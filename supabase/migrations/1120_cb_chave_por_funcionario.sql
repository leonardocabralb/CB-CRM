-- ============================================================
-- 1120 — Chave de API do FUNCIONÁRIO, recortada por FUNIL
--
-- Pedido do operador (04/11/2026, `docs/PLANO-chave-por-funcionario.md`):
-- cada funcionário recebe a PRÓPRIA chave, só de leitura, para o Claude dele
-- ler a conversa e os documentos de um cliente e montar a ficha de
-- atendimento. Duas colunas novas em `api_keys`:
--
--   · `membro_user_id` — o funcionário dono da chave. Nulo = chave da CONTA,
--     como toda chave de hoje (n8n, Make, iMotion): nada muda para elas.
--     A conferência da suspensão (1067) e da remoção NÃO mora aqui: ela é do
--     caminho da chave (`requireApiKey`), que lê o perfil do funcionário na
--     conta da chave a cada chamada. A API roda em service role, então o corte
--     de `is_account_member` não a alcança sozinho.
--     ⚠️ `ON DELETE CASCADE`, de propósito: a chave é credencial da PESSOA.
--     Com SET NULL, apagar o login dela transformaria a chave numa chave da
--     conta inteira (falha ABERTA). Por isso `api_keys` entra na lista do
--     dado da pessoa do `supabase/ci/verify-schema.sql` (1116).
--
--   · `funis` — os funis que a chave enxerga. Nulo = todos (como hoje). O
--     recorte também mora no código (`src/lib/api/v1/recorte-por-funil.ts`):
--     chave recortada só funciona nas rotas que sabem recortar; as outras a
--     recusam. ⚠️ Lista VAZIA é recusada pelo CHECK: aqui vazio não pode
--     significar "todos" (a régua das conexões) nem "nenhum" por acidente.
--     Sem FK por elemento: um funil apagado deixa o id solto, que não casa
--     com nada — fecha, nunca abre.
--
-- ⚠️ ADITIVA: colunas anuláveis, sem gatilho, sem linha mudada. Serve ao app
-- de antes e ao de depois — aplicar ANTES do deploy (o app novo as lê no
-- caminho de TODA chamada da API: sem elas, o PostgREST recusa a leitura e a
-- API inteira responde 500). Idempotente.
-- ============================================================

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS membro_user_id uuid
    REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS funis uuid[];

-- CHECK com nome (989): DROP + ADD pelo nome, idempotente.
ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_funis_nao_vazio,
  ADD CONSTRAINT api_keys_funis_nao_vazio
    CHECK (funis IS NULL OR cardinality(funis) > 0);

COMMENT ON COLUMN public.api_keys.membro_user_id IS
  '1120: funcionário dono da chave (nulo = chave da conta). Suspenso ou fora da conta = chave recusada (requireApiKey).';
COMMENT ON COLUMN public.api_keys.funis IS
  '1120: funis que a chave enxerga (nulo = todos; vazio recusado). Chave recortada só nas rotas que recortam.';

-- ------------------------------------------------------------
-- Conferência: as duas colunas, a FK em CASCADE (uma só) e o CHECK.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_acoes text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.api_keys'::regclass
       AND attname = 'membro_user_id' AND NOT attisdropped
       AND atttypid = 'uuid'::regtype
  ) THEN
    RAISE EXCEPTION '1120: api_keys.membro_user_id ausente ou com outro tipo';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.api_keys'::regclass
       AND attname = 'funis' AND NOT attisdropped
       AND atttypid = 'uuid[]'::regtype
  ) THEN
    RAISE EXCEPTION '1120: api_keys.funis ausente ou com outro tipo';
  END IF;

  SELECT string_agg(c.confdeltype::text, ',' ORDER BY c.conname) INTO v_acoes
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f'
     AND c.conrelid = 'public.api_keys'::regclass
     AND c.confrelid = 'auth.users'::regclass
     AND a.attname = 'membro_user_id';
  -- 'c' = CASCADE. SET NULL ('n') abriria a chave para a conta inteira.
  IF v_acoes IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION '1120: FK de api_keys.membro_user_id = % (esperado só CASCADE, "c")',
      coalesce(v_acoes, 'nenhuma');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname = 'api_keys_funis_nao_vazio'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION '1120: CHECK api_keys_funis_nao_vazio ausente';
  END IF;
END $$;
