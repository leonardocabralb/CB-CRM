import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { legendaDoEnvio, origemDaMidia, prepararMidiaDoNo } from './midia-do-no';

// ============================================================
// Nó "Enviar mídia" do robô (26/09/2026): qualquer arquivo do ACERVO,
// inclusive áudio como nota de voz, sem quebrar o nó antigo (`media_url`).
// ============================================================

describe('origemDaMidia', () => {
  it('o nó antigo (upload do construtor) continua valendo', () => {
    expect(
      origemDaMidia({ media_type: 'document', media_url: 'https://x/a.pdf' }),
    ).toEqual({ origem: 'url', tipo: 'document', link: 'https://x/a.pdf' });
  });

  it('acervo_id VENCE a URL guardada (ela é só da tela)', () => {
    expect(
      origemDaMidia({ media_type: 'audio', media_url: 'https://x/old.ogg', acervo_id: 'item-1' }),
    ).toEqual({ origem: 'acervo', acervoId: 'item-1' });
  });

  it('sem arquivo, ou tipo desconhecido no nó antigo = null', () => {
    expect(origemDaMidia({ media_type: 'image', media_url: '' })).toBeNull();
    expect(origemDaMidia({ media_type: 'sticker' as never, media_url: 'https://x' })).toBeNull();
    expect(origemDaMidia(null)).toBeNull();
  });
});

describe('legendaDoEnvio', () => {
  it('ÁUDIO nunca leva legenda (932) — a nota de voz não tem campo de texto', () => {
    expect(legendaDoEnvio('audio', 'Ouça com atenção')).toBeUndefined();
  });

  it('os outros levam; vazia não vai', () => {
    expect(legendaDoEnvio('image', 'Olá')).toBe('Olá');
    expect(legendaDoEnvio('document', '   ')).toBeUndefined();
    expect(legendaDoEnvio('video', undefined)).toBeUndefined();
  });
});

function bancoComAcervo(opts: {
  item?: Record<string, unknown> | null;
  erroLeitura?: string;
  erroCopia?: string;
}) {
  const copias: Array<[string, string]> = [];
  const filtros: Array<[string, unknown]> = [];
  const db = {
    from: () => {
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return b;
        },
        maybeSingle: () =>
          Promise.resolve(
            opts.erroLeitura
              ? { data: null, error: { message: opts.erroLeitura } }
              : { data: opts.item ?? null, error: null },
          ),
      };
      return b;
    },
    storage: {
      from: () => ({
        copy: (de: string, para: string) => {
          copias.push([de, para]);
          return Promise.resolve({ error: opts.erroCopia ? { message: opts.erroCopia } : null });
        },
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage/${p}` } }),
      }),
    },
  };
  return { db: db as unknown as SupabaseClient, copias, filtros };
}

describe('prepararMidiaDoNo', () => {
  const ITEM = {
    id: 'item-1',
    tipo: 'audio',
    media_path: 'account-acc/acervo/boas-vindas.ogg',
    filename: 'boas-vindas.ogg',
  };

  it('ACERVO: copia o item e manda a CÓPIA — o tipo vem do item', async () => {
    const { db, copias, filtros } = bancoComAcervo({ item: ITEM });
    const m = await prepararMidiaDoNo(db, 'acc', {
      // o nó diz imagem (foto velha): quem manda é o item
      media_type: 'image',
      media_url: 'https://storage/account-acc/acervo/boas-vindas.ogg',
      acervo_id: 'item-1',
    });
    expect(m.tipo).toBe('audio');
    expect(copias).toHaveLength(1);
    expect(copias[0][0]).toBe(ITEM.media_path);
    // A cópia sai do acervo/ — é um anexo como outro qualquer.
    expect(copias[0][1]).toMatch(/^account-acc\/\d+-boas-vindas\.ogg$/);
    expect(m.link).toBe(`https://storage/${copias[0][1]}`);
    expect(m.copia).toBe(copias[0][1]);
    expect(m.filename).toBe('boas-vindas.ogg');
    // Cercado pela conta: service role ignora RLS.
    expect(filtros).toContainEqual(['account_id', 'acc']);
  });

  it('ACERVO: item apagado falha com motivo legível', async () => {
    const { db } = bancoComAcervo({ item: null });
    await expect(prepararMidiaDoNo(db, 'acc', { media_type: 'audio', acervo_id: 'x' })).rejects.toThrow(
      /deleted/,
    );
  });

  it('ACERVO: erro de banco ou do Storage falha — nunca cai para a URL guardada', async () => {
    await expect(
      prepararMidiaDoNo(bancoComAcervo({ erroLeitura: 'timeout' }).db, 'acc', {
        media_type: 'audio',
        media_url: 'https://storage/velho.ogg',
        acervo_id: 'x',
      }),
    ).rejects.toThrow(/leitura/);
    await expect(
      prepararMidiaDoNo(bancoComAcervo({ item: ITEM, erroCopia: 'no space' }).db, 'acc', {
        media_type: 'audio',
        acervo_id: 'item-1',
      }),
    ).rejects.toThrow(/copia/);
  });

  it('NÓ ANTIGO: manda a URL como está, sem cópia', async () => {
    const { db, copias } = bancoComAcervo({});
    const m = await prepararMidiaDoNo(db, 'acc', {
      media_type: 'document',
      media_url: 'https://flow-media/fatura.pdf',
      filename: 'fatura.pdf',
    });
    expect(m).toEqual({
      tipo: 'document',
      link: 'https://flow-media/fatura.pdf',
      filename: 'fatura.pdf',
      copia: null,
    });
    expect(copias).toHaveLength(0);
  });

  it('nó sem arquivo lança', async () => {
    await expect(prepararMidiaDoNo(bancoComAcervo({}).db, 'acc', { media_type: 'image' })).rejects.toThrow(
      /no file/,
    );
  });
});
