-- ============================================================
-- 1109 — Encerrar a conversa não apaga o turno da IA que JÁ respondeu.
--
-- O encerramento limpa a IA da conversa e descarta os turnos vivos dela
-- (`cb_encerrar_limpa_ia`, 1049 — a definição vigente até aqui; nenhuma
-- migration depois dela a recriou). "Vivos" eram TODOS os `aguardando` e
-- `rodando`, inclusive o que já tinha mandado a resposta.
--
-- Medido no teste real de 25/10/2026: o agente respondeu e executou uma
-- automação (anotação interna + "Encerrar conversa"). A resposta saiu, a
-- automação rodou — e o turno ficou gravado "descartado — conversa encerrada"
-- e SEM as ações: o passo "Encerrar conversa" disparou este gatilho no MEIO
-- do turno (as ações rodam depois do envio, `turno.ts`), o turno virou
-- `descartado`, e a escrita final dele, cercada pela posse (`status =
-- 'rodando'`), não casou mais nada. A aba Turnos mentia sobre um turno que
-- respondeu e agiu.
--
-- O que muda: o turno cuja resposta JÁ SAIU — `mensagem_enviada_id` não nulo,
-- o id do provedor que o turno grava ANTES do INSERT da mensagem
-- (`gravarIdEnviado`) — fica de fora do descarte; o turno termina sozinho e
-- grava `respondeu` com as ações. O que ainda não mandou nada (o
-- `aguardando`, o `rodando` antes do envio e o que está no meio dele, sem o id)
-- continua descartado como na 1049: a reserva (`cb_ia_reservar_envio`) trava a
-- mesma linha da conversa e recusa `encerrada`. O resto do corpo é o da 1049,
-- sem mudança (último agente, pausa e o teto que recomeça).
--
-- O que NÃO muda aqui e mora no app: a conversa encerrada durante o turno não
-- arma retomada (`armarRetomada` relê a conversa: nada de follow-up numa
-- conversa que o próprio agente encerrou), e a transferência não passa por
-- cima de conversa encerrada (`transferirParaGente`, `.neq('status',
-- 'closed')`).
--
-- Só o CORPO da função é trocado (mesma assinatura, `CREATE OR REPLACE`): o
-- gatilho `cb_encerrar_limpa_ia_trigger` da 1049 fica como está — é um dos
-- "livres" da Lixeira (1097), e recriá-lo exigiria repetir a conferência dela.
-- SECURITY DEFINER como antes: o operador encerra sob a RLS, e `cb_ia_turnos`
-- é fechada ao navegador.
--
-- Ordem: independe do deploy — o app de hoje e o novo convivem com ela (os
-- dois já tentam gravar o desfecho do turno que respondeu, com a cerca de
-- posse; só passa a casar). Idempotente. Sem GRANT a devolver: o REVOKE é o
-- mesmo da 1049 (função de gatilho não é RPC; o gatilho dispara sem EXECUTE).
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION cb_encerrar_limpa_ia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.ia_agente_id := NULL;
    NEW.ai_autoreply_disabled := false;
    NEW.ia_pausada_por := NULL;
    NEW.ia_pausada_em := NULL;
    -- Recomeça o teto (as respostas contam de `greatest(etapa_desde,
    -- ia_retomada_em)`): o cliente que volta meses depois não herda as
    -- respostas gastas antes do encerramento (revisão da F2).
    NEW.ia_retomada_em := now();
    -- 1109: o turno cuja resposta JÁ SAIU (`mensagem_enviada_id`) não é
    -- descartado — ele está executando as ações da resposta (a automação que
    -- encerrou a conversa pode ser uma delas) e grava o próprio desfecho.
    UPDATE cb_ia_turnos
       SET status = 'descartado',
           erro = 'conversa encerrada',
           terminado_em = now(),
           updated_at = now()
     WHERE conversation_id = NEW.id
       AND account_id = NEW.account_id
       AND status IN ('aguardando', 'rodando')
       AND mensagem_enviada_id IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_encerrar_limpa_ia() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: o catálogo e a função CHAMADA pelo gatilho (o corpo só é
-- analisado quando roda), num subbloco desfeito por SQLSTATE próprio. Em
-- banco vazio não há conversa: só o catálogo.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_conv     uuid;
  v_conta    uuid;
  v_situacao text;
  v_saiu     uuid;
  v_pendente uuid;
  v_status   text;
BEGIN
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.cb_encerrar_limpa_ia()'::regprocedure) THEN
    RAISE EXCEPTION '1109: cb_encerrar_limpa_ia sem SECURITY DEFINER (encerrar pela tela falharia)';
  END IF;
  IF has_function_privilege('anon', 'public.cb_encerrar_limpa_ia()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_encerrar_limpa_ia()', 'EXECUTE') THEN
    RAISE EXCEPTION '1109: função de gatilho cb_encerrar_limpa_ia exposta como RPC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'cb_encerrar_limpa_ia_trigger'
                    AND tgrelid = 'public.conversations'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION '1109: o gatilho cb_encerrar_limpa_ia_trigger não existe';
  END IF;

  -- Uma conversa aberta, sem turno vivo (um `rodando` por conversa, um
  -- `aguardando` por conexão): é onde os dois turnos de conferência cabem.
  SELECT cv.id, cv.account_id, cv.status INTO v_conv, v_conta, v_situacao
    FROM conversations cv
   WHERE cv.status <> 'closed'
     AND NOT EXISTS (SELECT 1 FROM cb_ia_turnos t
                      WHERE t.conversation_id = cv.id AND t.status IN ('aguardando', 'rodando'))
   LIMIT 1;

  BEGIN
    -- Como o motor: o passo "Encerrar conversa" roda com o service role.
    SET LOCAL ROLE service_role;
    IF v_conv IS NOT NULL THEN
      -- O turno que JÁ respondeu (o id do provedor gravado) e um pendente.
      INSERT INTO cb_ia_turnos (account_id, conversation_id, status, rodando_desde, enviando_desde, mensagem_enviada_id)
        VALUES (v_conta, v_conv, 'rodando', now(), now(), 'wamid.conferencia-1109')
        RETURNING id INTO v_saiu;
      INSERT INTO cb_ia_turnos (account_id, conversation_id, status, executar_apos)
        VALUES (v_conta, v_conv, 'aguardando', now() + interval '1 hour')
        RETURNING id INTO v_pendente;

      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_saiu;
      IF v_status IS DISTINCT FROM 'rodando' THEN
        RAISE EXCEPTION '1109: encerrar descartou o turno que JÁ respondeu (ficou %)', v_status;
      END IF;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_pendente;
      IF v_status IS DISTINCT FROM 'descartado' THEN
        RAISE EXCEPTION '1109: encerrar não descartou o turno pendente (ficou %)', v_status;
      END IF;

      -- O que roda e AINDA NÃO respondeu continua descartado, como na 1049.
      UPDATE conversations SET status = v_situacao WHERE id = v_conv;
      UPDATE cb_ia_turnos SET mensagem_enviada_id = NULL WHERE id = v_saiu;
      UPDATE conversations SET status = 'closed' WHERE id = v_conv;
      SELECT status INTO v_status FROM cb_ia_turnos WHERE id = v_saiu;
      IF v_status IS DISTINCT FROM 'descartado' THEN
        RAISE EXCEPTION '1109: encerrar não descartou o turno que ainda não respondeu (ficou %)', v_status;
      END IF;
    ELSE
      RAISE NOTICE '1109: nenhuma conversa aberta sem turno vivo — o gatilho não foi chamado aqui.';
    END IF;
    RESET ROLE;
    RAISE EXCEPTION USING ERRCODE = 'P1109';
  EXCEPTION WHEN SQLSTATE 'P1109' THEN
    NULL;
  END;

  RAISE NOTICE '1109: encerrar descarta só o turno da IA que ainda não respondeu.';
END $$;
