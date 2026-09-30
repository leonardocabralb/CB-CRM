-- ============================================================
-- 1072 — Atlas, Fase 2 (servidor): a leitura periódica das situações, o
-- AMBIENTE em todo vínculo, o vínculo automático e a recusa.
--
-- Plano: docs/PLANO-integracao-atlas.md, Fase 2. Decisões do operador
-- (30/09/2026): vínculo automático pelo link da conversa E pelo telefone
-- completo e único dos dois lados (`casou_por`); a leitura roda no laço
-- lento do agendador, num `after()` da rota `cb/asaas/cron`.
--
-- 1) `cb_atlas_config` ganha o estado da LEITURA: rodízio
--    (`last_sync_attempt_at`), cadeado (`sincronizando_desde`), a última
--    leitura sem erro (`last_sync_at`), até quando as mudanças foram lidas
--    (`situacoes_lidas_ate`), a varredura de mudanças em curso
--    (`mudancas_desde` + `mudancas_cursor` + `mudancas_iniciada_em`), a listagem completa
--    (`listagem_*`) e o erro da LEITURA (`sync_erro`), separado de
--    `last_error` — a permissão "Listar clientes" desligada não derruba a
--    conexão que o passo "Criar cliente" usa.
-- 2) `cb_atlas_clientes` ganha o AMBIENTE (`api_url`, nulo = o Atlas de
--    verdade): o preview contra o staging grava NESTE banco, e sem a coluna
--    a leitura de um ambiente escreveria por cima dos vínculos do outro. As
--    chaves 1:1 passam a valer POR AMBIENTE (NULLS NOT DISTINCT: nulo é um
--    ambiente, não "sem valor"). E mais: a data da mudança no Atlas
--    (`situacao_desde`, o `status_changed_at`), por que o vínculo automático
--    casou, quem ligou à mão, quando o CRM escreveu a situação no Atlas,
--    quando o cliente foi visto na lixeira do Atlas e em qual listagem
--    completa ele apareceu pela última vez (`visto_na_listagem_em`).
-- 3) `cb_atlas_recusas` — "esta ficha NÃO é este cliente do Atlas"
--    (desvinculado à mão): o vínculo automático e o passo não religam o par.
--    FECHADA ao navegador (sem policy): só as rotas leem.
--
-- ⚠️ Nenhum dado pessoal do Atlas entra aqui: o `list_clients` devolve nome,
-- telefone, CPF e o link da conversa; só o id, a situação, a data e o
-- `app_url` são gravados (o resto fica em memória, para o vínculo).
--
-- ADITIVA, e vai ANTES do deploy: as colunas são novas e anuláveis, as
-- chaves ganham uma coluna (ficam mais largas), o CHECK ganha um valor, e o
-- app da Fase 0 grava `api_url` nulo, que é o certo na produção. As duas
-- tabelas estavam vazias ao desenhar (30/09/2026). Idempotente. As
-- conferências usam só o catálogo (banco VAZIO no replay do CI).
-- ============================================================

-- A FK composta das recusas pega trava em `contacts`, que recebe escrita o tempo todo.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) a conexão: o estado da leitura
-- ------------------------------------------------------------
ALTER TABLE cb_atlas_config
  ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sincronizando_desde  timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_at         timestamptz,
  ADD COLUMN IF NOT EXISTS situacoes_lidas_ate  timestamptz,
  -- O `statusChangedSince` FIXO da varredura de mudanças em curso, e o
  -- `nextCursor` dela: uma mudança em massa com mais páginas que o teto do
  -- ciclo continua de onde parou, em vez de reler as mesmas páginas.
  ADD COLUMN IF NOT EXISTS mudancas_desde       timestamptz,
  ADD COLUMN IF NOT EXISTS mudancas_cursor      text,
  -- Quando essa varredura COMEÇOU: terminada, vira `situacoes_lidas_ate`
  -- (o início do último ciclo deixaria de reler quem ela pulou por ser recente).
  ADD COLUMN IF NOT EXISTS mudancas_iniciada_em timestamptz,
  ADD COLUMN IF NOT EXISTS listagem_completa_em timestamptz,
  ADD COLUMN IF NOT EXISTS listagem_iniciada_em timestamptz,
  ADD COLUMN IF NOT EXISTS listagem_cursor      text,
  ADD COLUMN IF NOT EXISTS sync_erro            text;

-- ------------------------------------------------------------
-- 2) o vínculo: ambiente, data da mudança, por que casou, quem ligou
-- ------------------------------------------------------------
ALTER TABLE cb_atlas_clientes
  ADD COLUMN IF NOT EXISTS api_url              text,
  ADD COLUMN IF NOT EXISTS situacao_desde       timestamptz,
  ADD COLUMN IF NOT EXISTS casou_por            text,
  ADD COLUMN IF NOT EXISTS vinculado_por        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS crm_escreveu_em      timestamptz,
  ADD COLUMN IF NOT EXISTS excluido_no_atlas_em timestamptz,
  ADD COLUMN IF NOT EXISTS visto_na_listagem_em timestamptz;

-- `automatica` = a leitura ligou sozinha (pelo link da conversa ou pelo telefone).
ALTER TABLE cb_atlas_clientes DROP CONSTRAINT IF EXISTS cb_atlas_clientes_origem_ck;
ALTER TABLE cb_atlas_clientes ADD CONSTRAINT cb_atlas_clientes_origem_ck
  CHECK (origem IN ('criada', 'reativada', 'encontrada', 'manual', 'automatica'));
-- Só o vínculo automático diz por que casou; a coluna existe para desfazer em lote.
ALTER TABLE cb_atlas_clientes DROP CONSTRAINT IF EXISTS cb_atlas_clientes_casou_por_ck;
ALTER TABLE cb_atlas_clientes ADD CONSTRAINT cb_atlas_clientes_casou_por_ck
  CHECK (casou_por IS NULL OR casou_por IN ('chat_link', 'telefone'));

-- O 1:1 passa a ser POR AMBIENTE (NULLS NOT DISTINCT, PG15+; já usado na 1049).
ALTER TABLE cb_atlas_clientes DROP CONSTRAINT IF EXISTS cb_atlas_clientes_cliente_key;
ALTER TABLE cb_atlas_clientes ADD CONSTRAINT cb_atlas_clientes_cliente_key
  UNIQUE NULLS NOT DISTINCT (account_id, api_url, atlas_client_id);
-- Uma ficha liga a UM cliente do Atlas por ambiente. Índice PARCIAL: as
-- órfãs (`contact_id` nulo, a ficha foi apagada) continuam convivendo.
ALTER TABLE cb_atlas_clientes DROP CONSTRAINT IF EXISTS cb_atlas_clientes_contato_key;
CREATE UNIQUE INDEX IF NOT EXISTS cb_atlas_clientes_contato_key
  ON cb_atlas_clientes (account_id, api_url, contact_id) NULLS NOT DISTINCT
  WHERE contact_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3) a recusa: "esta ficha NÃO é este cliente do Atlas"
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_atlas_recusas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- O ambiente do Atlas (nulo = o de verdade), como no vínculo.
  api_url         text,
  contact_id      uuid NOT NULL,
  atlas_client_id uuid NOT NULL,
  recusado_por    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_atlas_recusas_key UNIQUE NULLS NOT DISTINCT (account_id, api_url, contact_id, atlas_client_id)
);

-- Apagar a ficha leva a recusa junto (CASCADE): sem índice por `contact_id`, varre a tabela.
CREATE INDEX IF NOT EXISTS cb_atlas_recusas_contato_idx ON cb_atlas_recusas (contact_id);

-- O índice único que a FK composta exige já existe (1071).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx ON contacts (id, account_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_atlas_recusas_contato_fkey' AND conrelid = 'public.cb_atlas_recusas'::regclass
  ) THEN
    ALTER TABLE cb_atlas_recusas
      ADD CONSTRAINT cb_atlas_recusas_contato_fkey FOREIGN KEY (contact_id, account_id)
      REFERENCES contacts (id, account_id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE cb_atlas_recusas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_atlas_recusas FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_atlas_recusas TO service_role;

-- ============================================================
-- Conferências — SÓ CATÁLOGO, válidas num banco VAZIO (nenhuma exige dado).
-- ============================================================
DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'cb_atlas_clientes_origem_ck',
    'cb_atlas_clientes_casou_por_ck',
    'cb_atlas_clientes_cliente_key',
    'cb_atlas_recusas_key',
    'cb_atlas_recusas_contato_fkey'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      RAISE EXCEPTION '1072: restrição % ausente', c;
    END IF;
  END LOOP;

  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'cb_atlas_clientes_origem_ck')) NOT LIKE '%automatica%' THEN
    RAISE EXCEPTION '1072: o CHECK da origem não aceita automatica';
  END IF;

  -- As chaves 1:1 são POR AMBIENTE, com nulo contando como um ambiente.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_constraint k ON k.conindid = i.indexrelid
     WHERE k.conname = 'cb_atlas_clientes_cliente_key' AND i.indnullsnotdistinct
       AND pg_get_indexdef(i.indexrelid) LIKE '%(account_id, api_url, atlas_client_id)%'
  ) THEN
    RAISE EXCEPTION '1072: cb_atlas_clientes_cliente_key não é (account_id, api_url, atlas_client_id) NULLS NOT DISTINCT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cb_atlas_clientes_contato_key') THEN
    RAISE EXCEPTION '1072: a restrição antiga cb_atlas_clientes_contato_key (sem ambiente) continua de pé';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indexrelid = 'public.cb_atlas_clientes_contato_key'::regclass
       AND i.indisunique AND i.indnullsnotdistinct AND i.indpred IS NOT NULL
       AND pg_get_indexdef(i.indexrelid) LIKE '%(account_id, api_url, contact_id)%'
       AND pg_get_indexdef(i.indexrelid) LIKE '%WHERE (contact_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION '1072: cb_atlas_clientes_contato_key precisa ser único, parcial e NULLS NOT DISTINCT em (account_id, api_url, contact_id)';
  END IF;

  -- A recusa: fechada ao navegador, sem policy.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_atlas_recusas'::regclass) THEN
    RAISE EXCEPTION '1072: cb_atlas_recusas sem RLS ligada';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_atlas_recusas') THEN
    RAISE EXCEPTION '1072: cb_atlas_recusas não pode ter policy (só as rotas leem)';
  END IF;
  IF has_table_privilege('anon', 'public.cb_atlas_recusas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_recusas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_recusas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_recusas', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_atlas_recusas', 'DELETE') THEN
    RAISE EXCEPTION '1072: cb_atlas_recusas alcançável pelo navegador';
  END IF;

  -- O vínculo continua com UMA policy, a de leitura da 1071 (forma da 1032).
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_atlas_clientes') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cb_atlas_clientes'
          AND cmd = 'SELECT' AND qual LIKE '%cb_contas_do_usuario%'
     ) THEN
    RAISE EXCEPTION '1072: cb_atlas_clientes precisa continuar com UMA policy, de leitura, na forma da 1032';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.cb_atlas_recusas', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_recusas', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_recusas', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_clientes', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_clientes', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_clientes', 'DELETE') THEN
    RAISE EXCEPTION '1072: service_role sem acesso às tabelas do Atlas';
  END IF;
END $$;
