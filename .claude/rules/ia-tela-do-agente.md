---
paths:
  - "src/lib/ai/defaults.ts"
  - "src/lib/ai/modelos-da-chave*"
  - "src/app/api/cb/ia/modelos/**"
  - "src/components/agentes-de-ia/provedor-e-modelo*"
  - "src/components/agentes-de-ia/configuracao-do-agente.tsx"
  - "src/components/agentes-de-ia/novo-agente-dialog.tsx"
  - "src/components/agentes-de-ia/detalhe-do-agente.tsx"
  - "src/components/agentes-de-ia/acesso-do-agente.tsx"
  - "src/components/agentes-de-ia/retomada-do-agente.tsx"
  - "src/components/agentes-de-ia/base-do-agente.tsx"
  - "src/components/agentes-de-ia/ferramentas*"
  - "src/components/agentes-de-ia/instrucoes-x-ferramentas*"
  - "src/lib/integracoes/montar*"
  - "src/components/settings/integracoes-panel.tsx"
  - "src/lib/ia-agentes/precos*"
  - "src/lib/ia-agentes/proximo-passo*"
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
- **Recortes de texto** (puros, testados): Gemini só com `generateContent`,
  fora os que não conversam (música Lyria, robótica, computer use, deep
  research, Antigravity — a lista da chave real, 10/11/2026);
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
  não Gemini; Office só Gemini, da planilha só a 1ª aba; zip/texto ninguém;
  vídeo não é assistido).

### Avisos ANTES de salvar

- **D27**: ligar ou desligar (inclusive a 1ª vez) pede confirmação com o aviso
  de que só os cards que ENTRAREM nas etapas depois disso serão atendidos. A
  regra não mudou. ⚠️ Desde 10/11/2026 o "Ligado" é o interruptor do
  CABEÇALHO ("Atende clientes", `detalhe-do-agente.tsx`) e grava NA HORA
  (`PATCH { ativo }`) depois da confirmação; a Configuração manda sempre
  `ativo: agente.ativo` — com o interruptor nela também, o rascunho guardaria
  o "Ligado" antigo e o Salvar o desfaria (pino em `provedor-e-modelo.test.ts`).
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

### A faixa diz o PRÓXIMO PASSO (pedido do operador, 12/11/2026)

`proximo-passo.ts` (puro) e o campo `proximo` de `GET /api/cb/ia/conversa/[id]`.

- Embaixo de "IA · X responde nesta conversa": "Próximo follow-up (2 de 5) a
  partir de 15:40 · em 2 h 13 min", a resposta na fila (em instantes; fora do
  horário do agente, a hora da abertura), "Respondendo agora…" ou "Sem
  follow-up agendado". "A partir de" porque o cron pega a linha depois e a
  conferência pode reagendar (horário, lembrete); hora passada = "a qualquer
  momento", nunca "em 0 min".
- ⚠️ **Só o que vai acontecer**: a rota lê a fila só com agente atendendo E a
  IA ativa ou na pausa que volta, e o follow-up só onde ele atravessa a pausa
  (sem pausa, ou `gente` com N > 0 — `ia-retomada.md`): o armado sob outra
  pausa é descartado no vencimento. E só a linha do DONO de agora (agente,
  card e etapa da decisão): a de outro (card movido para a etapa de outro
  agente) a conferência do motor descarta (Codex, #515). Ficam de fora a resposta que espera a
  EQUIPE (a linha da pausa já diz "volta a partir de"); a PRÉ-ARMAÇÃO não
  resolvida (30 s; a hora dela não é a do follow-up) sai como `agendando`:
  sem linha, só para a faixa perguntar de novo quando ela resolver — a
  resolução só muda `cb_ia_turnos`, nenhuma prop da faixa (Codex, #515).
- ⚠️ **`proximo` ausente ≠ `null`**: ausente (servidor antigo, forma
  estranha) = não se sabe, sem linha; `null` = nada na fila ("Sem follow-up
  agendado"). Leitura da fila que falha = 500, como o resto da rota.
- ⚠️ **A faixa pergunta de novo sozinha, e NUNCA para enquanto um agente
  atende** (o passo muda só em `cb_ia_turnos`, sem prop nenhuma mudar;
  `esperaParaReler`): 20 s depois da hora marcada, 15 s enquanto a IA
  escreve, 1 min com a hora vencida, teto de 12 h, e 2 min com a fila VAZIA —
  há vãos em que ela fica vazia por instantes (a resposta saiu e o follow-up
  seguinte ainda está sendo armado), e cada "parar de perguntar" deixava a
  faixa mentindo (três achados do Codex, #515). Sem leitura da fila
  (`proximo` nulo), só as props e os eventos. A contagem anda por um tique de
  30 s em estado (nunca `Date.now()` no render).

### Qual card decide o agente (decisão do operador, 09/11/2026)

- ⚠️⚠️ **`lerCardEAgente` (`quem-responde.ts`)**: entre os cards ABERTOS do
  contato (até 20, `created_at desc, id desc`), o mais recente cuja etapa tem
  agente LIGADO, não arquivado e com a conexão da mensagem; sem nenhum, o
  mais recente (a D24 de antes — `quemResponde` diz por que ninguém atende).
  Antes, o card novo noutro funil (Trabalhista) calava o agente do Bancário
  na conexão do Bancário. UMA leitura para a entrada, as conferências do
  turno, a retomada e a faixa (`GET /api/cb/ia/conversa/[id]`, com
  `canalId` nulo = o mais recente). O desempate por `id` faz dois cards da
  mesma transação darem sempre o mesmo card à entrada e à conferência.
- O bloco "Negócio" sem card do turno (o Playground; `lerNegocio` em
  `acesso.ts`) faz a mesma escolha pelo agente TESTADO, sem a conexão (o
  Playground não tem): o card numa etapa dele, senão o aberto mais recente.
  Falha ao ler as etapas = bloco indisponível, nunca o card de outro funil.
- **Limite aceito**: a pausa por gente (o gatilho da 1049) continua olhando
  "EXISTE card aberto em etapa com agente", sem a conexão: com dois cards e o
  agente do antigo noutra conexão, a resposta do SDR pausa e mover o card novo
  não entrega a conversa (a faixa mostra "Retomar"). 0 contatos assim em
  09/11/2026.
- ⚠️ **O "cliente" que é o número de OUTRA conexão da conta não tem IA**
  (`ehNumeroDeConexao`, pela chave de pessoa contra `cb_channels.display_phone`;
  `fora_do_alcance`, como o grupo): a mensagem entre dois números da conta
  entra como de cliente (validação de 25/10/2026), e com agente nas duas
  pontas eles se respondiam até o teto. A faixa não oferece nada.

### Custo por FAIXA do pedido (1108)

- ⚠️⚠️ **`cb_ia_uso` agrupa também por `acima_da_faixa`**
  (`prompt_tokens > 100000` numa linha de `ai_usage_log` = UMA chamada).
  `precos.ts`: linha com `acimaDe: LIMIAR_DA_FAIXA` é a tabela do pedido maior
  (Haiku 5.5: 0,10/0,50 até 100 mil; 0,50/2,50 acima). Sem a coluna
  (`acimaDaFaixa` nulo), modelo COM faixa é "sem preço", nunca a tabela baixa.
- O corte vive em DOIS lugares (o `.sql` e `LIMIAR_DA_FAIXA`), cobrados por
  `ia-uso-por-faixa-1108.test.ts` e `ia-uso-com-cache-1129.test.ts` (a 1129,
  com as somas do cache, é a definição vigente da função; o cache do
  provedor no custo: `ia-cache-do-pedido.md`): modelo com corte DIFERENTE exige migration
  nova. A rota pagina pelas SEIS chaves e exige a 1108 aplicada ANTES do
  deploy (ordenar por coluna ausente é erro do PostgREST).

### A tela de montar o agente (10/11/2026, pedido do operador)

- **O cabeçalho diz o que falta para atender** (do agente SALVO): instruções,
  chave do provedor (leitura das chaves que falha não acusa nada), ao menos
  uma conexão e uma etapa. Cada falta leva à aba.
- ⚠️ **UMA barra de salvar** para Configuração, Acesso, Base, Ferramentas e
  Retomada: cada aba entrega o Salvar dela (`registrarSalvar`, o do último
  render) e devolve `true`/`false`; a barra chama os das abas com alteração,
  um por vez, e para na primeira que falha (mostrando a aba). É o MESMO PATCH
  de cada aba — nenhum corpo combinado. "Descartar" remonta as abas
  (`geracao` na `key`; a do Playground continua só o id). Aba nova com
  rascunho entra em `ABAS_COM_RASCUNHO` e registra o Salvar, senão a barra
  não a salva.
- **Sair com alteração não salva pergunta antes**: o clique num link interno
  é segurado (captura no `document`) e "Sair sem salvar" navega; fechar ou
  recarregar, o aviso do navegador. Limite aceito: voltar pelo histórico não
  é segurado.
- **Configuração em seções** (`SECOES_DA_CONFIGURACAO`, com índice ao lado no
  desktop): Identidade, Como fala, Modelo, Onde atua, Quando responde, Limites
  e passagem, Arquivar. A falta de conexão é dita na seção; a de etapa, pela
  lista de etapas (`OndeAtua`) — uma vez só.
- **Acesso e Ferramentas em cartões**; as listas longas (campos, etiquetas)
  ficam recolhidas atrás de "Escolher (n de m)", com os marcados à vista.
  Ligar uma ferramenta, ou não ter nada marcado, deixa a lista aberta — fechar
  sozinha ao marcar o 1º item impedia marcar mais (achado no teste).
- **Retomada como lista numerada** ("Tentativa 2 · 1 h depois da resposta do
  agente") com a linha do tempo, "Nova tentativa" e quando para em chips
  (`PARADAS_A_VISTA`; o texto inteiro ao abrir). A cadência continua a mesma
  (`acrescentarIntervalo`: 1 a 8 tentativas, 10 min a 7 dias, contadas da
  resposta do agente).
