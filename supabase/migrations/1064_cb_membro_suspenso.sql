-- ============================================================
-- 1064 — membro SUSPENSO: o acesso para, a pessoa continua na conta
--
-- Pedido do operador (29/09/2026): em Configurações → Membros só havia
-- EXCLUIR, e ele quer suspender alguém por um tempo sem perder nada. Nada é
-- apagado nem reatribuído (decisão dele): conversas, tarefas e negócios
-- continuam com a pessoa, e reativar devolve o acesso como era, com o mesmo
-- papel e o mesmo perfil. A pessoa suspensa ainda consegue fazer login — cai
-- numa tela de "acesso suspenso", sem dado nenhum (decisão dele também).
--
-- O corte mora no BANCO, não na tela, em quatro peças:
--
-- 1. `profiles.suspenso_em` / `suspenso_por`, e as duas entram na trava
--    `enforce_profile_privilege_columns` (034/958). A policy `profiles_update`
--    deixa cada um editar a PRÓPRIA linha: sem a trava, a pessoa se reativaria
--    com um PATCH.
-- 2. `is_account_member` e `cb_contas_do_usuario` respondem "não é membro"
--    para quem está suspenso. Toda policy que dá acesso a dado da conta passa
--    por uma das duas (conferido no catálogo em 29/09/2026 — fora delas só
--    ficam a própria linha de `profiles` e a de `cb_celulares_dos_membros`, e
--    o batimento global do agendador), e o Realtime avalia as mesmas policies:
--    o corte vale para tela, API do Storage e tempo real. ⚠️ Os buckets de
--    mídia são PÚBLICOS: URL de arquivo que a pessoa já tem continua abrindo —
--    a RLS governa listar e gravar, não o download por URL.
-- 3. A própria linha fica INVISÍVEL para quem está suspenso (`profiles_select`
--    e `profiles_update`). É o que fecha as rotas que leem o cadastro do
--    chamador e depois agem com service role (`cb/notes`, `cb/agenda`,
--    `conversas/abrir`, `whatsapp/*`): todas recusam quando não o acham. E as
--    policies do Storage (`chat-media`, `flow-media`) consultam `profiles`
--    sob a RLS de quem chama.
-- 4. As funções SECURITY DEFINER que leem `profiles` direto (e por isso
--    ignoram as peças 2 e 3) conferem a suspensão: `touch_presence`,
--    `cb_marcar_conversa_aberta`, `set_member_role` e `remove_account_member`
--    recusam chamador suspenso; `transfer_account_ownership` recusa ALVO
--    suspenso (o dono novo ficaria trancado, e ninguém mexe no dono).
--    `redeem_invitation` não precisa: ela exige que o chamador seja o dono
--    único da conta atual, e o dono não pode ser suspenso.
--    `remove_account_member` também DESFAZ a suspensão: a pessoa sai da conta
--    como qualquer ex-membro, dona de uma conta pessoal nova — suspensa ali,
--    ficaria trancada numa conta sem ninguém para reativá-la.
--
-- E mais:
-- - `notifications_select`/`_update` pediam só `auth.uid() = user_id`: quem
--   está suspenso (e o ex-membro removido!) seguia lendo os avisos da conta.
-- - `cb_definir_suspensao` (admin+, a mesma régua do remover: nunca o dono,
--   nunca a si mesmo) e `cb_minha_suspensao` (a tela de acesso suspenso: com a
--   própria linha invisível, o navegador precisa de outro jeito de saber).
--
-- ⚠️ Os corpos das funções recriadas são REPRODUÇÃO FIEL da definição em
-- produção (pg_get_functiondef, 29/09/2026) — a lição da 922/960: o REPLACE
-- troca o corpo inteiro, e um trecho esquecido apaga uma guarda em silêncio.
-- CREATE OR REPLACE mantém dono e privilégios, então nenhum GRANT delas muda.
--
-- ⚠️ Nasceu 1062 e virou 1064 ANTES de ser aplicada em qualquer banco: a 1063
-- (pauta de reuniões, outra sessão) foi aplicada em produção em 29/09/2026 e
-- entra no main antes — e número novo vem depois do maior do main (a
-- instalação que atualiza por `db push` recusa número fora de ordem).
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- `profiles` é lida por TODA policy (pelas funções da peça 2): o ADD COLUMN
-- pega trava exclusiva nela. Sem teto, uma transação longa na tabela
-- enfileiraria o sistema inteiro atrás desta migration.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1. As colunas
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspenso_em  timestamptz,
  ADD COLUMN IF NOT EXISTS suspenso_por uuid;

COMMENT ON COLUMN public.profiles.suspenso_em IS
  '1064: quando o acesso foi suspenso. NULL = ativo. Só cb_definir_suspensao (e remove_account_member, que zera) escreve; a trava enforce_profile_privilege_columns barra o navegador.';
COMMENT ON COLUMN public.profiles.suspenso_por IS
  '1064: user_id de quem suspendeu (auth.users), para a tela de Membros. Sem FK de propósito: apagar o login de quem suspendeu não pode mexer na suspensão.';

-- ------------------------------------------------------------
-- 1b. A trava (corpo da 958 + as duas colunas)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      -- 958: o vínculo de perfil é configuração do operador, não
      -- self-service. Nulo = sem restrição, então deixar a própria pessoa
      -- zerá-lo desfaz o recorte de área com um PATCH.
      OR NEW.perfil_id IS DISTINCT FROM OLD.perfil_id
      -- 1064: a suspensão. Sem isto, a pessoa se reativaria sozinha.
      OR NEW.suspenso_em IS DISTINCT FROM OLD.suspenso_em
      OR NEW.suspenso_por IS DISTINCT FROM OLD.suspenso_por)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id, perfil_id and the suspension cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

-- ------------------------------------------------------------
-- 2. As duas perguntas centrais de toda policy
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      -- 1064: quem está suspenso não é membro para regra nenhuma.
      AND p.suspenso_em IS NULL
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

CREATE OR REPLACE FUNCTION public.cb_contas_do_usuario(
  p_papel_minimo public.account_role_enum DEFAULT 'viewer'
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
ROWS 3
AS $$
  -- Espelho do corpo de `is_account_member` (017): mesma tabela, mesmo
  -- `auth.uid()`, mesma hierarquia. Só muda a pergunta: em vez de "sou
  -- membro DESTA conta?", "de QUAIS contas sou membro?".
  SELECT p.account_id
    FROM public.profiles p
   WHERE p.user_id = auth.uid()
     AND p.account_id IS NOT NULL
     -- 1064: o mesmo corte da is_account_member — as duas não podem
     -- discordar sobre quem é membro.
     AND p.suspenso_em IS NULL
     AND CASE p.account_role
           WHEN 'owner'  THEN 4
           WHEN 'admin'  THEN 3
           WHEN 'agent'  THEN 2
           WHEN 'viewer' THEN 1
         END
         >=
         CASE p_papel_minimo
           WHEN 'owner'  THEN 4
           WHEN 'admin'  THEN 3
           WHEN 'agent'  THEN 2
           WHEN 'viewer' THEN 1
         END
$$;

-- ------------------------------------------------------------
-- 3. A própria linha e os avisos
-- ------------------------------------------------------------
-- A 1032 deixou `profiles_select` como "a minha linha OU as da minha conta".
-- Suspenso, a segunda metade já não devolve nada (peça 2); a primeira passa a
-- exigir que a linha não esteja suspensa.
ALTER POLICY profiles_select ON public.profiles
  USING (
    ((SELECT auth.uid()) = user_id AND suspenso_em IS NULL)
    OR account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))
  );

ALTER POLICY profiles_update ON public.profiles
  USING (auth.uid() = user_id AND suspenso_em IS NULL)
  WITH CHECK (auth.uid() = user_id);

-- O aviso é da CONTA onde nasceu: só quem é membro dela (e não está suspenso)
-- o lê. Fecha também o ex-membro removido, que seguia lendo os avisos antigos.
-- `(SELECT auth.uid())`, a forma da 1032: calculado uma vez por consulta.
ALTER POLICY notifications_select ON public.notifications
  USING (
    (SELECT auth.uid()) = user_id
    AND account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))
  );

ALTER POLICY notifications_update ON public.notifications
  USING (
    (SELECT auth.uid()) = user_id
    AND account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))
  )
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ------------------------------------------------------------
-- 4. As funções que conferem o chamador lendo `profiles` direto
-- ------------------------------------------------------------

-- 4a. Presença (024). O batimento do navegador chama a cada 30 s — e é a
-- recusa DAQUI que avisa a tela aberta de quem acabou de ser suspenso: a
-- mensagem `membro_suspenso` é contrato com `presence-heartbeat.tsx`.
CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_suspenso_em TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, suspenso_em INTO v_account_id, v_suspenso_em
  FROM profiles
  WHERE user_id = auth.uid();

  -- 1064
  IF v_suspenso_em IS NOT NULL THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;
END;
$$;

-- 4b. Quem está com a conversa aberta (963).
CREATE OR REPLACE FUNCTION public.cb_marcar_conversa_aberta(
  p_conversation_id UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid;
  v_conversa uuid;
  v_suspenso_em timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, suspenso_em INTO v_account, v_suspenso_em
    FROM profiles
   WHERE user_id = auth.uid();

  -- 1064
  IF v_suspenso_em IS NOT NULL THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  IF p_conversation_id IS NOT NULL THEN
    SELECT id INTO v_conversa
      FROM conversations
     WHERE id = p_conversation_id
       AND account_id = v_account;
  END IF;

  INSERT INTO cb_conversa_aberta (user_id, account_id, conversation_id, visto_em)
  VALUES (auth.uid(), v_account, v_conversa, now())
  ON CONFLICT (user_id) DO UPDATE
    SET conversation_id = excluded.conversation_id,
        account_id      = excluded.account_id,
        visto_em        = now();
END;
$$;

-- 4c. Mudar papel (018/962). Chamador suspenso é recusado; alvo suspenso
-- pode ter o papel mudado (o admin prepara a volta dele).
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_caller_suspenso TIMESTAMPTZ;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_perfil UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role, suspenso_em
  INTO v_caller_account_id, v_caller_role, v_caller_suspenso
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- 1064
  IF v_caller_suspenso IS NOT NULL THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, perfil_id
  INTO v_target_account_id, v_target_role, v_target_perfil
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_perfil IS NOT NULL THEN
    RAISE EXCEPTION 'This member has an access profile; change the profile (or unassign it) instead of the role'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

-- 4d. Remover membro (018/961). Chamador suspenso é recusado; o removido
-- sai com a suspensão desfeita (ver o cabeçalho).
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID  -- the new personal account id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_caller_suspenso TIMESTAMPTZ;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role, suspenso_em
  INTO v_caller_account_id, v_caller_role, v_caller_suspenso
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- 1064
  IF v_caller_suspenso IS NOT NULL THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Spin up a fresh personal account for the removed user. Mirror
  -- of handle_new_user's logic — keep them whole, just relocated.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner',
      -- 961: o perfil é da conta que a pessoa está DEIXANDO. Sem esta linha,
      -- a FK composta da 957 estoura (perfil da conta antiga × conta nova) e
      -- a remoção inteira falha.
      perfil_id = NULL,
      -- 1064: a suspensão era desta conta. Dona da conta nova e suspensa,
      -- ficaria trancada sem ninguém para reativá-la.
      suspenso_em = NULL,
      suspenso_por = NULL
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

-- 4e. Transferir a conta (018/965/971). Só o ALVO muda: o chamador é o
-- dono, e o dono não pode ser suspenso.
CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_suspenso TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  -- 1064: FOR UPDATE serializa com `cb_definir_suspensao`, que trava a mesma
  -- linha: sem ele, transferir e suspender a mesma pessoa ao mesmo tempo
  -- podia gravar um dono suspenso.
  SELECT account_id, account_role, suspenso_em
  INTO v_target_account_id, v_target_role, v_target_suspenso
  FROM profiles
  WHERE user_id = p_new_owner_user_id
  FOR UPDATE;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- 1064: dono suspenso é conta trancada — ninguém reativa o dono.
  IF v_target_suspenso IS NOT NULL THEN
    RAISE EXCEPTION 'Reactivate this member before transferring ownership'
      USING ERRCODE = '22023';
  END IF;

  -- Demote current owner first so the temporary state where the
  -- account has zero owners is never visible — both writes happen
  -- in the same function transaction.
  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = auth.uid();

  -- ⚠️ 965: `perfil_id = NULL` junto com a promoção. Dono não tem perfil
  -- (CHECK da 956 barra papel_base='owner'); deixar o vínculo antigo de pé
  -- criava a divergência papel×perfil que a 962 barra no set_member_role —
  -- aberta por este caminho, e irremovível pela UI (atribuir recusa owner).
  UPDATE profiles SET account_role = 'owner', perfil_id = NULL
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;

  -- ⚠️ 971: o acervo durável vai junto. Tudo o que a conta carimbou com o
  -- dono antigo (ou com qualquer outro membro, por caminho antigo) passa a
  -- ser do novo dono — é o CASCADE de `auth.users` que exige isto: o dono
  -- antigo acaba de virar removível.
  UPDATE contacts SET user_id = p_new_owner_user_id
  WHERE account_id = v_caller_account_id AND user_id <> p_new_owner_user_id;

  UPDATE conversations SET user_id = p_new_owner_user_id
  WHERE account_id = v_caller_account_id AND user_id <> p_new_owner_user_id;

  UPDATE custom_fields SET user_id = p_new_owner_user_id
  WHERE account_id = v_caller_account_id AND user_id <> p_new_owner_user_id;
END;
$$;

-- ------------------------------------------------------------
-- 5. Suspender / reativar, e a pergunta da tela de acesso suspenso
-- ------------------------------------------------------------

-- A régua de quem pode é a do `remove_account_member`: admin ou dono, nunca o
-- dono como alvo, nunca a si mesmo. Suspender o que já está suspenso não
-- muda a data nem o autor. Devolve o `suspenso_em` resultante (NULL = ativo).
CREATE OR REPLACE FUNCTION public.cb_definir_suspensao(
  p_user_id UUID,
  p_suspenso BOOLEAN
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_caller_suspenso TIMESTAMPTZ;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_resultado TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_suspenso IS NULL THEN
    RAISE EXCEPTION 'p_suspenso is required' USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, suspenso_em
  INTO v_caller_account_id, v_caller_role, v_caller_suspenso
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_suspenso IS NOT NULL THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot suspend yourself'
      USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE: dois administradores clicando ao mesmo tempo se serializam.
  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Só SUSPENDER o dono é recusado. Reativar fica aberto de propósito: é a
  -- saída de um dono que ficou suspenso por um caminho que esta função não
  -- previu — sem ela, só SQL o destrancaria.
  IF v_target_role = 'owner' AND p_suspenso THEN
    RAISE EXCEPTION 'Cannot suspend the account owner'
      USING ERRCODE = '22023';
  END IF;

  IF p_suspenso THEN
    UPDATE profiles
    SET suspenso_por = CASE WHEN suspenso_em IS NULL THEN auth.uid() ELSE suspenso_por END,
        suspenso_em  = COALESCE(suspenso_em, now())
    WHERE user_id = p_user_id
    RETURNING suspenso_em INTO v_resultado;

    -- A pessoa some do "online" e dos avatares da conversa AGORA, sem esperar
    -- o prazo de 75 s da presença: as funções da peça 4 não a deixam voltar.
    DELETE FROM member_presence WHERE user_id = p_user_id;
    DELETE FROM cb_conversa_aberta WHERE user_id = p_user_id;
  ELSE
    UPDATE profiles
    SET suspenso_em = NULL,
        suspenso_por = NULL
    WHERE user_id = p_user_id;
    v_resultado := NULL;
  END IF;

  RETURN v_resultado;
END;
$$;

ALTER FUNCTION public.cb_definir_suspensao(UUID, BOOLEAN) OWNER TO postgres;
-- As duas metades (regra do CLAUDE.md): tirar de PUBLIC E dos papéis, e
-- devolver a quem chama — o navegador chama pela rota com o cliente do
-- próprio admin (sob a sessão dele), e o service_role fica por garantia.
REVOKE ALL ON FUNCTION public.cb_definir_suspensao(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_definir_suspensao(UUID, BOOLEAN) TO authenticated, service_role;

-- Com a própria linha invisível (peça 3), o navegador de quem está suspenso
-- não tem como ler `suspenso_em`. Devolve só a PRÓPRIA data, nada mais.
CREATE OR REPLACE FUNCTION public.cb_minha_suspensao()
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.suspenso_em
    FROM public.profiles p
   WHERE p.user_id = auth.uid()
$$;

ALTER FUNCTION public.cb_minha_suspensao() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cb_minha_suspensao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_minha_suspensao() TO authenticated, service_role;

-- ------------------------------------------------------------
-- Conferência 1 — estrutura (vale em banco vazio)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_fn TEXT;
  v_def TEXT;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('suspenso_em', 'suspenso_por')) <> 2 THEN
    RAISE EXCEPTION '1064: as colunas de suspensão não existem em profiles';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.enforce_profile_privilege_columns()',
    'public.is_account_member(uuid, account_role_enum)',
    'public.cb_contas_do_usuario(account_role_enum)',
    'public.touch_presence(text)',
    'public.cb_marcar_conversa_aberta(uuid)',
    'public.set_member_role(uuid, account_role_enum)',
    'public.remove_account_member(uuid)',
    'public.transfer_account_ownership(uuid)'
  ] LOOP
    v_def := pg_get_functiondef(v_fn::regprocedure);
    IF v_def !~ 'suspenso_em' THEN
      RAISE EXCEPTION '1064: % não menciona suspenso_em — o REPLACE não pegou', v_fn;
    END IF;
  END LOOP;

  -- As guardas que vieram das migrations anteriores continuam lá (a lição da
  -- 922: um REPLACE que esquece um trecho apaga a guarda em silêncio).
  IF pg_get_functiondef('public.remove_account_member(uuid)'::regprocedure) !~ 'perfil_id = NULL' THEN
    RAISE EXCEPTION '1064: remove_account_member perdeu o perfil_id = NULL da 961';
  END IF;
  IF pg_get_functiondef('public.set_member_role(uuid, account_role_enum)'::regprocedure) !~ 'access profile' THEN
    RAISE EXCEPTION '1064: set_member_role perdeu a guarda de perfil da 962';
  END IF;
  IF pg_get_functiondef('public.transfer_account_ownership(uuid)'::regprocedure) !~ 'UPDATE custom_fields' THEN
    RAISE EXCEPTION '1064: transfer_account_ownership perdeu o acervo da 971';
  END IF;
  IF pg_get_functiondef('public.enforce_profile_privilege_columns()'::regprocedure) !~ 'perfil_id' THEN
    RAISE EXCEPTION '1064: a trava perdeu o perfil_id da 958';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'profiles' AND policyname = 'profiles_select'
                  AND qual ~ 'suspenso_em') THEN
    RAISE EXCEPTION '1064: profiles_select não esconde a própria linha suspensa';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'profiles' AND policyname = 'profiles_update'
                  AND qual ~ 'suspenso_em') THEN
    RAISE EXCEPTION '1064: profiles_update não barra a linha suspensa';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
       AND tablename = 'notifications'
       AND policyname IN ('notifications_select', 'notifications_update')
       AND qual ~ 'cb_contas_do_usuario') <> 2 THEN
    RAISE EXCEPTION '1064: as policies de notifications não perguntam a conta';
  END IF;

  IF has_function_privilege('anon', 'public.cb_definir_suspensao(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_minha_suspensao()', 'EXECUTE') THEN
    RAISE EXCEPTION '1064: anon executa as funções novas — não devia';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cb_definir_suspensao(uuid, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_minha_suspensao()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_definir_suspensao(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '1064: authenticated/service_role sem EXECUTE nas funções novas';
  END IF;
END $$;

-- ------------------------------------------------------------
-- Conferência 2 — comportamento, CHAMANDO as funções (regra 3 do CLAUDE.md)
--
-- Suspende de verdade um membro real num subbloco que se DESFAZ pela exceção
-- própria P1064 — nada sobra no banco. Banco sem um membro não-dono numa
-- conta com dono (o replay do CI) pula com NOTICE (regra 2).
--
-- ⚠️ Roda com as travas das ALTER acima presas (`profiles`, `notifications`),
-- então toda leitura aqui vai pelo índice — o membro, a conta dele —, nunca
-- varrendo a tabela: numa instalação grande, varrer `notifications` com a
-- trava exclusiva pararia o sistema (a regra da 1032).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_alvo  UUID;   -- membro comum (agent/viewer de preferência), ativo
  v_conta UUID;
  v_dono  UUID;
  v_ts    TIMESTAMPTZ;
  v_n     INT;
  v_ok    BOOLEAN;
BEGIN
  SELECT p.user_id, p.account_id, a.owner_user_id
  INTO v_alvo, v_conta, v_dono
  FROM public.profiles p
  JOIN public.accounts a ON a.id = p.account_id
  JOIN public.profiles d ON d.user_id = a.owner_user_id
                        AND d.account_id = a.id
                        AND d.account_role = 'owner'
                        AND d.suspenso_em IS NULL
  WHERE p.account_role IN ('agent', 'viewer', 'admin')
    AND p.suspenso_em IS NULL
    AND p.user_id <> a.owner_user_id
  ORDER BY (p.account_role = 'admin'), p.created_at
  LIMIT 1;

  IF v_alvo IS NULL THEN
    RAISE NOTICE '1064: sem membro não-dono numa conta com dono — pulando a prova de comportamento.';
    RETURN;
  END IF;

  BEGIN
    -- ---- Como o DONO: suspende --------------------------------------------
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    v_ts := public.cb_definir_suspensao(v_alvo, true);
    IF v_ts IS NULL THEN
      RAISE EXCEPTION '1064: cb_definir_suspensao(true) não devolveu a data';
    END IF;

    -- Suspender de novo não muda a data.
    IF public.cb_definir_suspensao(v_alvo, true) IS DISTINCT FROM v_ts THEN
      RAISE EXCEPTION '1064: suspender de novo mudou a data da suspensão';
    END IF;

    -- O dono NÃO transfere a conta para quem está suspenso.
    v_ok := false;
    BEGIN
      PERFORM public.transfer_account_ownership(v_alvo);
    EXCEPTION WHEN invalid_parameter_value THEN v_ok := true;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: transfer_account_ownership aceitou alvo suspenso';
    END IF;

    -- Ninguém se suspende (o dono, aqui).
    v_ok := false;
    BEGIN
      PERFORM public.cb_definir_suspensao(v_dono, true);
    EXCEPTION WHEN invalid_parameter_value THEN v_ok := true;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: o dono conseguiu suspender a si mesmo';
    END IF;

    -- ---- Como o SUSPENSO: não vê nada, não faz nada ------------------------
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_alvo, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_n FROM public.profiles
     WHERE user_id = v_alvo OR account_id = v_conta;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '1064: o suspenso ainda lê % linha(s) de profiles', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM public.cb_contas_do_usuario();
    IF v_n <> 0 THEN
      RAISE EXCEPTION '1064: cb_contas_do_usuario ainda devolve conta ao suspenso';
    END IF;
    IF public.is_account_member(v_conta) THEN
      RAISE EXCEPTION '1064: is_account_member ainda diz que o suspenso é membro';
    END IF;
    SELECT count(*) INTO v_n FROM public.notifications WHERE user_id = v_alvo;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '1064: o suspenso ainda lê % aviso(s)', v_n;
    END IF;
    IF public.cb_minha_suspensao() IS DISTINCT FROM v_ts THEN
      RAISE EXCEPTION '1064: cb_minha_suspensao não devolveu a data ao suspenso';
    END IF;

    UPDATE public.profiles SET full_name = full_name WHERE user_id = v_alvo;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '1064: o suspenso ainda edita a própria linha';
    END IF;

    v_ok := false;
    BEGIN
      PERFORM public.touch_presence('online');
    EXCEPTION WHEN insufficient_privilege THEN
      v_ok := SQLERRM = 'membro_suspenso';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: touch_presence não recusou o suspenso com membro_suspenso';
    END IF;

    v_ok := false;
    BEGIN
      PERFORM public.cb_marcar_conversa_aberta(NULL);
    EXCEPTION WHEN insufficient_privilege THEN
      v_ok := SQLERRM = 'membro_suspenso';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: cb_marcar_conversa_aberta não recusou o suspenso';
    END IF;

    v_ok := false;
    BEGIN
      PERFORM public.cb_definir_suspensao(v_dono, false);
    EXCEPTION WHEN insufficient_privilege THEN
      v_ok := SQLERRM = 'membro_suspenso';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: o suspenso conseguiu chamar cb_definir_suspensao';
    END IF;

    v_ok := false;
    BEGIN
      PERFORM public.set_member_role(v_dono, 'viewer');
    EXCEPTION WHEN insufficient_privilege THEN
      v_ok := SQLERRM = 'membro_suspenso';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: set_member_role não recusou o chamador suspenso';
    END IF;

    v_ok := false;
    BEGIN
      PERFORM public.remove_account_member(v_dono);
    EXCEPTION WHEN insufficient_privilege THEN
      v_ok := SQLERRM = 'membro_suspenso';
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: remove_account_member não recusou o chamador suspenso';
    END IF;

    -- ---- Como o DONO: reativa; o membro volta a ver ------------------------
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    IF public.cb_definir_suspensao(v_alvo, false) IS NOT NULL THEN
      RAISE EXCEPTION '1064: cb_definir_suspensao(false) não devolveu NULL';
    END IF;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_alvo, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_n FROM public.profiles WHERE user_id = v_alvo;
    IF v_n <> 1 OR NOT public.is_account_member(v_conta) THEN
      RAISE EXCEPTION '1064: reativado, o membro não voltou a ver a própria conta';
    END IF;

    -- A trava: ativo, ele continua sem poder se suspender pelo PATCH.
    v_ok := false;
    BEGIN
      UPDATE public.profiles SET suspenso_em = now() WHERE user_id = v_alvo;
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '1064: a trava deixou o membro mexer em suspenso_em';
    END IF;

    -- ---- Como o DONO: suspende de novo e REMOVE; a suspensão sai junto -----
    RESET ROLE;
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    PERFORM public.cb_definir_suspensao(v_alvo, true);
    PERFORM public.remove_account_member(v_alvo);

    RESET ROLE;
    IF EXISTS (SELECT 1 FROM public.profiles
                WHERE user_id = v_alvo
                  AND (suspenso_em IS NOT NULL OR account_id = v_conta)) THEN
      RAISE EXCEPTION '1064: remove_account_member não levou a pessoa para fora com a suspensão desfeita';
    END IF;

    -- Tudo certo: desfaz o teste inteiro.
    RAISE EXCEPTION USING ERRCODE = 'P1064', MESSAGE = 'desfaz a prova de comportamento';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio. `WHEN OTHERS` engoliria justamente o erro que
    -- a prova existe para mostrar.
    WHEN SQLSTATE 'P1064' THEN NULL;
  END;

  RESET ROLE;
  IF EXISTS (SELECT 1 FROM public.profiles
              WHERE user_id = v_alvo
                AND (suspenso_em IS NOT NULL OR account_id <> v_conta)) THEN
    RAISE EXCEPTION '1064: o teste de comportamento não se desfez';
  END IF;
END $$;
