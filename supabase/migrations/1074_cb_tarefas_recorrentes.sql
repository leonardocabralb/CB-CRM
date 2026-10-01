-- ============================================================
-- 1074 — Tarefa RECORRENTE: a cada 1, 2, 5, 7, 15 ou 30 dias.
--
-- Pedido do operador (30/09/2026), com quatro decisões dele:
--   1. PELO CALENDÁRIO: a próxima nasce sozinha, concluída ou não a anterior
--      (as atrasadas se acumulam — é o que ele escolheu, contra "ao concluir").
--   2. O intervalo conta DO PRAZO ANTERIOR: a próxima vence em
--      `vence_em + N`, e nasce NESSE dia (fuso do escritório).
--   3. Só no formulário da tela; API v1, automação e agente de IA não mudam.
--   4. Cada nova avisa o responsável no sino (o aviso é do app, não daqui).
--
-- O MODELO: a série é um grupo de tarefas comuns com o mesmo `serie_id` (o id
-- da primeira). A mais recente é a ATIVA — `repetir_a_cada_dias` preenchido e
-- `proxima_gerada_em` nulo — e é o MOLDE da próxima (título, descrição, hora,
-- cliente, responsável). Gerar a próxima carimba `proxima_gerada_em` na ativa
-- e insere a nova, que passa a ser a ativa. Nenhuma tabela nova: a ocorrência
-- é tarefa de pleno direito, e toda tela que lista tarefa já a mostra.
--
-- ⚠️ `proxima_gerada_em` NÃO é FK para a próxima, de propósito: com um
-- ponteiro `ON DELETE SET NULL`, apagar a ativa devolveria à anterior o posto
-- de ativa, e a rotina recriaria na hora a tarefa que alguém acabou de apagar
-- (a data dela já passou). Com o carimbo, apagar a ativa ENCERRA a série — e
-- a rota de apagar limpa `repetir_a_cada_dias` das irmãs, para a etiqueta
-- "Repete" não sobrar em tarefa de série que não repete mais.
--
-- ⚠️ UMA ATIVA POR SÉRIE, garantido pelo índice único parcial abaixo e não
-- por cuidado do código: duas ativas gerariam duas tarefas por dia.
--
-- ⚠️ QUEM GERA É `cb_tarefas_recorrentes_gerar`, numa transação só: carimbar
-- a ativa e inserir a próxima em duas idas do app deixaria, num processo
-- morto entre as duas, a série encerrada em silêncio (carimbada sem próxima).
-- `FOR UPDATE … SKIP LOCKED` deixa dois ciclos simultâneos sem se pisar. O
-- "hoje" vem de FORA (`p_hoje`, `diaNoFuso(FUSO_PADRAO)` no app): o banco
-- roda em UTC e erraria o dia das 21h à meia-noite.
--
-- ⚠️ `cb_tasks` está na publicação realtime SEM lista de colunas e com
-- REPLICA IDENTITY FULL (944/1068): as colunas novas viajam no payload. A
-- conferência repete a prova da 1068.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_tasks
  ADD COLUMN IF NOT EXISTS repetir_a_cada_dias smallint,
  ADD COLUMN IF NOT EXISTS serie_id uuid,
  ADD COLUMN IF NOT EXISTS proxima_gerada_em timestamptz;

COMMENT ON COLUMN public.cb_tasks.repetir_a_cada_dias IS
  'Intervalo da repetição em dias (1, 2, 5, 7, 15 ou 30), igual em todas as tarefas da série; NULL = não repete. Espelho de INTERVALOS_DE_REPETICAO (src/lib/tasks/validar.ts).';
COMMENT ON COLUMN public.cb_tasks.serie_id IS
  'O id da primeira tarefa da série; agrupa as ocorrências. NULL em tarefa que nunca repetiu.';
COMMENT ON COLUMN public.cb_tasks.proxima_gerada_em IS
  'Quando a próxima ocorrência foi gerada a partir desta. NULL = esta é a ativa da série (o molde da próxima). Carimbo, não FK: apagar a próxima não reativa esta.';

-- A lista é o ESPELHO de `INTERVALOS_DE_REPETICAO`; o pino
-- `tarefas-recorrentes-1074.test.ts` compara as duas.
ALTER TABLE public.cb_tasks DROP CONSTRAINT IF EXISTS cb_tasks_repetir_ck;
ALTER TABLE public.cb_tasks ADD CONSTRAINT cb_tasks_repetir_ck
  CHECK (repetir_a_cada_dias IS NULL OR repetir_a_cada_dias IN (1, 2, 5, 7, 15, 30));

-- Sem série não há como achar as irmãs: mudar o intervalo ou encerrar
-- mexeria só nesta linha, e a ativa seguiria repetindo.
ALTER TABLE public.cb_tasks DROP CONSTRAINT IF EXISTS cb_tasks_repetir_tem_serie_ck;
ALTER TABLE public.cb_tasks ADD CONSTRAINT cb_tasks_repetir_tem_serie_ck
  CHECK (repetir_a_cada_dias IS NULL OR serie_id IS NOT NULL);

-- Uma ativa por série. O predicado é o MESMO da consulta da função (a ativa):
-- mudar um sem o outro deixa o índice de pé e sem servir.
CREATE UNIQUE INDEX IF NOT EXISTS cb_tasks_uma_ativa_por_serie
  ON public.cb_tasks (serie_id)
  WHERE repetir_a_cada_dias IS NOT NULL AND proxima_gerada_em IS NULL;

-- As irmãs de uma série (mudar o intervalo, encerrar).
CREATE INDEX IF NOT EXISTS cb_tasks_serie_idx
  ON public.cb_tasks (serie_id)
  WHERE serie_id IS NOT NULL;

-- ------------------------------------------------------------
-- A geração
-- ------------------------------------------------------------
-- Para cada ativa cuja próxima já venceu (`vence_em + N <= hoje`): a próxima
-- vence na MAIOR data da grade `vence_em + k·N` que não passa de hoje. Com o
-- ciclo de 15 min isso é sempre `vence_em + N`; depois de dias com o
-- agendador parado, é a ocorrência de hoje — sem despejar as perdidas de uma
-- vez (a mesma prudência da guarda de atraso das agendadas).
--
-- ⚠️ Responsável que não é mais membro ATIVO da conta (saiu, ou está
-- suspenso — 1067) PAUSA a série: a ativa fica como está, e volta a gerar
-- quando alguém a redireciona ou a suspensão acaba. Gerar para quem saiu
-- seria tarefa que ninguém vê.
--
-- A nova nasce não lida e não vista (ninguém a viu ainda) e sem `concluida_em`;
-- `tipo` é sempre 'tarefa' (a rota não deixa resposta repetir).
CREATE OR REPLACE FUNCTION public.cb_tarefas_recorrentes_gerar(
  p_hoje date,
  p_limite integer DEFAULT 200
)
RETURNS SETOF public.cb_tasks
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  r public.cb_tasks;
  v_vence date;
  v_nova public.cb_tasks;
BEGIN
  IF p_hoje IS NULL THEN
    RAISE EXCEPTION 'cb_tarefas_recorrentes_gerar: p_hoje é obrigatório';
  END IF;

  FOR r IN
    SELECT t.*
      FROM public.cb_tasks t
     WHERE t.repetir_a_cada_dias IS NOT NULL
       AND t.proxima_gerada_em IS NULL
       AND t.vence_em + t.repetir_a_cada_dias <= p_hoje
       AND EXISTS (
         SELECT 1
           FROM public.profiles p
          WHERE p.user_id = t.responsavel_user_id
            AND p.account_id = t.account_id
            AND p.suspenso_em IS NULL
       )
     ORDER BY t.vence_em, t.id
     LIMIT greatest(coalesce(p_limite, 0), 0)
     FOR UPDATE OF t SKIP LOCKED
  LOOP
    -- `date - date` é inteiro; a divisão inteira pega o último passo inteiro.
    v_vence := r.vence_em
      + ((p_hoje - r.vence_em) / r.repetir_a_cada_dias) * r.repetir_a_cada_dias;

    -- Primeiro deixa de ser a ativa, depois nasce a nova: na ordem inversa o
    -- índice `cb_tasks_uma_ativa_por_serie` veria duas ativas e recusaria.
    UPDATE public.cb_tasks
       SET proxima_gerada_em = now()
     WHERE id = r.id;

    INSERT INTO public.cb_tasks (
      account_id, contact_id,
      criador_user_id, responsavel_user_id, criador_nome, responsavel_nome,
      titulo, descricao, vence_em, vence_as, importante,
      tarefa_pai_id, tarefa_pai_titulo, tipo,
      repetir_a_cada_dias, serie_id
    ) VALUES (
      r.account_id, r.contact_id,
      r.criador_user_id, r.responsavel_user_id, r.criador_nome, r.responsavel_nome,
      r.titulo, r.descricao, v_vence, r.vence_as, r.importante,
      r.tarefa_pai_id, r.tarefa_pai_titulo, 'tarefa',
      r.repetir_a_cada_dias, r.serie_id
    )
    RETURNING * INTO v_nova;

    RETURN NEXT v_nova;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.cb_tarefas_recorrentes_gerar(date, integer) IS
  'Gera a próxima ocorrência de cada série de tarefa recorrente que venceu até p_hoje (dia no fuso do escritório). Devolve as tarefas criadas. Só service_role (o ciclo do agendador).';

-- Só o ciclo do agendador (service role) chama. O REVOKE de PUBLIC tira até o
-- service_role — o GRANT devolve (banco vazio não tem o privilégio padrão).
REVOKE EXECUTE ON FUNCTION public.cb_tarefas_recorrentes_gerar(date, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_tarefas_recorrentes_gerar(date, integer)
  TO service_role;

-- ------------------------------------------------------------
-- Conferência — o RESULTADO, nunca a intenção
-- ------------------------------------------------------------
DO $$
DECLARE
  v_tipo text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo
    FROM pg_attribute a
   WHERE a.attrelid = 'public.cb_tasks'::regclass
     AND a.attname = 'repetir_a_cada_dias'
     AND NOT a.attisdropped;
  IF v_tipo IS DISTINCT FROM 'smallint' THEN
    RAISE EXCEPTION '1074: cb_tasks.repetir_a_cada_dias deveria ser smallint, é %', v_tipo;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'cb_tasks_uma_ativa_por_serie'
       AND indexdef LIKE 'CREATE UNIQUE INDEX%'
  ) THEN
    RAISE EXCEPTION '1074: o índice único de uma ativa por série não existe';
  END IF;

  IF has_function_privilege('anon', 'public.cb_tarefas_recorrentes_gerar(date, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cb_tarefas_recorrentes_gerar(date, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1074: o navegador consegue gerar tarefas recorrentes';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_tarefas_recorrentes_gerar(date, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '1074: service_role não executa a geração — a rotina não funciona';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_publication_rel pr
     WHERE pr.prrelid = 'public.cb_tasks'::regclass
       AND pr.prattrs IS NOT NULL
  ) THEN
    RAISE EXCEPTION '1074: cb_tasks está numa publicação COM lista de colunas — sob REPLICA IDENTITY FULL, as colunas novas quebrariam UPDATE e DELETE';
  END IF;
END $$;

-- A função é CHAMADA (o corpo plpgsql só é analisado quando roda), num
-- subbloco desfeito pelo SQLSTATE próprio. Com dado (produção), uma tarefa
-- real vira ativa de uma série de 7 dias vencida em 05/01 e a geração roda
-- "em 20/01": a próxima tem de vencer em 19/01 (a grade, sem despejar a de
-- 12/01), herdar o molde e deixar a série com UMA ativa. Sem dado (o replay
-- do CI), a chamada com limite zero prova ao menos a consulta.
DO $$
DECLARE
  v_base public.cb_tasks;
  v_qtd integer;
  v_nova public.cb_tasks;
  v_carimbo timestamptz;
BEGIN
  SELECT t.* INTO v_base
    FROM public.cb_tasks t
   WHERE EXISTS (
     SELECT 1 FROM public.profiles p
      WHERE p.user_id = t.responsavel_user_id
        AND p.account_id = t.account_id
        AND p.suspenso_em IS NULL
   )
   LIMIT 1;

  BEGIN
    IF v_base.id IS NULL THEN
      RAISE NOTICE '1074: banco sem tarefa de membro ativo — só a consulta da geração é provada aqui.';
      PERFORM * FROM public.cb_tarefas_recorrentes_gerar(DATE '2026-01-20', 0);
    ELSE
      UPDATE public.cb_tasks
         SET repetir_a_cada_dias = 7,
             serie_id = id,
             proxima_gerada_em = NULL,
             vence_em = DATE '2026-01-05'
       WHERE id = v_base.id;

      SELECT count(*) INTO v_qtd
        FROM public.cb_tarefas_recorrentes_gerar(DATE '2026-01-20', 200);
      IF v_qtd <> 1 THEN
        RAISE EXCEPTION '1074: a geração devia criar 1 tarefa, criou %', v_qtd;
      END IF;

      -- Outra instrução: na mesma, a foto é anterior ao INSERT da função.
      SELECT t.* INTO v_nova
        FROM public.cb_tasks t
       WHERE t.serie_id = v_base.id
         AND t.id <> v_base.id;
      IF v_nova.vence_em IS DISTINCT FROM DATE '2026-01-19' THEN
        RAISE EXCEPTION '1074: a próxima devia vencer em 2026-01-19, vence em %', v_nova.vence_em;
      END IF;
      IF v_nova.titulo IS DISTINCT FROM v_base.titulo
         OR v_nova.contact_id IS DISTINCT FROM v_base.contact_id
         OR v_nova.responsavel_user_id IS DISTINCT FROM v_base.responsavel_user_id
         OR v_nova.vence_as IS DISTINCT FROM v_base.vence_as
         OR v_nova.status <> 'aberta'
         OR v_nova.lida_em IS NOT NULL
         OR v_nova.vista_em IS NOT NULL
         OR v_nova.repetir_a_cada_dias IS DISTINCT FROM 7::smallint
         OR v_nova.proxima_gerada_em IS NOT NULL THEN
        RAISE EXCEPTION '1074: a próxima não herdou o molde da ativa';
      END IF;

      SELECT proxima_gerada_em INTO v_carimbo
        FROM public.cb_tasks WHERE id = v_base.id;
      IF v_carimbo IS NULL THEN
        RAISE EXCEPTION '1074: a antiga ativa não foi carimbada — a série teria duas ativas';
      END IF;

      -- De novo no mesmo dia: nada (a nova vence 26/01).
      SELECT count(*) INTO v_qtd
        FROM public.cb_tarefas_recorrentes_gerar(DATE '2026-01-20', 200);
      IF v_qtd <> 0 THEN
        RAISE EXCEPTION '1074: a segunda rodada no mesmo dia criou % tarefa(s)', v_qtd;
      END IF;

      -- O índice recusa uma segunda ativa na série.
      BEGIN
        UPDATE public.cb_tasks SET proxima_gerada_em = NULL WHERE id = v_base.id;
        RAISE EXCEPTION '1074: o índice aceitou duas ativas na mesma série';
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1074', MESSAGE = 'desfaz a chamada de conferência';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio: `WHEN OTHERS` engoliria o erro que a chamada
    -- existe para mostrar.
    WHEN SQLSTATE 'P1074' THEN
      NULL;
  END;
END $$;
