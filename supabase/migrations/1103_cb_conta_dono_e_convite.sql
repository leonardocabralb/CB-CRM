-- ============================================================
-- 1103 — A conta: o DONO não se troca pelo navegador, e o convite não
-- apaga a conta de quem tem colegas.
--
-- Porte de duas peças do #670 do original (a migration 047 dele), à nossa
-- forma. A 047 inteira NÃO entra: ela recria `redeem_invitation`,
-- `set_member_role`, `remove_account_member` e `transfer_account_ownership`
-- por cima das nossas (0960, 0961, 0962, 0965, 0971, 1000 e 1067: perfil de
-- acesso, membro suspenso, transferência do acervo, campo espelhado).
--
-- 1. Gatilho em `accounts`, com o MESMO nome e corpo do original
--    (`enforce_account_identity_columns`): `owner_user_id`, `id` e
--    `created_at` não mudam quando quem escreve é `authenticated` — o
--    navegador, pela policy `accounts_update` (017), que só exige admin.
--    MEDIDO em 24/10/2026: `authenticated` tinha UPDATE na coluna e nenhum
--    gatilho barrava, então qualquer admin se fazia dono pela chave anônima.
--    O dono é quem `donoDaConta` carimba em TODA ficha e conversa nova, e
--    `contacts`/`conversations.user_id` CASCADEiam de `auth.users`: o login
--    desse admin apagado um dia levaria os clientes junto (CLAUDE.md, 8a).
--    A transferência continua: `transfer_account_ownership` é SECURITY
--    DEFINER (roda como `postgres`) e o servidor escreve como `service_role`.
--    O que o app grava do navegador em `accounts` (nome, assinatura) não
--    toca nenhuma das três colunas. O `created_at` pesa por outro motivo:
--    `contaDaInstalacao` (`src/lib/marca-servidor.ts`) elege a conta MAIS
--    ANTIGA, e só o admin dela troca a marca de todos — o dono de qualquer
--    conta avulsa (um ex-membro, por exemplo) virava "a conta da instalação"
--    com um PATCH de `created_at`. Conferido por leitura em 25/10/2026:
--    ninguém usou (a mais antiga é a do escritório, e todo dono tem perfil
--    `owner` na própria conta).
-- 2. `redeem_invitation` recusa quando a conta atual de quem aceita tem
--    OUTROS membros. Ela só conferia que o chamador é o dono e que a conta
--    está vazia; o DELETE da conta no fim levava, pelo CASCADE de
--    `profiles.account_id` (017), o perfil de cada colega — e um login sem
--    perfil é justamente quem a policy `profiles_insert` deixa se inserir em
--    qualquer conta. O corpo é a reprodução FIEL da 1000 com UMA guarda nova,
--    antes da checagem de dados (a lição da 922/960: `CREATE OR REPLACE`
--    troca o corpo inteiro), e a busca da conta de quem aceita passa a TRAVAR
--    as linhas (`FOR UPDATE OF p, a`, como a 047): sem isso, um colega que
--    entrasse NA conta de quem está saindo no mesmo instante passaria pela
--    guarda e perderia o perfil no CASCADE. Hoje inofensivo — das contas, só a
--    do escritório tem mais de um membro, e ela tem dados —, mas é o que torna
--    verdade o motivo escrito em `membro-suspenso-1067.test.ts` ("o DONO
--    único").
-- 3. A raiz do item 2: a policy `profiles_insert` (017) só confere
--    `auth.uid() = user_id`, então um login SEM perfil se inseria em qualquer
--    conta, como `owner`. O app nunca insere perfil pelo navegador — quem
--    insere é `handle_new_user`, SECURITY DEFINER (conferido na produção em
--    25/10/2026: nenhuma função comum insere em `profiles`) —, então a policy
--    sai e o INSERT de `anon`/`authenticated` é revogado. É o que a branch
--    `fix/authz-membership-holes` do original (ainda não mesclada) também faz.
--
-- Sem dado novo, sem backfill. As três peças leem `auth.uid()`: provadas num
-- Postgres 16 descartável (esqueleto com as tabelas e a policy de escrita
-- reais, a migration aplicada duas vezes, 13 cenários e o banco vazio) — ver
-- a descrição do PR. Conferência no fim: roda em banco vazio (pula o que pede
-- dado) e, com dado, PROVA as peças em subblocos desfeitos por SQLSTATE
-- próprio.
-- ============================================================

SET LOCAL lock_timeout = '3s';

-- ------------------------------------------------------------
-- 1) O dono, o id e a criação da conta não se trocam pelo navegador
-- ------------------------------------------------------------
-- SECURITY INVOKER de propósito: `current_user` tem de ser o papel de quem
-- escreve (dentro de uma SECURITY DEFINER é o dono da função, e é isso que
-- deixa a transferência passar).
CREATE OR REPLACE FUNCTION public.enforce_account_identity_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'owner_user_id, id and created_at cannot be changed directly; use transfer_account_ownership'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_account_identity_columns ON public.accounts;
CREATE TRIGGER enforce_account_identity_columns
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_account_identity_columns();

-- Ninguém chama a função do gatilho direto. Revogar não impede o gatilho de
-- disparar: o privilégio é conferido no CREATE TRIGGER.
REVOKE EXECUTE ON FUNCTION public.enforce_account_identity_columns() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2) O convite não apaga a conta de quem tem colegas
-- ------------------------------------------------------------
-- Reprodução FIEL da 1000 (que reproduzia a 960), com a guarda da 1103 logo
-- depois da do dono. As outras guardas, a linha do campo espelhado
-- (`espelho IS NULL`, pino `convite-ignora-campo-espelhado.test.ts`) e o
-- bloco do perfil (960) ficam como estavam.
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
  -- 960: o papel e o perfil que o aceite vai gravar.
  v_papel account_role_enum;
  v_perfil_id UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  -- 1103: TRAVADAS até o fim — a guarda dos outros membros (abaixo) é lida
  -- antes do DELETE da conta, e um colega entrando nela no meio-tempo
  -- passaria pela guarda (o UPDATE de profiles dele espera esta trava, e a
  -- FK falha quando a conta some).
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every authenticated user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- 1103: ser o dono não basta — a conta não pode ter OUTROS membros. O
  -- DELETE do fim levaria, pelo CASCADE de profiles.account_id (017), o
  -- perfil de cada um, e o login deles ficaria sem conta.
  IF EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) THEN
    RAISE EXCEPTION 'Your current account has other members; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, deals,
  -- broadcasts, automations, flows, templates, etc.
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    -- 1000: o campo "E-mail" espelhado nasce com TODA conta (gatilho em
    -- accounts) e não é dado de ninguém — contá-lo recusava todo convite.
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id AND espelho IS NULL
    -- 922: aqui era a tabela antiga de anotacoes por contato. O nome dela
    -- nao pode ser escrito aqui — ver a nota da 922.
    UNION ALL SELECT 1 FROM cb_conversation_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- 960: resolve papel e perfil. O papel vem do PERFIL VIGENTE quando o
  -- convite carrega um; o carimbo do convite é o fallback (perfil apagado
  -- entre convidar e aceitar → SET NULL → v_inv.perfil_id já é NULL).
  v_papel := v_inv.role;
  v_perfil_id := NULL;
  IF v_inv.perfil_id IS NOT NULL THEN
    SELECT papel_base INTO v_papel
    FROM cb_perfis_de_acesso
    WHERE id = v_inv.perfil_id AND account_id = v_inv.account_id;
    IF FOUND THEN
      v_perfil_id := v_inv.perfil_id;
    ELSE
      v_papel := v_inv.role;  -- linha sumiu entre o SELECT do convite e aqui
    END IF;
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  -- (960: perfil_id entra no MESMO update — a FK composta de profiles é
  -- validada contra o account_id novo, que é o da conta do convite.)
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_papel,
      perfil_id = v_perfil_id
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$function$;

-- O REPLACE mantém os privilégios, mas a conferência abaixo não confia nisso.
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;

-- ------------------------------------------------------------
-- 3) Login sem perfil não se insere em conta nenhuma
-- ------------------------------------------------------------
-- O perfil nasce por `handle_new_user` (SECURITY DEFINER, roda como dono e
-- não passa pela RLS) e muda por `redeem_invitation`/`remove_account_member`/
-- transferência (todas definer). Nada do navegador insere.
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
REVOKE INSERT ON TABLE public.profiles FROM anon, authenticated;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def      text := pg_get_functiondef('public.redeem_invitation(text)'::regprocedure);
  v_conta    uuid;
  v_dono     uuid;
  v_colega   uuid;
  v_outra    uuid;
  v_n        integer;
  v_token    text;
BEGIN
  -- Catálogo: o gatilho existe, está ligado e a função dele é INVOKER.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.accounts'::regclass
      AND tgname = 'enforce_account_identity_columns'
      AND tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION '1103: o gatilho enforce_account_identity_columns não está em accounts';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.enforce_account_identity_columns()'::regprocedure) THEN
    RAISE EXCEPTION '1103: a função do gatilho virou SECURITY DEFINER — current_user deixaria de ser quem escreve';
  END IF;
  IF has_function_privilege('authenticated', 'public.enforce_account_identity_columns()', 'EXECUTE') THEN
    RAISE EXCEPTION '1103: a função do gatilho ficou aberta a authenticated';
  END IF;

  -- O convite: as guardas de antes continuam, a nova entrou, e quem aceita
  -- ainda consegue chamar.
  IF v_def !~ 'espelho IS NULL' THEN
    RAISE EXCEPTION '1103: redeem_invitation voltou a contar o campo espelhado (1000) — todo convite seria recusado';
  END IF;
  IF v_def !~ 'perfil_id' THEN
    RAISE EXCEPTION '1103: redeem_invitation perdeu o bloco do perfil (960)';
  END IF;
  IF v_def !~ 'has other members' THEN
    RAISE EXCEPTION '1103: redeem_invitation sem a guarda dos outros membros';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.redeem_invitation(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1103: authenticated perdeu redeem_invitation — ninguém entra na conta';
  END IF;
  IF v_def !~ 'FOR UPDATE OF p, a' THEN
    RAISE EXCEPTION '1103: redeem_invitation não trava a conta de quem aceita';
  END IF;

  -- O perfil: nenhuma policy de INSERT, e nem anon nem authenticated inserem.
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.profiles'::regclass AND polcmd IN ('a', '*')
  ) THEN
    RAISE EXCEPTION '1103: profiles ainda tem policy que deixa inserir';
  END IF;
  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('anon', 'public.profiles', 'INSERT') THEN
    RAISE EXCEPTION '1103: anon/authenticated ainda inserem em profiles';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.handle_new_user()'::regprocedure) THEN
    RAISE EXCEPTION '1103: handle_new_user deixou de ser SECURITY DEFINER — sem a policy, o cadastro pararia';
  END IF;

  -- Com dado: uma conta cujo dono é ADMIN dela de fato (perfil owner/admin,
  -- não suspenso — senão a RLS esconde a linha, a régua da 1067) e um colega
  -- que não é dono de conta nenhuma (o índice um-dono-uma-conta da 017
  -- recusaria a troca de prova do passo b).
  SELECT a.id, a.owner_user_id, p.user_id
  INTO v_conta, v_dono, v_colega
  FROM public.accounts a
  JOIN public.profiles d ON d.account_id = a.id AND d.user_id = a.owner_user_id
   AND d.account_role IN ('owner', 'admin') AND d.suspenso_em IS NULL
  JOIN public.profiles p ON p.account_id = a.id AND p.user_id <> a.owner_user_id
  WHERE NOT EXISTS (SELECT 1 FROM public.accounts o WHERE o.owner_user_id = p.user_id)
  ORDER BY a.created_at, p.user_id
  LIMIT 1;

  IF v_conta IS NULL THEN
    RAISE NOTICE '1103: nenhuma conta com dono e colega — nada a provar com dado.';
    RETURN;
  END IF;

  -- (0) O colega, pelo navegador, não se insere em outra conta (a raiz).
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_colega, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_colega::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO public.profiles (user_id, account_id, account_role)
    VALUES (v_colega, v_conta, 'owner');
    RAISE EXCEPTION USING ERRCODE = 'P1130', MESSAGE = 'o navegador inseriu perfil';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- 42501: o REVOKE barrou
    WHEN SQLSTATE 'P1130' THEN
      RAISE EXCEPTION '1103: o navegador ainda insere perfil';
  END;

  -- (a) O dono, pelo navegador (authenticated + o JWT dele), não consegue
  -- passar a conta a um colega. O UPDATE chega à linha (a RLS deixa o admin)
  -- e quem recusa é o gatilho.
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_dono::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.accounts SET owner_user_id = v_colega WHERE id = v_conta;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P1131', MESSAGE = 'a RLS escondeu a conta do próprio dono';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1132', MESSAGE = 'o navegador trocou o dono';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM !~ 'owner_user_id' THEN
        RAISE EXCEPTION '1103: a troca do dono foi recusada por outro motivo: %', SQLERRM;
      END IF;
    WHEN SQLSTATE 'P1131' THEN
      RAISE EXCEPTION '1103: a prova do gatilho não alcançou a linha (%): sem ela não se sabe se ele barra', SQLERRM;
    WHEN SQLSTATE 'P1132' THEN
      RAISE EXCEPTION '1103: o navegador ainda troca o dono da conta';
  END;

  -- (b) Fora do navegador (o papel desta migration, o mesmo das funções
  -- SECURITY DEFINER e do service role) a troca continua passando.
  BEGIN
    UPDATE public.accounts SET owner_user_id = v_colega WHERE id = v_conta;
    RAISE EXCEPTION USING ERRCODE = 'P1133', MESSAGE = 'desfaz a troca de prova';
  EXCEPTION
    WHEN SQLSTATE 'P1133' THEN NULL;  -- passou e foi desfeita
  END;

  -- (c) O convite: o dono de uma conta com colega aceitando convite para
  -- OUTRA conta é recusado pela guarda nova (que vem antes da de dados). O
  -- convite de prova nasce e morre neste subbloco.
  SELECT id INTO v_outra FROM public.accounts WHERE id <> v_conta ORDER BY created_at LIMIT 1;
  IF v_outra IS NULL THEN
    RAISE NOTICE '1103: só há uma conta — a guarda do convite fica sem prova com dado.';
    RETURN;
  END IF;
  v_token := 'cb1103-prova-' || md5(clock_timestamp()::text);
  BEGIN
    INSERT INTO public.account_invitations (account_id, token_hash, role, expires_at)
    VALUES (v_outra, v_token, 'agent', now() + interval '1 hour');
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_dono::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.redeem_invitation(v_token);
    RAISE EXCEPTION USING ERRCODE = 'P1134', MESSAGE = 'o convite foi aceito';
  EXCEPTION
    WHEN unique_violation THEN
      IF SQLERRM !~ 'has other members' THEN
        RAISE EXCEPTION '1103: o convite foi recusado por outra guarda antes da nova: %', SQLERRM;
      END IF;
    WHEN SQLSTATE 'P1134' THEN
      RAISE EXCEPTION '1103: o dono de uma conta com colegas ainda aceita convite para outra conta';
  END;

  IF EXISTS (SELECT 1 FROM public.account_invitations WHERE token_hash = v_token) THEN
    RAISE EXCEPTION '1103: o convite de prova ficou gravado';
  END IF;
  IF (SELECT owner_user_id FROM public.accounts WHERE id = v_conta) IS DISTINCT FROM v_dono THEN
    RAISE EXCEPTION '1103: a prova mudou o dono da conta';
  END IF;

  RAISE NOTICE '1103: gatilho barra o navegador, deixa o definer e o convite recusa a conta com colegas.';
END $$;
