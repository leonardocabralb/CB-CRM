import { describe, expect, it, vi } from 'vitest';

import {
  conteudoDaMensagem,
  findOrCreateContatoDoInstagram,
  type MidiaSalva,
} from './persistir';
import type { EventoDoInstagram } from './webhook';

type Mensagem = Extract<EventoDoInstagram, { tipo: 'mensagem' }>;

const base: Mensagem = {
  tipo: 'mensagem',
  igUserId: '17841457826920658',
  remetente: '1663055967608091',
  destinatario: '17841457826920658',
  timestampMs: 1757460907000,
  mid: 'm1',
  texto: null,
  anexos: [],
  ehEco: false,
  apagada: false,
  naoSuportada: false,
  respostaA: null,
  quickReply: null,
};

describe('conteudoDaMensagem', () => {
  it('texto puro', () => {
    expect(conteudoDaMensagem({ ...base, texto: 'Oi' }, null)).toEqual({
      content_type: 'text',
      content_text: 'Oi',
      media_url: null,
      media_type: null,
      media_filename: null,
    });
  });

  it('mídia salva manda a classe e o mime do WEBHOOK (a voz não vira vídeo)', () => {
    const midia: MidiaSalva = {
      url: 'https://storage/x.m4a',
      mime: 'audio/mp4',
      classe: 'audio',
      filename: 'audioclip-1.mp4',
    };
    expect(conteudoDaMensagem(base, midia)).toEqual({
      content_type: 'audio',
      content_text: null,
      media_url: 'https://storage/x.m4a',
      media_type: 'audio/mp4',
      media_filename: 'audioclip-1.mp4',
    });
  });

  it('compartilhamento, menção em story e reel viram texto com a URL', () => {
    const r = conteudoDaMensagem(
      {
        ...base,
        texto: 'olha isso',
        anexos: [
          { tipo: 'share', url: 'https://ig/p/1', tipoCru: 'share' },
          { tipo: 'story_mention', url: null, tipoCru: 'story_mention' },
        ],
      },
      null
    );
    expect(r.content_type).toBe('text');
    expect(r.content_text).toBe(
      '[Publicação compartilhada] https://ig/p/1\n[Menção em story]\nolha isso'
    );
  });

  it('resposta a story ganha o prefixo; não suportada e anexo perdido têm rótulo', () => {
    expect(
      conteudoDaMensagem(
        {
          ...base,
          texto: 'haha',
          respostaA: { story: { id: '9', url: null } },
        },
        null
      ).content_text
    ).toBe('[Resposta a um story]\nhaha');
    expect(
      conteudoDaMensagem({ ...base, naoSuportada: true }, null).content_text
    ).toBe('[Conteúdo não suportado pelo Instagram]');
    // Arquivo que existia mas não foi salvo (download falhou): fica o registro.
    expect(
      conteudoDaMensagem(
        {
          ...base,
          anexos: [{ tipo: 'image', url: 'https://cdn/x', tipoCru: 'image' }],
        },
        null
      ).content_text
    ).toBe('[Anexo indisponível]');
    expect(conteudoDaMensagem(base, null).content_text).toBeNull();
  });
});

// ------------------------------------------------------------
// Um Supabase de mentira, só com as cadeias que o contato usa.
// ------------------------------------------------------------
function fakeDb(opts: {
  existente?: Record<string, unknown> | null;
  insertErro?: { code: string; message: string } | null;
  aposCorrida?: Record<string, unknown> | null;
}) {
  const inserts: Record<string, unknown>[] = [];
  let buscas = 0;
  const from = vi.fn((tabela: string) => {
    if (tabela !== 'contacts') throw new Error(`tabela inesperada: ${tabela}`);
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              buscas += 1;
              const data =
                buscas === 1
                  ? (opts.existente ?? null)
                  : (opts.aposCorrida ?? null);
              return { data, error: null };
            },
          }),
        }),
      }),
      insert: (linha: Record<string, unknown>) => {
        inserts.push(linha);
        return {
          select: () => ({
            single: async () =>
              opts.insertErro
                ? { data: null, error: opts.insertErro }
                : {
                    data: {
                      id: 'novo',
                      name: null,
                      instagram_username: null,
                      avatar_url: null,
                    },
                    error: null,
                  },
          }),
        };
      },
    };
  });
  return { db: { from } as never, inserts };
}

const ctx = {
  accountId: 'conta',
  ownerUserId: 'dono-durável',
  channelId: 'canal',
};

describe('findOrCreateContatoDoInstagram', () => {
  it('acha pela conta + IGSID e não cria de novo', async () => {
    const { db, inserts } = fakeDb({
      existente: {
        id: 'c1',
        name: 'Ana',
        instagram_username: 'ana',
        avatar_url: null,
      },
    });
    const r = await findOrCreateContatoDoInstagram(db, ctx, '1663055967608091');
    expect(r).toMatchObject({ id: 'c1', wasCreated: false });
    expect(inserts).toHaveLength(0);
  });

  it('cria com phone NULO, o IGSID em instagram_id e o DONO DURÁVEL em user_id', async () => {
    const { db, inserts } = fakeDb({});
    const r = await findOrCreateContatoDoInstagram(db, ctx, '1663055967608091');
    expect(r).toMatchObject({ id: 'novo', wasCreated: true });
    expect(inserts).toEqual([
      {
        account_id: 'conta',
        user_id: 'dono-durável',
        phone: null,
        instagram_id: '1663055967608091',
      },
    ]);
  });

  it('perde a corrida no índice único e relê em vez de falhar', async () => {
    const { db } = fakeDb({
      insertErro: { code: '23505', message: 'duplicate key' },
      aposCorrida: {
        id: 'c2',
        name: null,
        instagram_username: null,
        avatar_url: null,
      },
    });
    const r = await findOrCreateContatoDoInstagram(db, ctx, '1663055967608091');
    expect(r).toMatchObject({ id: 'c2', wasCreated: false });
  });

  it('outro erro de insert devolve null (a rota registra e não derruba a entrega)', async () => {
    const { db } = fakeDb({ insertErro: { code: '42501', message: 'rls' } });
    expect(await findOrCreateContatoDoInstagram(db, ctx, 'x')).toBeNull();
  });
});

describe('igsidDoCliente — o cliente numa edição sem marca de eco', () => {
  it('remetente é o cliente; se a própria conta editou, o cliente é o destinatário', async () => {
    const { igsidDoCliente } = await import('./persistir');
    const conta = '17841457826920658';
    expect(
      igsidDoCliente({
        igUserId: conta,
        remetente: '1663055967608091',
        destinatario: conta,
      })
    ).toBe('1663055967608091');
    expect(
      igsidDoCliente({
        igUserId: conta,
        remetente: conta,
        destinatario: '1663055967608091',
      })
    ).toBe('1663055967608091');
  });
});
