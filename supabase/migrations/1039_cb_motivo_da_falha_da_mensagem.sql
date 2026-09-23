-- ============================================================
-- 1039_cb_motivo_da_falha_da_mensagem
--
-- Onde guardar o MOTIVO de a Meta não ter entregado uma mensagem. É a
-- `042_message_failure_reason` do projeto original (#535), que o merge #259
-- trouxe como `0045` e que esta migration SUBSTITUI com o número certo e o
-- cabeçalho da nossa realidade — a `0045` nunca foi aplicada em banco nenhum
-- desta casa.
--
-- ⚠️ Por que 1039 e não 0045: número NOVO vem depois do maior que já está
-- no `main` (era 1037). Quem atualiza por `supabase db push` tem a recusa
-- da migration fora de ordem (sem `--include-all`) — ver o CLAUDE.md.
--
-- Quando a Meta não consegue entregar, ela manda um webhook de status
-- `failed` com `errors[0]`: um `code` numérico estável (131049 "limite de
-- marketing por usuário", 131026 "não entregável", 131047 "janela de 24 h
-- fechada"…), um `title` curto e o `error_data.details` legível. O nosso
-- `handleStatusUpdate` (webhook da Meta) grava só `status = 'failed'` e
-- descarta o resto: na tela, o X vermelho não diz se foi número bloqueado,
-- modelo vencido ou teto da conta. Medido em 21/09/2026: um modelo de
-- marketing aceito pela Meta e depois recusado na entrega, sem motivo.
--
-- ⚠️ Esta migration só abre o lugar. GRAVAR o motivo (no MESMO update do
-- status, escopado pelo canal), mostrá-lo na bolha e espelhá-lo em
-- `broadcast_recipients.error_message` é a Fase 5 do
-- `docs/PLANO-merge-upstream-2026-09.md`. A ordem importa: o código que
-- grava estas colunas não pode chegar ao ar antes delas, senão o UPDATE do
-- `failed` é recusado pelo PostgREST e o próprio status se perde.
--
-- As três colunas são anuláveis e NÃO são limpas por um status posterior da
-- mesma mensagem (a Meta não promete ordem). Não há como preencher o
-- passado: os motivos que já chegaram foram descartados na porta.
--
-- Aditiva e idempotente.
-- ============================================================

-- `messages` é a tabela mais escrita do sistema: sem teto de espera, uma
-- transação longa enfileiraria a ingestão atrás desta trava (ADD COLUMN
-- anulável sem DEFAULT só mexe no catálogo, mas pede a trava exclusiva).
SET LOCAL lock_timeout = '5s';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_code INTEGER,
  ADD COLUMN IF NOT EXISTS error_title TEXT,
  ADD COLUMN IF NOT EXISTS error_details TEXT;

COMMENT ON COLUMN messages.error_code IS
  'Código numérico da Meta no webhook de status failed (errors[0].code). NULO se a mensagem não falhou. Um status posterior não o limpa.';
COMMENT ON COLUMN messages.error_title IS
  'Rótulo curto da Meta no webhook de status failed (errors[0].title). NULO se a mensagem não falhou.';
COMMENT ON COLUMN messages.error_details IS
  'Explicação legível da Meta no webhook de status failed (errors[0].error_data.details). NULO se a mensagem não falhou ou a Meta não mandou.';

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages'
        AND column_name IN ('error_code', 'error_title', 'error_details')) <> 3 THEN
    RAISE EXCEPTION '1039: as três colunas do motivo da falha não estão em messages';
  END IF;
END $$;
