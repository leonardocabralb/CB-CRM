-- ============================================================
-- 1046 — O celular de cada membro da equipe
--
-- Pedido do operador (26/09/2026): exigir de cada membro o número do celular,
-- para, no futuro, o CRM avisar a pessoa por mensagem particular. Quem ainda
-- não informou é pedido ao abrir o CRM (a tela de exigência, na casca do
-- dashboard) e não usa o sistema sem informar.
--
-- ⚠️⚠️ POR QUE TABELA PRÓPRIA, E NÃO UMA COLUNA EM `profiles`
-- A policy `profiles_select` (017, reescrita na 1032) deixa TODO membro da
-- conta ler a linha de perfil de TODOS os colegas — é o que a lista de
-- responsáveis do inbox, do funil e das tarefas precisa, e quatro telas leem
-- `profiles` com `select('*')`. Uma coluna ali mandaria o celular de cada
-- pessoa ao navegador de cada colega, e a rota de membros "esconder" o campo
-- seria só recorte de tela (é o que acontece hoje com o e-mail). Aqui a
-- barreira é o BANCO: a pessoa lê o próprio número e os administradores da
-- conta dela leem o da equipe. Ninguém mais.
--
-- ⚠️ POR PESSOA, NÃO POR CONTA. A chave é o `user_id` (o login): o celular é
-- da pessoa. `profiles.user_id` é único, então cada pessoa está em UMA conta
-- por vez, e a leitura do administrador pergunta a conta ATUAL dela pelo
-- `profiles` — quem sai da equipe (`remove_account_member` a leva para uma
-- conta própria) deixa de ser lido pelos administradores daqui sem nenhuma
-- escrita nesta tabela. CASCADE em `auth.users`: sem o login, o número não
-- serve a ninguém.
--
-- ⚠️ ESCRITA SÓ PELO SERVIDOR (`PUT /api/cb/meu-celular`, service role).
-- `authenticated` só tem SELECT: é a rota que confere o número pela régua do
-- CRM (`src/lib/account/celular.ts`: o brasileiro ganha o 55 e precisa do 9
-- de celular; o de fora vem com `+`). O CHECK daqui é só o piso de forma
-- (dígitos, sem o 0 na frente, 8 a 15) — a régua inteira mora num lugar só.
-- Sem policy de DELETE nem grant: o celular é EXIGIDO, e apagá-lo pelo
-- navegador devolveria a pessoa à tela de exigência.
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cb_celulares_dos_membros (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Só dígitos, com o código do país (o formato de `contacts.phone`).
  celular text NOT NULL
    CONSTRAINT cb_celulares_dos_membros_celular_ck
    CHECK (celular ~ '^[1-9][0-9]{7,14}$'),

  atualizado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cb_celulares_dos_membros IS
  'Celular de cada membro (uma linha por login). Lê: a própria pessoa e os administradores da conta dela. Grava: só a rota PUT /api/cb/meu-celular, que confere o número.';

ALTER TABLE cb_celulares_dos_membros ENABLE ROW LEVEL SECURITY;

-- ⚠️ A forma da 1032: a conta é perguntada UMA vez por consulta
-- (`= ANY (ARRAY(SELECT …))`), nunca `is_account_member` nem `IN (SELECT …)`,
-- que rodam por linha (há pino em `rls-leitura-1032.test.ts`).
-- ⚠️ O `EXISTS` lê `profiles` com o privilégio de quem chamou: é a policy
-- `profiles_select` que deixa o administrador enxergar a linha do colega.
DROP POLICY IF EXISTS cb_celulares_dos_membros_select ON cb_celulares_dos_membros;
CREATE POLICY cb_celulares_dos_membros_select ON cb_celulares_dos_membros
  FOR SELECT
  USING (
    user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1
        FROM public.profiles p
       WHERE p.user_id = cb_celulares_dos_membros.user_id
         AND p.account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario('admin'::public.account_role_enum)))
    )
  );

-- As duas metades, sempre (CLAUDE.md): tirar de todo mundo, dar por escrito.
REVOKE ALL ON TABLE cb_celulares_dos_membros FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE cb_celulares_dos_membros TO authenticated;
GRANT ALL ON TABLE cb_celulares_dos_membros TO service_role;

-- A policy lê `profiles` como `authenticated`. Em produção é no-op (o
-- privilégio vem do padrão do Supabase); num banco criado do zero, sem isto,
-- a leitura do administrador estouraria "permission denied for table
-- profiles" (regra 1 das migrations no banco vazio).
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- ------------------------------------------------------------
-- Conferência — o RESULTADO, trocando de papel
-- ------------------------------------------------------------
DO $$
DECLARE
  v_admin  uuid;
  v_conta  uuid;
  v_membro uuid;
  v_fora   uuid;
  v_n      int;
  v_barrou boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.cb_celulares_dos_membros'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '1046: RLS não ficou ligada em cb_celulares_dos_membros.';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'cb_celulares_dos_membros') <> 1 THEN
    RAISE EXCEPTION '1046: esperava UMA policy (a de leitura) em cb_celulares_dos_membros.';
  END IF;

  IF has_table_privilege('anon', 'public.cb_celulares_dos_membros', 'SELECT')
     OR has_table_privilege('anon', 'public.cb_celulares_dos_membros', 'INSERT') THEN
    RAISE EXCEPTION '1046: anon ainda alcança cb_celulares_dos_membros.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_celulares_dos_membros', 'SELECT') THEN
    RAISE EXCEPTION '1046: authenticated sem SELECT — a tela de exigência não teria como ler o próprio número.';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_celulares_dos_membros', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_celulares_dos_membros', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_celulares_dos_membros', 'DELETE') THEN
    RAISE EXCEPTION '1046: authenticated escreve em cb_celulares_dos_membros — a escrita é da rota, que confere o número.';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.cb_celulares_dos_membros', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_celulares_dos_membros', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.cb_celulares_dos_membros', 'SELECT') THEN
    RAISE EXCEPTION '1046: service_role sem acesso a cb_celulares_dos_membros — a rota não gravaria.';
  END IF;

  -- Comportamento: um administrador e um membro comum da MESMA conta, e alguém
  -- de outra conta. Derivados do banco; banco vazio pula (regra 2).
  SELECT a.user_id, a.account_id, m.user_id
    INTO v_admin, v_conta, v_membro
    FROM profiles a
    JOIN profiles m ON m.account_id = a.account_id AND m.user_id <> a.user_id
   WHERE a.account_role IN ('owner', 'admin')
     AND m.account_role IN ('agent', 'viewer')
   ORDER BY a.account_id, a.user_id, m.user_id
   LIMIT 1;

  IF v_admin IS NULL THEN
    RAISE NOTICE '1046: sem administrador e membro comum na mesma conta — a leitura foi conferida pela definição, não exercida.';
    RETURN;
  END IF;

  SELECT p.user_id INTO v_fora
    FROM profiles p
   WHERE p.account_id IS NOT NULL AND p.account_id <> v_conta
   ORDER BY p.user_id
   LIMIT 1;

  BEGIN
    -- Os números de teste somem com o bloco (P1046). O ON CONFLICT cobre a
    -- reaplicação depois que a pessoa já informou o número de verdade.
    INSERT INTO cb_celulares_dos_membros (user_id, celular)
    VALUES (v_membro, '5511900000001'), (v_admin, '5511900000002')
    ON CONFLICT (user_id) DO UPDATE SET celular = EXCLUDED.celular;

    -- O membro comum lê SÓ o próprio.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_membro, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM cb_celulares_dos_membros
     WHERE user_id IN (v_membro, v_admin);
    RESET ROLE;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '1046: o membro comum lê % celular(es) — tinha de ler só o próprio.', v_n;
    END IF;

    -- O administrador lê o da equipe.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM cb_celulares_dos_membros
     WHERE user_id IN (v_membro, v_admin);
    RESET ROLE;
    IF v_n <> 2 THEN
      RAISE EXCEPTION '1046: o administrador lê % celular(es) da própria conta — tinha de ler os 2.', v_n;
    END IF;

    -- Quem é de outra conta não lê nenhum dos dois.
    IF v_fora IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_fora, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO v_n FROM cb_celulares_dos_membros
       WHERE user_id IN (v_membro, v_admin);
      RESET ROLE;
      IF v_n <> 0 THEN
        RAISE EXCEPTION '1046: alguém de outra conta lê % celular(es) desta.', v_n;
      END IF;
    END IF;

    -- E o navegador não grava nem o próprio (a régua é da rota).
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_membro, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE cb_celulares_dos_membros SET celular = '5511900000003'
       WHERE user_id = v_membro;
    EXCEPTION
      WHEN insufficient_privilege THEN v_barrou := true;
    END;
    RESET ROLE;
    IF NOT v_barrou THEN
      RAISE EXCEPTION '1046: authenticated gravou o próprio celular sem passar pela rota.';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P1046', MESSAGE = 'desfaz a conferência';
  EXCEPTION
    -- ⚠️ Só o SQLSTATE próprio: `WHEN OTHERS` engoliria o erro que a
    -- conferência existe para mostrar.
    WHEN SQLSTATE 'P1046' THEN
      RAISE NOTICE '1046: leitura conferida trocando de papel (membro, administrador%), desfeita.',
        CASE WHEN v_fora IS NULL THEN '' ELSE ', outra conta' END;
  END;
END $$;
