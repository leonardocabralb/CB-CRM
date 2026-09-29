-- ============================================================
-- 1068 — Tarefa VISTA: quando o responsável viu a tarefa pela primeira vez.
--
-- Pedido do operador (29/09/2026): marcar a tarefa como lida quando a pessoa
-- a VÊ, e medir a diferença entre a tarefa não vista que não foi cumprida e a
-- vista que não foi cumprida (o card "Equipe" do Meu dia). Até aqui só havia
-- `lida_em`, marcada À MÃO (1 de 21 tarefas em produção, medido em
-- 29/09/2026), desmarcável ("marcar como não lida") e zerada ao redirecionar:
-- um estado pessoal, não um registro.
--
-- `vista_em` é o REGISTRO: quando o responsável ATUAL teve a tarefa na tela
-- pela primeira vez. Quem grava é a rota `POST /api/cb/tasks/vistas` (o
-- navegador não escreve em `cb_tasks` — 944), com a cerca na consulta: a
-- tarefa é de quem chama, está aberta e ainda não foi vista. "Marcar como não
-- lida" não a toca; redirecionar a zera junto com `lida_em` (quem recebe
-- ainda não viu). Criar para si mesmo já grava as duas.
--
-- Preenchimento: só onde há PROVA de que a pessoa viu — `lida_em`, marcada à
-- mão. O lembrete criado para si mesmo NÃO é preenchido aqui: a tela o marca
-- na primeira aparição, junto com a `lida_em`. Preenchido só o `vista_em`, a
-- primeira aparição não marcaria mais a lida (a rota só age sobre tarefa
-- ainda não vista) e o "Não lida" ficaria para sempre na linha.
-- O UPDATE passa pelo `cb_tasks_touch` (o `updated_at` das tarefas lidas vai
-- para agora — uma linha em produção) e manda o evento de tempo real delas.
--
-- ⚠️ `cb_tasks` está na publicação `supabase_realtime` SEM lista de colunas
-- (`pg_publication_rel.prattrs` nulo, medido) e com REPLICA IDENTITY FULL
-- (944): a coluna nova viaja no payload. Com lista de colunas — a 909 fez
-- isso em `cb_channels` —, a coluna fora da lista faria todo UPDATE/DELETE
-- falhar sob a identidade FULL. A conferência prova que não há lista.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_tasks
  ADD COLUMN IF NOT EXISTS vista_em timestamptz;

COMMENT ON COLUMN public.cb_tasks.vista_em IS
  'Quando o responsável atual viu a tarefa pela primeira vez (a tela marca; só a rota grava). NULL = ainda não vista. Não volta a NULL por "marcar como não lida"; volta ao redirecionar.';

UPDATE public.cb_tasks
   SET vista_em = lida_em
 WHERE vista_em IS NULL
   AND lida_em IS NOT NULL;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.cb_tasks'::regclass
     AND a.attname = 'vista_em'
     AND NOT a.attisdropped;
  IF v_tipo IS DISTINCT FROM 'timestamp with time zone' THEN
    RAISE EXCEPTION '1068: cb_tasks.vista_em deveria ser timestamptz, é %', v_tipo;
  END IF;

  -- Afirmar ausência vale igual num banco vazio (o replay do CI).
  IF EXISTS (
    SELECT 1 FROM public.cb_tasks WHERE lida_em IS NOT NULL AND vista_em IS NULL
  ) THEN
    RAISE EXCEPTION '1068: há tarefa lida sem vista_em';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_publication_rel pr
     WHERE pr.prrelid = 'public.cb_tasks'::regclass
       AND pr.prattrs IS NOT NULL
  ) THEN
    RAISE EXCEPTION '1068: cb_tasks está numa publicação COM lista de colunas — sob REPLICA IDENTITY FULL, a coluna nova quebraria UPDATE e DELETE';
  END IF;
END $$;
