-- ============================================================
-- 1041_cb_identidade_do_contato_com_bsuid
--
-- Fase 11 do `docs/PLANO-merge-upstream-2026-09.md` (o BSUID, #519/#533 do
-- original). A Meta deixou de mandar o telefone de quem adotou nome de
-- usuário e não tem histórico recente com a empresa: a mensagem chega só com
-- o BSUID (`from_user_id`). A ficha dessa pessoa nasce SEM telefone —
-- decisão do operador (P4, 24/09/2026): `phone` NULO (anulável desde a 0989,
-- a ficha só do Instagram), nunca o `''` do original.
--
-- O que muda: o CHECK "telefone OU instagram" da 0989 vira "telefone OU
-- instagram OU BSUID". A chave única do BSUID é a da 1038, por CONTA (P4),
-- e já existe.
--
-- ⚠️ ALARGA uma regra — aplicar ANTES do deploy da entrada (11.2): sem ela, o
-- INSERT com `phone` NULO e só o `wa_user_id` leva 23514 e a mensagem do
-- cliente se perde (a Meta já recebeu 200).
--
-- ⚠️ NÃO endurece contra `phone = ''` (a forma do original): um CHECK que o
-- recusasse transformaria uma regressão de merge em PERDA de mensagem (23514
-- depois do 200). Sem ele, a regressão vira ficha duplicada — e quem a
-- impede é o teste da rota (`phone: null`, nunca `''`).
--
-- Idempotente; aplica em banco vazio. Não cria objeto: sem GRANT/REVOKE.
-- ============================================================

-- `contacts` recebe escrita a toda mensagem: sem teto de espera, uma
-- transação longa enfileiraria a ingestão atrás desta trava.
SET LOCAL lock_timeout = '5s';

-- DROP pela FORMA (qualquer CHECK de identidade que cite o instagram) e pelo
-- nome: uma base que tenha recriado o CHECK inline teria o nome implícito, e
-- o nome que não casa deixaria o CHECK velho de pé ao lado do novo.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.contacts'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\(instagram_id IS NOT NULL\)'
  LOOP
    EXECUTE format('ALTER TABLE public.contacts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_identidade_ck;
ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_identidade_ck
  CHECK (phone IS NOT NULL OR instagram_id IS NOT NULL OR wa_user_id IS NOT NULL);

-- ============================================================
-- Conferência — afirma ausência, deriva o dado, nunca exige linha.
-- ============================================================
DO $$
DECLARE
  v_n      int;
  v_def    text;
  v_conta  uuid;
  v_dono   uuid;
  v_a      uuid;
  v_b      uuid;
BEGIN
  -- 1. UM CHECK de identidade, com as três pernas, validado.
  SELECT count(*) INTO v_n
  FROM pg_constraint
  WHERE conrelid = 'public.contacts'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) ~ '\(instagram_id IS NOT NULL\)';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '1041: esperava UM CHECK de identidade em contacts, há %', v_n;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def
  FROM pg_constraint
  WHERE conrelid = 'public.contacts'::regclass AND conname = 'contacts_identidade_ck'
    AND convalidated;
  IF v_def IS NULL OR v_def !~ '\(phone IS NOT NULL\)' OR v_def !~ '\(wa_user_id IS NOT NULL\)' THEN
    RAISE EXCEPTION '1041: contacts_identidade_ck ausente, não validado ou sem as três pernas: %', v_def;
  END IF;

  -- 2. A chave do BSUID (1038) de pé: única, por conta, parcial.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_contacts_account_wa_user_id'
      AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%(account_id, wa_user_id)%'
      AND indexdef LIKE '%WHERE (wa_user_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION '1041: o índice único do BSUID (1038) não está de pé';
  END IF;

  -- 3. Nenhuma ficha sem identidade (vale em banco vazio: não há linha).
  IF EXISTS (
    SELECT 1 FROM public.contacts
    WHERE phone IS NULL AND instagram_id IS NULL AND wa_user_id IS NULL
  ) THEN
    RAISE EXCEPTION '1041: há contato sem telefone, sem instagram e sem BSUID';
  END IF;

  -- 4. A regra na prática, num subbloco DESFEITO pelo SQLSTATE próprio: duas
  --    fichas só-BSUID com `phone` NULO convivem; o mesmo BSUID na mesma conta
  --    colide (23505); a ficha sem identidade nenhuma é recusada (23514).
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
  FROM public.accounts a
  WHERE a.owner_user_id IS NOT NULL
  LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1041: banco sem conta, a prova na prática fica para o descartável.';
  ELSE
    BEGIN
      INSERT INTO public.contacts (account_id, user_id, phone, wa_user_id)
      VALUES (v_conta, v_dono, NULL, 'ZZ.1041-conferencia-a')
      RETURNING id INTO v_a;
      INSERT INTO public.contacts (account_id, user_id, phone, wa_user_id)
      VALUES (v_conta, v_dono, NULL, 'ZZ.1041-conferencia-b')
      RETURNING id INTO v_b;
      IF v_a IS NULL OR v_b IS NULL THEN
        RAISE EXCEPTION '1041: as duas fichas só-BSUID não entraram';
      END IF;

      BEGIN
        INSERT INTO public.contacts (account_id, user_id, phone, wa_user_id)
        VALUES (v_conta, v_dono, NULL, 'ZZ.1041-conferencia-a');
        RAISE EXCEPTION '1041: o mesmo BSUID entrou duas vezes na mesma conta';
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;

      BEGIN
        INSERT INTO public.contacts (account_id, user_id, phone, instagram_id, wa_user_id)
        VALUES (v_conta, v_dono, NULL, NULL, NULL);
        RAISE EXCEPTION '1041: a ficha sem identidade nenhuma entrou';
      EXCEPTION WHEN check_violation THEN
        NULL;
      END;

      RAISE EXCEPTION USING ERRCODE = 'P1041', MESSAGE = 'desfaz a conferência';
    EXCEPTION
      -- ⚠️ Só o SQLSTATE próprio: `WHEN OTHERS` engoliria justamente o erro
      -- que a prova existe para mostrar.
      WHEN SQLSTATE 'P1041' THEN
        RAISE NOTICE '1041: só-BSUID convive, BSUID repetido colide, sem identidade recusa (desfeito).';
    END;
  END IF;

  RAISE NOTICE '1041: ok — identidade = telefone OU instagram OU BSUID.';
END $$;
