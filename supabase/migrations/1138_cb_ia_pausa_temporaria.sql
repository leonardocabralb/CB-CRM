-- ============================================================================
-- 1138 — Agentes de IA: a pausa TEMPORÁRIA (revisa a D26; decisões do operador
-- de 11/11/2026, docs/PLANO-pausa-temporaria-da-ia.md)
-- ============================================================================
-- Até aqui a pausa era PERMANENTE: a equipe assumia, deixava uma dúvida sem
-- resposta e sumia, e a IA nunca voltava (os follow-ups morriam junto). Agora:
--
--  1. `ai_configs.ia_volta_apos_min` (linha PADRÃO da conta, ao lado da
--     `cotacao_dolar`): em quantos minutos sem resposta da equipe a IA volta.
--     Padrão 15; 0 = desligado (a pausa volta a ser permanente, como antes).
--     Configuração da CONTA: vale para todo agente.
--  2. O motivo `desativada` (o botão "Desativar IA"): permanente até
--     "Retomar IA". As TEMPORÁRIAS são `gente` e `botao` (o "Pausar"); as
--     permanentes, `desativada`, `transferencia` e `automacao`. A lista vive
--     também em TS (`MOTIVOS_TEMPORARIOS`, `src/lib/ia-agentes/pausa.ts`), com
--     pino lendo este arquivo.
--  3. A pausa por gente (`cb_pausar_ia_por_gente`, corpo da 1049; o gatilho e
--     o WHEN da 1118 não mudam) ganha três passos, depois da pausa de sempre:
--     a) na conversa JÁ pausada por motivo temporário, a fala da equipe vira
--        `gente` (o "Pausar" seguido de uma resposta é "a equipe respondeu") e
--        recarimba `ia_pausada_em`;
--     b) na conversa JÁ pausada, o pendente de RESPOSTA sai (`a equipe
--        respondeu`): é o turno que esperava os N minutos — a equipe respondeu
--        antes, e a faixa não pode dizer "volta às 14:32" sobre isso;
--     c) a PRÉ-ARMAÇÃO do follow-up depois da fala da equipe (P4): uma linha
--        `retomada` na fila, ancorada na mensagem da equipe, SEM agente, card
--        nem etapa (quem os escolhe é o TS — `lerCardEAgente` —, que dá à
--        linha a 1ª tentativa pela cadência do agente) e com a marca
--        `armar a partir da fala da equipe`. Só com N > 0, a conversa pausada
--        por `gente`, mensagem que a cliente lê (não a ligação) e um card
--        ABERTO numa etapa cujo agente está ligado, tem a conexão da mensagem
--        e a retomada ligada (filtro barato; a régua certa é a do TS). A fala
--        seguinte da equipe só move a âncora (`ON CONFLICT … DO UPDATE`); a
--        retomada da IA ou o pendente de resposta que estavam na vaga viram
--        esta linha (a equipe respondeu).
--     (b) e (c) seguem a régua da 1050 (só a fala MAIS NOVA que o gatilho de
--     quem está na fila mexe nele: transações concorrentes não trocam a vez)
--     e ficam num subbloco que vira WARNING: a fila da IA nunca derruba o
--     INSERT da mensagem da equipe, que já saiu no WhatsApp.
--  4. `cb_ia_voltar_da_pausa(turno, rodando_desde, minutos)`: o turno LEVANTA
--     a pausa temporária, sob a trava da conversa e com a cerca de posse.
--     Resposta: `voltou` | `cedo` (+ `volta_em`) | `equipe_respondeu` |
--     `alguem_escreveu` | `permanente` | `nao_pausada` | `encerrada` |
--     `sem_gatilho` | `descartado` (posse perdida). Na RESPOSTA: volta quando
--     a cliente espera há N min (âncora = `greatest(aguardando_desde,
--     ia_pausada_em)`) e nenhuma fala de gente veio depois do gatilho. Na
--     RETOMADA (o follow-up depois da equipe, P7): só a pausa `gente`, e
--     ninguém escreveu depois da âncora. Levantar NÃO mexe no teto
--     (`ia_retomada_em`) nem no responsável.
--
-- ADITIVA: aplicar ANTES do deploy (o app novo lê a coluna e chama a função).
-- O app anterior não grava `desativada` nem lê a coluna, e a pré-armação que
-- ele reivindicar sem agente é descartada pelo `conduzirRetomada` de hoje
-- ("retomada sem agente, card ou conexão"): convive. Idempotente; aplica em
-- banco vazio. Conferência no fim: catálogo e privilégios sempre; com dado, o
-- gatilho e a função EXERCITADOS num subbloco desfeito por SQLSTATE próprio
-- (P1138), na forma da 1130.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0) A conversa da conferência, escolhida ANTES de qualquer trava (a forma da
--    1130): 1:1 aberta, sem pausa, sem turno vivo, card ABERTO numa etapa sem
--    agente e uma conexão da conta.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT cv.id AS conv, cv.account_id AS conta, dl.id AS deal, dl.stage_id AS etapa, ch.id AS canal
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
    PERFORM set_config('cb1138.conv', r.conv::text, true);
    PERFORM set_config('cb1138.conta', r.conta::text, true);
    PERFORM set_config('cb1138.deal', r.deal::text, true);
    PERFORM set_config('cb1138.etapa', r.etapa::text, true);
    PERFORM set_config('cb1138.canal', r.canal::text, true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Em quantos minutos a IA volta (a configuração da CONTA)
-- ---------------------------------------------------------------------------
ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS ia_volta_apos_min smallint NOT NULL DEFAULT 15;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_configs_ia_volta_apos_min_check') THEN
    ALTER TABLE ai_configs
      ADD CONSTRAINT ai_configs_ia_volta_apos_min_check CHECK (ia_volta_apos_min BETWEEN 0 AND 1440);
  END IF;
END $$;
COMMENT ON COLUMN ai_configs.ia_volta_apos_min IS
  'Pausa temporária da IA (1138): em quantos minutos sem resposta da equipe a IA volta a responder (e faz follow-up da fala da equipe). Só a linha PADRÃO da conta (channel_id nulo) vale; 0 = desligado (a pausa fica até "Retomar IA").';

-- ---------------------------------------------------------------------------
-- 2) O motivo `desativada` (o botão "Desativar IA")
-- ---------------------------------------------------------------------------
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_ia_pausada_por_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_ia_pausada_por_check
  CHECK (ia_pausada_por IS NULL OR ia_pausada_por IN ('gente', 'botao', 'desativada', 'transferencia', 'automacao'));

-- ---------------------------------------------------------------------------
-- 3) A pausa por gente (corpo da 1049) + o temporário, o descarte e a
--    pré-armação do follow-up da equipe
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, como antes: o compositor insere com o cliente do OPERADOR
-- (sob RLS), e `cb_ia_turnos` é fechada ao navegador. A ordem das travas é a
-- do encerrar (`conversations` → `cb_ia_turnos`).
CREATE OR REPLACE FUNCTION public.cb_pausar_ia_por_gente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  c         record;
  v_minutos integer;
BEGIN
  -- O eco do PRÓPRIO turno (o `message_id` é o `mensagem_enviada_id` de um
  -- turno desta conversa) não é fala de gente. O eco que chega antes de o turno
  -- gravar o id pausa — aceito desde a 1049: é o lado seguro, e raro.
  IF EXISTS (
    SELECT 1 FROM cb_ia_turnos t
     WHERE t.conversation_id = NEW.conversation_id
       AND t.mensagem_enviada_id IS NOT NULL
       AND t.mensagem_enviada_id = NEW.message_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT cv.account_id, cv.contact_id, cv.group_id, cv.status,
         cv.ai_autoreply_disabled AS pausada, cv.ia_pausada_por AS motivo
    INTO c
    FROM conversations cv
   WHERE cv.id = NEW.conversation_id;
  IF NOT FOUND OR c.group_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- A pausa de sempre (1049): conversa 1:1 ainda não pausada, onde a IA ATUA ou
  -- PODE atuar (já respondeu, turno vivo, contato SEM card aberto — a equipe
  -- abriu a conversa —, ou card aberto numa etapa COM agente). Card só em
  -- etapa sem agente NÃO pausa: é o SDR fora do território da IA.
  UPDATE conversations cv
     SET ai_autoreply_disabled = true,
         ia_pausada_por = 'gente',
         ia_pausada_em = now()
   WHERE cv.id = NEW.conversation_id
     AND NOT cv.ai_autoreply_disabled
     AND (cv.ia_agente_id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM cb_ia_turnos v
             WHERE v.conversation_id = NEW.conversation_id
               AND v.status IN ('aguardando', 'rodando')
          )
          OR NOT EXISTS (
            SELECT 1 FROM deals d
             WHERE d.contact_id = cv.contact_id
               AND d.account_id = cv.account_id
               AND d.status = 'open'
          )
          OR EXISTS (
            SELECT 1 FROM deals d
              JOIN cb_ia_agente_etapas e ON e.stage_id = d.stage_id
             WHERE d.contact_id = cv.contact_id
               AND d.account_id = cv.account_id
               AND d.status = 'open'
          ));

  IF c.pausada THEN
    -- (a) A pausa TEMPORÁRIA que a equipe acabou de responder é "a equipe
    -- respondeu", de agora (o "Pausar" seguido de uma resposta também).
    UPDATE conversations cv
       SET ia_pausada_por = 'gente',
           ia_pausada_em = now()
     WHERE cv.id = NEW.conversation_id
       AND cv.ai_autoreply_disabled
       AND cv.ia_pausada_por IN ('gente', 'botao');
  END IF;

  -- (b) e (c) mexem na FILA da IA: um erro aqui (trava, tempo) nunca pode
  -- derrubar o INSERT da mensagem da equipe — ela já saiu no WhatsApp. Vira
  -- WARNING, como os gatilhos que não podem barrar a ingestão (a pausa acima
  -- fica: é o lado que cala a IA).
  BEGIN
    IF c.pausada THEN
      -- (b) O retorno que esperava a equipe responder: ela respondeu. Só o
      -- de mensagem do cliente ANTERIOR a esta fala (a régua da 1050): a
      -- mensagem mais nova, gravada em paralelo, ainda espera resposta.
      UPDATE cb_ia_turnos t
         SET status = 'descartado',
             erro = 'a equipe respondeu',
             terminado_em = now(),
             updated_at = now()
       WHERE t.conversation_id = NEW.conversation_id
         AND t.status = 'aguardando'
         AND t.tipo = 'resposta'
         AND coalesce((SELECT g.gravada_em FROM messages g WHERE g.id = t.mensagem_gatilho_id), '-infinity'::timestamptz)
             <= NEW.gravada_em;
    END IF;

    -- (c) A pré-armação do follow-up depois da fala da equipe (P4).
    IF NEW.content_type IS DISTINCT FROM 'call'
       AND NEW.channel_id IS NOT NULL
       AND c.status IS DISTINCT FROM 'closed'
       AND c.contact_id IS NOT NULL THEN
      SELECT coalesce((SELECT a.ia_volta_apos_min FROM ai_configs a
                        WHERE a.account_id = c.account_id AND a.channel_id IS NULL
                        LIMIT 1), 15)
        INTO v_minutos;
      IF v_minutos > 0
         AND EXISTS (
           SELECT 1 FROM conversations cv
            WHERE cv.id = NEW.conversation_id
              AND cv.ai_autoreply_disabled
              AND cv.ia_pausada_por = 'gente'
         )
         AND EXISTS (
           SELECT 1 FROM deals d
             JOIN cb_ia_agente_etapas e ON e.stage_id = d.stage_id
             JOIN cb_ia_agentes ag ON ag.id = e.ia_agente_id AND ag.account_id = d.account_id
            WHERE d.contact_id = c.contact_id
              AND d.account_id = c.account_id
              AND d.status = 'open'
              AND ag.ativo
              AND ag.arquivado_em IS NULL
              AND NEW.channel_id = ANY (ag.conexoes)
              AND coalesce(ag.retomada -> 'ativa' = 'true'::jsonb, false)
         ) THEN
        INSERT INTO cb_ia_turnos AS t (
          account_id, conversation_id, canal_id, mensagem_gatilho_id, mensagem_inicial_id,
          status, executar_apos, tipo, tentativa, tentativas, erro
        )
        VALUES (
          c.account_id, NEW.conversation_id, NEW.channel_id, NEW.id, NEW.id,
          'aguardando', now() + interval '30 seconds', 'retomada', 1, 1, 'armar a partir da fala da equipe'
        )
        ON CONFLICT (conversation_id, canal_id) WHERE status = 'aguardando'
        DO UPDATE SET
          ia_agente_id        = NULL,
          deal_id             = NULL,
          stage_id            = NULL,
          veio_de_passagem    = false,
          mensagem_gatilho_id = EXCLUDED.mensagem_gatilho_id,
          mensagem_inicial_id = EXCLUDED.mensagem_inicial_id,
          executar_apos       = EXCLUDED.executar_apos,
          tipo                = 'retomada',
          tentativa           = 1,
          tentativas          = 1,
          erro                = EXCLUDED.erro,
          contexto            = NULL,
          updated_at          = now()
        -- A régua da 1050: só a fala MAIS NOVA que o gatilho de quem ocupa a
        -- vaga troca a âncora (ou converte o ocupante). Duas falas em
        -- transações concorrentes, ou uma mensagem do cliente mais nova
        -- gravada em paralelo, não perdem a vez para a mais velha.
        WHERE coalesce((SELECT g.gravada_em FROM messages g WHERE g.id = t.mensagem_gatilho_id), '-infinity'::timestamptz)
              <= NEW.gravada_em;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'cb_pausar_ia_por_gente (1138): a fila da IA não foi atualizada para a mensagem % (%: %)',
      NEW.id, SQLSTATE, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_pausar_ia_por_gente() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) O turno LEVANTA a pausa temporária
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_ia_voltar_da_pausa(
  p_turno_id      uuid,
  p_rodando_desde timestamptz,
  p_minutos       integer
)
RETURNS TABLE (resultado text, volta_em timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  t         cb_ia_turnos%ROWTYPE;
  c         record;
  v_gatilho timestamptz;
  v_volta   timestamptz;
BEGIN
  SELECT * INTO t FROM cb_ia_turnos r WHERE r.id = p_turno_id;
  IF NOT FOUND OR t.status <> 'rodando' OR t.rodando_desde IS DISTINCT FROM p_rodando_desde THEN
    RETURN QUERY SELECT 'descartado'::text, NULL::timestamptz;
    RETURN;
  END IF;

  -- A trava da reserva: a pausa por gente, o encerramento e a mensagem do
  -- cliente (972) escrevem esta linha e esperam por ela.
  SELECT cv.status, cv.ai_autoreply_disabled, cv.ia_pausada_por, cv.ia_pausada_em, cv.aguardando_desde
    INTO c
    FROM conversations cv
   WHERE cv.id = t.conversation_id AND cv.account_id = t.account_id
   FOR NO KEY UPDATE;
  IF NOT FOUND OR c.status = 'closed' THEN
    RETURN QUERY SELECT 'encerrada'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT c.ai_autoreply_disabled THEN
    RETURN QUERY SELECT 'nao_pausada'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF coalesce(p_minutos, 0) <= 0 OR c.ia_pausada_por IS NULL OR c.ia_pausada_por NOT IN ('gente', 'botao') THEN
    RETURN QUERY SELECT 'permanente'::text, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT g.gravada_em INTO v_gatilho FROM messages g WHERE g.id = t.mensagem_gatilho_id;
  IF v_gatilho IS NULL THEN
    RETURN QUERY SELECT 'sem_gatilho'::text, NULL::timestamptz;
    RETURN;
  END IF;

  IF t.tipo = 'retomada' THEN
    -- O follow-up depois da fala da EQUIPE (P7): só a pausa `gente` (o "Pausar"
    -- sem resposta não tem âncora), e ninguém escreveu depois dela — a
    -- cliente (apagada também) ou a equipe (a tentativa que não saiu não).
    IF c.ia_pausada_por <> 'gente' THEN
      RETURN QUERY SELECT 'permanente'::text, NULL::timestamptz;
      RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.gravada_em > v_gatilho
         AND (m.sender_type = 'customer' OR (m.sender_type = 'agent' AND NOT m.nao_saiu))
    ) THEN
      RETURN QUERY SELECT 'alguem_escreveu'::text, NULL::timestamptz;
      RETURN;
    END IF;
  ELSE
    -- A RESPOSTA que esperava a equipe: a fala de GENTE depois do gatilho (a
    -- régua do gatilho da 1049/1118) quer dizer que a equipe respondeu.
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'agent'
         AND (m.sender_id IS NOT NULL OR m.from_device)
         AND m.ia_agente_id IS NULL
         AND NOT m.nao_saiu
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN QUERY SELECT 'equipe_respondeu'::text, NULL::timestamptz;
      RETURN;
    END IF;
    -- A cliente esperando há N min: desde a 1ª mensagem sem resposta (972) ou
    -- desde a pausa, a mais nova (o "Pausar" apertado depois da mensagem
    -- recomeça a contagem dali).
    v_volta := greatest(coalesce(c.aguardando_desde, v_gatilho), coalesce(c.ia_pausada_em, v_gatilho))
               + make_interval(mins => p_minutos);
    IF now() < v_volta THEN
      RETURN QUERY SELECT 'cedo'::text, v_volta;
      RETURN;
    END IF;
  END IF;

  UPDATE conversations
     SET ai_autoreply_disabled = false,
         ia_pausada_por = NULL,
         ia_pausada_em = NULL
   WHERE id = t.conversation_id AND account_id = t.account_id;
  RETURN QUERY SELECT 'voltou'::text, v_volta;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_voltar_da_pausa(uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_voltar_da_pausa(uuid, timestamptz, integer) TO service_role;
-- INVOKER: quem chama lê (e trava) o que ela toca (no-op na produção; banco
-- novo não tem o privilégio padrão do Supabase).
GRANT SELECT, UPDATE ON TABLE conversations TO service_role;
GRANT SELECT ON TABLE messages, cb_ia_turnos TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo e privilégios; com a conversa
-- escolhida no passo 0, o gatilho e a função EXERCITADOS num subbloco desfeito
-- por SQLSTATE próprio — sem ela, NOTICE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conv    uuid := nullif(current_setting('cb1138.conv', true), '')::uuid;
  v_conta   uuid := nullif(current_setting('cb1138.conta', true), '')::uuid;
  v_deal    uuid := nullif(current_setting('cb1138.deal', true), '')::uuid;
  v_etapa   uuid := nullif(current_setting('cb1138.etapa', true), '')::uuid;
  v_canal   uuid := nullif(current_setting('cb1138.canal', true), '')::uuid;
  v_agente  uuid;
  v_equipe  uuid;
  v_equipe2 uuid;
  v_cliente uuid;
  v_turno   uuid;
  v_desde   timestamptz;
  v_pre     uuid;
  v_res     text;
  v_volta   timestamptz;
  v_motivo  text;
  v_pausada boolean;
  v_status  text;
  v_erro    text;
  v_tipo    text;
  v_ancora  uuid;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'cb_ia_voltar_da_pausa') <> 1 THEN
    RAISE EXCEPTION '1138: esperava UMA cb_ia_voltar_da_pausa';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_voltar_da_pausa(uuid, timestamptz, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_voltar_da_pausa(uuid, timestamptz, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_pausar_ia_por_gente()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_pausar_ia_por_gente()', 'EXECUTE') THEN
    RAISE EXCEPTION '1138: função da IA aberta ao navegador';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_voltar_da_pausa(uuid, timestamptz, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1138: service_role sem EXECUTE em cb_ia_voltar_da_pausa';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.cb_pausar_ia_por_gente()'::regprocedure) THEN
    RAISE EXCEPTION '1138: cb_pausar_ia_por_gente sem SECURITY DEFINER (a resposta pela tela falharia)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_pausa_ia_por_gente_trigger'
                  AND tgrelid = 'public.messages'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION '1138: o gatilho da pausa por gente sumiu';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ai_configs'
                    AND column_name = 'ia_volta_apos_min' AND is_nullable = 'NO'
                    AND column_default LIKE '15%') THEN
    RAISE EXCEPTION '1138: ai_configs.ia_volta_apos_min não ficou NOT NULL DEFAULT 15';
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'conversations_ia_pausada_por_check'))
     NOT LIKE '%desativada%' THEN
    RAISE EXCEPTION '1138: o CHECK do motivo da pausa não aceita desativada';
  END IF;

  BEGIN
    IF v_conv IS NOT NULL THEN
      -- Um agente da conferência, ligado, com a conexão e a retomada, na etapa do card.
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes, teto_respostas, retomada)
        VALUES (v_conta, '__conferencia_1138__', 'gemini', 'm', true, ARRAY[v_canal], 100, '{"ativa": true}'::jsonb)
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);
      -- A conta com o padrão (15); sem a linha padrão, o gatilho usa 15.
      UPDATE ai_configs SET ia_volta_apos_min = 15 WHERE account_id = v_conta AND channel_id IS NULL;

      -- (1) A fala da equipe (celular) numa conversa sem pausa: pausa `gente`
      -- e PRÉ-ARMA o follow-up ancorado nela.
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, channel_id, message_id,
                            from_me, from_device, gravada_em)
        VALUES (v_conv, 'agent', 'text', '__conferencia_1138__ equipe', v_canal, 'conferencia-1138-equipe-1',
                true, true, clock_timestamp())
        RETURNING id INTO v_equipe;
      SELECT ai_autoreply_disabled, ia_pausada_por INTO v_pausada, v_motivo FROM conversations WHERE id = v_conv;
      IF NOT v_pausada OR v_motivo IS DISTINCT FROM 'gente' THEN
        RAISE EXCEPTION '1138: a fala da equipe não pausou por gente (%, %)', v_pausada, v_motivo;
      END IF;
      SELECT id, tipo, erro, mensagem_gatilho_id INTO v_pre, v_tipo, v_erro, v_ancora
        FROM cb_ia_turnos
       WHERE conversation_id = v_conv AND canal_id = v_canal AND status = 'aguardando';
      IF v_pre IS NULL OR v_tipo <> 'retomada' OR v_erro IS DISTINCT FROM 'armar a partir da fala da equipe'
         OR v_ancora IS DISTINCT FROM v_equipe THEN
        RAISE EXCEPTION '1138: a pré-armação do follow-up não nasceu (%, %, %)', v_tipo, v_erro, v_ancora;
      END IF;

      -- (2) A fala seguinte da equipe só MOVE a âncora (a mesma linha).
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, channel_id, message_id,
                            from_me, from_device, gravada_em)
        VALUES (v_conv, 'agent', 'text', '__conferencia_1138__ equipe 2', v_canal, 'conferencia-1138-equipe-2',
                true, true, clock_timestamp())
        RETURNING id INTO v_equipe2;
      SELECT mensagem_gatilho_id INTO v_ancora FROM cb_ia_turnos WHERE id = v_pre;
      IF v_ancora IS DISTINCT FROM v_equipe2 THEN
        RAISE EXCEPTION '1138: a fala seguinte da equipe não moveu a âncora da pré-armação';
      END IF;

      -- (3) O follow-up (a pré-armação, já resolvida) LEVANTA a pausa `gente`
      -- quando ninguém escreveu depois da âncora — como o service_role.
      UPDATE cb_ia_turnos
         SET status = 'rodando', rodando_desde = clock_timestamp(), ia_agente_id = v_agente,
             deal_id = v_deal, stage_id = v_etapa, erro = NULL
       WHERE id = v_pre
       RETURNING rodando_desde INTO v_desde;
      SET LOCAL ROLE service_role;
      SELECT r.resultado INTO v_res FROM public.cb_ia_voltar_da_pausa(v_pre, v_desde, 15) r;
      RESET ROLE;
      SELECT ai_autoreply_disabled INTO v_pausada FROM conversations WHERE id = v_conv;
      IF v_res <> 'voltou' OR v_pausada THEN
        RAISE EXCEPTION '1138: o follow-up não levantou a pausa (%; pausada %)', v_res, v_pausada;
      END IF;
      UPDATE cb_ia_turnos SET status = 'descartado', terminado_em = now() WHERE id = v_pre;

      -- (4) A RESPOSTA que espera a equipe: a cliente escreve, a pausa volta
      -- (a fala da equipe), e o turno pergunta.
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, channel_id, gravada_em)
        VALUES (v_conv, 'customer', 'text', '__conferencia_1138__ cliente', v_canal, clock_timestamp())
        RETURNING id INTO v_cliente;
      UPDATE conversations
         SET ai_autoreply_disabled = true, ia_pausada_por = 'gente', ia_pausada_em = clock_timestamp(),
             aguardando_desde = clock_timestamp()
       WHERE id = v_conv;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_cliente, v_cliente, 'rodando', clock_timestamp())
        RETURNING id, rodando_desde INTO v_turno, v_desde;
      SET LOCAL ROLE service_role;
      -- (4a) Antes dos N min: `cedo`, com a volta.
      SELECT r.resultado, r.volta_em INTO v_res, v_volta FROM public.cb_ia_voltar_da_pausa(v_turno, v_desde, 15) r;
      IF v_res <> 'cedo' OR v_volta IS NULL THEN
        RAISE EXCEPTION '1138: antes dos N min a resposta não foi cedo (%, %)', v_res, v_volta;
      END IF;
      -- (4b) Desligado na conta: permanente.
      SELECT r.resultado INTO v_res FROM public.cb_ia_voltar_da_pausa(v_turno, v_desde, 0) r;
      IF v_res <> 'permanente' THEN
        RAISE EXCEPTION '1138: com N = 0 a pausa não ficou permanente (%)', v_res;
      END IF;
      RESET ROLE;
      -- (4c) Vencido: volta.
      UPDATE conversations SET aguardando_desde = now() - interval '1 hour', ia_pausada_em = now() - interval '2 hours'
       WHERE id = v_conv;
      SET LOCAL ROLE service_role;
      SELECT r.resultado INTO v_res FROM public.cb_ia_voltar_da_pausa(v_turno, v_desde, 15) r;
      RESET ROLE;
      SELECT ai_autoreply_disabled INTO v_pausada FROM conversations WHERE id = v_conv;
      IF v_res <> 'voltou' OR v_pausada THEN
        RAISE EXCEPTION '1138: vencidos os N min a pausa não saiu (%; pausada %)', v_res, v_pausada;
      END IF;

      -- (5) A equipe respondeu depois do gatilho: o turno não levanta.
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, channel_id, message_id,
                            from_me, from_device, gravada_em)
        VALUES (v_conv, 'agent', 'text', '__conferencia_1138__ equipe 3', v_canal, 'conferencia-1138-equipe-3',
                true, true, clock_timestamp());
      UPDATE conversations SET aguardando_desde = now() - interval '1 hour', ia_pausada_em = now() - interval '2 hours'
       WHERE id = v_conv;
      SET LOCAL ROLE service_role;
      SELECT r.resultado INTO v_res FROM public.cb_ia_voltar_da_pausa(v_turno, v_desde, 15) r;
      RESET ROLE;
      IF v_res <> 'equipe_respondeu' THEN
        RAISE EXCEPTION '1138: a fala da equipe depois do gatilho não segurou a volta (%)', v_res;
      END IF;

      -- (6) Desativada: permanente.
      UPDATE conversations SET ia_pausada_por = 'desativada' WHERE id = v_conv;
      SET LOCAL ROLE service_role;
      SELECT r.resultado INTO v_res FROM public.cb_ia_voltar_da_pausa(v_turno, v_desde, 15) r;
      RESET ROLE;
      IF v_res <> 'permanente' THEN
        RAISE EXCEPTION '1138: a pausa desativada não foi permanente (%)', v_res;
      END IF;
      UPDATE cb_ia_turnos SET status = 'descartado', terminado_em = now() WHERE id = v_turno;

      -- (7) Na conversa já pausada por motivo TEMPORÁRIO, a fala da equipe
      -- descarta o pendente de RESPOSTA e vira `gente` (o "Pausar" respondido).
      UPDATE cb_ia_turnos SET status = 'descartado', terminado_em = now()
       WHERE conversation_id = v_conv AND status = 'aguardando';
      UPDATE conversations SET ia_pausada_por = 'botao' WHERE id = v_conv;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_cliente, v_cliente, 'aguardando',
                now() + interval '15 minutes')
        RETURNING id INTO v_turno;
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, channel_id, message_id,
                            from_me, from_device, gravada_em)
        VALUES (v_conv, 'agent', 'text', '__conferencia_1138__ equipe 4', v_canal, 'conferencia-1138-equipe-4',
                true, true, clock_timestamp());
      SELECT status, erro INTO v_status, v_erro FROM cb_ia_turnos WHERE id = v_turno;
      SELECT ia_pausada_por INTO v_motivo FROM conversations WHERE id = v_conv;
      IF v_status IS DISTINCT FROM 'descartado' OR v_erro IS DISTINCT FROM 'a equipe respondeu'
         OR v_motivo IS DISTINCT FROM 'gente' THEN
        RAISE EXCEPTION '1138: a resposta da equipe não descartou o retorno (%, %) ou não virou gente (%)',
          v_status, v_erro, v_motivo;
      END IF;
    ELSE
      RAISE NOTICE '1138: nenhuma conversa aberta com card numa etapa livre — o gatilho e a função não foram exercitados aqui.';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1138';
  EXCEPTION WHEN SQLSTATE 'P1138' THEN
    NULL;
  END;

  RAISE NOTICE '1138: pausa temporária (coluna da conta, motivo desativada, gatilho e cb_ia_voltar_da_pausa) conferida.';
END $$;
