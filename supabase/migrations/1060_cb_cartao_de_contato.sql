-- ============================================================
-- 1060_cb_cartao_de_contato
--
-- O cartão de contato que o cliente compartilha no WhatsApp passa a aparecer
-- no fio da conversa. Até aqui o CRM não conhecia o tipo e gravava uma bolha
-- VAZIA: medido em 28/09/2026, 24 cartões perdidos em setembro, 23 deles de
-- clientes (o vCard continuava inteiro na Evolution).
--
-- Três mudanças:
--   1. `messages.content_type` aceita 'contact'. O CHECK é do upstream (0001),
--      estendido pela 0010, 0906 e 1044; aditivo, nenhum valor sai.
--      ⚠️ Um merge do upstream que recrie o CHECK tira o 'contact' (e o
--      'call') — e o cartão passa a ser recusado com 23514, a mensagem se
--      perde sem aviso na tela (a Evolution já recebeu 200).
--   2. `messages.contatos` (jsonb): o que a bolha desenha —
--      `[{nome, empresa, telefones: [{numero, waid}]}]`. Nulo em toda outra
--      mensagem. `content_text` leva o resumo (`👤 Nome · +55 …`) para a
--      prévia, a busca (929), o Radar e a API.
--   3. O bucket `chat-media` aceita `text/html`. Medido no mesmo dia: os 6
--      documentos que o celular do escritório mandou e o CRM não guardou em
--      14 dias eram todos .html, recusados pela lista de tipos do bucket.
--      Decisão do operador (28/09/2026): passar a guardar. A bolha e a aba
--      Arquivos oferecem o .html para BAIXAR, nunca para abrir no navegador
--      a partir do armazenamento (`?download=`).
--
-- ADITIVA: aplicar ANTES do deploy — o código novo grava o tipo e a coluna,
-- e sem eles o INSERT do cartão leva 23514/42703 e o cartão some. O app
-- anterior não lê nada disto (o cartão seguia vazio).
--
-- Idempotente; aplica em banco vazio.
-- ============================================================

-- `messages` recebe escrita a toda mensagem: sem teto de espera, uma
-- transação longa enfileiraria a ingestão atrás desta trava.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) messages.content_type aceita 'contact'
--
-- ⚠️ O ADD CONSTRAINT validado VARRE `messages` com a trava exclusiva presa
-- (o DROP a pegou). Aceito pelo tamanho, como na 1044: ~90 mil linhas em
-- 28/09/2026, milissegundos. Numa tabela maior, o caminho é `NOT VALID` aqui
-- e `VALIDATE CONSTRAINT` numa transação separada.
-- ------------------------------------------------------------
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'system', 'call', 'contact'
  ));

-- ------------------------------------------------------------
-- 2) messages.contatos
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS contatos jsonb;

COMMENT ON COLUMN messages.contatos IS
  'Só em content_type=contact (1060): [{nome, empresa, telefones: [{numero, waid}]}]. A bolha desenha o cartão a partir disto; content_text leva o resumo.';

-- ------------------------------------------------------------
-- 3) chat-media aceita text/html
--
-- `array_append` sobre a lista que já está lá, e não o upsert inteiro da 023/
-- 042: aquele reescreveria também o `file_size_limit` (a 986 o subiu para 50
-- MiB) e a lista inteira. ⚠️ `allowed_mime_types` NULO quer dizer "aceita
-- tudo" — `array_append(NULL, …)` o trocaria por "aceita SÓ html". Daí a
-- guarda.
-- ------------------------------------------------------------
UPDATE storage.buckets
SET allowed_mime_types = array_append(allowed_mime_types, 'text/html')
WHERE id = 'chat-media'
  AND allowed_mime_types IS NOT NULL
  AND NOT ('text/html' = ANY (allowed_mime_types));

-- ============================================================
-- Conferência — SÓ CATÁLOGO e a linha do bucket. Depois da primeira ALTER em
-- `messages` a transação segura a trava exclusiva da tabela mais quente do
-- banco até o fim: nada aqui lê nem escreve linha de `messages` (regra da
-- 1032). A prova de que o cartão entra e os gatilhos de `messages` o aceitam
-- é o teste ponta a ponta no preview, com a migration aplicada.
-- ============================================================
DO $$
DECLARE
  v_def    text;
  v_checks int;
  v_mimes  text[];
BEGIN
  -- 1. UM CHECK de tipo em messages, validado, com o 'contact' e os de antes.
  --    Um segundo CHECK sobre content_type (de outro nome, vindo de um merge)
  --    continuaria recusando o cartão com 23514, e este acima passaria verde.
  SELECT count(*) INTO v_checks
  FROM pg_constraint
  WHERE conrelid = 'public.messages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ '\mcontent_type\M';
  IF v_checks <> 1 THEN
    RAISE EXCEPTION '1060: esperava UM CHECK sobre messages.content_type, achou %', v_checks;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.messages'::regclass
    AND conname = 'messages_content_type_check'
    AND convalidated;
  IF v_def IS NULL
     OR v_def !~ '''contact'''
     OR v_def !~ '''call'''
     OR v_def !~ '''system'''
     OR v_def !~ '''interactive''' THEN
    RAISE EXCEPTION '1060: messages_content_type_check ausente, não validado ou sem os tipos: %', v_def;
  END IF;

  -- 2. A coluna nova, em jsonb.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name = 'contatos' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION '1060: messages.contatos não existe como jsonb';
  END IF;

  -- 3. O bucket aceita html — e continua com a lista (não virou "aceita tudo"
  --    nem "aceita só html"). Sem o bucket (banco sem a 023), nada a conferir.
  SELECT allowed_mime_types INTO v_mimes FROM storage.buckets WHERE id = 'chat-media';
  IF FOUND THEN
    IF v_mimes IS NOT NULL
       AND NOT ('text/html' = ANY (v_mimes) AND 'application/pdf' = ANY (v_mimes)) THEN
      RAISE EXCEPTION '1060: chat-media sem text/html ou sem os tipos de antes: %', v_mimes;
    END IF;
  ELSE
    RAISE NOTICE '1060: bucket chat-media ausente, nada a conferir.';
  END IF;
END $$;
