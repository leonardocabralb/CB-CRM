---
paths:
  - "supabase/migrations/1110_cb_ia_turnos_sobrevivem_a_conversa.sql"
  - "supabase/migrations/turnos-sobrevivem-1110.test.ts"
  - "src/lib/ia-agentes/conteudo-dos-turnos*"
  - "src/app/api/cb/ia/agentes/*/turnos/**"
  - "src/components/agentes-de-ia/turnos-do-agente.tsx"
---

# Central dos agentes — o turno durável (1110)

Plano: `docs/PLANO-central-dos-agentes.md` (C1; o desenho no anexo, "A1 —
Retenção"). Decisões do operador DC1–DC3 (26/10/2026). O motor do turno:
`ia.md` e `ia-agentes-turno.md`; a Lixeira por dentro: `supabase.md`.

### O turno sobrevive à conversa, em DUAS camadas (DC1, DC2)

- ⚠️⚠️ **O ESQUELETO fica, sem prazo**: agente, conexão, card, etapa,
  desfecho, tipo, o código do erro, as ações sem valor e sem detalhe cru,
  tokens e ids. É o que o Painel soma e o Registro lista.
- ⚠️⚠️ **O CONTEÚDO (texto do cliente) sai**: `contexto` (o retrato),
  `saida_bruta`, `erro_detalhe` e, de cada ação, `valor` e o `detalhe` cru —
  pelo PRAZO (`PRAZO_DO_CONTEUDO_DO_TURNO_DIAS`, 90; subir é trocar a
  constante) e na EXCLUSÃO DEFINITIVA da ficha (DC3). `conteudo_removido_em`
  e `_por` (`prazo` | `exclusao`) dizem quando e por quê; o primeiro carimbo
  vale (a limpeza não recarimba).
- ⚠️⚠️ **Coluna nova de `cb_ia_turnos` com texto do cliente entra em
  `cb_ia_turno_sem_conteudo` no MESMO PR** — senão escapa do prazo e da
  exclusão, sem erro nenhum.
- O `detalhe` que é CÓDIGO fica (`ja_estava`, `sem_marcador`,
  `nome_sem_origem`, `automacao_fala`, a lista no SQL), e também o código
  que acompanha um erro: o passo da D5 (`CODIGOS_DA_D5`) e o tipo do campo no
  `valor_invalido` (`FormatoDoCampo`). Código novo gravado pelo motor fora
  delas seria apagado como texto: o pino `turnos-sobrevivem-1110.test.ts` lê
  o motor (default-deny, inclusive toda `falha(código, detalhe)` classificada
  como código ou texto).
- O `erro` é cortado no primeiro `:` (o antigo colava o texto retido depois).
  Limite até a C3 (que move o texto para `erro_detalhe`): o erro cru SEM `:`
  (a mensagem do provedor) fica.
- **Só nascem** (a C3 grava): `motivo` (CHECK = `MOTIVOS_DE_TRANSFERENCIA`,
  pino; motivo novo em TS pede migration no CHECK antes), `esperou_horario`,
  `saida_bruta` e `erro_detalhe`.

### A FK e o gatilho do turno vivo

- `conversation_id` anulável; FK `ON DELETE SET NULL (conversation_id)` (a
  conta fica). Na tela, turno sem conversa = "sem conversa (apagada ou na
  Lixeira)", nunca "excluída": a ficha pode voltar.
- ⚠️⚠️ **`cb_ia_turnos_conversa_apagada_trigger`** (BEFORE UPDATE OF
  `conversation_id`): a conversa vira nula com o turno vivo → `descartado`
  (ou `incerto`, com `enviando_desde`: a resposta pode ter saído), erro
  `conversa apagada`, `terminado_em`. Sem ele, dois pendentes órfãos colidem
  no índice `NULLS NOT DISTINCT` (1049) e o DELETE da conversa ABORTA
  (medido num Postgres descartável; a conferência da 1110 prova de novo ao
  aplicar). Vale para o SET NULL da FK e para o `cb_lixeira_anular`.
- Turno VIVO nunca tem conversa nula. Quem lê turno TERMINADO trata o nulo: a
  rota da aba Turnos e o `eco.ts` (sem conversa = o caminho de sempre, como
  antes da 1110).
- Todo `erro` fixo que o BANCO grava no turno entra em
  `ERROS_GRAVADOS_PELO_BANCO` (`textos.ts`) e nos dois dicionários — pino
  lendo as migrations em `textos.test.ts`.

### A Lixeira (refeita na 1110)

- `cb_ia_turnos` fora do fecho; `cb_ia_turnos.conversation_id` → `reaponta`
  (restaurar religa o turno); o gatilho em `livres` (a volta só grava
  conversa NÃO nula; o mover precisa dele). O ponteiro
  `ai_usage_log.turno_id` saiu: o turno não sai mais com a ficha.
- ⚠️⚠️ **Excluir de vez** (o vencimento e o "Excluir agora", com ou sem o
  pedido do titular) limpa o conteúdo dos turnos dos ponteiros do item —
  FORA do `IF p_pedido` (DC3). O esqueleto fica, sem conversa.
- ⚠️ Branch que refaça `cb_lixeira_tratamento`/`cb_lixeira_purgar_um` parte
  do corpo VIGENTE do `main` no dia (o pino compara com o da 1102/1097).
- Limites: turno de conversa apagada FORA da Lixeira (DELETE à mão, desfazer
  de carga) só perde o conteúdo pelo prazo; o esqueleto guarda `deal_id`
  (card com o título = nome da pessoa), como a Lixeira já deixa — a
  confirmar com quem responde pela LGPD.

### A poda (o prazo)

- `cb_ia_podar_conteudo_dos_turnos(p_dias, p_limite)`: SECURITY DEFINER, só
  `service_role`, um lote por chamada, só turnos TERMINADOS. ⚠️ O índice
  parcial `(created_at) WHERE conteudo_removido_em IS NULL` espelha o filtro
  dela: mudar um sem o outro deixa o índice inútil (pino).
- Roda em `rodarManutencaoDoCiclo` (`agendadas.md`, laço lento), DEPOIS do
  vencimento da Lixeira (a ficha excluída de vez limpa como `exclusao`),
  isolada, sob o prazo comum. Sem rota nova nem `docker stack deploy`.
- A observação (C14) entra na MESMA rotina, com prazo próprio (30 dias).
