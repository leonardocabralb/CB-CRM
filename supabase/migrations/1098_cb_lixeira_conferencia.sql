-- ============================================================
-- 1098 — A conferência da Lixeira de contatos (a ida e volta da 1097)
--
-- Fase 2 de docs/PLANO-lixeira-de-contatos.md. Só PROVA: não muda o schema.
--
-- Separada da 1097 de propósito (revisão de 23/10/2026): a ida e volta numa
-- ficha fictícia — prévia, mover, restaurar, mover de novo e "Excluir agora"
-- com pedido — roda as funções novas sobre as tabelas de verdade. Dentro da
-- 1097 ela rodaria DEPOIS das ALTERs, segurando a trava ACCESS EXCLUSIVE de
-- `conversations`, `automation_logs` e `cb_lead_events` (a caixa de entrada
-- inteira parada esperando), e a regra é "depois da primeira ALTER, só
-- catálogo" (supabase.md). Aqui, só travas de linha da ficha fictícia.
--
-- Aplicar LOGO DEPOIS da 1097 (antes do deploy). Tudo é desfeito no fim
-- pelo SQLSTATE próprio (P1098) — nunca `WHEN OTHERS`, que engoliria o
-- defeito. No banco vazio do replay, pula com NOTICE.
-- ============================================================

DO $$
DECLARE
  v_conta uuid;
  v_dono uuid;
  v_contato uuid;
  v_conversa uuid;
  v_msg uuid;
  v_tag uuid;
  v_ret jsonb;
  v_item uuid;
  v_espera timestamptz;
  v_c record;
BEGIN
  SELECT a.id, a.owner_user_id INTO v_conta, v_dono
    FROM public.accounts a
    JOIN public.profiles p ON p.user_id = a.owner_user_id AND p.account_id = a.id
   WHERE p.suspenso_em IS NULL
   ORDER BY a.created_at
   LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1098: banco vazio, a Lixeira não foi exercitada.';
    RETURN;
  END IF;
  SELECT t.id INTO v_tag FROM public.tags t WHERE t.account_id = v_conta ORDER BY t.created_at LIMIT 1;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_dono::text, true);
    INSERT INTO public.contacts (user_id, account_id, phone, name)
    VALUES (v_dono, v_conta, '5500' || lpad((floor(random() * 1e9))::bigint::text, 9, '0'), 'Fulano Conferencia 1098')
    RETURNING id INTO v_contato;
    INSERT INTO public.conversations (user_id, account_id, contact_id, status)
    VALUES (v_dono, v_conta, v_contato, 'closed')
    RETURNING id INTO v_conversa;
    INSERT INTO public.messages (conversation_id, sender_type, content_type, content_text, created_at)
    VALUES (v_conversa, 'customer', 'text', 'oi', now() - interval '3 days')
    RETURNING id INTO v_msg;
    IF v_tag IS NOT NULL THEN
      INSERT INTO public.contact_tags (contact_id, tag_id) VALUES (v_contato, v_tag);
    END IF;

    SELECT aguardando_desde INTO v_espera FROM public.conversations WHERE id = v_conversa;

    v_ret := public.cb_previa_da_lixeira(ARRAY[v_contato]);
    IF (v_ret -> 0 ->> 'mensagens')::int <> 1 THEN
      RAISE EXCEPTION '1098: a prévia contou errado: %', v_ret;
    END IF;

    v_ret := public.cb_mover_contatos_para_lixeira(ARRAY[v_contato]);
    IF v_ret -> 'itens' -> 0 ->> 'resultado' <> 'movida' THEN
      RAISE EXCEPTION '1098: mover não moveu: %', v_ret;
    END IF;
    IF EXISTS (SELECT 1 FROM public.contacts WHERE id = v_contato)
       OR EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conversa) THEN
      RAISE EXCEPTION '1098: a ficha movida ficou de pé';
    END IF;
    SELECT x.id INTO v_item FROM public.cb_lixeira_de_contatos x WHERE x.contact_id = v_contato;
    IF v_item IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.cb_lead_events
          WHERE event_type = 'contact_trashed' AND details ->> 'item_id' = v_item::text) THEN
      RAISE EXCEPTION '1098: o item ou o rastro do mover não ficou';
    END IF;

    v_ret := public.cb_restaurar_da_lixeira(ARRAY[v_item]);
    IF v_ret -> 'itens' -> 0 ->> 'resultado' <> 'restaurada' THEN
      RAISE EXCEPTION '1098: restaurar não restaurou: %', v_ret;
    END IF;
    SELECT v.status, v.aguardando_desde, v.restaurada_em,
           (SELECT count(*) FROM public.messages m WHERE m.conversation_id = v.id) AS msgs,
           (SELECT count(*) FROM public.contact_tags t WHERE t.contact_id = v_contato) AS tags,
           (SELECT count(*) FROM public.cb_lead_events e
             WHERE e.contact_id = v_contato AND e.event_type = 'contact_trashed') AS rastro
      INTO v_c
      FROM public.conversations v WHERE v.id = v_conversa AND v.contact_id = v_contato;
    IF v_c.status IS DISTINCT FROM 'closed' OR v_c.aguardando_desde IS DISTINCT FROM v_espera
       OR v_c.restaurada_em IS NULL OR v_c.msgs <> 1
       OR v_c.tags <> (CASE WHEN v_tag IS NULL THEN 0 ELSE 1 END) OR v_c.rastro <> 1 THEN
      RAISE EXCEPTION '1098: a volta não trouxe tudo como estava: %', row_to_json(v_c);
    END IF;

    -- E de vez: a linha sai, o rastro fica sem nome.
    v_ret := public.cb_mover_contatos_para_lixeira(ARRAY[v_contato]);
    SELECT x.id INTO v_item FROM public.cb_lixeira_de_contatos x WHERE x.contact_id = v_contato;
    v_ret := public.cb_excluir_da_lixeira(ARRAY[v_item], true);
    IF v_ret -> 'itens' -> 0 ->> 'resultado' <> 'excluida'
       OR EXISTS (SELECT 1 FROM public.cb_lixeira_de_contatos WHERE id = v_item)
       OR NOT EXISTS (SELECT 1 FROM public.cb_lead_events
                       WHERE event_type = 'contact_purged' AND details ->> 'item_id' = v_item::text
                         AND contact_id IS NULL AND contact_label IS NULL) THEN
      RAISE EXCEPTION '1098: excluir agora falhou: %', v_ret;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1098', MESSAGE = 'desfaz a conferência';
  EXCEPTION WHEN SQLSTATE 'P1098' THEN
    RAISE NOTICE '1098: Lixeira conferida numa ficha fictícia (desfeita) — etiqueta: %.', v_tag IS NOT NULL;
  END;
END $$;
