-- ============================================================
-- 1066 — Os contadores do disparo só pelo servidor.
--
-- `_bcast_bump(uuid, text, integer)` (0005) e
-- `recompute_broadcast_counts(uuid)` (0003, reescrita na 0005) são do
-- upstream e mantêm os números de `broadcasts` (enviadas, entregues, lidas,
-- respondidas, falhas). As duas são SECURITY DEFINER — rodam como dono, por
-- cima da RLS — e nunca tiveram o EXECUTE fechado. MEDIDO em produção em
-- 29/09/2026, igual nas duas:
--
--   proacl = {=X/postgres, postgres=X/postgres, anon=X/postgres,
--             authenticated=X/postgres, service_role=X/postgres}
--             ^^ PUBLIC       e, além dele, anon e authenticated explícitos
--
-- `_bcast_bump` monta `UPDATE broadcasts SET <col> = GREATEST(0, <col> +
-- delta) WHERE id = bid` com a COLUNA vinda de quem chama e sem conferir conta
-- nenhuma. Com a chave anônima (que viaja no navegador de todo mundo) e o id
-- de uma campanha, qualquer pessoa, sem login, mudava por
-- `POST /rest/v1/rpc/_bcast_bump` os números de uma campanha de QUALQUER
-- conta — ou o `total_recipients`, a outra coluna inteira da linha.
-- `recompute_broadcast_counts` recalcula os contadores de qualquer campanha:
-- grava o que a tabela de destinatários diz, mas é escrita alheia por cima da
-- RLS. O assessor de segurança do Supabase acusava as duas (lints 0028/0029).
--
-- Quem chama as duas é SÓ a função do gatilho `broadcast_recipients_aggregate`
-- (`broadcast_recipient_aggregate_trigger()`, 0005), por PERFORM. Conferido no
-- repositório (nenhum `.rpc()`, nenhum script) e no catálogo de produção
-- (nenhuma outra função cita os dois nomes).
--
-- ⚠️⚠️ O REVOKE só é seguro porque a função do GATILHO é SECURITY DEFINER.
-- O EXECUTE da função chamada é conferido NA CHAMADA, contra o papel efetivo,
-- e dentro de uma SECURITY DEFINER o papel efetivo é o DONO dela (postgres),
-- cujo EXECUTE (`postgres=X/postgres`) o REVOKE não toca. O navegador grava em
-- `broadcast_recipients` como `authenticated`, sob RLS
-- (`use-broadcast-sending.ts`: insere os destinatários e marca cada envio); se
-- a função do gatilho fosse SECURITY INVOKER, esse INSERT/UPDATE passaria a
-- falhar com 42501 e o disparo pela tela pararia. Por isso a conferência abaixo
-- EXIGE que toda função que chama as duas seja SECURITY DEFINER e que o dono
-- dela continue executando as duas. A prova trocando de papel (INSERT, UPDATE
-- e DELETE como `authenticated` disparando o gatilho, com os donos, as
-- policies e as definições de produção) foi feita num Postgres descartável,
-- com o mutante — a função do gatilho como INVOKER — dando 42501 no mesmo
-- UPDATE e reprovando esta conferência.
--
-- ⚠️ As DUAS metades do REVOKE — PUBLIC E os papéis —, porque o `proacl`
-- acima tem as duas formas ao mesmo tempo (a 903/912 e a 914 erraram cada uma
-- uma metade; ver a 913 e a 915). E o GRANT de volta ao service_role por
-- escrito: em banco NOVO o EXECUTE nasce em PUBLIC, e revogar de PUBLIC levaria
-- o do service_role junto. A 0005 guarda `recompute_broadcast_counts` como
-- "rede de segurança" para acertar contador à mão: continua servindo, pelo SQL
-- do dono ou pelo service_role.
--
-- Restritiva, mas sem dependência de deploy: nenhum app, o de hoje ou o
-- anterior, chama as duas. Pode entrar antes ou depois do merge.
--
-- Fora, de propósito: `broadcast_recipient_aggregate_trigger()` (também
-- SECURITY DEFINER e aberta a anon no catálogo) retorna `trigger`, e o Postgres
-- recusa chamá-la fora de um gatilho (0A000, medido no descartável); e
-- `_bcast_cols_for_status(text)` é IMMUTABLE, sem acesso a tabela.
--
-- Idempotente: REVOKE/GRANT repetidos são no-op. Não recria nenhuma função (os
-- corpos são os da 0005, intocados), então não há corpo novo a CHAMAR — a
-- conferência prova os PRIVILÉGIOS, trocando de papel onde a migration consegue.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid) TO service_role;

-- ------------------------------------------------------------
-- Conferência. Confere o RESULTADO, não a intenção.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_bump         regprocedure := to_regprocedure('public._bcast_bump(uuid,text,integer)');
  v_recompute    regprocedure := to_regprocedure('public.recompute_broadcast_counts(uuid)');
  -- O papel de quem aplica. Volta-se a ele com SET LOCAL (some no fim da
  -- transação), nunca com RESET ROLE, que troca para o usuário da SESSÃO e
  -- fica valendo depois do commit.
  v_eu           text := current_user;
  v_funcao       regprocedure;
  v_papel        text;
  v_quebra       text;
  v_bump_ok      boolean;
  v_recompute_ok boolean;
BEGIN
  IF v_bump IS NULL THEN
    RAISE EXCEPTION '1066: _bcast_bump(uuid, text, integer) não existe';
  END IF;
  IF v_recompute IS NULL THEN
    RAISE EXCEPTION '1066: recompute_broadcast_counts(uuid) não existe';
  END IF;

  -- `anon` herda o que PUBLIC tem: false aqui prova as DUAS metades.
  FOREACH v_funcao IN ARRAY ARRAY[v_bump, v_recompute] LOOP
    IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION '1066: anon ainda executa %', v_funcao;
    END IF;
    IF has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION '1066: authenticated ainda executa %', v_funcao;
    END IF;
    IF NOT has_function_privilege('service_role', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION '1066: o service_role perdeu o EXECUTE de %', v_funcao;
    END IF;
  END LOOP;

  -- A armadilha: toda função que chama as duas (hoje, só a do gatilho) tem de
  -- ser SECURITY DEFINER, com um dono que continue executando as duas. Uma
  -- SECURITY INVOKER falharia com 42501 para quem a aciona — no gatilho, o
  -- navegador gravando destinatários como `authenticated`.
  SELECT string_agg(format('%s (dono %s, %s)', p.oid::regprocedure,
                           pg_get_userbyid(p.proowner),
                           CASE WHEN p.prosecdef THEN 'dono sem EXECUTE' ELSE 'SECURITY INVOKER' END),
                    '; ')
    INTO v_quebra
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid NOT IN (v_bump, v_recompute)
     AND p.prosrc ~ '(_bcast_bump|recompute_broadcast_counts)'
     AND NOT (p.prosecdef
              AND has_function_privilege(p.proowner, v_bump, 'EXECUTE')
              AND has_function_privilege(p.proowner, v_recompute, 'EXECUTE'));
  IF v_quebra IS NOT NULL THEN
    RAISE EXCEPTION '1066: função que chama os contadores deixaria de funcionar: %', v_quebra;
  END IF;

  -- Trocando de papel, como o PostgREST faria. O id é sorteado: o UPDATE de
  -- dentro das funções não acha linha nenhuma, então nada muda no banco.
  -- O SET ROLE fica FORA do bloco que captura 42501: "não pude assumir o
  -- papel" também é 42501, e capturado ali passaria por "fechada" sem ter
  -- chamado nada.
  FOREACH v_papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT pg_has_role(v_papel::name, 'MEMBER') THEN
      RAISE NOTICE '1066: % não assume o papel %; a troca de papel fica provada só pelo catálogo.', current_user, v_papel;
      CONTINUE;
    END IF;

    EXECUTE format('SET LOCAL ROLE %I', v_papel);
    BEGIN
      PERFORM public._bcast_bump(gen_random_uuid(), 'sent_count', 0);
      v_bump_ok := true;
    EXCEPTION WHEN insufficient_privilege THEN
      v_bump_ok := false;
    END;
    BEGIN
      PERFORM public.recompute_broadcast_counts(gen_random_uuid());
      v_recompute_ok := true;
    EXCEPTION WHEN insufficient_privilege THEN
      v_recompute_ok := false;
    END;
    EXECUTE format('SET LOCAL ROLE %I', v_eu);

    IF v_bump_ok THEN
      RAISE EXCEPTION '1066: % conseguiu chamar _bcast_bump', v_papel;
    END IF;
    IF v_recompute_ok THEN
      RAISE EXCEPTION '1066: % conseguiu chamar recompute_broadcast_counts', v_papel;
    END IF;
  END LOOP;

  IF NOT pg_has_role('service_role', 'MEMBER') THEN
    RAISE NOTICE '1066: % não assume o papel service_role; a chamada fica provada só pelo catálogo.', current_user;
  ELSE
    SET LOCAL ROLE service_role;
    BEGIN
      PERFORM public._bcast_bump(gen_random_uuid(), 'sent_count', 0);
      PERFORM public.recompute_broadcast_counts(gen_random_uuid());
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION '1066: service_role não consegue chamar os contadores: %', SQLERRM;
    END;
    EXECUTE format('SET LOCAL ROLE %I', v_eu);
  END IF;

  RAISE NOTICE '1066: _bcast_bump e recompute_broadcast_counts fechadas para anon/authenticated; service_role executa; quem as chama roda como dono.';
END $$;
