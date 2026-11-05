-- ============================================================
-- 1123 — Os alarmes de conexão ABERTOS da sentinela da VPS (Fase 4 dos
-- alarmes de conexão, E1).
--
-- A sentinela (`ops/vps/saude-whatsapp/sentinela.py`, `docs/INFRA-VPS.md`
-- §12) avisa no sino. O operador decidiu (05/11/2026) que os alarmes de UMA
-- conexão dela aparecem também no botão das conexões do cabeçalho, como os do
-- próprio CRM (1122). Ela grava aqui, a cada execução (de hora em hora), os
-- que estão abertos, e apaga os que fecharam; a sonda da saúde
-- (`src/lib/cb-channels/health.ts`) lê com a service role, cercada pela conta.
--   chave     o tipo do alarme, o prefixo da chave da sentinela sem a
--             instância. O `conexao:` fica de fora: a sonda do CRM vê a
--             conexão fora do ar ao vivo, pela mesma Evolution.
--   desde     quando a sentinela o viu pela primeira vez
--   visto_em  a última execução que o confirmou aberto. A sonda ignora a linha
--             velha (3 h): a sentinela parada, ou a VPS fora do ar, não deixa
--             alarme preso no botão.
--
-- ⚠️ Só existe NA NOSSA VPS: em qualquer outra instalação a tabela fica vazia
-- e nada muda.
--
-- ⚠️ FECHADA ao navegador: RLS ligada, nenhuma policy, nada para anon nem
-- authenticated. Só o servidor (a sonda) e a sentinela, com a service role.
--
-- ⚠️ A conexão apagada leva a linha junto (FK composta, CASCADE).
--
-- ⚠️ Fora da publicação do realtime: a sonda pergunta a cada 30 s.
--
-- ADITIVA: aplicar ANTES do deploy e antes de instalar a sentinela nova. Sem
-- ela, a sonda lê "não sei" (o botão fica com o resto) e a sentinela registra
-- a falha no log e segue.
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cb_alarmes_da_sentinela (
  account_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  chave      text NOT NULL,
  desde      timestamptz NOT NULL,
  visto_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_alarmes_da_sentinela_pkey PRIMARY KEY (channel_id, chave),
  CONSTRAINT cb_alarmes_da_sentinela_chave_check
    CHECK (chave IN ('sem_entrada', 'nao_gravadas', 'falhas', 'quedas')),
  CONSTRAINT cb_alarmes_da_sentinela_canal_fkey
    FOREIGN KEY (channel_id, account_id)
    REFERENCES public.cb_channels (id, account_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.cb_alarmes_da_sentinela IS
  'Alarmes de conexão abertos da sentinela da VPS (1123), para o botão das conexões do cabeçalho. Gravados pela sentinela a cada execução; a sonda da saúde ignora a linha não confirmada há mais de 3 h. Fechada ao navegador.';
COMMENT ON COLUMN public.cb_alarmes_da_sentinela.visto_em IS
  'A última execução da sentinela que confirmou o alarme aberto. Linha velha (sentinela parada, VPS fora) não vale.';

ALTER TABLE public.cb_alarmes_da_sentinela ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_alarmes_da_sentinela FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cb_alarmes_da_sentinela TO service_role;

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
   WHERE oid = 'public.cb_alarmes_da_sentinela'::regclass;
  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION '1123: RLS desligada em cb_alarmes_da_sentinela';
  END IF;

  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'cb_alarmes_da_sentinela';
  IF v_policies <> 0 THEN
    RAISE EXCEPTION '1123: cb_alarmes_da_sentinela tem % policy: ela é fechada ao navegador', v_policies;
  END IF;

  IF has_table_privilege('anon', 'public.cb_alarmes_da_sentinela', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.cb_alarmes_da_sentinela', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION '1123: anon ou authenticated alcançam cb_alarmes_da_sentinela';
  END IF;

  IF NOT (has_table_privilege('service_role', 'public.cb_alarmes_da_sentinela', 'SELECT')
          AND has_table_privilege('service_role', 'public.cb_alarmes_da_sentinela', 'INSERT')
          AND has_table_privilege('service_role', 'public.cb_alarmes_da_sentinela', 'UPDATE')
          AND has_table_privilege('service_role', 'public.cb_alarmes_da_sentinela', 'DELETE')) THEN
    RAISE EXCEPTION '1123: service_role não lê nem grava cb_alarmes_da_sentinela';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_fk
    FROM pg_constraint
   WHERE conrelid = 'public.cb_alarmes_da_sentinela'::regclass
     AND conname = 'cb_alarmes_da_sentinela_canal_fkey';
  IF v_fk IS NULL OR v_fk NOT LIKE '%ON DELETE CASCADE%' THEN
    RAISE EXCEPTION '1123: a FK para cb_channels não apaga em cascata (def=%)', v_fk;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE schemaname = 'public' AND tablename = 'cb_alarmes_da_sentinela') THEN
    RAISE EXCEPTION '1123: cb_alarmes_da_sentinela entrou numa publicação: cada escrita viajaria pelo realtime';
  END IF;
END $$;
