-- ============================================================
-- 1073 — Atlas, Fase 4: a fila das MUDANÇAS de situação que disparam o
-- gatilho "Situação mudou no Atlas" (`atlas_situacao_mudou`).
--
-- Plano: docs/PLANO-integracao-atlas.md, Fase 4. Decisões do operador
-- (30/09/2026): a automação exige funil; o card fora do funil escolhido NÃO
-- é mexido (só registra `sem_card`); SEM a trava de "ficha velha" e SEM a de
-- 48 h — por isso o CHECK do resultado não tem `antiga` nem
-- `suspeita_ficha_velha`.
--
-- A leitura periódica (`src/lib/atlas/situacoes.ts`) enfileira aqui cada
-- decisão `mudou` (a situação de um cliente VINCULADO mudou, com data
-- posterior ao vínculo) ANTES de gravar a situação no vínculo — a mudança
-- nunca se perde. O disparo (`src/lib/atlas/mudancas.ts`) roda depois do
-- fechamento do ciclo, reivindica cada linha (`pendente → processando`,
-- `UPDATE … RETURNING` cercado) e grava o resultado (`feito`).
--
-- ⚠️ SEM `contact_id`, de propósito: o contato sai do vínculo na hora de
-- disparar (a ficha pode ter sido fundida ou apagada no meio), então a
-- tabela fica FORA da receita de fusão de fichas.
-- ⚠️ A chave única (conta, AMBIENTE, cliente, data da mudança) segura a
-- sobreposição de 5 min da leitura e dois ciclos juntos: o 23505 é "já
-- registrada". NULLS NOT DISTINCT: nulo em `api_url` é o Atlas de verdade.
-- FECHADA ao navegador (sem policy): o cartão de Integrações lê pela rota.
--
-- ADITIVA, e vai ANTES do deploy do PR da Fase 4 (a leitura nova grava
-- aqui). Idempotente. As conferências usam só o catálogo (banco VAZIO no
-- replay do CI). Não há CHECK em `automations.trigger_type`: o gatilho novo
-- não precisa de migration própria.
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS cb_atlas_mudancas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- O ambiente do Atlas (nulo = o de verdade), como no vínculo (1072).
  api_url           text,
  atlas_client_id   uuid NOT NULL,
  -- Comparadas como a leitura compara (`em_negociacao` vale `ativo`), gravadas como vieram.
  situacao_anterior text NOT NULL,
  situacao_nova     text NOT NULL,
  -- O `status_changed_at` do Atlas: sem data, a mudança nunca vira evento.
  situacao_desde    timestamptz NOT NULL,
  estado            text NOT NULL DEFAULT 'pendente'
                    CONSTRAINT cb_atlas_mudancas_estado_ck
                    CHECK (estado IN ('pendente', 'processando', 'feito')),
  resultado         text
                    CONSTRAINT cb_atlas_mudancas_resultado_ck
                    CHECK (resultado IS NULL OR resultado IN ('disparado', 'em_espera', 'falhou', 'sem_automacao', 'sem_card', 'card_ambiguo', 'superada')),
  -- Uma linha por automação que casou, com o nome (o cartão mostra).
  detalhe           text,
  -- A posse da reivindicação: toda escrita do disparo leva este carimbo. Na
  -- pendente devolvida à fila, fica como a última tentativa (o rodízio).
  processando_desde timestamptz,
  tentativas        int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  processado_em     timestamptz,
  CONSTRAINT cb_atlas_mudancas_key UNIQUE NULLS NOT DISTINCT (account_id, api_url, atlas_client_id, situacao_desde)
);

-- O disparo: as abertas da conta, das mais antigas para as mais novas.
CREATE INDEX IF NOT EXISTS cb_atlas_mudancas_abertas_idx
  ON cb_atlas_mudancas (account_id, created_at) WHERE estado <> 'feito';
-- O cartão: as 20 últimas da conta (a fila não é podada).
CREATE INDEX IF NOT EXISTS cb_atlas_mudancas_conta_idx
  ON cb_atlas_mudancas (account_id, created_at DESC);

ALTER TABLE cb_atlas_mudancas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_atlas_mudancas FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_atlas_mudancas TO service_role;

-- ============================================================
-- Conferências — SÓ CATÁLOGO, válidas num banco VAZIO (nenhuma exige dado).
-- ============================================================
DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'cb_atlas_mudancas_estado_ck',
    'cb_atlas_mudancas_resultado_ck',
    'cb_atlas_mudancas_key'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c) THEN
      RAISE EXCEPTION '1073: restrição % ausente', c;
    END IF;
  END LOOP;

  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'cb_atlas_mudancas_resultado_ck')) LIKE '%antiga%'
     OR pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'cb_atlas_mudancas_resultado_ck')) LIKE '%suspeita%' THEN
    RAISE EXCEPTION '1073: o CHECK do resultado aceita uma trava que o operador recusou';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_constraint k ON k.conindid = i.indexrelid
     WHERE k.conname = 'cb_atlas_mudancas_key' AND i.indnullsnotdistinct
       AND pg_get_indexdef(i.indexrelid) LIKE '%(account_id, api_url, atlas_client_id, situacao_desde)%'
  ) THEN
    RAISE EXCEPTION '1073: cb_atlas_mudancas_key não é (account_id, api_url, atlas_client_id, situacao_desde) NULLS NOT DISTINCT';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_atlas_mudancas'::regclass) THEN
    RAISE EXCEPTION '1073: cb_atlas_mudancas sem RLS ligada';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_atlas_mudancas') THEN
    RAISE EXCEPTION '1073: cb_atlas_mudancas não pode ter policy (só as rotas leem)';
  END IF;
  IF has_table_privilege('anon', 'public.cb_atlas_mudancas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_mudancas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_mudancas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cb_atlas_mudancas', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cb_atlas_mudancas', 'DELETE') THEN
    RAISE EXCEPTION '1073: cb_atlas_mudancas alcançável pelo navegador';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.cb_atlas_mudancas', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_mudancas', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.cb_atlas_mudancas', 'UPDATE') THEN
    RAISE EXCEPTION '1073: service_role sem acesso a cb_atlas_mudancas';
  END IF;
END $$;
