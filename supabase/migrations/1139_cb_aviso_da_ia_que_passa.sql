-- ============================================================
-- 1139 — O aviso quando um agente de IA passa a conversa para a equipe.
--
-- Pedido do operador (11/11/2026; plano em
-- docs/PLANO-aviso-da-ia-que-passa-a-conversa.md): a transferência da IA
-- (`transferirParaGente`) pausava a IA, deixava a conversa Pendente e
-- escrevia uma anotação sem menção — ninguém era avisado, e a cliente
-- esperava. Agora ela grava um aviso no sino (com a caixinha clicável dentro
-- do CRM e o pop-up do navegador) para quem o agente manda avisar.
--
--   notifications.type   ganha 'ia_transferiu'. Mesma mecânica da 919, da
--                        944, da 1075 e da 1085: a lista fechada do CHECK é
--                        reescrita com os literais antigos, e a conferência
--                        prova que continuam lá.
--
--   cb_ia_agentes.avisar_ao_transferir
--                        ids de LOGIN (como `transferir_para`) de quem recebe
--                        o aviso, por agente (decisão D1 do operador). '{}' (o
--                        padrão) = o dono, os administradores e quem atende o
--                        número da conversa. Sem FK (lista): quem sai da conta
--                        fica na lista e é ignorado na hora de avisar (o app
--                        lê os membros ATIVOS). Até 50 (o CHECK abaixo, o
--                        mesmo teto de `LIMITES.avisarAoTransferir`); a rota
--                        confere que cada id é membro desta conta.
--
-- ADITIVA: aplicar ANTES do deploy — o app novo lê a coluna em
-- `COLUNAS_DO_AGENTE` (sem ela, toda leitura de agente — turno, tela,
-- Playground — falharia) e grava o tipo novo. O app antigo não lê nenhum dos
-- dois. A coluna herda os GRANTs de TABELA da 1048 (SELECT para
-- `authenticated` sob a policy de admin, ALL para `service_role`); o aviso é
-- gravado com a service role (`notifications` não tem policy de INSERT desde
-- a 027). Tabelas pequenas ou só catálogo: ADD COLUMN com DEFAULT constante
-- não reescreve, e os CHECKs validam linhas que já cabem. Idempotente.
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
    'ia_transferiu'
  ));

ALTER TABLE public.cb_ia_agentes
  ADD COLUMN IF NOT EXISTS avisar_ao_transferir uuid[] NOT NULL DEFAULT '{}';

-- O CHECK com NOME: o escrito inline ganharia nome implícito, que um DROP
-- pelo nome não acharia (989).
ALTER TABLE public.cb_ia_agentes
  DROP CONSTRAINT IF EXISTS cb_ia_agentes_avisar_ao_transferir_teto;
ALTER TABLE public.cb_ia_agentes
  ADD CONSTRAINT cb_ia_agentes_avisar_ao_transferir_teto CHECK (cardinality(avisar_ao_transferir) <= 50);

COMMENT ON COLUMN public.cb_ia_agentes.avisar_ao_transferir IS
  'Quem recebe o aviso ia_transferiu quando este agente passa a conversa para a equipe (1139): ids de login, conferidos contra os membros ATIVOS na hora. {} = o dono, os administradores e quem atende o número. O responsável pela conversa recebe sempre. Até 50.';

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção. Não depende de dado.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def     text;
  v_tipo    text;
  v_udt     text;
  v_nula    text;
  v_padrao  text;
  v_quantos int;
  v_estado  text;
BEGIN
  -- 1. O CHECK do sino conhece o tipo novo e NÃO perdeu nenhum antigo.
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass
     AND conname = 'notifications_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1139: notifications_type_check sumiu.';
  END IF;
  IF v_def NOT LIKE '%ia_transferiu%' THEN
    RAISE EXCEPTION '1139: notifications_type_check não conhece ia_transferiu (def=%)', v_def;
  END IF;
  IF v_def NOT LIKE '%conversation_assigned%' OR v_def NOT LIKE '%note_mention%'
     OR v_def NOT LIKE '%note_reply%' OR v_def NOT LIKE '%task_assigned%'
     OR v_def NOT LIKE '%task_reply%' OR v_def NOT LIKE '%whatsapp_alert%' THEN
    RAISE EXCEPTION '1139: notifications_type_check PERDEU tipo antigo (def=%)', v_def;
  END IF;

  -- 2. A coluna: uuid[], NOT NULL, com a lista vazia de padrão.
  SELECT data_type, udt_name, is_nullable, column_default
    INTO v_tipo, v_udt, v_nula, v_padrao
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'cb_ia_agentes' AND column_name = 'avisar_ao_transferir';
  IF v_tipo IS DISTINCT FROM 'ARRAY' OR v_udt IS DISTINCT FROM '_uuid' OR v_nula IS DISTINCT FROM 'NO'
     OR v_padrao IS NULL OR position('''{}''' IN v_padrao) = 0 THEN
    RAISE EXCEPTION '1139: cb_ia_agentes.avisar_ao_transferir fora da forma (tipo % %, nula %, padrão %)',
      v_tipo, v_udt, v_nula, v_padrao;
  END IF;

  -- 3. UM CHECK sobre a coluna, com o nome e o teto de 50.
  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.cb_ia_agentes'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'avisar_ao_transferir';
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.cb_ia_agentes'::regclass
     AND conname = 'cb_ia_agentes_avisar_ao_transferir_teto';
  IF v_quantos <> 1 OR v_def IS NULL OR v_def !~ 'cardinality\(avisar_ao_transferir\) <= 50' THEN
    RAISE EXCEPTION '1139: o CHECK de avisar_ao_transferir fora da forma (% CHECK(s): %)', v_quantos, v_def;
  END IF;

  -- 4. O service_role lê e grava a coluna e grava o aviso (uma chamada por
  --    privilégio); o anon não lê a tabela dos agentes.
  IF NOT has_column_privilege('service_role', 'public.cb_ia_agentes', 'avisar_ao_transferir', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.cb_ia_agentes', 'avisar_ao_transferir', 'UPDATE') THEN
    RAISE EXCEPTION '1139: service_role não lê nem grava cb_ia_agentes.avisar_ao_transferir';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.notifications', 'INSERT') THEN
    RAISE EXCEPTION '1139: service_role não grava em notifications';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_agentes', 'SELECT') THEN
    RAISE EXCEPTION '1139: cb_ia_agentes ficou legível para anon';
  END IF;

  -- 5. O COMPORTAMENTO, sem depender de dado (a regra 2 das migrations), na
  --    forma da 1131: linhas numa conta que não existe. Os CHECKs são
  --    conferidos NA LINHA, antes da FK (gatilho do fim da instrução) — então
  --    o que passa pelo CHECK cai na FK (23503), e o que não passa cai no
  --    CHECK (23514). Nada é gravado: o bloco se desfaz por uma exceção
  --    própria (P1139) — nunca `WHEN OTHERS`.
  BEGIN
    BEGIN
      INSERT INTO public.notifications (account_id, user_id, type, title)
      VALUES (gen_random_uuid(), gen_random_uuid(), 'ia_transferiu', 'conferencia_1139');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'fk' THEN
      RAISE EXCEPTION '1139: o tipo ia_transferiu devia passar pelo CHECK e cair na FK (%).', v_estado;
    END IF;

    BEGIN
      INSERT INTO public.cb_ia_agentes (account_id, nome, provedor, modelo, avisar_ao_transferir)
      VALUES (gen_random_uuid(), 'conferencia_1139', 'gemini', 'm',
              ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 50)));
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'fk' THEN
      RAISE EXCEPTION '1139: 50 pessoas deviam passar pelo CHECK e cair na FK (%).', v_estado;
    END IF;

    BEGIN
      INSERT INTO public.cb_ia_agentes (account_id, nome, provedor, modelo, avisar_ao_transferir)
      VALUES (gen_random_uuid(), 'conferencia_1139', 'gemini', 'm',
              ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 51)));
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1139: o CHECK deixou passar 51 pessoas (%).', v_estado;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1139', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1139' THEN NULL;
  END;
END
$$;
