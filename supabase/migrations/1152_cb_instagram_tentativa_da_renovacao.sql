-- 1152 — A TENTATIVA de renovar o token do Instagram fica carimbada.
--
-- A renovação (Fase 6, `src/lib/instagram/renovar-token.ts`) roda no ciclo
-- das agendadas e pega até 100 conexões por vez, sob o prazo comum da
-- manutenção. Sem carimbo da tentativa, a conexão que a Meta recusa sempre
-- (com erro que não é o 190 de token vencido) voltava À FRENTE do lote a cada
-- 15 min — cem delas, ou umas poucas que estouram o prazo de 10 s, e as
-- válidas atrás nunca renovariam até vencer (revisão do PR #539; a regra da
-- raiz: cron com rodízio carimba a tentativa ANTES do trabalho).
--
-- A coluna é só do servidor: não entra em `CB_CHANNEL_SAFE_COLUMNS` (a tela
-- não a mostra) nem na publicação realtime de `cb_channels` (lista fixa de
-- colunas — coluna nova não viaja, e aqui não precisa).
--
-- ADITIVA: o app novo lê e grava a coluna; aplicar ANTES do deploy. O app
-- antigo não a conhece. Banco vazio: só o ADD COLUMN.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_channels
  ADD COLUMN IF NOT EXISTS ig_token_refresh_tried_at timestamptz;

COMMENT ON COLUMN public.cb_channels.ig_token_refresh_tried_at IS
  'Instagram: a última TENTATIVA de renovar o token, carimbada antes do pedido à Meta (1152). Ordena o lote: a tentada há mais tempo vai primeiro.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_channels'
       AND column_name = 'ig_token_refresh_tried_at'
       AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION '1152: cb_channels.ig_token_refresh_tried_at não ficou timestamptz';
  END IF;
END $$;
