-- ============================================================
-- 1058 — O que ENTRAR numa etapa diz sobre a reunião com o cliente
--
-- Plano: docs/PLANO-reunioes-e-no-show.md, Fase 2. Pedido do operador
-- (27/09/2026): quando um lead marca reunião nova e já tinha faltado — ou já
-- tinha marcado antes e não avançou —, um aviso pequeno na conversa. O CRM
-- precisa saber QUAL etapa quer dizer "faltou" (a "No Show" do Bancário -
-- Comercial) e qual quer dizer "compareceu, mas sem proposta" ("Reunião Sem
-- Proposta"); a proposta e o contrato ele já sabe pelo degrau (975/1054).
--
-- O que muda no banco, e só isto:
--   `pipeline_stages.desfecho_da_reuniao` — 'compareceu' | 'faltou' | NULO.
--   O operador marca em Gerenciar funil, ao lado do resultado e do degrau.
--   NULO = a etapa não diz nada sobre a reunião (o padrão de toda etapa).
--
-- ⚠️ Nada é deduzido pelo NOME da etapa (renomear "No Show" desligaria o
-- aviso em silêncio) e nada é semeado aqui: a marcação é escolha de cada
-- funil, feita na tela. É INDEPENDENTE de `resultado` e de `degrau`: "No
-- Show" é degrau `reuniao` e sem resultado nesta conta.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo seleciona a coluna ao montar
-- o aviso e a grava em Gerenciar funil — sem ela, o salvamento do diálogo é
-- recusado pelo PostgREST. O app ANTIGO não a lê, e o upsert dele (sem a
-- coluna no corpo) deixa o valor como está.
--
-- Tabela pequena (dezenas de etapas): ADD COLUMN sem DEFAULT é só catálogo,
-- e o ADD CONSTRAINT valida as linhas (todas nulas) na hora. `lock_timeout`
-- para não enfileirar leituras do quadro. Idempotente. Replay em banco
-- vazio: as conferências afirmam FORMA e provam o CHECK sem depender de
-- dado (inserção que estoura e se desfaz, como a 1054).
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS desfecho_da_reuniao text;

ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_desfecho_da_reuniao_check;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_desfecho_da_reuniao_check
  CHECK (desfecho_da_reuniao IS NULL OR desfecho_da_reuniao IN ('compareceu', 'faltou'));

COMMENT ON COLUMN public.pipeline_stages.desfecho_da_reuniao IS
  'O que entrar nesta etapa diz sobre a reunião (1058): compareceu | faltou | NULO (nada). Lido pelo aviso de possível no-show da conversa; independente de resultado e degrau.';

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
     AND column_name = 'desfecho_da_reuniao';
  IF v_tipo IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION '1058: pipeline_stages.desfecho_da_reuniao ausente ou com tipo % (esperado text).', v_tipo;
  END IF;

  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.pipeline_stages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'desfecho_da_reuniao';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1058: % CHECK(s) sobre desfecho_da_reuniao (esperado 1).', v_quantos;
  END IF;

  -- O COMPORTAMENTO, sem dado: uma etapa num funil que não existe. O CHECK é
  -- conferido na linha, antes da FK — 'faltou' passa por ele e cai na FK
  -- (23503); um valor inventado cai no CHECK (23514). Nada fica gravado.
  BEGIN
    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, desfecho_da_reuniao)
      VALUES (gen_random_uuid(), 'conferencia_1058', 'faltou');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1058: o CHECK recusa faltou.';
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, desfecho_da_reuniao)
      VALUES (gen_random_uuid(), 'conferencia_1058', 'talvez');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1058: o CHECK deixou passar um valor inventado (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1058', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1058' THEN NULL;
  END;
END $$;
