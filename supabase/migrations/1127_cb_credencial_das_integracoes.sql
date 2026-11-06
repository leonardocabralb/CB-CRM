-- ============================================================
-- 1127 — A credencial de cada integração na tela (pedido do operador,
-- 06/11/2026; plano em docs/PLANO-credencial-das-integracoes.md).
--
-- Cada cartão de Configurações → Integrações passa a dizer QUAL chave está
-- guardada (só os 4 últimos caracteres, calculados no servidor), QUANDO ela
-- foi gravada, por QUEM, e quando foi testada pela última vez — com "Testar
-- agora" (a chave guardada, uma leitura só) e "Trocar chave" (sem
-- desconectar). O Atlas e o ZapSign já guardavam as duas datas (1071/1057);
-- tl;dv, Calendly, Meta Ads e Asaas ganham as MESMAS colunas aqui (e as
-- chaves de IA, `cb_ia_chaves.chave_gravada_em` — ver abaixo):
--   conectado_em  quando a chave ATUAL foi gravada (toda conexão e toda
--                 troca reescrevem)
--   conferido_em  a última vez que a chave guardada respondeu (ao gravar e
--                 no "Testar agora")
--
-- ⚠️ As linhas que já existem ficam com NULL, de propósito: a data em que a
-- chave atual foi gravada não está em lugar nenhum — `created_at` é a da
-- PRIMEIRA conexão (o upsert de uma troca não o reescreve) e `updated_at`
-- muda a cada sincronização. A tela diz "data não registrada" em vez de
-- afirmar uma data que pode ser de outra chave.
--
-- ADITIVA: aplicar ANTES do deploy (o app novo lê e grava as colunas; sem
-- elas o PostgREST recusa a escrita da conexão). As tabelas seguem fechadas
-- ao navegador (REVOKE de anon/authenticated nas 0976/0977/0987/0992): as
-- colunas novas herdam o GRANT ALL de tabela do service_role.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_tldv_config
  ADD COLUMN IF NOT EXISTS conectado_em timestamptz,
  ADD COLUMN IF NOT EXISTS conferido_em timestamptz;

ALTER TABLE public.cb_calendly_config
  ADD COLUMN IF NOT EXISTS conectado_em timestamptz,
  ADD COLUMN IF NOT EXISTS conferido_em timestamptz;

ALTER TABLE public.cb_meta_ads_config
  ADD COLUMN IF NOT EXISTS conectado_em timestamptz,
  ADD COLUMN IF NOT EXISTS conferido_em timestamptz;

ALTER TABLE public.cb_asaas_config
  ADD COLUMN IF NOT EXISTS conectado_em timestamptz,
  ADD COLUMN IF NOT EXISTS conferido_em timestamptz;

-- As chaves de IA (1047): `updated_at` NÃO serve de "gravada em". A 1047
-- copiou as chaves de `ai_configs` com `now()` e o autor da linha antiga, e
-- o gatilho temporário dela (até a 1048) reescrevia `updated_at` sem trocar
-- o autor: a tela diria "gravada em <dia da 1047> por <quem criou a config>".
-- `chave_gravada_em` é escrita SÓ por `gravarChave` (a tela); NULL = chave
-- anterior à 1127, e então o autor também não é afirmado.
ALTER TABLE public.cb_ia_chaves
  ADD COLUMN IF NOT EXISTS chave_gravada_em timestamptz;

COMMENT ON COLUMN public.cb_tldv_config.conectado_em IS 'Quando a chave atual foi gravada (conectar e trocar reescrevem). NULL = gravada antes da 1127.';
COMMENT ON COLUMN public.cb_tldv_config.conferido_em IS 'Última vez que a chave guardada respondeu (ao gravar e no "Testar agora").';
COMMENT ON COLUMN public.cb_calendly_config.conectado_em IS 'Quando o token atual foi gravado (conectar e trocar reescrevem). NULL = gravado antes da 1127.';
COMMENT ON COLUMN public.cb_calendly_config.conferido_em IS 'Última vez que o token guardado respondeu (ao gravar e no "Testar agora").';
COMMENT ON COLUMN public.cb_meta_ads_config.conectado_em IS 'Quando o token atual foi gravado (conectar e trocar reescrevem). NULL = gravado antes da 1127.';
COMMENT ON COLUMN public.cb_meta_ads_config.conferido_em IS 'Última vez que o token guardado respondeu (ao gravar e no "Testar agora").';
COMMENT ON COLUMN public.cb_asaas_config.conectado_em IS 'Quando a chave atual foi gravada (conectar e trocar reescrevem). NULL = gravada antes da 1127.';
COMMENT ON COLUMN public.cb_asaas_config.conferido_em IS 'Última vez que a chave guardada respondeu (ao gravar e no "Testar agora").';
COMMENT ON COLUMN public.cb_ia_chaves.chave_gravada_em IS 'Quando a chave atual foi gravada pela tela (gravarChave). NULL = gravada antes da 1127 (cópia da 1047): data e autor não são afirmados.';

-- ------------------------------------------------------------
-- Conferência: as seis tabelas de config têm as duas colunas, em
-- timestamptz, e seguem fechadas ao navegador. Não depende de dado.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tabela text;
  v_coluna text;
  v_tipo text;
BEGIN
  FOREACH v_tabela IN ARRAY ARRAY[
    'cb_tldv_config', 'cb_calendly_config', 'cb_meta_ads_config',
    'cb_asaas_config', 'cb_zapsign_config', 'cb_atlas_config'
  ] LOOP
    FOREACH v_coluna IN ARRAY ARRAY['conectado_em', 'conferido_em'] LOOP
      SELECT data_type INTO v_tipo
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = v_coluna;
      IF v_tipo IS DISTINCT FROM 'timestamp with time zone' THEN
        RAISE EXCEPTION '1127: %.% ausente ou com tipo errado (%)', v_tabela, v_coluna, v_tipo;
      END IF;
    END LOOP;
    IF has_table_privilege('anon', 'public.' || v_tabela, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || v_tabela, 'SELECT') THEN
      RAISE EXCEPTION '1127: % ficou legível ao navegador: ela guarda a chave cifrada', v_tabela;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || v_tabela, 'SELECT, UPDATE') THEN
      RAISE EXCEPTION '1127: service_role não lê nem grava %', v_tabela;
    END IF;
  END LOOP;

  SELECT data_type INTO v_tipo
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'cb_ia_chaves' AND column_name = 'chave_gravada_em';
  IF v_tipo IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION '1127: cb_ia_chaves.chave_gravada_em ausente ou com tipo errado (%)', v_tipo;
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_chaves', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_chaves', 'SELECT') THEN
    RAISE EXCEPTION '1127: cb_ia_chaves ficou legível ao navegador: ela guarda as chaves cifradas';
  END IF;
END
$$;
