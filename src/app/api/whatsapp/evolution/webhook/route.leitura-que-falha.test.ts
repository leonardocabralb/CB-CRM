import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A leitura da conexão que FALHA responde 503 (09/11/2026).
//
// Medido: o Supabase ficou ~1 min fora do ar (521), a leitura de
// `cb_channels` voltou com erro, o resolvedor a tratava como "instância
// desconhecida" e a rota respondia 200 sem log nenhum. A Evolution deu as
// mensagens por entregues, e 5 mensagens de cliente se perderam. A Evolution
// 2.4 entrega de novo em 5xx e em tempo esgotado (até 10 vezes; 400, 401, 403,
// 404 e 422 não repetem): o 503 é o que a faz tentar de novo.
// Números e ids são fictícios.
// ============================================================

const h = vi.hoisted(() => ({
  after: [] as (() => Promise<void> | void)[],
  /** O que cada tabela devolve no `maybeSingle`. */
  respostas: {} as Record<string, { data: unknown; error: unknown }>,
  consultadas: [] as string[],
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.after.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (tabela: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => {
          h.consultadas.push(tabela);
          return Promise.resolve(h.respostas[tabela] ?? { data: null, error: null });
        },
      };
      return q;
    },
  }),
}));

import { POST } from './route';

const SEGREDO = 'segredo-de-teste';

const upsert = {
  event: 'messages.upsert',
  instance: 'cbcrm-instancia-de-teste',
  data: {
    key: { remoteJid: '5583900000000@s.whatsapp.net', fromMe: false, id: '3EB0000000000000AB27' },
    message: { conversation: 'Bom dia, doutor.' },
    messageType: 'conversation',
    messageTimestamp: 1789044688,
  },
};

async function postar(corpo: unknown) {
  return (await POST(
    new Request('http://localhost/api/whatsapp/evolution/webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEGREDO}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  )) as unknown as { body: unknown; status: number };
}

beforeEach(() => {
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  h.after.length = 0;
  h.consultadas.length = 0;
  h.respostas = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('webhook da Evolution: a leitura da conexão que falha', () => {
  it('Supabase fora do ar (521) → 503, para a Evolution entregar de novo, e nada vai ao after()', async () => {
    h.respostas.cb_channels = { data: null, error: { message: '521: Web server is down' } };
    const resposta = await postar(upsert);
    expect(resposta.status).toBe(503);
    expect(h.after).toHaveLength(0);
    // Não cai no fallback nem dá a instância por desconhecida.
    expect(h.consultadas).toEqual(['cb_channels']);
  });

  it('o recibo também volta 503: a leitura vem antes de separar os eventos', async () => {
    h.respostas.cb_channels = { data: null, error: { message: 'fetch failed' } };
    const resposta = await postar({
      event: 'messages.update',
      instance: 'cbcrm-instancia-de-teste',
      data: { keyId: '3EB0000000000000AB27', remoteJid: '5583900000000@s.whatsapp.net', fromMe: true, status: 'DELIVERY_ACK' },
    });
    expect(resposta.status).toBe(503);
    expect(h.after).toHaveLength(0);
  });

  // A Evolution ESPERA a entrega do `messages.edited` dentro do laço do
  // `messages.upsert` (as outras ela dispara e segue): com 503, a reentrega
  // dela pararia a fila de entrada do número inteira atrás de uma edição.
  it('edição (messages.edited) com a leitura falhando → 200, para não parar a fila da Evolution', async () => {
    h.respostas.cb_channels = { data: null, error: { message: '521: Web server is down' } };
    for (const evento of ['messages.edited', 'MESSAGES_EDITED']) {
      const resposta = await postar({
        event: evento,
        instance: 'cbcrm-instancia-de-teste',
        data: { key: { id: '3EB0000000000000AB28' }, editedMessage: { conversation: 'corrigido' } },
      });
      expect(resposta.status).toBe(200);
    }
    expect(h.after).toHaveLength(0);
  });

  it('instância DESCONHECIDA (as duas leituras responderam, sem linha) segue 200', async () => {
    const resposta = await postar(upsert);
    expect(resposta.status).toBe(200);
    expect(h.consultadas).toEqual(['cb_channels', 'whatsapp_config']);
    expect(h.after).toHaveLength(0);
  });
});
