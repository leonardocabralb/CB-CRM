-- ============================================================
-- 1084 — POSSÍVEL DUPLICATA: a mesma pessoa em duas fichas
--
-- Pedido do operador em 13/10/2026. Plano, decisões e a medição que escolheu
-- os sinais: `docs/PLANO-fichas-duplicadas.md`.
--
-- A mesma pessoa vira duas fichas quando chega por dois caminhos com dados
-- diferentes (o formulário do anúncio com um telefone, o agendamento com
-- outro; o formulário com o número digitado errado, o WhatsApp com o certo).
-- A chave do telefone (1024) não pega: os números são DIFERENTES.
--
-- O desenho, e o porquê de cada peça:
--
--   * CONFERIDO NA HORA, nunca guardado. `cb_possiveis_duplicatas(contato)`
--     calcula os pares DAQUELA ficha quando a conversa ou o card abre. Nada
--     de gatilho em `contacts` (a ingestão não paga nada), nada de varredura
--     nem de lista para envelhecer — e a ficha antiga entra sozinha, no dia
--     em que for aberta (decisão D4: a base inteira).
--   * `SECURITY INVOKER`: a RLS de `contacts` vale dentro da função, então
--     ela só enxerga fichas das contas de quem pergunta. Nada a conferir à
--     mão, nada que um `SECURITY DEFINER` pudesse vazar.
--   * SÓ SINAIS FORTES (decisão D2), escolhidos pela medição de 13/10:
--       1. mesmo e-mail, fora de endereço de reserva (o mesmo e-mail em
--          mais de 3 fichas é digitação da equipe, não pessoa);
--       2. telefone a UM dígito de distância (troca, sobra, falta ou dois
--          vizinhos invertidos) E o mesmo primeiro nome;
--       3. criadas com até 2 min de diferença E o mesmo primeiro nome, FORA
--          de lote: importação cria centenas de fichas por minuto, e ali o
--          horário não diz nada (medido: 12,5 mil "pares" falsos).
--     Nome sozinho NUNCA é sinal (385 nomes repetidos na base medida).
--   * A decisão "não é duplicata" fica em `cb_duplicatas_descartadas` (par
--     ordenado). Escrever é de ADMIN (decisão D1), na policy; ler é de
--     qualquer membro, na forma da 1032. "Pessoas diferentes, mas ligadas"
--     não precisa de tabela: é o vínculo de Contatos relacionados (1069), e
--     o par ligado sai do aviso do mesmo jeito.
--   * FKs COMPOSTAS `(contato, account_id)` → `contacts (id, account_id)`
--     com CASCADE (padrão da 1069): apagar uma das fichas leva a decisão.
--
-- ⚠️ Tabela nova com contato: entra na receita de FUSÃO de fichas
-- (`.claude/rules/supabase.md`) no mesmo PR, pelas DUAS pontas.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo chama a RPC; o antigo não
-- sabe que ela existe.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) O primeiro nome — a régua de "mesmo nome" dos sinais 2 e 3
-- ------------------------------------------------------------
-- A primeira sequência de letras do nome, sem acento, em minúsculas, com 3
-- letras ou mais. "Fulano_detal" → "fulano"; "🫦 Fulana Teste" → "fulana";
-- emoji sozinho, número e nome curto ("Jo") → NULO, e NULO não casa com nada.
--
-- ⚠️ `normalize(…, NFD)` ANTES de apagar os sinais combinantes, como a régua
-- de etiqueta da 984: a forma decomposta (macOS, CSV) viraria outro nome.
-- O `\u0300` é escape da ARE do Postgres (`standard_conforming_strings`),
-- escrito assim de propósito: o caractere literal seria invisível.
CREATE OR REPLACE FUNCTION public.cb_primeiro_nome(p_nome text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE WHEN length(s.t) >= 3 THEN s.t END
    FROM (
      SELECT (regexp_match(
                regexp_replace(normalize(lower(coalesce(p_nome, '')), NFD),
                               '[\u0300-\u036f]', '', 'g'),
                '[a-z]+'))[1] AS t
    ) s
$$;

-- ------------------------------------------------------------
-- 2) Os telefones a UM dígito de distância
-- ------------------------------------------------------------
-- Todos os números que diferem do dado por um dígito trocado, um a mais, um
-- a menos ou dois vizinhos invertidos (~280 para um celular brasileiro). A
-- RPC procura a lista inteira no índice único de `telefone_canonico` — busca
-- por igualdade, nunca uma comparação contra a base toda.
--
-- Só número de 10 a 15 dígitos (o telefone de verdade, como a 1024 guarda);
-- o resto devolve vazio. O próprio número nunca está na lista.
CREATE OR REPLACE FUNCTION public.cb_vizinhos_do_telefone(p_tel text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_tel IS NULL OR p_tel !~ '^[0-9]{10,15}$' THEN ARRAY[]::text[]
    ELSE ARRAY(
      -- falta um dígito
      SELECT substr(p_tel, 1, i - 1) || substr(p_tel, i + 1)
        FROM generate_series(1, length(p_tel)) AS i
      UNION
      -- sobra um dígito
      SELECT substr(p_tel, 1, i - 1) || d::text || substr(p_tel, i)
        FROM generate_series(1, length(p_tel) + 1) AS i,
             generate_series(0, 9) AS d
      UNION
      -- um dígito trocado
      SELECT substr(p_tel, 1, i - 1) || d::text || substr(p_tel, i + 1)
        FROM generate_series(1, length(p_tel)) AS i,
             generate_series(0, 9) AS d
       WHERE d::text <> substr(p_tel, i, 1)
      UNION
      -- dois vizinhos invertidos
      SELECT substr(p_tel, 1, i - 1) || substr(p_tel, i + 1, 1)
             || substr(p_tel, i, 1) || substr(p_tel, i + 2)
        FROM generate_series(1, length(p_tel) - 1) AS i
       WHERE substr(p_tel, i, 1) <> substr(p_tel, i + 1, 1)
    )
  END
$$;

-- ------------------------------------------------------------
-- 3) A decisão "não é duplicata"
-- ------------------------------------------------------------
-- Alvo das FKs compostas. Já existe desde a 944 (IF NOT EXISTS): repetido
-- para esta migration aplicar sozinha num banco vazio.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx
  ON public.contacts (id, account_id);

CREATE TABLE IF NOT EXISTS public.cb_duplicatas_descartadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- O par ORDENADO (menor, maior): a mesma decisão vale nos dois sentidos, e
  -- o CHECK + o UNIQUE recusam o par repetido e a ficha consigo mesma.
  contato_menor uuid NOT NULL,
  contato_maior uuid NOT NULL,
  -- AUTORIA (SET NULL): apagar o login de quem decidiu não leva a decisão.
  descartado_por uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  descartado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_duplicatas_descartadas_ordem
    CHECK (contato_menor < contato_maior),
  CONSTRAINT cb_duplicatas_descartadas_par
    UNIQUE (contato_menor, contato_maior),
  CONSTRAINT cb_duplicatas_descartadas_menor_fkey
    FOREIGN KEY (contato_menor, account_id)
    REFERENCES public.contacts (id, account_id) ON DELETE CASCADE,
  CONSTRAINT cb_duplicatas_descartadas_maior_fkey
    FOREIGN KEY (contato_maior, account_id)
    REFERENCES public.contacts (id, account_id) ON DELETE CASCADE
);

-- O CASCADE de apagar contato procura pelas duas colunas; a primeira já é a
-- cabeça do UNIQUE.
CREATE INDEX IF NOT EXISTS cb_duplicatas_descartadas_maior_idx
  ON public.cb_duplicatas_descartadas (contato_maior);

COMMENT ON TABLE public.cb_duplicatas_descartadas IS
  'Par de fichas que um admin conferiu e decidiu NÃO ser a mesma pessoa (1084). Tira o par do aviso de possível duplicata.';

ALTER TABLE public.cb_duplicatas_descartadas ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro. Forma da 1032: a conta é perguntada UMA vez por
-- consulta, nunca por linha.
DROP POLICY IF EXISTS cb_duplicatas_descartadas_select ON public.cb_duplicatas_descartadas;
CREATE POLICY cb_duplicatas_descartadas_select ON public.cb_duplicatas_descartadas FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- Decidir: ADMIN (D1), como apagar contato (981). A autoria é de quem grava:
-- ninguém registra a decisão em nome de outro.
DROP POLICY IF EXISTS cb_duplicatas_descartadas_insert ON public.cb_duplicatas_descartadas;
CREATE POLICY cb_duplicatas_descartadas_insert ON public.cb_duplicatas_descartadas FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'admin'::account_role_enum)
    AND descartado_por IS NOT DISTINCT FROM auth.uid()
  );

-- Desfazer (o "Desfazer" logo depois de descartar): admin também.
DROP POLICY IF EXISTS cb_duplicatas_descartadas_delete ON public.cb_duplicatas_descartadas;
CREATE POLICY cb_duplicatas_descartadas_delete ON public.cb_duplicatas_descartadas FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

-- Sem UPDATE: a decisão se grava ou se desfaz, nunca se edita. O REVOKE ALL
-- vem antes do GRANT porque o privilégio padrão do Supabase dá TUDO a
-- `authenticated` (TRUNCATE incluso) — e no replay do CI esse padrão nem
-- existe: o que a tela precisa vai ESCRITO.
REVOKE ALL ON public.cb_duplicatas_descartadas FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.cb_duplicatas_descartadas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_duplicatas_descartadas TO service_role;

-- ------------------------------------------------------------
-- 4) O índice do sinal 3 (fichas criadas perto uma da outra)
-- ------------------------------------------------------------
-- `created_at` é comparação de timestamp — vai como condição de índice mesmo
-- sob a RLS. Sem ele, cada abertura de conversa varreria as fichas da conta.
CREATE INDEX IF NOT EXISTS idx_contacts_conta_criacao
  ON public.contacts (account_id, created_at);

-- ------------------------------------------------------------
-- 5) A pergunta: quais fichas parecem ser a mesma pessoa desta?
-- ------------------------------------------------------------
-- Devolve UMA linha por ficha candidata, com os motivos em ordem (e-mail,
-- telefone, horário). Fora: a própria ficha, o par descartado por um admin e
-- o par já ligado em Contatos relacionados. Ficha que quem pergunta não
-- enxerga (outra conta) não existe para a função — a RLS corta.
--
-- ⚠️ A janela de 2 min, o teto de 10 fichas do lote e o teto de 3 fichas por
-- e-mail são ESPELHO do plano e do teste (`possiveis-duplicatas-1084.test.ts`
-- lê este arquivo): mudar aqui sem medir de novo é chutar.
CREATE OR REPLACE FUNCTION public.cb_possiveis_duplicatas(p_contato uuid)
RETURNS TABLE (outro_id uuid, motivos jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH eu AS (
    SELECT c.id,
           c.account_id,
           c.created_at,
           nullif(c.telefone_canonico, '') AS tel,
           nullif(lower(btrim(c.email)), '') AS email,
           public.cb_primeiro_nome(c.name) AS nome
      FROM public.contacts c
     WHERE c.id = p_contato
  ),
  sinais AS (
    -- 1) Mesmo e-mail, fora de endereço de reserva.
    SELECT o.id, 1 AS ordem, jsonb_build_object('tipo', 'mesmo_email') AS motivo
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.id <> eu.id
       AND o.email IS NOT NULL
       AND lower(btrim(o.email)) = eu.email
     WHERE eu.email IS NOT NULL
       AND (SELECT count(*)
              FROM public.contacts x
             WHERE x.account_id = eu.account_id
               AND x.email IS NOT NULL
               AND lower(btrim(x.email)) = eu.email) <= 3

    UNION ALL

    -- 2) Telefone a um dígito de distância E o mesmo primeiro nome.
    SELECT o.id, 2, jsonb_build_object('tipo', 'telefone_parecido')
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.id <> eu.id
       AND o.telefone_canonico = ANY (public.cb_vizinhos_do_telefone(eu.tel))
     WHERE eu.tel IS NOT NULL
       AND eu.nome IS NOT NULL
       AND public.cb_primeiro_nome(o.name) = eu.nome

    UNION ALL

    -- 3) Criadas com até 2 min de diferença E o mesmo primeiro nome, fora de
    -- lote (no máximo 10 fichas na conta entre 1 min antes da primeira e 1
    -- min depois da segunda).
    SELECT o.id, 3,
           jsonb_build_object(
             'tipo', 'criadas_juntas',
             'segundos', round(abs(extract(epoch FROM o.created_at - eu.created_at)))::int
           )
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.id <> eu.id
       AND o.created_at BETWEEN eu.created_at - interval '2 minutes'
                            AND eu.created_at + interval '2 minutes'
     WHERE eu.nome IS NOT NULL
       AND public.cb_primeiro_nome(o.name) = eu.nome
       AND (SELECT count(*)
              FROM public.contacts x
             WHERE x.account_id = eu.account_id
               AND x.created_at BETWEEN least(eu.created_at, o.created_at) - interval '1 minute'
                                    AND greatest(eu.created_at, o.created_at) + interval '1 minute') <= 10
  )
  SELECT s.id AS outro_id,
         jsonb_agg(s.motivo ORDER BY s.ordem) AS motivos
    FROM sinais s
    CROSS JOIN eu
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.cb_duplicatas_descartadas d
            WHERE d.contato_menor = least(eu.id, s.id)
              AND d.contato_maior = greatest(eu.id, s.id))
     AND NOT EXISTS (
           SELECT 1
             FROM public.cb_contatos_relacionados r
            WHERE least(r.contact_a_id, r.contact_b_id) = least(eu.id, s.id)
              AND greatest(r.contact_a_id, r.contact_b_id) = greatest(eu.id, s.id))
   GROUP BY s.id
   ORDER BY min(s.ordem), s.id
$$;

-- A RPC roda como quem chama (INVOKER) e chama as duas auxiliares: quem pode
-- perguntar precisa de EXECUTE nas três. Nada para `anon`.
REVOKE EXECUTE ON FUNCTION public.cb_primeiro_nome(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_vizinhos_do_telefone(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_primeiro_nome(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cb_vizinhos_do_telefone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6) Conferência
-- ------------------------------------------------------------
-- As auxiliares são puras: provadas com constantes, em qualquer banco.
DO $$
DECLARE
  v_viz text[];
BEGIN
  IF public.cb_primeiro_nome('Fulano_detal') IS DISTINCT FROM 'fulano' THEN
    RAISE EXCEPTION '1084: primeiro nome de "Fulano_detal" deveria ser "fulano"';
  END IF;
  IF public.cb_primeiro_nome('Ândréa Souza') IS DISTINCT FROM 'andrea' THEN
    RAISE EXCEPTION '1084: o acento precomposto não saiu do primeiro nome';
  END IF;
  IF public.cb_primeiro_nome(E'A\u0301NDREA Souza') IS DISTINCT FROM 'andrea' THEN
    RAISE EXCEPTION '1084: o acento decomposto (NFD) não saiu do primeiro nome';
  END IF;
  IF public.cb_primeiro_nome(E'\U0001FAE6 Fulana Teste') IS DISTINCT FROM 'fulana' THEN
    RAISE EXCEPTION '1084: o emoji antes do nome deveria ser pulado';
  END IF;
  IF public.cb_primeiro_nome('Jo') IS NOT NULL
     OR public.cb_primeiro_nome('5511999990000') IS NOT NULL
     OR public.cb_primeiro_nome('') IS NOT NULL
     OR public.cb_primeiro_nome(NULL) IS NOT NULL THEN
    RAISE EXCEPTION '1084: nome curto, número ou vazio não podem virar primeiro nome';
  END IF;

  v_viz := public.cb_vizinhos_do_telefone('5511987654321');
  IF NOT ('551198765432' = ANY (v_viz)) THEN
    RAISE EXCEPTION '1084: faltou o vizinho com um dígito a menos';
  END IF;
  IF NOT ('55119876543210' = ANY (v_viz)) THEN
    RAISE EXCEPTION '1084: faltou o vizinho com um dígito a mais';
  END IF;
  IF NOT ('5511987654320' = ANY (v_viz)) THEN
    RAISE EXCEPTION '1084: faltou o vizinho com um dígito trocado';
  END IF;
  IF NOT ('5511897654321' = ANY (v_viz)) THEN
    RAISE EXCEPTION '1084: faltou o vizinho com dois dígitos invertidos';
  END IF;
  IF '5511987654321' = ANY (v_viz) THEN
    RAISE EXCEPTION '1084: o próprio número não pode ser vizinho de si mesmo';
  END IF;
  -- O "9 a mais" digitado: 14 dígitos que, sem o 9 sobrando, são o número certo.
  IF NOT ('5548999801234' = ANY (public.cb_vizinhos_do_telefone('55489999801234'))) THEN
    RAISE EXCEPTION '1084: o 9 a mais não acha o número certo';
  END IF;
  IF cardinality(public.cb_vizinhos_do_telefone('123')) <> 0
     OR cardinality(public.cb_vizinhos_do_telefone(NULL)) <> 0 THEN
    RAISE EXCEPTION '1084: o que não é telefone não tem vizinho';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.cb_duplicatas_descartadas'::regclass
         AND contype = 'f' AND confrelid = 'public.contacts'::regclass
         AND confdeltype = 'c') <> 2 THEN
    RAISE EXCEPTION '1084: as duas FKs para contacts têm de ser ON DELETE CASCADE';
  END IF;

  IF has_table_privilege('anon', 'public.cb_duplicatas_descartadas', 'SELECT') THEN
    RAISE EXCEPTION '1084: anon não pode ler cb_duplicatas_descartadas';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_duplicatas_descartadas', 'INSERT') THEN
    RAISE EXCEPTION '1084: authenticated precisa de INSERT (a RLS decide quem)';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_duplicatas_descartadas', 'UPDATE') THEN
    RAISE EXCEPTION '1084: a decisão não se edita — authenticated sem UPDATE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_duplicatas_descartadas'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1084: a policy de leitura tem de ter a forma da 1032';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_duplicatas_descartadas'
       AND cmd = 'INSERT' AND with_check LIKE '%admin%'
  ) THEN
    RAISE EXCEPTION '1084: decidir é de admin (D1) — a policy de INSERT não diz';
  END IF;

  IF has_function_privilege('anon', 'public.cb_possiveis_duplicatas(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1084: anon não pode chamar cb_possiveis_duplicatas';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cb_possiveis_duplicatas(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_primeiro_nome(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_vizinhos_do_telefone(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1084: authenticated precisa chamar a RPC e as duas auxiliares (INVOKER)';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.cb_possiveis_duplicatas(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '1084: a RPC tem de ser SECURITY INVOKER — a RLS de contacts é a cerca';
  END IF;
END $$;

-- A RPC roda de verdade sobre uma ficha, quando há ficha. Num banco vazio (o
-- replay do CI) não há o que perguntar.
DO $$
DECLARE
  v_id uuid;
  v_n integer;
BEGIN
  SELECT id INTO v_id FROM public.contacts ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE '1084: banco sem fichas, nada a perguntar.';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM public.cb_possiveis_duplicatas(v_id);
  RAISE NOTICE '1084: a RPC respondeu sobre a ficha mais nova: % candidata(s).', v_n;
END $$;
