-- 1049_cb_ia_quem_responde.sql
--
-- F2 dos agentes de IA, SIMPLIFICADA (docs/PLANO-agentes-de-ia.md, D24–D27,
-- decisões do operador de 26/09/2026): cada agente atua nas ETAPAS do funil
-- que o administrador marca. Card ABERTO do cliente numa dessas etapas = esse
-- agente responde (ligado, não arquivado, com a conexão da mensagem). Uma
-- etapa tem no máximo UM agente. Só card que ENTROU na etapa depois de o
-- agente ser ligado nela (D27). Gente respondeu = a IA para naquela conversa
-- até alguém clicar "Retomar IA" (D26).
--
-- ⚠️ Este arquivo foi REESCRITO em 26/09/2026. A versão anterior (entrada por
-- conexão, passo "Atribuir agente", geração da atribuição, D16/D17) nunca foi
-- aplicada em banco nenhum — conferido no histórico da produção no mesmo dia
-- —, então nada dela é apagado aqui: os objetos simplesmente não nascem.
--
-- O que faz:
--  1. `cb_ia_agentes.ativado_em`: quando o agente foi LIGADO, carimbado pelo
--     banco (INSERT ligado, ou desligado → ligado). Salvar de novo ligado não
--     recarimba. Acervo: agente já ligado ganha `now()`.
--  2. `cb_ia_agente_etapas`: onde cada agente atua. `stage_id` é a CHAVE
--     PRIMÁRIA — uma etapa, um agente (a segunda linha é 23505). `desde` =
--     quando o agente passou a atuar ali. Só ADMINISTRADOR lê (forma da
--     1032); só a rota escreve (service role). Arquivar o agente APAGA as
--     linhas dele (libera as etapas); apagar a etapa ou o agente leva a linha.
--  3. `deals.etapa_desde`: quando o card ENTROU na etapa em que está. O banco
--     carimba quando `stage_id` muda; salvar sem mudar a etapa não mexe. Todo
--     card existente fica com a hora desta migration — anterior a qualquer
--     agente ligado depois: é exatamente a D27. ⚠️ A carga da Kommo
--     (1014–1020) cala os gatilhos de `deals` (`DISABLE TRIGGER USER`): card
--     MOVIDO por ela não tem `etapa_desde` atualizado, e card CRIADO por ela
--     ganha a hora da carga (o DEFAULT).
--  4. `conversations`: `ia_agente_id` (o ÚLTIMO agente que respondeu — o turno
--     grava ao enviar), `ia_pausada_por` (`gente` | `botao` | `transferencia`
--     | `automacao`), `ia_pausada_em` e `ia_retomada_em` (o "Retomar IA":
--     o teto recomeça a contar dali). PAUSADA = `ai_autoreply_disabled`, a
--     coluna que já existia.
--  5. `messages.ia_agente_id`: quem escreveu, gravado SÓ pelo envio do agente.
--  6. Pausa por GENTE (gatilho AFTER INSERT em `messages`).
--  7. Encerrar limpa a IA e descarta os turnos vivos da conversa.
--  8. A resposta do agente conta como "respondido" (D11) nas três funções que
--     decidem a espera (as duas da 972 e a da 1011).
--  9. `cb_ia_turnos` (a fila E a trava) e três RPCs só de `service_role`.
-- 10. `claim_ai_reply_slot` fecha (E14); apagar a conexão descarta os turnos
--     pendentes dela.
--
-- ===========================================================================
-- CONTRATO DAS RPCs (todas só `service_role`, nenhuma com overload)
-- ===========================================================================
--
-- cb_ia_enfileirar_turno(
--   p_account_id uuid, p_conversation_id uuid, p_canal_id uuid,
--   p_ia_agente_id uuid, p_deal_id uuid, p_stage_id uuid,
--   p_mensagem_id uuid, p_espera_ms integer,
--   p_veio_de_passagem boolean DEFAULT false
-- ) RETURNS TABLE (id uuid, executar_apos timestamptz)
--   Grava ou EMPURRA o turno pendente (`aguardando`) da conversa nesta
--   conexão — um só por (conversa, conexão). Na rajada a mensagem nova vira
--   o gatilho, o `executar_apos` é empurrado (relógio do banco) e agente,
--   card e etapa passam a ser os da chamada. A PASSAGEM (D25:
--   `p_veio_de_passagem = true`, `p_espera_ms = 0`) que cai num pendente que
--   já existe NÃO troca o gatilho dele (o pendente é de mensagem igual ou
--   mais nova), mas leva agente/card/etapa, e o pendente passa a
--   `veio_de_passagem` (não passa de novo). ⚠️ Enfileirar a passagem com o
--   turno da triagem ainda `rodando` e só depois reivindicar: há UM `rodando`
--   por conversa, e o 23505 da reivindicação é "ocupado" (nada devolvido).
--   Quem passa marca o próprio turno `passou` ANTES de reivindicar o novo.
--
-- cb_ia_reivindicar_turno(p_turno_id uuid) RETURNS SETOF cb_ia_turnos
--   `aguardando` e vencido → `rodando` com `rodando_desde = now()` (a POSSE).
--   Devolve a linha inteira; nada devolvido = não venceu, já foi pego, ou há
--   outro `rodando` na conversa (o 23505 vira "ocupado", nunca erro).
--
-- cb_ia_reservar_envio(p_turno_id uuid, p_rodando_desde timestamptz)
--   RETURNS text
--   A última palavra antes de enviar, com a conversa TRAVADA. Tudo sai da
--   linha do turno (conversa, conexão, agente, card, etapa, gatilho). Devolve
--   'ok' ou o motivo, nesta ordem:
--     'descartado'       o turno não está `rodando` ou não é desta posse
--     'encerrada'        a conversa está encerrada (ou não existe)
--     'pausada'          `ai_autoreply_disabled`
--     'card_mudou'       o card não existe mais ou saiu da etapa do turno
--     'card_fechado'     o card não está `open`
--     'agente_desligado' o agente não está ligado, ou foi arquivado
--     'fora_da_conexao'  a conexão do turno não está nas `conexoes` dele
--     'agente_sem_etapa' o agente não é mais o dono da etapa do turno
--     'mais_nova'        há OUTRO turno pendente nesta conversa e conexão cuja
--                        mensagem, viva, é mais nova que o gatilho — a prova
--                        de que o cliente mandou mensagem RESPONDÍVEL depois
--                        (a régua `abreTurno` fica em JS; apagada não conta)
--     'robo_falou'       saída de robô/automação (`bot` sem `ia_agente_id`,
--                        não apagada) nesta conexão gravada depois do gatilho
--     'teto'             respostas deste agente na conversa gravadas depois
--                        de greatest(deal.etapa_desde, conversa.ia_retomada_em)
--                        já somam `teto_respostas`
--   Não escreve nada: o teto é CONTADO nas mensagens (um só `rodando` por
--   conversa), e a trava da linha da conversa serializa a reserva com a pausa
--   por gente e com o encerramento. O que chega depois da reserva é
--   simultaneidade aceita — a resposta já estava autorizada.
--
-- Fora das RPCs (o app escreve direto, com o cliente de serviço):
--   · o turno em `cb_ia_turnos` (cerca de posse: `status = 'rodando'` e o
--     `rodando_desde` do claim), e `conversations.ia_agente_id` ao enviar;
--   · Pausar/Retomar da faixa: pausar = `ai_autoreply_disabled = true`,
--     `ia_pausada_por = 'botao'`, `ia_pausada_em = now()`; retomar = pausa
--     limpa e `ia_retomada_em = now()`;
--   · o `set_ai` legado: desligar = pausa `'automacao'`; ligar = limpa a pausa
--     SÓ quando `ia_pausada_por = 'automacao'` (a de gente precisa do botão).
--
-- Os gatilhos e a reserva foram provados num Postgres 16 descartável com
-- dados (e o replay de todas as migrations num banco vazio).
--
-- Aditiva: aplicar ANTES do deploy. Idempotente. `SET LOCAL lock_timeout`:
-- `conversations`, `messages` e `deals` são tabelas quentes.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) Quando o agente foi LIGADO
-- ---------------------------------------------------------------------------
ALTER TABLE cb_ia_agentes ADD COLUMN IF NOT EXISTS ativado_em timestamptz;

CREATE OR REPLACE FUNCTION cb_ia_carimba_ativado_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ativo AND (TG_OP = 'INSERT' OR NOT OLD.ativo) THEN
    NEW.ativado_em := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_ia_agentes_carimba_ativado_em ON cb_ia_agentes;
CREATE TRIGGER cb_ia_agentes_carimba_ativado_em
  BEFORE INSERT OR UPDATE OF ativo ON cb_ia_agentes
  FOR EACH ROW EXECUTE FUNCTION cb_ia_carimba_ativado_em();

REVOKE EXECUTE ON FUNCTION cb_ia_carimba_ativado_em() FROM PUBLIC, anon, authenticated;

-- Acervo: o agente que já está ligado passa a contar de agora (D27).
UPDATE cb_ia_agentes SET ativado_em = now() WHERE ativo AND ativado_em IS NULL;

-- ---------------------------------------------------------------------------
-- 2) Onde o agente atua: as ETAPAS
-- ---------------------------------------------------------------------------
-- A etapa é a chave: uma etapa, um agente. `pipeline_stages` não tem
-- `account_id` — quem confere que a etapa é de um funil DA CONTA é o
-- repositório, antes de gravar. A FK do agente é COMPOSTA: a linha aponta
-- para um agente da MESMA conta.
CREATE TABLE IF NOT EXISTS cb_ia_agente_etapas (
  stage_id     uuid PRIMARY KEY REFERENCES pipeline_stages (id) ON DELETE CASCADE,
  account_id   uuid NOT NULL,
  ia_agente_id uuid NOT NULL,
  desde        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_ia_agente_etapas_agente_fkey FOREIGN KEY (ia_agente_id, account_id)
    REFERENCES cb_ia_agentes (id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cb_ia_agente_etapas_agente_idx
  ON cb_ia_agente_etapas (account_id, ia_agente_id);

ALTER TABLE cb_ia_agente_etapas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_ia_agente_etapas_select ON cb_ia_agente_etapas;
CREATE POLICY cb_ia_agente_etapas_select ON cb_ia_agente_etapas FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum))));

REVOKE ALL ON TABLE cb_ia_agente_etapas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_ia_agente_etapas TO authenticated;
GRANT ALL ON TABLE cb_ia_agente_etapas TO service_role;

-- A função da 1048 ganha uma linha: arquivar APAGA as etapas do agente (a
-- etapa fica livre para outro). O gatilho e o nome ficam.
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
    DELETE FROM cb_ia_agente_etapas
     WHERE account_id = NEW.account_id
       AND ia_agente_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_ia_agente_arquivado_sai_das_passagens() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Quando o card entrou na etapa
-- ---------------------------------------------------------------------------
-- `now()` no DEFAULT é avaliado UMA vez no ALTER (sem reescrever a tabela):
-- todo card existente fica com a hora desta migration.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS etapa_desde timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION cb_deals_carimba_etapa_desde()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    NEW.etapa_desde := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_deals_carimba_etapa_desde_trigger ON deals;
CREATE TRIGGER cb_deals_carimba_etapa_desde_trigger
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW EXECUTE FUNCTION cb_deals_carimba_etapa_desde();

REVOKE EXECUTE ON FUNCTION cb_deals_carimba_etapa_desde() FROM PUBLIC, anon, authenticated;

-- Cards ABERTOS por contato: a entrada do motor (o card do cliente) e a pausa
-- por gente (8) perguntam por aqui a cada mensagem, e `deals` só tinha índice
-- por conta, funil e etapa.
CREATE INDEX IF NOT EXISTS cb_deals_contato_aberto_idx ON deals (contact_id) WHERE status = 'open';

-- ---------------------------------------------------------------------------
-- 4) A IA na conversa: o último agente que respondeu e a pausa
-- ---------------------------------------------------------------------------
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_agente_id uuid;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_pausada_por text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_pausada_em timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_retomada_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_ia_pausada_por_check') THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_ia_pausada_por_check
      CHECK (ia_pausada_por IS NULL OR ia_pausada_por IN ('gente', 'botao', 'transferencia', 'automacao'));
  END IF;
  -- FK COMPOSTA (o agente da MESMA conta), SET NULL POR COLUNA (a forma
  -- simples tentaria zerar `account_id`). NOT VALID + VALIDATE: a coluna
  -- nasce nula e a validação não segura escritas.
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
-- 5) Quem escreveu a mensagem (só o envio do agente grava)
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
-- 6) Os turnos: a fila E a trava
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_ia_turnos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  conversation_id      uuid NOT NULL,
  -- A conexão da mensagem: o contexto do agente é SÓ dela (D4). Nula só se a
  -- conexão for apagada depois.
  canal_id             uuid,
  ia_agente_id         uuid,
  -- O card e a etapa que puseram este agente para responder (D24). Sem FK: é
  -- o retrato da hora do enfileiramento, e a reserva confere o card de novo.
  deal_id              uuid,
  stage_id             uuid,
  -- O turno nasceu de uma PASSAGEM (D25): não passa de novo.
  veio_de_passagem     boolean NOT NULL DEFAULT false,
  -- A ÚLTIMA mensagem da rajada (a que o turno responde) e a PRIMEIRA.
  mensagem_gatilho_id  uuid REFERENCES messages (id) ON DELETE SET NULL,
  mensagem_inicial_id  uuid REFERENCES messages (id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'aguardando' CHECK (status IN (
                         'aguardando', 'rodando', 'respondeu', 'transferiu', 'passou', 'sem_resposta',
                         'fora_do_horario', 'pausado_no_meio', 'descartado', 'falhou', 'incerto'
                       )),
  executar_apos        timestamptz NOT NULL DEFAULT now(),
  -- A POSSE: carimbada pela reivindicação.
  rodando_desde        timestamptz,
  -- Carimbado logo ANTES de chamar o provedor (morreu antes de enviar =
  -- falhou; no meio do envio = incerto).
  enviando_desde       timestamptz,
  -- O id do PROVEDOR da resposta, gravado ANTES do INSERT da mensagem: é o
  -- que a ingestão do eco consulta (E5) e o que a pausa por gente pula.
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
-- O eco (E5) e a pausa por gente: pelo id do provedor.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_enviada_idx
  ON cb_ia_turnos (mensagem_enviada_id)
  WHERE mensagem_enviada_id IS NOT NULL;
-- A sub-aba Turnos: os turnos de um agente, mais novos primeiro.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_agente_idx
  ON cb_ia_turnos (account_id, ia_agente_id, created_at DESC);
-- ⚠️ As FKs que o Postgres NÃO indexa sozinho: sem índice, cada linha apagada
-- do lado referenciado varre esta tabela inteira (o desfazer do histórico da
-- 1033 apaga ~68 mil mensagens). PARCIAIS nas anuláveis; a da conversa, cheia
-- (ela serve também à pausa por gente, que pergunta pelos turnos vivos).
CREATE INDEX IF NOT EXISTS cb_ia_turnos_mensagem_gatilho_idx
  ON cb_ia_turnos (mensagem_gatilho_id)
  WHERE mensagem_gatilho_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_ia_turnos_mensagem_inicial_idx
  ON cb_ia_turnos (mensagem_inicial_id)
  WHERE mensagem_inicial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_ia_turnos_conversa_idx
  ON cb_ia_turnos (conversation_id);
CREATE INDEX IF NOT EXISTS cb_ia_turnos_canal_idx
  ON cb_ia_turnos (canal_id)
  WHERE canal_id IS NOT NULL;

ALTER TABLE cb_ia_turnos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_ia_turnos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_ia_turnos TO service_role;

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES cb_ia_turnos (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ai_usage_log_turno_idx
  ON ai_usage_log (turno_id)
  WHERE turno_id IS NOT NULL;

-- Conexão apagada: os pendentes dela viram `descartado` ANTES do SET NULL da
-- FK — senão dois pendentes da mesma conversa em duas conexões apagadas
-- cairiam na mesma chave (conversa, NULL) e o DELETE da conexão ABORTARIA.
-- SECURITY DEFINER: quem apaga a conexão pode ser o admin sob RLS, e
-- `cb_ia_turnos` é fechada ao navegador.
CREATE OR REPLACE FUNCTION cb_ia_descartar_turnos_da_conexao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE cb_ia_turnos
     SET status = 'descartado',
         erro = 'conexão apagada',
         terminado_em = now(),
         updated_at = now()
   WHERE canal_id = OLD.id
     AND account_id = OLD.account_id
     AND status = 'aguardando';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cb_channels_descarta_turnos_de_ia ON cb_channels;
CREATE TRIGGER cb_channels_descarta_turnos_de_ia
  BEFORE DELETE ON cb_channels
  FOR EACH ROW EXECUTE FUNCTION cb_ia_descartar_turnos_da_conexao();

REVOKE EXECUTE ON FUNCTION cb_ia_descartar_turnos_da_conexao() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) As RPCs da fila (contrato no cabeçalho)
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
    -- pendente: não troca o gatilho.
    mensagem_gatilho_id = CASE WHEN EXCLUDED.veio_de_passagem THEN t.mensagem_gatilho_id
                               ELSE EXCLUDED.mensagem_gatilho_id END,
    veio_de_passagem    = t.veio_de_passagem OR EXCLUDED.veio_de_passagem,
    ia_agente_id        = EXCLUDED.ia_agente_id,
    deal_id             = EXCLUDED.deal_id,
    stage_id            = EXCLUDED.stage_id,
    executar_apos       = EXCLUDED.executar_apos,
    updated_at          = now()
  RETURNING t.id, t.executar_apos;
$$;

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
  v_contadas integer;
BEGIN
  SELECT * INTO t FROM cb_ia_turnos r WHERE r.id = p_turno_id;
  IF NOT FOUND OR t.status <> 'rodando' OR t.rodando_desde IS DISTINCT FROM p_rodando_desde THEN
    RETURN 'descartado';
  END IF;

  -- A trava: a pausa por gente e o encerramento escrevem esta linha e
  -- esperam por ela (FOR NO KEY UPDATE não disputa com a FK de quem insere
  -- mensagem ou turno).
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

  SELECT ag.ativo, ag.arquivado_em, ag.conexoes, ag.teto_respostas INTO a
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

  SELECT g.gravada_em INTO v_gatilho FROM messages g WHERE g.id = t.mensagem_gatilho_id;

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

REVOKE EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ia_reivindicar_turno(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_ia_reivindicar_turno(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) TO service_role;
-- As funções são INVOKER: quem chama precisa ler (e travar) o que elas tocam
-- (no-op na produção; em banco novo não há default privilege que conceda).
GRANT SELECT, UPDATE ON TABLE conversations TO service_role;
GRANT SELECT ON TABLE messages, deals, cb_ia_agentes TO service_role;

-- ---------------------------------------------------------------------------
-- 8) Pausa por GENTE (D26)
-- ---------------------------------------------------------------------------
-- Resposta de GENTE (`agent` com `sender_id`, ou o celular pareado), sem
-- `ia_agente_id`, gravada de verdade (`gravada_em` preenchida — a carga da
-- 1033 grava nula), numa conversa 1:1 ainda não pausada, onde a IA ATUA ou
-- PODE atuar → pausa por `gente`, até alguém clicar "Retomar IA". Pausa quando:
--  - a conversa tem `ia_agente_id` (a IA já respondeu nela), OU
--  - tem um turno vivo (`aguardando`/`rodando`): o advogado que responde nos
--    segundos entre a mensagem do cliente e a PRIMEIRA resposta da IA; OU
--  - o contato tem card ABERTO numa etapa COM agente (a equipe falou dentro do
--    território de um agente); OU
--  - o contato NÃO tem card aberto: a equipe ABRIU a conversa (o celular
--    pareado grava a mensagem e só DEPOIS o roteador cria o card na etapa de
--    entrada — sem isto, a triagem responderia por cima do advogado que
--    começou a conversa; revisão da F2, 26/09/2026).
-- NÃO pausa só quando todo card aberto do contato está em etapa SEM agente: é
-- o SDR trabalhando fora do território da IA, e mover o card depois para a
-- etapa de um agente é o jeito de entregar a conversa a ele (D24/D25).
-- Nunca o eco do PRÓPRIO turno (o `message_id` é o `mensagem_enviada_id` de um
-- turno desta conversa). O eco que chega antes de o turno gravar o id pausa —
-- aceito: é o lado seguro, e raro.
-- SECURITY DEFINER: o compositor insere com o cliente do OPERADOR (sob RLS), e
-- `cb_ia_turnos` é fechada ao navegador.
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
     AND NOT c.ai_autoreply_disabled
     AND (c.ia_agente_id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM cb_ia_turnos v
             WHERE v.conversation_id = NEW.conversation_id
               AND v.status IN ('aguardando', 'rodando')
          )
          OR NOT EXISTS (
            SELECT 1 FROM deals d
             WHERE d.contact_id = c.contact_id
               AND d.account_id = c.account_id
               AND d.status = 'open'
          )
          OR EXISTS (
            SELECT 1 FROM deals d
              JOIN cb_ia_agente_etapas e ON e.stage_id = d.stage_id
             WHERE d.contact_id = c.contact_id
               AND d.account_id = c.account_id
               AND d.status = 'open'
          ))
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
-- 9) Encerrar limpa a IA (E11)
-- ---------------------------------------------------------------------------
-- BEFORE e só na TRANSIÇÃO para encerrada (vale sob a RLS do operador, no
-- motor e no lote da 1018/1034): o último agente, a pausa e a retomada saem, e
-- os turnos `aguardando`/`rodando` da conversa viram `descartado` — inclusive
-- o que já começou a enviar. A reserva trava a mesma linha, então as duas se
-- serializam. SECURITY DEFINER: `cb_ia_turnos` é fechada ao navegador.
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
    UPDATE cb_ia_turnos
       SET status = 'descartado',
           erro = 'conversa encerrada',
           terminado_em = now(),
           updated_at = now()
     WHERE conversation_id = NEW.id
       AND account_id = NEW.account_id
       AND status IN ('aguardando', 'rodando');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_encerrar_limpa_ia_trigger ON conversations;
CREATE TRIGGER cb_encerrar_limpa_ia_trigger
  BEFORE UPDATE OF status ON conversations
  FOR EACH ROW EXECUTE FUNCTION cb_encerrar_limpa_ia();

REVOKE EXECUTE ON FUNCTION cb_encerrar_limpa_ia() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10) A resposta do agente conta como "respondido" (D11)
-- ---------------------------------------------------------------------------
-- Só as FUNÇÕES são recriadas: os gatilhos da 972 são calados PELO NOME pela
-- carga da 1033, e renomeá-los quebraria a carga aplicada.
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
-- 11) O contador de respostas do assistente anterior fecha (E14)
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
  v_canal   uuid;
  v_deal    uuid;
  v_etapa   uuid;
  v_agente  uuid;
  v_rod     uuid;
  v_desde   timestamptz;
  v_t1      uuid;
  v_t2      uuid;
  v_quantas integer;
  v_res     text;
  f         text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, uuid, uuid, integer, boolean)',
    'public.cb_ia_reivindicar_turno(uuid)',
    'public.cb_ia_reservar_envio(uuid, timestamptz)',
    'public.claim_ai_reply_slot(uuid, integer)',
    'public.cb_assentar_mensagem_historica(uuid, timestamptz, boolean, timestamptz, boolean)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1049: % aberta ao navegador', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1049: service_role sem EXECUTE em %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_carimba_ativado_em()', 'public.cb_deals_carimba_etapa_desde()',
    'public.cb_pausar_ia_por_gente()', 'public.cb_encerrar_limpa_ia()',
    'public.cb_marcar_aguardando_resposta()', 'public.cb_mensagem_apagada_recalcula_espera()',
    'public.cb_ia_agente_arquivado_sai_das_passagens()', 'public.cb_ia_descartar_turnos_da_conexao()'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1049: função de gatilho % exposta como RPC', f;
    END IF;
  END LOOP;
  -- Sem overload (a função da 1011 também só troca o corpo aqui).
  SELECT count(*) INTO v_quantas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cb_assentar_mensagem_historica';
  IF v_quantas <> 1 THEN
    RAISE EXCEPTION '1049: esperava UMA cb_assentar_mensagem_historica; há %', v_quantas;
  END IF;
  FOREACH f IN ARRAY ARRAY['cb_ia_enfileirar_turno', 'cb_ia_reivindicar_turno', 'cb_ia_reservar_envio'] LOOP
    SELECT count(*) INTO v_quantas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF v_quantas <> 1 THEN
      RAISE EXCEPTION '1049: esperava UMA %; há %', f, v_quantas;
    END IF;
  END LOOP;

  -- As tabelas: a fila fechada; as etapas só para leitura (a RLS de admin
  -- filtra) e escrita só do serviço.
  IF has_table_privilege('anon', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'INSERT') THEN
    RAISE EXCEPTION '1049: cb_ia_turnos aberta ao navegador';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_agente_etapas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_agente_etapas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_ia_agente_etapas', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_ia_agente_etapas', 'DELETE') THEN
    RAISE EXCEPTION '1049: cb_ia_agente_etapas aberta ao navegador além da leitura';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_ia_agente_etapas', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_agente_etapas', 'INSERT') THEN
    RAISE EXCEPTION '1049: cb_ia_agente_etapas sem a leitura do admin ou a escrita do serviço';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.cb_ia_agente_etapas'::regclass AND relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.cb_ia_turnos'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION '1049: RLS desligada numa tabela nova';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_ia_agente_etapas'
       AND policyname = 'cb_ia_agente_etapas_select' AND cmd = 'SELECT'
       AND qual LIKE '%ARRAY(%cb_contas_do_usuario(''admin''%'
  ) THEN
    RAISE EXCEPTION '1049: a leitura das etapas não é só de admin na forma da 1032';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_turnos_mensagem_gatilho_idx', 'public.cb_ia_turnos_mensagem_inicial_idx',
    'public.cb_ia_turnos_conversa_idx', 'public.cb_ia_turnos_canal_idx', 'public.ai_usage_log_turno_idx',
    'public.cb_ia_agente_etapas_agente_idx', 'public.conversations_ia_agente_idx'
  ] LOOP
    IF to_regclass(f) IS NULL THEN
      RAISE EXCEPTION '1049: índice % não existe', f;
    END IF;
  END LOOP;

  -- Os gatilhos que a carga da 1033 cala PELO NOME continuam com o nome.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_marcar_aguardando_resposta_trigger'
                    AND tgrelid = 'public.messages'::regclass) THEN
    RAISE EXCEPTION '1049: o gatilho cb_marcar_aguardando_resposta_trigger sumiu';
  END IF;
  FOREACH f IN ARRAY ARRAY['cb_channels_descarta_turnos_de_ia', 'cb_pausa_ia_por_gente_trigger',
                           'cb_encerrar_limpa_ia_trigger', 'cb_deals_carimba_etapa_desde_trigger',
                           'cb_ia_agentes_carimba_ativado_em'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = f AND NOT tgisinternal) THEN
      RAISE EXCEPTION '1049: o gatilho % não existe', f;
    END IF;
  END LOOP;
  -- Pausar e encerrar escrevem (ou leem) `cb_ia_turnos`, fechada ao navegador.
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.cb_encerrar_limpa_ia()'::regprocedure)
     OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.cb_pausar_ia_por_gente()'::regprocedure) THEN
    RAISE EXCEPTION '1049: pausa ou encerramento sem SECURITY DEFINER (falharia pela tela)';
  END IF;

  -- As RPCs CHAMADAS (o corpo só é analisado quando roda), como service_role.
  -- Uma conversa 1:1 aberta e sem pausa, sem turno vivo, com um card ABERTO do
  -- contato numa etapa livre e uma conexão da conta: é onde a reserva passa
  -- pelo corpo INTEIRO (com um agente de conferência, desfeito no fim).
  SELECT cv.id, cv.account_id, dl.id, dl.stage_id, ch.id
    INTO v_conv, v_conta, v_deal, v_etapa, v_canal
    FROM conversations cv
    JOIN deals dl ON dl.contact_id = cv.contact_id AND dl.account_id = cv.account_id AND dl.status = 'open'
    JOIN LATERAL (SELECT c2.id FROM cb_channels c2 WHERE c2.account_id = cv.account_id LIMIT 1) ch ON true
   WHERE cv.group_id IS NULL AND cv.status <> 'closed' AND NOT cv.ai_autoreply_disabled
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos t
                      WHERE t.conversation_id = cv.id AND t.status IN ('aguardando', 'rodando'))
     AND NOT EXISTS (SELECT 1 FROM cb_ia_agente_etapas e WHERE e.stage_id = dl.stage_id)
   LIMIT 1;
  BEGIN
    SET LOCAL ROLE service_role;
    PERFORM * FROM public.cb_ia_reivindicar_turno(gen_random_uuid());
    v_res := public.cb_ia_reservar_envio(gen_random_uuid(), now());
    IF v_res <> 'descartado' THEN
      RAISE EXCEPTION '1049: reserva de um turno que não existe respondeu %', v_res;
    END IF;
    IF v_conv IS NOT NULL THEN
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes)
        VALUES (v_conta, '__conferencia_1049__', 'gemini', 'm', true, ARRAY[v_canal])
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);
      -- A rajada: duas mensagens na mesma conversa e conexão = UM pendente, e
      -- antes do `executar_apos` nada é reivindicado.
      SELECT t.id INTO v_t1 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, NULL, 8000) t;
      SELECT t.id INTO v_t2 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, NULL, 8000) t;
      IF v_t1 IS DISTINCT FROM v_t2 THEN
        RAISE EXCEPTION '1049: a rajada abriu dois turnos pendentes';
      END IF;
      IF EXISTS (SELECT 1 FROM public.cb_ia_reivindicar_turno(v_t1)) THEN
        RAISE EXCEPTION '1049: turno reivindicado antes da espera de rajada';
      END IF;
      UPDATE cb_ia_turnos SET status = 'descartado' WHERE id = v_t1;
      -- O turno em curso: a reserva passa pelo corpo inteiro e dá `ok`...
      SELECT t.id INTO v_t1 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, NULL, 0) t;
      SELECT t.id, t.rodando_desde INTO v_rod, v_desde FROM public.cb_ia_reivindicar_turno(v_t1) t;
      IF v_rod IS NULL THEN
        RAISE EXCEPTION '1049: o turno vencido não foi reivindicado';
      END IF;
      v_res := public.cb_ia_reservar_envio(v_rod, v_desde);
      IF v_res <> 'ok' THEN
        RAISE EXCEPTION '1049: a reserva do turno em curso respondeu %', v_res;
      END IF;
      -- ...e, de outra posse, `descartado`.
      v_res := public.cb_ia_reservar_envio(v_rod, v_desde - interval '1 second');
      IF v_res <> 'descartado' THEN
        RAISE EXCEPTION '1049: a reserva de outra posse respondeu %', v_res;
      END IF;
      -- Encerrar (só `status` no SET) descarta o turno que roda.
      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      IF (SELECT status FROM cb_ia_turnos WHERE id = v_rod) <> 'descartado' THEN
        RAISE EXCEPTION '1049: encerrar não descartou o turno da conversa';
      END IF;
    ELSE
      RAISE NOTICE '1049: nenhuma conversa com card aberto numa etapa livre — a reserva não passou pelo corpo inteiro aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1049';
  EXCEPTION WHEN SQLSTATE 'P1049' THEN
    NULL;
  END;

  RAISE NOTICE '1049: quem responde — agentes por etapa, turnos, reserva, pausa por gente e a resposta do agente como "respondido".';
END $$;
