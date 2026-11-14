-- ============================================================================
-- 1144 — A pausa TEMPORÁRIA que o "Desligar IA" da automação cobriu volta no
-- "Ligar IA" (achado da revisão do porte ao Atlas)
-- ============================================================================
-- Desde a 1138, o "Desligar IA" (`set_ai`) troca qualquer pausa por
-- `automacao`, e o "Ligar IA" seguinte desfaz SÓ a de `automacao`. A dupla
-- desligar + ligar numa conversa que a EQUIPE tinha pausado (`gente`, ou o
-- "Pausar" = `botao`) soltava a IA de vez: ela respondia 8 s depois, por cima
-- de quem estava na conversa (D26: só o "Retomar IA" desfaz a pausa de gente).
--
-- O que muda, e só isto: a coluna `conversations.ia_pausa_antes_da_automacao`
-- guarda a pausa temporária que o "Desligar" cobriu; o "Ligar" a DEVOLVE, com
-- o relógio recomeçando (`ia_pausada_em` = agora). Só o passo `set_ai` lê e
-- escreve; nula = nada a devolver.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo lê e grava a coluna no passo
-- `set_ai` (sem ela, o passo falha). O app de antes não a conhece. Coluna
-- anulável sem default (só metadado); o CHECK varre a tabela com a coluna
-- toda nula, sob a trava curta da ALTER (como o da 1138). Idempotente.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ia_pausa_antes_da_automacao text;

ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_ia_pausa_antes_da_automacao_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_ia_pausa_antes_da_automacao_check
  CHECK (ia_pausa_antes_da_automacao IS NULL OR ia_pausa_antes_da_automacao IN ('gente', 'botao'));

COMMENT ON COLUMN public.conversations.ia_pausa_antes_da_automacao IS
  '1144: a pausa temporária (gente/botao) que o "Desligar IA" da automação cobriu; o "Ligar IA" a devolve. Só o passo set_ai lê e escreve.';

-- ----------------------------------------------------------------------------
-- Conferência — válida num banco VAZIO
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.conversations'::regclass
       AND attname = 'ia_pausa_antes_da_automacao'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '1144: coluna conversations.ia_pausa_antes_da_automacao ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.conversations'::regclass
       AND conname = 'conversations_ia_pausa_antes_da_automacao_check'
       AND contype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION '1144: CHECK conversations_ia_pausa_antes_da_automacao_check ausente ou não validado';
  END IF;
END $$;
