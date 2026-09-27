-- ============================================================
-- 1054 — Degrau `pasta` depois do contrato e o PAINEL de cada funil
--
-- Plano: docs/PLANO-previdenciario.md, Fase 6 (6.2 e 6.3). Decisões do
-- operador em 26/09/2026:
--   · C1 — um degrau NOVO no funil de eficiência, DEPOIS de `contrato`, igual
--     para todos os funis e opcional: "Pasta fechada" no previdenciário,
--     "Processo protocolado" no Trabalhista. Interno: `pasta`.
--   · C2 — cada funil configura o PRÓPRIO painel (Desempenho e Saúde):
--     rótulo livre por degrau, degraus que não se aplicam, cartões de custo
--     que aparecem.
--
-- O que muda no banco, e só isto:
--   1. O CHECK de `pipeline_stages.degrau` ganha 'pasta'.
--   2. `pipelines.painel jsonb NOT NULL DEFAULT '{}'` — a configuração do
--      painel. Quem lê e escreve é o app (`src/lib/funil/painel.ts`, por
--      PARSE); o banco só guarda. Chaves: `rotulos` (degrau → texto),
--      `nao_se_aplica` (degraus), `custos_ocultos` (cartões). Sem CHECK de
--      forma: o parse trata qualquer lixo como o padrão.
--
-- ⚠️ A REGRA de "fechado" NÃO mora aqui: é do TS (`ehFechamento`, em
-- `src/lib/funil/degraus.ts`) — pasta é fechamento, e "alcançou contrato"
-- é ≥ contrato. A RPC `cb_funil_trajetorias` (975) não conhece degrau e não
-- muda.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo seleciona e grava
-- `pipelines.painel` em Gerenciar funil — sem a coluna, o diálogo não abre
-- ("não foi possível carregar") e o salvamento é recusado pelo PostgREST.
-- O app ANTIGO não lê a coluna e aceita o CHECK novo (nenhuma etapa usa
-- 'pasta' até o operador mapear, o que só a tela nova oferece).
--
-- ⚠️ O DROP do CHECK é pela FORMA, e não só pelo nome (a regra da 989 e da
-- 1053): a 975 o criou com o nome `cb_pipeline_stages_degrau_check`, que é o
-- que a produção tem (medido em 26/09/2026), mas um DROP só pelo nome que não
-- casasse deixaria o CHECK velho de pé ao lado do novo — e o velho
-- continuaria recusando 'pasta'.
--
-- Tabelas pequenas (dezenas de etapas, meia dúzia de funis): o ADD
-- CONSTRAINT valida as linhas na hora e o ADD COLUMN com DEFAULT constante é
-- só catálogo. `lock_timeout` para não enfileirar leituras do quadro atrás
-- de uma transação longa. Idempotente. Replay em banco vazio: conferências
-- que afirmam AUSÊNCIA ou provam COMPORTAMENTO sem dado (inserção que
-- estoura e se desfaz).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1. O CHECK do degrau ganha 'pasta'
-- ------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.pipeline_stages'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ 'degrau = ANY \(ARRAY\['
  LOOP
    EXECUTE format('ALTER TABLE public.pipeline_stages DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_degrau_check;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_degrau_check
  CHECK (degrau IS NULL OR degrau IN (
    'lead',
    'mql',
    'reuniao',
    'proposta',
    'contrato',
    'pasta',
    'perda'
  ));

COMMENT ON COLUMN public.pipeline_stages.degrau IS
  'Degrau do funil de eficiência (lead|mql|reuniao|proposta|contrato|pasta) ou perda. NULO = não conta. pasta (1054) = depois do contrato, opcional, e é FECHAMENTO. Independente de resultado. Ver 975 e 1054.';

-- ------------------------------------------------------------
-- 2. A configuração do painel de cada funil
-- ------------------------------------------------------------
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS painel jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.pipelines.painel IS
  'Painel do funil (1054): {"rotulos": {degrau: texto}, "nao_se_aplica": [degrau], "custos_ocultos": [cartão]}. Lido por PARSE em src/lib/funil/painel.ts; {} = o padrão.';

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def      text;
  v_quantos  int;
  v_classe   text;
  v_estado   text;
  v_tipo     text;
  v_nulo     text;
  v_padrao   text;
  v_classes  text[] := ARRAY['lead', 'mql', 'reuniao', 'proposta', 'contrato', 'pasta', 'perda'];
BEGIN
  -- 1. Sobrou UM CHECK sobre `degrau`, com o nome certo e as sete classes
  --    (as seis antigas inclusive: perder uma recusaria o próximo salvamento
  --    de todo funil que a usa).
  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.pipeline_stages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'degrau';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1054: % CHECK(s) sobre pipeline_stages.degrau (esperado 1) — um velho ficou de pé.', v_quantos;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.pipeline_stages'::regclass
     AND conname = 'cb_pipeline_stages_degrau_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1054: cb_pipeline_stages_degrau_check ausente.';
  END IF;
  FOREACH v_classe IN ARRAY v_classes LOOP
    IF position(quote_literal(v_classe) IN v_def) = 0 THEN
      RAISE EXCEPTION '1054: o CHECK não traz %: %', v_classe, v_def;
    END IF;
  END LOOP;

  -- 2. A coluna do painel: jsonb, NOT NULL, com o objeto vazio de padrão.
  SELECT data_type, is_nullable, column_default
    INTO v_tipo, v_nulo, v_padrao
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pipelines' AND column_name = 'painel';
  IF v_tipo IS DISTINCT FROM 'jsonb' OR v_nulo IS DISTINCT FROM 'NO'
     OR v_padrao IS NULL OR position('''{}''' IN v_padrao) = 0 THEN
    RAISE EXCEPTION '1054: pipelines.painel fora da forma (tipo %, nulável %, padrão %).', v_tipo, v_nulo, v_padrao;
  END IF;

  -- 3. O COMPORTAMENTO, sem depender de dado (regra 2 das migrations): uma
  --    etapa num funil que não existe. O CHECK é conferido NA LINHA, antes da
  --    FK (gatilho do fim da instrução) — então 'pasta' passa pelo CHECK e
  --    cai na FK (23503), e uma classe inventada cai no CHECK (23514). Nada é
  --    gravado: as inserções estouram, e o bloco externo se desfaz de
  --    qualquer jeito por uma exceção própria (P1054).
  BEGIN
    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, degrau)
      VALUES (gen_random_uuid(), 'conferencia_1054', 'pasta');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1054: o CHECK ainda recusa pasta.';
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, degrau)
      VALUES (gen_random_uuid(), 'conferencia_1054', 'degrau_que_nao_existe');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1054: o CHECK deixou passar um degrau inventado (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1054', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1054' THEN NULL;
  END;
END $$;
