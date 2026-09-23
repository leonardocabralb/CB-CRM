-- ============================================================
-- 1038_cb_contato_bsuid
--
-- A segunda identidade do contato no WhatsApp: o BSUID (business-scoped
-- user id) e o nome de usuário. É a `040_contact_business_scoped_user_id`
-- do projeto original (#519/#533), que o merge #259 trouxe como `0043` e
-- que esta migration SUBSTITUI com o número certo e o cabeçalho da nossa
-- realidade — a `0043` nunca foi aplicada em banco nenhum desta casa.
--
-- ⚠️ Por que 1038 e não 0043: número NOVO vem depois do maior que já está
-- no `main` (era 1037). Quem atualiza por `supabase db push` tem a recusa
-- da migration fora de ordem (sem `--include-all`) — ver o CLAUDE.md.
--
-- O que a Meta faz: todo usuário do WhatsApp ganha um BSUID, único dentro de
-- um portfólio de negócios, e quem adota um nome de usuário deixa de ter o
-- telefone no webhook — `messages[].from` e `contacts[].wa_id` somem, e só
-- `from_user_id` / `user_id` identificam quem escreveu.
--
-- ⚠️ O que esta migration NÃO decide: como fica a ficha só com BSUID. No
-- projeto original ela grava `phone = ''`; aqui `contacts.phone` é ANULÁVEL
-- desde a 0989 (a ficha só do Instagram), com o CHECK "telefone OU
-- instagram". A proposta do plano (P4) é `phone` NULO e o CHECK alargado
-- para "telefone OU instagram OU BSUID" — isso é a Fase 11 do
-- `docs/PLANO-merge-upstream-2026-09.md`, em migration própria, junto com a
-- entrada, a saída e a tela. Até lá NENHUM código grava estas colunas: a
-- ingestão continua por telefone, e o único leitor (`wa_username` no hook de
-- notificação do navegador) não está montado.
--
-- Aditiva e idempotente: três colunas anuláveis e um índice único PARCIAL
-- (as linhas sem BSUID ficam fora dele). Nenhuma linha existente muda.
-- ============================================================

-- `contacts` recebe escrita a toda mensagem: sem teto de espera, uma
-- transação longa enfileiraria a ingestão atrás desta trava.
SET LOCAL lock_timeout = '5s';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_parent_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_username TEXT;

COMMENT ON COLUMN contacts.wa_user_id IS
  'BSUID do WhatsApp (ex.: "US.13491208655302741918"): estável por (usuário, portfólio de negócios). É a chave de entrada quando a Meta não manda o telefone. Nada o grava até a Fase 11.';
COMMENT ON COLUMN contacts.wa_parent_user_id IS
  'BSUID do portfólio (ex.: "US.ENT.11815799212886844830"). Só referência; nunca chave de busca.';
COMMENT ON COLUMN contacts.wa_username IS
  'Nome de usuário do WhatsApp, sem o @. Só exibição: a pessoa troca quando quer, então nunca é chave de identidade.';

-- Uma ficha por BSUID por conta — a mesma garantia que a 0022 deu ao
-- telefone. Parcial: as fichas sem BSUID (todas, hoje) ficam fora.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_user_id
  ON contacts (account_id, wa_user_id)
  WHERE wa_user_id IS NOT NULL;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'contacts'
        AND column_name IN ('wa_user_id', 'wa_parent_user_id', 'wa_username')) <> 3 THEN
    RAISE EXCEPTION '1038: as três colunas do BSUID não estão em contacts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_contacts_account_wa_user_id'
      AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE (wa_user_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION '1038: o índice único parcial do BSUID não existe';
  END IF;
END $$;
