// ============================================================
// Subir e desfazer o anexo da anotação (1102) — NAVEGADOR.
//
// A caixa (`InternalNoteBox`) sobe cada arquivo, um por vez, só ao Salvar,
// para `account-<conta>/notas/<único>/<nome>`; o `POST /api/cb/notes` grava
// os caminhos e confere cada um no armazenamento. O Storage carimba o
// `owner_id` com a sessão de quem sobe — é ele que deixa a PRÓPRIA pessoa
// apagar o que subiu e desistiu (a regra de `notas/` da 1102: ninguém troca;
// só o dono apaga). O que vira anotação sai, depois, pela fila da 1102.
//
// O tipo do arquivo já vem NORMALIZADO (`arquivoParaEnviar`): o bucket tem
// lista exata e recusa `image/png; charset=binary` (midia.md).
// ============================================================

import { createClient } from '@/lib/supabase/client';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';

import { caminhoDoAnexoDaNota } from './anexos';

/** Sobe o arquivo e devolve o CAMINHO (a URL nasce na tela). Lança na falha. */
export async function subirAnexoDaNota(
  conta: string,
  arquivo: File
): Promise<string> {
  const caminho = caminhoDoAnexoDaNota(conta, arquivo.name, crypto.randomUUID());
  const { error } = await createClient()
    .storage.from(CHAT_MEDIA_BUCKET)
    .upload(caminho, arquivo, {
      cacheControl: '3600',
      upsert: false,
      contentType: arquivo.type,
    });
  if (error) throw new Error(error.message);
  return caminho;
}

/**
 * Apaga o que a pessoa subiu e não virou anotação (desistiu, tirou da lista,
 * a caixa sumiu com o rascunho). Melhor esforço: quem chama não espera nem
 * avisa — um arquivo que fica é sobra no bucket, não erro de quem escreve.
 */
export async function apagarAnexosSubidos(
  caminhos: readonly string[]
): Promise<void> {
  if (caminhos.length === 0) return;
  const { error } = await createClient()
    .storage.from(CHAT_MEDIA_BUCKET)
    .remove([...caminhos]);
  if (error) throw new Error(error.message);
}
