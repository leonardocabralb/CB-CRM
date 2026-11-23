---
paths:
  - "src/lib/instagram/envio*"
  - "src/lib/instagram/graph*"
  - "src/lib/inbox/janela-24h*"
  - "src/lib/whatsapp/send-message*"
  - "src/lib/whatsapp/resposta-de-gente*"
  - "src/lib/scheduled/dispatch*"
  - "src/app/api/cb/scheduled/**"
  - "src/app/api/whatsapp/send/**"
---

# Instagram Direct: a janela de 7 dias (Human Agent) — regras

Fora das 24 h, a resposta de GENTE sai com a tag HUMAN_AGENT até 7 dias da
última mensagem da pessoa por aquela conexão. Decisão do operador
(22/11/2026, sobre a D2 e a U9 de `instagram.md`): vale a resposta digitada
e enviada na hora pela caixa E a agendada pela tela; o interruptor da conexão
nasce desligado e só se liga depois de a Meta aprovar o recurso para o app.
O resto do Direct (recusas, janela de 24 h, eco): `.claude/rules/instagram.md`.

- ⚠️⚠️ **Duas pontas, e as duas no SERVIDOR**: o interruptor
  (`cb_channels.ig_human_agent`, `=== true` no PATCH; o `CHANNEL_COLS` de
  `resolve.ts` o traz, senão o núcleo o lê falso) E `respostaDeGente` no
  núcleo. Só dois passam o parâmetro: `/api/whatsapp/send` (`true`: a caixa,
  o anexo, a voz e o "Tentar de novo") e o disparador da agendada
  (`linha.pela_tela === true`). API v1, MCP, automação, robô e IA nunca:
  mensagem AUTOMÁTICA é uso proibido da tag (referência da Send API), e o uso
  fora do permitido restringe a conta. Pino default-deny
  `resposta-de-gente.chamadores.test.ts`.
- ⚠️⚠️ **`cb_scheduled_messages.pela_tela` (1154) é o que separa a agendada
  da TELA da da API v1**: a API grava `created_by` com o dono da conta
  (`resolveApiAuthor`), o mesmo valor de quando o dono agenda pela tela. Só
  `/api/cb/scheduled` grava `true`; o padrão do banco é falso (linha antiga e
  da API ficam fora). A agendada é conferida na HORA do envio: o Agendar não
  trava na faixa.
- **A faixa é `faixaDaJanelaDoDirect`** (`envio.ts`, puro): dentro das 24 h
  sai SEM tag mesmo ligada; de 24 h a 7 dias, com a tag; depois,
  `window_closed` com `FRASE_JANELA_DO_HUMAN_AGENT_FECHADA`. Quem não é gente,
  dentro dos 7 dias, ouve `FRASE_HUMAN_AGENT_SO_DE_GENTE` (o integrador sabe
  por que a janela ligada não o alcança).
- ⚠️ **O pedido: `messaging_type: 'MESSAGE_TAG'` e `tag: 'HUMAN_AGENT'` no
  TOPO do corpo** (`corpoDaMensagem`), só quando a tag vai: sem ela o corpo é
  o medido nos envios reais (sem `messaging_type`). Forma lida na referência
  da Send API (22/11/2026, na cópia arquivada de 10/01/2026: a página atual da
  Meta vem vazia); a doc do Instagram diz que o formato é o mesmo. NÃO medida
  contra a Meta: sem a aprovação não há como. Vale nos dois hosts
  (`contaDaConexao`); a análise pedida é a do app da Atlas (central).
- ⚠️ **Com a tag, todo 4xx — o 2534022 inclusive — é `instagram_rejected` COM
  a tentativa** (bolha "não enviada" gravada), a causa reescrita com
  `FRASE_HUMAN_AGENT_RECUSADO` + a mensagem da Meta: sem a aprovação ela recusa
  o que sai fora das 24 h, e a forma desse erro não foi medida. O "não sei"
  (rede, 5xx, 2xx sem `mid`) segue `instagram_error`, nunca repete.
- **Na tela, o MESMO canal das 24 h** (`canalDaJanela`, o `CbChannel` traz
  `ig_human_agent`): `humanAgentNoCanal` e `minutosDoHumanAgent`
  (`janela-24h.ts`) alimentam a etiqueta âmbar "Human Agent: N dias
  restantes", o portão do disparo (`janelaFechadaAgora` deixa a faixa passar)
  e a frase da janela fechada (os 7 dias). O compositor recebe `humanAgent`
  (`na_faixa` → a dica âmbar; `ligado` → a dica da janela fechada fala dos 7
  dias). Pino `janela-24h.chamadores.test.ts`.
- **O texto do interruptor diz o que ele faz e que depende da aprovação**
  (`Settings.channels.instagramHumanAgentHint`). Ligado antes dela, cada
  resposta da faixa volta recusada, com a frase que manda desligar.
