-- ============================================================
-- 1117 — GRUPOS DO CLIENTE (vínculo entre o grupo e a ficha de quem está nele)
--
-- Pedido do operador em 30/10/2026: o cliente que participa de um grupo de
-- WhatsApp vê o grupo na ficha dele (aba Relacionados do painel da conversa)
-- e abre o grupo por ali — e, no grupo, o participante com conversa no CRM
-- abre a conversa individual. Plano: `docs/PLANO-participantes-do-grupo.md`,
-- Fase 5.
--
-- O desenho, e o porquê de cada peça:
--
--   * Guarda-se SÓ quem tem FICHA, nunca a lista de participantes: o
--     telefone de quem não é cliente continua existindo só na leitura ao vivo
--     do painel do grupo. Uma linha = "esta ficha estava neste grupo na
--     última vez que a lista foi conferida" (`visto_em`).
--   * Quem escreve é só o SERVIDOR (service role), a cada leitura completa da
--     lista: o painel do grupo, o "Sincronizar" e o detalhe na chegada da
--     mensagem (`src/lib/cb-groups/fichas-do-grupo.ts`), sempre pela função
--     `cb_gravar_fichas_do_grupo`: ela refaz o conjunto do grupo inteiro
--     (apaga quem saiu, grava quem está, carimba) numa transação, com o grupo
--     TRAVADO. Feito em três pedidos soltos, duas conferências ao mesmo tempo
--     se cruzavam e apagavam quem estava nas duas listas. Nenhuma policy de
--     escrita, e o navegador sem INSERT/UPDATE/DELETE (sem o REVOKE, um
--     DELETE do navegador voltaria "0 linhas" e pareceria certo).
--   * `cb_groups.participantes_conferidos_em` diz QUANDO a lista do grupo foi
--     conferida contra as fichas: a chegada de mensagem num grupo conferido
--     há mais de 24 h o confere de novo (`detalhar-na-chegada.ts`). Nula =
--     nunca conferida — todo grupo existente, até a primeira mensagem ou o
--     "Sincronizar" depois desta migration.
--   * ⚠️⚠️ `contact_id` SEM FK, de propósito: a Lixeira (1097) e a união de
--     fichas (`cb_unir_fichas`, 1093) são DEFAULT-DENY sobre as FKs para
--     `contacts` — uma FK aqui faria toda exclusão e toda união RECUSAREM até
--     as duas aprenderem a tabela (o precedente é o `note_id` da 1114). A
--     ficha que sai (Lixeira, união, exclusão de vez) deixa a linha SOLTA até
--     a próxima conferência do grupo, que a apaga (a ficha não existe) e liga
--     a que ficou. A ficha restaurada volta com o mesmo id e é religada na
--     conferência seguinte. A tela lê pelo contato aberto: linha solta não
--     aparece em lugar nenhum, e guarda só dois ids.
--   * `group_id` com FK COMPOSTA `(group_id, account_id)` →
--     `cb_groups (id, account_id)` (padrão da 944/1069): uma FK simples
--     aceitaria o grupo de OUTRA conta. CASCADE: grupo apagado leva o vínculo.
--   * Leitura: qualquer membro, na forma da 1032.
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo grava a tabela e a coluna, e
-- a tela da ficha as lê (sem elas, a ingestão de grupo segue — ela tolera a
-- coluna ausente — mas o vínculo não nasce).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ------------------------------------------------------------
-- 1) A coluna em cb_groups
-- ------------------------------------------------------------
ALTER TABLE public.cb_groups
  ADD COLUMN IF NOT EXISTS participantes_conferidos_em timestamptz;

COMMENT ON COLUMN public.cb_groups.participantes_conferidos_em IS
  'Última vez que a lista de participantes foi conferida contra as fichas (1117). Nula = nunca.';

-- Alvo da FK composta.
CREATE UNIQUE INDEX IF NOT EXISTS cb_groups_id_account_idx
  ON public.cb_groups (id, account_id);

-- ------------------------------------------------------------
-- 2) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_grupos_dos_contatos (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  group_id uuid NOT NULL,
  -- Sem FK: ver o cabeçalho.
  contact_id uuid NOT NULL,
  visto_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_id),
  CONSTRAINT cb_grupos_dos_contatos_grupo_fkey
    FOREIGN KEY (group_id, account_id)
    REFERENCES public.cb_groups (id, account_id) ON DELETE CASCADE
);

-- A ficha aberta procura os grupos dela.
CREATE INDEX IF NOT EXISTS cb_grupos_dos_contatos_contato_idx
  ON public.cb_grupos_dos_contatos (contact_id);

COMMENT ON TABLE public.cb_grupos_dos_contatos IS
  'Fichas que estavam no grupo na última conferência da lista (1117). Escrita só pelo servidor.';

-- ------------------------------------------------------------
-- 3) RLS + privilégios
-- ------------------------------------------------------------
ALTER TABLE public.cb_grupos_dos_contatos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_grupos_dos_contatos_select ON public.cb_grupos_dos_contatos;
CREATE POLICY cb_grupos_dos_contatos_select ON public.cb_grupos_dos_contatos FOR SELECT
  USING (account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario())));

REVOKE ALL ON public.cb_grupos_dos_contatos FROM anon, authenticated;
GRANT SELECT ON public.cb_grupos_dos_contatos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cb_grupos_dos_contatos TO service_role;

-- ------------------------------------------------------------
-- 4) A conferência do grupo, numa transação só
--
-- `p_contact_ids` = as fichas de quem está no grupo AGORA (sem os números do
-- escritório). NULO = a leitura não diz quem é quem (nenhum participante com
-- telefone): só carimba, sem mexer no vínculo. Devolve `true` quando o grupo
-- existe nesta conta (e foi carimbado); NULO, senão.
--
-- SECURITY INVOKER: quem chama é o service role. A trava (`FOR UPDATE` no
-- grupo) faz a segunda conferência do mesmo grupo esperar a primeira.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cb_gravar_fichas_do_grupo(
  p_account_id uuid,
  p_group_id uuid,
  p_contact_ids uuid[]
) RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT 1 FROM public.cb_groups
   WHERE id = p_group_id AND account_id = p_account_id
   FOR UPDATE;

  DELETE FROM public.cb_grupos_dos_contatos
   WHERE p_contact_ids IS NOT NULL
     AND account_id = p_account_id
     AND group_id = p_group_id
     AND NOT (contact_id = ANY (p_contact_ids));

  INSERT INTO public.cb_grupos_dos_contatos (account_id, group_id, contact_id, visto_em)
  SELECT DISTINCT p_account_id, p_group_id, c, now()
    FROM unnest(p_contact_ids) AS c
   WHERE c IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.cb_groups g
        WHERE g.id = p_group_id AND g.account_id = p_account_id
     )
  ON CONFLICT (group_id, contact_id) DO UPDATE SET visto_em = EXCLUDED.visto_em;

  UPDATE public.cb_groups
     SET participantes_conferidos_em = now()
   WHERE id = p_group_id AND account_id = p_account_id
  RETURNING true;
$$;

REVOKE EXECUTE ON FUNCTION public.cb_gravar_fichas_do_grupo(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cb_gravar_fichas_do_grupo(uuid, uuid, uuid[]) TO service_role;

-- ------------------------------------------------------------
-- 5) Conferência
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_groups'
       AND column_name = 'participantes_conferidos_em'
  ) THEN
    RAISE EXCEPTION '1117: falta cb_groups.participantes_conferidos_em';
  END IF;

  -- Sem FK para contacts: a Lixeira e a união recusariam (default-deny).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_grupos_dos_contatos'::regclass
       AND contype = 'f' AND confrelid = 'public.contacts'::regclass
  ) THEN
    RAISE EXCEPTION '1117: cb_grupos_dos_contatos não pode ter FK para contacts';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_grupos_dos_contatos'::regclass
       AND contype = 'f' AND confrelid = 'public.cb_groups'::regclass
       AND confdeltype = 'c' AND array_length(conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION '1117: a FK para cb_groups tem de ser composta e ON DELETE CASCADE';
  END IF;

  IF has_table_privilege('anon', 'public.cb_grupos_dos_contatos', 'SELECT') THEN
    RAISE EXCEPTION '1117: anon não pode ler cb_grupos_dos_contatos';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.cb_grupos_dos_contatos', 'SELECT') THEN
    RAISE EXCEPTION '1117: authenticated precisa de SELECT (a RLS decide quem)';
  END IF;

  IF has_table_privilege('authenticated', 'public.cb_grupos_dos_contatos', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_grupos_dos_contatos', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_grupos_dos_contatos', 'DELETE') THEN
    RAISE EXCEPTION '1117: só o servidor escreve em cb_grupos_dos_contatos';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.cb_grupos_dos_contatos', 'DELETE') THEN
    RAISE EXCEPTION '1117: service_role precisa escrever (a conferência do grupo)';
  END IF;

  IF has_function_privilege('authenticated', 'public.cb_gravar_fichas_do_grupo(uuid, uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.cb_gravar_fichas_do_grupo(uuid, uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '1117: só o servidor chama cb_gravar_fichas_do_grupo';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.cb_gravar_fichas_do_grupo(uuid, uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION '1117: service_role precisa chamar cb_gravar_fichas_do_grupo';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cb_grupos_dos_contatos'
       AND cmd = 'SELECT' AND qual NOT LIKE '%cb_contas_do_usuario%'
  ) THEN
    RAISE EXCEPTION '1117: a policy de leitura tem de ter a forma da 1032';
  END IF;
END $$;

-- A função refaz o conjunto (grava, apaga quem saiu, NULO só carimba) e a FK
-- composta recusa o grupo de OUTRA conta. Precisa de um grupo e de uma
-- segunda conta: num banco vazio (o replay do CI) não há o que provar. A
-- prova grava e se DESFAZ pelo SQLSTATE próprio — nunca `WHEN OTHERS`.
DO $$
DECLARE
  v_grupo uuid;
  v_conta uuid;
  v_outra uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_ok boolean;
  v_linhas int;
BEGIN
  SELECT g.id, g.account_id INTO v_grupo, v_conta FROM public.cb_groups g LIMIT 1;
  SELECT a.id INTO v_outra FROM public.accounts a WHERE a.id <> v_conta LIMIT 1;

  IF v_grupo IS NULL OR v_outra IS NULL THEN
    RAISE NOTICE '1117: banco sem grupo e segunda conta, nada a provar.';
    RETURN;
  END IF;

  BEGIN
    v_ok := public.cb_gravar_fichas_do_grupo(v_conta, v_grupo, ARRAY[v_a, v_b, v_b]);
    SELECT count(*) INTO v_linhas FROM public.cb_grupos_dos_contatos
     WHERE group_id = v_grupo AND contact_id IN (v_a, v_b);
    IF v_ok IS NOT TRUE OR v_linhas <> 2 THEN
      RAISE EXCEPTION '1117: a conferência não gravou as duas fichas (ok=%, linhas=%)', v_ok, v_linhas;
    END IF;

    PERFORM public.cb_gravar_fichas_do_grupo(v_conta, v_grupo, ARRAY[v_a]);
    IF EXISTS (SELECT 1 FROM public.cb_grupos_dos_contatos WHERE group_id = v_grupo AND contact_id = v_b) THEN
      RAISE EXCEPTION '1117: quem saiu do grupo continuou ligado';
    END IF;

    PERFORM public.cb_gravar_fichas_do_grupo(v_conta, v_grupo, NULL);
    IF NOT EXISTS (SELECT 1 FROM public.cb_grupos_dos_contatos WHERE group_id = v_grupo AND contact_id = v_a) THEN
      RAISE EXCEPTION '1117: a conferência só de carimbo mexeu no vínculo';
    END IF;

    IF public.cb_gravar_fichas_do_grupo(v_outra, v_grupo, ARRAY[v_b]) IS NOT NULL THEN
      RAISE EXCEPTION '1117: a conferência aceitou o grupo de outra conta';
    END IF;

    BEGIN
      INSERT INTO public.cb_grupos_dos_contatos (account_id, group_id, contact_id)
      VALUES (v_outra, v_grupo, gen_random_uuid());
      RAISE EXCEPTION '1117: o grupo de outra conta foi aceito';
    EXCEPTION WHEN foreign_key_violation THEN
      NULL;
    END;
    RAISE EXCEPTION USING ERRCODE = 'P1117', MESSAGE = '1117: desfaz a prova';
  EXCEPTION WHEN SQLSTATE 'P1117' THEN
    NULL;
  END;
END $$;
