-- ============================================================
-- 1050_cb_ia_rajada_fica_com_a_mais_nova — a rajada de mensagens do cliente
-- (docs/PLANO-agentes-de-ia.md, F2) guarda a mensagem MAIS NOVA como gatilho,
-- mesmo quando as ingestões terminam fora de ordem.
--
-- Por quê: cada mensagem do cliente chega num webhook próprio, processado em
-- paralelo (`after()`), e as duas enfileiram o turno no MESMO pendente da
-- conversa e conexão (`cb_ia_enfileirar_turno`, 1049). Na 1049 o último a
-- enfileirar vencia: se a ingestão da mensagem mais VELHA terminasse depois
-- da mais nova, o gatilho voltava para a velha — e o turno, ao rodar, via a
-- nova já gravada (`haMensagemMaisNova`, E10), se descartava, e nenhuma das
-- duas recebia resposta (Codex, #309).
--
-- Agora o gatilho (e o agente, o card e a etapa lidos junto com ele) só é
-- trocado por uma mensagem gravada DEPOIS da que o pendente guarda — a régua
-- `gravada_em` é a mesma de `haMensagemMaisNova`. Mensagem sem `gravada_em`
-- (carga antiga) cai no comportamento da 1049. A PASSAGEM (D25) segue como
-- era: ela nunca troca o gatilho e sempre traz o agente de destino.
--
-- Só troca o CORPO da função: mesma assinatura, mesmas concessões.
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cb_ia_enfileirar_turno(
  p_account_id       uuid,
  p_conversation_id  uuid,
  p_canal_id         uuid,
  p_ia_agente_id     uuid,
  p_deal_id          uuid,
  p_stage_id         uuid,
  p_mensagem_id      uuid,
  p_espera_ms        integer,
  p_veio_de_passagem boolean DEFAULT false
)
RETURNS TABLE (id uuid, executar_apos timestamptz)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  INSERT INTO cb_ia_turnos AS t (
    account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
    veio_de_passagem, mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos
  )
  VALUES (
    p_account_id, p_conversation_id, p_canal_id, p_ia_agente_id, p_deal_id, p_stage_id,
    p_veio_de_passagem, p_mensagem_id, p_mensagem_id, 'aguardando',
    now() + make_interval(secs => greatest(p_espera_ms, 0) / 1000.0)
  )
  ON CONFLICT (conversation_id, canal_id) WHERE status = 'aguardando'
  DO UPDATE SET
    -- A passagem responde a uma mensagem igual ou mais VELHA que a do
    -- pendente: não troca o gatilho. A mensagem mais velha que chega por
    -- último (ingestões fora de ordem) também não.
    mensagem_gatilho_id = CASE
      WHEN EXCLUDED.veio_de_passagem THEN t.mensagem_gatilho_id
      WHEN coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.mensagem_gatilho_id
      ELSE EXCLUDED.mensagem_gatilho_id END,
    veio_de_passagem    = t.veio_de_passagem OR EXCLUDED.veio_de_passagem,
    -- O agente, o card e a etapa são os lidos JUNTO com o gatilho que fica.
    ia_agente_id = CASE
      WHEN NOT EXCLUDED.veio_de_passagem
       AND coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.ia_agente_id
      ELSE EXCLUDED.ia_agente_id END,
    deal_id = CASE
      WHEN NOT EXCLUDED.veio_de_passagem
       AND coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.deal_id
      ELSE EXCLUDED.deal_id END,
    stage_id = CASE
      WHEN NOT EXCLUDED.veio_de_passagem
       AND coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.stage_id
      ELSE EXCLUDED.stage_id END,
    executar_apos       = EXCLUDED.executar_apos,
    updated_at          = now()
  RETURNING t.id, t.executar_apos;
$$;

-- As duas metades (CLAUDE.md, "Fechar EXECUTE de função") e o GRANT de volta:
-- o motor chama como service_role, que também lê `messages` aqui dentro.
REVOKE EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) TO service_role;
GRANT SELECT ON public.messages TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE proname = 'cb_ia_enfileirar_turno' AND pronamespace = 'public'::regnamespace;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '1050: esperava UMA cb_ia_enfileirar_turno, há %', v_n;
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '1050: anon ou authenticated executam a fila';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '1050: service_role perdeu a fila';
  END IF;
END $$;

-- A função é CHAMADA (regra 3): a mais nova enfileira primeiro, a mais velha
-- depois, e o gatilho fica com a mais nova. Num subbloco que se desfaz.
DO $$
DECLARE
  v_conta  uuid;
  v_conv   uuid;
  v_canal  uuid;
  v_velha  uuid;
  v_nova   uuid;
  v_agente uuid;
  v_t1     uuid;
  v_t2     uuid;
  v_gat    uuid;
BEGIN
  SELECT c.account_id, m.conversation_id, m.channel_id,
         (array_agg(m.id ORDER BY m.gravada_em ASC))[1],
         (array_agg(m.id ORDER BY m.gravada_em DESC))[1]
    INTO v_conta, v_conv, v_canal, v_velha, v_nova
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
   WHERE m.sender_type = 'customer'
     AND m.channel_id IS NOT NULL
     AND m.gravada_em IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos x
                      WHERE x.conversation_id = m.conversation_id
                        AND x.canal_id = m.channel_id
                        AND x.status = 'aguardando')
   GROUP BY c.account_id, m.conversation_id, m.channel_id
  HAVING count(DISTINCT m.gravada_em) >= 2
   LIMIT 1;
  IF v_conv IS NULL THEN
    RAISE NOTICE '1050: nenhuma conversa com duas mensagens do cliente — a fila não foi chamada aqui.';
    RETURN;
  END IF;
  BEGIN
    INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes)
      VALUES (v_conta, '__conferencia_1050__', 'gemini', 'm', false, ARRAY[v_canal])
      RETURNING id INTO v_agente;
    SELECT t.id INTO v_t1 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, NULL, NULL, v_nova, 8000) t;
    SELECT t.id INTO v_t2 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, NULL, NULL, v_velha, 8000) t;
    IF v_t1 IS DISTINCT FROM v_t2 THEN
      RAISE EXCEPTION '1050: a rajada abriu dois pendentes';
    END IF;
    SELECT mensagem_gatilho_id INTO v_gat FROM cb_ia_turnos WHERE id = v_t1;
    IF v_gat IS DISTINCT FROM v_nova THEN
      RAISE EXCEPTION '1050: a mensagem mais velha que chegou por último trocou o gatilho';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1050';
  EXCEPTION WHEN SQLSTATE 'P1050' THEN
    NULL;
  END;
END $$;
