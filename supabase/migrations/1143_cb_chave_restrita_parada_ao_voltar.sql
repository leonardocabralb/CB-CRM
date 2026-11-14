-- ============================================================
-- 1143 — A chave RESTRITA fica PARADA ao voltar a imagem, nunca aberta
--
-- Achado da revisão do porte ao Atlas: a imagem de antes da 1121 não conhece
-- `membro_user_id` nem `funis`. Voltar a imagem (rollback do serviço na VPS)
-- abria a chave recortada por funil para a conta INTEIRA (e soltava a
-- escrita, se o escopo a tivesse), e a chave do funcionário já removido ou
-- suspenso voltava a funcionar — falha ABERTA.
--
-- O que muda: a chave restrita (com `membro_user_id` ou `funis`) guarda o
-- hash com o prefixo `restrita-`, posto por GATILHO para todo escritor (as
-- rotas e o SQL à mão), com um CHECK que segura as duas formas. O app desta
-- versão procura as duas (`findActiveKeyByHash`, `PREFIXO_DA_CHAVE_RESTRITA`
-- em `src/lib/api-keys/keys.ts`); toda imagem de ANTES procura só o hash puro
-- e não acha a restrita: 401 até voltar à versão nova (falha FECHADA). A
-- chave da conta (n8n, Make, iMotion) não muda.
--
-- ⚠️ ORDEM: aplicar DEPOIS do deploy. O app desta versão acha a chave nas
-- duas formas; o app de antes, só na pura — com esta aplicada antes, a chave
-- restrita que já existe daria 401 até o deploy. Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '3s';

-- O prefixo da chave restrita (ver o cabeçalho). Hash puro é hexadecimal:
-- `restrita-` nunca colide com ele.
CREATE OR REPLACE FUNCTION public.cb_api_keys_hash_da_restrita()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_puro text := regexp_replace(NEW.key_hash, '^restrita-', '');
BEGIN
  NEW.key_hash := CASE
    WHEN NEW.membro_user_id IS NOT NULL OR NEW.funis IS NOT NULL THEN 'restrita-' || v_puro
    ELSE v_puro
  END;
  RETURN NEW;
END $$;

-- Função de gatilho: ninguém a chama de fora.
REVOKE EXECUTE ON FUNCTION public.cb_api_keys_hash_da_restrita() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cb_api_keys_hash_da_restrita_trigger ON public.api_keys;
CREATE TRIGGER cb_api_keys_hash_da_restrita_trigger
  BEFORE INSERT OR UPDATE OF key_hash, membro_user_id, funis ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.cb_api_keys_hash_da_restrita();

-- A chave restrita que já existe ganha o prefixo pelo gatilho, antes do CHECK.
UPDATE public.api_keys SET key_hash = key_hash
 WHERE (membro_user_id IS NOT NULL OR funis IS NOT NULL)
   AND NOT starts_with(key_hash, 'restrita-');

-- CHECK com nome (989): DROP + ADD pelo nome, idempotente.
ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_hash_da_restrita,
  ADD CONSTRAINT api_keys_hash_da_restrita
    CHECK ((membro_user_id IS NULL AND funis IS NULL) = NOT starts_with(key_hash, 'restrita-'));

-- ------------------------------------------------------------
-- Conferências
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname = 'api_keys_hash_da_restrita'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION '1143: CHECK api_keys_hash_da_restrita ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.api_keys'::regclass
       AND tgname = 'cb_api_keys_hash_da_restrita_trigger'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '1143: gatilho cb_api_keys_hash_da_restrita_trigger ausente';
  END IF;
END $$;

-- O gatilho EXERCITADO (o corpo plpgsql só é analisado quando roda), num
-- subbloco desfeito por SQLSTATE próprio. Precisa de uma conta com dono:
-- banco vazio pula com NOTICE.
DO $$
DECLARE
  v_conta uuid;
  v_dono  uuid;
  v_chave uuid;
  v_hash  text;
  v_puro  text := repeat('ab', 32);
BEGIN
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
   WHERE a.owner_user_id IS NOT NULL
   LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1143: banco vazio — o gatilho do prefixo não foi exercitado aqui.';
    RETURN;
  END IF;
  BEGIN
    -- A chave do funcionário nasce com o prefixo…
    INSERT INTO public.api_keys (account_id, created_by, name, key_prefix, key_hash, scopes, membro_user_id)
      VALUES (v_conta, v_dono, '__conferencia_1143__', 'conf_1143', v_puro, '{}', v_dono)
      RETURNING id, key_hash INTO v_chave, v_hash;
    IF v_hash IS DISTINCT FROM 'restrita-' || v_puro THEN
      RAISE EXCEPTION '1143: a chave do funcionário nasceu sem o prefixo (%)', v_hash;
    END IF;
    -- …e o perde quando deixa de ser restrita, sem dobrar nada.
    UPDATE public.api_keys SET membro_user_id = NULL WHERE id = v_chave RETURNING key_hash INTO v_hash;
    IF v_hash IS DISTINCT FROM v_puro THEN
      RAISE EXCEPTION '1143: a chave da conta ficou com o hash %', v_hash;
    END IF;
    -- O recorte por funil também é restrição.
    UPDATE public.api_keys SET funis = ARRAY[gen_random_uuid()] WHERE id = v_chave RETURNING key_hash INTO v_hash;
    IF v_hash IS DISTINCT FROM 'restrita-' || v_puro THEN
      RAISE EXCEPTION '1143: a chave recortada ficou sem o prefixo (%)', v_hash;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1143';
  EXCEPTION WHEN SQLSTATE 'P1143' THEN
    NULL;
  END;
  RAISE NOTICE '1143: a chave restrita guarda o hash com o prefixo (a imagem antiga não a acha).';
END $$;
