-- ============================================================
-- 1136 — A transcrição das ligações pelo CRM (4d,
-- docs/PLANO-ligar-pelo-crm.md §8.5 e §8.16)
--
-- 1) `cb_ligacoes` ganha o diálogo (os trechos dos dois lados, com o
--    horário), o estado da transcrição (a régua das notas de voz, 943), o
--    resumo (D11) e a marca da poda dos 180 dias (saem o áudio e o diálogo,
--    fica o resumo). A tabela continua fechada ao navegador: o diálogo chega
--    à tela pela rota, que confere a conversa.
-- 2) `cb_ligacao_sincronizar_faixa`: a faixa (`messages.ligacao`) passa a
--    refletir o estado da ligação (gravação, transcrição, resumo, poda),
--    lido sob a trava da linha e fundido numa escrita só. A marca da gravação
--    e a da transcrição chegam por pedidos separados, e a faixa pode ser
--    ligada no meio da transcrição: quem sincroniza por último deixa a faixa
--    no estado mais novo (revisão da 4d).
-- 3) A exclusão definitiva da Lixeira leva a gravação, o diálogo e o RESUMO
--    das ligações da ficha (§8.5, "Exclusão"), com ou sem o pedido do
--    titular: a fila de arquivos (1097) aceita o bucket `ligacoes`, a
--    reivindicação guarda cada bucket do seu jeito, e `cb_lixeira_purgar_um`
--    (o corpo VIGENTE, da 1110) chama a limpeza nova.
--
-- ADITIVA: o app de antes não lê nada disto. Aplicar ANTES do deploy, e o
-- deploy logo em seguida: a drenagem antiga trata a linha do bucket
-- `ligacoes` como fora da guarda (gasta tentativa sem apagar), e o app novo
-- sem a 1136 perde a marca da gravação na faixa.
-- ============================================================

-- `cb_ligacoes` e a fila são escritas pelo app o tempo todo: o ALTER espera
-- no máximo isto pela trava (falha em vez de enfileirar o app atrás dele).
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) cb_ligacoes: o diálogo, o resumo e a poda
-- ------------------------------------------------------------
-- `transcricao`: os trechos `[{ quem: 'cliente'|'atendente', inicio: <seg>,
-- texto }]`, na ordem do diálogo (`src/lib/whatsapp/ligacoes/dialogo.ts`).
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS transcricao jsonb;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS transcricao_status text;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS transcricao_erro text;
-- O carimbo do cadeado (a cerca de posse de toda escrita depois dele).
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS transcricao_desde timestamptz;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS transcricao_em timestamptz;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS transcricao_tentativas integer NOT NULL DEFAULT 0;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS resumo text;
-- A poda dos 180 dias (ou a exclusão definitiva): os arquivos saíram do
-- Storage e o diálogo do banco; fica o resumo (a não ser na exclusão).
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS gravacao_expirada_em timestamptz;

ALTER TABLE cb_ligacoes DROP CONSTRAINT IF EXISTS cb_ligacoes_transcricao_status_ck;
ALTER TABLE cb_ligacoes ADD CONSTRAINT cb_ligacoes_transcricao_status_ck
  CHECK (transcricao_status IS NULL OR transcricao_status IN ('transcrevendo', 'pronta', 'falhou', 'recusada'));
ALTER TABLE cb_ligacoes DROP CONSTRAINT IF EXISTS cb_ligacoes_transcricao_tentativas_ck;
ALTER TABLE cb_ligacoes ADD CONSTRAINT cb_ligacoes_transcricao_tentativas_ck
  CHECK (transcricao_tentativas >= 0);

-- O laço lento procura as ligações pelo CRM ainda com gravação: as que faltam
-- transcrever (dos últimos 7 dias) e as que passaram dos 180 (a poda). As
-- duas consultas recortam por `criada_em` dentro deste conjunto.
CREATE INDEX IF NOT EXISTS cb_ligacoes_com_gravacao_idx
  ON cb_ligacoes (criada_em)
  WHERE pelo_crm AND gravacao_expirada_em IS NULL;

-- ------------------------------------------------------------
-- 2) A faixa reflete a ligação, numa escrita só
-- ------------------------------------------------------------
-- Lê a ligação com `FOR UPDATE`: as sincronizações ficam em fila com as
-- escritas do estado, e a que chega depois lê o estado mais novo. Funde com
-- `||` (o resto da faixa fica) só na faixa de ligação (`content_type =
-- 'call'` com `ligacao`). Devolve true quando marcou. SECURITY DEFINER: o
-- servidor (service_role) a chama sem precisar de privilégio nas tabelas.
CREATE OR REPLACE FUNCTION public.cb_ligacao_sincronizar_faixa(p_ligacao uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  l record;
BEGIN
  SELECT g.message_id, g.gravacao_recebida_em, g.gravacao_expirada_em, g.transcricao_status, g.resumo
    INTO l
    FROM cb_ligacoes g
   WHERE g.id = p_ligacao
     FOR UPDATE;
  IF NOT FOUND OR l.message_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE messages
     SET ligacao = ligacao || jsonb_build_object(
           'gravacao', l.gravacao_recebida_em IS NOT NULL AND l.gravacao_expirada_em IS NULL,
           'transcricao', CASE WHEN l.gravacao_expirada_em IS NULL THEN l.transcricao_status END,
           'resumo', l.resumo,
           'expirada', l.gravacao_expirada_em IS NOT NULL)
   WHERE id = l.message_id
     AND content_type = 'call'
     AND ligacao IS NOT NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cb_ligacao_sincronizar_faixa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ligacao_sincronizar_faixa(uuid) TO service_role;

-- ------------------------------------------------------------
-- 3) A exclusão definitiva leva a gravação, o diálogo e o resumo
-- ------------------------------------------------------------
-- 3.1 A fila de arquivos (1097) aceita o bucket das gravações. A guarda do
--     caminho segue: `account-<conta>/…`.
ALTER TABLE public.cb_arquivos_a_apagar DROP CONSTRAINT IF EXISTS cb_arquivos_a_apagar_bucket_ck;
ALTER TABLE public.cb_arquivos_a_apagar ADD CONSTRAINT cb_arquivos_a_apagar_bucket_ck
  CHECK (bucket IN ('chat-media', 'ligacoes'));

-- 3.2 A limpeza das ligações pelo CRM de uma ficha: os três arquivos de cada
--     ligação atendida (e ainda não podada) vão para a fila, e o diálogo e o
--     resumo saem. A linha fica (é o registro da ligação; só o pedido do
--     titular a apaga, em `cb_lixeira_purgar_um`). Devolve as linhas limpas.
CREATE OR REPLACE FUNCTION public.cb_ligacoes_sem_gravacao(p_conta uuid, p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO cb_arquivos_a_apagar (account_id, bucket, caminho, origem)
  SELECT p_conta, 'ligacoes', 'account-' || p_conta::text || '/ligacoes/' || g.id::text || '/' || a.nome, 'lixeira'
    FROM cb_ligacoes g
   CROSS JOIN unnest(ARRAY['estereo.ogg', 'cliente.ogg', 'atendente.ogg']) AS a(nome)
   WHERE g.id = ANY (p_ids)
     AND g.account_id = p_conta
     AND g.pelo_crm
     AND g.atendida_pelo_crm_em IS NOT NULL
     AND g.gravacao_expirada_em IS NULL
  ON CONFLICT (bucket, caminho) DO NOTHING;

  UPDATE cb_ligacoes
     SET transcricao = NULL,
         resumo = NULL,
         transcricao_desde = NULL,
         gravacao_expirada_em = coalesce(gravacao_expirada_em, now())
   WHERE id = ANY (p_ids)
     AND account_id = p_conta
     AND pelo_crm;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ligacoes_sem_gravacao(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- 3.3 A reivindicação (corpo da 1097) com a guarda POR BUCKET: o `chat-media`
--     pela função dele e pelas citações, como antes; as gravações pela forma
--     do caminho. Bucket desconhecido sai da fila sem apagar nada.
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
     AND CASE f.bucket
           WHEN 'chat-media' THEN cb_caminho_no_chat_media(f.caminho, f.account_id) IS DISTINCT FROM f.caminho
           WHEN 'ligacoes' THEN f.caminho !~ ('^account-' || f.account_id::text
             || '/ligacoes/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(estereo|cliente|atendente)\.ogg$')
           ELSE true
         END;
  FOR v_conta IN SELECT DISTINCT f.account_id FROM cb_arquivos_a_apagar f
                  WHERE f.id = ANY (v_ids) AND f.bucket = 'chat-media' LOOP
    DELETE FROM cb_arquivos_a_apagar f
     WHERE f.id = ANY (v_ids) AND f.account_id = v_conta AND f.bucket = 'chat-media'
       AND f.caminho IN (SELECT cb_arquivos_citados(v_conta, ARRAY(
             SELECT g.caminho FROM cb_arquivos_a_apagar g
              WHERE g.id = ANY (v_ids) AND g.account_id = v_conta AND g.bucket = 'chat-media')));
  END LOOP;

  RETURN QUERY
    SELECT f.id, f.account_id, f.bucket, f.caminho, f.reivindicado_em
      FROM cb_arquivos_a_apagar f
     WHERE f.id = ANY (v_ids)
     ORDER BY f.criado_em, f.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_reivindicar_arquivos_a_apagar(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_reivindicar_arquivos_a_apagar(integer) TO service_role;

-- 3.4 Excluir de vez: o corpo VIGENTE da 1110 + as ligações pelo CRM da
--     ficha (a conversa delas está nos ponteiros, `reaponta`), ANTES e FORA
--     do `IF p_pedido`: vale no vencimento e no "Excluir agora". Com o
--     pedido do titular, também as do mesmo telefone (que o DELETE de
--     baixo apaga) deixam os arquivos na fila antes de a linha sumir.
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

  -- 1136 (4d): as ligações pelo CRM desta ficha perdem a gravação, o diálogo e o resumo.
  v_ids := ARRAY(SELECT DISTINCT (l -> 'pk' ->> 'id')::uuid FROM jsonb_array_elements(v.ponteiros) p,
                   jsonb_array_elements(p -> 'linhas') l WHERE p ->> 'tabela' = 'cb_ligacoes');
  PERFORM cb_ligacoes_sem_gravacao(v.account_id, v_ids);

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
    -- 1136: as do mesmo telefone fora dos ponteiros também deixam os arquivos na fila.
    PERFORM cb_ligacoes_sem_gravacao(v.account_id, ARRAY(
      SELECT g.id FROM cb_ligacoes g WHERE g.account_id = v.account_id AND g.telefone = ANY (v_telefones)));
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
-- 4) Conferência do CATÁLOGO (vale no banco vazio do replay)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cb_ligacoes'
         AND column_name IN ('transcricao', 'transcricao_status', 'transcricao_erro', 'transcricao_desde',
                             'transcricao_em', 'transcricao_tentativas', 'resumo', 'gravacao_expirada_em')) <> 8 THEN
    RAISE EXCEPTION '1136: faltam colunas da transcrição em cb_ligacoes';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ligacoes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ligacoes', 'SELECT') THEN
    RAISE EXCEPTION '1136: cb_ligacoes aberta ao navegador';
  END IF;
  IF position('ligacoes' IN (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c
                              WHERE c.conname = 'cb_arquivos_a_apagar_bucket_ck'
                                AND c.conrelid = 'public.cb_arquivos_a_apagar'::regclass)) = 0 THEN
    RAISE EXCEPTION '1136: a fila de arquivos não aceita o bucket das gravações';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ligacao_sincronizar_faixa(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ligacao_sincronizar_faixa(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_ligacao_sincronizar_faixa(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_ligacoes_sem_gravacao(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ligacoes_sem_gravacao(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_reivindicar_arquivos_a_apagar(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_reivindicar_arquivos_a_apagar(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_reivindicar_arquivos_a_apagar(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_purgar_um(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION '1136: EXECUTE das funções fora do lugar';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p
           WHERE p.oid = 'public.cb_ligacao_sincronizar_faixa(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '1136: a sincronização da faixa não é SECURITY DEFINER';
  END IF;
  IF position('cb_ligacoes_sem_gravacao(v.account_id, v_ids)'
              IN pg_get_functiondef('public.cb_lixeira_purgar_um(uuid, boolean)'::regprocedure)) = 0
     OR position('cb_ia_turno_sem_conteudo(v_ids, ''exclusao'')'
              IN pg_get_functiondef('public.cb_lixeira_purgar_um(uuid, boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '1136: a exclusão definitiva perdeu a limpeza das ligações ou a dos turnos';
  END IF;
  IF position('WHEN ''ligacoes'''
              IN pg_get_functiondef('public.cb_reivindicar_arquivos_a_apagar(integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '1136: a reivindicação não guarda o bucket das gravações';
  END IF;
  RAISE NOTICE '1136: colunas, fila, funções e portas conferidas.';
END $$;

-- ------------------------------------------------------------
-- 5) Conferência que CHAMA (supabase.md, regra 3 do banco vazio)
-- ------------------------------------------------------------
-- As funções novas ou recriadas são CHAMADAS (o corpo plpgsql só é analisado
-- quando roda). Com uma conta: uma ficha, uma conversa, uma faixa e uma
-- ligação pelo CRM FICTÍCIAS — a faixa passa a refletir a ligação sem perder
-- o que havia nela, a
-- limpeza põe os três arquivos na fila e tira diálogo e resumo, a
-- reivindicação (como o service_role) devolve os três, sem tirá-los da fila
-- pela guarda, e a exclusão definitiva roda inteira, sem e com o pedido do
-- titular. Tudo desfeito pelo SQLSTATE próprio (P1136 — nunca
-- `WHEN OTHERS`, que engoliria o defeito); no banco vazio, só as chamadas.
DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_ficha uuid;
  v_conversa uuid;
  v_faixa uuid;
  v_ligacao uuid;
  v_n integer;
  v_ok boolean;
  v_l record;
  v_r jsonb;
BEGIN
  BEGIN
    -- Com um id de verdade (que não existe), o corpo inteiro roda — o
    -- `cardinality = 0` sairia antes do INSERT e do UPDATE.
    v_n := public.cb_ligacoes_sem_gravacao(gen_random_uuid(), ARRAY[gen_random_uuid()]);
    IF v_n <> 0 THEN
      RAISE EXCEPTION '1136: a limpeza de uma ligação que não existe limpou % linha(s)', v_n;
    END IF;
    IF public.cb_ligacao_sincronizar_faixa(gen_random_uuid()) IS DISTINCT FROM false THEN
      RAISE EXCEPTION '1136: a sincronização achou uma ligação que não existe';
    END IF;

    SELECT a.id, a.owner_user_id INTO v_conta, v_dono
      FROM public.accounts a
      JOIN public.profiles p ON p.user_id = a.owner_user_id AND p.account_id = a.id
     ORDER BY a.created_at
     LIMIT 1;

    IF v_conta IS NULL THEN
      SET LOCAL ROLE service_role;
      PERFORM * FROM public.cb_reivindicar_arquivos_a_apagar(1);
      RESET ROLE;
      RAISE NOTICE '1136: banco vazio — as funções foram chamadas sem linhas.';
    ELSE
      INSERT INTO public.contacts (user_id, account_id, phone, name)
      VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano Conferencia 1136')
      RETURNING id INTO v_ficha;
      INSERT INTO public.conversations (user_id, account_id, contact_id, status)
      VALUES (v_dono, v_conta, v_ficha, 'closed') RETURNING id INTO v_conversa;
      INSERT INTO public.cb_ligacoes (account_id, call_id, direcao, pelo_crm, conversation_id, atendida_pelo_crm_em,
                                      desfecho, gravacao_recebida_em, transcricao_status, transcricao, resumo)
      VALUES (v_conta, 'crm:' || gen_random_uuid()::text, 'feita', true, v_conversa, now(), 'atendida', now(), 'pronta',
              '[{"quem": "cliente", "inicio": 1, "texto": "Fala fictícia."}]'::jsonb, 'Resumo fictício.')
      RETURNING id INTO v_ligacao;
      INSERT INTO public.messages (conversation_id, sender_type, content_type, message_id, from_me, status, ligacao)
      VALUES (v_conversa, 'agent', 'call', 'call:conferencia-1136-' || v_ligacao::text, true, 'sent',
              jsonb_build_object('desfecho', 'atendida', 'pelo_crm', true, 'gravacao', true,
                                 'ligacao_id', v_ligacao::text))
      RETURNING id INTO v_faixa;

      -- Sem a faixa ligada, nada a sincronizar; ligada, ela reflete a
      -- ligação e o que havia nela fica.
      IF public.cb_ligacao_sincronizar_faixa(v_ligacao) IS DISTINCT FROM false THEN
        RAISE EXCEPTION '1136: a sincronização marcou sem a faixa ligada';
      END IF;
      UPDATE public.cb_ligacoes SET message_id = v_faixa WHERE id = v_ligacao;
      v_ok := public.cb_ligacao_sincronizar_faixa(v_ligacao);
      SELECT ligacao INTO v_r FROM public.messages WHERE id = v_faixa;
      IF v_ok IS DISTINCT FROM true
         OR v_r ->> 'desfecho' IS DISTINCT FROM 'atendida' OR v_r ->> 'ligacao_id' IS DISTINCT FROM v_ligacao::text
         OR v_r ->> 'gravacao' IS DISTINCT FROM 'true' OR v_r ->> 'transcricao' IS DISTINCT FROM 'pronta'
         OR v_r ->> 'resumo' IS DISTINCT FROM 'Resumo fictício.' OR v_r ->> 'expirada' IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION '1136: a faixa não refletiu a ligação: %', v_r;
      END IF;

      -- A limpeza: os três arquivos na fila; diálogo e resumo fora; a linha fica.
      v_n := public.cb_ligacoes_sem_gravacao(v_conta, ARRAY[v_ligacao]);
      SELECT transcricao, resumo, gravacao_expirada_em INTO v_l FROM public.cb_ligacoes WHERE id = v_ligacao;
      IF v_n <> 1 OR v_l.transcricao IS NOT NULL OR v_l.resumo IS NOT NULL OR v_l.gravacao_expirada_em IS NULL THEN
        RAISE EXCEPTION '1136: a limpeza da ligação errou (% linha(s))', v_n;
      END IF;
      IF (SELECT count(*) FROM public.cb_arquivos_a_apagar
           WHERE bucket = 'ligacoes' AND account_id = v_conta
             AND caminho LIKE 'account-' || v_conta::text || '/ligacoes/' || v_ligacao::text || '/%') <> 3 THEN
        RAISE EXCEPTION '1136: a limpeza não pôs os três arquivos da gravação na fila';
      END IF;

      -- A reivindicação devolve os três (a guarda das gravações os aceita).
      UPDATE public.cb_arquivos_a_apagar SET criado_em = '2000-01-01'
       WHERE bucket = 'ligacoes' AND caminho LIKE '%/' || v_ligacao::text || '/%';
      SET LOCAL ROLE service_role;
      SELECT count(*) INTO v_n FROM public.cb_reivindicar_arquivos_a_apagar(3) r
       WHERE r.bucket = 'ligacoes' AND r.caminho LIKE '%/' || v_ligacao::text || '/%';
      RESET ROLE;
      IF v_n <> 3 THEN
        RAISE EXCEPTION '1136: a reivindicação devolveu % arquivo(s) da gravação, não 3', v_n;
      END IF;

      -- A exclusão definitiva (o corpo inteiro, sem e com o pedido do
      -- titular), por dois itens FICTÍCIOS da Lixeira que apontam outra
      -- ligação pelos ponteiros.
      INSERT INTO public.cb_ligacoes (account_id, call_id, direcao, pelo_crm, atendida_pelo_crm_em,
                                      desfecho, transcricao_status, transcricao, resumo, telefone)
      VALUES (v_conta, 'crm:' || gen_random_uuid()::text, 'feita', true, now(), 'atendida', 'pronta',
              '[]'::jsonb, 'Outro resumo fictício.', '5500000001136')
      RETURNING id INTO v_ligacao;
      INSERT INTO public.cb_lixeira_de_contatos (account_id, contact_id, lote_id, fotografia, ponteiros)
      VALUES (v_conta, gen_random_uuid(), gen_random_uuid(), '{}'::jsonb,
              jsonb_build_array(jsonb_build_object('tabela', 'cb_ligacoes', 'linhas',
                jsonb_build_array(jsonb_build_object('pk', jsonb_build_object('id', v_ligacao))))))
      RETURNING id INTO v_ficha;
      -- A chamada numa instrução e a leitura noutra: na mesma, a foto é a de antes.
      v_r := public.cb_lixeira_purgar_um(v_ficha, false);
      IF v_r ->> 'resultado' IS DISTINCT FROM 'excluida'
         OR (SELECT resumo FROM public.cb_ligacoes WHERE id = v_ligacao) IS NOT NULL
         OR (SELECT count(*) FROM public.cb_arquivos_a_apagar
              WHERE bucket = 'ligacoes' AND caminho LIKE '%/' || v_ligacao::text || '/%') <> 3 THEN
        RAISE EXCEPTION '1136: a exclusão definitiva não levou a gravação e o resumo da ligação';
      END IF;
      INSERT INTO public.cb_lixeira_de_contatos (account_id, contact_id, lote_id, fotografia, ponteiros, telefone)
      VALUES (v_conta, gen_random_uuid(), gen_random_uuid(), '{}'::jsonb,
              jsonb_build_array(jsonb_build_object('tabela', 'cb_ligacoes', 'linhas',
                jsonb_build_array(jsonb_build_object('pk', jsonb_build_object('id', v_ligacao))))),
              '5500000001136')
      RETURNING id INTO v_ficha;
      v_r := public.cb_lixeira_purgar_um(v_ficha, true);
      IF v_r ->> 'resultado' IS DISTINCT FROM 'excluida'
         OR EXISTS (SELECT 1 FROM public.cb_ligacoes WHERE id = v_ligacao) THEN
        RAISE EXCEPTION '1136: a exclusão com o pedido do titular não apagou a ligação';
      END IF;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1136', MESSAGE = 'desfaz a conferência';
  EXCEPTION WHEN SQLSTATE 'P1136' THEN
    RAISE NOTICE '1136: marca, limpeza e reivindicação chamadas e desfeitas — conta: %.', v_conta IS NOT NULL;
  END;
END $$;
