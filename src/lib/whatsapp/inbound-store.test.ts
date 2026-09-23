import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// `persistInboundMessage` (Evolution): o aviso `conversation.created` NÃO
// segura a gravação (23/09/2026).
//
// A entrega de webhook de saída é uma consulta, um DNS sem prazo e um POST de
// até 5 s por endpoint (`webhooks/deliver.ts`). Aguardada ANTES do INSERT, um
// endpoint fora do ar atrasava a primeira mensagem de toda conversa nova — e
// a reabertura, o robô, as automações e a IA junto. Agora ela começa no mesmo
// ponto, sem `await`, e é esperada antes do message.received e no retorno
// antecipado. Os motores são dublês: aqui só importa QUANDO cada um roda.
// ============================================================

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  insertErro: null as { code: string; message: string } | null,
  conversaExiste: false,
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: vi.fn(async () => ({
    contato: { id: 'contato-1', name: 'Cliente Teste' },
    falhou: false,
  })),
  fichaQueVenceu: vi.fn(),
  isUniqueViolation: () => false,
}));
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({
  routeContactToPipeline: vi.fn(async () => {
    h.ordem.push('funil');
  }),
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: vi.fn(async () => {
    h.ordem.push('reabre');
    return false;
  }),
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: vi.fn(async () => {
    h.ordem.push('automação');
  }),
}));
vi.mock('@/lib/automations/parar-se-responder', () => ({
  cancelarEsperasPorResposta: vi.fn(async () => {}),
}));
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: vi.fn(async () => {
    h.ordem.push('robô');
    return { consumed: false };
  }),
}));
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: vi.fn(async () => {
    h.ordem.push('ia');
  }),
}));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn() }));
vi.mock('@/lib/cb-channels/stamp', async () => {
  const real = await vi.importActual<typeof import('@/lib/cb-channels/stamp')>(
    '@/lib/cb-channels/stamp',
  );
  return {
    followConversationChannel: vi.fn(async () => {}),
    gravarComCanal: real.gravarComCanal,
  };
});
vi.mock('@/lib/cb-channels/atraso-de-entrega', () => ({
  registrarEntrega: vi.fn(async () => {}),
}));

import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

import { persistInboundMessage, type NormalizedInbound } from './inbound-store';

const dispatch = vi.mocked(dispatchWebhookEvent);

/** Um Supabase de mentira, só com as cadeias que a ingestão usa. */
function fakeDb() {
  const from = (tabela: string) => {
    if (tabela === 'conversations') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: h.conversaExiste ? [{ id: 'conv-1', unread_count: 0 }] : [],
                  error: null,
                }),
              }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'conv-1', unread_count: 0 }, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    if (tabela === 'messages') {
      return {
        // A contagem de mensagens anteriores do cliente.
        select: () => ({ eq: () => ({ eq: async () => ({ count: 0, error: null }) }) }),
        insert: () => ({
          select: () => ({
            single: async () => {
              h.ordem.push('grava');
              return h.insertErro
                ? { data: null, error: h.insertErro }
                : { data: { id: 'msg-1' }, error: null };
            },
          }),
        }),
      };
    }
    throw new Error(`tabela inesperada: ${tabela}`);
  };
  return { from } as never;
}

const MENSAGEM: NormalizedInbound = {
  accountId: 'conta-1',
  configOwnerUserId: 'dono-1',
  channelId: 'canal-1',
  phone: '5500000000000',
  name: 'Cliente Teste',
  providerMessageId: 'ID-TESTE-1',
  timestamp: 1_700_000_000,
  contentType: 'text',
  text: 'oi',
};

/** Uma promessa que só resolve quando o teste mandar. */
function presa() {
  let soltar!: () => void;
  const promessa = new Promise<'tentado'>((resolve) => {
    soltar = () => resolve('tentado');
  });
  return { promessa, soltar };
}

const eventos = () => dispatch.mock.calls.map((c) => c[2] as string);

beforeEach(() => {
  vi.clearAllMocks();
  h.ordem = [];
  h.insertErro = null;
  h.conversaExiste = false;
  dispatch.mockResolvedValue('tentado');
});

describe('persistInboundMessage: conversation.created não segura a gravação', () => {
  it('com a entrega PRESA, a mensagem é gravada e os motores rodam', async () => {
    const entrega = presa();
    dispatch.mockImplementation((_db, _conta, evento) =>
      evento === 'conversation.created' ? entrega.promessa : Promise.resolve('tentado' as const),
    );

    let terminou = false;
    const corrida = persistInboundMessage(fakeDb(), MENSAGEM).then((r) => {
      terminou = true;
      return r;
    });

    await vi.waitFor(() => expect(h.ordem).toContain('ia'));
    expect(h.ordem).toEqual(['grava', 'reabre', 'robô', 'automação', 'automação', 'automação', 'funil', 'ia']);
    // O message.received espera o aviso da conversa criada.
    expect(eventos()).toEqual(['conversation.created']);
    expect(terminou).toBe(false);

    entrega.soltar();
    expect(await corrida).toMatchObject({ messageId: 'msg-1', conversationId: 'conv-1' });
    expect(eventos()).toEqual(['conversation.created', 'message.received']);
  });

  it('message.received só COMEÇA depois de conversation.created TERMINAR', async () => {
    dispatch.mockImplementation(async (_db, _conta, evento) => {
      h.ordem.push(`${evento}:começou`);
      await new Promise((r) => setTimeout(r, 5));
      h.ordem.push(`${evento}:terminou`);
      return 'tentado' as const;
    });

    await persistInboundMessage(fakeDb(), MENSAGEM);

    const avisos = h.ordem.filter((o) => o.includes(':'));
    expect(avisos).toEqual([
      'conversation.created:começou',
      'conversation.created:terminou',
      'message.received:começou',
      'message.received:terminou',
    ]);
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'conta-1',
      'conversation.created',
      { conversation_id: 'conv-1', contact_id: 'contato-1', channel_id: 'canal-1' },
    );
  });

  it('a gravação FALHA: a conversa foi criada e o aviso sai — e o retorno espera por ele', async () => {
    h.insertErro = { code: 'XX000', message: 'boom' };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entrega = presa();
    dispatch.mockImplementation(() => entrega.promessa);

    let terminou = false;
    const corrida = persistInboundMessage(fakeDb(), MENSAGEM).then((r) => {
      terminou = true;
      return r;
    });
    await vi.waitFor(() => expect(h.ordem).toContain('grava'));
    await new Promise((r) => setTimeout(r, 5));

    // Nada depois da gravação rodou…
    expect(h.ordem).toEqual(['grava']);
    // …mas o aviso da conversa criada saiu, e o retorno o ESPERA (solto
    // dentro do `after()` da rota, poderia ser congelado antes de entregar).
    expect(eventos()).toEqual(['conversation.created']);
    expect(terminou).toBe(false);

    entrega.soltar();
    expect(await corrida).toBeNull();
    expect(eventos()).toEqual(['conversation.created']);
    erro.mockRestore();
  });

  it('conversa que JÁ existia não anuncia nada além do message.received', async () => {
    h.conversaExiste = true;

    await persistInboundMessage(fakeDb(), MENSAGEM);

    expect(eventos()).toEqual(['message.received']);
  });
});
