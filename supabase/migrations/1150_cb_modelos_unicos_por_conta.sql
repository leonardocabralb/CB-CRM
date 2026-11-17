-- ============================================================
-- 1150 — Um modelo da Meta por CONTA e número, não por AUTOR
--
-- Os índices únicos de `message_templates` eram por AUTOR (903):
-- `(user_id, name, language)` sem número e `(user_id, channel_id, name,
-- language)` com número. Dois admins da mesma conta podiam ter o MESMO
-- modelo (nome + idioma) no mesmo número, e a submissão, a sincronização e o
-- envio (`resolveTemplateRow`) escolhiam entre as duas linhas sem critério. O
-- autor nulo (1116: apagar o login de quem criou deixa `user_id` NULL) nem
-- era coberto — NULL nunca colide.
--
-- Passa a ser por CONTA, com a régua da 903: a linha de um número
-- (`channel_id`) e a global (sem número, de antes da 903) podem conviver;
-- duas do MESMO número, ou duas globais, não. `NULLS NOT DISTINCT`: idioma
-- nulo também conta como repetido. Os índices por autor SAEM: dentro da conta
-- os novos os cobrem, e entre contas eles ATRAPALHAVAM — o login movido de
-- conta não criava na conta nova o modelo global que deixou na antiga.
--
-- NADA é apagado (a 057 do original apaga a duplicata, que aqui seria o
-- modelo de outro número ou o vinculado à Meta). Com duplicata, a migration
-- PARA com a lista, para alguém escolher qual fica (como a 0014). Medido na
-- produção em 17/11/2026: 15 modelos, 0 duplicatas. Nenhum escritor muda:
-- submissão, sincronização e o stub do webhook já buscam pela conta antes de
-- inserir. Na corrida (o mesmo modelo gravado duas vezes ao mesmo tempo), a
-- submissão e o stub tratam o 23505; a sincronização o lista entre os erros
-- daquele modelo, e a seguinte o atualiza.
--
-- Apagar uma CONEXÃO: a FK da 903 (`channel_id` ON DELETE SET NULL) faz dos
-- modelos dela modelos globais, e o índice global por conta recusaria o que
-- repete uma global de mesmo nome e idioma — remover a conexão daria 23505
-- (com a 903 já dava, quando o autor era o mesmo, o caso comum). O gatilho
-- `cb_channels_solta_modelos`, abaixo, apaga SÓ essa linha repetida; a global
-- fica e as outras viram globais, como antes.
--
-- RESTRITIVA (índice único que o app antigo poderia violar numa corrida):
-- aplicar DEPOIS do deploy. O CREATE INDEX trava a ESCRITA em
-- `message_templates` enquanto lê a tabela (15 linhas), e o gatilho trava a
-- escrita em `cb_channels` até o fim (milissegundos). O DROP INDEX dos por
-- autor pega a trava EXCLUSIVA (até a LEITURA de modelos espera): vem DEPOIS
-- da prova, e depois dele só conferência de catálogo (`supabase.md`).
-- Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '3s';

-- ------------------------------------------------------------
-- Conferência ANTES: duplicata por conta + número (+ global) + nome +
-- idioma. GROUP BY junta os NULL, como o NULLS NOT DISTINCT dos índices.
-- Afirmar ausência vale no banco vazio do replay.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_quantas int;
  v_lista text;
BEGIN
  SELECT count(*), string_agg(chave, E'\n  ' ORDER BY chave)
    INTO v_quantas, v_lista
    FROM (
      SELECT format(
               'conta %s, número %s, modelo %s (%s): %s linhas',
               account_id,
               coalesce(channel_id::text, 'nenhum (global)'),
               name,
               coalesce(language, 'sem idioma'),
               count(*)
             ) AS chave
        FROM public.message_templates
       GROUP BY account_id, channel_id, name, language
      HAVING count(*) > 1
    ) repetidos;

  IF v_quantas > 0 THEN
    RAISE EXCEPTION E'1150: % modelo(s) repetido(s) na mesma conta e número:\n  %\nNada foi mudado. Escolha a linha que fica, apague as outras e rode de novo.',
      v_quantas, v_lista;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_conta_canal_nome_idioma_key
  ON public.message_templates (account_id, channel_id, name, language) NULLS NOT DISTINCT
  WHERE channel_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_conta_nome_idioma_global_key
  ON public.message_templates (account_id, name, language) NULLS NOT DISTINCT
  WHERE channel_id IS NULL;

-- ------------------------------------------------------------
-- Conexão apagada: os modelos dela viram globais, menos o que REPETIRIA uma
-- global de mesmo nome e idioma — esse sai (a global fica). Nada muda na
-- Meta, e nenhuma FK aponta para `message_templates`.
--
-- As outras viram globais AQUI, e não só no SET NULL da FK: ele roda no FIM
-- da instrução, e num DELETE de várias conexões (apagar a conta, SQL à mão)
-- duas com o mesmo modelo e sem global colidiriam entre si. Anuladas aqui, a
-- conexão seguinte da mesma instrução já vê a global que a anterior deixou.
--
-- BEFORE DELETE, nunca AFTER: o SET NULL da FK roda antes dos gatilhos AFTER
-- do usuário (1077). SECURITY DEFINER com `search_path` fixo, como os outros
-- gatilhos de `cb_channels`: a remoção pela tela roda como `authenticated`,
-- e a policy de `message_templates` não decide o que sai.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_solta_modelos_da_conexao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM message_templates t
   WHERE t.channel_id = OLD.id
     AND EXISTS (
       SELECT 1
         FROM message_templates g
        WHERE g.account_id = t.account_id
          AND g.channel_id IS NULL
          AND g.name = t.name
          AND g.language IS NOT DISTINCT FROM t.language
     );
  UPDATE message_templates
     SET channel_id = NULL
   WHERE channel_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cb_channels_solta_modelos ON public.cb_channels;
CREATE TRIGGER cb_channels_solta_modelos
  BEFORE DELETE ON public.cb_channels
  FOR EACH ROW EXECUTE FUNCTION public.cb_solta_modelos_da_conexao();

-- Função de gatilho não é RPC: as duas metades do REVOKE (913/915). O gatilho
-- dispara sem EXECUTE (o privilégio é checado no CREATE TRIGGER), e quem roda
-- a função é o dono dela: não há o que conceder.
REVOKE EXECUTE ON FUNCTION public.cb_solta_modelos_da_conexao() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- A prova de verdade CHAMA a função (o corpo plpgsql só é analisado quando
-- roda). Vem ANTES do DROP INDEX: os por autor ainda de pé não a atrapalham,
-- e a trava exclusiva dele não segura a leitura de modelos durante ela.
-- Precisa de uma conta com dono — no banco vazio do replay não há o que
-- provar — e se DESFAZ pelo SQLSTATE próprio, nunca `WHEN OTHERS`, que
-- engoliria um erro de verdade. Nada é gravado: a conexão e os modelos de
-- prova somem no desfazer, e um desfazer não chega ao tempo real.
--   1. A global e a linha da conexão com o mesmo nome e idioma: apagar a
--      conexão não dá 23505, a global fica e a repetida sai.
--   2. O mesmo com idioma NULO (o índice é NULLS NOT DISTINCT).
--   3. A linha só da conexão (sem global) vira global, como antes.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_canal uuid;
  v_nome text := 'prova_1150_' || replace(gen_random_uuid()::text, '-', '');
  v_global uuid;
  v_repetida uuid;
  v_global_sem_idioma uuid;
  v_repetida_sem_idioma uuid;
  v_so_da_conexao uuid;
  v_canal_depois uuid;
BEGIN
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
   WHERE a.owner_user_id IS NOT NULL
   LIMIT 1;

  IF v_conta IS NULL THEN
    RAISE NOTICE '1150: banco sem conta, nada a provar.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.cb_channels (account_id, kind, label, server_url, instance_name, api_key)
    VALUES (v_conta, 'evolution', '1150: prova', 'https://prova.invalid', '1150-prova-' || gen_random_uuid(), 'x')
    RETURNING id INTO v_canal;

    INSERT INTO public.message_templates (account_id, channel_id, name, language, body_text, user_id)
    VALUES (v_conta, NULL, v_nome, 'pt_BR', '1150: global', v_dono)
    RETURNING id INTO v_global;
    INSERT INTO public.message_templates (account_id, channel_id, name, language, body_text, user_id)
    VALUES (v_conta, v_canal, v_nome, 'pt_BR', '1150: repetida', v_dono)
    RETURNING id INTO v_repetida;
    INSERT INTO public.message_templates (account_id, channel_id, name, language, body_text, user_id)
    VALUES (v_conta, NULL, v_nome, NULL, '1150: global sem idioma', v_dono)
    RETURNING id INTO v_global_sem_idioma;
    INSERT INTO public.message_templates (account_id, channel_id, name, language, body_text, user_id)
    VALUES (v_conta, v_canal, v_nome, NULL, '1150: repetida sem idioma', v_dono)
    RETURNING id INTO v_repetida_sem_idioma;
    INSERT INTO public.message_templates (account_id, channel_id, name, language, body_text, user_id)
    VALUES (v_conta, v_canal, v_nome || '_so', 'pt_BR', '1150: só da conexão', v_dono)
    RETURNING id INTO v_so_da_conexao;

    DELETE FROM public.cb_channels WHERE id = v_canal;

    IF (SELECT count(*) FROM public.message_templates
         WHERE id IN (v_global, v_global_sem_idioma) AND channel_id IS NULL) <> 2 THEN
      RAISE EXCEPTION '1150: a global sumiu ao apagar a conexão';
    END IF;
    IF EXISTS (SELECT 1 FROM public.message_templates
                WHERE id IN (v_repetida, v_repetida_sem_idioma)) THEN
      RAISE EXCEPTION '1150: a linha da conexão que repetia a global ficou';
    END IF;
    SELECT channel_id INTO STRICT v_canal_depois
      FROM public.message_templates WHERE id = v_so_da_conexao;
    IF v_canal_depois IS NOT NULL THEN
      RAISE EXCEPTION '1150: a linha só da conexão não virou global';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1150', MESSAGE = '1150: desfaz a prova';
  EXCEPTION WHEN SQLSTATE 'P1150' THEN
    NULL;
  END;
END $$;

-- ------------------------------------------------------------
-- Os por autor da 903 saem. Trava EXCLUSIVA de `message_templates` até o
-- COMMIT: daqui em diante, só catálogo.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS public.message_templates_user_name_lang_global_key;
DROP INDEX IF EXISTS public.message_templates_user_name_lang_channel_key;

-- ------------------------------------------------------------
-- Conferência (só catálogo; vale no banco vazio): os dois por conta existem
-- com ESTA forma, nenhum índice único da tabela ficou com `user_id` (um
-- nome diferente numa instalação deixaria o por autor de pé), e o gatilho
-- está de pé sem a função exposta como RPC.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_indexdef(c.oid) INTO v_def
    FROM pg_class c
   WHERE c.relname = 'message_templates_conta_canal_nome_idioma_key'
     AND c.relnamespace = 'public'::regnamespace;
  IF v_def IS DISTINCT FROM
     'CREATE UNIQUE INDEX message_templates_conta_canal_nome_idioma_key ON public.message_templates USING btree (account_id, channel_id, name, language) NULLS NOT DISTINCT WHERE (channel_id IS NOT NULL)'
  THEN
    RAISE EXCEPTION '1150: índice por conta e número com outra forma: %', coalesce(v_def, 'ausente');
  END IF;

  SELECT pg_get_indexdef(c.oid) INTO v_def
    FROM pg_class c
   WHERE c.relname = 'message_templates_conta_nome_idioma_global_key'
     AND c.relnamespace = 'public'::regnamespace;
  IF v_def IS DISTINCT FROM
     'CREATE UNIQUE INDEX message_templates_conta_nome_idioma_global_key ON public.message_templates USING btree (account_id, name, language) NULLS NOT DISTINCT WHERE (channel_id IS NULL)'
  THEN
    RAISE EXCEPTION '1150: índice global por conta com outra forma: %', coalesce(v_def, 'ausente');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = 'public.message_templates'::regclass
       AND i.indisunique
       AND a.attname = 'user_id'
  ) THEN
    RAISE EXCEPTION '1150: ainda há índice único com user_id em message_templates';
  END IF;

  -- tgtype: bit 0 = ROW, bit 1 = BEFORE, bit 3 = DELETE (pg_trigger.h).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'cb_channels_solta_modelos'
       AND tgrelid = 'public.cb_channels'::regclass
       AND tgfoid = 'public.cb_solta_modelos_da_conexao()'::regprocedure
       AND (tgtype & 1) = 1
       AND (tgtype & 2) = 2
       AND (tgtype & 8) = 8
  ) THEN
    RAISE EXCEPTION '1150: o gatilho BEFORE DELETE de cb_channels não está de pé';
  END IF;
  IF has_function_privilege('anon', 'public.cb_solta_modelos_da_conexao()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_solta_modelos_da_conexao()', 'EXECUTE') THEN
    RAISE EXCEPTION '1150: função de gatilho exposta como RPC';
  END IF;
END $$;
