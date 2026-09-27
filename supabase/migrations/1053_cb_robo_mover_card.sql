-- ============================================================
-- 1053 — O robô MOVE o card de etapa (nó `move_deal_stage`)
--
-- Pedido do operador (26/09/2026, robô do previdenciário): o robô precisa
-- levar o card do lead de uma etapa a outra no meio da conversa ("Novo lead"
-- → "Pré-qualificação" → "Qualificado (MQL)" ou "Outros benefícios –
-- análise"). Até aqui só a AUTOMAÇÃO movia card (passo `move_deal_stage`);
-- o robô não tinha como.
--
-- O que muda no banco é UMA coisa: o CHECK de `flow_nodes.node_type` ganha
-- `'move_deal_stage'`. A configuração do nó (funil, etapa de destino, etapas
-- de origem permitidas) mora no `config` JSONB, como a de todo nó — quem a
-- confere é o validador (`src/lib/flows/validate.ts`) e a rota de ativação
-- (`referencias-do-robo.ts`). O motor move pela MESMA RPC das automações
-- (`cb_atualizar_negocio`, 1031), então trilha (912), resultado (950) e fila
-- do funil (933) valem sem nada novo aqui.
--
-- ⚠️⚠️ POR QUE O CHECK ANTES DO APP: `PUT /api/flows/[id]` APAGA todos os
-- nós do robô antes de inserir os novos, e sem transação. Com o app novo e o
-- CHECK velho, salvar um robô que tenha o bloco "Mover card" recusaria o
-- INSERT DEPOIS do DELETE — o robô ficaria SEM NENHUM NÓ. Esta migration vai
-- para a produção ANTES do merge.
--
-- ⚠️ `'http_fetch'` FICA na lista: é reservado desde a 010 (o código não tem
-- esse nó) e tirá-lo não compra nada — só faria esta migration recusar um nó
-- que alguém tenha gravado à mão. O teste
-- `tipos-de-no-do-robo-1053.test.ts` compara esta lista com os tipos do
-- código e conhece essa única diferença.
--
-- ⚠️ O DROP é pela FORMA, e não só pelo nome. A 010 escreveu o CHECK INLINE
-- na coluna (nome dado pelo Postgres) e a 016 o recriou com o nome
-- `flow_nodes_node_type_check`, que é o que a produção tem (medido em
-- 26/09/2026). Um DROP só pelo nome que não casasse deixaria o CHECK velho de
-- pé ao lado do novo, e o velho continuaria recusando o nó (a regra da 989).
--
-- Tabela pequena (nenhum robô ativo em produção em 26/09/2026): o ADD
-- CONSTRAINT valida as linhas existentes na hora, sob a trava da tabela.
-- `lock_timeout` para não enfileirar a ingestão atrás de uma transação longa
-- que esteja lendo `flow_nodes`. Idempotente: reaplicada, derruba o CHECK
-- desta própria migration e o recria igual.
-- ============================================================

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.flow_nodes'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ 'node_type = ANY \(ARRAY\['
  LOOP
    EXECUTE format('ALTER TABLE public.flow_nodes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE public.flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'move_deal_stage',
    'handoff',
    'http_fetch',
    'end'
  ));

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def      text;
  v_quantos  int;
  v_tipo     text;
  v_estado   text;
  v_tipos    text[] := ARRAY[
    'start', 'send_buttons', 'send_list', 'send_message', 'send_media',
    'collect_input', 'condition', 'set_tag', 'move_deal_stage', 'handoff',
    'http_fetch', 'end'
  ];
BEGIN
  -- 1. Sobrou UM CHECK sobre `node_type`, com o nome certo.
  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.flow_nodes'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'node_type';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1053: % CHECK(s) sobre flow_nodes.node_type (esperado 1) — um velho ficou de pé.', v_quantos;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.flow_nodes'::regclass
     AND conname = 'flow_nodes_node_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1053: flow_nodes_node_type_check ausente.';
  END IF;

  -- 2. Os doze tipos, os onze antigos inclusive: perder um deles recusaria
  --    todo robô que já usa aquele nó no próximo salvamento.
  FOREACH v_tipo IN ARRAY v_tipos LOOP
    IF position(quote_literal(v_tipo) IN v_def) = 0 THEN
      RAISE EXCEPTION '1053: o CHECK não traz %: %', v_tipo, v_def;
    END IF;
  END LOOP;

  -- 3. O COMPORTAMENTO, sem depender de dado (regra 2 das migrations): um nó
  --    num robô que não existe. O CHECK é conferido NA LINHA, antes da FK
  --    (que é gatilho do fim da instrução) — então o tipo novo passa pelo
  --    CHECK e cai na FK (23503), e um tipo inventado cai no CHECK (23514).
  --    Nada é gravado: as duas inserções estouram, e o bloco externo se
  --    desfaz de qualquer jeito por uma exceção própria (P1053).
  BEGIN
    BEGIN
      INSERT INTO public.flow_nodes (flow_id, node_key, node_type)
      VALUES (gen_random_uuid(), 'conferencia_1053', 'move_deal_stage');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1053: o CHECK ainda recusa move_deal_stage.';
    END IF;

    BEGIN
      INSERT INTO public.flow_nodes (flow_id, node_key, node_type)
      VALUES (gen_random_uuid(), 'conferencia_1053', 'tipo_que_nao_existe');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1053: o CHECK deixou passar um tipo inventado (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1053', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1053' THEN NULL;
  END;
END $$;
