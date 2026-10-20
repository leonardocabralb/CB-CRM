-- ============================================================
-- 1095 — O PAINEL CONTA MENSAGENS NO BANCO, não no navegador
--
-- Dois cartões do Painel (/dashboard) baixavam as LINHAS de `messages` pelo
-- PostgREST e somavam no navegador, sem `range` nem `count`. O PostgREST corta
-- em 1000 linhas sem avisar (volta `error: null`), e os dois mentiam calados:
--
--   * "Conversas ao longo do tempo" ordenava por `created_at` crescente: as
--     1000 linhas eram as mais ANTIGAS da janela. Medido em 20/10/2026: 30
--     dias = ~25,8 mil mensagens; o gráfico desenhava os dois primeiros dias
--     (o segundo pela metade) e ZERO em todos os outros.
--   * "Tempo de resposta" (14 dias, ordem por `conversation_id`): 13 mil
--     linhas em ~1.000 conversas → a média saía só das ~80 conversas de UUID
--     menor. Não zerava, então ninguém desconfiava.
--
-- Paginar não serve: 30 dias são 26 páginas em fila e 90 dias passam do teto
-- de 25 de `buscarPaginado`. As duas funções devolvem UMA linha por dia (no
-- máximo 90), já somada.
--
-- O desenho, e o porquê de cada peça:
--
--   * `SECURITY INVOKER`: a RLS de `messages` e `conversations` vale dentro
--     da função, exatamente como valia na leitura pelo PostgREST — quem
--     pergunta só conta as mensagens das próprias contas. DEFINER contaria o
--     banco inteiro.
--   * O DIA é o do fuso de QUEM OLHA (`p_fuso`, o IANA do navegador): a tela
--     nomeia os dias com `lastNDayKeys`/`localDayKey`, no fuso do navegador, e
--     o banco roda em UTC — agrupar em UTC jogaria as mensagens das 21h à
--     meia-noite no dia seguinte.
--   * Os FILTROS são os da leitura antiga, e cada um tem pino
--     (`painel-por-dia-1095.test.ts`): grupo fora (o painel é de atendimento
--     1:1); a ligação (1044) fora da série — a atendida é `agent` e contaria
--     como enviada —, mas DENTRO do tempo de resposta, como sempre esteve;
--     a tentativa do robô que não saiu (1080) fora dos dois; `p_canal` nulo =
--     a conta inteira, senão `messages.channel_id`.
--   * O par do tempo de resposta é o do código antigo: a PRIMEIRA fala do
--     cliente sem resposta, fechada pela fala seguinte de fora (equipe ou
--     robô). Cliente que escreve três vezes antes da resposta conta UMA vez.
--     O desempate da ordem é `id` (o código antigo deixava o empate solto).
--     A tela soma os dias por dia da semana e por semana; aqui só se soma.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo chama as RPCs; o antigo não
-- sabe que elas existem.
-- ============================================================

-- ------------------------------------------------------------
-- 1) "Conversas ao longo do tempo": recebidas e enviadas por dia
-- ------------------------------------------------------------
-- Recebida = `sender_type = 'customer'`; o resto (equipe e robô) é enviada.
CREATE OR REPLACE FUNCTION public.cb_painel_mensagens_por_dia(
  p_desde timestamptz,
  p_fuso text,
  p_canal uuid DEFAULT NULL
)
RETURNS TABLE (dia date, recebidas bigint, enviadas bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT (m.created_at AT TIME ZONE p_fuso)::date AS dia,
         count(*) FILTER (WHERE m.sender_type = 'customer') AS recebidas,
         count(*) FILTER (WHERE m.sender_type <> 'customer') AS enviadas
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
   WHERE c.group_id IS NULL
     AND m.created_at >= p_desde
     AND m.content_type <> 'call'
     AND NOT m.nao_saiu
     AND (p_canal IS NULL OR m.channel_id = p_canal)
   GROUP BY 1
   ORDER BY 1
$$;

-- ------------------------------------------------------------
-- 2) "Tempo de resposta": amostras e minutos somados por dia
-- ------------------------------------------------------------
-- `turno` = quantas falas de fora vieram ANTES desta na conversa. A fala de
-- fora de número N tem turno N; as do cliente desde a fala de fora anterior
-- também — então cada (conversa, turno) tem as falas do cliente que esperam e,
-- no máximo, a UMA que as responde. Turno sem fala do cliente (a equipe
-- mandou duas seguidas) ou sem resposta (o cliente ainda espera) não é par.
-- O dia é o da fala do CLIENTE, como no código antigo.
CREATE OR REPLACE FUNCTION public.cb_painel_tempo_de_resposta(
  p_desde timestamptz,
  p_fuso text,
  p_canal uuid DEFAULT NULL
)
RETURNS TABLE (dia date, amostras bigint, soma_minutos double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH falas AS (
    SELECT m.conversation_id,
           m.created_at,
           m.sender_type = 'customer' AS do_cliente,
           count(*) FILTER (WHERE m.sender_type <> 'customer') OVER (
             PARTITION BY m.conversation_id
             ORDER BY m.created_at, m.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
           ) AS turno
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE c.group_id IS NULL
       AND m.created_at >= p_desde
       AND NOT m.nao_saiu
       AND (p_canal IS NULL OR m.channel_id = p_canal)
  ),
  pares AS (
    SELECT min(f.created_at) FILTER (WHERE f.do_cliente) AS cliente_em,
           max(f.created_at) FILTER (WHERE NOT f.do_cliente) AS resposta_em
      FROM falas f
     GROUP BY f.conversation_id, f.turno
  )
  SELECT (p.cliente_em AT TIME ZONE p_fuso)::date AS dia,
         count(*) AS amostras,
         sum(extract(epoch FROM p.resposta_em - p.cliente_em) / 60)::double precision AS soma_minutos
    FROM pares p
   WHERE p.cliente_em IS NOT NULL
     AND p.resposta_em IS NOT NULL
   GROUP BY 1
   ORDER BY 1
$$;

-- Quem abre o Painel é `authenticated`; nada para `anon`. Todo privilégio que
-- a migration confere, ela concede (no banco vazio do replay não há o padrão
-- do Supabase para herdar).
REVOKE EXECUTE ON FUNCTION public.cb_painel_mensagens_por_dia(timestamptz, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cb_painel_tempo_de_resposta(timestamptz, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_painel_mensagens_por_dia(timestamptz, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cb_painel_tempo_de_resposta(timestamptz, text, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Conferência
-- ------------------------------------------------------------
-- As duas RODAM (num banco vazio, devolvem zero linhas; com dado, a janela de
-- 90 dias do Painel), e as concessões e o INVOKER são lidos do catálogo.
DO $$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.cb_painel_mensagens_por_dia(now() - interval '90 days', 'America/Sao_Paulo');
  SELECT count(*) INTO v_n
    FROM public.cb_painel_tempo_de_resposta(now() - interval '14 days', 'America/Sao_Paulo');

  IF has_function_privilege('anon', 'public.cb_painel_mensagens_por_dia(timestamptz, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_painel_tempo_de_resposta(timestamptz, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1095: anon não pode chamar as RPCs do Painel';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cb_painel_mensagens_por_dia(timestamptz, text, uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.cb_painel_tempo_de_resposta(timestamptz, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1095: authenticated precisa chamar as RPCs do Painel';
  END IF;
  IF (SELECT bool_or(prosecdef) FROM pg_proc
       WHERE oid IN ('public.cb_painel_mensagens_por_dia(timestamptz, text, uuid)'::regprocedure,
                     'public.cb_painel_tempo_de_resposta(timestamptz, text, uuid)'::regprocedure)) THEN
    RAISE EXCEPTION '1095: as RPCs do Painel têm de ser SECURITY INVOKER — a RLS de messages é a cerca';
  END IF;
END $$;
