-- 1135 — O MÓDULO "Cobrança automática" do Asaas (11/11/2026).
--
-- ⚠️ Aplicada na produção com o nome `1134_cb_asaas_modulo_da_cobranca`
-- (20261111120022): a `1134_cb_ligacoes_pelo_crm` entrou no `main` antes,
-- e este arquivo foi renumerado para 1135. Idempotente (IF NOT EXISTS).
--
-- A régua (998) ganha uma tela própria em Configurações › Integrações ›
-- Asaas › Cobrança automática, que configura de um lugar só o que hoje fica
-- espalhado nas automações da régua. Duas coisas não tinham onde morar:
--
-- 1. `regua_escritorio_nome` — o nome do escritório que entra em
--    `{{vars.escritorio_nome}}`. Até aqui saía do nome AUTOMÁTICO da
--    assinatura (`accounts.assinatura_nome_automatica`, senão
--    `accounts.name`), que também assina o robô: mudar lá para acertar a
--    cobrança mudava a assinatura de tudo. NULO = o de antes (sem mudança
--    para quem não mexer).
-- 2. `aviso_inadimplencia_ativo` — o ícone na lista, a faixa no fio e o
--    filtro "Inadimplentes" podem ser desligados (o painel "O que a
--    integração faz" do cartão). Padrão LIGADO: é o comportamento de hoje.
--
-- ADITIVA: o app novo lê as duas colunas por nome (a config do espelho, o
-- resumo da caixa, a varredura) — aplicar ANTES do deploy, senão o resumo
-- responde 500 e o aviso apaga para a conta inteira. A tabela continua
-- fechada ao navegador (RLS sem policy, 992): nada a conceder.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_asaas_config
  ADD COLUMN IF NOT EXISTS regua_escritorio_nome text NULL,
  ADD COLUMN IF NOT EXISTS aviso_inadimplencia_ativo boolean NOT NULL DEFAULT true;

ALTER TABLE public.cb_asaas_config
  DROP CONSTRAINT IF EXISTS cb_asaas_config_regua_escritorio_nome_ck;

ALTER TABLE public.cb_asaas_config
  ADD CONSTRAINT cb_asaas_config_regua_escritorio_nome_ck
  CHECK (regua_escritorio_nome IS NULL OR char_length(btrim(regua_escritorio_nome)) BETWEEN 1 AND 120);

COMMENT ON COLUMN public.cb_asaas_config.regua_escritorio_nome IS
  'O nome do escritório em {{vars.escritorio_nome}} da régua (1135). NULO = o nome automático da assinatura, senão o da conta.';
COMMENT ON COLUMN public.cb_asaas_config.aviso_inadimplencia_ativo IS
  'Ícone, faixa e filtro "Inadimplentes" na caixa de entrada (1135). Desligado, a aba Cobranças continua.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_asaas_config'
       AND column_name = 'aviso_inadimplencia_ativo' AND is_nullable = 'NO' AND column_default = 'true'
  ) THEN
    RAISE EXCEPTION '1135: aviso_inadimplencia_ativo não ficou NOT NULL DEFAULT true';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_asaas_config'
       AND column_name = 'regua_escritorio_nome' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '1135: regua_escritorio_nome ausente ou NOT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.cb_asaas_config'::regclass
       AND conname = 'cb_asaas_config_regua_escritorio_nome_ck'
  ) THEN
    RAISE EXCEPTION '1135: o CHECK do nome do escritório não foi criado';
  END IF;
  -- nenhuma conta mudou de comportamento: o aviso segue ligado em todas
  IF EXISTS (SELECT 1 FROM public.cb_asaas_config WHERE aviso_inadimplencia_ativo IS NOT TRUE) THEN
    RAISE EXCEPTION '1135: alguma conta nasceu com o aviso desligado';
  END IF;
END $$;
