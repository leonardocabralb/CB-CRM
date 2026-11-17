-- ============================================================================
-- 1147 — POSSE do envio do disparo: o "Retomar" não manda o modelo em dobro
-- (porte do original #683, 17/11/2026; docs/PLANO-porte-upstream-2026-11.md,
-- item F1)
-- ============================================================================
-- O assistente de disparo envia do NAVEGADOR de quem disparou, em lotes de 10
-- (`use-broadcast-sending.ts`), e nunca dizia ao banco que estava enviando. A
-- tela da campanha via `sending` + destinatários pendentes e anunciava
-- "Esta campanha parou no meio" com o botão Retomar; a retomada
-- (`claimBroadcastDelivery`) achava a trava dela livre e mandava, pelo
-- servidor, os mesmos pendentes que o assistente ainda ia mandar — o modelo
-- PAGO chegava duas vezes ao cliente, e mensagem de WhatsApp não se recolhe.
--
-- A POSSE é do assistente, com PRAZO medido pelo relógio do BANCO (o do
-- navegador pode estar errado por minutos):
--
--  - `cb_tomar_posse_do_disparo(disparo, token)`: o assistente toma a posse
--    logo depois de criar a campanha. Só toma com a posse livre, vencida ou
--    já DELE (o mesmo token: a repetição de um pedido cuja resposta se perdeu
--    não vira "outro assumiu") E com a trava da retomada livre ou velha (mais
--    de 30 min, a régua de `DELIVERY_LOCK_STALE_MS`).
--  - `cb_renovar_posse_do_disparo(disparo, token)`: antes de CADA lote (e
--    depois de cada espera do 429) — só com o token. Devolve nulo quando a
--    posse mudou de mãos: o assistente PARA e nunca reenvia.
--  - `cb_disparo_em_andamento(disparo)`: a tela troca "parou no meio" e o
--    Retomar por "Envio em andamento" enquanto a posse vale ou a trava da
--    retomada é recente. Nulo = não sei (a tela não afirma "parado").
--  - A retomada (TS, `claimBroadcastDelivery`) só toma a trava com a posse
--    livre ou vencida, e apaga posse e token na MESMA escrita: o assistente
--    que acordar depois disso perde a renovação.
--
-- DIVERGE do original (058): (1) o TOKEN — o original renova comparando o
-- próprio prazo, e a renovação gravada cuja resposta se perdeu, repetida, não
-- casava mais (o assistente parava dizendo que outro envio assumiu);
-- (2) SECURITY INVOKER com o papel ESCRITO (`is_account_member(…, 'admin')`,
-- quem dispara aqui; o original usa DEFINER com 'agent'): a RLS da 964 já
-- exige admin no UPDATE de `broadcasts`, então nada aqui precisa de
-- privilégio além do de quem chama. A coluna do prazo tem o nome do original
-- (`delivery_lease_until`). A 058 crua NÃO serve (depende da 052).
--
-- ADITIVA: aplicar ANTES do deploy. O app de hoje não conhece as colunas nem
-- as funções e segue igual; o app novo não começa um disparo sem elas (a
-- posse é tomada antes do primeiro envio) e a retomada as lê no filtro.
--
-- Conferência: as três funções são CHAMADAS como `authenticated` (o caminho
-- do PostgREST) num subbloco desfeito pelo SQLSTATE próprio (P1147) — sem
-- dado (vale no banco vazio) e, havendo um disparo parado de conta com admin,
-- com a sessão simulada desse admin.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS delivery_lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_lease_token UUID;

COMMENT ON COLUMN public.broadcasts.delivery_lease_until IS
  'Até quando vale a posse do envio pelo assistente (navegador), pelo relógio do banco. Renovada a cada lote; nula quando ninguém a tem. 1147.';
COMMENT ON COLUMN public.broadcasts.delivery_lease_token IS
  'Token (gerado pelo assistente) de quem tem a posse do envio. A retomada o apaga ao assumir. 1147.';

-- ----------------------------------------------------------------------------
-- Tomar a posse
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_tomar_posse_do_disparo(
  p_broadcast_id UUID,
  p_token UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY INVOKER
STRICT
SET search_path = public
AS $$
DECLARE
  v_prazo TIMESTAMPTZ;
BEGIN
  UPDATE public.broadcasts b
     SET delivery_lease_until = now() + INTERVAL '5 minutes',
         delivery_lease_token = p_token
   WHERE b.id = p_broadcast_id
     AND public.is_account_member(b.account_id, 'admin')
     AND (b.delivery_lease_token = p_token
          OR b.delivery_lease_until IS NULL
          OR b.delivery_lease_until < now())
     AND (b.delivery_locked_at IS NULL
          OR b.delivery_locked_at < now() - INTERVAL '30 minutes')
  RETURNING b.delivery_lease_until INTO v_prazo;
  RETURN v_prazo;
END;
$$;

COMMENT ON FUNCTION public.cb_tomar_posse_do_disparo(UUID, UUID) IS
  'Assistente de disparo: toma a posse do envio por 5 min (relógio do banco). Nulo = não tomou (outro envio, sem papel de admin, disparo de outra conta). 1147.';

-- ----------------------------------------------------------------------------
-- Renovar a posse (antes de cada lote)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_renovar_posse_do_disparo(
  p_broadcast_id UUID,
  p_token UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY INVOKER
STRICT
SET search_path = public
AS $$
DECLARE
  v_prazo TIMESTAMPTZ;
BEGIN
  -- Só o token decide: a posse vencida que ninguém assumiu continua do
  -- assistente (a aba que dormiu e acordou segue), e a retomada que assumiu
  -- apagou o token.
  UPDATE public.broadcasts b
     SET delivery_lease_until = now() + INTERVAL '5 minutes'
   WHERE b.id = p_broadcast_id
     AND public.is_account_member(b.account_id, 'admin')
     AND b.delivery_lease_token = p_token
  RETURNING b.delivery_lease_until INTO v_prazo;
  RETURN v_prazo;
END;
$$;

COMMENT ON FUNCTION public.cb_renovar_posse_do_disparo(UUID, UUID) IS
  'Assistente de disparo: renova a posse por 5 min, só com o token. Nulo = a posse mudou de mãos (o assistente para e não reenvia). 1147.';

-- ----------------------------------------------------------------------------
-- Envio em andamento? (a tela da campanha)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_disparo_em_andamento(
  p_broadcast_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(b.delivery_locked_at > now() - INTERVAL '30 minutes', false)
      OR COALESCE(b.delivery_lease_until > now(), false)
    FROM public.broadcasts b
   WHERE b.id = p_broadcast_id
$$;

COMMENT ON FUNCTION public.cb_disparo_em_andamento(UUID) IS
  'Tela da campanha: há envio em andamento (posse do assistente no prazo ou trava da retomada com menos de 30 min)? Nulo = disparo não visível. 1147.';

-- ----------------------------------------------------------------------------
-- Privilégios: quem chama é o navegador (authenticated). Banco vazio: a
-- função INVOKER lê e grava com o privilégio de quem chama — na produção o
-- `authenticated` já tem isto pelo padrão do Supabase.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.cb_tomar_posse_do_disparo(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cb_renovar_posse_do_disparo(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cb_disparo_em_andamento(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_tomar_posse_do_disparo(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_renovar_posse_do_disparo(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_disparo_em_andamento(UUID) TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.broadcasts TO authenticated;

-- Sem ninguém ouvindo (o replay do CI), é no-op.
NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_assinatura TEXT;
  v_oid        regprocedure;
  v_colunas    INTEGER;
  v_disparo    UUID;
  v_conta      UUID;
  v_admin      UUID;
  v_outro      UUID;
  v_token      UUID := gen_random_uuid();
  v_prazo      TIMESTAMPTZ;
BEGIN
  SELECT count(*) INTO v_colunas
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'broadcasts'
     AND column_name IN ('delivery_lease_until', 'delivery_lease_token');
  IF v_colunas <> 2 THEN
    RAISE EXCEPTION '1147: faltam as colunas da posse em broadcasts (% de 2)', v_colunas;
  END IF;

  FOREACH v_assinatura IN ARRAY ARRAY[
    'public.cb_tomar_posse_do_disparo(uuid,uuid)',
    'public.cb_renovar_posse_do_disparo(uuid,uuid)',
    'public.cb_disparo_em_andamento(uuid)'
  ] LOOP
    v_oid := to_regprocedure(v_assinatura);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '1147: % não existe', v_assinatura;
    END IF;
    IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) THEN
      RAISE EXCEPTION '1147: % virou SECURITY DEFINER (passaria por cima da RLS)', v_assinatura;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '1147: anon executa %', v_assinatura;
    END IF;
    IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '1147: authenticated não executa % (o assistente não começaria)', v_assinatura;
    END IF;
  END LOOP;

  -- 1. Sem dado (vale no banco vazio): como `authenticated`, as três rodam, e
  --    o disparo que não existe devolve nulo — nunca uma posse.
  BEGIN
    SET LOCAL ROLE authenticated;
    IF public.cb_tomar_posse_do_disparo(gen_random_uuid(), v_token) IS NOT NULL
       OR public.cb_renovar_posse_do_disparo(gen_random_uuid(), v_token) IS NOT NULL
       OR public.cb_disparo_em_andamento(gen_random_uuid()) IS NOT NULL THEN
      RAISE EXCEPTION '1147: disparo inexistente devolveu posse ou andamento';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1147', MESSAGE = 'desfaz a conferência (sem dado)';
  EXCEPTION
    WHEN SQLSTATE 'P1147' THEN NULL;
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION '1147: authenticated não consegue chamar as funções: %', SQLERRM;
  END;

  -- 2. Com dado: um disparo PARADO de uma conta com admin ativo, com a sessão
  --    simulada desse admin. Toma, outro token não toma, renova, está em
  --    andamento, outro token não renova; um membro que não é admin não renova.
  SELECT b.id, b.account_id, p.user_id
    INTO v_disparo, v_conta, v_admin
    FROM public.broadcasts b
    JOIN public.profiles p
      ON p.account_id = b.account_id
     AND p.account_role IN ('owner', 'admin')
     AND p.suspenso_em IS NULL
   WHERE (b.delivery_locked_at IS NULL OR b.delivery_locked_at < now() - INTERVAL '30 minutes')
     AND (b.delivery_lease_until IS NULL OR b.delivery_lease_until < now())
   ORDER BY b.created_at DESC, b.id, p.user_id
   LIMIT 1;
  IF v_disparo IS NULL THEN
    RAISE NOTICE '1147: sem disparo parado de conta com admin — conferida só a chamada sem dado.';
    RETURN;
  END IF;
  SELECT p.user_id INTO v_outro
    FROM public.profiles p
   WHERE p.account_id = v_conta
     AND p.account_role IN ('agent', 'viewer')
     AND p.suspenso_em IS NULL
   ORDER BY p.user_id
   LIMIT 1;

  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    v_prazo := public.cb_tomar_posse_do_disparo(v_disparo, v_token);
    IF v_prazo IS NULL OR v_prazo <= now() THEN
      RAISE EXCEPTION '1147: o admin não tomou a posse de um disparo parado';
    END IF;
    IF public.cb_tomar_posse_do_disparo(v_disparo, v_token) IS NULL THEN
      RAISE EXCEPTION '1147: repetir o pedido com o MESMO token não devolveu a posse';
    END IF;
    IF public.cb_tomar_posse_do_disparo(v_disparo, gen_random_uuid()) IS NOT NULL THEN
      RAISE EXCEPTION '1147: outro token tomou uma posse que ainda vale';
    END IF;
    IF public.cb_renovar_posse_do_disparo(v_disparo, v_token) IS NULL THEN
      RAISE EXCEPTION '1147: o dono da posse não conseguiu renovar';
    END IF;
    IF public.cb_disparo_em_andamento(v_disparo) IS NOT TRUE THEN
      RAISE EXCEPTION '1147: com a posse no prazo, o disparo não aparece em andamento';
    END IF;
    IF public.cb_renovar_posse_do_disparo(v_disparo, gen_random_uuid()) IS NOT NULL THEN
      RAISE EXCEPTION '1147: outro token renovou a posse';
    END IF;
    IF v_outro IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_outro, 'role', 'authenticated')::text, true);
      IF public.cb_renovar_posse_do_disparo(v_disparo, v_token) IS NOT NULL THEN
        RAISE EXCEPTION '1147: um membro que não é admin renovou a posse';
      END IF;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1147', MESSAGE = 'desfaz a conferência (com dado)';
  EXCEPTION
    -- Só o SQLSTATE próprio: `WHEN OTHERS` engoliria o erro que a chamada
    -- existe para mostrar.
    WHEN SQLSTATE 'P1147' THEN
      RAISE NOTICE '1147: posse tomada, renovada e recusada a quem não podia (chamada desfeita; % membro sem papel de admin conferido).',
        CASE WHEN v_outro IS NULL THEN 'nenhum' ELSE '1' END;
  END;
END $$;
