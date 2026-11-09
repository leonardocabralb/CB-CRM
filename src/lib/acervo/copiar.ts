// ============================================================
// Acervo de mídias (953) — COPIAR um item para mandá-lo.
//
// Server-side (service role). Duas formas, e a regra mora aqui para os
// chamadores seguirem a mesma:
//   · `copiarDoAcervo` — uma cópia NOVA por envio, num caminho normal de
//     anexo. Só a rota `POST /api/cb/acervo/[id]/copiar` (o compositor, antes
//     de montar o rascunho), porque o compositor APAGA o anexo dele;
//   · `copiaCongeladaDoAcervo` — UMA cópia por ITEM, reaproveitada em todo
//     envio (decisão do operador, 09/11/2026): o nó "Enviar mídia" do robô
//     (`src/lib/flows/midia-do-no.ts`) e o passo "Enviar arquivo" das
//     automações (`src/lib/automations/midia-do-passo.ts`), que nunca apagam
//     o que mandaram. Cópia por envio custava o arquivo inteiro a cada
//     cliente (o vídeo de 13,85 MB, 100 envios ≈ 1,4 GB).
//
// ⚠️⚠️ A CÓPIA é o coração, não uma otimização (ver a rota):
//   1. o compositor APAGA o objeto quando o envio falha ou o rascunho é
//      descartado, e cancelar uma agendada apaga também (932). Enviando por
//      referência, um envio falho destruiria o arquivo do escritório — e,
//      com a cópia congelada, a de todo mundo: por isso ele não a usa;
//   2. num CRM jurídico o que FOI ENVIADO não muda depois. A mensagem gravada
//      no fio aponta para a CÓPIA; apagar o item do acervo (que remove só o
//      original) não deixa a bolha antiga "indisponível".
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
      /**
       * Caminho da cópia no bucket. O compositor apaga a de `copiarDoAcervo`
       * se o rascunho morrer; a de `copiaCongeladaDoAcervo` NUNCA se apaga.
       */
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

interface ItemLido {
  id: string;
  tipo: TipoDeMidia;
  media_path: string;
  filename: string;
}

/** O item, lido pela CONTA — a leitura das duas formas de cópia. */
async function lerItem(
  admin: SupabaseClient,
  accountId: string,
  itemId: string,
): Promise<{ ok: true; item: ItemLido } | { ok: false; erro: 'leitura' | 'nao_encontrado'; detalhe: string }> {
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
  return { ok: true, item: item as ItemLido };
}

export async function copiarDoAcervo(
  admin: SupabaseClient,
  accountId: string,
  itemId: string,
): Promise<ResultadoDaCopia> {
  const lido = await lerItem(admin, accountId, itemId);
  if (!lido.ok) return lido;
  const { item } = lido;

  const destino = caminhoDaCopia(accountId, item.filename);
  const { error: erroCopia } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .copy(item.media_path, destino);
  if (erroCopia) return { ok: false, erro: 'copia', detalhe: erroCopia.message };

  const {
    data: { publicUrl },
  } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(destino);

  return {
    ok: true,
    tipo: item.tipo,
    mediaUrl: publicUrl,
    path: destino,
    filename: item.filename,
  };
}

/**
 * Puro: o caminho da CÓPIA CONGELADA de um item — UM por item, estável:
 * `account-<conta>/acervo/enviados/<item>/<nome>.<ext>`.
 *
 * ⚠️ Dentro de `acervo/` de propósito, e é o que dispensa migration: a policy
 * de Storage da 954 (só admin escreve ou apaga sob `acervo/`, pelo 2º
 * segmento do caminho) e a guarda da Lixeira da 1097 (`acervo/` nunca entra
 * na fila de apagar) já valem para a subpasta. Sem carimbo de tempo: o mesmo
 * item cai sempre no mesmo lugar, e `basenameFromUrl` recupera o nome.
 */
export function caminhoDaCopiaCongelada(accountId: string, itemId: string, filename: string): string {
  return buildMediaPath(accountId, filename, null, `acervo/enviados/${itemId}`);
}

/**
 * O objeto está no bucket? `true`/`false` só com a resposta do Storage;
 * `null` = não deu para saber.
 *
 * ⚠️ As duas armadilhas do `exists()` (a rota `POST /api/cb/acervo`): o
 * ausente RESOLVE com `data: false` E `error` ao mesmo tempo — só o `data`
 * vale —, e qualquer outra falha (5xx, rede) é LANÇADA. Storage fora do ar
 * não é "não existe".
 */
async function existeNoBucket(admin: SupabaseClient, caminho: string): Promise<boolean | null> {
  try {
    const r = await admin.storage.from(CHAT_MEDIA_BUCKET).exists(caminho);
    return typeof r.data === 'boolean' ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * A CÓPIA CONGELADA do item (decisão do operador, 09/11/2026): feita no
 * PRIMEIRO envio e reaproveitada em todos os seguintes. O que saiu continua
 * sem mudar nem sumir — o item não troca de arquivo (trocar é apagar e
 * cadastrar de novo, com outro id), apagar o item remove só o original, e
 * nada apaga a cópia congelada (nem a Lixeira, nem a rota do acervo).
 *
 * Só para quem NUNCA apaga o que mandou (o robô e as automações). O
 * compositor segue com `copiarDoAcervo`: ele apaga o anexo do rascunho
 * descartado, e apagaria a cópia de todo mundo.
 *
 * Mesmos desfechos de `copiarDoAcervo`: `leitura` (banco, NUNCA "não
 * encontrado"), `nao_encontrado` (apagado) e `copia` (o Storage recusou e a
 * cópia não está lá).
 */
export async function copiaCongeladaDoAcervo(
  admin: SupabaseClient,
  accountId: string,
  itemId: string,
): Promise<ResultadoDaCopia> {
  const lido = await lerItem(admin, accountId, itemId);
  if (!lido.ok) return lido;
  const { item } = lido;

  const destino = caminhoDaCopiaCongelada(accountId, item.id, item.filename);
  if ((await existeNoBucket(admin, destino)) !== true) {
    const { error: erroCopia } = await admin.storage
      .from(CHAT_MEDIA_BUCKET)
      .copy(item.media_path, destino);
    // Recusada porque JÁ existe: outro envio do mesmo item copiou entre a
    // conferência e a cópia (ou a conferência não respondeu). É a MESMA
    // cópia — confere de novo antes de desistir.
    if (erroCopia && (await existeNoBucket(admin, destino)) !== true) {
      return { ok: false, erro: 'copia', detalhe: erroCopia.message };
    }
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(destino);

  return {
    ok: true,
    tipo: item.tipo,
    mediaUrl: publicUrl,
    path: destino,
    filename: item.filename,
  };
}
