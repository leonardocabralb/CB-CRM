-- ============================================================
-- 1134_cb_ligacoes_pelo_crm
--
-- Ligar e atender pelo CRM, a 4b (`docs/PLANO-ligar-pelo-crm.md`, §8.14). O
-- computador de ligações (4a, `maquina-de-ligacoes/`) liga e atende pelo
-- WhatsApp Web de um número; daqui em diante o CRM é o dono da ligação:
--
--   1. `cb_ligacoes` (1044, fechada ao navegador) guarda também a ligação
--      FEITA pelo CRM (`call_id = 'crm:<uuid>'`) e a recebida ATENDIDA pelo
--      CRM: a direção, quem ligou ou atendeu (autoria, `ON DELETE SET NULL`,
--      1116), a marca do atendimento pelo CRM em curso (o conserto do
--      "atendida pelo CRM vira perdida", §8.4 passo 4), o fim que a máquina
--      conta e a hora em que a gravação chegou. O desfecho ganha
--      `nao_atendida` (a feita que o cliente não atendeu).
--   2. `cb_computadores_de_ligacao` (FECHADA ao navegador): um computador por
--      conexão, o endereço na rede interna e o último sinal de vida. Fora de
--      `cb_channels` de propósito: o sinal é uma escrita por minuto, e toda
--      escrita lá refaz a sonda de saúde em cada aba.
--   3. `cb_ligacoes_ao_vivo`: uma linha por ligação em curso (tocando,
--      conectando, chamando, em ligação). Leitura por membro na forma da 1032,
--      escrita só pelo servidor, na publicação do tempo real (a tela da 4c toca
--      e mostra o estado por ela). SEM FK para conversa, contato nem conexão: a
--      linha é passageira, e FK para o fecho da Lixeira recusaria o mover
--      (default-deny, 1097). UMA ligação por número além das que tocam (índice
--      único parcial): duas ao mesmo tempo no mesmo número viram 23505 → 409.
--   4. Bucket PRIVADO `ligacoes` (as gravações), sem policy: só o servidor
--      escreve e lê; ouvir é por URL assinada curta, depois de a rota conferir
--      o acesso à conversa. O `chat-media` é público: gravação de ligação
--      nunca pode ter endereço aberto.
--   5. A retomada da IA (`cb_ia_reservar_envio`, corpo VIGENTE da 1130) não
--      conta a FAIXA da ligação pelo CRM como "a equipe respondeu" (D6/D6b: a
--      faixa é só registro). A faixa é `agent` sem autor e fora do celular:
--      para a 972 e para a pausa da IA (1118) ela já não é gente; só a
--      retomada contava todo `agent`. A ligação atendida no CELULAR
--      (`from_device`) segue parando a série, como hoje.
--
-- ADITIVA: aplicar ANTES do deploy — o código novo grava as colunas e as
-- tabelas; o app anterior não lê nada disto e convive com a reserva nova.
-- Idempotente; aplica em banco vazio. Conferência no fim: catálogo e
-- privilégios sempre; com dado, a reserva CHAMADA num subbloco desfeito por
-- SQLSTATE próprio (P1134), na forma da 1130.
-- ============================================================

-- `cb_ligacoes` recebe escrita a cada aviso de ligação: sem teto de espera,
-- uma transação longa enfileiraria o webhook atrás desta trava.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 0) A conversa da conferência, escolhida ANTES de qualquer trava (a forma da
--    1130): 1:1 aberta, sem pausa, sem turno vivo, card ABERTO numa etapa sem
--    agente e uma conexão da conta.
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT cv.id AS conv, cv.account_id AS conta, dl.id AS deal, dl.stage_id AS etapa, ch.id AS canal
    INTO r
    FROM conversations cv
    JOIN deals dl ON dl.contact_id = cv.contact_id AND dl.account_id = cv.account_id AND dl.status = 'open'
    JOIN LATERAL (SELECT c2.id FROM cb_channels c2 WHERE c2.account_id = cv.account_id LIMIT 1) ch ON true
   WHERE cv.group_id IS NULL AND cv.status <> 'closed' AND NOT cv.ai_autoreply_disabled
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos t
                      WHERE t.conversation_id = cv.id AND t.status IN ('aguardando', 'rodando'))
     AND NOT EXISTS (SELECT 1 FROM cb_ia_agente_etapas e WHERE e.stage_id = dl.stage_id)
   LIMIT 1;
  IF r.conv IS NOT NULL THEN
    PERFORM set_config('cb1134.conv', r.conv::text, true);
    PERFORM set_config('cb1134.conta', r.conta::text, true);
    PERFORM set_config('cb1134.deal', r.deal::text, true);
    PERFORM set_config('cb1134.etapa', r.etapa::text, true);
    PERFORM set_config('cb1134.canal', r.canal::text, true);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 1) cb_ligacoes: a direção, quem ligou ou atendeu pelo CRM e o fim que a
--    máquina conta. Todas anuláveis ou com padrão: as linhas da Evolution
--    (1044) seguem como estão (`recebida`, fora do CRM).
-- ------------------------------------------------------------
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS direcao text NOT NULL DEFAULT 'recebida';
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS pelo_crm boolean NOT NULL DEFAULT false;
-- O login de quem ligou ou atendeu pelo CRM (autoria: o login apagado deixa a
-- ligação sem nome, nunca a apaga — 1116).
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS atendente_id uuid;
-- A marca do "atendimento pelo CRM em curso": gravada no clique em Atender,
-- apagada se a máquina não conseguir atender. Enquanto ela vale (com teto), a
-- régua da Evolution não conclui "perdida" — o `terminate` que o próprio
-- atendimento provoca chega antes da confirmação da máquina.
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS atendimento_pelo_crm_desde timestamptz;
-- O cliente atendeu (a feita) ou a máquina atendeu (a recebida): relógio da máquina.
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS atendida_pelo_crm_em timestamptz;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS duracao_seg integer;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS motivo_do_fim text;
ALTER TABLE cb_ligacoes ADD COLUMN IF NOT EXISTS gravacao_recebida_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_ligacoes_atendente_fkey' AND conrelid = 'public.cb_ligacoes'::regclass
  ) THEN
    ALTER TABLE cb_ligacoes
      ADD CONSTRAINT cb_ligacoes_atendente_fkey
      FOREIGN KEY (atendente_id) REFERENCES auth.users (id) ON DELETE SET NULL;
  END IF;
END $$;

-- Apagar um login faz SET NULL aqui: sem índice, cada login apagado varreria
-- a tabela inteira.
CREATE INDEX IF NOT EXISTS cb_ligacoes_atendente_idx
  ON cb_ligacoes (atendente_id) WHERE atendente_id IS NOT NULL;

ALTER TABLE cb_ligacoes DROP CONSTRAINT IF EXISTS cb_ligacoes_direcao_ck;
ALTER TABLE cb_ligacoes ADD CONSTRAINT cb_ligacoes_direcao_ck
  CHECK (direcao IN ('recebida', 'feita'));
-- A feita só existe pelo CRM (a feita pelo celular não gera aviso nenhum).
ALTER TABLE cb_ligacoes DROP CONSTRAINT IF EXISTS cb_ligacoes_feita_pelo_crm_ck;
ALTER TABLE cb_ligacoes ADD CONSTRAINT cb_ligacoes_feita_pelo_crm_ck
  CHECK (direcao = 'recebida' OR pelo_crm);
ALTER TABLE cb_ligacoes DROP CONSTRAINT IF EXISTS cb_ligacoes_duracao_ck;
ALTER TABLE cb_ligacoes ADD CONSTRAINT cb_ligacoes_duracao_ck
  CHECK (duracao_seg IS NULL OR duracao_seg >= 0);
-- Os motivos da máquina (`MotivoDoFim`, maquina-de-ligacoes/src/tipos.ts) e o
-- `sumiu` do CRM: a ligação que a máquina deixou de ter sem mandar o fim (o
-- contêiner reiniciou no meio, o aviso se perdeu).
ALTER TABLE cb_ligacoes DROP CONSTRAINT IF EXISTS cb_ligacoes_motivo_do_fim_ck;
ALTER TABLE cb_ligacoes ADD CONSTRAINT cb_ligacoes_motivo_do_fim_ck
  CHECK (motivo_do_fim IS NULL OR motivo_do_fim IN (
    'cliente_desligou', 'atendente_desligou', 'nao_atendida', 'ocupado',
    'sem_whatsapp', 'teto_30min', 'ponte_caiu', 'falhou', 'sumiu'
  ));
-- O CHECK da 1044 tem nome: DROP pelo nome, ADD com o valor novo.
ALTER TABLE cb_ligacoes DROP CONSTRAINT IF EXISTS cb_ligacoes_desfecho_ck;
ALTER TABLE cb_ligacoes ADD CONSTRAINT cb_ligacoes_desfecho_ck
  CHECK (desfecho IS NULL OR desfecho IN (
    'perdida', 'atendida', 'sem_telefone', 'do_escritorio', 'falhou', 'nao_atendida'
  ));

-- ------------------------------------------------------------
-- 2) cb_computadores_de_ligacao — FECHADA ao navegador (o endereço interno não
--    é da tela; a 4e mostra o estado por rota)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_computadores_de_ligacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  -- O `LIGACOES_COMPUTADOR` da máquina (o contêiner é `ligacoes-<nome>`). O
  -- segredo de cada computador sai dele (HMAC do segredo do CRM): quem tem o
  -- segredo de um não fala pelo outro.
  nome text NOT NULL,
  -- A API dele na rede interna, sem barra no fim (ex.: http://ligacoes-x:8080).
  endereco text NOT NULL,
  -- O último sinal de vida (um por minuto).
  whatsapp text,
  ligacao_em_curso text,
  chrome text,
  ultimo_sinal_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_computadores_de_ligacao_canal_key UNIQUE (channel_id),
  CONSTRAINT cb_computadores_de_ligacao_nome_key UNIQUE (nome),
  CONSTRAINT cb_computadores_de_ligacao_nome_ck CHECK (nome ~ '^[a-z0-9-]{1,40}$'),
  CONSTRAINT cb_computadores_de_ligacao_endereco_ck CHECK (endereco ~ '^https?://[^/?#]+$'),
  CONSTRAINT cb_computadores_de_ligacao_whatsapp_ck
    CHECK (whatsapp IS NULL OR whatsapp IN ('carregando', 'qr', 'conectado'))
);

COMMENT ON TABLE cb_computadores_de_ligacao IS
  'O computador de ligações de cada conexão (1134, maquina-de-ligacoes/): o endereço na rede interna e o último sinal de vida. Fechada ao navegador.';

-- A conexão é da MESMA conta; apagá-la leva o computador junto.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_computadores_de_ligacao_channel_fkey'
      AND conrelid = 'public.cb_computadores_de_ligacao'::regclass
  ) THEN
    ALTER TABLE cb_computadores_de_ligacao
      ADD CONSTRAINT cb_computadores_de_ligacao_channel_fkey
      FOREIGN KEY (channel_id, account_id)
      REFERENCES cb_channels (id, account_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE cb_computadores_de_ligacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_computadores_de_ligacao FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_computadores_de_ligacao TO service_role;

-- ------------------------------------------------------------
-- 3) cb_ligacoes_ao_vivo — a ligação em curso, para a tela (tempo real)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_ligacoes_ao_vivo (
  -- O mesmo id da linha de `cb_ligacoes` (sem FK: esta é passageira).
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  direcao text NOT NULL,
  estado text NOT NULL,
  -- O número da ligação, para a tela mostrar quem é antes de haver ficha.
  telefone text,
  conversation_id uuid,
  contact_id uuid,
  -- Quem ligou ou atendeu pelo CRM (nulo enquanto toca).
  atendente_id uuid,
  desde timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_ligacoes_ao_vivo_direcao_ck CHECK (direcao IN ('recebida', 'feita')),
  CONSTRAINT cb_ligacoes_ao_vivo_estado_ck
    CHECK (estado IN ('tocando', 'conectando', 'chamando', 'em_ligacao')),
  CONSTRAINT cb_ligacoes_ao_vivo_tocando_sem_atendente_ck
    CHECK (estado <> 'tocando' OR atendente_id IS NULL)
);

COMMENT ON TABLE cb_ligacoes_ao_vivo IS
  'As ligações pelo computador de ligações em curso agora (1134): tocando, conectando, chamando, em ligação. Some no fim. A tela lê por tempo real; só o servidor escreve.';

-- UMA ligação por número além das que tocam: o "Ligar" e o "Atender" que
-- chegam juntos para o mesmo número não passam os dois.
CREATE UNIQUE INDEX IF NOT EXISTS cb_ligacoes_ao_vivo_uma_por_numero
  ON cb_ligacoes_ao_vivo (channel_id) WHERE estado <> 'tocando';
CREATE INDEX IF NOT EXISTS cb_ligacoes_ao_vivo_conta_idx ON cb_ligacoes_ao_vivo (account_id);

ALTER TABLE cb_ligacoes_ao_vivo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_ligacoes_ao_vivo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_ligacoes_ao_vivo TO authenticated;
GRANT ALL ON TABLE cb_ligacoes_ao_vivo TO service_role;

DROP POLICY IF EXISTS cb_ligacoes_ao_vivo_leitura ON cb_ligacoes_ao_vivo;
CREATE POLICY cb_ligacoes_ao_vivo_leitura ON cb_ligacoes_ao_vivo
  FOR SELECT TO authenticated
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- Na publicação do tempo real, SEM lista de colunas (a armadilha da 909).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'cb_ligacoes_ao_vivo'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cb_ligacoes_ao_vivo;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) O bucket das gravações — PRIVADO e sem policy em storage.objects (só o
--    servidor, com a chave de serviço). Opus: ~5,4 MB por 30 min no estéreo,
--    abaixo do teto de 10 MB que o Next guarda do corpo com o middleware.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ligacoes', 'ligacoes', FALSE, 10485760, ARRAY['audio/ogg'])
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- 5) A reserva do envio do agente (corpo VIGENTE da 1130): a faixa da
--    ligação pelo CRM não é "a equipe respondeu"
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_ia_reservar_envio(
  p_turno_id      uuid,
  p_rodando_desde timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  t          cb_ia_turnos%ROWTYPE;
  c          record;
  d          record;
  a          record;
  v_gatilho  timestamptz;
  v_apagada  timestamptz;
  v_entrou   timestamptz;
  v_contadas integer;
BEGIN
  SELECT * INTO t FROM cb_ia_turnos r WHERE r.id = p_turno_id;
  IF NOT FOUND OR t.status <> 'rodando' OR t.rodando_desde IS DISTINCT FROM p_rodando_desde THEN
    RETURN 'descartado';
  END IF;

  -- A trava: a pausa por gente, o encerramento e o gatilho da mensagem do
  -- cliente (972) escrevem esta linha e esperam por ela.
  SELECT cv.status, cv.ai_autoreply_disabled, cv.ia_retomada_em INTO c
    FROM conversations cv
   WHERE cv.id = t.conversation_id AND cv.account_id = t.account_id
   FOR NO KEY UPDATE;
  IF NOT FOUND OR c.status = 'closed' THEN
    RETURN 'encerrada';
  END IF;
  IF c.ai_autoreply_disabled THEN
    RETURN 'pausada';
  END IF;

  SELECT dl.stage_id, dl.status, dl.etapa_desde INTO d
    FROM deals dl
   WHERE dl.id = t.deal_id AND dl.account_id = t.account_id;
  IF NOT FOUND OR d.stage_id IS DISTINCT FROM t.stage_id THEN
    RETURN 'card_mudou';
  END IF;
  IF d.status IS DISTINCT FROM 'open' THEN
    RETURN 'card_fechado';
  END IF;

  SELECT ag.ativo, ag.arquivado_em, ag.conexoes, ag.teto_respostas, ag.retomada INTO a
    FROM cb_ia_agentes ag
   WHERE ag.id = t.ia_agente_id AND ag.account_id = t.account_id;
  IF NOT FOUND OR NOT a.ativo OR a.arquivado_em IS NOT NULL THEN
    RETURN 'agente_desligado';
  END IF;
  IF t.canal_id IS NULL OR NOT (t.canal_id = ANY (a.conexoes)) THEN
    RETURN 'fora_da_conexao';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cb_ia_agente_etapas e
     WHERE e.stage_id = t.stage_id
       AND e.ia_agente_id = t.ia_agente_id
       AND e.account_id = t.account_id
  ) THEN
    RETURN 'agente_sem_etapa';
  END IF;
  IF t.tipo = 'retomada' AND NOT coalesce(a.retomada -> 'ativa' = 'true'::jsonb, false) THEN
    RETURN 'retomada_desligada';
  END IF;

  SELECT g.gravada_em, g.deleted_at INTO v_gatilho, v_apagada FROM messages g WHERE g.id = t.mensagem_gatilho_id;

  -- A RETOMADA: a âncora é a resposta do agente que ficou sem resposta.
  -- Qualquer um que escreveu depois dela (na conversa inteira) para a série.
  -- A mensagem do cliente conta mesmo apagada: ele escreveu.
  IF t.tipo = 'retomada' THEN
    IF v_gatilho IS NULL OR v_apagada IS NOT NULL THEN
      RETURN 'sem_ancora';
    END IF;
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'customer'
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN 'cliente_respondeu';
    END IF;
    -- A tentativa da equipe que NÃO saiu (1118) não respondeu ninguém. A
    -- FAIXA da ligação pelo CRM (1134: `call` fora do celular) é só registro
    -- (D6/D6b) — também não; a atendida no CELULAR (`from_device`) é gente.
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'agent'
         AND NOT m.nao_saiu
         AND NOT (m.content_type = 'call' AND NOT m.from_device)
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN 'equipe_respondeu';
    END IF;
    IF EXISTS (
      SELECT 1 FROM messages m
       WHERE m.conversation_id = t.conversation_id
         AND m.sender_type = 'bot'
         AND NOT m.nao_saiu
         AND (m.ia_agente_id IS NULL OR m.ia_agente_id <> t.ia_agente_id)
         AND m.deleted_at IS NULL
         AND m.gravada_em > v_gatilho
    ) THEN
      RETURN 'robo_falou';
    END IF;
  END IF;

  -- Sem o `gravada_em` de um dos lados, o pendente vivo conta (o lado que
  -- recusa). 1130: só o pendente de RESPOSTA — o gatilho da retomada é a
  -- resposta do agente, não uma mensagem do cliente.
  IF EXISTS (
    SELECT 1 FROM cb_ia_turnos p
      JOIN messages n ON n.id = p.mensagem_gatilho_id
     WHERE p.conversation_id = t.conversation_id
       AND p.canal_id IS NOT DISTINCT FROM t.canal_id
       AND p.status = 'aguardando'
       AND p.tipo IS DISTINCT FROM 'retomada'
       AND p.id <> t.id
       AND n.deleted_at IS NULL
       AND (v_gatilho IS NULL OR n.gravada_em IS NULL OR n.gravada_em > v_gatilho)
  ) THEN
    RETURN 'mais_nova';
  END IF;

  IF v_gatilho IS NOT NULL AND EXISTS (
    SELECT 1 FROM messages m
     WHERE m.conversation_id = t.conversation_id
       AND m.sender_type = 'bot'
       AND NOT m.nao_saiu
       AND m.ia_agente_id IS NULL
       AND m.deleted_at IS NULL
       AND m.channel_id IS NOT DISTINCT FROM t.canal_id
       AND m.gravada_em > v_gatilho
  ) THEN
    RETURN 'robo_falou';
  END IF;

  -- O teto conta as respostas DESTE agente desde que a conversa ENTROU no
  -- território dele (1130): o último evento de etapa do card cuja ORIGEM não é
  -- etapa dele (ou a criação do card). Sem trilha, o `etapa_desde`; nunca
  -- depois dele. "Retomar IA" e encerrar recomeçam (`ia_retomada_em`). As
  -- retomadas CONTAM: são mensagens do agente.
  SELECT ev.occurred_at INTO v_entrou
    FROM cb_lead_events ev
   WHERE ev.deal_id = t.deal_id
     AND ev.account_id = t.account_id
     AND ev.event_type IN ('stage_changed', 'pipeline_changed', 'deal_created')
     AND (ev.from_stage_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM cb_ia_agente_etapas e
             WHERE e.stage_id = ev.from_stage_id
               AND e.ia_agente_id = t.ia_agente_id
               AND e.account_id = t.account_id
          ))
   ORDER BY ev.occurred_at DESC
   LIMIT 1;
  SELECT count(*) INTO v_contadas
    FROM messages m
   WHERE m.conversation_id = t.conversation_id
     AND m.ia_agente_id = t.ia_agente_id
     AND NOT m.nao_saiu
     AND m.gravada_em > greatest(least(coalesce(v_entrou, d.etapa_desde), d.etapa_desde), c.ia_retomada_em);
  IF v_contadas >= a.teto_respostas THEN
    RETURN 'teto';
  END IF;

  RETURN 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_reservar_envio(uuid, timestamptz) TO service_role;
-- A reserva (INVOKER) lê a trilha como o service_role (banco novo não tem o
-- privilégio padrão do Supabase; repetido da 1130 porque a conferência cobra).
GRANT SELECT ON TABLE cb_lead_events TO service_role;

-- ============================================================
-- Conferência (roda em banco vazio: catálogo e privilégios; com a conversa
-- escolhida no passo 0, a reserva é CHAMADA num subbloco desfeito por
-- SQLSTATE próprio — sem ela, NOTICE)
-- ============================================================
DO $$
DECLARE
  v_conv    uuid := nullif(current_setting('cb1134.conv', true), '')::uuid;
  v_conta   uuid := nullif(current_setting('cb1134.conta', true), '')::uuid;
  v_deal    uuid := nullif(current_setting('cb1134.deal', true), '')::uuid;
  v_etapa   uuid := nullif(current_setting('cb1134.etapa', true), '')::uuid;
  v_canal   uuid := nullif(current_setting('cb1134.canal', true), '')::uuid;
  v_nome    text;
  v_def     text;
  v_lista   boolean;
  v_publico boolean;
  v_agente  uuid;
  v_ancora  uuid;
  v_turno   uuid;
  v_desde   timestamptz;
  v_res     text;
BEGIN
  -- 1. cb_ligacoes: as colunas, UM CHECK de desfecho (com o novo e os de antes)
  --    e a autoria SET NULL; segue fechada ao navegador (1044).
  FOREACH v_nome IN ARRAY ARRAY['direcao', 'pelo_crm', 'atendente_id', 'atendimento_pelo_crm_desde',
                                'atendida_pelo_crm_em', 'duracao_seg', 'motivo_do_fim',
                                'gravacao_recebida_em'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'cb_ligacoes' AND column_name = v_nome
    ) THEN
      RAISE EXCEPTION '1134: cb_ligacoes.% não existe', v_nome;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.cb_ligacoes'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) ~ '\mdesfecho\M') <> 1 THEN
    RAISE EXCEPTION '1134: esperava UM CHECK sobre cb_ligacoes.desfecho';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.cb_ligacoes'::regclass AND conname = 'cb_ligacoes_desfecho_ck' AND convalidated;
  IF v_def IS NULL OR v_def !~ '''nao_atendida''' OR v_def !~ '''perdida''' OR v_def !~ '''do_escritorio''' THEN
    RAISE EXCEPTION '1134: cb_ligacoes_desfecho_ck ausente ou sem os desfechos: %', v_def;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'cb_ligacoes_atendente_fkey' AND conrelid = 'public.cb_ligacoes'::regclass
       AND confrelid = 'auth.users'::regclass AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION '1134: cb_ligacoes.atendente_id sem a FK para auth.users com ON DELETE SET NULL (1116)';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ligacoes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ligacoes', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_ligacoes') THEN
    RAISE EXCEPTION '1134: cb_ligacoes deixou de ser fechada ao navegador';
  END IF;

  -- 2. O computador: fechado ao navegador, aberto ao servidor.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_computadores_de_ligacao'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_computadores_de_ligacao')
     OR has_table_privilege('anon', 'public.cb_computadores_de_ligacao', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_computadores_de_ligacao', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_computadores_de_ligacao', 'UPDATE') THEN
    RAISE EXCEPTION '1134: cb_computadores_de_ligacao aberta ao navegador';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_computadores_de_ligacao', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.cb_computadores_de_ligacao', 'SELECT') THEN
    RAISE EXCEPTION '1134: service_role sem leitura e escrita em cb_computadores_de_ligacao';
  END IF;

  -- 3. A ligação ao vivo: o navegador só LÊ, e pela policy da 1032.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_ligacoes_ao_vivo'::regclass) THEN
    RAISE EXCEPTION '1134: cb_ligacoes_ao_vivo sem RLS';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ligacoes_ao_vivo', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_ligacoes_ao_vivo', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ligacoes_ao_vivo', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_ligacoes_ao_vivo', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_ligacoes_ao_vivo', 'DELETE') THEN
    RAISE EXCEPTION '1134: cb_ligacoes_ao_vivo com as concessões erradas (só leitura de authenticated)';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_ligacoes_ao_vivo', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_ligacoes_ao_vivo', 'DELETE') THEN
    RAISE EXCEPTION '1134: service_role sem escrita em cb_ligacoes_ao_vivo';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_ligacoes_ao_vivo') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cb_ligacoes_ao_vivo'
          AND policyname = 'cb_ligacoes_ao_vivo_leitura' AND cmd = 'SELECT'
          AND qual ~ 'ANY \(ARRAY\(' AND qual ~ 'cb_contas_do_usuario'
     ) THEN
    RAISE EXCEPTION '1134: cb_ligacoes_ao_vivo sem a policy de leitura na forma da 1032 (ou com outra)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'cb_ligacoes_ao_vivo'
       AND indexname = 'cb_ligacoes_ao_vivo_uma_por_numero' AND indexdef ~ 'UNIQUE'
  ) THEN
    RAISE EXCEPTION '1134: falta o índice único de uma ligação por número';
  END IF;
  SELECT pr.prattrs IS NOT NULL INTO v_lista
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
   WHERE p.pubname = 'supabase_realtime'
     AND pr.prrelid = 'public.cb_ligacoes_ao_vivo'::regclass;
  IF v_lista IS NULL THEN
    RAISE EXCEPTION '1134: cb_ligacoes_ao_vivo fora da publicação supabase_realtime';
  ELSIF v_lista THEN
    RAISE EXCEPTION '1134: cb_ligacoes_ao_vivo na publicação com LISTA de colunas';
  END IF;

  -- 4. O bucket é PRIVADO, e nenhuma policy de storage.objects fala dele.
  SELECT public INTO v_publico FROM storage.buckets WHERE id = 'ligacoes';
  IF v_publico IS DISTINCT FROM false THEN
    RAISE EXCEPTION '1134: o bucket ligacoes não existe ou é público (%)', v_publico;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') ~ 'ligacoes' OR coalesce(with_check, '') ~ 'ligacoes')
  ) THEN
    RAISE EXCEPTION '1134: há policy em storage.objects para o bucket ligacoes (só o servidor o lê)';
  END IF;

  -- 5. A reserva: uma, fechada ao navegador, aberta ao service_role.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'cb_ia_reservar_envio') <> 1 THEN
    RAISE EXCEPTION '1134: esperava UMA cb_ia_reservar_envio';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_ia_reservar_envio(uuid, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1134: a reserva com as concessões erradas';
  END IF;

  -- Com dado: a série de retomada ancorada numa resposta do agente; a faixa
  -- da ligação pelo CRM depois dela NÃO para a série, e a ligação atendida no
  -- CELULAR para (é gente). As mensagens são gravadas pelo papel da migration
  -- (o INSERT em `messages` chama funções que o service_role de um banco NOVO
  -- não executa — o que se prova aqui é a reserva).
  BEGIN
    SET LOCAL ROLE service_role;
    IF v_conv IS NOT NULL THEN
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo, ativo, conexoes, teto_respostas, retomada)
        VALUES (v_conta, '__conferencia_1134__', 'gemini', 'm', true, ARRAY[v_canal], 100, '{"ativa": true}'::jsonb)
        RETURNING id INTO v_agente;
      INSERT INTO cb_ia_agente_etapas (stage_id, account_id, ia_agente_id) VALUES (v_etapa, v_conta, v_agente);
      RESET ROLE;
      INSERT INTO messages (conversation_id, sender_type, content_type, content_text, status, channel_id,
                            ia_agente_id, gravada_em)
        VALUES (v_conv, 'bot', 'text', '__conferencia_1134__', 'sent', v_canal, v_agente, clock_timestamp())
        RETURNING id INTO v_ancora;
      SET LOCAL ROLE service_role;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, canal_id, ia_agente_id, deal_id, stage_id,
                                mensagem_gatilho_id, mensagem_inicial_id, status, rodando_desde, tipo,
                                tentativa, tentativas)
        VALUES (v_conta, v_conv, v_canal, v_agente, v_deal, v_etapa, v_ancora, v_ancora, 'rodando', now(),
                'retomada', 1, 1)
        RETURNING id, rodando_desde INTO v_turno, v_desde;

      v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
      IF v_res = 'ok' THEN
        -- (a) A faixa da ligação pelo CRM: `agent`, sem autor, fora do celular.
        RESET ROLE;
        INSERT INTO messages (conversation_id, sender_type, content_type, status, channel_id, message_id,
                              from_me, from_device, gravada_em)
          VALUES (v_conv, 'agent', 'call', 'sent', v_canal, 'call:crm:conferencia-1134', true, false,
                  clock_timestamp());
        SET LOCAL ROLE service_role;
        v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
        IF v_res <> 'ok' THEN
          RAISE EXCEPTION '1134: a faixa da ligação pelo CRM parou a retomada (%)', v_res;
        END IF;
        -- (b) A atendida no CELULAR para a série. Ela pausa a IA (é gente, 1049):
        --     a pausa sai antes da reserva para a pergunta chegar à régua.
        RESET ROLE;
        INSERT INTO messages (conversation_id, sender_type, content_type, status, channel_id, message_id,
                              from_me, from_device, gravada_em)
          VALUES (v_conv, 'agent', 'call', 'sent', v_canal, 'call:conferencia-1134', true, true,
                  clock_timestamp());
        UPDATE conversations SET ai_autoreply_disabled = false, ia_pausada_por = NULL, ia_pausada_em = NULL
         WHERE id = v_conv;
        SET LOCAL ROLE service_role;
        v_res := public.cb_ia_reservar_envio(v_turno, v_desde);
        IF v_res <> 'equipe_respondeu' THEN
          RAISE EXCEPTION '1134: a ligação atendida no celular deixou de parar a retomada (%; esperava equipe_respondeu)', v_res;
        END IF;
      ELSE
        RAISE NOTICE '1134: a reserva já respondia % — a faixa não foi exercitada aqui.', v_res;
      END IF;
    ELSE
      RAISE NOTICE '1134: nenhuma conversa aberta com card numa etapa livre — a reserva não foi chamada aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1134';
  EXCEPTION WHEN SQLSTATE 'P1134' THEN
    NULL;
  END;

  RAISE NOTICE '1134: ligações pelo CRM (colunas, computador, ao vivo, bucket privado) e a reserva conferidos.';
END $$;
