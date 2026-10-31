import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Mensagem ENTRE dois números da mesma conta (25/10/2026): a Bancário -
// Comercial escreve para a Bancário - Jurídico. O id do WhatsApp é o mesmo nos
// dois lados, e a SAÍDA já está gravada com ele quando a chegada bate no
// webhook do outro número. Antes, `jaGravada` comparava com qualquer linha e a
// chegada era descartada como repetida, em silêncio. Agora a chegada só se
// compara com outra CHEGADA da mesma conta. Ids e números fictícios.
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

vi.mock('@/lib/whatsapp/inbound-store', () => ({
  persistInboundMessage: vi.fn(async () => ({ messageId: 'msg-nova', conversationId: 'conv-b', contato: null })),
  persistDeviceMessage: vi.fn(async () => ({ messageId: 'msg-aparelho', conversationId: 'conv-b', contato: null })),
}));

vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn(async () => {}) }));

import { persistDeviceMessage, persistInboundMessage } from '@/lib/whatsapp/inbound-store';
import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

import { POST } from './route';

const SEGREDO = 'segredo-de-teste';
const INSTANCIA_B = 'cbcrm-numero-b';
const TEL_A = '5511900000001@s.whatsapp.net';
const AGORA = 1792980000;
const ID = '3EB0-ENTRE-CONEXOES';

const conta: Linha = { id: 'conta-1', owner_user_id: 'dono-1' };
const canalB: Linha = {
  id: 'canal-b',
  account_id: 'conta-1',
  created_by: 'membro',
  groups_enabled: true,
  own_lid: null,
  instance_name: INSTANCIA_B,
  kind: 'evolution',
};

/** O que o número B recebe do número A (os dois desta conta). */
const chegada = (over: Linha = {}) => ({
  event: 'messages.upsert',
  instance: INSTANCIA_B,
  data: {
    key: { remoteJid: TEL_A, fromMe: false, id: ID },
    pushName: 'Número A',
    message: { conversation: 'TESTE: olá do outro número' },
    messageType: 'conversation',
    messageTimestamp: AGORA,
    ...over,
  },
});

async function entregar(corpo: unknown) {
  const antes = h.after.length;
  await POST(
    new Request('http://localhost/api/whatsapp/evolution/webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEGREDO}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
  for (const cb of h.after.slice(antes)) {
    const rodando = cb();
    await vi.advanceTimersByTimeAsync(3_000);
    await rodando;
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: (AGORA + 5) * 1000, toFake: ['Date', 'setTimeout'] });
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://banco.de.teste';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
  h.banco = criarBanco({ accounts: [conta], cb_channels: [canalB], messages: [] });
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

describe('mensagem entre dois números da mesma conta', () => {
  it('a SAÍDA do número A tem o mesmo id: a chegada no número B é gravada', async () => {
    h.banco.tabelas.messages.push({
      id: 'msg-saida-a',
      conversation_id: 'conv-a',
      message_id: ID,
      sender_type: 'agent',
      conversations: { account_id: 'conta-1' },
    });
    await entregar(chegada());
    expect(persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(persistDeviceMessage).not.toHaveBeenCalled();
  });

  it('a mesma CHEGADA já gravada nesta conta continua repetida', async () => {
    h.banco.tabelas.messages.push({
      id: 'msg-chegada',
      conversation_id: 'conv-b',
      message_id: ID,
      sender_type: 'customer',
      conversations: { account_id: 'conta-1' },
    });
    await entregar(chegada());
    expect(persistInboundMessage).not.toHaveBeenCalled();
  });

  it('chegada com o mesmo id em OUTRA conta não segura a desta', async () => {
    h.banco.tabelas.messages.push({
      id: 'msg-outra-conta',
      conversation_id: 'conv-x',
      message_id: ID,
      sender_type: 'customer',
      conversations: { account_id: 'conta-2' },
    });
    await entregar(chegada());
    expect(persistInboundMessage).toHaveBeenCalledTimes(1);
  });

  it('o ECO (fromMe) da saída continua "já gravado": não vira mensagem do celular', async () => {
    h.banco.tabelas.messages.push({
      id: 'msg-saida-b',
      conversation_id: 'conv-b',
      message_id: ID,
      sender_type: 'agent',
      conversations: { account_id: 'conta-1' },
    });
    await entregar(chegada({ key: { remoteJid: TEL_A, fromMe: true, id: ID } }));
    expect(persistDeviceMessage).not.toHaveBeenCalled();
    expect(persistInboundMessage).not.toHaveBeenCalled();
  });
});
