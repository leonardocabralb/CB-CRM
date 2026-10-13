-- ============================================================
-- 1089 — POSSÍVEL DUPLICATA sem varrer a conta (conserto de desempenho da 1088)
--
-- Medido em produção logo depois de aplicar a 1088 (13/10/2026), como
-- `authenticated` e com a RLS valendo: 289 ms por chamada, e a conversa abre
-- chamando a RPC. O plano mostrou o porquê: nos sinais 2 (telefone) e 3
-- (horário) o planejador juntou `eu` com `contacts` por HASH sobre
-- `cb_primeiro_nome(o.name)` — calculou o primeiro nome das 5.780 fichas da
-- conta (~215 ms, duas vezes) em vez de achar as candidatas pelo índice e
-- conferir o nome só delas.
--
-- O conserto, sem mudar o RESULTADO (os cenários da 1088 continuam valendo):
--   * as candidatas saem PRIMEIRO, em CTE `MATERIALIZED` (a cerca que o
--     planejador não atravessa): pelo telefone — cada vizinho por IGUALDADE
--     (`unnest`), nunca `= ANY (lista)`, que comparava cada ficha da conta
--     com a lista inteira — e pela janela de criação; o primeiro nome é
--     conferido DEPOIS, só nelas;
--   * a lista de vizinhos do telefone e a janela de ±2 min são calculadas UMA
--     vez, na própria ficha (`eu`): sob RLS, condição com função que não é
--     LEAKPROOF não vira condição de índice (`timestamptz_mi_interval` não é),
--     e a comparação nua (`=`, `BETWEEN` de timestamp) é;
--   * `telefone_canonico <> ''` repetido na junção: é o predicado do índice
--     parcial do telefone canônico.
-- Medido num Postgres com 6 mil fichas, como `authenticated`: o corpo da
-- 1088 levava 49 ms; este, ~4 ms.
-- O e-mail continua varrendo as fichas da conta (`lower`/`btrim` não são
-- LEAKPROOF, nenhum índice ajuda sob a RLS): ~5 ms, medido no mesmo plano.
--
-- ⚠️ A 1088 foi APLICADA: o conserto é migration nova, nunca a 1088 editada.
-- Aplicada na produção do CB como `1086_cb_duplicatas_sem_varredura` e
-- renumerada para 1089 (o porquê está no cabeçalho da 1088). O teste
-- `possiveis-duplicatas-1088.test.ts` lê a ÚLTIMA definição da RPC.
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
  -- vizinho por vez (`unnest`). Medido num Postgres com 6 mil fichas: com
  -- `= ANY (eu.vizinhos)` o planejador comparava cada ficha da conta com a
  -- lista inteira (13 ms só aqui); desdobrada, o corpo todo leva ~4 ms.
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
  -- … e o mesmo primeiro nome só nelas.
  por_telefone AS (
    SELECT v.id, 2 AS ordem, jsonb_build_object('tipo', 'telefone_parecido') AS motivo
      FROM vizinhas v
      CROSS JOIN eu
     WHERE v.id <> eu.id
       AND public.cb_primeiro_nome(v.name) = eu.nome
  ),

  -- 3) Criadas com até 2 min de diferença: as candidatas pelo ÍNDICE…
  da_mesma_hora AS MATERIALIZED (
    SELECT o.id, o.name, o.created_at
      FROM eu
      JOIN public.contacts o
        ON o.account_id = eu.account_id
       AND o.created_at BETWEEN eu.janela_de AND eu.janela_ate
     WHERE eu.nome IS NOT NULL
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
              FROM public.contacts x
             WHERE x.account_id = eu.account_id
               AND x.created_at BETWEEN least(eu.created_at, h.created_at) - interval '1 minute'
                                    AND greatest(eu.created_at, h.created_at) + interval '1 minute') <= 10
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

-- `CREATE OR REPLACE` mantém os privilégios da 1088; repetidos aqui para a
-- forma valer sozinha (nada para `anon`; quem chama é `authenticated`).
REVOKE EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cb_possiveis_duplicatas(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.cb_possiveis_duplicatas(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '1089: a RPC tem de continuar SECURITY INVOKER — a RLS de contacts é a cerca';
  END IF;
  IF has_function_privilege('anon', 'public.cb_possiveis_duplicatas(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1089: anon não pode chamar cb_possiveis_duplicatas';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.cb_possiveis_duplicatas(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1089: authenticated precisa chamar a RPC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'idx_contacts_account_telefone_canonico') THEN
    RAISE NOTICE '1089: sem o índice do telefone canônico (1024), o sinal 2 varre a conta.';
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
    RAISE NOTICE '1089: banco sem fichas, nada a perguntar.';
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM public.cb_possiveis_duplicatas(v_id);
  RAISE NOTICE '1089: a RPC respondeu sobre a ficha mais nova: % candidata(s).', v_n;
END $$;
