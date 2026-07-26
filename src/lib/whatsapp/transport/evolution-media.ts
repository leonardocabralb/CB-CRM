// ============================================================
// Mídia RECEBIDA por canal Evolution (QR / não-oficial).
//
// Até aqui `normalizeUpsert` devolvia `mediaUrl: null` com um TODO, então
// 100% da mídia recebida por número não-oficial se perdia: o cliente mandava
// a foto do contrato assinado ou o áudio explicando o caso, e no inbox
// aparecia uma bolha vazia. O conteúdo só existia no aparelho pareado.
//
// A Evolution não expõe URL de download: o binário vem em base64 sob demanda
// (`chat/getBase64FromMediaMessage`). Aqui ele é buscado e persistido no
// bucket `chat-media` (migration 023), o mesmo que a mídia da Meta usa, no
// caminho `account-<uuid>/…` que a RLS do bucket exige.
//
// Server-side de propósito: roda no `after()` do webhook, com o client de
// service-role — `uploadAccountMedia` é do browser e depende de sessão.
//
// TUDO best-effort: uma falha aqui devolve `null` e a mensagem é persistida
// sem anexo, exatamente como antes. Perder o anexo é ruim; perder a mensagem
// inteira seria pior.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { buildMediaPath, MEDIA_MAX_BYTES_BY_KIND } from '@/lib/storage/upload-media';
import type { EvolutionClient } from './evolution-client';

const BUCKET = 'chat-media';

/**
 * Mimetype sem parâmetros e em minúsculas. Nota de voz chega como
 * `audio/ogg; codecs=opus`, e o `allowed_mime_types` do bucket `chat-media`
 * lista `audio/ogg` — a comparação é literal, então o parâmetro fazia o
 * Storage recusar TODA nota de voz recebida.
 */
function mimeBase(mime: string): string {
  return mime.split(';')[0].trim().toLowerCase();
}

/** Extensão a partir do mimetype, para o arquivo abrir com o app certo. */
function extFromMime(mime: string): string {
  const limpo = mimeBase(mime);
  const mapa: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/amr': 'amr',
    'application/pdf': 'pdf',
  };
  if (mapa[limpo]) return mapa[limpo];
  const sufixo = limpo.split('/')[1];
  return sufixo && /^[a-z0-9]{1,5}$/.test(sufixo) ? sufixo : 'bin';
}

type Kind = keyof typeof MEDIA_MAX_BYTES_BY_KIND;

function kindFromContentType(contentType: string): Kind | null {
  if (contentType === 'image' || contentType === 'video' || contentType === 'audio')
    return contentType;
  if (contentType === 'document') return 'document';
  return null;
}

/**
 * Baixa a mídia da Evolution e sobe para o bucket. Devolve a URL pública, ou
 * `null` quando não há o que baixar / algo falhou.
 */
export async function fetchAndStoreEvolutionMedia(args: {
  db: SupabaseClient;
  client: EvolutionClient;
  accountId: string;
  /**
   * O item CRU do webhook (`data`), COM `key` e `message` — não o `.message`
   * de dentro dele. A Evolution resolve com `m?.message ? m : getMessage(m.key)`;
   * receber só o conteúdo quebra os dois ramos e devolve 400.
   */
  rawMessage: unknown;
  contentType: string;
}): Promise<string | null> {
  const kind = kindFromContentType(args.contentType);
  if (!kind) return null;

  try {
    const { base64, mimetype, fileName } = await args.client.getBase64FromMediaMessage({
      message: args.rawMessage,
    });
    if (!base64) return null;

    const bytes = Buffer.from(base64, 'base64');
    const limite = MEDIA_BYTES_LIMIT[kind];
    if (bytes.byteLength > limite) {
      console.warn(
        `[evolution-media] anexo de ${bytes.byteLength} bytes excede o limite de ${limite} para ${kind}; mensagem persistida sem anexo`,
      );
      return null;
    }

    const mime = mimeBase(mimetype || '') || 'application/octet-stream';
    const nome = fileName || `media.${extFromMime(mime)}`;
    const path = buildMediaPath(args.accountId, nome);

    const { error } = await args.db.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false, cacheControl: '3600' });
    if (error) {
      console.error('[evolution-media] upload falhou:', error.message);
      return null;
    }

    const {
      data: { publicUrl },
    } = args.db.storage.from(BUCKET).getPublicUrl(path);
    return publicUrl;
  } catch (err) {
    console.error(
      '[evolution-media] não foi possível recuperar a mídia:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

const MEDIA_BYTES_LIMIT = MEDIA_MAX_BYTES_BY_KIND;
