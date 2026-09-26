import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// ============================================================
// Full send path — what actually lands in `messages` (issue #483).
// ============================================================

const sendTemplateMessage = vi.fn(async () => ({ messageId: 'wamid.1' }));

// Stub only the senders — the module also exports INTERACTIVE_LIMITS,
// which `interactive.ts` needs for the payload validation covered above.
vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid.text' })),
  sendTemplateMessage: (...args: unknown[]) =>
    (sendTemplateMessage as unknown as (...a: unknown[]) => unknown)(...args),
  sendMediaMessage: vi.fn(async () => ({ messageId: 'wamid.media' })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: 'wamid.btn' })),
  sendInteractiveList: vi.fn(async () => ({ messageId: 'wamid.list' })),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));

// A assinatura (P1.2/923) é o que separa "o cliente recebeu" de "o CRM
// mostra". O resolvedor do nome é substituído para que os casos de regressão
// no fim do arquivo possam provar que o texto PERSISTIDO é o assinado.
vi.mock('@/lib/assinatura/resolver', () => ({
  nomeAutomaticoParaAssinar: vi.fn(async () => null),
  nomeParaAssinar: vi.fn(async () => null),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  // Only used for the best-effort "pause active flow run" write.
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    }),
  }),
}));

// O transporte da Evolution é espiado: os casos da Fase 11.3 provam que a
// ficha só-BSUID é recusada ANTES de ele ser montado — a Evolution tiraria as
// letras do BSUID e mandaria ao número formado pelos dígitos dele.
const evolutionSendText = vi.fn(async () => ({ providerMessageId: 'evo.1' }));
vi.mock('@/lib/whatsapp/transport', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getTransport: vi.fn(() => ({
    sendText: (...a: unknown[]) =>
      (evolutionSendText as unknown as (...x: unknown[]) => unknown)(...a),
    sendMedia: vi.fn(async () => ({ providerMessageId: 'evo.media' })),
  })),
}));

interface CapturedWrites {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  /** Toda escrita em `contacts` (a autocorreção do telefone depois de 131030). */
  contactUpdates?: Record<string, unknown>[];
}

/**
 * Supabase fake covering the tables the send path touches. Each table
 * gets a builder that is both chainable and awaitable, so the same
 * object serves `.single()` lookups and the bare `select().eq().eq()`
 * the template resolver uses.
 */
function sendPathDb(
  templateRows: unknown[],
  captured: CapturedWrites,
  contact: Record<string, unknown> = { id: 'ct-1', phone: '+15551234567' }
): SupabaseClient {
  const conversation = {
    id: 'cv-1',
    contact,
  };
  const config = {
    id: 'cfg-1',
    phone_number_id: 'pn-1',
    access_token: 'token',
  };

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === 'messages') captured.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          // Só a escrita da PRÉVIA: a reabertura (`reopen.ts`) roda sempre
          // depois dela e, capturada, apagaria o que estes testes conferem.
          if (table === 'conversations' && 'last_message_text' in row) {
            captured.conversation = row;
          }
          if (table === 'contacts') {
            (captured.contactUpdates ??= []).push(row);
          }
          return builder;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === 'conversations') {
            return { data: conversation, error: null };
          }
          if (table === 'whatsapp_config') return { data: config, error: null };
          if (table === 'messages') {
            return { data: { id: 'msg-1' }, error: null };
          }
          return { data: null, error: null };
        },
        // Bare-await result — only message_templates is read this way.
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) =>
          resolve({
            data: table === 'message_templates' ? templateRows : [],
            error: null,
          }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const TEMPLATE_ROW = {
  id: 'tpl-1',
  user_id: 'u-1',
  name: 'order_update',
  category: 'Utility',
  language: 'en',
  body_text: 'Your order {{1}} ships on {{2}}',
  created_at: '2026-01-01T00:00:00Z',
};

describe('sendMessageToConversation — template persistence (#483)', () => {
  // Nesta base o envio resolve o CANAL antes de qualquer outra coisa, e o
  // resolvedor está mockado no topo do arquivo — sem devolver um canal Meta
  // aqui, todo teste deste bloco estoura em `whatsapp_not_configured` antes
  // de chegar ao que ele quer exercitar.
  beforeEach(async () => {
    const { resolveChannelForConversation } = await import(
      '@/lib/cb-channels/resolve'
    );
    vi.mocked(resolveChannelForConversation).mockResolvedValue({
      channelId: 'canal-1',
      provider: 'meta',
      phone_number_id: 'pn-1',
      access_token: 'tok-1',
    } as unknown as Awaited<ReturnType<typeof resolveChannelForConversation>>);
  });

  it('stores the substituted body when the caller sends no text', async () => {
    const captured: CapturedWrites = {};
    const result = await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], captured),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A123', 'Friday'],
      }
    );

    expect(result.whatsappMessageId).toBe('wamid.1');
    // Was NULL before the fix — the Inbox rendered an empty bubble.
    expect(captured.message?.content_text).toBe(
      'Your order A123 ships on Friday'
    );
    expect(captured.message?.template_name).toBe('order_update');
    // …and the conversation-list preview reads the body, not '[template]'.
    expect(captured.conversation?.last_message_text).toBe(
      'Your order A123 ships on Friday'
    );
  });

  it('reads body values out of the structured params shape too', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([TEMPLATE_ROW], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'order_update',
      templateMessageParams: { body: ['B456', 'Monday'] },
    });
    expect(captured.message?.content_text).toBe(
      'Your order B456 ships on Monday'
    );
  });

  it("does not override the composer's pre-rendered text", async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([TEMPLATE_ROW], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'order_update',
      templateParams: ['A123', 'Friday'],
      contentText: 'rendered by the composer',
    });
    expect(captured.message?.content_text).toBe('rendered by the composer');
  });

  it("sends the local row's language when the caller names none", async () => {
    sendTemplateMessage.mockClear();
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([TEMPLATE_ROW], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'order_update',
      templateParams: ['A123', 'Friday'],
    });
    // Previously pinned to 'en_US', which matched no row and made Meta
    // reject the send as a missing translation.
    expect(
      (sendTemplateMessage.mock.calls[0] as unknown as [{ language: string }])[0]
        .language
    ).toBe('en');
  });

  it('leaves content_text null when the account has no local template row', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'template',
      templateName: 'never_synced',
      templateParams: ['A123'],
    });
    // Nothing to render from — the bubble falls back to the template
    // name rather than inventing a body.
    expect(captured.message?.content_text).toBeNull();
    expect(captured.conversation?.last_message_text).toBe('[template]');
  });
});

// ============================================================
// REGRESSÃO DO MERGE (upstream 2026-08-26) — a assinatura sobreviveu ao
// `persistedText`.
//
// O upstream (#483) introduziu `persistedText` para consertar a bolha vazia
// do template. A versão deles termina em `contentText ?? null` — o texto CRU
// que o chamador mandou. Nesta base o que vale é o `textoFinal`, o texto
// ASSINADO (P1.2/923): é o que o cliente recebeu, e o CRM tem de mostrar
// exatamente isso.
//
// Aceitar `persistedText` cru não quebraria nada visível de imediato: o envio
// sairia assinado e a gravação não. A divergência só apareceria quando
// alguém comparasse o WhatsApp com o CRM e visse dois textos diferentes para
// a mesma mensagem — num escritório de advocacia, uma discrepância de
// registro.
// ============================================================
describe('regressão de merge: o texto persistido é o ASSINADO', () => {
  beforeEach(async () => {
    const { resolveChannelForConversation } = await import(
      '@/lib/cb-channels/resolve'
    );
    vi.mocked(resolveChannelForConversation).mockResolvedValue({
      channelId: 'canal-1',
      provider: 'meta',
      phone_number_id: 'pn-1',
      access_token: 'tok-1',
    } as unknown as Awaited<ReturnType<typeof resolveChannelForConversation>>);
  });

  it('grava o texto com o prefixo da assinatura, não o texto cru', async () => {
    const { nomeParaAssinar } = await import('@/lib/assinatura/resolver');
    vi.mocked(nomeParaAssinar).mockResolvedValue('Dra. Ana');

    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Bom dia',
      senderUserId: 'user-1',
    });

    const gravado = String(captured.message?.content_text ?? '');
    expect(gravado).toContain('Dra. Ana');
    expect(gravado).toContain('Bom dia');
    // E não é o cru: se `persistedText` tivesse ficado com `contentText`,
    // isto seria exatamente 'Bom dia'.
    expect(gravado).not.toBe('Bom dia');
  });

  it('a prévia da conversa também usa o texto assinado', async () => {
    // `last_message_text` alimenta a lista do inbox. Divergir dela do corpo
    // da bolha é o mesmo problema, num lugar mais visível.
    const { nomeParaAssinar } = await import('@/lib/assinatura/resolver');
    vi.mocked(nomeParaAssinar).mockResolvedValue('Dra. Ana');

    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Bom dia',
      senderUserId: 'user-1',
    });

    expect(String(captured.conversation?.last_message_text ?? '')).toContain(
      'Dra. Ana'
    );
  });

  it('sem assinatura configurada, grava o texto como veio', async () => {
    // O caminho de quem nunca ligou a assinatura não pode ganhar prefixo.
    const { nomeParaAssinar } = await import('@/lib/assinatura/resolver');
    vi.mocked(nomeParaAssinar).mockResolvedValue(null);

    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb([], captured), 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Bom dia',
      senderUserId: 'user-1',
    });

    expect(captured.message?.content_text).toBe('Bom dia');
  });
});

// ============================================================
// Fase 11.3 — o BSUID (issue #519, 2cf9806): a ficha de quem a Meta
// identifica só pelo nome de usuário não tem telefone.
//
// Os cinco primeiros casos são os do original, portados (as frases de erro
// são as nossas; a ficha só-BSUID daqui guarda `phone` NULO, e a do original
// guardava `''` — os dois são cobertos). Os seguintes são do fork: o BSUID SÓ
// pela API oficial da Meta — pela Evolution ele viraria o número formado
// pelos dígitos dele — e JAMAIS na autocorreção do telefone depois de 131030.
// ============================================================

const BSUID = 'US.13491208655302741918';

describe('sendMessageToConversation — alvo por BSUID (Fase 11.3)', () => {
  const META = {
    channelId: 'canal-meta',
    provider: 'meta',
    phone_number_id: 'pn-1',
    access_token: 'tok-1',
  };
  const EVOLUTION = {
    channelId: 'canal-evo',
    provider: 'evolution',
    base_url: 'https://evo.test',
    instance_name: 'inst',
    api_key: 'k',
  };

  async function comCanal(canal: Record<string, unknown>) {
    const { resolveChannelForConversation } = await import(
      '@/lib/cb-channels/resolve'
    );
    vi.mocked(resolveChannelForConversation).mockResolvedValue(
      canal as unknown as Awaited<ReturnType<typeof resolveChannelForConversation>>
    );
  }

  async function envioDeTexto() {
    const { sendTextMessage } = await import('@/lib/whatsapp/meta-api');
    return vi.mocked(sendTextMessage);
  }

  beforeEach(async () => {
    const enviar = await envioDeTexto();
    enviar.mockReset();
    enviar.mockResolvedValue({ messageId: 'wamid.text' });
    evolutionSendText.mockClear();
    const { getTransport } = await import('@/lib/whatsapp/transport');
    vi.mocked(getTransport).mockClear();
    await comCanal(META);
  });

  it('manda ao BSUID quando a ficha não tem telefone (phone nulo ou vazio)', async () => {
    for (const phone of [null, '']) {
      const captured: CapturedWrites = {};
      const enviar = await envioDeTexto();
      enviar.mockClear();
      await sendMessageToConversation(
        sendPathDb([], captured, { id: 'ct-1', phone, wa_user_id: BSUID }),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
      );
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(enviar).toHaveBeenCalledWith(expect.objectContaining({ to: BSUID }));
      // O BSUID JAMAIS vai para `contacts.phone` (a autocorreção é só de
      // telefone — sem o `ehTelefone`, o BSUID "difere" do telefone vazio).
      expect(captured.contactUpdates ?? []).toEqual([]);
    }
  });

  it('prefere o telefone quando a ficha tem os dois', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([], captured, {
        id: 'ct-1',
        phone: '+15551234567',
        wa_user_id: BSUID,
      }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
    );
    expect(await envioDeTexto()).toHaveBeenCalledWith(
      expect.objectContaining({ to: '15551234567' })
    );
  });

  it('cai no BSUID quando o telefone gravado é inutilizável', async () => {
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([], captured, {
        id: 'ct-1',
        phone: 'not-a-number',
        wa_user_id: BSUID,
      }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
    );
    expect(await envioDeTexto()).toHaveBeenCalledWith(
      expect.objectContaining({ to: BSUID })
    );
    expect(captured.contactUpdates ?? []).toEqual([]);
  });

  it('400 quando não há telefone utilizável nem BSUID', async () => {
    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(
        sendPathDb([], captured, { id: 'ct-1', phone: '' }),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
      )
    ).rejects.toMatchObject({ status: 400 });
    expect(await envioDeTexto()).not.toHaveBeenCalled();
  });

  it('ignora um wa_user_id que não tem forma de BSUID', async () => {
    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(
        sendPathDb([], captured, { id: 'ct-1', phone: '', wa_user_id: 'lixo' }),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
      )
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
    expect(await envioDeTexto()).not.toHaveBeenCalled();
  });

  it('pela Evolution, a ficha só-BSUID é recusada ANTES de montar o transporte', async () => {
    await comCanal(EVOLUTION);
    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(
        sendPathDb([], captured, { id: 'ct-1', phone: null, wa_user_id: BSUID }),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
      )
    ).rejects.toMatchObject({ code: 'not_supported', status: 400 });
    const { getTransport } = await import('@/lib/whatsapp/transport');
    expect(vi.mocked(getTransport)).not.toHaveBeenCalled();
    expect(evolutionSendText).not.toHaveBeenCalled();
    expect(await envioDeTexto()).not.toHaveBeenCalled();
    expect(captured.message).toBeUndefined();
  });

  it('a recusa da Evolution diz o que fazer, em português', async () => {
    await comCanal(EVOLUTION);
    await expect(
      sendMessageToConversation(
        sendPathDb([], {}, { id: 'ct-1', phone: null, wa_user_id: BSUID }),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
      )
    ).rejects.toThrow(/número oficial/);
  });

  it('pela Evolution, a ficha com telefone E BSUID sai pelo TELEFONE', async () => {
    await comCanal(EVOLUTION);
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([], captured, {
        id: 'ct-1',
        phone: '+15551234567',
        wa_user_id: BSUID,
      }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
    );
    expect(evolutionSendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '15551234567' })
    );
    expect(captured.message?.remote_jid).toBe('15551234567@s.whatsapp.net');
  });

  it('131030 com BSUID: UMA tentativa, sem variantes e sem tocar em contacts', async () => {
    const enviar = await envioDeTexto();
    enviar.mockRejectedValue(new Error('(#131030) Recipient phone number not in allowed list'));
    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(
        sendPathDb([], captured, { id: 'ct-1', phone: null, wa_user_id: BSUID }),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
      )
    ).rejects.toMatchObject({ code: 'meta_error' });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith(expect.objectContaining({ to: BSUID }));
    expect(captured.contactUpdates ?? []).toEqual([]);
  });

  it('modelo de AUTENTICAÇÃO a quem só tem BSUID: recusado ANTES da Meta, com a frase', async () => {
    // A doc da Meta sobre BSUID exclui o código de acesso do envio por
    // `recipient`: só vai a telefone.
    sendTemplateMessage.mockClear();
    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(
        sendPathDb(
          [{ ...TEMPLATE_ROW, category: 'Authentication' }],
          captured,
          { id: 'ct-1', phone: null, wa_user_id: BSUID }
        ),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'template', templateName: 'order_update' }
      )
    ).rejects.toMatchObject({ code: 'not_supported', status: 400 });
    expect(sendTemplateMessage).not.toHaveBeenCalled();
    expect(captured.message).toBeUndefined();
  });

  it('a categoria vem da Meta em maiúsculas também (AUTHENTICATION)', async () => {
    sendTemplateMessage.mockClear();
    await expect(
      sendMessageToConversation(
        sendPathDb(
          [{ ...TEMPLATE_ROW, category: 'AUTHENTICATION' }],
          {},
          { id: 'ct-1', phone: null, wa_user_id: BSUID }
        ),
        'acct-1',
        { conversationId: 'cv-1', messageType: 'template', templateName: 'order_update' }
      )
    ).rejects.toThrow(/autenticação/);
    expect(sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('modelo UTILITÁRIO a quem só tem BSUID: sai no BSUID', async () => {
    sendTemplateMessage.mockClear();
    await sendMessageToConversation(
      sendPathDb([TEMPLATE_ROW], {}, { id: 'ct-1', phone: null, wa_user_id: BSUID }),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A1', 'sexta'],
      }
    );
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(sendTemplateMessage).toHaveBeenCalledWith(expect.objectContaining({ to: BSUID }));
  });

  it('modelo de AUTENTICAÇÃO a quem TEM telefone: sai, pelo telefone', async () => {
    sendTemplateMessage.mockClear();
    await sendMessageToConversation(
      sendPathDb(
        [{ ...TEMPLATE_ROW, category: 'Authentication' }],
        {},
        { id: 'ct-1', phone: '+15551234567', wa_user_id: BSUID }
      ),
      'acct-1',
      {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'order_update',
        templateParams: ['A1', 'sexta'],
      }
    );
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: '15551234567' })
    );
  });

  it('131030 com TELEFONE: as variantes rodam e a que entrega corrige a ficha', async () => {
    // O controle positivo do caso acima: a autocorreção continua viva para
    // quem tem telefone.
    const enviar = await envioDeTexto();
    enviar
      .mockRejectedValueOnce(new Error('(#131030) Recipient phone number not in allowed list'))
      .mockResolvedValue({ messageId: 'wamid.variante' });
    const captured: CapturedWrites = {};
    await sendMessageToConversation(
      sendPathDb([], captured, { id: 'ct-1', phone: '+15551234567' }),
      'acct-1',
      { conversationId: 'cv-1', messageType: 'text', contentText: 'oi' }
    );
    expect(enviar.mock.calls.length).toBeGreaterThan(1);
    const variante = (enviar.mock.calls[1]?.[0] as { to: string }).to;
    expect(variante).not.toBe('15551234567');
    expect(captured.contactUpdates).toEqual([{ phone: variante }]);
  });
});
