-- ============================================================
-- 1079 — Automações FAVORITAS (de cada membro)
--
-- Pedido do operador em 05/10/2026: marcar com estrela as automações que se
-- usa sempre, para que fiquem no TOPO da lista — na janela "Executar
-- automação" da conversa e na tela de Automações. Decisão dele: a favorita é
-- DE CADA PESSOA (o que eu fixo não muda a lista do colega), como as
-- conversas favoritas (924) e os filtros salvos (974).
--
-- ⚠️ POR QUE TABELA, E NÃO UMA COLUNA EM `automations`: a coluna seria uma
-- marca DA CONTA — o colega desmarcaria a minha. Tabela de junção é a forma
-- que o "por membro" tem no banco (o raciocínio inteiro está na 924).
--
-- ⚠️ `user_id` = `auth.users.id` (o que `auth.uid()` devolve), com CASCADE:
-- preferência PESSOAL, sem sentido depois que o login some (a exceção
-- declarada à regra do dono durável, como na 924 e na 974).
--
-- ⚠️ FK COMPOSTA `(automation_id, account_id)`: a simples só garantiria "existe
-- uma automação com esse id", não "é DESTA conta". `automations` não tinha
-- alvo único com a conta; o índice abaixo o cria (63 linhas em produção).
--
-- ⚠️ Só ORGANIZA a tela: o motor não lê nada disto.
--
-- ⚠️ ADITIVA, vai ANTES do deploy: o app novo lê a tabela (sem ela, as
-- estrelas não carregam e a tela avisa); o app antigo não a conhece.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) Alvo da FK composta
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS automations_id_conta
  ON public.automations (id, account_id);

-- ------------------------------------------------------------
-- 2) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_automacoes_favoritas (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A consulta que existe é "quais são as MINHAS": sai direto da PK.
  PRIMARY KEY (user_id, automation_id),
  CONSTRAINT cb_automacoes_favoritas_automacao_fkey
    FOREIGN KEY (automation_id, account_id)
    REFERENCES public.automations (id, account_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.cb_automacoes_favoritas IS
  'Automação marcada com estrela por um membro (1079): fica no topo das listas DELE. Pessoal: ninguém vê nem desmarca a do outro. O motor não lê.';

-- Sem este índice, apagar uma automação varre a tabela (a PK começa por
-- `user_id` e não serve para procurar por automação).
CREATE INDEX IF NOT EXISTS cb_automacoes_favoritas_automacao_idx
  ON public.cb_automacoes_favoritas (automation_id, account_id);

-- ------------------------------------------------------------
-- 3) RLS — cada um só enxerga e mexe no que é seu
-- ------------------------------------------------------------
ALTER TABLE public.cb_automacoes_favoritas ENABLE ROW LEVEL SECURITY;

-- Leitura na forma da 1032: dono e conta perguntados UMA vez por consulta.
DROP POLICY IF EXISTS cb_automacoes_favoritas_select ON public.cb_automacoes_favoritas;
CREATE POLICY cb_automacoes_favoritas_select ON public.cb_automacoes_favoritas FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    AND account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))
  );

DROP POLICY IF EXISTS cb_automacoes_favoritas_insert ON public.cb_automacoes_favoritas;
CREATE POLICY cb_automacoes_favoritas_insert ON public.cb_automacoes_favoritas FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS cb_automacoes_favoritas_delete ON public.cb_automacoes_favoritas;
CREATE POLICY cb_automacoes_favoritas_delete ON public.cb_automacoes_favoritas FOR DELETE
  USING (user_id = auth.uid() AND is_account_member(account_id));

-- Sem UPDATE: marcar é INSERT, desmarcar é DELETE. O REVOKE faz um UPDATE
-- responder 42501 em vez de "0 linhas" com cara de sucesso (912/918/924).
REVOKE ALL ON public.cb_automacoes_favoritas FROM anon;
REVOKE UPDATE, TRUNCATE ON public.cb_automacoes_favoritas FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.cb_automacoes_favoritas TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.cb_automacoes_favoritas TO service_role;

-- ------------------------------------------------------------
-- 4) Conferência (catálogo; nada aqui depende de dado)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_automacoes_favoritas'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '1079: RLS não ficou ligada em cb_automacoes_favoritas';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_automacoes_favoritas'
  ) <> 3 THEN
    RAISE EXCEPTION '1079: esperava 3 policies (select/insert/delete)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_automacoes_favoritas'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1079: a policy de leitura tem de ter a forma da 1032';
  END IF;

  IF has_table_privilege('anon', 'public.cb_automacoes_favoritas', 'SELECT') THEN
    RAISE EXCEPTION '1079: anon não pode ler cb_automacoes_favoritas';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_automacoes_favoritas', 'UPDATE') THEN
    RAISE EXCEPTION '1079: authenticated ainda pode UPDATE — o REVOKE não pegou';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_automacoes_favoritas', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_automacoes_favoritas', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.cb_automacoes_favoritas', 'DELETE') THEN
    RAISE EXCEPTION '1079: authenticated precisa de SELECT/INSERT/DELETE (a estrela sai do navegador)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cb_automacoes_favoritas_automacao_fkey' AND confdeltype = 'c'
  ) THEN
    RAISE EXCEPTION '1079: a FK da automação tem de ser ON DELETE CASCADE';
  END IF;
END $$;
