-- 1153 — Instagram Direct pelo login unificado (Facebook Login for Business).
--
-- Estudo: docs/ESTUDO-instagram-login-unificado.md · Plano: U-1 de
-- docs/PLANO-instagram-login-unificado.md.
--
-- App criado hoje na Meta já não monta o login do Instagram (medido em
-- 21/11/2026): só o login unificado, com o App ID e o App Secret PRINCIPAIS do
-- app, um ID de configuração (`config_id`) e um token do usuário do sistema que
-- fala com `graph.facebook.com`. Esta migration deixa as duas formas
-- conviverem, conexão por conexão:
--
--   1. `cb_channels.ig_login`: por qual login a conexão entrou. `instagram`
--      (o de hoje, padrão de toda linha que já existe), `unificado` (o app da
--      própria conta) ou `central` (o app da Atlas, pela central — U-3; o valor
--      entra já para o CHECK não precisar de outra migration).
--   2. `cb_channels.ig_client_business_id`: o portfólio do cliente que a
--      troca do login devolve. A doc manda guardá-lo com o token.
--   3. `cb_instagram_config.login` + `config_id`: qual login o app da conta
--      usa. No `unificado`, `ig_app_id`/`ig_app_secret` guardam o App ID e o
--      App Secret PRINCIPAIS (Configurações do app → Básico).
--
-- ⚠️ `cb_channels.ig_app_secret` continua obrigatório (CHECK da 989) e passa a
-- querer dizer "o segredo que ASSINA a entrega desta conexão": o Instagram App
-- Secret no login do Instagram (Teste B, 09/09) e o App Secret principal no
-- unificado (doc de 22/11). Por isso o webhook não muda, e a DM em dobro da
-- migração (estudo, §2.5) se barra sozinha: a conta tem UMA linha (índice
-- único global de `ig_user_id`), e ela só casa a assinatura de um dos apps.
--
-- ADITIVA: o app novo lê e grava as colunas; aplicar ANTES do deploy. O app
-- antigo não as conhece, e o padrão `instagram` é exatamente o que ele faz.
-- Nenhum privilégio novo: colunas herdam os da tabela (`cb_instagram_config`
-- segue fechada ao navegador, 990). `cb_channels` está na publicação realtime
-- com lista FIXA de colunas (909): as novas não viajam, e ninguém precisa.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_channels
  ADD COLUMN IF NOT EXISTS ig_login text NOT NULL DEFAULT 'instagram',
  ADD COLUMN IF NOT EXISTS ig_client_business_id text;

ALTER TABLE public.cb_channels
  DROP CONSTRAINT IF EXISTS cb_channels_ig_login_check;
ALTER TABLE public.cb_channels
  ADD CONSTRAINT cb_channels_ig_login_check
  CHECK (ig_login IN ('instagram', 'unificado', 'central'));

COMMENT ON COLUMN public.cb_channels.ig_login IS
  'Instagram: por qual login a conexão entrou — instagram (graph.instagram.com, token de 60 dias), unificado (app da conta, graph.facebook.com, token do usuário do sistema) ou central (app da Atlas pela central). 1153.';
COMMENT ON COLUMN public.cb_channels.ig_client_business_id IS
  'Instagram, login unificado: o portfólio do cliente devolvido pela troca do login (/me?fields=client_business_id). 1153.';
COMMENT ON COLUMN public.cb_channels.ig_app_secret IS
  'Instagram: o segredo que ASSINA a entrega do webhook desta conexão, cifrado — o Instagram App Secret no login do Instagram, o App Secret principal no unificado (1153).';

ALTER TABLE public.cb_instagram_config
  ADD COLUMN IF NOT EXISTS login text NOT NULL DEFAULT 'instagram',
  ADD COLUMN IF NOT EXISTS config_id text;

ALTER TABLE public.cb_instagram_config
  DROP CONSTRAINT IF EXISTS cb_instagram_config_login_check;
-- O `config_id` é numérico como o App ID. Conferido aqui pelo mesmo motivo da
-- 990: um valor colado com espaço viraria uma tela de erro da Meta sem código.
-- ⚠️ O `IS NOT NULL` é a metade que importa: com `config_id` nulo, `~` dá NULL,
-- e CHECK que dá NULL PASSA (medido no replay local).
ALTER TABLE public.cb_instagram_config
  ADD CONSTRAINT cb_instagram_config_login_check
  CHECK (
    (login = 'instagram')
    OR (login = 'unificado' AND config_id IS NOT NULL AND config_id ~ '^[0-9]{5,32}$')
  );

COMMENT ON COLUMN public.cb_instagram_config.login IS
  'Qual login o app da conta usa: instagram (Instagram App ID/Secret) ou unificado (App ID/Secret principais + config_id). 1153.';
COMMENT ON COLUMN public.cb_instagram_config.config_id IS
  'Login unificado: o ID da configuração do Facebook Login for Business. 1153.';

-- ---------------------------------------------------------------------------
-- Conferências — válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cb_channels'
         AND column_name IN ('ig_login', 'ig_client_business_id')) <> 2 THEN
    RAISE EXCEPTION '1153: faltam colunas em cb_channels';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cb_instagram_config'
         AND column_name IN ('login', 'config_id')) <> 2 THEN
    RAISE EXCEPTION '1153: faltam colunas em cb_instagram_config';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_channels'::regclass
       AND conname = 'cb_channels_ig_login_check'
  ) THEN
    RAISE EXCEPTION '1153: CHECK de cb_channels.ig_login ausente';
  END IF;

  -- A 989 segue de pé: toda conexão do Instagram com o segredo que assina.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_channels'::regclass
       AND pg_get_constraintdef(oid) LIKE '%ig_app_secret%'
  ) THEN
    RAISE EXCEPTION '1153: o CHECK da 989 que exige ig_app_secret sumiu';
  END IF;

  -- A tabela do app segue fechada ao navegador (990).
  IF has_table_privilege('authenticated', 'public.cb_instagram_config', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_instagram_config', 'SELECT') THEN
    RAISE EXCEPTION '1153: cb_instagram_config ficou legível pelo navegador';
  END IF;

  RAISE NOTICE '1153: ok — ig_login e ig_client_business_id em cb_channels; login e config_id em cb_instagram_config.';
END $$;
