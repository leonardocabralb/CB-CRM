// Trazido do original (#678) e ALTERADO em dois pontos, com o motivo:
//   1. A CSP da mídia exibida (`inline`) NÃO leva `sandbox`. Medido no
//      Chromium em 25/10/2026: aberto em aba nova, o áudio com `sandbox` fica
//      sem fonte (`networkState` 3) — o documento sandboxado ganha origem opaca
//      e não carrega a própria mídia —, e sem `sandbox`, com `img-src`/
//      `media-src 'self'`, toca. Imagem, áudio e vídeo não rodam script, e o
//      `default-src 'none'` continua barrando qualquer um. O que vira download
//      segue com `sandbox`.
//   2. O download leva o NOME do arquivo quando o link o traz (`nome=`, posto
//      por `urlParaAbrirAnexo`): sem isso o documento do cliente baixava como
//      `<id>.pdf`.
import { extensionForMime, sanitizeFilename } from "./filename";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

const INLINE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const INLINE_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/amr",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/opus",
]);

const INLINE_VIDEO_TYPES = new Set(["video/mp4", "video/3gpp"]);

const MIME_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

const SAFE_MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** O que vira download: nada carrega, nada roda. */
export const MEDIA_PROXY_CSP = "default-src 'none'; sandbox";

/** A mídia exibida: só ela mesma (ver o motivo no topo). */
export const MEDIA_PROXY_INLINE_CSP =
  "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'";

// ⚠️ Em produção quem vale é o `no-store` do `next.config.ts` para `/api/*`:
// o Next grava os cabeçalhos do config ANTES da rota e não sobrescreve um que
// já exista. Este valor só chega a quem chama a rota fora do Next (os testes).
export const MEDIA_PROXY_CACHE_CONTROL = "private, max-age=86400";

export function baseMimeType(contentType?: string | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MIME_TYPE_PATTERN.test(base) ? base : null;
}

export function isInlineSafeMimeType(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    INLINE_IMAGE_TYPES.has(mimeType) ||
    INLINE_AUDIO_TYPES.has(mimeType) ||
    INLINE_VIDEO_TYPES.has(mimeType)
  );
}

/**
 * O nome que o link trouxe, pronto para o cabeçalho: `sanitizeFilename` tira
 * caminho, controle e aspas; a forma ASCII vai em `filename` e a de verdade em
 * `filename*` (RFC 5987), para acento e cedilha chegarem ao arquivo baixado.
 */
function nomeNoCabecalho(nome: string): string | null {
  const limpo = sanitizeFilename(nome);
  if (!limpo) return null;
  const ascii = limpo.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "_");
  const codificado = encodeURIComponent(limpo).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `filename="${ascii}"; filename*=UTF-8''${codificado}`;
}

function attachmentDisposition(mediaId: string, mimeType: string, nome?: string | null): string {
  const doLink = nome ? nomeNoCabecalho(nome) : null;
  if (doLink) return `attachment; ${doLink}`;
  const extension = extensionForMime(mimeType);
  if (extension === "bin" || !SAFE_MEDIA_ID_PATTERN.test(mediaId)) {
    return "attachment";
  }
  return `attachment; filename="${mediaId}.${extension}"`;
}

export function mediaProxyHeaders(
  mediaId: string,
  contentType?: string | null,
  nome?: string | null,
): Record<string, string> {
  const mimeType = baseMimeType(contentType) ?? FALLBACK_CONTENT_TYPE;
  const inline = isInlineSafeMimeType(mimeType);

  return {
    "Content-Type": mimeType,
    "Content-Disposition": inline
      ? "inline"
      : attachmentDisposition(mediaId, mimeType, nome),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": inline ? MEDIA_PROXY_INLINE_CSP : MEDIA_PROXY_CSP,
    "Cache-Control": MEDIA_PROXY_CACHE_CONTROL,
  };
}
