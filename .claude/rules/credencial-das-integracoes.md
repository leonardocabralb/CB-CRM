---
paths:
  - "src/lib/integracoes/credencial*"
  - "src/components/settings/credencial-da-integracao.tsx"
  - "src/app/api/cb/integracoes/credencial/**"
  - "supabase/migrations/1127_cb_credencial_das_integracoes.sql"
  - "supabase/migrations/credencial-das-integracoes-1127.test.ts"
---

# Credencial das integrações — regras

O bloco "Chave guardada" dos cartões de Integrações (tl;dv, Calendly, Meta
Ads, Asaas, ZapSign, Atlas e as chaves de IA): os 4 últimos caracteres da
chave, quando foi gravada, por quem, quando respondeu, "Testar agora" e
"Trocar chave" (1127; pedido do operador, 06/11/2026). Plano:
`docs/PLANO-credencial-das-integracoes.md`. O resto de cada integração está
na regra dela.

- ⚠️⚠️ **Da chave só saem os 4 ÚLTIMOS caracteres, calculados no servidor**
  (`finalDaChave`; chave com menos de 16 não mostra nem isso). Decisão do
  operador: antes nenhuma rota devolvia a chave, nem mascarada. Rota nova não
  devolve mais que `finalDaChave`, e a mensagem de erro do provedor continua
  passando por `semSegredo` (Meta, OpenAI e Asaas ecoam a chave inteira).
- ⚠️ **Quem grava a chave carimba `conectado_em` E `conferido_em`** —
  conectar e TROCAR passam pelo mesmo caminho (pino em `credencial.test.ts`,
  `QUEM_GRAVA`). Sem o carimbo, depois de uma troca o bloco mostraria a data
  da chave anterior. `NULL` = gravada antes da 1127, e a tela diz "data não
  registrada": nunca preencher com `created_at` (é a da PRIMEIRA conexão; o
  upsert da troca não o reescreve).
- ⚠️ **"Testar agora" só limpa o erro que ele PROVA resolvido**
  (`registrarTeste`): a volta a `conectado` é cercada por `status = 'erro'` e
  `last_error IN (limpa)`; recusa da chave marca (`marca`); rede, limite e erro
  do provedor não mudam nada. O do Asaas não limpa `sem_permissao` (a listagem
  de clientes não prova a permissão de Cobranças); Atlas e ZapSign seguem o
  `registrarConferencia` deles. É UMA leitura no provedor, nada gravado lá.
- **Trocar = o mesmo PUT/POST do conectar** (cada conexão já mantém o token
  do webhook, recusa a chave de outra conta — Asaas `conta_trocada`, Atlas
  `outro_escritorio` — e testa antes de gravar). O campo vem aberto sozinho só
  com o erro DA CHAVE (`ERROS_DA_CHAVE`/`ERROS_DO_TOKEN` de cada cartão); o de
  webhook, rede ou limite não se resolve com chave nova.
- O resultado do teste é carimbado com a chave testada (`final|gravadaEm`):
  trocada a chave, o "não respondeu" da anterior some no mesmo render.
- **Chaves de IA**: `credencialDoProvedor` em `ia-chaves/repo.ts` (só ele toca
  `cb_ia_chaves`); sem "Testar agora" — o cartão já pinga cada modelo, e cada
  ping é geração paga.
- **Integração nova com chave**: entra em `INTEGRACOES`/`FONTES`
  (`credencial.ts`), em `TESTES` (a rota) e em `QUEM_GRAVA` (o teste), com as
  duas colunas na config e o bloco no cartão.
