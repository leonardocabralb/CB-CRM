-- ============================================================
-- 1094 — A MARCA da instalação (nome e logo), editável pela tela.
--
-- Pedido do operador em 19/10/2026: o CRM vai ser vendido, e quem compra
-- troca o NOME e o LOGO em Configurações → Marca, sem mexer em código nem
-- gerar outra imagem. Até aqui a marca era build-arg (`NEXT_PUBLIC_APP_*`),
-- inlinada no bundle. Plano: `docs/PLANO-marca-configuravel.md`.
--
-- O desenho, e o porquê de cada peça:
--
--   * `cb_marca` tem UMA linha por INSTALAÇÃO, não por conta: o nome e o
--     logo aparecem na tela de login, antes de haver sessão (e conta). A
--     chave é `id boolean` com `CHECK (id)` — só `true` cabe, então uma
--     segunda linha é impossível, e a PK TOTAL serve de alvo ao
--     `upsert(onConflict: 'id')` da rota. Sem linha = o padrão do produto
--     (Atlas CRM, `marcaPadrao()` em `src/lib/marca.ts`).
--   * As imagens moram no bucket `marca`; a linha guarda só o CAMINHO de
--     cada peça (a URL é derivada no servidor por `getPublicUrl`, nunca
--     aceita de fora). Os nomes das colunas `*_path` são espelho de
--     `COLUNA_DA_PECA`; os limites do nome, de `LIMITE_DO_NOME(_CURTO)`; o
--     teto e os tipos do bucket, de `TETO_DE_BYTES_DA_MARCA` e
--     `TIPOS_DA_PECA` (pino `marca-1094.test.ts`).
--   * FECHADA ao navegador: RLS ligada, NENHUMA policy, REVOKE de anon e de
--     authenticated. Quem lê é o servidor, com service role (`obterMarca`,
--     em cache, para o layout; `/api/cb/marca` para a aba). Quem grava é só
--     a rota, que confere o papel: o admin da conta MAIS ANTIGA da
--     instalação (D1 do plano — o cadastro dá a todo login novo uma conta
--     avulsa em que ele é admin, e uma policy por papel deixaria essa gente
--     trocar o logo de todos).
--   * Bucket PÚBLICO e SEM policy em `storage.objects`: a URL pública não
--     passa por RLS (o logo aparece na tela de login, sem sessão), e sem
--     policy ninguém LISTA nem ESCREVE pelo navegador — só a rota, com
--     service role. 1 MB por imagem; PNG, WebP e SVG (a união do que cada
--     peça aceita; o símbolo é só PNG, conferido na rota).
--   * `atualizado_por` é AUTORIA (SET NULL): apagar o login de quem gravou
--     não leva a marca junto.
--
-- Todo privilégio que a tabela precisa está ESCRITO aqui: em banco novo não
-- existe o default privilege do Supabase (o REVOKE de PUBLIC levaria até o
-- service_role).
--
-- ⚠️ ADITIVA, e vai ANTES do deploy: o app novo lê a tabela no layout raiz
-- (sem ela, `obterMarca` cai no padrão e registra erro a cada página); o
-- antigo não sabe que ela existe.
--
-- Idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cb_marca (
  id boolean NOT NULL DEFAULT true,
  nome text,
  nome_curto text,
  cor_do_icone text,
  simbolo_path text,
  horizontal_escuro_path text,
  horizontal_claro_path text,
  vertical_escuro_path text,
  vertical_claro_path text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT cb_marca_pkey PRIMARY KEY (id),
  -- Só `true` cabe na chave: uma linha por instalação.
  CONSTRAINT cb_marca_uma_linha_ck CHECK (id),
  CONSTRAINT cb_marca_nome_ck
    CHECK (nome IS NULL OR char_length(btrim(nome)) BETWEEN 1 AND 60),
  CONSTRAINT cb_marca_nome_curto_ck
    CHECK (nome_curto IS NULL OR char_length(btrim(nome_curto)) BETWEEN 1 AND 20),
  CONSTRAINT cb_marca_cor_do_icone_ck
    CHECK (cor_do_icone IS NULL OR cor_do_icone ~ '^#[0-9a-fA-F]{6}$')
);

COMMENT ON TABLE public.cb_marca IS
  'A marca da instalação (1094): nome, nome curto, cor do ícone e o caminho no bucket marca de cada imagem. Uma linha só (id = true); sem linha, vale o padrão do produto. Fechada ao navegador: lê e grava só o servidor, pela rota /api/cb/marca.';

ALTER TABLE public.cb_marca ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cb_marca FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cb_marca TO service_role;

-- ------------------------------------------------------------
-- 2) O bucket (modelo: 0008). Sem policy em storage.objects — de propósito.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marca',
  'marca',
  TRUE,
  1048576, -- 1 MB, o `TETO_DE_BYTES_DA_MARCA`
  ARRAY['image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ------------------------------------------------------------
-- 3) Conferência
-- ------------------------------------------------------------
DO $$
DECLARE
  v_publico boolean;
  v_teto bigint;
  v_tipos text[];
BEGIN
  -- Fechada ao navegador: nenhum privilégio, de nenhum tipo.
  IF has_table_privilege('anon', 'public.cb_marca',
       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION '1094: anon tem privilégio em cb_marca.';
  END IF;
  IF has_table_privilege('authenticated', 'public.cb_marca',
       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
    RAISE EXCEPTION '1094: authenticated tem privilégio em cb_marca.';
  END IF;
  -- A outra metade: o servidor lê e grava.
  IF NOT (has_table_privilege('service_role', 'public.cb_marca', 'SELECT')
          AND has_table_privilege('service_role', 'public.cb_marca', 'INSERT')
          AND has_table_privilege('service_role', 'public.cb_marca', 'UPDATE')
          AND has_table_privilege('service_role', 'public.cb_marca', 'DELETE')) THEN
    RAISE EXCEPTION '1094: service_role sem SELECT/INSERT/UPDATE/DELETE em cb_marca.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cb_marca'::regclass) THEN
    RAISE EXCEPTION '1094: RLS desligada em cb_marca.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cb_marca') THEN
    RAISE EXCEPTION '1094: cb_marca tem policy — ela é fechada ao navegador.';
  END IF;
  -- Nenhuma policy de storage.objects fala do bucket: só a rota escreve.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') LIKE '%''marca''%' OR coalesce(with_check, '') LIKE '%''marca''%')
  ) THEN
    RAISE EXCEPTION '1094: há policy em storage.objects para o bucket marca.';
  END IF;

  SELECT public, file_size_limit, allowed_mime_types
    INTO v_publico, v_teto, v_tipos
    FROM storage.buckets WHERE id = 'marca';
  IF NOT FOUND THEN
    RAISE EXCEPTION '1094: o bucket marca não foi criado.';
  END IF;
  IF v_publico IS NOT TRUE THEN
    RAISE EXCEPTION '1094: o bucket marca não é público (o logo da tela de login não carregaria).';
  END IF;
  IF v_teto IS DISTINCT FROM 1048576 THEN
    RAISE EXCEPTION '1094: teto do bucket marca é % (esperado 1048576).', v_teto;
  END IF;
  IF NOT (v_tipos @> ARRAY['image/png', 'image/webp', 'image/svg+xml']
          AND v_tipos <@ ARRAY['image/png', 'image/webp', 'image/svg+xml']) THEN
    RAISE EXCEPTION '1094: tipos do bucket marca são % (esperado PNG, WebP e SVG).', v_tipos;
  END IF;

  -- Uma linha só: `id = false` é recusado pelo CHECK. Num subbloco — se o
  -- INSERT passasse, o erro P1094 escapa do handler e a migration para.
  BEGIN
    INSERT INTO public.cb_marca (id) VALUES (false);
    RAISE EXCEPTION USING ERRCODE = 'P1094',
      MESSAGE = '1094: cb_marca aceitou uma segunda linha (id = false).';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END $$;
