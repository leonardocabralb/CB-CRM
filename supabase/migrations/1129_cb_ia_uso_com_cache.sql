-- ============================================================
-- 1129 — O uso de IA guarda o CACHE do provedor (09/11/2026).
--
-- O agente de IA passa a mandar o pedido em pedaços, com os FIXOS marcados
-- para o cache da Anthropic (`cache_control`, 1 h; `.claude/rules/
-- ia-cache-do-pedido.md`), e o Gemini faz cache sozinho (implícito). Com
-- cache, a Anthropic devolve a entrada em TRÊS números: o resto sem cache
-- (`input_tokens`), o gravado (`cache_creation_input_tokens`, cobrado a 2×
-- com 1 h) e o lido (`cache_read_input_tokens`, a 0,1×). O app soma os três em
-- `prompt_tokens` (a entrada INTEIRA, como antes) e guarda as duas partes do
-- cache aqui — sem elas, o custo estimado (D21, `precos.ts`) não saberia que
-- 97% da entrada saiu a 10% do preço, nem que a gravação custou o dobro.
--
-- 1. `ai_usage_log` ganha `cache_leitura_tokens` e `cache_escrita_tokens`
--    (nulos = a chamada não usou cache: Radar, transcrição, OpenAI e todo o
--    histórico de antes). Colunas sem DEFAULT: só catálogo, sem reescrever a
--    tabela.
-- 2. `cb_ia_uso` (1048/1108) soma as duas por dia, modo, agente, provedor,
--    modelo e faixa. ⚠️ DROP + CREATE, nunca `CREATE OR REPLACE`: o RETORNO
--    muda (duas colunas novas), e o Postgres recusa trocar o tipo de retorno
--    no lugar. Os mesmos parâmetros e o MESMO agrupamento da 1108 — o corte
--    100000 é o `LIMIAR_DA_FAIXA` (`src/lib/ia-agentes/precos.ts`), e a rota
--    pagina pelas seis chaves (pino `ia-uso-com-cache-1129.test.ts`).
--
-- ⚠️ ADITIVA, aplicar ANTES do deploy: o app novo grava as colunas novas
-- quando há cache, e o PostgREST recusa escrita em coluna que não existe
-- (`logAiUsage` engole o erro, e o custo da chamada SUMIRIA). O app ANTIGO
-- convive com tudo: não grava as colunas (ficam nulas) e lê as da função
-- pelo nome, ignorando as que sobram.
--
-- Privilégios na forma da 1108 e do banco VAZIO: `CREATE FUNCTION` nasce com
-- EXECUTE para PUBLIC, então REVOKE de PUBLIC, anon e authenticated e GRANT
-- de volta ao service_role (a rota lê com o cliente de serviço); a função é
-- INVOKER, e o service_role precisa ler `ai_usage_log` (repetido: o GRANT é
-- idempotente). Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS cache_leitura_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_escrita_tokens integer;

COMMENT ON COLUMN public.ai_usage_log.cache_leitura_tokens IS
  'Parte de prompt_tokens que veio do CACHE do provedor (Anthropic cache_read_input_tokens; Gemini cachedContentTokenCount). Nulo = sem cache. 1129.';
COMMENT ON COLUMN public.ai_usage_log.cache_escrita_tokens IS
  'Parte de prompt_tokens GRAVADA no cache (Anthropic cache_creation_input_tokens, TTL de 1 h, cobrada a 2x). Nulo = sem gravação. 1129.';

DROP FUNCTION IF EXISTS public.cb_ia_uso(uuid, timestamptz, text);

CREATE FUNCTION public.cb_ia_uso(
  p_account_id uuid,
  p_desde timestamptz,
  p_fuso text DEFAULT 'America/Sao_Paulo'
)
RETURNS TABLE (
  dia date,
  modo text,
  ia_agente_id uuid,
  ia_agente_nome text,
  provedor text,
  modelo text,
  acima_da_faixa boolean,
  chamadas bigint,
  tokens_entrada bigint,
  tokens_saida bigint,
  tokens_total bigint,
  tokens_cache_leitura bigint,
  tokens_cache_escrita bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT (l.created_at AT TIME ZONE p_fuso)::date AS dia,
         l.mode AS modo,
         l.ia_agente_id,
         max(l.ia_agente_nome) AS ia_agente_nome,
         l.provider AS provedor,
         l.model AS modelo,
         (coalesce(l.prompt_tokens, 0) > 100000) AS acima_da_faixa,
         count(*)::bigint AS chamadas,
         coalesce(sum(l.prompt_tokens), 0)::bigint AS tokens_entrada,
         coalesce(sum(l.completion_tokens), 0)::bigint AS tokens_saida,
         coalesce(sum(l.total_tokens), 0)::bigint AS tokens_total,
         coalesce(sum(l.cache_leitura_tokens), 0)::bigint AS tokens_cache_leitura,
         coalesce(sum(l.cache_escrita_tokens), 0)::bigint AS tokens_cache_escrita
    FROM ai_usage_log l
   WHERE l.account_id = p_account_id
     AND l.created_at >= p_desde
   GROUP BY 1, 2, 3, 5, 6, 7
   ORDER BY 1, 2, 3, 5, 6, 7;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_uso(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_uso(uuid, timestamptz, text) TO service_role;
-- A função é INVOKER: quem a chama precisa ler a tabela.
GRANT SELECT ON TABLE ai_usage_log TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo, privilégios e uma chamada; com
-- dado, a soma nova não perde nem duplica chamada).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conta uuid;
  v_desde timestamptz := now() - interval '30 days';
  v_no_log bigint;
  v_na_soma bigint;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_usage_log'
         AND column_name IN ('cache_leitura_tokens', 'cache_escrita_tokens')) <> 2 THEN
    RAISE EXCEPTION '1129: ai_usage_log sem as colunas do cache';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'cb_ia_uso') <> 1 THEN
    RAISE EXCEPTION '1129: cb_ia_uso tem de existir UMA vez (um overload sobrando deixa o RPC ambíguo)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'cb_ia_uso'
       AND 'acima_da_faixa' = ANY (p.proargnames)
       AND 'tokens_cache_leitura' = ANY (p.proargnames)
       AND 'tokens_cache_escrita' = ANY (p.proargnames)
  ) THEN
    RAISE EXCEPTION '1129: cb_ia_uso sem a faixa ou sem as colunas do cache';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1129: cb_ia_uso aberta ao navegador';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1129: service_role sem EXECUTE em cb_ia_uso';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ai_usage_log', 'SELECT') THEN
    RAISE EXCEPTION '1129: service_role não lê ai_usage_log (a função é INVOKER)';
  END IF;

  -- A função é CHAMADA (o corpo só é analisado de verdade quando roda): numa
  -- conta que não existe, ela devolve zero linhas sem erro.
  PERFORM 1 FROM public.cb_ia_uso('00000000-0000-0000-0000-000000000000'::uuid, now() - interval '1 day');

  -- Com dado: a conta mais recente do log. A soma nova não pode perder nem
  -- duplicar chamada — a soma de `chamadas` é a contagem das linhas.
  SELECT l.account_id INTO v_conta
    FROM ai_usage_log l
   WHERE l.created_at >= v_desde
   ORDER BY l.created_at DESC
   LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1129: nenhum uso de IA nos últimos 30 dias — nada a comparar.';
  ELSE
    SELECT count(*) INTO v_no_log
      FROM ai_usage_log l
     WHERE l.account_id = v_conta AND l.created_at >= v_desde;
    SELECT coalesce(sum(u.chamadas), 0) INTO v_na_soma
      FROM public.cb_ia_uso(v_conta, v_desde) u;
    IF v_no_log <> v_na_soma THEN
      RAISE EXCEPTION '1129: a soma tem % chamadas e o log % (conta %)', v_na_soma, v_no_log, v_conta;
    END IF;
    RAISE NOTICE '1129: % chamadas conferidas na conta %.', v_no_log, v_conta;
  END IF;
END $$;
