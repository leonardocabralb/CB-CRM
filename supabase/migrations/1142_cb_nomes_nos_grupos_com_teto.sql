-- ============================================================
-- 1142 — A BUSCA POR PARTICIPANTE lê só as ÚLTIMAS 1000 mensagens com nome
-- de cada grupo
--
-- Achado da revisão do porte ao Atlas: a `cb_nomes_nos_grupos` (1126) lia
-- TODA mensagem de grupo da conta a cada busca (um JOIN com `messages` sem
-- teto). Com 500 mil mensagens, de 260 a 680 ms numa máquina rápida, e
-- crescendo com o tempo até o teto de 8 s do `authenticated` — e aí a busca
-- por participante some sem erro.
--
-- O que muda, e só isto: o corpo da RPC. O nome com que cada um escreveu no
-- grupo sai das ÚLTIMAS 1000 mensagens com nome de cada grupo, pelo índice
-- `(conversation_id, created_at)` da 0941 (`messages_conversa_data_idx`), de
-- trás para a frente — o mesmo teto de `nomes-dos-participantes.ts`. Quem só
-- escreveu antes delas, e não tem ficha, não é achado (`grupos.md`). As
-- fichas ligadas (1117) seguem iguais. Assinatura, retorno e privilégios
-- iguais aos da 1126.
--
-- ⚠️ Não se edita a 1126 (já aplicada): esta a substitui por CREATE OR
-- REPLACE. Sem dependência de ordem com o deploy (o app chama a mesma RPC,
-- com a mesma forma); aplicar a qualquer momento.
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.cb_nomes_nos_grupos(p_conta uuid)
RETURNS TABLE (group_id uuid, nomes text[])
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH nomes AS (
    -- Clientes com ficha no grupo (a ficha na Lixeira já não existe: sai).
    SELECT gc.group_id, btrim(c.name) AS nome
      FROM cb_grupos_dos_contatos gc
      JOIN contacts c ON c.id = gc.contact_id
     WHERE gc.account_id = p_conta
       AND btrim(coalesce(c.name, '')) <> ''
    UNION
    -- O nome com que cada um escreveu no grupo, nas últimas 1000 mensagens
    -- com nome de cada grupo (ver o cabeçalho).
    SELECT cv.group_id, btrim(r.group_sender_name)
      FROM conversations cv
      CROSS JOIN LATERAL (
        SELECT m.group_sender_name
          FROM messages m
         WHERE m.conversation_id = cv.id
           AND m.group_sender_name IS NOT NULL
         ORDER BY m.created_at DESC
         LIMIT 1000
      ) r
     WHERE cv.account_id = p_conta
       AND cv.group_id IS NOT NULL
       AND btrim(r.group_sender_name) <> ''
  )
  SELECT n.group_id, array_agg(n.nome ORDER BY n.nome) AS nomes
    FROM nomes n
   GROUP BY n.group_id
$$;

-- O CREATE OR REPLACE mantém os privilégios da 1126; reescritos aqui para o
-- banco vazio e para não depender dela.
REVOKE EXECUTE ON FUNCTION public.cb_nomes_nos_grupos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_nomes_nos_grupos(uuid) TO authenticated, service_role;

-- SECURITY INVOKER lê com o privilégio de quem chama (banco vazio).
GRANT SELECT ON TABLE cb_grupos_dos_contatos, contacts, conversations, messages
  TO authenticated, service_role;

-- Sem ninguém ouvindo (o replay do CI), é no-op.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Conferências — todas válidas num banco VAZIO (nenhuma exige dado)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.cb_nomes_nos_grupos(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1142: anon executa a cb_nomes_nos_grupos';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_nomes_nos_grupos(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1142: service_role sem EXECUTE na cb_nomes_nos_grupos';
  END IF;
  -- O corpo novo, e não o da 1126, é o que ficou.
  IF position('LIMIT 1000' IN pg_get_functiondef('public.cb_nomes_nos_grupos(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '1142: a cb_nomes_nos_grupos ainda lê o histórico inteiro';
  END IF;
END $$;

-- ⚠️ SECURITY INVOKER: só trocando de papel se prova que `authenticated`
-- chama. Conta inexistente → vazio.
DO $$
DECLARE
  v_n integer;
BEGIN
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.cb_nomes_nos_grupos(gen_random_uuid());
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '1142: conta inexistente devolveu % grupo(s)', v_n;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '1142: authenticated não consegue executar a cb_nomes_nos_grupos: %', SQLERRM;
END $$;
