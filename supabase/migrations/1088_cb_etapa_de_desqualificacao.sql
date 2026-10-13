-- ============================================================
-- 1088 — Quais etapas de PERDA são de DESQUALIFICAÇÃO
--
-- Plano: docs/PLANO-anuncios-meta.md, Fase 4. Pedido do operador
-- (13/10/2026): o "custo por desqualificado" ao lado do custo por
-- qualificado, no Desempenho e na Saúde. As etapas "Desqualificado" já são
-- degrau `perda` (975), junto com "Perdido", "Não Respondeu" e "Contrato
-- sem pasta" — o degrau sozinho não separa o lead DESQUALIFICADO do lead
-- que se perdeu depois.
--
-- O que muda no banco, e só isto:
--   `pipeline_stages.desqualificacao` — boolean, padrão false. O operador
--   marca em Gerenciar funil (a opção "Perda — desqualificação" do seletor
--   de degrau). Cada card que ENTRA numa etapa marcada é um desqualificado.
--
-- ⚠️ Só vale em etapa de degrau `perda`: o CHECK recusa a marca em qualquer
-- outro degrau (e em etapa sem degrau). Desqualificação é um TIPO de perda;
-- marcada noutro degrau, a etapa contaria como avanço no funil e como
-- desqualificação ao mesmo tempo. Trocar o degrau de uma etapa marcada exige
-- desmarcar junto — o seletor da tela faz as duas coisas num gesto só.
--
-- ⚠️ Nada é deduzido pelo NOME da etapa (renomear "Desqualificado"
-- desligaria a conta em silêncio) e nada é semeado aqui: a marca é escolha de
-- cada funil, feita na tela, como a "Faltou" do no-show (1058).
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo grava a coluna no salvamento
-- de Gerenciar funil — sem ela, o PostgREST recusa o upsert inteiro. O app
-- ANTIGO não a lê, e o upsert dele (sem a coluna no corpo) a deixa como
-- está. Nenhuma etapa nasce marcada, então o CHECK não barra o app antigo.
--
-- Tabela pequena (dezenas de etapas): ADD COLUMN com DEFAULT constante é só
-- catálogo, e o ADD CONSTRAINT valida as linhas (todas false) na hora.
-- `lock_timeout` para não enfileirar leituras do quadro. Idempotente.
-- Replay em banco vazio: as conferências afirmam FORMA e provam o CHECK sem
-- depender de dado (inserção que estoura e se desfaz, como a 1058).
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS desqualificacao boolean NOT NULL DEFAULT false;

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_desqualificacao_check;

-- `IS NOT DISTINCT FROM`, nunca `=`: com degrau NULO, `degrau = 'perda'` é
-- NULO, e CHECK que dá NULO PASSA — a marca entraria em etapa sem degrau.
ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_desqualificacao_check
  CHECK (NOT desqualificacao OR degrau IS NOT DISTINCT FROM 'perda');

COMMENT ON COLUMN public.pipeline_stages.desqualificacao IS
  'Etapa de perda que é DESQUALIFICAÇÃO (1088): cada card que entra nela conta no custo por desqualificado do Desempenho e da Saúde. Só vale com degrau perda (CHECK).';

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo    text;
  v_nulo    text;
  v_padrao  text;
  v_quantos int;
  v_estado  text;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO v_tipo, v_nulo, v_padrao
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'pipeline_stages'
     AND column_name = 'desqualificacao';
  IF v_tipo IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION '1088: pipeline_stages.desqualificacao ausente ou com tipo % (esperado boolean).', v_tipo;
  END IF;
  IF v_nulo IS DISTINCT FROM 'NO' OR v_padrao IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '1088: desqualificacao deveria ser NOT NULL DEFAULT false (nullable %, default %).', v_nulo, v_padrao;
  END IF;

  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.pipeline_stages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'desqualificacao';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1088: % CHECK(s) sobre desqualificacao (esperado 1).', v_quantos;
  END IF;

  -- O COMPORTAMENTO, sem dado: uma etapa num funil que não existe. O CHECK é
  -- conferido na linha, antes da FK — marcada em perda passa por ele e cai
  -- na FK (23503); marcada em outro degrau, ou sem degrau, cai no CHECK
  -- (23514). Nada fica gravado.
  BEGIN
    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, degrau, desqualificacao)
      VALUES (gen_random_uuid(), 'conferencia_1088', 'perda', true);
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1088: o CHECK recusa a marca numa etapa de perda.';
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, degrau, desqualificacao)
      VALUES (gen_random_uuid(), 'conferencia_1088', 'mql', true);
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1088: o CHECK deixou passar a marca fora da perda (%).', v_estado;
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, desqualificacao)
      VALUES (gen_random_uuid(), 'conferencia_1088', true);
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1088: o CHECK deixou passar a marca em etapa sem degrau (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1088', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1088' THEN NULL;
  END;
END $$;
