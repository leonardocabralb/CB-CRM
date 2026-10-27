// ============================================================
// Com que TIPO o anexo RECEBIDO é guardado no bucket `chat-media` (1115).
//
// O bucket tem lista EXATA de tipos (023/042/1060), e o que ficava fora dela
// o Storage recusava: a mensagem era gravada sem o arquivo ("Documento
// indisponível"). Medido em 27/10/2026: em 11 dias, 4 ZIP (como
// `application/zip` e como `application/x-zip-compressed`, a grafia do
// Windows) e 2 e-mails do Outlook. Pedido do operador: todo formato entra.
//
// ⚠️ Sem abrir o bucket para TUDO (lista nula): um `.svg` ou um `.html` com o
// tipo verdadeiro rodaria no navegador a partir do endereço do nosso Storage.
// O desenho é outro — o tipo que o navegador MOSTRA ou TOCA vai com o nome
// dele (a lista abaixo), e qualquer outro vai como binário genérico, que o
// navegador só BAIXA (`urlParaAbrirAnexo` põe o nome real no `download=`). O
// tipo verdadeiro continua em `messages.media_type`.
//
// Puro: lido pelo download da Evolution, pelo espelho da Meta e pela bolha.
// ============================================================

/** O tipo de quem não tem tipo conhecido — também na lista do bucket (1115). */
export const BINARIO_GENERICO = 'application/octet-stream';

/**
 * ⚠️ ESPELHO da `allowed_mime_types` do `chat-media`: a lista da 0042, o
 * `.html` da 1060 e os tipos da 1115. Pino `tipos-do-chat-media.test.ts`
 * (lê as três migrations). Tipo aqui que o bucket não aceita = o upload é
 * recusado e o anexo some de novo; tipo no bucket que falta aqui = só vira
 * binário, sem perda.
 */
export const MIMES_DO_CHAT_MEDIA: readonly string[] = [
  // 0042
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/3gpp',
  'video/3gp',
  'video/quicktime',
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'audio/ogg',
  'audio/mpeg',
  'audio/aac',
  'audio/mp4',
  'audio/amr',
  'audio/opus',
  // 1060 (baixa, nunca abre: `ehPaginaHtml`)
  'text/html',
  // 1115: o binário genérico e as grafias de imagem, áudio e vídeo que a bolha
  // DESENHA ou TOCA — guardadas como binário, dependeriam do palpite do
  // navegador para aparecer.
  BINARIO_GENERICO,
  'image/jpg',
  'image/bmp',
  'image/avif',
  'image/heic',
  'image/heif',
  'audio/mp3',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'audio/x-flac',
  'video/webm',
];

/** Sem parâmetros e em minúsculas (`audio/ogg; codecs=opus` → `audio/ogg`). */
function tipoBase(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * O `contentType` do upload: o tipo declarado, se o bucket o aceita; senão o
 * binário genérico. Tipo ausente também vira binário.
 */
export function tipoParaGuardar(mime: string | null | undefined): string {
  const base = tipoBase(mime);
  return base && MIMES_DO_CHAT_MEDIA.includes(base) ? base : BINARIO_GENERICO;
}

/**
 * O anexo com este `media_type` está no bucket como binário genérico — e por
 * isso o link o BAIXA com o nome real. Tipo AUSENTE responde `false`: as
 * linhas de antes da 969 não têm `media_type`, e eram guardadas com o tipo
 * delas.
 */
export function guardadoComoBinario(mime: string | null | undefined): boolean {
  const base = tipoBase(mime);
  if (!base) return false;
  return tipoParaGuardar(base) === BINARIO_GENERICO;
}
