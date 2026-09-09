// ============================================================
// A mídia da DM: baixar a URL ASSINADA do CDN da Meta na hora e guardar no
// Storage. Só de servidor.
//
// Medido na Fase 0: a URL (`lookaside.fbsbx.com/ig_messaging_cdn/…&signature=`)
// vem com `cache-control: no-store` e EXPIRA — gravá-la em `media_url`
// deixaria a bolha "indisponível" horas depois. E o CDN entrega a nota de
// voz como `content-type: video/mp4` (`audioclip-<epoch>.mp4`): quem decide
// classe e mime é o `type` do webhook (`midiaDoAnexo`), nunca o cabeçalho.
//
// Reusa o espelhamento da Meta Cloud API (`mirrorInboundMedia`: teto de
// entrada, nome do objeto, upload, URL pública) com um download próprio —
// a URL assinada NÃO leva `Authorization`, e mandar um Bearer para o CDN
// seria entregar o token a um host que não o pediu.
// ============================================================

import { createHash } from 'node:crypto';

import {
  mirrorInboundMedia,
  type MirrorStorage,
} from '@/lib/whatsapp/mirror-inbound-media';

import type { MidiaSalva } from './persistir';
import { midiaDoAnexo, type AnexoDoInstagram } from './webhook';

const TIMEOUT_MS = 20_000;

/** `filename=audioclip-1757460907-0.mp4` do content-disposition, se vier. */
export function nomeDoContentDisposition(
  header: string | null | undefined
): string | null {
  if (!header) return null;
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1].trim()) : null;
}

/** Curto e estável: o `mid` tem ~120 caracteres e entra no nome do objeto. */
export function chaveCurta(mid: string): string {
  return createHash('sha1').update(mid).digest('hex').slice(0, 12);
}

export async function salvarMidiaDoInstagram(args: {
  storage: MirrorStorage;
  accountId: string;
  anexo: AnexoDoInstagram;
  mid: string;
  timestampMs: number | null;
  fetchFn?: typeof fetch;
}): Promise<MidiaSalva | null> {
  const m = midiaDoAnexo(args.anexo);
  if (!m || !args.anexo.url) return null;
  const fetchFn = args.fetchFn ?? fetch;
  let filename: string | null = null;

  const url = await mirrorInboundMedia({
    storage: args.storage,
    accountId: args.accountId,
    mediaId: `ig-${chaveCurta(args.mid)}`,
    downloadUrl: args.anexo.url,
    accessToken: '', // a URL é assinada; ver o cabeçalho
    mimeType: m.mime,
    messageTimestamp: args.timestampMs,
    download: async ({ downloadUrl }) => {
      const r = await fetchFn(downloadUrl, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`Media download failed: ${r.status}`);
      filename = nomeDoContentDisposition(r.headers.get('content-disposition'));
      return {
        buffer: Buffer.from(await r.arrayBuffer()),
        contentType:
          r.headers.get('content-type') || 'application/octet-stream',
      };
    },
  });
  if (!url) return null;
  return { url, mime: m.mime, classe: m.classe, filename };
}
