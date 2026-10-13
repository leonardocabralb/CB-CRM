-- ============================================================
-- 1087 — POSSÍVEL DUPLICATA: a ficha importada em lote não paga o lote
--
-- Medido em produção depois de aplicar a 1086 (13/10/2026): 3.874 das 5.784
-- fichas nasceram em dois minutos seguidos (uma importação). Para qualquer
-- uma delas, o sinal 3 (horário) trazia as ~3,9 mil fichas da janela de
-- ±2 min, calculava o primeiro nome de todas e, para cada candidata com o
-- mesmo nome, recontava a janela inteira — para no fim concluir "lote" e
-- não devolver nada. Só esse sinal levava ~180 ms por ficha, e a conferência
-- da base inteira estourou o tempo do banco. A 1086 só valia para as fichas
-- de fora do lote.
--
-- O conserto, sem mudar o RESULTADO:
--   * `eu` conta as fichas da conta entre 1 min antes e 1 min depois DELA,
--     parando na 11ª. Toda janela de par (1 min antes da primeira até 1 min
--     depois da segunda) CONTÉM essa, porque a ficha é uma das duas pontas:
--     se ali já há mais de 10 fichas, nenhum par passa no limite de 10, e as
--     candidatas do horário nem são buscadas;
--   * a contagem de cada par também para na 11ª (`LIMIT 11`): passar de 10 já
--     reprova, e a ficha vizinha de um lote não reconta o lote.
-- A referência à ficha dentro das contagens vira parâmetro: sob a RLS, a
-- condição de índice continua valendo.
-- Medido num Postgres 16 com 8 mil fichas e um lote de 2 mil em 90 s, como
-- `authenticated` (média de 50 chamadas): ficha do lote 52 ms → 3,3 ms; ficha
-- comum igual nas duas; a RPC sobre a base inteira devolve as mesmas 14
-- linhas (mesma assinatura) com a 1086 e com esta.
--
-- A 1084 e a 1086 foram APLICADAS: o conserto é migration nova. A 1085 é de
-- outra frente (sentinela do WhatsApp). O teste
-- `possiveis-duplicatas-1084.test.ts` lê ESTA definição da RPC (a última).
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cb_possiveis_duplicatas(p_contato uuid)
RETURNS TABLE (outro_id uuid, motivos jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH eu AS MATERIALIZED (
    SELECT c.id,
           c.account_id,
           c.created_at,
           c.created_at - interval '2 minutes' AS janela_de,
           c.created_at + interval '2 minutes' AS janela_ate,
           -- As fichas em volta DELA (±1 min), até 11: mais de 10 = lote.
           (SELECT count(*)
              FROM (SELECT 1
                      FROM public.contacts x
                     WHERE x.account_id = c.account_id
                       AND x.created_at BETWEEN c.created_at - interval '1 minute'
                                            AND c.created_at + interval '1 minute'
                     LIMIT 11) AS t) AS em_volta,
           nullif(lower(btrim(c.email)), '') AS email,
           public.cb_primeiro_nome(c.name) AS nome,
           public.cb_vizinhos_do_telefone(nullif(c.telefone_canonico, '')) AS vizinhos
      FROM public.contacts c
     WHERE c.id = p_contato
  ),

  -- 1) Mesmo e-mail, fora de endereço de reserva (em mais de 3 fichas).
  por_email AS (
    SELECT o.id, 1 AS ordem, jsonb_build_object('tipo', 'mesmo_email') AS motivo
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.id <> eu.id
       AND o.email IS NOT NULL
       AND lower(btrim(o.email)) = eu.email
     WHERE eu.email IS NOT NULL
       AND (SELECT count(*)
              FROM public.contacts x
             WHERE x.account_id = eu.account_id
               AND x.email IS NOT NULL
               AND lower(btrim(x.email)) = eu.email) <= 3
  ),

  -- 2) Telefone a um dígito de distância: as candidatas por IGUALDADE, um
  -- vizinho por vez (`unnest`), e o primeiro nome conferido só nelas.
  vizinhas AS MATERIALIZED (
    SELECT o.id, o.name
      FROM eu
      CROSS JOIN LATERAL unnest(eu.vizinhos) AS v(tel)
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.telefone_canonico <> ''
       AND o.telefone_canonico = v.tel
     WHERE eu.nome IS NOT NULL
  ),
  por_telefone AS (
    SELECT v.id, 2 AS ordem, jsonb_build_object('tipo', 'telefone_parecido') AS motivo
      FROM vizinhas v
      CROSS JOIN eu
     WHERE v.id <> eu.id
       AND public.cb_primeiro_nome(v.name) = eu.nome
  ),

  -- 3) Criadas com até 2 min de diferença: as candidatas pelo ÍNDICE, e só
  -- quando a ficha não nasceu num lote (ver o cabeçalho)…
  da_mesma_hora AS MATERIALIZED (
    SELECT o.id, o.name, o.created_at
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.created_at BETWEEN eu.janela_de AND eu.janela_ate
     WHERE eu.nome IS NOT NULL
       AND eu.em_volta <= 10
  ),
  -- … e o mesmo primeiro nome, fora de lote (no máximo 10 fichas na conta
  -- entre 1 min antes da primeira e 1 min depois da segunda), só nelas.
  por_horario AS (
    SELECT h.id, 3 AS ordem,
           jsonb_build_object(
             'tipo', 'criadas_juntas',
             'segundos', round(abs(extract(epoch FROM h.created_at - eu.created_at)))::int
           ) AS motivo
      FROM da_mesma_hora h
      CROSS JOIN eu
     WHERE h.id <> eu.id
       AND public.cb_primeiro_nome(h.name) = eu.nome
       AND (SELECT count(*)
              FROM (SELECT 1
                      FROM public.contacts x
                     WHERE x.account_id = eu.account_id
                       AND x.created_at BETWEEN least(eu.created_at, h.created_at) - interval '1 minute'
                                            AND greatest(eu.created_at, h.created_at) + interval '1 minute'
                     LIMIT 11) AS t) <= 10
  ),

  sinais AS (
    SELECT * FROM por_email
    UNION ALL
    SELECT * FROM por_telefone
    UNION ALL
    SELECT * FROM por_horario
  )
  SELECT s.id AS outro_id,
         jsonb_agg(s.motivo ORDER BY s.ordem) AS motivos
    FROM sinais s
    CROSS JOIN eu
   WHERE NOT EXISTS (
           SELECT 1
             FROM public.cb_duplicatas_descartadas d
            WHERE d.contato_menor = least(eu.id, s.id)
              AND d.contato_maior = greatest(eu.id, s.id))
     AND NOT EXISTS (
           SELECT 1
             FROM public.cb_contatos_relacionados r
            WHERE least(r.contact_a_id, r.contact_b_id) = least(eu.id, s.id)
              AND greatest(r.contact_a_id, r.contact_b_id) = greatest(eu.id, s.id))
   GROUP BY s.id
   ORDER BY min(s.ordem), s.id
$$;

-- `CREATE OR REPLACE` mantém os privilégios; repetidos aqui para a forma
-- valer sozinha (nada para `anon`; quem chama é `authenticated`).
REVOKE EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.cb_possiveis_duplicatas(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '1087: a RPC tem de continuar SECURITY INVOKER — a RLS de contacts é a cerca';
  END IF;
  IF has_function_privilege('anon', 'public.cb_possiveis_duplicatas(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1087: anon não pode chamar cb_possiveis_duplicatas';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cb_possiveis_duplicatas(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1087: authenticated precisa chamar a RPC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'idx_contacts_conta_criacao') THEN
    RAISE EXCEPTION '1087: sem o índice de (account_id, created_at) da 1084, o sinal 3 varre a conta';
  END IF;
END $$;

-- A RPC roda de verdade sobre uma ficha, quando há ficha. Num banco vazio (o
-- replay do CI) não há o que perguntar.
DO $$
DECLARE
  v_id uuid;
  v_n integer;
BEGIN
  SELECT id INTO v_id FROM public.contacts ORDER BY created_at DESC LIMIT 1;
  IF v_id IS NULL THEN
    RAISE NOTICE '1087: banco sem fichas, nada a perguntar.';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM public.cb_possiveis_duplicatas(v_id);
  RAISE NOTICE '1087: a RPC respondeu sobre a ficha mais nova: % candidata(s).', v_n;
END $$;
