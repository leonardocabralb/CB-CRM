-- ============================================================================
-- 1118 — a tentativa da EQUIPE que não saiu não é resposta de gente
-- ============================================================================
-- Decisão do operador (31/10/2026): quando alguém da equipe tenta mandar pelo
-- compositor e o provedor recusa (número sem WhatsApp, conexão fora do ar) ou
-- não responde, a tentativa fica GRAVADA no fio, para todos verem — a mesma
-- bolha "não enviada" do robô (1080), agora com quem tentou: `sender_type =
-- 'agent'`, o `sender_id` da pessoa, `status = 'failed'`, `nao_saiu = true`
-- (`registrarTentativaDaEquipe`, `src/lib/whatsapp/envio-que-falhou.ts`).
--
-- ⚠️⚠️ `agent` + `sender_id` é a forma de "resposta de gente". Sem esta
-- migration, a tentativa que não chegou ao cliente:
--   - PAUSAVA o agente de IA da conversa (o gatilho da 1049 não olha a
--     coluna) — decisão do operador: a falha não pausa;
--   - PARAVA a retomada do agente como "a equipe respondeu" (a reserva do
--     envio, na versão da 1080).
-- As duas peças são recriadas com a forma VIGENTE (conferida contra a
-- produção em 31/10/2026: o gatilho com o WHEN do sinal da Lixeira, 1097; a
-- reserva com o corpo da 1080) e um `NOT nao_saiu` cada. O "em atraso" (972)
-- e o Painel já ignoravam a coluna (1080, 1095). Os leitores do app filtram
-- pela mesma coluna (pino `src/lib/inbox/nao-saiu.chamadores.test.ts`).
--
-- ⚠️ O gatilho mantém o WHEN do sinal `cb.lixeira` (calado pela restauração da
-- Lixeira, `cb_lixeira_tratamento()`): sem ele, mover e restaurar recusam
-- (`lixeira_gatilho_sem_sinal`) — pino `lixeira-1097.test.ts`, (b).
--
-- Pode ir ANTES do deploy: o app de antes nunca grava `agent` com `nao_saiu`,
-- e as duas peças só deixam de contar a linha que não saiu.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0) A conversa da conferência, escolhida ANTES de qualquer trava (a forma da
--    1080): 1:1 aberta, sem pausa, sem turno vivo, card ABERTO numa etapa sem
--    agente, uma conexão da conta e uma última mensagem viva com `gravada_em`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT cv.id AS conv, cv.account_id AS conta, dl.id AS deal, dl.stage_id AS etapa, ch.id AS canal,
         ac.owner_user_id AS dono
    INTO r
    FROM conversations cv
    JOIN accounts ac ON ac.id = cv.account_id
    JOIN deals dl ON dl.contact_id = cv.contact_id AND dl.account_id = cv.account_id AND dl.status = 'open'
    JOIN LATERAL (SELECT c2.id FROM cb_channels c2 WHERE c2.account_id = cv.account_id LIMIT 1) ch ON true
   WHERE cv.group_id IS NULL AND cv.status <> 'closed' AND NOT cv.ai_autoreply_disabled
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos t
                      WHERE t.conversation_id = cv.id AND t.status IN ('aguardando', 'rodando'))
     AND NOT EXISTS (SELECT 1 FROM cb_ia_agente_etapas e WHERE e.stage_id = dl.stage_id)
     AND EXISTS (SELECT 1 FROM messages m
                  WHERE m.conversation_id = cv.id AND m.gravada_em IS NOT NULL AND m.deleted_at IS NULL)
   LIMIT 1;
  IF r.conv IS NOT NULL THEN
    PERFORM set_config('cb1118.conv', r.conv::text, true);
    PERFORM set_config('cb1118.conta', r.conta::text, true);
    PERFORM set_config('cb1118.deal', r.deal::text, true);
    PERFORM set_config('cb1118.etapa', r.etapa::text, true);
    PERFORM set_config('cb1118.canal', r.canal::text, true);
    PERFORM set_config('cb1118.dono', coalesce(r.dono::text, ''), true);
    PERFORM set_config('cb1118.ultima', (
      SELECT m.id::text FROM messages m
       WHERE m.conversation_id = r.conv AND m.gravada_em IS NOT NULL AND m.deleted_at IS NULL
       ORDER BY m.gravada_em DESC, m.id DESC LIMIT 1), true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) A pausa por gente (1049; o WHEN do sinal da 1097): a tentativa que não
--    saiu não pausa a IA. Mesmo nome (a carga da 1033 e a Lixeira o calam
--    pelo nome).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER cb_pausa_ia_por_gente_trigger
  AFTER INSERT ON public.messages FOR EACH ROW
  WHEN ((new.sender_type = 'agent'::text) AND ((new.sender_id IS NOT NULL) OR new.from_device)
        AND (new.ia_agente_id IS NULL) AND (new.gravada_em IS NOT NULL)
        AND (NOT new.nao_saiu)
        AND nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_pausar_ia_por_gente();

-- ---------------------------------------------------------------------------
-- 2) A reserva do envio do agente (1056; corpo da 1080): "a equipe
--    respondeu" conta só o que saiu
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_ia_reservar_envio(
  p_turno_id      uuid,
  p_rodando_desde timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  t          cb_ia_turnos%ROWTYPE;
  c          record;
  d          record;
  a          record;
  v_gatilho  timestamptz;
  v_apagada  timestamptz;
  v_contadas integer;
BEGIN
  SELECT * INTO t FROM cb_ia_turnos r WHERE r.id = p_turno_id;
  IF NOT FOUND OR t.status <> 'rodando' OR t.rodando_desde IS DISTINCT FROM p_rodando_desde THEN
    RETURN 'descartado';
  END IF;

  -- A trava: a pausa por gente, o encerramento e o gatilho da mensagem do
  -- cliente (972) escrevem esta linha e esperam por ela.
  SELECT cv.status, cv.ai_autoreply_disabled, cv.ia_retomada_em INTO c
    FROM conversations cv
   WHERE cv.id = t.conversation_id AND cv.account_id = t.account_id
   FOR NO KEY UPDATE;
  IF NOT FOUND OR c.status = 'closed' THEN
    RETURN 'encerrada';
  END IF;
  IF c.ai_autoreply_disabled THEN
    RETURN 'pausada';
  END IF;

  SELECT dl.stage_id, dl.status, dl.etapa_desde INTO d
    FROM deals dl
   WHERE dl.id = t.deal_id AND dl.account_id = t.account_id;
  IF NOT FOUND OR d.stage_id IS DISTINCT FROM t.stage_id THEN
    RETURN 'card_mudou';
  END IF;
  IF d.status IS DISTINCT FROM 'open' THEN
    RETURN 'card_fechado';
  END IF;

  SELECT ag.ativo, ag.arquivado_em, ag.conexoes, ag.teto_respostas, ag.retomada INTO a
    FROM cb_ia_agentes ag
   WHERE ag.id = t.ia_agente_id AND ag.account_id = t.account_id;
  IF NOT FOUND OR NOT a.ativo OR a.arquivado_em IS NOT NULL THEN
    RETURN 'agente_desligado';
  END IF;
  IF t.canal_id IS NULL OR NOT (t.canal_id = ANY (a.conexoes)) THEN
    RETURN 'fora_da_conexao';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cb_ia_agente_etapas e
     WHERE e.stage_id = t.stage_id
       AND e.ia_agente_id = t.ia_agente_id
       AND e.account_id = t.account_id
  ) THEN
    RETURN 'agente_sem_etapa';
  END IF;
  IF t.tipo = 'retomada' AND NOT coalesce(a.retomada -> 'ativa' = 'true'::jsonb, false) THEN
    RETURN 'retomada_desligada';
  END IF;

  SELECT g.gravada_em, g.deleted_at INTO v_gatilho, v_apagada FROM messages g WHERE g.id = t.mensagem_gatilho_id;

  -- A RETOMADA: a âncora é a resposta do agente que ficou sem resposta.
  -- Qualquer um que escreveu depois dela (na conversa inteira) para a série.
  -- A mensagem do cliente conta mesmo apagada: ele escreveu.
  IF t.tipo = 'retomada' THEN
    IF v_gatilho IS NULL OR v_apagada IS NOT NULL THEN
      RETURN 'sem_ancora';
    END IF;
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'customer'
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN 'cliente_respondeu';
    END IF;
    -- A tentativa da equipe que NÃO saiu (1118) não respondeu ninguém.
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'agent'
         AND NOT m.nao_saiu
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN 'equipe_respondeu';
    END IF;
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'bot'
         AND NOT m.nao_saiu
         AND (m.ia_agente_id IS NULL OR m.ia_agente_id <> t.ia_agente_id)
         AND m.deleted_at IS NULL
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN 'robo_falou';
    END IF;
  END IF;

  -- Sem o `gravada_em` de um dos lados, o pendente vivo conta (o lado que
  -- recusa).
  IF EXISTS (
    SELECT 1 FROM cb_ia_turnos p
      JOIN messages n ON n.id = p.mensagem_gatilho_id
     WHERE p.conversation_id = t.conversation_id
       AND p.canal_id IS NOT DISTINCT FROM t.canal_id
       AND p.status = 'aguardando'
       AND p.id <> t.id
       AND n.deleted_at IS NULL
       AND (v_gatilho IS NULL OR n.gravada_em IS NULL OR n.gravada_em > v_gatilho)
  ) THEN
    RETURN 'mais_nova';
  END IF;

  IF v_gatilho IS NOT NULL AND EXISTS (
    SELECT 1 FROM messages m
     WHERE m.conversation_id = t.conversation_id
       AND m.sender_type = 'bot'
       AND NOT m.nao_saiu
       AND m.ia_agente_id IS NULL
       AND m.deleted_at IS NULL
       AND m.channel_id IS NOT DISTINCT FROM t.canal_id
       AND m.gravada_em > v_gatilho
  ) THEN
    RETURN 'robo_falou';
  END IF;

  -- O teto recomeça quando o card ENTRA na etapa e quando a IA é RETOMADA.
  -- As retomadas CONTAM: são mensagens do agente.
  SELECT count(*) INTO v_contadas
    FROM messages m
   WHERE m.conversation_id = t.conversation_id
     AND m.ia_agente_id = t.ia_agente_id
     AND NOT m.nao_saiu
     AND m.gravada_em > greatest(d.etapa_desde, c.ia_retomada_em);
  IF v_contadas >= a.teto_respostas THEN
    RETURN 'teto';
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo e privilégios; o gatilho e a
-- reserva são EXERCITADOS num subbloco desfeito por SQLSTATE próprio, com a
-- conversa escolhida no passo 0 — sem ela, NOTICE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def      text;
  v_conv     uuid := nullif(current_setting('cb1118.conv', true), '')::uuid;
  v_conta    uuid := nullif(current_setting('cb1118.conta', true), '')::uuid;
  v_deal     uuid := nullif(current_setting('cb1118.deal', true), '')::uuid;
  v_etapa    uuid := nullif(current_setting('cb1118.etapa', true), '')::uuid;
  v_canal    uuid := nullif(current_setting('cb1118.canal', true), '')::uuid;
  v_dono     uuid := nullif(current_setting('cb1118.dono', true), '')::uuid;
  v_ultima   uuid := nullif(current_setting('cb1118.ultima', true), '')::uuid;
  v_agente   uuid;
  v_turno    uuid;
  v_desde    timestamptz;
  v_tentou   uuid;
  v_res      text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.messages'::regclass AND t.tgname = 'cb_pausa_ia_por_gente_trigger';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1118: o gatilho da pausa por gente sumiu';
  END IF;
  IF position('NOT new.nao_saiu' IN v_def) = 0 THEN
    RAISE EXCEPTION '1118: a pausa por gente não ignora a tentativa que não saiu: %', v_def;
  END IF;
  -- A forma que a conferência da Lixeira procura (`cb_lixeira_conferir_gatilhos`).
  IF position('NULLIF(current_setting(''cb.lixeira''::text, true), ''''::text) IS NULL' IN v_def) = 0 THEN
    RAISE EXCEPTION '1118: a pausa por gente perdeu o sinal da Lixeira: %', v_def;
  END IF;

  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'cb_ia_reservar_envio') <> 1 THEN
    RAISE EXCEPTION '1118: esperava UMA cb_ia_reservar_envio';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1118: cb_ia_reservar_envio aberta ao navegador';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1118: service_role sem EXECUTE em cb_ia_reservar_envio';
  END IF;

  BEGIN
    SET LOCAL ROLE service_role;
    IF v_conv IS NOT NULL AND v_ultima IS NOT NULL THEN
      -- Um agente com retomada LIGADA na etapa do card: a pausa por gente
      -- agiria nesta conversa, e a reserva da retomada chega à pergunta.
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes, teto_respostas, retomada)
        VALUES (v_conta, '__conferencia_1118__', 'gemini', 'm', true, ARRAY[v_canal], 100,
                '{"ativa": true}'::jsonb)
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);

      -- A âncora da retomada é a última mensagem viva da conversa.
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde, tipo,
                                tentativa, tentativas)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, v_ultima, 'rodando', now(),
                'retomada', 1, 1)
        RETURNING id, rodando_desde INTO v_turno, v_desde;

      -- (a) A tentativa da equipe que NÃO saiu: não pausa a IA…
      -- `gravada_em` pelo RELÓGIO, não pelo `now()` da transação: uma âncora
      -- gravada depois do início desta transação ficaria "depois" da linha.
      INSERT INTO messages (conversation_id, sender_type, sender_id, content_type, content_text, status,
                            channel_id, nao_saiu, error_title, gravada_em)
        VALUES (v_conv, 'agent', coalesce(v_dono, gen_random_uuid()), 'text', '__conferencia_1118__',
                'failed', v_canal, true, 'sem_whatsapp', clock_timestamp())
        RETURNING id INTO v_tentou;
      IF (SELECT ai_autoreply_disabled FROM conversations WHERE id = v_conv) THEN
        RAISE EXCEPTION '1118: a tentativa da equipe que não saiu pausou a IA';
      END IF;

      -- (b) …nem para a retomada como "a equipe respondeu".
      v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
      IF v_res = 'equipe_respondeu' THEN
        RAISE EXCEPTION '1118: a tentativa da equipe que não saiu parou a retomada';
      END IF;

      -- (c) A resposta da equipe que SAIU continua parando a retomada…
      UPDATE messages SET nao_saiu = false, status = 'sent' WHERE id = v_tentou;
      v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
      IF v_res <> 'equipe_respondeu' THEN
        RAISE EXCEPTION '1118: com a resposta da equipe que saiu, a reserva respondeu % (esperava equipe_respondeu)', v_res;
      END IF;

      -- (d) …e pausando a IA (o ramo do gatilho continua de pé).
      INSERT INTO messages (conversation_id, sender_type, sender_id, content_type, content_text, status,
                            channel_id, gravada_em)
        VALUES (v_conv, 'agent', coalesce(v_dono, gen_random_uuid()), 'text', '__conferencia_1118__',
                'sent', v_canal, clock_timestamp());
      IF NOT (SELECT ai_autoreply_disabled FROM conversations WHERE id = v_conv) THEN
        RAISE EXCEPTION '1118: a resposta da equipe que saiu não pausou a IA';
      END IF;
    ELSE
      RAISE NOTICE '1118: nenhuma conversa com card aberto numa etapa livre e uma última mensagem viva — o gatilho e a reserva não foram exercitados aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1118';
  EXCEPTION WHEN SQLSTATE 'P1118' THEN
    NULL;
  END;

  RAISE NOTICE '1118: a pausa por gente e a retomada ignoram a tentativa da equipe que não saiu.';
END $$;
