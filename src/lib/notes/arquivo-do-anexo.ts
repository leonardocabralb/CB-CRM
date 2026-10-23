// ============================================================
// O que o ARMAZENAMENTO diz de um anexo de anotação (1102) — servidor.
//
// A rota `POST /api/cb/notes` nunca confia no corpo: o tamanho e o tipo do
// anexo vêm daqui, lidos com o service role no `chat-media`. Isolado de
// propósito numa função só: a forma da leitura (`info()`) é a do storage-js
// instalado (2.109) e ainda se MEDE contra o Storage real no preview — se o
// projeto responder diferente, troca-se aqui, e o resto não muda.
//
// A alternativa já pensada: `list()` da pasta do arquivo (cada anexo tem
// pasta própria, `notas/<único>/`), filtrado pelo nome — devolve
// `metadata.size` e `metadata.mimetype`.
//
// ⚠️⚠️ Ausente ≠ fora do ar (raiz, 8b: "Storage fora do ar ≠ arquivo
// sumiu"). `info()` RESOLVE com `{ data: null, error }` nos dois casos (o
// `handleOperation` do storage-js converte o erro): o 404 do objeto — que o
// Storage do Supabase manda como HTTP 404, ou como 400 com `statusCode:
// "404"` no corpo — é `ausente`; qualquer outra falha (5xx, rede, resposta
// sem tamanho ou tipo) é `falhou`, e a rota responde 503, nunca 400. E o que
// não for erro do Storage é LANÇADO: daí o try/catch.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';

export type ArquivoNoArmazenamento =
  | { estado: 'existe'; bytes: number; mime: string }
  | { estado: 'ausente' }
  | { estado: 'falhou'; motivo: string };

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** O 404 do OBJETO, nas duas formas que o Storage do Supabase responde. */
function ehAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== 'object') return false;
  const { status, statusCode } = erro as { status?: unknown; statusCode?: unknown };
  return status === 404 || String(statusCode) === '404';
}

export async function lerArquivoDoAnexo(
  admin: SupabaseClient,
  caminho: string
): Promise<ArquivoNoArmazenamento> {
  try {
    const { data, error } = await admin.storage
      .from(CHAT_MEDIA_BUCKET)
      .info(caminho);
    if (error) {
      return ehAusente(error)
        ? { estado: 'ausente' }
        : { estado: 'falhou', motivo: error.message };
    }
    const meta = (data?.metadata ?? {}) as Record<string, unknown>;
    const bytes = numero(data?.size) ?? numero(meta.size);
    const mime = texto(data?.contentType) ?? texto(meta.mimetype);
    if (bytes === null || mime === null) {
      return { estado: 'falhou', motivo: 'o armazenamento não disse o tamanho ou o tipo' };
    }
    return { estado: 'existe', bytes, mime };
  } catch (erro) {
    return {
      estado: 'falhou',
      motivo: erro instanceof Error ? erro.message : 'erro desconhecido',
    };
  }
}
