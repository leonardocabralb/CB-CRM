-- ============================================================
-- 1106 — A espera presa em `running` vira FALHA VISÍVEL (adaptado do #672 do
-- original, `051_automation_pending_integrity`).
--
-- O cron das automações (`/api/automations/cron`) REIVINDICA a espera vencida
-- (`status = 'running'`) e roda a retomada. Se o processo morre no meio —
-- deploy, reinício do contêiner —, a linha fica `running` para sempre: a
-- execução some em silêncio, a aba Automações da conversa diz que ela ainda
-- roda, e a guarda de espera viva de `fecharLog` (985) nunca publica a hora de
-- fim das irmãs. Nada recolhia essa linha (era o "conhecido, não tratado" de
-- `.claude/rules/automacoes-esperas.md`).
--
-- O que muda aqui é UMA coluna e UM índice:
--
--   * `claimed_at` — QUANDO o cron reivindicou. Nasce NULA (a espera
--     estacionada ainda não foi reivindicada; `cb_estacionar_espera` não a
--     escreve) e é gravada junto do `status = 'running'`.
--   * o índice parcial em `(claimed_at) WHERE status = 'running'` — o do
--     recolhimento, que roda no começo de CADA ciclo do laço rápido (~15 s).
--     Serve também a pergunta das linhas antigas, SEM carimbo (`claimed_at IS
--     NULL`: o btree guarda os nulos). O predicado espelha o `.eq('status',
--     'running')` de `recolherEsperasPresas` (`src/lib/automations/engine.ts`):
--     mudar um sem o outro deixa o índice de pé e inútil (pino
--     `espera-presa-1106.test.ts`).
--
-- ⚠️⚠️ O que o original faz e AQUI NÃO SE FAZ: lá a presa volta para a fila e
-- é RE-EXECUTADA. O processo pode ter morrido logo DEPOIS de mandar a
-- mensagem, e refazer a retomada a mandaria de novo — envio que pode ter saído
-- nunca se repete (CLAUDE.md, 8e). Aqui a linha vira `failed`, o registro
-- ganha o motivo e o desfecho `falhou` (o mesmo caminho da espera que não pode
-- retomar, `conferirRetomada`), e nada roda de novo. A coluna `parked_step_id`
-- da 051 também não vem: o nosso passo da fila mora no contexto
-- (`_passo_da_fila`, `retomada.ts`).
--
-- Os cortes (no app, `engine.ts`): reivindicada há mais de 1 h; ou, para
-- as `running` do código anterior a esta migration (sem carimbo), vencida há
-- mais de 24 h. A conferência abaixo diz, ANTES de qualquer ALTER, quantas
-- dessas antigas o primeiro ciclo depois do deploy vai fechar como falha.
--
-- ⚠️⚠️ ADITIVA, e o app novo DEPENDE dela: a reivindicação grava
-- `claimed_at`, e sem a coluna o PostgREST recusa o UPDATE inteiro — NENHUMA
-- espera retomaria (a rota agora registra o erro, mas não retoma). Aplicar
-- ANTES do deploy. O app antigo não lê nem grava a coluna: convive com ela.
--
-- Tabela quente (o laço rápido a lê a cada 15 s; a ingestão a escreve a cada
-- resposta de cliente): `lock_timeout` para não enfileirar a fila atrás de uma
-- transação longa. O ADD COLUMN sem padrão é só catálogo; o CREATE INDEX
-- percorre a tabela (que não é podada) sob a trava do ALTER — a contagem
-- informativa vem ANTES dele. Sem REVOKE, logo sem GRANT a devolver (a tabela
-- continua só do service_role). Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- Antes de qualquer trava exclusiva: o que o primeiro recolhimento vai achar.
-- Só informa — afirmar ausência é sempre seguro, e banco vazio dá zero.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_running  int;
  v_vencidas int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE run_at < now() - interval '24 hours')
    INTO v_running, v_vencidas
    FROM public.automation_pending_executions
   WHERE status = 'running';
  IF v_running = 0 THEN
    RAISE NOTICE '1106: nenhuma espera em running agora (banco vazio ou fila em dia) — nada para o primeiro recolhimento.';
  ELSE
    RAISE NOTICE '1106: % espera(s) em running agora; % vencida(s) há mais de 24 h — o primeiro ciclo do cron depois do deploy fecha essas como falha visível (as outras, se passarem de 24 h sem terminar).',
      v_running, v_vencidas;
  END IF;
END $$;

ALTER TABLE public.automation_pending_executions
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN public.automation_pending_executions.claimed_at IS
  'Quando o cron reivindicou a espera (gravado junto do status running). Nula = nunca reivindicada, ou reivindicada pelo código anterior à 1106. É o relógio do recolhimento: running com carimbo mais velho que 15 min vira falha visível, nunca é re-executada.';

CREATE INDEX IF NOT EXISTS automation_pending_executions_presas_idx
  ON public.automation_pending_executions (claimed_at)
  WHERE status = 'running';

COMMENT ON INDEX public.automation_pending_executions_presas_idx IS
  'O recolhimento das esperas presas (recolherEsperasPresas, a cada ciclo do laço rápido): running com claimed_at velho, e as antigas com claimed_at nulo. O predicado espelha o filtro da consulta.';

-- ------------------------------------------------------------
-- Conferência — o RESULTADO, no catálogo (sem dado exigido: vale em banco
-- vazio, e depois do ALTER só catálogo roda sob a trava).
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo      text;
  v_not_null  boolean;
  v_padrao    text;
  v_def       text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    INTO v_tipo, v_not_null, v_padrao
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.automation_pending_executions'::regclass
     AND a.attname = 'claimed_at'
     AND NOT a.attisdropped;
  IF v_tipo IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION '1106: automation_pending_executions.claimed_at ausente ou com o tipo errado (%)', v_tipo;
  END IF;
  -- NOT NULL recusaria todo estacionamento (`cb_estacionar_espera` não a
  -- escreve); um padrão carimbaria a espera que ninguém reivindicou.
  IF v_not_null OR v_padrao IS NOT NULL THEN
    RAISE EXCEPTION '1106: claimed_at tem de nascer NULA e sem padrão (not null=%, padrão=%)', v_not_null, v_padrao;
  END IF;

  SELECT indexdef INTO v_def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'automation_pending_executions'
     AND indexname = 'automation_pending_executions_presas_idx';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '1106: o índice automation_pending_executions_presas_idx não foi criado';
  END IF;
  IF v_def NOT LIKE '%(claimed_at)%' OR v_def NOT LIKE '%WHERE (status = ''running''::text)%' THEN
    RAISE EXCEPTION '1106: o índice das presas não é o parcial em claimed_at com status = running: %', v_def;
  END IF;

  RAISE NOTICE '1106: claimed_at e o índice das esperas presas no lugar.';
END $$;
