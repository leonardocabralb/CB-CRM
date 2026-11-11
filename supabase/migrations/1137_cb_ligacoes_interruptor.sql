-- ============================================================
-- 1137_cb_ligacoes_interruptor
--
-- A 4e do ligar pelo CRM (`docs/PLANO-ligar-pelo-crm.md`, §8.17):
--
--   1. `cb_computadores_de_ligacao.ligado_em` — o INTERRUPTOR das ligações
--      pelo CRM de cada conexão (D16, decisão do operador de 11/11/2026),
--      ligado pelo admin na tela Conexões. Nulo = desligado: o CRM não mostra
--      o botão "Ligar", a recebida não toca e não há alarme. Nasce DESLIGADO,
--      também o computador que já existe — o operador liga na tela.
--   2. `cb_alarmes_de_conexao` (1122) ganha os tipos `computador_fora` (o
--      computador sem sinal de vida) e `computador_qr` (o WhatsApp dele pede
--      o QR), com as regras do sino da 1122 (`alarmes-no-sino.ts`, que tem o
--      espelho da lista — pino `ligacoes-interruptor-1137.test.ts`).
--
-- ADITIVA: aplicar ANTES do deploy — o código novo lê `ligado_em` por nome;
-- o app anterior não a lê e não grava os tipos novos. Idempotente; aplica em
-- banco vazio. Sem função nova. Conferência no fim: catálogo e privilégios.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_computadores_de_ligacao
  ADD COLUMN IF NOT EXISTS ligado_em timestamptz;

COMMENT ON COLUMN public.cb_computadores_de_ligacao.ligado_em IS
  'O interruptor das ligações pelo CRM desta conexão (1137, D16): quando o admin ligou. Nulo = desligado — sem botão Ligar, sem toque, sem alarme.';

-- O CHECK da 1122 tem nome (não é o implícito): troca pelo nome.
ALTER TABLE public.cb_alarmes_de_conexao
  DROP CONSTRAINT IF EXISTS cb_alarmes_de_conexao_tipo_check;
ALTER TABLE public.cb_alarmes_de_conexao
  ADD CONSTRAINT cb_alarmes_de_conexao_tipo_check
  CHECK (tipo IN ('sem_recibo', 'atraso', 'computador_fora', 'computador_qr'));

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'cb_computadores_de_ligacao'
       AND column_name = 'ligado_em'
       AND data_type = 'timestamp with time zone'
       AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '1137: cb_computadores_de_ligacao.ligado_em (timestamptz, anulável) não existe';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.cb_alarmes_de_conexao'::regclass
     AND c.conname = 'cb_alarmes_de_conexao_tipo_check';
  IF v_def IS NULL
     OR v_def NOT LIKE '%''sem_recibo''%'
     OR v_def NOT LIKE '%''atraso''%'
     OR v_def NOT LIKE '%''computador_fora''%'
     OR v_def NOT LIKE '%''computador_qr''%' THEN
    RAISE EXCEPTION '1137: o CHECK dos tipos de alarme não tem os quatro tipos: %', v_def;
  END IF;
  -- Um CHECK velho com outro nome barraria os tipos novos sem erro aqui.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.cb_alarmes_de_conexao'::regclass
       AND c.contype = 'c'
       AND c.conname <> 'cb_alarmes_de_conexao_tipo_check'
       AND pg_get_constraintdef(c.oid) LIKE '%tipo%'
  ) THEN
    RAISE EXCEPTION '1137: sobrou outro CHECK sobre o tipo do alarme';
  END IF;

  -- As duas tabelas continuam fechadas ao navegador (1122, 1134).
  IF has_table_privilege('anon', 'public.cb_computadores_de_ligacao', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_computadores_de_ligacao', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_alarmes_de_conexao', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_alarmes_de_conexao', 'SELECT') THEN
    RAISE EXCEPTION '1137: tabela fechada ao navegador ficou aberta';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_computadores_de_ligacao', 'UPDATE') THEN
    RAISE EXCEPTION '1137: o servidor não grava o interruptor';
  END IF;

  RAISE NOTICE '1137: conferida (o interruptor e os tipos novos de alarme).';
END $$;
