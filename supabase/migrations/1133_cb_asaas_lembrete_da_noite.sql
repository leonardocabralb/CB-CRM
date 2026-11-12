-- 1133 — O LEMBRETE DA NOITE da régua do Asaas.
--
-- Decisão do operador (10/11/2026, D12 revista): no dia do vencimento saem
-- DOIS lembretes — o do dia (`hora_envio` antes das 18:00, como sempre) e o
-- da noite (a partir das 18:00, com a janela até as 21:00), de propósito com
-- cara de mensagem automática. Cada turno tem a SUA trava: `tipo =
-- 'vence_hoje'` com `marco = 0` (dia) ou `marco = 1` (noite) — com uma trava
-- só, o lembrete do dia já enviado barraria o da noite pelo UNIQUE
-- `(cobranca_id, tipo, marco, vencimento)`. O CHECK da 998 só aceitava
-- `marco = 0` no lembrete.
--
-- ADITIVA: o app novo grava `marco = 1`; aplicar ANTES do deploy. O app
-- antigo só grava 0, que continua aceito. Banco vazio: só troca o CHECK.

ALTER TABLE public.cb_asaas_regua_envios
  DROP CONSTRAINT IF EXISTS cb_asaas_regua_envios_marco_ck;

ALTER TABLE public.cb_asaas_regua_envios
  ADD CONSTRAINT cb_asaas_regua_envios_marco_ck
  CHECK ((tipo = 'vence_hoje' AND marco IN (0, 1)) OR (tipo = 'atraso' AND marco > 0));

COMMENT ON COLUMN public.cb_asaas_regua_envios.marco IS
  'atraso: os dias do marco (> 0). vence_hoje: o TURNO do lembrete — 0 = do dia, 1 = da noite (1133).';

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.cb_asaas_regua_envios'::regclass
     AND conname = 'cb_asaas_regua_envios_marco_ck';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1133: o CHECK do marco sumiu';
  END IF;
  IF v_def NOT LIKE '%ARRAY[0, 1]%' OR v_def NOT LIKE '%marco > 0%' THEN
    RAISE EXCEPTION '1133: o CHECK do marco não ficou como esperado: %', v_def;
  END IF;
  -- a trava continua uma por (cobrança, tipo, marco, vencimento)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_asaas_regua_envios'::regclass
       AND conname = 'cb_asaas_regua_envios_uk'
  ) THEN
    RAISE EXCEPTION '1133: a trava UNIQUE do marco está ausente — a régua mandaria duas vezes';
  END IF;
END $$;
