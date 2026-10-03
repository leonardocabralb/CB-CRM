-- 1078_cb_trajetorias_por_chave.sql
--
-- Desempenho da aba Funis, Fase 2 (docs/PLANO-desempenho-do-funil.md).
--
-- `cb_funil_trajetorias_por_chave` é a MESMA leitura da `cb_funil_trajetorias`
-- (975) — mesmo recorte, mesmas colunas, mesma RLS (SECURITY INVOKER) —, mas
-- paginada por CHAVE dentro da função.
--
-- Por quê (medido na produção em 03/10/2026): a 975 é paginada por OFFSET pelo
-- PostgREST (`order` + `range` + `count`), e a função SQL com `SET search_path`
-- não é embutida pelo planejador: CADA página recalculava o funil inteiro
-- (~550 ms no Trabalhista, com as três subconsultas por negócio rodando 3.772
-- vezes) para devolver mil linhas. A Saúde (12 meses) pedia 4 páginas em fila:
-- ~2,35 s. Aqui o recorte de chave entra ANTES do cálculo caro, e as
-- subconsultas só rodam para as linhas da página.
--
-- Contrato (quem chama: `src/lib/funil/carregar.ts`):
-- - `(p_chave_apos, p_chave_ate]` é a faixa de `deal_id` (nulo = sem limite
--   daquele lado). A página são os `p_limite` primeiros por `deal_id` dentro
--   dela; a próxima pede `p_chave_apos` = o último `deal_id` recebido.
-- - `restantes` = quantos negócios a faixa ainda tinha a partir desta página
--   (ela inclusive), contado ANTES do `LIMIT`. É o que fecha o laço sem
--   `count: exact` — e sem depender do teto de linhas do PostgREST: página
--   curta com `restantes` maior só continua pela chave, nunca pula linha.
-- - Faixas disjuntas podem ser pedidas EM PARALELO (o laço divide o espaço
--   de `deal_id` em quatro). Diferente do OFFSET, nenhuma linha que já existia
--   some entre uma página e outra: a chave não anda quando o banco muda.
-- - `p_desde`/`p_ate`: o MESMO superconjunto da 975 (criado no intervalo OU
--   com evento no intervalo; `p_ate` exclusivo; `p_desde` nulo = Total). O
--   recorte fino continua no TS. O pino `trajetorias-por-chave-1078.test.ts`
--   compara o texto do recorte com o da 975: mudou um, muda o outro.
--
-- A 975 FICA: a versão do app que está no ar ainda a chama durante o deploy.
-- Aditiva — aplicar ANTES do deploy.

CREATE OR REPLACE FUNCTION public.cb_funil_trajetorias_por_chave(
  p_pipeline_id uuid,
  p_desde timestamptz DEFAULT NULL,
  p_ate timestamptz DEFAULT NULL,
  p_chave_apos uuid DEFAULT NULL,
  p_chave_ate uuid DEFAULT NULL,
  p_limite integer DEFAULT 1000
)
RETURNS TABLE (
  deal_id uuid,
  contact_id uuid,
  conversation_id uuid,
  conversa_do_contato uuid,
  title text,
  value numeric,
  status text,
  pipeline_id uuid,
  stage_id uuid,
  channel_id uuid,
  source text,
  assigned_to uuid,
  created_at timestamptz,
  updated_at timestamptz,
  contato_nome text,
  contato_telefone text,
  contato_email text,
  contato_empresa text,
  contato_avatar text,
  campos jsonb,
  trajeto jsonb,
  restantes bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH tocados AS (
    -- quem já ENTROU em alguma etapa deste funil (criado aqui, movido aqui
    -- ou transferido para cá)
    SELECT DISTINCT e.deal_id
    FROM cb_lead_events e
    WHERE e.to_pipeline_id = p_pipeline_id
      AND e.deal_id IS NOT NULL
      AND e.event_type IN ('deal_created', 'stage_changed', 'pipeline_changed')
  ),
  alvo AS (
    SELECT d.*
    FROM deals d
    JOIN tocados t ON t.deal_id = d.id
    WHERE (p_chave_apos IS NULL OR d.id > p_chave_apos)
      AND (p_chave_ate IS NULL OR d.id <= p_chave_ate)
      AND (
    -- recorte do período (o mesmo texto da 975)
    p_desde IS NULL
       OR (d.created_at >= p_desde
           AND d.created_at < COALESCE(p_ate, 'infinity'::timestamptz))
       OR EXISTS (
         SELECT 1
         FROM cb_lead_events e
         WHERE e.deal_id = d.id
           AND e.occurred_at >= p_desde
           AND e.occurred_at < COALESCE(p_ate, 'infinity'::timestamptz)
       )
      )
  ),
  -- A página ANTES do cálculo caro: as subconsultas abaixo só rodam para as
  -- linhas dela. A janela conta a faixa inteira (antes do LIMIT).
  pagina AS (
    SELECT a.*, count(*) OVER () AS restantes
    FROM alvo a
    ORDER BY a.id
    LIMIT p_limite
  )
  SELECT
    a.id,
    a.contact_id,
    a.conversation_id,
    (SELECT c2.id
       FROM conversations c2
      WHERE c2.contact_id = a.contact_id
        AND c2.account_id = a.account_id
      ORDER BY c2.created_at
      LIMIT 1),
    a.title,
    a.value,
    a.status,
    a.pipeline_id,
    a.stage_id,
    a.channel_id,
    a.source,
    a.assigned_to,
    a.created_at,
    a.updated_at,
    c.name,
    c.phone,
    c.email,
    c.company,
    c.avatar_url,
    (SELECT jsonb_object_agg(f.field_key, v.value)
       FROM contact_custom_values v
       JOIN custom_fields f ON f.id = v.custom_field_id
      WHERE v.contact_id = a.contact_id
        AND coalesce(v.value, '') <> ''),
    (SELECT jsonb_agg(
              jsonb_build_object(
                'etapa',  e.to_stage_id,
                'funil',  e.to_pipeline_id,
                'em',     e.occurred_at,
                'origem', e.origin,
                'tipo',   e.event_type)
              ORDER BY e.occurred_at, e.id)
       FROM cb_lead_events e
      WHERE e.deal_id = a.id
        AND e.event_type IN ('deal_created', 'stage_changed', 'pipeline_changed')),
    a.restantes
  FROM pagina a
  LEFT JOIN contacts c ON c.id = a.contact_id
  ORDER BY a.id;
$$;

-- EXECUTE nasce concedido a PUBLIC; fechar exige as DUAS metades, e o REVOKE
-- de PUBLIC leva o service_role junto — devolver por escrito (o banco VAZIO
-- do replay não tem o default privilege do Supabase).
REVOKE EXECUTE ON FUNCTION public.cb_funil_trajetorias_por_chave(uuid, timestamptz, timestamptz, uuid, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_funil_trajetorias_por_chave(uuid, timestamptz, timestamptz, uuid, uuid, integer)
  TO authenticated, service_role;

-- SECURITY INVOKER: lê as tabelas com o privilégio de quem chama. Num banco
-- VAZIO o SELECT de `authenticated` não vem de default privilege; o que a
-- conferência abaixo exercita, a migration concede (idempotente; a RLS de
-- cada tabela continua mandando) — o mesmo GRANT da 975.
GRANT SELECT ON TABLE deals, contacts, conversations, contact_custom_values,
  custom_fields, cb_lead_events TO authenticated;

-- ---------------------------------------------------------------------------
-- Conferências — todas válidas num banco VAZIO (nenhuma exige dado).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.cb_funil_trajetorias_por_chave(uuid, timestamptz, timestamptz, uuid, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1078: anon ainda executa cb_funil_trajetorias_por_chave';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.cb_funil_trajetorias_por_chave(uuid, timestamptz, timestamptz, uuid, uuid, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role',
       'public.cb_funil_trajetorias_por_chave(uuid, timestamptz, timestamptz, uuid, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1078: authenticated/service_role sem EXECUTE em cb_funil_trajetorias_por_chave';
  END IF;
  -- A 975 continua de pé: a versão do app no ar a chama durante o deploy.
  IF to_regprocedure('public.cb_funil_trajetorias(uuid, timestamptz, timestamptz)') IS NULL THEN
    RAISE EXCEPTION '1078: cb_funil_trajetorias (975) sumiu';
  END IF;
END $$;

-- ⚠️ SECURITY INVOKER checa o privilégio de TUDO que roda dentro como quem
-- chamou, e o bloco acima roda como DONO: trocar de papel é a única prova de
-- que `authenticated` consegue chamar (lição da 929). Funil inexistente →
-- zero linhas, em qualquer banco.
DO $$
DECLARE
  v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n
    FROM public.cb_funil_trajetorias_por_chave(gen_random_uuid(), NULL, NULL, NULL, NULL, 1000);
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '1078: funil inexistente devolveu % linha(s)', v_n;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '1078: authenticated não consegue executar cb_funil_trajetorias_por_chave: %', SQLERRM;
END $$;
