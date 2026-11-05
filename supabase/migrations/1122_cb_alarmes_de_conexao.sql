-- ============================================================
-- 1122 — O estado dos alarmes de conexão no sino (Fase 2 dos alarmes).
--
-- O próprio CRM passa a avisar no sino (o tipo `whatsapp_alert` da 1085)
-- quando uma conexão envia e nada volta (os "envios sem recibo",
-- `src/lib/cb-channels/sem-recibo.ts`) ou fica 30 min recebendo com atraso
-- (o âmbar da 1002). Quem grava é um passo do laço lento do agendador
-- (`src/lib/cb-channels/avisar-alarmes.ts`, no `rodarManutencaoDoCiclo`),
-- com a service role. Plano e decisões: `docs/PLANO-alarmes-de-conexao.md`.
--
-- A tabela é o `estado.json` da sentinela da VPS, só que no banco: UM aviso
-- por episódio, lembrete a cada 24 h, "Normalizou" só com prova. Uma linha
-- por conexão e tipo enquanto o episódio dura; o "Normalizou" a apaga.
--   desde          começo do episódio, como a medição o viu
--   avisado_em     quando o sino recebeu o último aviso (nulo = ainda não)
--   normalizou_em  a prova do fim já veio e o aviso dela ainda não entrou
--   devido_em      o aviso ficou devido e NÃO entrou (o sino recusou, ou não
--                  havia a quem avisar): só com ele o fim vira "Aconteceu e
--                  já normalizou"; sem ele, o episódio que nunca valeu aviso
--                  (o de madrugada, o de 10 min) sai calado
--   detalhe        a última medição (o atraso e quando foi medido)
--
-- ⚠️ A escrita do estado e o aviso vão JUNTOS, na mesma transação
-- (`cb_gravar_alarme_de_conexao`): a escrita cercada é a reivindicação (raiz,
-- 8e) e, se o aviso não entra, o estado também não muda. Em duas escritas, um
-- processo que morresse entre elas daria o episódio por avisado sem aviso.
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
  devido_em     timestamptz,
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
  'Estado dos alarmes de conexão no sino (1122): um aviso por episódio, lembrete a cada 24 h, "Normalizou" só com prova. Escrito só por cb_gravar_alarme_de_conexao, junto com o aviso; fechado ao navegador.';
COMMENT ON COLUMN public.cb_alarmes_de_conexao.avisado_em IS
  'Quando o sino recebeu o último aviso do episódio (novo ou lembrete). Nulo = ainda não: o envio sem recibo fora do horário útil espera a abertura.';
COMMENT ON COLUMN public.cb_alarmes_de_conexao.normalizou_em IS
  'A prova do fim já veio, e o aviso dela ainda não entrou no sino: o próximo ciclo o manda mesmo sem medição nova.';
COMMENT ON COLUMN public.cb_alarmes_de_conexao.devido_em IS
  'O aviso ficou devido e não entrou. Só com ele o fim de um episódio não avisado vira "Aconteceu e já normalizou"; sem ele, sai calado.';

ALTER TABLE public.cb_alarmes_de_conexao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_alarmes_de_conexao FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cb_alarmes_de_conexao TO service_role;

-- O que a função lê e grava, concedido aqui: em banco novo o service_role
-- não tem o privilégio padrão do Supabase (`.claude/rules/supabase.md`).
GRANT SELECT ON TABLE public.profiles TO service_role;
GRANT INSERT ON TABLE public.notifications TO service_role;

-- ------------------------------------------------------------
-- A escrita cercada do estado, com o aviso junto
-- ------------------------------------------------------------
-- p_de     o estado lido (NULL = não havia linha). A cerca é o avisado_em, o
--          normalizou_em e o devido_em dele.
-- p_para   o estado novo (NULL = a linha sai).
-- p_destinatarios / p_titulo / p_corpo: o aviso. Vai a quem, da lista, é
--          membro ATIVO da conta (conferido aqui, não só no app). Sem título,
--          só o estado muda.
-- Devolve true quando a escrita valeu (e o aviso entrou); false quando a
-- linha já não estava como `p_de` (outro escritor ganhou).
CREATE OR REPLACE FUNCTION public.cb_gravar_alarme_de_conexao(
  p_account_id uuid,
  p_channel_id uuid,
  p_tipo text,
  p_de jsonb,
  p_para jsonb,
  p_destinatarios jsonb DEFAULT '[]'::jsonb,
  p_titulo text DEFAULT NULL,
  p_corpo text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_linhas int;
BEGIN
  IF p_de IS NULL AND p_para IS NULL THEN
    RETURN true;
  END IF;

  IF p_de IS NULL THEN
    INSERT INTO public.cb_alarmes_de_conexao
      (account_id, channel_id, tipo, desde, avisado_em, normalizou_em, devido_em, detalhe)
    VALUES
      (p_account_id, p_channel_id, p_tipo,
       (p_para->>'desde')::timestamptz,
       (p_para->>'avisado_em')::timestamptz,
       (p_para->>'normalizou_em')::timestamptz,
       (p_para->>'devido_em')::timestamptz,
       coalesce(p_para->'detalhe', '{}'::jsonb))
    ON CONFLICT (channel_id, tipo) DO NOTHING;
  ELSIF p_para IS NULL THEN
    DELETE FROM public.cb_alarmes_de_conexao a
     WHERE a.account_id = p_account_id
       AND a.channel_id = p_channel_id
       AND a.tipo = p_tipo
       AND a.avisado_em    IS NOT DISTINCT FROM (p_de->>'avisado_em')::timestamptz
       AND a.normalizou_em IS NOT DISTINCT FROM (p_de->>'normalizou_em')::timestamptz
       AND a.devido_em     IS NOT DISTINCT FROM (p_de->>'devido_em')::timestamptz;
  ELSE
    UPDATE public.cb_alarmes_de_conexao a
       SET desde         = (p_para->>'desde')::timestamptz,
           avisado_em    = (p_para->>'avisado_em')::timestamptz,
           normalizou_em = (p_para->>'normalizou_em')::timestamptz,
           devido_em     = (p_para->>'devido_em')::timestamptz,
           detalhe       = coalesce(p_para->'detalhe', '{}'::jsonb)
     WHERE a.account_id = p_account_id
       AND a.channel_id = p_channel_id
       AND a.tipo = p_tipo
       AND a.avisado_em    IS NOT DISTINCT FROM (p_de->>'avisado_em')::timestamptz
       AND a.normalizou_em IS NOT DISTINCT FROM (p_de->>'normalizou_em')::timestamptz
       AND a.devido_em     IS NOT DISTINCT FROM (p_de->>'devido_em')::timestamptz;
  END IF;

  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  IF v_linhas <> 1 THEN
    RETURN false;
  END IF;

  IF p_titulo IS NOT NULL THEN
    INSERT INTO public.notifications (account_id, user_id, type, title, body)
    SELECT p_account_id, p.user_id, 'whatsapp_alert', p_titulo, p_corpo
      FROM public.profiles p
     WHERE p.account_id = p_account_id
       AND p.suspenso_em IS NULL
       AND p.user_id IN (
         SELECT d.valor::uuid
           FROM jsonb_array_elements_text(coalesce(p_destinatarios, '[]'::jsonb)) AS d(valor)
       );
  END IF;
  RETURN true;
END
$$;

REVOKE EXECUTE ON FUNCTION public.cb_gravar_alarme_de_conexao(uuid, uuid, text, jsonb, jsonb, jsonb, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_gravar_alarme_de_conexao(uuid, uuid, text, jsonb, jsonb, jsonb, text, text)
  TO service_role;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_rls boolean;
  v_policies int;
  v_fk text;
  v_funcao text := 'public.cb_gravar_alarme_de_conexao(uuid, uuid, text, jsonb, jsonb, jsonb, text, text)';
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
          AND has_table_privilege('service_role', 'public.cb_alarmes_de_conexao', 'DELETE')
          AND has_table_privilege('service_role', 'public.profiles', 'SELECT')
          AND has_table_privilege('service_role', 'public.notifications', 'INSERT')) THEN
    RAISE EXCEPTION '1122: service_role não alcança o que a função lê e grava';
  END IF;

  IF has_function_privilege('anon', v_funcao, 'EXECUTE')
     OR has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION '1122: anon ou authenticated executam cb_gravar_alarme_de_conexao';
  END IF;
  IF NOT has_function_privilege('service_role', v_funcao, 'EXECUTE') THEN
    RAISE EXCEPTION '1122: service_role não executa cb_gravar_alarme_de_conexao';
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

-- A função CHAMADA, como o service_role: o corpo do plpgsql só é analisado
-- quando roda. Precisa de uma conexão e do dono da conta dela; em banco
-- vazio, pula. Tudo dentro do subbloco é desfeito pelo SQLSTATE próprio.
DO $$
DECLARE
  v_canal uuid;
  v_conta uuid;
  v_dono uuid;
  v_ok boolean;
  v_avisos int;
  v_estado jsonb := jsonb_build_object(
    'desde', '2026-01-01T00:00:00Z', 'avisado_em', '2026-01-01T01:00:00Z',
    'normalizou_em', NULL, 'devido_em', NULL, 'detalhe', '{}'::jsonb);
BEGIN
  SELECT c.id, c.account_id, a.owner_user_id
    INTO v_canal, v_conta, v_dono
    FROM public.cb_channels c
    JOIN public.accounts a ON a.id = c.account_id
    JOIN public.profiles p ON p.account_id = a.id AND p.user_id = a.owner_user_id
   LIMIT 1;
  IF v_canal IS NULL THEN
    RAISE NOTICE '1122: banco vazio, a função não foi chamada.';
    RETURN;
  END IF;

  BEGIN
    SET LOCAL ROLE service_role;

    v_ok := public.cb_gravar_alarme_de_conexao(
      v_conta, v_canal, 'sem_recibo', NULL, v_estado,
      jsonb_build_array(v_dono::text, gen_random_uuid()::text), '1122: conferência', 'desfeita no fim');
    IF v_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION '1122: o 1º aviso do episódio não valeu';
    END IF;
    SELECT count(*) INTO v_avisos
      FROM public.notifications
     WHERE account_id = v_conta AND title = '1122: conferência';
    IF v_avisos <> 1 THEN
      RAISE EXCEPTION '1122: o aviso não entrou junto, ou foi a quem não é membro (% avisos)', v_avisos;
    END IF;

    v_ok := public.cb_gravar_alarme_de_conexao(
      v_conta, v_canal, 'sem_recibo', NULL, v_estado, '[]'::jsonb, NULL, NULL);
    IF v_ok IS DISTINCT FROM false THEN
      RAISE EXCEPTION '1122: o mesmo episódio nasceu duas vezes';
    END IF;

    v_ok := public.cb_gravar_alarme_de_conexao(
      v_conta, v_canal, 'sem_recibo',
      jsonb_build_object('avisado_em', NULL, 'normalizou_em', NULL, 'devido_em', NULL),
      NULL, '[]'::jsonb, NULL, NULL);
    IF v_ok IS DISTINCT FROM false THEN
      RAISE EXCEPTION '1122: a cerca errada apagou o estado';
    END IF;

    v_ok := public.cb_gravar_alarme_de_conexao(
      v_conta, v_canal, 'sem_recibo', v_estado,
      v_estado || jsonb_build_object('devido_em', '2026-01-01T02:00:00Z'),
      '[]'::jsonb, NULL, NULL);
    IF v_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION '1122: a cerca certa não atualizou o estado';
    END IF;

    v_ok := public.cb_gravar_alarme_de_conexao(
      v_conta, v_canal, 'sem_recibo',
      v_estado || jsonb_build_object('devido_em', '2026-01-01T02:00:00Z'),
      NULL, '[]'::jsonb, NULL, NULL);
    IF v_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION '1122: a cerca certa não apagou o estado';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1122', MESSAGE = '1122: conferência desfeita';
  EXCEPTION WHEN SQLSTATE 'P1122' THEN
    NULL;
  END;
END $$;
