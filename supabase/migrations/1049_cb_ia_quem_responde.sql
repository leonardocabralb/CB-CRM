-- 1049_cb_ia_quem_responde.sql
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
--     o interruptor. E `ia_atribuicao`, a GERAÇÃO da atribuição (E12): um
--     gatilho BEFORE UPDATE a avança quando o agente muda (inclusive para
--     nulo: encerrar e arquivar), quando a pausa é retomada e quando o teto é
--     zerado — por QUALQUER caminho —, e só ele a escreve. A reserva do envio
--     exige a mesma geração que o turno leu: é o que invalida o turno velho
--     quando a conversa é encerrada, reaberta e reatribuída ao mesmo agente
--     no meio.
--  3. `messages.ia_agente_id`: quem escreveu, gravado SÓ pelo envio do agente,
--     no próprio INSERT (o gatilho AFTER INSERT da 972 lê).
--  4. `cb_ia_turnos`: a fila E a trava. Pendente POR CONEXÃO (Codex, #292) e um
--     só `rodando` por conversa, por índices únicos parciais; fechada ao
--     navegador. `ai_usage_log.turno_id`. Apagar a conexão DESCARTA os
--     pendentes dela antes do SET NULL da FK (senão dois pendentes da mesma
--     conversa colidiriam na chave (conversa, NULL) e o DELETE abortaria).
--  5. RPCs (só `service_role`): enfileirar (rajada: a mensagem nova empurra o
--     `executar_apos` e troca o gatilho), reivindicar (com o relógio do
--     banco; o 23505 do `rodando` vira "ocupado", nunca erro), atribuir o
--     agente com a regra da D17 DENTRO da transação (E12) — e, para a
--     ENTRADA, só se a conversa continua sem agente (`p_so_se_vazio`) — e o
--     "ligar" do `set_ai` com a MESMA regra (E13) — a pergunta das 24 h mora
--     numa função só. A reatribuição que não muda nada (o mesmo agente, sem
--     pausa) não escreve: nem zera o teto nem avança a geração. Mais os
--     índices das FKs que o Postgres não cria.
--  6. Gatilho da PAUSA POR GENTE: resposta com `sender_id` ou `from_device`,
--     sem `ia_agente_id`, gravada de verdade (`gravada_em` preenchida — a carga
--     da 1033 grava nula e cala os gatilhos antigos pelo NOME, não este)
--     DEPOIS da atribuição — só pelo `gravada_em`, nunca pelo `created_at`,
--     que no celular é o relógio do APARELHO —, só em conversa com agente
--     ativo e ainda não pausada, nunca o eco de um turno. Sem janela pelo
--     `created_at` (Codex, #292): um celular com o relógio mais de um dia
--     atrasado não pausava, e a IA falaria por cima do advogado. O preço,
--     aceito: a fala ANTIGA de gente recuperada pela 1010 (gravada agora, com
--     o carimbo de dias atrás) também pausa — o lado seguro, e raro.
--  7. Encerrar a conversa limpa tudo da IA (E11) e DESCARTA os turnos
--     `aguardando` e `rodando` dela; arquivar um agente o tira da entrada das
--     conexões e das conversas.
--  8. A resposta do agente conta como "respondido" (D11): o ramo
--     `sender_type = 'bot' AND ia_agente_id IS NOT NULL` nas TRÊS funções que
--     decidem a espera (as duas da 972 e `cb_assentar_mensagem_historica`,
--     vigente na 1011) — só a FUNÇÃO é recriada; os gatilhos da 972 são calados
--     PELO NOME pela carga da 1033, e renomeá-los quebraria a carga aplicada.
--  9. `claim_ai_reply_slot` fecha (E14): `anon` e `authenticated` a executavam.
--     E `cb_ia_reservar_envio`: a vaga do teto e a última conferência
--     (aberta, sem pausa, mesmo agente e mesma geração, o turno ainda
--     rodando, a mensagem do turno ainda lá sem ter sido apagada nem editada,
--     sem outro turno pendente na conexão com mensagem MAIS NOVA, sem saída do
--     robô depois da mensagem do turno) numa escrita só.
--
-- Os gatilhos (a geração e sua ORDEM depois do encerramento, a pausa por
-- gente, o descarte no encerramento) foram provados num Postgres 16
-- descartável com dados; a conferência do fim cobra a ordem no catálogo.
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

-- A GERAÇÃO da atribuição (E12). O turno a lê junto com o agente na
-- conferência antes de gerar, e a reserva do envio exige a mesma: conversa
-- encerrada, reaberta e reatribuída ao MESMO agente no meio de um turno passa
-- por "aberta, sem pausa, mesmo agente", e só a geração a denuncia (Codex,
-- #292). Avança quando:
--   · o agente muda — `IS DISTINCT FROM`, inclusive para nulo (encerrar e
--     arquivar zeram) e de volta de nulo;
--   · a pausa é retomada (`ai_autoreply_disabled` de true para false);
--   · o teto é zerado (`ai_reply_count` de >0 para 0).
-- Pausar NÃO avança (a reserva recusa pela pausa). A reatribuição que não
-- muda nada (o mesmo agente, sem pausa) não toca nenhuma das três colunas, e
-- por isso não avança: uma automação que atribui o mesmo agente a cada
-- mensagem descartaria todo turno em curso.
-- ⚠️ Por QUALQUER caminho — atribuição, botão, `set_ai`, encerramento (que
-- zera o agente num gatilho BEFORE, com só `status` no SET) —, então o
-- gatilho NÃO tem lista de colunas: um `BEFORE UPDATE OF` só dispara pelas
-- colunas do SET e não veria o que outro gatilho BEFORE mudou. O WHEN vê o NEW
-- já modificado pelos gatilhos BEFORE anteriores, que o Postgres dispara em
-- ORDEM ALFABÉTICA: o nome tem de vir DEPOIS de todo gatilho BEFORE UPDATE de
-- `conversations` que mexa nessas colunas (hoje `cb_encerrar_limpa_ia_trigger`
-- — a conferência do fim cobra isso no catálogo).
-- ⚠️ Só o banco escreve a geração: um UPDATE que a mande (o navegador tem
-- UPDATE em `conversations` sob RLS) é desfeito aqui.
-- ⚠️ A devolução da ÚNICA vaga (`ai_reply_count` de 1 para 0) é, para a
-- linha, igual a zerar o teto, e também avança a geração. Por isso ela tem de
-- acontecer com o turno que devolve ainda `rodando` (há um só por conversa, e
-- o pendente seguinte, reivindicado depois, lê a geração nova): devolvida
-- depois, o turno seguinte já reivindicado seria recusado como `mudou` —
-- nenhuma resposta, nunca duas.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ia_atribuicao bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION cb_ia_avanca_geracao_da_atribuicao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ia_agente_id IS DISTINCT FROM OLD.ia_agente_id
     OR (OLD.ai_autoreply_disabled AND NOT NEW.ai_autoreply_disabled)
     OR (OLD.ai_reply_count > 0 AND NEW.ai_reply_count = 0) THEN
    NEW.ia_atribuicao := OLD.ia_atribuicao + 1;
  ELSE
    NEW.ia_atribuicao := OLD.ia_atribuicao;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_ia_geracao_da_atribuicao_trigger ON conversations;
CREATE TRIGGER cb_ia_geracao_da_atribuicao_trigger
  BEFORE UPDATE ON conversations
  FOR EACH ROW
  WHEN (
    NEW.ia_agente_id IS DISTINCT FROM OLD.ia_agente_id
    OR (OLD.ai_autoreply_disabled AND NOT NEW.ai_autoreply_disabled)
    OR (OLD.ai_reply_count > 0 AND NEW.ai_reply_count = 0)
    OR NEW.ia_atribuicao IS DISTINCT FROM OLD.ia_atribuicao
  )
  EXECUTE FUNCTION cb_ia_avanca_geracao_da_atribuicao();

REVOKE EXECUTE ON FUNCTION cb_ia_avanca_geracao_da_atribuicao() FROM PUBLIC, anon, authenticated;

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
-- ⚠️ As FKs que o Postgres NÃO indexa sozinho: sem índice, cada linha apagada
-- do lado referenciado varre esta tabela inteira. Apagar mensagem (o desfazer
-- do histórico da 1033 apaga ~68 mil) passa pelas duas de mensagem; apagar
-- contato ou conversa cascateia pela da conversa. PARCIAIS nas anuláveis: o
-- `col = $1` da checagem da FK implica `col IS NOT NULL`, e o índice serve.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_mensagem_gatilho_idx
  ON cb_ia_turnos (mensagem_gatilho_id)
  WHERE mensagem_gatilho_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_ia_turnos_mensagem_inicial_idx
  ON cb_ia_turnos (mensagem_inicial_id)
  WHERE mensagem_inicial_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_ia_turnos_conversa_idx
  ON cb_ia_turnos (conversation_id);
-- ...e a da conexão: apagar uma conexão faz o SET NULL de `canal_id` (e o
-- gatilho abaixo descarta os pendentes dela) — sem índice, varreria a tabela.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_canal_idx
  ON cb_ia_turnos (canal_id)
  WHERE canal_id IS NOT NULL;

ALTER TABLE cb_ia_turnos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_ia_turnos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_ia_turnos TO service_role;

ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES cb_ia_turnos (id) ON DELETE SET NULL;
-- Turno sai em lote (a conversa apagada o leva em CASCADE; a poda de 90 dias
-- do plano também apagará): sem índice, cada turno apagado varreria o log de
-- uso inteiro.
CREATE INDEX IF NOT EXISTS ai_usage_log_turno_idx
  ON ai_usage_log (turno_id)
  WHERE turno_id IS NOT NULL;

-- Conexão apagada: os pendentes dela viram `descartado` ANTES do SET NULL da
-- FK. O índice do pendente é (conversa, canal) com NULLS NOT DISTINCT: dois
-- pendentes da mesma conversa em duas conexões apagadas (ou em sequência)
-- cairiam na mesma chave (conversa, NULL) e o DELETE da conexão ABORTARIA. E
-- o pendente sem conexão não tem mais contexto (D4): o agente só vê a conexão
-- da mensagem. BEFORE: a ação da FK roda depois, no fim do comando.
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

-- A pergunta da D17 — "alguém da equipe respondeu nas últimas 24 h?" — num
-- lugar só: a atribuição do agente e o "ligar" do `set_ai` (E13) a fazem, e
-- duas cópias divergiriam na primeira mudança. Pelo `created_at` (apagada
-- inclusive): `gravada_em` é nula na carga da 1033 e "agora" na mensagem
-- recuperada pela 1010.
CREATE OR REPLACE FUNCTION public.cb_ia_gente_respondeu_em_24h(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM messages h
     WHERE h.conversation_id = p_conversation_id
       AND h.sender_type = 'agent'
       AND (h.sender_id IS NOT NULL OR h.from_device)
       AND h.ia_agente_id IS NULL
       AND h.created_at > now() - interval '24 hours'
  );
$$;

-- Atribui o agente com a regra da D17, DENTRO da transação e com a conversa
-- travada (E12): ler "houve resposta de gente nas últimas 24 h?" no app e
-- gravar depois deixaria a resposta de um advogado no meio sem pausar.
--   · pausa por `botao` ou `transferencia` (ou sem motivo, anterior à 1049):
--     decisão de gente — NUNCA retomada por automação; o agente fica atribuído
--     e pausado.
--   · resposta de gente nas últimas 24 h (por `created_at`, apagada inclusive):
--     atribuído e pausado por `gente`.
--   · senão: retomada.
-- Nunca toca `assigned_agent_id`. Reatribuir o MESMO agente mantém o `desde`.
-- Zera o contador de respostas — MENOS na reatribuição que não muda nada (o
-- mesmo agente, sem pausa e sem resposta de gente em 24 h): essa não escreve
-- nada, e a geração (E12) não avança. Zerando, uma automação que atribui o
-- mesmo agente a cada mensagem descartaria todo turno em curso (a geração
-- avança com o teto zerado). O agente é relido AQUI, na execução: desligado
-- ou arquivado depois de a automação ser salva = `agente_indisponivel`, nada
-- gravado (Codex, #292) — senão a conversa ficaria com um agente que não
-- responde, e a próxima mensagem cairia na entrada. Com `p_canal_id` (a conexão
-- do disparo), o agente também tem de ATENDER essa conexão: atribuído fora
-- dela, ele não responderia (regra 4) e a entrada não o substitui (regra 5).
-- Com `p_so_se_vazio` (a ENTRADA, regra 5 do 5.3): conversa que JÁ tem agente
-- = `ocupada`, nada gravado. Entre a leitura da regra e a atribuição, uma
-- automação (a régua do Asaas) pode ter atribuído um especialista, e a entrada
-- o sobrescreveria; a pergunta é feita com a conversa travada (Codex, #292).
-- O passo da automação e a régua chamam sem o parâmetro: trocam o agente.
-- DROP das assinaturas antigas antes do CREATE: sem overload, o PostgREST não
-- tem o que desempatar.
DROP FUNCTION IF EXISTS public.cb_atribuir_agente_de_ia(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.cb_atribuir_agente_de_ia(
  p_account_id      uuid,
  p_conversation_id uuid,
  p_ia_agente_id    uuid,
  p_canal_id        uuid DEFAULT NULL,
  p_so_se_vazio     boolean DEFAULT false
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
  IF p_so_se_vazio AND c.ia_agente_id IS NOT NULL THEN
    RETURN QUERY SELECT 'ocupada'::text, NULL::text;
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

  v_gente := public.cb_ia_gente_respondeu_em_24h(p_conversation_id);

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

  -- Nada muda (o mesmo agente, sem pausa): não escreve — o teto e a geração
  -- ficam, e o turno em curso segue.
  IF c.ia_agente_id = p_ia_agente_id AND NOT c.ai_autoreply_disabled THEN
    RETURN QUERY SELECT 'retomada'::text, NULL::text;
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

-- O "ligar" do `set_ai` legado (E13) com a MESMA regra da atribuição, no
-- banco e com a conversa travada: sem ela, o advogado respondia há 5 min pelo
-- celular, a conversa estava pausada por `gente`, uma automação com "Ligar IA"
-- rodava e a IA voltava a falar no meio do atendimento (D10).
--   · sem pausa: nada a retomar — "ligar" só zera o teto de respostas (D10,
--     decisão do operador) → `ja_ligada`.
--   · pausa por `botao` ou `transferencia` (ou sem motivo, anterior à 1049):
--     decisão de gente, NUNCA retomada por automação → `pausada_mantida`,
--     nada gravado.
--   · pausa por `gente` ou `automacao` com resposta de gente nas últimas 24 h:
--     segue pausada, e o motivo passa a ser `gente` (é o que aconteceu)
--     → `pausada_gente`.
--   · senão: retomada, teto zerado → `retomada`.
-- Nunca toca `assigned_agent_id` nem o agente ativo.
CREATE OR REPLACE FUNCTION public.cb_retomar_ia_por_automacao(
  p_account_id      uuid,
  p_conversation_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  c record;
BEGIN
  SELECT cv.group_id, cv.ai_autoreply_disabled, cv.ia_pausada_por
    INTO c
    FROM conversations cv
   WHERE cv.id = p_conversation_id AND cv.account_id = p_account_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'sem_conversa';
  END IF;
  IF c.group_id IS NOT NULL THEN
    RETURN 'grupo';
  END IF;

  IF NOT c.ai_autoreply_disabled THEN
    UPDATE conversations
       SET ai_reply_count = 0,
           ai_handoff_summary = NULL
     WHERE id = p_conversation_id;
    RETURN 'ja_ligada';
  END IF;

  IF c.ia_pausada_por IS NULL OR c.ia_pausada_por NOT IN ('gente', 'automacao') THEN
    RETURN 'pausada_mantida';
  END IF;

  IF public.cb_ia_gente_respondeu_em_24h(p_conversation_id) THEN
    IF c.ia_pausada_por <> 'gente' THEN
      UPDATE conversations
         SET ia_pausada_por = 'gente',
             ia_pausada_em = now()
       WHERE id = p_conversation_id;
    END IF;
    RETURN 'pausada_gente';
  END IF;

  UPDATE conversations
     SET ai_autoreply_disabled = false,
         ia_pausada_por = NULL,
         ia_pausada_em = NULL,
         ai_reply_count = 0,
         ai_handoff_summary = NULL
   WHERE id = p_conversation_id;
  RETURN 'retomada';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_gente_respondeu_em_24h(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_retomar_ia_por_automacao(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_gente_respondeu_em_24h(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_retomar_ia_por_automacao(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ia_reivindicar_turno(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_ia_reivindicar_turno(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid, boolean) TO service_role;
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
     -- GRAVADA depois da atribuição, SÓ pelo relógio do BANCO. O `created_at`
     -- da mensagem do celular é o relógio do APARELHO: um aparelho atrasado
     -- poria a resposta do advogado "antes" da atribuição — sem pausa, e o
     -- turno seguinte (que só olha o gravado depois da SUA mensagem) também
     -- não a veria: a IA falaria por cima do advogado (Codex, #292). Por isso
     -- nenhuma janela pelo `created_at`, nem a de 24 h da D17: com ela, um
     -- celular com o relógio mais de um dia atrasado não pausava (Codex,
     -- #292). O preço, aceito: a fala ANTIGA de gente recuperada pela 1010
     -- (gravada agora, com o carimbo de dias atrás) também pausa — o lado
     -- seguro (a IA para e a equipe assume), e raro.
     AND NEW.gravada_em >= coalesce(c.ia_agente_desde, '-infinity'::timestamptz)
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
-- BEFORE: vale sob a RLS do operador (o fio), no motor (`close_conversation`)
-- e no lote (1018/1034), que põem `status` no SET. Só na TRANSIÇÃO para
-- encerrada: a régua cobra conversa JÁ encerrada e atribui o agente nela — o
-- UPDATE seguinte com `status` no SET não pode zerar o que acabou de ser
-- gravado.
-- Zerar o agente aqui avança a geração (E12): o gatilho dela vem DEPOIS deste
-- na ordem alfabética, e é isso que o faz ver o agente zerado.
-- E os turnos da conversa `aguardando` e `rodando` viram `descartado` (E11):
-- o pendente não tem mais a quem responder, e o que roda não pode enviar para
-- conversa encerrada (a reserva também o recusaria, pela geração e pelo
-- `status`). Na MESMA transação do encerramento, com a conversa travada pelo
-- UPDATE: a reserva do envio trava a mesma linha, então as duas se
-- serializam. SECURITY DEFINER: quem encerra pode ser o operador sob RLS, e
-- `cb_ia_turnos` é fechada ao navegador.
-- ⚠️ INCLUSIVE o `rodando` que já começou a enviar (`enviando_desde`) — o
-- contrário da entrada (`descartarPendente`, que o poupa para não calar a
-- transferência do `incerto`). Aqui a transferência não serve a ninguém (a
-- conversa encerrada fica sem agente) e, com o turno ainda `rodando`, o
-- recolhedor poderia transferir o atendimento NOVO de uma conversa reaberta
-- e reatribuída. O preço: o registro pode dizer `descartado` sobre uma
-- resposta que saiu — o `mensagem_enviada_id` (gravado sem cerca de status)
-- conta a verdade.
CREATE OR REPLACE FUNCTION cb_encerrar_limpa_ia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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

-- A função da 1048 ganha as duas limpezas novas (o gatilho e o nome ficam).
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

-- A ÚLTIMA palavra antes do envio do turno, na MESMA escrita que consome a
-- vaga do teto (5.7, E10, E12; Codex, #292). A conversa tem de estar:
--   · aberta, sem pausa, com o MESMO agente e a MESMA geração da atribuição
--     que o turno leu (`p_ia_atribuicao`; E12): encerrada, reaberta e
--     reatribuída ao mesmo agente no meio, ela passaria por todo o resto;
-- e ainda:
--   · o turno continua `rodando` (`p_turno_id`, desta conversa): outro
--     caminho pode tê-lo descartado — a mensagem que o robô consumiu ou à qual
--     uma automação respondeu (E10 a), o encerramento;
--   · a mensagem que abriu o turno (`p_gatilho_id`) continua nesta conversa,
--     sem ter sido APAGADA nem EDITADA: conferida só em JS, a edição ou a
--     exclusão que chega entre a conferência e a reserva passaria. A edição
--     cifrada da Evolution 2.4 carimba `edited_at` e mantém o texto antigo —
--     responder seria responder ao que o cliente já corrigiu;
--   · sem OUTRO turno pendente desta conversa NESTA conexão cuja mensagem é
--     MAIS NOVA que a do turno (a régua da E10, por `gravada_em`): ele é a
--     prova de que chegou mensagem nova do cliente que abre turno, pela MESMA
--     régua da entrada (E9/E10), sem copiá-la para o SQL. A mensagem nova não
--     serializa na linha da conversa (o gatilho da 972 só a escreve sem espera
--     acesa), e sem esta pergunta o turno velho enviaria com o novo já na
--     fila. O pendente cuja mensagem foi APAGADA (ou não existe mais) não
--     conta, nem o de mensagem mais antiga; sem o `gravada_em` de um dos dois
--     lados, conta (o lado que recusa);
--   · sem saída do robô ou de automação (`bot` sem `ia_agente_id`, não
--     apagada) NESTA conexão gravada depois da mensagem do turno (E10 b):
--     alguém já respondeu. A resposta do PRÓPRIO agente não conta, nem a de
--     outra conexão (D4). Gatilho nulo = não confere.
-- `p_ia_atribuicao` nulo não confere a geração, e `p_gatilho_id` nulo não
-- confere a mensagem: só para teste — o turno passa os dois.
-- A pausa por gente (o gatilho do item 6) e o encerramento escrevem a MESMA
-- linha de `conversations`, então se serializam com a reserva pela trava da
-- linha: a resposta do advogado gravada antes da reserva a recusa; a gravada
-- depois é a simultaneidade que nenhum banco evita — a mensagem da IA já
-- estava autorizada (Codex, #292). O mesmo vale para o que NÃO escreve na
-- conversa (o descarte do turno, a edição da mensagem, o pendente novo): o
-- que chega durante a própria escrita é "depois" dela. O que sobra é a
-- mensagem do cliente gravada e ainda não enfileirada no instante da
-- reserva: aceito (5.7).
-- A linha é travada ANTES da escrita (FOR NO KEY UPDATE, a mesma trava que o
-- UPDATE pega — não disputa com a FK de quem insere mensagem ou turno), para
-- a recusa ser classificada sobre o MESMO estado da escrita: o chamador
-- TRANSFERE para gente no `teto`, e um `teto` falso seria uma pausa que só
-- gente desfaz. Ordem: `mudou`, `descartado`, `editada`, `pausada`,
-- `mais_nova`, `robo_falou`, `teto`. Conexão e turno nulos comparam como
-- valor (o lado que recusa).
-- DROP das assinaturas antigas antes do CREATE: sem overload (e sem DEFAULT
-- nos parâmetros novos, de propósito: quem chamar com os 7 de antes erra
-- alto, em vez de reservar sem conferir a geração e a mensagem).
DROP FUNCTION IF EXISTS public.cb_ia_reservar_envio(uuid, uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.cb_ia_reservar_envio(uuid, uuid, uuid, integer, uuid, uuid, timestamptz);
CREATE OR REPLACE FUNCTION public.cb_ia_reservar_envio(
  p_account_id         uuid,
  p_conversation_id    uuid,
  p_ia_agente_id       uuid,
  p_max                integer,
  p_turno_id           uuid,
  p_canal_id           uuid,
  p_gatilho_gravada_em timestamptz,
  p_ia_atribuicao      bigint,
  p_gatilho_id         uuid
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  c record;
BEGIN
  SELECT cv.ia_agente_id, cv.ai_autoreply_disabled, cv.status, cv.ai_reply_count, cv.ia_atribuicao INTO c
    FROM conversations cv
   WHERE cv.id = p_conversation_id AND cv.account_id = p_account_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN 'mudou';
  END IF;

  UPDATE conversations
     SET ai_reply_count = ai_reply_count + 1
   WHERE id = p_conversation_id
     AND account_id = p_account_id
     AND ia_agente_id = p_ia_agente_id
     AND (p_ia_atribuicao IS NULL OR ia_atribuicao = p_ia_atribuicao)
     AND NOT ai_autoreply_disabled
     AND status <> 'closed'
     AND ai_reply_count < p_max
     AND EXISTS (
       SELECT 1 FROM cb_ia_turnos r
        WHERE r.id = p_turno_id
          AND r.conversation_id = p_conversation_id
          AND r.status = 'rodando'
     )
     AND (p_gatilho_id IS NULL OR EXISTS (
       SELECT 1 FROM messages g
        WHERE g.id = p_gatilho_id
          AND g.conversation_id = p_conversation_id
          AND g.deleted_at IS NULL
          AND g.edited_at IS NULL
     ))
     AND NOT EXISTS (
       SELECT 1 FROM cb_ia_turnos t
         JOIN messages n ON n.id = t.mensagem_gatilho_id
        WHERE t.conversation_id = p_conversation_id
          AND t.canal_id IS NOT DISTINCT FROM p_canal_id
          AND t.status = 'aguardando'
          AND t.id IS DISTINCT FROM p_turno_id
          AND n.deleted_at IS NULL
          AND (p_gatilho_gravada_em IS NULL OR n.gravada_em IS NULL OR n.gravada_em > p_gatilho_gravada_em)
     )
     AND NOT EXISTS (
       SELECT 1 FROM messages m
        WHERE m.conversation_id = p_conversation_id
          AND m.sender_type = 'bot'
          AND m.ia_agente_id IS NULL
          AND m.deleted_at IS NULL
          AND m.channel_id IS NOT DISTINCT FROM p_canal_id
          AND p_gatilho_gravada_em IS NOT NULL
          AND m.gravada_em > p_gatilho_gravada_em
     );
  IF FOUND THEN
    RETURN 'ok';
  END IF;

  -- A conversa está travada: agente, geração, pausa, `status` e contador são
  -- os da escrita. O resto é relido.
  IF c.ia_agente_id IS DISTINCT FROM p_ia_agente_id
     OR c.status = 'closed'
     OR (p_ia_atribuicao IS NOT NULL AND c.ia_atribuicao IS DISTINCT FROM p_ia_atribuicao) THEN
    RETURN 'mudou';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cb_ia_turnos r
     WHERE r.id = p_turno_id
       AND r.conversation_id = p_conversation_id
       AND r.status = 'rodando'
  ) THEN
    RETURN 'descartado';
  END IF;
  IF p_gatilho_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM messages g
     WHERE g.id = p_gatilho_id
       AND g.conversation_id = p_conversation_id
       AND g.deleted_at IS NULL
       AND g.edited_at IS NULL
  ) THEN
    RETURN 'editada';
  END IF;
  IF c.ai_autoreply_disabled THEN
    RETURN 'pausada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM cb_ia_turnos t
      JOIN messages n ON n.id = t.mensagem_gatilho_id
     WHERE t.conversation_id = p_conversation_id
       AND t.canal_id IS NOT DISTINCT FROM p_canal_id
       AND t.status = 'aguardando'
       AND t.id IS DISTINCT FROM p_turno_id
       AND n.deleted_at IS NULL
       AND (p_gatilho_gravada_em IS NULL OR n.gravada_em IS NULL OR n.gravada_em > p_gatilho_gravada_em)
  ) THEN
    RETURN 'mais_nova';
  END IF;
  IF EXISTS (
    SELECT 1 FROM messages m
     WHERE m.conversation_id = p_conversation_id
       AND m.sender_type = 'bot'
       AND m.ia_agente_id IS NULL
       AND m.deleted_at IS NULL
       AND m.channel_id IS NOT DISTINCT FROM p_canal_id
       AND p_gatilho_gravada_em IS NOT NULL
       AND m.gravada_em > p_gatilho_gravada_em
  ) THEN
    RETURN 'robo_falou';
  END IF;
  -- A linha está travada: o contador é o da escrita.
  IF c.ai_reply_count >= p_max THEN
    RETURN 'teto';
  END IF;
  -- A prova sumiu entre a escrita e esta leitura (o pendente foi descartado,
  -- a saída foi apagada): no instante da escrita ela existia, e a resposta
  -- não sai. Nunca `teto`, que transferiria para gente.
  RETURN 'mais_nova';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, uuid, uuid, integer, uuid, uuid, timestamptz, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, uuid, uuid, integer, uuid, uuid, timestamptz, bigint, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo, privilégios e as RPCs CHAMADAS
-- num subbloco desfeito por SQLSTATE próprio)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conv         uuid;
  v_conta        uuid;
  v_conv_ia      uuid;
  v_conta_ia     uuid;
  v_agente       uuid;
  v_msg          uuid;
  v_msg_gravada  timestamptz;
  v_rod          uuid;
  v_ger          bigint;
  v_t1           uuid;
  v_t2           uuid;
  v_quantas      integer;
  v_res          text;
  r_antes        record;
  f              text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_enfileirar_turno(uuid, uuid, uuid, uuid, uuid, integer)',
    'public.cb_ia_reivindicar_turno(uuid)',
    'public.cb_atribuir_agente_de_ia(uuid, uuid, uuid, uuid, boolean)',
    'public.cb_ia_gente_respondeu_em_24h(uuid)',
    'public.cb_retomar_ia_por_automacao(uuid, uuid)',
    'public.claim_ai_reply_slot(uuid, integer)',
    'public.cb_ia_reservar_envio(uuid, uuid, uuid, integer, uuid, uuid, timestamptz, bigint, uuid)',
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
    'public.cb_pausar_ia_por_gente()', 'public.cb_encerrar_limpa_ia()', 'public.cb_carimba_entrada_de_ia()',
    'public.cb_marcar_aguardando_resposta()', 'public.cb_mensagem_apagada_recalcula_espera()',
    'public.cb_ia_agente_arquivado_sai_das_passagens()', 'public.cb_ia_descartar_turnos_da_conexao()',
    'public.cb_ia_avanca_geracao_da_atribuicao()'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1049: função de gatilho % exposta como RPC', f;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'INSERT') THEN
    RAISE EXCEPTION '1049: cb_ia_turnos aberta ao navegador';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_turnos_mensagem_gatilho_idx', 'public.cb_ia_turnos_mensagem_inicial_idx',
    'public.cb_ia_turnos_conversa_idx', 'public.cb_ia_turnos_canal_idx', 'public.ai_usage_log_turno_idx'
  ] LOOP
    IF to_regclass(f) IS NULL THEN
      RAISE EXCEPTION '1049: índice da FK % não existe', f;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_quantas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cb_assentar_mensagem_historica';
  IF v_quantas <> 1 THEN
    RAISE EXCEPTION '1049: esperava UMA cb_assentar_mensagem_historica; há %', v_quantas;
  END IF;
  -- Sem overload: as assinaturas antigas saíram.
  FOREACH f IN ARRAY ARRAY['cb_ia_reservar_envio', 'cb_atribuir_agente_de_ia'] LOOP
    SELECT count(*) INTO v_quantas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF v_quantas <> 1 THEN
      RAISE EXCEPTION '1049: esperava UMA %; há %', f, v_quantas;
    END IF;
  END LOOP;

  -- Os gatilhos que a carga da 1033 cala PELO NOME continuam com o nome.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_marcar_aguardando_resposta_trigger'
                    AND tgrelid = 'public.messages'::regclass) THEN
    RAISE EXCEPTION '1049: o gatilho cb_marcar_aguardando_resposta_trigger sumiu';
  END IF;
  -- Apagar a conexão descarta os pendentes dela antes do SET NULL da FK.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_channels_descarta_turnos_de_ia'
                    AND tgrelid = 'public.cb_channels'::regclass) THEN
    RAISE EXCEPTION '1049: o gatilho cb_channels_descarta_turnos_de_ia não existe';
  END IF;
  -- Encerrar escreve em `cb_ia_turnos`, fechada ao navegador: DEFINER.
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.cb_encerrar_limpa_ia()'::regprocedure) THEN
    RAISE EXCEPTION '1049: cb_encerrar_limpa_ia não é SECURITY DEFINER (encerrar pela tela falharia)';
  END IF;

  -- A geração (E12): BEFORE UPDATE por linha, SEM lista de colunas (o
  -- encerramento zera o agente com só `status` no SET)...
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.conversations'::regclass
       AND t.tgname = 'cb_ia_geracao_da_atribuicao_trigger'
       AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
       AND coalesce(array_length(t.tgattr::int2[], 1), 0) = 0
  ) THEN
    RAISE EXCEPTION '1049: o gatilho da geração não é BEFORE UPDATE por linha sem lista de colunas';
  END IF;
  -- ...e DEPOIS, na ordem alfabética em que o Postgres dispara os BEFORE, de
  -- todo gatilho BEFORE UPDATE de `conversations` que escreva o agente, a
  -- pausa ou o teto em NEW. Antes deles, o WHEN veria o NEW sem a mudança e a
  -- geração não avançaria.
  SELECT string_agg(t.tgname::text, ', ') INTO f
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.conversations'::regclass
     AND NOT t.tgisinternal
     AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
     AND t.tgname <> 'cb_ia_geracao_da_atribuicao_trigger'
     AND p.prosrc ~* 'new\.(ia_agente_id|ai_autoreply_disabled|ai_reply_count)\s*:?='
     AND t.tgname > 'cb_ia_geracao_da_atribuicao_trigger'::name;
  IF f IS NOT NULL THEN
    RAISE EXCEPTION '1049: % mexe(m) no agente, na pausa ou no teto e dispara(m) DEPOIS do gatilho da geração', f;
  END IF;

  -- As RPCs CHAMADAS (o corpo só é analisado quando roda), como service_role.
  SELECT c.id, c.account_id INTO v_conv, v_conta FROM conversations c WHERE c.group_id IS NULL LIMIT 1;
  -- Uma conversa aberta de uma conta que tem agente, SEM turno vivo (o índice
  -- de um só `rodando` por conversa) e com uma mensagem viva para servir de
  -- gatilho: é onde a reserva passa pelo corpo inteiro.
  SELECT a.id, c.id, c.account_id, m.id, m.gravada_em
    INTO v_agente, v_conv_ia, v_conta_ia, v_msg, v_msg_gravada
    FROM cb_ia_agentes a
    JOIN conversations c ON c.account_id = a.account_id
    JOIN LATERAL (
      SELECT m.id, m.gravada_em FROM messages m
       WHERE m.conversation_id = c.id
         AND m.deleted_at IS NULL AND m.edited_at IS NULL AND m.gravada_em IS NOT NULL
       LIMIT 1
    ) m ON true
   WHERE c.group_id IS NULL AND c.status <> 'closed'
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos t
                      WHERE t.conversation_id = c.id AND t.status IN ('aguardando', 'rodando'))
   LIMIT 1;
  BEGIN
    SET LOCAL ROLE service_role;
    -- Sem conversa (banco vazio) a atribuição responde sem escrever.
    SELECT a.resultado INTO v_res
      FROM public.cb_atribuir_agente_de_ia(coalesce(v_conta, gen_random_uuid()), coalesce(v_conv, gen_random_uuid()), gen_random_uuid()) a;
    IF v_res NOT IN ('sem_conversa', 'agente_indisponivel', 'grupo') THEN
      RAISE EXCEPTION '1049: atribuição de agente inexistente respondeu %', v_res;
    END IF;
    PERFORM * FROM public.cb_ia_reivindicar_turno(gen_random_uuid());
    -- A reserva numa conversa que não existe (ou sem este agente) não grava.
    v_res := public.cb_ia_reservar_envio(coalesce(v_conta, gen_random_uuid()), coalesce(v_conv, gen_random_uuid()), gen_random_uuid(), 99,
                                         gen_random_uuid(), NULL, now(), NULL, NULL);
    IF v_res <> 'mudou' THEN
      RAISE EXCEPTION '1049: reserva de envio com agente estranho respondeu %', v_res;
    END IF;
    -- O "ligar" do `set_ai` numa conversa que não existe responde sem escrever.
    v_res := public.cb_retomar_ia_por_automacao(coalesce(v_conta, gen_random_uuid()), gen_random_uuid());
    IF v_res <> 'sem_conversa' THEN
      RAISE EXCEPTION '1049: retomada em conversa inexistente respondeu %', v_res;
    END IF;
    IF v_conv IS NOT NULL THEN
      -- ...e numa conversa de verdade passa pelo corpo inteiro (a pergunta das
      -- 24 h inclusive); o que gravar se desfaz com o subbloco.
      v_res := public.cb_retomar_ia_por_automacao(v_conta, v_conv);
      IF v_res NOT IN ('retomada', 'ja_ligada', 'pausada_gente', 'pausada_mantida') THEN
        RAISE EXCEPTION '1049: retomada numa conversa da conta respondeu %', v_res;
      END IF;
      -- A rajada: duas mensagens na mesma conversa e conexão = UM pendente.
      SELECT t.id INTO v_t1 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, NULL, NULL, NULL, 8000) t;
      SELECT t.id INTO v_t2 FROM public.cb_ia_enfileirar_turno(v_conta, v_conv, NULL, NULL, NULL, 8000) t;
      IF v_t1 IS DISTINCT FROM v_t2 THEN
        RAISE EXCEPTION '1049: a rajada abriu dois turnos pendentes';
      END IF;
      -- Antes do `executar_apos`, nada é reivindicado.
      IF EXISTS (SELECT 1 FROM public.cb_ia_reivindicar_turno(v_t1)) THEN
        RAISE EXCEPTION '1049: turno reivindicado antes da espera de rajada';
      END IF;
    ELSE
      RAISE NOTICE '1049: banco vazio — a rajada não foi exercitada aqui.';
    END IF;
    IF v_agente IS NOT NULL THEN
      -- Dar o agente à conversa avança a geração se mudou o agente ou retomou
      -- a pausa; senão, não.
      SELECT cv.ia_agente_id, cv.ai_autoreply_disabled, cv.ia_atribuicao INTO r_antes
        FROM conversations cv WHERE cv.id = v_conv_ia;
      UPDATE conversations SET ia_agente_id = v_agente, ai_autoreply_disabled = false WHERE id = v_conv_ia;
      SELECT cv.ia_atribuicao INTO v_ger FROM conversations cv WHERE cv.id = v_conv_ia;
      IF v_ger <> r_antes.ia_atribuicao
                  + (CASE WHEN r_antes.ia_agente_id IS DISTINCT FROM v_agente OR r_antes.ai_autoreply_disabled THEN 1 ELSE 0 END) THEN
        RAISE EXCEPTION '1049: a geração foi de % para % ao dar o agente à conversa', r_antes.ia_atribuicao, v_ger;
      END IF;
      -- Só o banco escreve a geração.
      UPDATE conversations SET ia_atribuicao = v_ger + 100 WHERE id = v_conv_ia;
      IF (SELECT cv.ia_atribuicao FROM conversations cv WHERE cv.id = v_conv_ia) <> v_ger THEN
        RAISE EXCEPTION '1049: um UPDATE mudou a geração por fora';
      END IF;
      -- A ENTRADA não sobrescreve a conversa que já tem agente.
      SELECT a.resultado INTO v_res FROM public.cb_atribuir_agente_de_ia(v_conta_ia, v_conv_ia, v_agente, NULL, true) a;
      IF v_res <> 'ocupada' THEN
        RAISE EXCEPTION '1049: a entrada numa conversa com agente respondeu %', v_res;
      END IF;
      -- O turno em curso e OUTRO pendente nesta conexão (nula), os dois com a
      -- mesma mensagem por gatilho.
      INSERT INTO cb_ia_turnos (account_id, conversation_id, ia_agente_id, mensagem_gatilho_id, status, rodando_desde)
        VALUES (v_conta_ia, v_conv_ia, v_agente, v_msg, 'rodando', now())
        RETURNING id INTO v_rod;
      SELECT t.id INTO v_t1 FROM public.cb_ia_enfileirar_turno(v_conta_ia, v_conv_ia, NULL, v_agente, v_msg, 0) t;
      -- A mensagem do pendente MAIS NOVA que a do turno recusa...
      v_res := public.cb_ia_reservar_envio(v_conta_ia, v_conv_ia, v_agente, 2147483647, v_rod, NULL,
                                           v_msg_gravada - interval '1 second', v_ger, v_msg);
      IF v_res <> 'mais_nova' THEN
        RAISE EXCEPTION '1049: reserva com pendente de mensagem mais nova respondeu %', v_res;
      END IF;
      -- ...a do mesmo instante, não.
      v_res := public.cb_ia_reservar_envio(v_conta_ia, v_conv_ia, v_agente, 2147483647, v_rod, NULL,
                                           v_msg_gravada, v_ger, v_msg);
      IF v_res NOT IN ('ok', 'robo_falou') THEN
        RAISE EXCEPTION '1049: reserva do turno em curso respondeu %', v_res;
      END IF;
      -- Geração velha: `mudou`.
      v_res := public.cb_ia_reservar_envio(v_conta_ia, v_conv_ia, v_agente, 2147483647, v_rod, NULL,
                                           v_msg_gravada, v_ger - 1, v_msg);
      IF v_res <> 'mudou' THEN
        RAISE EXCEPTION '1049: reserva com a geração velha respondeu %', v_res;
      END IF;
      -- Turno que não está rodando: `descartado`.
      v_res := public.cb_ia_reservar_envio(v_conta_ia, v_conv_ia, v_agente, 2147483647, v_t1, NULL,
                                           v_msg_gravada, v_ger, v_msg);
      IF v_res <> 'descartado' THEN
        RAISE EXCEPTION '1049: reserva de turno que não roda respondeu %', v_res;
      END IF;
      -- Encerrar (só `status` no SET) descarta o pendente e o que roda, e
      -- avança a geração (o agente zerado pelo gatilho do encerramento).
      UPDATE conversations SET status = 'closed' WHERE id = v_conv_ia;
      IF EXISTS (SELECT 1 FROM cb_ia_turnos WHERE id IN (v_rod, v_t1) AND status <> 'descartado') THEN
        RAISE EXCEPTION '1049: encerrar não descartou os turnos da conversa';
      END IF;
      IF (SELECT cv.ia_atribuicao FROM conversations cv WHERE cv.id = v_conv_ia) <> v_ger + 1 THEN
        RAISE EXCEPTION '1049: encerrar não avançou a geração';
      END IF;
    ELSE
      RAISE NOTICE '1049: nenhuma conta com agente e conversa livre — a reserva não passou pelo corpo inteiro aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1049';
  EXCEPTION WHEN SQLSTATE 'P1049' THEN
    NULL;
  END;

  RAISE NOTICE '1049: quem responde — turnos, geração da atribuição, pausa por gente, entrada da conexão e a resposta do agente como "respondido".';
END $$;
