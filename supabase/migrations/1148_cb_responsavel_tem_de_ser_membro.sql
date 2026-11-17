-- ============================================================
-- 1148 — o responsável da conversa tem de ser MEMBRO da conta, e remover um
-- membro devolve as conversas dele à fila.
--
-- Porte do #682 do original (`055_authz_membership_holes.sql`, REFERÊNCIA —
-- nunca crua: ela recria `enforce_profile_privilege_columns`, as policies de
-- mídia e `notify_conversation_assigned` por cima das nossas). Plano:
-- `docs/PLANO-porte-upstream-2026-11.md`, Lote E (E1 e E2).
--
-- O DEFEITO (E1). `conversations.assigned_agent_id` não tem FK, e nada no
-- banco perguntava se o responsável é da conta. Gravavam ex-membro: o menu
-- Responsável com a lista aberta antes da remoção, o passo "Atribuir" da
-- automação com atendente fixo que saiu (só o SUSPENSO era barrado), a
-- agendada de quem saiu (a reabertura atribui a quem agendou), o desfazer do
-- encerramento em lote (1018/1020/1021/1034) e a união de fichas (1093). A
-- conversa ficava presa a quem não está mais na equipe — fora da fila de
-- quem está sem dono, sem ninguém para responder.
--
-- 1. O GATILHO `cb_responsavel_tem_de_ser_membro_trigger` (BEFORE INSERT OR
--    UPDATE OF assigned_agent_id, account_id): troca para quem não é membro
--    da conta da conversa MANTÉM o anterior (se ainda for membro) ou deixa
--    SEM responsável — nunca recusa a escrita (o UPDATE do motor, da
--    reabertura e da tela segue; só o responsável não pega). Quem grava e
--    precisa saber confere o retorno (`.select()`: o menu, o motor).
--    - SUSPENSO CONTA como membro (1067, decisão do operador: suspender não
--      reatribui nada). Por isso o gatilho NÃO olha `suspenso_em`.
--    - A leitura do perfil do NOVO responsável é `FOR KEY SHARE`: fecha a
--      corrida "atribuir a X enquanto X é removido" (ver 2b).
--
-- 2. `remove_account_member` (corpo VIGENTE da 1067, idêntico ao da produção
--    salvo o comentário "-- 1064", + duas peças):
--    a. as conversas da conta em que a pessoa é responsável voltam para a
--       fila (sem responsável) — decisão do operador #16, 17/11/2026. ANTES
--       de mover o perfil: a trilha (1083) só acha o NOME de quem saía
--       enquanto ele ainda é da conta (a linha diz "estava com Fulano").
--    b. a TRAVA, em ordem de `user_id` (duas remoções cruzadas não se
--       prendem): o ALVO `FOR UPDATE` — serializa com a transferência de
--       dono e a suspensão, que travam a mesma linha, e com a atribuição a
--       ele, cujo gatilho espera e relê (o `account_id` mudou: não é mais
--       membro). ⚠️ O `FOR UPDATE` EXPLÍCITO é obrigatório: o UPDATE de
--       `account_id` sozinho pega NO KEY UPDATE (`account_id` não está em
--       índice único), que não conflita com o `FOR KEY SHARE` do gatilho — a
--       atribuição leria a versão velha e passaria. O CHAMADOR fica `FOR
--       SHARE`: o papel dele não muda no meio (o original trava as duas em
--       FOR UPDATE), e a atribuição A ELE durante a remoção não espera — em
--       FOR UPDATE, "passar a conversa de X para quem remove" e "remover X"
--       se prenderiam (deadlock).
--    Resíduo aceito: atribuir ao NOVO dono no mesmo instante de uma
--    transferência de conta pode dar deadlock — o Postgres detecta, um dos
--    dois falha e repete.
--
-- 3. A CORREÇÃO, uma vez: a conversa cujo responsável já não é membro da
--    conta volta para a fila. 0 na produção em 17/11/2026 (vale para as
--    instalações do produto). Gatilhos por linha que ela aciona: a trilha
--    (1083, "pelo sistema", uma linha por conversa), `set_updated_at` e o
--    tempo real (um UPDATE por conversa); aviso no sino nenhum (nulo não
--    avisa, 0027).
--
-- 4. A Lixeira (1097): gatilho novo numa tabela que a restauração escreve
--    tem de estar declarado em `cb_lixeira_tratamento()`, senão TODA
--    restauração recusa (`lixeira_sem_tratamento:gatilho:…`; pino
--    `lixeira-1097.test.ts` (e)). Ele entra em `livres` (roda na volta): a
--    restauração já zera, na fotografia, o responsável que saiu da conta ou
--    está suspenso, então ali ele não muda nada — e a garantia "o banco nunca
--    guarda ex-membro" fica sem exceção. A função recriada é o corpo VIGENTE
--    da 1110 (idêntico ao da produção, conferido em 17/11/2026) + essa linha.
--
-- Fica como está, de propósito: `notify_conversation_assigned` (com o
-- gatilho, o aviso só vê membro), `profiles_insert` (a 1103 já fechou),
-- `deals.assigned_to` e as tarefas de quem sai (a decisão #16 é sobre
-- conversas). Limite: apagar o LOGIN fora do app (painel do Supabase) leva o
-- perfil pelo CASCADE e deixa a conversa presa — esta correção roda uma vez.
--
-- Ordem: antes do deploy (o app novo confere o que gravou; o antigo segue
-- funcionando, só sem dizer por que a atribuição não pegou).
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- `conversations` é a tabela mais escrita do CRM: o CREATE TRIGGER pega trava
-- ShareRowExclusive (segura toda escrita nela até o fim da transação). Sem
-- teto, uma transação longa enfileiraria a ingestão atrás desta migration.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) O gatilho
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_responsavel_tem_de_ser_membro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sem mudança de responsável nem de conta: nada a conferir.
  IF TG_OP = 'UPDATE'
     AND NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id THEN
    RETURN NEW;
  END IF;

  -- Membro desta conta, SUSPENSO inclusive (1067). FOR KEY SHARE: com a
  -- remoção da pessoa em curso (que trava a linha FOR UPDATE), espera ela
  -- terminar e relê a versão nova — já fora da conta.
  PERFORM 1
     FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
      FOR KEY SHARE;
  IF FOUND THEN
    RETURN NEW;
  END IF;

  -- Não é membro: fica o anterior, se ainda for membro desta conta; senão,
  -- ninguém. Nunca recusa a escrita: o resto do UPDATE segue.
  IF TG_OP = 'UPDATE'
     AND OLD.assigned_agent_id IS NOT NULL
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
     AND EXISTS (SELECT 1
                   FROM profiles
                  WHERE user_id = OLD.assigned_agent_id
                    AND account_id = OLD.account_id) THEN
    NEW.assigned_agent_id := OLD.assigned_agent_id;
  ELSE
    NEW.assigned_agent_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.cb_responsavel_tem_de_ser_membro() OWNER TO postgres;
-- Função de gatilho não é RPC (revogar não impede o disparo).
REVOKE EXECUTE ON FUNCTION public.cb_responsavel_tem_de_ser_membro() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER cb_responsavel_tem_de_ser_membro_trigger
  BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.cb_responsavel_tem_de_ser_membro();

-- ------------------------------------------------------------
-- 2) A correção, uma vez (depois do gatilho: sob a trava dele, nenhuma
--    escrita nova grava ex-membro enquanto ela varre)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.conversations c
     SET assigned_agent_id = NULL
   WHERE c.assigned_agent_id IS NOT NULL
     AND NOT EXISTS (SELECT 1
                       FROM public.profiles p
                      WHERE p.user_id = c.assigned_agent_id
                        AND p.account_id = c.account_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE '1148: % conversa(s) com responsável fora da conta voltaram para a fila.', v_n;
END $$;

-- ------------------------------------------------------------
-- 3) Remover membro (018/961/1067): a trava e as conversas de volta à fila
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID  -- the new personal account id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_caller_suspenso TIMESTAMPTZ;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- 1148: a trava, em ordem de user_id. O ALVO em FOR UPDATE (transferência
  -- de dono, suspensão e o gatilho do responsável esperam por ela); o
  -- CHAMADOR em FOR SHARE (o papel dele não muda no meio, e atribuir conversa
  -- a ele não espera). Ver o cabeçalho da 1148.
  IF auth.uid() < p_user_id THEN
    PERFORM 1 FROM profiles WHERE user_id = auth.uid() FOR SHARE;
    PERFORM 1 FROM profiles WHERE user_id = p_user_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM profiles WHERE user_id = p_user_id FOR UPDATE;
    PERFORM 1 FROM profiles WHERE user_id = auth.uid() FOR SHARE;
  END IF;

  SELECT account_id, account_role, suspenso_em
  INTO v_caller_account_id, v_caller_role, v_caller_suspenso
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- 1067
  IF v_caller_suspenso IS NOT NULL THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- 1148 (decisão do operador #16): as conversas em que a pessoa é
  -- responsável voltam para a fila. ANTES de mover o perfil: a trilha (1083)
  -- só acha o nome de quem saía enquanto ele ainda é desta conta.
  UPDATE conversations
     SET assigned_agent_id = NULL
   WHERE account_id = v_target_account_id
     AND assigned_agent_id = p_user_id;

  -- Spin up a fresh personal account for the removed user. Mirror
  -- of handle_new_user's logic — keep them whole, just relocated.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner',
      -- 961: o perfil é da conta que a pessoa está DEIXANDO. Sem esta linha,
      -- a FK composta da 957 estoura (perfil da conta antiga × conta nova) e
      -- a remoção inteira falha.
      perfil_id = NULL,
      -- 1067: a suspensão era desta conta. Dona da conta nova e suspensa,
      -- ficaria trancada sem ninguém para reativá-la.
      suspenso_em = NULL,
      suspenso_por = NULL
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

-- As duas metades (regra do CLAUDE.md): a produção já está assim
-- (`{postgres, authenticated, service_role}`); o banco novo fica igual.
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) O inventário da Lixeira: o corpo VIGENTE da 1110 + o gatilho novo em
--    `livres`
-- ------------------------------------------------------------
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
      -- 1148: o responsável que não é membro da conta não pega (fica o
      -- anterior, ou ninguém). A volta já grava membro ou nulo (o ajuste da
      -- fotografia, 1097), então aqui ele não muda nada.
      'conversations.cb_responsavel_tem_de_ser_membro_trigger',
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

-- Peça interna, como na 1097/1110 (`CREATE OR REPLACE` mantém o ACL; o
-- REVOKE repetido só deixa a intenção escrita).
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_tratamento() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Conferência 1 — estrutura (vale em banco vazio)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_corpo text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.conversations'::regclass
     AND t.tgname = 'cb_responsavel_tem_de_ser_membro_trigger'
     AND NOT t.tgisinternal;
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1148: o gatilho do responsável não existe';
  END IF;
  IF position('BEFORE INSERT OR UPDATE OF assigned_agent_id, account_id ON public.conversations FOR EACH ROW' IN v_def) = 0
     OR position(' WHEN ' IN v_def) > 0 THEN
    RAISE EXCEPTION '1148: o gatilho do responsável não tem a forma esperada: %', v_def;
  END IF;

  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.cb_responsavel_tem_de_ser_membro()'::regprocedure) THEN
    RAISE EXCEPTION '1148: a função do gatilho não é SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', 'public.cb_responsavel_tem_de_ser_membro()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_responsavel_tem_de_ser_membro()', 'EXECUTE') THEN
    RAISE EXCEPTION '1148: anon/authenticated executam a função do gatilho';
  END IF;

  -- A remoção: as duas peças novas e as guardas que vieram de antes (a lição
  -- da 922: um REPLACE que esquece um trecho apaga a guarda em silêncio).
  v_corpo := pg_get_functiondef('public.remove_account_member(uuid)'::regprocedure);
  -- As INSTRUÇÕES, não as palavras: o comentário do corpo também cita
  -- "FOR UPDATE" e "FOR SHARE", e a palavra solta passaria sem a trava.
  IF position('WHERE user_id = p_user_id FOR UPDATE' IN v_corpo) = 0
     OR position('WHERE user_id = auth.uid() FOR SHARE' IN v_corpo) = 0 THEN
    RAISE EXCEPTION '1148: remove_account_member perdeu a trava';
  END IF;
  IF position('SET assigned_agent_id = NULL' IN v_corpo) = 0
     OR position('SET assigned_agent_id = NULL' IN v_corpo) > position('UPDATE profiles' IN v_corpo) THEN
    RAISE EXCEPTION '1148: remove_account_member não devolve as conversas à fila ANTES de mover o perfil';
  END IF;
  IF v_corpo !~ 'perfil_id = NULL' OR v_corpo !~ 'suspenso_em = NULL' OR v_corpo !~ 'membro_suspenso' THEN
    RAISE EXCEPTION '1148: remove_account_member perdeu uma guarda da 961/1067';
  END IF;
  IF has_function_privilege('anon', 'public.remove_account_member(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.remove_account_member(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.remove_account_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1148: o EXECUTE de remove_account_member não é o esperado';
  END IF;

  -- A Lixeira: declarado em `livres`, e a conferência dela passa.
  IF NOT ((public.cb_lixeira_tratamento() -> 'livres') ? 'conversations.cb_responsavel_tem_de_ser_membro_trigger') THEN
    RAISE EXCEPTION '1148: o gatilho do responsável não está em livres na Lixeira';
  END IF;
  PERFORM public.cb_lixeira_conferir_gatilhos();

  -- A correção pegou tudo (sob a trava do gatilho: nada novo entrou).
  IF EXISTS (SELECT 1
               FROM public.conversations c
              WHERE c.assigned_agent_id IS NOT NULL
                AND NOT EXISTS (SELECT 1
                                  FROM public.profiles p
                                 WHERE p.user_id = c.assigned_agent_id
                                   AND p.account_id = c.account_id)) THEN
    RAISE EXCEPTION '1148: sobrou conversa com responsável fora da conta';
  END IF;
END $$;

-- ------------------------------------------------------------
-- Conferência 2 — comportamento, CHAMANDO as funções (regra 3 do CLAUDE.md)
--
-- O modelo da 1067: tudo num subbloco desfeito pela exceção própria P1148 —
-- nada sobra no banco (a trilha, o aviso do sino e a conta pessoal nova são
-- transacionais; o tempo real só vê o que foi confirmado). A FICHA e a
-- CONVERSA da prova são sintéticas, criadas aqui: nenhuma conversa real muda
-- de responsável. A remoção é de um membro real não-dono (o caminho só existe
-- com ele), desfeita junto. Banco sem membro não-dono numa conta com dono (o
-- replay do CI) pula com NOTICE (regra 2).
--
-- ⚠️ Roda com a trava do CREATE TRIGGER presa (escrita em `conversations`
-- espera): só leitura por índice e poucas linhas.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_alvo   uuid;   -- membro não-dono, ativo
  v_conta  uuid;
  v_dono   uuid;
  v_fora   uuid := gen_random_uuid();  -- ninguém
  v_ficha  uuid;
  v_conv   uuid;
  v_resp   uuid;
  v_antes  integer;
  v_depois integer;
BEGIN
  SELECT p.user_id, p.account_id, a.owner_user_id
  INTO v_alvo, v_conta, v_dono
  FROM public.profiles p
  JOIN public.accounts a ON a.id = p.account_id
  JOIN public.profiles d ON d.user_id = a.owner_user_id
                        AND d.account_id = a.id
                        AND d.account_role = 'owner'
                        AND d.suspenso_em IS NULL
  WHERE p.account_role IN ('agent', 'viewer', 'admin')
    AND p.suspenso_em IS NULL
    AND p.user_id <> a.owner_user_id
    -- A remoção cria a conta pessoal dela (uma por dono,
    -- `idx_accounts_one_per_owner`): quem já é dono de outra conta não serve
    -- à prova (0 assim na produção em 17/11/2026).
    AND NOT EXISTS (SELECT 1 FROM public.accounts o WHERE o.owner_user_id = p.user_id)
  ORDER BY (p.account_role = 'admin'), p.created_at
  LIMIT 1;

  IF v_alvo IS NULL THEN
    RAISE NOTICE '1148: sem membro não-dono (e sem conta própria) numa conta com dono — pulando a prova de comportamento.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_antes
    FROM public.conversations
   WHERE account_id = v_conta AND assigned_agent_id IS NOT NULL;

  BEGIN
    INSERT INTO public.contacts (user_id, account_id, instagram_id, name)
    VALUES (v_dono, v_conta, 'cb1148-' || gen_random_uuid()::text, '1148 prova')
    RETURNING id INTO v_ficha;

    -- (a) nasce com quem não é membro → sem responsável
    INSERT INTO public.conversations (user_id, account_id, contact_id, assigned_agent_id)
    VALUES (v_dono, v_conta, v_ficha, v_fora)
    RETURNING id, assigned_agent_id INTO v_conv, v_resp;
    IF v_resp IS NOT NULL THEN
      RAISE EXCEPTION '1148: a conversa nasceu com responsável de fora da conta';
    END IF;

    -- (b) o membro pega
    UPDATE public.conversations SET assigned_agent_id = v_alvo
     WHERE id = v_conv RETURNING assigned_agent_id INTO v_resp;
    IF v_resp IS DISTINCT FROM v_alvo THEN
      RAISE EXCEPTION '1148: o membro não pegou a conversa';
    END IF;

    -- (c) quem não é membro: fica o anterior
    UPDATE public.conversations SET assigned_agent_id = v_fora
     WHERE id = v_conv RETURNING assigned_agent_id INTO v_resp;
    IF v_resp IS DISTINCT FROM v_alvo THEN
      RAISE EXCEPTION '1148: a troca para quem não é membro não manteve o anterior';
    END IF;

    -- (d) sem anterior, quem não é membro não pega
    UPDATE public.conversations SET assigned_agent_id = NULL WHERE id = v_conv;
    UPDATE public.conversations SET assigned_agent_id = v_fora
     WHERE id = v_conv RETURNING assigned_agent_id INTO v_resp;
    IF v_resp IS NOT NULL THEN
      RAISE EXCEPTION '1148: quem não é membro pegou a conversa sem dono';
    END IF;

    -- (e) SUSPENSO conta como membro (a trava da 1067 só barra `authenticated`)
    UPDATE public.profiles SET suspenso_em = now(), suspenso_por = v_dono WHERE user_id = v_alvo;
    UPDATE public.conversations SET assigned_agent_id = v_alvo
     WHERE id = v_conv RETURNING assigned_agent_id INTO v_resp;
    IF v_resp IS DISTINCT FROM v_alvo THEN
      RAISE EXCEPTION '1148: o suspenso deixou de contar como membro';
    END IF;

    -- (f) remover, como o DONO, pelo caminho do navegador: as conversas
    --     voltam à fila e a pessoa sai sem a suspensão
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.remove_account_member(v_alvo);
    RESET ROLE;

    IF EXISTS (SELECT 1 FROM public.conversations
                WHERE account_id = v_conta AND assigned_agent_id = v_alvo) THEN
      RAISE EXCEPTION '1148: remove_account_member deixou conversa com quem saiu';
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles
                WHERE user_id = v_alvo
                  AND (account_id = v_conta OR suspenso_em IS NOT NULL)) THEN
      RAISE EXCEPTION '1148: a pessoa não saiu da conta (ou saiu suspensa)';
    END IF;

    -- (g) fora da conta, não pega mais
    UPDATE public.conversations SET assigned_agent_id = v_alvo
     WHERE id = v_conv RETURNING assigned_agent_id INTO v_resp;
    IF v_resp IS NOT NULL THEN
      RAISE EXCEPTION '1148: quem saiu da conta voltou a pegar conversa';
    END IF;

    -- Tudo certo: desfaz a prova inteira.
    RAISE EXCEPTION USING ERRCODE = 'P1148', MESSAGE = 'desfaz a prova de comportamento';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio. `WHEN OTHERS` engoliria justamente o erro que
    -- a prova existe para mostrar.
    WHEN SQLSTATE 'P1148' THEN NULL;
  END;

  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles
                  WHERE user_id = v_alvo AND account_id = v_conta AND suspenso_em IS NULL) THEN
    RAISE EXCEPTION '1148: a prova de comportamento não se desfez (a pessoa saiu da conta)';
  END IF;
  SELECT count(*) INTO v_depois
    FROM public.conversations
   WHERE account_id = v_conta AND assigned_agent_id IS NOT NULL;
  IF v_depois <> v_antes THEN
    RAISE EXCEPTION '1148: a prova de comportamento não se desfez (% × % conversas com responsável)', v_antes, v_depois;
  END IF;
END $$;
