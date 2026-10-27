-- ============================================================
-- 1115 — O `chat-media` recebe TODO arquivo que o cliente manda
--
-- Pedido do operador (27/10/2026): um ZIP que o cliente mandou pela conexão
-- da Evolution apareceu como "Documento indisponível". A Evolution entregou o
-- arquivo; quem o recusou foi o NOSSO bucket — `allowed_mime_types` é lista
-- exata, e `application/x-zip-compressed` (a grafia do Windows) não estava
-- nela (log do Storage: 415 `InvalidMimeType`). Em 11 dias: 4 ZIP e 2 e-mails
-- do Outlook (`application/vnd.ms-outlook`), todos perdidos assim. O operador
-- pediu todo formato: RAR, MP3, MP4 e o resto.
--
-- O que muda no banco, e só isto: a lista do `chat-media` ganha
--   · `application/octet-stream` — o binário genérico. O app guarda como
--     binário TODO tipo que não está na lista (`tipoParaGuardar`,
--     `src/lib/storage/tipos-do-chat-media.ts`), e o navegador só BAIXA
--     binário: um `.svg` ou `.html` com o tipo verdadeiro rodaria a partir do
--     endereço do nosso Storage. Por isso a lista NÃO vira nula ("aceita
--     tudo"): ZIP, RAR, 7z, MSG, CSV, XML… entram como binário, com o tipo
--     verdadeiro gravado em `messages.media_type`.
--   · as grafias de imagem, áudio e vídeo que a bolha DESENHA ou TOCA e não
--     estavam aqui (`image/jpg`, HEIC, `audio/mp3`, `audio/x-m4a`, WAV, WebM,
--     FLAC…). MP3 (`audio/mpeg`) e MP4 (`video/mp4`) já estavam.
--
-- ⚠️ Acrescenta só o que falta, na ordem, e não regrava a lista inteira nem o
-- `file_size_limit` (a 986 o subiu para 50 MiB) — o mesmo cuidado da 1060.
-- ⚠️ `allowed_mime_types` NULO quer dizer "aceita tudo": a guarda `IS NOT NULL`
-- não troca isso por uma lista. Os ESPELHOS em TS: `MIMES_DO_CHAT_MEDIA`
-- (pino `tipos-do-chat-media.test.ts`, que lê esta lista); a de ENVIO
-- (`MIMES_POR_TIPO`, `arquivo-solto.ts`) não muda — a Meta não aceita estes
-- tipos na saída.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo sobe com
-- `application/octet-stream`; sem esta migration, o Storage recusa e o anexo
-- se perde como hoje. O app antigo não manda os tipos novos. Idempotente.
-- ============================================================

UPDATE storage.buckets
SET allowed_mime_types = allowed_mime_types || ARRAY(
  SELECT t
  FROM unnest(ARRAY[
    'application/octet-stream',
    'image/jpg', 'image/bmp', 'image/avif', 'image/heic', 'image/heif',
    'audio/mp3', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm',
    'audio/flac', 'audio/x-flac',
    'video/webm'
  ]::text[]) WITH ORDINALITY AS novo(t, ordem)
  WHERE NOT (t = ANY (allowed_mime_types))
  ORDER BY ordem
)
WHERE id = 'chat-media'
  AND allowed_mime_types IS NOT NULL;

-- ------------------------------------------------------------
-- Conferência: a lista tem os tipos de antes E os novos (nada saiu, nada
-- virou "aceita tudo" por engano). Sem o bucket (banco sem a 023), nada a
-- conferir.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_mimes text[];
BEGIN
  SELECT allowed_mime_types INTO v_mimes FROM storage.buckets WHERE id = 'chat-media';
  IF NOT FOUND THEN
    RAISE NOTICE '1115: bucket chat-media ausente, nada a conferir.';
  ELSIF v_mimes IS NULL THEN
    RAISE NOTICE '1115: chat-media aceita todo tipo (lista nula), nada a acrescentar.';
  ELSIF NOT (v_mimes @> ARRAY[
    'application/pdf', 'text/html', 'audio/ogg', 'image/jpeg', 'video/mp4',
    'application/octet-stream', 'image/heic', 'audio/mp3', 'audio/x-m4a',
    'audio/wav', 'video/webm'
  ]::text[]) THEN
    RAISE EXCEPTION '1115: chat-media sem os tipos de antes ou sem os novos: %', v_mimes;
  ELSIF cardinality(v_mimes) <> cardinality(ARRAY(SELECT DISTINCT unnest(v_mimes))) THEN
    RAISE EXCEPTION '1115: chat-media com tipo repetido: %', v_mimes;
  END IF;
END $$;
