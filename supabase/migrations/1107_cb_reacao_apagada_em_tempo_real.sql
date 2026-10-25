-- ============================================================
-- 1107 — A reação apagada chega às outras telas pelo tempo real.
--
-- O fio assina INSERT, UPDATE e DELETE de `message_reactions` filtrando por
-- `conversation_id` (`message-thread.tsx`). Com a REPLICA IDENTITY padrão, o
-- registro do DELETE só leva a chave primária: o filtro por
-- `conversation_id` não casa e o evento não chega a ninguém — o mesmo que a
-- 921 mediu nas anotações. Até aqui isso só deixava presa na tela a reação
-- que o CLIENTE tirou; com a reação do escritório única por mensagem (rota
-- `api/whatsapp/react`, porte do #675: reagir apaga a do colega, tirar apaga
-- todas), a do colega também ficaria na tela de quem está com a conversa
-- aberta, embora o banco e o celular do cliente já não a tenham.
--
-- Custo, como na 921: a identidade cheia só pesa no registro de UPDATE e
-- DELETE (o INSERT não muda), e a tabela é pequena e de pouca escrita — as
-- reações. Medido em 25/10/2026: identidade `d` (padrão), na publicação
-- `supabase_realtime`.
-- ============================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.message_reactions REPLICA IDENTITY FULL;

-- Conferência: o resultado, não a intenção.
DO $$
DECLARE
  identidade "char";
BEGIN
  SELECT relreplident INTO identidade
    FROM pg_class WHERE oid = 'public.message_reactions'::regclass;
  IF identidade <> 'f' THEN
    RAISE EXCEPTION '1107: replica identity ficou em % (esperado f = FULL)', identidade;
  END IF;

  -- A publicação só existe no Supabase (o replay local também a cria); sem
  -- ela não há o que conferir.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE '1107: sem a publicação supabase_realtime — nada a conferir nela.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reactions'
  ) THEN
    RAISE NOTICE '1107: message_reactions fora da publicação supabase_realtime neste banco.';
  END IF;
END $$;
