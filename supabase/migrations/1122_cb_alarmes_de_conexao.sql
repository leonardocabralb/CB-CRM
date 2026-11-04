-- ============================================================
-- 1122 — O estado dos alarmes de conexão no sino (Fase 2 dos alarmes).
--
-- O próprio CRM passa a avisar no sino (o tipo `whatsapp_alert` da 1085)
-- quando uma conexão envia e nada volta (os "envios sem recibo",
-- `src/lib/cb-channels/sem-recibo.ts`) ou recebe com 30 min ou mais de atraso
-- (a fronteira da 1002). Quem grava é um passo do laço lento do agendador
-- (`src/lib/cb-channels/avisar-alarmes.ts`, no `rodarManutencaoDoCiclo`),
-- com a service role. Plano e decisões: `docs/PLANO-alarmes-de-conexao.md`.
--
-- Esta tabela é o `estado.json` da sentinela da VPS, só que no banco: UM
-- aviso por episódio, lembrete a cada 24 h, "Normalizou" só com prova. Uma
-- linha por conexão e tipo enquanto o episódio dura; o "Normalizou" a apaga.
--   desde          começo do episódio, como a medição o viu
--   avisado_em     quando o sino recebeu o último aviso (nulo = ainda não)
--   normalizou_em  a prova do fim já veio e o aviso dela ainda não entrou
--   detalhe        a última medição (o atraso e quando foi medido)
--
-- ⚠️ Por que uma tabela própria, e não colunas em `cb_channels`: todo UPDATE
-- ali faz cada aba aberta refazer a sonda da saúde (realtime), e o
-- espaçamento de 1 min da 1002 existe por isso. Esta fica FORA da publicação.
--
-- ⚠️ FECHADA ao navegador: RLS ligada, nenhuma policy, nada para anon nem
-- authenticated. Só o servidor lê e escreve.
--
-- ⚠️ A conexão apagada leva o estado junto (FK composta, CASCADE): o que
-- deixou de ser vigiado sai em silêncio, como na sentinela.
--
-- ADITIVA: aplicar ANTES do deploy. Sem ela, o passo novo falha ao ler o
-- estado e não avisa nada (o passo é isolado: os outros do ciclo seguem).
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cb_alarmes_de_conexao (
  account_id    uuid NOT NULL,
  channel_id    uuid NOT NULL,
  tipo          text NOT NULL,
  desde         timestamptz NOT NULL,
  avisado_em    timestamptz,
  normalizou_em timestamptz,
  detalhe       jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cb_alarmes_de_conexao_pkey PRIMARY KEY (channel_id, tipo),
  CONSTRAINT cb_alarmes_de_conexao_tipo_check
    CHECK (tipo IN ('sem_recibo', 'atraso')),
  CONSTRAINT cb_alarmes_de_conexao_canal_fkey
    FOREIGN KEY (channel_id, account_id)
    REFERENCES public.cb_channels (id, account_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cb_alarmes_de_conexao IS
  'Estado dos alarmes de conexão no sino (1122): um aviso por episódio, lembrete a cada 24 h, "Normalizou" só com prova. Escrito só pelo passo do ciclo do agendador; fechado ao navegador.';
COMMENT ON COLUMN public.cb_alarmes_de_conexao.avisado_em IS
  'Quando o sino recebeu o último aviso do episódio (novo ou lembrete). Nulo = ainda não: o envio sem recibo fora do horário útil espera a abertura.';
COMMENT ON COLUMN public.cb_alarmes_de_conexao.normalizou_em IS
  'A prova do fim já veio, e o aviso dela ainda não entrou no sino: o próximo ciclo o manda mesmo sem medição nova.';

ALTER TABLE public.cb_alarmes_de_conexao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_alarmes_de_conexao FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cb_alarmes_de_conexao TO service_role;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_rls boolean;
  v_policies int;
  v_fk text;
BEGIN
  SELECT relrowsecurity INTO v_rls
    FROM pg_class
   WHERE oid = 'public.cb_alarmes_de_conexao'::regclass;
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION '1122: RLS desligada em cb_alarmes_de_conexao';
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cb_alarmes_de_conexao';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '1122: cb_alarmes_de_conexao tem % policy: ela é fechada ao navegador', v_policies;
  END IF;

  IF has_table_privilege('anon', 'public.cb_alarmes_de_conexao', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.cb_alarmes_de_conexao', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION '1122: anon ou authenticated alcançam cb_alarmes_de_conexao';
  END IF;

  IF NOT (has_table_privilege('service_role', 'public.cb_alarmes_de_conexao', 'SELECT')
          AND has_table_privilege('service_role', 'public.cb_alarmes_de_conexao', 'INSERT')
          AND has_table_privilege('service_role', 'public.cb_alarmes_de_conexao', 'UPDATE')
          AND has_table_privilege('service_role', 'public.cb_alarmes_de_conexao', 'DELETE')) THEN
    RAISE EXCEPTION '1122: service_role não lê ou não escreve em cb_alarmes_de_conexao';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_fk
    FROM pg_constraint
   WHERE conrelid = 'public.cb_alarmes_de_conexao'::regclass
     AND conname = 'cb_alarmes_de_conexao_canal_fkey';
  IF v_fk IS NULL OR v_fk NOT LIKE '%ON DELETE CASCADE%' THEN
    RAISE EXCEPTION '1122: a FK para cb_channels não apaga em cascata (def=%)', v_fk;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE schemaname = 'public' AND tablename = 'cb_alarmes_de_conexao') THEN
    RAISE EXCEPTION '1122: cb_alarmes_de_conexao entrou numa publicação: cada escrita viajaria pelo realtime';
  END IF;
END $$;
