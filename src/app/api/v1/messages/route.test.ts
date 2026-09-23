import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/v1/messages — o `channel_id` é conferido ANTES de criar
// contato/conversa e ANTES de fixar.
//
// `GET /api/v1/channels` lista também as contas do Instagram, e
// `pinConversationChannel` só confere a POSSE: um id de Instagram era
// FIXADO na conversa do telefone, e só depois o núcleo recusava com
// `not_supported`. A conversa ficava presa no Instagram e todo envio
// seguinte falhava. Mesmo código e status; o efeito colateral sai.
// Ids fictícios.
// ============================================================

const h = vi.hoisted(() => ({
  canal: null as { id: string; kind: string } | null,
  erroDoCanal: null as { message: string } | null,
  leituras: 0,
  resolveConversationByPhone: vi.fn(),
  sendMessageToConversation: vi.fn(),
  pinConversationChannel: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    accountId: 'conta-1',
    keyId: 'chave-1',
    supabase: {
      from: (tabela: string) => {
        if (tabela !== 'cb_channels') throw new Error(`tabela inesperada: ${tabela}`);
        const cadeia = {
          select: () => cadeia,
          eq: () => cadeia,
          maybeSingle: async () => {
            h.leituras++;
            return { data: h.canal, error: h.erroDoCanal };
          },
        };
        return cadeia;
      },
    },
  })),
}));
vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: h.resolveConversationByPhone,
}));
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: h.sendMessageToConversation,
  validateSendMessageParams: () => {},
  SendMessageError: class SendMessageError extends Error {
    code = 'x';
    status = 400;
  },
}));
vi.mock('@/lib/cb-channels/stamp', () => ({
  pinConversationChannel: h.pinConversationChannel,
}));

import { POST } from './route';

const CANAL = '0f0f0f0f-1111-4222-8333-444444444444';

const post = (corpo: unknown) =>
  POST(
    new Request('http://localhost/api/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: JSON.stringify(corpo),
    })
  );

const nadaFoiFeito = () => {
  expect(h.resolveConversationByPhone).not.toHaveBeenCalled();
  expect(h.pinConversationChannel).not.toHaveBeenCalled();
  expect(h.sendMessageToConversation).not.toHaveBeenCalled();
};

beforeEach(() => {
  h.canal = null;
  h.erroDoCanal = null;
  h.leituras = 0;
  h.resolveConversationByPhone.mockReset().mockResolvedValue({
    conversationId: 'conv-1',
    contactId: 'contato-1',
    contactCreated: false,
  });
  h.pinConversationChannel.mockReset().mockResolvedValue(true);
  h.sendMessageToConversation.mockReset().mockResolvedValue({
    messageId: 'msg-1',
    whatsappMessageId: 'wamid.1',
    channelId: CANAL,
  });
});

describe('POST /api/v1/messages — o canal pedido', () => {
  it('⚠️ conta do Instagram: 400 not_supported, SEM fixar a conversa nem criar contato', async () => {
    h.canal = { id: CANAL, kind: 'instagram' };
    const r = await post({ to: '+5581988745316', text: 'oi', channel_id: CANAL });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('not_supported');
    nadaFoiFeito();
  });

  it('canal de outra conta (ou apagado): 400 bad_request, sem contato criado', async () => {
    h.canal = null;
    const r = await post({ to: '+5581988745316', text: 'oi', channel_id: CANAL });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({
      error: { code: 'bad_request', message: "'channel_id' is not a channel of this account" },
    });
    nadaFoiFeito();
  });

  it('id que não é UUID: o mesmo 400, sem ir ao banco (o Postgres recusaria o filtro)', async () => {
    const r = await post({ to: '+5581988745316', text: 'oi', channel_id: 'comercial' });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('bad_request');
    expect(h.leituras).toBe(0);
    nadaFoiFeito();
  });

  it('erro de banco na leitura do canal é 500, nunca "não é desta conta"', async () => {
    h.erroDoCanal = { message: 'timeout' };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await post({ to: '+5581988745316', text: 'oi', channel_id: CANAL });
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('internal');
    nadaFoiFeito();
    erro.mockRestore();
  });

  it.each(['meta', 'evolution'])('número de WhatsApp (%s): fixa e envia', async (kind) => {
    h.canal = { id: CANAL, kind };
    const r = await post({ to: '+5581988745316', text: 'oi', channel_id: CANAL });
    expect(r.status).toBe(201);
    expect(h.pinConversationChannel).toHaveBeenCalledWith(
      expect.anything(),
      'conta-1',
      'conv-1',
      CANAL
    );
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1);
    expect((await r.json()).data).toMatchObject({ conversation_id: 'conv-1', channel_id: CANAL });
  });

  it('sem channel_id: não lê canal, não fixa, envia', async () => {
    const r = await post({ to: '+5581988745316', text: 'oi' });
    expect(r.status).toBe(201);
    expect(h.leituras).toBe(0);
    expect(h.pinConversationChannel).not.toHaveBeenCalled();
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1);
  });
});
