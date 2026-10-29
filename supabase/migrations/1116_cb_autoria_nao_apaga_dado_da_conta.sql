-- ============================================================
-- 1116 — Apagar o LOGIN de quem criou não apaga o que é da CONTA
--
-- Onze tabelas do upstream (0001, 0006, 0010, 0035) guardam em `user_id` o
-- login de quem criou a linha, `NOT NULL` com `ON DELETE CASCADE` para
-- `auth.users`. Apagar esse login (painel do Supabase ou admin API, o passo
-- normal de quem sai do escritório; `remove_account_member` só move o perfil)
-- apagava junto o que é do escritório:
--   · `pipelines` → as etapas e TODOS os negócios do funil (CASCADE de
--     `deals_pipeline_account_fkey` — a 908 tinha protegido só o
--     `deals.user_id`);
--   · `tags` → os vínculos com os contatos (`contact_tags`);
--   · `automations` → passos, registros, esperas, lembretes e favoritas;
--   · `flows` → os nós e as execuções do robô;
--   · `broadcasts` → os destinatários;
--   · `message_templates`, `quick_replies`, `whatsapp_config`;
--   · e os registros (`automation_logs`, `automation_pending_executions`,
--     `flow_runs`), que são de cada execução e não de quem a escreveu.
-- Quem grava é o login de quem clicou (o construtor, a tela de etiquetas, o
-- disparo…), então bastava um membro criar uma etiqueta para ela ficar presa
-- ao login dele. Medido na produção em 29/10/2026: nenhuma linha dessas era de
-- quem não é o dono da conta, salvo 3 respostas rápidas — o risco ainda não
-- tinha virado perda.
--
-- A saída é a da 908 para `deals.user_id` e a de toda coluna de autoria das
-- tabelas `cb_*`: a coluna vira anulável com `ON DELETE SET NULL`. A autoria
-- fica enquanto o login existe; apagado o login, a linha fica sem autor. Não
-- é o dono durável (CLAUDE.md, 8a): carimbar o dono perderia quem criou, e a
-- proteção dependeria de todo escritor lembrar dele. Nenhuma policy destas
-- tabelas lê `user_id` (conferido na produção) e nenhum envio o usa.
--
-- O CASCADE continua onde está certo: o dado da PESSOA (perfil, presença,
-- avisos, favoritas, filtros, ordem dos blocos, celular, disponibilidade,
-- conversa aberta) e o trio do dono durável (`contacts`, `conversations`,
-- `custom_fields`, sempre com `accounts.owner_user_id`, que é RESTRICT, e
-- transferido junto com a posse pela 971). O `verify-schema.sql` do CI cobra
-- essa lista: tabela NOVA com CASCADE para `auth.users` reprova o replay.
--
-- ⚠️ Só catálogo: nenhuma linha muda, nenhum gatilho dispara. Afrouxa
-- (anulável, SET NULL), então serve ao app de antes e ao de depois — aplicar
-- ANTES do merge. Cada ALTER troca a FK num comando só (o DROP roda antes do
-- ADD dentro do mesmo ALTER) e valida a FK nova lendo a tabela (a maior,
-- `automation_logs`, tinha 6,4 mil linhas). Ordem pai → filho
-- (`automation_logs` antes de `automation_pending_executions`, como trava
-- `cb_estacionar_espera`). As FKs nascem com o nome padrão, o da produção; a
-- conferência acha pelo CATÁLOGO, então um nome diferente numa instalação
-- reprova em vez de deixar o CASCADE de pé ao lado do SET NULL. Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.pipelines
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS pipelines_user_id_fkey,
  ADD CONSTRAINT pipelines_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tags
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS tags_user_id_fkey,
  ADD CONSTRAINT tags_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.automations
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS automations_user_id_fkey,
  ADD CONSTRAINT automations_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.automation_logs
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS automation_logs_user_id_fkey,
  ADD CONSTRAINT automation_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.automation_pending_executions
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS automation_pending_executions_user_id_fkey,
  ADD CONSTRAINT automation_pending_executions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.flows
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS flows_user_id_fkey,
  ADD CONSTRAINT flows_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.flow_runs
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS flow_runs_user_id_fkey,
  ADD CONSTRAINT flow_runs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.broadcasts
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS broadcasts_user_id_fkey,
  ADD CONSTRAINT broadcasts_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.message_templates
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS message_templates_user_id_fkey,
  ADD CONSTRAINT message_templates_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.quick_replies
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS quick_replies_user_id_fkey,
  ADD CONSTRAINT quick_replies_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.whatsapp_config
  ALTER COLUMN user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_fkey,
  ADD CONSTRAINT whatsapp_config_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Conferência (só catálogo; vale no banco vazio): em cada uma das onze,
-- `user_id` é anulável e a ÚNICA FK dele para `auth.users` é SET NULL.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tabela text;
  v_acoes text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY[
    'pipelines', 'tags', 'automations', 'automation_logs',
    'automation_pending_executions', 'flows', 'flow_runs', 'broadcasts',
    'message_templates', 'quick_replies', 'whatsapp_config'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = ('public.' || v_tabela)::regclass
         AND attname = 'user_id' AND attnotnull
    ) THEN
      RAISE EXCEPTION '1116: %.user_id continua NOT NULL', v_tabela;
    END IF;

    SELECT string_agg(c.confdeltype::text, ',' ORDER BY c.conname) INTO v_acoes
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.conrelid = ('public.' || v_tabela)::regclass
       AND c.confrelid = 'auth.users'::regclass
       AND a.attname = 'user_id';
    -- 'n' = SET NULL. Outra letra, ou duas FKs (um nome que não casou com o
    -- DROP), deixaria o CASCADE de pé.
    IF v_acoes IS DISTINCT FROM 'n' THEN
      RAISE EXCEPTION '1116: FK de %.user_id para auth.users = % (esperado só SET NULL, "n")',
        v_tabela, coalesce(v_acoes, 'nenhuma');
    END IF;
  END LOOP;
END $$;
