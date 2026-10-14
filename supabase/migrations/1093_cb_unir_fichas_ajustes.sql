-- ============================================================
-- 1093 — Unir fichas: os ajustes da revisão da 1092 e as decisões do
-- operador sobre ela (14/10/2026). Plano: `docs/PLANO-fichas-duplicadas.md`.
--
-- A 1092 já está aplicada: a receita da fusão passa a ser a DESTA
-- migration (`CREATE OR REPLACE`). Só funções — nenhuma ALTER em tabela.
--
-- Decisões do operador (14/10/2026), refinando as da 1092:
--   D8' as execuções em andamento SEGUEM O CARD: a de card que fica continua,
--       venha de qual ficha vier; a de card que a D7 apaga termina (`fusao`);
--       a sem card segue a D8 (a da que fica continua, a da que sai termina);
--   D9' só o TELEFONE antigo encontra a ficha nos cadastros (nenhum cadastro
--       procura pelo e-mail ATUAL); o e-mail antigo só acende o aviso (sinal
--       4 da 1092);
--   D10 "Data e Hora Reunião" nas duas: fica a MAIS NOVA (os lembretes e a
--       pauta leem esse campo); a outra vai para o Histórico;
--   D11 a busca da API v1 (`?search=`) acha a ficha pelo telefone antigo
--       (código: `src/app/api/v1/contacts/route.ts`).
-- Consertos da revisão:
--   • o BSUID da que sai só passa quando uma das duas não tem telefone: com
--     os dois, a próxima mensagem do número antigo cairia na conversa unida
--     (o webhook da Meta casa pelo BSUID primeiro) e a resposta sairia para
--     o outro número (o envio prefere o telefone);
--   • a janela da Meta (993) é a do número para o qual a conversa unida
--     ENVIA — somar as duas dizia "aberta" para quem não abriu a janela;
--   • a espera (972) não ressuscita fala de conversa ENCERRADA;
--   • o que apontava para a CÓPIA repetida de uma mensagem (citação, reação,
--     ligação, turno da IA) passa para a mensagem que fica;
--   • a execução que segue com o card leva a conversa nova no contexto (a
--     retomada recusa conversa que não existe);
--   • a foto guarda os cards apagados das DUAS fichas, o BSUID que não
--     passou, o estado da IA da conversa que sai, os vínculos e o Atlas;
--   • as travas: CONVERSAS antes das fichas.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Peças novas — internas (só as RPCs da união as chamam, como dono)
-- ------------------------------------------------------------

-- 1.1 O instante de um valor de campo de data e hora: ISO 8601 COM fuso, a
-- forma que o Calendly e a tela gravam (medido em produção: 130 de 130).
-- Fora dela, ou data impossível, NULO — nunca erro: a união não pode
-- estourar por um valor torto.
CREATE OR REPLACE FUNCTION public.cb_instante_do_valor(p_valor text)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_valor IS NULL
     OR btrim(p_valor) !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_valor)::timestamptz;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN NULL;
END;
$$;

-- 1.2 As execuções EM ANDAMENTO das duas fichas e o destino de cada uma
-- (D8'): seguem o CARD. O card de uma execução é o `deal_id` do contexto da
-- espera dela (é por ele que a retomada mexe no card); sem card, vale a
-- ficha. Calculado ANTES de qualquer card mudar.
CREATE OR REPLACE FUNCTION public.cb_execucoes_da_uniao(p_fica uuid, p_sai uuid)
RETURNS TABLE (log_id uuid, da_ficha text, deal_id uuid, destino text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH cards AS (
    SELECT c.deal_id, c.acao FROM cb_cards_da_uniao(p_fica, p_sai) c
  ),
  vivas AS (
    SELECT l.id, l.contact_id,
           (SELECT e.context ->> 'deal_id'
              FROM automation_pending_executions e
             WHERE e.log_id = l.id AND e.status = 'pending'
               AND coalesce(e.context ->> 'deal_id', '') <> ''
             ORDER BY e.run_at
             LIMIT 1) AS card
      FROM automation_logs l
      JOIN contacts f ON f.id = p_fica
     WHERE l.account_id = f.account_id
       AND l.contact_id IN (p_fica, p_sai)
       AND l.finalizado_em IS NULL AND l.interrompida_em IS NULL
  )
  SELECT v.id,
         CASE WHEN v.contact_id = p_fica THEN 'fica' ELSE 'sai' END,
         c.deal_id,
         CASE WHEN c.acao = 'apaga' THEN 'interrompe'
              WHEN c.acao IS NOT NULL THEN 'segue'
              WHEN v.contact_id = p_sai THEN 'interrompe'
              ELSE 'segue' END
    FROM vivas v
    LEFT JOIN cards c ON c.deal_id::text = v.card
$$;

-- ------------------------------------------------------------
-- 2) O que não cabe numa ficha só — D10 no campo da reunião
-- ------------------------------------------------------------
-- Como a 1092, e: "Data e Hora Reunião" (`data_e_hora_reuniao`, a chave que
-- a pauta e os lembretes leem) fica com a MAIS NOVA das duas; o mesmo
-- instante escrito de dois jeitos não é divergência.
CREATE OR REPLACE FUNCTION public.cb_divergencias_da_uniao(p_fica uuid, p_sai uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH itens AS (
         -- o nome que NÃO ficou
         SELECT 1 AS ordem, NULL::text AS rotulo, 'nome' AS campo, NULL::uuid AS campo_id,
                n.nome AS ficou,
                CASE WHEN btrim(n.nome) = btrim(f.name) THEN s.name ELSE f.name END AS saiu
           FROM contacts f, contacts s, LATERAL cb_nome_da_uniao(f, s) n
          WHERE f.id = p_fica AND s.id = p_sai
            AND f.name ~ '[[:alpha:]]' AND s.name ~ '[[:alpha:]]'
            AND btrim(f.name) <> btrim(s.name)
         UNION ALL
         SELECT 2, NULL, 'empresa', NULL, f.company, s.company
           FROM contacts f, contacts s
          WHERE f.id = p_fica AND s.id = p_sai
            AND coalesce(btrim(f.company), '') <> '' AND coalesce(btrim(s.company), '') <> ''
            AND btrim(f.company) <> btrim(s.company)
         UNION ALL
         SELECT 3, cf.field_name, 'campo', cf.id,
                CASE WHEN x.sai_mais_nova THEN vs.value ELSE vf.value END,
                CASE WHEN x.sai_mais_nova THEN vf.value ELSE vs.value END
           FROM contact_custom_values vs
           JOIN contact_custom_values vf ON vf.contact_id = p_fica AND vf.custom_field_id = vs.custom_field_id
           JOIN custom_fields cf ON cf.id = vs.custom_field_id
           CROSS JOIN LATERAL (
             SELECT cf.field_key = 'data_e_hora_reuniao'
                    AND cb_instante_do_valor(vs.value) > cb_instante_do_valor(vf.value) AS sai_mais_nova,
                    cf.field_key = 'data_e_hora_reuniao'
                    AND cb_instante_do_valor(vs.value) = cb_instante_do_valor(vf.value) AS mesmo_instante
           ) x
          WHERE vs.contact_id = p_sai
            AND cf.espelho IS NULL
            AND coalesce(btrim(vs.value), '') <> '' AND coalesce(btrim(vf.value), '') <> ''
            AND btrim(vs.value) <> btrim(vf.value)
            AND x.mesmo_instante IS NOT TRUE
       )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'campo', i.campo, 'campo_id', i.campo_id, 'rotulo', i.rotulo,
           'ficou', i.ficou, 'saiu', i.saiu) ORDER BY i.ordem, i.rotulo), '[]'::jsonb)
    FROM itens i
$$;

-- ------------------------------------------------------------
-- 3) A PRÉVIA — como a 1092, com as execuções pela régua do card (D8')
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_previa_da_uniao(p_fica uuid, p_sai uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid;
  v_fica contacts;
  v_sai contacts;
  v_sugestao record;
  v_nome record;
  v_conversa_sai uuid;
  v_conversa_fica uuid;
  v_interrompidas integer;
  v_seguem integer;
BEGIN
  IF p_fica IS NULL OR p_sai IS NULL OR p_fica = p_sai THEN
    RAISE EXCEPTION 'mesma_ficha' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_fica FROM contacts WHERE id = p_fica;
  SELECT * INTO v_sai FROM contacts WHERE id = p_sai;
  IF v_fica.id IS NULL OR v_sai.id IS NULL THEN
    RAISE EXCEPTION 'ficha_nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  v_conta := v_fica.account_id;
  -- `is_account_member` confere a suspensão (1064): suspenso_em do chamador.
  IF auth.uid() IS NULL OR NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  IF v_sai.account_id <> v_conta THEN
    RAISE EXCEPTION 'contas_diferentes' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_sugestao FROM cb_ficha_sugerida_da_uniao(p_fica, p_sai);
  SELECT * INTO v_nome FROM cb_nome_da_uniao(v_fica, v_sai);
  SELECT id INTO v_conversa_sai FROM conversations WHERE contact_id = p_sai;
  SELECT id INTO v_conversa_fica FROM conversations WHERE contact_id = p_fica;
  SELECT count(*) FILTER (WHERE x.destino = 'interrompe'),
         count(*) FILTER (WHERE x.destino = 'segue' AND x.da_ficha = 'sai')
    INTO v_interrompidas, v_seguem
    FROM cb_execucoes_da_uniao(p_fica, p_sai) x;

  RETURN jsonb_build_object(
    'sugerida_fica', v_sugestao.ficha,
    'motivo_da_sugestao', v_sugestao.motivo,
    'bloqueios', to_jsonb(cb_bloqueios_da_uniao(p_fica, p_sai)),
    'nome_final', v_nome.nome,
    'cards', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'deal_id', c.deal_id, 'da_ficha', c.da_ficha, 'acao', c.acao,
               'fica_no_lugar', c.fica_no_lugar, 'pipeline_id', c.pipeline_id,
               'titulo', d.title, 'status', d.status,
               'funil', p.name, 'etapa', s.name)
             ORDER BY p.name, c.acao, d.created_at), '[]'::jsonb)
        FROM cb_cards_da_uniao(p_fica, p_sai) c
        JOIN deals d ON d.id = c.deal_id
        JOIN pipelines p ON p.id = d.pipeline_id
        JOIN pipeline_stages s ON s.id = d.stage_id
    ),
    'divergencias', cb_divergencias_da_uniao(p_fica, p_sai),
    'contatos_antigos', cb_contatos_antigos_da_uniao(p_fica, p_sai),
    'contagens', jsonb_build_object(
      -- As que PASSAM: a cópia da mesma mensagem do WhatsApp fica de fora.
      'mensagens', (SELECT count(*) FROM messages m
                     WHERE m.conversation_id = v_conversa_sai
                       AND (m.message_id IS NULL OR v_conversa_fica IS NULL OR NOT EXISTS (
                             SELECT 1 FROM messages x
                              WHERE x.conversation_id = v_conversa_fica AND x.message_id = m.message_id))),
      'anotacoes', (SELECT count(*) FROM cb_conversation_notes n WHERE n.contact_id = p_sai),
      'tarefas', (SELECT count(*) FROM cb_tasks t WHERE t.contact_id = p_sai),
      'etiquetas_novas', (
        SELECT count(*) FROM contact_tags t
         WHERE t.contact_id = p_sai
           AND NOT EXISTS (SELECT 1 FROM contact_tags x WHERE x.contact_id = p_fica AND x.tag_id = t.tag_id)),
      'campos_preenchidos', (
        SELECT count(*) FROM contact_custom_values v
          JOIN custom_fields cf ON cf.id = v.custom_field_id
         WHERE v.contact_id = p_sai AND cf.espelho IS NULL
           AND coalesce(btrim(v.value), '') <> ''
           AND NOT EXISTS (SELECT 1 FROM contact_custom_values x
                            WHERE x.contact_id = p_fica AND x.custom_field_id = v.custom_field_id
                              AND coalesce(btrim(x.value), '') <> '')),
      'agendadas', (SELECT count(*) FROM cb_scheduled_messages a
                     WHERE a.conversation_id = v_conversa_sai AND a.status IN ('pending', 'sending')),
      -- D8': das DUAS fichas (a de card apagado também termina).
      'automacoes_interrompidas', v_interrompidas,
      -- As da ficha que sai que continuam com o card dela.
      'automacoes_que_seguem', v_seguem,
      'robos_parados', (
        SELECT count(*) FROM flow_runs r
         WHERE r.account_id = v_conta AND r.contact_id = p_sai AND r.status = 'active')
    )
  );
END;
$$;

-- ------------------------------------------------------------
-- 4) A UNIÃO — uma transação; ou tudo, ou nada
-- ------------------------------------------------------------
-- `lock_timeout` curto: a conversa é a linha mais escrita do CRM, e a
-- união que espera vira "tente de novo" na tela — nunca uma fila atrás de
-- mensagens de cliente.
CREATE OR REPLACE FUNCTION public.cb_unir_fichas(p_fica uuid, p_sai uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conta uuid;
  v_quem text;
  v_fica contacts;
  v_sai contacts;
  v_conv_fica conversations;
  v_conv_sai conversations;
  v_conversa uuid;
  v_bloqueios text[];
  v_fusao uuid := gen_random_uuid();
  v_foto jsonb;
  v_divergencias jsonb;
  v_antigos jsonb;
  v_nome record;
  v_card record;
  v_card_sai deals;
  v_cards_saem text[];
  v_cards_ficam text[];
  v_logs uuid[];
  v_vivas uuid[];
  v_n integer;
  v_resumo jsonb := '{}'::jsonb;
  v_mais_recente boolean;
  v_bsuid_passa boolean;
  v_janela_da_sai boolean;
  v_espera timestamptz;
  v_copias uuid[];
  v_originais uuid[];
  v_tabela regclass;
  v_coluna text;
  v_sobrou boolean;
BEGIN
  -- ── 1. Porta: sessão de ADMIN da conta, sem suspensão ──
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  IF p_fica IS NULL OR p_sai IS NULL OR p_fica = p_sai THEN
    RAISE EXCEPTION 'mesma_ficha' USING ERRCODE = 'P0001';
  END IF;
  SELECT account_id INTO v_conta FROM contacts WHERE id = p_fica;
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'ficha_nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  -- O nome de quem uniu, congelado no livro. A suspensão já foi conferida
  -- acima; repetida aqui porque esta leitura ignora a RLS (1067).
  SELECT coalesce(nullif(p.full_name, ''), p.email) INTO v_quem
    FROM profiles p
   WHERE p.user_id = v_uid AND p.account_id = v_conta AND p.suspenso_em IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;

  -- ── 2. Travas: as CONVERSAS primeiro, depois as fichas ──
  -- É a ordem dos gatilhos: mudar a situação ou o responsável da conversa
  -- grava na trilha e no sino com FK para a ficha (trava a conversa, depois a
  -- ficha). Na ordem inversa, uma reabertura no mesmo instante fecharia um
  -- ciclo com a união, e a vítima do deadlock podia ser a ingestão. Ids em
  -- ordem: duas uniões cruzadas não fecham ciclo entre si.
  PERFORM 1 FROM conversations c WHERE c.contact_id IN (p_fica, p_sai) ORDER BY c.id FOR UPDATE;
  PERFORM 1 FROM contacts c WHERE c.id IN (p_fica, p_sai) ORDER BY c.id FOR UPDATE;
  -- A conversa criada entre as duas travas (a ficha ainda estava livre).
  PERFORM 1 FROM conversations c WHERE c.contact_id IN (p_fica, p_sai) ORDER BY c.id FOR UPDATE;
  SELECT * INTO v_fica FROM contacts WHERE id = p_fica;
  SELECT * INTO v_sai FROM contacts WHERE id = p_sai;
  IF v_sai.id IS NULL OR v_fica.id IS NULL THEN
    RAISE EXCEPTION 'ficha_nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_sai.account_id <> v_conta THEN
    RAISE EXCEPTION 'contas_diferentes' USING ERRCODE = 'P0001';
  END IF;
  v_bloqueios := cb_bloqueios_da_uniao(p_fica, p_sai);
  IF cardinality(v_bloqueios) > 0 THEN
    RAISE EXCEPTION 'bloqueada:%', v_bloqueios[1] USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_conv_fica FROM conversations WHERE contact_id = p_fica;
  SELECT * INTO v_conv_sai FROM conversations WHERE contact_id = p_sai;

  -- Identidade e janela, decididas pelas fichas COMO ESTAVAM. O BSUID da que
  -- sai só passa quando uma das duas não tem telefone: com os dois, ele
  -- levaria a mensagem do número antigo para a conversa unida (o webhook da
  -- Meta casa pelo BSUID primeiro) e a resposta sairia para o outro número
  -- (o envio prefere o telefone) — e a D9 diz que o número antigo abre ficha
  -- própria. A janela da Meta é a do número para o qual a conversa unida vai
  -- ENVIAR: a da que sai só quando o telefone (ou o BSUID) dela passa a ser
  -- o da ficha.
  v_bsuid_passa := v_sai.phone IS NULL OR v_fica.phone IS NULL;
  v_janela_da_sai := v_fica.phone IS NULL
                     AND (v_sai.phone IS NOT NULL
                          OR (v_fica.wa_user_id IS NULL AND v_sai.wa_user_id IS NOT NULL));

  -- ── 3. A foto da que sai e o que não cabe numa ficha só — ANTES de mexer ──
  v_foto := jsonb_build_object(
    'ficha', jsonb_build_object(
      'id', v_sai.id, 'nome', v_sai.name, 'telefone', v_sai.phone, 'email', v_sai.email,
      'empresa', v_sai.company, 'criada_em', v_sai.created_at,
      'wa_username', v_sai.wa_username, 'wa_user_id', v_sai.wa_user_id,
      'nome_fixado_em', v_sai.nome_fixado_em),
    'campos', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'campo_id', v.custom_field_id, 'nome', cf.field_name, 'valor', v.value)
             ORDER BY cf.field_name), '[]'::jsonb)
        FROM contact_custom_values v JOIN custom_fields cf ON cf.id = v.custom_field_id
       WHERE v.contact_id = p_sai AND coalesce(btrim(v.value), '') <> ''),
    'etiquetas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.name) ORDER BY t.name), '[]'::jsonb)
        FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.contact_id = p_sai),
    'cards', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'titulo', d.title, 'funil', pl.name, 'etapa', st.name,
               'status', d.status, 'valor', d.value, 'kommo_lead_id', d.kommo_lead_id)
             ORDER BY d.created_at), '[]'::jsonb)
        FROM deals d
        JOIN pipelines pl ON pl.id = d.pipeline_id
        JOIN pipeline_stages st ON st.id = d.stage_id
       WHERE d.contact_id = p_sai),
    -- Os cards que a D7 apaga, das DUAS fichas: o da que fica não estava na
    -- foto, e o valor, as notas e o id da Kommo dele sumiam de tudo.
    'cards_apagados', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', d.id, 'da_ficha', u.da_ficha, 'ficou_no_lugar', u.fica_no_lugar,
               'titulo', d.title, 'funil', pl.name, 'etapa', st.name, 'status', d.status,
               'valor', d.value, 'notas', d.notes, 'kommo_lead_id', d.kommo_lead_id)
             ORDER BY d.created_at), '[]'::jsonb)
        FROM cb_cards_da_uniao(p_fica, p_sai) u
        JOIN deals d ON d.id = u.deal_id
        JOIN pipelines pl ON pl.id = d.pipeline_id
        JOIN pipeline_stages st ON st.id = d.stage_id
       WHERE u.acao = 'apaga'),
    'conversa', CASE WHEN v_conv_sai.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conv_sai.id, 'status', v_conv_sai.status, 'criada_em', v_conv_sai.created_at,
      'canal', v_conv_sai.channel_id, 'responsavel', v_conv_sai.assigned_agent_id,
      'ia_desligada', v_conv_sai.ai_autoreply_disabled, 'ia_agente', v_conv_sai.ia_agente_id,
      'ia_pausada_por', v_conv_sai.ia_pausada_por, 'ia_resumo', v_conv_sai.ai_handoff_summary) END,
    -- Vínculos (1069) e Atlas (1071) da que sai: o repetido, e o Atlas de
    -- outro vínculo no mesmo ambiente, não passam — ficam aqui.
    'relacionados', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'ficha', CASE WHEN r.contact_a_id = p_sai THEN r.contact_b_id ELSE r.contact_a_id END,
               'descricao', r.descricao)), '[]'::jsonb)
        FROM cb_contatos_relacionados r
       WHERE p_sai IN (r.contact_a_id, r.contact_b_id)),
    'atlas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'api_url', a.api_url, 'atlas_client_id', a.atlas_client_id)), '[]'::jsonb)
        FROM cb_atlas_clientes a
       WHERE a.contact_id = p_sai)
  );
  v_divergencias := cb_divergencias_da_uniao(p_fica, p_sai);
  v_antigos := cb_contatos_antigos_da_uniao(p_fica, p_sai);
  SELECT * INTO v_nome FROM cb_nome_da_uniao(v_fica, v_sai);

  -- ── 4. D8' (14/10/2026): as execuções em andamento SEGUEM O CARD ──
  -- (`cb_execucoes_da_uniao`) A de card que fica continua, venha de qual
  -- ficha vier; a de card que a D7 apaga termina; sem card, a da que sai
  -- termina e a da que fica continua. A marca durável é a dos outros
  -- cancelamentos (1005): a retomada e o estacionamento a leem; a falha
  -- ADIADA ganha a hora de fim (como `marcarExecucoesInterrompidas`).
  SELECT coalesce(array_agg(c.deal_id::text) FILTER (WHERE c.acao = 'apaga'), '{}'),
         coalesce(array_agg(c.deal_id::text) FILTER (WHERE c.acao <> 'apaga'), '{}')
    INTO v_cards_saem, v_cards_ficam
    FROM cb_cards_da_uniao(p_fica, p_sai) c;
  SELECT coalesce(array_agg(x.log_id) FILTER (WHERE x.destino = 'interrompe'), '{}'),
         coalesce(array_agg(x.log_id), '{}')
    INTO v_logs, v_vivas
    FROM cb_execucoes_da_uniao(p_fica, p_sai) x;
  UPDATE automation_logs l
     SET interrompida_em = now(),
         interrompida_por = 'fusao',
         finalizado_em = CASE WHEN l.desfecho = 'falhou' THEN now() ELSE l.finalizado_em END
   WHERE l.id = ANY (v_logs);
  v_resumo := v_resumo || jsonb_build_object('automacoes_interrompidas', cardinality(v_logs));

  -- As esperas: as das execuções que terminam; as soltas (sem execução viva)
  -- pela mesma régua do card — apagado termina, que fica continua; sem card,
  -- só as da que sai.
  UPDATE automation_pending_executions e
     SET status = 'cancelled'
   WHERE e.account_id = v_conta AND e.status = 'pending'
     AND (e.log_id = ANY (v_logs)
          OR (e.contact_id IN (p_fica, p_sai)
              AND (e.log_id IS NULL OR e.log_id <> ALL (v_vivas))
              AND CASE WHEN e.context ->> 'deal_id' = ANY (v_cards_saem) THEN true
                       WHEN e.context ->> 'deal_id' = ANY (v_cards_ficam) THEN false
                       ELSE e.contact_id = p_sai END));

  -- O robô: uma PESSOA decidiu (955) — e a que fica pode ter o seu ativo
  -- (um por ficha, `idx_one_active_run_per_contact`).
  UPDATE flow_runs r
     SET status = 'stopped_by_agent', ended_at = now(), end_reason = 'fichas_unidas'
   WHERE r.account_id = v_conta AND r.contact_id = p_sai AND r.status = 'active';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_resumo := v_resumo || jsonb_build_object('robos_parados', v_n);

  -- ── 5. Cards (D7) ──
  -- 5.1 Os que saem: a história e o que só eles tinham passam ao que fica.
  v_n := 0;
  FOR v_card IN
    SELECT c.deal_id, c.fica_no_lugar FROM cb_cards_da_uniao(p_fica, p_sai) c WHERE c.acao = 'apaga'
  LOOP
    SELECT * INTO v_card_sai FROM deals WHERE id = v_card.deal_id;
    UPDATE cb_lead_events SET deal_id = v_card.fica_no_lugar WHERE deal_id = v_card.deal_id;
    UPDATE cb_zapsign_documentos SET deal_id = v_card.fica_no_lugar WHERE deal_id = v_card.deal_id;
    UPDATE cb_zapsign_eventos SET deal_id = v_card.fica_no_lugar WHERE deal_id = v_card.deal_id;
    UPDATE cb_ia_turnos SET deal_id = v_card.fica_no_lugar WHERE deal_id = v_card.deal_id;
    -- Evento de funil AINDA NÃO processado do card que sai: dispararia a
    -- automação da etapa por um card que não existe mais.
    DELETE FROM cb_automation_events
     WHERE deal_id = v_card.deal_id AND processado_em IS NULL;

    -- `kommo_lead_id` é chave de reexecução da carga (1012): zera aqui
    -- ANTES de ir para o que fica (índice único por conta). Com os dois
    -- carimbados, fica o do card que fica (o outro está na foto).
    IF v_card_sai.kommo_lead_id IS NOT NULL THEN
      UPDATE deals SET kommo_lead_id = NULL WHERE id = v_card.deal_id;
    END IF;
    UPDATE deals k
       SET value = CASE WHEN coalesce(k.value, 0) = 0 THEN coalesce(v_card_sai.value, k.value) ELSE k.value END,
           notes = CASE
                     WHEN coalesce(btrim(v_card_sai.notes), '') = '' THEN k.notes
                     WHEN coalesce(btrim(k.notes), '') = '' THEN v_card_sai.notes
                     WHEN btrim(k.notes) = btrim(v_card_sai.notes) THEN k.notes
                     ELSE k.notes || E'\n\n' || v_card_sai.notes
                   END,
           assigned_to = coalesce(k.assigned_to, v_card_sai.assigned_to),
           expected_close_date = coalesce(k.expected_close_date, v_card_sai.expected_close_date),
           channel_id = coalesce(k.channel_id, v_card_sai.channel_id),
           kommo_lead_id = coalesce(k.kommo_lead_id, v_card_sai.kommo_lead_id)
     WHERE k.id = v_card.fica_no_lugar;
    -- O gatilho da 912 grava `deal_deleted` com quem uniu.
    DELETE FROM deals WHERE id = v_card.deal_id;
    v_n := v_n + 1;
  END LOOP;
  v_resumo := v_resumo || jsonb_build_object('cards_apagados', v_n);

  -- 5.2 Os que passam inteiros. O título que deriva da pessoa (sem marca de
  -- título escrito, 1007) segue o nome final; o card de conexão vira
  -- `manual` quando a que fica já tem um (o índice da 911 aceita um só).
  UPDATE deals d
     SET contact_id = p_fica,
         source = CASE
                    WHEN d.source = 'channel' AND EXISTS (
                      SELECT 1 FROM deals x
                       WHERE x.account_id = v_conta AND x.contact_id = p_fica AND x.source = 'channel')
                    THEN 'manual' ELSE d.source END,
         title = CASE
                   WHEN d.titulo_fixado_em IS NULL AND d.status = 'open'
                        AND coalesce(v_nome.nome, '') ~ '[[:alpha:]]'
                   THEN btrim(v_nome.nome) ELSE d.title END
   WHERE d.account_id = v_conta AND d.contact_id = p_sai;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_resumo := v_resumo || jsonb_build_object('cards_movidos', v_n);

  -- ── 6. Conversa (uma por ficha, 036) ──
  IF v_conv_sai.id IS NOT NULL AND v_conv_fica.id IS NULL THEN
    -- Só a que sai tinha: a conversa inteira passa, com tudo dentro (o
    -- contexto das execuções que seguem continua valendo). A janela da Meta
    -- dela é do número da que SAI: se a que fica envia para o PRÓPRIO
    -- número, a janela começa fechada (vazia) até esse número escrever.
    UPDATE conversations
       SET contact_id = p_fica,
           janela_meta = CASE WHEN v_janela_da_sai THEN janela_meta ELSE '{}'::jsonb END
     WHERE id = v_conv_sai.id;
    v_conversa := v_conv_sai.id;
    v_resumo := v_resumo || jsonb_build_object('conversa', 'passou');
  ELSIF v_conv_sai.id IS NOT NULL THEN
    v_conversa := v_conv_fica.id;
    -- O agente de IA da que sai para (D8): o turno pendente responderia por
    -- uma conversa que não existe mais.
    UPDATE cb_ia_turnos t
       SET status = 'descartado', erro = 'fichas unidas', terminado_em = now(), updated_at = now()
     WHERE t.conversation_id = v_conv_sai.id AND t.status IN ('aguardando', 'rodando');

    -- A espera (972) da conversa unida, calculada ANTES de as mensagens
    -- mudarem de conversa: contam só as falas do cliente das conversas
    -- ABERTAS, a partir da espera de cada uma (encerrar limpa a espera — a
    -- fala antiga da encerrada não volta), sem resposta de gente ou do
    -- agente de IA depois, nas duas. A cópia repetida da que sai não conta.
    SELECT min(m.created_at) INTO v_espera
      FROM messages m
     WHERE m.sender_type = 'customer'
       AND m.deleted_at IS NULL
       AND ((m.conversation_id = v_conv_fica.id AND v_conv_fica.status <> 'closed'
             AND m.created_at >= v_conv_fica.aguardando_desde)
            OR (m.conversation_id = v_conv_sai.id AND v_conv_sai.status <> 'closed'
                AND m.created_at >= v_conv_sai.aguardando_desde
                AND (m.message_id IS NULL OR NOT EXISTS (
                      SELECT 1 FROM messages x
                       WHERE x.conversation_id = v_conv_fica.id AND x.message_id = m.message_id))))
       AND m.created_at > coalesce((
             SELECT max(h.created_at)
               FROM messages h
              WHERE h.conversation_id IN (v_conv_fica.id, v_conv_sai.id)
                AND ((h.sender_type = 'agent' AND (h.sender_id IS NOT NULL OR h.from_device))
                     OR (h.sender_type = 'bot' AND h.ia_agente_id IS NOT NULL))
                AND h.deleted_at IS NULL
                AND NOT h.nao_saiu
           ), '-infinity'::timestamptz);

    -- Mensagens: a mesma mensagem do WhatsApp nas duas (o índice da
    -- conversa + `message_id`) fica com a cópia da que fica.
    UPDATE messages m
       SET conversation_id = v_conv_fica.id
     WHERE m.conversation_id = v_conv_sai.id
       AND (m.message_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM messages x
              WHERE x.conversation_id = v_conv_fica.id AND x.message_id = m.message_id));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_resumo := v_resumo || jsonb_build_object('conversa', 'mesclada', 'mensagens', v_n);
    UPDATE message_reactions r
       SET conversation_id = v_conv_fica.id
      FROM messages m
     WHERE r.conversation_id = v_conv_sai.id AND m.id = r.message_id
       AND m.conversation_id = v_conv_fica.id;

    -- As CÓPIAS repetidas ficam na que sai e vão com ela; o que apontava
    -- para uma cópia passa para a mensagem que fica (a citação e a reação
    -- sumiam; a ligação, o turno e a retida perdiam a bolha).
    SELECT coalesce(array_agg(s.id ORDER BY s.id), '{}'), coalesce(array_agg(f.id ORDER BY s.id), '{}')
      INTO v_copias, v_originais
      FROM messages s
      JOIN messages f ON f.conversation_id = v_conv_fica.id AND f.message_id = s.message_id
     WHERE s.conversation_id = v_conv_sai.id AND s.message_id IS NOT NULL;
    IF cardinality(v_copias) > 0 THEN
      UPDATE messages m SET reply_to_message_id = p.original
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE m.conversation_id = v_conv_fica.id AND m.reply_to_message_id = p.copia;
      UPDATE cb_scheduled_messages a SET reply_to_message_id = p.original
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE a.reply_to_message_id = p.copia;
      UPDATE message_reactions r SET message_id = p.original, conversation_id = v_conv_fica.id
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE r.message_id = p.copia
         AND NOT EXISTS (SELECT 1 FROM message_reactions x
                          WHERE x.message_id = p.original AND x.actor_type = r.actor_type
                            AND x.actor_id IS NOT DISTINCT FROM r.actor_id);
      UPDATE cb_ligacoes g SET message_id = p.original
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE g.message_id = p.copia;
      UPDATE cb_ia_turnos t SET mensagem_gatilho_id = p.original
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE t.mensagem_gatilho_id = p.copia;
      UPDATE cb_ia_turnos t SET mensagem_inicial_id = p.original
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE t.mensagem_inicial_id = p.copia;
      UPDATE flow_runs r SET last_prompt_message_id = p.original
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE r.last_prompt_message_id = p.copia;
      UPDATE cb_mensagens_sem_telefone s SET message_id = p.original
        FROM unnest(v_copias, v_originais) AS p(copia, original)
       WHERE s.message_id = p.copia;
    END IF;

    UPDATE cb_conversation_notes SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE cb_scheduled_messages SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE cb_conversation_favorites f SET conversation_id = v_conv_fica.id
     WHERE f.conversation_id = v_conv_sai.id
       AND NOT EXISTS (SELECT 1 FROM cb_conversation_favorites x
                        WHERE x.user_id = f.user_id AND x.conversation_id = v_conv_fica.id);
    -- A análise do Radar é UMA por conversa: a da que fica vale; sem ela, a
    -- da que sai passa (a próxima análise refaz a janela).
    UPDATE cb_conversation_insights i SET conversation_id = v_conv_fica.id
     WHERE i.conversation_id = v_conv_sai.id
       AND NOT EXISTS (SELECT 1 FROM cb_conversation_insights x WHERE x.conversation_id = v_conv_fica.id);
    UPDATE cb_ia_turnos SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE notifications SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE ai_usage_log SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE cb_ligacoes SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE cb_meetings SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE deals SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    UPDATE flow_runs SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    -- A trilha da conversa (1083) não tem FK: diz de qual conversa era.
    UPDATE cb_lead_events SET conversation_id = v_conv_fica.id WHERE conversation_id = v_conv_sai.id;
    -- A execução que segue (D8') leva a conversa nova: a retomada confere
    -- que a conversa do contexto é do contato e recusa a que não existe.
    UPDATE automation_pending_executions e
       SET context = jsonb_set(e.context, '{conversation_id}', to_jsonb(v_conv_fica.id::text))
     WHERE e.account_id = v_conta AND e.status = 'pending'
       AND e.context ->> 'conversation_id' = v_conv_sai.id::text;

    -- O estado da conversa que fica. A que sai estava ABERTA e a que fica
    -- encerrada: a conversa reabre com a situação e o responsável da que
    -- sai (a trilha da 1083 grava "reaberta" por quem uniu). As não lidas
    -- somam; a prévia é a da mais recente; o canal segue a mais recente,
    -- salvo canal FIXADO na que fica. A janela da Meta (993) é a do número
    -- para o qual a conversa ENVIA (somar as duas diria "aberta" para quem
    -- não abriu a janela — a Meta recusa o texto livre). A espera é a
    -- calculada acima; encerradas as duas, fica como está.
    v_mais_recente := coalesce(v_conv_sai.last_message_at > v_conv_fica.last_message_at,
                               v_conv_fica.last_message_at IS NULL AND v_conv_sai.last_message_at IS NOT NULL);
    UPDATE conversations c
       SET status = CASE WHEN c.status = 'closed' AND v_conv_sai.status <> 'closed'
                         THEN v_conv_sai.status ELSE c.status END,
           assigned_agent_id = CASE WHEN c.status = 'closed' AND v_conv_sai.status <> 'closed'
                                    THEN v_conv_sai.assigned_agent_id ELSE c.assigned_agent_id END,
           unread_count = coalesce(c.unread_count, 0) + coalesce(v_conv_sai.unread_count, 0),
           last_message_text = CASE WHEN v_mais_recente THEN v_conv_sai.last_message_text ELSE c.last_message_text END,
           last_message_at = CASE WHEN v_mais_recente THEN v_conv_sai.last_message_at ELSE c.last_message_at END,
           channel_id = CASE WHEN NOT c.channel_pinned AND v_conv_sai.channel_id IS NOT NULL
                              AND (v_mais_recente OR c.channel_id IS NULL)
                             THEN v_conv_sai.channel_id ELSE c.channel_id END,
           channel_pinned = CASE WHEN NOT c.channel_pinned AND v_conv_sai.channel_id IS NOT NULL
                                  AND (v_mais_recente OR c.channel_id IS NULL)
                                 THEN v_conv_sai.channel_pinned ELSE c.channel_pinned END,
           janela_meta = CASE WHEN v_janela_da_sai THEN v_conv_sai.janela_meta ELSE c.janela_meta END,
           aguardando_desde = CASE WHEN c.status = 'closed' AND v_conv_sai.status = 'closed'
                                   THEN c.aguardando_desde ELSE v_espera END,
           created_at = least(c.created_at, v_conv_sai.created_at)
     WHERE c.id = v_conv_fica.id;
  ELSE
    v_conversa := v_conv_fica.id;
  END IF;

  -- ── 7. A ficha que fica: completa o que falta ──
  -- O e-mail entra pelo UPDATE (o espelho da 1000 grava o campo "E-mail").
  UPDATE contacts c
     SET name = v_nome.nome,
         nome_fixado_em = v_nome.nome_fixado_em,
         email = CASE WHEN coalesce(btrim(c.email), '') = '' THEN v_sai.email ELSE c.email END,
         company = CASE WHEN coalesce(btrim(c.company), '') = '' THEN v_sai.company ELSE c.company END,
         avatar_url = coalesce(c.avatar_url, v_sai.avatar_url),
         avatar_checked_at = CASE WHEN c.avatar_url IS NULL THEN v_sai.avatar_checked_at ELSE c.avatar_checked_at END
   WHERE c.id = p_fica;

  -- D10: "Data e Hora Reunião" nas duas — fica a MAIS NOVA (os lembretes e
  -- a pauta leem esse campo; a reunião futura da que sai não pode ficar de
  -- fora). A outra está em `divergencias`.
  UPDATE contact_custom_values vf
     SET value = vs.value
    FROM contact_custom_values vs, custom_fields cf
   WHERE vf.contact_id = p_fica AND vs.contact_id = p_sai
     AND vs.custom_field_id = vf.custom_field_id
     AND cf.id = vf.custom_field_id AND cf.espelho IS NULL
     AND cf.field_key = 'data_e_hora_reuniao'
     AND cb_instante_do_valor(vs.value) > cb_instante_do_valor(vf.value);
  -- Campos: o vazio da que fica recebe o da que sai; o que ela não tem passa
  -- inteiro. Valor diferente nas duas: fica o da que fica (o outro está em
  -- `divergencias`). O campo espelhado (e-mail) é do UPDATE acima.
  UPDATE contact_custom_values vf
     SET value = vs.value
    FROM contact_custom_values vs, custom_fields cf
   WHERE vf.contact_id = p_fica AND vs.contact_id = p_sai
     AND vs.custom_field_id = vf.custom_field_id
     AND cf.id = vf.custom_field_id AND cf.espelho IS NULL
     AND coalesce(btrim(vf.value), '') = '' AND coalesce(btrim(vs.value), '') <> '';
  UPDATE contact_custom_values vs
     SET contact_id = p_fica
    FROM custom_fields cf
   WHERE vs.contact_id = p_sai
     AND cf.id = vs.custom_field_id AND cf.espelho IS NULL
     AND coalesce(btrim(vs.value), '') <> ''
     AND NOT EXISTS (SELECT 1 FROM contact_custom_values x
                      WHERE x.contact_id = p_fica AND x.custom_field_id = vs.custom_field_id);

  -- ── 8. O resto que é da PESSOA ──
  -- Etiquetas por UPDATE: não acende a trilha (gatilho de INSERT/DELETE) nem
  -- a automação `tag_added` (que sai do código) — a etiqueta não é nova.
  UPDATE contact_tags t SET contact_id = p_fica
   WHERE t.contact_id = p_sai
     AND NOT EXISTS (SELECT 1 FROM contact_tags x WHERE x.contact_id = p_fica AND x.tag_id = t.tag_id);
  UPDATE cb_tasks SET contact_id = p_fica WHERE contact_id = p_sai AND account_id = v_conta;
  -- A anotação fixada é UMA por ficha (índice da 951): a da que fica
  -- continua fixada; a da que sai passa como anotação comum.
  UPDATE cb_conversation_notes n SET fixada_em = NULL
   WHERE n.contact_id = p_sai AND n.fixada_em IS NOT NULL
     AND EXISTS (SELECT 1 FROM cb_conversation_notes x
                  WHERE x.contact_id = p_fica AND x.fixada_em IS NOT NULL);
  UPDATE cb_conversation_notes SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE cb_automation_reminders r SET contact_id = p_fica
   WHERE r.contact_id = p_sai
     AND NOT EXISTS (SELECT 1 FROM cb_automation_reminders x
                      WHERE x.automation_id = r.automation_id AND x.contact_id = p_fica AND x.valor = r.valor);

  -- Relacionados (1069): o vínculo vale para as duas pontas. Vira repetido
  -- ou liga a ficha a si mesma → fica para o CASCADE (está na foto); a
  -- descrição que só o da que sai tinha passa ao da que fica.
  UPDATE cb_contatos_relacionados f
     SET descricao = s.descricao
    FROM cb_contatos_relacionados s
   WHERE coalesce(btrim(f.descricao), '') = '' AND coalesce(btrim(s.descricao), '') <> ''
     AND p_fica IN (f.contact_a_id, f.contact_b_id)
     AND p_sai IN (s.contact_a_id, s.contact_b_id)
     AND (CASE WHEN f.contact_a_id = p_fica THEN f.contact_b_id ELSE f.contact_a_id END)
       = (CASE WHEN s.contact_a_id = p_sai THEN s.contact_b_id ELSE s.contact_a_id END);
  UPDATE cb_contatos_relacionados r
     SET contact_a_id = CASE WHEN r.contact_a_id = p_sai THEN p_fica ELSE r.contact_a_id END,
         contact_b_id = CASE WHEN r.contact_b_id = p_sai THEN p_fica ELSE r.contact_b_id END
   WHERE p_sai IN (r.contact_a_id, r.contact_b_id)
     AND p_fica NOT IN (r.contact_a_id, r.contact_b_id)
     AND NOT EXISTS (
       SELECT 1 FROM cb_contatos_relacionados x
        WHERE p_fica IN (x.contact_a_id, x.contact_b_id)
          AND (CASE WHEN x.contact_a_id = p_fica THEN x.contact_b_id ELSE x.contact_a_id END)
            = (CASE WHEN r.contact_a_id = p_sai THEN r.contact_b_id ELSE r.contact_a_id END));

  -- "Não é duplicata" (1088): par ORDENADO — regravado, nunca só trocado.
  INSERT INTO cb_duplicatas_descartadas (account_id, contato_menor, contato_maior, descartado_por, descartado_em)
  SELECT d.account_id,
         least(p_fica, CASE WHEN d.contato_menor = p_sai THEN d.contato_maior ELSE d.contato_menor END),
         greatest(p_fica, CASE WHEN d.contato_menor = p_sai THEN d.contato_maior ELSE d.contato_menor END),
         d.descartado_por, d.descartado_em
    FROM cb_duplicatas_descartadas d
   WHERE p_sai IN (d.contato_menor, d.contato_maior)
     AND p_fica NOT IN (d.contato_menor, d.contato_maior)
  ON CONFLICT (contato_menor, contato_maior) DO NOTHING;

  -- Atlas (1071/1072): 1:1 POR AMBIENTE. Já ligada ao Atlas no mesmo
  -- ambiente, a que fica mantém o seu e o da que sai fica sem ficha (SET
  -- NULL; está na foto).
  UPDATE cb_atlas_clientes a SET contact_id = p_fica
   WHERE a.contact_id = p_sai
     AND NOT EXISTS (SELECT 1 FROM cb_atlas_clientes x
                      WHERE x.account_id = a.account_id AND x.api_url IS NOT DISTINCT FROM a.api_url
                        AND x.contact_id = p_fica);
  UPDATE cb_atlas_recusas a SET contact_id = p_fica
   WHERE a.contact_id = p_sai
     AND NOT EXISTS (SELECT 1 FROM cb_atlas_recusas x
                      WHERE x.account_id = a.account_id AND x.api_url IS NOT DISTINCT FROM a.api_url
                        AND x.contact_id = p_fica AND x.atlas_client_id = a.atlas_client_id);
  -- Asaas: "este cliente do Asaas NÃO é esta ficha" vale para a pessoa.
  UPDATE cb_asaas_clientes a
     SET contatos_recusados = array_remove(a.contatos_recusados, p_sai)
                              || CASE WHEN p_fica = ANY (a.contatos_recusados) THEN '{}'::uuid[] ELSE ARRAY[p_fica] END
   WHERE a.account_id = v_conta AND p_sai = ANY (a.contatos_recusados);

  -- As referências que só registram (SET NULL na exclusão): passam todas.
  UPDATE cb_asaas_clientes SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE cb_asaas_regua_envios SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE automation_logs SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;
  UPDATE automation_pending_executions SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;
  UPDATE broadcast_recipients SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE cb_automation_events SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;
  UPDATE cb_calendly_eventos SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;
  UPDATE cb_lead_events SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;
  UPDATE cb_meetings SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE cb_reunioes_da_kommo SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE cb_reunioes_transcritas SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE cb_webhook_eventos SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;
  UPDATE cb_zapsign_documentos SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE cb_zapsign_eventos SET contact_id = p_fica WHERE contact_id = p_sai;
  UPDATE flow_runs SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;
  UPDATE notifications SET contact_id = p_fica WHERE account_id = v_conta AND contact_id = p_sai;

  -- Uniões anteriores: o que respondia pela que sai passa a responder pela
  -- que fica (a API resolve o id antigo num passo só); os contatos antigos
  -- dela também passam.
  UPDATE cb_fichas_unidas SET ficha_que_fica = p_fica WHERE ficha_que_fica = p_sai;
  UPDATE cb_contatos_antigos a SET contact_id = p_fica
   WHERE a.contact_id = p_sai;

  -- ── 9. Conferência: nada que aponte para a que sai pode sumir calado ──
  -- Pelo CATÁLOGO, toda FK para `contacts` (tabela nova incluída), pela
  -- coluna que casa com `contacts.id` (a FK composta leva `account_id`
  -- junto). Sobra aceita: o repetido que a que fica já tinha e o CASCADE leva.
  FOR v_tabela, v_coluna IN
    SELECT k.conrelid::regclass, a.attname
      FROM pg_constraint k
      CROSS JOIN LATERAL generate_subscripts(k.confkey, 1) AS i
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[i]
     WHERE k.contype = 'f' AND k.confrelid = 'public.contacts'::regclass
       AND k.confkey[i] = (SELECT x.attnum FROM pg_attribute x
                            WHERE x.attrelid = 'public.contacts'::regclass AND x.attname = 'id')
  LOOP
    CONTINUE WHEN v_tabela IN (
      'public.contact_tags'::regclass,               -- etiqueta que a que fica já tinha
      'public.contact_custom_values'::regclass,      -- campo já preenchido / espelhado
      'public.cb_automation_reminders'::regclass,    -- lembrete que a que fica já recebeu
      'public.cb_contatos_relacionados'::regclass,   -- vínculo repetido ou consigo mesma
      'public.cb_duplicatas_descartadas'::regclass,  -- regravado acima como par novo
      'public.cb_atlas_recusas'::regclass,           -- recusa repetida
      'public.cb_atlas_clientes'::regclass,          -- outro vínculo no mesmo ambiente
      'public.conversations'::regclass               -- a conversa da que sai: logo abaixo
    );
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_tabela, v_coluna)
      INTO v_sobrou USING p_sai;
    IF v_sobrou THEN
      RAISE EXCEPTION 'uniao_sem_tratamento:%', v_tabela USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- A conversa que sai (mesclada) só pode levar o repetido: a cópia de
  -- mensagem que a que fica já tinha, o favorito, a análise e a presença.
  IF v_conv_sai.id IS NOT NULL AND v_conv_fica.id IS NOT NULL THEN
    FOR v_tabela, v_coluna IN
      SELECT k.conrelid::regclass, a.attname
        FROM pg_constraint k
        CROSS JOIN LATERAL generate_subscripts(k.confkey, 1) AS i
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[i]
       WHERE k.contype = 'f' AND k.confrelid = 'public.conversations'::regclass
         AND k.confkey[i] = (SELECT x.attnum FROM pg_attribute x
                              WHERE x.attrelid = 'public.conversations'::regclass AND x.attname = 'id')
    LOOP
      CONTINUE WHEN v_tabela IN (
        'public.messages'::regclass,
        'public.message_reactions'::regclass,
        'public.cb_conversation_favorites'::regclass,
        'public.cb_conversation_insights'::regclass,
        'public.cb_conversa_aberta'::regclass
      );
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', v_tabela, v_coluna)
        INTO v_sobrou USING v_conv_sai.id;
      IF v_sobrou THEN
        RAISE EXCEPTION 'uniao_sem_tratamento:%', v_tabela USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    DELETE FROM conversations WHERE id = v_conv_sai.id;
  END IF;

  -- ── 10. O livro (o gatilho grava a linha na trilha) e a saída ──
  v_resumo := v_resumo || jsonb_build_object('contatos_antigos', v_antigos);
  INSERT INTO cb_fichas_unidas (
    id, account_id, ficha_que_fica, ficha_removida, unida_a,
    unida_por, unida_por_nome, foto, divergencias, resumo
  ) VALUES (
    v_fusao, v_conta, p_fica, p_sai, p_fica,
    v_uid, v_quem, v_foto, v_divergencias, v_resumo
  );

  DELETE FROM contacts WHERE id = p_sai;

  -- ── 11. A identidade da que saiu: só DEPOIS do DELETE (o índice único e
  -- `contacts_identidade_ck` não deixam antes). O BSUID só pela régua do
  -- passo 2 (`v_bsuid_passa`); o que não passa está na foto. ──
  UPDATE contacts c
     SET phone = CASE WHEN c.phone IS NULL THEN v_sai.phone ELSE c.phone END,
         wa_user_id = CASE WHEN v_bsuid_passa THEN coalesce(c.wa_user_id, v_sai.wa_user_id) ELSE c.wa_user_id END,
         wa_username = CASE WHEN v_bsuid_passa AND c.wa_user_id IS NULL
                            THEN coalesce(c.wa_username, v_sai.wa_username) ELSE c.wa_username END,
         wa_parent_user_id = CASE WHEN v_bsuid_passa AND c.wa_user_id IS NULL
                                  THEN coalesce(c.wa_parent_user_id, v_sai.wa_parent_user_id) ELSE c.wa_parent_user_id END
   WHERE c.id = p_fica
     AND ((c.phone IS NULL AND v_sai.phone IS NOT NULL)
          OR (v_bsuid_passa AND c.wa_user_id IS NULL AND v_sai.wa_user_id IS NOT NULL));

  -- Contatos antigos (D9). Valor que já era antigo de outra ficha passa a
  -- apontar para esta: a ficha que acabou de sair o usava por último.
  INSERT INTO cb_contatos_antigos (account_id, contact_id, tipo, valor, fusao_id)
  SELECT v_conta, p_fica, x ->> 'tipo', x ->> 'valor', v_fusao
    FROM jsonb_array_elements(v_antigos) x
  ON CONFLICT (account_id, tipo, valor)
    DO UPDATE SET contact_id = EXCLUDED.contact_id, fusao_id = EXCLUDED.fusao_id;
  -- O que virou o contato PRINCIPAL da que fica não é antigo.
  DELETE FROM cb_contatos_antigos a
   USING contacts c
   WHERE c.id = p_fica AND a.contact_id = p_fica
     AND ((a.tipo = 'telefone' AND a.valor = c.telefone_canonico)
          OR (a.tipo = 'email' AND a.valor = lower(btrim(c.email))));

  RETURN jsonb_build_object(
    'fusao_id', v_fusao,
    'ficha', p_fica,
    'conversa', v_conversa,
    'resumo', v_resumo
  );
END;
$$;

-- ------------------------------------------------------------
-- 5) Os cadastros procuram SÓ pelo telefone antigo (D9')
-- ------------------------------------------------------------
-- Nenhum cadastro procura a ficha pelo e-mail ATUAL (a busca é pelo
-- telefone): o e-mail ANTIGO casava onde o atual não casa, e o agendamento
-- com telefone novo e e-mail antigo caía na ficha unida, com a confirmação e
-- os lembretes indo para o telefone DELA. O e-mail antigo continua acendendo
-- o aviso (sinal 4 da 1092). Assinatura nova: DROP + CREATE (um overload com
-- o e-mail sobraria ambíguo para o RPC).
-- ⚠️ Exige o MESMO primeiro nome (`cb_primeiro_nome`, 1088): o número
-- digitado errado que virou contato antigo pode ser de OUTRA pessoa.
DROP FUNCTION IF EXISTS public.cb_ficha_por_contato_antigo(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.cb_ficha_por_contato_antigo(
  p_conta uuid,
  p_telefone_canonico text,
  p_nome text
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a.contact_id
    FROM cb_contatos_antigos a
    JOIN contacts c ON c.id = a.contact_id
   WHERE a.account_id = p_conta
     AND a.tipo = 'telefone'
     AND a.valor = nullif(btrim(p_telefone_canonico), '')
     AND cb_primeiro_nome(c.name) IS NOT NULL
     AND cb_primeiro_nome(c.name) = cb_primeiro_nome(p_nome)
   LIMIT 1
$$;

-- ------------------------------------------------------------
-- 6) Quem executa o quê
-- ------------------------------------------------------------
-- As peças internas: ninguém de fora (as RPCs rodam como dono).
REVOKE EXECUTE ON FUNCTION public.cb_instante_do_valor(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_execucoes_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_divergencias_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- As duas RPCs da tela: a porta de admin é por dentro.
REVOKE EXECUTE ON FUNCTION public.cb_previa_da_uniao(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_unir_fichas(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_previa_da_uniao(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_unir_fichas(uuid, uuid) TO authenticated;
-- A busca dos cadastros: só o servidor.
REVOKE EXECUTE ON FUNCTION public.cb_ficha_por_contato_antigo(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ficha_por_contato_antigo(uuid, text, text) TO service_role;

-- ------------------------------------------------------------
-- 7) Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_funil uuid;
  v_etapa uuid;
  v_etapa2 uuid;
  v_fica uuid;
  v_sai uuid;
  v_conv_fica uuid;
  v_conv_sai uuid;
  v_card_sai uuid;
  v_card_move uuid;
  v_auto uuid;
  v_log_apaga uuid;
  v_log_move uuid;
  v_campo uuid;
  v_tel_sai text;
  v_ret jsonb;
  v_c record;
BEGIN
  -- 7.1 As portas e a assinatura nova da busca.
  IF has_function_privilege('authenticated', 'public.cb_execucoes_da_uniao(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_instante_do_valor(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ficha_por_contato_antigo(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_unir_fichas(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_ficha_por_contato_antigo(uuid, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_unir_fichas(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_previa_da_uniao(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1093: EXECUTE das funções fora do lugar';
  END IF;
  IF to_regprocedure('public.cb_ficha_por_contato_antigo(uuid, text, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '1093: a busca com e-mail ficou de pé';
  END IF;

  -- 7.2 O instante do campo de data e hora: as formas de produção, o mesmo
  -- instante em dois fusos, e o torto vira nulo sem erro.
  IF public.cb_instante_do_valor('2026-10-14T18:15:00.000Z') IS NULL
     OR public.cb_instante_do_valor('2026-10-14T18:15:00.123456Z') IS NULL
     OR public.cb_instante_do_valor('2026-10-14T15:15:00-03:00')
        IS DISTINCT FROM public.cb_instante_do_valor('2026-10-14T18:15:00Z')
     OR public.cb_instante_do_valor('2026-02-30T10:00:00Z') IS NOT NULL
     OR public.cb_instante_do_valor('14/10/2026 18:15') IS NOT NULL
     OR public.cb_instante_do_valor('') IS NOT NULL THEN
    RAISE EXCEPTION '1093: o instante do campo de data e hora errou';
  END IF;

  -- 7.3 A UNIÃO de verdade, num par FICTÍCIO, desfeita no fim (SQLSTATE
  -- próprio — nunca WHEN OTHERS). Banco vazio (replay): nada a provar.
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
    JOIN public.profiles p ON p.user_id = a.owner_user_id AND p.account_id = a.id
   WHERE p.suspenso_em IS NULL
   ORDER BY a.created_at
   LIMIT 1;
  SELECT s.pipeline_id, s.id INTO v_funil, v_etapa
    FROM public.pipeline_stages s JOIN public.pipelines pl ON pl.id = s.pipeline_id
   WHERE pl.account_id = v_conta
   ORDER BY s.position, s.id LIMIT 1;
  IF v_conta IS NULL OR v_etapa IS NULL THEN
    RAISE NOTICE '1093: banco vazio, a união não foi exercitada.';
    RETURN;
  END IF;
  -- Um segundo funil (o card que PASSA inteiro), quando a conta tem.
  SELECT s.id INTO v_etapa2
    FROM public.pipeline_stages s JOIN public.pipelines pl ON pl.id = s.pipeline_id
   WHERE pl.account_id = v_conta AND pl.id <> v_funil
   ORDER BY s.position, s.id LIMIT 1;
  SELECT id INTO v_auto FROM public.automations WHERE account_id = v_conta ORDER BY created_at LIMIT 1;
  SELECT id INTO v_campo FROM public.custom_fields
   WHERE account_id = v_conta AND field_key = 'data_e_hora_reuniao' AND espelho IS NULL LIMIT 1;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_dono::text, true);
    -- Telefones fictícios fora de qualquer faixa real (DDD 00). As DUAS com
    -- telefone e só a que sai com BSUID: ele NÃO passa.
    v_tel_sai := '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0');
    INSERT INTO public.contacts (user_id, account_id, phone, name)
    VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano Conferencia 1093')
    RETURNING id INTO v_fica;
    INSERT INTO public.contacts (user_id, account_id, phone, name, wa_user_id)
    VALUES (v_dono, v_conta, v_tel_sai, 'Fulano C.', 'BR.conferencia1093.' || md5(random()::text))
    RETURNING id, telefone_canonico INTO v_sai, v_tel_sai;
    -- A que fica ENCERRADA, com uma fala antiga sem resposta; a que sai
    -- aberta e esperando. Janelas da Meta diferentes.
    INSERT INTO public.conversations (user_id, account_id, contact_id, status, janela_meta)
    VALUES (v_dono, v_conta, v_fica, 'open', '{"conferencia": "2026-01-01T00:00:00+00:00"}')
    RETURNING id INTO v_conv_fica;
    INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text, created_at)
    VALUES (v_conv_fica, 'customer', 'text', 'antiga', now() - interval '3 days');
    UPDATE public.conversations SET status = 'closed' WHERE id = v_conv_fica;
    INSERT INTO public.conversations (user_id, account_id, contact_id, status, janela_meta)
    VALUES (v_dono, v_conta, v_sai, 'open', '{"conferencia": "2026-01-02T00:00:00+00:00"}')
    RETURNING id INTO v_conv_sai;
    INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text, created_at)
    VALUES (v_conv_sai, 'customer', 'text', 'oi', now() - interval '1 hour');
    -- Cards no mesmo funil (empate: fica o da que fica; o da que sai é
    -- apagado) e, havendo, um da que sai noutro funil (passa inteiro).
    INSERT INTO public.deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value, source)
    VALUES (v_dono, v_conta, v_funil, v_etapa, v_fica, 'Fulano Conferencia 1093', 0, 'manual');
    INSERT INTO public.deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value, source)
    VALUES (v_dono, v_conta, v_funil, v_etapa, v_sai, 'Fulano C.', 10, 'manual')
    RETURNING id INTO v_card_sai;
    IF v_etapa2 IS NOT NULL THEN
      INSERT INTO public.deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value, source)
      SELECT v_dono, v_conta, s.pipeline_id, s.id, v_sai, 'Fulano C.', 0, 'manual'
        FROM public.pipeline_stages s WHERE s.id = v_etapa2
      RETURNING id INTO v_card_move;
    END IF;
    -- Execuções da que sai: uma do card apagado (termina) e, havendo, uma do
    -- card que passa (segue, com a conversa nova no contexto).
    IF v_auto IS NOT NULL THEN
      INSERT INTO public.automation_logs (automation_id, user_id, contact_id, trigger_event, steps_executed, status, account_id)
      VALUES (v_auto, v_dono, v_sai, 'conferencia', '[]', 'success', v_conta) RETURNING id INTO v_log_apaga;
      INSERT INTO public.automation_pending_executions (automation_id, user_id, contact_id, log_id, next_step_position, context, run_at, account_id)
      VALUES (v_auto, v_dono, v_sai, v_log_apaga, 1,
              jsonb_build_object('deal_id', v_card_sai, 'conversation_id', v_conv_sai), now() + interval '1 day', v_conta);
      IF v_card_move IS NOT NULL THEN
        INSERT INTO public.automation_logs (automation_id, user_id, contact_id, trigger_event, steps_executed, status, account_id)
        VALUES (v_auto, v_dono, v_sai, 'conferencia', '[]', 'success', v_conta) RETURNING id INTO v_log_move;
        INSERT INTO public.automation_pending_executions (automation_id, user_id, contact_id, log_id, next_step_position, context, run_at, account_id)
        VALUES (v_auto, v_dono, v_sai, v_log_move, 1,
                jsonb_build_object('deal_id', v_card_move, 'conversation_id', v_conv_sai), now() + interval '1 day', v_conta);
      END IF;
    END IF;
    -- D10: a reunião mais nova é a da que sai.
    IF v_campo IS NOT NULL THEN
      INSERT INTO public.contact_custom_values (contact_id, custom_field_id, value) VALUES
        (v_fica, v_campo, '2026-01-01T10:00:00.000Z'),
        (v_sai, v_campo, '2026-01-05T10:00:00.000Z');
    END IF;

    v_ret := public.cb_previa_da_uniao(v_fica, v_sai);
    IF v_auto IS NOT NULL
       AND ((v_ret -> 'contagens' ->> 'automacoes_interrompidas')::int <> 1
            OR (v_ret -> 'contagens' ->> 'automacoes_que_seguem')::int <> (CASE WHEN v_card_move IS NULL THEN 0 ELSE 1 END)) THEN
      RAISE EXCEPTION '1093: a prévia contou as execuções errado: %', v_ret -> 'contagens';
    END IF;

    v_ret := public.cb_unir_fichas(v_fica, v_sai);

    SELECT c.wa_user_id, c.phone, v.janela_meta, v.aguardando_desde, v.status
      INTO v_c
      FROM public.contacts c JOIN public.conversations v ON v.contact_id = c.id
     WHERE c.id = v_fica;
    IF EXISTS (SELECT 1 FROM public.contacts WHERE id = v_sai)
       OR EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv_sai) THEN
      RAISE EXCEPTION '1093: a ficha ou a conversa que sai ficou de pé';
    END IF;
    IF v_c.wa_user_id IS NOT NULL THEN
      RAISE EXCEPTION '1093: o BSUID da que sai passou com os dois telefones';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cb_fichas_unidas
                    WHERE ficha_removida = v_sai AND foto -> 'ficha' ->> 'wa_user_id' IS NOT NULL) THEN
      RAISE EXCEPTION '1093: o BSUID que não passou não ficou na foto';
    END IF;
    IF v_c.janela_meta ->> 'conferencia' IS DISTINCT FROM '2026-01-01T00:00:00+00:00' THEN
      RAISE EXCEPTION '1093: a janela da Meta não é a do número da que fica: %', v_c.janela_meta;
    END IF;
    IF v_c.status <> 'open' OR v_c.aguardando_desde IS NULL
       OR v_c.aguardando_desde < now() - interval '2 hours' THEN
      RAISE EXCEPTION '1093: a espera ressuscitou a fala da encerrada ou sumiu: % %', v_c.status, v_c.aguardando_desde;
    END IF;
    IF v_log_apaga IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.automation_logs WHERE id = v_log_apaga AND interrompida_por = 'fusao') THEN
      RAISE EXCEPTION '1093: a execução do card apagado não terminou';
    END IF;
    IF v_log_move IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.automation_logs l
           JOIN public.automation_pending_executions e ON e.log_id = l.id
          WHERE l.id = v_log_move AND l.interrompida_em IS NULL AND l.contact_id = v_fica
            AND e.status = 'pending' AND e.context ->> 'conversation_id' = v_conv_fica::text) THEN
      RAISE EXCEPTION '1093: a execução do card que passa não seguiu com a conversa nova';
    END IF;
    IF v_campo IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.contact_custom_values
          WHERE contact_id = v_fica AND custom_field_id = v_campo AND value = '2026-01-05T10:00:00.000Z') THEN
      RAISE EXCEPTION '1093: a reunião mais nova não ficou';
    END IF;
    IF public.cb_ficha_por_contato_antigo(v_conta, v_tel_sai, 'Fulano') IS DISTINCT FROM v_fica THEN
      RAISE EXCEPTION '1093: o telefone antigo não encontra a ficha que ficou';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1093', MESSAGE = 'desfaz a conferência';
  EXCEPTION WHEN SQLSTATE 'P1093' THEN
    RAISE NOTICE '1093: união conferida num par fictício (desfeita) — execuções: %, card que passa: %, campo da reunião: %.',
      v_auto IS NOT NULL, v_card_move IS NOT NULL, v_campo IS NOT NULL;
  END;
END $$;
