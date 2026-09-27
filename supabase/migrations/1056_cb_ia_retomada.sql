-- 1056_cb_ia_retomada.sql
--
-- A RETOMADA do agente de IA (pedido do operador, 27/09/2026): o agente fez
-- uma pergunta e o cliente não respondeu → mensagens de retomada numa
-- cadência (padrão 15 min, 1 h, 3 h, 6 h, 12 h e 48 h contados da última
-- mensagem do agente sem resposta), só dentro de uma janela do dia e longe
-- dos lembretes da reunião. Qualquer mensagem do cliente, da equipe ou de
-- uma automação depois da mensagem do agente PARA a série.
--
-- O desenho: a retomada é uma linha da MESMA fila de turnos (`cb_ia_turnos`,
-- `tipo = 'retomada'`), com `executar_apos` = o vencimento. Reusa a posse, a
-- reivindicação, o prazo, o recolhedor e a rede do cron. A âncora da série é
-- a `mensagem_gatilho_id`: a resposta do AGENTE que ficou sem resposta (não
-- uma mensagem do cliente). A tentativa k só existe depois da k-1.
--
-- O que faz:
--  1. `cb_ia_agentes.retomada jsonb`: `{ ativa, cadencia: [min…], janela:
--     { inicio, fim } }`; nulo = desligada. A forma é validada no app
--     (`lerRetomada`, como o `horario` e o `acesso`).
--  2. `cb_ia_turnos.tipo` ('resposta' | 'retomada'), `tentativa` (1-based) e
--     `tentativas` (o tamanho da cadência quando a tentativa foi armada — é o
--     "Retomada 2/6" da sub-aba Turnos), com um CHECK que amarra os três.
--  3. `cb_ia_enfileirar_turno` (corpo da 1050, mesma assinatura): ANTES de
--     gravar ou empurrar o pendente, DESCARTA toda retomada pendente da
--     conversa. É a mensagem do cliente que abre turno: sem isto, o
--     `ON CONFLICT` da rajada cairia em cima da retomada pendente da mesma
--     conexão e a transformaria num turno com o tipo errado. As mensagens que
--     NÃO abrem turno (figurinha, localização, conversa pausada…) não passam
--     por aqui: a retomada delas é parada quando vence (o turno confere que
--     ninguém escreveu depois da âncora) e, em último caso, pela reserva.
--  4. `cb_ia_reservar_envio` (corpo da 1049, mesma assinatura) ganha, SÓ
--     para a retomada, quatro recusas novas, depois de `agente_sem_etapa`:
--       'retomada_desligada'  o agente não tem mais a retomada ligada
--       'sem_ancora'          a mensagem do agente sumiu ou foi apagada
--       'cliente_respondeu'   mensagem do CLIENTE (em qualquer conexão,
--                             apagada ou não) gravada depois da âncora
--       'equipe_respondeu'    mensagem da equipe (`agent`) depois da âncora
--       'robo_falou'          robô/automação, ou OUTRO agente, depois da
--                             âncora, em qualquer conexão
--     O teto continua o mesmo e CONTA as retomadas (são mensagens do agente).
--     A trava da conversa (FOR NO KEY UPDATE) serializa a reserva com o
--     gatilho que a mensagem do cliente dispara em `conversations` (972):
--     quem escreveu enquanto a retomada era gerada faz a reserva recusar.
--  5. Índice parcial das retomadas pendentes (o descarte do item 3).
--
-- Aditiva: aplicar ANTES do deploy (o app lê `cb_ia_agentes.retomada` pelo
-- nome em toda leitura de agente, e a aba Turnos pede `tipo`). Idempotente.
-- Provada num Postgres 16 descartável com dados, e o replay num banco vazio.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) A configuração, por agente
-- ---------------------------------------------------------------------------
ALTER TABLE cb_ia_agentes ADD COLUMN IF NOT EXISTS retomada jsonb;

-- ---------------------------------------------------------------------------
-- 2) O tipo do turno e a tentativa
-- ---------------------------------------------------------------------------
ALTER TABLE cb_ia_turnos ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'resposta';
ALTER TABLE cb_ia_turnos ADD COLUMN IF NOT EXISTS tentativa integer;
ALTER TABLE cb_ia_turnos ADD COLUMN IF NOT EXISTS tentativas integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cb_ia_turnos_tipo_check') THEN
    ALTER TABLE cb_ia_turnos
      ADD CONSTRAINT cb_ia_turnos_tipo_check CHECK (
        (tipo = 'resposta' AND tentativa IS NULL AND tentativas IS NULL)
        -- `IS NOT NULL` explícito: com a tentativa nula, o BETWEEN daria NULL
        -- e o CHECK aceitaria a linha (NULL não reprova CHECK).
        OR (tipo = 'retomada' AND tentativa IS NOT NULL AND tentativas IS NOT NULL
            AND tentativa BETWEEN 1 AND 8 AND tentativas BETWEEN tentativa AND 8)
      );
  END IF;
END $$;

-- O descarte do item 3: as retomadas pendentes de uma conversa.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_retomada_pendente_idx
  ON cb_ia_turnos (conversation_id)
  WHERE status = 'aguardando' AND tipo = 'retomada';

-- ---------------------------------------------------------------------------
-- 3) A fila: a mensagem do cliente tira a retomada pendente
-- ---------------------------------------------------------------------------
-- Dois comandos na mesma função (VOLATILE: o segundo vê o primeiro). O
-- INSERT é o da 1050, sem mudança.
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

-- ---------------------------------------------------------------------------
-- 4) A reserva do envio: as recusas da retomada
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
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'agent'
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN 'equipe_respondeu';
    END IF;
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'bot'
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
     AND m.gravada_em > greatest(d.etapa_desde, c.ia_retomada_em);
  IF v_contadas >= a.teto_respostas THEN
    RETURN 'teto';
  END IF;

  RETURN 'ok';
END;
$$;

-- As duas metades do REVOKE e o GRANT de volta (CLAUDE.md, "Fechar EXECUTE
-- de função"): o motor chama como service_role.
REVOKE EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) TO service_role;
-- As funções são INVOKER: quem chama precisa ler (e travar) o que elas tocam
-- (no-op na produção; em banco novo não há default privilege que conceda).
GRANT SELECT, UPDATE ON TABLE conversations TO service_role;
GRANT SELECT ON TABLE messages, deals, cb_ia_agentes, cb_ia_agente_etapas TO service_role;
GRANT ALL ON TABLE cb_ia_turnos TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo, privilégios e as RPCs CHAMADAS
-- num subbloco desfeito por SQLSTATE próprio)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conv    uuid;
  v_conta   uuid;
  v_canal   uuid;
  v_deal    uuid;
  v_etapa   uuid;
  v_agente  uuid;
  v_ultima  uuid;
  v_antiga  uuid;
  v_ret     uuid;
  v_novo    uuid;
  v_desde   timestamptz;
  v_quantas integer;
  v_res     text;
  f         text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)',
    'public.cb_ia_reservar_envio(uuid, timestamptz)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1056: % aberta ao navegador', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1056: service_role sem EXECUTE em %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['cb_ia_enfileirar_turno', 'cb_ia_reservar_envio'] LOOP
    SELECT count(*) INTO v_quantas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF v_quantas <> 1 THEN
      RAISE EXCEPTION '1056: esperava UMA %; há %', f, v_quantas;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'cb_ia_agentes'
                    AND column_name = 'retomada' AND data_type = 'jsonb') THEN
    RAISE EXCEPTION '1056: cb_ia_agentes.retomada não existe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'cb_ia_turnos'
                    AND column_name = 'tipo' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '1056: cb_ia_turnos.tipo não existe (ou aceita nulo)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cb_ia_turnos_tipo_check') THEN
    RAISE EXCEPTION '1056: o CHECK do tipo do turno não existe';
  END IF;
  IF to_regclass('public.cb_ia_turnos_retomada_pendente_idx') IS NULL THEN
    RAISE EXCEPTION '1056: o índice das retomadas pendentes não existe';
  END IF;
  -- A fila continua fechada ao navegador.
  IF has_table_privilege('anon', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'SELECT') THEN
    RAISE EXCEPTION '1056: cb_ia_turnos aberta ao navegador';
  END IF;

  -- As RPCs CHAMADAS (o corpo só é analisado quando roda), como service_role.
  -- Uma conversa 1:1 aberta e sem pausa, sem turno vivo, com um card ABERTO
  -- do contato numa etapa livre e uma conexão da conta (a forma da 1049).
  SELECT cv.id, cv.account_id, dl.id, dl.stage_id, ch.id
    INTO v_conv, v_conta, v_deal, v_etapa, v_canal
    FROM conversations cv
    JOIN deals dl ON dl.contact_id = cv.contact_id AND dl.account_id = cv.account_id AND dl.status = 'open'
    JOIN LATERAL (SELECT c2.id FROM cb_channels c2 WHERE c2.account_id = cv.account_id LIMIT 1) ch ON true
   WHERE cv.group_id IS NULL AND cv.status <> 'closed' AND NOT cv.ai_autoreply_disabled
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos t
                      WHERE t.conversation_id = cv.id AND t.status IN ('aguardando', 'rodando'))
     AND NOT EXISTS (SELECT 1 FROM cb_ia_agente_etapas e WHERE e.stage_id = dl.stage_id)
     AND EXISTS (SELECT 1 FROM messages m
                  WHERE m.conversation_id = cv.id AND m.gravada_em IS NOT NULL AND m.deleted_at IS NULL)
   LIMIT 1;
  IF v_conv IS NOT NULL THEN
    -- A âncora "sem nada depois" (a última mensagem gravada) e, se houver, uma
    -- mais velha que a última do CLIENTE.
    -- Nunca apagada: a âncora apagada é `sem_ancora`.
    SELECT m.id INTO v_ultima FROM messages m
     WHERE m.conversation_id = v_conv AND m.gravada_em IS NOT NULL AND m.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM messages k
                        WHERE k.conversation_id = v_conv AND k.gravada_em > m.gravada_em)
     ORDER BY m.gravada_em DESC LIMIT 1;
    SELECT m.id INTO v_antiga FROM messages m
     WHERE m.conversation_id = v_conv AND m.deleted_at IS NULL
       AND m.gravada_em < (SELECT max(k.gravada_em) FROM messages k
                            WHERE k.conversation_id = v_conv AND k.sender_type = 'customer')
     ORDER BY m.gravada_em DESC LIMIT 1;
  END IF;

  BEGIN
    SET LOCAL ROLE service_role;
    IF v_conv IS NOT NULL AND v_ultima IS NOT NULL THEN
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes, retomada)
        VALUES (v_conta, '__conferencia_1056__', 'gemini', 'm', true, ARRAY[v_canal],
                '{"ativa": true, "cadencia": [15], "janela": {"inicio": "08:00", "fim": "21:00"}}'::jsonb)
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);

      -- A retomada ancorada na última mensagem (nada depois dela): a reserva
      -- passa pelo corpo inteiro e dá `ok`.
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde,
                                tipo, tentativa, tentativas)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, v_ultima, 'rodando', now(),
                'retomada', 1, 1)
        RETURNING id, rodando_desde INTO v_ret, v_desde;
      v_res := public.cb_ia_reservar_envio(v_ret, v_desde);
      IF v_res <> 'ok' THEN
        RAISE EXCEPTION '1056: a reserva da retomada sem nada depois da âncora respondeu %', v_res;
      END IF;

      -- A retomada desligada no agente: recusa.
      UPDATE cb_ia_agentes SET retomada = NULL WHERE id = v_agente;
      v_res := public.cb_ia_reservar_envio(v_ret, v_desde);
      IF v_res <> 'retomada_desligada' THEN
        RAISE EXCEPTION '1056: a reserva com a retomada desligada respondeu %', v_res;
      END IF;
      UPDATE cb_ia_agentes SET retomada = '{"ativa": true, "cadencia": [15]}'::jsonb WHERE id = v_agente;

      -- Âncora mais velha que uma mensagem do cliente: o cliente respondeu.
      IF v_antiga IS NOT NULL THEN
        UPDATE cb_ia_turnos SET mensagem_gatilho_id = v_antiga WHERE id = v_ret;
        v_res := public.cb_ia_reservar_envio(v_ret, v_desde);
        IF v_res <> 'cliente_respondeu' THEN
          RAISE EXCEPTION '1056: a reserva com o cliente escrevendo depois da âncora respondeu %', v_res;
        END IF;
      ELSE
        RAISE NOTICE '1056: a conversa não tem mensagem mais velha que a última do cliente — o "cliente_respondeu" não foi chamado aqui.';
      END IF;

      -- A fila: a retomada PENDENTE sai quando a mensagem do cliente enfileira
      -- o turno, e o turno novo nasce como resposta.
      UPDATE cb_ia_turnos
         SET status = 'aguardando', rodando_desde = NULL, mensagem_gatilho_id = v_ultima,
             executar_apos = now() + interval '1 hour'
       WHERE id = v_ret;
      SELECT t.id INTO v_novo
        FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, 8000) t;
      IF v_novo IS NULL OR v_novo = v_ret THEN
        RAISE EXCEPTION '1056: a mensagem do cliente não abriu um turno novo (a retomada ficou no lugar)';
      END IF;
      IF (SELECT status FROM cb_ia_turnos WHERE id = v_ret) <> 'descartado' THEN
        RAISE EXCEPTION '1056: a retomada pendente não foi descartada pela mensagem do cliente';
      END IF;
      IF (SELECT tipo FROM cb_ia_turnos WHERE id = v_novo) <> 'resposta' THEN
        RAISE EXCEPTION '1056: o turno novo não nasceu como resposta';
      END IF;
    ELSE
      RAISE NOTICE '1056: nenhuma conversa com card aberto numa etapa livre e uma última mensagem viva — a reserva e a fila não foram chamadas aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1056';
  EXCEPTION WHEN SQLSTATE 'P1056' THEN
    NULL;
  END;

  RAISE NOTICE '1056: a retomada — tipo do turno, a fila que a descarta e a reserva que a recusa.';
END $$;
