-- ============================================================
-- 1044_cb_ligacoes
--
-- Ligações de WhatsApp no fio da conversa (`docs/PLANO-ligacoes-do-whatsapp.md`).
-- A Evolution avisa cada ligação por webhook (evento CALL): começou a tocar
-- (`offer`), um aparelho do escritório atendeu (`accept`), terminou
-- (`terminate`/`timeout`/`reject`). São avisos SEPARADOS, que chegam em POSTs
-- separados e podem chegar fora de ordem; o CRM os junta numa linha de
-- `cb_ligacoes` e, quando o desfecho é conhecido (perdida ou atendida no
-- celular), grava UMA mensagem `content_type = 'call'` na conversa.
--
-- Três mudanças:
--   1. `cb_ligacoes`: uma linha por ligação (conta + `call_id`). FECHADA ao
--      navegador — a tela lê a mensagem, nunca esta tabela.
--   2. `messages.content_type` aceita 'call'. O CHECK é do upstream (0001),
--      estendido pela 0010 e pela 0906; aditivo, nenhum valor sai.
--      ⚠️ Um merge do upstream que recrie o CHECK tira o 'call' — e a
--      ligação passa a ser recusada com 23514, sem aviso na tela.
--   3. `messages.ligacao` (jsonb): o que a bolha mostra — vídeo ou voz, a hora
--      em que começou a tocar e quanto tocou. Nulo em toda outra mensagem.
--
-- ⚠️ 1044, e não 1042: a 1042 e a 1043 estão reservadas pelos PRs #294/#295
-- (agentes de IA), abertos quando esta nasceu.
--
-- ADITIVA: aplicar ANTES do deploy — o código novo grava o tipo e a coluna, e
-- sem eles o INSERT da bolha leva 23514/42703 e a ligação some (a Evolution já
-- recebeu 200). O app anterior não lê nada disto.
--
-- Idempotente; aplica em banco vazio.
-- ============================================================

-- `messages` recebe escrita a toda mensagem: sem teto de espera, uma
-- transação longa enfileiraria a ingestão atrás desta trava.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) cb_ligacoes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_ligacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- A conexão que recebeu a ligação. FK composta (abaixo), como em `deals`.
  channel_id uuid,
  -- O id da chamada no WhatsApp (`call-id`): o mesmo em todos os avisos.
  call_id text NOT NULL,
  -- Quem ligou, como o `offer` trouxe: quase sempre um LID (`…@lid`).
  quem_ligou text,
  -- O `callerPn` da Baileys (≥ 7.0.0-rc13): o telefone de quem ligou, quando o
  -- WhatsApp manda. Guardado CRU; a conferência é do código.
  telefone_informado text,
  video boolean NOT NULL DEFAULT false,
  -- Relógio do WhatsApp (o `date` de cada aviso).
  oferta_em timestamptz,
  atendida_em timestamptz,
  encerrada_em timestamptz,
  encerramento text,
  -- Relógio do CRM: quando o aviso de fim foi gravado. É dele que se conta a
  -- folga antes de concluir "perdida" — o "atendida" do mesmo segundo pode
  -- estar noutro POST, ainda a caminho.
  encerramento_gravado_em timestamptz,
  desfecho text,
  desfecho_em timestamptz,
  -- Os dígitos de quem ligou, depois de resolvidos.
  telefone text,
  detalhe text,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  -- TOTAL, não parcial: é o alvo do `ON CONFLICT` do upsert (lição da 903).
  CONSTRAINT cb_ligacoes_conta_chamada_key UNIQUE (account_id, call_id),
  CONSTRAINT cb_ligacoes_encerramento_ck
    CHECK (encerramento IS NULL OR encerramento IN ('terminate', 'timeout', 'reject')),
  CONSTRAINT cb_ligacoes_desfecho_ck
    CHECK (desfecho IS NULL OR desfecho IN (
      'perdida', 'atendida', 'sem_telefone', 'do_escritorio', 'falhou'
    ))
);

COMMENT ON TABLE cb_ligacoes IS
  'Ligações de WhatsApp recebidas pelas conexões por QR Code (1044): os avisos do evento CALL da Evolution juntados por call_id, e o desfecho. A bolha no fio é a mensagem content_type=call apontada por message_id.';

-- A conexão é da MESMA conta (a ingestão roda em service role e ignora RLS).
-- Apagar a conexão preserva o registro, sem o canal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_ligacoes_channel_fkey' AND conrelid = 'public.cb_ligacoes'::regclass
  ) THEN
    ALTER TABLE cb_ligacoes
      ADD CONSTRAINT cb_ligacoes_channel_fkey
      FOREIGN KEY (channel_id, account_id)
      REFERENCES cb_channels (id, account_id)
      ON DELETE SET NULL (channel_id);
  END IF;
END $$;

-- Apagar conversa ou mensagem faz SET NULL aqui: sem índice, cada linha
-- apagada varreria a tabela inteira.
CREATE INDEX IF NOT EXISTS cb_ligacoes_conversa_idx
  ON cb_ligacoes (conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_ligacoes_mensagem_idx
  ON cb_ligacoes (message_id) WHERE message_id IS NOT NULL;

ALTER TABLE cb_ligacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_ligacoes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_ligacoes TO service_role;

-- ------------------------------------------------------------
-- 2) messages.content_type aceita 'call'
-- ------------------------------------------------------------
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'system', 'call'
  ));

-- ------------------------------------------------------------
-- 3) messages.ligacao
-- ------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ligacao jsonb;

COMMENT ON COLUMN messages.ligacao IS
  'Só em content_type=call (1044): {desfecho, video, inicio, fim, tocou_seg, encerramento}. A bolha escreve a frase a partir disto; content_text fica nulo.';

-- ============================================================
-- Conferência — afirma ausência, deriva o dado, nunca exige linha.
-- ============================================================
DO $$
DECLARE
  v_def  text;
  v_conv uuid;
BEGIN
  -- 1. UM CHECK de tipo em messages, validado, com o 'call' e os de antes.
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.messages'::regclass
    AND conname = 'messages_content_type_check'
    AND convalidated;
  IF v_def IS NULL OR v_def !~ '''call''' OR v_def !~ '''system''' OR v_def !~ '''interactive''' THEN
    RAISE EXCEPTION '1044: messages_content_type_check ausente, não validado ou sem os tipos: %', v_def;
  END IF;

  -- 2. A coluna nova, em jsonb.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name = 'ligacao' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION '1044: messages.ligacao não existe como jsonb';
  END IF;

  -- 3. A tabela fechada ao navegador, aberta ao servidor.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_ligacoes'::regclass) THEN
    RAISE EXCEPTION '1044: cb_ligacoes sem RLS';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ligacoes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ligacoes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ligacoes', 'INSERT') THEN
    RAISE EXCEPTION '1044: cb_ligacoes aberta ao navegador';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_ligacoes', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_ligacoes', 'UPDATE') THEN
    RAISE EXCEPTION '1044: service_role sem escrita em cb_ligacoes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_ligacoes') THEN
    RAISE EXCEPTION '1044: cb_ligacoes não pode ter policy (a tela não lê esta tabela)';
  END IF;

  -- 4. A FK composta da conexão, com o SET NULL só do canal.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_ligacoes_channel_fkey'
      AND conrelid = 'public.cb_ligacoes'::regclass
      AND pg_get_constraintdef(oid) ~ 'ON DELETE SET NULL \(channel_id\)'
  ) THEN
    RAISE EXCEPTION '1044: cb_ligacoes_channel_fkey ausente ou sem o SET NULL (channel_id)';
  END IF;

  -- 5. Na prática: uma bolha de ligação entra numa conversa real e os gatilhos
  --    de `messages` a aceitam. Num subbloco DESFEITO pelo SQLSTATE próprio.
  SELECT id INTO v_conv FROM conversations WHERE group_id IS NULL LIMIT 1;
  IF v_conv IS NULL THEN
    RAISE NOTICE '1044: banco sem conversa, a bolha na prática fica para o descartável.';
  ELSE
    BEGIN
      INSERT INTO messages (
        conversation_id, sender_type, content_type, content_text,
        message_id, from_me, status, ligacao
      ) VALUES (
        v_conv, 'customer', 'call', NULL,
        'call:1044-conferencia', false, 'delivered',
        jsonb_build_object('desfecho', 'perdida', 'video', false)
      );
      RAISE EXCEPTION USING ERRCODE = 'P1044', MESSAGE = 'desfaz a conferência';
    EXCEPTION
      -- ⚠️ Só o SQLSTATE próprio: `WHEN OTHERS` engoliria justamente o erro
      -- que a prova existe para mostrar.
      WHEN SQLSTATE 'P1044' THEN
        RAISE NOTICE '1044: a bolha de ligação entra e os gatilhos a aceitam (desfeito).';
    END;
  END IF;
END $$;
