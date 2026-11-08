-- ============================================================
-- 1128 — "Conduz o fechamento": opção POR AGENTE de IA (pedido do operador,
-- 08/11/2026; plano em docs/PLANO-agentes-de-ia.md, "Conduz o fechamento").
--
-- Até aqui as regras do sistema (27/09/2026, `regras-do-sistema.ts`) valiam
-- iguais para todo agente, e duas delas tornavam impossível um agente de
-- FECHAMENTO: `sem_preco` (nunca falar de honorários nem de condições de
-- pagamento) e `sem_compromisso` (nunca aceitar proposta nem dizer que o
-- escritório pega o caso). Com a coluna ligada, o pedido DESSE agente troca
-- as duas por duas regras mais estreitas (`honorarios`: só os honorários e
-- as condições ESCRITOS nas instruções ou na base, sem negociar; e
-- `fechamento`: convidar a assinar pelo link escrito, e a contratação só se
-- confirma com a assinatura). As outras dez regras não mudam.
--
--   conduz_fechamento  false (o padrão) = as 12 regras de sempre. Os agentes
--                      que já existem nascem com false: nada muda neles.
--
-- ADITIVA: aplicar ANTES do deploy (o app novo lê a coluna em
-- `COLUNAS_DO_AGENTE`; sem ela, toda leitura de agente — turno, tela,
-- Playground — falharia). O app antigo não a lê. A tabela segue com os
-- GRANTs de TABELA da 1048 (SELECT para `authenticated` sob a policy de
-- admin, ALL para `service_role`): a coluna herda.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_ia_agentes
  ADD COLUMN IF NOT EXISTS conduz_fechamento boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cb_ia_agentes.conduz_fechamento IS
  'Conduz o fechamento (1128): troca as regras do sistema sem_preco e sem_compromisso pelas do fechamento (honorários só como escritos; contratação só pela assinatura). false = as regras de sempre.';

-- ------------------------------------------------------------
-- Conferência: a coluna existe, boolean, NOT NULL, padrão false, e o
-- service_role a lê e grava. Não depende de dado.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
  v_nula text;
  v_padrao text;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO v_tipo, v_nula, v_padrao
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'cb_ia_agentes' AND column_name = 'conduz_fechamento';
  IF v_tipo IS DISTINCT FROM 'boolean' OR v_nula IS DISTINCT FROM 'NO' OR v_padrao IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '1128: cb_ia_agentes.conduz_fechamento fora da forma (tipo %, nula %, padrão %)', v_tipo, v_nula, v_padrao;
  END IF;
  -- Uma chamada por privilégio: com a lista ('SELECT, UPDATE'), basta UM dos dois.
  IF NOT has_column_privilege('service_role', 'public.cb_ia_agentes', 'conduz_fechamento', 'SELECT')
     OR NOT has_column_privilege('service_role', 'public.cb_ia_agentes', 'conduz_fechamento', 'UPDATE') THEN
    RAISE EXCEPTION '1128: service_role não lê nem grava cb_ia_agentes.conduz_fechamento';
  END IF;
  IF has_table_privilege('anon', 'public.cb_ia_agentes', 'SELECT') THEN
    RAISE EXCEPTION '1128: cb_ia_agentes ficou legível para anon';
  END IF;
END
$$;
