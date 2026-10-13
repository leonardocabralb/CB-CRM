-- ============================================================
-- 1085 — O sino aceita o aviso de saúde do WhatsApp (`whatsapp_alert`).
--
-- Pedido do operador (13/10/2026): um monitor de fora do app (na instalação
-- de referência, uma rotina de hora em hora no servidor da Evolution) avisa
-- os administradores quando uma conexão cai, fica aberta sem receber, recebe
-- sem gravar, descarta mensagem ou quando o servidor perde um serviço. O
-- aviso entra em `notifications` como os outros, com título e corpo já
-- escritos (o padrão dos avisos `note_*`/`task_*`), sem conversa nem tarefa:
-- o clique só marca lido.
--
-- Quem grava é o monitor, com a service role (a tabela não tem policy de
-- INSERT desde a 027). Aqui só se alarga a lista fechada do CHECK — mesma
-- mecânica da 919, da 944 e da 1075: os literais antigos são reescritos
-- junto, e a conferência prova que continuam lá.
--
-- ADITIVA: aplicar ANTES do deploy (sem ela, o INSERT do monitor é recusado
-- pelo CHECK; o app novo só lê o tipo).
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'note_mention',
    'note_reply',
    'task_assigned',
    'task_reply',
    'whatsapp_alert'
  ));

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass
     AND conname = 'notifications_type_check';
  IF def IS NULL THEN
    RAISE EXCEPTION '1085: notifications_type_check sumiu.';
  END IF;
  IF def NOT LIKE '%whatsapp_alert%' THEN
    RAISE EXCEPTION '1085: notifications_type_check não conhece whatsapp_alert (def=%)', def;
  END IF;
  IF def NOT LIKE '%conversation_assigned%' OR def NOT LIKE '%note_mention%'
     OR def NOT LIKE '%note_reply%' OR def NOT LIKE '%task_assigned%'
     OR def NOT LIKE '%task_reply%' THEN
    RAISE EXCEPTION '1085: notifications_type_check PERDEU tipo antigo (def=%)', def;
  END IF;
END $$;
