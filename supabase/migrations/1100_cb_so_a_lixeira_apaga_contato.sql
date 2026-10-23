-- ============================================================
-- 1100 — Contato só sai pela Lixeira (Fase 3)
--
-- Fase 3 de docs/PLANO-lixeira-de-contatos.md. RESTRITIVA: aplicar DEPOIS
-- do deploy da Fase 2 (1097/1098 e a tela que move para a Lixeira). Uma aba
-- aberta com o app antigo que tente apagar recebe 42501 e o `lerExclusao`
-- dela diz "falhou" — nunca apaga sem Lixeira.
--
-- Desde a 1097 nada no app chama `.delete()` em `contacts`: excluir é
-- `cb_mover_contatos_para_lixeira` (SECURITY DEFINER, admin por dentro). Mas
-- a policy `contacts_delete` (981, admin) seguia de pé, e um DELETE direto
-- pelo PostgREST — ou a página CRUA do upstream num merge — apagaria a ficha
-- com a conversa e as mensagens, SEM passar pela Lixeira.
--
-- O QUE CONTINUA APAGANDO: as funções SECURITY DEFINER (a Lixeira, a união
-- de fichas, o desfazer da Kommo), o CASCADE da conta apagada e o service
-- role. INSERT e UPDATE do navegador não mudam (`agent`, 017/981).
--
-- ⚠️ `contacts_delete` é do UPSTREAM (0017): um merge que a recrie reabre a
-- porta sem conflito. §6 de docs/MERGE-UPSTREAM.md; o pino
-- `so-a-lixeira-apaga-1100.test.ts` reprova pelos `.sql` e pelo `src/`, e o
-- `supabase/ci/verify-schema.sql` confere o catálogo no fim do replay.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- Trocar policy trava `contacts` até o fim da transação: a trava vem no
-- COMEÇO (num DO: `LOCK TABLE` solto estoura fora de transação).
DO $$
BEGIN
  LOCK TABLE public.contacts IN ACCESS EXCLUSIVE MODE;
END $$;

DROP POLICY IF EXISTS contacts_delete ON public.contacts;
-- O REVOKE torna a tentativa VISÍVEL (42501), em vez de "0 linhas" com cara
-- de sucesso (o motivo da 918 e da 1096).
REVOKE DELETE ON public.contacts FROM authenticated, anon;

-- Todo privilégio que a conferência confere, a migration concede (banco
-- vazio). Em produção, no-op.
GRANT SELECT, INSERT, UPDATE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'contacts' AND cmd IN ('DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION '1100: sobrou policy de DELETE ou FOR ALL em contacts';
  END IF;
  IF has_table_privilege('authenticated', 'public.contacts', 'DELETE')
     OR has_table_privilege('anon', 'public.contacts', 'DELETE') THEN
    RAISE EXCEPTION '1100: authenticated ou anon ainda têm DELETE em contacts';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.contacts', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.contacts', 'UPDATE') THEN
    RAISE EXCEPTION '1100: o REVOKE levou junto o cadastro e a correção';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.contacts', 'DELETE') THEN
    RAISE EXCEPTION '1100: o service role perdeu o DELETE';
  END IF;
  -- A porta que fica: a Lixeira.
  IF to_regprocedure('public.cb_mover_contatos_para_lixeira(uuid[], uuid)') IS NULL
     OR NOT has_function_privilege('authenticated', 'public.cb_mover_contatos_para_lixeira(uuid[], uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1100: sem a Lixeira (1097), contato não sairia por porta nenhuma';
  END IF;
  RAISE NOTICE '1100: contato só sai pela Lixeira, pelas funções e pelo service role.';
END $$;
