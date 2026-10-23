-- ============================================================
-- 1096 — Conversa e mensagem não se apagam pelo navegador
--
-- Fase 1 de docs/PLANO-lixeira-de-contatos.md (decisão do operador de
-- 22/10/2026: excluir contato é só de admin, 981).
--
-- ⚠️ A PORTA DOS FUNDOS. Desde a 0017 (do upstream), `conversations_delete`
-- deixava QUALQUER membro com papel `agent` apagar uma conversa — e com ela,
-- pelo CASCADE, todas as mensagens — direto pelo PostgREST; e
-- `messages_modify` (FOR ALL) deixava apagar mensagem solta. Nenhuma tela faz
-- isso (conferido no código em 22/10/2026), mas o banco permitia, e apagar a
-- conversa inteira é o mesmo estrago que a 981 tirou do atendente, por outra
-- porta. Conferido na produção em 22/10/2026: as duas policies vivas, e
-- `authenticated` e `anon` com o privilégio de DELETE nas duas tabelas.
--
-- O QUE CONTINUA APAGANDO:
--   • a FICHA apagada leva conversa e mensagens (CASCADE). A ação referencial
--     roda como o DONO da tabela que referencia, sem a RLS, e não depende do
--     privilégio de quem apagou a ficha — provado num Postgres descartável em
--     22/10/2026 (admin apagando a ficha pelo papel `authenticated`, sem
--     DELETE em `conversations` e `messages`: as duas linhas saíram);
--   • as funções SECURITY DEFINER (união de fichas, desfazer da Kommo e do
--     histórico do WhatsApp) e o service role.
--
-- O QUE NÃO MUDA: INSERT e UPDATE de mensagem pelo navegador seguem com o
-- MESMO predicado da 1032; só o DELETE sai. A leitura continua em
-- `messages_select` (que aceita viewer — mais larga que a escrita, então o
-- FOR ALL que sai não levava leitura que ela não dê).
--
-- RESTRITIVA, mas nenhuma versão do app usa o que ela tira: pode ser aplicada
-- antes ou depois do deploy.
--
-- ⚠️ As duas policies são do UPSTREAM (0017): um merge que as recrie reabre a
-- porta sem conflito. Está na §6 de docs/MERGE-UPSTREAM.md; o pino
-- `portas-dos-fundos-1096.test.ts` reprova pelos `.sql`, e o
-- `supabase/ci/verify-schema.sql` confere o catálogo no fim do replay.
-- ============================================================

-- `lock_timeout` curto: `messages` e `conversations` são quentes, e trocar
-- policy trava a tabela até o fim da transação (supabase.md).
SET LOCAL lock_timeout = '5s';

-- ⚠️ As travas no COMEÇO e na ordem da ingestão: `messages`, depois
-- `conversations` (o INSERT de mensagem segura `messages` e o gatilho da 972
-- vai a `conversations`). Na ordem inversa — o primeiro DROP POLICY é o de
-- `conversations` —, um INSERT em voo fecharia um ciclo com esta migration e
-- o detector de deadlock abortaria a INGESTÃO: mensagem do cliente perdida
-- (supabase.md, "Mensagem ANTIGA").
LOCK TABLE public.messages, public.conversations IN ACCESS EXCLUSIVE MODE;

-- ------------------------------------------------------------
-- 1) Conversa: sem policy de DELETE e sem o privilégio.
-- ------------------------------------------------------------
-- O REVOKE não é redundante com a policy que sai: sem ele, o DELETE do
-- navegador só não acharia linhas ("0 linhas", com cara de sucesso); com ele,
-- o Postgres responde 42501 e a tentativa fica visível (o motivo da 918).
DROP POLICY IF EXISTS conversations_delete ON public.conversations;
REVOKE DELETE ON public.conversations FROM authenticated, anon;

-- ------------------------------------------------------------
-- 2) Mensagem: o FOR ALL vira INSERT + UPDATE, com o MESMO predicado.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS messages_modify ON public.messages;

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM conversations c
    WHERE ((c.id = messages.conversation_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 );

DROP POLICY IF EXISTS messages_update ON public.messages;
CREATE POLICY messages_update ON public.messages FOR UPDATE
 USING (
  (EXISTS ( SELECT 1
     FROM conversations c
    WHERE ((c.id = messages.conversation_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 )
 WITH CHECK (
  (EXISTS ( SELECT 1
     FROM conversations c
    WHERE ((c.id = messages.conversation_id) AND (c.account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('agent'::public.account_role_enum)))))))
 );

REVOKE DELETE ON public.messages FROM authenticated, anon;

-- Todo privilégio que esta migration CONFERE abaixo, ela CONCEDE (banco vazio:
-- o padrão do Supabase não existe numa instalação nova). Em produção, no-op.
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.messages TO service_role;

-- ------------------------------------------------------------
-- 3) Conferência (não precisa de dado: lê o catálogo)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('conversations', 'messages')
       AND cmd IN ('DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION '1096: sobrou policy de DELETE ou FOR ALL em conversations/messages';
  END IF;

  IF has_table_privilege('authenticated', 'public.conversations', 'DELETE')
     OR has_table_privilege('authenticated', 'public.messages', 'DELETE')
     OR has_table_privilege('anon', 'public.conversations', 'DELETE')
     OR has_table_privilege('anon', 'public.messages', 'DELETE') THEN
    RAISE EXCEPTION '1096: authenticated ou anon ainda têm DELETE em conversations/messages';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.messages', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.messages', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.conversations', 'UPDATE') THEN
    RAISE EXCEPTION '1096: o REVOKE levou junto a escrita que fica';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.messages', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.conversations', 'DELETE') THEN
    RAISE EXCEPTION '1096: o service role perdeu o DELETE';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'messages'
         AND (policyname, cmd) IN (('messages_insert', 'INSERT'), ('messages_update', 'UPDATE'), ('messages_select', 'SELECT'))) <> 3 THEN
    RAISE EXCEPTION '1096: messages não ficou com select + insert + update';
  END IF;

  RAISE NOTICE '1096: conversa e mensagem só saem pela ficha, pelas funções e pelo service role.';
END $$;
