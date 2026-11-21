import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// O eco do Instagram que PERDE o INSERT depois de baixar o anexo (Codex, PR
// #539): o eco esperou 2 s sem achar a nossa linha, baixou a cópia, e o
// núcleo de envio gravou a resposta no meio. A cópia não tem dono e sai do
// bucket — mas só quando a linha que ficou cita OUTRO arquivo. Ids fictícios.
// ============================================================

const CONTA = '0f0f0f0f-1111-4222-8333-444444444444';
const BASE = 'https://x.supabase.co/storage/v1/object/public/chat-media';
const COPIA = `account-${CONTA}/inbound/ig-abc123.pdf`;

const h = vi.hoisted(() => ({
  linhaQueFicou: null as { media_url: string | null } | null,
  erroDaLeitura: null as { message: string } | null,
  removidos: [] as string[],
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
    // messages
    let cols = '';
    const m = {
      select: (s: string) => {
        cols = s;
        return m;
      },
      eq: () => m,
      // A linha do nosso envio NÃO está lá enquanto o eco espera (`id`); na
      // colisão, a leitura da linha que ficou (`media_url`).
      maybeSingle: async () =>
        cols === 'media_url'
          ? { data: h.linhaQueFicou, error: h.erroDaLeitura }
          : { data: null, error: null },
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { code: '23505', message: 'duplicate key' },
          }),
        }),
      }),
    };
    return m;
  };
  return {
    from,
    storage: {
      from: () => ({
        remove: async (caminhos: string[]) => {
          h.removidos.push(...caminhos);
          return { error: null };
        },
      }),
    },
  } as never;
}

const CTX = { accountId: CONTA, ownerUserId: 'dono-1', channelId: 'canal-1' };
const ECO: EventoDoInstagram = {
  tipo: 'mensagem',
  igUserId: '100',
  remetente: '100',
  destinatario: '200',
  timestampMs: 1_700_000_000_000,
  mid: 'mid-do-crm',
  texto: null,
  anexos: [{ tipo: 'file', tipoCru: 'file', url: 'https://cdn.instagram.com/x.pdf' }],
  ehEco: true,
  apagada: false,
  naoSuportada: false,
  respostaA: null,
  quickReply: null,
} as EventoDoInstagram;

const salvar = vi.fn(async () => ({
  url: `${BASE}/${COPIA}`,
  mime: 'application/pdf',
  classe: 'document' as const,
  filename: 'x.pdf',
}));
const SEM_ESPERA = { esperar: async () => {} };

beforeEach(() => {
  h.linhaQueFicou = null;
  h.erroDaLeitura = null;
  h.removidos = [];
  salvar.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('o eco que perde o INSERT depois de baixar o anexo', () => {
  it('⚠️ a linha que ficou cita OUTRO arquivo (o da equipe): a cópia do eco sai do bucket', async () => {
    h.linhaQueFicou = { media_url: `${BASE}/account-${CONTA}/1700000000000-contrato.pdf` };
    const r = await persistirEventoDoInstagram(fakeDb(), CTX, ECO, salvar, undefined, SEM_ESPERA);
    expect(r).toEqual({ resultado: 'duplicada' });
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(h.removidos).toEqual([COPIA]);
  });

  it('reentrega da Meta: a linha que ficou cita o MESMO arquivo, e ele fica', async () => {
    h.linhaQueFicou = { media_url: `${BASE}/${COPIA}` };
    await persistirEventoDoInstagram(fakeDb(), CTX, ECO, salvar, undefined, SEM_ESPERA);
    expect(h.removidos).toEqual([]);
  });

  it('leitura que falha é "não sei": o arquivo fica', async () => {
    h.erroDaLeitura = { message: 'boom' };
    await persistirEventoDoInstagram(fakeDb(), CTX, ECO, salvar, undefined, SEM_ESPERA);
    expect(h.removidos).toEqual([]);
  });
});
