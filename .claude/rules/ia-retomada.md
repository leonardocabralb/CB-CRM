---
paths:
  - "src/lib/ia-agentes/retomada*"
  - "src/lib/ia-agentes/turno*"
  - "src/lib/ia-agentes/rede*"
  - "src/components/agentes-de-ia/retomada*"
  - "supabase/migrations/1056_cb_ia_retomada.sql"
---

# Agentes de IA — a retomada quando o cliente não responde (1056, 27/09/2026)

`retomada.ts` (puro), `retomada-fatos.ts`, `retomada-resposta.ts` e a seção
"A RETOMADA" de `turno.ts`. Plano: `docs/PLANO-agentes-de-ia.md` (Estado). O
motor, a fila e a pausa estão em `.claude/rules/ia.md`; o que o agente vê e
faz, em `.claude/rules/ia-agentes.md`. ⚠️ "Retomada" aqui é o FOLLOW-UP; o
"Retomar IA" da faixa (`conversations.ia_retomada_em`) é outra coisa.

- ⚠️⚠️ **É uma linha da MESMA fila** (`cb_ia_turnos.tipo = 'retomada'`,
  `tentativa` 1-based, `tentativas` = a cadência ao armar), vencendo em
  `executar_apos`: rodada pela rede do cron, NUNCA por `after()`. A
  `mensagem_gatilho_id` é a ÂNCORA — a resposta do AGENTE sem resposta.
- **Quem arma**: o turno `respondeu` sem pedir a equipe (`pediuEquipe`:
  `[[TRANSFERIR]]`, equipe prometida, reunião não marcada), com a retomada
  ligada; cada retomada que sai arma a seguinte. 23505 ao armar = o cliente
  escreveu. Robô, automação e gente não armam. Conversa ENCERRADA durante o
  turno (a automação que o agente executou) não arma: `armarRetomada` relê a
  conversa (1109, `ia-agentes-turno.md`).
- ⚠️⚠️ **A fala da EQUIPE também arma (1138, P4 e P7 do operador,
  11/11/2026)**, com a cadência do agente da etapa, contada DELA: a equipe
  pediu o holerite e a cliente sumiu → a IA cobra. Quem arma é o gatilho da
  pausa por gente (a única porta de toda fala de gente): uma linha de
  PRÉ-ARMAÇÃO (`ERRO_DA_ARMACAO_PELA_EQUIPE`, sem agente/card/etapa; só com N
  > 0 na conta, pausa `gente` e um agente ligado com a conexão e a retomada —
  `ia-pausa.md`). `conduzirRetomada` a RESOLVE (`resolverArmacaoDaEquipe`:
  `lerQuemAtende` + `quemResponde` atravessando a pausa `gente`, a retomada
  ligada, ninguém depois da âncora) e grava agente, card, etapa, `tentativa
  = 1`, `tentativas` = a cadência — no MESMO objeto do turno (o `encerrar` e o
  `armarRetomada` da seguinte o leem) — e segue como toda retomada (a
  conferência a reagenda para o vencimento). Nada aplicável = `descartado`.
- ⚠️ **A retomada atravessa SÓ a pausa `gente`** (com N > 0;
  `minutosDaPausaDaRetomada`): o "Pausar" sem resposta, o "Desativar", a
  transferência e a automação param a série. O follow-up que SAI levanta a
  pausa (`cb_ia_voltar_da_pausa`, logo antes da reserva; `alguem_escreveu`
  descarta): a cliente que responde a ele é respondida pela IA na hora (P7).
  ⚠️ Levantada e NADA saiu (a reserva recusou, o envio falhou ou ficou
  incerto): a pausa `gente` VOLTA (`devolverPausaDaEquipe`, cercada pela
  conversa sem pausa) — senão a próxima mensagem era respondida em 8 s.
  O pedido ganha a linha "a última foi da equipe" (`daEquipe`, parte
  VARIÁVEL, pela `sender_type` da âncora) SÓ na 1ª tentativa: da 2ª em
  diante a última fala é o follow-up da própria IA.
- ⚠️⚠️ **Arma com o card e a etapa de AGORA** (revisão de 09/11/2026): a
  própria resposta pode ter movido o card (`mover_etapa`); armada com a etapa
  do começo do turno, ela era descartada SEMPRE no vencimento ("o card mudou
  de etapa"), justo depois da proposta. `armarRetomada` relê
  (`lerQuemAtende` + `quemResponde`, a régua do vencimento): etapa do MESMO
  agente arma com ela; de outro agente ou sem agente NÃO arma — o novo dono
  fala na próxima mensagem (decisão do operador, 09/11/2026). Exige também o
  MESMO card do turno (só a etapa muda): com dois cards do agente, o da
  resposta movido para etapa sem dono faria a leitura cair no card ANTIGO, e
  a retomada armada nele passaria no vencimento, que compara com o card que
  ela mesma gravou (Codex, #484).
- ⚠️ **Não arma com turno de RESPOSTA vivo na conversa** (`aguardando` ou
  `rodando`): o cliente escreveu enquanto a resposta saía, e o turno dele, já
  reivindicado, não ocupa a vaga do pendente (sem 23505). Armada, a retomada
  (gatilho = a resposta, mais nova que a mensagem do cliente) fazia a reserva
  dele recusar `mais_nova`; desde a 1130 a reserva também não a conta.
- ⚠️⚠️ **A cadência mantém o ESPAÇAMENTO** (decisão do operador, 27/09):
  `max(ancora + cadencia[k], enviada(k-1) + (cadencia[k] − cadencia[k-1]))`,
  piso de 30 min depois da anterior, dentro da janela ∩ horário do agente. A
  tentativa adiada empurra as seguintes — contada só da âncora, a noite fora
  da janela despejava cinco mensagens de manhã (pino no teste).
- ⚠️⚠️ **O cliente que escreve DESCARTA a pendente**: dentro de
  `cb_ia_enfileirar_turno` (1056, toda conexão) quando abre turno; o que não
  abre (figurinha, conversa pausada…) é visto quando ela VENCE
  (`motivoDaParada`: cliente — apagada também —, equipe, robô ou outro agente
  depois da âncora). A última palavra é a reserva (1056: `cliente_respondeu`,
  `equipe_respondeu`, `robo_falou`, `sem_ancora`, `retomada_desligada`).
  ⚠️ A tentativa que NÃO saiu (`nao_saiu`) não para nada: nem a do robô
  (1080) nem a da equipe (1118, `agent` com `sender_id`) — o cliente não a
  recebeu. Os dois lados filtram (`retomada-fatos.ts` e a reserva).
- ⚠️⚠️ **A automação que o PRÓPRIO agente executa fala em nome dele**
  (09/11/2026, o vídeo e o link da assinatura do Trabalhista): o turno passa
  `iaAgenteId` a `runAutomationById` (`executar-acoes.ts`), e o texto e a
  mídia dela saem com `messages.ia_agente_id` — não param a série
  (`robo_falou`, no TS e na reserva). Antes, resposta + automação matava a
  retomada já na 1ª tentativa. A marca só entra pelo argumento, atravessa o
  "Acionar automação" e a retentativa, e o disparo por evento a descarta (a
  cascata da etiqueta): `automacoes-passos.md`, pino
  `envio.chamadores.test.ts`. Na 1ª tentativa `proximaRetomada` IGNORA a
  "anterior" (seria a fala da automação: o piso de 30 min empurrava o 1º
  toque). As mensagens dela CONTAM no teto (são do agente). Limite: botões,
  lista e modelo da automação saem SEM a marca (param a série).
- **Ao rodar, tudo é reconferido**: card, agente, retomada ligada, quem
  escreveu, e o vencimento — fora da janela ou a menos de 30 min de um
  LEMBRETE = volta à fila; a 90 min da reunião, cadência no fim ou janela de
  24 h da Meta fechada = para. Os lembretes saem de TODAS as automações
  `date_field_offset` que vigiam um campo, ⚠️ LIGADAS OU NÃO (na transição a
  Kommo manda os mesmos), aplicadas à ficha (`campoDoLembrete`,
  `deslocamentoEmMs`); todo campo vigiado é data de reunião, e os 90 min
  valem com a data futura mesmo com o deslocamento ilegível. Leitura que
  falha ao rodar = a série para (ao armar, segue sem eles).
- ⚠️ **Nada executa e nada transfere**: sem ações, passagens nem horários no
  pedido (`montarPedidoDaRetomada`, com as regras do sistema, como todo
  pedido); `[[SEM_RETOMADA]]`, `[[HANDOFF]]`, `[[TRANSFERIR]]`, passagem,
  pedido vazado (`vazouOPedido`, que conhece um trecho da própria seção da
  retomada), equipe prometida e link inventado PARAM a
  série (`sem_resposta`, motivo no `erro`), sem mandar — `lerRespostaDaRetomada`
  é a régua do turno E do Playground. O teto conta as retomadas e só para; o
  `incerto` não transfere (nem recolhido pela rede). A falha PASSAGEIRA do
  provedor (prazo, 429, 5xx) tenta UMA vez mais, como o turno
  (`ERRO_DA_REPETICAO`, 09/11/2026): o `falhou` não arma a seguinte, e um 429
  acabava a série.
- ⚠️⚠️ **A conversa ao modelo NÃO pode terminar na resposta do agente**: o
  Gemini recusa ("Requests ending with a model turn are not supported",
  MEDIDO no e2e de 27/09 — o provedor falso dos testes não pegava) e a
  Anthropic trata o turno do modelo como texto a CONTINUAR. `comNotaDaRetomada`
  fecha com uma nota no papel de usuário, que diz não ser o cliente — no turno
  E no Playground.
- **Playground**: `retomada: true` simula a tentativa seguinte (a conversa
  termina na resposta do agente), com `parada` quando nada sairia.
- **Deploy DEPOIS da 1056**: `COLUNAS_DO_AGENTE` pede `retomada` (sem ela,
  toda leitura de agente falha) e a aba Turnos pede `tipo`.
- **Limites**: fonte `reuniao` (`cb_meetings`) fora dos bloqueios; a
  mensagem que não abre turno fica na fila até vencer (aba Turnos); o turno
  que MORRE depois de enviar e antes do `encerrar` é fechado pelo recolhedor
  como `respondeu` SEM armar a tentativa seguinte — a série acaba ali (Codex,
  PR #328; janela de segundos num deploy, e o lado é o de mandar menos); o
  horário é conferido ANTES de gerar e a 2ª conferência só olha quem escreveu,
  então a geração (segundos) pode fazer a retomada sair segundos depois do fim
  da janela ou dentro de uma folga (Codex, PR #328).
