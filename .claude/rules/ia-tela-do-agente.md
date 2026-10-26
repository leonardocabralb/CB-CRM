---
paths:
  - "src/lib/ai/defaults.ts"
  - "src/lib/ai/modelos-da-chave*"
  - "src/app/api/cb/ia/modelos/**"
  - "src/components/agentes-de-ia/provedor-e-modelo*"
  - "src/components/agentes-de-ia/configuracao-do-agente.tsx"
  - "src/components/agentes-de-ia/novo-agente-dialog.tsx"
  - "src/components/agentes-de-ia/ferramentas*"
  - "src/components/agentes-de-ia/instrucoes-x-ferramentas*"
  - "src/lib/integracoes/montar*"
  - "src/components/settings/integracoes-panel.tsx"
  - "src/lib/ia-agentes/precos*"
  - "src/lib/ia-agentes/uso*"
  - "src/app/api/cb/ia/uso/**"
  - "supabase/migrations/1108_cb_ia_uso_por_faixa.sql"
  - "src/lib/ia-agentes/quem-responde*"
  - "src/app/api/cb/ia/conversa/**"
  - "src/components/inbox/ai-thread-banner*"
---

# Tela do agente de IA: modelo, mídia, avisos e custo por faixa

Validação de 25/10/2026 (`docs/PLANO-agentes-de-ia.md`). A regra geral dos
agentes está em `ia.md` e `ia-agentes.md`; aqui, o que a TELA diz antes de o
agente errar em silêncio.

### O seletor de modelo lista o que a CHAVE oferece

`GET /api/cb/ia/modelos` (admin), `src/lib/ai/modelos-da-chave.ts`; agente
(Configuração e "Novo agente") e Radar.

- ⚠️ **`AI_PROVIDER_MODELS` são os RECOMENDADOS no topo** (`opcoesDeModelo`,
  só os que a chave tem) e a sugestão do campo de texto quando a lista falha.
  Continua NÃO sendo allow-list: "Outro (digitar o id)" e o servidor grava
  qualquer id. O modelo SALVO fora da lista aparece sempre, marcado — nunca
  trocado em silêncio. Lista que falha = campo de texto com aviso; falha
  nunca vira "sem chave" nem "sem modelos".
- ⚠️ **A chave sai do `repo.ts` (`lerChave`) e nunca volta à tela**: a rota
  manda `{ id, nome }` ou o CÓDIGO (`sem_chave`, `falhou` + `invalid_key`/
  `rate_limited`/`timeout`/…); o log passa por `semSegredo`. Chave SÓ no
  cabeçalho; a página seguinte se monta sobre a URL FIXA do provedor
  (`after_id`/`pageToken`), `redirect: 'error'`, 8 s para todas as páginas.
- **Recortes de texto** (puros, testados): Gemini só com `generateContent`;
  OpenAI só `gpt-*`/`o<n>*`/`chatgpt-*`, fora áudio, imagem, embedding e o
  que não passa pelo `/v1/chat/completions` do adapter (`instruct`, `codex`,
  `deep-research`, `-pro`); Anthropic, tudo.
- **Cache de 10 min por conta + provedor + IMPRESSÃO da chave** (sha256):
  trocar a chave traz a lista nova na hora; falha não entra; `?atualizar=1`
  fura. A chave da OpenAI "só da base" é `sem_chave`.
- **Trocar de provedor escolhe o recomendado DISPONÍVEL**
  (`modeloRecomendado`); no "Novo agente" o modelo é DERIVADO no render,
  nunca gravado por efeito.
- **Padrão da Anthropic = `claude-haiku-5-5`** (escolha do operador; ids da
  família 5.5 sem data). Agente salvo com modelo antigo não muda sozinho.

### Quem lê áudio, imagem e PDF é DITO na tela

- ⚠️ **Não é o modelo do agente: é a chave da conta** (Gemini → OpenAI →
  Anthropic; o agente recebe o texto). Quadro `QuemLeAMidia`
  (`provedor-e-modelo.tsx`) na Configuração, linha curta no "Novo agente" e
  nos cartões de Integrações com transcrição/leitura. "Nesta conta" sai de
  `leitoresDaConta` (`montar.ts`, puro) com as ORDENS REAIS de `leitores.ts`.
  Leitura de chave que falha = `leitores: null` ("não se sabe"), nunca
  "ninguém". Sem Gemini nem OpenAI: âmbar — áudio não será ouvido.
- Mudou a ordem ou o que cada provedor lê (`leitores.ts`, `transcrever.ts`,
  `contexto.ts`)? O texto `IaAgentes.midia.*` muda junto (HEIC só Gemini; GIF
  não Gemini; planilha/Word ninguém; vídeo não é assistido).

### Avisos ANTES de salvar

- **D27**: mudar "Ligado" (inclusive a 1ª vez) mostra em âmbar que só os cards
  que ENTRAREM nas etapas depois disso serão atendidos. A regra não mudou.
- ⚠️ **Instruções × ferramentas** (`ferramentasPedidasDesligadas`): as
  instruções E as regras pedem ação de ferramenta desligada (medido: "Criei o
  lembrete…" sem tarefa). Heurística CONSERVADORA de propósito — alarme falso
  ensina a ignorar o âmbar: verbo de ação + objeto a até 4 palavras; negação,
  outro sujeito ("o cliente agenda"), reunião em frase com "link", "etapa" sem
  "mover", "cartão" e "mover a ação" (judicial) não contam. Palavra nova entra
  com teste dos DOIS lados; os modelos de partida não acendem aviso (pino). É
  a defesa da tela; a do turno é a trava `acao_prometida` do motor.
- ⚠️ **"Marcar reunião" sem o campo E-mail em "Preencher campo"**
  (`avisoDoEmailDaReuniao`): o agente pede o e-mail e transfere. O campo é o
  de `tipo === 'email'` (o ESPELHADO, 1000), nunca pelo nome. "Liberar o
  campo …" marca SÓ no rascunho; no teto de itens, sem botão; Calendly
  desconectado, sem aviso (o vermelho já diz).

### A faixa diz quando a etapa TEM agente que não atende

- `GET /api/cb/ia/conversa/[id]` devolve `naoAtende: { agente: { id, nome },
  motivo }` (do agente, SÓ id e nome — pino) para desligado, fora da conexão
  e card antigo (`MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE`, `quem-responde.ts`).
  Linha discreta "IA · X não atende esta conversa: <motivo>", sem botão, e a
  mesma embaixo da pausada. Antes, o card antigo ficava mudo SEM RASTRO.
- ⚠️ **Nunca sugerir "mova o card e volte"** para o card antigo: as automações
  das duas etapas rodam de novo e podem escrever ao cliente outra vez.
- Motivo é chave MONTADA (`Inbox.aiBanner.naoAtendeMotivo.<m>`), cobrada pela
  LISTA; motivo fora dela a faixa ignora (`lerNaoAtende`), nunca chave crua.

### Custo por FAIXA do pedido (1108)

- ⚠️⚠️ **`cb_ia_uso` agrupa também por `acima_da_faixa`**
  (`prompt_tokens > 100000` numa linha de `ai_usage_log` = UMA chamada).
  `precos.ts`: linha com `acimaDe: LIMIAR_DA_FAIXA` é a tabela do pedido maior
  (Haiku 5.5: 0,10/0,50 até 100 mil; 0,50/2,50 acima). Sem a coluna
  (`acimaDaFaixa` nulo), modelo COM faixa é "sem preço", nunca a tabela baixa.
- O corte vive em DOIS lugares (o `.sql` e `LIMIAR_DA_FAIXA`), cobrados por
  `ia-uso-por-faixa-1108.test.ts`: modelo com corte DIFERENTE exige migration
  nova. A rota pagina pelas SEIS chaves e exige a 1108 aplicada ANTES do
  deploy (ordenar por coluna ausente é erro do PostgREST).
