-- ============================================================
-- 1119 — RECIBOS DE MENSAGEM EM GRUPO, por participante
--
-- Medido em 04/11/2026 (`docs/PLANO-recibos-de-grupo.md`): nenhuma mensagem
-- de grupo da equipe passava de ✓. Na Baileys 7, o recibo de grupo (entrega e
-- leitura) é UM POR PARTICIPANTE, num evento à parte, e a Evolution 2.4 não o
-- repassava ao webhook. O 5º patch da imagem (`docker/evolution-cb/`) passa a
-- repassar; esta migration guarda e agrega.
--
-- O desenho, e o porquê de cada peça:
--
--   * `cb_recibos_do_grupo`: uma linha por (mensagem, participante), com a
--     primeira entrega e a primeira leitura. A leitura também conta como
--     entrega (`entregue_em` nunca é nulo). Só AVANÇA: recibo repetido (um por
--     aparelho do participante) ou fora de ordem não apaga nem atrasa nada
--     (`LEAST`).
--   * `participante` = como o WhatsApp o chamou (o LID, quase sempre; num grupo
--     endereçado por telefone, o JID do telefone, como o `group_sender_jid`),
--     sem o aparelho: a chave da linha.
--   * ⚠️ O TELEFONE de quem recebeu NÃO é guardado (decisão do operador de
--     29/10/2026: os telefones dos participantes são lidos na hora e nunca
--     guardados). Guarda-se só a FICHA (`contact_id`), quando o telefone que a
--     Evolution conhece para o LID casa com um cliente — o vínculo da 1117. O
--     telefone só vive na chegada do recibo, para achar a ficha e para
--     descartar os números das conexões da conta (que nem entram).
--   * `cb_groups.participantes_de_fora`: quantos participantes NÃO são
--     números da conta, gravado a cada conferência da lista (a mesma que
--     refaz as fichas, 1117). É o denominador do ✓✓: a bolha vira entregue
--     quando TODOS os de fora receberam, e lida quando todos leram (decisão
--     do operador, 04/11/2026: como o WhatsApp). Nula = não se sabe (nunca
--     conferido, ou a lista não diz quem é quem): a bolha fica em ✓.
--   * `cb_registrar_recibo_do_grupo`: grava e devolve a contagem DA
--     MENSAGEM na mesma chamada, com uma trava por mensagem
--     (`pg_advisory_xact_lock`). Sem ela, dois recibos da mesma mensagem ao
--     mesmo tempo (o normal: os participantes recebem juntos) não se veriam,
--     cada um contaria "1", e a bolha ficaria em ✓ com todos tendo recebido.
--   * Sem FK para `contacts`, `conversations` nem `messages` — nem no
--     `contact_id`: a Lixeira (1097) e a união de fichas (1093) são
--     DEFAULT-DENY sobre as FKs para o fecho do contato (o precedente é o
--     `contact_id` da 1117). A ficha que sai deixa o id solto, que não aponta
--     para nada e não aparece na tela. `group_id` com FK COMPOSTA para
--     `cb_groups (id, account_id)` (padrão da 1117) e CASCADE: grupo apagado
--     leva os recibos.
--   * Escrita só pelo servidor (service role); leitura por membro, na forma
--     da 1032; nada para `anon`.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo grava a coluna e chama a
-- função. Sem a migration, a conferência loga a coluna ausente e o recibo
-- loga a função ausente — a ingestão de grupo segue (ela lê `cb_groups` com
-- `select('*')`).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) O denominador, em cb_groups
-- ------------------------------------------------------------
ALTER TABLE public.cb_groups
  ADD COLUMN IF NOT EXISTS participantes_de_fora integer;

ALTER TABLE public.cb_groups
  DROP CONSTRAINT IF EXISTS cb_groups_participantes_de_fora_ck;
ALTER TABLE public.cb_groups
  ADD CONSTRAINT cb_groups_participantes_de_fora_ck
  CHECK (participantes_de_fora IS NULL OR participantes_de_fora >= 0);

COMMENT ON COLUMN public.cb_groups.participantes_de_fora IS
  'Participantes que não são números da conta, na última conferência da lista (1119). Nula = não se sabe.';

-- ------------------------------------------------------------
-- 2) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_recibos_do_grupo (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  -- O id da mensagem no WhatsApp (`messages.message_id`). Sem FK: ver o cabeçalho.
  message_id text NOT NULL,
  participante text NOT NULL,
  -- A ficha de quem recebeu, quando é cliente. Sem FK: ver o cabeçalho.
  contact_id uuid,
  entregue_em timestamptz NOT NULL,
  lida_em timestamptz,
  PRIMARY KEY (account_id, message_id, participante),
  CONSTRAINT cb_recibos_do_grupo_grupo_fkey
    FOREIGN KEY (group_id, account_id)
    REFERENCES public.cb_groups (id, account_id) ON DELETE CASCADE
);

-- O CASCADE do grupo procura por aqui.
CREATE INDEX IF NOT EXISTS cb_recibos_do_grupo_grupo_idx
  ON public.cb_recibos_do_grupo (group_id);

COMMENT ON TABLE public.cb_recibos_do_grupo IS
  'Recibo de entrega e de leitura de mensagem de grupo, por participante de fora da conta (1119). Escrita só pelo servidor.';

-- ------------------------------------------------------------
-- 3) RLS + privilégios
-- ------------------------------------------------------------
ALTER TABLE public.cb_recibos_do_grupo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_recibos_do_grupo_select ON public.cb_recibos_do_grupo;
CREATE POLICY cb_recibos_do_grupo_select ON public.cb_recibos_do_grupo FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

REVOKE ALL ON public.cb_recibos_do_grupo FROM anon, authenticated;
GRANT SELECT ON public.cb_recibos_do_grupo TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_recibos_do_grupo TO service_role;

-- ------------------------------------------------------------
-- 4) Gravar um recibo e contar os da mensagem
--
-- Devolve UMA linha: quantos participantes de fora receberam (`entregues`) e
-- quantos leram (`lidas`) esta mensagem, e o denominador do grupo. Grupo que
-- não existe nesta conta: nada é gravado e volta (0, 0, NULL).
--
-- LANGUAGE sql e VOLATILE, em TRÊS instruções separadas: cada uma tira foto
-- nova (em READ COMMITTED, o padrão), então a contagem (a última) já vê o
-- que a outra chamada gravou antes de soltar a trava. Juntar tudo numa
-- instrução só (CTE) voltaria a contar com a foto de ANTES da trava — e nem
-- veria o próprio INSERT: cada recibo contaria "1".
-- SECURITY INVOKER: quem chama é o service role.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_registrar_recibo_do_grupo(
  p_account_id uuid,
  p_group_jid text,
  p_message_id text,
  p_participante text,
  p_contact_id uuid,
  p_lida boolean,
  p_instante timestamptz
) RETURNS TABLE (entregues integer, lidas integer, participantes_de_fora integer)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(p_account_id::text || '|' || p_message_id, 1119));

  INSERT INTO public.cb_recibos_do_grupo AS r
         (account_id, group_id, message_id, participante, contact_id, entregue_em, lida_em)
  SELECT p_account_id, g.id, p_message_id, p_participante, p_contact_id,
         p_instante, CASE WHEN p_lida THEN p_instante END
    FROM public.cb_groups g
   WHERE g.account_id = p_account_id AND g.jid = p_group_jid
  ON CONFLICT (account_id, message_id, participante) DO UPDATE
     SET entregue_em = LEAST(r.entregue_em, EXCLUDED.entregue_em),
         lida_em = LEAST(r.lida_em, EXCLUDED.lida_em),
         contact_id = COALESCE(EXCLUDED.contact_id, r.contact_id);

  SELECT count(*)::integer,
         count(r.lida_em)::integer,
         (SELECT g.participantes_de_fora FROM public.cb_groups g
           WHERE g.account_id = p_account_id AND g.jid = p_group_jid)
    FROM public.cb_recibos_do_grupo r
   WHERE r.account_id = p_account_id AND r.message_id = p_message_id;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_registrar_recibo_do_grupo(uuid, text, text, text, uuid, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_registrar_recibo_do_grupo(uuid, text, text, text, uuid, boolean, timestamptz)
  TO service_role;

-- ------------------------------------------------------------
-- 5) Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_groups'
       AND column_name = 'participantes_de_fora'
  ) THEN
    RAISE EXCEPTION '1119: falta cb_groups.participantes_de_fora';
  END IF;

  -- Sem FK para o fecho do contato: a Lixeira e a união recusariam (default-deny).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_recibos_do_grupo'::regclass
       AND contype = 'f'
       AND confrelid IN ('public.contacts'::regclass, 'public.conversations'::regclass, 'public.messages'::regclass)
  ) THEN
    RAISE EXCEPTION '1119: cb_recibos_do_grupo não pode ter FK para contacts, conversations nem messages';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_recibos_do_grupo'::regclass
       AND contype = 'f' AND confrelid = 'public.cb_groups'::regclass
       AND confdeltype = 'c' AND array_length(conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION '1119: a FK para cb_groups tem de ser composta e ON DELETE CASCADE';
  END IF;

  IF has_table_privilege('anon', 'public.cb_recibos_do_grupo', 'SELECT') THEN
    RAISE EXCEPTION '1119: anon não pode ler cb_recibos_do_grupo';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_recibos_do_grupo', 'SELECT') THEN
    RAISE EXCEPTION '1119: authenticated precisa de SELECT (a RLS decide quem)';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_recibos_do_grupo', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_recibos_do_grupo', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_recibos_do_grupo', 'DELETE') THEN
    RAISE EXCEPTION '1119: só o servidor escreve em cb_recibos_do_grupo';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.cb_recibos_do_grupo', 'INSERT') THEN
    RAISE EXCEPTION '1119: service_role precisa gravar os recibos';
  END IF;

  IF has_function_privilege('authenticated', 'public.cb_registrar_recibo_do_grupo(uuid, text, text, text, uuid, boolean, timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_registrar_recibo_do_grupo(uuid, text, text, text, uuid, boolean, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1119: só o servidor chama cb_registrar_recibo_do_grupo';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.cb_registrar_recibo_do_grupo(uuid, text, text, text, uuid, boolean, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '1119: service_role precisa chamar cb_registrar_recibo_do_grupo';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_recibos_do_grupo'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1119: a policy de leitura tem de ter a forma da 1032';
  END IF;
END $$;

-- A função grava só avançando, conta os da mensagem e ignora o grupo de outra
-- conta. Precisa de um grupo e de uma segunda conta: num banco vazio (o
-- replay do CI) não há o que provar. A prova grava e se DESFAZ pelo SQLSTATE
-- próprio — nunca `WHEN OTHERS`.
DO $$
DECLARE
  v_grupo uuid;
  v_conta uuid;
  v_jid text;
  v_outra uuid;
  v_msg text := 'prova-1119-' || gen_random_uuid()::text;
  v_t0 timestamptz := '2026-01-01 12:00:00+00';
  v_e integer;
  v_l integer;
  v_f integer;
  v_entregue timestamptz;
  v_lida timestamptz;
  v_ficha uuid := gen_random_uuid();
BEGIN
  SELECT g.id, g.account_id, g.jid INTO v_grupo, v_conta, v_jid FROM public.cb_groups g LIMIT 1;
  -- A outra conta NÃO pode ter o mesmo grupo: senão a função gravaria de
  -- verdade nela, e a prova acusaria a função certa.
  SELECT a.id INTO v_outra FROM public.accounts a
   WHERE a.id <> v_conta
     AND NOT EXISTS (SELECT 1 FROM public.cb_groups g2 WHERE g2.account_id = a.id AND g2.jid = v_jid)
   LIMIT 1;

  IF v_grupo IS NULL OR v_outra IS NULL THEN
    RAISE NOTICE '1119: banco sem grupo e segunda conta, nada a provar.';
    RETURN;
  END IF;

  BEGIN
    UPDATE public.cb_groups SET participantes_de_fora = 2 WHERE id = v_grupo;

    -- Entrega de A.
    SELECT * INTO v_e, v_l, v_f FROM public.cb_registrar_recibo_do_grupo(
      v_conta, v_jid, v_msg, 'a@lid', v_ficha, false, v_t0 + interval '10 seconds');
    IF (v_e, v_l, v_f) IS DISTINCT FROM (1, 0, 2) THEN
      RAISE EXCEPTION '1119: a 1ª entrega devolveu (%, %, %)', v_e, v_l, v_f;
    END IF;

    -- A leu; e um recibo de entrega atrasado, mais ANTIGO, ajusta só a entrega.
    PERFORM public.cb_registrar_recibo_do_grupo(
      v_conta, v_jid, v_msg, 'a@lid', NULL, true, v_t0 + interval '30 seconds');
    SELECT * INTO v_e, v_l, v_f FROM public.cb_registrar_recibo_do_grupo(
      v_conta, v_jid, v_msg, 'a@lid', NULL, false, v_t0 + interval '5 seconds');
    SELECT entregue_em, lida_em INTO v_entregue, v_lida FROM public.cb_recibos_do_grupo
     WHERE account_id = v_conta AND message_id = v_msg AND participante = 'a@lid';
    IF (v_e, v_l) IS DISTINCT FROM (1, 1)
       OR v_entregue <> v_t0 + interval '5 seconds'
       OR v_lida <> v_t0 + interval '30 seconds' THEN
      RAISE EXCEPTION '1119: o recibo não só avançou (entregues=%, lidas=%, entregue=%, lida=%)',
        v_e, v_l, v_entregue, v_lida;
    END IF;

    -- A ficha nula de um recibo depois não apaga a que já se sabia.
    IF NOT EXISTS (
      SELECT 1 FROM public.cb_recibos_do_grupo
       WHERE account_id = v_conta AND message_id = v_msg AND participante = 'a@lid'
         AND contact_id = v_ficha
    ) THEN
      RAISE EXCEPTION '1119: um recibo sem ficha apagou a ficha';
    END IF;

    -- B leu direto (a leitura conta como entrega).
    SELECT * INTO v_e, v_l, v_f FROM public.cb_registrar_recibo_do_grupo(
      v_conta, v_jid, v_msg, 'b@lid', NULL, true, v_t0 + interval '40 seconds');
    IF (v_e, v_l, v_f) IS DISTINCT FROM (2, 2, 2) THEN
      RAISE EXCEPTION '1119: a leitura de B devolveu (%, %, %)', v_e, v_l, v_f;
    END IF;

    -- O grupo de OUTRA conta: nada gravado, contagem zerada, sem denominador.
    SELECT * INTO v_e, v_l, v_f FROM public.cb_registrar_recibo_do_grupo(
      v_outra, v_jid, v_msg, 'c@lid', NULL, false, v_t0);
    IF (v_e, v_l) IS DISTINCT FROM (0, 0) OR v_f IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.cb_recibos_do_grupo WHERE account_id = v_outra AND message_id = v_msg) THEN
      RAISE EXCEPTION '1119: o grupo de outra conta foi aceito (%, %, %)', v_e, v_l, v_f;
    END IF;

    BEGIN
      UPDATE public.cb_groups SET participantes_de_fora = -1 WHERE id = v_grupo;
      RAISE EXCEPTION '1119: o denominador aceitou número negativo';
    EXCEPTION WHEN check_violation THEN
      NULL;
    END;

    RAISE EXCEPTION USING ERRCODE = 'P1119', MESSAGE = '1119: desfaz a prova';
  EXCEPTION WHEN SQLSTATE 'P1119' THEN
    NULL;
  END;
END $$;
