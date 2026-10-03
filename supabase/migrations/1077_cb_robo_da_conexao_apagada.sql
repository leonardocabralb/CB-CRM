-- ============================================================
-- 1077 — O robô de uma conexão apagada fica DESLIGADO, nunca curinga.
--
-- Pedido do operador (03/10/2026): trocar ou perder um número não pode
-- quebrar nada em silêncio. `flows.channel_id` é ON DELETE SET NULL
-- (`flows_channel_id_fkey`), e no motor `channel_id` nulo quer dizer "vale
-- para TODO número" (`findEntryFlow`): apagar a conexão transformava o robô
-- de UM número num robô de todos, respondendo nos números dos outros
-- setores. É o contrário do que a 903 faz com a automação
-- (`cb_drop_channel_from_automations`: escopo que esvazia DESLIGA).
--
-- Aqui, a mesma régua para o robô: antes de a conexão sair, o robô ATIVO
-- restrito a ela vai para `draft` (o motor só entra em robô `active`, e a
-- tela o mostra desligado). O SET NULL da FK continua: religar à mão é
-- escolha de quem religa, e a tela mostra o escopo "todos os números".
--
-- ⚠️ BEFORE DELETE, nunca AFTER: a ação da FK (o SET NULL) roda antes dos
-- gatilhos AFTER do usuário, e um AFTER já não acharia o robô pelo
-- `channel_id`. É a forma do `cb_channels_tira_dos_agentes_de_ia` (1048).
-- Pelo id da conexão (único no banco), sem a conta: a FK é simples.
--
-- SECURITY DEFINER, como os outros gatilhos de `cb_channels`: a exclusão
-- pela tela roda como `authenticated`, e a policy de `flows` não pode decidir
-- se o robô desliga.
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cb_desliga_robos_da_conexao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE flows
     SET status = 'draft'
   WHERE channel_id = OLD.id
     AND status = 'active';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cb_channels_desliga_robos ON public.cb_channels;
CREATE TRIGGER cb_channels_desliga_robos
  BEFORE DELETE ON public.cb_channels
  FOR EACH ROW EXECUTE FUNCTION public.cb_desliga_robos_da_conexao();

-- Função de gatilho não é RPC: as duas metades do REVOKE (913/915).
REVOKE EXECUTE ON FUNCTION public.cb_desliga_robos_da_conexao() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  -- tgtype: bit 1 = BEFORE, bit 3 = DELETE (pg_trigger.h).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'cb_channels_desliga_robos'
       AND tgrelid = 'public.cb_channels'::regclass
       AND (tgtype & 2) = 2
       AND (tgtype & 8) = 8
  ) THEN
    RAISE EXCEPTION '1077: o gatilho BEFORE DELETE de cb_channels não está de pé';
  END IF;
  IF has_function_privilege('anon', 'public.cb_desliga_robos_da_conexao()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_desliga_robos_da_conexao()', 'EXECUTE') THEN
    RAISE EXCEPTION '1077: função de gatilho exposta como RPC';
  END IF;
END $$;

-- A prova de verdade precisa de uma conta com dono (num banco vazio, o replay
-- do CI, não há o que provar) e se DESFAZ pelo SQLSTATE próprio — nunca
-- `WHEN OTHERS`, que engoliria um erro de verdade. Nada é gravado: a conexão
-- e os robôs de prova somem no desfazer, e um desfazer não chega ao tempo
-- real.
--   1. O robô ATIVO da conexão apagada fica `draft` (e o SET NULL da FK roda).
--   2. O robô de OUTRA conexão não é tocado.
--   3. O rascunho da conexão apagada continua rascunho.
DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_canal uuid;
  v_vizinha uuid;
  v_robo uuid;
  v_robo_vizinho uuid;
  v_rascunho uuid;
  v_status text;
  v_canal_do_robo uuid;
BEGIN
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
   WHERE a.owner_user_id IS NOT NULL
   LIMIT 1;

  IF v_conta IS NULL THEN
    RAISE NOTICE '1077: banco sem conta, nada a provar.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.cb_channels (account_id, kind, label, server_url, instance_name, api_key)
    VALUES (v_conta, 'evolution', '1077: prova', 'https://prova.invalid', '1077-prova-' || gen_random_uuid(), 'x')
    RETURNING id INTO v_canal;
    INSERT INTO public.cb_channels (account_id, kind, label, server_url, instance_name, api_key)
    VALUES (v_conta, 'evolution', '1077: vizinha', 'https://prova.invalid', '1077-vizinha-' || gen_random_uuid(), 'x')
    RETURNING id INTO v_vizinha;

    INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, channel_id)
    VALUES (v_dono, v_conta, '1077: robô da conexão', 'active', 'manual', v_canal)
    RETURNING id INTO v_robo;
    INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, channel_id)
    VALUES (v_dono, v_conta, '1077: robô da vizinha', 'active', 'manual', v_vizinha)
    RETURNING id INTO v_robo_vizinho;
    INSERT INTO public.flows (user_id, account_id, name, status, trigger_type, channel_id)
    VALUES (v_dono, v_conta, '1077: rascunho da conexão', 'draft', 'manual', v_canal)
    RETURNING id INTO v_rascunho;

    DELETE FROM public.cb_channels WHERE id = v_canal;

    SELECT status, channel_id INTO STRICT v_status, v_canal_do_robo
      FROM public.flows WHERE id = v_robo;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION '1077: o robô da conexão apagada ficou %', v_status;
    END IF;
    IF v_canal_do_robo IS NOT NULL THEN
      RAISE EXCEPTION '1077: o SET NULL da FK não rodou';
    END IF;

    SELECT status INTO STRICT v_status FROM public.flows WHERE id = v_robo_vizinho;
    IF v_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION '1077: o robô de OUTRA conexão foi desligado';
    END IF;

    SELECT status INTO STRICT v_status FROM public.flows WHERE id = v_rascunho;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION '1077: o rascunho da conexão apagada ficou %', v_status;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1077', MESSAGE = '1077: desfaz a prova';
  EXCEPTION WHEN SQLSTATE 'P1077' THEN
    NULL;
  END;
END $$;
