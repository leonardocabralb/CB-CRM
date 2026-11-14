-- ============================================================================
-- 1146 — O follow-up da IA atravessa o ENCERRAMENTO (decisão do operador de
-- 14/11/2026)
-- ============================================================================
-- O caso (produção, Trabalhista, 13/11/2026): um atendente mandou uma pergunta
-- a clientes em andamento e encerrou as conversas logo depois, para limpar a
-- caixa ("se ela responder, reabre"). Os cards ficaram ABERTOS em etapas com
-- agente de IA, e o encerramento descartou os follow-ups — o da resposta da IA
-- (1056) e o da fala da equipe (1138, P4/P7): ninguém mais cobrou as clientes.
--
-- A decisão: "Dependendo do encerramento, a gente pode manter o follow-up. O
-- follow-up não vai abrir as mensagens, mas, quando a cliente responder, vai
-- abrir novamente." O que muda, e só isto:
--
--  1) ENCERRAR (`cb_encerrar_limpa_ia`, corpo da 1130) não descarta a RETOMADA
--     (`tipo = 'retomada'`, a pré-armação da fala da equipe inclusive) que
--     seguiria no vencimento:
--       - a pausa de ANTES do encerramento é uma que a retomada atravessa:
--         nenhuma, ou a `gente` com N > 0 na conta (`ia-retomada.md`).
--         Encerrar continua APAGANDO a pausa — sem pesá-la aqui, o "Pausar",
--         o "Desativar", a transferência e a automação deixariam de parar a
--         série (a conversa encerrada fica sem pausa);
--       - o card dela continua ABERTO, na MESMA etapa, do MESMO agente, ligado,
--         com a conexão dela e a retomada ligada. A pré-armação (ainda sem
--         agente) pede um card aberto do contato numa etapa assim — o filtro
--         barato da 1138; a régua certa é a do TS, no vencimento.
--     O resto fica como era: o agente e a pausa saem, o teto recomeça
--     (`ia_retomada_em`), os turnos de RESPOSTA são descartados, e o que já
--     respondeu ou está no meio do envio termina sozinho (1109/1130).
--  2) A RESERVA (`cb_ia_reservar_envio`, corpo da 1134) deixa a RETOMADA sair
--     com a conversa encerrada; a resposta continua recusada (`encerrada`).
--     As outras recusas valem para ela como antes (pausa, card, agente, quem
--     escreveu depois da âncora, o teto).
--
-- A retomada sai SEM reabrir a conversa (`engineSendText` só sobe a prévia;
-- reabrir é dos caminhos de gente, `ingestao.md`): ela aparece na aba
-- Encerradas, e a resposta da cliente reabre pelo caminho de sempre.
--
-- ADITIVA: aplicar ANTES do deploy. O app de hoje convive: a retomada que o
-- encerramento deixa na fila ele descarta no vencimento (`encerrada`), como
-- hoje. Sem ela, o app novo também convive: o gatilho de hoje descarta no
-- encerramento e a reserva recusa `encerrada`. Os gatilhos ficam como estão
-- (só os corpos mudam; o de encerrar é um "livre" da Lixeira, 1097).
--
-- Idempotente; aplica em banco vazio. Conferência no fim: catálogo e
-- privilégios sempre; com dado, as duas funções CHAMADAS num subbloco desfeito
-- por SQLSTATE próprio (P1146), na forma da 1130.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0) A conversa da conferência, escolhida ANTES de qualquer trava (a forma da
--    1130): 1:1 aberta, sem pausa, sem turno vivo, card ABERTO numa etapa sem
--    agente (a conferência a dá a um agente de mentira) e uma conexão da conta.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT cv.id AS conv, cv.account_id AS conta, cv.status AS situacao, dl.id AS deal, dl.stage_id AS etapa,
         ch.id AS canal
    INTO r
    FROM conversations cv
    JOIN deals dl ON dl.contact_id = cv.contact_id AND dl.account_id = cv.account_id AND dl.status = 'open'
    JOIN LATERAL (SELECT c2.id FROM cb_channels c2 WHERE c2.account_id = cv.account_id LIMIT 1) ch ON true
   WHERE cv.group_id IS NULL AND cv.status <> 'closed' AND NOT cv.ai_autoreply_disabled
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos t
                      WHERE t.conversation_id = cv.id AND t.status IN ('aguardando', 'rodando'))
     AND NOT EXISTS (SELECT 1 FROM cb_ia_agente_etapas e WHERE e.stage_id = dl.stage_id)
   LIMIT 1;
  IF r.conv IS NOT NULL THEN
    PERFORM set_config('cb1146.conv', r.conv::text, true);
    PERFORM set_config('cb1146.conta', r.conta::text, true);
    PERFORM set_config('cb1146.situacao', r.situacao, true);
    PERFORM set_config('cb1146.deal', r.deal::text, true);
    PERFORM set_config('cb1146.etapa', r.etapa::text, true);
    PERFORM set_config('cb1146.canal', r.canal::text, true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) A reserva do envio (corpo da 1134): a RETOMADA sai com a conversa
--    encerrada
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
  v_entrou   timestamptz;
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
  -- 1146: a RETOMADA sai com a conversa ENCERRADA, sem reabri-la (decisão do
  -- operador, 14/11/2026) — o encerramento já pesou a pausa e o card dela
  -- (`cb_encerrar_limpa_ia`), e o resto desta reserva confere como sempre. A
  -- RESPOSTA continua recusada.
  IF NOT FOUND OR (c.status = 'closed' AND t.tipo <> 'retomada') THEN
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
    -- A tentativa da equipe que NÃO saiu (1118) não respondeu ninguém. A
    -- FAIXA da ligação pelo CRM (1134: `call` fora do celular) é só registro
    -- (D6/D6b) — também não; a atendida no CELULAR (`from_device`) é gente.
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'agent'
         AND NOT m.nao_saiu
         AND NOT (m.content_type = 'call' AND NOT m.from_device)
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
  -- recusa). 1130: só o pendente de RESPOSTA — o gatilho da retomada é a
  -- resposta do agente, não uma mensagem do cliente.
  IF EXISTS (
    SELECT 1 FROM cb_ia_turnos p
      JOIN messages n ON n.id = p.mensagem_gatilho_id
     WHERE p.conversation_id = t.conversation_id
       AND p.canal_id IS NOT DISTINCT FROM t.canal_id
       AND p.status = 'aguardando'
       AND p.tipo IS DISTINCT FROM 'retomada'
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

  -- O teto conta as respostas DESTE agente desde que a conversa ENTROU no
  -- território dele (1130): o último evento de etapa do card cuja ORIGEM não é
  -- etapa dele (ou a criação do card). Sem trilha, o `etapa_desde`; nunca
  -- depois dele. "Retomar IA" e encerrar recomeçam (`ia_retomada_em`). As
  -- retomadas CONTAM: são mensagens do agente.
  SELECT ev.occurred_at INTO v_entrou
    FROM cb_lead_events ev
   WHERE ev.deal_id = t.deal_id
     AND ev.account_id = t.account_id
     AND ev.event_type IN ('stage_changed', 'pipeline_changed', 'deal_created')
     AND (ev.from_stage_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM cb_ia_agente_etapas e
             WHERE e.stage_id = ev.from_stage_id
               AND e.ia_agente_id = t.ia_agente_id
               AND e.account_id = t.account_id
          ))
   ORDER BY ev.occurred_at DESC
   LIMIT 1;
  SELECT count(*) INTO v_contadas
    FROM messages m
   WHERE m.conversation_id = t.conversation_id
     AND m.ia_agente_id = t.ia_agente_id
     AND NOT m.nao_saiu
     AND m.gravada_em > greatest(least(coalesce(v_entrou, d.etapa_desde), d.etapa_desde), c.ia_retomada_em);
  IF v_contadas >= a.teto_respostas THEN
    RETURN 'teto';
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) TO service_role;
-- A reserva (INVOKER) lê a trilha como o service_role (banco novo não tem o
-- privilégio padrão do Supabase; repetido da 1130/1134 porque a conferência
-- a chama).
GRANT SELECT ON TABLE cb_lead_events TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Encerrar (corpo da 1130): a RETOMADA que seguiria fica na fila
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_encerrar_limpa_ia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_segue boolean;
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    -- 1146: a retomada atravessa o encerramento só com a pausa que ela
    -- atravessaria no vencimento — nenhuma, ou a `gente` com N > 0 na conta
    -- (sem a linha padrão, 15; a mesma leitura da pré-armação, 1138). A pausa
    -- que a para (o "Pausar", o "Desativar", a transferência, a automação, a
    -- `gente` com N = 0) é pesada AQUI: logo abaixo o encerramento a apaga, e
    -- no vencimento a conversa encerrada estaria sem pausa.
    v_segue := NOT OLD.ai_autoreply_disabled;
    IF OLD.ai_autoreply_disabled AND OLD.ia_pausada_por = 'gente' THEN
      v_segue := coalesce((SELECT a.ia_volta_apos_min FROM ai_configs a
                            WHERE a.account_id = NEW.account_id AND a.channel_id IS NULL
                            LIMIT 1), 15) > 0;
    END IF;
    NEW.ia_agente_id := NULL;
    NEW.ai_autoreply_disabled := false;
    NEW.ia_pausada_por := NULL;
    NEW.ia_pausada_em := NULL;
    -- Recomeça o teto (as respostas contam de `greatest(etapa_desde,
    -- ia_retomada_em)`): o cliente que volta meses depois não herda as
    -- respostas gastas antes do encerramento (revisão da F2).
    NEW.ia_retomada_em := now();
    -- 1109: o turno cuja resposta JÁ SAIU (`mensagem_enviada_id`) não é
    -- descartado — ele está executando as ações da resposta (a automação que
    -- encerrou a conversa pode ser uma delas) e grava o próprio desfecho.
    -- 1130: nem o que está NO MEIO do envio (`enviando_desde`, carimbado
    -- DEPOIS da reserva): a resposta está saindo, e ele grava o desfecho
    -- verdadeiro (respondeu, falhou ou incerto) — "descartado" mentia.
    -- 1146: nem a RETOMADA que seguiria: o card dela ABERTO, na MESMA etapa,
    -- do MESMO agente (ligado, com a conexão e a retomada ligada); a
    -- pré-armação da fala da equipe, ainda sem agente, com um card aberto do
    -- contato numa etapa assim. Ela sai com a conversa encerrada, sem
    -- reabri-la; o vencimento confere tudo de novo.
    UPDATE cb_ia_turnos
       SET status = 'descartado',
           erro = 'conversa encerrada',
           terminado_em = now(),
           updated_at = now()
     WHERE conversation_id = NEW.id
       AND account_id = NEW.account_id
       AND status IN ('aguardando', 'rodando')
       AND mensagem_enviada_id IS NULL
       AND enviando_desde IS NULL
       AND NOT (
         v_segue
         AND cb_ia_turnos.tipo = 'retomada'
         AND EXISTS (
           SELECT 1
             FROM deals d
             JOIN cb_ia_agente_etapas e ON e.stage_id = d.stage_id AND e.account_id = d.account_id
             JOIN cb_ia_agentes ag ON ag.id = e.ia_agente_id AND ag.account_id = d.account_id
            WHERE d.account_id = NEW.account_id
              AND d.status = 'open'
              AND ag.ativo
              AND ag.arquivado_em IS NULL
              AND cb_ia_turnos.canal_id = ANY (ag.conexoes)
              AND coalesce(ag.retomada -> 'ativa' = 'true'::jsonb, false)
              AND CASE
                    WHEN cb_ia_turnos.ia_agente_id IS NULL THEN d.contact_id = NEW.contact_id
                    ELSE d.id = cb_ia_turnos.deal_id
                     AND d.stage_id = cb_ia_turnos.stage_id
                     AND ag.id = cb_ia_turnos.ia_agente_id
                  END
         )
       );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_encerrar_limpa_ia() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo e privilégios; com a conversa
-- escolhida no passo 0, as duas funções são CHAMADAS num subbloco desfeito
-- por SQLSTATE próprio — sem ela, NOTICE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conv     uuid := nullif(current_setting('cb1146.conv', true), '')::uuid;
  v_conta    uuid := nullif(current_setting('cb1146.conta', true), '')::uuid;
  v_situacao text := nullif(current_setting('cb1146.situacao', true), '');
  v_deal     uuid := nullif(current_setting('cb1146.deal', true), '')::uuid;
  v_etapa    uuid := nullif(current_setting('cb1146.etapa', true), '')::uuid;
  v_canal    uuid := nullif(current_setting('cb1146.canal', true), '')::uuid;
  v_nome     text;
  v_agente   uuid;
  v_ancora   uuid;
  v_retomada uuid;
  v_resposta uuid;
  v_desde    timestamptz;
  v_res      text;
  v_status   text;
  v_c        record;
BEGIN
  -- Uma de cada, fechadas ao navegador, a reserva aberta ao service_role.
  FOREACH v_nome IN ARRAY ARRAY['cb_ia_reservar_envio', 'cb_encerrar_limpa_ia'] LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = v_nome) <> 1 THEN
      RAISE EXCEPTION '1146: esperava UMA %', v_nome;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_encerrar_limpa_ia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_encerrar_limpa_ia()', 'EXECUTE') THEN
    RAISE EXCEPTION '1146: função da IA aberta ao navegador';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1146: service_role sem EXECUTE na reserva';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_lead_events', 'SELECT') THEN
    RAISE EXCEPTION '1146: service_role sem SELECT na trilha (a reserva a lê)';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.cb_encerrar_limpa_ia()'::regprocedure) THEN
    RAISE EXCEPTION '1146: cb_encerrar_limpa_ia sem SECURITY DEFINER (encerrar pela tela falharia)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_encerrar_limpa_ia_trigger'
                  AND tgrelid = 'public.conversations'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '1146: o gatilho cb_encerrar_limpa_ia_trigger sumiu';
  END IF;

  BEGIN
    -- Como o motor: o service_role chama a reserva, e o passo "Encerrar
    -- conversa" encerra.
    SET LOCAL ROLE service_role;
    IF v_conv IS NOT NULL THEN
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes, teto_respostas, retomada)
        VALUES (v_conta, '__conferencia_1146__', 'gemini', 'm', true, ARRAY[v_canal], 100, '{"ativa": true}'::jsonb)
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);
      -- A âncora: a resposta do agente. Gravada pelo papel da migration: o
      -- INSERT em `messages` chama funções (a busca, 929) que o service_role
      -- de um banco NOVO não executa — e o que se prova aqui são as funções.
      RESET ROLE;
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, status, channel_id,
                            ia_agente_id, gravada_em)
        VALUES (v_conv, 'bot', 'text', '__conferencia_1146__', 'sent', v_canal, v_agente, clock_timestamp())
        RETURNING id INTO v_ancora;
      SET LOCAL ROLE service_role;

      -- (1) Encerrar com o card na etapa do agente e sem pausa: a RETOMADA
      -- fica na fila; o turno de RESPOSTA sai; o resto do encerrar, como era.
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos, tipo,
                                tentativa, tentativas)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ancora, v_ancora, 'aguardando',
                now() + interval '1 hour', 'retomada', 1, 1)
        RETURNING id INTO v_retomada;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ancora, v_ancora, 'rodando', now())
        RETURNING id INTO v_resposta;
      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_retomada;
      IF v_status IS DISTINCT FROM 'aguardando' THEN
        RAISE EXCEPTION '1146: encerrar descartou a retomada com o card na etapa do agente (ficou %)', v_status;
      END IF;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_resposta;
      IF v_status IS DISTINCT FROM 'descartado' THEN
        RAISE EXCEPTION '1146: encerrar não descartou o turno de resposta (ficou %)', v_status;
      END IF;
      SELECT ai_autoreply_disabled, ia_pausada_por, ia_agente_id, ia_retomada_em INTO v_c
        FROM conversations WHERE id = v_conv;
      IF v_c.ai_autoreply_disabled OR v_c.ia_pausada_por IS NOT NULL OR v_c.ia_agente_id IS NOT NULL
         OR v_c.ia_retomada_em IS NULL THEN
        RAISE EXCEPTION '1146: encerrar deixou de limpar a IA (pausa, agente ou teto)';
      END IF;

      -- (2) A reserva com a conversa ENCERRADA: a retomada passa; a resposta
      -- continua `encerrada`.
      UPDATE cb_ia_turnos SET status = 'rodando', rodando_desde = now() WHERE id = v_retomada
        RETURNING rodando_desde INTO v_desde;
      v_res := public.cb_ia_reservar_envio(v_retomada, v_desde);
      IF v_res IS DISTINCT FROM 'ok' THEN
        RAISE EXCEPTION '1146: a reserva recusou a retomada na conversa encerrada (%)', v_res;
      END IF;
      UPDATE cb_ia_turnos SET status = 'descartado', terminado_em = now() WHERE id = v_retomada;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ancora, v_ancora, 'rodando', now())
        RETURNING id, rodando_desde INTO v_resposta, v_desde;
      v_res := public.cb_ia_reservar_envio(v_resposta, v_desde);
      IF v_res IS DISTINCT FROM 'encerrada' THEN
        RAISE EXCEPTION '1146: a reserva deixou a RESPOSTA sair na conversa encerrada (%)', v_res;
      END IF;
      UPDATE cb_ia_turnos SET status = 'descartado', terminado_em = now() WHERE id = v_resposta;

      -- (3) A pausa que a retomada NÃO atravessa (o "Desativar"): encerrar a
      -- descarta, como o vencimento faria — o encerramento apaga a pausa.
      UPDATE conversations SET status = v_situacao WHERE id = v_conv;
      UPDATE conversations SET ai_autoreply_disabled = true, ia_pausada_por = 'desativada', ia_pausada_em = now()
       WHERE id = v_conv;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos, tipo,
                                tentativa, tentativas)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ancora, v_ancora, 'aguardando',
                now() + interval '1 hour', 'retomada', 1, 1)
        RETURNING id INTO v_retomada;
      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_retomada;
      IF v_status IS DISTINCT FROM 'descartado' THEN
        RAISE EXCEPTION '1146: encerrar com a IA desativada não descartou a retomada (ficou %)', v_status;
      END IF;

      -- (4) A etapa do card deixou de ser do agente: encerrar descarta.
      UPDATE conversations SET status = v_situacao WHERE id = v_conv;
      DELETE FROM cb_ia_agente_etapas WHERE stage_id = v_etapa AND ia_agente_id = v_agente;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos, tipo,
                                tentativa, tentativas)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ancora, v_ancora, 'aguardando',
                now() + interval '1 hour', 'retomada', 1, 1)
        RETURNING id INTO v_retomada;
      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_retomada;
      IF v_status IS DISTINCT FROM 'descartado' THEN
        RAISE EXCEPTION '1146: encerrar com o card fora da etapa do agente não descartou a retomada (ficou %)', v_status;
      END IF;

      -- (5) A PRÉ-ARMAÇÃO da fala da equipe (1138, ainda sem agente, card e
      -- etapa) com o card do contato numa etapa do agente: fica.
      UPDATE conversations SET status = v_situacao WHERE id = v_conv;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, mensagem_gatilho_id, mensagem_inicial_id,
                                status, executar_apos, tipo, tentativa, tentativas, erro)
        VALUES (v_conta, v_conv, v_canal, v_ancora, v_ancora, 'aguardando', now() + interval '30 seconds',
                'retomada', 1, 1, 'armar a partir da fala da equipe')
        RETURNING id INTO v_retomada;
      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_retomada;
      IF v_status IS DISTINCT FROM 'aguardando' THEN
        RAISE EXCEPTION '1146: encerrar descartou a pré-armação da fala da equipe (ficou %)', v_status;
      END IF;
    ELSE
      RAISE NOTICE '1146: nenhuma conversa aberta com card numa etapa livre — as funções não foram chamadas aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1146';
  EXCEPTION WHEN SQLSTATE 'P1146' THEN
    NULL;
  END;

  RAISE NOTICE '1146: encerrar mantém a retomada que seguiria, e a reserva a deixa sair com a conversa encerrada.';
END $$;
