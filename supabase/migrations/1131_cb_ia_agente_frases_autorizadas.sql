-- ============================================================
-- 1131 — "Frases autorizadas": frases EXATAS, escritas pelo escritório, que
-- um agente de IA pode dizer mesmo falando de custo ou de resultado
-- (decisão do operador 50=c de 04/10/2026, confirmada em 09/11/2026; plano
-- em docs/PLANO-agentes-de-ia.md, "Frases autorizadas").
--
-- As regras do sistema (27/09/2026, `regras-do-sistema.ts`) proíbem todo
-- agente de falar de qualquer custo (`sem_preco`) e de citar resultados
-- (`sem_promessa`). O agente do Bancário precisa dizer, por exemplo, que a
-- primeira reunião com o advogado não tem custo, e o resultado que o
-- escritório já obteve em gestão de passivo, com a ressalva de que depende
-- de cada caso e não é garantido. Com a lista preenchida, o pedido DESSE
-- agente ganha uma exceção no fim de `sem_preco` (de `honorarios`, com
-- "Conduz o fechamento", 1128) e de `sem_promessa`, e o bloco das regras
-- termina com a lista. Fora das frases, as regras valem iguais.
--
--   frases_autorizadas  '{}' (o padrão) = as 12 regras de sempre, sem uma
--                       letra a mais. Os agentes que já existem nascem com
--                       '{}': nada muda neles. No máximo 10 frases (o CHECK
--                       abaixo, o mesmo teto de `LIMITES.frasesAutorizadas`);
--                       o tamanho de cada uma (1 a 400 caracteres) e a
--                       repetição são conferidos na rota
--                       (`lerFrasesAutorizadasDoCorpo`).
--
-- ADITIVA: aplicar ANTES do deploy (o app novo lê a coluna em
-- `COLUNAS_DO_AGENTE`; sem ela, toda leitura de agente — turno, tela,
-- Playground — falharia). O app antigo não a lê. A tabela segue com os
-- GRANTs de TABELA da 1048 (SELECT para `authenticated` sob a policy de
-- admin, ALL para `service_role`): a coluna herda. Tabela pequena (uma linha
-- por agente): o ADD CONSTRAINT valida as linhas na hora e o ADD COLUMN com
-- DEFAULT constante é só catálogo. Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_ia_agentes
  ADD COLUMN IF NOT EXISTS frases_autorizadas text[] NOT NULL DEFAULT '{}';

-- O CHECK com NOME: o escrito inline ganharia nome implícito, que um DROP
-- pelo nome não acharia (989).
ALTER TABLE public.cb_ia_agentes
  DROP CONSTRAINT IF EXISTS cb_ia_agentes_frases_autorizadas_teto;
ALTER TABLE public.cb_ia_agentes
  ADD CONSTRAINT cb_ia_agentes_frases_autorizadas_teto CHECK (cardinality(frases_autorizadas) <= 10);

COMMENT ON COLUMN public.cb_ia_agentes.frases_autorizadas IS
  'Frases autorizadas (1131): frases exatas, escritas pelo escritório, que o agente pode dizer mesmo citando custo ou resultado (exceção no fim de sem_preco/honorarios e de sem_promessa; a lista no fim das regras do sistema). {} = as regras de sempre. Até 10.';

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção. Não depende de dado.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo    text;
  v_udt     text;
  v_nula    text;
  v_padrao  text;
  v_def     text;
  v_quantos int;
  v_estado  text;
BEGIN
  -- 1. A coluna: text[], NOT NULL, com a lista vazia de padrão.
  SELECT data_type, udt_name, is_nullable, column_default
    INTO v_tipo, v_udt, v_nula, v_padrao
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'cb_ia_agentes' AND column_name = 'frases_autorizadas';
  IF v_tipo IS DISTINCT FROM 'ARRAY' OR v_udt IS DISTINCT FROM '_text' OR v_nula IS DISTINCT FROM 'NO'
     OR v_padrao IS NULL OR position('''{}''' IN v_padrao) = 0 THEN
    RAISE EXCEPTION '1131: cb_ia_agentes.frases_autorizadas fora da forma (tipo % %, nula %, padrão %)',
      v_tipo, v_udt, v_nula, v_padrao;
  END IF;

  -- 2. UM CHECK sobre a coluna, com o nome e o teto de 10.
  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.cb_ia_agentes'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'frases_autorizadas';
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.cb_ia_agentes'::regclass
     AND conname = 'cb_ia_agentes_frases_autorizadas_teto';
  IF v_quantos <> 1 OR v_def IS NULL OR v_def !~ 'cardinality\(frases_autorizadas\) <= 10' THEN
    RAISE EXCEPTION '1131: o CHECK de frases_autorizadas fora da forma (% CHECK(s): %)', v_quantos, v_def;
  END IF;

  -- 3. O service_role lê e grava a coluna (uma chamada por privilégio: com a
  --    lista 'SELECT, UPDATE', basta UM dos dois); o anon não lê a tabela.
  IF NOT has_column_privilege('service_role', 'public.cb_ia_agentes', 'frases_autorizadas', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.cb_ia_agentes', 'frases_autorizadas', 'UPDATE') THEN
    RAISE EXCEPTION '1131: service_role não lê nem grava cb_ia_agentes.frases_autorizadas';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_agentes', 'SELECT') THEN
    RAISE EXCEPTION '1131: cb_ia_agentes ficou legível para anon';
  END IF;

  -- 4. O COMPORTAMENTO, sem depender de dado (a regra 2 das migrations): um
  --    agente numa conta que não existe. O CHECK é conferido NA LINHA, antes
  --    da FK (gatilho do fim da instrução) — então 10 frases passam pelo
  --    CHECK e caem na FK (23503), e 11 caem no CHECK (23514). Nada é
  --    gravado: as inserções estouram, e o bloco se desfaz de qualquer jeito
  --    por uma exceção própria (P1131) — nunca `WHEN OTHERS`.
  BEGIN
    BEGIN
      INSERT INTO public.cb_ia_agentes (account_id, nome, provedor, modelo, frases_autorizadas)
      VALUES (gen_random_uuid(), 'conferencia_1131', 'gemini', 'm', array_fill('frase'::text, ARRAY[10]));
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'fk' THEN
      RAISE EXCEPTION '1131: 10 frases deviam passar pelo CHECK e cair na FK (%).', v_estado;
    END IF;

    BEGIN
      INSERT INTO public.cb_ia_agentes (account_id, nome, provedor, modelo, frases_autorizadas)
      VALUES (gen_random_uuid(), 'conferencia_1131', 'gemini', 'm', array_fill('frase'::text, ARRAY[11]));
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1131: o CHECK deixou passar 11 frases (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1131', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1131' THEN NULL;
  END;
END
$$;
