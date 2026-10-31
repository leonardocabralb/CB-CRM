import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { lerArquivoDoAnexo } from './arquivo-do-anexo';

// ============================================================
// A leitura do anexo no armazenamento (1102): ausente ≠ fora do ar. Dublê do
// `storage.from().info()` com as formas que o storage-js 2.109 devolve
// (`handleOperation`: resolve `{ data: null, error }` para StorageError e
// LANÇA o resto). A forma real se mede no preview.
// ============================================================

function cliente(info: (caminho: string) => Promise<unknown>) {
  const pedidos: Array<{ bucket: string; caminho: string }> = [];
  const supabase = {
    storage: {
      from: (bucket: string) => ({
        info: (caminho: string) => {
          pedidos.push({ bucket, caminho });
          return info(caminho);
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { supabase, pedidos };
}

const CAMINHO = 'account-00000000-0000-0000-0000-000000000001/notas/u1/a.ogg';

describe('lerArquivoDoAnexo', () => {
  it('existe: tamanho e tipo do Storage, no bucket chat-media', async () => {
    const { supabase, pedidos } = cliente(async () => ({
      data: { size: 4096, contentType: 'audio/ogg' },
      error: null,
    }));
    expect(await lerArquivoDoAnexo(supabase, CAMINHO)).toEqual({
      estado: 'existe',
      bytes: 4096,
      mime: 'audio/ogg',
    });
    expect(pedidos).toEqual([{ bucket: 'chat-media', caminho: CAMINHO }]);
  });

  it('sem os campos de cima, lê os do metadata', async () => {
    const { supabase } = cliente(async () => ({
      data: { metadata: { size: 12, mimetype: 'application/pdf' } },
      error: null,
    }));
    expect(await lerArquivoDoAnexo(supabase, CAMINHO)).toEqual({
      estado: 'existe',
      bytes: 12,
      mime: 'application/pdf',
    });
  });

  it('o 404 do objeto (HTTP 404, ou 400 com statusCode "404") é AUSENTE', async () => {
    for (const error of [
      { message: 'Object not found', status: 404, statusCode: '404' },
      { message: 'Object not found', status: 400, statusCode: '404' },
    ]) {
      const { supabase } = cliente(async () => ({ data: null, error }));
      expect(await lerArquivoDoAnexo(supabase, CAMINHO)).toEqual({ estado: 'ausente' });
    }
  });

  it('5xx, rede e resposta sem tamanho ou tipo são FALHA (a rota responde 503), nunca ausente', async () => {
    const casos: Array<() => Promise<unknown>> = [
      async () => ({ data: null, error: { message: 'gateway', status: 502, statusCode: '502' } }),
      async () => ({ data: null, error: { message: 'fetch failed' } }),
      async () => ({ data: { size: 10 }, error: null }),
      async () => {
        throw new TypeError('fetch failed');
      },
    ];
    for (const info of casos) {
      const { supabase } = cliente(info);
      expect((await lerArquivoDoAnexo(supabase, CAMINHO)).estado).toBe('falhou');
    }
  });
});
