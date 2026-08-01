import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// Só o resolvedor de canal é substituído — os testes de `channelId` no fim
// do arquivo precisam mandar nele. Os demais estouram antes de chegar lá.
vi.mock('@/lib/cb-channels/resolve', () => ({
  resolveChannelForConversation: vi.fn(),
}));

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

// ------------------------------------------------------------
// `channelId` — o canal EXIGIDO (925, mensagem agendada).
//
// A propriedade que estes dois testes travam é a razão de o parâmetro
// existir: `resolveChannelForConversation` cai para o canal padrão da conta
// quando o id pedido não resolve, e ele faz isso EM SILÊNCIO. No envio
// manual está certo — tem gente na tela vendo. Numa agendada é a mensagem
// saindo pelo número errado às 9 da manhã, e num escritório de advocacia
// isso mistura identidades sem ninguém perceber.
// ------------------------------------------------------------
describe('sendMessageToConversation — canal exigido', () => {
  function dbComConversa(): SupabaseClient {
    return {
      from: (tabela: string) => {
        if (tabela !== 'conversations') {
          throw new Error(`não devia consultar ${tabela}`);
        }
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          single: () =>
            Promise.resolve({
              data: {
                id: 'cv-1',
                account_id: 'acct-1',
                group_id: null,
                group: null,
                contact: { id: 'ct-1', phone: '+5511999998888' },
              },
              error: null,
            }),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
  }

  it('recusa quando o canal pedido não é o que resolveu', async () => {
    const { resolveChannelForConversation } = await import(
      '@/lib/cb-channels/resolve'
    );
    vi.mocked(resolveChannelForConversation).mockResolvedValue({
      channelId: 'outro-canal',
    } as Awaited<ReturnType<typeof resolveChannelForConversation>>);

    await expect(
      sendMessageToConversation(dbComConversa(), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'oi',
        channelId: 'canal-que-sumiu',
      })
    ).rejects.toMatchObject({ code: 'channel_unavailable', status: 409 });
  });

  it('recusa quando o canal pedido não resolve para nada', async () => {
    const { resolveChannelForConversation } = await import(
      '@/lib/cb-channels/resolve'
    );
    vi.mocked(resolveChannelForConversation).mockResolvedValue(null);

    await expect(
      sendMessageToConversation(dbComConversa(), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'oi',
        channelId: 'canal-que-sumiu',
      })
    ).rejects.toMatchObject({ code: 'channel_unavailable', status: 409 });
  });
});
