-- ============================================================
-- 1125 — CLIENTE IDEAL POR FUNIL: em quais funis o selo de um perfil vale
-- (docs/PLANO-cliente-ideal.md, D8)
--
-- Pedido do operador (06/11/2026): o perfil "Bancário" só deve marcar quem
-- está no funil "Bancário - Comercial"; no "Bancário - Jurídico" o selo
-- ocupava espaço sem servir para nada.
--
-- O que muda, e só isto:
--   1. `cb_perfis_de_cliente_ideal.funis uuid[]`: NULO = todos os funis (a
--      regra do "escopo vazio = todos" do resto do CRM). Com funis, o contato
--      só conta para o perfil se tiver NEGÓCIO (qualquer situação) num deles;
--      contato sem negócio nenhum fica de fora.
--   2. `cb_clientes_ideais(p_conta, p_contato, p_funil)`: o parâmetro novo
--      `p_funil` é o QUADRO de um funil — só valem os perfis sem funis ou que
--      incluem aquele funil. Assim o card do Jurídico fica sem selo mesmo que o
--      mesmo contato tenha card no Comercial. Nulo (a caixa de entrada, o
--      painel, a tela da regra) = a regra do item 1.
--   `cb_cliente_ideal_do_contato` (o painel) chama a `cb_clientes_ideais` e
--   herda o recorte sem mudar.
--
-- ⚠️ Assinatura nova = DROP + CREATE (um CREATE OR REPLACE deixaria dois
-- overloads, e o PostgREST não escolheria entre eles). O `p_funil` tem
-- DEFAULT: o app de antes desta migration segue chamando com `p_conta` só.
-- Tudo numa transação: não há instante sem a função.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: a coluna nasce nula (todos os funis), e
-- nada muda até alguém marcar um funil na tela.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) A coluna
-- ------------------------------------------------------------
-- Vazio não existe: "nenhum" se grava NULO (todos). Teto e "sem nulo dentro"
-- espelham `TETO_DE_FUNIS` (src/lib/contacts/cliente-ideal.ts, há teste).
ALTER TABLE public.cb_perfis_de_cliente_ideal
  ADD COLUMN IF NOT EXISTS funis uuid[];

ALTER TABLE public.cb_perfis_de_cliente_ideal
  DROP CONSTRAINT IF EXISTS cb_perfis_de_cliente_ideal_funis_ck;
ALTER TABLE public.cb_perfis_de_cliente_ideal
  ADD CONSTRAINT cb_perfis_de_cliente_ideal_funis_ck
  CHECK (funis IS NULL OR (cardinality(funis) BETWEEN 1 AND 50 AND array_position(funis, NULL) IS NULL));

-- ------------------------------------------------------------
-- 2) Quem é cliente ideal, agora com o funil
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cb_clientes_ideais(uuid, uuid);

-- Uma linha por contato que casa com ALGUM perfil ativo e válido da conta.
-- `p_contato` restringe a um contato (o painel); nulo = a conta toda (UMA
-- chamada por carga). `p_funil`: ver o cabeçalho.
CREATE OR REPLACE FUNCTION public.cb_clientes_ideais(
  p_conta uuid,
  p_contato uuid DEFAULT NULL,
  p_funil uuid DEFAULT NULL
)
RETURNS TABLE (contact_id uuid, nivel text, perfil_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH perfis AS (
    SELECT p.id, p.posicao, p.criterios, p.funis
      FROM cb_perfis_de_cliente_ideal p
     WHERE p.account_id = p_conta
       AND p.ativo
       -- No quadro de um funil, só o perfil que vale nele.
       AND (p_funil IS NULL OR p.funis IS NULL OR p_funil = ANY (p.funis))
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
           pf.funis,
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
  -- Perfil com funis: só quem tem negócio num deles (funil apagado não casa
  -- com nada; todos apagados = ninguém, como o campo apagado).
  candidatos AS (
    SELECT c.perfil_id, c.posicao, v.contact_id
      FROM criterios c
      JOIN contact_custom_values v ON v.custom_field_id = c.campo
     WHERE c.ordem = 1
       AND (p_contato IS NULL OR v.contact_id = p_contato)
       AND cb_resposta_normalizada(v.value) = ANY (c.aceitas)
       AND (
         c.funis IS NULL
         OR EXISTS (
           -- `account_id` primeiro: é o índice `idx_deals_contact`.
           SELECT 1 FROM deals d
            WHERE d.account_id = p_conta
              AND d.contact_id = v.contact_id
              AND d.pipeline_id = ANY (c.funis)
         )
       )
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

REVOKE EXECUTE ON FUNCTION public.cb_clientes_ideais(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_clientes_ideais(uuid, uuid, uuid) TO authenticated, service_role;

-- SECURITY INVOKER: a leitura de `deals` é de quem chama (banco vazio).
GRANT SELECT ON TABLE deals TO authenticated, service_role;

-- O PostgREST converte o corpo pelo TIPO dos argumentos que tem em cache.
-- Sem ninguém ouvindo (o replay do CI), é no-op.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3) Conferências — todas válidas num banco VAZIO (nenhuma exige dado)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.cb_clientes_ideais(uuid, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '1125: a cb_clientes_ideais de dois parâmetros ficou de pé (overload ambíguo)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'cb_clientes_ideais') <> 1 THEN
    RAISE EXCEPTION '1125: tem de existir UMA cb_clientes_ideais';
  END IF;
  IF has_function_privilege('anon', 'public.cb_clientes_ideais(uuid, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1125: anon executa a cb_clientes_ideais';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_clientes_ideais(uuid, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1125: service_role sem EXECUTE na cb_clientes_ideais';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_perfis_de_cliente_ideal'::regclass
       AND conname = 'cb_perfis_de_cliente_ideal_funis_ck'
  ) THEN
    RAISE EXCEPTION '1125: falta o CHECK dos funis';
  END IF;
END $$;

-- ⚠️ SECURITY INVOKER: só trocando de papel se prova que `authenticated`
-- chama — com e sem funil, e pelo painel, que chama a de cima por dentro.
DO $$
DECLARE
  v_n integer;
  v_j jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.cb_clientes_ideais(gen_random_uuid());
  IF v_n <> 0 THEN
    RAISE EXCEPTION '1125: conta inexistente devolveu % cliente(s) ideal(is)', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.cb_clientes_ideais(gen_random_uuid(), NULL, gen_random_uuid());
  IF v_n <> 0 THEN
    RAISE EXCEPTION '1125: conta inexistente, com funil, devolveu % cliente(s) ideal(is)', v_n;
  END IF;
  v_j := public.cb_cliente_ideal_do_contato(gen_random_uuid());
  RESET ROLE;
  IF v_j ->> 'nivel' IS NOT NULL THEN
    RAISE EXCEPTION '1125: contato inexistente devolveu %', v_j;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '1125: authenticated não consegue executar as RPCs do cliente ideal: %', SQLERRM;
END $$;
