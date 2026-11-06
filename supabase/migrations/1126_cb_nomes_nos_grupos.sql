-- ============================================================
-- 1126 — OS NOMES DE QUEM ESTÁ NOS GRUPOS: a busca da caixa de entrada acha
-- o grupo pelo nome de um participante
--
-- Pedido do operador (06/11/2026): buscar o grupo pelo nome do grupo, pelo
-- apelido interno (os dois a busca já olhava) e pelo nome das pessoas.
--
-- O que muda, e só isto: a RPC `cb_nomes_nos_grupos(p_conta)`, uma linha por
-- grupo com os nomes que o CRM SABE de quem está nele:
--   - os clientes com ficha ligados ao grupo (1117, `cb_grupos_dos_contatos`);
--   - o nome com que cada pessoa escreveu no grupo (`messages.group_sender_name`).
-- ⚠️ Não é a lista inteira de participantes, e não pode ser: ela não é
-- guardada (só se lê ao vivo; o telefone de quem não é cliente só existe
-- nessa leitura, decisão D4 de 29/10/2026). Quem nunca escreveu e não tem
-- ficha não é achado — limite escrito em `.claude/rules/grupos.md`.
--
-- Agrupada NO BANCO: do navegador, ler `messages` para tirar os nomes passaria
-- por milhares de linhas e pelo corte de 1000 do PostgREST.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo chama a RPC; o antigo não.
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
    -- O nome com que cada um escreveu no grupo.
    SELECT cv.group_id, btrim(m.group_sender_name)
      FROM conversations cv
      JOIN messages m ON m.conversation_id = cv.id
     WHERE cv.account_id = p_conta
       AND cv.group_id IS NOT NULL
       AND btrim(coalesce(m.group_sender_name, '')) <> ''
  )
  SELECT n.group_id, array_agg(n.nome ORDER BY n.nome) AS nomes
    FROM nomes n
   GROUP BY n.group_id
$$;

-- EXECUTE nasce concedido a PUBLIC; o REVOKE de PUBLIC leva o service_role
-- junto, então quem usa ganha de volta, por escrito.
REVOKE EXECUTE ON FUNCTION public.cb_nomes_nos_grupos(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_nomes_nos_grupos(uuid) TO authenticated, service_role;

-- SECURITY INVOKER lê com o privilégio de quem chama (banco vazio).
GRANT SELECT ON TABLE cb_grupos_dos_contatos, contacts, conversations, messages
  TO authenticated, service_role;

-- O PostgREST converte o corpo pelo TIPO dos argumentos que tem em cache.
-- Sem ninguém ouvindo (o replay do CI), é no-op.
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Conferências — todas válidas num banco VAZIO (nenhuma exige dado)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.cb_nomes_nos_grupos(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1126: anon executa a cb_nomes_nos_grupos';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.cb_nomes_nos_grupos(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '1126: service_role sem EXECUTE na cb_nomes_nos_grupos';
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
    RAISE EXCEPTION '1126: conta inexistente devolveu % grupo(s)', v_n;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '1126: authenticated não consegue executar a cb_nomes_nos_grupos: %', SQLERRM;
END $$;
