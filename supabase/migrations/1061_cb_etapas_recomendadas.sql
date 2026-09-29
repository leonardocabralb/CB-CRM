-- ============================================================
-- 1061 — Etapas recomendadas: o botão "avançar" do painel da conversa.
--
-- Pedido do operador (28–29/09/2026): no cartão de negócio da conversa, um
-- botão que leva o card à próxima etapa num clique, com as outras opções
-- como links. A regra, decidida por ele: AUTOMÁTICA e só para a frente por
-- padrão, e escolhida à mão, por etapa, no "Gerenciar funil" quando o
-- automático não serve.
--
-- Duas peças:
--
-- 1. `pipeline_stages.proximas_etapas uuid[]` — a escolha à mão, na ordem:
--    a primeira é o botão principal, as outras viram links.
--      NULL = automático (o padrão; toda etapa nasce e continua assim)
--      '{}' = nenhuma: o botão não aparece nesta etapa
--    ⚠️ Array não tem FK: etapa apagada deixa o id órfão aqui, e quem lê
--    (`src/lib/pipelines/etapas-recomendadas.ts`) o ignora. Etapa de OUTRO
--    funil também é ignorada — o botão move dentro do funil.
--
-- 2. `cb_movimentos_entre_etapas(funil, desde)` — os movimentos de etapa
--    DENTRO do funil desde um instante, contados por (de, para). É a base do
--    automático; a regra (só para a frente, mínimo de movimentos, perda por
--    último) mora no TS, pura e testada.
--    ⚠️ O recorte é por `occurred_at`, NUNCA `created_at`: a carga da Kommo
--    (1014+) gravou a trilha retroativa em setembro, com a data histórica em
--    `occurred_at` — medido em 29/09/2026, 6.265 dos 6.273 `stage_changed`
--    tinham `created_at` nos últimos 30 dias. Por `created_at`, a janela
--    "30 dias" contaria a história inteira da Kommo.
--    SECURITY INVOKER: quem chama só conta a trilha que a RLS da
--    `cb_lead_events` (912/1032) já lhe mostra. `LANGUAGE sql`: o corpo é
--    conferido no CREATE, ao contrário do plpgsql.
--    `deal_id IS NOT NULL` casa o índice parcial `cb_lead_events_funil_idx`
--    (975) — todo `stage_changed` tem negócio.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS proximas_etapas uuid[];

COMMENT ON COLUMN public.pipeline_stages.proximas_etapas IS
  'Etapas que o botão "avançar" do painel recomenda depois desta, na ordem (a primeira é o botão principal). NULL = automático (para a frente, 30 dias); vazio = nenhuma.';

CREATE OR REPLACE FUNCTION public.cb_movimentos_entre_etapas(
  p_pipeline_id uuid,
  p_desde timestamptz
)
RETURNS TABLE (de uuid, para uuid, vezes integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT e.from_stage_id, e.to_stage_id, count(*)::integer
    FROM public.cb_lead_events e
   WHERE e.event_type = 'stage_changed'
     AND e.deal_id IS NOT NULL
     AND e.to_pipeline_id = p_pipeline_id
     AND e.from_pipeline_id = p_pipeline_id
     AND e.occurred_at >= p_desde
     AND e.from_stage_id IS NOT NULL
     AND e.to_stage_id IS NOT NULL
     AND e.from_stage_id <> e.to_stage_id
   GROUP BY e.from_stage_id, e.to_stage_id
$$;

-- As duas metades do REVOKE (PUBLIC e os papéis) e o GRANT de volta: a
-- forma da concessão varia por função (ver CLAUDE.md, "Fechar EXECUTE").
REVOKE EXECUTE ON FUNCTION public.cb_movimentos_entre_etapas(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_movimentos_entre_etapas(uuid, timestamptz)
  TO authenticated, service_role;

-- A função é INVOKER: quem chama precisa de SELECT na trilha. Em produção a
-- 912 já concedeu; em banco novo (o replay do CI) é esta linha que concede.
GRANT SELECT ON public.cb_lead_events TO authenticated;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.pipeline_stages'::regclass
     AND a.attname = 'proximas_etapas'
     AND NOT a.attisdropped;
  IF v_tipo IS DISTINCT FROM 'uuid[]' THEN
    RAISE EXCEPTION '1061: pipeline_stages.proximas_etapas deveria ser uuid[], é %', v_tipo;
  END IF;

  IF (SELECT count(*) FROM pg_proc
       WHERE proname = 'cb_movimentos_entre_etapas'
         AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION '1061: esperava UMA função cb_movimentos_entre_etapas';
  END IF;

  IF has_function_privilege('anon', 'public.cb_movimentos_entre_etapas(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1061: anon não pode executar cb_movimentos_entre_etapas';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cb_movimentos_entre_etapas(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1061: authenticated precisa executar cb_movimentos_entre_etapas';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_movimentos_entre_etapas(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1061: service_role precisa executar cb_movimentos_entre_etapas';
  END IF;
END $$;

-- SECURITY INVOKER checa o privilégio de TUDO que roda dentro, como quem
-- chamou: a chamada troca de papel. Sem claims de usuário a RLS devolve zero
-- linhas — o que se prova aqui é que `authenticated` consegue executar, não
-- o conteúdo (vale igual num banco vazio).
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM 1 FROM public.cb_movimentos_entre_etapas(gen_random_uuid(), now() - interval '30 days');
  RESET ROLE;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '1061: authenticated não consegue executar cb_movimentos_entre_etapas: %', SQLERRM;
END $$;
