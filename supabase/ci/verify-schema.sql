-- Post-migration assertions for the `migrations` job in
-- `.github/workflows/pipeline.yml`. (O `migrations.yml` que este cabeçalho
-- citava era do upstream e foi removido no merge de 2026-08-26.)
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- ⚠️ Disparo e regras são de ADMIN (964) — e a checagem é pelo CONJUNTO.
  --
  -- A conferência DENTRO da 964 pega policy RENOMEADA (conta os 12 nomes
  -- esperados) e policy AFROUXADA (procura 'agent' nas 12). O que ela não
  -- pega é policy ADICIONADA — e em Postgres policies permissivas são
  -- combinadas com OU, então UMA a mais reabre o furo inteiro com as 12
  -- originais intactas e a migration imprimindo "OK".
  --
  -- O caso real: um merge do upstream reintroduzindo a
  -- "Users can manage own broadcasts" (001, `FOR ALL USING auth.uid() =
  -- user_id`). A 017 a derrubou; um merge futuro a traz de volta.
  --
  -- Aqui a pergunta é outra: existe ALGUMA policy de escrita nessas seis
  -- tabelas fora das 12? Se existir, o nome dela sai na mensagem.
  DECLARE
    v_intrusas TEXT;
  BEGIN
    SELECT string_agg(format('%s.%s', tablename, policyname), ', ' ORDER BY tablename, policyname)
    INTO v_intrusas
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'automations', 'automation_steps', 'flows',
        'flow_nodes', 'broadcasts', 'broadcast_recipients'
      )
      AND cmd <> 'SELECT'
      AND policyname NOT IN (
        'automations_insert', 'automations_update', 'automations_delete',
        'automation_steps_modify',
        'flows_insert', 'flows_update', 'flows_delete',
        'flow_nodes_modify',
        'broadcasts_insert', 'broadcasts_update', 'broadcasts_delete',
        'broadcast_recipients_modify'
      );
    IF v_intrusas IS NOT NULL THEN
      RAISE EXCEPTION
        'policy de escrita inesperada em tabela de disparo/regras: % — policies permissivas se somam com OU, então esta reabre o acesso que a 964 fechou',
        v_intrusas;
    END IF;
  END;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
