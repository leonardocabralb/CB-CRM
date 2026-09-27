-- ============================================================
-- 1055 — ÁREAS da tela de Automações (abas criadas pela conta)
--
-- Pedido do operador em 27/09/2026: separar a lista de automações por área,
-- "só para organização, para saber qual é qual e não ficar com uma lista tão
-- grande" — e com LIBERDADE para cada instalação criar as suas abas (o CRM
-- vai ser vendido: um escritório tem Bancário e Trabalhista, outro vai querer
-- Tributário). Por isso as áreas são LINHAS da conta, nunca nomes no código.
--
-- O que muda no banco, e só isto:
--   1. `cb_areas_de_automacao` (nome + posição, por conta) — o molde é o dos
--      blocos de campos personalizados (966).
--   2. `automations.area_id`, anulável. NULO = a aba "Geral", que NÃO tem
--      linha: é fixa, não se renomeia nem se apaga, e o rótulo sai do
--      dicionário (o mesmo desenho do bloco "Geral", 966).
--
-- ⚠️ O MOTOR NÃO LÊ nada disto. Área não muda escopo, gatilho nem o que
-- dispara — é só em que aba a automação aparece.
--
-- ⚠️ `ON DELETE SET NULL (area_id)`, com a coluna NOMEADA: `account_id` é NOT
-- NULL e faz parte da FK composta; um SET NULL sem lista tentaria zerar as
-- duas colunas, e apagar uma aba estouraria violação em vez de devolver as
-- automações à aba Geral (a armadilha escrita na 966).
--
-- ⚠️ SEM semente: as abas de cada conta são criadas na tela. As desta
-- instalação entram como DADO, por script, depois de aplicar.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo lê a tabela e grava
-- `area_id` — sem elas, a lista não carrega as abas e o salvamento da
-- automação é recusado. O app antigo não lê nenhuma das duas.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) As áreas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_areas_de_automacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Rótulo de ABA: curto. Espelho de `TETO_DO_NOME_DA_AREA` (há teste).
  nome text NOT NULL CHECK (nome = btrim(nome) AND nome <> '' AND char_length(nome) <= 40),
  -- Ordem das abas. A tela grava 0..N-1; empate cai no nome.
  posicao integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Alvo da FK COMPOSTA de `automations` (padrão da 903/908/966): a API grava
-- em service-role, e uma FK simples aceitaria a área de OUTRA conta.
CREATE UNIQUE INDEX IF NOT EXISTS cb_areas_de_automacao_id_conta
  ON public.cb_areas_de_automacao (id, account_id);

-- Duas abas "Tributário" seriam indistinguíveis. Sem caixa; o app ainda tira
-- o acento na comparação da tela, mas quem barra de verdade é este índice.
CREATE UNIQUE INDEX IF NOT EXISTS cb_areas_de_automacao_nome_unico
  ON public.cb_areas_de_automacao (account_id, lower(nome));

-- ------------------------------------------------------------
-- 2) A coluna em automations
-- ------------------------------------------------------------
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS area_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'automations_area_fkey'
  ) THEN
    ALTER TABLE public.automations
      ADD CONSTRAINT automations_area_fkey
      FOREIGN KEY (area_id, account_id)
      REFERENCES public.cb_areas_de_automacao (id, account_id)
      ON DELETE SET NULL (area_id);
  END IF;
END $$;

-- A FK composta pede índice do lado de quem aponta, senão apagar uma aba
-- varre `automations` inteira (dezenas de linhas hoje; é o hábito da casa).
CREATE INDEX IF NOT EXISTS automations_area_id_idx
  ON public.automations (area_id) WHERE area_id IS NOT NULL;

COMMENT ON COLUMN public.automations.area_id IS
  'Aba da tela de Automações (1055). NULO = "Geral". Só organiza: o motor não lê.';

-- ------------------------------------------------------------
-- 3) RLS + privilégios
-- ------------------------------------------------------------
ALTER TABLE public.cb_areas_de_automacao ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro (a aba é rótulo de tela). Forma da 1032: a conta é
-- perguntada UMA vez por consulta, nunca por linha.
DROP POLICY IF EXISTS cb_areas_de_automacao_select ON public.cb_areas_de_automacao;
CREATE POLICY cb_areas_de_automacao_select ON public.cb_areas_de_automacao FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- Escrever: admin, o mesmo piso das automações (as rotas exigem admin).
DROP POLICY IF EXISTS cb_areas_de_automacao_insert ON public.cb_areas_de_automacao;
CREATE POLICY cb_areas_de_automacao_insert ON public.cb_areas_de_automacao FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS cb_areas_de_automacao_update ON public.cb_areas_de_automacao;
CREATE POLICY cb_areas_de_automacao_update ON public.cb_areas_de_automacao FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS cb_areas_de_automacao_delete ON public.cb_areas_de_automacao;
CREATE POLICY cb_areas_de_automacao_delete ON public.cb_areas_de_automacao FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- Tabela cb_* nasce sem nada para `anon`, e o que os outros papéis precisam
-- vai ESCRITO (o default privilege do Supabase não existe no replay do CI).
REVOKE ALL ON public.cb_areas_de_automacao FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_areas_de_automacao TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_areas_de_automacao TO service_role;

-- ------------------------------------------------------------
-- 4) Conferência (catálogo; nada aqui depende de dado)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'automations' AND column_name = 'area_id'
  ) THEN
    RAISE EXCEPTION '1055: a coluna automations.area_id não foi criada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'automations_area_fkey' AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION '1055: a FK automations_area_fkey não é ON DELETE SET NULL';
  END IF;

  IF has_table_privilege('anon', 'public.cb_areas_de_automacao', 'SELECT') THEN
    RAISE EXCEPTION '1055: anon não pode ler cb_areas_de_automacao';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_areas_de_automacao', 'INSERT') THEN
    RAISE EXCEPTION '1055: authenticated precisa de INSERT (a RLS decide quem)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_areas_de_automacao'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1055: a policy de leitura tem de ter a forma da 1032';
  END IF;
END $$;
