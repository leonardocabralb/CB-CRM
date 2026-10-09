-- ============================================================
-- 1081 — "Reagendar": o cliente avisou que não vai e pediu nova data
--
-- Plano: docs/PLANO-reagendamento.md. Pedido do operador (09/10/2026): quem
-- AVISA que não vai comparecer e pede para remarcar não é no-show. Uma etapa
-- própria no funil (a marca nova) e um botão "Reagendar" na pauta de
-- reuniões, antes e depois do horário (decisão D1).
--
-- O que muda no banco, e só isto:
--   1. `pipeline_stages.desfecho_da_reuniao` aceita 'reagendar' (além das três
--      de hoje). Escolhida em Gerenciar funil, nunca deduzida pelo nome.
--   2. `cb_reunioes_marcos` aceita o resultado 'reagendar' (sem valor).
--   3. `cb_reunioes_marcos.inicio` — o início da reunião que a tela via ao
--      gravar o marco. ⚠️ É o que deixa o Reagendar valer ANTES do horário:
--      a remarcação pela ficha (03/10) reaproveita a MESMA reunião com um
--      horário novo, e sem saber de qual horário o registro é, o Reagendar do
--      horário antigo resolveria o novo. NULÁVEL: os marcos antigos não o têm.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy. Sem ela, o app novo quebra em TRÊS
-- lugares: a pauta e a agenda do Meu dia (o select de `inicio`) e a aba
-- Reuniões + a faixa de possível no-show de TODA conversa aberta (a rota
-- `/api/cb/agenda/contato` lê os marcos com `inicio`) voltam 500; e TODO
-- botão da pauta, não só o Reagendar, manda `inicio` no upsert — o PostgREST
-- recusa a coluna depois que o card já andou, e "Reunião qualificada", "Com
-- proposta" e "No show" terminam em "registro falhou". O app ANTIGO não lê a
-- coluna, e o upsert dele (sem ela no corpo) a deixa como está.
--
-- Tabelas pequenas (dezenas de etapas, dezenas de marcos): o ADD CONSTRAINT
-- valida as linhas na hora. `lock_timeout` para não enfileirar leituras do
-- quadro. Idempotente. Replay em banco vazio: as conferências afirmam FORMA e
-- provam os CHECKs sem depender de dado (inserção que estoura e se desfaz).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1. A marca 'reagendar' na etapa — sem tirar as três de hoje
-- ------------------------------------------------------------
ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_desfecho_da_reuniao_check;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_desfecho_da_reuniao_check
  CHECK (desfecho_da_reuniao IS NULL OR desfecho_da_reuniao IN ('qualificada', 'compareceu', 'faltou', 'reagendar'));

COMMENT ON COLUMN public.pipeline_stages.desfecho_da_reuniao IS
  'O que entrar nesta etapa diz sobre a reunião (1058/1063/1081): qualificada (antes da reunião) | compareceu | faltou | reagendar (o cliente avisou e pediu nova data; não é falta) | NULO (nada).';

-- ------------------------------------------------------------
-- 2. O resultado 'reagendar' no marco, e o horário do marco
-- ------------------------------------------------------------
ALTER TABLE public.cb_reunioes_marcos
  ADD COLUMN IF NOT EXISTS inicio timestamptz;

COMMENT ON COLUMN public.cb_reunioes_marcos.inicio IS
  'O início da reunião que a tela via ao gravar o marco (1081). O Reagendar gravado antes do horário só vale enquanto a reunião continuar nesse início. NULO nos marcos anteriores à 1081.';

-- ⚠️ `resultado IS NOT NULL` continua necessário: `NULL IN (…)` dá NULL, e
-- CHECK que avalia NULL PASSA.
ALTER TABLE public.cb_reunioes_marcos
  DROP CONSTRAINT IF EXISTS cb_reunioes_marcos_forma_ck;

ALTER TABLE public.cb_reunioes_marcos
  ADD CONSTRAINT cb_reunioes_marcos_forma_ck CHECK (
    (marco = 'qualificada' AND resultado IS NULL AND valor IS NULL)
    OR (marco = 'resultado' AND resultado IS NOT NULL
        AND resultado IN ('proposta', 'sem_proposta', 'no_show', 'reagendar')
        AND (resultado = 'proposta' OR valor IS NULL)
        AND (valor IS NULL OR valor >= 0))
  );

COMMENT ON TABLE public.cb_reunioes_marcos IS
  'Pauta de reuniões (1063/1081): o que a equipe marcou em cada reunião — qualificada e resultado (proposta com valor, sem proposta, reagendar, no show). Quem marcou é carimbado por gatilho.';

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_quantos int;
  v_tipo    text;
  v_nulavel text;
  v_estado  text;
BEGIN
  -- Um CHECK só sobre a marca da etapa, e um só de forma no marco: um nome que
  -- não casasse deixaria o velho de pé, recusando a marca nova.
  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.pipeline_stages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'desfecho_da_reuniao';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1081: % CHECK(s) sobre desfecho_da_reuniao (esperado 1).', v_quantos;
  END IF;

  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.cb_reunioes_marcos'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'sem_proposta';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1081: % CHECK(s) de forma em cb_reunioes_marcos (esperado 1).', v_quantos;
  END IF;

  SELECT data_type, is_nullable INTO v_tipo, v_nulavel
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'cb_reunioes_marcos'
     AND column_name = 'inicio';
  IF v_tipo IS DISTINCT FROM 'timestamp with time zone' OR v_nulavel IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION '1081: cb_reunioes_marcos.inicio ausente ou com forma errada (tipo %, nulável %).', v_tipo, v_nulavel;
  END IF;

  -- A tela grava a coluna nova pelo navegador: o privilégio de tabela da 1063
  -- tem de alcançá-la (em banco novo, inclusive).
  IF NOT has_column_privilege('authenticated', 'public.cb_reunioes_marcos', 'inicio', 'INSERT')
     OR NOT has_column_privilege('authenticated', 'public.cb_reunioes_marcos', 'inicio', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.cb_reunioes_marcos', 'inicio', 'SELECT') THEN
    RAISE EXCEPTION '1081: authenticated sem SELECT/INSERT/UPDATE em cb_reunioes_marcos.inicio.';
  END IF;
  IF has_table_privilege('anon', 'public.cb_reunioes_marcos', 'SELECT') THEN
    RAISE EXCEPTION '1081: anon enxerga cb_reunioes_marcos.';
  END IF;

  -- O COMPORTAMENTO, sem dado: o CHECK é conferido na linha, antes da FK —
  -- o valor aceito passa por ele e cai na FK (23503); o recusado cai no
  -- CHECK (23514). Nada fica gravado.
  BEGIN
    -- A marca nova passa, e as três de antes continuam passando.
    FOR v_tipo IN SELECT unnest(ARRAY['qualificada', 'compareceu', 'faltou', 'reagendar']) LOOP
      BEGIN
        INSERT INTO public.pipeline_stages (pipeline_id, name, desfecho_da_reuniao)
        VALUES (gen_random_uuid(), 'conferencia_1081', v_tipo);
        v_estado := 'gravou';
      EXCEPTION
        WHEN check_violation THEN v_estado := 'check';
        WHEN foreign_key_violation THEN v_estado := 'fk';
      END;
      IF v_estado = 'check' THEN
        RAISE EXCEPTION '1081: o CHECK da etapa recusa %.', v_tipo;
      END IF;
    END LOOP;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, desfecho_da_reuniao)
      VALUES (gen_random_uuid(), 'conferencia_1081', 'talvez');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1081: o CHECK da etapa deixou passar um valor inventado (%).', v_estado;
    END IF;

    -- O marco: 'reagendar' sem valor passa o CHECK (cai na FK da conta).
    BEGIN
      INSERT INTO public.cb_reunioes_marcos (account_id, origem, reuniao_id, marco, resultado, inicio)
      VALUES (gen_random_uuid(), 'calendly', gen_random_uuid(), 'resultado', 'reagendar', now());
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1081: o CHECK do marco recusa reagendar.';
    END IF;

    -- 'reagendar' COM valor não passa: valor é só da proposta.
    BEGIN
      INSERT INTO public.cb_reunioes_marcos (account_id, origem, reuniao_id, marco, resultado, valor)
      VALUES (gen_random_uuid(), 'calendly', gen_random_uuid(), 'resultado', 'reagendar', 10);
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1081: reagendar com valor passou (%).', v_estado;
    END IF;

    -- E um resultado inventado continua recusado.
    BEGIN
      INSERT INTO public.cb_reunioes_marcos (account_id, origem, reuniao_id, marco, resultado)
      VALUES (gen_random_uuid(), 'calendly', gen_random_uuid(), 'resultado', 'talvez');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1081: resultado inventado passou (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1081', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1081' THEN NULL;
  END;
END $$;
