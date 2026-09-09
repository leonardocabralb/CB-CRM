import { createClient } from "@/lib/supabase/client";
import { buildMediaPath } from "./media-path";

/**
 * Shared media-upload helper for Supabase Storage buckets that use the
 * account-scoped path convention introduced in migration 020
 * (`flow-media`) and reused by migration 023 (`chat-media`):
 *
 *   <bucket>/account-<account_id>/<timestamp>-<basename>.<ext>
 *
 * The first path segment (`account-<uuid>`) is what the bucket's RLS
 * write policies match on, so every caller MUST go through here rather
 * than hand-rolling a path — a mismatched segment is silently rejected
 * by RLS. Both the Flows builder (`node-config-form`) and the inbox
 * composer call this so the logic lives in exactly one place.
 */

/**
 * 16 MB — o `file_size_limit` do bucket `flow-media` (016/020).
 *
 * ⚠️ Deixou de valer para o `chat-media`, que foi para 50 MiB na 986: quem
 * responde por ele é `MEDIA_MAX_BYTES_ENTRADA` (entrada) ou
 * `MEDIA_MAX_BYTES_BY_KIND` (envio). O comentário antigo dizia "both
 * buckets" e ficaria mentindo aqui.
 */
export const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Per-kind upload ceilings that mirror Meta's WhatsApp Cloud API caps so
 * a file that the bucket would accept (≤16 MB) but Meta would reject is
 * caught client-side BEFORE upload — otherwise it lands in storage as an
 * orphan and the send fails with a confusing 400. Images are Meta's
 * tightest cap at 5 MB; documents are held at the 16 MB bucket limit
 * (Meta allows 100 MB, but the bucket — and shared-hosting upload UX —
 * caps lower).
 */
/**
 * Teto do que o CRM aceita RECEBER de um cliente — 50 MiB, o `file_size_limit`
 * do bucket `chat-media` desde a migration 986.
 *
 * ⚠️ É OUTRO número, e outra pergunta, do `MEDIA_MAX_BYTES_BY_KIND` abaixo.
 * Aquele é o teto de ENVIO: espelha os limites da API da Meta para o arquivo
 * ser barrado no navegador antes de virar órfão no bucket. Este responde
 * "cabe no nosso Storage?" sobre um arquivo que o cliente JÁ mandou e que o
 * WhatsApp já aceitou — recusá-lo não impede envio nenhum, só apaga o
 * documento do fio.
 *
 * Os dois eram o MESMO valor até 2026-09-09, e o preço foi medido: sete
 * documentos de cliente (extrato, contrato, regulamento — até 46 MiB)
 * viraram "Documento indisponível", porque o teto de ENVIO da Meta estava
 * decidindo o que o escritório podia RECEBER.
 *
 * ⚠️ Espelha a migration 986, como `MIMES_POR_TIPO` espelha a
 * `allowed_mime_types` da 023: subir aqui sem subir lá troca a recusa do
 * código por uma recusa do Storage, já com o arquivo baixado.
 */
export const MEDIA_MAX_BYTES_ENTRADA = 50 * 1024 * 1024;

export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const;

/**
 * O construtor de caminho mudou para `media-path.ts` (server-safe) — ver o
 * cabeçalho de lá. Reexportado aqui para os call sites e o teste existentes.
 */
export { buildMediaPath } from "./media-path";

export interface UploadAccountMediaResult {
  /** Public URL Meta can fetch at send time. */
  publicUrl: string;
  /** Storage object path (account-scoped). */
  path: string;
}

/**
 * Upload a file to an account-scoped Storage bucket and return its public
 * URL. Throws with a user-facing message on auth / account-resolution /
 * upload failure — callers surface it via a toast.
 *
 * Size validation is the caller's responsibility (limits can differ per
 * feature); `MEDIA_MAX_BYTES` is exported for the common case.
 */
export async function uploadAccountMedia(
  bucket: string,
  file: File,
  /**
   * Pasta abaixo de `account-<id>`. As policies da 020/023 casam só o
   * PRIMEIRO segmento, então aninhar é de graça — é o que separa o arquivo do
   * acervo (953) de um anexo qualquer de mensagem dentro do mesmo bucket.
   */
  subfolder?: string,
): Promise<UploadAccountMediaResult> {
  const supabase = createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new Error("Not signed in.");
  }

  // Resolve account_id so the path is account-scoped (matches the
  // bucket's RLS write policy from migration 020/023). User-scoped
  // paths would be rejected.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileErr || !profile?.account_id) {
    throw new Error("Could not resolve your account.");
  }

  const path = buildMediaPath(
    profile.account_id as string,
    file.name,
    Date.now(),
    subfolder,
  );
  const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (upErr) throw new Error(upErr.message);

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(path);

  return { publicUrl, path };
}

/**
 * Delete a previously-uploaded object. Used to GC media that was staged
 * (uploaded) but never sent — a cancelled draft or a failed Meta send —
 * so abandoned attachments don't accumulate in the public bucket. The
 * DELETE is gated by the same account-scoped RLS policy as the upload,
 * so a caller can only remove objects under their own account folder.
 *
 * Best-effort: callers fire-and-forget and swallow errors (a missed
 * delete is a storage nit, not something to surface to the user).
 */
export async function deleteAccountMedia(
  bucket: string,
  path: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message);
}
