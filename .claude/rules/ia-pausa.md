---
paths:
  - "src/lib/ia-agentes/pausa*"
  - "src/lib/ia-agentes/entrada*"
  - "src/lib/ia-agentes/contexto*"
  - "src/components/inbox/ai-thread-banner*"
  - "src/app/api/ai/autoreply/**"
  - "src/app/api/cb/ia/pausa/**"
  - "src/app/api/cb/ia/conversa/**"
  - "src/components/agentes-de-ia/pausa-da-conta*"
  - "supabase/migrations/1138_cb_ia_pausa_temporaria.sql"
---

# Agentes de IA — a pausa TEMPORÁRIA (1138, revisa a D26)

Decisões do operador de 11/11/2026 (P1–P7 de
`docs/PLANO-pausa-temporaria-da-ia.md`). O motor, a fila e a reserva estão em
`ia.md`; a retomada (follow-ups), em `ia-retomada.md`.

### A configuração é da CONTA

- ⚠️⚠️ **`ai_configs.ia_volta_apos_min`, na linha PADRÃO** (`channel_id`
  nulo, ao lado da `cotacao_dolar`): NOT NULL DEFAULT 15, CHECK 0–1440. Vale
  para TODO agente — nada por agente, funil ou conexão (operador, 11/11). 0 =
  desligado: toda pausa fica até o "Retomar IA" e a IA não faz follow-up da
  fala da equipe (o comportamento de antes, inteiro). Sem a linha = 15.
- Escrita SÓ por `PUT /api/cb/ia/pausa` (admin; o `POST /api/ai/config`
  reescreve a linha e não conhece a coluna). Tela: cartão "Quando a equipe
  responde" na aba Agentes de `/agents` (`pausa-da-conta.tsx`), que nunca
  mostra "15" ou "desligado" antes de ler.
- ⚠️ **Leitura do N que falha FALHA FECHADO** (`lerVoltaAposMin` lança): a
  entrada não enfileira, o turno vira `falhou`, a faixa responde 500 — nunca
  "0 = como antes" nem "15" por ignorância.

### Temporária × permanente

- **Temporárias** (`MOTIVOS_TEMPORARIOS`, `pausa.ts`): `gente` (o gatilho da
  1049) e `botao` (o "Pausar"). **Permanentes**: `desativada` (o "Desativar
  IA", NOVO na 1138), `transferencia` (P2) e `automacao`. A lista vive TAMBÉM
  no SQL (CHECK, gatilho e `cb_ia_voltar_da_pausa`): pino
  `supabase/migrations/pausa-temporaria-1138.test.ts`.
- "Retomar IA" continua a única porta das permanentes e o único que ZERA o
  teto (`ia_retomada_em`). Mover o card NÃO limpa a temporária (P3).
- O "Pausar" (rota com `{ paused: true }`) só casa sem pausa ou com a
  temporária (`.or(...)`): nunca rebaixa a permanente (0 linhas = 409). O
  "Desativar" (`permanente: true`) sobrescreve qualquer uma.

### O retorno: "a cliente esperando há N min sem resposta da equipe"

- ⚠️⚠️ **Âncora = `greatest(aguardando_desde, ia_pausada_em)`**
  (`voltaDaPausaEm` no TS, a mesma conta no SQL): a 1ª mensagem sem resposta
  (972) ou a pausa — o "Pausar" apertado depois recomeça a contagem dali.
- **A entrada** (`entrada.ts`): pausa temporária + N > 0 → `quemResponde`
  com `pausaTemporaria` (as regras seguem; o agente vem `sobrePausa`) →
  enfileira com `esperaMs` até a âncora + N (nunca menos que a rajada) e
  MARCA a linha `ERRO_DA_ESPERA_DA_EQUIPE` (a fila a devolve limpa a cada
  mensagem). Espera acima de 60 s não segura `after()`
  (`ESPERA_MAXIMA_NO_PROCESSO_MS`): quem roda é a rede do cron.
  `lerQuemAtende` só para cedo na pausa PERMANENTE (a temporária precisa do
  card e do agente).
- **O turno** (`conduzir`): a 1ª conferência aceita a temporária
  (`aceitaPausaTemporaria`); depois do HORÁRIO (fora dele, espera a abertura,
  P5) `cb_ia_voltar_da_pausa` decide: `cedo` reagenda para a volta (com a
  marca), `equipe_respondeu` descarta, `voltou` LEVANTA a pausa e segue. ⚠️
  Levantada ANTES de gerar, de propósito: a transferência que o modelo pedir
  passa a valer (`transferirParaGente` não grava por cima de pausa). A 2ª
  conferência é ESTRITA: pausa que aparece durante a geração é gente
  respondendo (o gatilho pausa de novo porque há turno vivo).
- **`cb_ia_voltar_da_pausa`** (INVOKER, service_role): conversa travada
  (`FOR NO KEY UPDATE`), cerca de posse do turno; "gente depois do gatilho" é
  a régua do gatilho (`agent` com `sender_id` ou celular, sem
  `ia_agente_id`, `NOT nao_saiu`). Levanta SÓ os três campos da pausa — nunca
  o teto nem o responsável. Limite aceito: pausa levantada e geração que
  falha = a conversa fica sem pausa sem resposta (a próxima mensagem é
  atendida na hora).

### O gatilho da pausa por gente (corpo da 1138)

- A pausa de sempre (1049) e, na conversa JÁ pausada: (a) a temporária vira
  `gente` com `ia_pausada_em` de agora (o "Pausar" respondido é "a equipe
  respondeu"); (b) o pendente de RESPOSTA sai `a equipe respondeu` (era o
  retorno — a faixa não pode dizer "volta às 14:32" sobre isso).
- (c) **A PRÉ-ARMAÇÃO do follow-up da equipe** (P4): com N > 0, pausa `gente`,
  mensagem que não é ligação e um card aberto numa etapa cujo agente está
  ligado, com a conexão e a retomada ligada → linha `retomada` na fila,
  âncora = a fala da equipe, SEM agente/card/etapa, marca
  `ERRO_DA_ARMACAO_PELA_EQUIPE`, 30 s. A fala seguinte só move a âncora
  (`ON CONFLICT … DO UPDATE`). Detalhe da resolução: `ia-retomada.md`.
- ⚠️ É a ÚNICA porta: toda fala de gente (CRM, celular, agendada) passa por
  ele. Escrita à mão em `messages` de fala de gente PRÉ-ARMA também
  (`supabase.md`, escrita manual).

### A faixa (`ai-thread-banner.tsx`) e a rota dela

- `GET /api/cb/ia/conversa/[id]` devolve também `pausaTemporaria`,
  `voltaAposMin` (lido só onde há agente ou pausa) e `voltaEm` (o pendente
  marcado `ERRO_DA_ESPERA_DA_EQUIPE`).
- Atendendo com N > 0: [Pausar] (dica com o N) + [Desativar IA]. Temporária:
  "volta às <hora> se ninguém da equipe responder" (ou "volta sozinha se o
  cliente esperar N min"), [Retomar IA] (agora) + [Desativar IA].
  Desativada: "IA desativada nesta conversa" + [Retomar IA]. N = 0 ou
  servidor sem os campos: a faixa de antes — nunca "volta sozinha" por
  ignorância. A hora sai por `toLocaleTimeString(undefined, …)`.
- A aba Turnos diz "aguardando a equipe responder · a IA volta <quando>" e
  traduz `a equipe respondeu` (`ERROS_GRAVADOS_PELO_BANCO`).

### O contexto do modelo: a fala da EQUIPE vai rotulada (P6)

- `montarConversa` prefixa `ROTULO_DA_EQUIPE` (`[Team member]`, SEM o nome)
  na fala de gente (`ehFalaDaEquipe`: `agent` com `sender_id` ou celular, sem
  `ia_agente_id`); IA, robô, automação e mensagem sem autor (API) ficam como
  antes. O TEXTO-BASE (pedaço FIXO, texto constante: o cache erra uma vez no
  deploy) diz que é a equipe, para não repetir nem contradizer e seguir o que
  ela combinou. O rótulo imitado no começo de linha sai em `lerAcoes`
  (`semRotuloDaEquipe`): nunca chega ao cliente.
