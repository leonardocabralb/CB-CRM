-- ============================================================
-- 1061 — A pauta de reuniões: a etapa de "reunião qualificada" e o registro
--        do que a equipe marcou em cada reunião
--
-- Plano: docs/PLANO-pauta-de-reunioes.md. Pedido do operador (28/09/2026):
-- uma tela com as reuniões do dia em que, antes da reunião, "Reunião
-- qualificada" leva o card para a MQL 2 e, depois que ela começa, o resultado
-- (com proposta, sem proposta, no show) leva o card para a etapa certa. A
-- etapa funciona como REDE DE SEGURANÇA: toda reunião que já começou tem de
-- terminar com resultado.
--
-- O que muda no banco, e só isto:
--
-- 1. `pipeline_stages.desfecho_da_reuniao` aceita 'qualificada' (além de
--    'compareceu' e 'faltou', da 1058). É o que diz para qual etapa o botão
--    "Reunião qualificada" leva — nunca o NOME da etapa (renomear "MQL 2"
--    desligaria o botão em silêncio). Nada é semeado: a marcação é escolha de
--    cada funil, em Gerenciar funil. O aviso de possível no-show (1058) lê só
--    'compareceu' e 'faltou' e ignora a marca nova — de propósito: a MQL 2
--    NÃO é comparecimento (28 de 30 entradas nela são ANTES da reunião).
--
-- 2. `cb_reunioes_marcos`: UMA linha por reunião e por marco ('qualificada',
--    'resultado'), com o resultado, o valor da proposta e QUEM marcou. Existe
--    porque a trilha do card (912) não basta: mover o card para a etapa em que
--    ele JÁ está não grava trilha nenhuma, e a reunião ficaria "sem resultado"
--    para sempre; e o valor informado na hora da reunião é dado da reunião,
--    não do card (que muda no contrato). A tela também lê a trilha: resolver
--    pelo quadro do funil conta igual.
--
--    - `reuniao_id` é o id da linha de origem (`cb_calendly_eventos.id` ou
--      `cb_meetings.id`, conforme `origem`), SEM FK: são duas tabelas, e a
--      reunião do Calendly nunca é apagada (é log). Sem `contact_id` de
--      propósito: o contato sai da reunião, e uma coluna a mais com contato
--      entraria na lista de tabelas que a fusão de fichas tem de reapontar.
--    - Quem marcou é CARIMBADO por gatilho (`auth.uid()` e o nome do perfil),
--      nunca aceito do navegador.
--    - Leitura por qualquer membro (a forma da 1032); escrita por quem move
--      card (`agent`, o mesmo piso de `deals_update`). Sem DELETE: corrigir é
--      marcar de novo (o upsert troca a linha do mesmo marco).
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo grava a marca e a tabela; sem
-- elas, o salvamento de Gerenciar funil com 'qualificada' e o registro da tela
-- são recusados. O app antigo não lê nenhuma das duas.
--
-- `lock_timeout` para não enfileirar leituras do quadro. Idempotente. Replay
-- em banco vazio: as conferências afirmam FORMA e provam o CHECK e o gatilho
-- sem depender de dado (inserção que estoura e se desfaz, como a 1058).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1. A marca 'qualificada' na etapa
-- ------------------------------------------------------------
ALTER TABLE public.pipeline_stages
  DROP CONSTRAINT IF EXISTS cb_pipeline_stages_desfecho_da_reuniao_check;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT cb_pipeline_stages_desfecho_da_reuniao_check
  CHECK (desfecho_da_reuniao IS NULL OR desfecho_da_reuniao IN ('qualificada', 'compareceu', 'faltou'));

COMMENT ON COLUMN public.pipeline_stages.desfecho_da_reuniao IS
  'O que entrar nesta etapa diz sobre a reunião (1058/1061): qualificada (antes da reunião; o botão da pauta leva para cá) | compareceu | faltou | NULO (nada). O aviso de possível no-show lê só compareceu e faltou.';

-- ------------------------------------------------------------
-- 2. O registro por reunião
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_reunioes_marcos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  origem               text NOT NULL CHECK (origem IN ('calendly', 'agenda')),
  reuniao_id           uuid NOT NULL,
  marco                text NOT NULL CHECK (marco IN ('qualificada', 'resultado')),
  resultado            text,
  valor                numeric(14, 2),
  registrado_por       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  registrado_por_nome  text,
  registrado_em        timestamptz NOT NULL DEFAULT now(),
  -- ⚠️ `resultado IS NOT NULL` é necessário, não redundante: `NULL IN (…)`
  -- dá NULL, e CHECK que avalia NULL PASSA — sem ele, "resultado" vazio
  -- entrava (medido num Postgres 16 descartável antes de aplicar).
  CONSTRAINT cb_reunioes_marcos_forma_ck CHECK (
    (marco = 'qualificada' AND resultado IS NULL AND valor IS NULL)
    OR (marco = 'resultado' AND resultado IS NOT NULL
        AND resultado IN ('proposta', 'sem_proposta', 'no_show')
        AND (resultado = 'proposta' OR valor IS NULL)
        AND (valor IS NULL OR valor >= 0))
  ),
  -- O alvo do upsert da tela: índice TOTAL (índice parcial não serve de alvo
  -- de ON CONFLICT no PostgREST — a lição da 903).
  CONSTRAINT cb_reunioes_marcos_um_por_marco UNIQUE (account_id, origem, reuniao_id, marco)
);

COMMENT ON TABLE public.cb_reunioes_marcos IS
  'Pauta de reuniões (1061): o que a equipe marcou em cada reunião — qualificada e resultado (proposta com valor, sem proposta, no show). Quem marcou é carimbado por gatilho.';

-- Quem marcou e quando: do banco, nunca do corpo. Sem usuário (service role,
-- script), fica o que veio.
CREATE OR REPLACE FUNCTION public.cb_reunioes_marcos_carimbo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  NEW.registrado_em := now();
  IF v_uid IS NOT NULL THEN
    NEW.registrado_por := v_uid;
    NEW.registrado_por_nome := (
      SELECT p.full_name FROM public.profiles p WHERE p.user_id = v_uid ORDER BY p.created_at LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$;

-- As duas metades do REVOKE (a forma da concessão varia por função; ver o
-- CLAUDE.md). O gatilho continua disparando: o privilégio é conferido no
-- CREATE TRIGGER, não a cada disparo.
REVOKE EXECUTE ON FUNCTION public.cb_reunioes_marcos_carimbo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_reunioes_marcos_carimbo() TO service_role;

DROP TRIGGER IF EXISTS cb_reunioes_marcos_carimbo ON public.cb_reunioes_marcos;
CREATE TRIGGER cb_reunioes_marcos_carimbo
  BEFORE INSERT OR UPDATE ON public.cb_reunioes_marcos
  FOR EACH ROW EXECUTE FUNCTION public.cb_reunioes_marcos_carimbo();

ALTER TABLE public.cb_reunioes_marcos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_reunioes_marcos_select ON public.cb_reunioes_marcos;
CREATE POLICY cb_reunioes_marcos_select ON public.cb_reunioes_marcos FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

-- Escrever: quem move card (o piso de `deals_update`).
DROP POLICY IF EXISTS cb_reunioes_marcos_insert ON public.cb_reunioes_marcos;
CREATE POLICY cb_reunioes_marcos_insert ON public.cb_reunioes_marcos FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum));

DROP POLICY IF EXISTS cb_reunioes_marcos_update ON public.cb_reunioes_marcos;
CREATE POLICY cb_reunioes_marcos_update ON public.cb_reunioes_marcos FOR UPDATE
  USING (is_account_member(account_id, 'agent'::account_role_enum))
  WITH CHECK (is_account_member(account_id, 'agent'::account_role_enum));

-- Tabela cb_* nasce sem nada para `anon`, e o que os outros papéis precisam
-- vai ESCRITO (o default privilege do Supabase não existe no replay do CI).
REVOKE ALL ON TABLE public.cb_reunioes_marcos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cb_reunioes_marcos TO authenticated;
GRANT ALL ON TABLE public.cb_reunioes_marcos TO service_role;

-- ------------------------------------------------------------
-- Conferência — o resultado, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_quantos int;
  v_estado  text;
  v_conta   uuid;
  v_nome    text;
  v_em      timestamptz;
BEGIN
  -- O CHECK da etapa: um só, com a marca nova.
  SELECT count(*) INTO v_quantos
    FROM pg_constraint
   WHERE conrelid = 'public.pipeline_stages'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ~ 'desfecho_da_reuniao';
  IF v_quantos <> 1 THEN
    RAISE EXCEPTION '1061: % CHECK(s) sobre desfecho_da_reuniao (esperado 1).', v_quantos;
  END IF;

  -- Os privilégios, as duas metades.
  IF has_table_privilege('anon', 'public.cb_reunioes_marcos', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_reunioes_marcos', 'INSERT') THEN
    RAISE EXCEPTION '1061: anon enxerga cb_reunioes_marcos.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.cb_reunioes_marcos', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.cb_reunioes_marcos', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.cb_reunioes_marcos', 'UPDATE') THEN
    RAISE EXCEPTION '1061: authenticated sem SELECT/INSERT/UPDATE em cb_reunioes_marcos.';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_reunioes_marcos', 'DELETE') THEN
    RAISE EXCEPTION '1061: authenticated pode apagar cb_reunioes_marcos.';
  END IF;
  IF has_function_privilege('anon', 'public.cb_reunioes_marcos_carimbo()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_reunioes_marcos_carimbo()', 'EXECUTE') THEN
    RAISE EXCEPTION '1061: o carimbo ficou executável fora do servidor.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_reunioes_marcos'::regclass) THEN
    RAISE EXCEPTION '1061: RLS desligada em cb_reunioes_marcos.';
  END IF;
  SELECT count(*) INTO v_quantos FROM pg_policy WHERE polrelid = 'public.cb_reunioes_marcos'::regclass;
  IF v_quantos <> 3 THEN
    RAISE EXCEPTION '1061: % policies em cb_reunioes_marcos (esperado 3: select, insert, update).', v_quantos;
  END IF;

  -- O COMPORTAMENTO, sem dado. O CHECK da etapa aceita 'qualificada' (cai na
  -- FK, 23503) e recusa um valor inventado (23514).
  BEGIN
    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, desfecho_da_reuniao)
      VALUES (gen_random_uuid(), 'conferencia_1061', 'qualificada');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado = 'check' THEN
      RAISE EXCEPTION '1061: o CHECK da etapa recusa qualificada.';
    END IF;

    BEGIN
      INSERT INTO public.pipeline_stages (pipeline_id, name, desfecho_da_reuniao)
      VALUES (gen_random_uuid(), 'conferencia_1061', 'talvez');
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1061: o CHECK da etapa deixou passar um valor inventado (%).', v_estado;
    END IF;

    -- A forma do marco: resultado sem tipo é recusado ANTES da FK da conta.
    BEGIN
      INSERT INTO public.cb_reunioes_marcos (account_id, origem, reuniao_id, marco, resultado)
      VALUES (gen_random_uuid(), 'calendly', gen_random_uuid(), 'resultado', NULL);
      v_estado := 'gravou';
    EXCEPTION
      WHEN check_violation THEN v_estado := 'check';
      WHEN foreign_key_violation THEN v_estado := 'fk';
    END;
    IF v_estado <> 'check' THEN
      RAISE EXCEPTION '1061: marco de resultado sem resultado passou (%).', v_estado;
    END IF;

    -- O gatilho RODA (a regra 3 da seção de migrations: função plpgsql nova é
    -- chamada pela conferência). Só com uma conta para apontar; banco vazio
    -- pula. Sem usuário, o nome enviado fica e a hora é a do banco.
    SELECT id INTO v_conta FROM public.accounts LIMIT 1;
    IF v_conta IS NULL THEN
      RAISE NOTICE '1061: banco vazio, o gatilho fica sem prova de execução aqui.';
    ELSE
      INSERT INTO public.cb_reunioes_marcos (account_id, origem, reuniao_id, marco, registrado_por_nome, registrado_em)
      VALUES (v_conta, 'agenda', gen_random_uuid(), 'qualificada', 'conferencia', '2000-01-01T00:00:00Z')
      RETURNING registrado_por_nome, registrado_em INTO v_nome, v_em;
      IF v_nome IS DISTINCT FROM 'conferencia' OR v_em < now() - interval '1 minute' THEN
        RAISE EXCEPTION '1061: o carimbo não rodou como esperado (nome %, em %).', v_nome, v_em;
      END IF;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1061', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    WHEN SQLSTATE 'P1061' THEN NULL;
  END;
END $$;
