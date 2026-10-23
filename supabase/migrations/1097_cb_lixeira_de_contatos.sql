-- ============================================================
-- 1097 — Lixeira de contatos (90 dias) e a fila de arquivos a apagar
--
-- Fase 2 de docs/PLANO-lixeira-de-contatos.md (decisões L1–L3 e B1–B6 do
-- operador, 22/10/2026). ADITIVA: aplicar ANTES do deploy (a tela nova chama
-- as RPCs daqui; a tela antiga continua apagando como hoje até a Fase 3).
--
-- O DESENHO (B1, FOTOGRAFIA). Mover para a Lixeira copia a ficha e TUDO o
-- que a exclusão levaria (o fecho do CASCADE, calculado pelo CATÁLOGO) para
-- uma linha de `cb_lixeira_de_contatos`, anota os ponteiros que ficariam
-- nulos (SET NULL) e só então apaga a ficha, como hoje. Para o resto do CRM a
-- ficha não existe: automação, robô, agendada, IA, API e integrações seguem
-- sem mudança. Restaurar reinsere a fotografia e reaponta os ponteiros que
-- ainda estão nulos; excluir de vez (prazo vencido ou "Excluir agora") apaga
-- a linha e põe os arquivos na fila `cb_arquivos_a_apagar`, que o servidor
-- drena no `after()` de `/api/cb/scheduled/cron`.
--
-- ⚠️⚠️ REGRA DE OURO: restaurar nunca manda nada ao cliente. Os gatilhos que
-- reagiriam à reinserção (trilha, espera, janela da Meta, pausa da IA, aviso
-- de atribuição, espelho do e-mail, `set_updated_at`) ganham um WHEN que lê
-- o SINAL `cb.lixeira`, gravado só dentro da transação (`set_config(…,
-- true)`), na forma `nullif(current_setting('cb.lixeira', true), '')` — sem o
-- `missing_ok` estoura em toda sessão que nunca o definiu, e sem o `nullif` a
-- sessão do pool que já o usou guarda `''`. Nunca `DISABLE TRIGGER`: travaria
-- `messages` e `conversations` de TODAS as contas. As execuções de automação,
-- as esperas e o robô da ficha são ENCERRADOS ao mover e não religam; a
-- agendada volta como falha; a trava dos lembretes volta (é o "já mandei").
--
-- ⚠️⚠️ DEFAULT-DENY. Tabela nova com FK para QUALQUER tabela do fecho (ficha,
-- conversa, mensagem, tarefa, anotação…) recusa o mover com
-- `lixeira_sem_tratamento:<tabela>` até entrar em `cb_lixeira_tratamento()`;
-- gatilho novo numa tabela que a restauração escreve recusa o restaurar até
-- ser declarado. Tabela nova com `contact_id` entra na UNIÃO (1093) E aqui,
-- no mesmo PR (.claude/rules/supabase.md).
--
-- ⚠️ Os WHEN vão em gatilhos do UPSTREAM (`set_updated_at`,
-- `on_conversation_assigned`): um merge que os recrie sem o WHEN faz a
-- restauração RECUSAR (a conferência de gatilhos acusa), nunca barulho em
-- silêncio. Linha na tabela de docs/MERGE-UPSTREAM.md.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- As travas no COMEÇO e na ordem da ingestão (supabase.md, "Mensagem
-- ANTIGA"): `messages`, depois `conversations`, e a trilha por último (os
-- gatilhos das outras gravam nela). Dentro de um DO: `LOCK TABLE` solto
-- estoura fora de transação.
DO $$
BEGIN
  LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.conversations IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.contacts, public.contact_custom_values, public.contact_tags,
             public.deals, public.cb_fichas_unidas IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.automation_logs, public.cb_lead_events IN ACCESS EXCLUSIVE MODE;
END $$;

-- ------------------------------------------------------------
-- 1) Coluna nova e CHECKs alargados (ANTES das funções que gravam neles)
-- ------------------------------------------------------------
-- A conversa restaurada carrega o instante da volta: o navegador dá como
-- ANTIGA a mensagem gravada antes dele (sem pop-up, sem não lida somada). A
-- publicação do tempo real de `conversations` não tem lista de colunas
-- (conferido em 23/10/2026): a coluna nova viaja.
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS restaurada_em timestamptz;
COMMENT ON COLUMN public.conversations.restaurada_em IS
  'Quando a conversa voltou da Lixeira de contatos (1097). Mensagem com gravada_em anterior é antiga.';

ALTER TABLE public.automation_logs DROP CONSTRAINT IF EXISTS automation_logs_interrompida_por_check;
ALTER TABLE public.automation_logs ADD CONSTRAINT automation_logs_interrompida_por_check
  CHECK (interrompida_por = ANY (ARRAY['resposta', 'etapa', 'parar', 'passo', 'desativacao', 'fusao', 'lixeira']));

ALTER TABLE public.cb_lead_events DROP CONSTRAINT IF EXISTS cb_lead_events_event_type_check;
ALTER TABLE public.cb_lead_events ADD CONSTRAINT cb_lead_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'deal_created', 'stage_changed', 'pipeline_changed', 'status_changed', 'deal_deleted',
    'tag_added', 'tag_removed', 'conversation_status_changed', 'conversation_assigned',
    'contacts_merged', 'contact_trashed', 'contact_restored', 'contact_purged']));

ALTER TABLE public.cb_lead_events DROP CONSTRAINT IF EXISTS cb_lead_events_shape;
ALTER TABLE public.cb_lead_events ADD CONSTRAINT cb_lead_events_shape CHECK (
  CASE event_type
    WHEN 'deal_created' THEN deal_id IS NOT NULL AND to_pipeline_id IS NOT NULL
    WHEN 'stage_changed' THEN deal_id IS NOT NULL AND to_stage_id IS NOT NULL
    WHEN 'pipeline_changed' THEN deal_id IS NOT NULL AND from_pipeline_id IS NOT NULL
                                 AND to_pipeline_id IS NOT NULL AND from_pipeline_id <> to_pipeline_id
    WHEN 'status_changed' THEN deal_id IS NOT NULL AND to_status IS NOT NULL
    WHEN 'deal_deleted' THEN deal_id IS NOT NULL
    WHEN 'tag_added' THEN tag_id IS NOT NULL
    WHEN 'tag_removed' THEN tag_id IS NOT NULL
    WHEN 'conversation_status_changed' THEN conversation_id IS NOT NULL AND to_status IS NOT NULL
    WHEN 'conversation_assigned' THEN conversation_id IS NOT NULL
    WHEN 'contacts_merged' THEN details IS NOT NULL
    -- Nunca exigem `contact_id` (supabase.md: apagar contato faz SET NULL).
    WHEN 'contact_trashed' THEN details IS NOT NULL
    WHEN 'contact_restored' THEN details IS NOT NULL
    WHEN 'contact_purged' THEN details IS NOT NULL
    ELSE false
  END);

-- ------------------------------------------------------------
-- 2) As tabelas
-- ------------------------------------------------------------
-- A Lixeira. Uma linha por ficha enquanto ela está lá (restaurar e excluir de
-- vez APAGAM a linha; o rastro fica na trilha). FECHADA ao navegador: a tela
-- lê pelas RPCs, que nunca devolvem a fotografia.
CREATE TABLE IF NOT EXISTS public.cb_lixeira_de_contatos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- Sem FK: a ficha não existe enquanto está aqui (e volta com o mesmo id).
  contact_id         uuid NOT NULL,
  lote_id            uuid NOT NULL,
  -- O que a lista mostra e por onde a identidade se confere (B2; a faixa da
  -- Fase 4 procura por estas três chaves).
  nome               text,
  telefone           text,
  email              text,
  instagram_username text,
  wa_username        text,
  telefone_canonico  text,
  phone_normalized   text,
  wa_user_id         text,
  instagram_id       text,
  -- Login de quem moveu, sem FK (quem sai da conta não leva o item).
  movida_por         uuid,
  movida_por_nome    text,
  movida_em          timestamptz NOT NULL DEFAULT now(),
  vence_em           timestamptz NOT NULL DEFAULT now() + interval '90 days',
  contagens          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Os negócios que ficaram no funil sem contato (B4): a marca no card.
  negocios           uuid[] NOT NULL DEFAULT '{}',
  -- Os caminhos do `chat-media` que a fotografia cita: a drenagem não apaga
  -- arquivo que outro item ainda cita; o purgar os põe na fila.
  arquivos           text[] NOT NULL DEFAULT '{}',
  fotografia         jsonb NOT NULL,
  ponteiros          jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT cb_lixeira_de_contatos_uma_por_ficha UNIQUE (account_id, contact_id)
);
CREATE INDEX IF NOT EXISTS cb_lixeira_de_contatos_vence_idx ON public.cb_lixeira_de_contatos (vence_em);
CREATE INDEX IF NOT EXISTS cb_lixeira_de_contatos_lote_idx ON public.cb_lixeira_de_contatos (account_id, lote_id);
CREATE INDEX IF NOT EXISTS cb_lixeira_de_contatos_negocios_idx ON public.cb_lixeira_de_contatos USING gin (negocios);
CREATE INDEX IF NOT EXISTS cb_lixeira_de_contatos_arquivos_idx ON public.cb_lixeira_de_contatos USING gin (arquivos);
CREATE INDEX IF NOT EXISTS cb_lixeira_de_contatos_telefone_idx ON public.cb_lixeira_de_contatos (account_id, telefone_canonico)
  WHERE telefone_canonico IS NOT NULL AND telefone_canonico <> '';
CREATE INDEX IF NOT EXISTS cb_lixeira_de_contatos_bsuid_idx ON public.cb_lixeira_de_contatos (account_id, wa_user_id)
  WHERE wa_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cb_lixeira_de_contatos_instagram_idx ON public.cb_lixeira_de_contatos (account_id, instagram_id)
  WHERE instagram_id IS NOT NULL;
ALTER TABLE public.cb_lixeira_de_contatos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_lixeira_de_contatos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cb_lixeira_de_contatos TO service_role;

-- A fila de arquivos a apagar do `chat-media`. COMPARTILHADA com o plano
-- irmão (docs/PLANO-anotacao-com-anexos-e-edicao.md): origem `anotacao` é
-- dele. `account_id` SEM FK: a linha sobrevive à conta apagada, para o
-- arquivo sair. A guarda do caminho é repetida na drenagem.
CREATE TABLE IF NOT EXISTS public.cb_arquivos_a_apagar (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL,
  bucket          text NOT NULL DEFAULT 'chat-media',
  caminho         text NOT NULL,
  origem          text NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  tentativas      integer NOT NULL DEFAULT 0,
  reivindicado_em timestamptz,
  ultimo_erro     text,
  CONSTRAINT cb_arquivos_a_apagar_bucket_ck CHECK (bucket = 'chat-media'),
  CONSTRAINT cb_arquivos_a_apagar_origem_ck CHECK (origem IN ('anotacao', 'lixeira')),
  CONSTRAINT cb_arquivos_a_apagar_caminho_ck CHECK (caminho LIKE 'account-' || account_id::text || '/%'),
  -- A mensagem e a agendada enviada citam o MESMO objeto: todo escritor usa
  -- ON CONFLICT DO NOTHING.
  CONSTRAINT cb_arquivos_a_apagar_um_por_arquivo UNIQUE (bucket, caminho)
);
CREATE INDEX IF NOT EXISTS cb_arquivos_a_apagar_fila_idx ON public.cb_arquivos_a_apagar (criado_em)
  WHERE tentativas < 10;
ALTER TABLE public.cb_arquivos_a_apagar ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_arquivos_a_apagar FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cb_arquivos_a_apagar TO service_role;

-- ------------------------------------------------------------
-- 3) O caminho de um arquivo NOSSO no `chat-media`
-- ------------------------------------------------------------
-- Espelho em TS: src/lib/storage/caminho-no-chat-media.ts (o pino compara os
-- dois lados pelos mesmos exemplos). Aceita a URL pública ou o caminho cru;
-- devolve NULL para tudo o que NÃO é arquivo da conta fora do acervo: URL
-- externa, `flow-media`, outra conta, `acervo/` (o acervo tem dono próprio),
-- `..`, `%` (nome codificado: na dúvida, o arquivo fica) e barra sobrando.
CREATE OR REPLACE FUNCTION public.cb_caminho_no_chat_media(p_url text, p_conta uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
           WHEN s.v IS NULL OR s.v = '' THEN NULL
           WHEN left(s.v, length('account-' || p_conta::text || '/')) <> 'account-' || p_conta::text || '/' THEN NULL
           WHEN left(s.v, length('account-' || p_conta::text || '/acervo/')) = 'account-' || p_conta::text || '/acervo/' THEN NULL
           WHEN position('..' IN s.v) > 0 OR position('%' IN s.v) > 0 OR position('\' IN s.v) > 0 THEN NULL
           WHEN position('//' IN s.v) > 0 OR right(s.v, 1) = '/' THEN NULL
           ELSE s.v
         END
    FROM (
      SELECT CASE
               WHEN p_url IS NULL OR p_conta IS NULL THEN NULL
               WHEN position('/object/public/chat-media/' IN p_url) > 0 THEN
                 split_part(split_part(
                   substr(p_url, position('/object/public/chat-media/' IN p_url) + length('/object/public/chat-media/')),
                   '?', 1), '#', 1)
               WHEN p_url ~ '^[A-Za-z][A-Za-z0-9+.-]*:' OR left(p_url, 1) = '/' THEN NULL
               ELSE p_url
             END AS v
    ) s
$$;

-- ------------------------------------------------------------
-- 4) O que a Lixeira faz com cada tabela e cada gatilho (default-deny)
-- ------------------------------------------------------------
-- `fecho`: tabela que o CASCADE leva → `volta`, `par` (vínculo de duas
-- fichas: a outra ponta decide) ou `nao_volta`. `ordem`: a ordem da
-- reinserção (mães antes das filhas). `ponteiros`: FK SET NULL de fora do
-- fecho para dentro dele, pela chave `<tabela>.<colunas anuladas>` →
-- `reaponta`, `asaas_cliente`, `asaas_regua`, `disparo` (com condição) ou
-- `nao_reaponta`. `calados`/`livres`: TODO gatilho das tabelas que a
-- restauração escreve.
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
      'deals.set_updated_at'
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

-- ------------------------------------------------------------
-- 5) Os gatilhos que a restauração (e o mover) calam pelo SINAL
-- ------------------------------------------------------------
-- Mesma definição de hoje (conferida na produção em 23/10/2026) + o WHEN.
-- Qualquer valor do sinal cala: 'movendo' (o SET NULL do DELETE não carimba
-- `deals.updated_at`), 'restaurando' (a reinserção) e 'purgando'.
CREATE OR REPLACE TRIGGER cb_marcar_aguardando_resposta_trigger
  AFTER INSERT ON public.messages FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_marcar_aguardando_resposta();
CREATE OR REPLACE TRIGGER cb_marcar_janela_da_meta_trigger
  AFTER INSERT ON public.messages FOR EACH ROW
  WHEN ((new.sender_type = 'customer'::text) AND nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_marcar_janela_da_meta();
CREATE OR REPLACE TRIGGER cb_pausa_ia_por_gente_trigger
  AFTER INSERT ON public.messages FOR EACH ROW
  WHEN ((new.sender_type = 'agent'::text) AND ((new.sender_id IS NOT NULL) OR new.from_device)
        AND (new.ia_agente_id IS NULL) AND (new.gravada_em IS NOT NULL)
        AND nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_pausar_ia_por_gente();

CREATE OR REPLACE TRIGGER cb_conversa_criada_na_trilha
  AFTER INSERT ON public.conversations REFERENCING NEW TABLE AS novas FOR EACH STATEMENT
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_log_conversa_criada();
CREATE OR REPLACE TRIGGER cb_conversa_mudou_na_trilha
  AFTER UPDATE ON public.conversations REFERENCING OLD TABLE AS antes NEW TABLE AS depois FOR EACH STATEMENT
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_log_conversa_mudou();
CREATE OR REPLACE TRIGGER on_conversation_assigned
  AFTER INSERT OR UPDATE OF assigned_agent_id ON public.conversations FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.notify_conversation_assigned();
CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON public.conversations FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER cb_email_da_ficha_para_o_campo_trigger
  AFTER INSERT OR UPDATE OF email ON public.contacts FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_email_da_ficha_para_o_campo();
CREATE OR REPLACE TRIGGER cb_email_do_campo_para_a_ficha_trigger
  AFTER INSERT OR DELETE OR UPDATE ON public.contact_custom_values FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_email_do_campo_para_a_ficha();
CREATE OR REPLACE TRIGGER cb_contact_tags_log_event
  AFTER INSERT OR DELETE ON public.contact_tags FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_log_contact_tag_event();
CREATE OR REPLACE TRIGGER cb_fichas_unidas_na_trilha
  AFTER INSERT ON public.cb_fichas_unidas FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.cb_log_fichas_unidas();
CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON public.deals FOR EACH ROW
  WHEN (nullif(current_setting('cb.lixeira', true), '') IS NULL)
  EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 6) A trilha da Lixeira (gatilho na tabela da Lixeira; o app nunca grava
--    em `cb_lead_events`)
-- ------------------------------------------------------------
-- Só grava com o sinal: o CASCADE da conta apagada passa calado (gravar a
-- trilha de uma conta que está sumindo estouraria a FK). `contact_purged` vai
-- SEM dado pessoal (id, quem, quando, contagens). Falha assimétrica da 912:
-- com `auth.uid()` estoura; sem, WARNING.
CREATE OR REPLACE FUNCTION public.cb_log_lixeira()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sinal text := nullif(current_setting('cb.lixeira', true), '');
  v_actor uuid := auth.uid();
  v_row cb_lixeira_de_contatos;
  v_tipo text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;
  v_tipo := CASE
              WHEN TG_OP = 'INSERT' AND v_sinal = 'movendo' THEN 'contact_trashed'
              WHEN TG_OP = 'DELETE' AND v_sinal = 'restaurando' THEN 'contact_restored'
              WHEN TG_OP = 'DELETE' AND v_sinal = 'purgando' THEN 'contact_purged'
            END;
  IF v_tipo IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    INSERT INTO cb_lead_events (
      account_id, contact_id, contact_label, event_type,
      actor_user_id, actor_label, origin, details
    ) VALUES (
      v_row.account_id,
      CASE WHEN v_tipo = 'contact_purged' THEN NULL ELSE v_row.contact_id END,
      CASE WHEN v_tipo = 'contact_purged' THEN NULL
           ELSE coalesce(nullif(v_row.nome, ''), v_row.telefone, v_row.instagram_username) END,
      v_tipo,
      v_actor,
      CASE WHEN v_actor IS NOT NULL THEN cb_lead_event_actor(v_row.account_id) END,
      CASE WHEN v_actor IS NOT NULL THEN 'usuario' ELSE 'sistema' END,
      CASE v_tipo
        WHEN 'contact_trashed' THEN jsonb_build_object(
          'item_id', v_row.id, 'lote_id', v_row.lote_id, 'vence_em', v_row.vence_em,
          'contagens', v_row.contagens)
        WHEN 'contact_restored' THEN jsonb_build_object(
          'item_id', v_row.id, 'lote_id', v_row.lote_id, 'movida_em', v_row.movida_em)
        ELSE jsonb_build_object(
          'contact_id', v_row.contact_id, 'item_id', v_row.id, 'movida_em', v_row.movida_em,
          'pedido_exclusao', coalesce(nullif(current_setting('cb.lixeira_pedido', true), ''), 'nao') = 'sim',
          'contagens', v_row.contagens)
      END
    );
  EXCEPTION WHEN OTHERS THEN
    IF v_actor IS NOT NULL THEN
      RAISE;
    END IF;
    RAISE WARNING 'cb_lead_events: evento da Lixeira descartado (%): %', SQLSTATE, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS cb_lixeira_na_trilha ON public.cb_lixeira_de_contatos;
CREATE TRIGGER cb_lixeira_na_trilha
  AFTER INSERT OR DELETE ON public.cb_lixeira_de_contatos
  FOR EACH ROW EXECUTE FUNCTION public.cb_log_lixeira();

-- ------------------------------------------------------------
-- 7) Peças internas: fotografia, ponteiros, arquivos, reinserção
-- ------------------------------------------------------------
-- As FKs do catálogo, com nomes de coluna em ordem.
CREATE OR REPLACE FUNCTION public.cb_lixeira_fks()
RETURNS TABLE (
  conname text, filha regclass, mae regclass, acao "char",
  cols text[], refs text[], anula text[]
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT k.conname::text, k.conrelid::regclass, k.confrelid::regclass, k.confdeltype,
         ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY u(n, o)
                 JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY u.o),
         ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY u(n, o)
                 JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.n ORDER BY u.o),
         ARRAY(SELECT a.attname::text
                 FROM unnest(CASE WHEN cardinality(k.confdelsetcols) > 0 THEN k.confdelsetcols ELSE k.conkey END) WITH ORDINALITY u(n, o)
                 JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY u.o)
    FROM pg_constraint k
   WHERE k.contype = 'f'
     AND k.connamespace = 'public'::regnamespace
$$;

-- O fecho TRANSITIVO do CASCADE a partir da ficha, por tabela, sem repetir
-- linha. Tabela alcançada que não está declarada recusa.
CREATE OR REPLACE FUNCTION public.cb_lixeira_fotografar(p_contato uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_trat jsonb := cb_lixeira_tratamento();
  v_foto jsonb;
  -- Quantas linhas a mãe tinha quando cada FK foi consultada: o fecho só
  -- cresce, então a mesma contagem é o mesmo conjunto (nada novo a buscar).
  v_vistas jsonb := '{}'::jsonb;
  v_fk record;
  v_novas jsonb;
  v_mudou boolean;
  v_volta integer := 0;
  v_filha text;
  v_mae text;
BEGIN
  SELECT jsonb_build_object('contacts', coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb))
    INTO v_foto FROM contacts c WHERE c.id = p_contato;

  LOOP
    v_volta := v_volta + 1;
    IF v_volta > 10 THEN
      RAISE EXCEPTION 'lixeira_fecho_sem_fim' USING ERRCODE = 'P0001';
    END IF;
    v_mudou := false;
    FOR v_fk IN SELECT * FROM cb_lixeira_fks() f WHERE f.acao = 'c' ORDER BY f.conname LOOP
      v_mae := v_fk.mae::text;
      v_filha := v_fk.filha::text;
      CONTINUE WHEN NOT v_foto ? v_mae;
      CONTINUE WHEN jsonb_array_length(v_foto -> v_mae) = 0;
      CONTINUE WHEN (v_vistas ->> v_fk.conname)::int = jsonb_array_length(v_foto -> v_mae);
      v_vistas := v_vistas || jsonb_build_object(v_fk.conname, jsonb_array_length(v_foto -> v_mae));
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(to_jsonb(f)), ''[]''::jsonb) FROM %s f WHERE (%s) IN (SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1) m)',
        v_fk.filha,
        (SELECT string_agg('f.' || quote_ident(c), ', ') FROM unnest(v_fk.cols) c),
        (SELECT string_agg('m.' || quote_ident(c), ', ') FROM unnest(v_fk.refs) c),
        v_fk.mae)
      INTO v_novas USING v_foto -> v_mae;
      IF jsonb_array_length(v_novas) = 0 THEN
        CONTINUE;
      END IF;
      IF NOT (v_trat -> 'fecho') ? v_filha THEN
        RAISE EXCEPTION 'lixeira_sem_tratamento:%', v_filha USING ERRCODE = 'P0001';
      END IF;
      v_novas := (SELECT jsonb_agg(DISTINCT e) FROM jsonb_array_elements(coalesce(v_foto -> v_filha, '[]'::jsonb) || v_novas) e);
      IF jsonb_array_length(v_novas) <> jsonb_array_length(coalesce(v_foto -> v_filha, '[]'::jsonb)) THEN
        v_mudou := true;
        v_foto := jsonb_set(v_foto, ARRAY[v_filha], v_novas);
      END IF;
    END LOOP;
    EXIT WHEN NOT v_mudou;
  END LOOP;
  RETURN v_foto;
END;
$$;

-- Os ponteiros que o DELETE anularia (FK SET NULL de linha FORA do fecho para
-- linha dentro dele): [{fk, tabela, cols, mae, refs, chave, modo, linhas:
-- [{pk, v, x}]}]. Ponteiro sem tratamento declarado recusa.
CREATE OR REPLACE FUNCTION public.cb_lixeira_ponteiros(p_foto jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_trat jsonb := cb_lixeira_tratamento();
  v_fk record;
  v_saida jsonb := '[]'::jsonb;
  v_linhas jsonb;
  v_chave text;
  v_pk text[];
  v_filha text;
  v_extras text[];
BEGIN
  FOR v_fk IN SELECT * FROM cb_lixeira_fks() f WHERE f.acao IN ('n', 'd') ORDER BY f.conname LOOP
    CONTINUE WHEN NOT p_foto ? v_fk.mae::text;
    CONTINUE WHEN jsonb_array_length(p_foto -> v_fk.mae::text) = 0;
    v_filha := v_fk.filha::text;
    v_pk := ARRAY(
      SELECT a.attname::text
        FROM pg_index i
        CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY u(n, o)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = u.n
       WHERE i.indrelid = v_fk.filha AND i.indisprimary
       ORDER BY u.o);
    IF cardinality(v_pk) = 0 THEN
      RAISE EXCEPTION 'lixeira_sem_tratamento:%:sem_chave', v_filha USING ERRCODE = 'P0001';
    END IF;
    v_extras := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_trat -> 'extras' -> v_filha, '[]'::jsonb)));
    EXECUTE format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(''pk'', jsonb_build_object(%s), ''v'', jsonb_build_object(%s), ''x'', jsonb_build_object(%s))), ''[]''::jsonb)
         FROM %s f
        WHERE (%s) IN (SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1) m)
          AND NOT ((%s) IN (SELECT %s FROM jsonb_populate_recordset(NULL::%s, $2) d))',
      (SELECT string_agg(quote_literal(c) || ', f.' || quote_ident(c), ', ') FROM unnest(v_pk) c),
      (SELECT string_agg(quote_literal(c) || ', f.' || quote_ident(c), ', ') FROM unnest(v_fk.anula) c),
      coalesce((SELECT string_agg(quote_literal(c) || ', f.' || quote_ident(c), ', ') FROM unnest(v_extras) c), ''),
      v_fk.filha,
      (SELECT string_agg('f.' || quote_ident(c), ', ') FROM unnest(v_fk.cols) c),
      (SELECT string_agg('m.' || quote_ident(c), ', ') FROM unnest(v_fk.refs) c),
      v_fk.mae,
      (SELECT string_agg('f.' || quote_ident(c), ', ') FROM unnest(v_pk) c),
      (SELECT string_agg('d.' || quote_ident(c), ', ') FROM unnest(v_pk) c),
      v_fk.filha)
    INTO v_linhas
    USING p_foto -> v_fk.mae::text, coalesce(p_foto -> v_filha, '[]'::jsonb);
    CONTINUE WHEN jsonb_array_length(v_linhas) = 0;

    v_chave := v_filha || '.' || array_to_string(v_fk.anula, ',');
    IF NOT (v_trat -> 'ponteiros') ? v_chave THEN
      RAISE EXCEPTION 'lixeira_sem_tratamento:%', v_chave USING ERRCODE = 'P0001';
    END IF;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'fk', v_fk.conname, 'tabela', v_filha, 'cols', to_jsonb(v_fk.cols),
      'anula', to_jsonb(v_fk.anula), 'mae', v_fk.mae::text, 'refs', to_jsonb(v_fk.refs),
      'pk', to_jsonb(v_pk), 'chave', v_chave, 'modo', v_trat -> 'ponteiros' ->> v_chave,
      'linhas', v_linhas));
  END LOOP;
  RETURN v_saida;
END;
$$;

-- Os caminhos do `chat-media` que a fotografia cita, já pela guarda e pelo
-- prefixo de cada origem: mensagem e agendada na conta (fora de `avatares/`,
-- `notas/` e `acervo/`), a foto só em `avatares/`, o anexo de anotação só em
-- `notas/` (ausente enquanto o plano irmão não estiver no `main`).
CREATE OR REPLACE FUNCTION public.cb_lixeira_arquivos(p_foto jsonb, p_conta uuid)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH brutos AS (
    SELECT cb_caminho_no_chat_media(m ->> 'media_url', p_conta) AS c, 'raiz' AS origem
      FROM jsonb_array_elements(coalesce(p_foto -> 'messages', '[]'::jsonb)) m
    UNION ALL
    SELECT cb_caminho_no_chat_media(a ->> 'media_path', p_conta), 'raiz'
      FROM jsonb_array_elements(coalesce(p_foto -> 'cb_scheduled_messages', '[]'::jsonb)) a
    UNION ALL
    SELECT cb_caminho_no_chat_media(a ->> 'media_url', p_conta), 'raiz'
      FROM jsonb_array_elements(coalesce(p_foto -> 'cb_scheduled_messages', '[]'::jsonb)) a
    UNION ALL
    SELECT cb_caminho_no_chat_media(c ->> 'avatar_url', p_conta), 'avatares'
      FROM jsonb_array_elements(coalesce(p_foto -> 'contacts', '[]'::jsonb)) c
    UNION ALL
    SELECT cb_caminho_no_chat_media(x ->> 'caminho', p_conta), 'notas'
      FROM jsonb_array_elements(coalesce(p_foto -> 'cb_conversation_notes', '[]'::jsonb)) n
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(n -> 'anexos') = 'array' THEN n -> 'anexos' ELSE '[]'::jsonb END) x
  )
  SELECT coalesce(array_agg(DISTINCT b.c ORDER BY b.c), '{}')
    FROM brutos b
   WHERE b.c IS NOT NULL
     AND CASE b.origem
           WHEN 'avatares' THEN b.c LIKE 'account-' || p_conta::text || '/avatares/%'
           WHEN 'notas' THEN b.c LIKE 'account-' || p_conta::text || '/notas/%'
           ELSE b.c NOT LIKE 'account-' || p_conta::text || '/avatares/%'
                AND b.c NOT LIKE 'account-' || p_conta::text || '/notas/%'
         END
$$;

-- Reinsere as linhas de UMA tabela da fotografia. A lista de colunas é
-- (colunas não geradas do catálogo) ∩ (chaves do JSON): coluna nova fica com
-- o DEFAULT, as geradas de `contacts` ficam de fora. Cada FK que sai da
-- tabela segue o próprio ON DELETE quando o alvo sumiu em 90 dias: SET NULL
-- anula só as colunas dele, CASCADE descarta a linha, RESTRICT/NO ACTION
-- descarta e relata. Erro de forma (NOT NULL novo, CHECK, tipo) vira
-- `lixeira_schema_mudou:<tabela>`, nunca o erro cru.
CREATE OR REPLACE FUNCTION public.cb_lixeira_reinserir(p_tabela regclass, p_linhas jsonb, p_estrita boolean)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_linhas jsonb := coalesce(p_linhas, '[]'::jsonb);
  v_total integer := jsonb_array_length(coalesce(p_linhas, '[]'::jsonb));
  v_fk record;
  v_ruins bigint[];
  v_auto boolean;
  v_cols text;
  v_sumidas text[];
  v_n integer := 0;
  v_fks jsonb := '{}'::jsonb;
BEGIN
  IF v_total = 0 THEN
    RETURN jsonb_build_object('total', 0, 'inseridas', 0);
  END IF;

  -- A auto-referência por último: a mãe pode estar no próprio lote.
  FOR v_fk IN
    SELECT f.*, (f.mae = f.filha) AS auto FROM cb_lixeira_fks() f
     WHERE f.filha = p_tabela ORDER BY (f.mae = f.filha), f.conname
  LOOP
    EXECUTE format(
      'SELECT coalesce(array_agg(e.i), ''{}'') FROM jsonb_array_elements($1) WITH ORDINALITY e(r, i),
         LATERAL jsonb_populate_record(NULL::%1$s, e.r) x
        WHERE %2$s AND NOT EXISTS (SELECT 1 FROM %3$s m WHERE %4$s) %5$s',
      p_tabela,
      (SELECT string_agg('x.' || quote_ident(c) || ' IS NOT NULL', ' AND ') FROM unnest(v_fk.cols) c),
      v_fk.mae,
      (SELECT string_agg('m.' || quote_ident(r) || ' = x.' || quote_ident(c), ' AND ')
         FROM unnest(v_fk.cols, v_fk.refs) AS p(c, r)),
      CASE WHEN v_fk.auto THEN format(
        'AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1) e2, LATERAL jsonb_populate_record(NULL::%s, e2) y WHERE %s)',
        p_tabela,
        (SELECT string_agg('y.' || quote_ident(r) || ' = x.' || quote_ident(c), ' AND ')
           FROM unnest(v_fk.cols, v_fk.refs) AS p(c, r)))
      ELSE '' END)
    INTO v_ruins USING v_linhas;
    CONTINUE WHEN cardinality(v_ruins) = 0;

    IF v_fk.acao IN ('n', 'd') THEN
      v_linhas := (
        SELECT jsonb_agg(CASE WHEN e.i = ANY (v_ruins)
                              THEN e.r || (SELECT jsonb_object_agg(c, NULL) FROM unnest(v_fk.anula) c)
                              ELSE e.r END ORDER BY e.i)
          FROM jsonb_array_elements(v_linhas) WITH ORDINALITY e(r, i));
      v_fks := v_fks || jsonb_build_object(v_fk.conname, jsonb_build_object('acao', 'anulada', 'n', cardinality(v_ruins)));
    ELSE
      v_linhas := coalesce((
        SELECT jsonb_agg(e.r ORDER BY e.i)
          FROM jsonb_array_elements(v_linhas) WITH ORDINALITY e(r, i)
         WHERE NOT (e.i = ANY (v_ruins))), '[]'::jsonb);
      v_fks := v_fks || jsonb_build_object(v_fk.conname, jsonb_build_object(
        'acao', CASE WHEN v_fk.acao = 'c' THEN 'descartada' ELSE 'restrita' END,
        'n', cardinality(v_ruins), 'alvo', v_fk.mae::text));
    END IF;
  END LOOP;

  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = p_tabela AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_linhas) e WHERE e ? a.attname);
  SELECT coalesce(array_agg(DISTINCT k ORDER BY k), '{}')
    INTO v_sumidas
    FROM jsonb_array_elements(v_linhas) e, jsonb_object_keys(e) k
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = p_tabela AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);

  IF jsonb_array_length(v_linhas) > 0 THEN
    BEGIN
      EXECUTE format(
        'INSERT INTO %s (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::%s, $1) %s',
        p_tabela, v_cols, v_cols, p_tabela,
        CASE WHEN p_estrita THEN '' ELSE 'ON CONFLICT DO NOTHING' END)
      USING v_linhas;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    EXCEPTION
      WHEN not_null_violation OR check_violation OR invalid_text_representation
           OR datatype_mismatch OR string_data_right_truncation OR numeric_value_out_of_range
           OR invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN
        RAISE EXCEPTION 'lixeira_schema_mudou:%', p_tabela::text
          USING ERRCODE = 'P0001', DETAIL = SQLERRM;
    END;
  END IF;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'total', v_total,
    'inseridas', v_n,
    'fks', CASE WHEN v_fks = '{}'::jsonb THEN NULL ELSE v_fks END,
    'colunas_sumidas', CASE WHEN cardinality(v_sumidas) = 0 THEN NULL ELSE to_jsonb(v_sumidas) END));
END;
$$;

-- Reaponta UM grupo de ponteiros (só os que ainda estão nulos, só para alvo
-- que existe). As condições próprias de cada modo vêm do desenho (tabela do
-- plano, "Reaponta com condição").
CREATE OR REPLACE FUNCTION public.cb_lixeira_reapontar(p jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tabela text := p ->> 'tabela';
  v_cols text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'cols'));
  v_refs text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'refs'));
  v_anula text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'anula'));
  v_pk text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'pk'));
  v_extra text;
  v_n integer;
BEGIN
  IF to_regclass('public.' || quote_ident(v_tabela)) IS NULL
     OR to_regclass('public.' || quote_ident(p ->> 'mae')) IS NULL THEN
    RETURN 0;
  END IF;
  v_extra := CASE p ->> 'modo'
    WHEN 'asaas_cliente' THEN 'AND f.vinculo_origem IS NOT DISTINCT FROM (e.r -> ''x'' ->> ''vinculo_origem'')'
    WHEN 'asaas_regua' THEN 'AND EXISTS (SELECT 1 FROM cb_asaas_clientes ac WHERE ac.account_id = f.account_id AND ac.asaas_customer_id = f.asaas_customer_id AND ac.contact_id = p.contact_id)'
    WHEN 'disparo' THEN 'AND f.status IN (''sent'', ''delivered'', ''read'', ''replied'')'
    ELSE ''
  END;
  EXECUTE format(
    'UPDATE %1$s f SET (%2$s) = ROW(%3$s)
       FROM jsonb_array_elements($1) AS e(r), LATERAL jsonb_populate_record(NULL::%1$s, (e.r -> ''pk'') || (e.r -> ''v'')) p
      WHERE %4$s AND %5$s AND EXISTS (SELECT 1 FROM %6$s m WHERE %7$s) %8$s',
    ('public.' || quote_ident(v_tabela))::regclass,
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_anula) c),
    (SELECT string_agg('p.' || quote_ident(c), ', ') FROM unnest(v_anula) c),
    (SELECT string_agg('f.' || quote_ident(c) || ' = p.' || quote_ident(c), ' AND ') FROM unnest(v_pk) c),
    (SELECT string_agg('f.' || quote_ident(c) || ' IS NULL', ' AND ') FROM unnest(v_anula) c),
    ('public.' || quote_ident(p ->> 'mae'))::regclass,
    (SELECT string_agg('m.' || quote_ident(r) || ' = '
                       || CASE WHEN c = ANY (v_anula) THEN 'p.' ELSE 'f.' END || quote_ident(c), ' AND ')
       FROM unnest(v_cols, v_refs) AS x(c, r)),
    v_extra)
  USING p -> 'linhas';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Anula UM grupo de ponteiros ANTES do DELETE, linha a linha pela chave.
-- ⚠️ Não é enfeite: deixado ao CASCADE, o Postgres anula `flow_runs`
-- (contato, conversa e última pergunta do robô) em três passos e confere a
-- FK da pergunta ENTRE eles, quando a mensagem já saiu — o DELETE estoura com
-- 23503 (medido no descartável em 23/10/2026; a exclusão de hoje tem o mesmo
-- defeito). Anulado aqui, o CASCADE não tem o que anular.
CREATE OR REPLACE FUNCTION public.cb_lixeira_anular(p jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tabela regclass := ('public.' || quote_ident(p ->> 'tabela'))::regclass;
  v_anula text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'anula'));
  v_pk text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'pk'));
  v_n integer;
BEGIN
  EXECUTE format(
    'UPDATE %1$s f SET (%2$s) = ROW(%3$s)
       FROM jsonb_array_elements($1) AS e(r), LATERAL jsonb_populate_record(NULL::%1$s, e.r -> ''pk'') k
      WHERE %4$s',
    v_tabela,
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_anula) c),
    (SELECT string_agg('NULL', ', ') FROM unnest(v_anula) c),
    (SELECT string_agg('f.' || quote_ident(c) || ' = k.' || quote_ident(c), ' AND ') FROM unnest(v_pk) c))
  USING p -> 'linhas';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Todo gatilho das tabelas que a restauração escreve tem de estar declarado;
-- o calado tem de ter o WHEN do sinal (um merge do upstream que recrie o
-- `set_updated_at` sem ele faz a restauração recusar, nunca fazer barulho).
CREATE OR REPLACE FUNCTION public.cb_lixeira_conferir_gatilhos()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_trat jsonb := cb_lixeira_tratamento();
  v_tabelas text[];
  v_g record;
BEGIN
  v_tabelas := ARRAY(
    SELECT k FROM jsonb_each_text(v_trat -> 'fecho') AS x(k, v) WHERE v <> 'nao_volta'
    UNION
    SELECT split_part(k, '.', 1) FROM jsonb_each_text(v_trat -> 'ponteiros') AS x(k, v) WHERE v <> 'nao_reaponta');
  FOR v_g IN
    SELECT c.relname::text AS tabela, t.tgname::text AS nome, pg_get_triggerdef(t.oid) AS def
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
       AND c.relname = ANY (v_tabelas)
  LOOP
    IF (v_trat -> 'calados') ? (v_g.tabela || '.' || v_g.nome) THEN
      IF position('NULLIF(current_setting(''cb.lixeira''::text, true), ''''::text) IS NULL' IN v_g.def) = 0 THEN
        RAISE EXCEPTION 'lixeira_gatilho_sem_sinal:%.%', v_g.tabela, v_g.nome USING ERRCODE = 'P0001';
      END IF;
    ELSIF NOT (v_trat -> 'livres') ? (v_g.tabela || '.' || v_g.nome) THEN
      RAISE EXCEPTION 'lixeira_sem_tratamento:gatilho:%.%', v_g.tabela, v_g.nome USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 8) Mover para a Lixeira
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_lixeira_mover_um(
  p_contato uuid, p_conta uuid, p_lote uuid, p_uid uuid, p_quem text
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ficha contacts;
  v_foto jsonb;
  v_ponteiros jsonb;
  v_item uuid;
  v_negocios uuid[];
  v_contagens jsonb;
BEGIN
  -- Travas: as CONVERSAS primeiro, depois a ficha (a ordem dos gatilhos, como
  -- a união), e de novo a conversa criada entre as duas.
  PERFORM 1 FROM conversations c WHERE c.contact_id = p_contato ORDER BY c.id FOR UPDATE;
  SELECT * INTO v_ficha FROM contacts WHERE id = p_contato FOR UPDATE;
  IF v_ficha.id IS NULL THEN
    RETURN 'sumiu';
  END IF;
  IF v_ficha.account_id <> p_conta THEN
    RAISE EXCEPTION 'contas_diferentes' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM conversations c WHERE c.contact_id = p_contato ORDER BY c.id FOR UPDATE;

  -- O que está vivo PARA, no molde da união (1093): restaurar não religa.
  -- Corrige também o defeito de hoje (a espera da ficha apagada seguia
  -- rodando com contato nulo).
  UPDATE automation_logs l
     SET interrompida_em = now(),
         interrompida_por = 'lixeira',
         finalizado_em = CASE WHEN l.desfecho = 'falhou' THEN now() ELSE l.finalizado_em END
   WHERE l.account_id = p_conta AND l.contact_id = p_contato
     AND l.finalizado_em IS NULL AND l.interrompida_em IS NULL;
  UPDATE automation_pending_executions e
     SET status = 'cancelled'
   WHERE e.account_id = p_conta AND e.contact_id = p_contato AND e.status = 'pending';
  UPDATE flow_runs r
     SET status = 'stopped_by_agent', ended_at = now(), end_reason = 'contato_na_lixeira'
   WHERE r.account_id = p_conta AND r.contact_id = p_contato AND r.status = 'active';

  v_foto := cb_lixeira_fotografar(p_contato);
  v_contagens := (
    SELECT jsonb_object_agg(k, jsonb_array_length(v))
      FROM jsonb_each(v_foto) AS x(k, v)
     WHERE jsonb_array_length(v) > 0);

  PERFORM set_config('cb.lixeira', 'movendo', true);
  -- O gatilho grava `contact_trashed` com a ficha ainda de pé: o ponteiro da
  -- trilha entra na conta abaixo e volta com a ficha.
  INSERT INTO cb_lixeira_de_contatos (
    account_id, contact_id, lote_id, nome, telefone, email, instagram_username, wa_username,
    telefone_canonico, phone_normalized, wa_user_id, instagram_id,
    movida_por, movida_por_nome, contagens, arquivos, fotografia
  ) VALUES (
    p_conta, p_contato, p_lote, v_ficha.name, v_ficha.phone, v_ficha.email,
    v_ficha.instagram_username, v_ficha.wa_username,
    nullif(v_ficha.telefone_canonico, ''), nullif(v_ficha.phone_normalized, ''),
    v_ficha.wa_user_id, v_ficha.instagram_id,
    p_uid, p_quem, coalesce(v_contagens, '{}'::jsonb),
    cb_lixeira_arquivos(v_foto, p_conta), v_foto
  ) RETURNING id INTO v_item;

  v_ponteiros := cb_lixeira_ponteiros(v_foto);
  v_negocios := ARRAY(
    SELECT DISTINCT (l -> 'pk' ->> 'id')::uuid
      FROM jsonb_array_elements(v_ponteiros) p, jsonb_array_elements(p -> 'linhas') l
     WHERE p ->> 'tabela' = 'deals');
  UPDATE cb_lixeira_de_contatos
     SET ponteiros = v_ponteiros, negocios = v_negocios
   WHERE id = v_item;

  PERFORM cb_lixeira_anular(p) FROM jsonb_array_elements(v_ponteiros) p;
  DELETE FROM contacts WHERE id = p_contato;
  PERFORM set_config('cb.lixeira', '', true);
  RETURN 'movida';
END;
$$;

-- A porta do admin. Recusa o LOTE INTEIRO se um id for de conta onde quem
-- chama não é admin (membro de várias contas). Por ficha: `movida`, `sumiu`
-- ou `recusada` (com o código: 55P03 trava, 40P01 deadlock, P0001 regra).
CREATE OR REPLACE FUNCTION public.cb_mover_contatos_para_lixeira(p_ids uuid[], p_lote uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote uuid := coalesce(p_lote, gen_random_uuid());
  v_ids uuid[];
  v_contas uuid[];
  v_conta uuid;
  v_quem text;
  v_quems jsonb := '{}'::jsonb;
  v_id uuid;
  v_res text;
  v_itens jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL ORDER BY x);
  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object('lote_id', v_lote, 'itens', '[]'::jsonb);
  END IF;
  IF cardinality(v_ids) > 100 THEN
    RAISE EXCEPTION 'lote_grande_demais' USING ERRCODE = 'P0001';
  END IF;

  v_contas := ARRAY(SELECT DISTINCT c.account_id FROM contacts c WHERE c.id = ANY (v_ids));
  FOREACH v_conta IN ARRAY v_contas LOOP
    IF NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
      RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
    END IF;
    -- O nome de quem moveu, congelado no item (1067: a leitura ignora a RLS,
    -- então repete a suspensão).
    SELECT coalesce(nullif(p.full_name, ''), p.email) INTO v_quem
      FROM profiles p
     WHERE p.user_id = v_uid AND p.account_id = v_conta AND p.suspenso_em IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
    END IF;
    v_quems := v_quems || jsonb_build_object(v_conta::text, v_quem);
  END LOOP;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT c.account_id INTO v_conta FROM contacts c WHERE c.id = v_id;
    IF v_conta IS NULL THEN
      v_itens := v_itens || jsonb_build_array(jsonb_build_object('id', v_id, 'resultado', 'sumiu'));
      CONTINUE;
    END IF;
    -- A conta de cada ficha foi conferida ANTES do laço: um id de outra conta
    -- que voltou da Lixeira de lá no meio do caminho não entra sem a porta.
    IF NOT (v_conta = ANY (v_contas)) THEN
      v_itens := v_itens || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'resultado', 'recusada', 'codigo', '42501', 'motivo', 'so_admin'));
      CONTINUE;
    END IF;
    BEGIN
      v_res := cb_lixeira_mover_um(v_id, v_conta, v_lote, v_uid, v_quems ->> v_conta::text);
      v_itens := v_itens || jsonb_build_array(jsonb_build_object('id', v_id, 'resultado', v_res));
    EXCEPTION
      WHEN lock_not_available OR deadlock_detected OR foreign_key_violation OR SQLSTATE 'P0001' THEN
        v_itens := v_itens || jsonb_build_array(jsonb_build_object(
          'id', v_id, 'resultado', 'recusada', 'codigo', SQLSTATE, 'motivo', SQLERRM));
    END;
  END LOOP;
  PERFORM set_config('cb.lixeira', '', true);
  RETURN jsonb_build_object('lote_id', v_lote, 'itens', v_itens);
END;
$$;

-- A PRÉVIA (só leitura): o que mover cancela de COLEGAS.
CREATE OR REPLACE FUNCTION public.cb_previa_da_lixeira(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conta uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  FOR v_conta IN SELECT DISTINCT c.account_id FROM contacts c WHERE c.id = ANY (p_ids) LOOP
    IF NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
      RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'nome', coalesce(nullif(c.name, ''), c.phone, c.instagram_username),
      'mensagens', (SELECT count(*) FROM messages m JOIN conversations v ON v.id = m.conversation_id
                     WHERE v.contact_id = c.id),
      'agendadas', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('autor', a.autor_nome, 'quando', a.scheduled_for)
                                  ORDER BY a.scheduled_for), '[]'::jsonb)
          FROM cb_scheduled_messages a JOIN conversations v ON v.id = a.conversation_id
         WHERE v.contact_id = c.id AND a.status IN ('pending', 'sending')),
      'esperas', (SELECT count(*) FROM automation_pending_executions e
                   WHERE e.account_id = c.account_id AND e.contact_id = c.id AND e.status = 'pending'),
      'robos', (SELECT count(*) FROM flow_runs r
                 WHERE r.account_id = c.account_id AND r.contact_id = c.id AND r.status = 'active'),
      'tarefas', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('titulo', t.titulo, 'responsavel', t.responsavel_nome,
                                                     'vence_em', t.vence_em) ORDER BY t.vence_em), '[]'::jsonb)
          FROM cb_tasks t
         WHERE t.account_id = c.account_id AND t.contact_id = c.id AND t.status = 'aberta'),
      'negocios', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('titulo', d.title, 'funil', pl.name, 'etapa', st.name)
                                  ORDER BY d.created_at), '[]'::jsonb)
          FROM deals d
          JOIN pipelines pl ON pl.id = d.pipeline_id
          JOIN pipeline_stages st ON st.id = d.stage_id
         WHERE d.account_id = c.account_id AND d.contact_id = c.id AND d.status = 'open'),
      'conversa', (
        SELECT jsonb_build_object('status', v.status, 'responsavel',
                 (SELECT coalesce(nullif(p.full_name, ''), p.email) FROM profiles p
                   WHERE p.user_id = v.assigned_agent_id AND p.account_id = v.account_id LIMIT 1))
          FROM conversations v WHERE v.contact_id = c.id LIMIT 1)
    ) ORDER BY c.name)
      FROM contacts c
     WHERE c.id = ANY (p_ids)
  ), '[]'::jsonb);
END;
$$;

-- ------------------------------------------------------------
-- 9) Restaurar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_lixeira_restaurar_um(p_item uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_trat jsonb := cb_lixeira_tratamento();
  v cb_lixeira_de_contatos;
  v_dono uuid;
  v_ocupada record;
  v_foto jsonb;
  v_tabela text;
  v_linhas jsonb;
  v_rel jsonb := '{}'::jsonb;
  v_ponteiros jsonb := '{}'::jsonb;
  v_p jsonb;
  v_n integer;
  v_linha jsonb;
  v_outra uuid;
  v_unida uuid;
  v_outro_item uuid;
  v_pares jsonb;
  v_col_a text;
  v_col_b text;
  v_eu_a boolean;
  v_pares_para_lixeira integer := 0;
  v_extra jsonb := '{}'::jsonb;
BEGIN
  -- ── Tudo o que pode recusar vem ANTES de escrever ──
  SELECT * INTO v FROM cb_lixeira_de_contatos WHERE id = p_item FOR UPDATE NOWAIT;
  IF v.id IS NULL THEN
    RETURN jsonb_build_object('item_id', p_item, 'resultado', 'sumiu');
  END IF;
  SELECT a.owner_user_id INTO v_dono FROM accounts a WHERE a.id = v.account_id;

  -- B2: a identidade já está em uso por outra ficha → bloqueia.
  SELECT c.id, coalesce(nullif(c.name, ''), c.phone, c.instagram_username) AS nome
    INTO v_ocupada
    FROM contacts c
   WHERE c.account_id = v.account_id
     AND ((v.telefone_canonico IS NOT NULL AND c.telefone_canonico = v.telefone_canonico)
          OR (v.phone_normalized IS NOT NULL AND c.phone_normalized = v.phone_normalized)
          OR (v.wa_user_id IS NOT NULL AND c.wa_user_id = v.wa_user_id)
          OR (v.instagram_id IS NOT NULL AND c.instagram_id = v.instagram_id))
   ORDER BY c.created_at
   LIMIT 1;
  IF v_ocupada.id IS NOT NULL THEN
    RETURN jsonb_build_object('item_id', p_item, 'contact_id', v.contact_id, 'resultado', 'recusada',
                              'codigo', 'identidade_ocupada', 'ocupada_por', v_ocupada.id,
                              'ocupada_por_nome', v_ocupada.nome);
  END IF;
  PERFORM cb_lixeira_conferir_gatilhos();

  v_foto := v.fotografia;

  -- ── Ajustes da volta, na fotografia ──
  -- Dono durável (8a) na ficha e na conversa; responsável que saiu da conta
  -- ou está suspenso volta nulo; a conversa já nasce com `restaurada_em`.
  v_foto := jsonb_set(v_foto, '{contacts}', coalesce((
    SELECT jsonb_agg(c || jsonb_build_object('user_id', v_dono, 'updated_at', now()))
      FROM jsonb_array_elements(v_foto -> 'contacts') c), '[]'::jsonb));
  IF v_foto ? 'conversations' THEN
    v_foto := jsonb_set(v_foto, '{conversations}', (
      SELECT jsonb_agg(c || jsonb_build_object(
               'user_id', v_dono,
               'restaurada_em', now(),
               'assigned_agent_id', CASE WHEN EXISTS (
                   SELECT 1 FROM profiles p
                    WHERE p.user_id = (c ->> 'assigned_agent_id')::uuid
                      AND p.account_id = v.account_id AND p.suspenso_em IS NULL)
                 THEN c -> 'assigned_agent_id' ELSE 'null'::jsonb END))
        FROM jsonb_array_elements(v_foto -> 'conversations') c));
  END IF;
  IF v_foto ? 'cb_tasks' THEN
    v_foto := jsonb_set(v_foto, '{cb_tasks}', (
      SELECT jsonb_agg(CASE WHEN t ->> 'responsavel_user_id' IS NOT NULL AND NOT EXISTS (
                         SELECT 1 FROM profiles p
                          WHERE p.user_id = (t ->> 'responsavel_user_id')::uuid
                            AND p.account_id = v.account_id AND p.suspenso_em IS NULL)
                       THEN t || '{"responsavel_user_id": null}'::jsonb ELSE t END)
        FROM jsonb_array_elements(v_foto -> 'cb_tasks') t));
  END IF;
  -- Agendada: nada sai sozinho, ninguém perde o que agendou. A que o worker já
  -- reivindicou (`sending`) PODE ter saído: falha incerta, sem reenvio.
  IF v_foto ? 'cb_scheduled_messages' THEN
    v_foto := jsonb_set(v_foto, '{cb_scheduled_messages}', (
      SELECT jsonb_agg(CASE a ->> 'status'
               WHEN 'pending' THEN a || jsonb_build_object(
                 'status', 'failed', 'entrega_incerta', false, 'sending_desde', NULL,
                 'error', 'Voltou da Lixeira: a mensagem não saiu. Envie ou cancele.')
               WHEN 'sending' THEN a || jsonb_build_object(
                 'status', 'failed', 'entrega_incerta', true,
                 'error', 'Estava saindo quando a ficha foi para a Lixeira: PODE ter chegado ao cliente. Confira a conversa antes de enviar de novo.')
               ELSE a END)
        FROM jsonb_array_elements(v_foto -> 'cb_scheduled_messages') a));
  END IF;

  -- Pares (Relacionados, "não é duplicata"): a outra ponta viva → volta;
  -- unida → segue o livro; ainda na Lixeira → a linha passa para a
  -- fotografia daquele item; apagada de vez → a FK descarta e relata.
  FOREACH v_tabela IN ARRAY ARRAY['cb_contatos_relacionados', 'cb_duplicatas_descartadas'] LOOP
    CONTINUE WHEN NOT v_foto ? v_tabela;
    IF v_tabela = 'cb_contatos_relacionados' THEN
      v_col_a := 'contact_a_id'; v_col_b := 'contact_b_id';
    ELSE
      v_col_a := 'contato_menor'; v_col_b := 'contato_maior';
    END IF;
    v_pares := '[]'::jsonb;
    FOR v_linha IN SELECT e FROM jsonb_array_elements(v_foto -> v_tabela) e LOOP
      v_eu_a := (v_linha ->> v_col_a)::uuid = v.contact_id;
      v_outra := (v_linha ->> CASE WHEN v_eu_a THEN v_col_b ELSE v_col_a END)::uuid;
      IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = v_outra) THEN
        SELECT u.ficha_que_fica INTO v_unida
          FROM cb_fichas_unidas u
         WHERE u.account_id = v.account_id AND u.ficha_removida = v_outra
         ORDER BY u.unida_em DESC NULLS LAST LIMIT 1;
        IF v_unida IS NOT NULL AND v_unida <> v.contact_id THEN
          v_outra := v_unida;
          v_linha := v_linha || CASE WHEN v_eu_a
                                     THEN jsonb_build_object(v_col_b, v_outra)
                                     ELSE jsonb_build_object(v_col_a, v_outra) END;
          IF v_tabela = 'cb_duplicatas_descartadas' THEN
            v_linha := v_linha || jsonb_build_object(
              'contato_menor', least(v.contact_id, v_outra), 'contato_maior', greatest(v.contact_id, v_outra));
          END IF;
        ELSIF v_unida = v.contact_id THEN
          CONTINUE;  -- ligaria a ficha a si mesma
        ELSE
          SELECT x.id INTO v_outro_item FROM cb_lixeira_de_contatos x
           WHERE x.account_id = v.account_id AND x.contact_id = v_outra;
          IF v_outro_item IS NOT NULL THEN
            UPDATE cb_lixeira_de_contatos x
               SET fotografia = jsonb_set(x.fotografia, ARRAY[v_tabela],
                                          coalesce(x.fotografia -> v_tabela, '[]'::jsonb) || jsonb_build_array(v_linha))
             WHERE x.id = v_outro_item
               AND NOT coalesce(x.fotografia -> v_tabela, '[]'::jsonb) @> jsonb_build_array(v_linha);
            v_pares_para_lixeira := v_pares_para_lixeira + 1;
            CONTINUE;
          END IF;
        END IF;
      END IF;
      v_pares := v_pares || jsonb_build_array(v_linha);
    END LOOP;
    v_foto := jsonb_set(v_foto, ARRAY[v_tabela], v_pares);
  END LOOP;

  -- ── A volta, com os gatilhos calados pelo sinal ──
  PERFORM set_config('cb.lixeira', 'restaurando', true);
  FOR v_tabela IN SELECT jsonb_array_elements_text(v_trat -> 'ordem') LOOP
    CONTINUE WHEN NOT v_foto ? v_tabela;
    IF to_regclass('public.' || v_tabela) IS NULL THEN
      v_rel := v_rel || jsonb_build_object(v_tabela, jsonb_build_object('tabela_sumiu', true));
      CONTINUE;
    END IF;
    v_rel := v_rel || jsonb_build_object(v_tabela, cb_lixeira_reinserir(
      ('public.' || v_tabela)::regclass, v_foto -> v_tabela, v_tabela IN ('contacts', 'conversations')));
  END LOOP;
  -- Tabela da fotografia que não está mais na ordem (o tratamento mudou).
  v_rel := v_rel || coalesce((
    SELECT jsonb_object_agg(k, jsonb_build_object('fora_da_volta', jsonb_array_length(x)))
      FROM jsonb_each(v_foto) AS e(k, x)
     WHERE jsonb_array_length(x) > 0
       AND NOT (v_trat -> 'ordem') @> to_jsonb(k)
       AND coalesce(v_trat -> 'fecho' ->> k, '') <> 'nao_volta'), '{}'::jsonb);

  -- Os ponteiros: só os que ainda estão nulos, na ordem dos modos (a régua
  -- do Asaas depende do cliente do Asaas que voltou).
  FOR v_p IN
    SELECT p FROM jsonb_array_elements(v.ponteiros) p
     WHERE p ->> 'modo' <> 'nao_reaponta'
     ORDER BY CASE p ->> 'modo' WHEN 'reaponta' THEN 1 WHEN 'asaas_cliente' THEN 2
                                WHEN 'asaas_regua' THEN 3 ELSE 4 END, p ->> 'chave'
  LOOP
    v_n := cb_lixeira_reapontar(v_p);
    v_ponteiros := v_ponteiros || jsonb_build_object(v_p ->> 'chave', jsonb_build_object(
      'total', jsonb_array_length(v_p -> 'linhas'),
      'reapontados', v_n + coalesce((v_ponteiros -> (v_p ->> 'chave') ->> 'reapontados')::int, 0)));
  END LOOP;

  -- O cancelamento do Calendly chegado durante a Lixeira (sem ficha): religado
  -- pelo convite, para a varredura dos lembretes não avisar reunião cancelada.
  UPDATE cb_calendly_eventos x
     SET contact_id = v.contact_id
   WHERE x.account_id = v.account_id AND x.contact_id IS NULL
     AND x.evento = 'invitee.canceled' AND x.recebido_em >= v.movida_em
     AND x.invitee_uri IN (SELECT y.invitee_uri FROM cb_calendly_eventos y
                            WHERE y.account_id = v.account_id AND y.contact_id = v.contact_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    v_extra := v_extra || jsonb_build_object('cancelamentos_religados', v_n);
  END IF;

  -- B4: o que rodou sem a ficha enquanto ela estava na Lixeira.
  v_extra := v_extra || jsonb_build_object(
    'movimentos_sem_automacao', (
      SELECT count(*) FROM cb_automation_events ev
       WHERE ev.account_id = v.account_id AND ev.deal_id = ANY (v.negocios)
         AND ev.criado_em >= v.movida_em),
    'zapsign_sem_contato', (
      SELECT count(*) FROM cb_zapsign_eventos z
       WHERE z.account_id = v.account_id AND z.resultado = 'sem_contato'
         AND z.recebido_em >= v.movida_em),
    'agendadas_em_falha', (
      SELECT count(*) FROM jsonb_array_elements(coalesce(v.fotografia -> 'cb_scheduled_messages', '[]'::jsonb)) a
       WHERE a ->> 'status' IN ('pending', 'sending')),
    'pares_para_a_lixeira', v_pares_para_lixeira);

  -- A conversa: UM UPDATE que reassenta a linha nas abas abertas (o tempo
  -- real leva `restaurada_em`); `set_updated_at` e a trilha calados.
  UPDATE conversations SET restaurada_em = now() WHERE contact_id = v.contact_id;

  -- A linha da Lixeira sai; o gatilho grava `contact_restored`.
  DELETE FROM cb_lixeira_de_contatos WHERE id = v.id;
  PERFORM set_config('cb.lixeira', '', true);

  IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = v.contact_id) THEN
    RAISE EXCEPTION 'lixeira_ficha_nao_voltou' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'item_id', v.id, 'contact_id', v.contact_id, 'resultado', 'restaurada',
    'relatorio', jsonb_build_object('tabelas', v_rel, 'ponteiros', v_ponteiros) || v_extra);
END;
$$;

-- A porta do admin: itens escolhidos OU um lote inteiro (o "Desfazer").
CREATE OR REPLACE FUNCTION public.cb_restaurar_da_lixeira(p_itens uuid[] DEFAULT NULL, p_lote uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_itens uuid[];
  v_conta uuid;
  v_item uuid;
  v_res jsonb;
  v_saida jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  v_itens := ARRAY(
    SELECT x.id FROM cb_lixeira_de_contatos x
     WHERE (p_itens IS NOT NULL AND x.id = ANY (p_itens))
        OR (p_lote IS NOT NULL AND x.lote_id = p_lote)
     ORDER BY x.movida_em, x.id);
  FOR v_conta IN SELECT DISTINCT x.account_id FROM cb_lixeira_de_contatos x WHERE x.id = ANY (v_itens) LOOP
    IF NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
      RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  -- Pedido por id que não está mais na Lixeira.
  v_saida := coalesce((
    SELECT jsonb_agg(jsonb_build_object('item_id', x, 'resultado', 'sumiu'))
      FROM unnest(coalesce(p_itens, '{}')) x WHERE NOT (x = ANY (v_itens))), '[]'::jsonb);

  FOREACH v_item IN ARRAY v_itens LOOP
    BEGIN
      v_res := cb_lixeira_restaurar_um(v_item);
    EXCEPTION
      WHEN lock_not_available THEN
        v_res := jsonb_build_object('item_id', v_item, 'resultado', 'recusada', 'codigo', 'em_processamento');
      WHEN deadlock_detected OR unique_violation OR foreign_key_violation OR SQLSTATE 'P0001' THEN
        v_res := jsonb_build_object('item_id', v_item, 'resultado', 'recusada', 'codigo', SQLSTATE,
                                    'motivo', SQLERRM);
    END;
    v_saida := v_saida || jsonb_build_array(v_res);
  END LOOP;
  PERFORM set_config('cb.lixeira', '', true);
  RETURN jsonb_build_object('itens', v_saida);
END;
$$;

-- ------------------------------------------------------------
-- 10) Excluir de vez: "Excluir agora" (admin) e o vencimento (servidor)
-- ------------------------------------------------------------
-- Um miolo, duas portas. Põe na fila os arquivos que a fotografia cita;
-- com o PEDIDO DE EXCLUSÃO (B3, proposta a confirmar com quem responde pela
-- LGPD), também: os dados dos eventos de webhook e do Calendly da ficha, o
-- contexto das execuções, as ligações e as mensagens retidas pelo telefone e
-- pelos LIDs, e o nome na trilha. Nunca afirma eliminação total: backups, a
-- Evolution e o que terceiros já baixaram ficam fora do alcance do CRM.
CREATE OR REPLACE FUNCTION public.cb_lixeira_purgar_um(p_item uuid, p_pedido boolean)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v cb_lixeira_de_contatos;
  v_arquivos integer;
  v_ids uuid[];
  v_telefones text[];
  v_lids text[];
BEGIN
  SELECT * INTO v FROM cb_lixeira_de_contatos WHERE id = p_item;
  IF v.id IS NULL THEN
    RETURN jsonb_build_object('item_id', p_item, 'resultado', 'sumiu');
  END IF;

  INSERT INTO cb_arquivos_a_apagar (account_id, bucket, caminho, origem)
  SELECT v.account_id, 'chat-media', a, 'lixeira'
    FROM unnest(v.arquivos) a
   WHERE cb_caminho_no_chat_media(a, v.account_id) = a
  ON CONFLICT (bucket, caminho) DO NOTHING;
  GET DIAGNOSTICS v_arquivos = ROW_COUNT;

  IF p_pedido THEN
    v_telefones := ARRAY(
      SELECT DISTINCT t FROM unnest(ARRAY[v.telefone, v.telefone_canonico, v.phone_normalized]) t
       WHERE coalesce(t, '') <> '');
    v_lids := ARRAY(
      SELECT DISTINCT m ->> 'remote_jid_lid'
        FROM jsonb_array_elements(coalesce(v.fotografia -> 'messages', '[]'::jsonb)) m
       WHERE coalesce(m ->> 'remote_jid_lid', '') <> '');

    -- Ids que ficaram com ponteiro nulo, por tabela.
    v_ids := ARRAY(SELECT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                     jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_webhook_eventos');
    UPDATE cb_webhook_eventos SET nome = NULL, telefone = NULL, variaveis = '{}'::jsonb
     WHERE id = ANY (v_ids) AND account_id = v.account_id;
    v_ids := ARRAY(SELECT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                     jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_calendly_eventos');
    -- E o mesmo convite chegado durante a Lixeira (o cancelamento sem ficha,
    -- que não estava entre os ponteiros anotados ao mover).
    UPDATE cb_calendly_eventos SET nome = NULL, email = NULL, telefone = NULL,
           perguntas = '[]'::jsonb, variaveis = '{}'::jsonb
     WHERE account_id = v.account_id
       AND (id = ANY (v_ids)
            OR invitee_uri IN (SELECT y.invitee_uri FROM cb_calendly_eventos y
                                WHERE y.id = ANY (v_ids) AND y.account_id = v.account_id));
    v_ids := ARRAY(SELECT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                     jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'automation_logs');
    UPDATE automation_logs SET steps_executed = '[]'::jsonb, error_message = NULL
     WHERE id = ANY (v_ids) AND account_id = v.account_id;
    v_ids := ARRAY(SELECT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                     jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_ligacoes');
    DELETE FROM cb_ligacoes
     WHERE account_id = v.account_id AND (id = ANY (v_ids) OR telefone = ANY (v_telefones));
    v_ids := ARRAY(SELECT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                     jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_mensagens_sem_telefone');
    DELETE FROM cb_mensagens_sem_telefone
     WHERE account_id = v.account_id AND (id = ANY (v_ids) OR lid_jid = ANY (v_lids));
    -- A trilha fica (912: apagar contato não apaga o rastro), sem o nome.
    v_ids := ARRAY(SELECT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                     jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_lead_events');
    UPDATE cb_lead_events
       SET contact_label = NULL,
           -- `contatos_antigos` e `divergencias` (da união, 1092) guardam
           -- telefones, e-mails e nomes antigos da pessoa.
           details = CASE WHEN details IS NULL THEN NULL
                          ELSE details - 'removida' - 'nome' - 'telefone' - 'email'
                                       - 'contatos_antigos' - 'divergencias' END
     WHERE id = ANY (v_ids) AND account_id = v.account_id;
  END IF;

  PERFORM set_config('cb.lixeira', 'purgando', true);
  PERFORM set_config('cb.lixeira_pedido', CASE WHEN p_pedido THEN 'sim' ELSE 'nao' END, true);
  DELETE FROM cb_lixeira_de_contatos WHERE id = v.id;
  PERFORM set_config('cb.lixeira', '', true);
  PERFORM set_config('cb.lixeira_pedido', '', true);

  RETURN jsonb_build_object('item_id', v.id, 'contact_id', v.contact_id, 'resultado', 'excluida',
                            'arquivos', v_arquivos, 'pedido_exclusao', p_pedido);
END;
$$;

CREATE OR REPLACE FUNCTION public.cb_excluir_da_lixeira(p_itens uuid[], p_pedido_exclusao boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conta uuid;
  v_item uuid;
  v_res jsonb;
  v_saida jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  FOR v_conta IN SELECT DISTINCT x.account_id FROM cb_lixeira_de_contatos x WHERE x.id = ANY (p_itens) LOOP
    IF NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
      RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  FOREACH v_item IN ARRAY ARRAY(SELECT DISTINCT x FROM unnest(p_itens) x WHERE x IS NOT NULL ORDER BY x) LOOP
    BEGIN
      PERFORM 1 FROM cb_lixeira_de_contatos WHERE id = v_item FOR UPDATE NOWAIT;
      v_res := cb_lixeira_purgar_um(v_item, coalesce(p_pedido_exclusao, false));
    EXCEPTION
      WHEN lock_not_available THEN
        v_res := jsonb_build_object('item_id', v_item, 'resultado', 'recusada', 'codigo', 'em_processamento');
    END;
    v_saida := v_saida || jsonb_build_array(v_res);
  END LOOP;
  PERFORM set_config('cb.lixeira', '', true);
  RETURN jsonb_build_object('itens', v_saida);
END;
$$;

-- O vencimento: UM item por chamada (o servidor repete sob o prazo do ciclo).
-- Só `service_role` (senão qualquer membro anteciparia o vencimento). Roda
-- como dono: as peças internas são fechadas até ao `service_role`.
CREATE OR REPLACE FUNCTION public.cb_vencer_lixeira()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item uuid;
BEGIN
  SELECT x.id INTO v_item FROM cb_lixeira_de_contatos x
   WHERE x.vence_em <= now()
   ORDER BY x.vence_em, x.id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF v_item IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN cb_lixeira_purgar_um(v_item, false);
END;
$$;

-- ------------------------------------------------------------
-- 11) Leituras da tela
-- ------------------------------------------------------------
-- A lista (só admin, nunca a fotografia), com a identidade ocupada (B2).
CREATE OR REPLACE FUNCTION public.cb_lixeira_da_conta(p_busca text DEFAULT NULL)
RETURNS TABLE (
  id uuid, account_id uuid, contact_id uuid, lote_id uuid, nome text, telefone text, email text,
  instagram_username text, wa_username text, movida_em timestamptz, movida_por_nome text,
  vence_em timestamptz, contagens jsonb, ocupada_por uuid, ocupada_por_nome text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.id, x.account_id, x.contact_id, x.lote_id, x.nome, x.telefone, x.email,
         x.instagram_username, x.wa_username, x.movida_em, x.movida_por_nome,
         x.vence_em, x.contagens, o.id, o.nome
    FROM cb_lixeira_de_contatos x
    LEFT JOIN LATERAL (
      SELECT c.id, coalesce(nullif(c.name, ''), c.phone, c.instagram_username) AS nome
        FROM contacts c
       WHERE c.account_id = x.account_id
         AND ((x.telefone_canonico IS NOT NULL AND c.telefone_canonico = x.telefone_canonico)
              OR (x.phone_normalized IS NOT NULL AND c.phone_normalized = x.phone_normalized)
              OR (x.wa_user_id IS NOT NULL AND c.wa_user_id = x.wa_user_id)
              OR (x.instagram_id IS NOT NULL AND c.instagram_id = x.instagram_id))
       ORDER BY c.created_at
       LIMIT 1
    ) o ON true
   WHERE x.account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))
     AND (coalesce(btrim(p_busca), '') = ''
          OR position(lower(btrim(p_busca)) IN lower(concat_ws(' ', x.nome, x.telefone, x.email,
                                                                x.instagram_username, x.wa_username))) > 0)
   ORDER BY x.movida_em DESC, x.id
$$;

-- Os cards cuja ficha está na Lixeira (B4). Qualquer membro: o card aparece a
-- todos. Só o nome, nunca a fotografia.
CREATE OR REPLACE FUNCTION public.cb_negocios_na_lixeira(p_negocios uuid[])
RETURNS TABLE (deal_id uuid, item_id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, x.id, coalesce(nullif(x.nome, ''), x.telefone, x.instagram_username)
    FROM deals d
    JOIN cb_lixeira_de_contatos x ON x.account_id = d.account_id AND x.negocios @> ARRAY[d.id]
   WHERE d.id = ANY (p_negocios)
     AND d.contact_id IS NULL
     AND d.account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))
$$;

-- Os arquivos que a fila não conseguiu apagar (a tela da Lixeira avisa).
CREATE OR REPLACE FUNCTION public.cb_arquivos_da_lixeira_parados()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'na_fila', count(*) FILTER (WHERE f.tentativas < 10),
    'parados', count(*) FILTER (WHERE f.tentativas >= 10))
    FROM cb_arquivos_a_apagar f
   WHERE f.origem = 'lixeira'
     AND f.account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))
$$;

-- ------------------------------------------------------------
-- 12) A drenagem da fila (servidor)
-- ------------------------------------------------------------
-- Quem cita um caminho NA HORA (a lista universal; o plano irmão acrescenta
-- os anexos de anotação). Caminho citado sai da fila sem apagar o arquivo:
-- quem cita enfileira de novo ao sair.
-- UMA varredura por tabela citadora para o lote inteiro (as mensagens não
-- têm índice na URL: varrer uma vez por arquivo multiplicaria o custo).
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
    -- As fotografias dos OUTROS itens da Lixeira (o purgado já saiu).
    SELECT c FROM unnest(p_caminhos) c
     WHERE EXISTS (SELECT 1 FROM cb_lixeira_de_contatos x WHERE x.arquivos @> ARRAY[c])
  )
  SELECT DISTINCT c FROM citados WHERE c = ANY (p_caminhos)
$$;

-- Reivindica um lote (carimbo ANTES do trabalho; a tentativa conta já aqui).
-- Como dono, aberta só ao `service_role` (a conferência de citações é interna).
-- Devolve só o que pode sair: caminho fora da guarda ou ainda citado sai da
-- fila sem apagar o arquivo.
CREATE OR REPLACE FUNCTION public.cb_reivindicar_arquivos_a_apagar(p_limite integer DEFAULT 25)
RETURNS TABLE (id uuid, account_id uuid, bucket text, caminho text, carimbo timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_carimbo timestamptz := clock_timestamp();
  v_ids uuid[];
  v_conta uuid;
BEGIN
  SELECT array_agg(s.id) INTO v_ids
    FROM (SELECT f.id FROM cb_arquivos_a_apagar f
           WHERE f.tentativas < 10
             AND (f.reivindicado_em IS NULL OR f.reivindicado_em < now() - interval '10 minutes')
           ORDER BY f.criado_em, f.id
           LIMIT greatest(1, least(coalesce(p_limite, 25), 100))
           FOR UPDATE SKIP LOCKED) s;
  IF v_ids IS NULL THEN
    RETURN;
  END IF;
  UPDATE cb_arquivos_a_apagar f
     SET reivindicado_em = v_carimbo, tentativas = f.tentativas + 1
   WHERE f.id = ANY (v_ids);

  -- Fora da guarda (a CHECK já barra o grosso) ou citado por alguém: sai da
  -- fila, o arquivo fica.
  DELETE FROM cb_arquivos_a_apagar f
   WHERE f.id = ANY (v_ids)
     AND cb_caminho_no_chat_media(f.caminho, f.account_id) IS DISTINCT FROM f.caminho;
  FOR v_conta IN SELECT DISTINCT f.account_id FROM cb_arquivos_a_apagar f WHERE f.id = ANY (v_ids) LOOP
    DELETE FROM cb_arquivos_a_apagar f
     WHERE f.id = ANY (v_ids) AND f.account_id = v_conta
       AND f.caminho IN (SELECT cb_arquivos_citados(v_conta, ARRAY(
             SELECT g.caminho FROM cb_arquivos_a_apagar g WHERE g.id = ANY (v_ids) AND g.account_id = v_conta)));
  END LOOP;

  RETURN QUERY
    SELECT f.id, f.account_id, f.bucket, f.caminho, f.reivindicado_em
      FROM cb_arquivos_a_apagar f
     WHERE f.id = ANY (v_ids)
     ORDER BY f.criado_em, f.id;
END;
$$;

-- ------------------------------------------------------------
-- 13) Quem executa o quê
-- ------------------------------------------------------------
-- As peças internas: ninguém de fora (as RPCs rodam como dono).
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_tratamento() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_fks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_fotografar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_ponteiros(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_arquivos(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_reinserir(regclass, jsonb, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_reapontar(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_anular(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_conferir_gatilhos() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_mover_um(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_restaurar_um(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_purgar_um(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_log_lixeira() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_arquivos_citados(uuid, text[]) FROM PUBLIC, anon, authenticated;
-- O servidor: vencimento e drenagem.
REVOKE EXECUTE ON FUNCTION public.cb_vencer_lixeira() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_reivindicar_arquivos_a_apagar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_vencer_lixeira() TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_reivindicar_arquivos_a_apagar(integer) TO service_role;
-- As RPCs da tela: a porta de admin (ou de membro) é por dentro.
REVOKE EXECUTE ON FUNCTION public.cb_mover_contatos_para_lixeira(uuid[], uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_previa_da_lixeira(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_restaurar_da_lixeira(uuid[], uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_excluir_da_lixeira(uuid[], boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_da_conta(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_negocios_na_lixeira(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_arquivos_da_lixeira_parados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_mover_contatos_para_lixeira(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_previa_da_lixeira(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_restaurar_da_lixeira(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_excluir_da_lixeira(uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_lixeira_da_conta(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_negocios_na_lixeira(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_arquivos_da_lixeira_parados() TO authenticated;
-- A guarda do caminho é pura: o servidor a usa também.
REVOKE EXECUTE ON FUNCTION public.cb_caminho_no_chat_media(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_caminho_no_chat_media(text, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 14) Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  -- 14.1 Portas.
  IF has_function_privilege('authenticated', 'public.cb_vencer_lixeira()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_vencer_lixeira()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_reivindicar_arquivos_a_apagar(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_restaurar_um(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_mover_um(uuid, uuid, uuid, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_purgar_um(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_mover_contatos_para_lixeira(uuid[], uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_vencer_lixeira()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_reivindicar_arquivos_a_apagar(integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_mover_contatos_para_lixeira(uuid[], uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_restaurar_da_lixeira(uuid[], uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_excluir_da_lixeira(uuid[], boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_lixeira_da_conta(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_negocios_na_lixeira(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '1097: EXECUTE das funções fora do lugar';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_lixeira_de_contatos', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_lixeira_de_contatos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_arquivos_a_apagar', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_arquivos_a_apagar', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_arquivos_a_apagar', 'DELETE') THEN
    RAISE EXCEPTION '1097: as tabelas da Lixeira e da fila não estão fechadas ao navegador';
  END IF;

  -- 14.2 A guarda do caminho (os MESMOS exemplos do pino em TS).
  IF public.cb_caminho_no_chat_media(
       'https://x.supabase.co/storage/v1/object/public/chat-media/account-00000000-0000-0000-0000-000000000001/1700-a.jpg?t=1',
       '00000000-0000-0000-0000-000000000001') IS DISTINCT FROM 'account-00000000-0000-0000-0000-000000000001/1700-a.jpg'
     OR public.cb_caminho_no_chat_media('account-00000000-0000-0000-0000-000000000001/avatares/x.jpg',
                                        '00000000-0000-0000-0000-000000000001')
        IS DISTINCT FROM 'account-00000000-0000-0000-0000-000000000001/avatares/x.jpg'
     OR public.cb_caminho_no_chat_media('account-00000000-0000-0000-0000-000000000001/acervo/x.jpg',
                                        '00000000-0000-0000-0000-000000000001') IS NOT NULL
     OR public.cb_caminho_no_chat_media('account-00000000-0000-0000-0000-000000000002/x.jpg',
                                        '00000000-0000-0000-0000-000000000001') IS NOT NULL
     OR public.cb_caminho_no_chat_media('https://x.supabase.co/storage/v1/object/public/flow-media/account-00000000-0000-0000-0000-000000000001/x.jpg',
                                        '00000000-0000-0000-0000-000000000001') IS NOT NULL
     OR public.cb_caminho_no_chat_media('account-00000000-0000-0000-0000-000000000001/../x.jpg',
                                        '00000000-0000-0000-0000-000000000001') IS NOT NULL
     OR public.cb_caminho_no_chat_media('account-00000000-0000-0000-0000-000000000001/a%20b.jpg',
                                        '00000000-0000-0000-0000-000000000001') IS NOT NULL
     OR public.cb_caminho_no_chat_media('https://example.com/x.jpg', '00000000-0000-0000-0000-000000000001') IS NOT NULL
     OR public.cb_caminho_no_chat_media('inbound/x.jpg', '00000000-0000-0000-0000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION '1097: a guarda do caminho errou';
  END IF;

  -- 14.3 Os gatilhos declarados e o fecho do catálogo, mesmo no banco vazio.
  PERFORM public.cb_lixeira_conferir_gatilhos();
  IF EXISTS (
    SELECT 1 FROM public.cb_lixeira_fks() f
     WHERE f.acao = 'c'
       AND public.cb_lixeira_tratamento() -> 'fecho' ? f.mae::text
       AND NOT public.cb_lixeira_tratamento() -> 'fecho' ? f.filha::text
  ) THEN
    RAISE EXCEPTION '1097: há tabela no CASCADE da ficha sem tratamento na Lixeira';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cb_lixeira_fks() f
     WHERE f.acao IN ('n', 'd')
       AND public.cb_lixeira_tratamento() -> 'fecho' ? f.mae::text
       AND NOT public.cb_lixeira_tratamento() -> 'ponteiros' ? (f.filha::text || '.' || array_to_string(f.anula, ','))
  ) THEN
    RAISE EXCEPTION '1097: há ponteiro para o fecho sem tratamento na Lixeira';
  END IF;

  -- 14.4 A IDA E VOLTA de verdade mora na 1098, numa transação PRÓPRIA:
  -- aqui ela rodaria segurando a trava exclusiva das ALTERs (conversas,
  -- execuções, trilha) — e depois da primeira ALTER, só catálogo
  -- (supabase.md).
  RAISE NOTICE '1097: portas, guarda do caminho, gatilhos e fecho conferidos; a ida e volta é a 1098.';
END $$;
