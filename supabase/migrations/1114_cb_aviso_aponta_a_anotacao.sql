-- ============================================================
-- 1114 — O aviso de anotação aponta a ANOTAÇÃO que o gerou
--
-- Pedido do operador (27/10/2026): clicar no aviso de menção ou de resposta
-- abria a conversa e deixava a pessoa procurando o trecho. O aviso guardava
-- só a conversa; agora guarda também a anotação, e o clique leva o fio até
-- ela (`/inbox?c=<conversa>&nota=<anotação>`, o salto pontual que o "Ver na
-- conversa" da aba Notas já usa).
--
-- O que muda no banco, e só isto:
--   `notifications.note_id` — uuid nulo. Gravado pelos escritores de
--   `note_mention` e `note_reply` (a rota do painel, a edição que acrescenta
--   menção, o passo de automação e o agente de IA). Nulo nos outros tipos e
--   nos avisos anteriores a esta migration: o clique só abre a conversa, como
--   antes.
--
-- ⚠️ SEM chave estrangeira, de propósito. `cb_lixeira_tratamento()` (1097) e
-- `cb_unir_fichas` (1093) varrem as FKs pelo CATÁLOGO e são default-deny:
-- uma FK nova para `cb_conversation_notes` (tabela do fecho) faria mover
-- contato para a Lixeira e unir fichas RECUSAREM até as duas listas serem
-- ensinadas. E a FK não compraria nada: anotação apagada deixa o ponteiro
-- solto, o fio não acha a âncora e o clique só abre a conversa — o mesmo
-- desfecho de um SET NULL. Na união, a anotação passa para a conversa que
-- fica com o MESMO id, junto com o aviso (1093), e o ponteiro segue valendo.
-- Os avisos não voltam da Lixeira (`nao_volta`, 1097).
--
-- Sem índice: ninguém pergunta por `note_id`; ele só viaja na linha.
-- Realtime: `notifications` está na publicação SEM lista de colunas (0027;
-- conferido em produção em 27/10/2026), então a coluna viaja no INSERT que o
-- pop-up do navegador ouve. A conferência abaixo cobra isso.
-- Privilégio: o SELECT de `authenticated` é de TABELA (0919) e alcança a
-- coluna nova; o UPDATE dele é só de `read_at`, e continua só dele.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo grava a coluna no INSERT do
-- aviso; sem ela, o PostgREST recusa o INSERT e o aviso não sai (a anotação
-- sai — o aviso é best-effort). O app ANTIGO não a conhece.
-- Tabela pequena (centenas de linhas): ADD COLUMN nulo é só catálogo.
-- `lock_timeout` para não enfileirar leituras do sino. Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS note_id uuid;

COMMENT ON COLUMN public.notifications.note_id IS
  'A anotação que gerou o aviso (note_mention, note_reply; 1114): o clique leva o fio até ela. Sem FK de propósito (Lixeira e união de fichas são default-deny sobre as FKs); anotação apagada = o clique só abre a conversa.';

-- ------------------------------------------------------------
-- Conferência (banco vazio também: só catálogo)
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
  v_fks int;
  v_lista boolean;
BEGIN
  SELECT data_type INTO v_tipo
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'notifications'
     AND column_name = 'note_id';
  IF v_tipo IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION '1114: notifications.note_id ausente ou com tipo errado (%)', v_tipo;
  END IF;

  -- A FK é a armadilha descrita no cabeçalho: nenhuma pode apontar a coluna.
  SELECT count(*) INTO v_fks
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.notifications'::regclass
     AND c.contype = 'f'
     AND a.attname = 'note_id';
  IF v_fks > 0 THEN
    RAISE EXCEPTION '1114: notifications.note_id ganhou FK — a Lixeira e a união de fichas passariam a recusar';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.notifications', 'note_id', 'SELECT') THEN
    RAISE EXCEPTION '1114: authenticated não lê notifications.note_id';
  END IF;
  IF has_column_privilege('authenticated', 'public.notifications', 'note_id', 'UPDATE') THEN
    RAISE EXCEPTION '1114: authenticated pode reescrever notifications.note_id';
  END IF;

  -- Publicação com lista de colunas deixaria a coluna fora do INSERT do
  -- tempo real (a armadilha de `cb_channels`). Sem publicação (banco sem
  -- Realtime), nada a provar.
  SELECT pr.prattrs IS NOT NULL INTO v_lista
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
   WHERE p.pubname = 'supabase_realtime'
     AND pr.prrelid = 'public.notifications'::regclass;
  IF v_lista IS NULL THEN
    RAISE NOTICE '1114: notifications fora da publicação supabase_realtime, nada a provar.';
  ELSIF v_lista THEN
    RAISE EXCEPTION '1114: notifications está na publicação com LISTA de colunas — note_id não viajaria';
  END IF;
END $$;
