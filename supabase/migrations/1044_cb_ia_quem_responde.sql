-- 1044_cb_ia_quem_responde.sql
--
-- F2a do plano dos agentes de IA (docs/PLANO-agentes-de-ia.md, 5.2–5.7 e as
-- decisões da execução E1–E14): o banco de QUEM RESPONDE. Nesta fase nenhuma
-- tela liga um agente (a F2b traz as telas), então tudo aqui nasce inerte.
--
-- O que faz:
--  1. `cb_channels.ia_agente_entrada_id` (o agente de ENTRADA da conexão; nulo
--     = sem IA) e `ia_agente_entrada_desde` (quando a entrada foi ligada — a
--     P8: só contato criado depois disso é atendido pela entrada), carimbado
--     pelo BANCO quando a coluna sai de nula e zerado quando volta a nula.
--  2. `conversations.ia_agente_id` (o agente ATIVO), `ia_agente_desde`,
--     `ia_pausada_por` (`gente` | `transferencia` | `botao` | `automacao`) e
--     `ia_pausada_em`, ao lado de `ai_autoreply_disabled`, que continua sendo
--     o interruptor.
--  3. `messages.ia_agente_id`: quem escreveu, gravado SÓ pelo envio do agente,
--     no próprio INSERT (o gatilho AFTER INSERT da 972 lê).
--  4. `cb_ia_turnos`: a fila E a trava. Pendente POR CONEXÃO (Codex, #292) e um
--     só `rodando` por conversa, por índices únicos parciais; fechada ao
--     navegador. `ai_usage_log.turno_id`.
--  5. RPCs (só `service_role`): enfileirar (rajada: a mensagem nova empurra o
--     `executar_apos` e troca o gatilho), reivindicar (com o relógio do
--     banco; o 23505 do `rodando` vira "ocupado", nunca erro) e atribuir o
--     agente com a regra da D17 DENTRO da transação (E12).
--  6. Gatilho da PAUSA POR GENTE: resposta com `sender_id` ou `from_device`,
--     sem `ia_agente_id`, gravada de verdade (`gravada_em` preenchida — a carga
--     da 1033 grava nula e cala os gatilhos antigos pelo NOME, não este), só em
--     conversa com agente ativo e ainda não pausada, nunca o eco de um turno.
--  7. Encerrar a conversa limpa tudo da IA (E11); arquivar um agente o tira da
--     entrada das conexões e das conversas.
--  8. A resposta do agente conta como "respondido" (D11): o ramo
--     `sender_type = 'bot' AND ia_agente_id IS NOT NULL` nas TRÊS funções que
--     decidem a espera (as duas da 972 e `cb_assentar_mensagem_historica`,
--     vigente na 1011) — só a FUNÇÃO é recriada; os gatilhos da 972 são calados
--     PELO NOME pela carga da 1033, e renomeá-los quebraria a carga aplicada.
--  9. `claim_ai_reply_slot` fecha (E14): `anon` e `authenticated` a executavam.
--
-- Aditiva: aplicar ANTES do deploy. Idempotente. `SET LOCAL lock_timeout`:
-- `conversations` e `messages` são tabelas quentes.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) Agente de entrada da conexão
-- ---------------------------------------------------------------------------
ALTER TABLE cb_channels ADD COLUMN IF NOT EXISTS ia_agente_entrada_id uuid;
ALTER TABLE cb_channels ADD COLUMN IF NOT EXISTS ia_agente_entrada_desde timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cb_channels_ia_agente_entrada_fkey') THEN
    ALTER TABLE cb_channels
      ADD CONSTRAINT cb_channels_ia_agente_entrada_fkey
      FOREIGN KEY (ia_agente_entrada_id, account_id)
      REFERENCES cb_ia_agentes (id, account_id)
      ON DELETE SET NULL (ia_agente_entrada_id);
  END IF;
END $$;

-- Quando a entrada foi LIGADA: o banco carimba (nula → agente) e zera (agente
-- → nula). Trocar de agente mantém o carimbo — a régua da P8 é "contato
-- anterior à IA nesta conexão", não "anterior a este agente".
CREATE OR REPLACE FUNCTION cb_carimba_entrada_de_ia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ia_agente_entrada_id IS NULL THEN
    NEW.ia_agente_entrada_desde := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.ia_agente_entrada_id IS NULL THEN
    NEW.ia_agente_entrada_desde := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_channels_carimba_entrada_de_ia ON cb_channels;
CREATE TRIGGER cb_channels_carimba_entrada_de_ia
  BEFORE INSERT OR UPDATE OF ia_agente_entrada_id ON cb_channels
  FOR EACH ROW EXECUTE FUNCTION cb_carimba_entrada_de_ia();

REVOKE EXECUTE ON FUNCTION cb_carimba_entrada_de_ia() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) O agente ativo e a pausa na conversa
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_agente_id uuid;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_agente_desde timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_pausada_por text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_pausada_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_ia_pausada_por_check') THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_ia_pausada_por_check
      CHECK (ia_pausada_por IS NULL OR ia_pausada_por IN ('gente', 'transferencia', 'botao', 'automacao'));
  END IF;
  -- FK COMPOSTA: o agente é escrito em service role a partir de JSON (o passo
  -- "Atribuir agente"), e a FK simples só garantiria "existe um agente com esse
  -- id". SET NULL POR COLUNA: a forma simples tentaria zerar `account_id`.
  -- NOT VALID + VALIDATE: a coluna nasce nula, e a validação não segura
  -- escritas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_ia_agente_fkey') THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_ia_agente_fkey
      FOREIGN KEY (ia_agente_id, account_id)
      REFERENCES cb_ia_agentes (id, account_id)
      ON DELETE SET NULL (ia_agente_id)
      NOT VALID;
    ALTER TABLE conversations VALIDATE CONSTRAINT conversations_ia_agente_fkey;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversations_ia_agente_idx
  ON conversations (ia_agente_id) WHERE ia_agente_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Quem escreveu a mensagem (só o envio do agente grava)
-- ---------------------------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ia_agente_id uuid;

DO $$
BEGIN
  -- `messages` não tem `account_id`: FK simples. NOT VALID + VALIDATE para não
  -- segurar a ingestão enquanto valida.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_ia_agente_fkey') THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_ia_agente_fkey
      FOREIGN KEY (ia_agente_id) REFERENCES cb_ia_agentes (id) ON DELETE SET NULL
      NOT VALID;
    ALTER TABLE messages VALIDATE CONSTRAINT messages_ia_agente_fkey;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Os turnos: a fila E a trava
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_ia_turnos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  conversation_id      uuid NOT NULL,
  -- A conexão da mensagem: o contexto do agente é SÓ dela (D4), e o
  -- pendente é por conexão (Codex, #292). Nula só se a conexão for apagada
  -- depois.
  canal_id             uuid,
  ia_agente_id         uuid,
  -- A ÚLTIMA mensagem da rajada (a que o turno responde) e a PRIMEIRA (que o
  -- ON CONFLICT não troca).
  mensagem_gatilho_id  uuid REFERENCES messages (id) ON DELETE SET NULL,
  mensagem_inicial_id  uuid REFERENCES messages (id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'aguardando' CHECK (status IN (
                         'aguardando', 'rodando', 'respondeu', 'transferiu', 'sem_resposta',
                         'fora_do_horario', 'pausado_no_meio', 'descartado', 'falhou', 'incerto'
                       )),
  executar_apos        timestamptz NOT NULL DEFAULT now(),
  rodando_desde        timestamptz,
  -- Carimbado logo ANTES de chamar o provedor: é o que deixa o recolhedor
  -- separar "morreu antes de enviar" (falhou, sem transferir) de "morreu no
  -- meio do envio" (incerto: pode ter saído — transfere, nunca reenvia).
  enviando_desde       timestamptz,
  -- O id do PROVEDOR da resposta, gravado ANTES do INSERT da mensagem: é o
  -- que a ingestão do eco consulta (E5).
  mensagem_enviada_id  text,
  iteracoes            integer NOT NULL DEFAULT 0,
  acoes                jsonb NOT NULL DEFAULT '[]'::jsonb,
  tokens_entrada       integer,
  tokens_saida         integer,
  tokens_total         integer,
  erro                 text,
  terminado_em         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_ia_turnos_rodando_tem_posse CHECK (status <> 'rodando' OR rodando_desde IS NOT NULL),
  CONSTRAINT cb_ia_turnos_conversa_fkey FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations (id, account_id) ON DELETE CASCADE,
  CONSTRAINT cb_ia_turnos_canal_fkey FOREIGN KEY (canal_id, account_id)
    REFERENCES cb_channels (id, account_id) ON DELETE SET NULL (canal_id),
  CONSTRAINT cb_ia_turnos_agente_fkey FOREIGN KEY (ia_agente_id, account_id)
    REFERENCES cb_ia_agentes (id, account_id) ON DELETE SET NULL (ia_agente_id)
);

-- Um pendente por (conversa, conexão): a rajada. NULLS NOT DISTINCT: a conexão
-- apagada não pode abrir dois pendentes.
CREATE UNIQUE INDEX IF NOT EXISTS cb_ia_turnos_um_aguardando_idx
  ON cb_ia_turnos (conversation_id, canal_id) NULLS NOT DISTINCT
  WHERE status = 'aguardando';
-- Um rodando por CONVERSA: a trava.
CREATE UNIQUE INDEX IF NOT EXISTS cb_ia_turnos_um_rodando_idx
  ON cb_ia_turnos (conversation_id)
  WHERE status = 'rodando';
-- A rede do cron: os pendentes vencidos.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_vencidos_idx
  ON cb_ia_turnos (executar_apos)
  WHERE status = 'aguardando';
-- O recolhedor: os rodando velhos.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_rodando_idx
  ON cb_ia_turnos (rodando_desde)
  WHERE status = 'rodando';
-- O eco (E5): a ingestão pergunta pelo id do provedor.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_enviada_idx
  ON cb_ia_turnos (mensagem_enviada_id)
  WHERE mensagem_enviada_id IS NOT NULL;
-- A sub-aba Turnos (F2b): os turnos de um agente, mais novos primeiro.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_agente_idx
  ON cb_ia_turnos (account_id, ia_agente_id, created_at DESC);

ALTER TABLE cb_ia_turnos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_ia_turnos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_ia_turnos TO service_role;

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES cb_ia_turnos (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5) RPCs da fila e da atribuição (só service_role)
-- ---------------------------------------------------------------------------

-- Enfileira (ou empurra) o turno PENDENTE da conversa nesta conexão. A
-- mensagem nova empurra o `executar_apos` (relógio do BANCO) e vira o gatilho;
-- a primeira mensagem da rajada fica.
CREATE OR REPLACE FUNCTION public.cb_ia_enfileirar_turno(
  p_account_id      uuid,
  p_conversation_id uuid,
  p_canal_id        uuid,
  p_ia_agente_id    uuid,
  p_mensagem_id     uuid,
  p_espera_ms       integer
)
RETURNS TABLE (id uuid, executar_apos timestamptz)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  INSERT INTO cb_ia_turnos AS t (
    account_id, conversation_id, canal_id, ia_agente_id,
    mensagem_gatilho_id, mensagem_inicial_id, status, executar_apos
  )
  VALUES (
    p_account_id, p_conversation_id, p_canal_id, p_ia_agente_id,
    p_mensagem_id, p_mensagem_id, 'aguardando',
    now() + make_interval(secs => greatest(p_espera_ms, 0) / 1000.0)
  )
  ON CONFLICT (conversation_id, canal_id) WHERE status = 'aguardando'
  DO UPDATE SET
    mensagem_gatilho_id = EXCLUDED.mensagem_gatilho_id,
    ia_agente_id        = EXCLUDED.ia_agente_id,
    executar_apos       = EXCLUDED.executar_apos,
    updated_at          = now()
  RETURNING t.id, t.executar_apos;
$$;

-- Reivindica UM turno pendente e vencido. Com outro turno `rodando` na mesma
-- conversa o índice único recusa (23505): isso é "ocupado" — a rede do cron
-- tenta no tique seguinte —, nunca erro. Devolve a linha inteira do RETURNING
-- (reler reabriria a janela).
CREATE OR REPLACE FUNCTION public.cb_ia_reivindicar_turno(p_turno_id uuid)
RETURNS SETOF cb_ia_turnos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
    UPDATE cb_ia_turnos
       SET status = 'rodando', rodando_desde = now(), updated_at = now()
     WHERE cb_ia_turnos.id = p_turno_id
       AND status = 'aguardando'
       AND executar_apos <= now()
    RETURNING *;
EXCEPTION WHEN unique_violation THEN
  RETURN;
END;
$$;

-- Atribui o agente com a regra da D17, DENTRO da transação e com a conversa
-- travada (E12): ler "houve resposta de gente nas últimas 24 h?" no app e
-- gravar depois deixaria a resposta de um advogado no meio sem pausar.
--   · pausa por `botao` ou `transferencia` (ou sem motivo, anterior à 1044):
--     decisão de gente — NUNCA retomada por automação; o agente fica atribuído
--     e pausado.
--   · resposta de gente nas últimas 24 h (por `created_at`, apagada inclusive):
--     atribuído e pausado por `gente`.
--   · senão: retomada.
-- Nunca toca `assigned_agent_id`. Reatribuir o MESMO agente mantém o `desde`.
-- Zera o contador de respostas. O agente é relido AQUI, na execução: desligado
-- ou arquivado depois de a automação ser salva = `agente_indisponivel`, nada
-- gravado (Codex, #292) — senão a conversa ficaria com um agente que não
-- responde, e a próxima mensagem cairia na entrada. Com `p_canal_id` (a conexão
-- do disparo), o agente também tem de ATENDER essa conexão: atribuído fora
-- dela, ele não responderia (regra 4) e a entrada não o substitui (regra 5).
DROP FUNCTION IF EXISTS public.cb_atribuir_agente_de_ia(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.cb_atribuir_agente_de_ia(
  p_account_id      uuid,
  p_conversation_id uuid,
  p_ia_agente_id    uuid,
  p_canal_id        uuid DEFAULT NULL
)
RETURNS TABLE (resultado text, pausada_por text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  c record;
  v_gente boolean;
BEGIN
  SELECT cv.id, cv.group_id, cv.ia_agente_id, cv.ia_agente_desde,
         cv.ai_autoreply_disabled, cv.ia_pausada_por
    INTO c
    FROM conversations cv
   WHERE cv.id = p_conversation_id AND cv.account_id = p_account_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'sem_conversa'::text, NULL::text;
    RETURN;
  END IF;
  IF c.group_id IS NOT NULL THEN
    RETURN QUERY SELECT 'grupo'::text, NULL::text;
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cb_ia_agentes a
     WHERE a.id = p_ia_agente_id AND a.account_id = p_account_id
       AND a.arquivado_em IS NULL AND a.ativo
       AND (p_canal_id IS NULL OR p_canal_id = ANY (a.conexoes))
  ) THEN
    RETURN QUERY SELECT 'agente_indisponivel'::text, NULL::text;
    RETURN;
  END IF;

  IF c.ai_autoreply_disabled AND (c.ia_pausada_por IS NULL OR c.ia_pausada_por IN ('botao', 'transferencia')) THEN
    UPDATE conversations
       SET ia_agente_id = p_ia_agente_id,
           ia_agente_desde = CASE WHEN c.ia_agente_id = p_ia_agente_id THEN coalesce(c.ia_agente_desde, now()) ELSE now() END,
           ai_reply_count = 0,
           ia_pausada_por = coalesce(c.ia_pausada_por, 'botao'),
           ia_pausada_em = coalesce(ia_pausada_em, now())
     WHERE id = p_conversation_id;
    RETURN QUERY SELECT 'pausada_mantida'::text, coalesce(c.ia_pausada_por, 'botao');
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM messages h
     WHERE h.conversation_id = p_conversation_id
       AND h.sender_type = 'agent'
       AND (h.sender_id IS NOT NULL OR h.from_device)
       AND h.ia_agente_id IS NULL
       AND h.created_at > now() - interval '24 hours'
  ) INTO v_gente;

  IF v_gente THEN
    UPDATE conversations
       SET ia_agente_id = p_ia_agente_id,
           ia_agente_desde = CASE WHEN c.ia_agente_id = p_ia_agente_id THEN coalesce(c.ia_agente_desde, now()) ELSE now() END,
           ai_reply_count = 0,
           ai_autoreply_disabled = true,
           ia_pausada_por = 'gente',
           ia_pausada_em = CASE WHEN c.ai_autoreply_disabled AND c.ia_pausada_por = 'gente' THEN coalesce(ia_pausada_em, now()) ELSE now() END
     WHERE id = p_conversation_id;
    RETURN QUERY SELECT 'pausada_gente'::text, 'gente'::text;
    RETURN;
  END IF;

  UPDATE conversations
     SET ia_agente_id = p_ia_agente_id,
         ia_agente_desde = CASE WHEN c.ia_agente_id = p_ia_agente_id THEN coalesce(c.ia_agente_desde, now()) ELSE now() END,
         ai_reply_count = 0,
         ai_autoreply_disabled = false,
         ia_pausada_por = NULL,
         ia_pausada_em = NULL
   WHERE id = p_conversation_id;
  RETURN QUERY SELECT 'retomada'::text, NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ia_reivindicar_turno(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_ia_reivindicar_turno(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid) TO service_role;
-- As funções são INVOKER: quem chama precisa ler e escrever o que elas tocam
-- (no-op na produção; em banco novo não há default privilege que conceda).
GRANT SELECT, INSERT, UPDATE ON TABLE cb_ia_turnos TO service_role;
GRANT SELECT, UPDATE ON TABLE conversations TO service_role;
GRANT SELECT ON TABLE messages, cb_ia_agentes TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Pausa por gente
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: o compositor insere a mensagem com o cliente do OPERADOR
-- (sob RLS), e a pausa tem de valer seja qual for a policy de UPDATE dele —
-- a mesma razão da 972.
CREATE OR REPLACE FUNCTION cb_pausar_ia_por_gente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE conversations c
     SET ai_autoreply_disabled = true,
         ia_pausada_por = 'gente',
         ia_pausada_em = now()
   WHERE c.id = NEW.conversation_id
     AND c.group_id IS NULL
     AND c.ia_agente_id IS NOT NULL
     AND NOT c.ai_autoreply_disabled
     -- Eco ANTIGO (mensagem recuperada com carimbo anterior à atribuição do
     -- agente) não cala o agente de agora.
     AND NEW.created_at >= coalesce(c.ia_agente_desde, '-infinity'::timestamptz)
     -- Nunca o eco do PRÓPRIO turno (defesa dobrada do E5; a ingestão já o
     -- pula pelo mesmo id).
     AND NOT EXISTS (
       SELECT 1 FROM cb_ia_turnos t
        WHERE t.conversation_id = NEW.conversation_id
          AND t.mensagem_enviada_id IS NOT NULL
          AND t.mensagem_enviada_id = NEW.message_id
     );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_pausa_ia_por_gente_trigger ON messages;
CREATE TRIGGER cb_pausa_ia_por_gente_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (
    NEW.sender_type = 'agent'
    AND (NEW.sender_id IS NOT NULL OR NEW.from_device)
    AND NEW.ia_agente_id IS NULL
    AND NEW.gravada_em IS NOT NULL
  )
  EXECUTE FUNCTION cb_pausar_ia_por_gente();

REVOKE EXECUTE ON FUNCTION cb_pausar_ia_por_gente() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) Encerrar limpa a IA; arquivar tira o agente da entrada e das conversas
-- ---------------------------------------------------------------------------
-- BEFORE e só em NEW: vale sob a RLS do operador (o fio), no motor
-- (`close_conversation`) e no lote (1018/1034), que põem `status` no SET.
-- Só na TRANSIÇÃO para encerrada: a régua cobra conversa JÁ encerrada e
-- atribui o agente nela — o UPDATE seguinte com `status` no SET não pode
-- zerar o que acabou de ser gravado.
CREATE OR REPLACE FUNCTION cb_encerrar_limpa_ia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.ia_agente_id := NULL;
    NEW.ia_agente_desde := NULL;
    NEW.ai_autoreply_disabled := false;
    NEW.ia_pausada_por := NULL;
    NEW.ia_pausada_em := NULL;
    NEW.ai_reply_count := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_encerrar_limpa_ia_trigger ON conversations;
CREATE TRIGGER cb_encerrar_limpa_ia_trigger
  BEFORE UPDATE OF status ON conversations
  FOR EACH ROW EXECUTE FUNCTION cb_encerrar_limpa_ia();

REVOKE EXECUTE ON FUNCTION cb_encerrar_limpa_ia() FROM PUBLIC, anon, authenticated;

-- A função da 1043 ganha as duas limpezas novas (o gatilho e o nome ficam).
CREATE OR REPLACE FUNCTION cb_ia_agente_arquivado_sai_das_passagens()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.arquivado_em IS NULL AND NEW.arquivado_em IS NOT NULL THEN
    UPDATE cb_ia_agentes
       SET pode_passar_para = array_remove(pode_passar_para, NEW.id),
           updated_at = now()
     WHERE account_id = NEW.account_id
       AND pode_passar_para @> ARRAY[NEW.id];
    -- Agente arquivado não é entrada de conexão nenhuma...
    UPDATE cb_channels
       SET ia_agente_entrada_id = NULL
     WHERE account_id = NEW.account_id
       AND ia_agente_entrada_id = NEW.id;
    -- ...nem o agente ativo de conversa nenhuma.
    UPDATE conversations
       SET ia_agente_id = NULL,
           ia_agente_desde = NULL
     WHERE account_id = NEW.account_id
       AND ia_agente_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_ia_agente_arquivado_sai_das_passagens() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) A resposta do agente conta como "respondido" (D11)
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
  ELSIF (NEW.sender_type = 'agent' AND (NEW.sender_id IS NOT NULL OR NEW.from_device))
     OR (NEW.sender_type = 'bot' AND NEW.ia_agente_id IS NOT NULL) THEN
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

-- A versão VIGENTE é esta (a 1011 vira a anterior). O corpo é o da 1011; as
-- três perguntas "gente respondeu?" ganham o ramo da resposta do agente.
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
-- 9) O contador de respostas fecha (E14)
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo, privilégios e as RPCs CHAMADAS
-- num subbloco desfeito por SQLSTATE próprio)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conv    uuid;
  v_conta   uuid;
  v_t1      uuid;
  v_t2      uuid;
  v_quantas integer;
  v_res     text;
  f         text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, integer)',
    'public.cb_ia_reivindicar_turno(uuid)',
    'public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid)',
    'public.claim_ai_reply_slot(uuid, integer)',
    'public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1044: % aberta ao navegador', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1044: service_role sem EXECUTE em %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.cb_pausar_ia_por_gente()', 'public.cb_encerrar_limpa_ia()', 'public.cb_carimba_entrada_de_ia()',
    'public.cb_marcar_aguardando_resposta()', 'public.cb_mensagem_apagada_recalcula_espera()',
    'public.cb_ia_agente_arquivado_sai_das_passagens()'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1044: função de gatilho % exposta como RPC', f;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'INSERT') THEN
    RAISE EXCEPTION '1044: cb_ia_turnos aberta ao navegador';
  END IF;

  SELECT count(*) INTO v_quantas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cb_assentar_mensagem_historica';
  IF v_quantas <> 1 THEN
    RAISE EXCEPTION '1044: esperava UMA cb_assentar_mensagem_historica; há %', v_quantas;
  END IF;

  -- Os gatilhos que a carga da 1033 cala PELO NOME continuam com o nome.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_marcar_aguardando_resposta_trigger'
                    AND tgrelid = 'public.messages'::regclass) THEN
    RAISE EXCEPTION '1044: o gatilho cb_marcar_aguardando_resposta_trigger sumiu';
  END IF;

  -- As RPCs CHAMADAS (o corpo só é analisado quando roda), como service_role.
  SELECT c.id, c.account_id INTO v_conv, v_conta FROM conversations c WHERE c.group_id IS NULL LIMIT 1;
  BEGIN
    SET LOCAL ROLE service_role;
    -- Sem conversa (banco vazio) a atribuição responde sem escrever.
    SELECT a.resultado INTO v_res
      FROM public.cb_atribuir_agente_de_ia(coalesce(v_conta, gen_random_uuid()), coalesce(v_conv, gen_random_uuid()), gen_random_uuid()) a;
    IF v_res NOT IN ('sem_conversa', 'agente_indisponivel', 'grupo') THEN
      RAISE EXCEPTION '1044: atribuição de agente inexistente respondeu %', v_res;
    END IF;
    PERFORM * FROM public.cb_ia_reivindicar_turno(gen_random_uuid());
    IF v_conv IS NOT NULL THEN
      -- A rajada: duas mensagens na mesma conversa e conexão = UM pendente.
      SELECT t.id INTO v_t1 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, NULL, NULL, NULL, 8000) t;
      SELECT t.id INTO v_t2 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, NULL, NULL, NULL, 8000) t;
      IF v_t1 IS DISTINCT FROM v_t2 THEN
        RAISE EXCEPTION '1044: a rajada abriu dois turnos pendentes';
      END IF;
      -- Antes do `executar_apos`, nada é reivindicado.
      IF EXISTS (SELECT 1 FROM public.cb_ia_reivindicar_turno(v_t1)) THEN
        RAISE EXCEPTION '1044: turno reivindicado antes da espera de rajada';
      END IF;
    ELSE
      RAISE NOTICE '1044: banco vazio — a rajada não foi exercitada aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1044';
  EXCEPTION WHEN SQLSTATE 'P1044' THEN
    NULL;
  END;

  RAISE NOTICE '1044: quem responde — turnos, pausa por gente, entrada da conexão e a resposta do agente como "respondido".';
END $$;
