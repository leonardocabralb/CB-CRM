import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Instagram: o aviso `conversation.created` NÃO segura a gravação da DM
// (23/09/2026) — o mesmo conserto do `inbound-store` e do webhook da Meta.
// A entrega de webhook de saída pode levar 5 s por endpoint; ela começa no
// mesmo ponto de antes, sem `await`, e é esperada antes do message.received
// e em todo retorno. Ids fictícios.
// ============================================================

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  insertErro: null as { code: string; message: string } | null,
}));

vi.mock('@/lib/whatsapp/inbound-store', () => ({
  findOrCreateConversation: vi.fn(async () => ({
    conversation: { id: 'conv-1' },
    created: true,
  })),
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
vi.mock('@/lib/cb-channels/stamp', () => ({
  followConversationChannel: vi.fn(async () => {}),
}));
vi.mock('@/lib/cb-channels/atraso-de-entrega', () => ({
  registrarEntrega: vi.fn(async () => {}),
}));
vi.mock('@/lib/contacts/dedupe', () => ({ isUniqueViolation: () => false }));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn() }));

import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';

import { persistirEventoDoInstagram } from './persistir';
import type { EventoDoInstagram } from './webhook';

const dispatch = vi.mocked(dispatchWebhookEvent);

function fakeDb() {
  const from = (tabela: string) => {
    if (tabela === 'contacts') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'contato-1',
                  name: 'Cliente Teste',
                  instagram_username: 'cliente',
                  avatar_url: null,
                  avatar_checked_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (tabela === 'messages') {
      return {
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
  const rpc = async (nome: string) => {
    h.ordem.push(nome);
    return { error: null };
  };
  return { from, rpc } as never;
}

const CTX = { accountId: 'conta-1', ownerUserId: 'dono-1', channelId: 'canal-1' };

const DM: EventoDoInstagram = {
  tipo: 'mensagem',
  igUserId: '100',
  remetente: '200',
  destinatario: '100',
  timestampMs: 1_700_000_000_000,
  mid: 'mid-1',
  texto: 'oi',
  anexos: [],
  ehEco: false,
  apagada: false,
  naoSuportada: false,
  respostaA: null,
  quickReply: null,
};

const semMidia = async () => null;

function presa() {
  let soltar!: () => void;
  const promessa = new Promise<void>((resolve) => {
    soltar = resolve;
  });
  return { promessa, soltar };
}

const eventos = () => dispatch.mock.calls.map((c) => c[2] as string);

beforeEach(() => {
  vi.clearAllMocks();
  h.ordem = [];
  h.insertErro = null;
  dispatch.mockResolvedValue(undefined);
});

describe('Instagram: conversation.created não segura a gravação', () => {
  it('com a entrega PRESA, a DM é gravada e a conversa segue o fluxo', async () => {
    const entrega = presa();
    dispatch.mockImplementation((_db, _conta, evento) =>
      evento === 'conversation.created' ? entrega.promessa : Promise.resolve(),
    );

    let terminou = false;
    const corrida = persistirEventoDoInstagram(fakeDb(), CTX, DM, semMidia).then((r) => {
      terminou = true;
      return r;
    });

    await vi.waitFor(() => expect(h.ordem).toContain('funil'));
    expect(h.ordem).toEqual(['grava', 'reabre', 'bump_conversation_on_inbound', 'funil']);
    expect(eventos()).toEqual(['conversation.created']);
    expect(terminou).toBe(false);

    entrega.soltar();
    expect(await corrida).toMatchObject({ resultado: 'gravada', messageId: 'msg-1' });
    expect(eventos()).toEqual(['conversation.created', 'message.received']);
  });

  it('a gravação FALHA: o aviso da conversa criada sai e o retorno espera por ele', async () => {
    h.insertErro = { code: 'XX000', message: 'boom' };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const entrega = presa();
    dispatch.mockImplementation(() => entrega.promessa);

    let terminou = false;
    const corrida = persistirEventoDoInstagram(fakeDb(), CTX, DM, semMidia).then((r) => {
      terminou = true;
      return r;
    });
    await vi.waitFor(() => expect(h.ordem).toContain('grava'));
    await new Promise((r) => setTimeout(r, 5));

    expect(h.ordem).toEqual(['grava']);
    expect(eventos()).toEqual(['conversation.created']);
    expect(terminou).toBe(false);

    entrega.soltar();
    expect(await corrida).toEqual({ resultado: 'falhou' });
    erro.mockRestore();
  });
});
