-- ============================================================
-- 1105 — A primeira mensagem do cliente se decide UMA vez por conversa.
--
-- O gatilho "Primeira mensagem recebida" das automações
-- (`first_inbound_message`) e a entrada de robô por primeira mensagem saíam
-- em DOBRO numa rajada. Os dois caminhos de cliente do WhatsApp (o webhook da
-- Meta e o `persistInboundMessage` da Evolution) contam as mensagens
-- anteriores do cliente ANTES de gravar a nova; duas mensagens no mesmo
-- segundo ("oi" e "tudo bem?", cada uma na sua requisição) contavam antes de
-- qualquer uma gravar, as duas viam zero, e a saudação chegava duas vezes ao
-- cliente. Porte adaptado do #675 do original (a 054 dele).
--
-- `conversations.first_inbound_at` é o carimbo de quem REIVINDICOU a
-- primeira mensagem. A contagem continua decidindo se vale tentar (zero
-- mensagens do cliente); depois do INSERT da mensagem, o app faz
--
--   UPDATE conversations SET first_inbound_at = <agora>
--    WHERE id = <conversa> AND first_inbound_at IS NULL
--
-- e só quem levou a linha é a primeira (`src/lib/conversations/
-- primeira-mensagem.ts`). Sob READ COMMITTED, a segunda requisição espera a
-- trava da linha, relê a versão nova e volta com zero linhas.
--
-- ⚠️ SEM preencher as conversas antigas, de propósito (a 054 do original
-- preenche todas a partir de `messages`): nula e sem default, a coluna entra
-- só no catálogo — nada de reescrever a tabela, nem de acender os gatilhos de
-- UPDATE de `conversations` (`set_updated_at`, a trilha da 1083, o tempo
-- real) em toda conversa da base. A conversa antiga com mensagem do cliente
-- nem chega a reivindicar: a contagem já dá mais de zero. Por isso a coluna
-- nula quer dizer "ninguém reivindicou", nunca "o cliente nunca escreveu".
--
-- ADITIVA: aplicar ANTES do deploy. Sem a coluna, o UPDATE do app novo volta
-- erro, a reivindicação falha FECHADA e o gatilho deixa de disparar — perde-se
-- a saudação, nunca se manda em dobro. O app anterior não lê a coluna.
--
-- Sem GRANT novo: a coluna herda os privilégios de tabela de `conversations`
-- (o service role, que é quem reivindica, tem UPDATE — 1096).
--
-- Idempotente; aplica em banco vazio.
-- ============================================================

-- `conversations` recebe escrita a toda mensagem: sem teto de espera, a
-- trava do ALTER enfileiraria a ingestão atrás de uma transação longa.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS first_inbound_at timestamptz;

COMMENT ON COLUMN public.conversations.first_inbound_at IS
  'Quando a primeira mensagem do cliente foi REIVINDICADA (1105): o UPDATE condicional (first_inbound_at IS NULL) que decide o gatilho first_inbound_message. NULL = ninguém reivindicou; as conversas anteriores à 1105 não foram preenchidas (a contagem das mensagens do cliente vem antes).';

-- ------------------------------------------------------------
-- Conferência. Depois do ALTER a tabela está com a trava exclusiva: o
-- catálogo e, com dado, UMA conversa pela chave — a reivindicação provada
-- na tabela de verdade (com os gatilhos dela), num subbloco desfeito por
-- SQLSTATE próprio.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
  v_nao_nula boolean;
  v_com_default boolean;
  v_conversa uuid;
  v_linhas integer;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull, a.atthasdef
    INTO v_tipo, v_nao_nula, v_com_default
    FROM pg_attribute a
   WHERE a.attrelid = 'public.conversations'::regclass
     AND a.attname = 'first_inbound_at'
     AND NOT a.attisdropped;
  IF v_tipo IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION '1105: conversations.first_inbound_at deveria ser timestamptz, é %', v_tipo;
  END IF;
  -- O NULL é o que a reivindicação disputa: com default, toda conversa nova
  -- nasceria "já reivindicada" e o gatilho nunca mais dispararia.
  IF v_nao_nula OR v_com_default THEN
    RAISE EXCEPTION '1105: conversations.first_inbound_at tem de ser nula e sem default';
  END IF;

  SELECT c.id INTO v_conversa
    FROM public.conversations c
   WHERE c.first_inbound_at IS NULL
   LIMIT 1;
  IF v_conversa IS NULL THEN
    RAISE NOTICE '1105: nenhuma conversa sem reivindicação (banco vazio): a disputa não tem onde se provar aqui.';
  ELSE
    BEGIN
      UPDATE public.conversations
         SET first_inbound_at = now()
       WHERE id = v_conversa
         AND first_inbound_at IS NULL;
      GET DIAGNOSTICS v_linhas = ROW_COUNT;
      IF v_linhas <> 1 THEN
        RAISE EXCEPTION '1105: a 1ª reivindicação deveria levar a conversa, levou % linha(s)', v_linhas;
      END IF;

      UPDATE public.conversations
         SET first_inbound_at = now()
       WHERE id = v_conversa
         AND first_inbound_at IS NULL;
      GET DIAGNOSTICS v_linhas = ROW_COUNT;
      IF v_linhas <> 0 THEN
        RAISE EXCEPTION '1105: a 2ª reivindicação deveria voltar vazia, levou % linha(s)', v_linhas;
      END IF;

      -- Desfaz as duas escritas: a prova não deixa conversa reivindicada.
      RAISE SQLSTATE 'P1105';
    EXCEPTION WHEN SQLSTATE 'P1105' THEN
      NULL;
    END;
  END IF;
END $$;
