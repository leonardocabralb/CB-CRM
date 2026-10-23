-- ============================================================
-- 1099 — A Lixeira só anula o ponteiro que ainda aponta para a ficha
--
-- Correção da 1097 (revisão do PR #429, 23/10/2026). `cb_lixeira_anular`
-- anulava cada ponteiro fotografado (negócio, evento, reunião… que aponta
-- para a ficha movida) só pela CHAVE da linha. Entre a fotografia
-- (`cb_lixeira_ponteiros`) e o UPDATE a linha de fora não está travada —
-- trocar o `contact_id` de um negócio para OUTRA ficha trava a ficha nova,
-- não a que está sendo movida —, e um pedido concorrente que mudasse o
-- ponteiro nesse intervalo teria a troca apagada em silêncio (e a
-- restauração religaria a linha à ficha antiga).
--
-- Agora o UPDATE confere também o VALOR fotografado (`v` de cada linha, com
-- `IS NOT DISTINCT FROM`): a linha cujo ponteiro mudou fica como o outro
-- pedido deixou. No READ COMMITTED, o UPDATE relê a versão mais nova da
-- linha que esperou e reavalia o WHERE — a troca que comitou primeiro vence.
--
-- Limite que fica: o ponteiro pulado continua na lista `ponteiros` do item.
-- A restauração só religa linha cujo ponteiro está NULO
-- (`cb_lixeira_reapontar`); só se a outra ficha também sumir até lá a linha
-- voltaria para a restaurada.
--
-- ADITIVA (mesma assinatura): aplicar ANTES do deploy do PR #429.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cb_lixeira_anular(p jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_tabela regclass := ('public.' || quote_ident(p ->> 'tabela'))::regclass;
  v_anula text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'anula'));
  v_pk text[] := ARRAY(SELECT jsonb_array_elements_text(p -> 'pk'));
  v_n integer;
BEGIN
  -- `k` traz a chave E o valor fotografado do ponteiro (`v`): só sai a linha
  -- que ainda aponta para a ficha movida.
  EXECUTE format(
    'UPDATE %1$s f SET (%2$s) = ROW(%3$s)
       FROM jsonb_array_elements($1) AS e(r), LATERAL jsonb_populate_record(NULL::%1$s, (e.r -> ''pk'') || (e.r -> ''v'')) k
      WHERE %4$s AND %5$s',
    v_tabela,
    (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_anula) c),
    (SELECT string_agg('NULL', ', ') FROM unnest(v_anula) c),
    (SELECT string_agg('f.' || quote_ident(c) || ' = k.' || quote_ident(c), ' AND ') FROM unnest(v_pk) c),
    (SELECT string_agg('f.' || quote_ident(c) || ' IS NOT DISTINCT FROM k.' || quote_ident(c), ' AND ') FROM unnest(v_anula) c))
  USING p -> 'linhas';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Interna: só as funções da Lixeira a chamam (as SECURITY DEFINER rodam
-- como o dono), sem concessão a ninguém — como na 1097. `CREATE OR REPLACE`
-- mantém o ACL; o REVOKE repetido só deixa a intenção escrita.
REVOKE EXECUTE ON FUNCTION public.cb_lixeira_anular(jsonb) FROM PUBLIC, anon, authenticated;

-- Conferência: a função CHAMADA (o corpo só é analisado quando roda), num
-- subbloco desfeito por SQLSTATE próprio (P1099). Com dado: um aviso do sino
-- de uma ficha fictícia que "outro pedido" passou para outra ficha não é
-- anulado; o que ainda aponta, é. No banco vazio, só a chamada sem linhas.
DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_a uuid;
  v_b uuid;
  v_aviso uuid;
  v_n integer;
  v_atual uuid;
BEGIN
  IF has_function_privilege('anon', 'public.cb_lixeira_anular(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_lixeira_anular(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '1099: cb_lixeira_anular ficou aberta ao navegador';
  END IF;

  PERFORM public.cb_lixeira_anular(jsonb_build_object(
    'tabela', 'notifications', 'anula', jsonb_build_array('contact_id'),
    'pk', jsonb_build_array('id'), 'linhas', '[]'::jsonb));

  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
    JOIN public.profiles p ON p.user_id = a.owner_user_id AND p.account_id = a.id
   ORDER BY a.created_at
   LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1099: banco vazio, só a chamada sem linhas.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.contacts (user_id, account_id, phone, name)
    VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano Conferencia 1099 A')
    RETURNING id INTO v_a;
    INSERT INTO public.contacts (user_id, account_id, phone, name)
    VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano Conferencia 1099 B')
    RETURNING id INTO v_b;
    INSERT INTO public.notifications (account_id, user_id, contact_id, title)
    VALUES (v_conta, v_dono, v_a, 'Conferencia 1099')
    RETURNING id INTO v_aviso;

    -- "Outro pedido" troca o ponteiro depois da fotografia (que viu A).
    UPDATE public.notifications SET contact_id = v_b WHERE id = v_aviso;
    v_n := public.cb_lixeira_anular(jsonb_build_object(
      'tabela', 'notifications', 'anula', jsonb_build_array('contact_id'),
      'pk', jsonb_build_array('id'),
      'linhas', jsonb_build_array(jsonb_build_object(
        'pk', jsonb_build_object('id', v_aviso), 'v', jsonb_build_object('contact_id', v_a)))));
    SELECT contact_id INTO v_atual FROM public.notifications WHERE id = v_aviso;
    IF v_n <> 0 OR v_atual IS DISTINCT FROM v_b THEN
      RAISE EXCEPTION '1099: a troca do outro pedido foi apagada (% linha, ficou %)', v_n, v_atual;
    END IF;

    -- O ponteiro que ainda aponta para a ficha sai.
    v_n := public.cb_lixeira_anular(jsonb_build_object(
      'tabela', 'notifications', 'anula', jsonb_build_array('contact_id'),
      'pk', jsonb_build_array('id'),
      'linhas', jsonb_build_array(jsonb_build_object(
        'pk', jsonb_build_object('id', v_aviso), 'v', jsonb_build_object('contact_id', v_b)))));
    SELECT contact_id INTO v_atual FROM public.notifications WHERE id = v_aviso;
    IF v_n <> 1 OR v_atual IS NOT NULL THEN
      RAISE EXCEPTION '1099: o ponteiro que ainda apontava não foi anulado (% linha, ficou %)', v_n, v_atual;
    END IF;

    RAISE SQLSTATE 'P1099';
  EXCEPTION WHEN SQLSTATE 'P1099' THEN
    RAISE NOTICE '1099: a Lixeira só anula o ponteiro que ainda aponta para a ficha.';
  END;
END $$;
