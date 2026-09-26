import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// O ECO da resposta do agente de IA (E5 do docs/PLANO-agentes-de-ia.md), de
// ponta a ponta DENTRO da rota: o webhook entra pelo `POST` de verdade, sobre
// o banco de mentira em memória. O turno grava o id do provedor antes do
// INSERT da mensagem; se a linha não aparece na espera de 2 s do `jaGravada`,
// o eco é gravado como a resposta do AGENTE — nunca como mensagem do celular
// (`persistDeviceMessage`, simulado aqui), que pausaria o agente e marcaria a
// conversa como "já teve gente" (D16). Ids e números fictícios.
// ============================================================

import type { Banco, Linha } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

const h = vi.hoisted(() => ({
  banco: null as unknown as Banco,
  after: [] as (() => Promise<void> | void)[],
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.after.push(cb);
  },
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, init }) },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => h.banco.db.from(t),
    rpc: (n: string, a: Record<string, unknown>) =>
      (h.banco.db as unknown as { rpc: (n: string, a: unknown) => unknown }).rpc(n, a),
  }),
}));

vi.mock('@/lib/whatsapp/inbound-store', () => {
  /** O caminho de SEMPRE: grava como o real grava (o celular com `from_device`). */
  const gravar =
    (tipo: 'cliente' | 'aparelho') =>
    async (_db: unknown, m: { providerMessageId: string; channelId?: string | null }) => {
      const id = `msg-${m.providerMessageId}`;
      (h.banco.tabelas.messages ??= []).push({
        id,
        conversation_id: 'conv-1',
        channel_id: m.channelId ?? null,
        message_id: m.providerMessageId,
        sender_type: tipo === 'cliente' ? 'customer' : 'agent',
        from_device: tipo === 'aparelho',
      });
      return { messageId: id, conversationId: 'conv-1', contato: null };
    };
  return {
    persistInboundMessage: vi.fn(gravar('cliente')),
    persistDeviceMessage: vi.fn(gravar('aparelho')),
  };
});

vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn(async () => {}) }));

import { persistDeviceMessage, persistInboundMessage } from '@/lib/whatsapp/inbound-store';
import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

import { POST } from './route';

const SEGREDO = 'segredo-de-teste';
const INSTANCIA = 'cbcrm-instancia-de-teste';
const LID = '100000000000000@lid';
const TEL = '5583900000000@s.whatsapp.net';
const AGORA = 1789747434; // 2026-09-18T16:03:54Z
const ID = '3EB0-RESPOSTA-DA-IA';
const TEXTO = 'Olá! Vou verificar o seu contrato.\n\n— Escritório';
const TURNOS = 'cb_ia_turnos';

const conta: Linha = { id: 'conta-1', owner_user_id: 'dono-1' };
const canal: Linha = {
  id: 'canal-1',
  account_id: 'conta-1',
  created_by: 'membro-que-conectou',
  groups_enabled: true,
  own_lid: null,
  instance_name: INSTANCIA,
  kind: 'evolution',
};
const turno = (over: Linha = {}): Linha => ({
  id: 'turno-1',
  account_id: 'conta-1',
  conversation_id: 'conv-ia',
  canal_id: 'canal-1',
  ia_agente_id: 'agente-1',
  mensagem_enviada_id: ID,
  status: 'rodando',
  ...over,
});

const upsert = (data: Linha) => ({ event: 'messages.upsert', instance: INSTANCIA, data });

/** O eco da Evolution 2.4: telefone em `remoteJid`, LID em `remoteJidAlt`. */
const eco = (over: Linha = {}) =>
  upsert({
    key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: true, id: ID },
    pushName: 'Escritório',
    message: { conversation: TEXTO },
    messageType: 'conversation',
    messageTimestamp: AGORA,
    ...over,
  });

/** Entrega um webhook e roda o `after()` dele, com a espera de 2 s passando no relógio falso. */
async function entregar(corpo: unknown, durante?: () => void) {
  const antes = h.after.length;
  const resposta = (await POST(
    new Request('http://localhost/api/whatsapp/evolution/webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEGREDO}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  )) as unknown as { init?: { status?: number } };
  expect(resposta.init?.status ?? 200).toBe(200);
  const novos = h.after.slice(antes);
  expect(novos).toHaveLength(1);
  const rodando = novos[0]();
  await vi.advanceTimersByTimeAsync(1_000);
  durante?.();
  await vi.advanceTimersByTimeAsync(1_500);
  await rodando;
}

let tabelasConsultadas: string[];
beforeEach(() => {
  vi.useFakeTimers({ now: (AGORA + 5) * 1000, toFake: ['Date', 'setTimeout'] });
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://banco.de.teste';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
  h.banco = criarBanco({
    accounts: [conta],
    cb_channels: [canal],
    [TURNOS]: [turno()],
    conversations: [{ id: 'conv-ia', account_id: 'conta-1', last_message_text: 'pergunta' }],
    messages: [],
  });
  tabelasConsultadas = [];
  const from = h.banco.db.from.bind(h.banco.db);
  (h.banco.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    tabelasConsultadas.push(t);
    return from(t);
  };
  h.after = [];
  vi.mocked(persistInboundMessage).mockClear();
  vi.mocked(persistDeviceMessage).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const doAgente = () => h.banco.tabelas.messages.filter((m) => m.sender_type === 'bot');

describe('o eco da resposta do agente de IA', () => {
  it('turno sem linha depois da espera: grava COMO a resposta do agente — nunca pelo caminho do celular', async () => {
    await entregar(eco());

    expect(persistDeviceMessage).not.toHaveBeenCalled();
    expect(persistInboundMessage).not.toHaveBeenCalled();
    expect(h.banco.tabelas.messages).toHaveLength(1);
    expect(doAgente()[0]).toMatchObject({
      conversation_id: 'conv-ia',
      sender_type: 'bot',
      ia_agente_id: 'agente-1',
      channel_id: 'canal-1',
      message_id: ID,
      content_text: TEXTO,
      from_me: true,
      ai_generated: true,
    });
    expect(doAgente()[0]).not.toHaveProperty('from_device');
    expect(h.banco.tabelas.conversations[0].last_message_text).toBe(TEXTO);
    // Nenhum motor, nenhuma RPC (fila, pausa, reabertura).
    expect(h.banco.rpcs).toEqual([]);
  });

  it('a linha do envio JÁ existe: "já gravada", como sempre — nem pergunta ao turno', async () => {
    h.banco.tabelas.messages.push({ id: 'msg-envio', conversation_id: 'conv-ia', message_id: ID, sender_type: 'bot' });
    await entregar(eco());
    expect(persistDeviceMessage).not.toHaveBeenCalled();
    expect(h.banco.tabelas.messages).toHaveLength(1);
    expect(h.banco.escritas).toEqual([]);
    expect(tabelasConsultadas).not.toContain(TURNOS);
  });

  it('o INSERT do envio chega DURANTE a espera: "já gravada" — o turno não é consultado', async () => {
    await entregar(eco(), () => {
      h.banco.tabelas.messages.push({ id: 'msg-envio', conversation_id: 'conv-ia', message_id: ID, sender_type: 'bot' });
    });
    expect(persistDeviceMessage).not.toHaveBeenCalled();
    expect(h.banco.tabelas.messages).toHaveLength(1);
    expect(tabelasConsultadas).not.toContain(TURNOS);
  });

  it('id que NÃO é de turno: o caminho de sempre (mensagem do celular)', async () => {
    h.banco.tabelas[TURNOS] = [turno({ mensagem_enviada_id: 'OUTRO-ID' })];
    await entregar(eco());
    expect(persistDeviceMessage).toHaveBeenCalledTimes(1);
    expect(doAgente()).toEqual([]);
  });

  it('turno de OUTRA conta com o mesmo id: o caminho de sempre, e nada no fio da outra', async () => {
    h.banco.tabelas[TURNOS] = [turno({ account_id: 'conta-2', conversation_id: 'conv-da-outra' })];
    await entregar(eco());
    expect(persistDeviceMessage).toHaveBeenCalledTimes(1);
    expect(doAgente()).toEqual([]);
    expect(h.banco.tabelas.messages.some((m) => m.conversation_id === 'conv-da-outra')).toBe(false);
  });

  it('a leitura do turno falha: o caminho de sempre — a mensagem não se perde', async () => {
    h.banco.falhas[TURNOS] = { code: '57014', message: 'canceling statement due to statement timeout' };
    await entregar(eco());
    expect(persistDeviceMessage).toHaveBeenCalledTimes(1);
  });

  it('eco em `@lid` SEM telefone: também vira a resposta do agente, e nada fica retido', async () => {
    await entregar(
      eco({ key: { remoteJid: LID, fromMe: true, id: ID }, pushName: undefined }),
    );
    expect(persistDeviceMessage).not.toHaveBeenCalled();
    expect(doAgente()[0]).toMatchObject({
      conversation_id: 'conv-ia',
      ia_agente_id: 'agente-1',
      remote_jid: null,
      remote_jid_lid: LID,
    });
    expect(h.banco.tabelas.cb_mensagens_sem_telefone ?? []).toEqual([]);
  });

  it('eco num GRUPO com id de turno (a regra é uma para todo eco): não vira mensagem de grupo do celular', async () => {
    await entregar(
      eco({ key: { remoteJid: '120363000000000000@g.us', participant: TEL, fromMe: true, id: ID } }),
    );
    expect(doAgente()).toHaveLength(1);
    expect(h.banco.tabelas.messages.some((m) => m.from_device === true)).toBe(false);
  });

  it('mensagem do CLIENTE não pergunta ao turno (a consulta só existe para eco sem linha)', async () => {
    await entregar(
      upsert({
        key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: false, id: ID },
        pushName: 'Cliente',
        message: { conversation: 'oi' },
        messageTimestamp: AGORA,
      }),
    );
    expect(persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(tabelasConsultadas).not.toContain(TURNOS);
  });
});

describe('lendo o fonte: todo eco `fromMe` pergunta ao turno antes do caminho do celular', () => {
  const fonte = fs
    .readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /** O eco que a rota passa: a conta da instância e o item cru. */
  const ECO = /\{\s*accountId:\s*route\.accountId,\s*item,?\s*\}/;

  it('toda chamada de `jaGravada(` que espera a corrida leva o item (grupo, 1:1 e `@lid` sem telefone)', () => {
    // A definição fica de fora; a religação passa a função sem chamá-la (não
    // espera a corrida — o limite está em `eco.ts`).
    const chamadas = [...fonte.matchAll(/(?<!function )jaGravada\(([^)]*)\)/g)].map((m) => m[1]);
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
    for (const args of chamadas) expect(args).toMatch(ECO);
  });

  it('dentro de `jaGravada`, o eco do turno vem DEPOIS da espera e da segunda olhada', () => {
    const inicio = fonte.indexOf('async function jaGravada(');
    const corpo = fonte.slice(inicio, fonte.indexOf('\n}\n', inicio));
    const espera = corpo.indexOf('setTimeout(');
    const segunda = corpo.indexOf('if (await existe()) return true;', espera);
    const semEco = corpo.indexOf('if (!eco) return false;');
    const assume = corpo.indexOf('assumirEcoDoTurno(');
    expect(espera).toBeGreaterThan(-1);
    expect(segunda).toBeGreaterThan(espera);
    expect(semEco).toBeGreaterThan(segunda);
    expect(assume).toBeGreaterThan(semEco);
  });

  it('o caminho do celular só é alcançado depois de `jaGravada` com o item', () => {
    for (const persistidor of ['persistDeviceMessage(', 'persistGroupDeviceMessage(']) {
      const chamada = fonte.indexOf(persistidor);
      expect(chamada, persistidor).toBeGreaterThan(-1);
      const antes = fonte.slice(0, chamada);
      const ultimaPergunta = antes.lastIndexOf('jaGravada(');
      expect(ultimaPergunta, persistidor).toBeGreaterThan(-1);
      expect(antes.slice(ultimaPergunta)).toMatch(ECO);
    }
  });
});
