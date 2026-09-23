-- ============================================================
-- 1040_cb_origem_api_e_aviso_duravel_do_funil
--
-- Duas mudanças na fila do funil (`cb_automation_events`, 0933/0934), que é
-- a fonte dos avisos `deal.*` dos webhooks de saída. Uma migration só porque
-- as duas mexem na MESMA tabela e no MESMO caminho de entrega.
--
-- ⚠️⚠️ ORDEM DE DEPLOY: ESTA MIGRATION VAI PARA A PRODUÇÃO ANTES DO MERGE.
-- O app novo passa a escrever `webhooks_pendente_desde` NA REIVINDICAÇÃO da
-- fila (`drain-events.ts`). Sem a coluna, o PostgREST recusa aquele UPDATE,
-- toda linha cai em "reivindicação falhou" e as AUTOMAÇÕES DE FUNIL PARAM —
-- não só os avisos. O app antigo convive com ela: não escreve a coluna nova
-- (fica NULL, "nada a reentregar") e não manda o cabeçalho `x-cb-origem`.
--
-- ⚠️⚠️ E, ENTRE APLICAR E MESCLAR, MEDIR A ORIGEM `api` (escrita em produção,
-- com autorização do operador). A conferência abaixo põe `request.headers` À
-- MÃO: ela prova o gatilho, não que o gateway da Supabase repasse o
-- cabeçalho e o PostgREST o publique — isso é premissa DOCUMENTADA, não
-- medida. O passo: mover pelo PostgREST da produção, com a service role e o
-- cabeçalho `x-cb-origem: api` (o que o cliente das rotas v1 manda), o card
-- do lead de teste autorizado entre duas etapas SEM automação; conferir
-- `origem = 'api'` na linha nova de `cb_automation_events`; devolver a
-- etapa. Sem `api` ali, NÃO mesclar: a queda não é inofensiva — o movimento
-- pela API sairia `system`, e a receita da doc (`source != api`) deixaria de
-- cortar o laço do fluxo que move o card pela API.
--
-- ------------------------------------------------------------
-- (1) ORIGEM `api`
--
-- O plano dos webhooks de negócio prometia quatro origens: pessoa, conexão,
-- automação e API. O gatilho da 0934 produzia `usuario`, `conexao`,
-- `automacao` (só o INSERT com `source = 'automation'`, o passo "Criar
-- negócio") e `sistema` para todo o resto — e o resto misturava a API
-- pública (`POST`/`PATCH /api/v1/deals`) com os passos "Mover card" e
-- "Marcar status" das automações. O integrador não conseguia separar "eu
-- mesmo movi pela API" (o que ele filtra para não entrar em laço) de "uma
-- automação moveu" (o evento que ele quer: Calendly → "Reunião Agendada").
-- A justificativa escrita ("o banco não separa os dois") não se sustentava:
-- `cb_atualizar_negocio` (0934/1031) SEMPRE carimba `cb.cadeia` antes do
-- UPDATE, e é a única escritora dessa variável.
--
-- O CASE passa a ser, NESTA ordem:
--   1. `auth.uid()`                         → usuario
--   2. `cb.cadeia` definida (não vazia)     → automacao  ("Mover"/"Marcar")
--   3. INSERT com `source = 'channel'`      → conexao
--   4. INSERT com `source = 'automation'`   → automacao  ("Criar negócio")
--   5. cabeçalho `x-cb-origem: api`         → api
--   6. senão                                → sistema    (SQL à mão, carga…)
-- O cabeçalho vem DEPOIS de cadeia e source de propósito: o que uma
-- automação faz continua sendo automação mesmo quando um pedido da API a
-- disparou. Quem manda o cabeçalho é o cliente PRÓPRIO das rotas v1
-- (`src/lib/api/v1/cliente-da-api.ts`); o PostgREST publica os cabeçalhos
-- do pedido na GUC `request.headers` (JSON, nomes em minúsculas).
--
-- ⚠️ O `nullif` de `cb.cadeia` cobre o `''` que a sessão do pool guarda
-- depois de um `set_config` LOCAL — sem ele, toda escrita que caísse numa
-- conexão já usada pela RPC sairia `automacao`.
-- ⚠️ A leitura do cabeçalho mora num bloco PRÓPRIO com EXCEPTION, fora do
-- bloco que protege os INSERTs: `request.headers` malformado, com o
-- `::jsonb` fora de um bloco protegido, abortaria TODA escrita em `deals`
-- (arrastar, formulário, roteador). O bloco só lê — não grava nada, então
-- não consome xid de subtransação (a nota do estouro de subxids da 1014 é
-- sobre bloco que ESCREVE).
-- ⚠️ O CHECK é trocado ANTES da função. O gatilho engole erro com WARNING
-- (0933/0934): com a origem nova recusada pelo CHECK, o evento se perderia
-- calado e as automações de funil parariam de disparar.
--
-- ------------------------------------------------------------
-- (2) AVISO DURÁVEL
--
-- Até aqui a reivindicação gravava só `processado_em`, e a entrega do aviso
-- `deal.*` rodava num `after()` depois da resposta. Processo que morria no
-- meio (SIGKILL do rollout depois dos 10 s de graça, queda, OOM) perdia os
-- avisos já reivindicados SEM RASTRO; falha ao ler os endpoints ou o
-- catálogo também descartava o lote, só com log.
--
-- `webhooks_pendente_desde` é gravada NA MESMA escrita da reivindicação (um
-- carimbo por ciclo), RENOVADA por compare-and-swap logo antes de entregar
-- cada conta (o ciclo do dreno pode passar do prazo da reentrega) e limpa,
-- com cerca de posse (`= carimbo renovado`), depois de cada entrega — com
-- sucesso OU falha HTTP: continua sendo UMA tentativa por endpoint. O cron
-- reentrega, com o MESMO id, o que ficou pendente além do prazo
-- (`reentregar-eventos-de-funil.ts`), por compare-and-swap no carimbo
-- e com teto de tentativas em `webhooks_tentativas` — coluna PRÓPRIA:
-- `tentativas` e `erro` são do motor de automações.
--
-- ⚠️ SEM BACKFILL, de propósito: o NULL do acervo é o que impede reenviar
-- 30 dias de histórico ao integrador. Só o que for reivindicado depois do
-- deploy entra no mecanismo.
--
-- Aditiva e idempotente. Sem GRANT novo: a 0933 já fecha a tabela a
-- `anon`/`authenticated` e concede ao `service_role`.
-- ============================================================

-- `cb_automation_events` é escrita pelo gatilho de `deals`: sem teto de
-- espera, uma transação longa enfileiraria o arrastar do card atrás do ALTER.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) O CHECK da origem aceita `api` — ANTES da função (ver o cabeçalho)
--
-- A restrição nasceu inline na 0933 (`origem text NOT NULL CHECK (...)`),
-- com nome gerado. Localizada pela FORMA (CHECK sobre a coluna `origem`),
-- nunca pelo nome.
-- ------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.cb_automation_events'::regclass
      AND c.contype = 'c'
      AND c.conkey = ARRAY[(
        SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = 'public.cb_automation_events'::regclass
          AND a.attname = 'origem'
      )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.cb_automation_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.cb_automation_events
  ADD CONSTRAINT cb_automation_events_origem_check
  CHECK (origem IN ('usuario', 'conexao', 'automacao', 'api', 'sistema'));

-- ------------------------------------------------------------
-- 2) O aviso pendente
-- ------------------------------------------------------------

ALTER TABLE public.cb_automation_events
  ADD COLUMN IF NOT EXISTS webhooks_pendente_desde timestamptz,
  ADD COLUMN IF NOT EXISTS webhooks_tentativas integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cb_automation_events.webhooks_pendente_desde IS
  'Aviso deal.* reivindicado e ainda nao entregue: o carimbo da posse vigente '
  '(gravado na reivindicacao, renovado logo antes da entrega; a cerca da '
  'limpeza). NULL = nada a entregar. Sem backfill: o acervo anterior a 1040 '
  'nunca e reenviado.';
COMMENT ON COLUMN public.cb_automation_events.webhooks_tentativas IS
  'Reentregas do aviso deal.* feitas pelo cron. Proprio dos webhooks: '
  '`tentativas` e `erro` sao do motor de automacoes. No teto, a linha fica '
  'com webhooks_pendente_desde preenchido como registro do aviso nao entregue.';

-- Parcial: a pergunta do cron é sempre "quem está pendente?", e o acervo
-- entregue (quase tudo) não precisa entrar no índice.
CREATE INDEX IF NOT EXISTS cb_automation_events_webhooks_pendentes_idx
  ON public.cb_automation_events (webhooks_pendente_desde)
  WHERE webhooks_pendente_desde IS NOT NULL;

-- ------------------------------------------------------------
-- 3) O gatilho — cópia fiel da 0934, trocando só a ORIGEM
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cb_enfileira_evento_de_funil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_origem   text;
  v_canal    uuid;
  v_cadeia   jsonb;
  v_pedido   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- `UPDATE OF` dispara quando a coluna é MENCIONADA, mesmo sem mudar de
    -- valor, e o formulário manda as três em todo save.
    IF NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
       AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
       AND NEW.status   IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  -- O cabeçalho `x-cb-origem` do pedido do PostgREST (o cliente das rotas
  -- v1 o manda). Bloco PRÓPRIO: um `request.headers` malformado não pode
  -- derrubar a escrita em `deals` — vira "sem marca" e a origem cai adiante.
  BEGIN
    v_pedido := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-cb-origem';
  EXCEPTION WHEN OTHERS THEN
    v_pedido := NULL;
  END;

  -- ⚠️ A ORDEM é o contrato (ver o cabeçalho da 1040): cadeia e source vêm
  -- antes do cabeçalho — o que uma automação faz continua automação mesmo
  -- dentro de um pedido da API.
  v_origem := CASE
    WHEN v_actor IS NOT NULL THEN 'usuario'
    WHEN nullif(current_setting('cb.cadeia', true), '') IS NOT NULL THEN 'automacao'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'channel'    THEN 'conexao'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'automation' THEN 'automacao'
    WHEN v_pedido = 'api' THEN 'api'
    ELSE 'sistema'
  END;

  -- A cadeia da transação, se houver. `current_setting(..., true)` devolve
  -- NULL quando a variável nunca foi definida — que é o caso de toda escrita
  -- que não veio de `cb_atualizar_negocio`. O `nullif` cobre a string vazia,
  -- que `''::jsonb` recusaria com erro.
  v_cadeia := coalesce(
    nullif(current_setting('cb.cadeia', true), '')::jsonb,
    '[]'::jsonb
  );

  BEGIN
    IF NEW.contact_id IS NOT NULL THEN
      SELECT c.channel_id INTO v_canal
        FROM conversations c
       WHERE c.account_id = NEW.account_id
         AND c.contact_id = NEW.contact_id
         AND c.channel_id IS NOT NULL
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 1;
    END IF;

    IF TG_OP = 'INSERT' THEN
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        to_pipeline_id, to_stage_id, to_status, origem, cadeia
      ) VALUES (
        NEW.account_id, 'deal_stage_changed', NEW.id, NEW.contact_id, v_canal,
        NEW.pipeline_id, NEW.stage_id, NEW.status, v_origem, v_cadeia
      );
      RETURN NEW;
    END IF;

    IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
       OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        from_pipeline_id, to_pipeline_id, from_stage_id, to_stage_id,
        origem, cadeia
      ) VALUES (
        NEW.account_id, 'deal_stage_changed', NEW.id, NEW.contact_id, v_canal,
        OLD.pipeline_id, NEW.pipeline_id, OLD.stage_id, NEW.stage_id,
        v_origem, v_cadeia
      );
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        to_pipeline_id, to_stage_id, from_status, to_status, origem, cadeia
      ) VALUES (
        NEW.account_id, 'deal_status_changed', NEW.id, NEW.contact_id, v_canal,
        NEW.pipeline_id, NEW.stage_id, OLD.status, NEW.status,
        v_origem, v_cadeia
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Engole SEMPRE: re-levantar faria o arrastar do card falhar na cara do
    -- operador por causa de uma automação.
    RAISE WARNING 'cb_enfileira_evento_de_funil falhou para deal %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- As DUAS metades, como na 0933/0934. Função de gatilho não precisa de
-- EXECUTE para disparar (o privilégio é checado no CREATE TRIGGER).
REVOKE EXECUTE ON FUNCTION public.cb_enfileira_evento_de_funil()
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------

DO $$
DECLARE
  v_def     text;
  v_deal    uuid;
  v_de      uuid;
  v_para    uuid;
  v_vistos  uuid[];
  v_id      uuid;
  v_origem  text;
  v_quantos integer;
BEGIN
  -- a) As colunas e o índice, com o predicado.
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cb_automation_events'
        AND column_name IN ('webhooks_pendente_desde', 'webhooks_tentativas')) <> 2 THEN
    RAISE EXCEPTION '1040: as colunas do aviso pendente não estão em cb_automation_events';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'cb_automation_events_webhooks_pendentes_idx'
      AND indexdef LIKE '%WHERE (webhooks_pendente_desde IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION '1040: o índice parcial dos avisos pendentes não existe (ou perdeu o predicado)';
  END IF;

  -- b) UM CHECK sobre a origem, e ele aceita `api`.
  SELECT count(*) INTO v_quantos
  FROM pg_constraint c
  WHERE c.conrelid = 'public.cb_automation_events'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%origem%';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1040: % CHECK(s) sobre origem (esperado 1)', v_quantos;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.cb_automation_events'::regclass
      AND c.conname = 'cb_automation_events_origem_check'
      AND pg_get_constraintdef(c.oid) LIKE '%''api''%'
  ) THEN
    RAISE EXCEPTION '1040: o CHECK de origem não aceita api';
  END IF;

  -- c) A função é a nova, e continua fechada.
  v_def := pg_get_functiondef('public.cb_enfileira_evento_de_funil()'::regprocedure);
  IF v_def NOT LIKE '%x-cb-origem%' OR v_def NOT LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION '1040: cb_enfileira_evento_de_funil não é a versão da 1040';
  END IF;
  IF has_function_privilege('anon', 'public.cb_enfileira_evento_de_funil()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_enfileira_evento_de_funil()', 'EXECUTE') THEN
    RAISE EXCEPTION '1040: anon/authenticated executam cb_enfileira_evento_de_funil';
  END IF;

  -- d) ⚠️ CHAMAR o gatilho (regra 3 do CLAUDE.md): três movimentos de um
  --    card de verdade, num subbloco que se desfaz por exceção própria.
  --    Card ABERTO numa etapa sem resultado, e destino sem resultado no mesmo
  --    funil — senão o gatilho da 950/1031 mexeria no status e a fila
  --    ganharia eventos que não são os da prova. Banco vazio pula.
  SELECT d.id, d.stage_id, s2.id
    INTO v_deal, v_de, v_para
  FROM deals d
  JOIN pipeline_stages s1 ON s1.id = d.stage_id AND s1.resultado IS NULL
  JOIN LATERAL (
    SELECT s.id FROM pipeline_stages s
    WHERE s.pipeline_id = d.pipeline_id AND s.id <> d.stage_id AND s.resultado IS NULL
    ORDER BY s.position, s.id
    LIMIT 1
  ) s2 ON true
  WHERE d.status = 'open'
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = d.account_id)
  ORDER BY d.id
  LIMIT 1;
  IF v_deal IS NULL THEN
    RAISE NOTICE '1040: banco sem card movível — o gatilho foi conferido pela definição, não chamado.';
    RETURN;
  END IF;

  BEGIN
    -- Sem pessoa logada (senão tudo sairia `usuario`) e sem cadeia herdada.
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('cb.cadeia', '', true);
    v_vistos := ARRAY(SELECT e.id FROM cb_automation_events e WHERE e.deal_id = v_deal);

    -- ⚠️ Cada leitura da fila é uma instrução SEPARADA do UPDATE: dentro da
    -- mesma instrução, a consulta não enxerga a linha que o gatilho gravou.

    -- 1. Cabeçalho da API → `api` (e o CHECK aceita: senão o gatilho engolia
    --    o erro e a fila ficava sem a linha).
    PERFORM set_config('request.headers', '{"x-cb-origem":"api"}', true);
    UPDATE deals SET stage_id = v_para WHERE id = v_deal;
    SELECT e.id, e.origem INTO v_id, v_origem FROM cb_automation_events e
    WHERE e.deal_id = v_deal AND e.tipo = 'deal_stage_changed'
      AND e.from_stage_id = v_de AND e.to_stage_id = v_para
      AND NOT (e.id = ANY (v_vistos));
    IF v_origem IS DISTINCT FROM 'api' THEN
      RAISE EXCEPTION '1040: movimento com o cabeçalho da API saiu %, esperado api', coalesce(v_origem, '(nenhum evento)');
    END IF;
    v_vistos := v_vistos || v_id;

    -- 2. Cadeia da RPC + o MESMO cabeçalho → `automacao` (a ordem do CASE).
    PERFORM set_config('cb.cadeia', '[]', true);
    UPDATE deals SET stage_id = v_de WHERE id = v_deal;
    v_origem := NULL;
    SELECT e.id, e.origem INTO v_id, v_origem FROM cb_automation_events e
    WHERE e.deal_id = v_deal AND e.tipo = 'deal_stage_changed'
      AND e.from_stage_id = v_para AND e.to_stage_id = v_de
      AND NOT (e.id = ANY (v_vistos));
    IF v_origem IS DISTINCT FROM 'automacao' THEN
      RAISE EXCEPTION '1040: movimento com cadeia saiu %, esperado automacao', coalesce(v_origem, '(nenhum evento)');
    END IF;
    v_vistos := v_vistos || v_id;
    PERFORM set_config('cb.cadeia', '', true);

    -- 3. Cabeçalho MALFORMADO: a escrita não falha, e a origem cai em `sistema`.
    PERFORM set_config('request.headers', 'isto nao e json', true);
    UPDATE deals SET stage_id = v_para WHERE id = v_deal;
    v_origem := NULL;
    SELECT e.origem INTO v_origem FROM cb_automation_events e
    WHERE e.deal_id = v_deal AND e.tipo = 'deal_stage_changed'
      AND e.from_stage_id = v_de AND e.to_stage_id = v_para
      AND NOT (e.id = ANY (v_vistos));
    IF v_origem IS DISTINCT FROM 'sistema' THEN
      RAISE EXCEPTION '1040: movimento com cabeçalho malformado saiu %, esperado sistema', coalesce(v_origem, '(nenhum evento)');
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1040', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio. `WHEN OTHERS` engoliria justamente o erro que
    -- a chamada existe para mostrar.
    WHEN SQLSTATE 'P1040' THEN
      RAISE NOTICE '1040: o gatilho EXECUTOU (api, automacao e sistema conferidos num card, desfeito).';
  END;
END $$;
