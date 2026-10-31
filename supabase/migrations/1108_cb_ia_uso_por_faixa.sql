-- ============================================================
-- 1108 — A soma do uso de IA (`cb_ia_uso`, 1048) separa a FAIXA do pedido.
--
-- O Haiku 5.5 (o modelo padrão da Anthropic desde 25/10/2026) tem DUAS
-- tabelas de preço pelo tamanho de CADA pedido: até 100 mil tokens de
-- entrada, US$ 0,10/0,50 por milhão; acima, US$ 0,50/2,50 — entrada E saída
-- (platform.claude.com/docs/en/about-claude/pricing, 25/10/2026). A soma da
-- 1048 juntava o dia inteiro de um modelo numa linha só, sem o tamanho de
-- cada pedido, e o app deixou o Haiku 5.5 "sem preço" de propósito: com a
-- tabela baixa, o PDF longo da leitura sairia 5× mais barato.
--
-- Aqui a função ganha a coluna `acima_da_faixa` (`prompt_tokens > 100000` da
-- linha de `ai_usage_log`, que é UMA chamada — `logAiUsage`) e agrupa também
-- por ela. Linha sem contagem (`prompt_tokens` nulo) fica ABAIXO, nunca nula:
-- a soma já a conta como zero, e uma faixa nula deixaria o modelo "sem preço". ⚠️ O corte 100000 é o MESMO de `LIMIAR_DA_FAIXA`
-- (`src/lib/ia-agentes/precos.ts`); o pino `ia-uso-por-faixa-1108.test.ts` os
-- compara. Mudou um, muda o outro (e a migration é nova).
--
-- ⚠️ DROP + CREATE, nunca `CREATE OR REPLACE`: o RETORNO muda (coluna nova),
-- e o Postgres recusa trocar o tipo de retorno no lugar. Os mesmos
-- parâmetros: nenhum overload sobra para o RPC.
--
-- ⚠️ ADITIVA, aplicar ANTES do deploy: o app novo ORDENA a paginação pela
-- coluna nova (`/api/cb/ia/uso`), e ordenar por coluna que a função não tem é
-- erro do PostgREST. O app ANTIGO convive com a função nova: lê as colunas
-- pelo nome e ignora a que sobra; o Haiku 5.5 continua "sem preço" nele
-- (a tabela antiga não tem a linha). Limite conhecido do app antigo: a ordem
-- dele (cinco chaves) deixa de ser total — duas linhas de um modelo podem
-- empatar, e só com MAIS de 1000 linhas no período a fronteira da página
-- poderia repetir uma e pular a outra (a conta tem poucas dezenas).
--
-- Privilégios na forma da 1048 e do banco VAZIO: `CREATE FUNCTION` nasce com
-- EXECUTE para PUBLIC, então REVOKE de PUBLIC, anon e authenticated e GRANT
-- de volta ao service_role (a rota lê com o cliente de serviço); a função é
-- INVOKER, e o service_role precisa ler `ai_usage_log` (repetido da 1048: o
-- GRANT é idempotente). Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '5s';

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
  tokens_total bigint
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
         coalesce(sum(l.total_tokens), 0)::bigint AS tokens_total
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
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'cb_ia_uso') <> 1 THEN
    RAISE EXCEPTION '1108: cb_ia_uso tem de existir UMA vez (um overload sobrando deixa o RPC ambíguo)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'cb_ia_uso'
       AND 'acima_da_faixa' = ANY (p.proargnames)
  ) THEN
    RAISE EXCEPTION '1108: cb_ia_uso sem a coluna acima_da_faixa';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1108: cb_ia_uso aberta ao navegador';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1108: service_role sem EXECUTE em cb_ia_uso';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ai_usage_log', 'SELECT') THEN
    RAISE EXCEPTION '1108: service_role não lê ai_usage_log (a função é INVOKER)';
  END IF;

  -- A função é CHAMADA (o corpo só é analisado de verdade quando roda): numa
  -- conta que não existe, ela devolve zero linhas sem erro.
  PERFORM 1 FROM public.cb_ia_uso('00000000-0000-0000-0000-000000000000'::uuid, now() - interval '1 day');

  -- Com dado: a conta mais recente do log. Separar a faixa não pode perder
  -- nem duplicar chamada — a soma de `chamadas` é a contagem das linhas.
  SELECT l.account_id INTO v_conta
    FROM ai_usage_log l
   WHERE l.created_at >= v_desde
   ORDER BY l.created_at DESC
   LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1108: nenhum uso de IA nos últimos 30 dias — nada a comparar.';
  ELSE
    SELECT count(*) INTO v_no_log
      FROM ai_usage_log l
     WHERE l.account_id = v_conta AND l.created_at >= v_desde;
    SELECT coalesce(sum(u.chamadas), 0) INTO v_na_soma
      FROM public.cb_ia_uso(v_conta, v_desde) u;
    IF v_no_log <> v_na_soma THEN
      RAISE EXCEPTION '1108: a soma tem % chamadas e o log % (conta %)', v_na_soma, v_no_log, v_conta;
    END IF;
    RAISE NOTICE '1108: % chamadas conferidas na conta %.', v_no_log, v_conta;
  END IF;
END $$;
