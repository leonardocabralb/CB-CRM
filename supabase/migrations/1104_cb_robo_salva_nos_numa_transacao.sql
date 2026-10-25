-- ============================================================
-- 1104 — Salvar o robô troca os nós NUMA TRANSAÇÃO (`cb_trocar_nos_do_robo`;
-- adaptado do #674 do original, `052_flow_run_integrity`).
--
-- `PUT /api/flows/[id]` apagava TODOS os nós do robô e inseria os novos em
-- duas idas ao banco, sem transação. Quando o INSERT era recusado — um tipo de
-- nó fora do CHECK de `flow_nodes.node_type` (nó novo exige migration, 1053, e
-- o app pode chegar antes dela), dois nós com a mesma chave, uma posição que
-- não é inteira —, o DELETE já tinha valido: o robô ficava SEM NÓ NENHUM, e um
-- robô ativo encerrava toda run seguinte em `node_not_found`.
--
-- A troca passa a ser UMA chamada: a função apaga e insere na mesma
-- transação, e qualquer recusa desfaz as duas — os nós de antes ficam como
-- estavam.
--
-- O que ela faz:
--   * recusa `p_nodes` que não é lista JSON (22023): apagar sem ter o que
--     inserir é justamente o que não pode acontecer;
--   * trava a linha do robô (`FOR UPDATE`): dois salvamentos do mesmo robô se
--     enfileiram (o segundo apaga o que o primeiro gravou e grava o seu) em
--     vez de o segundo estourar 23505 em `(flow_id, node_key)`; robô que não
--     existe é recusado (P0002) antes de apagar qualquer coisa;
--   * grava `node_key`, `node_type`, `config` (ausente ou `null` vira `{}`) e
--     `position_x`/`position_y` (ausentes viram 0) — os campos e os padrões do
--     INSERT que a rota fazia —, e devolve quantos nós gravou.
--
-- O que ela NÃO faz (≠ a 052 do original):
--   * não recria o CHECK de `flow_runs.status`: o deles volta SEM os nossos
--     `stopped_by_automation`/`stopped_by_agent` (0936/0955), e toda parada do
--     robô pela equipe ou por automação passaria a estourar;
--   * não cancela run (o status `cancelled` não existe aqui) nem cria
--     `transition_seq`;
--   * não confere QUEM chama: é SECURITY INVOKER e só o `service_role`
--     executa — a rota chama DEPOIS das guardas dela (`requireRole('admin')` e
--     o robô visível pela RLS de quem pediu). `flows.entry_node_id` é TEXTO (o
--     `node_key`), sem FK: trocar os nós não o toca.
--
-- ADITIVA: o app novo chama a função; o antigo não a conhece. Aplicar ANTES
-- do deploy — sem ela, salvar o robô responde 500 e nada muda (os nós e o
-- cabeçalho ficam intactos: a rota troca os nós ANTES de gravar o resto).
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cb_trocar_nos_do_robo(p_flow_id uuid, p_nodes jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_gravados integer;
BEGIN
  IF p_nodes IS NULL OR jsonb_typeof(p_nodes) <> 'array' THEN
    RAISE EXCEPTION 'cb_trocar_nos_do_robo: p_nodes tem de ser uma lista JSON (veio %)',
      coalesce(jsonb_typeof(p_nodes), 'nulo')
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.flows WHERE id = p_flow_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cb_trocar_nos_do_robo: o robô % não existe', p_flow_id
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.flow_nodes WHERE flow_id = p_flow_id;

  INSERT INTO public.flow_nodes (flow_id, node_key, node_type, config, position_x, position_y)
  SELECT p_flow_id,
         e.item ->> 'node_key',
         e.item ->> 'node_type',
         coalesce(nullif(e.item -> 'config', 'null'::jsonb), '{}'::jsonb),
         coalesce((e.item ->> 'position_x')::integer, 0),
         coalesce((e.item ->> 'position_y')::integer, 0)
    FROM jsonb_array_elements(p_nodes) WITH ORDINALITY AS e(item, ordem)
   ORDER BY e.ordem;
  GET DIAGNOSTICS v_gravados = ROW_COUNT;
  RETURN v_gravados;
END;
$$;

COMMENT ON FUNCTION public.cb_trocar_nos_do_robo(uuid, jsonb) IS
  'Troca TODOS os nós do robô numa transação (PUT /api/flows/[id]): recusa lista que não é lista, trava o robô, apaga e insere — qualquer recusa desfaz as duas e os nós de antes ficam. Só o service_role executa.';

-- As duas metades do REVOKE (PUBLIC e os papéis) e o GRANT de volta: em banco
-- novo o EXECUTE nasce em PUBLIC, e o service_role o perderia junto.
REVOKE ALL ON FUNCTION public.cb_trocar_nos_do_robo(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_trocar_nos_do_robo(uuid, jsonb) TO service_role;

-- O PostgREST converte o corpo pelo TIPO dos argumentos que tem em cache.
-- Sem ninguém ouvindo (o replay do CI), é no-op.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Conferência. Confere o RESULTADO, não a intenção — e CHAMA a função (o
-- corpo de uma plpgsql só é analisado quando roda), como o PostgREST chama
-- (corpo JSON convertido para o tipo de cada argumento) e como QUEM chama (o
-- service_role: SECURITY INVOKER checa tudo o que roda dentro como ele). Tudo
-- num subbloco desfeito pelo SQLSTATE próprio (P1104): nada sobra.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_quantas  integer;
  v_oid      regprocedure;
  v_definer  boolean;
  v_robo     uuid;
  v_antes    jsonb;
  v_depois   jsonb;
  v_gravados integer;
  v_estado   text;
BEGIN
  -- 1. Uma função só, (uuid, jsonb), SECURITY INVOKER.
  SELECT count(*) INTO v_quantas
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cb_trocar_nos_do_robo';
  IF v_quantas <> 1 THEN
    RAISE EXCEPTION '1104: % assinatura(s) de cb_trocar_nos_do_robo (esperado 1)', v_quantas;
  END IF;
  v_oid := to_regprocedure('public.cb_trocar_nos_do_robo(uuid,jsonb)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '1104: cb_trocar_nos_do_robo não é (uuid, jsonb)';
  END IF;
  SELECT p.prosecdef INTO v_definer FROM pg_proc p WHERE p.oid = v_oid;
  IF v_definer THEN
    RAISE EXCEPTION '1104: cb_trocar_nos_do_robo tem de ser SECURITY INVOKER';
  END IF;

  -- 2. Privilégios: as duas metades.
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '1104: anon/authenticated conseguem executar cb_trocar_nos_do_robo';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '1104: o service_role perdeu o EXECUTE de cb_trocar_nos_do_robo';
  END IF;

  -- 3. A chamada. O robô com MAIS nós (o dado deriva do banco); sem robô
  --    nenhum, só o que não precisa de dado.
  SELECT f.id INTO v_robo
    FROM public.flows f
    LEFT JOIN public.flow_nodes n ON n.flow_id = f.id
   GROUP BY f.id
   ORDER BY count(n.id) DESC, f.id
   LIMIT 1;

  BEGIN
    SET LOCAL ROLE service_role;

    -- 3a. A lista que não é lista é recusada ANTES de apagar.
    BEGIN
      PERFORM public.cb_trocar_nos_do_robo(coalesce(v_robo, gen_random_uuid()), '{"node_key": "x"}'::jsonb);
      v_estado := 'aceitou';
    EXCEPTION WHEN invalid_parameter_value THEN
      v_estado := 'recusou';
    END;
    IF v_estado <> 'recusou' THEN
      RAISE EXCEPTION '1104: p_nodes que não é lista foi aceito';
    END IF;

    -- 3b. O robô que não existe é recusado (e o FOR UPDATE roda como o
    --     service_role: sem UPDATE em `flows`, estouraria 42501 aqui).
    BEGIN
      PERFORM public.cb_trocar_nos_do_robo(gen_random_uuid(), '[]'::jsonb);
      v_estado := 'aceitou';
    EXCEPTION WHEN no_data_found THEN
      v_estado := 'recusou';
    END;
    IF v_estado <> 'recusou' THEN
      RAISE EXCEPTION '1104: robô inexistente foi aceito';
    END IF;

    IF v_robo IS NOT NULL THEN
      -- Os nós de hoje, na forma em que a rota os manda.
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'node_key', node_key, 'node_type', node_type,
               'config', coalesce(nullif(config, 'null'::jsonb), '{}'::jsonb),
               'position_x', position_x, 'position_y', position_y) ORDER BY node_key), '[]'::jsonb)
        INTO v_antes
        FROM public.flow_nodes WHERE flow_id = v_robo;

      -- 3c. Regravar os MESMOS nós pelo caminho do PostgREST.
      SELECT public.cb_trocar_nos_do_robo(a.p_flow_id, a.p_nodes) INTO v_gravados
        FROM json_to_record(json_build_object('p_flow_id', v_robo, 'p_nodes', v_antes))
             AS a(p_flow_id uuid, p_nodes jsonb);
      IF v_gravados <> jsonb_array_length(v_antes) THEN
        RAISE EXCEPTION '1104: a função gravou % nó(s), esperado %', v_gravados, jsonb_array_length(v_antes);
      END IF;
      -- ⚠️ OUTRA instrução: na mesma, a foto seria a de antes do INSERT.
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'node_key', node_key, 'node_type', node_type,
               'config', coalesce(nullif(config, 'null'::jsonb), '{}'::jsonb),
               'position_x', position_x, 'position_y', position_y) ORDER BY node_key), '[]'::jsonb)
        INTO v_depois
        FROM public.flow_nodes WHERE flow_id = v_robo;
      IF v_depois IS DISTINCT FROM v_antes THEN
        RAISE EXCEPTION '1104: os nós regravados não são os de antes';
      END IF;

      -- 3d. Um tipo que o CHECK recusa: a chamada estoura e os nós de antes
      --     ficam — o defeito que esta migration existe para matar.
      BEGIN
        PERFORM public.cb_trocar_nos_do_robo(
          v_robo,
          v_antes || '[{"node_key": "conferencia_1104", "node_type": "tipo_que_nao_existe", "config": {}}]'::jsonb
        );
        v_estado := 'aceitou';
      EXCEPTION WHEN check_violation THEN
        v_estado := 'recusou';
      END;
      IF v_estado <> 'recusou' THEN
        RAISE EXCEPTION '1104: o CHECK de node_type deixou passar um tipo inventado';
      END IF;
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'node_key', node_key, 'node_type', node_type,
               'config', coalesce(nullif(config, 'null'::jsonb), '{}'::jsonb),
               'position_x', position_x, 'position_y', position_y) ORDER BY node_key), '[]'::jsonb)
        INTO v_depois
        FROM public.flow_nodes WHERE flow_id = v_robo;
      IF v_depois IS DISTINCT FROM v_antes THEN
        RAISE EXCEPTION '1104: a troca recusada mexeu nos nós de antes';
      END IF;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1104', MESSAGE = 'desfaz a chamada de conferência';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio: `WHEN OTHERS` engoliria o erro que a chamada
    -- existe para mostrar.
    WHEN SQLSTATE 'P1104' THEN
      IF v_robo IS NULL THEN
        RAISE NOTICE '1104: banco vazio — a função EXECUTOU como service_role nas duas recusas (lista que não é lista, robô inexistente); a regravação de nós não foi provada aqui.';
      ELSE
        RAISE NOTICE '1104: a função EXECUTOU como service_role: regravou os % nó(s) do robô % iguais e recusou o tipo inventado sem tocar nos de antes (tudo desfeito).',
          v_gravados, v_robo;
      END IF;
  END;
END $$;
