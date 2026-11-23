import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// O envio pela central volta numa grafia do mid e o eco (e a citação do
// cliente) chega noutra, do MESMO IGMessageID (medido em 23/11/2026: cada
// resposta do CRM aparecia duas vezes no fio). `idDaMensagem` acha a nossa
// linha pela `chaveDoMid` quando a grafia exata falha. Ids FICTÍCIOS.
// ============================================================

const h = vi.hoisted(() => ({
  enviadas: [] as { id: string; message_id: string | null }[],
  erroDaBusca: null as { message: string } | null,
  buscas: [] as Record<string, unknown>[],
  inseridas: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/whatsapp/inbound-store', () => ({
  findOrCreateConversation: vi.fn(async () => ({
    conversation: { id: 'conv-1' },
    created: false,
  })),
}));
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({
  routeContactToPipeline: vi.fn(async () => null),
}));
vi.mock('@/lib/conversations/reopen', () => ({
  reopenClosedConversation: vi.fn(async () => false),
}));
vi.mock('@/lib/cb-channels/stamp', () => ({
  followConversationChannel: vi.fn(async () => {}),
}));
vi.mock('@/lib/cb-channels/atraso-de-entrega', () => ({
  registrarEntrega: vi.fn(async () => {}),
}));
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn() }));

import { persistirEventoDoInstagram } from './persistir';
import type { EventoDoInstagram } from './webhook';

function naGrafiaDaMeta(texto: string): string {
  return Buffer.from(texto, 'latin1')
    .toString('base64')
    .replace(/[Z=]/g, (c) => (c === 'Z' ? 'ZA' : 'ZD'));
}

const ID = '11111111111111111:222222222222222222222222222222222222222:3333333333333333333333333333333333';
const PELO_ECO = naGrafiaDaMeta(`ig_dm_item:1:IGMessageID:${ID}`);
const PELA_CENTRAL = naGrafiaDaMeta(`new_ig_dm_item:1:IGMessageID:${ID}`);

function fakeDb() {
  const from = (tabela: string) => {
    if (tabela === 'contacts') {
      const c = {
        select: () => c,
        eq: () => c,
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
      };
      return c;
    }
    if (tabela === 'conversations') {
      return { update: () => ({ eq: async () => ({ error: null }) }) };
    }
    // messages: a grafia exata nunca casa; a busca pela chave lê as enviadas.
    const filtros: Record<string, unknown> = {};
    const m = {
      select: () => m,
      eq: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return m;
      },
      order: () => m,
      limit: async () => {
        h.buscas.push({ ...filtros });
        return { data: h.erroDaBusca ? null : h.enviadas, error: h.erroDaBusca };
      },
      maybeSingle: async () => ({ data: null, error: null }),
      insert: (linha: Record<string, unknown>) => {
        h.inseridas.push(linha);
        return { select: () => ({ single: async () => ({ data: { id: 'nova' }, error: null }) }) };
      },
    };
    return m;
  };
  return { from, rpc: async () => ({ error: null }) } as never;
}

const CTX = { accountId: 'conta-1', ownerUserId: 'dono-1', channelId: 'canal-1' };
const ECO: EventoDoInstagram = {
  tipo: 'mensagem',
  igUserId: '100',
  remetente: '100',
  destinatario: '200',
  timestampMs: 1_700_000_000_000,
  mid: PELO_ECO,
  texto: 'Oi',
  anexos: [],
  ehEco: true,
  apagada: false,
  naoSuportada: false,
  respostaA: null,
  quickReply: null,
};
const salvar = vi.fn(async () => null);
const SEM_ESPERA = { esperar: async () => {} };

beforeEach(() => {
  h.enviadas = [];
  h.erroDaBusca = null;
  h.buscas = [];
  h.inseridas = [];
  salvar.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('o mesmo mid em duas grafias', () => {
  it('⚠️ o eco do envio pela central acha a nossa linha: não vira a 2ª bolha', async () => {
    h.enviadas = [
      { id: 'outra', message_id: naGrafiaDaMeta(`new_ig_dm_item:1:IGMessageID:${ID}9`) },
      { id: 'nossa', message_id: PELA_CENTRAL },
    ];
    const r = await persistirEventoDoInstagram(fakeDb(), CTX, ECO, salvar, undefined, SEM_ESPERA);
    expect(r).toEqual({ resultado: 'duplicada' });
    expect(h.inseridas).toEqual([]);
    // Só entre as que o CRM enviou, desta conversa.
    expect(h.buscas[0]).toEqual({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      from_device: false,
    });
  });

  it('eco sem par em grafia nenhuma é digitado no app: entra como do celular', async () => {
    h.enviadas = [{ id: 'outra', message_id: naGrafiaDaMeta(`new_ig_dm_item:1:IGMessageID:${ID}9`) }];
    const r = await persistirEventoDoInstagram(fakeDb(), CTX, ECO, salvar, undefined, SEM_ESPERA);
    expect(r).toMatchObject({ resultado: 'gravada' });
    expect(h.inseridas[0]).toMatchObject({ message_id: PELO_ECO, from_device: true });
    // Antes e depois da espera de 2 s.
    expect(h.buscas).toHaveLength(2);
  });

  it('busca que falha é "não está": o eco entra, e o núcleo segue com a dele', async () => {
    h.erroDaBusca = { message: 'boom' };
    const r = await persistirEventoDoInstagram(fakeDb(), CTX, ECO, salvar, undefined, SEM_ESPERA);
    expect(r).toMatchObject({ resultado: 'gravada' });
  });

  it('a citação do cliente na outra grafia liga à nossa linha', async () => {
    h.enviadas = [{ id: 'nossa', message_id: PELA_CENTRAL }];
    const DM: EventoDoInstagram = {
      ...ECO,
      remetente: '200',
      destinatario: '100',
      mid: naGrafiaDaMeta(`ig_dm_item:1:IGMessageID:${ID}7`),
      ehEco: false,
      respostaA: { mid: PELO_ECO },
    };
    const r = await persistirEventoDoInstagram(fakeDb(), CTX, DM, salvar, undefined, SEM_ESPERA);
    expect(r).toMatchObject({ resultado: 'gravada' });
    expect(h.inseridas[0]).toMatchObject({ reply_to_message_id: 'nossa', sender_type: 'customer' });
  });

  it('mid fora da forma conhecida não faz a busca (só a grafia exata, como antes)', async () => {
    await persistirEventoDoInstagram(fakeDb(), CTX, { ...ECO, mid: 'mid-de-teste' }, salvar, undefined, SEM_ESPERA);
    expect(h.buscas).toEqual([]);
  });
});
