-- ============================================================
-- 1083 — Histórico da conversa: quem abriu, encerrou, deixou pendente ou
-- trocou o responsável (plano: `docs/PLANO-historico-da-conversa.md`).
--
-- Pedido do operador (13/10/2026): a conversa de um cliente apareceu
-- encerrada e ninguém sabia quem tinha encerrado — a resposta só saiu dos
-- logs de acesso do Supabase, que guardam poucos dias e não dizem o que
-- mudou. Decisões dele: a linha aparece DENTRO da conversa (como "Avançou de
-- … para …"), a troca de responsável também entra, grupo fica de fora (não
-- tem ficha) e o passado não se reconstrói.
--
-- ⚠️ A TRILHA É A DA 912 (`cb_lead_events`), com dois tipos novos e
-- `deal_id` NULO — nenhum leitor de funil os conta (0975, 1065 e 1078
-- filtram por tipo ou por `deal_id`; idem as telas):
--   • `conversation_status_changed`: `from_status` → `to_status`; na
--     CRIAÇÃO, `from_status` nulo.
--   • `conversation_assigned`: só quando a situação NÃO mudou. Encerrar
--     solta o responsável, reabrir enviando atribui a quem enviou e o robô
--     deixa pendente com alguém: situação e responsável mudando juntos são UM
--     fato, e viram UMA linha de situação, com o responsável em `details`.
--
-- ⚠️⚠️ GATILHO POR INSTRUÇÃO, NÃO POR LINHA.
-- O encerramento em lote (1018–1021) muda centenas de conversas numa
-- instrução. Gatilho por linha com bloco EXCEPTION que GRAVA abre uma
-- subtransação COM xid por linha: o cache de 64 subxids estoura por volta da
-- 32ª, e daí toda leitura concorrente do banco paga SLRU por tupla até o
-- commit (medido na carga da Kommo, cabeçalho da 1014). Com tabela de
-- transição (`REFERENCING … TABLE`) e `FOR EACH STATEMENT`, cada instrução
-- grava a trilha num INSERT … SELECT só, dentro de UM bloco de exceção.
-- O preço, escrito: tabela de transição não aceita `UPDATE OF <colunas>`
-- (o Postgres recusa), então o gatilho de UPDATE roda em TODA instrução
-- sobre `conversations` — a prévia de cada mensagem também. A primeira
-- coisa que ele faz é um EXISTS na tabela de transição, e sem mudança de
-- situação ou de responsável sai sem gravar nada. E tabela de transição não
-- aceita dois eventos no mesmo gatilho: são dois gatilhos, duas funções.
--
-- ⚠️⚠️ QUEM E DE ONDE (`cb_quem_mexeu_na_conversa`, uma vez por instrução):
--   1. a sessão de quem está logado → `usuario`, com o nome congelado. A
--      tela (encerrar, pendente, reabrir, atribuir) cai aqui sem mudar
--      código;
--   2. só com o papel `service_role` (o servidor do CRM), os cabeçalhos que
--      o próprio código manda (`marcarOrigem`,
--      `src/lib/conversations/origem-da-escrita.ts`), lidos de
--      `request.headers` como a 1040 lê o `x-cb-origem`:
--        `x-cb-via`  de onde veio (lista fechada abaixo);
--        `x-cb-ator` a PESSOA por trás da escrita do servidor (o envio pelo
--                    CRM reabre em nome de quem enviou) — vale só se for
--                    membro da conta da conversa;
--        `x-cb-ref`  a automação, o robô ou o agente de IA — o nome é
--                    buscado e congelado na conta da conversa.
--      Sem `x-cb-via`, o `x-cb-origem: api` das rotas v1 vale como `api`;
--   3. senão → `sistema` (SQL à mão, encerramento em lote, carga).
-- ⚠️ Cabeçalho é RÓTULO, não credencial: o navegador também manda
-- cabeçalho, e por isso ele só vale sem sessão e com `service_role`.
-- `origin` fica no vocabulário da 912: cliente/celular/ligação → `conexao`;
-- automação/robô/agente/régua → `automacao`; API, agendamento, webhook →
-- `sistema`. O detalhe fino é `details.via`, que é o que a tela lê.
--
-- ⚠️ POLÍTICA DE FALHA da 912: com sessão de pessoa, o erro da trilha
-- ESTOURA (aparece na tela); escrita do servidor engole com WARNING — a
-- reabertura da conversa do cliente que acabou de escrever vale mais que a
-- linha de auditoria.
--
-- ⚠️ Criação com `created_at` mais de 10 minutos no passado é CARGA DE
-- HISTÓRICO (a 1033 grava a conversa com a data da primeira mensagem): não
-- vira linha. As cargas que gravam `created_at` de agora (Kommo, 1016) geram
-- "criada já encerrada · pelo sistema" — verdade, e aceito.
--
-- Aditiva: o app antigo não manda os cabeçalhos e as linhas saem "pelo
-- sistema" até o deploy. Sem GRANT novo: a trilha continua só-leitura para
-- `authenticated` (912) e quem grava é o gatilho, como dono.
-- ============================================================

-- `cb_lead_events` é gravada pelos gatilhos de `deals` e `contact_tags`, e
-- `conversations` é a tabela mais escrita do CRM: sem teto de espera, uma
-- transação longa enfileiraria o arrastar do card e a mensagem nova atrás
-- do ALTER.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) Os tipos novos — os CHECKs trocam ANTES das funções
--
-- O gatilho engole erro com WARNING no caminho do servidor: com o tipo novo
-- recusado pelo CHECK, a linha se perderia calada.
--
-- O CHECK de `event_type` nasceu inline na 912 (nome gerado): localizado
-- pela FORMA (CHECK sobre a coluna `event_type`), nunca pelo nome, e
-- recriado COM nome. O `cb_lead_events_shape` já nasceu com nome.
-- ------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.cb_lead_events'::regclass
      AND c.contype = 'c'
      AND c.conkey = ARRAY[(
        SELECT a.attnum FROM pg_attribute a
        WHERE a.attrelid = 'public.cb_lead_events'::regclass
          AND a.attname = 'event_type'
      )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.cb_lead_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.cb_lead_events
  ADD CONSTRAINT cb_lead_events_event_type_check CHECK (
    event_type IN (
      'deal_created',
      'stage_changed',
      'pipeline_changed',
      'status_changed',
      'deal_deleted',
      'tag_added',
      'tag_removed',
      'conversation_status_changed',
      'conversation_assigned'
    )
  );

ALTER TABLE public.cb_lead_events DROP CONSTRAINT IF EXISTS cb_lead_events_shape;
ALTER TABLE public.cb_lead_events
  ADD CONSTRAINT cb_lead_events_shape CHECK (
    CASE event_type
      WHEN 'deal_created' THEN deal_id IS NOT NULL AND to_pipeline_id IS NOT NULL
      WHEN 'stage_changed' THEN deal_id IS NOT NULL AND to_stage_id IS NOT NULL
      WHEN 'pipeline_changed' THEN
        deal_id IS NOT NULL
        AND from_pipeline_id IS NOT NULL
        AND to_pipeline_id IS NOT NULL
        AND from_pipeline_id <> to_pipeline_id
      WHEN 'status_changed' THEN deal_id IS NOT NULL AND to_status IS NOT NULL
      WHEN 'deal_deleted' THEN deal_id IS NOT NULL
      -- ⚠️ Sem `contact_id IS NOT NULL`, como na 912: apagar contato faz SET
      -- NULL na coluna (um UPDATE, que revalida o CHECK).
      WHEN 'tag_added' THEN tag_id IS NOT NULL
      WHEN 'tag_removed' THEN tag_id IS NOT NULL
      -- `conversation_id` não tem FK (912): apagar a conversa não o anula, e
      -- a linha continua dizendo de qual conversa era.
      WHEN 'conversation_status_changed' THEN conversation_id IS NOT NULL AND to_status IS NOT NULL
      WHEN 'conversation_assigned' THEN conversation_id IS NOT NULL
      ELSE false
    END
  );

-- ------------------------------------------------------------
-- 2) Quem mexeu — resolvido uma vez por instrução
-- ------------------------------------------------------------
-- `ator_da_sessao` = a pessoa logada (nunca conferida contra cabeçalho);
-- `ator` sem sessão = o `x-cb-ator` do servidor, ainda por conferir contra
-- a conta da conversa (quem faz é a função do gatilho, por linha).
-- ⚠️ Os blocos com EXCEPTION aqui só LEEM: não consomem xid de
-- subtransação (a nota da 1040). E `request.headers` malformado não pode
-- derrubar a escrita na conversa — vira "sem marca".
CREATE OR REPLACE FUNCTION public.cb_quem_mexeu_na_conversa(
  OUT ator uuid,
  OUT ator_da_sessao boolean,
  OUT via text,
  OUT ref uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cabecalhos jsonb;
  v_papel      text;
  v_texto      text;
  c_uuid CONSTANT text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  -- `auth.uid()` lê o JWT como JSON: claims ilegíveis estourariam aqui e
  -- derrubariam a escrita na conversa. Ilegível = sem sessão.
  BEGIN
    ator := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    ator := NULL;
  END;
  ator_da_sessao := ator IS NOT NULL;
  IF ator_da_sessao THEN
    RETURN;
  END IF;

  BEGIN
    v_cabecalhos := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_cabecalhos := NULL;
  END;
  BEGIN
    v_papel := coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      nullif(current_setting('request.jwt.claim.role', true), '')
    );
  EXCEPTION WHEN OTHERS THEN
    v_papel := NULL;
  END;

  -- Só o servidor do CRM (service role) diz quem e de onde.
  IF v_papel IS DISTINCT FROM 'service_role'
     OR jsonb_typeof(v_cabecalhos) IS DISTINCT FROM 'object' THEN
    RETURN;
  END IF;

  v_texto := v_cabecalhos ->> 'x-cb-via';
  IF v_texto IN (
    'cliente', 'celular', 'ligacao', 'envio', 'api',
    'automacao', 'robo', 'agente', 'regua', 'agendamento', 'webhook'
  ) THEN
    via := v_texto;
  ELSIF v_cabecalhos ->> 'x-cb-origem' = 'api' THEN
    via := 'api';
  END IF;

  v_texto := v_cabecalhos ->> 'x-cb-ator';
  IF v_texto ~ c_uuid THEN
    ator := v_texto::uuid;
  END IF;

  v_texto := v_cabecalhos ->> 'x-cb-ref';
  IF v_texto ~ c_uuid THEN
    ref := v_texto::uuid;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_quem_mexeu_na_conversa() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3) A conversa nasceu
-- ------------------------------------------------------------
-- ⚠️ O corpo das duas funções abaixo NÃO cita a função de sessão do
-- Supabase: elas leem `profiles` (só o NOME, para congelar na trilha), e o
-- pino da 1067 cobra conferência de suspensão de quem lê `profiles` pelo
-- chamador. Quem é o chamador vem de `cb_quem_mexeu_na_conversa`.
CREATE OR REPLACE FUNCTION public.cb_log_conversa_criada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM novas n
     WHERE n.group_id IS NULL
       AND n.contact_id IS NOT NULL
       AND coalesce(n.created_at, now()) >= now() - interval '10 minutes'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO q FROM public.cb_quem_mexeu_na_conversa();

  BEGIN
    INSERT INTO cb_lead_events (
      account_id, contact_id, contact_label, conversation_id,
      event_type, actor_user_id, actor_label, origin,
      from_status, to_status, channel_id, channel_label, details
    )
    SELECT
      n.account_id, n.contact_id, coalesce(nullif(c.name, ''), c.phone), n.id,
      'conversation_status_changed',
      quem.user_id, quem.nome,
      CASE
        WHEN quem.user_id IS NOT NULL THEN 'usuario'
        WHEN q.via IN ('cliente', 'celular', 'ligacao') THEN 'conexao'
        WHEN q.via IN ('automacao', 'robo', 'agente', 'regua') THEN 'automacao'
        ELSE 'sistema'
      END,
      NULL, n.status, n.channel_id, ch.label,
      jsonb_strip_nulls(jsonb_build_object(
        'via', q.via,
        'ref_id', ref.id,
        'ref_nome', ref.nome,
        'para_responsavel_id', n.assigned_agent_id,
        'para_responsavel', para.nome
      ))
    FROM novas n
    JOIN accounts a ON a.id = n.account_id
    LEFT JOIN contacts c ON c.id = n.contact_id
    LEFT JOIN cb_channels ch ON ch.id = n.channel_id
    LEFT JOIN LATERAL (
      -- A pessoa da sessão vale sempre (o login existe: é ele que está
      -- escrevendo); a do cabeçalho, só se for membro DESTA conta.
      SELECT q.ator AS user_id, (
               SELECT coalesce(nullif(p.full_name, ''), p.email)
                 FROM profiles p
                WHERE p.user_id = q.ator
                ORDER BY (p.account_id = n.account_id) DESC
                LIMIT 1
             ) AS nome
       WHERE q.ator IS NOT NULL
         AND (q.ator_da_sessao OR EXISTS (
               SELECT 1 FROM profiles p
                WHERE p.user_id = q.ator AND p.account_id = n.account_id))
    ) quem ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(nullif(p.full_name, ''), p.email) AS nome
        FROM profiles p
       WHERE p.user_id = n.assigned_agent_id
       ORDER BY (p.account_id = n.account_id) DESC
       LIMIT 1
    ) para ON true
    LEFT JOIN LATERAL (
      SELECT x.id, x.nome FROM (
        SELECT au.id, au.name AS nome FROM automations au
         WHERE q.via IN ('automacao', 'regua') AND au.id = q.ref AND au.account_id = n.account_id
        UNION ALL
        SELECT f.id, f.name FROM flows f
         WHERE q.via = 'robo' AND f.id = q.ref AND f.account_id = n.account_id
        UNION ALL
        SELECT g.id, g.nome FROM cb_ia_agentes g
         WHERE q.via = 'agente' AND g.id = q.ref AND g.account_id = n.account_id
      ) x
      LIMIT 1
    ) ref ON true
    WHERE n.group_id IS NULL
      AND n.contact_id IS NOT NULL
      AND coalesce(n.created_at, now()) >= now() - interval '10 minutes';
  EXCEPTION WHEN OTHERS THEN
    IF q.ator_da_sessao THEN
      RAISE;
    END IF;
    RAISE WARNING 'cb_lead_events: criação de conversa fora da trilha (%): %', SQLSTATE, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_log_conversa_criada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cb_conversa_criada_na_trilha ON public.conversations;
CREATE TRIGGER cb_conversa_criada_na_trilha
  AFTER INSERT ON public.conversations
  REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.cb_log_conversa_criada();

-- ------------------------------------------------------------
-- 4) A conversa mudou de situação ou de responsável
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_log_conversa_mudou()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  q record;
BEGIN
  -- Quase todo UPDATE em `conversations` é prévia, não lidas ou canal: sai
  -- aqui, sem gravar nada (é só leitura da tabela de transição).
  IF NOT EXISTS (
    SELECT 1 FROM antes o JOIN depois n ON n.id = o.id
     WHERE n.group_id IS NULL
       AND n.contact_id IS NOT NULL
       AND (n.status IS DISTINCT FROM o.status
            OR n.assigned_agent_id IS DISTINCT FROM o.assigned_agent_id)
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO q FROM public.cb_quem_mexeu_na_conversa();

  BEGIN
    INSERT INTO cb_lead_events (
      account_id, contact_id, contact_label, conversation_id,
      event_type, actor_user_id, actor_label, origin,
      from_status, to_status, channel_id, channel_label, details
    )
    SELECT
      n.account_id, n.contact_id, coalesce(nullif(c.name, ''), c.phone), n.id,
      CASE WHEN n.status IS DISTINCT FROM o.status
           THEN 'conversation_status_changed'
           ELSE 'conversation_assigned' END,
      quem.user_id, quem.nome,
      CASE
        WHEN quem.user_id IS NOT NULL THEN 'usuario'
        WHEN q.via IN ('cliente', 'celular', 'ligacao') THEN 'conexao'
        WHEN q.via IN ('automacao', 'robo', 'agente', 'regua') THEN 'automacao'
        ELSE 'sistema'
      END,
      CASE WHEN n.status IS DISTINCT FROM o.status THEN o.status END,
      CASE WHEN n.status IS DISTINCT FROM o.status THEN n.status END,
      n.channel_id, ch.label,
      jsonb_strip_nulls(
        jsonb_build_object(
          'via', q.via,
          'ref_id', ref.id,
          'ref_nome', ref.nome
        )
        -- O responsável só entra quando mudou: na linha de situação ele é o
        -- "(estava com …)" de quem encerrou e o "atribuída a …" do robô.
        || CASE WHEN n.assigned_agent_id IS DISTINCT FROM o.assigned_agent_id THEN
             jsonb_build_object(
               'responsavel_mudou', true,
               'de_responsavel_id', o.assigned_agent_id,
               'de_responsavel', de.nome,
               'para_responsavel_id', n.assigned_agent_id,
               'para_responsavel', para.nome
             )
           ELSE '{}'::jsonb END
      )
    FROM antes o
    JOIN depois n ON n.id = o.id
    JOIN accounts a ON a.id = n.account_id
    LEFT JOIN contacts c ON c.id = n.contact_id
    LEFT JOIN cb_channels ch ON ch.id = n.channel_id
    LEFT JOIN LATERAL (
      SELECT q.ator AS user_id, (
               SELECT coalesce(nullif(p.full_name, ''), p.email)
                 FROM profiles p
                WHERE p.user_id = q.ator
                ORDER BY (p.account_id = n.account_id) DESC
                LIMIT 1
             ) AS nome
       WHERE q.ator IS NOT NULL
         AND (q.ator_da_sessao OR EXISTS (
               SELECT 1 FROM profiles p
                WHERE p.user_id = q.ator AND p.account_id = n.account_id))
    ) quem ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(nullif(p.full_name, ''), p.email) AS nome
        FROM profiles p
       WHERE p.user_id = o.assigned_agent_id
       ORDER BY (p.account_id = n.account_id) DESC
       LIMIT 1
    ) de ON true
    LEFT JOIN LATERAL (
      SELECT coalesce(nullif(p.full_name, ''), p.email) AS nome
        FROM profiles p
       WHERE p.user_id = n.assigned_agent_id
       ORDER BY (p.account_id = n.account_id) DESC
       LIMIT 1
    ) para ON true
    LEFT JOIN LATERAL (
      SELECT x.id, x.nome FROM (
        SELECT au.id, au.name AS nome FROM automations au
         WHERE q.via IN ('automacao', 'regua') AND au.id = q.ref AND au.account_id = n.account_id
        UNION ALL
        SELECT f.id, f.name FROM flows f
         WHERE q.via = 'robo' AND f.id = q.ref AND f.account_id = n.account_id
        UNION ALL
        SELECT g.id, g.nome FROM cb_ia_agentes g
         WHERE q.via = 'agente' AND g.id = q.ref AND g.account_id = n.account_id
      ) x
      LIMIT 1
    ) ref ON true
    WHERE n.group_id IS NULL
      AND n.contact_id IS NOT NULL
      AND (n.status IS DISTINCT FROM o.status
           OR n.assigned_agent_id IS DISTINCT FROM o.assigned_agent_id);
  EXCEPTION WHEN OTHERS THEN
    IF q.ator_da_sessao THEN
      RAISE;
    END IF;
    RAISE WARNING 'cb_lead_events: mudança de conversa fora da trilha (%): %', SQLSTATE, SQLERRM;
  END;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_log_conversa_mudou() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cb_conversa_mudou_na_trilha ON public.conversations;
CREATE TRIGGER cb_conversa_mudou_na_trilha
  AFTER UPDATE ON public.conversations
  REFERENCING OLD TABLE AS antes NEW TABLE AS depois
  FOR EACH STATEMENT EXECUTE FUNCTION public.cb_log_conversa_mudou();

-- ------------------------------------------------------------
-- 5) Conferência
-- ------------------------------------------------------------
-- Definições primeiro (valem no banco vazio do replay). Depois as funções
-- são CHAMADAS de verdade, pelo caminho que a produção usa (UPDATE e INSERT
-- em `conversations`, com o papel e os cabeçalhos do PostgREST postos à
-- mão), num subbloco desfeito pelo SQLSTATE próprio: nada sobra na trilha
-- nem na conversa. A conversa escolhida é a ENCERRADA mexida há mais tempo,
-- para a trava de linha da conferência não esbarrar em atendimento.
DO $$
DECLARE
  v_def       text;
  v_conv      uuid;
  v_conta     uuid;
  v_status    text;
  v_membro    uuid;
  v_dono      uuid;
  v_livre     uuid;
  v_nova      uuid;
  v_antes     bigint;
  v_depois    bigint;
  v_linha     record;
BEGIN
  -- 5.1 Os CHECKs aceitam os tipos novos, e só UM CHECK cuida de event_type.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.cb_lead_events'::regclass
     AND conname = 'cb_lead_events_event_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%conversation_status_changed%'
     OR v_def NOT LIKE '%conversation_assigned%' OR v_def NOT LIKE '%tag_removed%' THEN
    RAISE EXCEPTION '1083: o CHECK de event_type não aceita os tipos novos: %', v_def;
  END IF;
  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid = 'public.cb_lead_events'::regclass AND c.contype = 'c'
         AND c.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                WHERE a.attrelid = 'public.cb_lead_events'::regclass
                                  AND a.attname = 'event_type')]::smallint[]) <> 1 THEN
    RAISE EXCEPTION '1083: sobrou mais de um CHECK sobre event_type';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.cb_lead_events'::regclass AND conname = 'cb_lead_events_shape';
  IF v_def IS NULL OR v_def NOT LIKE '%conversation_status_changed%'
     OR v_def NOT LIKE '%conversation_assigned%' OR v_def NOT LIKE '%deal_deleted%' THEN
    RAISE EXCEPTION '1083: o CHECK de forma não conhece os tipos novos: %', v_def;
  END IF;

  -- 5.2 Os gatilhos são por INSTRUÇÃO (bit 0 de tgtype = por linha) e têm
  -- a tabela de transição.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.conversations'::regclass
       AND t.tgname = 'cb_conversa_criada_na_trilha'
       AND (t.tgtype & 1) = 0 AND t.tgnewtable IS NOT NULL AND t.tgenabled <> 'D'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.conversations'::regclass
       AND t.tgname = 'cb_conversa_mudou_na_trilha'
       AND (t.tgtype & 1) = 0 AND t.tgoldtable IS NOT NULL AND t.tgnewtable IS NOT NULL
       AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION '1083: os gatilhos por instrução de conversations não estão de pé';
  END IF;

  -- 5.3 Ninguém do navegador executa as funções.
  IF has_function_privilege('anon', 'public.cb_quem_mexeu_na_conversa()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_quem_mexeu_na_conversa()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_log_conversa_criada()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_log_conversa_criada()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_log_conversa_mudou()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_log_conversa_mudou()', 'EXECUTE') THEN
    RAISE EXCEPTION '1083: anon/authenticated conseguem executar as funções da trilha da conversa';
  END IF;

  -- 5.4 A prova de verdade.
  SELECT v.id, v.account_id, v.status INTO v_conv, v_conta, v_status
    FROM conversations v
   WHERE v.group_id IS NULL AND v.contact_id IS NOT NULL
   ORDER BY (v.status = 'closed') DESC, v.updated_at ASC NULLS FIRST, v.id
   LIMIT 1;
  IF v_conv IS NULL THEN
    RAISE NOTICE '1083: banco vazio — os gatilhos foram conferidos pela definição, não chamados.';
    RETURN;
  END IF;
  SELECT p.user_id INTO v_membro
    FROM profiles p WHERE p.account_id = v_conta ORDER BY p.user_id LIMIT 1;
  SELECT a.owner_user_id INTO v_dono FROM accounts a WHERE a.id = v_conta;

  BEGIN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

    -- (a) Situação, pela automação: uma linha, origem e via certas.
    PERFORM set_config('request.headers', '{"x-cb-via":"automacao"}', true);
    SELECT count(*) INTO v_antes FROM cb_lead_events WHERE conversation_id = v_conv;
    UPDATE conversations
       SET status = CASE WHEN status = 'closed' THEN 'open' ELSE 'closed' END
     WHERE id = v_conv;
    SELECT count(*) INTO v_depois FROM cb_lead_events WHERE conversation_id = v_conv;
    IF v_depois <> v_antes + 1 THEN
      RAISE EXCEPTION '1083: mudar a situação gravou % linha(s) na trilha (esperado 1)', v_depois - v_antes;
    END IF;
    SELECT * INTO v_linha FROM cb_lead_events
     WHERE conversation_id = v_conv ORDER BY occurred_at DESC, id DESC LIMIT 1;
    IF v_linha.event_type <> 'conversation_status_changed'
       OR v_linha.origin <> 'automacao'
       OR v_linha.details ->> 'via' IS DISTINCT FROM 'automacao'
       OR v_linha.from_status IS DISTINCT FROM v_status
       OR v_linha.to_status IS NOT DISTINCT FROM v_status
       OR v_linha.deal_id IS NOT NULL THEN
      RAISE EXCEPTION '1083: a linha da situação saiu errada: %', row_to_json(v_linha);
    END IF;

    -- (b) UPDATE que não mexe em situação nem responsável não grava nada.
    UPDATE conversations SET updated_at = updated_at WHERE id = v_conv;
    SELECT count(*) INTO v_antes FROM cb_lead_events WHERE conversation_id = v_conv;
    IF v_antes <> v_depois THEN
      RAISE EXCEPTION '1083: UPDATE sem mudança de situação gravou na trilha';
    END IF;

    IF v_membro IS NOT NULL THEN
      -- (c) Responsável, pelo servidor em nome de um membro: vira `usuario`.
      UPDATE conversations SET assigned_agent_id = NULL WHERE id = v_conv;
      PERFORM set_config(
        'request.headers',
        json_build_object('x-cb-via', 'envio', 'x-cb-ator', v_membro)::text,
        true
      );
      SELECT count(*) INTO v_antes FROM cb_lead_events WHERE conversation_id = v_conv;
      UPDATE conversations SET assigned_agent_id = v_membro WHERE id = v_conv;
      SELECT * INTO v_linha FROM cb_lead_events
       WHERE conversation_id = v_conv ORDER BY occurred_at DESC, id DESC LIMIT 1;
      SELECT count(*) INTO v_depois FROM cb_lead_events WHERE conversation_id = v_conv;
      IF v_depois <> v_antes + 1
         OR v_linha.event_type <> 'conversation_assigned'
         OR v_linha.origin <> 'usuario'
         OR v_linha.actor_user_id IS DISTINCT FROM v_membro
         OR v_linha.details ->> 'para_responsavel_id' IS DISTINCT FROM v_membro::text THEN
        RAISE EXCEPTION '1083: a linha da atribuição saiu errada: %', row_to_json(v_linha);
      END IF;

      -- (d) Cabeçalho SEM service role não vale: o ator é ignorado.
      PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
      UPDATE conversations SET assigned_agent_id = NULL WHERE id = v_conv;
      SELECT * INTO v_linha FROM cb_lead_events
       WHERE conversation_id = v_conv ORDER BY occurred_at DESC, id DESC LIMIT 1;
      IF v_linha.actor_user_id IS NOT NULL
         OR v_linha.origin <> 'sistema'
         OR v_linha.details ? 'via' THEN
        RAISE EXCEPTION '1083: cabeçalho sem service role foi aceito: %', row_to_json(v_linha);
      END IF;
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    ELSE
      RAISE NOTICE '1083: conta sem membro — o ramo do responsável foi conferido pela definição.';
    END IF;

    -- (e) Criação: linha com `from_status` nulo; histórica não vira linha.
    SELECT c.id INTO v_livre
      FROM contacts c
     WHERE c.account_id = v_conta
       AND NOT EXISTS (SELECT 1 FROM conversations v WHERE v.contact_id = c.id)
     ORDER BY c.id
     LIMIT 1;
    IF v_livre IS NOT NULL AND v_dono IS NOT NULL THEN
      PERFORM set_config('request.headers', '{"x-cb-via":"webhook"}', true);
      INSERT INTO conversations (account_id, user_id, contact_id, status)
      VALUES (v_conta, v_dono, v_livre, 'closed')
      RETURNING id INTO v_nova;
      SELECT * INTO v_linha FROM cb_lead_events WHERE conversation_id = v_nova;
      IF v_linha.id IS NULL
         OR v_linha.event_type <> 'conversation_status_changed'
         OR v_linha.from_status IS NOT NULL
         OR v_linha.to_status <> 'closed'
         OR v_linha.origin <> 'sistema'
         OR v_linha.details ->> 'via' IS DISTINCT FROM 'webhook' THEN
        RAISE EXCEPTION '1083: a linha da criação saiu errada: %', row_to_json(v_linha);
      END IF;

      DELETE FROM conversations WHERE id = v_nova;
      INSERT INTO conversations (account_id, user_id, contact_id, status, created_at)
      VALUES (v_conta, v_dono, v_livre, 'closed', now() - interval '1 day')
      RETURNING id INTO v_nova;
      IF EXISTS (SELECT 1 FROM cb_lead_events WHERE conversation_id = v_nova) THEN
        RAISE EXCEPTION '1083: conversa de carga histórica (created_at no passado) virou linha';
      END IF;
    ELSE
      RAISE NOTICE '1083: nenhum contato sem conversa — a criação foi conferida pela definição.';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1083', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio: `WHEN OTHERS` engoliria o erro que a
    -- conferência existe para mostrar.
    WHEN SQLSTATE 'P1083' THEN
      RAISE NOTICE '1083: os gatilhos EXECUTARAM (situação, responsável, criação); conferência desfeita.';
  END;
END $$;
