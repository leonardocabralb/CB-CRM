-- 1042_cb_ia_chaves_por_provedor.sql
--
-- F1a do plano dos agentes de IA (docs/PLANO-agentes-de-ia.md, D1): a chave
-- de cada provedor de IA passa a ser UMA POR CONTA, numa tabela própria, e
-- deixa de morar dentro da linha do "agente" (`ai_configs.api_key`).
--
-- Por quê: a linha de `ai_configs` mistura a CREDENCIAL com o COMPORTAMENTO
-- do assistente (prompt, modelo, interruptores). O Radar e a transcrição
-- leem a chave de lá, então criar um agente com outro provedor, ou "Remover"
-- a configuração do assistente, mexia na chave do Radar sem aviso. Com vários
-- agentes (F1b), cada um escolhe provedor e modelo; a chave é do provedor.
--
-- O que faz:
--  1. `cb_ia_chaves` — `(account_id, provedor)` único, a chave CIFRADA com
--     `encrypt()` de `src/lib/whatsapp/encryption.ts` (AES-256-GCM,
--     `ENCRYPTION_KEY`). FECHADA ao navegador (RLS ligada, nenhuma policy,
--     REVOKE de anon e authenticated): a tela lê o ESTADO por rota de admin,
--     e a chave não sai de rota nenhuma, nem mascarada.
--  2. COPIA as chaves que já existem: a de cada linha de `ai_configs` para o
--     provedor dela (a padrão da conta primeiro; linha por conexão só
--     preenche provedor que ainda não tem chave), e `embeddings_api_key`
--     para o slot da OpenAI quando ele ainda estiver vazio. Com duas chaves
--     OpenAI diferentes (a do chat e a de embeddings), a do chat vai para
--     `api_key` e a de embeddings FICA, em `embeddings_api_key` da mesma
--     linha: uma chave de projeto RESTRITA gera texto e não gera embedding,
--     e quem tinha uma chave dedicada à base não pode perder a busca por
--     sentido na migração (Codex, PR #295). O texto cifrado é copiado como
--     está (mesma ENCRYPTION_KEY).
--  3. `ai_configs.api_key` perde o NOT NULL: a linha padrão passa a guardar
--     só a configuração dos módulos (provedor e modelo do Radar) e o
--     comportamento do assistente legado; a chave deixa de ser lida dali.
--     A coluna FICA (com o valor de hoje) até a limpeza de uma fase
--     posterior: se o deploy precisar voltar atrás, o app anterior continua
--     achando a chave onde sempre achou.
--
--  4. Um gatilho TEMPORÁRIO (`cb_ia_chaves_segue_o_legado`) cobre a janela
--     entre aplicar e publicar: o app anterior ainda grava a chave em
--     `ai_configs`, e a cópia do item 2 é um retrato. Sem o gatilho, a chave
--     trocada nesse intervalo nunca chegaria a `cb_ia_chaves` e o app novo
--     subiria com a velha (Codex, #294). A 1043, aplicada com a F1a já no
--     ar, o apaga.
--
-- ⚠️ Aditiva: aplicar ANTES do deploy.
--
-- Idempotente. `anon` sem nada; `service_role` com tudo, POR ESCRITO (em
-- banco novo não existe default privilege que o conceda).

CREATE TABLE IF NOT EXISTS cb_ia_chaves (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provedor       text NOT NULL CHECK (provedor IN ('openai', 'anthropic', 'gemini')),
  api_key        text NOT NULL CHECK (api_key <> ''),
  -- Só da OpenAI: a chave também serve à busca por sentido da base de
  -- conhecimento (embeddings), e uma chave de projeto RESTRITA gera texto e
  -- não gera embedding. NULL = não conferida (a copiada do app anterior, ou
  -- a conferência falhou por rede/limite) e vale como "serve", que era o
  -- comportamento de antes; false = a OpenAI RECUSOU o embedding quando a
  -- chave foi gravada, e a base cai na busca por palavras em vez de tentar
  -- (e falhar) a cada rascunho, resposta e indexação.
  serve_embeddings boolean CHECK (provedor = 'openai' OR serve_embeddings IS NULL),
  -- Só da OpenAI: a chave PRÓPRIA dos embeddings, herdada do app anterior
  -- (`ai_configs.embeddings_api_key`) quando a conta tinha uma diferente da
  -- do chat. Vence `api_key` na busca por sentido. Some quando uma chave da
  -- OpenAI gravada pela tela passa na conferência do embedding (ela serve às
  -- duas coisas), e com a linha, ao apagar a chave da OpenAI.
  embeddings_api_key text CHECK (
    embeddings_api_key IS NULL OR (provedor = 'openai' AND embeddings_api_key <> '')
  ),
  -- Autoria: SET NULL, nunca CASCADE — apagar o login de quem cadastrou não
  -- pode levar junto a chave que o Radar usa.
  atualizada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_ia_chaves_conta_provedor_key UNIQUE (account_id, provedor)
);

ALTER TABLE cb_ia_chaves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_ia_chaves FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_ia_chaves TO service_role;

-- A cópia. A linha padrão (channel_id NULL) vence a de conexão para o mesmo
-- provedor, e entre as de conexão a LIGADA vence a desligada (é a que roda:
-- a chave velha de uma desligada derrubaria a resposta automática da ligada —
-- Codex, #294): `ORDER BY` + `DISTINCT ON`, e o `ON CONFLICT DO NOTHING` não
-- sobrescreve o que já estiver na tabela (reexecução).
INSERT INTO cb_ia_chaves (account_id, provedor, api_key, atualizada_por, created_at, updated_at)
SELECT DISTINCT ON (c.account_id, c.provider)
       c.account_id, c.provider, c.api_key, c.created_by, now(), now()
  FROM ai_configs c
 WHERE c.api_key IS NOT NULL AND c.api_key <> ''
 ORDER BY c.account_id, c.provider, (c.channel_id IS NULL) DESC, c.is_active DESC, c.created_at
ON CONFLICT (account_id, provedor) DO NOTHING;

-- A de embeddings entra no slot da OpenAI VAZIO como a chave dele E como a
-- chave PRÓPRIA da base, com o MESMO texto cifrado nos dois campos. É a marca
-- de origem: texto cifrado IDÊNTICO = "esta chave É a da base" (o app a
-- preserva quando uma chave de chat da OpenAI chegar depois e não servir aos
-- embeddings — Codex, #294); mesma chave com textos cifrados DIFERENTES é a
-- duplicata falsa do caso seguinte, que a troca apaga.
INSERT INTO cb_ia_chaves (account_id, provedor, api_key, embeddings_api_key, atualizada_por, created_at, updated_at)
SELECT c.account_id, 'openai', c.embeddings_api_key, c.embeddings_api_key, c.created_by, now(), now()
  FROM ai_configs c
 WHERE c.channel_id IS NULL
   AND c.embeddings_api_key IS NOT NULL AND c.embeddings_api_key <> ''
ON CONFLICT (account_id, provedor) DO NOTHING;

-- Slot da OpenAI JÁ ocupado pela chave do chat: a de embeddings fica como a
-- chave PRÓPRIA da base. Compara o texto CIFRADO: a mesma chave cifrada duas
-- vezes dá textos diferentes (IV aleatório), e aí ela é guardada duas vezes.
-- ⚠️ Isso NÃO é inofensivo na TROCA: a chave velha, tida como "própria",
-- seria preservada e continuaria sendo usada. O SQL não decifra (a chave de
-- cifra é do app); quem separa é o app, na troca (`gravarChave` confere as
-- duas DECIFRADAS e apaga a falsa — Codex, #294). Só preenche o que está
-- vazio (reexecução).
UPDATE cb_ia_chaves k
   SET embeddings_api_key = c.embeddings_api_key
  FROM ai_configs c
 WHERE c.channel_id IS NULL
   AND c.account_id = k.account_id
   AND k.provedor = 'openai'
   AND k.embeddings_api_key IS NULL
   AND c.embeddings_api_key IS NOT NULL AND c.embeddings_api_key <> ''
   AND c.embeddings_api_key <> k.api_key;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n
    FROM ai_configs c
   WHERE c.channel_id IS NULL
     AND c.provider = 'openai'
     AND c.api_key IS NOT NULL
     AND c.embeddings_api_key IS NOT NULL;
  IF n > 0 THEN
    RAISE NOTICE '1042: % conta(s) tinham chave OpenAI de chat E de embeddings; a de embeddings ficou como a chave própria da base.', n;
  END IF;
END $$;

ALTER TABLE ai_configs ALTER COLUMN api_key DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) A janela entre aplicar e publicar (TEMPORÁRIO — a 1043 apaga)
-- ---------------------------------------------------------------------------
-- Só a escrita que vem do NAVEGADOR (a sessão de um usuário pelo PostgREST,
-- como o app anterior grava): o app novo espelha a chave em `ai_configs` pelo
-- SERVIÇO, e copiar de volta o espelho dele recriaria a falsa chave "própria"
-- dos embeddings. SECURITY DEFINER porque `authenticated` não alcança
-- `cb_ia_chaves` (e não deve).
CREATE OR REPLACE FUNCTION public.cb_ia_chaves_segue_o_legado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_da_conexao text;
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'authenticated' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- O "Remover" do app anterior apaga a linha padrão e diz ao administrador
  -- que a chave foi esquecida: a cópia em `cb_ia_chaves` sai junto, senão o
  -- app novo subiria usando a chave que a pessoa mandou esquecer (Codex, #295).
  IF TG_OP = 'DELETE' THEN
    IF OLD.channel_id IS NULL THEN
      -- Um agente de CONEXÃO ligado do mesmo provedor continua configurado: a
      -- chave do provedor passa a ser a DELE (a mesma escolha da cópia do
      -- item 1), em vez de sumir — sem isso a resposta automática dele pararia
      -- no deploy (Codex, #294). A da linha apagada sai do mesmo jeito.
      SELECT c.api_key INTO v_da_conexao
        FROM ai_configs c
       WHERE c.account_id = OLD.account_id AND c.provider = OLD.provider
         AND c.channel_id IS NOT NULL AND c.is_active
         AND c.api_key IS NOT NULL AND c.api_key <> ''
       ORDER BY c.created_at
       LIMIT 1;
      IF v_da_conexao IS NOT NULL THEN
        UPDATE cb_ia_chaves SET api_key = v_da_conexao, serve_embeddings = NULL, updated_at = now()
         WHERE account_id = OLD.account_id AND provedor = OLD.provider;
      ELSE
        DELETE FROM cb_ia_chaves WHERE account_id = OLD.account_id AND provedor = OLD.provider;
      END IF;
      IF OLD.embeddings_api_key IS NOT NULL AND OLD.embeddings_api_key <> '' THEN
        -- A linha da OpenAI que nasceu SÓ da chave da base (as duas colunas com
        -- o MESMO texto cifrado — a marca de origem do item 2) é essa chave
        -- inteira: sai a linha, senão `api_key` continuaria servindo a base com
        -- a credencial que a pessoa mandou esquecer (Codex, #295).
        DELETE FROM cb_ia_chaves
         WHERE account_id = OLD.account_id AND provedor = 'openai' AND api_key = embeddings_api_key;
        UPDATE cb_ia_chaves SET embeddings_api_key = NULL, updated_at = now()
         WHERE account_id = OLD.account_id AND provedor = 'openai';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.channel_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.api_key IS NOT NULL AND NEW.api_key <> ''
     AND (TG_OP = 'INSERT' OR NEW.api_key IS DISTINCT FROM OLD.api_key) THEN
    INSERT INTO cb_ia_chaves (account_id, provedor, api_key, created_at, updated_at)
    VALUES (NEW.account_id, NEW.provider, NEW.api_key, now(), now())
    ON CONFLICT (account_id, provedor)
      DO UPDATE SET api_key = EXCLUDED.api_key, serve_embeddings = NULL, updated_at = now();
  END IF;

  IF TG_OP = 'INSERT' OR NEW.embeddings_api_key IS DISTINCT FROM OLD.embeddings_api_key THEN
    IF NEW.embeddings_api_key IS NOT NULL AND NEW.embeddings_api_key <> '' THEN
      -- A regra da cópia (item 2): slot da OpenAI vazio recebe a chave; ocupado,
      -- ela fica como a própria da base.
      -- A linha que nasceu SÓ da chave da base troca as DUAS colunas (a marca
      -- de origem segue valendo); a linha de uma chave de chat de verdade
      -- troca só a própria da base.
      INSERT INTO cb_ia_chaves (account_id, provedor, api_key, embeddings_api_key, created_at, updated_at)
      VALUES (NEW.account_id, 'openai', NEW.embeddings_api_key, NEW.embeddings_api_key, now(), now())
      ON CONFLICT (account_id, provedor)
        DO UPDATE SET
          api_key = CASE WHEN cb_ia_chaves.api_key = cb_ia_chaves.embeddings_api_key
                         THEN EXCLUDED.api_key ELSE cb_ia_chaves.api_key END,
          serve_embeddings = CASE WHEN cb_ia_chaves.api_key = cb_ia_chaves.embeddings_api_key
                                  THEN NULL ELSE cb_ia_chaves.serve_embeddings END,
          embeddings_api_key = EXCLUDED.embeddings_api_key,
          updated_at = now();
    ELSIF TG_OP = 'UPDATE' THEN
      -- A tela antiga APAGOU a chave própria: a linha que era SÓ dela sai
      -- (Codex, #295); na outra, a base volta à chave da OpenAI.
      DELETE FROM cb_ia_chaves
       WHERE account_id = NEW.account_id AND provedor = 'openai' AND api_key = embeddings_api_key;
      UPDATE cb_ia_chaves SET embeddings_api_key = NULL, updated_at = now()
       WHERE account_id = NEW.account_id AND provedor = 'openai';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_chaves_segue_o_legado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cb_ia_chaves_segue_o_legado ON ai_configs;
CREATE TRIGGER cb_ia_chaves_segue_o_legado
  AFTER INSERT OR UPDATE OF api_key, embeddings_api_key OR DELETE ON ai_configs
  FOR EACH ROW EXECUTE FUNCTION public.cb_ia_chaves_segue_o_legado();

-- ---------------------------------------------------------------------------
-- Conferência (roda em banco vazio: só catálogo e privilégios).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  faltando integer;
BEGIN
  IF to_regclass('public.cb_ia_chaves') IS NULL THEN
    RAISE EXCEPTION '1042: cb_ia_chaves ausente';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_chaves', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_ia_chaves', 'INSERT') THEN
    RAISE EXCEPTION '1042: anon alcança cb_ia_chaves';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_ia_chaves', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_chaves', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_ia_chaves', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_ia_chaves', 'DELETE') THEN
    RAISE EXCEPTION '1042: authenticated alcança cb_ia_chaves — a chave só passa pela rota';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_ia_chaves', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_chaves', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_chaves', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_chaves', 'DELETE') THEN
    RAISE EXCEPTION '1042: service_role sem acesso a cb_ia_chaves';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.cb_ia_chaves'::regclass
                    AND attname = 'serve_embeddings' AND NOT attisdropped) THEN
    RAISE EXCEPTION '1042: cb_ia_chaves.serve_embeddings ausente';
  END IF;
  IF (SELECT attnotnull FROM pg_attribute
       WHERE attrelid = 'public.ai_configs'::regclass AND attname = 'api_key') THEN
    RAISE EXCEPTION '1042: ai_configs.api_key continua NOT NULL';
  END IF;

  -- Toda conta que tinha chave de chat tem, agora, a chave do provedor dela.
  -- Afirma AUSÊNCIA de falta (seguro em banco vazio).
  SELECT count(*) INTO faltando
    FROM ai_configs c
   WHERE c.channel_id IS NULL
     AND c.api_key IS NOT NULL AND c.api_key <> ''
     AND NOT EXISTS (
       SELECT 1 FROM cb_ia_chaves k
        WHERE k.account_id = c.account_id AND k.provedor = c.provider
     );
  IF faltando > 0 THEN
    RAISE EXCEPTION '1042: % conta(s) com chave em ai_configs sem cópia em cb_ia_chaves', faltando;
  END IF;

  -- Toda chave de embeddings de antes está em algum lugar da linha da OpenAI.
  SELECT count(*) INTO faltando
    FROM ai_configs c
   WHERE c.channel_id IS NULL
     AND c.embeddings_api_key IS NOT NULL AND c.embeddings_api_key <> ''
     AND NOT EXISTS (
       SELECT 1 FROM cb_ia_chaves k
        WHERE k.account_id = c.account_id AND k.provedor = 'openai'
          AND (k.api_key = c.embeddings_api_key OR k.embeddings_api_key = c.embeddings_api_key)
     );
  IF faltando > 0 THEN
    RAISE EXCEPTION '1042: % conta(s) perderam a chave de embeddings na cópia', faltando;
  END IF;
END $$;
