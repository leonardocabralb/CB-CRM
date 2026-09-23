import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// Instagram: o aviso `conversation.created` NÃO segura a gravação da DM
// (23/09/2026) — o mesmo conserto do `inbound-store` e do webhook da Meta.
// A entrega de webhook de saída pode levar 5 s por endpoint; ela começa no
// mesmo ponto de antes, sem `await`, e é esperada antes do message.received
// e em todo retorno. Ids fictícios.
//
// E o SIGNIFICADO do evento (decisão do operador, 23/09/2026): só a ENTRADA
// do cliente abre a conversa com aviso. O eco — a equipe escrevendo primeiro
// pelo app do Instagram — abre calado, como o celular pareado do WhatsApp.
// ============================================================

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  insertErro: null as { code: string; message: string } | null,
  contatoExiste: true,
  conversaExiste: true,
  filtrosDaExclusao: [] as [string, unknown][],
  conversasAchadasOuCriadas: 0,
}));

vi.mock('@/lib/whatsapp/inbound-store', () => ({
  findOrCreateConversation: vi.fn(async () => {
    h.conversasAchadasOuCriadas++;
    return { conversation: { id: 'conv-1' }, created: true };
  }),
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
                data: h.contatoExiste
                  ? {
                      id: 'contato-1',
                      name: 'Cliente Teste',
                      instagram_username: 'cliente',
                      avatar_url: null,
                      avatar_checked_at: null,
                    }
                  : null,
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (tabela === 'conversations') {
      // Só o eco passa aqui: a prévia da lista, sem o bump de não lidas.
      return {
        update: () => ({
          eq: async () => {
            h.ordem.push('previa');
            return { error: null };
          },
        }),
        // `conversaDoCliente`: a conversa que JÁ existe, sem criar nada.
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: h.conversaExiste ? { id: 'conv-existente' } : null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (tabela === 'messages') {
      return {
        update: (valores: Record<string, unknown>) => {
          h.ordem.push('marca-apagada');
          h.filtrosDaExclusao = [['deleted_by', valores.deleted_by]];
          const cadeia = {
            eq: (coluna: string, valor: unknown) => {
              h.filtrosDaExclusao.push([coluna, valor]);
              return cadeia;
            },
            is: async (coluna: string, valor: unknown) => {
              h.filtrosDaExclusao.push([coluna, valor]);
              return { error: null };
            },
          };
          return cadeia;
        },
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
  h.contatoExiste = true;
  h.conversaExiste = true;
  h.filtrosDaExclusao = [];
  h.conversasAchadasOuCriadas = 0;
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

describe('Instagram: conversation.created é a ENTRADA do cliente', () => {
  it('a DM do cliente que abre a conversa emite, com conversa, contato e conexão', async () => {
    expect(await persistirEventoDoInstagram(fakeDb(), CTX, DM, semMidia)).toMatchObject({
      resultado: 'gravada',
    });
    expect(eventos()).toEqual(['conversation.created', 'message.received']);
    expect(dispatch.mock.calls[0][3]).toEqual({
      conversation_id: 'conv-1',
      contact_id: 'contato-1',
      channel_id: 'canal-1',
    });
  });

  it('eco que abre a conversa não emite', async () => {
    const ECO: EventoDoInstagram = {
      ...DM,
      remetente: '100',
      destinatario: '200',
      mid: 'mid-eco',
      texto: 'Olá, aqui é o escritório',
      ehEco: true,
    };

    expect(await persistirEventoDoInstagram(fakeDb(), CTX, ECO, semMidia)).toMatchObject({
      resultado: 'gravada',
      messageId: 'msg-1',
    });
    // A conversa nasceu (o mock devolve `created: true`) e a mensagem foi
    // gravada pelo caminho do eco — sem bump de não lidas, com prévia.
    expect(h.ordem).toEqual(['grava', 'reabre', 'previa', 'funil']);
    expect(eventos()).toEqual([]);
  });

  it('eco que falha ao gravar também não emite', async () => {
    h.insertErro = { code: 'XX000', message: 'boom' };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ECO: EventoDoInstagram = { ...DM, remetente: '100', destinatario: '200', ehEco: true };

    expect(await persistirEventoDoInstagram(fakeDb(), CTX, ECO, semMidia)).toEqual({
      resultado: 'falhou',
    });
    expect(eventos()).toEqual([]);
    erro.mockRestore();
  });
});

describe('Instagram: DM APAGADA não abre conversa', () => {
  const APAGADA: EventoDoInstagram = { ...DM, mid: 'mid-apagada', texto: null, apagada: true };

  it('⚠️ cliente sem ficha: nada é criado e nada é emitido (antes: ficha e conversa vazias + conversation.created)', async () => {
    h.contatoExiste = false;
    expect(await persistirEventoDoInstagram(fakeDb(), CTX, APAGADA, semMidia)).toEqual({
      resultado: 'ignorada',
    });
    expect(h.ordem).toEqual([]);
    expect(h.conversasAchadasOuCriadas).toBe(0);
    expect(eventos()).toEqual([]);
  });

  it('ficha sem conversa: também não cria a conversa', async () => {
    h.conversaExiste = false;
    expect(await persistirEventoDoInstagram(fakeDb(), CTX, APAGADA, semMidia)).toEqual({
      resultado: 'ignorada',
    });
    expect(h.ordem).toEqual([]);
    expect(h.conversasAchadasOuCriadas).toBe(0);
    expect(eventos()).toEqual([]);
  });

  it('conversa existente: marca a mensagem pela CONVERSA do cliente, sem emitir nada', async () => {
    expect(await persistirEventoDoInstagram(fakeDb(), CTX, APAGADA, semMidia)).toEqual({
      resultado: 'ignorada',
    });
    expect(h.ordem).toEqual(['marca-apagada']);
    expect(h.conversasAchadasOuCriadas).toBe(0);
    expect(h.filtrosDaExclusao).toEqual([
      ['deleted_by', 'customer'],
      ['conversation_id', 'conv-existente'],
      ['message_id', 'mid-apagada'],
      ['deleted_at', null],
    ]);
    expect(eventos()).toEqual([]);
  });

  it('apagada pela própria conta (eco): a marca diz "agent"', async () => {
    const ECO_APAGADO: EventoDoInstagram = {
      ...APAGADA,
      remetente: '100',
      destinatario: '200',
      ehEco: true,
    };
    await persistirEventoDoInstagram(fakeDb(), CTX, ECO_APAGADO, semMidia);
    expect(h.filtrosDaExclusao[0]).toEqual(['deleted_by', 'agent']);
    expect(eventos()).toEqual([]);
  });
});
