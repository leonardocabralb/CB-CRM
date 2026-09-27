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
  escreveu. Robô, automação e gente não armam.
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
  `incerto` não transfere (nem recolhido pela rede).
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
  PR #328; janela de segundos num deploy, e o lado é o de mandar menos).
