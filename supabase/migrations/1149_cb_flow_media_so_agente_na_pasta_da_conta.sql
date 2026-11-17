-- ============================================================
-- 1149 — `flow-media`: só atendente para cima grava, e só na pasta da CONTA.
--
-- Porte do #682 do original (`055_authz_membership_holes.sql`, REFERÊNCIA —
-- a dele mantém a pasta por usuário e recria também as do `chat-media`, que
-- aqui ficam como estão: decisão do operador #17, 17/11/2026, o Visualizador
-- continua subindo arquivo no `chat-media`). Plano:
-- `docs/PLANO-porte-upstream-2026-11.md`, Lote E (E3).
--
-- O DEFEITO. As policies de escrita da 0020 aceitavam:
--   · na pasta da conta (`account-<id>/…`), QUALQUER membro — até o
--     Visualizador, que nem abre o construtor do robô (as regras do robô são
--     de admin, 964);
--   · na pasta do próprio usuário (`<user_id>/…`, a convenção anterior à
--     0020), QUALQUER login: suspenso (a 1067 escreveu esta pendência) e até
--     quem não é de conta nenhuma — a pasta não pergunta a `profiles`.
-- O construtor só grava na pasta da conta (`uploadAccountMedia`, desde a
-- 0020), e o bucket estava VAZIO em 17/11/2026 (nem pasta por usuário): nada
-- existente se perde.
--
-- O QUE MUDA.
--   · Gravar, trocar e apagar: owner, admin ou agent, ATIVO (`suspenso_em`
--     nulo), só em `account-<a conta dele>/…`. A pasta por usuário deixa de
--     existir.
--   · Listar (a policy de leitura da 0900): só a pasta da conta, de qualquer
--     membro ativo — a pasta por usuário sai daqui também. ⚠️ O bucket segue
--     PÚBLICO: quem tem a URL de um arquivo continua abrindo (a RLS governa
--     listar e gravar, não o download por URL; ver a 0900).
--   A forma é a das policies do `chat-media` (954): EXISTS em `profiles`
--   pelo usuário da sessão, sob a RLS de quem chama — com `(SELECT
--   auth.uid())`, calculado uma vez por consulta (a forma da 1032).
--
-- RESTRITIVA: aplicar DEPOIS do deploy (tira permissão). Nenhum código do app
-- muda com ela. Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- DROP/CREATE POLICY em `storage.objects` trava a tabela do Storage inteiro
-- (todos os buckets) até o fim da transação.
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.suspenso_em IS NULL
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Members can update flow media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.suspenso_em IS NULL
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  )
  WITH CHECK (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.suspenso_em IS NULL
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Members can delete flow media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.suspenso_em IS NULL
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Flow media is readable by account members" ON storage.objects;
CREATE POLICY "Flow media is readable by account members"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'flow-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.suspenso_em IS NULL
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- Conferência — o catálogo (vale em banco vazio). O comportamento sob a RLS
-- (agente, visualizador, suspenso, de fora, pasta por usuário) foi provado
-- num Postgres descartável com os stubs do Storage; aqui não há função
-- plpgsql nova para chamar.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_p record;
  v_n integer := 0;
BEGIN
  FOR v_p IN
    SELECT policyname, cmd,
           coalesce(qual, '') || ' ' || coalesce(with_check, '') AS corpo
      FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname IN ('Members can upload flow media', 'Members can update flow media',
                          'Members can delete flow media', 'Flow media is readable by account members')
  LOOP
    v_n := v_n + 1;
    IF v_p.corpo !~ 'flow-media' OR v_p.corpo !~ 'suspenso_em IS NULL' OR v_p.corpo !~ '''account-''' THEN
      RAISE EXCEPTION '1149: a policy "%" não tem a forma esperada: %', v_p.policyname, v_p.corpo;
    END IF;
    -- A pasta por usuário: `(auth.uid())::text = (storage.foldername(name))[1]`
    -- (ou com `(SELECT auth.uid())`, que o catálogo escreve `( SELECT … AS uid)`).
    IF v_p.corpo ~ 'auth\.uid\(\)\)::text' OR v_p.corpo ~ 'AS uid\)\)::text' THEN
      RAISE EXCEPTION '1149: a policy "%" ainda aceita a pasta por usuário', v_p.policyname;
    END IF;
    IF v_p.cmd <> 'SELECT' AND v_p.corpo !~ '''agent''' THEN
      RAISE EXCEPTION '1149: a policy de escrita "%" não exige atendente para cima', v_p.policyname;
    END IF;
    IF v_p.cmd <> 'SELECT' AND v_p.corpo ~ '''viewer''' THEN
      RAISE EXCEPTION '1149: a policy de escrita "%" aceita o visualizador', v_p.policyname;
    END IF;
  END LOOP;
  IF v_n <> 4 THEN
    RAISE EXCEPTION '1149: esperava as 4 policies do flow-media, achei %', v_n;
  END IF;

  -- Nenhuma OUTRA policy de escrita alcança o bucket (permissivas somam com
  -- OU: uma quinta, frouxa, reabriria a porta) — nem a que cita o
  -- `flow-media`, nem a que não recorta bucket nenhum (vale para todos).
  -- Medido na produção em 17/11/2026: as 9 de escrita recortam o bucket.
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                AND ((coalesce(qual, '') || coalesce(with_check, '')) ~ 'flow-media'
                     OR (coalesce(qual, '') || coalesce(with_check, '')) !~ 'bucket_id')
                AND policyname NOT IN ('Members can upload flow media', 'Members can update flow media',
                                       'Members can delete flow media')) THEN
    RAISE EXCEPTION '1149: há outra policy de escrita que alcança o flow-media';
  END IF;
END $$;
