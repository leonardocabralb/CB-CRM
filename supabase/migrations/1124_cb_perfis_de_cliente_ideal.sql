-- ============================================================
-- 1124 — PERFIS DE CLIENTE IDEAL (ICP): a regra que marca o cliente
-- (docs/PLANO-cliente-ideal.md, Fase 1)
--
-- Pedido do operador (05/11/2026): marcar o cliente ideal na conversa e no
-- card do funil. A regra é DADO da conta, nunca texto no código: o CRM é
-- vendido, e as respostas dos formulários mudam de grafia quando a agência
-- reescreve o formulário. Decisão D6: VÁRIOS perfis com nome por conta
-- (ex.: um do Bancário, outro do Trabalhista).
--
-- O que muda no banco, e só isto:
--   1. `cb_perfis_de_cliente_ideal`: nome, ativo, posição e os critérios,
--      `[{"campo": <uuid de custom_fields>, "respostas": [texto…]}]`. TODOS
--      os critérios casam (E); dentro de cada um, basta UMA resposta (OU).
--   2. `cb_resposta_normalizada(text)`: espaços repetidos viram um, aparar,
--      minúsculas. A comparação é sempre entre normalizadas, dos dois lados.
--   3. Três RPCs SECURITY INVOKER (a RLS de cada tabela decide a conta):
--      `cb_clientes_ideais(p_conta, p_contato)`, o nível de cada contato;
--      `cb_cliente_ideal_do_contato(p_contato)`, o porquê do painel; e
--      `cb_respostas_do_campo(p_campo)`, as respostas gravadas num campo,
--      agrupadas NO BANCO (do navegador, o PostgREST cortaria em 1000).
--
-- NÍVEIS: 'ideal' = todos os critérios casam. 'possivel' (o selo "ICP?",
-- D2) = o PRIMEIRO critério casa, os outros casam ou estão VAZIOS, e ao menos
-- um está vazio. Resposta preenchida que não casa tira de qualquer selo. Um
-- contato que casa com dois perfis fica com o melhor nível e, no empate, com
-- o perfil de menor posição.
--
-- ⚠️ Calculado na LEITURA: nenhum gatilho, nenhuma coluna em `contacts`.
-- Nada entra na Lixeira (1097), na união de fichas (1093) nem na carga; mudar
-- a regra vale na hora. O preço: não se sabe DESDE QUANDO alguém é ICP.
--
-- ⚠️ Critério cujo campo não existe mais na conta INVALIDA o perfil inteiro
-- (ninguém casa por ele): ignorar o critério marcaria gente demais. A tela
-- avisa.
--
-- ⚠️ "Respondeu" NÃO é critério (D5): vira o retrato do painel, contado em
-- `cb_cliente_ideal_do_contato`.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo lê a tabela e as RPCs; o
-- antigo não lê nenhuma.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) Normalização e validação (funções puras)
-- ------------------------------------------------------------
-- Espaço repetido (inclusive tab e quebra de linha) vira um, apara e põe em
-- minúsculas: "Atraso de 3  à 6 meses" e "atraso de 3 à 6 MESES" casam.
CREATE OR REPLACE FUNCTION public.cb_resposta_normalizada(p_texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g')))
$$;

-- A forma dos critérios. plpgsql com IFs aninhados de propósito: numa
-- expressão SQL o Postgres não promete a ordem de um OR, e
-- `jsonb_array_length` de um escalar ESTOURA em vez de responder falso.
-- Espelho de `criteriosValidos` (src/lib/contacts/cliente-ideal.ts), há teste
-- lendo este arquivo.
CREATE OR REPLACE FUNCTION public.cb_criterios_de_cliente_ideal_validos(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_criterio jsonb;
  v_resposta jsonb;
  v_campos text[] := '{}';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p) < 1 OR jsonb_array_length(p) > 10 THEN
    RETURN false;
  END IF;
  FOR v_criterio IN SELECT value FROM jsonb_array_elements(p) LOOP
    IF jsonb_typeof(v_criterio) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(v_criterio -> 'campo') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
    IF (v_criterio ->> 'campo') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN false;
    END IF;
    IF (v_criterio ->> 'campo') = ANY (v_campos) THEN
      RETURN false;  -- o mesmo campo duas vezes no perfil
    END IF;
    v_campos := v_campos || (v_criterio ->> 'campo');
    IF jsonb_typeof(v_criterio -> 'respostas') IS DISTINCT FROM 'array' THEN
      RETURN false;
    END IF;
    IF jsonb_array_length(v_criterio -> 'respostas') < 1
       OR jsonb_array_length(v_criterio -> 'respostas') > 200 THEN
      RETURN false;
    END IF;
    FOR v_resposta IN SELECT value FROM jsonb_array_elements(v_criterio -> 'respostas') LOOP
      IF jsonb_typeof(v_resposta) IS DISTINCT FROM 'string' THEN
        RETURN false;
      END IF;
      IF public.cb_resposta_normalizada(v_resposta #>> '{}') = '' THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;
  RETURN true;
END;
$$;

-- ------------------------------------------------------------
-- 2) Os perfis
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_perfis_de_cliente_ideal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Rótulo curto (o painel diz qual perfil casou). Espelho de
  -- `TETO_DO_NOME_DO_PERFIL` (há teste).
  nome text NOT NULL CHECK (nome = btrim(nome) AND nome <> '' AND char_length(nome) <= 40),
  ativo boolean NOT NULL DEFAULT true,
  -- Desempate entre perfis que casam com o mesmo contato. A tela grava 0..N-1.
  posicao integer NOT NULL DEFAULT 0,
  criterios jsonb NOT NULL
    CONSTRAINT cb_perfis_de_cliente_ideal_criterios_ck
    CHECK (public.cb_criterios_de_cliente_ideal_validos(criterios)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dois perfis "Bancário" seriam indistinguíveis no painel.
CREATE UNIQUE INDEX IF NOT EXISTS cb_perfis_de_cliente_ideal_nome_unico
  ON public.cb_perfis_de_cliente_ideal (account_id, lower(nome));

DROP TRIGGER IF EXISTS cb_perfis_de_cliente_ideal_updated_at ON public.cb_perfis_de_cliente_ideal;
CREATE TRIGGER cb_perfis_de_cliente_ideal_updated_at
  BEFORE UPDATE ON public.cb_perfis_de_cliente_ideal
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cb_perfis_de_cliente_ideal ENABLE ROW LEVEL SECURITY;

-- Ler: qualquer membro (o selo aparece para todos). Forma da 1032.
DROP POLICY IF EXISTS cb_perfis_de_cliente_ideal_select ON public.cb_perfis_de_cliente_ideal;
CREATE POLICY cb_perfis_de_cliente_ideal_select ON public.cb_perfis_de_cliente_ideal FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- Escrever: admin, o piso da seção Campos e etiquetas (`ESCRITA_DA_SECAO.fields`).
DROP POLICY IF EXISTS cb_perfis_de_cliente_ideal_insert ON public.cb_perfis_de_cliente_ideal;
CREATE POLICY cb_perfis_de_cliente_ideal_insert ON public.cb_perfis_de_cliente_ideal FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS cb_perfis_de_cliente_ideal_update ON public.cb_perfis_de_cliente_ideal;
CREATE POLICY cb_perfis_de_cliente_ideal_update ON public.cb_perfis_de_cliente_ideal FOR UPDATE
  USING (is_account_member(account_id, 'admin'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'admin'::account_role_enum));

DROP POLICY IF EXISTS cb_perfis_de_cliente_ideal_delete ON public.cb_perfis_de_cliente_ideal;
CREATE POLICY cb_perfis_de_cliente_ideal_delete ON public.cb_perfis_de_cliente_ideal FOR DELETE
  USING (is_account_member(account_id, 'admin'::account_role_enum));

REVOKE ALL ON public.cb_perfis_de_cliente_ideal FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_perfis_de_cliente_ideal TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_perfis_de_cliente_ideal TO service_role;

-- ------------------------------------------------------------
-- 3) Quem é cliente ideal
-- ------------------------------------------------------------
-- Uma linha por contato que casa com ALGUM perfil ativo e válido da conta.
-- `p_contato` restringe a um contato (o painel); nulo = a conta toda (a lista
-- de conversas e o quadro do funil, UMA chamada por carga).
CREATE OR REPLACE FUNCTION public.cb_clientes_ideais(
  p_conta uuid,
  p_contato uuid DEFAULT NULL
)
RETURNS TABLE (contact_id uuid, nivel text, perfil_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH perfis AS (
    SELECT p.id, p.posicao, p.criterios
      FROM cb_perfis_de_cliente_ideal p
     WHERE p.account_id = p_conta
       AND p.ativo
       -- Campo apagado (ou de outra conta) invalida o perfil inteiro.
       AND NOT EXISTS (
         SELECT 1
           FROM jsonb_array_elements(p.criterios) AS e(v)
          WHERE NOT EXISTS (
            SELECT 1 FROM custom_fields cf
             WHERE cf.id = (e.v ->> 'campo')::uuid
               AND cf.account_id = p.account_id
          )
       )
  ),
  criterios AS (
    SELECT pf.id AS perfil_id,
           pf.posicao,
           e.ordem,
           (e.v ->> 'campo')::uuid AS campo,
           ARRAY(
             SELECT cb_resposta_normalizada(r)
               FROM jsonb_array_elements_text(e.v -> 'respostas') AS r
           ) AS aceitas
      FROM perfis pf
     CROSS JOIN LATERAL jsonb_array_elements(pf.criterios) WITH ORDINALITY AS e(v, ordem)
  ),
  -- Todo nível exige o PRIMEIRO critério casado: só quem casa nele é avaliado.
  candidatos AS (
    SELECT c.perfil_id, c.posicao, v.contact_id
      FROM criterios c
      JOIN contact_custom_values v ON v.custom_field_id = c.campo
     WHERE c.ordem = 1
       AND (p_contato IS NULL OR v.contact_id = p_contato)
       AND cb_resposta_normalizada(v.value) = ANY (c.aceitas)
  ),
  avaliados AS (
    SELECT k.contact_id,
           k.perfil_id,
           k.posicao,
           count(c.campo) AS outros,
           count(*) FILTER (
             WHERE c.campo IS NOT NULL
               AND cb_resposta_normalizada(v.value) = ANY (c.aceitas)
           ) AS casam,
           count(*) FILTER (
             WHERE c.campo IS NOT NULL
               AND cb_resposta_normalizada(v.value) = ''
           ) AS vazios
      FROM candidatos k
      LEFT JOIN criterios c
        ON c.perfil_id = k.perfil_id AND c.ordem > 1
      LEFT JOIN contact_custom_values v
        ON v.contact_id = k.contact_id AND v.custom_field_id = c.campo
     GROUP BY k.contact_id, k.perfil_id, k.posicao
  )
  SELECT DISTINCT ON (a.contact_id)
         a.contact_id,
         CASE WHEN a.casam = a.outros THEN 'ideal' ELSE 'possivel' END AS nivel,
         a.perfil_id
    FROM avaliados a
   WHERE a.casam = a.outros
      OR (a.vazios > 0 AND a.casam + a.vazios = a.outros)
   ORDER BY a.contact_id, (a.casam = a.outros) DESC, a.posicao, a.perfil_id
$$;

-- O porquê do painel: o melhor perfil, cada critério dele (o valor gravado e
-- se casa) e o retrato do contato (D5). `nivel` nulo = não é cliente ideal.
CREATE OR REPLACE FUNCTION public.cb_cliente_ideal_do_contato(p_contato uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ct AS (
    SELECT c.id, c.account_id FROM contacts c WHERE c.id = p_contato
  ),
  melhor AS (
    SELECT ci.nivel, ci.perfil_id
      FROM ct
     CROSS JOIN LATERAL cb_clientes_ideais(ct.account_id, ct.id) AS ci
  ),
  perfil AS (
    SELECT p.id, p.nome, p.criterios
      FROM cb_perfis_de_cliente_ideal p
      JOIN melhor m ON m.perfil_id = p.id
  ),
  detalhe AS (
    SELECT e.ordem,
           cf.id AS campo_id,
           cf.field_name AS campo,
           nullif(btrim(coalesce(v.value, '')), '') AS valor,
           cb_resposta_normalizada(v.value) = ANY (
             ARRAY(
               SELECT cb_resposta_normalizada(r)
                 FROM jsonb_array_elements_text(e.v -> 'respostas') AS r
             )
           ) AS casa
      FROM perfil pf
     CROSS JOIN LATERAL jsonb_array_elements(pf.criterios) WITH ORDINALITY AS e(v, ordem)
      JOIN custom_fields cf ON cf.id = (e.v ->> 'campo')::uuid
      LEFT JOIN contact_custom_values v
        ON v.contact_id = p_contato AND v.custom_field_id = cf.id
  ),
  retrato AS (
    SELECT count(*) FILTER (WHERE m.sender_type = 'customer') AS do_cliente,
           count(*) FILTER (
             WHERE m.sender_type IN ('agent', 'bot') AND NOT coalesce(m.nao_saiu, false)
           ) AS nossas,
           count(*) FILTER (WHERE coalesce(m.nao_saiu, false)) AS nao_sairam
      FROM conversations cv
      JOIN messages m ON m.conversation_id = cv.id
     WHERE cv.contact_id = p_contato
  )
  SELECT jsonb_build_object(
    'nivel', (SELECT nivel FROM melhor),
    'perfil', (SELECT jsonb_build_object('id', id, 'nome', nome) FROM perfil),
    'criterios', coalesce(
      (SELECT jsonb_agg(
                jsonb_build_object('campo_id', campo_id, 'campo', campo, 'valor', valor, 'casa', casa)
                ORDER BY ordem)
         FROM detalhe),
      '[]'::jsonb),
    'retrato', (SELECT jsonb_build_object('do_cliente', do_cliente, 'nossas', nossas, 'nao_sairam', nao_sairam)
                  FROM retrato)
  )
$$;

-- As respostas já gravadas num campo, com quantas fichas cada uma: a tela da
-- regra oferece estas para marcar. Teto de 200 (o mesmo do critério).
CREATE OR REPLACE FUNCTION public.cb_respostas_do_campo(p_campo uuid)
RETURNS TABLE (resposta text, fichas bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT btrim(v.value) AS resposta, count(*) AS fichas
    FROM contact_custom_values v
   WHERE v.custom_field_id = p_campo
     AND btrim(coalesce(v.value, '')) <> ''
   GROUP BY btrim(v.value)
   ORDER BY count(*) DESC, btrim(v.value)
   LIMIT 200
$$;

-- EXECUTE nasce concedido a PUBLIC; o REVOKE de PUBLIC leva o service_role
-- junto, então quem usa ganha de volta, por escrito.
REVOKE EXECUTE ON FUNCTION public.cb_resposta_normalizada(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_resposta_normalizada(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cb_criterios_de_cliente_ideal_validos(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_criterios_de_cliente_ideal_validos(jsonb) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cb_clientes_ideais(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_clientes_ideais(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cb_cliente_ideal_do_contato(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_cliente_ideal_do_contato(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.cb_respostas_do_campo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_respostas_do_campo(uuid) TO authenticated, service_role;

-- SECURITY INVOKER lê com o privilégio de quem chama: o que a conferência
-- abaixo prova trocando de papel, a migration concede (banco vazio).
GRANT SELECT ON TABLE custom_fields, contact_custom_values, contacts, conversations, messages
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) Conferências — todas válidas num banco VAZIO (nenhuma exige dado)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_campo text := '"' || gen_random_uuid()::text || '"';
BEGIN
  IF public.cb_resposta_normalizada(E'  Atraso de 3  à 6\tMESES ') <> 'atraso de 3 à 6 meses' THEN
    RAISE EXCEPTION '1124: cb_resposta_normalizada não normaliza espaço e caixa';
  END IF;

  IF NOT public.cb_criterios_de_cliente_ideal_validos(
       ('[{"campo": ' || v_campo || ', "respostas": ["Maior que 500 mil reais"]}]')::jsonb) THEN
    RAISE EXCEPTION '1124: um critério válido foi recusado';
  END IF;
  IF public.cb_criterios_de_cliente_ideal_validos('[]'::jsonb)
     OR public.cb_criterios_de_cliente_ideal_validos('"x"'::jsonb)
     OR public.cb_criterios_de_cliente_ideal_validos('[{"campo": "nao-e-uuid", "respostas": ["a"]}]'::jsonb)
     OR public.cb_criterios_de_cliente_ideal_validos(('[{"campo": ' || v_campo || ', "respostas": []}]')::jsonb)
     OR public.cb_criterios_de_cliente_ideal_validos(('[{"campo": ' || v_campo || ', "respostas": ["  "]}]')::jsonb)
     OR public.cb_criterios_de_cliente_ideal_validos(('[{"campo": ' || v_campo || ', "respostas": [1]}]')::jsonb)
     OR public.cb_criterios_de_cliente_ideal_validos(('[{"campo": ' || v_campo || ', "respostas": ["a"]},'
                                                     || '{"campo": ' || v_campo || ', "respostas": ["b"]}]')::jsonb) THEN
    RAISE EXCEPTION '1124: um critério inválido foi aceito';
  END IF;

  IF has_table_privilege('anon', 'public.cb_perfis_de_cliente_ideal', 'SELECT') THEN
    RAISE EXCEPTION '1124: anon não pode ler cb_perfis_de_cliente_ideal';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_perfis_de_cliente_ideal', 'INSERT') THEN
    RAISE EXCEPTION '1124: authenticated precisa de INSERT (a RLS decide quem)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_perfis_de_cliente_ideal'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1124: a policy de leitura tem de ter a forma da 1032';
  END IF;

  IF has_function_privilege('anon', 'public.cb_clientes_ideais(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_cliente_ideal_do_contato(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_respostas_do_campo(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1124: anon ainda executa uma RPC do cliente ideal';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_clientes_ideais(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_cliente_ideal_do_contato(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_respostas_do_campo(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1124: service_role sem EXECUTE numa RPC do cliente ideal';
  END IF;
END $$;

-- ⚠️ SECURITY INVOKER checa o privilégio de TUDO que roda dentro como quem
-- chamou, e o bloco acima roda como DONO: trocar de papel é a única prova de
-- que `authenticated` consegue chamar. Conta e contato inexistentes → vazio.
DO $$
DECLARE
  v_n integer;
  v_j jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.cb_clientes_ideais(gen_random_uuid());
  IF v_n <> 0 THEN
    RAISE EXCEPTION '1124: conta inexistente devolveu % cliente(s) ideal(is)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.cb_respostas_do_campo(gen_random_uuid());
  IF v_n <> 0 THEN
    RAISE EXCEPTION '1124: campo inexistente devolveu % resposta(s)', v_n;
  END IF;
  v_j := public.cb_cliente_ideal_do_contato(gen_random_uuid());
  RESET ROLE;
  IF v_j ->> 'nivel' IS NOT NULL OR (v_j -> 'retrato' ->> 'do_cliente')::int <> 0 THEN
    RAISE EXCEPTION '1124: contato inexistente devolveu %', v_j;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '1124: authenticated não consegue executar as RPCs do cliente ideal: %', SQLERRM;
END $$;
