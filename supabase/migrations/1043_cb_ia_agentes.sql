-- 1043_cb_ia_agentes.sql
--
-- F1b do plano dos agentes de IA (docs/PLANO-agentes-de-ia.md, 5.2): a conta
-- passa a ter VÁRIOS agentes, cada um com instruções e regras (D23), provedor
-- e modelo (D1), conexões, horário, teto e o destino da transferência. Nesta
-- fase nenhum agente responde cliente: eles são criados, testados no
-- Playground e medidos no uso. A chave é a do PROVEDOR (`cb_ia_chaves`, 1042).
--
-- O que faz:
--  1. `cb_ia_agentes`:
--     - `conexoes uuid[]`: VAZIO = NENHUMA conexão (a exceção deliberada à
--       convenção "vazio = todos", como o `radar_enabled`: é dado de cliente
--       indo a provedor externo, e há número de uso pessoal na conta).
--     - `regras text[]`: cada item uma regra (D23); vazio = nenhuma.
--     - `horario jsonb`: nulo = sempre; a forma é validada no app.
--     - `arquivado_em`: apagar é ARQUIVAR — o uso e os turnos antigos mantêm
--       o nome. O nome é único por conta entre os NÃO arquivados, sem
--       distinguir maiúsculas.
--     - `transferir_para`: membro humano (`auth.users.id`) que recebe a
--       transferência; nulo = fila sem responsável. SET NULL ao apagar o
--       login, como toda autoria.
--     - `UNIQUE (id, account_id)`: alvo das FKs COMPOSTAS das fases seguintes
--       (conversa e conexão apontam para o agente da MESMA conta).
--     Leitura só para ADMINISTRADOR (D14, na forma da 1032). Escrita só pela
--     rota (service role): nenhum GRANT de escrita a `authenticated`.
--  2. Apagar uma CONEXÃO tira o id dela de `conexoes` de todo agente
--     (gatilho, no molde de `cb_drop_channel_from_automations`, 903), e
--     ARQUIVAR um agente o tira de `pode_passar_para` dos outros (gatilho,
--     num UPDATE só: ler e regravar o array pelo app perderia uma edição
--     concorrente — revisão da F1b).
--  3. `ai_usage_log`: `ia_agente_id` (SET NULL) + `ia_agente_nome`
--     (congelado — a regra dos rótulos da 912) e o `mode` ganha `agente` e
--     `agente_teste` (o Playground, D13). ⚠️ O CHECK ANTES do código: sem ele o
--     insert falha e `logAiUsage` engole o erro — o custo some em silêncio.
--  4. `ai_configs.cotacao_dolar` (D21): R$ por US$, com o IOF do cartão.
--     Nula = custo não calculado.
--  5. `ai_configs.radar_model` materializado onde é nulo (= `model`): o Radar
--     herdava o modelo do assistente, e a tela de Agentes deixa de editá-lo.
--  6. `cb_ia_uso`: a soma do uso no BANCO (a rota antiga lia linhas e o
--     PostgREST cortava em 1000 sem avisar).
--  7. A leitura de `ai_configs` passa a ser só de ADMINISTRADOR (Codex, #295):
--     a linha guarda o `system_prompt` do assistente legado, e a regra da 0029
--     deixava qualquer membro lê-lo direto pelo PostgREST — a rota esconder o
--     campo não fechava nada. Quem não é admin e precisa da configuração (a
--     faixa de IA da conversa e o rascunho) lê pelo SERVIDOR, com a conta
--     conferida na sessão.
--
-- ⚠️ ORDEM: aplicar DEPOIS de a F1a estar em produção e ANTES do deploy da
-- F1b. A regra de leitura só-de-admin do item 7 (Codex, #295) supõe que a faixa
-- de IA da conversa e o rascunho já leem `ai_configs` pelo SERVIÇO — é o
-- código da F1a; com o app anterior a ela, todo membro que não é admin veria a
-- IA como "não configurada" até o deploy. O resto da migration é aditivo.
-- Idempotente. `anon` sem nada;
-- `service_role` com tudo, POR ESCRITO.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) Agentes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_ia_agentes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  nome             text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 80),
  descricao        text NOT NULL DEFAULT '' CHECK (char_length(descricao) <= 1000),
  instrucoes       text NOT NULL DEFAULT '' CHECK (char_length(instrucoes) <= 20000),
  regras           text[] NOT NULL DEFAULT '{}',
  provedor         text NOT NULL CHECK (provedor IN ('openai', 'anthropic', 'gemini')),
  modelo           text NOT NULL CHECK (btrim(modelo) <> ''),
  ativo            boolean NOT NULL DEFAULT false,
  conexoes         uuid[] NOT NULL DEFAULT '{}',
  horario          jsonb,
  teto_respostas   integer NOT NULL DEFAULT 10 CHECK (teto_respostas BETWEEN 1 AND 100),
  acesso           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ferramentas      jsonb NOT NULL DEFAULT '{}'::jsonb,
  pode_passar_para uuid[] NOT NULL DEFAULT '{}',
  transferir_para  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  arquivado_em     timestamptz,
  criado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  atualizado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_ia_agentes_id_conta_key UNIQUE (id, account_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cb_ia_agentes_nome_vivo_idx
  ON cb_ia_agentes (account_id, lower(btrim(nome)))
  WHERE arquivado_em IS NULL;

CREATE INDEX IF NOT EXISTS cb_ia_agentes_conta_idx ON cb_ia_agentes (account_id);

ALTER TABLE cb_ia_agentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_ia_agentes_select ON cb_ia_agentes;
CREATE POLICY cb_ia_agentes_select ON cb_ia_agentes FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum))));

REVOKE ALL ON TABLE cb_ia_agentes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_ia_agentes TO authenticated;
GRANT ALL ON TABLE cb_ia_agentes TO service_role;

-- ---------------------------------------------------------------------------
-- 2) Conexão apagada sai das conexões dos agentes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_tira_conexao_dos_agentes_de_ia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Esvaziar NÃO vira curinga aqui: `conexoes` vazio já quer dizer "nenhuma".
  UPDATE cb_ia_agentes
     SET conexoes = array_remove(conexoes, OLD.id),
         updated_at = now()
   WHERE account_id = OLD.account_id
     AND conexoes @> ARRAY[OLD.id];
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cb_channels_tira_dos_agentes_de_ia ON cb_channels;
CREATE TRIGGER cb_channels_tira_dos_agentes_de_ia
  BEFORE DELETE ON cb_channels
  FOR EACH ROW EXECUTE FUNCTION cb_tira_conexao_dos_agentes_de_ia();

-- Função de gatilho não é RPC: as duas metades do REVOKE (913/915).
REVOKE EXECUTE ON FUNCTION cb_tira_conexao_dos_agentes_de_ia() FROM PUBLIC, anon, authenticated;

-- Agente ARQUIVADO sai das listas "pode passar para" dos outros da conta.
-- O UPDATE de dentro não muda `arquivado_em` das outras linhas, então o
-- gatilho não se repete.
CREATE OR REPLACE FUNCTION cb_ia_agente_arquivado_sai_das_passagens()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.arquivado_em IS NULL AND NEW.arquivado_em IS NOT NULL THEN
    UPDATE cb_ia_agentes
       SET pode_passar_para = array_remove(pode_passar_para, NEW.id),
           updated_at = now()
     WHERE account_id = NEW.account_id
       AND pode_passar_para @> ARRAY[NEW.id];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_ia_agentes_arquivado_sai_das_passagens ON cb_ia_agentes;
CREATE TRIGGER cb_ia_agentes_arquivado_sai_das_passagens
  AFTER UPDATE OF arquivado_em ON cb_ia_agentes
  FOR EACH ROW EXECUTE FUNCTION cb_ia_agente_arquivado_sai_das_passagens();

REVOKE EXECUTE ON FUNCTION cb_ia_agente_arquivado_sai_das_passagens() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Uso por agente
-- ---------------------------------------------------------------------------
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS ia_agente_id uuid REFERENCES cb_ia_agentes(id) ON DELETE SET NULL;
ALTER TABLE ai_usage_log
  ADD COLUMN IF NOT EXISTS ia_agente_nome text;

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check CHECK (
    mode IN ('auto_reply', 'draft', 'radar', 'transcricao', 'agente', 'agente_teste')
  );

CREATE INDEX IF NOT EXISTS ai_usage_log_agente_idx
  ON ai_usage_log (account_id, ia_agente_id, created_at)
  WHERE ia_agente_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) e 5) A configuração dos módulos
-- ---------------------------------------------------------------------------
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS cotacao_dolar numeric
  CHECK (cotacao_dolar IS NULL OR (cotacao_dolar > 0 AND cotacao_dolar < 100));

UPDATE ai_configs
   SET radar_model = model
 WHERE channel_id IS NULL
   AND radar_model IS NULL
   AND model IS NOT NULL
   AND btrim(model) <> '';

-- 7) Só administrador lê a configuração (e o prompt) direto do banco. Na forma
-- da 1032 (a conta perguntada UMA vez por consulta), com o papel mínimo.
ALTER POLICY ai_configs_select ON public.ai_configs
 USING (
  (account_id = ANY (ARRAY( SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum))))
 );

-- ---------------------------------------------------------------------------
-- 6) A soma do uso no banco
-- ---------------------------------------------------------------------------
-- Uma linha por (dia local, modo, agente, provedor, modelo). O DIA é o do fuso
-- passado (o da tela), para as barras somarem o total. A rota chama com o
-- cliente de SERVIÇO depois de conferir que quem pede é admin da conta.
-- ⚠️ O PostgREST corta a resposta de uma RPC em 1000 linhas também: a rota
-- PAGINA (range + count) sobre uma ordem TOTAL (as cinco chaves do grupo) —
-- com a ordem só por dia e modo, a página seguinte poderia repetir ou pular
-- linhas (revisão da F1b).
CREATE OR REPLACE FUNCTION public.cb_ia_uso(
  p_account_id uuid,
  p_desde timestamptz,
  p_fuso text DEFAULT 'America/Sao_Paulo'
)
RETURNS TABLE (
  dia date,
  modo text,
  ia_agente_id uuid,
  ia_agente_nome text,
  provedor text,
  modelo text,
  chamadas bigint,
  tokens_entrada bigint,
  tokens_saida bigint,
  tokens_total bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT (l.created_at AT TIME ZONE p_fuso)::date AS dia,
         l.mode AS modo,
         l.ia_agente_id,
         max(l.ia_agente_nome) AS ia_agente_nome,
         l.provider AS provedor,
         l.model AS modelo,
         count(*)::bigint AS chamadas,
         coalesce(sum(l.prompt_tokens), 0)::bigint AS tokens_entrada,
         coalesce(sum(l.completion_tokens), 0)::bigint AS tokens_saida,
         coalesce(sum(l.total_tokens), 0)::bigint AS tokens_total
    FROM ai_usage_log l
   WHERE l.account_id = p_account_id
     AND l.created_at >= p_desde
   GROUP BY 1, 2, 3, 5, 6
   ORDER BY 1, 2, 3, 5, 6;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_uso(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_uso(uuid, timestamptz, text) TO service_role;
-- A função é INVOKER: quem a chama precisa ler a tabela.
GRANT SELECT ON TABLE ai_usage_log TO service_role;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo, privilégios e uma chamada).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.cb_ia_agentes') IS NULL THEN
    RAISE EXCEPTION '1043: cb_ia_agentes ausente';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_agentes', 'SELECT') THEN
    RAISE EXCEPTION '1043: anon lê cb_ia_agentes';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_ia_agentes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_ia_agentes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_ia_agentes', 'DELETE') THEN
    RAISE EXCEPTION '1043: authenticated escreve em cb_ia_agentes — a escrita é da rota';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_ia_agentes', 'SELECT') THEN
    RAISE EXCEPTION '1043: authenticated sem SELECT em cb_ia_agentes (a policy de admin não teria o que filtrar)';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_ia_agentes', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_agentes', 'UPDATE') THEN
    RAISE EXCEPTION '1043: service_role sem escrita em cb_ia_agentes';
  END IF;
  IF has_function_privilege('anon', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1043: cb_ia_uso aberta ao navegador';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_uso(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '1043: service_role sem EXECUTE em cb_ia_uso';
  END IF;
  IF has_function_privilege('anon', 'public.cb_tira_conexao_dos_agentes_de_ia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_tira_conexao_dos_agentes_de_ia()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_ia_agente_arquivado_sai_das_passagens()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_agente_arquivado_sai_das_passagens()', 'EXECUTE') THEN
    RAISE EXCEPTION '1043: função de gatilho exposta como RPC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'cb_ia_agentes_arquivado_sai_das_passagens'
                    AND tgrelid = 'public.cb_ia_agentes'::regclass) THEN
    RAISE EXCEPTION '1043: gatilho do arquivamento ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_schema = 'public'
       AND constraint_name = 'ai_usage_log_mode_check'
       AND check_clause LIKE '%agente_teste%'
  ) THEN
    RAISE EXCEPTION '1043: o CHECK de mode não aceita agente_teste — o uso do Playground sumiria calado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ai_configs'
       AND policyname = 'ai_configs_select'
       AND qual LIKE '%cb_contas_do_usuario(''admin''%'
  ) THEN
    RAISE EXCEPTION '1043: ai_configs ainda legível por qualquer membro (o prompt do assistente)';
  END IF;

  -- A função de soma é CHAMADA (o corpo só é analisado quando roda): numa
  -- conta que não existe, ela devolve zero linhas sem erro.
  PERFORM 1 FROM public.cb_ia_uso('00000000-0000-0000-0000-000000000000'::uuid, now() - interval '1 day');
END $$;
