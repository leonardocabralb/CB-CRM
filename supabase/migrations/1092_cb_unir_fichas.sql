-- ============================================================
-- 1092 — Unir fichas: a fase 2 das fichas duplicadas (plano:
-- `docs/PLANO-fichas-duplicadas.md`).
--
-- A 1088 AVISA que duas fichas podem ser a mesma pessoa; aqui o admin as
-- UNE. Pedido do operador: "as duas devem prevalecer em cima daquela que o
-- sistema acha que é a mais correta e a mais atual. Dados não devem ser
-- perdidos, eles devem ser mesclados." Decisões dele (13/10/2026):
--   D6 o sistema SUGERE a ficha que fica (a com mensagem do cliente mais
--      recente); o admin pode trocar;
--   D7 UM card por funil: nos funis em que as DUAS fichas têm card, fica o
--      mais avançado (empate: o da ficha que fica); o outro sai depois de
--      passar a história (trilha, documentos) e as notas para o que fica.
--      Card em funil que só uma tem passa inteiro;
--   D8 as automações em curso da ficha que SAI terminam (marca `fusao`, a
--      mesma marca durável dos outros cancelamentos, 1005); as da que fica
--      seguem;
--   D9 o telefone e o e-mail da ficha que sai viram CONTATOS ANTIGOS da que
--      fica e a encontram nos CADASTROS (formulário pela API, Calendly,
--      webhook de entrada, Asaas — o código chama
--      `cb_ficha_por_contato_antigo`). A mensagem de WhatsApp do número
--      antigo NÃO os consulta: abre ficha própria, e o aviso da 1088 ganha o
--      sinal 4 ("contato de uma ficha unida").
-- Só ADMIN une (D1), sem desfazer: a foto da ficha que saiu e os valores
-- que ficaram de fora vão para o livro (`cb_fichas_unidas`) e para a trilha
-- (`contacts_merged`, no Histórico da que fica).
--
-- ⚠️⚠️ A RECEITA DE FUSÃO de `.claude/rules/supabase.md` agora MORA AQUI:
-- `cb_unir_fichas` reaponta TODA referência à ficha que sai. A conferência
-- final da função percorre as FKs para `contacts` pelo CATÁLOGO e ESTOURA
-- (`uniao_sem_tratamento`) se sobrar linha numa tabela que ela não conhece:
-- tabela nova com `contact_id` entra na função no mesmo PR, senão a união
-- recusa — nunca apaga calada.
--
-- ⚠️ ORDEM, por causa das restrições REAIS (medidas numa réplica do
-- esquema de produção):
--   • `contacts_identidade_ck` exige telefone, Instagram ou BSUID: a ficha
--     que sai NÃO solta o telefone antes de ser apagada. O telefone (e o
--     BSUID) passa à que fica DEPOIS do DELETE, quando o índice único libera;
--   • a conversa é UMA por ficha (036): com as duas, as mensagens passam
--     para a da que fica e a outra é apagada no fim;
--   • `cb_deals_contato_canal_idx` aceita UM card `channel` por ficha: o da
--     que sai, se a que fica já tem um, passa como `manual`;
--   • o ÍNDICE único da Kommo (`deals.kommo_lead_id`) zera no card que sai
--     ANTES de ir para o que fica.
--
-- ⚠️ Instagram fica de FORA (bloqueio `instagram`): a conversa mista
-- (Direct + WhatsApp) é a Fase 5 de `docs/PLANO-instagram-direct.md` e pede
-- o canal ativo no compositor. Dois BSUIDs diferentes também bloqueiam (a
-- ficha só guarda um).
--
-- LIMITE CONHECIDO: mensagem do cliente que chega pela conversa da ficha
-- que SAI no instante da união (a transação dura uma fração de segundo)
-- encontra a conversa apagada e se perde — o mesmo de apagar um contato.
--
-- Aditiva: tabelas, funções e dois valores novos em CHECK. Aplicar ANTES do
-- deploy (o app novo chama as RPCs).
-- ============================================================

-- `automation_logs` e `cb_lead_events` são escritas pelo motor e pelos
-- gatilhos de `deals`/`conversations`: o ALTER trava as duas até o fim.
SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) Vocabulário — os CHECKs trocam ANTES das funções que gravam os valores
-- ------------------------------------------------------------

-- 1.1 `automation_logs.interrompida_por` ganha `fusao` (D8). O CHECK nasceu
-- inline na 1005 (nome gerado): localizado pela FORMA, recriado COM nome.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.automation_logs'::regclass
       AND c.contype = 'c'
       AND c.conkey = ARRAY[(
         SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = 'public.automation_logs'::regclass
            AND a.attname = 'interrompida_por'
       )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.automation_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.automation_logs
  ADD CONSTRAINT automation_logs_interrompida_por_check CHECK (
    interrompida_por IN ('resposta', 'etapa', 'parar', 'passo', 'desativacao', 'fusao')
  );

-- 1.2 A trilha (912/1083) ganha `contacts_merged`. Mesmo molde da 1083: o
-- CHECK de tipo localizado pela forma; o de FORMA recriado inteiro.
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
      'conversation_assigned',
      'contacts_merged'
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
      WHEN 'conversation_status_changed' THEN conversation_id IS NOT NULL AND to_status IS NOT NULL
      WHEN 'conversation_assigned' THEN conversation_id IS NOT NULL
      -- 1092: a união. `details` leva a ficha que saiu e o que ficou de fora.
      WHEN 'contacts_merged' THEN details IS NOT NULL
      ELSE false
    END
  );

-- ------------------------------------------------------------
-- 2) O livro das uniões e os contatos antigos
-- ------------------------------------------------------------
-- Alvo das FKs compostas (já existe desde a 944; repetido para o banco
-- vazio).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx
  ON public.contacts (id, account_id);

CREATE TABLE IF NOT EXISTS public.cb_fichas_unidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  -- A ficha que RESPONDE hoje pela que saiu: se ela própria for unida a uma
  -- terceira depois, a linha passa para a nova (a API v1 resolve o id antigo
  -- por aqui num passo só). Apagar essa ficha leva o livro junto.
  ficha_que_fica uuid NOT NULL,
  -- Sem FK: a ficha não existe mais. UNIQUE: cada id sai uma vez só.
  ficha_removida uuid NOT NULL,
  -- A que ficou NA HORA da união (história; não acompanha uniões depois).
  unida_a uuid NOT NULL,
  -- AUTORIA (SET NULL): apagar o login de quem uniu não leva o registro.
  unida_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unida_por_nome text,
  unida_em timestamptz NOT NULL DEFAULT now(),
  -- A ficha que saiu como estava: dados, campos, etiquetas, cards, conversa.
  foto jsonb NOT NULL,
  -- Valores das duas que não cabiam numa ficha só (ficou o da que fica).
  divergencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  resumo jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cb_fichas_unidas_removida_key UNIQUE (ficha_removida),
  CONSTRAINT cb_fichas_unidas_par_ck CHECK (ficha_que_fica <> ficha_removida),
  CONSTRAINT cb_fichas_unidas_ficha_fkey
    FOREIGN KEY (ficha_que_fica, account_id)
    REFERENCES public.contacts (id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cb_fichas_unidas_ficha_idx
  ON public.cb_fichas_unidas (ficha_que_fica);

COMMENT ON TABLE public.cb_fichas_unidas IS
  'Livro das uniões de fichas (1092): a foto da ficha que saiu, os valores que ficaram de fora e a ficha que responde por ela.';

CREATE TABLE IF NOT EXISTS public.cb_contatos_antigos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  tipo text NOT NULL,
  -- Telefone: a CANÔNICA (dígitos, celular brasileiro com o nono — a régua
  -- da 1024). E-mail: aparado e minúsculo.
  valor text NOT NULL,
  fusao_id uuid REFERENCES public.cb_fichas_unidas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_contatos_antigos_tipo_ck CHECK (tipo IN ('telefone', 'email')),
  CONSTRAINT cb_contatos_antigos_valor_ck CHECK (btrim(valor) <> ''),
  -- Um valor antigo aponta para UMA ficha da conta.
  CONSTRAINT cb_contatos_antigos_valor_key UNIQUE (account_id, tipo, valor),
  CONSTRAINT cb_contatos_antigos_contato_fkey
    FOREIGN KEY (contact_id, account_id)
    REFERENCES public.contacts (id, account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS cb_contatos_antigos_contato_idx
  ON public.cb_contatos_antigos (contact_id);

COMMENT ON TABLE public.cb_contatos_antigos IS
  'Telefones e e-mails de fichas unidas (1092): encontram a ficha que ficou nos cadastros e acendem o aviso de possível duplicata.';

-- Ler: qualquer membro (forma da 1032). Escrever: só as funções abaixo
-- (SECURITY DEFINER) — nenhuma policy de escrita, e o navegador só lê.
ALTER TABLE public.cb_fichas_unidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cb_contatos_antigos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_fichas_unidas_select ON public.cb_fichas_unidas;
CREATE POLICY cb_fichas_unidas_select ON public.cb_fichas_unidas FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

DROP POLICY IF EXISTS cb_contatos_antigos_select ON public.cb_contatos_antigos;
CREATE POLICY cb_contatos_antigos_select ON public.cb_contatos_antigos FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- REVOKE antes do GRANT: o padrão do Supabase dá TUDO a `authenticated`, e
-- no replay do CI o padrão nem existe.
REVOKE ALL ON public.cb_fichas_unidas FROM anon, authenticated;
REVOKE ALL ON public.cb_contatos_antigos FROM anon, authenticated;
GRANT SELECT ON public.cb_fichas_unidas TO authenticated;
GRANT SELECT ON public.cb_contatos_antigos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_fichas_unidas TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_contatos_antigos TO service_role;

-- ------------------------------------------------------------
-- 3) A linha da união na trilha — escrita por GATILHO no livro (912: o app
--    nunca grava em `cb_lead_events`)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_log_fichas_unidas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO cb_lead_events (
    account_id, contact_id, contact_label, event_type,
    actor_user_id, actor_label, origin, details
  )
  SELECT NEW.account_id, NEW.ficha_que_fica, coalesce(nullif(c.name, ''), c.phone),
         'contacts_merged', NEW.unida_por, NEW.unida_por_nome,
         CASE WHEN NEW.unida_por IS NOT NULL THEN 'usuario' ELSE 'sistema' END,
         jsonb_build_object(
           'fusao_id', NEW.id,
           'removida', NEW.foto -> 'ficha',
           'divergencias', NEW.divergencias,
           'contatos_antigos', coalesce(NEW.resumo -> 'contatos_antigos', '[]'::jsonb),
           'cards_apagados', coalesce(NEW.resumo -> 'cards_apagados', '0'::jsonb)
         )
    FROM contacts c
   WHERE c.id = NEW.ficha_que_fica;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_fichas_unidas_na_trilha ON public.cb_fichas_unidas;
CREATE TRIGGER cb_fichas_unidas_na_trilha
  AFTER INSERT ON public.cb_fichas_unidas
  FOR EACH ROW EXECUTE FUNCTION public.cb_log_fichas_unidas();

-- ------------------------------------------------------------
-- 4) Peças da união — internas (sem EXECUTE para ninguém de fora: só as
--    duas RPCs, que rodam como dono, as chamam)
-- ------------------------------------------------------------

-- 4.1 O que impede unir. Lista vazia = pode.
CREATE OR REPLACE FUNCTION public.cb_bloqueios_da_uniao(p_fica uuid, p_sai uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN f.instagram_id IS NOT NULL OR s.instagram_id IS NOT NULL THEN 'instagram' END,
    CASE WHEN f.wa_user_id IS NOT NULL AND s.wa_user_id IS NOT NULL
              AND f.wa_user_id <> s.wa_user_id THEN 'bsuid_diferentes' END
  ], NULL)
    FROM contacts f, contacts s
   WHERE f.id = p_fica AND s.id = p_sai
$$;

-- 4.2 Qual ficha o sistema sugere manter (D6): a que tem mensagem do
-- cliente; entre as duas, a mais RECENTE; sem mensagem, a mais mexida; por
-- fim a mais nova. Devolve a ficha e o motivo (a tela o explica).
CREATE OR REPLACE FUNCTION public.cb_ficha_sugerida_da_uniao(
  p_a uuid,
  p_b uuid,
  OUT ficha uuid,
  OUT motivo text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH fichas AS (
    SELECT c.id, c.created_at,
           (SELECT max(m.created_at)
              FROM conversations v
              JOIN messages m ON m.conversation_id = v.id
             WHERE v.contact_id = c.id
               AND m.sender_type = 'customer'
               AND m.deleted_at IS NULL) AS ultima_do_cliente,
           greatest(c.updated_at,
                    (SELECT max(v.last_message_at) FROM conversations v WHERE v.contact_id = c.id)) AS ultima_atividade
      FROM contacts c
     WHERE c.id IN (p_a, p_b)
  ),
  ordem AS (
    SELECT f.*, row_number() OVER (
             ORDER BY f.ultima_do_cliente DESC NULLS LAST,
                      f.ultima_atividade DESC NULLS LAST,
                      f.created_at DESC NULLS LAST,
                      f.id) AS pos,
           count(f.ultima_do_cliente) OVER () AS com_mensagem
      FROM fichas f
  )
  SELECT o.id,
         CASE WHEN o.ultima_do_cliente IS NOT NULL THEN 'mensagem_do_cliente'
              WHEN o.com_mensagem = 0 AND o.ultima_atividade IS NOT NULL THEN 'atividade'
              ELSE 'mais_nova' END
    FROM ordem o
   WHERE o.pos = 1
$$;

-- 4.3 O destino de cada card das duas fichas (D7). `fica`: card da ficha
-- que fica, intocado; `move`: card da que sai, passa inteiro; `apaga`: num
-- funil em que as DUAS têm card, todos menos o mais avançado — a história
-- vai para `fica_no_lugar`.
-- Mais avançado: ganho > aberto > perdido; depois o degrau do funil de
-- eficiência (975/1054; perda e etapa sem degrau abaixo de qualquer
-- degrau); depois a posição; empate: o card da ficha que fica.
CREATE OR REPLACE FUNCTION public.cb_cards_da_uniao(p_fica uuid, p_sai uuid)
RETURNS TABLE (
  deal_id uuid,
  da_ficha text,
  pipeline_id uuid,
  acao text,
  fica_no_lugar uuid
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH cards AS (
    SELECT d.id, d.pipeline_id, d.status, d.updated_at,
           CASE WHEN d.contact_id = p_fica THEN 'fica' ELSE 'sai' END AS da_ficha,
           s.position,
           CASE s.degrau
             WHEN 'lead' THEN 0 WHEN 'mql' THEN 1 WHEN 'reuniao' THEN 2
             WHEN 'proposta' THEN 3 WHEN 'contrato' THEN 4 WHEN 'pasta' THEN 5
             WHEN 'perda' THEN -2 ELSE -1
           END AS degrau
      FROM deals d
      JOIN pipeline_stages s ON s.id = d.stage_id
     WHERE d.contact_id IN (p_fica, p_sai)
  ),
  disputados AS (
    SELECT c.pipeline_id FROM cards c GROUP BY c.pipeline_id HAVING count(DISTINCT c.da_ficha) = 2
  ),
  ranqueados AS (
    SELECT c.*,
           (c.pipeline_id IN (SELECT x.pipeline_id FROM disputados x)) AS disputado,
           row_number() OVER w AS pos,
           first_value(c.id) OVER w AS melhor
      FROM cards c
    WINDOW w AS (
      PARTITION BY c.pipeline_id
      ORDER BY CASE c.status WHEN 'won' THEN 3 WHEN 'lost' THEN 1 ELSE 2 END DESC,
               c.degrau DESC,
               c.position DESC NULLS LAST,
               (c.da_ficha = 'fica') DESC,
               c.updated_at DESC NULLS LAST,
               c.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
  )
  SELECT r.id, r.da_ficha, r.pipeline_id,
         CASE WHEN r.disputado AND r.pos > 1 THEN 'apaga'
              WHEN r.da_ficha = 'fica' THEN 'fica'
              ELSE 'move' END,
         CASE WHEN r.disputado AND r.pos > 1 THEN r.melhor END
    FROM ranqueados r
$$;

-- 4.4 Os valores que NÃO cabem numa ficha só: nome e empresa das duas
-- preenchidos e diferentes, e cada campo personalizado com valor nas duas
-- (menos o campo espelhado do e-mail, 1000: o e-mail vira contato antigo).
-- O NOME segue a regra da união (4.5): o "ficou" é o nome final.
CREATE OR REPLACE FUNCTION public.cb_nome_da_uniao(p_fica public.contacts, p_sai public.contacts)
RETURNS TABLE (nome text, nome_fixado_em timestamptz)
LANGUAGE sql
IMMUTABLE
AS $$
  -- Fica o nome da que fica, salvo: (a) ele não identifica ninguém (vazio,
  -- só número, "Novo contato" não ocorre em ficha); (b) só o da que sai foi
  -- FIXADO por gente (999: cadastro, Calendly, Asaas) — nome escrito vence
  -- o apelido do WhatsApp.
  SELECT CASE
           WHEN coalesce(btrim(p_sai.name), '') !~ '[[:alpha:]]' THEN p_fica.name
           WHEN coalesce(btrim(p_fica.name), '') !~ '[[:alpha:]]' THEN p_sai.name
           WHEN p_fica.nome_fixado_em IS NULL AND p_sai.nome_fixado_em IS NOT NULL THEN p_sai.name
           ELSE p_fica.name
         END,
         CASE
           WHEN coalesce(btrim(p_sai.name), '') !~ '[[:alpha:]]' THEN p_fica.nome_fixado_em
           WHEN coalesce(btrim(p_fica.name), '') !~ '[[:alpha:]]' THEN p_sai.nome_fixado_em
           WHEN p_fica.nome_fixado_em IS NULL AND p_sai.nome_fixado_em IS NOT NULL THEN p_sai.nome_fixado_em
           ELSE p_fica.nome_fixado_em
         END
$$;

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
         SELECT 3, cf.field_name, 'campo', cf.id, vf.value, vs.value
           FROM contact_custom_values vs
           JOIN contact_custom_values vf ON vf.contact_id = p_fica AND vf.custom_field_id = vs.custom_field_id
           JOIN custom_fields cf ON cf.id = vs.custom_field_id
          WHERE vs.contact_id = p_sai
            AND cf.espelho IS NULL
            AND coalesce(btrim(vs.value), '') <> '' AND coalesce(btrim(vf.value), '') <> ''
            AND btrim(vs.value) <> btrim(vf.value)
       )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'campo', i.campo, 'campo_id', i.campo_id, 'rotulo', i.rotulo,
           'ficou', i.ficou, 'saiu', i.saiu) ORDER BY i.ordem, i.rotulo), '[]'::jsonb)
    FROM itens i
$$;

-- 4.5 Telefone e e-mail da ficha que sai que viram CONTATO ANTIGO (D9): os
-- que ela tinha e a que fica não tem igual. O telefone vai pela CANÔNICA.
-- (Quando a que fica não tem telefone nenhum, o da que sai PASSA a ser o
-- dela — e não vira antigo.)
CREATE OR REPLACE FUNCTION public.cb_contatos_antigos_da_uniao(p_fica uuid, p_sai uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.ordem), '[]'::jsonb)
    FROM contacts f, contacts s,
         LATERAL (
           SELECT 1 AS ordem, jsonb_build_object('tipo', 'telefone', 'valor', s.telefone_canonico) AS item
            WHERE coalesce(s.telefone_canonico, '') <> ''
              AND coalesce(f.telefone_canonico, '') <> ''
              AND s.telefone_canonico <> f.telefone_canonico
           UNION ALL
           SELECT 2, jsonb_build_object('tipo', 'email', 'valor', lower(btrim(s.email)))
            WHERE coalesce(btrim(s.email), '') <> ''
              AND coalesce(btrim(f.email), '') <> ''
              AND lower(btrim(s.email)) <> lower(btrim(f.email))
         ) x
   WHERE f.id = p_fica AND s.id = p_sai
$$;

-- ------------------------------------------------------------
-- 5) A PRÉVIA — o que a união vai fazer, sem gravar nada
-- ------------------------------------------------------------
-- SECURITY DEFINER com a MESMA porta da união (admin da conta, sem
-- suspensão): a prévia conta mensagens, automações e cards que a RLS de quem
-- olha talvez não mostre (perfil restrito), e só quem pode unir a vê.
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
      'automacoes_interrompidas', (
        SELECT count(*) FROM automation_logs l
         WHERE l.account_id = v_conta AND l.contact_id = p_sai
           AND l.finalizado_em IS NULL AND l.interrompida_em IS NULL),
      'robos_parados', (
        SELECT count(*) FROM flow_runs r
         WHERE r.account_id = v_conta AND r.contact_id = p_sai AND r.status = 'active')
    )
  );
END;
$$;

-- ------------------------------------------------------------
-- 6) A UNIÃO — uma transação; ou tudo, ou nada
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
  v_logs uuid[];
  v_n integer;
  v_resumo jsonb := '{}'::jsonb;
  v_mais_recente boolean;
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

  -- ── 2. Travas: as duas fichas em ordem de id (duas uniões cruzadas não
  -- fecham ciclo), depois as conversas delas ──
  PERFORM 1 FROM contacts c WHERE c.id IN (p_fica, p_sai) ORDER BY c.id FOR UPDATE;
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

  PERFORM 1 FROM conversations c WHERE c.contact_id IN (p_fica, p_sai) ORDER BY c.id FOR UPDATE;
  SELECT * INTO v_conv_fica FROM conversations WHERE contact_id = p_fica;
  SELECT * INTO v_conv_sai FROM conversations WHERE contact_id = p_sai;

  -- ── 3. A foto da que sai e o que não cabe numa ficha só — ANTES de mexer ──
  v_foto := jsonb_build_object(
    'ficha', jsonb_build_object(
      'id', v_sai.id, 'nome', v_sai.name, 'telefone', v_sai.phone, 'email', v_sai.email,
      'empresa', v_sai.company, 'criada_em', v_sai.created_at,
      'wa_username', v_sai.wa_username, 'nome_fixado_em', v_sai.nome_fixado_em),
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
    'conversa', CASE WHEN v_conv_sai.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_conv_sai.id, 'status', v_conv_sai.status, 'criada_em', v_conv_sai.created_at,
      'canal', v_conv_sai.channel_id, 'responsavel', v_conv_sai.assigned_agent_id) END
  );
  v_divergencias := cb_divergencias_da_uniao(p_fica, p_sai);
  v_antigos := cb_contatos_antigos_da_uniao(p_fica, p_sai);
  SELECT * INTO v_nome FROM cb_nome_da_uniao(v_fica, v_sai);

  -- ── 4. D8: as automações em curso da que SAI terminam ──
  -- A marca durável (1005), a mesma dos outros cancelamentos: a retomada e o
  -- estacionamento a leem; a falha ADIADA ganha a hora de fim (como
  -- `marcarExecucoesInterrompidas`).
  WITH marcadas AS (
    UPDATE automation_logs l
       SET interrompida_em = now(),
           interrompida_por = 'fusao',
           finalizado_em = CASE WHEN l.desfecho = 'falhou' THEN now() ELSE l.finalizado_em END
     WHERE l.account_id = v_conta AND l.contact_id = p_sai
       AND l.finalizado_em IS NULL AND l.interrompida_em IS NULL
    RETURNING l.id
  )
  SELECT coalesce(array_agg(id), '{}') INTO v_logs FROM marcadas;
  v_resumo := v_resumo || jsonb_build_object('automacoes_interrompidas', cardinality(v_logs));

  UPDATE automation_pending_executions e
     SET status = 'cancelled'
   WHERE e.account_id = v_conta AND e.status = 'pending'
     AND (e.contact_id = p_sai OR e.log_id = ANY (v_logs));

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
    -- Só a que sai tinha: a conversa inteira passa, com tudo dentro.
    UPDATE conversations SET contact_id = p_fica WHERE id = v_conv_sai.id;
    v_conversa := v_conv_sai.id;
    v_resumo := v_resumo || jsonb_build_object('conversa', 'passou');
  ELSIF v_conv_sai.id IS NOT NULL THEN
    v_conversa := v_conv_fica.id;
    -- O agente de IA da que sai para (D8): o turno pendente responderia por
    -- uma conversa que não existe mais.
    UPDATE cb_ia_turnos t
       SET status = 'descartado', erro = 'fichas unidas', terminado_em = now(), updated_at = now()
     WHERE t.conversation_id = v_conv_sai.id AND t.status IN ('aguardando', 'rodando');

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

    -- O estado da conversa que fica. A que sai estava ABERTA e a que fica
    -- encerrada: a conversa reabre com a situação e o responsável da que
    -- sai (a trilha da 1083 grava "reaberta" por quem uniu). As não lidas
    -- somam; a prévia é a da mais recente; o canal segue a mais recente,
    -- salvo canal FIXADO na que fica; a janela da Meta (993) fica com o
    -- maior carimbo de cada número.
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
           janela_meta = (
             SELECT coalesce(jsonb_object_agg(j.chave, to_jsonb(j.maior)), '{}'::jsonb)
               FROM (SELECT t.key AS chave, max(t.value::timestamptz) AS maior
                       FROM (SELECT * FROM jsonb_each_text(c.janela_meta)
                             UNION ALL
                             SELECT * FROM jsonb_each_text(v_conv_sai.janela_meta)) t
                      GROUP BY t.key) j),
           created_at = least(c.created_at, v_conv_sai.created_at)
     WHERE c.id = v_conv_fica.id;

    -- A espera (972) recalculada sobre as mensagens juntas — a fórmula da
    -- mensagem apagada (1080): 1ª fala de cliente depois da última resposta
    -- de gente ou do agente de IA que SAIU.
    UPDATE conversations c
       SET aguardando_desde = (
         SELECT min(m.created_at)
           FROM messages m
          WHERE m.conversation_id = c.id
            AND m.sender_type = 'customer'
            AND m.deleted_at IS NULL
            AND m.created_at > coalesce((
              SELECT max(h.created_at)
                FROM messages h
               WHERE h.conversation_id = c.id
                 AND ((h.sender_type = 'agent' AND (h.sender_id IS NOT NULL OR h.from_device))
                      OR (h.sender_type = 'bot' AND h.ia_agente_id IS NOT NULL))
                 AND h.deleted_at IS NULL
                 AND NOT h.nao_saiu
            ), '-infinity'::timestamptz))
     WHERE c.id = v_conv_fica.id AND c.status <> 'closed';
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
  -- ou liga a ficha a si mesma → fica para o CASCADE; a descrição que só o
  -- da que sai tinha passa ao da que fica.
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
  -- ambiente, a que fica mantém o seu e o da que sai fica sem ficha (SET NULL).
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
  -- `contacts_identidade_ck` não deixam antes) ──
  UPDATE contacts c
     SET phone = CASE WHEN c.phone IS NULL THEN v_sai.phone ELSE c.phone END,
         wa_user_id = coalesce(c.wa_user_id, v_sai.wa_user_id),
         wa_username = CASE WHEN c.wa_user_id IS NULL THEN coalesce(c.wa_username, v_sai.wa_username) ELSE c.wa_username END,
         wa_parent_user_id = CASE WHEN c.wa_user_id IS NULL THEN coalesce(c.wa_parent_user_id, v_sai.wa_parent_user_id) ELSE c.wa_parent_user_id END
   WHERE c.id = p_fica
     AND ((c.phone IS NULL AND v_sai.phone IS NOT NULL)
          OR (c.wa_user_id IS NULL AND v_sai.wa_user_id IS NOT NULL));

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
-- 7) Os cadastros procuram pelos contatos antigos (D9)
-- ------------------------------------------------------------
-- Chamada só pelo servidor (service role), DEPOIS da busca normal pelo
-- telefone e pelo e-mail não achar ninguém. ⚠️ Exige o MESMO primeiro nome
-- (`cb_primeiro_nome`, 1088): o número digitado errado que virou contato
-- antigo pode ser de OUTRA pessoa, e o formulário dela cairia nesta ficha.
-- Sem nome, ou nome diferente, nada — a ficha nova nasce e o aviso da 1088
-- (sinal 4) a mostra ao lado desta.
CREATE OR REPLACE FUNCTION public.cb_ficha_por_contato_antigo(
  p_conta uuid,
  p_telefone_canonico text,
  p_email text,
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
     AND ((a.tipo = 'telefone' AND a.valor = nullif(btrim(p_telefone_canonico), ''))
          OR (a.tipo = 'email' AND a.valor = nullif(lower(btrim(p_email)), '')))
     AND cb_primeiro_nome(c.name) IS NOT NULL
     AND cb_primeiro_nome(c.name) = cb_primeiro_nome(p_nome)
   ORDER BY (a.tipo = 'telefone') DESC, a.created_at DESC
   LIMIT 1
$$;

-- ------------------------------------------------------------
-- 8) O aviso (1088) ganha o sinal 4: contato de uma ficha unida
-- ------------------------------------------------------------
-- Nos dois sentidos: o telefone/e-mail DESTA ficha é contato antigo de
-- outra; ou o de outra é contato antigo desta. Sem primeiro nome: o valor
-- já foi da pessoa, e o aviso é só para o admin conferir. As peças da
-- 1089/1090 ficam como estão (cercas MATERIALIZED, igualdade para o índice).
CREATE OR REPLACE FUNCTION public.cb_possiveis_duplicatas(p_contato uuid)
RETURNS TABLE (outro_id uuid, motivos jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH eu AS MATERIALIZED (
    SELECT c.id,
           c.account_id,
           c.created_at,
           c.created_at - interval '2 minutes' AS janela_de,
           c.created_at + interval '2 minutes' AS janela_ate,
           (SELECT count(*)
              FROM (SELECT 1
                      FROM public.contacts x
                     WHERE x.account_id = c.account_id
                       AND x.created_at BETWEEN c.created_at - interval '1 minute'
                                            AND c.created_at + interval '1 minute'
                     LIMIT 11) AS t) AS em_volta,
           nullif(lower(btrim(c.email)), '') AS email,
           nullif(c.telefone_canonico, '') AS telefone,
           public.cb_primeiro_nome(c.name) AS nome,
           public.cb_vizinhos_do_telefone(nullif(c.telefone_canonico, '')) AS vizinhos
      FROM public.contacts c
     WHERE c.id = p_contato
  ),
  por_email AS (
    SELECT o.id, 1 AS ordem, jsonb_build_object('tipo', 'mesmo_email') AS motivo
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.id <> eu.id
       AND o.email IS NOT NULL
       AND lower(btrim(o.email)) = eu.email
     WHERE eu.email IS NOT NULL
       AND (SELECT count(*)
              FROM public.contacts x
             WHERE x.account_id = eu.account_id
               AND x.email IS NOT NULL
               AND lower(btrim(x.email)) = eu.email) <= 3
  ),
  vizinhas AS MATERIALIZED (
    SELECT o.id, o.name
      FROM eu
      CROSS JOIN LATERAL unnest(eu.vizinhos) AS v(tel)
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.telefone_canonico <> ''
       AND o.telefone_canonico = v.tel
     WHERE eu.nome IS NOT NULL
  ),
  por_telefone AS (
    SELECT v.id, 2 AS ordem, jsonb_build_object('tipo', 'telefone_parecido') AS motivo
      FROM vizinhas v
      CROSS JOIN eu
     WHERE v.id <> eu.id
       AND public.cb_primeiro_nome(v.name) = eu.nome
  ),
  da_mesma_hora AS MATERIALIZED (
    SELECT o.id, o.name, o.created_at
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.created_at BETWEEN eu.janela_de AND eu.janela_ate
     WHERE eu.nome IS NOT NULL
       AND eu.em_volta <= 10
  ),
  por_horario AS (
    SELECT h.id,
           3 AS ordem,
           jsonb_build_object(
             'tipo', 'criadas_juntas',
             'segundos', round(abs(extract(epoch FROM h.created_at - eu.created_at)))::int
           ) AS motivo
      FROM da_mesma_hora h
      CROSS JOIN eu
     WHERE h.id <> eu.id
       AND public.cb_primeiro_nome(h.name) = eu.nome
       AND (SELECT count(*)
              FROM (SELECT 1
                      FROM public.contacts x
                     WHERE x.account_id = eu.account_id
                       AND x.created_at BETWEEN least(eu.created_at, h.created_at) - interval '1 minute'
                                            AND greatest(eu.created_at, h.created_at) + interval '1 minute'
                     LIMIT 11) AS t) <= 10
  ),
  -- 1092: o telefone/e-mail desta ficha é contato ANTIGO de outra.
  antigo_de_outra AS (
    SELECT a.contact_id AS id, 4 AS ordem, jsonb_build_object('tipo', 'contato_antigo') AS motivo
      FROM eu
      JOIN public.cb_contatos_antigos a
        ON a.account_id = eu.account_id
       AND ((a.tipo = 'telefone' AND a.valor = eu.telefone)
            OR (a.tipo = 'email' AND a.valor = eu.email))
     WHERE a.contact_id <> eu.id
  ),
  -- 1092: os contatos antigos DESTA ficha são o telefone/e-mail de outra.
  meus_antigos AS MATERIALIZED (
    SELECT a.tipo, a.valor
      FROM eu
      JOIN public.cb_contatos_antigos a ON a.contact_id = eu.id
  ),
  antigo_meu AS (
    SELECT o.id, 4 AS ordem, jsonb_build_object('tipo', 'contato_antigo') AS motivo
      FROM meus_antigos m
      CROSS JOIN eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.telefone_canonico <> ''
       AND o.telefone_canonico = m.valor
     WHERE m.tipo = 'telefone' AND o.id <> eu.id
    UNION ALL
    SELECT o.id, 4, jsonb_build_object('tipo', 'contato_antigo')
      FROM meus_antigos m
      CROSS JOIN eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.email IS NOT NULL
       AND lower(btrim(o.email)) = m.valor
     WHERE m.tipo = 'email' AND o.id <> eu.id
  ),
  sinais AS (
    SELECT * FROM por_email
    UNION ALL SELECT * FROM por_telefone
    UNION ALL SELECT * FROM por_horario
    UNION ALL SELECT * FROM antigo_de_outra
    UNION ALL SELECT * FROM antigo_meu
  ),
  -- O mesmo sinal 4 pode chegar pelo telefone E pelo e-mail: um motivo só.
  unicos AS (
    SELECT DISTINCT ON (s.id, s.motivo) s.id, s.ordem, s.motivo FROM sinais s
  )
  SELECT s.id AS outro_id,
         jsonb_agg(s.motivo ORDER BY s.ordem) AS motivos
    FROM unicos s
    CROSS JOIN eu
   WHERE NOT EXISTS (
           SELECT 1 FROM public.cb_duplicatas_descartadas d
            WHERE d.contato_menor = least(eu.id, s.id)
              AND d.contato_maior = greatest(eu.id, s.id)
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.cb_contatos_relacionados r
            WHERE least(r.contact_a_id, r.contact_b_id) = least(eu.id, s.id)
              AND greatest(r.contact_a_id, r.contact_b_id) = greatest(eu.id, s.id)
         )
   GROUP BY s.id
   ORDER BY min(s.ordem), s.id
$$;

-- ------------------------------------------------------------
-- 9) Quem executa o quê
-- ------------------------------------------------------------
-- As peças internas: ninguém de fora (as RPCs rodam como dono).
REVOKE EXECUTE ON FUNCTION public.cb_bloqueios_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ficha_sugerida_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_cards_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_nome_da_uniao(public.contacts, public.contacts) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_divergencias_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_contatos_antigos_da_uniao(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_log_fichas_unidas() FROM PUBLIC, anon, authenticated;
-- As duas RPCs da tela: a porta de admin é por dentro.
REVOKE EXECUTE ON FUNCTION public.cb_previa_da_uniao(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_unir_fichas(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_previa_da_uniao(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cb_unir_fichas(uuid, uuid) TO authenticated;
-- A busca dos cadastros: só o servidor.
REVOKE EXECUTE ON FUNCTION public.cb_ficha_por_contato_antigo(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ficha_por_contato_antigo(uuid, text, text, text) TO service_role;
-- O aviso: como na 1088.
REVOKE EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 10) Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_conta uuid;
  v_dono uuid;
  v_funil uuid;
  v_etapa uuid;
  v_fica uuid;
  v_sai uuid;
  v_conv_fica uuid;
  v_conv_sai uuid;
  v_ret jsonb;
  v_n integer;
  v_tel text;
BEGIN
  -- 10.1 Os CHECKs aceitam os valores novos.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.automation_logs'::regclass AND conname = 'automation_logs_interrompida_por_check';
  IF v_def IS NULL OR v_def NOT LIKE '%fusao%' THEN
    RAISE EXCEPTION '1092: interrompida_por não aceita fusao: %', v_def;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.cb_lead_events'::regclass AND conname = 'cb_lead_events_event_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%contacts_merged%' THEN
    RAISE EXCEPTION '1092: a trilha não aceita contacts_merged: %', v_def;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.cb_lead_events'::regclass AND conname = 'cb_lead_events_shape';
  IF v_def IS NULL OR v_def NOT LIKE '%contacts_merged%' THEN
    RAISE EXCEPTION '1092: o CHECK de forma não conhece contacts_merged: %', v_def;
  END IF;

  -- 10.2 As portas: o navegador só lê as tabelas novas e só chama as RPCs.
  IF has_table_privilege('anon', 'public.cb_fichas_unidas', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_contatos_antigos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_fichas_unidas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_contatos_antigos', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.cb_fichas_unidas', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_contatos_antigos', 'SELECT') THEN
    RAISE EXCEPTION '1092: privilégios das tabelas novas fora do lugar';
  END IF;
  IF has_function_privilege('anon', 'public.cb_unir_fichas(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_cards_da_uniao(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ficha_por_contato_antigo(uuid, text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_unir_fichas(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_previa_da_uniao(uuid, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cb_ficha_por_contato_antigo(uuid, text, text, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_possiveis_duplicatas(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1092: EXECUTE das funções fora do lugar';
  END IF;

  -- 10.3 O aviso continua respondendo (a ficha mais nova da base).
  PERFORM 1 FROM public.cb_possiveis_duplicatas(
    (SELECT c.id FROM public.contacts c ORDER BY c.created_at DESC NULLS LAST LIMIT 1));

  -- 10.4 A UNIÃO de verdade, num par FICTÍCIO, desfeita no fim (SQLSTATE
  -- próprio — nunca WHEN OTHERS, que engoliria o erro). O corpo de plpgsql
  -- só é analisado quando roda. Banco vazio (replay): nada a provar.
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
    JOIN public.profiles p ON p.user_id = a.owner_user_id AND p.account_id = a.id
   WHERE p.suspenso_em IS NULL
   ORDER BY a.created_at
   LIMIT 1;
  SELECT s.pipeline_id, s.id INTO v_funil, v_etapa
    FROM public.pipeline_stages s JOIN public.pipelines pl ON pl.id = s.pipeline_id
   WHERE pl.account_id = v_conta
   ORDER BY s.position LIMIT 1;
  IF v_conta IS NULL OR v_etapa IS NULL THEN
    RAISE NOTICE '1092: banco vazio, a união não foi exercitada.';
  ELSE
    BEGIN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', v_dono::text, true);
      -- Telefones fictícios fora de qualquer faixa real (DDD 00).
      v_tel := '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0');
      INSERT INTO public.contacts (user_id, account_id, phone, name, email)
      VALUES (v_dono, v_conta, v_tel, 'Fulano Conferencia 1092', 'conferencia-1092@exemplo.invalid')
      RETURNING id INTO v_fica;
      INSERT INTO public.contacts (user_id, account_id, phone, name)
      VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano C.')
      RETURNING id INTO v_sai;
      INSERT INTO public.conversations (user_id, account_id, contact_id, status)
      VALUES (v_dono, v_conta, v_fica, 'closed') RETURNING id INTO v_conv_fica;
      INSERT INTO public.conversations (user_id, account_id, contact_id, status)
      VALUES (v_dono, v_conta, v_sai, 'open') RETURNING id INTO v_conv_sai;
      INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text)
      VALUES (v_conv_sai, 'customer', 'text', 'oi');
      INSERT INTO public.deals (user_id, account_id, pipeline_id, stage_id, contact_id, title, value, source)
      VALUES (v_dono, v_conta, v_funil, v_etapa, v_fica, 'Fulano Conferencia 1092', 0, 'manual'),
             (v_dono, v_conta, v_funil, v_etapa, v_sai, 'Fulano C.', 10, 'manual');

      v_ret := public.cb_previa_da_uniao(v_fica, v_sai);
      IF jsonb_array_length(v_ret -> 'cards') <> 2 THEN
        RAISE EXCEPTION '1092: a prévia não viu os dois cards: %', v_ret;
      END IF;

      v_ret := public.cb_unir_fichas(v_fica, v_sai);

      IF EXISTS (SELECT 1 FROM public.contacts WHERE id = v_sai)
         OR EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv_sai) THEN
        RAISE EXCEPTION '1092: a ficha ou a conversa que sai ficou de pé';
      END IF;
      SELECT count(*) INTO v_n FROM public.messages WHERE conversation_id = v_conv_fica;
      IF v_n <> 1 THEN
        RAISE EXCEPTION '1092: a mensagem não passou para a conversa que fica (%)', v_n;
      END IF;
      SELECT count(*) INTO v_n FROM public.deals WHERE contact_id = v_fica;
      IF v_n <> 1 OR NOT EXISTS (SELECT 1 FROM public.deals WHERE contact_id = v_fica AND value = 10) THEN
        RAISE EXCEPTION '1092: os cards do mesmo funil não viraram um só com o valor';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv_fica AND status = 'open') THEN
        RAISE EXCEPTION '1092: a conversa encerrada não reabriu com a aberta';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.cb_contatos_antigos WHERE contact_id = v_fica AND tipo = 'telefone') THEN
        RAISE EXCEPTION '1092: o telefone da que saiu não virou contato antigo';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.cb_lead_events
                      WHERE contact_id = v_fica AND event_type = 'contacts_merged') THEN
        RAISE EXCEPTION '1092: a união não apareceu na trilha';
      END IF;
      IF public.cb_ficha_por_contato_antigo(
           v_conta,
           (SELECT valor FROM public.cb_contatos_antigos WHERE contact_id = v_fica AND tipo = 'telefone'),
           NULL, 'Fulano') IS DISTINCT FROM v_fica THEN
        RAISE EXCEPTION '1092: o contato antigo não encontra a ficha que ficou';
      END IF;

      RAISE EXCEPTION USING ERRCODE = 'P1092', MESSAGE = 'desfaz a conferência';
    EXCEPTION WHEN SQLSTATE 'P1092' THEN
      RAISE NOTICE '1092: união conferida num par fictício (desfeita).';
    END;
  END IF;
END $$;
