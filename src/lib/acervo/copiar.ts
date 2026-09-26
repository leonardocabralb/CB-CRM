// ============================================================
// Acervo de mídias (953) — COPIAR um item para o caminho normal de anexo.
//
// Server-side (service role). Dois chamadores, e a regra mora aqui para os
// dois seguirem a mesma: a rota `POST /api/cb/acervo/[id]/copiar` (o
// compositor, antes de montar o rascunho) e o nó "Enviar mídia" do robô
// (`src/lib/flows/midia-do-no.ts`), a cada envio.
//
// ⚠️⚠️ A CÓPIA é o coração, não uma otimização (ver a rota):
//   1. o compositor APAGA o objeto quando o envio falha ou o rascunho é
//      descartado, e cancelar uma agendada apaga também (932). Enviando por
//      referência, um envio falho destruiria o arquivo do escritório;
//   2. num CRM jurídico o que FOI ENVIADO não muda depois. A mensagem gravada
//      no fio aponta para a CÓPIA; apagar o item do acervo (que remove o
//      objeto do bucket) não deixa a bolha antiga "indisponível".
//
// `copy()` roda dentro do Storage: nada trafega por aqui.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
import { buildMediaPath } from '@/lib/storage/media-path';
import type { TipoDeMidia } from './tipos';

export type ResultadoDaCopia =
  | {
      ok: true;
      tipo: TipoDeMidia;
      /** URL pública da CÓPIA — é ela que vai para o WhatsApp e para o fio. */
      mediaUrl: string;
      /** Caminho da cópia no bucket, para quem precisar apagá-la se o envio falhar. */
      path: string;
      filename: string;
    }
  /**
   * `leitura` = o banco falhou (NÃO é "não encontrado" — regra do projeto:
   * virar 404 faria alguém cadastrar o arquivo de novo); `nao_encontrado` =
   * o item não existe nesta conta (apagado); `copia` = o Storage recusou.
   */
  | { ok: false; erro: 'leitura' | 'nao_encontrado' | 'copia'; detalhe: string };

/**
 * Puro: o caminho da CÓPIA, único por envio. `buildMediaPath` carimba só o
 * milissegundo, e dois leads que chegam ao mesmo passo "Enviar mídia" do robô
 * no mesmo milissegundo teriam o MESMO destino — o Storage recusa copiar por
 * cima de objeto existente, e um dos envios falharia com a mídia perfeita
 * (Codex, PR #314). Seis dígitos aleatórios colados ao carimbo resolvem sem
 * mudar a forma do caminho: `basenameFromUrl` (`media/filename.ts`) tira
 * `^\d{10,}-` e continua achando o nome do arquivo.
 */
export function caminhoDaCopia(
  accountId: string,
  filename: string,
  agora: number = Date.now(),
  sorte: number = Math.floor(Math.random() * 1_000_000),
): string {
  const semCarimbo = buildMediaPath(accountId, filename, null);
  const barra = semCarimbo.lastIndexOf('/');
  const carimbo = `${agora}${String(sorte).padStart(6, '0')}-`;
  return semCarimbo.slice(0, barra + 1) + carimbo + semCarimbo.slice(barra + 1);
}

export async function copiarDoAcervo(
  admin: SupabaseClient,
  accountId: string,
  itemId: string,
): Promise<ResultadoDaCopia> {
  // ⚠️ O `.eq('account_id')` não é decorativo: service role ignora RLS, e
  // sem ele o id de um item de outra conta seria copiado daqui.
  const { data: item, error } = await admin
    .from('cb_media_library')
    .select('id, tipo, media_path, filename')
    .eq('id', itemId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) return { ok: false, erro: 'leitura', detalhe: error.message };
  if (!item) return { ok: false, erro: 'nao_encontrado', detalhe: 'item not found' };

  const destino = caminhoDaCopia(accountId, item.filename as string);
  const { error: erroCopia } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .copy(item.media_path as string, destino);
  if (erroCopia) return { ok: false, erro: 'copia', detalhe: erroCopia.message };

  const {
    data: { publicUrl },
  } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(destino);

  return {
    ok: true,
    tipo: item.tipo as TipoDeMidia,
    mediaUrl: publicUrl,
    path: destino,
    filename: item.filename as string,
  };
}
