-- ============================================================
-- 1113 — O relatório de MOTIVOS do Desempenho
--
-- Plano: docs/PLANO-motivos-de-perda.md, Fase 4. A etapa com campo de motivo
-- (1112) pergunta por que o lead caiu; aqui o Desempenho soma as respostas.
--
-- `cb_motivos_do_funil(funil, desde, ate)` devolve, por etapa com motivo, os
-- CARDS que entraram nela no período, agrupados pelo valor ATUAL do campo
-- da etapa na ficha do contato. O card que ficou sem motivo vem separado por
-- QUEM o levou até a etapa (a ÚLTIMA entrada dele no período).
--
-- Contrato (quem chama: `src/lib/funil/motivos.ts`):
-- - Conta CARDS, não entradas: o card que entrou duas vezes na mesma etapa
--   conta uma (o mesmo jeito do cartão "Desqualificados", 1091). Entrada =
--   `deal_created`, `stage_changed` ou `pipeline_changed` com destino na
--   etapa — semente da 912 e trilha da Kommo (`retroativo`) inclusive, como
--   na desqualificação.
-- - `[p_desde, p_ate)`, nulo = sem limite daquele lado. Nos DOIS modos do
--   Desempenho a conta é pelo período (o motivo é do momento da saída).
-- - `motivo` nulo = a ficha não tem valor no campo da etapa. Só nessas linhas
--   vêm `origem`, `ator_id` e `ator_nome` (a foto do nome na trilha); com
--   motivo, eles vêm nulos e a linha soma todo mundo.
-- - ⚠️ A trilha só sabe dizer "pessoa" (`usuario`, com o ator) ou "sem
--   pessoa" (`sistema`: automação, robô, IA, API e integração, juntos — o
--   gatilho da 912 não distingue por dentro). Não prometer mais que isso.
-- - O motivo é do CONTATO (limite aceito do plano): lido pelo contato ATUAL
--   do card, que a fusão de fichas repõe. Card apagado não conta.
-- - Agregado no banco: algumas dezenas de linhas, longe do teto do PostgREST
--   (quem chama recusa resposta que bata no teto, nunca soma meia lista).
--
-- SECURITY INVOKER: a RLS de cada tabela manda (a conta de quem chama). O
-- índice `cb_lead_events_funil_idx` (to_pipeline_id, occurred_at) WHERE
-- deal_id IS NOT NULL serve o recorte — o predicado se repete abaixo.
--
-- ADITIVA: função nova, nada muda para o app no ar. Aplicar ANTES do deploy.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cb_motivos_do_funil(
  p_pipeline_id uuid,
  p_desde timestamptz DEFAULT NULL,
  p_ate timestamptz DEFAULT NULL
)
RETURNS TABLE (
  etapa_id uuid,
  motivo text,
  origem text,
  ator_id uuid,
  ator_nome text,
  cards bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH etapas AS (
    SELECT s.id, s.campo_do_motivo_id
      FROM pipeline_stages s
     WHERE s.pipeline_id = p_pipeline_id
       AND s.campo_do_motivo_id IS NOT NULL
  ),
  -- a ÚLTIMA entrada de cada card em cada etapa com motivo, no período
  entradas AS (
    SELECT DISTINCT ON (e.deal_id, e.to_stage_id)
           e.deal_id, e.to_stage_id, e.origin, e.actor_user_id, e.actor_label
      FROM cb_lead_events e
      JOIN etapas s ON s.id = e.to_stage_id
     WHERE e.to_pipeline_id = p_pipeline_id
       AND e.deal_id IS NOT NULL
       AND e.event_type IN ('deal_created', 'stage_changed', 'pipeline_changed')
       AND (p_desde IS NULL OR e.occurred_at >= p_desde)
       AND e.occurred_at < COALESCE(p_ate, 'infinity'::timestamptz)
     ORDER BY e.deal_id, e.to_stage_id, e.occurred_at DESC, e.id DESC
  ),
  -- o valor por subconsulta: contato e campo juntos casam o índice único
  -- (contact_id, custom_field_id) — a junção solta lia a ficha inteira
  lidas AS (
    SELECT en.to_stage_id AS etapa,
           NULLIF(btrim((SELECT v.value
                           FROM contact_custom_values v
                          WHERE v.contact_id = d.contact_id
                            AND v.custom_field_id = s.campo_do_motivo_id)), '') AS motivo,
           en.origin,
           en.actor_user_id,
           en.actor_label
      FROM entradas en
      JOIN deals d ON d.id = en.deal_id
      JOIN etapas s ON s.id = en.to_stage_id
  ),
  -- quem levou só importa no card SEM motivo; o ator apagado (id nulo) se
  -- separa pela foto do nome
  chaves AS (
    SELECT l.etapa,
           l.motivo,
           CASE WHEN l.motivo IS NULL THEN l.origin END AS origem,
           CASE WHEN l.motivo IS NULL THEN l.actor_user_id END AS ator_id,
           CASE WHEN l.motivo IS NULL THEN l.actor_label END AS ator_nome,
           CASE WHEN l.motivo IS NULL AND l.actor_user_id IS NULL THEN l.actor_label END AS nome_sem_id
      FROM lidas l
  )
  SELECT c.etapa, c.motivo, c.origem, c.ator_id, max(c.ator_nome), count(*)
    FROM chaves c
   GROUP BY c.etapa, c.motivo, c.origem, c.ator_id, c.nome_sem_id
   ORDER BY c.etapa, count(*) DESC, c.motivo;
$$;

-- EXECUTE nasce concedido a PUBLIC; o REVOKE de PUBLIC leva o service_role
-- junto — devolver por escrito (o banco VAZIO do replay não tem o default
-- privilege do Supabase).
REVOKE EXECUTE ON FUNCTION public.cb_motivos_do_funil(uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_motivos_do_funil(uuid, timestamptz, timestamptz)
  TO authenticated, service_role;

-- SECURITY INVOKER lê com o privilégio de quem chama: o que a conferência
-- abaixo exercita, a migration concede (idempotente; a RLS continua mandando).
-- `pipelines` e `contacts` entram pelas policies de `pipeline_stages` e de
-- `contact_custom_values`, que leem as duas.
GRANT SELECT ON TABLE pipelines, pipeline_stages, cb_lead_events, deals, contacts,
  contact_custom_values TO authenticated;

-- ---------------------------------------------------------------------------
-- Conferências — todas válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.cb_motivos_do_funil(uuid, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1113: anon ainda executa cb_motivos_do_funil';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.cb_motivos_do_funil(uuid, timestamptz, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.cb_motivos_do_funil(uuid, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1113: authenticated/service_role sem EXECUTE em cb_motivos_do_funil';
  END IF;
END $$;

-- ⚠️ SECURITY INVOKER checa o privilégio de TUDO que roda dentro como quem
-- chamou, e o bloco acima roda como DONO: trocar de papel é a única prova de
-- que `authenticated` consegue chamar. Funil inexistente → zero linhas.
DO $$
DECLARE
  v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n
    FROM public.cb_motivos_do_funil(gen_random_uuid(), NULL, NULL);
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '1113: funil inexistente devolveu % linha(s)', v_n;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '1113: authenticated não consegue executar cb_motivos_do_funil: %', SQLERRM;
END $$;
