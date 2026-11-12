-- ============================================================
-- 1132 — Lixeira de anotações: apagar MARCA a anotação, não a apaga
--
-- Pedido do operador (10/11/2026), depois de um caso real: uma colaboradora
-- recebeu o aviso de menção, abriu a conversa e não achou a anotação — a
-- autora a tinha apagado uma hora depois de escrever, e nada na tela dizia
-- isso. Decisões dele, no mesmo dia:
--   1. Na aba Notas, um ícone discreto de lixeira mostra as anotações
--      apagadas da conversa, na ordem em que foram escritas, e dali se
--      RESTAURA (proteção contra exclusão sem querer).
--   2. Vê a lixeira quem já vê as anotações (todos da conta); restaura quem
--      podia apagar (o AUTOR ou admin/dono).
--   3. A apagada fica 90 dias (o prazo da Lixeira de contatos) e depois sai
--      de vez, com os anexos.
--   4. O aviso de menção ou resposta cuja anotação foi apagada diz isso, com
--      o texto COMPLETO, quem apagou e quando.
--
-- O MODELO: apagar vira marcar. Três colunas — `apagada_em`, `apagada_por`
-- (o login, `ON DELETE SET NULL` como toda autoria desde a 1116) e
-- `apagada_por_nome` (o nome CONGELADO, como `autor_nome`: quem saiu da conta
-- continua nomeado). A linha fica onde estava, então:
--   - restaurar é desmarcar: a anotação volta com o MESMO id, o mesmo lugar
--     no fio, os anexos, a menção e as respostas (a FK `resposta_de` nunca
--     disparou o SET NULL);
--   - o aviso (`notifications.note_id`, 1114) continua apontando uma linha
--     que existe, e é dela que sai o texto completo;
--   - a Lixeira de contatos (1097) e a união de fichas (1093) não mudam: a
--     fotografia e a união levam a linha inteira, marca inclusa (o
--     `cb_lixeira_reinserir` copia toda coluna que o JSON tem, e a FK nova
--     para `auth.users` segue o SET NULL dela quando o login sumiu);
--   - os anexos ficam guardados sem tocar na fila: o gatilho da 1102 é
--     `AFTER DELETE OR UPDATE OF anexos`, e marcar não mexe em `anexos` (a
--     conferência abaixo cobra isso); `cb_arquivos_citados` conta a linha
--     marcada, e a drenagem não apaga o que ela cita. Quando o prazo vence,
--     o app faz o DELETE de verdade (o ciclo de manutenção, como o
--     vencimento da Lixeira de contatos) e o gatilho da 1102 põe os anexos
--     na fila.
--
-- QUEM ESCREVE A MARCA: só a rota (`DELETE /api/cb/notes/[id]` e
-- `POST /api/cb/notes/[id]/restaurar`), com o service role, como o fixar e o
-- editar — `authenticated` segue sem UPDATE nesta tabela (918/920). A policy
-- de DELETE do navegador fica de pé por enquanto: tirá-la é RESTRITIVA (o app
-- antigo apaga por ela) e vai DEPOIS do deploy, noutra migration.
--
-- QUEM LÊ: todo leitor de anotação "viva" filtra `apagada_em IS NULL` (o
-- pino `lixeira-de-anotacoes.chamadores.test.ts` cobra cada
-- `.from('cb_conversation_notes')` do app). A RLS de leitura não muda: a
-- lixeira é lida pela mesma policy, por todos da conta (decisão 2).
--
-- ⚠️ A apagada NUNCA fica fixada: CHECK nomeado. Sem ele, a fixada apagada
-- seguraria o índice único parcial da 951 (uma fixada por cliente) e ninguém
-- conseguiria fixar outra anotação daquele cliente.
--
-- Realtime: a tabela está na publicação SEM lista de colunas e com REPLICA
-- IDENTITY FULL (921): marcar e desmarcar chegam como UPDATE com a linha
-- inteira, colunas novas inclusas (conferido abaixo).
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: a rota nova grava as colunas, e as telas
-- novas filtram por elas — sem a coluna, o PostgREST recusa a leitura e a aba
-- Notas fica vazia. O app ANTIGO não as conhece e segue funcionando.
-- Tabela pequena: ADD COLUMN nulo é só catálogo; o índice é parcial (vazio
-- ao nascer). Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_conversation_notes
  ADD COLUMN IF NOT EXISTS apagada_em timestamptz,
  ADD COLUMN IF NOT EXISTS apagada_por uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS apagada_por_nome text;

COMMENT ON COLUMN public.cb_conversation_notes.apagada_em IS
  'Lixeira de anotações (1132): quando a anotação foi apagada. NULL = viva. Marcada, some das telas e fica na lixeira da aba Notas por 90 dias (restaurar = voltar a NULL); depois o ciclo de manutenção a apaga de vez (e o gatilho da 1102 leva os anexos à fila).';
COMMENT ON COLUMN public.cb_conversation_notes.apagada_por IS
  'Lixeira de anotações (1132): o login de quem apagou. SET NULL quando o login some (1116).';
COMMENT ON COLUMN public.cb_conversation_notes.apagada_por_nome IS
  'Lixeira de anotações (1132): o nome de quem apagou, congelado na hora (como autor_nome).';

ALTER TABLE public.cb_conversation_notes
  DROP CONSTRAINT IF EXISTS cb_conversation_notes_apagada_sem_fixar_ck;
ALTER TABLE public.cb_conversation_notes
  ADD CONSTRAINT cb_conversation_notes_apagada_sem_fixar_ck
  CHECK (apagada_em IS NULL OR fixada_em IS NULL);

-- O vencimento pergunta "apagadas há mais de 90 dias". Parcial: quase toda
-- anotação está viva.
CREATE INDEX IF NOT EXISTS cb_conversation_notes_apagada_idx
  ON public.cb_conversation_notes (apagada_em)
  WHERE apagada_em IS NOT NULL;

-- ------------------------------------------------------------
-- Conferência (banco vazio também: só catálogo)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
  v_coluna text;
  v_gatilho text;
  v_lista boolean;
  v_regra text;
BEGIN
  FOR v_coluna, v_tipo IN
    SELECT c.coluna, c.tipo
      FROM (VALUES
        ('apagada_em', 'timestamp with time zone'),
        ('apagada_por', 'uuid'),
        ('apagada_por_nome', 'text')
      ) AS c(coluna, tipo)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'cb_conversation_notes'
         AND column_name = v_coluna
         AND data_type = v_tipo
    ) THEN
      RAISE EXCEPTION '1132: cb_conversation_notes.% ausente ou com tipo errado', v_coluna;
    END IF;
    -- A marca é da rota (service role): o navegador lê, nunca escreve.
    IF NOT has_column_privilege('authenticated', 'public.cb_conversation_notes', v_coluna, 'SELECT') THEN
      RAISE EXCEPTION '1132: authenticated não lê cb_conversation_notes.%', v_coluna;
    END IF;
    IF has_column_privilege('authenticated', 'public.cb_conversation_notes', v_coluna, 'UPDATE') THEN
      RAISE EXCEPTION '1132: authenticated pode escrever cb_conversation_notes.% (a marca é só da rota)', v_coluna;
    END IF;
  END LOOP;

  SELECT pg_get_constraintdef(c.oid) INTO v_regra
    FROM pg_constraint c
   WHERE c.conrelid = 'public.cb_conversation_notes'::regclass
     AND c.conname = 'cb_conversation_notes_apagada_sem_fixar_ck';
  IF v_regra IS DISTINCT FROM 'CHECK (((apagada_em IS NULL) OR (fixada_em IS NULL)))' THEN
    RAISE EXCEPTION '1132: a regra "apagada não fica fixada" ausente ou diferente: %', v_regra;
  END IF;

  -- ⚠️ Marcar não pode pôr os anexos na fila: o gatilho da 1102 só olha
  -- DELETE e UPDATE OF anexos. Se um dia ele passar a olhar qualquer UPDATE,
  -- apagar levaria os arquivos em ~15 min e a restauração voltaria sem eles.
  SELECT pg_get_triggerdef(t.oid) INTO v_gatilho
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.cb_conversation_notes'::regclass
     AND t.tgname = 'cb_anexos_da_anotacao_para_a_fila'
     AND NOT t.tgisinternal;
  IF v_gatilho IS NULL THEN
    RAISE EXCEPTION '1132: o gatilho dos anexos da 1102 sumiu';
  END IF;
  IF position('AFTER DELETE OR UPDATE OF anexos ON' IN v_gatilho) = 0 THEN
    RAISE EXCEPTION '1132: o gatilho dos anexos mudou de forma (marcar como apagada poria os anexos na fila): %', v_gatilho;
  END IF;

  -- Publicação com lista de colunas deixaria a marca fora do UPDATE do tempo
  -- real (a armadilha de `cb_channels`). Sem publicação, nada a provar.
  SELECT pr.prattrs IS NOT NULL INTO v_lista
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
   WHERE p.pubname = 'supabase_realtime'
     AND pr.prrelid = 'public.cb_conversation_notes'::regclass;
  IF v_lista IS NULL THEN
    RAISE NOTICE '1132: cb_conversation_notes fora da publicação supabase_realtime, nada a provar.';
  ELSIF v_lista THEN
    RAISE EXCEPTION '1132: cb_conversation_notes está na publicação com LISTA de colunas — a marca não viajaria';
  END IF;
END $$;
