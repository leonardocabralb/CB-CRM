-- 1052_cb_ia_agente_documentos.sql
--
-- F3 dos agentes de IA (docs/PLANO-agentes-de-ia.md, 5.2, 5.5 e D20): cada
-- agente tem a SUA base de conhecimento, e o turno guarda o RETRATO do que o
-- modelo viu.
--
-- O que faz:
--  1. `ai_knowledge_documents` ganha `UNIQUE (id, account_id)` — o alvo da FK
--     COMPOSTA do item 2 (o Postgres exige o par único e TOTAL no destino;
--     Codex, #292).
--  2. `cb_ia_agente_documentos (account_id, ia_agente_id, documento_id)`: os
--     documentos marcados para cada agente. Um documento serve a vários
--     agentes. FKs COMPOSTAS pela conta, CASCADE dos dois lados: apagar o
--     documento tira o vínculo; ARQUIVAR o agente não apaga nada (o vínculo
--     fica para quando ele voltar); apagar a conta leva tudo pelo agente e
--     pelo documento. FECHADA ao navegador (RLS ligada, ZERO policy): só a
--     rota de administrador lê e escreve, com o cliente de serviço.
--  3. Duas funções NOVAS de busca na base, com o recorte pelo agente:
--     `cb_ia_buscar_conhecimento_semantico` e `cb_ia_buscar_conhecimento_fts`.
--     Só devolvem os trechos dos documentos MARCADOS para o agente (JOIN em
--     `cb_ia_agente_documentos` pela conta E pelo agente). ⚠️ `p_ia_agente_id`
--     NULO = NADA: nada marcado = nenhuma base, o "fechado por padrão" do
--     acesso. As de hoje (`match_ai_knowledge_*`, 0903) dizem o contrário com
--     parâmetro nulo ("sem recorte") e ficam como estão, para o rascunho —
--     por isso funções novas, e não um parâmetro a mais nelas.
--     SECURITY INVOKER, EXECUTE só do `service_role` (as duas metades do
--     REVOKE, 913/915) — e o SELECT das tabelas que elas leem, POR ESCRITO.
--  4. `cb_ia_turnos.contexto jsonb`: o RETRATO do que o modelo viu no turno —
--     `{ blocos: [{ bloco, texto }], documentos: [ids] }`, com teto no app
--     (20 KB). Nulo nos turnos anteriores à F3. A tabela continua fechada ao
--     navegador; a sub-aba Turnos lê pela rota de administrador.
--
-- ⚠️ ORDEM: aplicar ANTES do deploy da F3. Sem a tabela e as funções, a base
-- do agente fica vazia (a busca é melhor esforço) e o retrato não é gravado
-- (escrita separada, melhor esforço) — nada quebra, mas a tela de documentos
-- do agente responde 500. Aditiva. Idempotente. `anon` sem nada.
--
-- ⚠️ A conferência do fim CHAMA as duas funções (o corpo só é analisado
-- quando roda), num subbloco desfeito por SQLSTATE próprio (`P1052`), como
-- `service_role`. Com dado (uma conta com trecho da base), ela marca um
-- documento para um agente de conferência e prova o recorte; em banco vazio
-- pula com NOTICE. Roda com as travas das ALTER presas — por isso é barata:
-- um trecho, um agente, uma busca.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) O alvo da FK composta
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_knowledge_documents'::regclass
       AND conname = 'ai_knowledge_documents_id_conta_key'
  ) THEN
    ALTER TABLE public.ai_knowledge_documents
      ADD CONSTRAINT ai_knowledge_documents_id_conta_key UNIQUE (id, account_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Os documentos de cada agente
-- ---------------------------------------------------------------------------
-- Sem FK direta para `accounts`: a conta está nas duas FKs compostas, e a
-- exclusão da conta chega aqui pelo agente e pelo documento (uma terceira FK
-- sem índice próprio faria o DELETE da conta varrer a tabela).
CREATE TABLE IF NOT EXISTS cb_ia_agente_documentos (
  account_id    uuid NOT NULL,
  ia_agente_id  uuid NOT NULL,
  documento_id  uuid NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ia_agente_id, documento_id),
  CONSTRAINT cb_ia_agente_documentos_agente_fkey
    FOREIGN KEY (ia_agente_id, account_id) REFERENCES cb_ia_agentes (id, account_id) ON DELETE CASCADE,
  CONSTRAINT cb_ia_agente_documentos_documento_fkey
    FOREIGN KEY (documento_id, account_id) REFERENCES ai_knowledge_documents (id, account_id) ON DELETE CASCADE
);

-- A FK do documento (apagar o documento procura os vínculos por ele). A do
-- agente usa o começo da chave primária.
CREATE INDEX IF NOT EXISTS cb_ia_agente_documentos_documento_idx
  ON cb_ia_agente_documentos (documento_id);

ALTER TABLE cb_ia_agente_documentos ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE cb_ia_agente_documentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_ia_agente_documentos TO service_role;

-- ---------------------------------------------------------------------------
-- 3) A busca na base DO AGENTE
-- ---------------------------------------------------------------------------
-- Semântica: distância de cosseno contra o embedding da consulta; só trechos
-- com embedding. `p_query_embedding` é TEXTO (o literal `[0.1,…]`) e o cast é
-- aqui dentro — a forma da 0030/0903 (o PostgREST não liga JSON a `vector`
-- de modo confiável). `score` = 1 − distância (maior = mais perto).
DROP FUNCTION IF EXISTS public.cb_ia_buscar_conhecimento_semantico(uuid, uuid, text, integer);
CREATE FUNCTION public.cb_ia_buscar_conhecimento_semantico(
  p_account_id      uuid,
  p_ia_agente_id    uuid,
  p_query_embedding text,
  p_match_count     integer
)
RETURNS TABLE (id uuid, documento_id uuid, content text, score real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT c.id,
         c.document_id AS documento_id,
         c.content,
         (1 - (c.embedding <=> p_query_embedding::vector(1536)))::real AS score
    FROM ai_knowledge_chunks c
    JOIN cb_ia_agente_documentos d
      ON d.documento_id = c.document_id
     AND d.account_id = c.account_id
   WHERE c.account_id = p_account_id
     -- Agente nulo nunca casa (`= NULL`): nada marcado = nenhuma base.
     AND d.ia_agente_id = p_ia_agente_id
     AND c.embedding IS NOT NULL
   ORDER BY c.embedding <=> p_query_embedding::vector(1536)
   LIMIT GREATEST(p_match_count, 0);
$$;

-- Por palavras: `plainto_tsquery` (a mensagem crua do cliente vira consulta
-- sem operador injetável), no mesmo `'simple'` da coluna `fts`. Desempate
-- pelo id, para a ordem ser total.
DROP FUNCTION IF EXISTS public.cb_ia_buscar_conhecimento_fts(uuid, uuid, text, integer);
CREATE FUNCTION public.cb_ia_buscar_conhecimento_fts(
  p_account_id   uuid,
  p_ia_agente_id uuid,
  p_query        text,
  p_match_count  integer
)
RETURNS TABLE (id uuid, documento_id uuid, content text, score real)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT c.id,
         c.document_id AS documento_id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS score
    FROM ai_knowledge_chunks c
    JOIN cb_ia_agente_documentos d
      ON d.documento_id = c.document_id
     AND d.account_id = c.account_id
   WHERE c.account_id = p_account_id
     AND d.ia_agente_id = p_ia_agente_id
     AND c.fts @@ plainto_tsquery('simple', p_query)
   ORDER BY score DESC, c.id
   LIMIT GREATEST(p_match_count, 0);
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_buscar_conhecimento_semantico(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cb_ia_buscar_conhecimento_fts(uuid, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
-- O turno e o Playground chamam com o cliente de SERVIÇO, que perdeu o
-- EXECUTE junto com PUBLIC.
GRANT EXECUTE ON FUNCTION public.cb_ia_buscar_conhecimento_semantico(uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cb_ia_buscar_conhecimento_fts(uuid, uuid, text, integer) TO service_role;
-- As funções são INVOKER: quem as chama precisa ler os trechos (em banco novo
-- não há privilégio padrão que o conceda).
GRANT SELECT ON TABLE ai_knowledge_chunks TO service_role;

-- ---------------------------------------------------------------------------
-- 4) O retrato do turno
-- ---------------------------------------------------------------------------
ALTER TABLE cb_ia_turnos ADD COLUMN IF NOT EXISTS contexto jsonb;

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: catálogo, privilégios e as duas funções
-- CHAMADAS num subbloco desfeito por SQLSTATE próprio)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conta     uuid;
  v_doc       uuid;
  v_trecho    uuid;
  v_palavra   text;
  v_doc_emb   uuid;
  v_trecho_emb uuid;
  v_embedding text;
  v_agente    uuid;
  v_quantas   integer;
  f           text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.ai_knowledge_documents'::regclass
       AND conname = 'ai_knowledge_documents_id_conta_key' AND contype = 'u'
  ) THEN
    RAISE EXCEPTION '1052: ai_knowledge_documents sem UNIQUE (id, account_id)';
  END IF;

  -- A tabela: RLS ligada, NENHUMA policy, nada ao navegador, tudo ao serviço.
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.cb_ia_agente_documentos'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION '1052: RLS desligada em cb_ia_agente_documentos';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_ia_agente_documentos') THEN
    RAISE EXCEPTION '1052: cb_ia_agente_documentos tem policy — ela é fechada ao navegador';
  END IF;
  FOREACH f IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF has_table_privilege('anon', 'public.cb_ia_agente_documentos', f)
       OR has_table_privilege('authenticated', 'public.cb_ia_agente_documentos', f) THEN
      RAISE EXCEPTION '1052: cb_ia_agente_documentos aberta ao navegador (%)', f;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.cb_ia_agente_documentos', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_agente_documentos', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_agente_documentos', 'DELETE') THEN
    RAISE EXCEPTION '1052: service_role sem leitura ou escrita em cb_ia_agente_documentos';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ai_knowledge_chunks', 'SELECT') THEN
    RAISE EXCEPTION '1052: service_role sem SELECT em ai_knowledge_chunks (as funções INVOKER falhariam)';
  END IF;

  -- As duas FKs compostas, com CASCADE; e o índice da do documento.
  SELECT count(*) INTO v_quantas FROM pg_constraint
   WHERE conrelid = 'public.cb_ia_agente_documentos'::regclass
     AND conname IN ('cb_ia_agente_documentos_agente_fkey', 'cb_ia_agente_documentos_documento_fkey')
     AND contype = 'f' AND confdeltype = 'c' AND array_length(conkey, 1) = 2;
  IF v_quantas <> 2 THEN
    RAISE EXCEPTION '1052: esperava as duas FKs compostas com CASCADE; há %', v_quantas;
  END IF;
  IF to_regclass('public.cb_ia_agente_documentos_documento_idx') IS NULL THEN
    RAISE EXCEPTION '1052: índice da FK do documento não existe';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_ia_turnos'
       AND column_name = 'contexto' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION '1052: cb_ia_turnos.contexto não existe';
  END IF;

  -- As funções: só o serviço, e uma de cada (sem overload).
  FOREACH f IN ARRAY ARRAY[
    'public.cb_ia_buscar_conhecimento_semantico(uuid, uuid, text, integer)',
    'public.cb_ia_buscar_conhecimento_fts(uuid, uuid, text, integer)'
  ] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1052: % aberta ao navegador', f;
    END IF;
    IF NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION '1052: service_role sem EXECUTE em %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['cb_ia_buscar_conhecimento_semantico', 'cb_ia_buscar_conhecimento_fts'] LOOP
    SELECT count(*) INTO v_quantas FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f;
    IF v_quantas <> 1 THEN
      RAISE EXCEPTION '1052: esperava UMA %; há %', f, v_quantas;
    END IF;
  END LOOP;

  -- As funções CHAMADAS, como service_role. O dado sai do banco: um trecho com
  -- palavra (a busca por palavras) e, na mesma conta, um com embedding (a por
  -- sentido — o próprio embedding dele é a consulta, e ele é o mais perto).
  SELECT c.account_id, c.document_id, c.id, (tsvector_to_array(c.fts))[1]
    INTO v_conta, v_doc, v_trecho, v_palavra
    FROM ai_knowledge_chunks c
   WHERE length(c.fts) > 0
   LIMIT 1;
  IF v_conta IS NOT NULL THEN
    SELECT c.document_id, c.id, c.embedding::text
      INTO v_doc_emb, v_trecho_emb, v_embedding
      FROM ai_knowledge_chunks c
     WHERE c.account_id = v_conta AND c.embedding IS NOT NULL
     LIMIT 1;
  END IF;
  BEGIN
    SET LOCAL ROLE service_role;
    -- Agente NULO = nada, sempre (nunca "sem recorte").
    IF EXISTS (SELECT 1 FROM public.cb_ia_buscar_conhecimento_fts(
                 coalesce(v_conta, gen_random_uuid()), NULL, coalesce(v_palavra, 'x'), 50)) THEN
      RAISE EXCEPTION '1052: a busca por palavras com agente nulo devolveu trecho';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cb_ia_buscar_conhecimento_semantico(
                 coalesce(v_conta, gen_random_uuid()), NULL, v_embedding, 50)) THEN
      RAISE EXCEPTION '1052: a busca por sentido com agente nulo devolveu trecho';
    END IF;

    IF v_conta IS NOT NULL THEN
      INSERT INTO cb_ia_agentes (account_id, nome, provedor, modelo)
        VALUES (v_conta, '__conferencia_1052__', 'gemini', 'm')
        RETURNING id INTO v_agente;
      -- Sem documento marcado: nenhuma base.
      IF EXISTS (SELECT 1 FROM public.cb_ia_buscar_conhecimento_fts(v_conta, v_agente, v_palavra, 50)) THEN
        RAISE EXCEPTION '1052: agente sem documento marcado viu a base';
      END IF;
      INSERT INTO cb_ia_agente_documentos (account_id, ia_agente_id, documento_id)
        VALUES (v_conta, v_agente, v_doc);
      IF NOT EXISTS (SELECT 1 FROM public.cb_ia_buscar_conhecimento_fts(v_conta, v_agente, v_palavra, 1000) t
                      WHERE t.id = v_trecho AND t.documento_id = v_doc) THEN
        RAISE EXCEPTION '1052: a busca por palavras não achou o trecho do documento marcado';
      END IF;
      IF EXISTS (SELECT 1 FROM public.cb_ia_buscar_conhecimento_fts(v_conta, v_agente, v_palavra, 1000) t
                  WHERE t.documento_id <> v_doc) THEN
        RAISE EXCEPTION '1052: a busca por palavras devolveu trecho de documento NÃO marcado';
      END IF;
      IF v_embedding IS NOT NULL THEN
        INSERT INTO cb_ia_agente_documentos (account_id, ia_agente_id, documento_id)
          VALUES (v_conta, v_agente, v_doc_emb)
          ON CONFLICT DO NOTHING;
        IF NOT EXISTS (SELECT 1 FROM public.cb_ia_buscar_conhecimento_semantico(v_conta, v_agente, v_embedding, 50) t
                        WHERE t.id = v_trecho_emb) THEN
          RAISE EXCEPTION '1052: a busca por sentido não achou o trecho do documento marcado';
        END IF;
        IF EXISTS (SELECT 1 FROM public.cb_ia_buscar_conhecimento_semantico(v_conta, v_agente, v_embedding, 50) t
                    WHERE t.documento_id NOT IN (v_doc, v_doc_emb)) THEN
          RAISE EXCEPTION '1052: a busca por sentido devolveu trecho de documento NÃO marcado';
        END IF;
      ELSE
        RAISE NOTICE '1052: nenhum trecho com embedding nesta conta — a busca por sentido foi chamada só com agente nulo.';
      END IF;
    ELSE
      RAISE NOTICE '1052: banco sem trecho da base — as funções foram chamadas só com agente nulo.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1052';
  EXCEPTION WHEN SQLSTATE 'P1052' THEN
    NULL;
  END;

  RAISE NOTICE '1052: a base de conhecimento por agente e o retrato do turno.';
END $$;
