-- ============================================================
-- 1057_cb_zapsign
--
-- Integração com o ZapSign (assinatura eletrônica), entrega 1: a conexão e
-- "contrato assinado move o card". O ZapSign avisa por webhook a cada
-- assinatura (`doc_signed`); o CRM RELÊ o documento com a própria chave, acha
-- o cliente e dispara o gatilho `zapsign_documento_assinado` das automações.
-- Três tabelas, as três FECHADAS ao navegador (RLS ligada, nenhuma policy,
-- REVOKE de `anon` e `authenticated`): a tela lê pela rota
-- `GET /api/cb/zapsign` (admin, service role).
--
-- 1) `cb_zapsign_config` — UMA linha por conta:
--    - `api_token`: o token da API do ZapSign, CIFRADO com `encrypt()` de
--      `src/lib/whatsapp/encryption.ts` (AES-256-GCM, `ENCRYPTION_KEY` —
--      rotacionar a chave invalida este token junto com os outros).
--    - `webhook_url_token`: o segmento da URL do webhook
--      (`/api/cb/zapsign/webhook/<token>`) que diz de QUAL conta é a entrega.
--      Em claro e ÚNICO: a rota o procura por igualdade.
--    - `webhook_secret`: a CREDENCIAL que o ZapSign devolve no cabeçalho
--      `Authorization` de cada entrega (informada por nós ao criar o
--      webhook; o ZapSign não assina com HMAC). Cifrada.
--    - `webhook_id`/`webhook_estado`: o webhook criado no ZapSign.
-- 2) `cb_zapsign_documentos` — um documento por conta. Nesta entrega nasce
--    quando uma assinatura é processada; o passo "Gerar contrato" (futuro)
--    vai inserir na CRIAÇÃO, com o negócio (`deal_id`), e é isso que torna o
--    casamento EXATO. `disparo_evento_id` é o cadeado do DISPARO: o ZapSign
--    manda `doc_signed` a cada signatário, e duas entregas que releem o
--    documento já completo não podem rodar a automação duas vezes.
-- 3) `cb_zapsign_eventos` — o log e a idempotência. `UNIQUE (account_id,
--    doc_token, event_type, signer_token)`: o ZapSign REPETE a entrega que
--    não recebeu 200, e a cópia é descartada antes de disparar. O
--    `signer_token` é NOT NULL com DEFAULT '' para o UNIQUE ser TOTAL — só
--    índice total serve de alvo do `ON CONFLICT` (lição da 903).
--    `variaveis` guarda o que foi entregue ao motor, SEM CPF.
--
-- ⚠️ `deal_id` e `contact_id` com FK COMPOSTA `(…, account_id)` e
-- `ON DELETE SET NULL (coluna)`: a ingestão roda em service role e ignora a
-- RLS, e a FK simples só garante "existe uma linha com esse id" — em qualquer
-- conta. Apagar o contato ou o card não apaga o registro de que o contrato
-- foi assinado.
--
-- ADITIVA: aplicar ANTES do deploy (as rotas leem estas tabelas). O app
-- anterior não lê nada disto. Idempotente; aplica em banco vazio.
-- ============================================================

-- As FKs pegam trava SHARE ROW EXCLUSIVE em `contacts` e `deals`, que
-- recebem escrita o tempo todo: sem teto de espera, uma transação longa
-- enfileiraria a ingestão atrás desta migration.
SET LOCAL lock_timeout = '5s';

-- A FK composta exige um índice único na referência. O de `contacts` já
-- existe (0944/0987/0994); o de `deals` nasce aqui. `id` é a PK, então o
-- índice nunca é violado.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx ON contacts (id, account_id);
CREATE UNIQUE INDEX IF NOT EXISTS deals_id_account_idx ON deals (id, account_id);

-- ------------------------------------------------------------
-- 1) config
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_zapsign_config (
  account_id         uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  api_token          text NOT NULL,
  webhook_url_token  text NOT NULL UNIQUE,
  webhook_secret     text NOT NULL,
  webhook_id         text,
  -- 'ativo' = criado no ZapSign; 'ausente' = ainda não criado (a conexão foi
  -- feita fora do endereço público, ou o webhook foi apagado); 'erro' = o
  -- ZapSign recusou a criação (o motivo fica em `last_error`).
  webhook_estado     text NOT NULL DEFAULT 'ausente'
                     CONSTRAINT cb_zapsign_config_webhook_estado_ck
                     CHECK (webhook_estado IN ('ativo', 'ausente', 'erro')),
  plano              text,
  status             text NOT NULL DEFAULT 'conectado'
                     CONSTRAINT cb_zapsign_config_status_ck
                     CHECK (status IN ('conectado', 'erro')),
  last_error         text,
  last_event_at      timestamptz,
  conectado_em       timestamptz NOT NULL DEFAULT now(),
  conferido_em       timestamptz,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cb_zapsign_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_zapsign_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_zapsign_config TO service_role;

-- ------------------------------------------------------------
-- 2) eventos recebidos (o log e a idempotência)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_zapsign_eventos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  doc_token        text NOT NULL,
  event_type       text NOT NULL,
  -- Quem assinou nesta entrega (`signer_who_signed.token`). '' quando o aviso
  -- não traz: NOT NULL para o UNIQUE abaixo ser total.
  signer_token     text NOT NULL DEFAULT '',
  documento_nome   text,
  signatario_nome  text,
  resultado        text NOT NULL DEFAULT 'recebido'
                   CONSTRAINT cb_zapsign_eventos_resultado_ck
                   CHECK (resultado IN (
                     'recebido', 'disparado', 'em_espera', 'sem_contato',
                     'sem_automacao', 'falhou', 'ignorado', 'incompleto'
                   )),
  casado_por       text
                   CONSTRAINT cb_zapsign_eventos_casado_por_ck
                   CHECK (casado_por IS NULL OR casado_por IN (
                     'external_id', 'documento', 'telefone', 'email', 'cpf'
                   )),
  contact_id       uuid,
  deal_id          uuid,
  detalhe          text,
  variaveis        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- O CADEADO do processamento (o gêmeo do `cb_calendly_eventos`, 980): quem
  -- conseguiu escrever aqui é o dono; toda escrita posterior leva o valor
  -- como cerca de posse.
  processando_desde timestamptz,
  recebido_em      timestamptz NOT NULL DEFAULT now(),
  processado_em    timestamptz,
  CONSTRAINT cb_zapsign_eventos_entrega_key UNIQUE (account_id, doc_token, event_type, signer_token)
);

CREATE INDEX IF NOT EXISTS cb_zapsign_eventos_conta_idx
  ON cb_zapsign_eventos (account_id, recebido_em DESC);
-- Apagar contato ou card faz SET NULL aqui: sem índice, cada linha apagada
-- varreria a tabela inteira.
CREATE INDEX IF NOT EXISTS cb_zapsign_eventos_contato_idx
  ON cb_zapsign_eventos (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_zapsign_eventos_negocio_idx
  ON cb_zapsign_eventos (deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE cb_zapsign_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_zapsign_eventos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_zapsign_eventos TO service_role;

-- ------------------------------------------------------------
-- 3) documentos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_zapsign_documentos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  doc_token         text NOT NULL,
  deal_id           uuid,
  contact_id        uuid,
  nome              text,
  -- Como o ZapSign o diz (`pending` | `signed`, hoje). Sem CHECK: um status
  -- novo do ZapSign não pode derrubar a gravação do documento.
  status            text,
  assinado_em       timestamptz,
  -- A entrega que DISPAROU as automações deste documento. Escrita por
  -- `UPDATE … WHERE disparo_evento_id IS NULL`: é o que impede duas
  -- assinaturas quase simultâneas de rodarem a automação duas vezes.
  disparo_evento_id uuid REFERENCES cb_zapsign_eventos(id) ON DELETE SET NULL,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_zapsign_documentos_doc_key UNIQUE (account_id, doc_token)
);

CREATE INDEX IF NOT EXISTS cb_zapsign_documentos_contato_idx
  ON cb_zapsign_documentos (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_zapsign_documentos_negocio_idx
  ON cb_zapsign_documentos (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_zapsign_documentos_disparo_idx
  ON cb_zapsign_documentos (disparo_evento_id) WHERE disparo_evento_id IS NOT NULL;

ALTER TABLE cb_zapsign_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_zapsign_documentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_zapsign_documentos TO service_role;

-- ------------------------------------------------------------
-- 4) FKs compostas (idempotentes)
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cb_zapsign_eventos', 'cb_zapsign_documentos'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_contato_fkey' AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (contact_id, account_id) '
        'REFERENCES contacts (id, account_id) ON DELETE SET NULL (contact_id)',
        t, t || '_contato_fkey'
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_negocio_fkey' AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (deal_id, account_id) '
        'REFERENCES deals (id, account_id) ON DELETE SET NULL (deal_id)',
        t, t || '_negocio_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- Conferências — SÓ CATÁLOGO, válidas num banco VAZIO (nenhuma exige dado).
-- ============================================================
DO $$
DECLARE
  t text;
  c text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cb_zapsign_config', 'cb_zapsign_eventos', 'cb_zapsign_documentos'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE EXCEPTION '1057: tabela % ausente', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION '1057: % sem RLS ligada', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '1057: anon ainda alcança %', t;
    END IF;
    -- Fechadas para o membro: nem SELECT. O token cifrado, a credencial do
    -- webhook e o log (nome e telefone de quem assinou) passam pela rota.
    IF has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION '1057: authenticated alcança % — tudo passa pela rota', t;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || t, 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.' || t, 'UPDATE') THEN
      RAISE EXCEPTION '1057: service_role sem acesso a %', t;
    END IF;
  END LOOP;

  FOREACH c IN ARRAY ARRAY[
    'cb_zapsign_eventos_entrega_key',
    'cb_zapsign_documentos_doc_key',
    'cb_zapsign_eventos_contato_fkey',
    'cb_zapsign_eventos_negocio_fkey',
    'cb_zapsign_documentos_contato_fkey',
    'cb_zapsign_documentos_negocio_fkey'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      RAISE EXCEPTION '1057: restrição % ausente', c;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.cb_zapsign_config'::regclass AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '1057: webhook_url_token sem UNIQUE — duas contas com o mesmo token na URL';
  END IF;
END $$;
