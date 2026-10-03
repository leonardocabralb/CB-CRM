-- ============================================================
-- 1075 — Responder a uma anotação interna.
--
-- Pedido do operador (01/10/2026), com duas decisões dele:
--   1. A resposta é uma anotação de pleno direito, desenhada NO PONTO EM QUE
--      FOI ESCRITA (no fio e na aba Notas), com a original citada em cima —
--      como a resposta do WhatsApp. Não fica empilhada sob a original: quem
--      abre a conversa pelo aviso cai vendo a resposta.
--   2. O aviso no sino vai ao AUTOR da original e a QUEM JÁ RESPONDEU nela;
--      quem está respondendo nunca. O aviso é da rota (`POST /api/cb/notes`),
--      não daqui — mesma escolha da 919 para a menção.
--
-- O MODELO: `resposta_de` aponta a anotação RESPONDIDA — que pode ser uma
-- resposta (a citação é do que foi tocado, como no WhatsApp). Quem já
-- respondeu se acha subindo por `resposta_de` até a origem, em JS
-- (`quemAvisarDaResposta`): as anotações de uma conversa são poucas.
--
-- ⚠️ FK COMPOSTA `(resposta_de, conversation_id)`, como a da 918 para a
-- conversa: a rota grava em service-role, que ignora RLS, e uma FK simples só
-- garantiria "existe uma anotação com esse id" — não "da MESMA conversa". O
-- índice único `(id, conversation_id)` existe só para ser alvo dela.
--
-- ⚠️ `ON DELETE SET NULL (resposta_de)` — a lista de colunas é obrigatória
-- (Postgres 15+): o SET NULL da FK composta anularia também
-- `conversation_id`, que é NOT NULL, e apagar a original ESTOURARIA. Apagar a
-- original não leva as respostas: a resposta é de quem a escreveu, e a
-- original pode ser apagada pelo autor dela ou por um admin. A resposta fica
-- como anotação comum. Apagar a CONVERSA (ou o contato) continua levando tudo
-- pelo CASCADE da 918.
--
-- ⚠️ Sem policy nova e sem GRANT novo: a escrita continua só pela rota (o
-- INSERT segue revogado do navegador desde a 918) e a coluna nova entra no
-- SELECT que já existe. `cb_conversation_notes` está na publicação realtime
-- SEM lista de colunas e com REPLICA IDENTITY FULL (921): a coluna viaja no
-- INSERT, e o SET NULL da FK chega como UPDATE à tela aberta.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_conversation_notes
  ADD COLUMN IF NOT EXISTS resposta_de uuid;

COMMENT ON COLUMN public.cb_conversation_notes.resposta_de IS
  'A anotação que esta responde (1075), sempre da mesma conversa; pode ser outra resposta. NULL = anotação comum, ou resposta cuja respondida foi apagada.';

-- Alvo da FK composta. `id` já é único sozinho (PK); o par só existe para a
-- FK poder exigir a mesma conversa.
CREATE UNIQUE INDEX IF NOT EXISTS cb_conversation_notes_id_conversa_key
  ON public.cb_conversation_notes (id, conversation_id);

ALTER TABLE public.cb_conversation_notes
  DROP CONSTRAINT IF EXISTS cb_conversation_notes_resposta_fkey;
ALTER TABLE public.cb_conversation_notes
  ADD CONSTRAINT cb_conversation_notes_resposta_fkey
  FOREIGN KEY (resposta_de, conversation_id)
  REFERENCES public.cb_conversation_notes (id, conversation_id)
  ON DELETE SET NULL (resposta_de);

-- O SET NULL ao apagar a respondida pergunta por `resposta_de`. Parcial:
-- quase toda anotação não é resposta.
CREATE INDEX IF NOT EXISTS cb_conversation_notes_resposta_idx
  ON public.cb_conversation_notes (resposta_de)
  WHERE resposta_de IS NOT NULL;

-- ------------------------------------------------------------
-- O sino passa a conhecer a resposta
-- ------------------------------------------------------------
-- Mesma mecânica da 919 e da 944: o CHECK é lista fechada, e os literais
-- antigos são reescritos junto (a conferência prova que continuam lá).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'note_mention',
    'note_reply',
    'task_assigned',
    'task_reply'
  ));

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  def text;
  v_regra "char";
  v_cols smallint[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass
     AND conname = 'notifications_type_check';
  IF def IS NULL THEN
    RAISE EXCEPTION '1075: notifications_type_check sumiu.';
  END IF;
  IF def NOT LIKE '%note_reply%' THEN
    RAISE EXCEPTION '1075: notifications_type_check não conhece note_reply (def=%)', def;
  END IF;
  IF def NOT LIKE '%conversation_assigned%' OR def NOT LIKE '%note_mention%'
     OR def NOT LIKE '%task_assigned%' OR def NOT LIKE '%task_reply%' THEN
    RAISE EXCEPTION '1075: notifications_type_check PERDEU tipo antigo (def=%)', def;
  END IF;

  -- O SET NULL é só da coluna `resposta_de` (confdelsetcols), nunca da FK
  -- inteira — senão apagar a original tentaria anular `conversation_id`.
  SELECT confdeltype, confdelsetcols INTO v_regra, v_cols
    FROM pg_constraint
   WHERE conrelid = 'public.cb_conversation_notes'::regclass
     AND conname = 'cb_conversation_notes_resposta_fkey';
  IF v_regra IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION '1075: a FK da resposta não é ON DELETE SET NULL (regra=%)', v_regra;
  END IF;
  IF v_cols IS NULL OR array_length(v_cols, 1) <> 1 THEN
    RAISE EXCEPTION '1075: o SET NULL da FK da resposta não está restrito a resposta_de';
  END IF;

  -- Nada de privilégio novo: o navegador continua sem INSERT/UPDATE.
  IF has_table_privilege('authenticated', 'public.cb_conversation_notes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_conversation_notes', 'UPDATE') THEN
    RAISE EXCEPTION '1075: authenticated escreve em cb_conversation_notes — a escrita é só pela rota.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_conversation_notes', 'SELECT') THEN
    RAISE EXCEPTION '1075: authenticated não lê cb_conversation_notes — o fio nasce sem anotações.';
  END IF;
END $$;

-- A prova de verdade precisa de uma conversa (num banco vazio, o replay do
-- CI, não há o que provar) e se DESFAZ pelo SQLSTATE próprio — nunca
-- `WHEN OTHERS`, que engoliria um erro de verdade.
--   1. Apagar a original deixa a resposta de pé, com `resposta_de` nulo.
--   2. Resposta apontando anotação de OUTRA conversa é recusada (a FK composta).
--   3. Original e resposta apagadas no mesmo comando (o CASCADE da conversa)
--      saem juntas, sem estourar no SET NULL de uma linha que o mesmo
--      comando está apagando.
DO $$
DECLARE
  v_conta uuid;
  v_conversa uuid;
  v_outra uuid;
  v_original uuid;
  v_resposta uuid;
  v_aponta uuid;
BEGIN
  SELECT c.account_id, c.id INTO v_conta, v_conversa
    FROM public.conversations c
   LIMIT 1;

  IF v_conversa IS NULL THEN
    RAISE NOTICE '1075: banco sem conversa, nada a provar.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.cb_conversation_notes (account_id, conversation_id, texto)
    VALUES (v_conta, v_conversa, '1075: original')
    RETURNING id INTO v_original;

    INSERT INTO public.cb_conversation_notes (account_id, conversation_id, texto, resposta_de)
    VALUES (v_conta, v_conversa, '1075: resposta', v_original)
    RETURNING id INTO v_resposta;

    DELETE FROM public.cb_conversation_notes WHERE id = v_original;

    SELECT resposta_de INTO STRICT v_aponta
      FROM public.cb_conversation_notes WHERE id = v_resposta;
    IF v_aponta IS NOT NULL THEN
      RAISE EXCEPTION '1075: apagar a original não anulou resposta_de da resposta';
    END IF;

    SELECT c.id INTO v_outra
      FROM public.conversations c
     WHERE c.account_id = v_conta AND c.id <> v_conversa
     LIMIT 1;
    IF v_outra IS NOT NULL THEN
      BEGIN
        INSERT INTO public.cb_conversation_notes (account_id, conversation_id, texto, resposta_de)
        VALUES (v_conta, v_outra, '1075: resposta de fora', v_resposta);
        RAISE EXCEPTION '1075: resposta a anotação de OUTRA conversa foi aceita';
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END IF;

    -- Original e resposta apagadas no MESMO comando: é o que o CASCADE da
    -- conversa faz, sem apagar uma conversa de verdade dentro da prova.
    INSERT INTO public.cb_conversation_notes (account_id, conversation_id, texto)
    VALUES (v_conta, v_conversa, '1075: original 2')
    RETURNING id INTO v_original;
    INSERT INTO public.cb_conversation_notes (account_id, conversation_id, texto, resposta_de)
    VALUES (v_conta, v_conversa, '1075: resposta 2', v_original)
    RETURNING id INTO v_aponta;
    DELETE FROM public.cb_conversation_notes WHERE id IN (v_original, v_aponta);
    IF EXISTS (
      SELECT 1 FROM public.cb_conversation_notes WHERE id IN (v_original, v_aponta)
    ) THEN
      RAISE EXCEPTION '1075: apagar original e resposta juntas deixou linha para trás';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1075', MESSAGE = '1075: desfaz a prova';
  EXCEPTION WHEN SQLSTATE 'P1075' THEN
    NULL;
  END;
END $$;
