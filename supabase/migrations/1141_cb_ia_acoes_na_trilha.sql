-- ============================================================================
-- 1141 — As AÇÕES da IA viram faixas cinzas no fio (pedido do operador,
-- 12/11/2026; docs/PLANO-acoes-da-ia-na-trilha.md)
-- ============================================================================
-- Cada ação do agente de IA virava uma anotação amarela ("IA · X moveu o card
-- para…", "…etiquetou…", "…preencheu…", "…respondeu e passou a conversa…"),
-- e a conversa ficava poluída. Agora:
--
--  1. A trilha (912) diz QUEM quando foi a IA. Os gatilhos de `deals` e de
--     `contact_tags` leem o cabeçalho do pedido (`x-cb-via: agente` +
--     `x-cb-ref: <agente>`, por `cb_quem_mexeu_na_conversa`, da 1083 — o
--     mesmo caminho da trilha da conversa) e gravam `details.via`, `ref_id` e
--     `ref_nome`: a faixa "Avançou de X para Y" passa a dizer "pelo agente de
--     IA <nome>" em vez de "pelo sistema" (a tela já lê `via`/`ref_nome` de
--     qualquer evento). SÓ a via `agente`: as outras (automação, cliente…)
--     seguem como eram, para não mudar o rótulo de quem não pediu; escrita
--     com sessão nem lê o cabeçalho. Os dois corpos são o da 912 — o vigente
--     na produção, conferido em 12/11/2026 (o do gatilho de negócio lá está
--     sem os comentários) — mais esse acréscimo. Origem (`origin`) não muda.
--  2. `cb_conversation_notes.tipo`: 'anotacao' (o padrão: tudo como antes) ou
--     'acao_da_ia' — o que a IA FEZ e não tem faixa própria na trilha
--     (preencheu campo, criou tarefa, executou automação, marcou reunião). O
--     fio a desenha como faixa cinza; a aba Notas e a ficha de /contatos não a
--     listam. Continua sendo ANOTAÇÃO de propósito: some com a conversa e vai
--     à Lixeira como as outras — na trilha, o valor do campo (dado da
--     cliente, ex. o motivo da pendência) ficaria depois de excluída a ficha.
--     CHECK: só sem autor (nenhuma pessoa escreve ação da IA).
--  3. As anotações de ação que a IA já escreveu (o texto do dicionário pt-BR,
--     autor "IA · <agente>", sem `author_user_id`) passam a 'acao_da_ia' — 23
--     em 12/11/2026, todas do dia em que os agentes do Trabalhista foram
--     ligados. Os avisos que pedem algo da equipe (áudio, teto, resposta
--     retida, ação ou reunião prometida, reunião não marcada, link
--     inventado, entrega incerta, o cliente que precisa de alguém) ficam
--     anotação amarela.
--
-- ADITIVA: aplicar ANTES do deploy (o app novo grava `tipo` e a ficha filtra
-- por ele). O app de hoje convive com ela (não conhece a coluna; o padrão a
-- preenche; a atribuição só aparece com o cabeçalho, que ele não manda).
--
-- Conferência com DADO (P1141): exercita os dois gatilhos com o cabeçalho do
-- agente num subbloco desfeito; banco vazio pula com NOTICE.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) O tipo da anotação
-- ------------------------------------------------------------
ALTER TABLE public.cb_conversation_notes
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'anotacao';

ALTER TABLE public.cb_conversation_notes DROP CONSTRAINT IF EXISTS cb_conversation_notes_tipo_ck;
ALTER TABLE public.cb_conversation_notes
  ADD CONSTRAINT cb_conversation_notes_tipo_ck CHECK (
    tipo IN ('anotacao', 'acao_da_ia')
    AND (tipo = 'anotacao' OR author_user_id IS NULL)
  );

COMMENT ON COLUMN public.cb_conversation_notes.tipo IS
  '1141: anotacao (padrão) ou acao_da_ia — o que o agente de IA fez sem faixa própria na trilha; o fio a desenha como faixa cinza, a aba Notas e a ficha não a listam.';

-- ------------------------------------------------------------
-- 2) As anotações de ação já escritas
-- ------------------------------------------------------------
-- O texto começa pelo nome do agente (o autor é "IA · <nome>"; 'IA · ' tem 5
-- caracteres) e segue o dicionário pt-BR de `IaAgentes.transferencia`.
UPDATE public.cb_conversation_notes n
   SET tipo = 'acao_da_ia'
 WHERE n.tipo = 'anotacao'
   AND n.author_user_id IS NULL
   AND n.autor_nome LIKE 'IA · %'
   AND left(n.texto, length(substr(n.autor_nome, 6))) = substr(n.autor_nome, 6)
   AND (
     substr(n.texto, length(substr(n.autor_nome, 6)) + 2) LIKE ANY (ARRAY[
       'moveu o card para %',
       'etiquetou o contato com %',
       'tirou a etiqueta %',
       'preencheu %',
       'criou a tarefa %',
       'executou a automação %',
       'marcou a reunião para %',
       'passou a conversa para IA · %'
     ])
     OR substr(n.texto, length(substr(n.autor_nome, 6)) + 2)
        = 'respondeu ao cliente e passou a conversa para a equipe.'
   );

-- ------------------------------------------------------------
-- 3) O gatilho de `deals` (912) com a via do agente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_log_deal_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row        deals;
  v_actor      uuid := auth.uid();
  v_origin     text;
  v_contato    text;
  v_canal      text;
  v_de_funil   text;
  v_para_funil text;
  v_de_etapa   text;
  v_de_pos     integer;
  v_para_etapa text;
  v_para_pos   integer;
  v_tipo       text;
  -- 1141: quem agiu, quando foi o agente de IA (o cabeçalho do pedido).
  v_quem       jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  -- Cascata de conta: a própria `accounts` já saiu e `cb_lead_events` está
  -- sendo apagada junto.
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_row.account_id) THEN
    RETURN v_row;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- `UPDATE OF` dispara com a coluna MENCIONADA, mesmo sem mudar.
    IF NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
       AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  v_origin := CASE
    WHEN v_actor IS NOT NULL THEN 'usuario'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'channel' THEN 'conexao'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'automation' THEN 'automacao'
    ELSE 'sistema'
  END;

  SELECT coalesce(nullif(c.name, ''), c.phone) INTO v_contato
    FROM contacts c WHERE c.id = v_row.contact_id;

  BEGIN
    -- 1141: sem sessão, o cabeçalho do servidor diz se foi o agente de IA.
    -- Só a via `agente` vai para a trilha (as outras seguem como eram), com
    -- o NOME do agente desta conta (fora dela, nulo).
    IF v_actor IS NULL THEN
      SELECT CASE WHEN q.via = 'agente' THEN jsonb_strip_nulls(jsonb_build_object(
               'via', 'agente',
               'ref_id', g.id,
               'ref_nome', g.nome
             )) END
        INTO v_quem
        FROM public.cb_quem_mexeu_na_conversa() q
        LEFT JOIN cb_ia_agentes g ON g.id = q.ref AND g.account_id = v_row.account_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
      SELECT ch.label INTO v_canal FROM cb_channels ch WHERE ch.id = NEW.channel_id;
      SELECT p.name INTO v_para_funil FROM pipelines p WHERE p.id = NEW.pipeline_id;
      SELECT s.name, s.position INTO v_para_etapa, v_para_pos
        FROM pipeline_stages s WHERE s.id = NEW.stage_id;

      INSERT INTO cb_lead_events (
        account_id, contact_id, contact_label, deal_id, conversation_id,
        event_type, actor_user_id, actor_label, origin,
        to_pipeline_id, to_pipeline_label,
        to_stage_id, to_stage_label, to_stage_position,
        to_status, channel_id, channel_label, details
      ) VALUES (
        NEW.account_id, NEW.contact_id, v_contato, NEW.id, NEW.conversation_id,
        'deal_created', v_actor, cb_lead_event_actor(NEW.account_id), v_origin,
        NEW.pipeline_id, v_para_funil,
        NEW.stage_id, v_para_etapa, v_para_pos,
        NEW.status, NEW.channel_id, v_canal,
        jsonb_build_object('title', NEW.title, 'source', NEW.source) || coalesce(v_quem, '{}'::jsonb)
      );

    ELSIF TG_OP = 'DELETE' THEN
      SELECT p.name INTO v_de_funil FROM pipelines p WHERE p.id = OLD.pipeline_id;
      SELECT s.name, s.position INTO v_de_etapa, v_de_pos
        FROM pipeline_stages s WHERE s.id = OLD.stage_id;

      INSERT INTO cb_lead_events (
        account_id, contact_id, contact_label, deal_id, conversation_id,
        event_type, actor_user_id, actor_label, origin,
        from_pipeline_id, from_pipeline_label,
        from_stage_id, from_stage_label, from_stage_position,
        from_status, channel_id, details
      ) VALUES (
        OLD.account_id, OLD.contact_id, v_contato, OLD.id, OLD.conversation_id,
        'deal_deleted', v_actor, cb_lead_event_actor(OLD.account_id), v_origin,
        OLD.pipeline_id, v_de_funil,
        OLD.stage_id, v_de_etapa, v_de_pos,
        OLD.status, OLD.channel_id,
        jsonb_build_object('title', OLD.title) || coalesce(v_quem, '{}'::jsonb)
      );

    ELSE
      -- Funil e etapa numa linha SÓ quando o funil muda (o mesmo UPDATE).
      IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
        v_tipo := 'pipeline_changed';
      ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
        v_tipo := 'stage_changed';
      END IF;

      IF v_tipo IS NOT NULL THEN
        SELECT p.name INTO v_de_funil FROM pipelines p WHERE p.id = OLD.pipeline_id;
        SELECT p.name INTO v_para_funil FROM pipelines p WHERE p.id = NEW.pipeline_id;
        SELECT s.name, s.position INTO v_de_etapa, v_de_pos
          FROM pipeline_stages s WHERE s.id = OLD.stage_id;
        SELECT s.name, s.position INTO v_para_etapa, v_para_pos
          FROM pipeline_stages s WHERE s.id = NEW.stage_id;

        INSERT INTO cb_lead_events (
          account_id, contact_id, contact_label, deal_id, conversation_id,
          event_type, actor_user_id, actor_label, origin,
          from_pipeline_id, from_pipeline_label, to_pipeline_id, to_pipeline_label,
          from_stage_id, from_stage_label, from_stage_position,
          to_stage_id, to_stage_label, to_stage_position,
          channel_id, details
        ) VALUES (
          NEW.account_id, NEW.contact_id, v_contato, NEW.id, NEW.conversation_id,
          v_tipo, v_actor, cb_lead_event_actor(NEW.account_id), v_origin,
          OLD.pipeline_id, v_de_funil, NEW.pipeline_id, v_para_funil,
          OLD.stage_id, v_de_etapa, v_de_pos,
          NEW.stage_id, v_para_etapa, v_para_pos,
          NEW.channel_id, v_quem
        );
      END IF;

      -- Status é linha própria.
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        SELECT p.name INTO v_para_funil FROM pipelines p WHERE p.id = NEW.pipeline_id;
        SELECT s.name, s.position INTO v_para_etapa, v_para_pos
          FROM pipeline_stages s WHERE s.id = NEW.stage_id;

        INSERT INTO cb_lead_events (
          account_id, contact_id, contact_label, deal_id, conversation_id,
          event_type, actor_user_id, actor_label, origin,
          from_status, to_status,
          to_pipeline_id, to_pipeline_label,
          to_stage_id, to_stage_label, to_stage_position,
          channel_id, details
        ) VALUES (
          NEW.account_id, NEW.contact_id, v_contato, NEW.id, NEW.conversation_id,
          'status_changed', v_actor, cb_lead_event_actor(NEW.account_id), v_origin,
          OLD.status, NEW.status,
          NEW.pipeline_id, v_para_funil,
          NEW.stage_id, v_para_etapa, v_para_pos,
          NEW.channel_id, v_quem
        );
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- A política de falha da 912: ação humana estoura; escrita do servidor
    -- vira WARNING (a ingestão não pode deixar de abrir card em silêncio).
    IF v_actor IS NOT NULL THEN
      RAISE;
    END IF;
    RAISE WARNING 'cb_lead_events: evento de negocio descartado (%): %',
      SQLSTATE, SQLERRM;
  END;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_log_deal_event() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) O gatilho de `contact_tags` (912) com a via do agente
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_log_contact_tag_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row      contact_tags;
  v_actor    uuid := auth.uid();
  v_conta    uuid;
  v_contato  text;
  v_tag      text;
  v_cor      text;
  -- 1141: quem agiu, quando foi o agente de IA (o cabeçalho do pedido).
  v_quem     jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  SELECT c.account_id, coalesce(nullif(c.name, ''), c.phone)
    INTO v_conta, v_contato
    FROM contacts c WHERE c.id = v_row.contact_id;

  -- O contato já saiu (cascata da exclusão): a exclusão é o evento.
  IF v_conta IS NULL THEN
    RETURN v_row;
  END IF;

  BEGIN
    IF v_actor IS NULL THEN
      SELECT CASE WHEN q.via = 'agente' THEN jsonb_strip_nulls(jsonb_build_object(
               'via', 'agente',
               'ref_id', g.id,
               'ref_nome', g.nome
             )) END
        INTO v_quem
        FROM public.cb_quem_mexeu_na_conversa() q
        LEFT JOIN cb_ia_agentes g ON g.id = q.ref AND g.account_id = v_conta;
    END IF;

    SELECT t.name, t.color INTO v_tag, v_cor FROM tags t WHERE t.id = v_row.tag_id;

    INSERT INTO cb_lead_events (
      account_id, contact_id, contact_label,
      event_type, actor_user_id, actor_label, origin,
      tag_id, tag_label, tag_color, details
    ) VALUES (
      v_conta, v_row.contact_id, v_contato,
      CASE WHEN TG_OP = 'DELETE' THEN 'tag_removed' ELSE 'tag_added' END,
      v_actor, cb_lead_event_actor(v_conta),
      CASE WHEN v_actor IS NOT NULL THEN 'usuario' ELSE 'sistema' END,
      v_row.tag_id, v_tag, v_cor, v_quem
    );
  EXCEPTION WHEN OTHERS THEN
    IF v_actor IS NOT NULL THEN
      RAISE;
    END IF;
    RAISE WARNING 'cb_lead_events: evento de tag descartado (%): %',
      SQLSTATE, SQLERRM;
  END;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_log_contact_tag_event() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5) Conferência (P1141)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_deal      record;
  v_etapa     uuid;
  v_agente    record;
  v_tag       uuid;
  v_evento    jsonb;
  v_evento2   jsonb;
  v_sobrou    integer;
  -- Os eventos que já existiam: na transação todo evento novo tem o MESMO
  -- `created_at` (o `now()` dela), então "o mais recente" sairia ao acaso.
  v_antes     uuid[];
BEGIN
  -- a) A coluna e o CHECK.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_conversation_notes'
       AND column_name = 'tipo' AND is_nullable = 'NO'
       AND column_default LIKE '''anotacao''%'
  ) THEN
    RAISE EXCEPTION '1141: faltou cb_conversation_notes.tipo NOT NULL DEFAULT ''anotacao''';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_conversation_notes'::regclass
       AND conname = 'cb_conversation_notes_tipo_ck'
  ) THEN
    RAISE EXCEPTION '1141: faltou cb_conversation_notes_tipo_ck';
  END IF;

  -- b) Os dois gatilhos leem a via do agente.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.cb_log_deal_event()'::regprocedure) NOT LIKE '%cb_quem_mexeu_na_conversa%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = 'public.cb_log_contact_tag_event()'::regprocedure) NOT LIKE '%cb_quem_mexeu_na_conversa%' THEN
    RAISE EXCEPTION '1141: os gatilhos da trilha não leem a via do agente';
  END IF;
  IF has_function_privilege('anon', 'public.cb_log_deal_event()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_log_contact_tag_event()', 'EXECUTE') THEN
    RAISE EXCEPTION '1141: gatilho da trilha executável por anon/authenticated';
  END IF;

  -- c) Nenhuma anotação de ação da IA ficou como anotação comum.
  SELECT count(*) INTO v_sobrou
    FROM public.cb_conversation_notes n
   WHERE n.tipo = 'anotacao' AND n.author_user_id IS NULL AND n.autor_nome LIKE 'IA · %'
     AND left(n.texto, length(substr(n.autor_nome, 6))) = substr(n.autor_nome, 6)
     AND substr(n.texto, length(substr(n.autor_nome, 6)) + 2) LIKE ANY (ARRAY[
       'moveu o card para %', 'etiquetou o contato com %', 'preencheu %'
     ]);
  IF v_sobrou > 0 THEN
    RAISE EXCEPTION '1141: % anotações de ação da IA continuam comuns', v_sobrou;
  END IF;

  -- d) COM DADO: os dois gatilhos, com o cabeçalho do agente, num subbloco
  -- desfeito. Um card aberto, outra etapa neutra do MESMO funil, um agente
  -- da MESMA conta e uma etiqueta da conta que o contato não tem.
  SELECT d.id, d.account_id, d.contact_id, d.pipeline_id, d.stage_id INTO v_deal
    FROM deals d
   WHERE d.status = 'open' AND d.contact_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM cb_ia_agentes g WHERE g.account_id = d.account_id)
     AND EXISTS (SELECT 1 FROM pipeline_stages s
                  WHERE s.pipeline_id = d.pipeline_id AND s.id <> d.stage_id AND s.resultado IS NULL)
   LIMIT 1;

  IF v_deal.id IS NULL THEN
    RAISE NOTICE '1141: nenhum card aberto com agente na conta — os gatilhos não foram exercitados aqui.';
  ELSE
    SELECT s.id INTO v_etapa FROM pipeline_stages s
     WHERE s.pipeline_id = v_deal.pipeline_id AND s.id <> v_deal.stage_id AND s.resultado IS NULL
     LIMIT 1;
    SELECT g.id, g.nome INTO v_agente FROM cb_ia_agentes g WHERE g.account_id = v_deal.account_id LIMIT 1;
    SELECT t.id INTO v_tag FROM tags t
     WHERE t.account_id = v_deal.account_id
       AND NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = v_deal.contact_id AND ct.tag_id = t.id)
     LIMIT 1;

    BEGIN
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

      -- Sem o cabeçalho do agente: a trilha fica como era (sem via).
      PERFORM set_config('request.headers', '{"x-cb-via":"automacao"}', true);
      SELECT coalesce(array_agg(e.id), '{}') INTO v_antes FROM cb_lead_events e WHERE e.deal_id = v_deal.id;
      UPDATE deals SET stage_id = v_etapa WHERE id = v_deal.id;
      SELECT e.details INTO v_evento FROM cb_lead_events e
       WHERE e.deal_id = v_deal.id AND e.event_type = 'stage_changed' AND NOT (e.id = ANY (v_antes));
      IF NOT FOUND THEN
        RAISE EXCEPTION '1141: o movimento sem o agente não entrou na trilha';
      END IF;
      IF v_evento IS NOT NULL AND v_evento ? 'via' THEN
        RAISE EXCEPTION '1141: a via que não é do agente entrou na trilha: %', v_evento;
      END IF;

      -- Com o cabeçalho do agente: via e nome na trilha.
      PERFORM set_config('request.headers',
        json_build_object('x-cb-via', 'agente', 'x-cb-ref', v_agente.id)::text, true);
      SELECT coalesce(array_agg(e.id), '{}') INTO v_antes FROM cb_lead_events e WHERE e.deal_id = v_deal.id;
      UPDATE deals SET stage_id = v_deal.stage_id WHERE id = v_deal.id;
      SELECT e.details INTO v_evento FROM cb_lead_events e
       WHERE e.deal_id = v_deal.id AND e.event_type = 'stage_changed' AND NOT (e.id = ANY (v_antes));
      IF v_evento IS NULL OR v_evento ->> 'via' IS DISTINCT FROM 'agente'
         OR v_evento ->> 'ref_nome' IS DISTINCT FROM v_agente.nome THEN
        RAISE EXCEPTION '1141: a etapa movida pelo agente saiu sem a via na trilha: %', v_evento;
      END IF;

      IF v_tag IS NULL THEN
        RAISE NOTICE '1141: o contato já tem todas as etiquetas da conta — o gatilho de etiqueta não foi exercitado.';
      ELSE
        SELECT coalesce(array_agg(e.id), '{}') INTO v_antes FROM cb_lead_events e WHERE e.contact_id = v_deal.contact_id;
        INSERT INTO contact_tags (contact_id, tag_id) VALUES (v_deal.contact_id, v_tag);
        SELECT e.details INTO v_evento2 FROM cb_lead_events e
         WHERE e.contact_id = v_deal.contact_id AND e.event_type = 'tag_added' AND NOT (e.id = ANY (v_antes));
        IF v_evento2 IS NULL OR v_evento2 ->> 'via' IS DISTINCT FROM 'agente'
           OR v_evento2 ->> 'ref_nome' IS DISTINCT FROM v_agente.nome THEN
          RAISE EXCEPTION '1141: a etiqueta posta pelo agente saiu sem a via na trilha: %', v_evento2;
        END IF;
      END IF;

      RAISE EXCEPTION USING ERRCODE = 'P1141';
    EXCEPTION WHEN SQLSTATE 'P1141' THEN
      NULL;
    END;
  END IF;

  RAISE NOTICE '1141: tipo da anotação, conversão das ações antigas e a via do agente na trilha conferidos.';
END;
$$;
