-- ============================================================
-- 1145 — O episódio do alarme da IA PARADO há mais de 24 h abre um NOVO
-- (achado da revisão do porte ao Atlas)
--
-- Na 1140, o episódio (conta, provedor) só fecha quando AQUELE provedor gera
-- de novo. O escritório que troca o agente de provedor deixa o episódio
-- aberto para sempre, e a falha de semanas depois chegava como "Continua",
-- com o "desde" e a contagem do episódio velho.
--
-- O que muda, e só isto: o corpo de `cb_ia_registrar_falha`. O episódio
-- aberto sem falha nova há mais de 24 h (`ultima_falha_em`) é tratado como
-- fechado: a próxima falha abre um NOVO (`acao = 'abriu'`, o aviso de
-- "parou"). Assinatura, retorno e privilégios iguais aos da 1140.
--
-- ⚠️ Não se edita a 1140 (já aplicada). Sem dependência de ordem com o
-- deploy: o app chama a mesma função, com a mesma forma.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cb_ia_registrar_falha(
  p_conta uuid,
  p_provedor text,
  p_motivo text,
  p_lembrar_apos_min integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v public.cb_ia_alarmes%ROWTYPE;
BEGIN
  LOOP
    SELECT * INTO v
      FROM public.cb_ia_alarmes
     WHERE account_id = p_conta AND provedor = p_provedor
       FOR UPDATE;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.cb_ia_alarmes (account_id, provedor, desde, ultima_falha_em, ultimo_aviso_em, falhas, motivo)
        VALUES (p_conta, p_provedor, now(), now(), now(), 1, p_motivo);
        RETURN jsonb_build_object('acao', 'abriu', 'desde', now(), 'falhas', 1);
      EXCEPTION WHEN unique_violation THEN
        -- Outro processo abriu o episódio no mesmo instante: relê, travado.
        NULL;
      END;
    ELSIF v.normalizou_em IS NOT NULL OR v.ultima_falha_em < now() - interval '24 hours' THEN
      -- O episódio anterior tinha fechado — ou está PARADO há mais de 24 h sem
      -- falha nova (o escritório trocou o agente de provedor, e só uma geração
      -- boa DESTE provedor o fecharia): este é um NOVO. Sem isso, a falha de
      -- semanas depois chegava como "Continua", com o "desde" e a contagem
      -- do episódio velho.
      UPDATE public.cb_ia_alarmes
         SET desde = now(), ultima_falha_em = now(), ultimo_aviso_em = now(),
             falhas = 1, motivo = p_motivo, normalizou_em = NULL
       WHERE account_id = p_conta AND provedor = p_provedor;
      RETURN jsonb_build_object('acao', 'abriu', 'desde', now(), 'falhas', 1);
    ELSIF v.ultimo_aviso_em <= now() - make_interval(mins => p_lembrar_apos_min) THEN
      UPDATE public.cb_ia_alarmes
         SET ultima_falha_em = now(), ultimo_aviso_em = now(),
             falhas = v.falhas + 1, motivo = p_motivo
       WHERE account_id = p_conta AND provedor = p_provedor;
      RETURN jsonb_build_object('acao', 'continua', 'desde', v.desde, 'falhas', v.falhas + 1);
    ELSE
      UPDATE public.cb_ia_alarmes
         SET ultima_falha_em = now(), falhas = v.falhas + 1, motivo = p_motivo
       WHERE account_id = p_conta AND provedor = p_provedor;
      RETURN jsonb_build_object('acao', 'nada', 'desde', v.desde, 'falhas', v.falhas + 1);
    END IF;
  END LOOP;
END
$$;

-- O CREATE OR REPLACE mantém os privilégios da 1140; reescritos aqui para o
-- banco vazio e para não depender dela.
REVOKE EXECUTE ON FUNCTION public.cb_ia_registrar_falha(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_registrar_falha(uuid, text, text, integer) TO service_role;

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conta  uuid;
  v_r      jsonb;
  v_estado text;
BEGIN
  IF has_function_privilege('anon', 'public.cb_ia_registrar_falha(uuid, text, text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_registrar_falha(uuid, text, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1145: cb_ia_registrar_falha ficou executável pelo navegador.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_registrar_falha(uuid, text, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1145: service_role não executa cb_ia_registrar_falha.';
  END IF;

  -- a) A função é CHAMADA (o corpo plpgsql só é analisado quando roda), numa
  --    conta que não existe: o INSERT cai na FK — o corpo roda até lá.
  BEGIN
    BEGIN
      PERFORM public.cb_ia_registrar_falha(gen_random_uuid(), 'anthropic', 'conferencia_1145', 360);
      v_estado := 'gravou';
    EXCEPTION WHEN foreign_key_violation THEN
      v_estado := 'fk';
    END;
    IF v_estado <> 'fk' THEN
      RAISE EXCEPTION '1145: a conta inexistente devia cair na FK (%).', v_estado;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1145', MESSAGE = 'desfaz a conferência (a)';
  EXCEPTION
    WHEN SQLSTATE 'P1145' THEN NULL;
  END;

  -- b) O episódio PARADO há mais de 24 h, numa conta que EXISTE (derivada do
  --    banco; o banco vazio do replay pula): a falha abre um NOVO; dentro das
  --    24 h, só conta. Tudo desfeito.
  SELECT id INTO v_conta FROM public.accounts ORDER BY created_at LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1145: banco sem conta, o episódio parado não foi exercitado.';
  ELSE
    BEGIN
      DELETE FROM public.cb_ia_alarmes WHERE account_id = v_conta AND provedor = 'openai';
      v_r := public.cb_ia_registrar_falha(v_conta, 'openai', 'conferencia_1145', 360);
      IF v_r->>'acao' <> 'abriu' THEN
        RAISE EXCEPTION '1145: a 1ª falha devia abrir o episódio (%).', v_r;
      END IF;
      v_r := public.cb_ia_registrar_falha(v_conta, 'openai', 'conferencia_1145', 360);
      IF v_r->>'acao' <> 'nada' OR (v_r->>'falhas')::int <> 2 THEN
        RAISE EXCEPTION '1145: a 2ª falha dentro do prazo só devia contar (%).', v_r;
      END IF;
      UPDATE public.cb_ia_alarmes
         SET desde = now() - interval '30 days', ultima_falha_em = now() - interval '25 hours',
             ultimo_aviso_em = now() - interval '25 hours'
       WHERE account_id = v_conta AND provedor = 'openai';
      v_r := public.cb_ia_registrar_falha(v_conta, 'openai', 'conferencia_1145', 360);
      IF v_r->>'acao' <> 'abriu' OR (v_r->>'falhas')::int <> 1 THEN
        RAISE EXCEPTION '1145: o episódio parado há mais de 24 h devia abrir um NOVO (%).', v_r;
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P1145', MESSAGE = 'desfaz a conferência (b)';
    EXCEPTION
      WHEN SQLSTATE 'P1145' THEN NULL;
    END;
  END IF;
END
$$;
