import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Dublê do EvolutionClient: nenhuma chamada de rede. `estados` é a fila das
// respostas de `connectionState` (uma por leitura); `chamadas` registra a
// ordem do que o código pediu à Evolution.
const evo = vi.hoisted(() => ({
  estados: [] as string[],
  chamadas: [] as string[],
  falhaDoLogout: null as Error | null,
  falhaDoEstado: null as Error | null,
  qr: { base64: 'data:image/png;base64,QR', pairingCode: 'ABCD-1234' } as {
    base64?: string;
    pairingCode?: string;
  },
  instancias: [] as unknown[],
}));

vi.mock('@/lib/whatsapp/transport/evolution-client', () => ({
  EvolutionClient: class {
    async connectionState() {
      evo.chamadas.push('connectionState');
      if (evo.falhaDoEstado) throw evo.falhaDoEstado;
      const state = evo.estados.shift();
      if (!state) throw new Error('teste: connectionState sem resposta programada');
      return { instance: { state } };
    }
    async connect() {
      evo.chamadas.push('connect');
      return evo.qr;
    }
    async logout() {
      evo.chamadas.push('logout');
      if (evo.falhaDoLogout) throw evo.falhaDoLogout;
    }
    async fetchInstances() {
      evo.chamadas.push('fetchInstances');
      return evo.instancias;
    }
  },
}));

import {
  buildChannelInstanceName,
  channelConnectionState,
  ESPERA_FECHADA_MS,
  evolutionWebhookConfig,
  repairChannelPairing,
  SessaoAindaDePe,
  slugDoRotulo,
} from './evolution-admin';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('slugDoRotulo', () => {
  it('minúsculas, sem acento, separado por hífen', () => {
    expect(slugDoRotulo('Dr. Leonardo — Trabalhista')).toBe('dr-leonardo-trabalhista');
    expect(slugDoRotulo('Atendimento Ação')).toBe('atendimento-acao');
  });

  it('não deixa hífen nas pontas', () => {
    expect(slugDoRotulo('  Comercial 2!  ')).toBe('comercial-2');
  });

  it('devolve vazio quando não sobra caractere aproveitável', () => {
    expect(slugDoRotulo('🙂🙂')).toBe('');
    expect(slugDoRotulo('...')).toBe('');
  });

  it('corta em 32 caracteres sem deixar hífen solto no fim', () => {
    // 60 é o teto do rótulo na rota; o nome da instância não precisa dele todo.
    const s = slugDoRotulo('a'.repeat(32) + ' sobra');
    expect(s).toBe('a'.repeat(32));
    expect(s).not.toMatch(/-$/);
  });
});

describe('buildChannelInstanceName', () => {
  it('deriva do RÓTULO, com sufixo aleatório', () => {
    const name = buildChannelInstanceName('11111111-2222-3333-4444-555555555555', 'CBAdv');
    expect(name).toMatch(/^cbadv-[0-9a-f]{6}$/);
  });

  it('cai no accountId quando o rótulo não vira slug', () => {
    const acct = '11111111-2222-3333-4444-555555555555';
    expect(buildChannelInstanceName(acct, '🙂')).toMatch(
      new RegExp(`^cbcrm-${acct}-[0-9a-f]{6}$`),
    );
  });

  it('não colide com o nome do canal padrão (cbcrm-<accountId>)', () => {
    const acct = 'acct-1';
    // O padrão single-channel do Gabriel usa exatamente `cbcrm-<accountId>`.
    expect(buildChannelInstanceName(acct, 'cbcrm')).not.toBe(`cbcrm-${acct}`);
    expect(buildChannelInstanceName(acct, '🙂')).not.toBe(`cbcrm-${acct}`);
  });

  it('gera nomes distintos para o MESMO rótulo', () => {
    // O sufixo é o que separa dois canais de mesmo nome — e o que impede o
    // create-or-adopt de assumir instância alheia de nome igual.
    const a = buildChannelInstanceName('acct-1', 'Comercial');
    const b = buildChannelInstanceName('acct-1', 'Comercial');
    expect(a).not.toBe(b);
  });
});

describe('evolutionWebhookConfig', () => {
  it('lança sem EVOLUTION_WEBHOOK_SECRET', () => {
    vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com');
    expect(() => evolutionWebhookConfig()).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
  });

  it('monta a URL do webhook a partir de NEXT_PUBLIC_SITE_URL (sem barra dupla)', () => {
    vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', 'segredo');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    const cfg = evolutionWebhookConfig();
    expect(cfg.secret).toBe('segredo');
    expect(cfg.url).toBe('https://crm.example.com/api/whatsapp/evolution/webhook');
  });

  it('usa o requestOrigin de fallback quando SITE_URL não está setado', () => {
    vi.stubEnv('EVOLUTION_WEBHOOK_SECRET', 'segredo');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const cfg = evolutionWebhookConfig('http://localhost:3000');
    expect(cfg.url).toBe('http://localhost:3000/api/whatsapp/evolution/webhook');
  });
});

// ============================================================
// QR só depois de "fechada confirmada" (06/10/2026). Na Evolution 2.4,
// `GET /instance/connect` com o estado 'close' SEMPRE abre um socket novo e
// não fecha o anterior; depois de uma queda que ela reconecta sozinha (em 3 s)
// o estado passa por 'close', e um connect nessa janela duplicava a sessão.
// ============================================================

describe('channelConnectionState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('EVOLUTION_BASE_URL', 'http://evolution.teste');
    vi.stubEnv('EVOLUTION_GLOBAL_API_KEY', 'chave-de-teste');
    evo.estados = [];
    evo.chamadas = [];
    evo.falhaDoLogout = null;
    evo.falhaDoEstado = null;
    evo.instancias = [];
  });

  it("'open' → o número, sem connect", async () => {
    evo.estados = ['open'];
    evo.instancias = [
      { name: 'inst-a', ownerJid: '5551999998229@s.whatsapp.net', connectionStatus: 'open' },
    ];
    const res = await channelConnectionState('inst-a');
    expect(res).toEqual({ state: 'open', ownerPhone: '5551999998229' });
    expect(evo.chamadas).toEqual(['connectionState', 'fetchInstances']);
  });

  it("'open' com o número ainda não gravado → numeroPendente, sem connect", async () => {
    evo.estados = ['open'];
    evo.instancias = [
      { name: 'inst-a', ownerJid: '5551999990000@s.whatsapp.net', connectionStatus: 'connecting' },
    ];
    const res = await channelConnectionState('inst-a');
    expect(res).toEqual({ state: 'open', numeroPendente: true });
    expect(evo.chamadas).not.toContain('connect');
  });

  it("'connecting' → UM connect (o QR vigente, sem socket novo), sem esperar", async () => {
    evo.estados = ['connecting'];
    const res = await channelConnectionState('inst-a');
    expect(res).toEqual({
      state: 'connecting',
      qrBase64: 'data:image/png;base64,QR',
      pairingCode: 'ABCD-1234',
    });
    expect(evo.chamadas).toEqual(['connectionState', 'connect']);
  });

  it("'close' → espera ESPERA_FECHADA_MS, lê de novo e, ainda 'close', UM connect", async () => {
    evo.estados = ['close', 'close'];
    const promessa = channelConnectionState('inst-a');

    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS - 1);
    // Dentro da janela da reconexão automática: nada além da primeira leitura.
    expect(evo.chamadas).toEqual(['connectionState']);

    await vi.advanceTimersByTimeAsync(1);
    const res = await promessa;
    expect(evo.chamadas).toEqual(['connectionState', 'connectionState', 'connect']);
    expect(res).toMatchObject({ state: 'close', qrBase64: 'data:image/png;base64,QR' });
  });

  it("'close' que a Evolution reconectou ('connecting') → o QR vigente; nenhum connect com 'close'", async () => {
    evo.estados = ['close', 'connecting'];
    const promessa = channelConnectionState('inst-a');
    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS);
    const res = await promessa;
    // O único connect é o de 'connecting', que só devolve o QR guardado.
    expect(evo.chamadas).toEqual(['connectionState', 'connectionState', 'connect']);
    expect(res.state).toBe('connecting');
  });

  it("'close' que reabriu sozinha ('open') → nenhum connect", async () => {
    evo.estados = ['close', 'open'];
    evo.instancias = [
      { name: 'inst-a', ownerJid: '5551999998229@s.whatsapp.net', connectionStatus: 'open' },
    ];
    const promessa = channelConnectionState('inst-a');
    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS);
    const res = await promessa;
    expect(evo.chamadas).toEqual(['connectionState', 'connectionState', 'fetchInstances']);
    expect(res).toEqual({ state: 'open', ownerPhone: '5551999998229' });
  });

  it('duas consultas simultâneas da mesma instância → a MESMA promessa: um ciclo, um connect', async () => {
    evo.estados = ['close', 'close'];
    const a = channelConnectionState('inst-a');
    const b = channelConnectionState('inst-a');
    expect(b).toBe(a);
    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS);
    await Promise.all([a, b]);
    expect(evo.chamadas.filter((c) => c === 'connect')).toHaveLength(1);
    expect(evo.chamadas.filter((c) => c === 'connectionState')).toHaveLength(2);
  });

  it('instâncias diferentes não esperam uma pela outra', async () => {
    evo.estados = ['connecting', 'connecting'];
    const [a, b] = await Promise.all([
      channelConnectionState('inst-a'),
      channelConnectionState('inst-b'),
    ]);
    expect(a.state).toBe('connecting');
    expect(b.state).toBe('connecting');
    expect(evo.chamadas.filter((c) => c === 'connect')).toHaveLength(2);
  });

  it('a entrada sai quando a promessa assenta, inclusive no erro', async () => {
    evo.falhaDoEstado = new Error('Evolution fora do ar');
    await expect(channelConnectionState('inst-a')).rejects.toThrow('Evolution fora do ar');

    evo.falhaDoEstado = null;
    evo.estados = ['connecting'];
    // Uma consulta NOVA (não a promessa rejeitada de antes).
    await expect(channelConnectionState('inst-a')).resolves.toMatchObject({ state: 'connecting' });
  });
});

describe('repairChannelPairing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('EVOLUTION_BASE_URL', 'http://evolution.teste');
    vi.stubEnv('EVOLUTION_GLOBAL_API_KEY', 'chave-de-teste');
    evo.estados = [];
    evo.chamadas = [];
    evo.falhaDoLogout = null;
    evo.falhaDoEstado = null;
    evo.instancias = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it("logout que LANÇA com a sessão 'open' → SessaoAindaDePe e NENHUM connect", async () => {
    evo.falhaDoLogout = new Error('timeout');
    evo.estados = ['open'];
    const promessa = repairChannelPairing('inst-a');
    await expect(promessa).rejects.toBeInstanceOf(SessaoAindaDePe);
    await expect(promessa).rejects.toThrow(/não confirmou o logout/);
    expect(evo.chamadas).toEqual(['logout', 'connectionState']);
  });

  it('logout que lança com a instância já fechada → segue, e o connect só depois de fechada confirmada', async () => {
    evo.falhaDoLogout = new Error('Instance already logged out');
    evo.estados = ['close', 'close'];
    const promessa = repairChannelPairing('inst-a');
    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS - 1);
    expect(evo.chamadas).not.toContain('connect');
    await vi.advanceTimersByTimeAsync(1);
    await expect(promessa).resolves.toEqual({
      qrBase64: 'data:image/png;base64,QR',
      pairingCode: 'ABCD-1234',
    });
    expect(evo.chamadas).toEqual(['logout', 'connectionState', 'connectionState', 'connect']);
  });

  it('logout ok → connect depois da fechada confirmada, com o pairingCode preservado', async () => {
    evo.estados = ['close', 'close'];
    const promessa = repairChannelPairing('inst-a');
    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS - 1);
    expect(evo.chamadas).toEqual(['logout', 'connectionState']);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promessa).resolves.toEqual({
      qrBase64: 'data:image/png;base64,QR',
      pairingCode: 'ABCD-1234',
    });
    expect(evo.chamadas).toEqual(['logout', 'connectionState', 'connectionState', 'connect']);
  });

  it('a consulta em curso termina ANTES do logout, e a que chega durante o repareamento recebe a promessa dele', async () => {
    evo.estados = ['close', 'close', 'close', 'close'];
    const consulta = channelConnectionState('inst-a');
    const reparo = repairChannelPairing('inst-a');

    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS - 1);
    expect(evo.chamadas).not.toContain('logout');

    await vi.advanceTimersByTimeAsync(1);
    await consulta;
    // O logout só sai depois que a consulta (e o connect dela) assentou.
    expect(evo.chamadas.slice(0, 4)).toEqual([
      'connectionState',
      'connectionState',
      'connect',
      'logout',
    ]);

    const durante = channelConnectionState('inst-a');
    await vi.advanceTimersByTimeAsync(ESPERA_FECHADA_MS);
    const [doReparo, daConsulta] = await Promise.all([reparo, durante]);
    expect(daConsulta.pairingCode).toBe(doReparo.pairingCode);
    // Um connect da consulta antiga e UM do repareamento; o "durante" não somou outro.
    expect(evo.chamadas.filter((c) => c === 'connect')).toHaveLength(2);
  });
});
