-- ============================================================================
-- 1080 — o envio do ROBÔ que não saiu fica no fio, e ninguém o lê como fala
-- ============================================================================
-- Decisão do operador (06/10/2026): quando a automação, o robô ou o agente de
-- IA tentam mandar por uma conexão e o provedor recusa (conexão fora do ar,
-- número sem WhatsApp), a tentativa aparece no fio como bolha "não enviada",
-- e a conversa sobe na lista. O app grava essa linha em `messages`
-- (`src/lib/whatsapp/envio-que-falhou.ts`): `sender_type = 'bot'`,
-- `status = 'failed'`, sem `message_id` — e com `nao_saiu = true`, a coluna
-- desta migration.
--
-- ⚠️⚠️ Uma linha de `messages` é lida como FALA por muita gente. Sem a coluna,
-- a tentativa que não saiu:
--   - apagava o "em atraso" (a resposta do agente de IA conta como
--     "respondido" no gatilho da 972, na versão da 1049) e o recálculo ao
--     apagar e o assentamento da mensagem histórica faziam o mesmo;
--   - fazia o agente de IA desistir ("o robô falou", na reserva do envio da
--     1056) e gastava o teto de respostas dele.
-- As quatro funções são recriadas com o corpo VIGENTE (conferido byte a byte
-- contra a produção em 06/10/2026: 1049 para as três do "respondido", 1056
-- para a reserva) e um `NOT nao_saiu` em cada pergunta "alguém falou?". Os
-- gatilhos não mudam de nome (a carga da 1033 os cala pelo nome).
-- Os leitores do lado do app filtram pela mesma coluna (pino
-- `src/lib/inbox/nao-saiu.chamadores.test.ts`).
--
-- ADITIVA: aplicar ANTES do deploy (o app grava a coluna).
-- `ADD COLUMN … DEFAULT false` é só catálogo (Postgres 11+), mas a trava é
-- exclusiva até o fim da transação: a escolha da conversa da conferência (a
-- consulta cara) roda ANTES da ALTER e passa para depois por `set_config`
-- local da transação — depois da ALTER, só catálogo e escritas por id.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0) A conversa da conferência, escolhida ANTES da trava (a forma da 1056):
--    1:1 aberta, sem pausa, sem turno vivo, card ABERTO numa etapa sem agente,
--    uma conexão da conta e uma última mensagem viva com `gravada_em`.
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
     AND EXISTS (SELECT 1 FROM messages m
                  WHERE m.conversation_id = cv.id AND m.gravada_em IS NOT NULL AND m.deleted_at IS NULL)
   LIMIT 1;
  IF r.conv IS NOT NULL THEN
    PERFORM set_config('cb1080.conv', r.conv::text, true);
    PERFORM set_config('cb1080.conta', r.conta::text, true);
    PERFORM set_config('cb1080.deal', r.deal::text, true);
    PERFORM set_config('cb1080.etapa', r.etapa::text, true);
    PERFORM set_config('cb1080.canal', r.canal::text, true);
    PERFORM set_config('cb1080.ultima', (
      SELECT m.id::text FROM messages m
       WHERE m.conversation_id = r.conv AND m.gravada_em IS NOT NULL AND m.deleted_at IS NULL
       ORDER BY m.gravada_em DESC, m.id DESC LIMIT 1), true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) A coluna
-- ---------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS nao_saiu boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN messages.nao_saiu IS
  'true = o ROBÔ tentou enviar e nada saiu (1080): a bolha "não enviada" do fio. Não é fala de ninguém — todo leitor que pergunta "alguém falou?" a ignora.';

-- ---------------------------------------------------------------------------
-- 2) O "em atraso" (972, versão da 1049): a resposta que não saiu não responde
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_marcar_aguardando_resposta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
    SET aguardando_desde = COALESCE(aguardando_desde, NEW.created_at, now())
    WHERE id = NEW.conversation_id
      AND group_id IS NULL
      AND aguardando_desde IS NULL;
  ELSIF NOT NEW.nao_saiu
    AND ((NEW.sender_type = 'agent' AND (NEW.sender_id IS NOT NULL OR NEW.from_device))
      OR (NEW.sender_type = 'bot' AND NEW.ia_agente_id IS NOT NULL)) THEN
    UPDATE conversations
    SET aguardando_desde = NULL
    WHERE id = NEW.conversation_id
      AND aguardando_desde IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cb_mensagem_apagada_recalcula_espera()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE conversations c
    SET aguardando_desde = (
      SELECT MIN(m.created_at)
      FROM messages m
      WHERE m.conversation_id = c.id
        AND m.sender_type = 'customer'
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE((
          SELECT MAX(h.created_at)
          FROM messages h
          WHERE h.conversation_id = c.id
            AND ((h.sender_type = 'agent' AND (h.sender_id IS NOT NULL OR h.from_device))
                 OR (h.sender_type = 'bot' AND h.ia_agente_id IS NOT NULL))
            AND h.deleted_at IS NULL
            AND NOT h.nao_saiu
        ), '-infinity'::timestamptz)
    )
    WHERE c.id = NEW.conversation_id
      AND c.group_id IS NULL
      AND c.status <> 'closed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_marcar_aguardando_resposta() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cb_mensagem_apagada_recalcula_espera() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cb_marcar_aguardando_resposta() TO service_role;
GRANT EXECUTE ON FUNCTION cb_mensagem_apagada_recalcula_espera() TO service_role;

create or replace function public.cb_assentar_mensagem_historica(
  p_conversation_id uuid,
  p_carimbo         timestamptz,
  p_da_equipe       boolean,
  p_espera_antes    timestamptz,
  p_conta_nao_lida  boolean
)
returns void
language sql
security invoker
set search_path = public
as $$
  update conversations c
  set unread_count = coalesce(c.unread_count, 0)
        + case when p_conta_nao_lida then 1 else 0 end,
      aguardando_desde = case
        when c.group_id is not null or c.status = 'closed' then null

        when p_da_equipe then
          case
            when p_espera_antes is null then c.aguardando_desde
            when p_carimbo > p_espera_antes then (
              select min(m.created_at)
              from messages m
              where m.conversation_id = c.id
                and m.sender_type = 'customer'
                and m.deleted_at is null
                and m.created_at > p_carimbo
                and not exists (
                  select 1
                  from messages h
                  where h.conversation_id = c.id
                    and ((h.sender_type = 'agent' and (h.sender_id is not null or h.from_device))
                         or (h.sender_type = 'bot' and h.ia_agente_id is not null))
                    and h.deleted_at is null
                    and not h.nao_saiu
                    and h.created_at > m.created_at
                )
            )
            when exists (
              select 1
              from messages h
              where h.conversation_id = c.id
                and ((h.sender_type = 'agent' and (h.sender_id is not null or h.from_device))
                     or (h.sender_type = 'bot' and h.ia_agente_id is not null))
                and h.deleted_at is null
                and not h.nao_saiu
                and h.created_at > p_espera_antes
            ) then c.aguardando_desde
            else least(p_espera_antes, c.aguardando_desde)
          end

        when exists (
          select 1
          from messages h
          where h.conversation_id = c.id
            and ((h.sender_type = 'agent' and (h.sender_id is not null or h.from_device))
                 or (h.sender_type = 'bot' and h.ia_agente_id is not null))
            and h.deleted_at is null
            and not h.nao_saiu
            and h.created_at > p_carimbo
        ) then case when c.aguardando_desde = p_carimbo then null else c.aguardando_desde end

        else least(c.aguardando_desde, p_carimbo)
      end,
      updated_at = now()
  where c.id = p_conversation_id;
$$;

revoke execute on function public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3) A reserva do envio do agente (1056): "o robô falou" e o teto contam só o
--    que saiu
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
-- Conferência (roda em banco vazio: catálogo e privilégios; as funções são
-- CHAMADAS num subbloco desfeito por SQLSTATE próprio, com a conversa
-- escolhida no passo 0 — sem ela, NOTICE)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f         text;
  v_conv    uuid := nullif(current_setting('cb1080.conv', true), '')::uuid;
  v_conta   uuid := nullif(current_setting('cb1080.conta', true), '')::uuid;
  v_deal    uuid := nullif(current_setting('cb1080.deal', true), '')::uuid;
  v_etapa   uuid := nullif(current_setting('cb1080.etapa', true), '')::uuid;
  v_canal   uuid := nullif(current_setting('cb1080.canal', true), '')::uuid;
  v_ultima  uuid := nullif(current_setting('cb1080.ultima', true), '')::uuid;
  v_agente  uuid;
  v_turno   uuid;
  v_desde   timestamptz;
  v_da_ia   uuid;
  v_do_robo uuid;
  v_saiu    uuid;
  v_res     text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'messages'
                    AND column_name = 'nao_saiu' AND data_type = 'boolean'
                    AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION '1080: messages.nao_saiu não existe (ou aceita nulo, ou não nasce false)';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'cb_marcar_aguardando_resposta', 'cb_mensagem_apagada_recalcula_espera',
    'cb_assentar_mensagem_historica', 'cb_ia_reservar_envio'
  ] LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = f) <> 1 THEN
      RAISE EXCEPTION '1080: esperava UMA %', f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = f AND p.prosrc LIKE '%nao_saiu%') THEN
      RAISE EXCEPTION '1080: % não ignora o envio que não saiu', f;
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'public.cb_marcar_aguardando_resposta()',
    'public.cb_mensagem_apagada_recalcula_espera()',
    'public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)',
    'public.cb_ia_reservar_envio(uuid, timestamptz)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1080: % aberta ao navegador', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1080: service_role sem EXECUTE em %', f;
    END IF;
  END LOOP;

  BEGIN
    SET LOCAL ROLE service_role;
    IF v_conv IS NOT NULL AND v_ultima IS NOT NULL THEN
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes, teto_respostas)
        VALUES (v_conta, '__conferencia_1080__', 'gemini', 'm', true, ARRAY[v_canal], 1)
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);
      -- O teto conta a partir daqui (a etapa pode ter `etapa_desde` nulo).
      UPDATE conversations
         SET aguardando_desde = now() - interval '1 hour', ia_retomada_em = now() - interval '1 hour'
       WHERE id = v_conv;

      -- (a) A resposta do agente que NÃO saiu não apaga o "em atraso".
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, status,
                            channel_id, ia_agente_id, nao_saiu)
        VALUES (v_conv, 'bot', 'text', '__conferencia_1080__', 'failed', v_canal, v_agente, true)
        RETURNING id INTO v_da_ia;
      IF (SELECT aguardando_desde FROM conversations WHERE id = v_conv) IS NULL THEN
        RAISE EXCEPTION '1080: a resposta do agente que não saiu apagou o "em atraso"';
      END IF;

      -- (b) A reserva: a tentativa da automação que não saiu não é "o robô
      --     falou", e a do agente não gasta o teto.
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, status,
                            channel_id, nao_saiu)
        VALUES (v_conv, 'bot', 'text', '__conferencia_1080__', 'failed', v_canal, true)
        RETURNING id INTO v_do_robo;
      -- Turno de RESPOSTA: \`tentativa\`/\`tentativas\` nulos (o CHECK do tipo, 1056).
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde, tipo)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ultima, v_ultima, 'rodando', now(),
                'resposta')
        RETURNING id, rodando_desde INTO v_turno, v_desde;
      v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
      IF v_res <> 'ok' THEN
        RAISE EXCEPTION '1080: com as duas tentativas que não saíram, a reserva respondeu % (esperava ok)', v_res;
      END IF;
      UPDATE messages SET nao_saiu = false WHERE id = v_do_robo;
      v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
      IF v_res <> 'robo_falou' THEN
        RAISE EXCEPTION '1080: com a automação que saiu, a reserva respondeu % (esperava robo_falou)', v_res;
      END IF;
      UPDATE messages SET nao_saiu = true WHERE id = v_do_robo;
      UPDATE messages SET nao_saiu = false WHERE id = v_da_ia;
      v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
      IF v_res <> 'teto' THEN
        RAISE EXCEPTION '1080: com a resposta do agente que saiu (teto 1), a reserva respondeu % (esperava teto)', v_res;
      END IF;
      UPDATE messages SET nao_saiu = true WHERE id = v_da_ia;

      -- (c) A resposta que SAIU apaga o "em atraso" (o ramo continua de pé)…
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, status,
                            channel_id, ia_agente_id)
        VALUES (v_conv, 'bot', 'text', '__conferencia_1080__', 'sent', v_canal, v_agente)
        RETURNING id INTO v_saiu;
      IF (SELECT aguardando_desde FROM conversations WHERE id = v_conv) IS NOT NULL THEN
        RAISE EXCEPTION '1080: a resposta do agente que saiu não apagou o "em atraso"';
      END IF;
      -- …e o recálculo ao apagar e o assentamento rodam com a coluna.
      UPDATE messages SET deleted_at = now() WHERE id = v_saiu;
      PERFORM public.cb_assentar_mensagem_historica(
        v_conv, now() - interval '2 hours', true, now() - interval '3 hours', false);
    ELSE
      RAISE NOTICE '1080: nenhuma conversa com card aberto numa etapa livre e uma última mensagem viva — as funções não foram chamadas aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1080';
  EXCEPTION WHEN SQLSTATE 'P1080' THEN
    NULL;
  END;

  RAISE NOTICE '1080: messages.nao_saiu e as quatro perguntas "alguém falou?" que a ignoram.';
END $$;
