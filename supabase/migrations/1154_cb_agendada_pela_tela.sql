-- 1154 — A agendada sabe se foi escrita pela TELA do CRM ou pela API.
--
-- A janela de 7 dias do Instagram (Human Agent, `cb_channels.ig_human_agent`)
-- vale para a resposta de GENTE: a que se digita e envia na hora pela caixa e
-- a agendada por uma pessoa na tela (decisão do operador, 22/11/2026). A
-- agendada pela API v1 (n8n, Make, MCP) nunca sai com a tag HUMAN_AGENT:
-- mensagem automática é uso proibido dela na Meta, e o uso fora do permitido
-- restringe a conta.
--
-- Até aqui as duas eram iguais na linha: a API grava `created_by` com o dono
-- da conta (`resolveApiAuthor`), o mesmo valor de quando o dono agenda pela
-- tela. Só a rota da tela (`/api/cb/scheduled`) grava `pela_tela = true`; o
-- disparador (`dispatch.ts`) a lê e passa `respostaDeGente` ao núcleo.
--
-- `NOT NULL DEFAULT false`: a linha antiga (e a da API) fica fora da tag — o
-- lado seguro. A Lixeira (1097) reinsere só as colunas que a fotografia
-- traz: a foto de antes desta migration volta com o padrão.
--
-- ADITIVA: o app novo grava e lê a coluna (a rota insere, o disparador
-- seleciona); aplicar ANTES do deploy. O app antigo não a conhece. Banco
-- vazio: só o ADD COLUMN; a leitura é a `GRANT SELECT` da 925, na tabela.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cb_scheduled_messages
  ADD COLUMN IF NOT EXISTS pela_tela boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cb_scheduled_messages.pela_tela IS
  'Agendada pela tela do CRM, por uma pessoa da equipe (1154), e não pela API v1. Só ela pode sair pela janela de 7 dias do Instagram (Human Agent).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cb_scheduled_messages'
       AND column_name = 'pela_tela'
       AND data_type = 'boolean'
       AND is_nullable = 'NO'
       AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION '1154: cb_scheduled_messages.pela_tela não ficou boolean NOT NULL DEFAULT false';
  END IF;
END $$;
