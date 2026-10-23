-- ============================================================
-- 1101 — Lixeira de contatos, Fase 4: "Restaurar e unir"
--
-- docs/PLANO-lixeira-de-contatos.md, Fase 4. ADITIVA e só funções (nenhuma
-- ALTER em tabela): aplicar ANTES do deploy — a faixa nova da conversa e do
-- card chama as RPCs daqui. Depende da 1097 (a Lixeira) e da 1093 (a
-- receita vigente da união); a 1099 (correção do `cb_lixeira_anular`) e a
-- 1100 (Fase 3) vêm antes, e nenhuma das duas muda o que se usa aqui.
--
-- O PROBLEMA. Restaurar uma ficha cuja identidade (telefone canônico, BSUID
-- ou Instagram) já é de OUTRA ficha é BLOQUEADO (B2 da 1097,
-- `identidade_ocupada`): a volta nunca funde nem sobrescreve. É o caso comum
-- do cliente que volta a escrever depois de a ficha dele ir para a Lixeira —
-- a ingestão abre uma ficha nova com o mesmo número. A saída é RESTAURAR E
-- UNIR à ficha que ocupa a identidade, numa transação só:
--   1. trava o item (NOWAIT: outra pessoa mexendo nele vira recusa legível);
--   2. confere que a ficha que fica é da mesma conta e que a identidade CASA
--      com a do item (ao menos uma das três);
--   3. dá à fotografia uma identidade PROVISÓRIA: anula SÓ o que colide com
--      a ficha que fica (telefone, BSUID, Instagram) e, se nada sobrar, um
--      BSUID de reserva (`lixeira:<item>`) para o CHECK
--      `contacts_identidade_ck`. As colunas de identidade do PRÓPRIO item
--      (que a conferência B2 de `cb_lixeira_restaurar_um` lê) acompanham;
--      identidade que colide com uma TERCEIRA ficha continua recusando
--      (`identidade_ocupada`) — nunca se anula o que é de outra pessoa;
--   4. restaura pelo miolo de sempre (`cb_lixeira_restaurar_um`: o sinal
--      `cb.lixeira`, a trilha `contact_restored` pelo gatilho do item);
--   5. une (`cb_unir_fichas(fica, restaurada)`): a receita inteira da união,
--      o livro e a trilha `contacts_merged`;
--   6. a reserva NUNCA sobra: se passou para a ficha que ficou (a união leva
--      o BSUID da que sai quando uma das duas não tem telefone), sai; e o
--      livro e a trilha da união guardam a identidade ORIGINAL da ficha que
--      voltou (a provisória diria "sem telefone").
-- Qualquer recusa (bloqueio da união, identidade de uma terceira ficha,
-- trava, esquema que mudou) desfaz TUDO — o subbloco volta ao começo — e a
-- função devolve o código.
--
-- A CONVERSA QUE VOLTA ENTRA COMO HISTÓRICO (decisão de 23/10/2026, revisão
-- da Fase 4). Junto da identidade provisória, a conversa da fotografia volta
-- ENCERRADA, sem responsável, sem espera, sem não lidas e com a IA como o
-- encerrar deixa (o que `cb_encerrar_limpa_ia` faria). Sem isso a união
-- (1093) a leria como viva: reabriria a conversa de hoje com o responsável de
-- meses atrás (aviso no sino incluso) e a espera podia recuar para uma fala
-- antiga. A conversa de hoje não reabre, não troca de responsável e a espera
-- dela não recua.
--
-- A JANELA DA META SÓ AVANÇA. A união decide a janela pelas fichas COMO
-- ESTÃO — e a da fotografia está com a identidade provisória (sem o telefone
-- ou o BSUID que colidiu). Como a identidade CASOU (mesmo número ou mesma
-- conta do WhatsApp), a conversa que fica recebe, por chave, o MAIOR instante
-- entre a janela dela (lida ANTES da união) e a da conversa da fotografia.
--
-- LIMITE CONHECIDO (o tempo real): o INSERT de `cb_fichas_unidas` grava a
-- trilha `contacts_merged` pelo gatilho da 1092 com a identidade PROVISÓRIA
-- (telefone nulo, ou a reserva no lugar do BSUID), e esse INSERT sai pelo
-- tempo real antes do UPDATE que o corrige na mesma transação. Quem está com
-- a conversa aberta vê, até recarregar, a linha "unida" sem o telefone da
-- ficha que voltou. A reserva `lixeira:<item>` não é dado pessoal (é o id do
-- item). `cb_unir_fichas` não muda por isso.
--
-- A PRÉVIA ("sem prévia, sem botão", a regra da união): os passos 1–4 num
-- subbloco, `cb_previa_da_uniao(fica, restaurada)` guardada numa variável e
-- o subbloco desfeito pelo SQLSTATE próprio P1101 — nunca `WHEN OTHERS`.
-- Nada fica gravado (provado no descartável: item, fichas e trilha iguais
-- antes e depois).
--
-- A RESERVA NÃO É BSUID. `cb_bloqueios_da_uniao` (1092) passa a ignorar o
-- prefixo `lixeira:`: sem isso, toda ficha que volta só com o BSUID (ou só
-- com o telefone, para uma ficha que fica COM BSUID) seria recusada como
-- "contas de WhatsApp diferentes". Nenhum BSUID da Meta começa assim, e a
-- reserva só existe dentro desta transação.
--
-- A LEITURA DA FAIXA (`cb_lixeira_da_mesma_pessoa`): os itens da Lixeira da
-- mesma conta com o telefone canônico, o BSUID ou o Instagram da ficha
-- aberta, pelos três índices parciais da 1097 — nunca pelo `@`, que muda e
-- não é único. Só colunas de lista (nunca a fotografia), e vazio para quem
-- não é admin daquela conta. `com_instagram`: uma das duas fichas tem
-- Instagram, e a união recusa sempre (Fase 5 do plano do Instagram) — a tela
-- não oferece o botão. A lista da Lixeira (`cb_lixeira_da_conta`, 1097)
-- ganha o mesmo sinal (`ocupada_com_instagram`) para oferecer "Restaurar e
-- unir" no próprio item bloqueado: coluna de saída nova = DROP + CREATE.
--
-- ⚠️ `auth.uid()` e a suspensão (1067): as três RPCs da tela conferem por
-- dentro; provado no descartável trocando de papel (`authenticated` com os
-- claims de admin, de atendente e de admin suspenso).
-- ============================================================

-- ------------------------------------------------------------
-- 1) A reserva não é BSUID (a regra da 1092, com a exceção)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_bloqueios_da_uniao(p_fica uuid, p_sai uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN f.instagram_id IS NOT NULL OR s.instagram_id IS NOT NULL THEN 'instagram' END,
    -- O BSUID de reserva da Fase 4 da Lixeira (`lixeira:<item>`) não é conta
    -- de WhatsApp de ninguém: não conta como "diferente".
    CASE WHEN f.wa_user_id IS NOT NULL AND s.wa_user_id IS NOT NULL
              AND f.wa_user_id <> s.wa_user_id
              AND left(f.wa_user_id, 8) <> 'lixeira:' AND left(s.wa_user_id, 8) <> 'lixeira:'
         THEN 'bsuid_diferentes' END
  ], NULL)
    FROM contacts f, contacts s
   WHERE f.id = p_fica AND s.id = p_sai
$$;

-- ------------------------------------------------------------
-- 2) A faixa: os itens da Lixeira da MESMA PESSOA que a ficha aberta
-- ------------------------------------------------------------
-- Uma busca por chave, cada uma com o predicado do índice parcial dela
-- (`cb_lixeira_de_contatos_{telefone,bsuid,instagram}_idx`), atrás da ficha
-- MATERIALIZADA. O telefone pelo CANÔNICO basta: `phone_normalized` igual
-- implica canônico igual (o canônico é função dos dígitos).
CREATE OR REPLACE FUNCTION public.cb_lixeira_da_mesma_pessoa(p_contato uuid)
RETURNS TABLE (
  id uuid, contact_id uuid, nome text, telefone text, wa_username text, instagram_username text,
  movida_em timestamptz, movida_por_nome text, vence_em timestamptz, mensagens integer,
  com_instagram boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ficha AS MATERIALIZED (
    SELECT c.account_id, nullif(c.telefone_canonico, '') AS tel, c.wa_user_id AS bsuid, c.instagram_id AS ig
      FROM contacts c
     WHERE c.id = p_contato
       AND c.account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))
  ),
  achados AS (
    SELECT x.id
      FROM cb_lixeira_de_contatos x JOIN ficha f ON x.account_id = f.account_id AND x.telefone_canonico = f.tel
     WHERE x.telefone_canonico IS NOT NULL AND x.telefone_canonico <> ''
    UNION
    SELECT x.id
      FROM cb_lixeira_de_contatos x JOIN ficha f ON x.account_id = f.account_id AND x.wa_user_id = f.bsuid
     WHERE x.wa_user_id IS NOT NULL
    UNION
    SELECT x.id
      FROM cb_lixeira_de_contatos x JOIN ficha f ON x.account_id = f.account_id AND x.instagram_id = f.ig
     WHERE x.instagram_id IS NOT NULL
  )
  SELECT x.id, x.contact_id, x.nome, x.telefone, x.wa_username, x.instagram_username,
         x.movida_em, x.movida_por_nome, x.vence_em,
         -- `contagens` só tem as tabelas com linha: sem `messages`, zero.
         CASE WHEN jsonb_typeof(x.contagens -> 'messages') = 'number'
              THEN (x.contagens ->> 'messages')::numeric::integer ELSE 0 END,
         -- A união recusa sempre que uma das duas tem Instagram.
         x.instagram_id IS NOT NULL OR f.ig IS NOT NULL
    FROM cb_lixeira_de_contatos x
    CROSS JOIN ficha f
   WHERE x.id IN (SELECT a.id FROM achados a)
   ORDER BY x.movida_em DESC, x.id
$$;

-- 2.1) A lista da Lixeira (1097) com o mesmo sinal: o item bloqueado por
-- identidade ocupada oferece "Restaurar e unir" com a ficha que ocupa — salvo
-- com Instagram (`ocupada_com_instagram`). O corpo é o da 1097, com a coluna
-- nova no fim (o app anterior a ignora). Coluna de saída nova = DROP + CREATE
-- (`CREATE OR REPLACE` não muda o tipo de retorno), na mesma transação.
DROP FUNCTION IF EXISTS public.cb_lixeira_da_conta(text);
CREATE OR REPLACE FUNCTION public.cb_lixeira_da_conta(p_busca text DEFAULT NULL)
RETURNS TABLE (
  id uuid, account_id uuid, contact_id uuid, lote_id uuid, nome text, telefone text, email text,
  instagram_username text, wa_username text, movida_em timestamptz, movida_por_nome text,
  vence_em timestamptz, contagens jsonb, ocupada_por uuid, ocupada_por_nome text, lote_total integer,
  ocupada_com_instagram boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.id, x.account_id, x.contact_id, x.lote_id, x.nome, x.telefone, x.email,
         x.instagram_username, x.wa_username, x.movida_em, x.movida_por_nome,
         x.vence_em, x.contagens, o.id, o.nome,
         (SELECT count(*)::integer FROM cb_lixeira_de_contatos y
           WHERE y.account_id = x.account_id AND y.lote_id = x.lote_id),
         CASE WHEN o.id IS NOT NULL THEN x.instagram_id IS NOT NULL OR o.instagram_id IS NOT NULL END
    FROM cb_lixeira_de_contatos x
    LEFT JOIN LATERAL (
      SELECT c.id, coalesce(nullif(c.name, ''), c.phone, c.instagram_username) AS nome, c.instagram_id
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

-- ------------------------------------------------------------
-- 3) Os passos 1–4, numa peça só (a prévia e a união chamam a MESMA)
-- ------------------------------------------------------------
-- Interna: sem porta (quem chama confere admin e suspensão) e sem EXECUTE
-- para ninguém de fora. Toda recusa é `RAISE … P0001` com o código no texto:
-- quem chama desfaz o subbloco e devolve o código.
CREATE OR REPLACE FUNCTION public.cb_lixeira_preparar_uniao(p_item uuid, p_fica uuid, p_conta uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v cb_lixeira_de_contatos;
  v_fica contacts;
  v_ficha jsonb;
  v_bate_tel boolean;
  v_bate_wa boolean;
  v_bate_ig boolean;
  v_phone text;
  v_wa text;
  v_ig text;
  v_reserva text;
  v_conversas jsonb;
  v_janela_fica jsonb;
  v_res jsonb;
BEGIN
  -- 1. O item, travado sem esperar, e só da conta de quem fica.
  BEGIN
    SELECT * INTO v FROM cb_lixeira_de_contatos x
     WHERE x.id = p_item AND x.account_id = p_conta
       FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'em_processamento' USING ERRCODE = 'P0001';
  END;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'item_sumiu' USING ERRCODE = 'P0001';
  END IF;

  -- 2. A ficha que fica: as CONVERSAS antes da ficha (a ordem da união e dos
  -- gatilhos da conversa; na inversa, a ingestão fecharia um ciclo).
  PERFORM 1 FROM conversations c WHERE c.contact_id = p_fica ORDER BY c.id FOR UPDATE;
  SELECT * INTO v_fica FROM contacts c WHERE c.id = p_fica FOR UPDATE;
  -- A janela da Meta da conversa de hoje ANTES da união (ela só avança).
  SELECT c.janela_meta INTO v_janela_fica FROM conversations c WHERE c.contact_id = p_fica;
  IF v_fica.id IS NULL THEN
    RAISE EXCEPTION 'ficha_nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_fica.account_id <> v.account_id THEN
    RAISE EXCEPTION 'contas_diferentes' USING ERRCODE = 'P0001';
  END IF;
  v_ficha := v.fotografia -> 'contacts' -> 0;
  IF v_ficha IS NULL OR jsonb_typeof(v_ficha) <> 'object' THEN
    RAISE EXCEPTION 'lixeira_ficha_nao_voltou' USING ERRCODE = 'P0001';
  END IF;

  -- A identidade CASA com a da ficha que fica? (as colunas do item são as
  -- que a B2 confere; o canônico já vem sem o vazio.)
  v_bate_tel := coalesce(v.telefone_canonico = nullif(v_fica.telefone_canonico, ''), false)
             OR coalesce(v.phone_normalized = nullif(v_fica.phone_normalized, ''), false);
  v_bate_wa := coalesce(v.wa_user_id = v_fica.wa_user_id, false);
  v_bate_ig := coalesce(v.instagram_id = v_fica.instagram_id, false);
  IF NOT (v_bate_tel OR v_bate_wa OR v_bate_ig) THEN
    RAISE EXCEPTION 'identidade_nao_casa' USING ERRCODE = 'P0001';
  END IF;

  -- 3. A identidade PROVISÓRIA: some só o que colide com a ficha que fica.
  v_phone := CASE WHEN v_bate_tel THEN NULL ELSE v_ficha ->> 'phone' END;
  v_wa := CASE WHEN v_bate_wa THEN NULL ELSE v_ficha ->> 'wa_user_id' END;
  v_ig := CASE WHEN v_bate_ig THEN NULL ELSE v_ficha ->> 'instagram_id' END;
  IF v_phone IS NULL AND v_wa IS NULL AND v_ig IS NULL THEN
    v_reserva := 'lixeira:' || v.id::text;
    v_wa := v_reserva;
  END IF;
  -- A conversa da fotografia entra na união como HISTÓRICO: encerrada, sem
  -- responsável, sem espera e sem não lidas — e, se estava aberta, com a IA
  -- como o encerrar deixa (`cb_encerrar_limpa_ia`). A união (1093) então não
  -- reabre a conversa de hoje, não troca o responsável (nem avisa no sino) e
  -- não recua a espera dela.
  v_conversas := (
    SELECT jsonb_agg(c || jsonb_build_object(
             'status', 'closed', 'assigned_agent_id', NULL, 'aguardando_desde', NULL, 'unread_count', 0)
           || CASE WHEN c ->> 'status' IS DISTINCT FROM 'closed' THEN jsonb_build_object(
                'ia_agente_id', NULL, 'ai_autoreply_disabled', false, 'ia_pausada_por', NULL,
                'ia_pausada_em', NULL, 'ia_retomada_em', now())
              ELSE '{}'::jsonb END)
      FROM jsonb_array_elements(v.fotografia -> 'conversations') c
     WHERE jsonb_typeof(v.fotografia -> 'conversations') = 'array');
  UPDATE cb_lixeira_de_contatos x
     SET fotografia = jsonb_set(
                        CASE WHEN v_conversas IS NULL THEN x.fotografia
                             ELSE jsonb_set(x.fotografia, '{conversations}', v_conversas) END,
                        '{contacts,0}',
                        v_ficha || jsonb_build_object('phone', v_phone, 'wa_user_id', v_wa,
                                                      'instagram_id', v_ig)),
         telefone_canonico = CASE WHEN v_bate_tel THEN NULL ELSE x.telefone_canonico END,
         phone_normalized = CASE WHEN v_bate_tel THEN NULL ELSE x.phone_normalized END,
         wa_user_id = v_wa,
         instagram_id = v_ig
   WHERE x.id = v.id;

  -- 4. A volta, pelo miolo de sempre. A recusa dele (a identidade que sobrou
  -- é de uma TERCEIRA ficha) volta com o retorno inteiro no DETAIL.
  v_res := cb_lixeira_restaurar_um(v.id);
  IF v_res ->> 'resultado' IS DISTINCT FROM 'restaurada' THEN
    RAISE EXCEPTION '%', coalesce(nullif(v_res ->> 'codigo', ''), 'item_sumiu')
      USING ERRCODE = 'P0001', DETAIL = v_res::text;
  END IF;

  RETURN jsonb_build_object(
    'contact_id', v.contact_id,
    'reserva', v_reserva,
    -- Por onde a identidade casou, e as janelas da Meta das duas conversas
    -- (a da fotografia não muda com o histórico).
    'casou_por_numero', v_bate_tel OR v_bate_wa,
    'janela_fica', v_janela_fica,
    'janela_foto', v.fotografia -> 'conversations' -> 0 -> 'janela_meta',
    -- A identidade como estava (o livro e a trilha da união a recebem).
    'original', jsonb_build_object('telefone', v_ficha -> 'phone', 'wa_user_id', v_ficha -> 'wa_user_id'),
    -- O que a união pode trocar na ficha que fica junto com a reserva.
    'fica_antes', jsonb_build_object('wa_username', v_fica.wa_username,
                                     'wa_parent_user_id', v_fica.wa_parent_user_id),
    -- As caixas da prévia (só o que a tela desenha; nunca o BSUID).
    'fica', jsonb_build_object('id', v_fica.id, 'name', v_fica.name, 'phone', v_fica.phone,
                               'wa_username', v_fica.wa_username,
                               'instagram_username', v_fica.instagram_username),
    'sai', jsonb_build_object('id', v.contact_id, 'name', v.nome, 'phone', v.telefone,
                              'wa_username', v.wa_username, 'instagram_username', v.instagram_username,
                              'movida_em', v.movida_em, 'movida_por_nome', v.movida_por_nome),
    'relatorio', v_res -> 'relatorio');
END;
$$;

-- ------------------------------------------------------------
-- 4) A PRÉVIA — os passos 1–4 e a prévia da união, desfeitos (P1101)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_previa_restaurar_e_unir(p_item uuid, p_fica uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conta uuid;
  v_prep jsonb;
  v_previa jsonb;
  v_codigo text;
  v_motivo text;
  v_detalhe text;
  v_ocupada jsonb;
BEGIN
  -- Porta: admin da conta da ficha que fica, sem suspensão (1067).
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  SELECT c.account_id INTO v_conta FROM contacts c WHERE c.id = p_fica;
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'ficha_nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles p
              WHERE p.user_id = v_uid AND p.account_id = v_conta AND p.suspenso_em IS NOT NULL) THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;
  IF NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_prep := cb_lixeira_preparar_uniao(p_item, p_fica, v_conta);
    v_previa := cb_previa_da_uniao(p_fica, (v_prep ->> 'contact_id')::uuid);
    -- Desfaz o subbloco: a volta não aconteceu. As variáveis ficam.
    RAISE EXCEPTION USING ERRCODE = 'P1101', MESSAGE = 'desfaz a prévia';
  EXCEPTION
    WHEN SQLSTATE 'P1101' THEN
      NULL;
    WHEN lock_not_available OR deadlock_detected OR unique_violation OR foreign_key_violation THEN
      v_codigo := SQLSTATE;
      v_motivo := SQLERRM;
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_motivo = MESSAGE_TEXT, v_detalhe = PG_EXCEPTION_DETAIL;
      v_codigo := v_motivo;
  END;
  PERFORM set_config('cb.lixeira', '', true);

  IF v_codigo IS NOT NULL THEN
    v_ocupada := CASE WHEN v_codigo = 'identidade_ocupada' AND left(coalesce(v_detalhe, ''), 1) = '{'
                      THEN v_detalhe::jsonb END;
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'resultado', 'recusada', 'item_id', p_item, 'codigo', v_codigo, 'motivo', v_motivo,
      'ocupada_por', v_ocupada -> 'ocupada_por', 'ocupada_por_nome', v_ocupada -> 'ocupada_por_nome'));
  END IF;
  RETURN jsonb_build_object(
    'resultado', 'previa', 'item_id', p_item,
    'fica', v_prep -> 'fica', 'sai', v_prep -> 'sai',
    'previa', v_previa, 'relatorio', v_prep -> 'relatorio');
END;
$$;

-- ------------------------------------------------------------
-- 5) RESTAURAR E UNIR — uma transação; ou tudo, ou nada
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_restaurar_e_unir(p_item uuid, p_fica uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_conta uuid;
  v_prep jsonb;
  v_contato uuid;
  v_uniao jsonb;
  v_fusao uuid;
  v_reserva text;
  v_removida jsonb;
  v_codigo text;
  v_motivo text;
  v_detalhe text;
  v_ocupada jsonb;
BEGIN
  -- Porta: a MESMA da prévia.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;
  SELECT c.account_id INTO v_conta FROM contacts c WHERE c.id = p_fica;
  IF v_conta IS NULL THEN
    RAISE EXCEPTION 'ficha_nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles p
              WHERE p.user_id = v_uid AND p.account_id = v_conta AND p.suspenso_em IS NOT NULL) THEN
    RAISE EXCEPTION 'membro_suspenso' USING ERRCODE = '42501';
  END IF;
  IF NOT is_account_member(v_conta, 'admin'::account_role_enum) THEN
    RAISE EXCEPTION 'so_admin' USING ERRCODE = '42501';
  END IF;

  BEGIN
    -- 1–4. Trava, confere, identidade provisória, volta.
    v_prep := cb_lixeira_preparar_uniao(p_item, p_fica, v_conta);
    v_contato := (v_prep ->> 'contact_id')::uuid;
    v_reserva := v_prep ->> 'reserva';

    -- 5. A união (a trilha `contacts_merged` sai do gatilho do livro).
    v_uniao := cb_unir_fichas(p_fica, v_contato);
    v_fusao := (v_uniao ->> 'fusao_id')::uuid;

    -- 6. A reserva NUNCA sobra. Ela passa para a ficha que fica quando esta
    -- não tinha BSUID (a união leva o da que sai, sem telefone): volta o que
    -- a ficha tinha antes nas colunas que vieram junto.
    IF v_reserva IS NOT NULL THEN
      UPDATE contacts c
         SET wa_user_id = NULL,
             wa_username = v_prep -> 'fica_antes' ->> 'wa_username',
             wa_parent_user_id = v_prep -> 'fica_antes' ->> 'wa_parent_user_id'
       WHERE c.id = p_fica AND c.wa_user_id = v_reserva;
    END IF;
    -- 7. A janela da Meta SÓ AVANÇA. A união a decidiu pela identidade
    -- provisória da fotografia; como a identidade casou pelo número (ou pela
    -- conta do WhatsApp), a conversa que fica recebe, por chave, o MAIOR
    -- instante entre a janela dela antes da união e a da fotografia. Valor que
    -- não é instante (`cb_instante_do_valor` nulo) nunca vence um que é.
    IF (v_prep ->> 'casou_por_numero')::boolean AND v_uniao ->> 'conversa' IS NOT NULL THEN
      UPDATE conversations c
         SET janela_meta = coalesce((
               SELECT jsonb_object_agg(k.chave,
                        CASE WHEN cb_instante_do_valor(j.foto ->> k.chave) IS NOT NULL
                                  AND (cb_instante_do_valor(j.fica ->> k.chave) IS NULL
                                       OR cb_instante_do_valor(j.foto ->> k.chave)
                                          > cb_instante_do_valor(j.fica ->> k.chave))
                             THEN j.foto -> k.chave
                             ELSE coalesce(j.fica -> k.chave, j.foto -> k.chave) END)
                 FROM (SELECT CASE WHEN jsonb_typeof(v_prep -> 'janela_fica') = 'object'
                                   THEN v_prep -> 'janela_fica' ELSE '{}'::jsonb END AS fica,
                              CASE WHEN jsonb_typeof(v_prep -> 'janela_foto') = 'object'
                                   THEN v_prep -> 'janela_foto' ELSE '{}'::jsonb END AS foto) j
                CROSS JOIN LATERAL (SELECT jsonb_object_keys(j.fica) AS chave
                                    UNION SELECT jsonb_object_keys(j.foto)) k), '{}'::jsonb)
       WHERE c.id = (v_uniao ->> 'conversa')::uuid;
    END IF;
    -- O livro e a trilha da união contam a ficha que voltou com a identidade
    -- ORIGINAL (a provisória diria "sem telefone" — e levaria a reserva).
    UPDATE cb_fichas_unidas u
       SET foto = jsonb_set(
                    jsonb_set(u.foto, '{ficha,telefone}',
                              coalesce(v_prep -> 'original' -> 'telefone', 'null'::jsonb)),
                    '{ficha,wa_user_id}',
                    coalesce(v_prep -> 'original' -> 'wa_user_id', 'null'::jsonb))
     WHERE u.id = v_fusao
    RETURNING u.foto -> 'ficha' INTO v_removida;
    IF v_removida IS NOT NULL THEN
      UPDATE cb_lead_events e
         SET details = jsonb_set(e.details, '{removida}', v_removida)
       WHERE e.account_id = v_conta AND e.contact_id = p_fica AND e.event_type = 'contacts_merged'
         AND e.details ->> 'fusao_id' = v_fusao::text;
    END IF;
    IF v_reserva IS NOT NULL AND (
         EXISTS (SELECT 1 FROM contacts c WHERE c.account_id = v_conta AND c.wa_user_id = v_reserva)
         OR EXISTS (SELECT 1 FROM cb_fichas_unidas u
                     WHERE u.id = v_fusao AND position(v_reserva IN u.foto::text) > 0)
         OR EXISTS (SELECT 1 FROM cb_lead_events e
                     WHERE e.account_id = v_conta AND e.contact_id = p_fica AND e.event_type = 'contacts_merged'
                       AND e.details ->> 'fusao_id' = v_fusao::text
                       AND position(v_reserva IN e.details::text) > 0)) THEN
      RAISE EXCEPTION 'lixeira_reserva_sobrou' USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN lock_not_available OR deadlock_detected OR unique_violation OR foreign_key_violation THEN
      v_codigo := SQLSTATE;
      v_motivo := SQLERRM;
    WHEN SQLSTATE 'P0001' THEN
      GET STACKED DIAGNOSTICS v_motivo = MESSAGE_TEXT, v_detalhe = PG_EXCEPTION_DETAIL;
      v_codigo := v_motivo;
  END;
  PERFORM set_config('cb.lixeira', '', true);

  IF v_codigo IS NOT NULL THEN
    v_ocupada := CASE WHEN v_codigo = 'identidade_ocupada' AND left(coalesce(v_detalhe, ''), 1) = '{'
                      THEN v_detalhe::jsonb END;
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'resultado', 'recusada', 'item_id', p_item, 'codigo', v_codigo, 'motivo', v_motivo,
      'ocupada_por', v_ocupada -> 'ocupada_por', 'ocupada_por_nome', v_ocupada -> 'ocupada_por_nome'));
  END IF;
  RETURN jsonb_build_object(
    'resultado', 'unida', 'item_id', p_item, 'contact_id', v_contato,
    'ficha', p_fica, 'conversa', v_uniao -> 'conversa', 'fusao_id', v_fusao,
    'relatorio', v_prep -> 'relatorio');
END;
$$;

-- ------------------------------------------------------------
-- 6) Quem executa o quê
-- ------------------------------------------------------------
-- As peças internas: ninguém de fora (as RPCs rodam como dono).
REVOKE EXECUTE ON FUNCTION public.cb_bloqueios_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_preparar_uniao(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
-- As RPCs da tela: a porta de admin é por dentro.
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_da_mesma_pessoa(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_previa_restaurar_e_unir(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_restaurar_e_unir(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_lixeira_da_mesma_pessoa(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cb_previa_restaurar_e_unir(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cb_restaurar_e_unir(uuid, uuid) TO authenticated, service_role;
-- A lista da Lixeira recriada: as portas da 1097, de novo (o DROP as levou).
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_da_conta(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_lixeira_da_conta(text) TO authenticated;

-- ------------------------------------------------------------
-- 7) Conferência
-- ------------------------------------------------------------
-- O catálogo vale no banco vazio. A ida e volta CHAMA as funções novas numa
-- ficha fictícia — a que foi para a Lixeira e a nova do mesmo número, o caso
-- da reserva (nada sobra da identidade) — e é desfeita pelo SQLSTATE próprio
-- P11C1 (o P1101 é o da prévia, por dentro). Só travas de linha das fichas
-- fictícias: esta migration não tem ALTER.
DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_tel text;
  v_velha uuid;
  v_nova uuid;
  v_conversa uuid;
  v_item uuid;
  v_mensagens integer;
  v_antes jsonb;
  v_ret jsonb;
  v_c record;
BEGIN
  -- 7.1 As portas.
  IF has_function_privilege('anon', 'public.cb_restaurar_e_unir(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_previa_restaurar_e_unir(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_lixeira_da_mesma_pessoa(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_preparar_uniao(uuid, uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_bloqueios_da_uniao(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_restaurar_um(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_restaurar_e_unir(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_previa_restaurar_e_unir(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_lixeira_da_mesma_pessoa(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_restaurar_e_unir(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_lixeira_da_conta(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_lixeira_da_conta(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1101: EXECUTE das funções fora do lugar';
  END IF;

  -- 7.2 A ida e volta. Banco vazio (o replay): nada a provar.
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
    JOIN public.profiles p ON p.user_id = a.owner_user_id AND p.account_id = a.id
   WHERE p.suspenso_em IS NULL
   ORDER BY a.created_at
   LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1101: banco vazio, restaurar e unir não foi exercitado.';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_dono::text, true);
    -- Telefone fictício fora de qualquer faixa real (DDD 00). A ficha que
    -- vai para a Lixeira tem SÓ o telefone: na volta nada sobra, e a reserva
    -- entra (o caso que mais pode deixar rastro). A conversa dela está
    -- ABERTA, com responsável e janela da Meta: volta como histórico, com a
    -- janela.
    v_tel := '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0');
    INSERT INTO public.contacts (user_id, account_id, phone, name)
    VALUES (v_dono, v_conta, v_tel, 'Fulano Conferencia 1101')
    RETURNING id INTO v_velha;
    INSERT INTO public.conversations (user_id, account_id, contact_id, status, assigned_agent_id, janela_meta)
    VALUES (v_dono, v_conta, v_velha, 'open', v_dono, '{"conferencia": "2026-01-02T00:00:00+00:00"}')
    RETURNING id INTO v_conversa;
    INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text, created_at)
    VALUES (v_conversa, 'customer', 'text', 'oi 1101', now() - interval '3 days');

    v_ret := public.cb_mover_contatos_para_lixeira(ARRAY[v_velha]);
    IF v_ret -> 'itens' -> 0 ->> 'resultado' IS DISTINCT FROM 'movida' THEN
      RAISE EXCEPTION '1101: mover não moveu: %', v_ret;
    END IF;
    -- O cliente volta a escrever: a ficha nova do mesmo número.
    INSERT INTO public.contacts (user_id, account_id, phone, name)
    VALUES (v_dono, v_conta, v_tel, 'Fulano Conferencia 1101')
    RETURNING id INTO v_nova;

    -- A faixa acha o item, com as mensagens; a lista da Lixeira diz quem
    -- ocupa e que dá para unir (sem Instagram).
    SELECT f.id, f.mensagens INTO v_item, v_mensagens FROM public.cb_lixeira_da_mesma_pessoa(v_nova) f
     WHERE NOT f.com_instagram;
    IF v_item IS NULL OR v_mensagens IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '1101: a faixa não achou a ficha na Lixeira: % %', v_item, v_mensagens;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cb_lixeira_da_conta(NULL) l
                    WHERE l.id = v_item AND l.ocupada_por = v_nova AND l.ocupada_com_instagram IS FALSE) THEN
      RAISE EXCEPTION '1101: a lista da Lixeira não mostra quem ocupa a identidade';
    END IF;

    -- A prévia mostra e não grava nada.
    SELECT to_jsonb(x) INTO v_antes FROM public.cb_lixeira_de_contatos x WHERE x.id = v_item;
    v_ret := public.cb_previa_restaurar_e_unir(v_item, v_nova);
    IF v_ret ->> 'resultado' IS DISTINCT FROM 'previa'
       OR jsonb_array_length(v_ret -> 'previa' -> 'bloqueios') <> 0
       OR (v_ret -> 'previa' -> 'contagens' ->> 'mensagens')::int <> 1 THEN
      RAISE EXCEPTION '1101: a prévia errou: %', v_ret;
    END IF;
    IF (SELECT to_jsonb(x) FROM public.cb_lixeira_de_contatos x WHERE x.id = v_item) IS DISTINCT FROM v_antes
       OR EXISTS (SELECT 1 FROM public.contacts WHERE id = v_velha)
       OR EXISTS (SELECT 1 FROM public.cb_fichas_unidas WHERE ficha_removida = v_velha) THEN
      RAISE EXCEPTION '1101: a prévia deixou rastro';
    END IF;

    -- Restaurar e unir.
    v_ret := public.cb_restaurar_e_unir(v_item, v_nova);
    IF v_ret ->> 'resultado' IS DISTINCT FROM 'unida' THEN
      RAISE EXCEPTION '1101: restaurar e unir recusou: %', v_ret;
    END IF;
    IF EXISTS (SELECT 1 FROM public.cb_lixeira_de_contatos WHERE id = v_item)
       OR EXISTS (SELECT 1 FROM public.contacts WHERE id = v_velha)
       OR NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = v_nova AND phone = v_tel AND wa_user_id IS NULL)
       OR EXISTS (SELECT 1 FROM public.contacts
                   WHERE account_id = v_conta AND wa_user_id = 'lixeira:' || v_item::text) THEN
      RAISE EXCEPTION '1101: a volta com a união não deixou as fichas como deveria';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations v ON v.id = m.conversation_id
                    WHERE v.contact_id = v_nova AND m.content_text = 'oi 1101') THEN
      RAISE EXCEPTION '1101: a conversa da ficha que voltou não passou';
    END IF;
    -- A conversa que passou é HISTÓRICO, e a janela da Meta veio junto.
    SELECT v.status, v.assigned_agent_id, v.aguardando_desde, v.janela_meta INTO v_c
      FROM public.conversations v WHERE v.contact_id = v_nova;
    IF v_c.status IS DISTINCT FROM 'closed' OR v_c.assigned_agent_id IS NOT NULL
       OR v_c.aguardando_desde IS NOT NULL
       OR v_c.janela_meta ->> 'conferencia' IS DISTINCT FROM '2026-01-02T00:00:00+00:00' THEN
      RAISE EXCEPTION '1101: a conversa que voltou não entrou como histórico com a janela: %', row_to_json(v_c);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.cb_fichas_unidas u
                    WHERE u.ficha_removida = v_velha AND u.ficha_que_fica = v_nova
                      AND u.foto -> 'ficha' ->> 'telefone' = v_tel
                      AND position('lixeira:' IN u.foto::text) = 0)
       OR NOT EXISTS (SELECT 1 FROM public.cb_lead_events e
                       WHERE e.contact_id = v_nova AND e.event_type = 'contact_restored'
                         AND e.details ->> 'item_id' = v_item::text)
       OR NOT EXISTS (SELECT 1 FROM public.cb_lead_events e
                       WHERE e.contact_id = v_nova AND e.event_type = 'contacts_merged'
                         AND e.details -> 'removida' ->> 'telefone' = v_tel
                         AND position('lixeira:' IN e.details::text) = 0) THEN
      RAISE EXCEPTION '1101: o livro ou a trilha não contam a volta e a união como foram';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P11C1', MESSAGE = 'desfaz a conferência';
  EXCEPTION WHEN SQLSTATE 'P11C1' THEN
    RAISE NOTICE '1101: restaurar e unir conferido numa ficha fictícia (desfeito).';
  END;
END $$;
