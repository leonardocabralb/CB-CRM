-- ============================================================
-- 1111_cb_opcoes_de_resposta
--
-- A mensagem de EMPRESA que chega com opções de resposta — o modelo com botão
-- de resposta rápida ("Sim", "Retorna mais tarde"), a mensagem interativa com
-- `quick_reply` e o menu em lista de um robô — passa a oferecer na bolha um
-- botão por opção, que PREPARA a resposta no compositor (o rótulo na caixa,
-- citando a mensagem). Desde a 1060 as opções viravam só texto (`[Sim]`), e o
-- operador não tinha o que clicar (pedido de 26/10/2026). Não é o toque de
-- verdade: do outro lado chega uma resposta digitada.
--
-- `messages.opcoes_de_resposta` (jsonb): os rótulos, na ordem —
-- `["Sim", "Retorna mais tarde"]`. Nulo em toda outra mensagem.
-- `content_text` continua com as mesmas opções em linhas `[opção]` (prévia,
-- busca, Radar e API leem o texto); a bolha tira essas linhas e desenha os
-- botões.
--
-- ADITIVA: aplicar ANTES do deploy — o código novo grava a coluna, e sem ela o
-- INSERT da mensagem de empresa com opções leva 42703 e a mensagem some (a
-- Evolution já recebeu 200). O app anterior não lê a coluna.
--
-- Idempotente; aplica em banco vazio.
-- ============================================================

-- `messages` recebe escrita a toda mensagem: sem teto de espera, uma
-- transação longa enfileiraria a ingestão atrás desta trava.
SET LOCAL lock_timeout = '5s';

ALTER TABLE messages ADD COLUMN IF NOT EXISTS opcoes_de_resposta jsonb;

COMMENT ON COLUMN messages.opcoes_de_resposta IS
  'Mensagem de empresa recebida com opções de resposta (1111): ["Sim", ...]. A bolha oferece um botão por opção, que prepara a resposta no compositor; content_text leva as mesmas opções em linhas [opção].';

-- ============================================================
-- Conferência — SÓ CATÁLOGO. Depois da ALTER a transação segura a trava
-- exclusiva de `messages` até o fim: nada aqui lê nem escreve linha (regra da
-- 1032). A prova de que a mensagem entra com as opções é o teste ponta a ponta
-- no preview, com a migration aplicada.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages'
      AND column_name = 'opcoes_de_resposta' AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION '1111: messages.opcoes_de_resposta não existe como jsonb';
  END IF;
END $$;
