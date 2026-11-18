-- ============================================================================
-- 1151 — Disparo: ENTREGA INCERTA no destinatário (`uncertain`), e o envio
-- que pode ter saído nunca é reenviado (regra 8e do CLAUDE.md; achado da
-- revisão do Lote F, docs/PLANO-porte-upstream-2026-11.md §13)
-- ============================================================================
-- Até aqui o destinatário só sabia dizer "saiu" (`sent` e acima) ou "falhou"
-- (`failed`), e o "Tentar de novo os que falharam" da tela da campanha reenvia
-- todo `failed`. Três caminhos gravavam `failed` sobre o que PODE ter saído:
--
--  - o lote do assistente cuja CHAMADA falhava (rede, tempo esgotado, servidor
--    reiniciando) marcava `failed` as linhas ainda pendentes — e a rota podia
--    já ter mandado à Meta, ou seguir mandando depois de o navegador desistir;
--  - a rota do lote e o envio pelo servidor (`deliverBroadcast`: Retomar,
--    "Tentar de novo", API v1) gravavam `failed` também no 5xx da Meta, no tempo
--    esgotado e no erro de rede, em que a Meta pode ter aceitado.
--
-- Cada reenvio desses é um modelo PAGO chegando em dobro ao cliente.
--
-- `uncertain` é o terceiro estado: nem enviado nem falhou. Quem envia (a rota
-- do lote e `deliverBroadcast`) RESERVA a linha — `pending` (ou o escopo da
-- retomada) → `uncertain` — ANTES de chamar a Meta, e depois grava o que
-- aprendeu: `sent` (a Meta aceitou), `failed` (recusa comprovada, 4xx) ou deixa
-- `uncertain` (5xx, sem resposta, processo que morreu no meio). Nenhum escopo
-- de reenvio inclui `uncertain` (`broadcast-resume.ts`), e a tela a mostra à
-- parte, com a frase "pode ter chegado".
--
-- Os contadores de `broadcasts` NÃO mudam: `_bcast_cols_for_status` (0005)
-- devolve `{}` para o estado que não conhece, então a incerta não entra em
-- `sent_count` nem em `failed_count` (o mesmo que `pending`), sem tocar nas
-- funções SECURITY DEFINER da 1066. A conferência prova isso.
--
-- O CHECK foi escrito INLINE na 0001, com nome dado pelo Postgres
-- (`broadcast_recipients_status_check`, conferido na produção): o DROP é pela
-- FORMA (`status = ANY (ARRAY[…`, como o Postgres renderiza `status IN (…)`) e
-- o ADD dá o nome — o modelo da 989. Um DROP pelo nome que não casasse deixaria
-- o CHECK velho de pé, e toda reserva seria recusada.
--
-- ADITIVA: aplicar ANTES do deploy. O app de hoje nunca grava `uncertain` e
-- segue igual; o app novo reserva TODA linha antes de enviar, e sem o CHECK
-- alargado a reserva falha e o disparo não manda nada.
--
-- Conferência: um CHECK de status só, com os sete estados; a incerta fora dos
-- contadores; e, havendo destinatário de conta com admin, a RESERVA feita como
-- esse admin (`authenticated`, sob a RLS da 964 — o caminho da rota do lote),
-- com um estado fora da lista recusado, tudo desfeito pelo SQLSTATE P1151.
-- ============================================================================

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.broadcast_recipients'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ~ 'status = ANY \(ARRAY\['
  LOOP
    EXECUTE format('ALTER TABLE public.broadcast_recipients DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'uncertain'));

COMMENT ON COLUMN public.broadcast_recipients.status IS
  'pending = não saiu (nada foi tentado); sent/delivered/read/replied = a escada do recibo; failed = não chegou (recusa comprovada, nada a enviar, ou o recibo de falha da Meta; antes da 1151 também o que podia ter saído — na produção, nenhuma linha assim em 18/11/2026); uncertain = PODE ter saído (reservada antes da Meta e sem resposta que confirme) — nenhum reenvio a pega. 1151.';

-- A rota do lote reserva e anota como quem disparou (`authenticated`, sob a
-- RLS da 964). Na produção isto já vale pelo padrão do Supabase; em banco
-- novo, a migration concede o que a conferência abaixo exercita.
GRANT SELECT, UPDATE ON TABLE public.broadcast_recipients TO authenticated;

-- ----------------------------------------------------------------------------
-- Conferência
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_checks       INTEGER;
  v_def          TEXT;
  v_estado       TEXT;
  v_destinatario UUID;
  v_admin        UUID;
  v_reservadas   INTEGER;
BEGIN
  -- 1. Um CHECK de status só, e ele lista os sete estados.
  SELECT count(*) INTO v_checks
    FROM pg_constraint
   WHERE conrelid = 'public.broadcast_recipients'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'status = ANY \(ARRAY\[';
  IF v_checks <> 1 THEN
    RAISE EXCEPTION '1151: broadcast_recipients ficou com % CHECKs de status (esperado 1)', v_checks;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.broadcast_recipients'::regclass
     AND conname = 'broadcast_recipients_status_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1151: broadcast_recipients_status_check não existe';
  END IF;
  FOREACH v_estado IN ARRAY ARRAY['pending', 'sent', 'delivered', 'read', 'replied', 'failed', 'uncertain'] LOOP
    IF position(quote_literal(v_estado) IN v_def) = 0 THEN
      RAISE EXCEPTION '1151: o CHECK de status não aceita %', v_estado;
    END IF;
  END LOOP;

  -- 2. A incerta não entra em contador nenhum (nem enviado, nem falhou).
  IF public._bcast_cols_for_status('uncertain') <> ARRAY[]::TEXT[] THEN
    RAISE EXCEPTION '1151: _bcast_cols_for_status conta a incerta em %',
      public._bcast_cols_for_status('uncertain');
  END IF;

  -- 3. Com dado: a RESERVA como o admin da conta (o caminho da rota do lote),
  --    e um estado fora da lista recusado. Desfeito pelo SQLSTATE próprio.
  --    Roda depois do ALTER, com a trava exclusiva: QUALQUER linha serve —
  --    sem ORDER BY, a leitura para na primeira (sem varrer nem ordenar).
  SELECT r.id, p.user_id
    INTO v_destinatario, v_admin
    FROM public.broadcast_recipients r
    JOIN public.broadcasts b ON b.id = r.broadcast_id
    JOIN public.profiles p
      ON p.account_id = b.account_id
     AND p.account_role IN ('owner', 'admin')
     AND p.suspenso_em IS NULL
   LIMIT 1;
  IF v_destinatario IS NULL THEN
    RAISE NOTICE '1151: sem destinatário de conta com admin — conferido só o catálogo.';
    RETURN;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    UPDATE public.broadcast_recipients
       SET status = 'uncertain', error_message = NULL
     WHERE id = v_destinatario;
    GET DIAGNOSTICS v_reservadas = ROW_COUNT;
    IF v_reservadas <> 1 THEN
      RAISE EXCEPTION '1151: o admin não conseguiu reservar o destinatário (% linhas)', v_reservadas;
    END IF;

    BEGIN
      UPDATE public.broadcast_recipients
         SET status = 'estado_que_nao_existe'
       WHERE id = v_destinatario;
      RAISE EXCEPTION '1151: o CHECK aceitou um estado fora da lista';
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;

    RAISE EXCEPTION USING ERRCODE = 'P1151', MESSAGE = 'desfaz a conferência (com dado)';
  EXCEPTION
    -- Só o SQLSTATE próprio: `WHEN OTHERS` engoliria o erro que a prova existe
    -- para mostrar.
    WHEN SQLSTATE 'P1151' THEN
      RAISE NOTICE '1151: reserva como admin aceita e estado fora da lista recusado (desfeito).';
  END;
END $$;
