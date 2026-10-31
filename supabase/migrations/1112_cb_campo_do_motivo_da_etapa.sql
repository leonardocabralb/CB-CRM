-- ============================================================
-- 1112 — Qual campo de MOTIVO cada etapa pergunta
--
-- Plano: docs/PLANO-motivos-de-perda.md, Fase 1. Pedido do operador
-- (26/10/2026): registrar por que o lead foi desqualificado ou o negócio foi
-- perdido, num campo personalizado do tipo Lista (a IA já preenche campo).
--
-- O que muda no banco, e só isto:
--   `pipeline_stages.campo_do_motivo_id` — uuid nulo, FK para
--   `custom_fields(id)` com ON DELETE SET NULL. A etapa com campo pergunta o
--   motivo a quem leva o card até ela (Fase 2) e o passo "Mover card de
--   etapa" das automações grava nele (Fase 3). Nula = a etapa não pergunta
--   nada, que é o comportamento de hoje. O operador escolhe em Gerenciar
--   funil.
--
-- ⚠️ Quem decide é a CONFIGURAÇÃO da etapa, não o `resultado`: o operador
-- pode ligar o motivo também numa etapa neutra (a "Não Respondeu" do
-- Trabalhista é degrau perda e etapa neutra). Nada é semeado aqui.
--
-- ⚠️ O campo tem de ser da MESMA CONTA do funil, por gatilho: a tabela de
-- etapas não tem `account_id`, então não há FK composta, e a FK simples só
-- garante "existe um campo com esse id". O gatilho confere só a conta, que
-- nunca muda depois. O TIPO (Lista) não é conferido aqui de propósito: o
-- operador pode trocar o tipo do campo depois, e o upsert de Gerenciar funil
-- regrava todas as etapas a cada "Salvar" — um tipo trocado travaria o
-- salvamento de qualquer outra mudança do funil. Quem LÊ confere o tipo
-- (`src/lib/pipelines/motivo-da-etapa.ts`).
--
-- ⚠️ O upsert dispara o BEFORE INSERT mesmo para a linha que acaba em UPDATE:
-- por isso o gatilho é de INSERT e de UPDATE, e só lê duas linhas por etapa.
-- Roda como QUEM grava (SECURITY INVOKER): pela tela, sob a RLS, um campo de
-- conta alheia nem é encontrado — e é recusado do mesmo jeito.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo manda a coluna no upsert das
-- etapas; sem ela, o PostgREST recusa o upsert inteiro. O app ANTIGO não a
-- conhece, e o upsert dele (sem a coluna no corpo) a deixa como está.
--
-- Apagar o campo zera a coluna (SET NULL): a etapa volta a não perguntar.
-- Tabela pequena (dezenas de etapas): ADD COLUMN nulo é só catálogo.
-- `lock_timeout` para não enfileirar leituras do quadro. Idempotente.
-- Replay em banco vazio: a conferência afirma a FORMA e CHAMA o gatilho sem
-- depender de dado (inserções que estouram e se desfazem, como a 1091).
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS campo_do_motivo_id uuid
    REFERENCES public.custom_fields(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.pipeline_stages.campo_do_motivo_id IS
  'Campo personalizado (Lista) que guarda o MOTIVO de quem entra na etapa (1112): a tela pergunta a quem move o card e a automação grava. Nulo = não pergunta. Mesma conta do funil (gatilho); o tipo é conferido por quem lê.';

CREATE OR REPLACE FUNCTION public.cb_campo_do_motivo_da_mesma_conta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_conta_do_campo uuid;
  v_conta_do_funil uuid;
BEGIN
  IF NEW.campo_do_motivo_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO v_conta_do_campo
    FROM public.custom_fields
   WHERE id = NEW.campo_do_motivo_id;
  SELECT account_id INTO v_conta_do_funil
    FROM public.pipelines
   WHERE id = NEW.pipeline_id;

  -- Campo que não existe (ou que a RLS esconde) também é recusado aqui, com
  -- a mensagem que a tela conhece, antes de a FK dizer outra coisa.
  IF v_conta_do_campo IS NULL OR v_conta_do_campo IS DISTINCT FROM v_conta_do_funil THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'campo_do_motivo_de_outra_conta',
      DETAIL = format('etapa %s, campo %s', NEW.id, NEW.campo_do_motivo_id);
  END IF;

  RETURN NEW;
END $$;

-- Função de gatilho não se chama por RPC; o privilégio é conferido no
-- CREATE TRIGGER, então fechar o EXECUTE não impede o gatilho de disparar.
REVOKE EXECUTE ON FUNCTION public.cb_campo_do_motivo_da_mesma_conta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cb_campo_do_motivo_da_mesma_conta_trg ON public.pipeline_stages;
CREATE TRIGGER cb_campo_do_motivo_da_mesma_conta_trg
  BEFORE INSERT OR UPDATE OF campo_do_motivo_id ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.cb_campo_do_motivo_da_mesma_conta();

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo      text;
  v_nulo      text;
  v_acao      "char";
  v_gatilhos  int;
  v_estado    text;
BEGIN
  SELECT data_type, is_nullable
    INTO v_tipo, v_nulo
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'pipeline_stages'
     AND column_name = 'campo_do_motivo_id';
  IF v_tipo IS DISTINCT FROM 'uuid' OR v_nulo IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '1112: pipeline_stages.campo_do_motivo_id ausente ou com forma errada (tipo %, nullable %).', v_tipo, v_nulo;
  END IF;

  SELECT c.confdeltype INTO v_acao
    FROM pg_constraint c
   WHERE c.conrelid = 'public.pipeline_stages'::regclass
     AND c.contype = 'f'
     AND c.confrelid = 'public.custom_fields'::regclass;
  IF v_acao IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION '1112: a FK de campo_do_motivo_id deveria ser ON DELETE SET NULL (veio %).', v_acao;
  END IF;

  SELECT count(*) INTO v_gatilhos
    FROM pg_trigger
   WHERE tgrelid = 'public.pipeline_stages'::regclass
     AND tgname = 'cb_campo_do_motivo_da_mesma_conta_trg'
     AND NOT tgisinternal;
  IF v_gatilhos <> 1 THEN
    RAISE EXCEPTION '1112: gatilho cb_campo_do_motivo_da_mesma_conta_trg ausente.';
  END IF;

  IF has_function_privilege('anon', 'public.cb_campo_do_motivo_da_mesma_conta()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_campo_do_motivo_da_mesma_conta()', 'EXECUTE') THEN
    RAISE EXCEPTION '1112: o EXECUTE do gatilho ficou aberto a anon/authenticated.';
  END IF;

  -- O COMPORTAMENTO, sem dado (o corpo plpgsql só é analisado quando roda):
  -- uma etapa num funil que não existe. Com um campo que não existe, o
  -- GATILHO recusa (23514) antes da FK; sem campo, ele deixa passar e quem
  -- recusa é a FK do funil (23503). Nada fica gravado.
  BEGIN
    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, campo_do_motivo_id)
      VALUES (gen_random_uuid(), 'conferencia_1112', gen_random_uuid());
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'gatilho';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'gatilho' THEN
      RAISE EXCEPTION '1112: o gatilho deixou passar um campo que não existe (%).', v_estado;
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, campo_do_motivo_id)
      VALUES (gen_random_uuid(), 'conferencia_1112', NULL);
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'gatilho';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'fk' THEN
      RAISE EXCEPTION '1112: etapa sem campo deveria passar pelo gatilho e cair na FK do funil (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1112', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1112' THEN NULL;
  END;
END $$;
