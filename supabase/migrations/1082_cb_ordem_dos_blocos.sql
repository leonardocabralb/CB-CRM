-- ============================================================
-- 1082 — A ORDEM DOS BLOCOS de campos passa a ser de cada membro
--
-- Pedido do operador em 12/10/2026: o escritório tem equipes por área
-- (bancário, trabalhista, previdenciário) olhando a mesma ficha, e cada uma
-- quer abrir direto no bloco da SUA área. Decisão dele: a ordem é DE CADA
-- PESSOA, como os filtros salvos (974) e as automações favoritas (1079) — e
-- não do perfil, porque um perfil pode cobrir duas áreas.
--
-- O que muda e o que não muda
-- ---------------------------
-- A ordem da CONTA continua onde sempre esteve (`cb_grupos_de_campos.posicao`,
-- 966) e continua valendo para quem nunca arrumou a sua, para o catálogo de
-- Configurações, para os seletores de campo do construtor e para a API. Esta
-- tabela só diz em que ordem ESTA pessoa vê as pastilhas na ficha — e, como a
-- ficha mostra um bloco por vez, qual deles já abre.
--
-- ⚠️ Só ORGANIZA a tela: nenhum motor (automação, robô, API v1, Calendly,
-- agente de IA) lê nada daqui, e nada aqui toca `custom_fields`.
--
-- ⚠️ `ordem` É TEXTO, NÃO UUID: o bloco "Geral" não tem linha no banco
-- (`grupo_id IS NULL`), e a chave dele na tela é a palavra `geral`
-- (`chaveDoBloco`). Os demais itens são o id do grupo, como texto.
--
-- ⚠️ SEM FK, porque array não tem. Bloco apagado deixa o id órfão na lista de
-- quem o tinha ordenado; a LEITURA resolve contra os blocos vivos e ignora o
-- que não existe mais — a mesma regra dos arrays de `cb_perfis_de_acesso`
-- (956). E bloco criado depois, que a pessoa ainda não posicionou, entra no
-- FIM da ordem dela.
--
-- ⚠️ `user_id` = `auth.users.id`, com CASCADE: preferência PESSOAL, sem
-- sentido depois que o login some (a exceção declarada à regra do dono
-- durável, como na 974 e na 1079).
--
-- ⚠️ ADITIVA, vai ANTES do deploy. Sem ela o app novo não quebra — a leitura
-- que falha cai na ordem da conta —, mas "Salvar" a ordem responderia erro.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) A tabela — UMA linha por pessoa em cada conta
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_ordem_dos_blocos (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- As chaves dos blocos, na ordem em que a pessoa quer vê-los. Voltar ao
  -- padrão é APAGAR a linha, nunca gravar lista vazia: assim "tem ordem
  -- própria" é uma pergunta só (a linha existe?).
  ordem text[] NOT NULL
    CHECK (cardinality(ordem) BETWEEN 1 AND 200
           AND array_position(ordem, NULL) IS NULL),
  -- A consulta que existe é "qual é a MINHA, nesta conta": sai direto da PK,
  -- que é também o alvo do `ON CONFLICT` de quem salva.
  PRIMARY KEY (user_id, account_id)
);

COMMENT ON TABLE public.cb_ordem_dos_blocos IS
  'Ordem em que UM membro vê os blocos de campos na ficha (1082). Pessoal: ninguém vê nem muda a do outro. Sem linha = ordem da conta. Nenhum motor lê.';

-- Apagar a conta varre por `account_id`, e a PK começa por `user_id`.
CREATE INDEX IF NOT EXISTS cb_ordem_dos_blocos_conta_idx
  ON public.cb_ordem_dos_blocos (account_id);

-- ------------------------------------------------------------
-- 2) RLS — cada um só enxerga e mexe na sua
-- ------------------------------------------------------------
ALTER TABLE public.cb_ordem_dos_blocos ENABLE ROW LEVEL SECURITY;

-- Leitura na forma da 1032: dono e conta perguntados UMA vez por consulta.
DROP POLICY IF EXISTS cb_ordem_dos_blocos_select ON public.cb_ordem_dos_blocos;
CREATE POLICY cb_ordem_dos_blocos_select ON public.cb_ordem_dos_blocos FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    AND account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))
  );

DROP POLICY IF EXISTS cb_ordem_dos_blocos_insert ON public.cb_ordem_dos_blocos;
CREATE POLICY cb_ordem_dos_blocos_insert ON public.cb_ordem_dos_blocos FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

-- USING e WITH CHECK (como na 974): só o USING deixaria mover a linha para
-- outro dono no mesmo update; só o WITH CHECK deixaria editar a que não se vê.
DROP POLICY IF EXISTS cb_ordem_dos_blocos_update ON public.cb_ordem_dos_blocos;
CREATE POLICY cb_ordem_dos_blocos_update ON public.cb_ordem_dos_blocos FOR UPDATE
  USING (user_id = auth.uid() AND is_account_member(account_id))
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS cb_ordem_dos_blocos_delete ON public.cb_ordem_dos_blocos;
CREATE POLICY cb_ordem_dos_blocos_delete ON public.cb_ordem_dos_blocos FOR DELETE
  USING (user_id = auth.uid() AND is_account_member(account_id));

-- Privilégios por escrito: o default privilege do Supabase não existe em
-- banco novo, e é lá que o CI reaplica tudo do zero.
REVOKE ALL ON public.cb_ordem_dos_blocos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_ordem_dos_blocos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_ordem_dos_blocos TO service_role;

-- ------------------------------------------------------------
-- 3) Conferência (catálogo; nada aqui depende de dado)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_ordem_dos_blocos'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '1082: RLS não ficou ligada em cb_ordem_dos_blocos';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_ordem_dos_blocos'
  ) <> 4 THEN
    RAISE EXCEPTION '1082: esperava 4 policies (select/insert/update/delete)';
  END IF;

  -- Toda policy recorta pelo DONO: sem isso, um membro leria (ou trocaria) a
  -- ordem do colega, e a tela não teria como mostrar o engano.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_ordem_dos_blocos'
       AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%auth.uid()%'
  ) THEN
    RAISE EXCEPTION '1082: há policy em cb_ordem_dos_blocos que não recorta pelo dono';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_ordem_dos_blocos'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1082: a policy de leitura tem de ter a forma da 1032';
  END IF;

  IF has_table_privilege('anon', 'public.cb_ordem_dos_blocos', 'SELECT') THEN
    RAISE EXCEPTION '1082: anon não pode ler cb_ordem_dos_blocos';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_ordem_dos_blocos', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_ordem_dos_blocos', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.cb_ordem_dos_blocos', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.cb_ordem_dos_blocos', 'DELETE') THEN
    RAISE EXCEPTION '1082: authenticated precisa de SELECT/INSERT/UPDATE/DELETE (a ordem é salva do navegador)';
  END IF;
END $$;
