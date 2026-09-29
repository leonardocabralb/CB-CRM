-- ============================================================
-- 1069 — CONTATOS RELACIONADOS (vínculo entre duas fichas)
--
-- Pedido do operador em 29/09/2026: às vezes duas pessoas falam com o
-- escritório sobre o mesmo assunto (cônjuge, filho, procurador). O vínculo
-- liga a ficha A à ficha B, e cada uma aparece na aba "Relacionados" da
-- outra — no painel da conversa e na ficha de /contatos. Plano:
-- `docs/PLANO-contatos-relacionados.md`.
--
-- O desenho, e o porquê de cada peça:
--
--   * UM vínculo é UMA linha, e vale para os dois lados. A tela procura o
--     contato nas DUAS colunas. Duas linhas (A→B e B→A) poderiam discordar
--     sobre a descrição, e desfazer um lado deixaria o outro de pé.
--   * O índice único sobre `LEAST/GREATEST` recusa o mesmo par nos dois
--     sentidos (A–B e B–A), sem obrigar a tela a ordenar os ids antes de
--     gravar. O CHECK recusa a ficha ligada a ela mesma.
--   * FKs COMPOSTAS `(contato, account_id)` → `contacts (id, account_id)`
--     (padrão da 944/945/994/1057): uma FK simples aceitaria o contato de
--     OUTRA conta. `ON DELETE CASCADE`: apagar uma das fichas desfaz o
--     vínculo — um vínculo com uma ponta vazia não diz nada a ninguém.
--   * `descricao` é opcional e curta ("esposa", "procurador"). Espelho de
--     `TETO_DA_DESCRICAO` (`src/lib/contacts/relacionados.ts`; há teste).
--   * `created_by` é AUTORIA (SET NULL): apagar o login de quem vinculou não
--     leva o vínculo junto.
--   * Leitura: qualquer membro, na forma da 1032. Escrita: `agent`, o mesmo
--     piso de `contacts_update` (017) — vincular é cuidar da ficha, como
--     corrigir o nome. O Visualizador só vê.
--
-- ⚠️ Tabela nova com `contact_id`: entra na receita de FUSÃO de fichas
-- (`.claude/rules/supabase.md`) no mesmo PR.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo lê a tabela na aba; o antigo
-- não sabe que ela existe.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- Alvo das FKs compostas. Já existe desde a 944 (IF NOT EXISTS): repetido
-- para esta migration aplicar sozinha num banco vazio.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx
  ON public.contacts (id, account_id);

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_contatos_relacionados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_a_id uuid NOT NULL,
  contact_b_id uuid NOT NULL,
  descricao text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_contatos_relacionados_nao_a_si_mesmo
    CHECK (contact_a_id <> contact_b_id),
  CONSTRAINT cb_contatos_relacionados_descricao
    CHECK (
      descricao IS NULL
      OR (descricao = btrim(descricao) AND descricao <> '' AND char_length(descricao) <= 80)
    ),
  CONSTRAINT cb_contatos_relacionados_contato_a_fkey
    FOREIGN KEY (contact_a_id, account_id)
    REFERENCES public.contacts (id, account_id) ON DELETE CASCADE,
  CONSTRAINT cb_contatos_relacionados_contato_b_fkey
    FOREIGN KEY (contact_b_id, account_id)
    REFERENCES public.contacts (id, account_id) ON DELETE CASCADE
);

-- O mesmo par, em qualquer ordem, uma vez só.
CREATE UNIQUE INDEX IF NOT EXISTS cb_contatos_relacionados_par_unico
  ON public.cb_contatos_relacionados (
    LEAST(contact_a_id, contact_b_id),
    GREATEST(contact_a_id, contact_b_id)
  );

-- A aba procura o contato nas duas colunas (`.or(a.eq,b.eq)`), e o CASCADE de
-- apagar contato procura pelas duas também: sem índice, cada exclusão de
-- ficha varreria a tabela inteira.
CREATE INDEX IF NOT EXISTS cb_contatos_relacionados_contato_a_idx
  ON public.cb_contatos_relacionados (contact_a_id);
CREATE INDEX IF NOT EXISTS cb_contatos_relacionados_contato_b_idx
  ON public.cb_contatos_relacionados (contact_b_id);

COMMENT ON TABLE public.cb_contatos_relacionados IS
  'Vínculo entre duas fichas da mesma conta (1069). Uma linha vale para os dois lados.';

-- ------------------------------------------------------------
-- 2) RLS + privilégios
-- ------------------------------------------------------------
ALTER TABLE public.cb_contatos_relacionados ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro. Forma da 1032: a conta é perguntada UMA vez por
-- consulta, nunca por linha.
DROP POLICY IF EXISTS cb_contatos_relacionados_select ON public.cb_contatos_relacionados;
CREATE POLICY cb_contatos_relacionados_select ON public.cb_contatos_relacionados FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- Escrever: `agent`, o piso de `contacts_update`.
DROP POLICY IF EXISTS cb_contatos_relacionados_insert ON public.cb_contatos_relacionados;
CREATE POLICY cb_contatos_relacionados_insert ON public.cb_contatos_relacionados FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum));

DROP POLICY IF EXISTS cb_contatos_relacionados_update ON public.cb_contatos_relacionados;
CREATE POLICY cb_contatos_relacionados_update ON public.cb_contatos_relacionados FOR UPDATE
  USING (is_account_member(account_id, 'agent'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum));

DROP POLICY IF EXISTS cb_contatos_relacionados_delete ON public.cb_contatos_relacionados;
CREATE POLICY cb_contatos_relacionados_delete ON public.cb_contatos_relacionados FOR DELETE
  USING (is_account_member(account_id, 'agent'::account_role_enum));

-- Tabela cb_* nasce sem nada para `anon`, e o que os outros papéis precisam
-- vai ESCRITO (o default privilege do Supabase não existe no replay do CI).
REVOKE ALL ON public.cb_contatos_relacionados FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_contatos_relacionados TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_contatos_relacionados TO service_role;

-- ------------------------------------------------------------
-- 3) Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (
    SELECT count(*) FROM pg_constraint
     WHERE conrelid = 'public.cb_contatos_relacionados'::regclass
       AND contype = 'f' AND confrelid = 'public.contacts'::regclass
       AND confdeltype = 'c'
  ) <> 2 THEN
    RAISE EXCEPTION '1069: as duas FKs para contacts têm de ser ON DELETE CASCADE';
  END IF;

  IF has_table_privilege('anon', 'public.cb_contatos_relacionados', 'SELECT') THEN
    RAISE EXCEPTION '1069: anon não pode ler cb_contatos_relacionados';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_contatos_relacionados', 'INSERT') THEN
    RAISE EXCEPTION '1069: authenticated precisa de INSERT (a RLS decide quem)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_contatos_relacionados'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1069: a policy de leitura tem de ter a forma da 1032';
  END IF;
END $$;

-- O par invertido é recusado. Precisa de duas fichas da mesma conta: num banco
-- vazio (o replay do CI) não há o que provar. A prova grava e se DESFAZ pelo
-- SQLSTATE próprio — nunca `WHEN OTHERS`, que engoliria um erro de verdade.
DO $$
DECLARE
  v_conta uuid;
  v_a uuid;
  v_b uuid;
BEGIN
  SELECT c1.account_id, c1.id, c2.id INTO v_conta, v_a, v_b
    FROM public.contacts c1
    JOIN public.contacts c2 ON c2.account_id = c1.account_id AND c2.id <> c1.id
   LIMIT 1;

  IF v_conta IS NULL THEN
    RAISE NOTICE '1069: banco sem duas fichas na mesma conta, nada a provar.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.cb_contatos_relacionados (account_id, contact_a_id, contact_b_id)
    VALUES (v_conta, v_a, v_b);
    BEGIN
      INSERT INTO public.cb_contatos_relacionados (account_id, contact_a_id, contact_b_id)
      VALUES (v_conta, v_b, v_a);
      RAISE EXCEPTION '1069: o par invertido (B–A) foi aceito ao lado de A–B';
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P1069', MESSAGE = '1069: desfaz a prova';
  EXCEPTION WHEN SQLSTATE 'P1069' THEN
    NULL;
  END;
END $$;
