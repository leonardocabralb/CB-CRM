-- ============================================================
-- 1071 — Integração com o Atlas Gestor: a conexão (chave da API) e o vínculo
-- ficha do CRM ↔ cliente do Atlas.
--
-- Plano: docs/PLANO-integracao-atlas.md, Fase 0. Decisões do operador
-- (29/09/2026): o escritório gera UMA chave no Atlas e a cola no cartão
-- "Atlas" de Integrações (D1); o Atlas manda no contrato (D2); cliente que
-- volta é REATIVADO no cadastro que já existe, nunca criado de novo (D3). O
-- passo de automação "Criar cliente no Atlas" procura, cria ou reativa, e
-- guarda aqui o id do cliente do Atlas.
--
-- 1) `cb_atlas_config` — uma linha por conta, com a chave CIFRADA
--    (`ENCRYPTION_KEY`). FECHADA ao navegador (RLS sem policy, REVOKE de
--    anon e authenticated, como a 1057): a tela lê pela rota, que nunca
--    devolve a chave.
-- 2) `cb_atlas_clientes` — o vínculo 1:1 (um cliente do Atlas por ficha, uma
--    ficha por cliente do Atlas). Sem dado pessoal (ids, link da ficha no
--    Atlas, a última situação lida), então LEGÍVEL por membro na forma da
--    1032 — a Fase 2 mostra o botão "Abrir no Atlas" e a faixa pela situação
--    do Atlas lendo daqui. ESCRITA só pelo servidor (service role).
--    `atlas_tenant_id` guarda de qual escritório do Atlas é o cliente: uma
--    chave de OUTRO escritório não pode reaproveitar esses vínculos.
--
-- ⚠️ `contact_id` com FK COMPOSTA `(contact_id, account_id)` e
-- `ON DELETE SET NULL (contact_id)`: apagar a ficha deixa o vínculo órfão
-- (o cliente continua existindo no Atlas). A tabela entra na receita de fusão
-- de fichas (`.claude/rules/supabase.md`) neste mesmo PR.
--
-- ADITIVA, e vai ANTES do deploy: o app novo lê e grava as duas tabelas; o
-- antigo não sabe delas. Idempotente. As conferências usam só o catálogo
-- (banco VAZIO no replay do CI).
-- ============================================================

-- A FK composta pega trava em `contacts`, que recebe escrita o tempo todo.
SET LOCAL lock_timeout = '5s';

-- O índice único que a FK composta exige já existe (0944/0987/0994/1057).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx ON contacts (id, account_id);

-- ------------------------------------------------------------
-- 1) a conexão
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_atlas_config (
  account_id       uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  -- A chave da API do Atlas, CIFRADA (`encrypt()`); nunca sai por rota.
  api_key          text NOT NULL,
  -- O que o `whoami` do Atlas disse ao conectar: de qual escritório é a chave.
  atlas_tenant_id  uuid NOT NULL,
  escritorio       text,
  status           text NOT NULL DEFAULT 'conectado'
                   CONSTRAINT cb_atlas_config_status_ck
                   CHECK (status IN ('conectado', 'erro')),
  last_error       text,
  conectado_em     timestamptz NOT NULL DEFAULT now(),
  conferido_em     timestamptz,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cb_atlas_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_atlas_config FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_atlas_config TO service_role;

-- ------------------------------------------------------------
-- 2) o vínculo ficha ↔ cliente do Atlas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_atlas_clientes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id       uuid,
  atlas_tenant_id  uuid NOT NULL,
  atlas_client_id  uuid NOT NULL,
  -- O endereço da ficha no app do Atlas (`app_url` da resposta), quando veio.
  app_url          text,
  -- A situação como o Atlas a escreve (ativo, rescindido, finalizado, …), a
  -- última lida. Sem CHECK: a lista é do Atlas.
  situacao         text,
  situacao_lida_em timestamptz,
  -- Como o vínculo nasceu: o passo CRIOU o cliente, REATIVOU um cadastro que
  -- existia, ou o ENCONTROU ativo (só vinculou); `manual` é da Fase 2.
  origem           text NOT NULL
                   CONSTRAINT cb_atlas_clientes_origem_ck
                   CHECK (origem IN ('criada', 'reativada', 'encontrada', 'manual')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_atlas_clientes_cliente_key UNIQUE (account_id, atlas_client_id),
  -- 1:1: uma ficha liga a UM cliente do Atlas. Várias linhas órfãs
  -- (`contact_id` nulo depois de apagar a ficha) convivem: NULL não repete.
  CONSTRAINT cb_atlas_clientes_contato_key UNIQUE (account_id, contact_id)
);

-- Apagar a ficha faz SET NULL por `contact_id`: sem índice por ele, varre a tabela.
CREATE INDEX IF NOT EXISTS cb_atlas_clientes_contato_idx
  ON cb_atlas_clientes (contact_id) WHERE contact_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cb_atlas_clientes_contato_fkey' AND conrelid = 'public.cb_atlas_clientes'::regclass
  ) THEN
    ALTER TABLE cb_atlas_clientes
      ADD CONSTRAINT cb_atlas_clientes_contato_fkey FOREIGN KEY (contact_id, account_id)
      REFERENCES contacts (id, account_id) ON DELETE SET NULL (contact_id);
  END IF;
END $$;

ALTER TABLE cb_atlas_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_atlas_clientes FROM PUBLIC, anon, authenticated;
-- O membro LÊ (botão "Abrir no Atlas" e a faixa, na Fase 2); escrever, só o servidor.
GRANT SELECT ON TABLE cb_atlas_clientes TO authenticated;
GRANT ALL ON TABLE cb_atlas_clientes TO service_role;

DROP POLICY IF EXISTS cb_atlas_clientes_select ON public.cb_atlas_clientes;
CREATE POLICY cb_atlas_clientes_select ON public.cb_atlas_clientes FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- ============================================================
-- Conferências — SÓ CATÁLOGO, válidas num banco VAZIO (nenhuma exige dado).
-- ============================================================
DO $$
DECLARE
  c text;
BEGIN
  -- A conexão: fechada ao membro — nem SELECT (a chave cifrada passa pela rota).
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_atlas_config'::regclass) THEN
    RAISE EXCEPTION '1071: cb_atlas_config sem RLS ligada';
  END IF;
  IF has_table_privilege('anon', 'public.cb_atlas_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_config', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_config', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_config', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_atlas_config', 'DELETE') THEN
    RAISE EXCEPTION '1071: cb_atlas_config alcançável pelo navegador — tudo passa pela rota';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_atlas_config') THEN
    RAISE EXCEPTION '1071: cb_atlas_config não pode ter policy';
  END IF;

  -- O vínculo: o membro só LÊ, e pela forma da 1032.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_atlas_clientes'::regclass) THEN
    RAISE EXCEPTION '1071: cb_atlas_clientes sem RLS ligada';
  END IF;
  IF has_table_privilege('anon', 'public.cb_atlas_clientes', 'SELECT') THEN
    RAISE EXCEPTION '1071: anon alcança cb_atlas_clientes';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_atlas_clientes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_clientes', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_clientes', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_atlas_clientes', 'DELETE') THEN
    RAISE EXCEPTION '1071: cb_atlas_clientes — o membro só lê; escrever é do servidor';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_atlas_clientes') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cb_atlas_clientes'
          AND cmd = 'SELECT' AND qual LIKE '%cb_contas_do_usuario%'
     ) THEN
    RAISE EXCEPTION '1071: cb_atlas_clientes precisa de UMA policy, de leitura, na forma da 1032';
  END IF;

  FOREACH c IN ARRAY ARRAY[
    'cb_atlas_config_status_ck',
    'cb_atlas_clientes_origem_ck',
    'cb_atlas_clientes_cliente_key',
    'cb_atlas_clientes_contato_key',
    'cb_atlas_clientes_contato_fkey'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      RAISE EXCEPTION '1071: restrição % ausente', c;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role', 'public.cb_atlas_config', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_clientes', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_clientes', 'UPDATE') THEN
    RAISE EXCEPTION '1071: service_role sem acesso às tabelas do Atlas';
  END IF;
END $$;
