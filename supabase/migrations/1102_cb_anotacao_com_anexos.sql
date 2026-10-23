-- ============================================================
-- 1102 — Anotação interna com anexos (o banco das Fases 1–2)
--
-- docs/PLANO-anotacao-com-anexos-e-edicao.md (decisões D1–D7 e A1–A7 do
-- operador, 22–23/10/2026). A anotação passa a levar anexos (áudio gravado na
-- hora, imagem, vídeo, PDF, Office, texto e HTML), até 10 por anotação, e
-- ganha a coluna da marca "editada" (a EDIÇÃO em si é a Fase 3, outro PR).
--
-- ADITIVA: aplicar ANTES do deploy (a rota nova grava `anexos`; o app antigo
-- continua gravando só texto, que a regra nova aceita). As regras do
-- armazenamento apertam só `notas/`, que está VAZIA até o deploy.
--
-- O QUE MUDA
--   1. `anexos jsonb NOT NULL DEFAULT '[]'` (lista de `{caminho, nome, mime,
--      bytes}`; a URL nasce na tela, nunca é gravada) e `editada_em`.
--      Lista na linha, não tabela filha: o INSERT do tempo real chega com os
--      anexos, `cb_unir_fichas` (1093) move a anotação e os anexos vão junto,
--      e a Lixeira (1097) já fotografa a linha inteira (`to_jsonb`) — e já
--      lê `anexos[].caminho` para a fila (`cb_lixeira_arquivos`, `notas/`).
--   2. Regras: sai o CHECK inline da 918 (`btrim(texto) <> ''`, pela FORMA —
--      o nome é implícito, 989) e entram `..._conteudo_ck` (texto OU pelo
--      menos um anexo) e `..._anexos_ck` (uma LISTA, com no máximo 10). Com
--      CASE, nunca AND: o Postgres não garante a ordem de avaliação, e
--      `jsonb_array_length` estoura em não-lista.
--   3. O gatilho `cb_anexos_da_anotacao_para_a_fila` (AFTER DELETE OR UPDATE
--      OF anexos): o caminho que SAI da anotação (apagada pela tela, pelo
--      CASCADE da conversa, do contato ou da conta, por SQL à mão; ou tirado
--      numa edição) vai para a fila `cb_arquivos_a_apagar` (1097), origem
--      `anotacao`, `ON CONFLICT DO NOTHING`. Só entra caminho que passa na
--      guarda (`cb_caminho_no_chat_media`) E está em `account-<conta>/notas/`
--      — o prefixo é conferido aqui, na entrada, e não na drenagem, que é
--      compartilhada. SECURITY DEFINER: o DELETE vem do navegador, que não
--      escreve na fila. Nunca estoura: caminho torto fica fora da fila (o
--      arquivo fica), e apagar a anotação nunca falha por causa dele.
--   4. ⚠️⚠️ O SINAL DA LIXEIRA. Mover a ficha para a Lixeira apaga as
--      anotações pelo CASCADE com `cb.lixeira = 'movendo'`: os anexos NÃO
--      podem ir para a fila (a fotografia os guarda; saem quando a ficha sai
--      de vez — o "Excluir agora" e o vencimento põem `arquivos` na fila).
--      O gatilho leva EXATAMENTE o WHEN do sinal e entra em `calados` de
--      `cb_lixeira_tratamento()` (o corpo VIGENTE da 1097, mais a entrada):
--      sem a declaração, toda restauração recusaria
--      (`lixeira_sem_tratamento:gatilho:…`); sem o WHEN,
--      `lixeira_gatilho_sem_sinal`. Ele nunca dispara na restauração (que só
--      faz INSERT) nem na união de fichas (que não mexe em `anexos`).
--   5. `cb_arquivos_citados` (o corpo VIGENTE da 1097) passa a contar os
--      `anexos[].caminho` das anotações vivas: arquivo que uma anotação ainda
--      cita sai da fila sem ser apagado.
--   6. O armazenamento `chat-media` em `notas/` (as regras da 954 refeitas;
--      fora de `notas/` nada muda): GRAVAR continua igual (qualquer membro
--      ativo, todos os perfis — D6; a policy de INSERT da 954 não é tocada);
--      TROCAR ninguém pelo navegador (UPDATE — e, sem WITH CHECK, o USING
--      vale para a linha nova: ninguém move arquivo PARA dentro de `notas/`
--      também); APAGAR só o arquivo que a própria pessoa subiu (`owner_id`),
--      para a caixa desfazer o envio que não virou anotação. O resto sai
--      pela fila, com o service role. `IS DISTINCT FROM`, nunca `<>`: a
--      segunda pasta de um anexo comum é NULA (supabase.md, "Storage").
--
-- AS TRAVAS. A ALTER pega trava exclusiva em `cb_conversation_notes` (tabela
-- de pouco tráfego: ~370 anotações por mês) e a segura até o fim: a
-- conferência que CHAMA o gatilho (supabase.md, regra 3 do banco vazio) só
-- escreve nela mesma e na fila, e uma anotação a menos por um instante não
-- para o atendimento. As policies de `storage.objects` (tabela QUENTE: toda
-- leitura de anexo passa por ela) ficam no FIM, para a trava exclusiva dela
-- durar só até o COMMIT.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) As colunas
-- ------------------------------------------------------------
ALTER TABLE public.cb_conversation_notes
  ADD COLUMN IF NOT EXISTS anexos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS editada_em timestamptz;

COMMENT ON COLUMN public.cb_conversation_notes.anexos IS
  'Anexos da anotação (1102): lista de {caminho, nome, mime, bytes}, até 10. O caminho é do chat-media, em account-<conta>/notas/; a URL nasce na tela. Tamanho e tipo lidos do armazenamento pela rota, nunca do corpo. O que sai daqui vai para cb_arquivos_a_apagar (gatilho cb_anexos_da_anotacao_para_a_fila).';
COMMENT ON COLUMN public.cb_conversation_notes.editada_em IS
  'Quando a anotação foi editada pela última vez (Fase 3 do plano de anexos e edição). NULL = nunca editada.';

-- ------------------------------------------------------------
-- 2) As regras: texto OU anexo; anexos é lista de até 10
-- ------------------------------------------------------------
-- O CHECK da 918 foi escrito inline (nome implícito,
-- `cb_conversation_notes_texto_check` na produção): sai pela FORMA
-- renderizada, exata — a regra nova também contém `btrim(texto) <> ''`, e um
-- casamento frouxo a derrubaria na segunda aplicação.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.cb_conversation_notes'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) = 'CHECK ((btrim(texto) <> ''''::text))'
  LOOP
    EXECUTE format('ALTER TABLE public.cb_conversation_notes DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.cb_conversation_notes DROP CONSTRAINT IF EXISTS cb_conversation_notes_anexos_ck;
ALTER TABLE public.cb_conversation_notes
  ADD CONSTRAINT cb_conversation_notes_anexos_ck CHECK (
    CASE WHEN jsonb_typeof(anexos) = 'array' THEN jsonb_array_length(anexos) <= 10
         ELSE false
    END);

ALTER TABLE public.cb_conversation_notes DROP CONSTRAINT IF EXISTS cb_conversation_notes_conteudo_ck;
ALTER TABLE public.cb_conversation_notes
  ADD CONSTRAINT cb_conversation_notes_conteudo_ck CHECK (
    CASE WHEN btrim(texto) <> '' THEN true
         WHEN jsonb_typeof(anexos) = 'array' THEN jsonb_array_length(anexos) >= 1
         ELSE false
    END);

-- ------------------------------------------------------------
-- 3) O gatilho: o anexo que SAI da anotação vai para a fila
-- ------------------------------------------------------------
-- No DELETE, todos os caminhos de OLD; no UPDATE, os de OLD que não estão em
-- NEW (NEW só é lido no ramo do UPDATE). A drenagem (`arquivos-a-apagar.ts`,
-- no `after()` de `/api/cb/scheduled/cron`) confere de novo, NA HORA, se
-- alguém ainda cita o caminho (`cb_arquivos_citados`) antes de apagar.
CREATE OR REPLACE FUNCTION public.cb_anexos_da_anotacao_para_a_fila()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefixo text := 'account-' || OLD.account_id::text || '/notas/';
  v_ficam jsonb := '[]'::jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_ficam := CASE WHEN jsonb_typeof(NEW.anexos) = 'array' THEN NEW.anexos ELSE '[]'::jsonb END;
  END IF;

  INSERT INTO cb_arquivos_a_apagar (account_id, bucket, caminho, origem)
  SELECT DISTINCT OLD.account_id, 'chat-media'::text, s.c, 'anotacao'::text
    FROM (
      SELECT x ->> 'caminho' AS c
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(OLD.anexos) = 'array' THEN OLD.anexos ELSE '[]'::jsonb END) x
    ) s
   WHERE cb_caminho_no_chat_media(s.c, OLD.account_id) = s.c
     AND left(s.c, length(v_prefixo)) = v_prefixo
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ficam) y WHERE y ->> 'caminho' = s.c)
  ON CONFLICT (bucket, caminho) DO NOTHING;

  RETURN NULL;
END;
$$;

-- O WHEN do sinal, EXATAMENTE na forma da 1097 (o pino lixeira-1097.test.ts
-- e `cb_lixeira_conferir_gatilhos` o procuram): sem o `missing_ok` estoura em
-- sessão que nunca o definiu; sem o `nullif`, a do pool que já o usou guarda
-- `''`. Só o sinal: o WHEN de um gatilho de DELETE não pode ler NEW.
CREATE OR REPLACE TRIGGER cb_anexos_da_anotacao_para_a_fila
  AFTER DELETE OR UPDATE OF anexos ON public.cb_conversation_notes FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_anexos_da_anotacao_para_a_fila();

-- Ninguém chama o gatilho de fora (revogar não impede o disparo: o
-- privilégio é conferido no CREATE TRIGGER).
REVOKE EXECUTE ON FUNCTION public.cb_anexos_da_anotacao_para_a_fila() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) O inventário da restauração: o corpo VIGENTE da 1097 + o gatilho novo
-- ------------------------------------------------------------
-- Única diferença: `cb_conversation_notes.cb_anexos_da_anotacao_para_a_fila`
-- em `calados` (com o WHEN do sinal; a restauração só faz INSERT nas
-- anotações, e o mover não pode enfileirar o que a fotografia guarda).
CREATE OR REPLACE FUNCTION public.cb_lixeira_tratamento()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'fecho', jsonb_build_object(
      'contacts', 'volta',
      'conversations', 'volta',
      'messages', 'volta',
      'message_reactions', 'volta',
      'cb_message_media_ref', 'volta',
      'contact_tags', 'volta',
      'contact_custom_values', 'volta',
      'cb_tasks', 'volta',
      'cb_conversation_notes', 'volta',
      -- É o "já mandei" do lembrete: sem ela, o lembrete da janela sai de novo.
      'cb_automation_reminders', 'volta',
      'cb_contatos_relacionados', 'par',
      -- Decisão de gente: sem ela, a leitura do Atlas religa o par desvinculado.
      'cb_atlas_recusas', 'volta',
      'cb_duplicatas_descartadas', 'par',
      'cb_fichas_unidas', 'volta',
      'cb_contatos_antigos', 'volta',
      'cb_scheduled_messages', 'volta',
      'cb_conversation_insights', 'volta',
      'cb_conversation_favorites', 'volta',
      'notifications', 'nao_volta',
      'cb_conversa_aberta', 'nao_volta',
      'cb_ia_turnos', 'nao_volta'
    ),
    'ordem', jsonb_build_array(
      'contacts', 'conversations', 'messages', 'message_reactions', 'cb_message_media_ref',
      'contact_tags', 'contact_custom_values', 'cb_tasks', 'cb_conversation_notes',
      'cb_automation_reminders', 'cb_contatos_relacionados', 'cb_atlas_recusas',
      'cb_duplicatas_descartadas', 'cb_fichas_unidas', 'cb_contatos_antigos',
      'cb_scheduled_messages', 'cb_conversation_insights', 'cb_conversation_favorites'
    ),
    'ponteiros', jsonb_build_object(
      'deals.contact_id', 'reaponta',
      'deals.conversation_id', 'reaponta',
      'cb_meetings.contact_id', 'reaponta',
      'cb_meetings.conversation_id', 'reaponta',
      'cb_lead_events.contact_id', 'reaponta',
      'cb_calendly_eventos.contact_id', 'reaponta',
      'cb_atlas_clientes.contact_id', 'reaponta',
      'cb_zapsign_documentos.contact_id', 'reaponta',
      'cb_zapsign_eventos.contact_id', 'reaponta',
      'cb_reunioes_da_kommo.contact_id', 'reaponta',
      'cb_reunioes_transcritas.contact_id', 'reaponta',
      'cb_webhook_eventos.contact_id', 'reaponta',
      'automation_logs.contact_id', 'reaponta',
      'cb_ligacoes.conversation_id', 'reaponta',
      'cb_ligacoes.message_id', 'reaponta',
      'ai_usage_log.conversation_id', 'reaponta',
      'cb_mensagens_sem_telefone.message_id', 'reaponta',
      'messages.reply_to_message_id', 'reaponta',
      'cb_ia_turnos.mensagem_inicial_id', 'reaponta',
      'cb_ia_turnos.mensagem_gatilho_id', 'reaponta',
      'cb_tasks.tarefa_pai_id', 'reaponta',
      'cb_conversation_notes.resposta_de', 'reaponta',
      'cb_contatos_antigos.fusao_id', 'reaponta',
      -- Não atropela vínculo decidido durante a Lixeira.
      'cb_asaas_clientes.contact_id', 'asaas_cliente',
      -- Só quando o cliente do Asaas voltou para a ficha.
      'cb_asaas_regua_envios.contact_id', 'asaas_regua',
      -- Só o histórico (enviado, entregue, lido, respondido).
      'broadcast_recipients.contact_id', 'disparo',
      -- Baixaria o número do sino.
      'notifications.contact_id', 'nao_reaponta',
      -- Encerradas ao mover: restaurar não religa nada.
      'automation_pending_executions.contact_id', 'nao_reaponta',
      'flow_runs.contact_id', 'nao_reaponta',
      'flow_runs.conversation_id', 'nao_reaponta',
      'flow_runs.last_prompt_message_id', 'nao_reaponta',
      -- Fila do funil já drenada.
      'cb_automation_events.contact_id', 'nao_reaponta',
      -- O turno da IA não volta.
      'ai_usage_log.turno_id', 'nao_reaponta'
    ),
    -- Colunas guardadas junto com o ponteiro, para a condição da volta.
    'extras', jsonb_build_object(
      'cb_asaas_clientes', jsonb_build_array('vinculo_origem')
    ),
    -- Calados pelo sinal (o WHEN desta migration); a conferência exige o WHEN.
    'calados', jsonb_build_array(
      'contacts.cb_email_da_ficha_para_o_campo_trigger',
      'contact_custom_values.cb_email_do_campo_para_a_ficha_trigger',
      'conversations.cb_conversa_criada_na_trilha',
      'conversations.cb_conversa_mudou_na_trilha',
      'conversations.on_conversation_assigned',
      'conversations.set_updated_at',
      'messages.cb_marcar_aguardando_resposta_trigger',
      'messages.cb_marcar_janela_da_meta_trigger',
      'messages.cb_pausa_ia_por_gente_trigger',
      'contact_tags.cb_contact_tags_log_event',
      'cb_fichas_unidas.cb_fichas_unidas_na_trilha',
      'deals.set_updated_at',
      -- 1102: os anexos da anotação apagada pelo mover ficam na fotografia.
      'cb_conversation_notes.cb_anexos_da_anotacao_para_a_fila'
    ),
    -- Podem disparar: não são tocados pela restauração (UPDATE OF de coluna
    -- que ela não escreve) ou não fazem barulho (normalizar, conferir).
    'livres', jsonb_build_array(
      'contacts.cb_email_da_ficha_normaliza_trigger',
      'contacts.cb_titulo_do_card_segue_a_ficha_trigger',
      'contacts.set_updated_at',
      'contact_custom_values.cb_email_do_campo_normaliza_trigger',
      'conversations.cb_encerrar_limpa_espera_trigger',
      'conversations.cb_encerrar_limpa_ia_trigger',
      'messages.cb_mensagem_apagada_recalcula_espera_trigger',
      'deals.cb_deals_aplica_resultado_trigger',
      'deals.cb_deals_carimba_etapa_desde_trigger',
      'deals.cb_deals_enfileira_evento',
      'deals.cb_deals_enfileira_evento_update',
      'deals.cb_deals_log_event',
      'deals.cb_deals_log_event_update',
      'cb_tasks.cb_tasks_touch',
      'broadcast_recipients.broadcast_recipients_aggregate'
    )
  )
$$;

-- Peça interna, como na 1097 (`CREATE OR REPLACE` mantém o ACL; o REVOKE
-- repetido só deixa a intenção escrita).
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_tratamento() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5) Quem cita um caminho: o corpo VIGENTE da 1097 + os anexos das anotações
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_arquivos_citados(p_conta uuid, p_caminhos text[])
RETURNS SETOF text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- O filtro barato vem antes da guarda: a URL que CONTÉM um dos caminhos
  -- (LIKE com os curingas escapados), num passo MATERIALIZADO — sem ele o
  -- planejador aplica a guarda a cada mensagem (650 ms com 110 mil, medido
  -- no descartável; com ele, ~15 ms).
  WITH padroes AS (
    SELECT ARRAY(
      SELECT '%/chat-media/' || replace(replace(replace(c, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        FROM unnest(p_caminhos) c) AS p
  ),
  urls AS MATERIALIZED (
    SELECT m.media_url AS u FROM messages m, padroes x WHERE m.media_url LIKE ANY (x.p)
    UNION ALL
    SELECT a.media_url FROM cb_scheduled_messages a, padroes x WHERE a.media_url LIKE ANY (x.p)
    UNION ALL
    SELECT t.header_media_url FROM message_templates t, padroes x WHERE t.header_media_url LIKE ANY (x.p)
    UNION ALL
    SELECT k.avatar_url FROM contacts k, padroes x WHERE k.avatar_url LIKE ANY (x.p)
    UNION ALL
    SELECT p.avatar_url FROM profiles p, padroes x WHERE p.avatar_url LIKE ANY (x.p)
    UNION ALL
    SELECT g.picture_url FROM cb_groups g, padroes x WHERE g.picture_url LIKE ANY (x.p)
  ),
  citados AS (
    SELECT cb_caminho_no_chat_media(u, p_conta) AS c FROM urls
    UNION
    SELECT a.media_path FROM cb_scheduled_messages a WHERE a.media_path = ANY (p_caminhos)
    UNION
    SELECT b.media_path FROM cb_media_library b WHERE b.media_path = ANY (p_caminhos)
    UNION
    -- Configuração em JSON (passo de automação, nó do robô) e o texto do
    -- cabeçalho do modelo: pela presença do caminho no texto.
    SELECT c FROM unnest(p_caminhos) c
     WHERE EXISTS (SELECT 1 FROM automation_steps s WHERE position(c IN s.step_config::text) > 0)
        OR EXISTS (SELECT 1 FROM flow_nodes n WHERE position(c IN n.config::text) > 0)
        OR EXISTS (SELECT 1 FROM message_templates t WHERE position(c IN coalesce(t.header_content, '')) > 0)
    UNION
    -- 1102: os anexos das anotações VIVAS (o caminho cru, no JSON). A que
    -- foi apagada já saiu da tabela; a da ficha na Lixeira está na
    -- fotografia, logo abaixo.
    SELECT x ->> 'caminho' FROM cb_conversation_notes n
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(n.anexos) = 'array' THEN n.anexos ELSE '[]'::jsonb END) x
     WHERE n.anexos <> '[]'::jsonb
       AND x ->> 'caminho' = ANY (p_caminhos)
    UNION
    -- As fotografias dos OUTROS itens da Lixeira (o purgado já saiu).
    SELECT c FROM unnest(p_caminhos) c
     WHERE EXISTS (SELECT 1 FROM cb_lixeira_de_contatos x WHERE x.arquivos @> ARRAY[c])
  )
  SELECT DISTINCT c FROM citados WHERE c = ANY (p_caminhos)
$$;

REVOKE EXECUTE ON FUNCTION public.cb_arquivos_citados(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6) Conferência do CATÁLOGO (vale no banco vazio do replay)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_seguro boolean;
  v_caminho text;
BEGIN
  -- 6.1 As colunas.
  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cb_conversation_notes'
          AND column_name = 'anexos' AND data_type = 'jsonb' AND is_nullable = 'NO')
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cb_conversation_notes'
          AND column_name = 'editada_em' AND data_type = 'timestamp with time zone'
          AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '1102: as colunas anexos/editada_em não ficaram na forma esperada';
  END IF;

  -- 6.2 O CHECK de só-texto saiu; os dois novos estão lá.
  IF EXISTS (
       SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'public.cb_conversation_notes'::regclass AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) = 'CHECK ((btrim(texto) <> ''''::text))') THEN
    RAISE EXCEPTION '1102: o CHECK de só-texto da 918 ficou de pé (anotação só de anexos seria recusada)';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid = 'public.cb_conversation_notes'::regclass AND c.contype = 'c'
         AND c.conname IN ('cb_conversation_notes_conteudo_ck', 'cb_conversation_notes_anexos_ck')) <> 2 THEN
    RAISE EXCEPTION '1102: faltou cb_conversation_notes_conteudo_ck ou cb_conversation_notes_anexos_ck';
  END IF;

  -- 6.3 O gatilho: AFTER DELETE OR UPDATE OF anexos, por linha, com o sinal.
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.cb_conversation_notes'::regclass
     AND t.tgname = 'cb_anexos_da_anotacao_para_a_fila' AND NOT t.tgisinternal;
  IF v_def IS NULL
     OR position('AFTER DELETE OR UPDATE OF anexos' IN v_def) = 0
     OR position('FOR EACH ROW' IN v_def) = 0
     OR position('NULLIF(current_setting(''cb.lixeira''::text, true), ''''::text) IS NULL' IN v_def) = 0 THEN
    RAISE EXCEPTION '1102: o gatilho dos anexos não ficou na forma esperada: %', v_def;
  END IF;
  SELECT p.prosecdef AND coalesce(array_to_string(p.proconfig, ',') LIKE '%search_path=public%', false)
    INTO v_seguro
    FROM pg_proc p WHERE p.oid = 'public.cb_anexos_da_anotacao_para_a_fila()'::regprocedure;
  IF v_seguro IS DISTINCT FROM true THEN
    RAISE EXCEPTION '1102: a função do gatilho não é SECURITY DEFINER com search_path fixo';
  END IF;
  IF has_function_privilege('anon', 'public.cb_anexos_da_anotacao_para_a_fila()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_anexos_da_anotacao_para_a_fila()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_tratamento()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_arquivos_citados(uuid, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '1102: função interna aberta ao navegador';
  END IF;

  -- 6.4 A restauração conhece o gatilho novo (sem isso, toda restauração
  --     recusaria) — a mesma conferência que ela roda antes de escrever.
  IF NOT (public.cb_lixeira_tratamento() -> 'calados') ? 'cb_conversation_notes.cb_anexos_da_anotacao_para_a_fila' THEN
    RAISE EXCEPTION '1102: o gatilho dos anexos ficou fora dos calados da Lixeira';
  END IF;
  PERFORM public.cb_lixeira_conferir_gatilhos();

  -- 6.5 Nada de privilégio novo: o navegador continua sem escrever na
  --     anotação (só pela rota) e sem ver a fila.
  IF has_table_privilege('authenticated', 'public.cb_conversation_notes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_conversation_notes', 'UPDATE')
     OR has_table_privilege('anon', 'public.cb_conversation_notes', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_conversation_notes', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_conversation_notes', 'DELETE')
     OR has_table_privilege('authenticated', 'public.cb_arquivos_a_apagar', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_arquivos_a_apagar', 'INSERT') THEN
    RAISE EXCEPTION '1102: os privilégios das anotações ou da fila mudaram';
  END IF;

  -- 6.6 `cb_arquivos_citados` recriada é CHAMADA (no banco vazio, sem nada a
  --     citar): o corpo novo roda.
  SELECT c INTO v_caminho
    FROM public.cb_arquivos_citados('00000000-0000-0000-0000-000000000001',
                                    ARRAY['account-00000000-0000-0000-0000-000000000001/notas/x/1102.ogg']) c;
  IF v_caminho IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.cb_conversation_notes n
                      WHERE n.anexos @> '[{"caminho": "account-00000000-0000-0000-0000-000000000001/notas/x/1102.ogg"}]') THEN
    RAISE EXCEPTION '1102: cb_arquivos_citados cita um caminho que ninguém usa: %', v_caminho;
  END IF;

  RAISE NOTICE '1102: colunas, regras, gatilho, inventário da Lixeira e privilégios conferidos.';
END $$;

-- ------------------------------------------------------------
-- 7) Conferência que CHAMA o gatilho (supabase.md, regra 3 do banco vazio)
-- ------------------------------------------------------------
-- Numa conversa de verdade, num subbloco desfeito pelo SQLSTATE próprio
-- (P1102 — nunca `WHEN OTHERS`, que engoliria o defeito): nada sobra na
-- anotação nem na fila, e nada sai pelo tempo real (só o que é confirmado é
-- decodificado). No banco vazio do replay, pula com NOTICE.
DO $$
DECLARE
  v_conta uuid;
  v_conversa uuid;
  v_contato uuid;
  v_base text;
  v_nota uuid;
  v_onze jsonb;
BEGIN
  SELECT c.account_id, c.id, c.contact_id INTO v_conta, v_conversa, v_contato
    FROM public.conversations c
   LIMIT 1;
  IF v_conversa IS NULL THEN
    RAISE NOTICE '1102: banco sem conversa — o gatilho foi conferido pela definição, não chamado.';
    RETURN;
  END IF;
  -- Uma pasta que não existe no armazenamento (nada é apagado: tudo se desfaz).
  v_base := 'account-' || v_conta::text || '/notas/conferencia-1102-' || replace(gen_random_uuid()::text, '-', '') || '/';

  BEGIN
    -- a) Anotação SÓ de anexo entra; vazia, com 11 anexos ou com anexos que
    --    não são lista, não.
    INSERT INTO public.cb_conversation_notes (account_id, conversation_id, contact_id, texto, anexos)
    VALUES (v_conta, v_conversa, v_contato, '',
            jsonb_build_array(jsonb_build_object('caminho', v_base || 'a.ogg', 'nome', 'a.ogg',
                                                 'mime', 'audio/ogg', 'bytes', 10)))
    RETURNING id INTO v_nota;
    BEGIN
      INSERT INTO public.cb_conversation_notes (account_id, conversation_id, contact_id, texto, anexos)
      VALUES (v_conta, v_conversa, v_contato, '   ', '[]'::jsonb);
      RAISE EXCEPTION '1102: anotação sem texto e sem anexo entrou';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    SELECT jsonb_agg(jsonb_build_object('caminho', v_base || g || '.pdf', 'nome', g || '.pdf'))
      INTO v_onze FROM generate_series(1, 11) g;
    BEGIN
      INSERT INTO public.cb_conversation_notes (account_id, conversation_id, contact_id, texto, anexos)
      VALUES (v_conta, v_conversa, v_contato, 'onze', v_onze);
      RAISE EXCEPTION '1102: anotação com 11 anexos entrou';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
      INSERT INTO public.cb_conversation_notes (account_id, conversation_id, contact_id, texto, anexos)
      VALUES (v_conta, v_conversa, v_contato, 'objeto', '{"caminho": "x"}'::jsonb);
      RAISE EXCEPTION '1102: anexos que não são lista entraram';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- b) Apagar a anotação põe o anexo na fila (origem `anotacao`).
    DELETE FROM public.cb_conversation_notes WHERE id = v_nota;
    IF NOT EXISTS (SELECT 1 FROM public.cb_arquivos_a_apagar f
                    WHERE f.caminho = v_base || 'a.ogg' AND f.account_id = v_conta
                      AND f.origem = 'anotacao' AND f.bucket = 'chat-media') THEN
      RAISE EXCEPTION '1102: apagar a anotação não pôs o anexo na fila';
    END IF;

    -- c) Tirar 1 de 3 anexos põe só o tirado; mexer em outra coluna, nada.
    INSERT INTO public.cb_conversation_notes (account_id, conversation_id, contact_id, texto, anexos)
    VALUES (v_conta, v_conversa, v_contato, 'tres',
            jsonb_build_array(jsonb_build_object('caminho', v_base || 'b.png', 'nome', 'b.png'),
                              jsonb_build_object('caminho', v_base || 'c.pdf', 'nome', 'c.pdf'),
                              jsonb_build_object('caminho', v_base || 'd.mp4', 'nome', 'd.mp4')))
    RETURNING id INTO v_nota;
    UPDATE public.cb_conversation_notes
       SET anexos = jsonb_build_array(jsonb_build_object('caminho', v_base || 'b.png', 'nome', 'b.png'),
                                      jsonb_build_object('caminho', v_base || 'd.mp4', 'nome', 'd.mp4'))
     WHERE id = v_nota;
    UPDATE public.cb_conversation_notes SET texto = 'tres, agora dois' WHERE id = v_nota;
    IF NOT EXISTS (SELECT 1 FROM public.cb_arquivos_a_apagar WHERE caminho = v_base || 'c.pdf')
       OR EXISTS (SELECT 1 FROM public.cb_arquivos_a_apagar
                   WHERE caminho IN (v_base || 'b.png', v_base || 'd.mp4')) THEN
      RAISE EXCEPTION '1102: tirar um anexo não pôs SÓ o tirado na fila';
    END IF;

    -- d) Uma anotação viva cita o caminho: a drenagem não o apaga.
    IF NOT EXISTS (SELECT 1 FROM public.cb_arquivos_citados(v_conta, ARRAY[v_base || 'b.png', v_base || 'c.pdf']) c
                    WHERE c = v_base || 'b.png')
       OR EXISTS (SELECT 1 FROM public.cb_arquivos_citados(v_conta, ARRAY[v_base || 'c.pdf']) c) THEN
      RAISE EXCEPTION '1102: cb_arquivos_citados não conta os anexos das anotações vivas';
    END IF;

    -- e) Com o sinal da Lixeira (o CASCADE do mover), nada vai para a fila.
    PERFORM set_config('cb.lixeira', 'movendo', true);
    DELETE FROM public.cb_conversation_notes WHERE id = v_nota;
    PERFORM set_config('cb.lixeira', '', true);
    IF EXISTS (SELECT 1 FROM public.cb_arquivos_a_apagar
                WHERE caminho IN (v_base || 'b.png', v_base || 'd.mp4')) THEN
      RAISE EXCEPTION '1102: com cb.lixeira = movendo, o anexo foi para a fila (a fotografia o guarda)';
    END IF;

    -- f) Caminho fora de `notas/`, de outra conta ou torto não entra na fila
    --    (o arquivo fica: na dúvida, nada se apaga).
    INSERT INTO public.cb_conversation_notes (account_id, conversation_id, contact_id, texto, anexos)
    VALUES (v_conta, v_conversa, v_contato, 'tortos',
            jsonb_build_array(
              jsonb_build_object('caminho', 'account-' || v_conta::text || '/conferencia-1102-fora.pdf'),
              jsonb_build_object('caminho', 'account-00000000-0000-0000-0000-000000000000/notas/x/y.pdf'),
              jsonb_build_object('caminho', v_base || '../z.pdf'),
              jsonb_build_object('nome', 'sem caminho'),
              '"texto solto"'::jsonb))
    RETURNING id INTO v_nota;
    DELETE FROM public.cb_conversation_notes WHERE id = v_nota;
    IF EXISTS (SELECT 1 FROM public.cb_arquivos_a_apagar
                WHERE caminho IN ('account-' || v_conta::text || '/conferencia-1102-fora.pdf',
                                  'account-00000000-0000-0000-0000-000000000000/notas/x/y.pdf',
                                  v_base || '../z.pdf')) THEN
      RAISE EXCEPTION '1102: caminho fora de notas/ (ou de outra conta) entrou na fila';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1102', MESSAGE = 'desfaz a conferência';
  EXCEPTION WHEN SQLSTATE 'P1102' THEN
    RAISE NOTICE '1102: o gatilho dos anexos EXECUTOU numa conversa de verdade (desfeito).';
  END;

  -- O rollback do subbloco desfaz o sinal junto; confere.
  IF nullif(current_setting('cb.lixeira', true), '') IS NOT NULL THEN
    RAISE EXCEPTION '1102: o sinal cb.lixeira sobrou depois da conferência';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 8) O armazenamento em `notas/` (as regras da 954, refeitas)
-- ------------------------------------------------------------
-- No FIM de propósito: a trava exclusiva de `storage.objects` vai daqui até o
-- COMMIT. A policy de INSERT ("Members can upload chat media", 954) NÃO é
-- tocada: gravar em `notas/` continua aberto a todo membro ativo (D6).

-- TROCAR (UPDATE): ninguém em `notas/` pelo navegador. Sem WITH CHECK, o
-- USING vale também para a linha NOVA: ninguém move arquivo para dentro de
-- `notas/`, nem de lá para fora.
DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[2] IS DISTINCT FROM 'notas'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND (
          (storage.foldername(name))[2] IS DISTINCT FROM 'acervo'
          OR p.account_role IN ('owner', 'admin')
        )
    )
  );

-- APAGAR (DELETE): em `notas/`, só o arquivo que a própria pessoa subiu
-- (`owner_id`, que o Storage grava no upload com a sessão). `=` de propósito
-- no dono: arquivo sem dono (subido pelo service role) dá NULL, e NULL nega.
-- Fora de `notas/`, a regra da 954 como era.
DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
        AND CASE
              WHEN (storage.foldername(name))[2] IS NOT DISTINCT FROM 'notas'
                THEN objects.owner_id = auth.uid()::text
              ELSE (storage.foldername(name))[2] IS DISTINCT FROM 'acervo'
                   OR p.account_role IN ('owner', 'admin')
            END
    )
  );

-- Conferência: a REGRA em memória (como a 954 — vale no banco vazio e não
-- depende de existir membro de cada papel) e as policies no catálogo.
DO $$
DECLARE
  v_conta text := 'account-11111111-1111-1111-1111-111111111111';
  v_eu text := '22222222-2222-2222-2222-222222222222';
  v_ok boolean;
BEGIN
  FOR v_ok IN
    SELECT (
      CASE acao
        WHEN 'trocar' THEN
          (storage.foldername(caminho))[2] IS DISTINCT FROM 'notas'
          AND ((storage.foldername(caminho))[2] IS DISTINCT FROM 'acervo' OR papel IN ('owner', 'admin'))
        ELSE
          coalesce(CASE
            WHEN (storage.foldername(caminho))[2] IS NOT DISTINCT FROM 'notas' THEN dono = v_eu
            ELSE (storage.foldername(caminho))[2] IS DISTINCT FROM 'acervo' OR papel IN ('owner', 'admin')
          END, false)
      END
    ) IS NOT DISTINCT FROM esperado
    FROM (VALUES
      -- `notas/`: ninguém troca; só o dono apaga — nem o admin apaga o dos outros.
      (v_conta || '/notas/u1/a.ogg', 'agent',  v_eu,   'apagar', true),
      (v_conta || '/notas/u1/a.ogg', 'viewer', v_eu,   'apagar', true),
      (v_conta || '/notas/u1/a.ogg', 'admin',  'outro', 'apagar', false),
      (v_conta || '/notas/u1/a.ogg', 'owner',  NULL,   'apagar', false),
      (v_conta || '/notas/u1/a.ogg', 'agent',  v_eu,   'trocar', false),
      (v_conta || '/notas/u1/a.ogg', 'owner',  v_eu,   'trocar', false),
      -- Fora de `notas/`, como na 954: anexo comum, todo membro; acervo, admin.
      (v_conta || '/1-foto.png',          'viewer', NULL, 'apagar', true),
      (v_conta || '/1-foto.png',          'agent',  NULL, 'trocar', true),
      (v_conta || '/acervo/1-modelo.pdf', 'agent',  NULL, 'apagar', false),
      (v_conta || '/acervo/1-modelo.pdf', 'admin',  NULL, 'trocar', true)
    ) AS t(caminho, papel, dono, acao, esperado)
  LOOP
    IF NOT v_ok THEN
      RAISE EXCEPTION '1102: a regra de notas/ no armazenamento não bate com o esperado.';
    END IF;
  END LOOP;

  IF NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Members can update chat media' AND cmd = 'UPDATE'
          AND qual LIKE '%notas%' AND qual LIKE '%acervo%')
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Members can delete chat media' AND cmd = 'DELETE'
          AND qual LIKE '%notas%' AND qual LIKE '%owner_id%' AND qual LIKE '%acervo%')
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
          AND policyname = 'Members can upload chat media' AND cmd = 'INSERT'
          AND with_check LIKE '%acervo%' AND with_check NOT LIKE '%notas%') THEN
    RAISE EXCEPTION '1102: as policies do chat-media não ficaram na forma esperada.';
  END IF;

  RAISE NOTICE '1102: as regras de notas/ no armazenamento conferidas.';
END $$;
