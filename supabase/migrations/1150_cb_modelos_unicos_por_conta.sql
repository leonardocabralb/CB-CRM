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
-- inserir e tratam o 23505.
--
-- RESTRITIVA (índice único que o app antigo poderia violar numa corrida):
-- aplicar DEPOIS do deploy. O CREATE INDEX trava a ESCRITA em
-- `message_templates` enquanto lê a tabela (15 linhas). Idempotente.
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

DROP INDEX IF EXISTS public.message_templates_user_name_lang_global_key;
DROP INDEX IF EXISTS public.message_templates_user_name_lang_channel_key;

-- ------------------------------------------------------------
-- Conferência (só catálogo; vale no banco vazio): os dois por conta existem
-- com ESTA forma, e nenhum índice único da tabela ficou com `user_id` (um
-- nome diferente numa instalação deixaria o por autor de pé).
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
END $$;
