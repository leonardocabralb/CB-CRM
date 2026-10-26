-- ============================================================
-- 1110 — O turno do agente de IA sobrevive à conversa apagada e à Lixeira
--
-- C1 de docs/PLANO-central-dos-agentes.md (o desenho: anexo, "A1 —
-- Retenção"). Decisões do operador de 26/10/2026:
--   DC1 (c): o PRÓPRIO turno sobrevive à conversa, em duas camadas; restaurar
--            da Lixeira religa o turno à conversa;
--   DC2:     o conteúdo (texto do cliente) fica 90 dias — a constante
--            `PRAZO_DO_CONTEUDO_DO_TURNO_DIAS` do código —; o esqueleto, sem
--            prazo;
--   DC3 (b): TODA exclusão definitiva (o prazo da Lixeira e o "Excluir
--            agora") limpa o conteúdo; o esqueleto fica.
--
-- Até aqui a FK `cb_ia_turnos_conversa_fkey` era ON DELETE CASCADE (1049) e a
-- Lixeira levava o turno sem volta (`'cb_ia_turnos', 'nao_volta'`, 1102): o
-- registro do que o agente fez sumia com a conversa. Medido em 26/10/2026:
-- 0 turnos e 0 itens na Lixeira na produção — não há passado a converter.
--
-- AS DUAS CAMADAS de `cb_ia_turnos`:
--   - o ESQUELETO, sem texto de cliente: agente, conexão, card, etapa,
--     desfecho, tipo, o código do erro, as ações sem valor e sem detalhe cru,
--     tokens e ids. Fica.
--   - o CONTEÚDO, com texto de cliente: o retrato (`contexto`), a saída do
--     modelo (`saida_bruta`), o texto do desfecho (`erro_detalhe`), o `valor`
--     e o `detalhe` cru de cada ação. Sai pelo prazo (a poda, no ciclo de
--     manutenção das agendadas) e na exclusão definitiva da ficha, e o turno
--     diz quando e por quê (`conteudo_removido_em`/`_por`).
--
-- O QUE FAZ:
--  1. Colunas novas: `saida_bruta`, `erro_detalhe`, `motivo` (CHECK = a lista
--     `MOTIVOS_DE_TRANSFERENCIA` de src/lib/ia-agentes/textos-do-servidor.ts)
--     e `esperou_horario` — o app ainda NÃO as grava (é a C3); só nascem — e
--     `conteudo_removido_em`/`conteudo_removido_por` ('prazo' | 'exclusao').
--  2. Índices: `(account_id, created_at DESC)` (o Registro da conta) e o
--     parcial `(created_at) WHERE conteudo_removido_em IS NULL`, com o MESMO
--     predicado que a poda filtra (pino `turnos-sobrevivem-1110.test.ts`).
--  3. `cb_ia_turno_sem_conteudo(p_ids, p_por)`: limpa SÓ o conteúdo. Peça
--     interna: só a poda e a exclusão da Lixeira (funções que rodam como o
--     dono) a chamam.
--  4. `cb_ia_podar_conteudo_dos_turnos(p_dias, p_limite)`: a poda por prazo,
--     em lotes, só do `service_role` (o ciclo de manutenção).
--  5. O gatilho de DESCARTE do turno vivo: quando a conversa vira nula (o SET
--     NULL da FK nova, ou o `cb_lixeira_anular`, que anula os ponteiros ANTES
--     do DELETE), o `aguardando` e o `rodando` que ainda não enviava viram
--     `descartado`; o `rodando` que já enviava (`enviando_desde`) vira
--     `incerto` — a resposta pode ter saído, e `descartado` afirmaria que
--     nada saiu. ⚠️ Sem ele o DELETE da conversa ABORTA: o índice do pendente
--     é `NULLS NOT DISTINCT` (1049), e dois pendentes órfãos da mesma conexão
--     colidiriam — o mesmo motivo do gatilho da conexão apagada (1049).
--  6. `conversation_id` aceita nulo e a FK vira `ON DELETE SET NULL
--     (conversation_id)`, por coluna (a conta fica), no molde da FK do canal.
--  7. A Lixeira: `cb_lixeira_tratamento()` refeita a partir do corpo VIGENTE
--     (o da 1102, conferido igual ao da produção em 26/10/2026) — sai
--     `cb_ia_turnos` do fecho, sai o ponteiro `ai_usage_log.turno_id` (que
--     deixa de ser alcançado), entra `cb_ia_turnos.conversation_id` →
--     `reaponta` (restaurar religa o turno) e o gatilho novo em `livres` (a
--     restauração só grava conversa NÃO nula); e `cb_lixeira_purgar_um`
--     refeita a partir do corpo vigente (o da 1097, conferido igual ao da
--     produção) — a exclusão definitiva limpa o conteúdo dos turnos anotados
--     nos ponteiros, FORA do `IF p_pedido` (DC3: vale no prazo e no "Excluir
--     agora").
--
-- AS TRAVAS: o DROP da FK velha toma ACCESS EXCLUSIVE em `conversations`
-- (o Postgres trava a tabela referenciada para tirar os gatilhos da FK), e
-- ela vale até o COMMIT. A trava vem no COMEÇO, na ordem em que o app trava
-- (a conversa, depois o turno: encerrar a conversa e a pausa por gente
-- escrevem/leem `cb_ia_turnos` segurando a conversa) — na ordem inversa, um
-- encerramento simultâneo fecharia um ciclo com esta migration. Teto de 5 s
-- para ESPERAR; depois, tudo é rápido: a tabela tem 0 linhas, a FK nova nasce
-- NOT VALID e é validada em seguida, e a conferência que escreve mexe só em
-- linhas fictícias.
--
-- ADITIVA: aplicar ANTES do deploy (a aba Turnos passa a pedir
-- `conteudo_removido_*`, e o ciclo de manutenção chama a poda). Antes de
-- aplicar, provar num Postgres descartável com o schema do replay e dado: o
-- SET NULL da FK dispara o gatilho (a conferência abaixo prova com duas
-- conversas fictícias), mover para a Lixeira, restaurar (a conversa volta ao
-- turno) e excluir de vez (o esqueleto fica, o conteúdo sai) continuam
-- funcionando, e `cb_unir_fichas` (que move os turnos ANTES de apagar a
-- conversa, 1093) também.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- Dentro de um DO: `LOCK TABLE` solto estoura fora de transação.
DO $$
BEGIN
  LOCK TABLE public.conversations IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.cb_ia_turnos IN ACCESS EXCLUSIVE MODE;
END $$;

-- ------------------------------------------------------------
-- 1) As colunas novas e os CHECKs (nomeados: o DROP acha pelo nome)
-- ------------------------------------------------------------
ALTER TABLE public.cb_ia_turnos
  ADD COLUMN IF NOT EXISTS saida_bruta text,
  ADD COLUMN IF NOT EXISTS erro_detalhe text,
  ADD COLUMN IF NOT EXISTS motivo text,
  ADD COLUMN IF NOT EXISTS esperou_horario boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conteudo_removido_em timestamptz,
  ADD COLUMN IF NOT EXISTS conteudo_removido_por text;

-- Espelho de `MOTIVOS_DE_TRANSFERENCIA` (textos-do-servidor.ts); o pino
-- compara as duas listas.
ALTER TABLE public.cb_ia_turnos DROP CONSTRAINT IF EXISTS cb_ia_turnos_motivo_check;
ALTER TABLE public.cb_ia_turnos ADD CONSTRAINT cb_ia_turnos_motivo_check CHECK (
  motivo IS NULL OR motivo IN (
    'sentinela', 'teto', 'audio', 'incerto', 'link_inventado', 'reuniao_nao_marcada',
    'reuniao_prometida', 'agente_passou', 'pedido_vazado', 'acao_prometida'));

ALTER TABLE public.cb_ia_turnos DROP CONSTRAINT IF EXISTS cb_ia_turnos_conteudo_removido_por_check;
ALTER TABLE public.cb_ia_turnos ADD CONSTRAINT cb_ia_turnos_conteudo_removido_por_check CHECK (
  conteudo_removido_por IS NULL OR conteudo_removido_por IN ('prazo', 'exclusao'));

COMMENT ON COLUMN public.cb_ia_turnos.saida_bruta IS
  'O texto que o modelo devolveu, com os marcadores (C3). CONTEÚDO: sai pelo prazo e na exclusão definitiva (1110).';
COMMENT ON COLUMN public.cb_ia_turnos.erro_detalhe IS
  'O texto livre do desfecho (retido pelas travas, links, a mensagem crua do erro, por semSegredo) — o `erro` vira código (C3). CONTEÚDO (1110).';
COMMENT ON COLUMN public.cb_ia_turnos.motivo IS
  'Por que o turno transferiu ou pediu a equipe (MOTIVOS_DE_TRANSFERENCIA), também no "respondeu" que transfere depois (C3). Esqueleto.';
COMMENT ON COLUMN public.cb_ia_turnos.esperou_horario IS
  'O turno esperou a abertura do horário do agente (C3): a marca no `erro` é sobrescrita quando ele roda. Esqueleto.';
COMMENT ON COLUMN public.cb_ia_turnos.conteudo_removido_em IS
  'Quando o conteúdo (contexto, saida_bruta, erro_detalhe, valor e detalhe cru das ações) saiu (1110).';
COMMENT ON COLUMN public.cb_ia_turnos.conteudo_removido_por IS
  'Por que o conteúdo saiu: prazo (a poda) ou exclusao (a ficha excluída de vez da Lixeira) (1110).';

-- ------------------------------------------------------------
-- 2) Os índices
-- ------------------------------------------------------------
-- O Registro da conta (a aba da C6): os turnos da conta, mais novos primeiro.
CREATE INDEX IF NOT EXISTS cb_ia_turnos_conta_criado_idx
  ON public.cb_ia_turnos (account_id, created_at DESC);
-- A poda: o MESMO predicado e a mesma coluna que `cb_ia_podar_conteudo_dos_turnos`
-- filtra (supabase.md: índice parcial espelha a consulta — mudar um sem o
-- outro deixa o índice de pé e inútil).
CREATE INDEX IF NOT EXISTS cb_ia_turnos_conteudo_a_podar_idx
  ON public.cb_ia_turnos (created_at)
  WHERE conteudo_removido_em IS NULL;

-- ------------------------------------------------------------
-- 3) Limpar o conteúdo de turnos (peça interna)
-- ------------------------------------------------------------
-- O esqueleto fica: status, tipo, tokens, ids e as ações sem `valor` e sem o
-- `detalhe` cru — o `detalhe` que é CÓDIGO da lista fechada fica (`ja_estava`,
-- `sem_marcador`, `nome_sem_origem` e o `automacao_fala` da C3), e também o
-- código que acompanha um erro: o passo da D5 que bloqueou a automação
-- (`CODIGOS_DA_D5`) e o tipo do campo no `valor_invalido` (`FormatoDoCampo`).
-- Os dois saem do motor como 2º argumento de `falha(…)`. O `erro` fica
-- até o primeiro ':' — é código desde a C3; o gravado antes dela colava o
-- texto retido depois dos dois-pontos. Turno já limpo não é carimbado de novo
-- (o primeiro motivo é o que vale). Devolve quantos limpou.
CREATE OR REPLACE FUNCTION public.cb_ia_turno_sem_conteudo(p_ids uuid[], p_por text)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_por IS NULL OR p_por NOT IN ('prazo', 'exclusao') THEN
    RAISE EXCEPTION 'conteudo_removido_por_invalido:%', p_por USING ERRCODE = '22023';
  END IF;

  UPDATE cb_ia_turnos t
     SET contexto = NULL,
         saida_bruta = NULL,
         erro_detalhe = NULL,
         erro = CASE WHEN position(':' IN t.erro) > 0 THEN split_part(t.erro, ':', 1) ELSE t.erro END,
         acoes = CASE WHEN jsonb_typeof(t.acoes) = 'array' THEN coalesce((
                   SELECT jsonb_agg(CASE
                            WHEN e.a ->> 'detalhe' IN ('ja_estava', 'sem_marcador', 'nome_sem_origem', 'automacao_fala')
                              OR (e.a ->> 'erro' IN ('automacao_fora_da_d5', 'cascata_fora_da_d5')
                                  AND e.a ->> 'detalhe' IN ('send_to_number', 'send_webhook', 'atlas_criar_cliente', 'status_de_resultado', 'etapa_de_resultado', 'run_flow', 'campo_vigiado', 'aguardar'))
                              OR (e.a ->> 'erro' = 'valor_invalido'
                                  AND e.a ->> 'detalhe' IN ('texto', 'data', 'numero', 'lista', 'email'))
                              THEN e.a - 'valor'
                            ELSE e.a - 'valor' - 'detalhe'
                          END ORDER BY e.i)
                     FROM jsonb_array_elements(t.acoes) WITH ORDINALITY AS e(a, i)
                    WHERE jsonb_typeof(e.a) = 'object'), '[]'::jsonb)
                 ELSE '[]'::jsonb END,
         conteudo_removido_em = now(),
         conteudo_removido_por = p_por,
         updated_at = now()
   WHERE t.id = ANY (p_ids)
     AND t.conteudo_removido_em IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- ------------------------------------------------------------
-- 4) A poda por prazo (o servidor, no ciclo de manutenção)
-- ------------------------------------------------------------
-- Um lote por chamada (o servidor repete sob o prazo do ciclo): os turnos
-- TERMINADOS com o conteúdo de pé e `created_at` mais velho que `p_dias`.
-- Como dono (SECURITY DEFINER): a limpeza é peça interna, sem GRANT a
-- ninguém (no banco novo, nem o `service_role` a alcança direto). `p_dias`
-- vem da constante do código (DC2); menos de 1 dia é recusado (limparia o
-- turno de agora).
CREATE OR REPLACE FUNCTION public.cb_ia_podar_conteudo_dos_turnos(p_dias integer, p_limite integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_dias IS NULL OR p_dias < 1 THEN
    RAISE EXCEPTION 'poda_prazo_invalido:%', p_dias USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(s.id) INTO v_ids
    FROM (SELECT t.id FROM cb_ia_turnos t
           WHERE t.conteudo_removido_em IS NULL
             AND t.created_at < now() - make_interval(days => p_dias)
             AND t.status NOT IN ('aguardando', 'rodando')
           ORDER BY t.created_at
           LIMIT least(greatest(coalesce(p_limite, 200), 1), 1000)
           FOR UPDATE SKIP LOCKED) s;
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;
  RETURN cb_ia_turno_sem_conteudo(v_ids, 'prazo');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_turno_sem_conteudo(uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ia_podar_conteudo_dos_turnos(integer, integer) FROM PUBLIC, anon, authenticated;
-- O ciclo de manutenção chama com o service_role, que perdeu o EXECUTE junto
-- com PUBLIC (supabase.md: todo privilégio que a migration confere, concede).
GRANT EXECUTE ON FUNCTION public.cb_ia_podar_conteudo_dos_turnos(integer, integer) TO service_role;

-- ------------------------------------------------------------
-- 5) O gatilho de descarte do turno vivo (o PRIMEIRO de cb_ia_turnos)
-- ------------------------------------------------------------
-- No vocabulário que o banco já grava no `erro` ('conexão apagada', 'conversa
-- encerrada', 'fichas unidas'). `terminado_em = now()`, como o gatilho da
-- conexão. Sem SECURITY DEFINER: só mexe no NEW.
CREATE OR REPLACE FUNCTION public.cb_ia_turno_conversa_apagada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.status := CASE WHEN NEW.status = 'rodando' AND NEW.enviando_desde IS NOT NULL
                     THEN 'incerto' ELSE 'descartado' END;
  NEW.erro := 'conversa apagada';
  NEW.terminado_em := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_ia_turnos_conversa_apagada_trigger ON public.cb_ia_turnos;
CREATE TRIGGER cb_ia_turnos_conversa_apagada_trigger
  BEFORE UPDATE OF conversation_id ON public.cb_ia_turnos
  FOR EACH ROW
  WHEN (OLD.conversation_id IS NOT NULL AND NEW.conversation_id IS NULL AND NEW.status IN ('aguardando', 'rodando'))
  EXECUTE FUNCTION public.cb_ia_turno_conversa_apagada();

-- Função de gatilho não é RPC (revogar não impede o disparo).
REVOKE EXECUTE ON FUNCTION public.cb_ia_turno_conversa_apagada() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6) A conversa vira anulável; a FK, SET NULL (conversation_id)
-- ------------------------------------------------------------
ALTER TABLE public.cb_ia_turnos ALTER COLUMN conversation_id DROP NOT NULL;
ALTER TABLE public.cb_ia_turnos DROP CONSTRAINT IF EXISTS cb_ia_turnos_conversa_fkey;
ALTER TABLE public.cb_ia_turnos ADD CONSTRAINT cb_ia_turnos_conversa_fkey
  FOREIGN KEY (conversation_id, account_id) REFERENCES public.conversations (id, account_id)
  ON DELETE SET NULL (conversation_id) NOT VALID;
ALTER TABLE public.cb_ia_turnos VALIDATE CONSTRAINT cb_ia_turnos_conversa_fkey;

-- ------------------------------------------------------------
-- 7) O inventário da Lixeira: o corpo VIGENTE da 1102 + o turno que fica
-- ------------------------------------------------------------
-- Diferenças: sem `'cb_ia_turnos', 'nao_volta'` no fecho; sem o ponteiro
-- `ai_usage_log.turno_id` (o turno não sai mais com a ficha); com
-- `cb_ia_turnos.conversation_id` → `reaponta` e o gatilho novo em `livres`.
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
      'cb_conversa_aberta', 'nao_volta'
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
      -- 1110: o turno da IA FICA (DC1); restaurar o religa à conversa.
      'cb_ia_turnos.conversation_id', 'reaponta',
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
      'cb_automation_events.contact_id', 'nao_reaponta'
    ),
    -- Colunas guardadas junto com o ponteiro, para a condição da volta.
    'extras', jsonb_build_object(
      'cb_asaas_clientes', jsonb_build_array('vinculo_origem')
    ),
    -- Calados pelo sinal (o WHEN da 1097); a conferência exige o WHEN.
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
      'broadcast_recipients.broadcast_recipients_aggregate',
      -- 1110: a restauração só grava conversa NÃO nula (o WHEN não casa); o
      -- mover PRECISA dele (descarta o turno vivo antes do DELETE).
      'cb_ia_turnos.cb_ia_turnos_conversa_apagada_trigger'
    )
  )
$$;

-- Peça interna, como na 1097 (`CREATE OR REPLACE` mantém o ACL; o REVOKE
-- repetido só deixa a intenção escrita).
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_tratamento() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8) Excluir de vez: o corpo VIGENTE da 1097 + o conteúdo dos turnos
-- ------------------------------------------------------------
-- Única diferença: os turnos anotados nos ponteiros (a conversa e as
-- mensagens da ficha) perdem o CONTEÚDO, com `por = 'exclusao'`, ANTES e FORA
-- do `IF p_pedido` (DC3): vale no vencimento e no "Excluir agora", com ou sem
-- o pedido do titular. O esqueleto fica, sem conversa.
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

  -- 1110 (DC3): o registro dos agentes de IA desta ficha fica sem o conteúdo.
  v_ids := ARRAY(SELECT DISTINCT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                   jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_ia_turnos');
  PERFORM cb_ia_turno_sem_conteudo(v_ids, 'exclusao');

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

REVOKE EXECUTE ON FUNCTION public.cb_lixeira_purgar_um(uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 9) Conferência do CATÁLOGO (vale no banco vazio do replay)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_fk record;
  v_def text;
  v_trat jsonb := public.cb_lixeira_tratamento();
BEGIN
  -- 9.1 A conversa aceita nulo; a FK é SET NULL só na conversa, e validada.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'cb_ia_turnos'
                AND column_name = 'conversation_id' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '1110: cb_ia_turnos.conversation_id continua NOT NULL';
  END IF;
  SELECT k.confdeltype, k.convalidated,
         ARRAY(SELECT a.attname::text FROM unnest(k.confdelsetcols) u(n)
                 JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n) AS anula,
         k.confrelid
    INTO v_fk
    FROM pg_constraint k
   WHERE k.conname = 'cb_ia_turnos_conversa_fkey' AND k.conrelid = 'public.cb_ia_turnos'::regclass;
  IF v_fk.confdeltype IS DISTINCT FROM 'n' OR NOT v_fk.convalidated
     OR v_fk.anula IS DISTINCT FROM ARRAY['conversation_id']
     OR v_fk.confrelid IS DISTINCT FROM 'public.conversations'::regclass THEN
    RAISE EXCEPTION '1110: a FK da conversa não ficou SET NULL (conversation_id) e validada: %', row_to_json(v_fk);
  END IF;

  -- 9.2 As colunas novas e os CHECKs nomeados.
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cb_ia_turnos'
         AND column_name IN ('saida_bruta', 'erro_detalhe', 'motivo', 'esperou_horario',
                             'conteudo_removido_em', 'conteudo_removido_por')) <> 6 THEN
    RAISE EXCEPTION '1110: faltou coluna nova em cb_ia_turnos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'cb_ia_turnos'
                    AND column_name = 'esperou_horario' AND is_nullable = 'NO'
                    AND column_default = 'false') THEN
    RAISE EXCEPTION '1110: esperou_horario não é boolean NOT NULL DEFAULT false';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c
       WHERE c.conrelid = 'public.cb_ia_turnos'::regclass AND c.contype = 'c'
         AND c.conname IN ('cb_ia_turnos_motivo_check', 'cb_ia_turnos_conteudo_removido_por_check')) <> 2 THEN
    RAISE EXCEPTION '1110: faltou o CHECK do motivo ou o de conteudo_removido_por';
  END IF;

  -- 9.3 O índice da poda: a coluna e o predicado que a poda filtra.
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.cb_ia_turnos_conteudo_a_podar_idx');
  IF v_def IS NULL OR position('(created_at) WHERE (conteudo_removido_em IS NULL)' IN v_def) = 0 THEN
    RAISE EXCEPTION '1110: o índice da poda não ficou na forma esperada: %', v_def;
  END IF;
  IF to_regclass('public.cb_ia_turnos_conta_criado_idx') IS NULL THEN
    RAISE EXCEPTION '1110: o índice da conta (account_id, created_at DESC) não existe';
  END IF;

  -- 9.4 O gatilho: BEFORE UPDATE OF conversation_id, por linha.
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.cb_ia_turnos'::regclass
     AND t.tgname = 'cb_ia_turnos_conversa_apagada_trigger' AND NOT t.tgisinternal;
  IF v_def IS NULL
     OR position('BEFORE UPDATE OF conversation_id ON ' IN v_def) = 0
     OR position(' FOR EACH ROW WHEN ' IN v_def) = 0 THEN
    RAISE EXCEPTION '1110: o gatilho do turno vivo não ficou na forma esperada: %', v_def;
  END IF;

  -- 9.5 As portas: o navegador não lê os turnos nem chama as funções; o
  --     service_role poda. (Na produção o service_role tem EXECUTE em toda
  --     função `cb_*` pelo privilégio padrão do Supabase — a limpeza não é
  --     conferida contra ele; no banco novo do replay, só a poda o tem.)
  IF has_table_privilege('anon', 'public.cb_ia_turnos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_turnos', 'SELECT') THEN
    RAISE EXCEPTION '1110: cb_ia_turnos aberta ao navegador';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_turno_sem_conteudo(uuid[], text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_turno_sem_conteudo(uuid[], text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_ia_podar_conteudo_dos_turnos(integer, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_podar_conteudo_dos_turnos(integer, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_ia_podar_conteudo_dos_turnos(integer, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_ia_turno_conversa_apagada()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_turno_conversa_apagada()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_purgar_um(uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_tratamento()', 'EXECUTE') THEN
    RAISE EXCEPTION '1110: EXECUTE das funções fora do lugar';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p
           WHERE p.oid = 'public.cb_ia_podar_conteudo_dos_turnos(integer, integer)'::regprocedure) THEN
    RAISE EXCEPTION '1110: a poda não é SECURITY DEFINER (o service_role não alcançaria a limpeza interna)';
  END IF;

  -- 9.6 A Lixeira: o turno fora do fecho, a conversa dele reapontada, o
  --     gatilho declarado; a exclusão definitiva chama a limpeza.
  IF (v_trat -> 'fecho') ? 'cb_ia_turnos'
     OR (v_trat -> 'ponteiros') ? 'ai_usage_log.turno_id'
     OR v_trat -> 'ponteiros' ->> 'cb_ia_turnos.conversation_id' IS DISTINCT FROM 'reaponta'
     OR NOT (v_trat -> 'livres') ? 'cb_ia_turnos.cb_ia_turnos_conversa_apagada_trigger' THEN
    RAISE EXCEPTION '1110: o inventário da Lixeira não ficou como o turno durável pede';
  END IF;
  IF position('cb_ia_turno_sem_conteudo(v_ids, ''exclusao'')'
              IN pg_get_functiondef('public.cb_lixeira_purgar_um(uuid, boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '1110: a exclusão definitiva não limpa o conteúdo dos turnos';
  END IF;
  -- A mesma conferência que a restauração roda antes de escrever.
  PERFORM public.cb_lixeira_conferir_gatilhos();
  -- E o fecho do catálogo (a 14.3 da 1097): nada no CASCADE da ficha nem
  -- ponteiro para ela sem tratamento.
  IF EXISTS (
    SELECT 1 FROM public.cb_lixeira_fks() f
     WHERE f.acao = 'c'
       AND v_trat -> 'fecho' ? f.mae::text
       AND NOT v_trat -> 'fecho' ? f.filha::text
  ) THEN
    RAISE EXCEPTION '1110: há tabela no CASCADE da ficha sem tratamento na Lixeira';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cb_lixeira_fks() f
     WHERE f.acao IN ('n', 'd')
       AND v_trat -> 'fecho' ? f.mae::text
       AND NOT v_trat -> 'ponteiros' ? (f.filha::text || '.' || array_to_string(f.anula, ','))
  ) THEN
    RAISE EXCEPTION '1110: há ponteiro para o fecho sem tratamento na Lixeira';
  END IF;

  RAISE NOTICE '1110: FK, colunas, índices, gatilho, portas e o inventário da Lixeira conferidos.';
END $$;

-- ------------------------------------------------------------
-- 10) Conferência que CHAMA (supabase.md, regra 3 do banco vazio)
-- ------------------------------------------------------------
-- As duas funções novas são chamadas mesmo no banco vazio (o corpo só é
-- analisado quando roda). Com uma conta, duas fichas FICTÍCIAS, cada uma com
-- uma conversa e um turno `aguardando` (a mesma conexão: nula), mais um
-- `rodando` que já enviava e um turno velho com conteúdo: apagar as duas
-- conversas num DELETE só PROVA que o SET NULL da FK dispara o gatilho —
-- sem ele, os dois pendentes órfãos colidiriam no índice `NULLS NOT DISTINCT`
-- e o DELETE abortaria (23505, e a migration falha). Depois a poda (como o
-- service_role, o caminho do servidor) e a limpeza da exclusão. Tudo desfeito
-- pelo SQLSTATE próprio (P1110 — nunca `WHEN OTHERS`, que engoliria o
-- defeito); no banco vazio do replay, só as chamadas sem linhas.
DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_ficha_a uuid;
  v_ficha_b uuid;
  v_conversa_a uuid;
  v_conversa_b uuid;
  v_aguardando_a uuid;
  v_aguardando_b uuid;
  v_rodando uuid;
  v_velho uuid;
  v_n integer;
  v_t record;
BEGIN
  BEGIN
    v_n := public.cb_ia_turno_sem_conteudo('{}'::uuid[], 'prazo');
    IF v_n <> 0 THEN
      RAISE EXCEPTION '1110: a limpeza sem ids limpou % turno(s)', v_n;
    END IF;

    SELECT a.id, a.owner_user_id INTO v_conta, v_dono
      FROM public.accounts a
      JOIN public.profiles p ON p.user_id = a.owner_user_id AND p.account_id = a.id
     ORDER BY a.created_at
     LIMIT 1;

    IF v_conta IS NULL THEN
      SET LOCAL ROLE service_role;
      v_n := public.cb_ia_podar_conteudo_dos_turnos(90, 1);
      RESET ROLE;
      RAISE NOTICE '1110: banco vazio — as funções foram chamadas sem linhas; o gatilho não foi exercitado aqui.';
    ELSE
      INSERT INTO public.contacts (user_id, account_id, phone, name)
      VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano Conferencia 1110 A')
      RETURNING id INTO v_ficha_a;
      INSERT INTO public.contacts (user_id, account_id, phone, name)
      VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano Conferencia 1110 B')
      RETURNING id INTO v_ficha_b;
      INSERT INTO public.conversations (user_id, account_id, contact_id, status)
      VALUES (v_dono, v_conta, v_ficha_a, 'closed') RETURNING id INTO v_conversa_a;
      INSERT INTO public.conversations (user_id, account_id, contact_id, status)
      VALUES (v_dono, v_conta, v_ficha_b, 'closed') RETURNING id INTO v_conversa_b;

      INSERT INTO public.cb_ia_turnos (account_id, conversation_id, status, executar_apos)
      VALUES (v_conta, v_conversa_a, 'aguardando', now() + interval '1 hour') RETURNING id INTO v_aguardando_a;
      INSERT INTO public.cb_ia_turnos (account_id, conversation_id, status, executar_apos)
      VALUES (v_conta, v_conversa_b, 'aguardando', now() + interval '1 hour') RETURNING id INTO v_aguardando_b;
      INSERT INTO public.cb_ia_turnos (account_id, conversation_id, status, rodando_desde, enviando_desde)
      VALUES (v_conta, v_conversa_a, 'rodando', now(), now()) RETURNING id INTO v_rodando;
      INSERT INTO public.cb_ia_turnos (account_id, conversation_id, status, terminado_em, created_at,
                                       erro, erro_detalhe, saida_bruta, contexto, acoes)
      VALUES (v_conta, v_conversa_b, 'transferiu', now() - interval '100 days', now() - interval '100 days',
              'pedido vazado: texto fictício retido', 'texto fictício do desfecho', 'saída fictícia',
              '{"blocos": [{"bloco": "ficha", "texto": "Customer record: ficticio."}]}'::jsonb,
              '[{"tipo": "preencher_campo", "alvo": {"id": "c1", "nome": "Campo"}, "ok": true, "valor": "valor fictício"},
                {"tipo": "mover_etapa", "alvo": {"id": "e1", "nome": "Etapa"}, "ok": true, "detalhe": "ja_estava"},
                {"tipo": "etiquetar", "alvo": {"id": "t1", "nome": "Etiqueta"}, "ok": false, "erro": "falhou", "detalhe": "erro cru fictício"},
                "linha fora da forma"]'::jsonb)
      RETURNING id INTO v_velho;

      -- A FK: as duas conversas num DELETE só.
      DELETE FROM public.conversations WHERE id IN (v_conversa_a, v_conversa_b);

      SELECT status, erro, conversation_id, terminado_em INTO v_t FROM public.cb_ia_turnos WHERE id = v_aguardando_a;
      IF v_t.status IS DISTINCT FROM 'descartado' OR v_t.erro IS DISTINCT FROM 'conversa apagada'
         OR v_t.conversation_id IS NOT NULL OR v_t.terminado_em IS NULL THEN
        RAISE EXCEPTION '1110: o pendente da conversa apagada não foi descartado: %', row_to_json(v_t);
      END IF;
      SELECT status INTO v_t FROM public.cb_ia_turnos WHERE id = v_aguardando_b;
      IF v_t.status IS DISTINCT FROM 'descartado' THEN
        RAISE EXCEPTION '1110: o segundo pendente órfão não foi descartado: %', v_t.status;
      END IF;
      SELECT status, erro INTO v_t FROM public.cb_ia_turnos WHERE id = v_rodando;
      IF v_t.status IS DISTINCT FROM 'incerto' OR v_t.erro IS DISTINCT FROM 'conversa apagada' THEN
        RAISE EXCEPTION '1110: o turno que já enviava não ficou incerto: %', row_to_json(v_t);
      END IF;
      SELECT status, conversation_id, contexto INTO v_t FROM public.cb_ia_turnos WHERE id = v_velho;
      IF v_t.status IS DISTINCT FROM 'transferiu' OR v_t.conversation_id IS NOT NULL OR v_t.contexto IS NULL THEN
        RAISE EXCEPTION '1110: o turno terminado não ficou como estava, sem conversa: %', row_to_json(v_t);
      END IF;

      -- A poda, pelo caminho do servidor: o turno velho perde só o conteúdo.
      SET LOCAL ROLE service_role;
      v_n := public.cb_ia_podar_conteudo_dos_turnos(90, 1000);
      RESET ROLE;
      SELECT status, erro, contexto, saida_bruta, erro_detalhe, acoes, conteudo_removido_em, conteudo_removido_por
        INTO v_t FROM public.cb_ia_turnos WHERE id = v_velho;
      IF v_n < 1 OR v_t.status IS DISTINCT FROM 'transferiu' OR v_t.erro IS DISTINCT FROM 'pedido vazado'
         OR v_t.contexto IS NOT NULL OR v_t.saida_bruta IS NOT NULL OR v_t.erro_detalhe IS NOT NULL
         OR v_t.conteudo_removido_em IS NULL OR v_t.conteudo_removido_por IS DISTINCT FROM 'prazo'
         OR v_t.acoes IS DISTINCT FROM
            '[{"tipo": "preencher_campo", "alvo": {"id": "c1", "nome": "Campo"}, "ok": true},
              {"tipo": "mover_etapa", "alvo": {"id": "e1", "nome": "Etapa"}, "ok": true, "detalhe": "ja_estava"},
              {"tipo": "etiquetar", "alvo": {"id": "t1", "nome": "Etiqueta"}, "ok": false, "erro": "falhou"}]'::jsonb THEN
        RAISE EXCEPTION '1110: a poda não deixou só o esqueleto (% turno(s)): %', v_n, row_to_json(v_t);
      END IF;
      -- Os recentes não são podados.
      IF EXISTS (SELECT 1 FROM public.cb_ia_turnos
                  WHERE id IN (v_aguardando_a, v_aguardando_b, v_rodando) AND conteudo_removido_em IS NOT NULL) THEN
        RAISE EXCEPTION '1110: a poda limpou turno dentro do prazo';
      END IF;

      -- A exclusão definitiva: carimba `exclusao`; o já limpo não é carimbado de novo.
      v_n := public.cb_ia_turno_sem_conteudo(ARRAY[v_rodando, v_velho], 'exclusao');
      IF v_n <> 1
         OR (SELECT conteudo_removido_por FROM public.cb_ia_turnos WHERE id = v_rodando) IS DISTINCT FROM 'exclusao'
         OR (SELECT conteudo_removido_por FROM public.cb_ia_turnos WHERE id = v_velho) IS DISTINCT FROM 'prazo' THEN
        RAISE EXCEPTION '1110: a limpeza da exclusão errou (% turno(s))', v_n;
      END IF;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1110', MESSAGE = 'desfaz a conferência';
  EXCEPTION WHEN SQLSTATE 'P1110' THEN
    RAISE NOTICE '1110: o turno sobrevive à conversa (gatilho, poda e limpeza chamados e desfeitos) — conta: %.', v_conta IS NOT NULL;
  END;
END $$;
