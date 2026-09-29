-- ============================================================
-- 1070 — O que ESTAR numa etapa diz sobre o contrato do cliente
--
-- Plano: docs/PLANO-integracao-atlas.md, Fase 1. Pedido do operador
-- (29/09/2026): uma faixa bem visível na conversa quando o cliente está
-- RESCINDIDO ou FINALIZADO, para quem atende decidir se segue a conversa. A
-- primeira fonte é o próprio funil (a segunda, o Atlas, vem na Fase 2): o CRM
-- precisa saber QUAL etapa quer dizer "rescindido" e qual quer dizer
-- "finalizado" — no CB, "Cliente Rescindido" e "Cliente Finalizado" do
-- Bancário - Jurídico; noutro escritório, outras.
--
-- O que muda no banco, e só isto:
--   `pipeline_stages.situacao_do_cliente` — 'rescindido' | 'finalizado' | NULO.
--   O operador marca em Gerenciar funil, ao lado do resultado, do degrau e da
--   reunião. NULO = a etapa não diz nada sobre o contrato (o padrão).
--
-- ⚠️ Nada é deduzido pelo NOME da etapa (renomear desligaria a faixa em
-- silêncio, e o CRM é vendido a quem dá outros nomes) e nada é semeado aqui:
-- a marcação é escolha de cada funil, feita na tela. É INDEPENDENTE de
-- `resultado`, `degrau` e `desfecho_da_reuniao`.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo seleciona a coluna ao montar
-- a faixa e a grava em Gerenciar funil — sem ela, o salvamento do diálogo é
-- recusado pelo PostgREST. O app ANTIGO não a lê, e o upsert dele (sem a
-- coluna no corpo) deixa o valor como está.
--
-- Tabela pequena (dezenas de etapas): ADD COLUMN sem DEFAULT é só catálogo,
-- e o ADD CONSTRAINT valida as linhas (todas nulas) na hora. `lock_timeout`
-- para não enfileirar leituras do quadro. Idempotente. Replay em banco
-- vazio: as conferências afirmam FORMA e provam o CHECK sem depender de
-- dado (inserção que estoura e se desfaz, como a 1058).
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS situacao_do_cliente text;

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_situacao_do_cliente_check;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_situacao_do_cliente_check
  CHECK (situacao_do_cliente IS NULL OR situacao_do_cliente IN ('rescindido', 'finalizado'));

COMMENT ON COLUMN public.pipeline_stages.situacao_do_cliente IS
  'O que estar nesta etapa diz sobre o contrato do cliente (1070): rescindido | finalizado | NULO (nada). Lido pela faixa de situação da conversa; independente de resultado, degrau e desfecho_da_reuniao.';

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo    text;
  v_quantos int;
  v_estado  text;
BEGIN
  SELECT data_type INTO v_tipo
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'pipeline_stages'
     AND column_name = 'situacao_do_cliente';
  IF v_tipo IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION '1070: pipeline_stages.situacao_do_cliente ausente ou com tipo % (esperado text).', v_tipo;
  END IF;

  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.pipeline_stages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'situacao_do_cliente';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1070: % CHECK(s) sobre situacao_do_cliente (esperado 1).', v_quantos;
  END IF;

  -- O COMPORTAMENTO, sem dado: uma etapa num funil que não existe. O CHECK é
  -- conferido na linha, antes da FK — 'rescindido' e 'finalizado' passam por
  -- ele e caem na FK (23503); um valor inventado cai no CHECK (23514). Nada
  -- fica gravado.
  BEGIN
    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, situacao_do_cliente)
      VALUES (gen_random_uuid(), 'conferencia_1070', 'rescindido');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1070: o CHECK recusa rescindido.';
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, situacao_do_cliente)
      VALUES (gen_random_uuid(), 'conferencia_1070', 'finalizado');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1070: o CHECK recusa finalizado.';
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, situacao_do_cliente)
      VALUES (gen_random_uuid(), 'conferencia_1070', 'inativo');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1070: o CHECK deixou passar um valor inventado (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1070', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1070' THEN NULL;
  END;
END $$;
