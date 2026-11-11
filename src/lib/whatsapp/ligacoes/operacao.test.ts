import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { segredoDoComputador, situacaoDaMaquina } from './computador';
import { comoNaTela, computadoresDaConta, qrDaConexao, reparearConexao, trocarInterruptor } from './operacao';

// ============================================================
// A operação do computador de ligações pela tela Conexões (4e, 1137), com um
// dublê da tabela e da máquina. Dados fictícios.
// ============================================================

const CONTA = '00000000-0000-4000-8000-000000000001';
const CANAL = '00000000-0000-4000-8000-0000000000c1';
const SEGREDO = 's'.repeat(40);
const AGORA = Date.parse('2026-11-11T15:00:00Z');
const RECENTE = new Date(AGORA - 30_000).toISOString();
const LIGADO = '2026-11-01T12:00:00.000Z';
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

type Linha = Record<string, unknown>;

/** A tabela num array; cada consulta guarda os filtros, e o UPDATE aplica o patch. */
function banco(linhas: Linha[], erro: { message: string } | null = null) {
  const consultas: { op: string; patch?: Linha; filtros: [string, string, unknown][] }[] = [];
  const db = {
    from: (tabela: string) => {
      expect(tabela).toBe('cb_computadores_de_ligacao');
      const c: (typeof consultas)[number] = { op: 'select', filtros: [] };
      consultas.push(c);
      const casa = (l: Linha) =>
        c.filtros.every(([tipo, coluna, valor]) => (tipo === 'eq' ? l[coluna] === valor : l[coluna] === null));
      const resultado = () => {
        if (erro) return { data: null, error: erro };
        const achadas = linhas.filter(casa);
        if (c.op === 'update') for (const l of achadas) Object.assign(l, c.patch);
        return { data: achadas.map((l) => ({ ...l })), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        update: (patch: Linha) => ((c.op = 'update'), (c.patch = patch), q),
        eq: (coluna: string, valor: unknown) => (c.filtros.push(['eq', coluna, valor]), q),
        is: (coluna: string, valor: unknown) => (c.filtros.push(['is', coluna, valor]), q),
        maybeSingle: async () => {
          const r = resultado();
          return { data: r.data?.[0] ?? null, error: r.error };
        },
        then: (ok: (r: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, falha),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, consultas };
}

const computador = (extra: Linha = {}): Linha => ({
  id: 'comp-1',
  account_id: CONTA,
  channel_id: CANAL,
  nome: 'ficticio',
  endereco: 'http://ligacoes-ficticio:8080',
  whatsapp: 'conectado',
  ligacao_em_curso: null,
  ultimo_sinal_em: RECENTE,
  ligado_em: LIGADO,
  ...extra,
});

/** A máquina falsa: responde por caminho e guarda cada pedido. */
function maquina(respostas: Record<string, { status: number; corpo: unknown } | 'cai'>) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const enviar = vi.fn(async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    const r = respostas[new URL(url).pathname];
    if (!r || r === 'cai') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.corpo), { status: r.status });
  }) as unknown as typeof fetch;
  return { enviar, pedidos };
}

describe('a situação do computador (a régua da tela)', () => {
  it('fora, QR, carregando, em ligação e pronto', () => {
    const base = { whatsapp: 'conectado', ligacao_em_curso: null, ultimo_sinal_em: RECENTE };
    expect(situacaoDaMaquina({ ...base, ultimo_sinal_em: new Date(AGORA - 4 * 60_000).toISOString() }, AGORA)).toBe('fora');
    expect(situacaoDaMaquina({ ...base, ultimo_sinal_em: null }, AGORA)).toBe('fora');
    expect(situacaoDaMaquina({ ...base, whatsapp: 'qr' }, AGORA)).toBe('qr');
    expect(situacaoDaMaquina({ ...base, whatsapp: 'carregando' }, AGORA)).toBe('carregando');
    expect(situacaoDaMaquina({ ...base, whatsapp: null }, AGORA)).toBe('carregando');
    expect(situacaoDaMaquina({ ...base, ligacao_em_curso: 'lig-1' }, AGORA)).toBe('em_ligacao');
    expect(situacaoDaMaquina(base, AGORA)).toBe('pronto');
  });

  it('a tela nunca recebe o endereço nem o nome do contêiner; desligado não tem situação', () => {
    const naTela = comoNaTela(computador() as never, AGORA);
    expect(naTela).toEqual({ channel_id: CANAL, ligado: true, ligado_em: LIGADO, situacao: 'pronto', sinal_em: RECENTE });
    expect(JSON.stringify(naTela)).not.toMatch(/ligacoes-ficticio|ficticio:8080/);
    expect(comoNaTela(computador({ ligado_em: null }) as never, AGORA)).toMatchObject({ ligado: false, situacao: null });
  });

  it('a lista da conta: cercada pela conta; a falha é "falhou", nunca a lista vazia', async () => {
    const { db, consultas } = banco([computador()]);
    expect(await computadoresDaConta(db, CONTA, AGORA)).toHaveLength(1);
    expect(consultas[0].filtros).toContainEqual(['eq', 'account_id', CONTA]);
    expect(await computadoresDaConta(banco([], { message: 'fora do ar' }).db, CONTA, AGORA)).toBe('falhou');
  });
});

describe('o interruptor', () => {
  it('liga e desliga, cercado pela conta e pela conexão', async () => {
    const linhas = [computador({ ligado_em: null })];
    const { db, consultas } = banco(linhas);
    expect(await trocarInterruptor(db, CONTA, CANAL, true, '2026-11-11T15:00:00.000Z')).toEqual({
      ok: true,
      ligado_em: '2026-11-11T15:00:00.000Z',
    });
    expect(consultas[0].filtros).toEqual([
      ['eq', 'account_id', CONTA],
      ['eq', 'channel_id', CANAL],
      ['is', 'ligado_em', null],
    ]);
    expect(await trocarInterruptor(db, CONTA, CANAL, false, '2026-11-11T16:00:00.000Z')).toEqual({ ok: true, ligado_em: null });
    expect(linhas[0].ligado_em).toBeNull();
  });

  it('ligar o que já está ligado mantém o "ligado desde"', async () => {
    const { db } = banco([computador()]);
    expect(await trocarInterruptor(db, CONTA, CANAL, true, '2026-11-11T15:00:00.000Z')).toEqual({ ok: true, ligado_em: LIGADO });
  });

  it('sem computador nesta conexão (D17): 404; de outra conta não serve', async () => {
    const { db } = banco([computador({ account_id: '00000000-0000-4000-8000-000000000002' })]);
    expect(await trocarInterruptor(db, CONTA, CANAL, true, '2026-11-11T15:00:00.000Z')).toEqual({
      ok: false,
      status: 404,
      erro: 'sem_computador',
    });
  });
});

describe('o QR ao vivo', () => {
  it('pede o estado e, pedindo o QR, a foto dele — com o segredo DO computador, por GET', async () => {
    const m = maquina({ '/estado': { status: 200, corpo: { whatsapp: 'qr' } }, '/qr': { status: 200, corpo: { qr: QR } } });
    expect(await qrDaConexao(banco([computador()]).db, CONTA, CANAL, SEGREDO, m.enviar)).toEqual({ ok: true, whatsapp: 'qr', qr: QR });
    expect(m.pedidos.map((p) => [p.url, p.init.method])).toEqual([
      ['http://ligacoes-ficticio:8080/estado', 'GET'],
      ['http://ligacoes-ficticio:8080/qr', 'GET'],
    ]);
    expect((m.pedidos[0].init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${segredoDoComputador(SEGREDO, 'ficticio')}`,
    );
    expect(m.pedidos[0].init.body).toBeUndefined();
  });

  it('conectado: sem QR, e sem pedir a foto', async () => {
    const m = maquina({ '/estado': { status: 200, corpo: { whatsapp: 'conectado' } } });
    expect(await qrDaConexao(banco([computador()]).db, CONTA, CANAL, SEGREDO, m.enviar)).toEqual({
      ok: true,
      whatsapp: 'conectado',
      qr: null,
    });
    expect(m.pedidos).toHaveLength(1);
  });

  it('⚠️ o que não é PNG em data URL não chega à tela', async () => {
    const m = maquina({
      '/estado': { status: 200, corpo: { whatsapp: 'qr' } },
      '/qr': { status: 200, corpo: { qr: 'javascript:alert(1)' } },
    });
    expect(await qrDaConexao(banco([computador()]).db, CONTA, CANAL, SEGREDO, m.enviar)).toEqual({ ok: true, whatsapp: 'qr', qr: null });
  });

  it('desligado: 409 sem falar com a máquina; a máquina que não responde: 502', async () => {
    const m = maquina({});
    expect(await qrDaConexao(banco([computador({ ligado_em: null })]).db, CONTA, CANAL, SEGREDO, m.enviar)).toEqual({
      ok: false,
      status: 409,
      erro: 'desligado',
    });
    expect(m.pedidos).toHaveLength(0);
    expect(await qrDaConexao(banco([computador()]).db, CONTA, CANAL, SEGREDO, maquina({ '/estado': 'cai' }).enviar)).toEqual({
      ok: false,
      status: 502,
      erro: 'sem_resposta',
    });
  });
});

describe('o Reparear', () => {
  it('pede o desconectar à máquina (POST) e devolve ok', async () => {
    const m = maquina({ '/desconectar': { status: 200, corpo: {} } });
    expect(await reparearConexao(banco([computador()]).db, CONTA, CANAL, SEGREDO, m.enviar)).toEqual({ ok: true });
    expect(m.pedidos[0].url).toBe('http://ligacoes-ficticio:8080/desconectar');
    expect(m.pedidos[0].init.method).toBe('POST');
  });

  it('⚠️ em ligação não desconecta (409); já pedindo o QR, 409; a máquina que não desconectou, 502', async () => {
    const casos: [Record<string, { status: number; corpo: unknown } | 'cai'>, unknown][] = [
      [{ '/desconectar': { status: 409, corpo: { erro: 'ocupada' } } }, { ok: false, status: 409, erro: 'em_ligacao' }],
      [{ '/desconectar': { status: 503, corpo: { erro: 'whatsapp_desconectado' } } }, { ok: false, status: 409, erro: 'ja_pede_qr' }],
      [{ '/desconectar': { status: 500, corpo: { erro: 'falhou' } } }, { ok: false, status: 502, erro: 'nao_desconectou' }],
      [{ '/desconectar': 'cai' }, { ok: false, status: 502, erro: 'sem_resposta' }],
    ];
    for (const [respostas, esperado] of casos) {
      expect(await reparearConexao(banco([computador()]).db, CONTA, CANAL, SEGREDO, maquina(respostas).enviar)).toEqual(esperado);
    }
  });

  it('desligado ou sem computador: nem fala com a máquina', async () => {
    const m = maquina({});
    expect((await reparearConexao(banco([computador({ ligado_em: null })]).db, CONTA, CANAL, SEGREDO, m.enviar)).ok).toBe(false);
    expect(await reparearConexao(banco([]).db, CONTA, CANAL, SEGREDO, m.enviar)).toEqual({ ok: false, status: 404, erro: 'sem_computador' });
    expect(m.pedidos).toHaveLength(0);
  });
});
