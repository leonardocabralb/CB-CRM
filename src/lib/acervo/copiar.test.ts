import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { basenameFromUrl } from '@/lib/media/filename';
import {
  caminhoDaCopia,
  caminhoDaCopiaCongelada,
  copiaCongeladaDoAcervo,
  copiarDoAcervo,
} from './copiar';

// O caminho da cópia do acervo é ÚNICO por envio (Codex, PR #314): dois
// leads no mesmo milissegundo não podem cair no mesmo destino, e o nome do
// arquivo continua recuperável a partir do caminho.
describe('caminhoDaCopia', () => {
  it('mesmo milissegundo, sortes diferentes → caminhos diferentes', () => {
    const a = caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 1);
    const b = caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 2);
    expect(a).not.toBe(b);
  });

  it('forma: account-<id>/<carimbo de 19 dígitos>-<nome>.<ext>', () => {
    expect(caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 42)).toBe(
      'account-conta-1/1790000000000000042-Boas-vindas.ogg',
    );
  });

  it('o nome do arquivo continua saindo do caminho (basenameFromUrl)', () => {
    const caminho = caminhoDaCopia('conta-1', 'Boas-vindas.ogg', 1790000000000, 987654);
    expect(basenameFromUrl(`https://x.supabase.co/storage/v1/object/public/chat-media/${caminho}`)).toBe(
      'Boas-vindas.ogg',
    );
  });
});

// ============================================================
// A CÓPIA CONGELADA (decisão do operador, 09/11/2026): UMA cópia por item para
// o robô e as automações, feita no primeiro envio e reaproveitada nos
// seguintes. O compositor segue com uma cópia por envio (`copiarDoAcervo`).
// ============================================================

/** Banco e bucket falsos: o bucket guarda os objetos que existem. */
function bancoDoAcervo(opts: {
  item?: Record<string, unknown> | null;
  erroLeitura?: string;
  /** Objetos que já estão no bucket. */
  existentes?: string[];
  erroCopia?: string;
  /** Faz o `exists()` LANÇAR (5xx/rede) nas primeiras N chamadas. */
  existsLancaVezes?: number;
}) {
  const bucket = new Set(opts.existentes ?? []);
  const copias: Array<[string, string]> = [];
  const filtros: Array<[string, unknown]> = [];
  let lancamentos = opts.existsLancaVezes ?? 0;
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
        // A forma do storage-js: AUSENTE resolve com data:false E error.
        exists: (p: string) => {
          if (lancamentos > 0) {
            lancamentos -= 1;
            return Promise.reject(new Error('503 Service Unavailable'));
          }
          return Promise.resolve(
            bucket.has(p) ? { data: true, error: null } : { data: false, error: { message: 'Object not found' } },
          );
        },
        copy: (de: string, para: string) => {
          copias.push([de, para]);
          if (opts.erroCopia) return Promise.resolve({ error: { message: opts.erroCopia } });
          if (bucket.has(para)) return Promise.resolve({ error: { message: 'The resource already exists' } });
          bucket.add(para);
          return Promise.resolve({ error: null });
        },
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage/${p}` } }),
      }),
    },
  };
  return { db: db as unknown as SupabaseClient, copias, filtros, bucket };
}

const ITEM = {
  id: '00000000-0000-4000-8000-0000000000a1',
  tipo: 'video',
  media_path: 'account-acc/acervo/1790000000000-gestante.mp4',
  filename: 'Gestante 5 passos.mp4',
};
const CONGELADA = `account-acc/acervo/enviados/${ITEM.id}/Gestante_5_passos.mp4`;

describe('caminhoDaCopiaCongelada', () => {
  it('UM caminho por item, estável, dentro de acervo/ (954 e 1097 já o cobrem)', () => {
    expect(caminhoDaCopiaCongelada('acc', ITEM.id, ITEM.filename)).toBe(CONGELADA);
    expect(caminhoDaCopiaCongelada('acc', ITEM.id, ITEM.filename)).toBe(CONGELADA);
    expect(caminhoDaCopiaCongelada('acc', 'outro-item', ITEM.filename)).not.toBe(CONGELADA);
  });

  it('o nome do arquivo continua saindo do caminho (basenameFromUrl)', () => {
    expect(basenameFromUrl(`https://x.supabase.co/storage/v1/object/public/chat-media/${CONGELADA}`)).toBe(
      'Gestante_5_passos.mp4',
    );
  });
});

describe('copiaCongeladaDoAcervo', () => {
  it('1º envio: copia o item UMA vez para a cópia congelada e devolve a URL dela', async () => {
    const { db, copias, filtros } = bancoDoAcervo({ item: ITEM });
    const r = await copiaCongeladaDoAcervo(db, 'acc', ITEM.id);
    expect(r).toEqual({
      ok: true,
      tipo: 'video',
      mediaUrl: `https://storage/${CONGELADA}`,
      path: CONGELADA,
      filename: 'Gestante 5 passos.mp4',
    });
    expect(copias).toEqual([[ITEM.media_path, CONGELADA]]);
    // Cercado pela conta: service role ignora RLS.
    expect(filtros).toContainEqual(['account_id', 'acc']);
  });

  it('os envios seguintes REAPROVEITAM a mesma cópia — nenhum arquivo novo no bucket', async () => {
    const { db, copias, bucket } = bancoDoAcervo({ item: ITEM });
    const urls = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const r = await copiaCongeladaDoAcervo(db, 'acc', ITEM.id);
      if (r.ok) urls.add(r.mediaUrl);
    }
    expect(copias).toHaveLength(1);
    expect([...urls]).toEqual([`https://storage/${CONGELADA}`]);
    expect([...bucket]).toEqual([CONGELADA]);
  });

  it('corrida: outro envio copiou entre a conferência e a cópia — é a MESMA, segue', async () => {
    // O exists() não respondeu (lançou) e a cópia foi recusada por já existir.
    const { db } = bancoDoAcervo({ item: ITEM, existentes: [CONGELADA], existsLancaVezes: 1 });
    const r = await copiaCongeladaDoAcervo(db, 'acc', ITEM.id);
    expect(r).toMatchObject({ ok: true, path: CONGELADA });
  });

  it('Storage fora do ar na conferência NÃO é "não existe": tenta copiar', async () => {
    const { db, copias } = bancoDoAcervo({ item: ITEM, existsLancaVezes: 1 });
    expect(await copiaCongeladaDoAcervo(db, 'acc', ITEM.id)).toMatchObject({ ok: true });
    expect(copias).toHaveLength(1);
  });

  it('o Storage recusou e a cópia NÃO está lá: falha `copia`', async () => {
    const { db } = bancoDoAcervo({ item: ITEM, erroCopia: 'no space' });
    expect(await copiaCongeladaDoAcervo(db, 'acc', ITEM.id)).toEqual({
      ok: false,
      erro: 'copia',
      detalhe: 'no space',
    });
  });

  it('erro de BANCO é `leitura`, NUNCA "não encontrado"; item apagado é `nao_encontrado` — e o bucket nem é tocado', async () => {
    const leitura = bancoDoAcervo({ erroLeitura: 'timeout' });
    expect(await copiaCongeladaDoAcervo(leitura.db, 'acc', ITEM.id)).toEqual({
      ok: false,
      erro: 'leitura',
      detalhe: 'timeout',
    });
    const apagado = bancoDoAcervo({ item: null });
    expect(await copiaCongeladaDoAcervo(apagado.db, 'acc', ITEM.id)).toMatchObject({
      ok: false,
      erro: 'nao_encontrado',
    });
    expect(leitura.copias).toEqual([]);
    expect(apagado.copias).toEqual([]);
  });
});

describe('copiarDoAcervo (o compositor) segue com uma cópia NOVA por envio', () => {
  it('duas chamadas, duas cópias, fora de acervo/ — o compositor apaga o rascunho dele', async () => {
    const { db, copias } = bancoDoAcervo({ item: ITEM });
    await copiarDoAcervo(db, 'acc', ITEM.id);
    await copiarDoAcervo(db, 'acc', ITEM.id);
    expect(copias).toHaveLength(2);
    for (const [, para] of copias) {
      expect(para).toMatch(/^account-acc\/\d{19}-Gestante_5_passos\.mp4$/);
    }
    expect(copias[0][1]).not.toBe(copias[1][1]);
  });
});
