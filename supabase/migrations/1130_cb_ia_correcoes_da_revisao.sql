-- ============================================================================
-- 1130 — Agentes de IA: as correções da revisão de 09/11/2026 que moram no banco
-- ============================================================================
-- Revisão geral da estrutura de IA antes de ligar os agentes (relatório fora do
-- repositório). Quatro peças recriadas a partir da forma VIGENTE de cada uma:
--
--  1) A RESERVA do envio (`cb_ia_reservar_envio`, corpo da 1118):
--     a) `mais_nova` não conta a RETOMADA pendente. A retomada que o turno
--        anterior armou depois de o cliente escrever (o turno da mensagem nova
--        já reivindicado, por isso o índice do pendente não acusou) tem como
--        gatilho a RESPOSTA do agente — mais nova que a mensagem do cliente —,
--        e a reserva do turno do cliente recusava `mais_nova`: a mensagem
--        ficava sem resposta e, 15 min depois, saía o "ainda está aí?". O app
--        também deixa de armar com turno de resposta vivo (`armarRetomada`).
--     b) O TETO conta desde que a conversa ENTROU no território do agente
--        (decisão do operador, 09/11/2026), não desde a etapa atual: o agente
--        que move o card entre as PRÓPRIAS etapas (`mover_etapa`) zerava o
--        próprio teto — o laço com a resposta automática do celular do cliente
--        ia a teto × etapas. A entrada é o último evento de etapa da trilha
--        (912, `cb_lead_events`) cuja etapa de ORIGEM não é dele (ou a criação
--        do card); sem trilha, o `etapa_desde` de sempre. Nunca DEPOIS do
--        `etapa_desde` (`least`): a régua nova nunca é mais frouxa que a antiga.
--        "Retomar IA" e encerrar continuam recomeçando (`ia_retomada_em`).
--  2) A FILA (`cb_ia_enfileirar_turno`, corpo da 1056): a linha que a mensagem
--     do cliente empurra volta a ser um turno de RESPOSTA limpo (`tipo`,
--     `tentativa`, `tentativas` e `erro` zerados). Uma retomada inserida na vaga
--     entre o descarte e o INSERT viraria "o turno" da mensagem e rodaria como
--     retomada (um empurrão no lugar da resposta); e a marca de uma espera
--     anterior (a repetição da geração) não é da mensagem nova.
--  3) ENCERRAR (`cb_encerrar_limpa_ia`, corpo da 1109) não descarta o turno
--     que está NO MEIO do envio (`enviando_desde`, carimbado depois da
--     reserva): a resposta está saindo, e o registro dizia "descartado —
--     conversa encerrada". Ele termina sozinho e grava o desfecho verdadeiro.
--  4) A CONVERSA APAGADA (`cb_ia_turno_conversa_apagada`, corpo da 1110): o
--     turno vivo cuja resposta JÁ SAIU (`mensagem_enviada_id`) é `respondeu`,
--     não `incerto`.
--
-- Os gatilhos ficam como estão (só os corpos mudam; o de encerrar é um "livre"
-- da Lixeira, 1097). As funções INVOKER chamadas pelo service_role leem a
-- trilha: o GRANT abaixo (banco novo não tem o privilégio padrão do Supabase).
--
-- Ordem: independe do deploy (o app de hoje e o novo convivem com as quatro).
-- Idempotente. Conferência no fim: catálogo e privilégios sempre; com dado, as
-- funções CHAMADAS num subbloco desfeito por SQLSTATE próprio (P1130).
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0) A conversa da conferência, escolhida ANTES de qualquer trava (a forma da
--    1118): 1:1 aberta, sem pausa, sem turno vivo, card ABERTO numa etapa sem
--    agente, uma conexão da conta, e a mensagem MAIS NOVA por `gravada_em` viva.
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
     AND EXISTS (SELECT 1 FROM (SELECT m.deleted_at FROM messages m
                                 WHERE m.conversation_id = cv.id AND m.gravada_em IS NOT NULL
                                 ORDER BY m.gravada_em DESC, m.id DESC LIMIT 1) u
                  WHERE u.deleted_at IS NULL)
   LIMIT 1;
  IF r.conv IS NOT NULL THEN
    PERFORM set_config('cb1130.conv', r.conv::text, true);
    PERFORM set_config('cb1130.conta', r.conta::text, true);
    PERFORM set_config('cb1130.situacao', r.situacao, true);
    PERFORM set_config('cb1130.deal', r.deal::text, true);
    PERFORM set_config('cb1130.etapa', r.etapa::text, true);
    PERFORM set_config('cb1130.canal', r.canal::text, true);
    PERFORM set_config('cb1130.ultima', (
      SELECT m.id::text FROM messages m
       WHERE m.conversation_id = r.conv AND m.gravada_em IS NOT NULL
       ORDER BY m.gravada_em DESC, m.id DESC LIMIT 1), true);
  END IF;
END $$;

-- As funções INVOKER (a reserva) leem a trilha como o service_role.
GRANT SELECT ON TABLE cb_lead_events TO service_role;

-- ---------------------------------------------------------------------------
-- 1) A reserva do envio (corpo da 1118): `mais_nova` sem a retomada; o teto
--    pelo território do agente
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

-- ---------------------------------------------------------------------------
-- 2) A fila (corpo da 1056): a linha empurrada volta a ser uma RESPOSTA limpa
-- ---------------------------------------------------------------------------
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
  -- O cliente escreveu (ou a triagem passou a conversa): a retomada pendente
  -- da conversa, em QUALQUER conexão, sai da fila.
  UPDATE cb_ia_turnos
     SET status = 'descartado',
         erro = 'o cliente escreveu antes da retomada',
         terminado_em = now(),
         updated_at = now()
   WHERE conversation_id = p_conversation_id
     AND account_id = p_account_id
     AND status = 'aguardando'
     AND tipo = 'retomada';

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
    -- 1130: a linha em conflito pode ser uma RETOMADA que um INSERT concorrente
    -- pôs na vaga entre o descarte acima e este INSERT. Ela vira o turno DESTA
    -- mensagem por inteiro (gatilho, mensagem inicial, agente, card, etapa):
    -- com os da retomada, o turno de resposta teria como gatilho a própria
    -- mensagem do agente. (Na linha de resposta, a regra da 1050 de sempre.)
    -- A passagem responde a uma mensagem igual ou mais VELHA que a do
    -- pendente: não troca o gatilho. A mensagem mais velha que chega por
    -- último (ingestões fora de ordem) também não.
    mensagem_gatilho_id = CASE
      WHEN t.tipo = 'retomada' THEN EXCLUDED.mensagem_gatilho_id
      WHEN EXCLUDED.veio_de_passagem THEN t.mensagem_gatilho_id
      WHEN coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.mensagem_gatilho_id
      ELSE EXCLUDED.mensagem_gatilho_id END,
    veio_de_passagem    = CASE WHEN t.tipo = 'retomada' THEN EXCLUDED.veio_de_passagem
                               ELSE t.veio_de_passagem OR EXCLUDED.veio_de_passagem END,
    mensagem_inicial_id = CASE WHEN t.tipo = 'retomada' THEN EXCLUDED.mensagem_inicial_id
                               ELSE t.mensagem_inicial_id END,
    -- O agente, o card e a etapa são os lidos JUNTO com o gatilho que fica.
    ia_agente_id = CASE
      WHEN t.tipo = 'retomada' THEN EXCLUDED.ia_agente_id
      WHEN NOT EXCLUDED.veio_de_passagem
       AND coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.ia_agente_id
      ELSE EXCLUDED.ia_agente_id END,
    deal_id = CASE
      WHEN t.tipo = 'retomada' THEN EXCLUDED.deal_id
      WHEN NOT EXCLUDED.veio_de_passagem
       AND coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.deal_id
      ELSE EXCLUDED.deal_id END,
    stage_id = CASE
      WHEN t.tipo = 'retomada' THEN EXCLUDED.stage_id
      WHEN NOT EXCLUDED.veio_de_passagem
       AND coalesce((SELECT n.gravada_em < v.gravada_em
                       FROM messages n, messages v
                      WHERE n.id = EXCLUDED.mensagem_gatilho_id
                        AND v.id = t.mensagem_gatilho_id), false)
        THEN t.stage_id
      ELSE EXCLUDED.stage_id END,
    -- 1130: a linha que fica é um turno de RESPOSTA — a retomada que um
    -- INSERT concorrente pôs na vaga entre o descarte acima e este INSERT não
    -- vira "o turno" do cliente (rodaria como retomada); e a marca de uma
    -- espera anterior (a repetição da geração, o horário) é da mensagem de
    -- antes. O CHECK da 1056 exige os três juntos.
    tipo                = 'resposta',
    tentativa           = NULL,
    tentativas          = NULL,
    erro                = NULL,
    executar_apos       = EXCLUDED.executar_apos,
    updated_at          = now()
  RETURNING t.id, t.executar_apos;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Encerrar (corpo da 1109): nem o turno que está NO MEIO do envio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_encerrar_limpa_ia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
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
    UPDATE cb_ia_turnos
       SET status = 'descartado',
           erro = 'conversa encerrada',
           terminado_em = now(),
           updated_at = now()
     WHERE conversation_id = NEW.id
       AND account_id = NEW.account_id
       AND status IN ('aguardando', 'rodando')
       AND mensagem_enviada_id IS NULL
       AND enviando_desde IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_encerrar_limpa_ia() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) A conversa apagada (corpo da 1110): a resposta que já saiu é `respondeu`
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_ia_turno_conversa_apagada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status := CASE
                  -- 1130: o id do provedor gravado = a resposta SAIU.
                  WHEN NEW.mensagem_enviada_id IS NOT NULL THEN 'respondeu'
                  WHEN NEW.status = 'rodando' AND NEW.enviando_desde IS NOT NULL THEN 'incerto'
                  ELSE 'descartado' END;
  NEW.erro := 'conversa apagada';
  NEW.terminado_em := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_turno_conversa_apagada() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo e privilégios; com a conversa
-- escolhida no passo 0, as quatro funções são CHAMADAS num subbloco desfeito
-- por SQLSTATE próprio — sem ela, NOTICE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conv     uuid := nullif(current_setting('cb1130.conv', true), '')::uuid;
  v_conta    uuid := nullif(current_setting('cb1130.conta', true), '')::uuid;
  v_situacao text := nullif(current_setting('cb1130.situacao', true), '');
  v_deal     uuid := nullif(current_setting('cb1130.deal', true), '')::uuid;
  v_etapa    uuid := nullif(current_setting('cb1130.etapa', true), '')::uuid;
  v_canal    uuid := nullif(current_setting('cb1130.canal', true), '')::uuid;
  v_ultima   uuid := nullif(current_setting('cb1130.ultima', true), '')::uuid;
  v_nome     text;
  v_agente   uuid;
  v_turno    uuid;
  v_desde    timestamptz;
  v_resposta uuid;
  v_retomada uuid;
  v_pendente uuid;
  v_fila     uuid;
  v_res      text;
  v_antes    text;
  v_status   text;
  v_erro     text;
  v_tipo     text;
BEGIN
  -- Uma de cada, fechadas ao navegador, abertas ao service_role (as RPCs).
  FOREACH v_nome IN ARRAY ARRAY['cb_ia_reservar_envio', 'cb_ia_enfileirar_turno', 'cb_encerrar_limpa_ia',
                                'cb_ia_turno_conversa_apagada'] LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = v_nome) <> 1 THEN
      RAISE EXCEPTION '1130: esperava UMA %', v_nome;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_encerrar_limpa_ia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_encerrar_limpa_ia()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_ia_turno_conversa_apagada()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_turno_conversa_apagada()', 'EXECUTE') THEN
    RAISE EXCEPTION '1130: função da IA aberta ao navegador';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '1130: service_role sem EXECUTE na reserva ou na fila';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_lead_events', 'SELECT') THEN
    RAISE EXCEPTION '1130: service_role sem SELECT na trilha (a reserva a lê)';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.cb_encerrar_limpa_ia()'::regprocedure) THEN
    RAISE EXCEPTION '1130: cb_encerrar_limpa_ia sem SECURITY DEFINER (encerrar pela tela falharia)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_encerrar_limpa_ia_trigger'
                  AND tgrelid = 'public.conversations'::regclass AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_ia_turnos_conversa_apagada_trigger'
                     AND tgrelid = 'public.cb_ia_turnos'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '1130: um gatilho da IA sumiu (encerrar ou conversa apagada)';
  END IF;

  BEGIN
    -- Como o motor: o service_role chama a fila e a reserva, e o passo
    -- "Encerrar conversa" encerra.
    SET LOCAL ROLE service_role;
    IF v_conv IS NOT NULL AND v_ultima IS NOT NULL THEN
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes, teto_respostas, retomada)
        VALUES (v_conta, '__conferencia_1130__', 'gemini', 'm', true, ARRAY[v_canal], 100, '{"ativa": true}'::jsonb)
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, v_ultima, 'rodando', now())
        RETURNING id, rodando_desde INTO v_turno, v_desde;

      -- (1) A reserva ANTES de tudo: o dado real pode já recusar (uma mensagem
      -- do robô depois da última, por ex.). Sem `ok`, (1a) e (1b) são puladas.
      v_antes := public.cb_ia_reservar_envio(v_turno, v_desde);
      IF v_antes = 'ok' THEN
        -- (1a) A retomada pendente, ancorada numa resposta do agente MAIS NOVA
        -- que o gatilho do turno, não é `mais_nova`. A mensagem é gravada pelo
        -- papel da migration: o INSERT em `messages` chama funções (a busca,
        -- 929) que o service_role de um banco NOVO não executa — e o que se
        -- prova aqui é a reserva, não o INSERT.
        RESET ROLE;
        INSERT INTO messages (conversation_id, sender_type, content_type, content_text, status, channel_id,
                              ia_agente_id, gravada_em)
          VALUES (v_conv, 'bot', 'text', '__conferencia_1130__', 'sent', v_canal, v_agente, clock_timestamp())
          RETURNING id INTO v_resposta;
        SET LOCAL ROLE service_role;
        INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                  mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos, tipo,
                                  tentativa, tentativas)
          VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_resposta, v_resposta, 'aguardando',
                  now() + interval '1 hour', 'retomada', 1, 1)
          RETURNING id INTO v_retomada;
        v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
        IF v_res <> 'ok' THEN
          RAISE EXCEPTION '1130: a retomada pendente fez a reserva do turno de resposta recusar (%)', v_res;
        END IF;
        -- (1b) …e o pendente de RESPOSTA com gatilho mais novo continua sendo.
        UPDATE cb_ia_turnos SET status = 'descartado', terminado_em = now() WHERE id = v_retomada;
        INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                  mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos)
          VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_resposta, v_resposta, 'aguardando',
                  now() + interval '1 hour')
          RETURNING id INTO v_pendente;
        v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
        IF v_res <> 'mais_nova' THEN
          RAISE EXCEPTION '1130: o pendente de resposta mais novo não recusou a reserva (%; esperava mais_nova)', v_res;
        END IF;
        UPDATE cb_ia_turnos SET status = 'descartado', terminado_em = now() WHERE id = v_pendente;
      ELSE
        RAISE NOTICE '1130: a reserva já respondia % — a retomada pendente não foi exercitada aqui.', v_antes;
      END IF;

      -- (2) A fila: o pendente de resposta com a marca de uma espera anterior,
      -- empurrado pela mensagem, volta LIMPO (e é a MESMA linha).
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos, erro)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, v_ultima, 'aguardando',
                now() + interval '1 hour', '__marca_1130__')
        RETURNING id INTO v_pendente;
      SELECT f.id INTO v_fila
        FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, 8000) f;
      SELECT status, erro, tipo INTO v_status, v_erro, v_tipo FROM cb_ia_turnos WHERE id = v_pendente;
      IF v_fila IS DISTINCT FROM v_pendente OR v_status <> 'aguardando' OR v_erro IS NOT NULL OR v_tipo <> 'resposta' THEN
        RAISE EXCEPTION '1130: a fila não devolveu o pendente limpo (fila %, status %, erro %, tipo %)',
          v_fila, v_status, v_erro, v_tipo;
      END IF;

      -- (3) Encerrar: o turno NO MEIO do envio fica (termina sozinho); o
      -- pendente é descartado, como antes.
      UPDATE cb_ia_turnos SET enviando_desde = now() WHERE id = v_turno;
      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_turno;
      IF v_status IS DISTINCT FROM 'rodando' THEN
        RAISE EXCEPTION '1130: encerrar mexeu no turno que estava enviando (ficou %)', v_status;
      END IF;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_pendente;
      IF v_status IS DISTINCT FROM 'descartado' THEN
        RAISE EXCEPTION '1130: encerrar não descartou o pendente (ficou %)', v_status;
      END IF;
      UPDATE conversations SET status = v_situacao WHERE id = v_conv;

      -- (4) A conversa apagada com o turno vivo cuja resposta JÁ SAIU: respondeu.
      UPDATE cb_ia_turnos SET mensagem_enviada_id = 'wamid.conferencia-1130' WHERE id = v_turno;
      UPDATE cb_ia_turnos SET conversation_id = NULL WHERE id = v_turno;
      SELECT status, erro INTO v_status, v_erro FROM cb_ia_turnos WHERE id = v_turno;
      IF v_status IS DISTINCT FROM 'respondeu' OR v_erro IS DISTINCT FROM 'conversa apagada' THEN
        RAISE EXCEPTION '1130: a conversa apagada marcou % (%) o turno que já respondeu', v_status, v_erro;
      END IF;
    ELSE
      RAISE NOTICE '1130: nenhuma conversa aberta com card numa etapa livre e uma última mensagem viva — as funções não foram chamadas aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1130';
  EXCEPTION WHEN SQLSTATE 'P1130' THEN
    NULL;
  END;

  RAISE NOTICE '1130: reserva (retomada fora do mais_nova; teto pelo território), fila, encerrar e conversa apagada conferidos.';
END $$;
