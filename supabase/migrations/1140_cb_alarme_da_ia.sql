-- ============================================================
-- 1140 — O ALARME quando a IA para de responder (créditos, chave, modelo,
-- provedor fora do ar).
--
-- Pedido do operador (12/11/2026; plano em
-- docs/PLANO-alarme-quando-a-ia-para.md): com os agentes ligados, se os
-- créditos da Anthropic acabassem, a chave fosse recusada ou o provedor
-- caísse, o turno terminava `falhou` (E8: não pausa, não transfere) e
-- NINGUÉM era avisado — só a conversa ficava "em atraso". Decisões F1–F3:
-- alarme no sino e na tela (um por problema, lembra a cada 6 h, diz quando
-- normalizou); a IA NÃO é pausada (o alarme leva às clientes "Em atraso");
-- recebem o dono, os admins e os marcados dos agentes daquele provedor.
--
--   notifications.type   ganha 'ia_falhou' (o alarme, que abre a caixinha
--                        VERMELHA na tela) e 'ia_voltou' (só o sino). Mesma
--                        mecânica da 919/944/1075/1085/1139: a lista inteira
--                        reescrita, a conferência prova os antigos.
--
--   cb_ia_alarmes        UM episódio por (conta, provedor): a chave e os
--                        créditos são do PROVEDOR, então todos os agentes dele
--                        param juntos. `desde` = a 1ª falha do episódio;
--                        `falhas` = quantas respostas não saíram nele;
--                        `ultimo_aviso_em` = o último aviso gravado (a 1ª
--                        falha e os lembretes); `normalizou_em` fecha o
--                        episódio (a 1ª geração que deu certo depois). FECHADA
--                        ao navegador: RLS ligada, nenhuma policy, só o
--                        service_role (o turno roda com ele).
--
--   cb_ia_registrar_falha(conta, provedor, motivo, lembrar_apos_min)
--                        decide, SOB TRAVA DA LINHA, se a falha abre o
--                        episódio ('abriu'), se é hora do lembrete
--                        ('continua') ou se só conta ('nada'). Dois processos
--                        falhando juntos não abrem dois avisos: o INSERT
--                        perdido (23505) relê a linha travada.
--
-- ADITIVA: aplicar ANTES do deploy (o app novo grava os tipos e chama a
-- função; sem ela, o alarme falha em log e a resposta da IA segue igual —
-- melhor esforço). O app antigo não conhece nada disto. Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned',
    'note_mention',
    'note_reply',
    'task_assigned',
    'task_reply',
    'whatsapp_alert',
    'ia_transferiu',
    'ia_falhou',
    'ia_voltou'
  ));

CREATE TABLE IF NOT EXISTS public.cb_ia_alarmes (
  account_id      uuid        NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  provedor        text        NOT NULL,
  desde           timestamptz NOT NULL,
  ultima_falha_em timestamptz NOT NULL,
  ultimo_aviso_em timestamptz NOT NULL,
  falhas          integer     NOT NULL DEFAULT 1,
  motivo          text        NOT NULL,
  normalizou_em   timestamptz,
  CONSTRAINT cb_ia_alarmes_pkey PRIMARY KEY (account_id, provedor),
  CONSTRAINT cb_ia_alarmes_provedor_ck CHECK (provedor IN ('openai', 'anthropic', 'gemini')),
  CONSTRAINT cb_ia_alarmes_falhas_ck CHECK (falhas >= 1)
);

COMMENT ON TABLE public.cb_ia_alarmes IS
  'O alarme quando a IA para de responder (1140): um episódio por (conta, provedor). Escrito só pelo servidor (cb_ia_registrar_falha e o fechamento em normalizou_em). Fechada ao navegador.';

ALTER TABLE public.cb_ia_alarmes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_ia_alarmes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cb_ia_alarmes TO service_role;

CREATE OR REPLACE FUNCTION public.cb_ia_registrar_falha(
  p_conta uuid,
  p_provedor text,
  p_motivo text,
  p_lembrar_apos_min integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v public.cb_ia_alarmes%ROWTYPE;
BEGIN
  LOOP
    SELECT * INTO v
      FROM public.cb_ia_alarmes
     WHERE account_id = p_conta AND provedor = p_provedor
       FOR UPDATE;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.cb_ia_alarmes (account_id, provedor, desde, ultima_falha_em, ultimo_aviso_em, falhas, motivo)
        VALUES (p_conta, p_provedor, now(), now(), now(), 1, p_motivo);
        RETURN jsonb_build_object('acao', 'abriu', 'desde', now(), 'falhas', 1);
      EXCEPTION WHEN unique_violation THEN
        -- Outro processo abriu o episódio no mesmo instante: relê, travado.
        NULL;
      END;
    ELSIF v.normalizou_em IS NOT NULL THEN
      -- O episódio anterior tinha fechado: este é um NOVO.
      UPDATE public.cb_ia_alarmes
         SET desde = now(), ultima_falha_em = now(), ultimo_aviso_em = now(),
             falhas = 1, motivo = p_motivo, normalizou_em = NULL
       WHERE account_id = p_conta AND provedor = p_provedor;
      RETURN jsonb_build_object('acao', 'abriu', 'desde', now(), 'falhas', 1);
    ELSIF v.ultimo_aviso_em <= now() - make_interval(mins => p_lembrar_apos_min) THEN
      UPDATE public.cb_ia_alarmes
         SET ultima_falha_em = now(), ultimo_aviso_em = now(),
             falhas = v.falhas + 1, motivo = p_motivo
       WHERE account_id = p_conta AND provedor = p_provedor;
      RETURN jsonb_build_object('acao', 'continua', 'desde', v.desde, 'falhas', v.falhas + 1);
    ELSE
      UPDATE public.cb_ia_alarmes
         SET ultima_falha_em = now(), falhas = v.falhas + 1, motivo = p_motivo
       WHERE account_id = p_conta AND provedor = p_provedor;
      RETURN jsonb_build_object('acao', 'nada', 'desde', v.desde, 'falhas', v.falhas + 1);
    END IF;
  END LOOP;
END
$$;

REVOKE EXECUTE ON FUNCTION public.cb_ia_registrar_falha(uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_ia_registrar_falha(uuid, text, text, integer) TO service_role;

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def      text;
  v_politicas int;
  v_conta    uuid;
  v_r        jsonb;
  v_estado   text;
BEGIN
  -- 1. O CHECK do sino conhece os dois tipos novos e NÃO perdeu nenhum antigo.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1140: notifications_type_check sumiu.';
  END IF;
  IF v_def NOT LIKE '%ia_falhou%' OR v_def NOT LIKE '%ia_voltou%' THEN
    RAISE EXCEPTION '1140: notifications_type_check não conhece ia_falhou/ia_voltou (def=%)', v_def;
  END IF;
  IF v_def NOT LIKE '%conversation_assigned%' OR v_def NOT LIKE '%note_mention%'
     OR v_def NOT LIKE '%note_reply%' OR v_def NOT LIKE '%task_assigned%'
     OR v_def NOT LIKE '%task_reply%' OR v_def NOT LIKE '%whatsapp_alert%'
     OR v_def NOT LIKE '%ia_transferiu%' THEN
    RAISE EXCEPTION '1140: notifications_type_check PERDEU tipo antigo (def=%)', v_def;
  END IF;

  -- 2. A tabela FECHADA ao navegador: RLS ligada, nenhuma policy, nada para
  --    anon/authenticated; o service_role lê e escreve.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_ia_alarmes'::regclass) THEN
    RAISE EXCEPTION '1140: cb_ia_alarmes sem RLS.';
  END IF;
  SELECT count(*) INTO v_politicas FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_ia_alarmes';
  IF v_politicas <> 0 THEN
    RAISE EXCEPTION '1140: cb_ia_alarmes ganhou % policy(s); devia ser fechada.', v_politicas;
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_alarmes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_alarmes', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_ia_alarmes', 'UPDATE') THEN
    RAISE EXCEPTION '1140: cb_ia_alarmes ficou aberta ao navegador.';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_ia_alarmes', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_alarmes', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.cb_ia_alarmes', 'INSERT') THEN
    RAISE EXCEPTION '1140: service_role não lê nem escreve cb_ia_alarmes.';
  END IF;

  -- 3. A função: fechada ao navegador, aberta ao service_role.
  IF has_function_privilege('anon', 'public.cb_ia_registrar_falha(uuid, text, text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_ia_registrar_falha(uuid, text, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1140: cb_ia_registrar_falha ficou executável pelo navegador.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_ia_registrar_falha(uuid, text, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1140: service_role não executa cb_ia_registrar_falha.';
  END IF;

  -- 4. A função é CHAMADA (o corpo plpgsql só é analisado quando roda), num
  --    subbloco desfeito pelo SQLSTATE próprio (P1140) — nunca WHEN OTHERS.
  --    a) Numa conta que não existe: o INSERT cai na FK — prova que o corpo
  --       roda até lá, sem depender de dado.
  BEGIN
    BEGIN
      PERFORM public.cb_ia_registrar_falha(gen_random_uuid(), 'anthropic', 'conferencia_1140', 360);
      v_estado := 'gravou';
    EXCEPTION WHEN foreign_key_violation THEN
      v_estado := 'fk';
    END;
    IF v_estado <> 'fk' THEN
      RAISE EXCEPTION '1140: a conta inexistente devia cair na FK (%).', v_estado;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P1140', MESSAGE = 'desfaz a conferência (a)';
  EXCEPTION
    WHEN SQLSTATE 'P1140' THEN NULL;
  END;

  --    b) O ciclo de um episódio, numa conta que EXISTE (derivada do banco; o
  --       banco vazio do replay pula): abre, conta sem avisar, lembra com
  --       intervalo zero, e reabre depois de normalizado. Tudo desfeito.
  SELECT id INTO v_conta FROM public.accounts ORDER BY created_at LIMIT 1;
  IF v_conta IS NULL THEN
    RAISE NOTICE '1140: banco sem conta, o ciclo do episódio não foi exercitado.';
  ELSE
    BEGIN
      DELETE FROM public.cb_ia_alarmes WHERE account_id = v_conta AND provedor = 'openai';
      v_r := public.cb_ia_registrar_falha(v_conta, 'openai', 'conferencia_1140', 360);
      IF v_r->>'acao' <> 'abriu' OR (v_r->>'falhas')::int <> 1 THEN
        RAISE EXCEPTION '1140: a 1ª falha devia abrir o episódio (%).', v_r;
      END IF;
      v_r := public.cb_ia_registrar_falha(v_conta, 'openai', 'conferencia_1140', 360);
      IF v_r->>'acao' <> 'nada' OR (v_r->>'falhas')::int <> 2 THEN
        RAISE EXCEPTION '1140: a 2ª falha dentro do prazo só devia contar (%).', v_r;
      END IF;
      v_r := public.cb_ia_registrar_falha(v_conta, 'openai', 'conferencia_1140', 0);
      IF v_r->>'acao' <> 'continua' OR (v_r->>'falhas')::int <> 3 THEN
        RAISE EXCEPTION '1140: com o prazo vencido devia lembrar (%).', v_r;
      END IF;
      UPDATE public.cb_ia_alarmes SET normalizou_em = now() WHERE account_id = v_conta AND provedor = 'openai';
      v_r := public.cb_ia_registrar_falha(v_conta, 'openai', 'conferencia_1140', 360);
      IF v_r->>'acao' <> 'abriu' OR (v_r->>'falhas')::int <> 1 THEN
        RAISE EXCEPTION '1140: depois de normalizar, a falha devia abrir um episódio NOVO (%).', v_r;
      END IF;
      RAISE EXCEPTION USING ERRCODE = 'P1140', MESSAGE = 'desfaz a conferência (b)';
    EXCEPTION
      WHEN SQLSTATE 'P1140' THEN NULL;
    END;
  END IF;
END
$$;
