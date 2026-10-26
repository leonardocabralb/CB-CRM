# Plano — Motivos de desqualificação e de perda

Pedido do operador (26/10/2026): controlar POR QUE os leads são
desqualificados e os negócios são perdidos, com preenchimento fácil para a
equipe e, no futuro, pela IA que atende os leads. O lugar é o campo
personalizado (a IA já preenche campo).

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 0 | Listas de motivos aprovadas; campos criados nos blocos | ✅ 26/10: 4 campos gravados em produção (Bancário e Trabalhista); Previdenciário só renomeado |
| 1 | Migration: campo do motivo por etapa; seletor no Gerenciar funil | ✅ 26/10: código na branch (sem PR); 1112 APLICADA em produção (`20261026161549`) |
| 2 | Janela "Por que…?" nos caminhos de gente; botão Perdido escolhe etapa | código pronto 26/10 (branch); e2e no preview espera autorização |
| 3 | Passo "Mover card de etapa" grava o motivo | — |
| 4 | Relatório de motivos no Desempenho | — |
| 5 | Agente de IA que leva o card à perda grava o motivo | depois (agentes desligados) |

## Decisões do operador (26/10/2026)

- **D1 — Dois campos por área**, tipo Lista, no bloco de cada área:
  "Motivo da desqualificação" (o lead não servia: fala com anúncio e entrada)
  e "Motivo da perda" (servia e não fechou: fala com o comercial).
- **D2 — 3 ou 4 motivos pré-montados + "Outro"**, que abre texto livre. O
  texto vai para o PRÓPRIO campo (a ficha já mostra valor fora da lista,
  `campo-personalizado-input.tsx`, `foraDaLista`); o relatório agrupa o que
  está fora da lista como "Outro" e lista os textos.
- **D3 — Obrigatório para PESSOAS na tela**: sem motivo o card não vai para a
  etapa; cancelar a janela devolve o card para onde estava.
- **D4 — Automação grava o motivo NO PRÓPRIO PASSO** "Mover card de etapa"
  quando o destino pede motivo; o validador avisa se ficar vazio. Automação,
  robô, IA e API nunca abrem janela (não há ninguém para responder).
- **D5 — O botão "Perdido"** (painel e formulário do negócio) passa a
  perguntar a etapa de perda + o motivo e MOVE o card para a etapa. Muda o
  comportamento do botão (hoje marca perdido sem trocar a etapa).
- **D6 — Três níveis**: campos, janela e relatório.
- **D7 — Listas e regra entre as etapas aprovadas** (abaixo), tiradas da
  leitura das conversas, anotações e fichas dos cards movidos por gente em
  30 dias. A análise com as contagens e os achados de negócio fica FORA do
  repositório (`~/Downloads/CB-CRM/motivos-de-perda-2026-10-26/`).

## Medições técnicas (26/10/2026, produção, só leitura)

- **≈ 9 perdas por dia feitas por pessoas** nos funis comerciais do Bancário
  e do Trabalhista (`cb_lead_events` `status_changed` → `lost`, com
  `actor_user_id`).
- **Todas por troca de etapa**: nenhuma perda pelo botão "Perdido" sem
  trocar a etapa em 30 dias. Por isso a janela se ancora na ETAPA.
- **Automações que levam a etapa de perda**: 6 ATIVAS, todas do
  Previdenciário → "Desqualificado" (lembretes e reengajamento sem
  resposta); 2 desligadas ("(RASCUNHO) Trabalhista · Recuperação" →
  Perdido; "Typebot · Desqualificado" → Bancário). Nenhum robô (`flow_nodes`)
  leva a etapa de perda.
- **Etapas de perda** (`resultado = 'perdido'`): Bancário "Desqualificado"
  (marca `desqualificacao`) e "Perdido"; Trabalhista "Desqualificado - Sem
  Direito" (marca) e "Perdido"; Previdenciário "Desqualificado" (marca) e
  "Contrato sem pasta". ⚠️ "Não Respondeu" do Trabalhista é degrau `perda`
  mas etapa NEUTRA: não pede motivo, salvo se o operador ligar.
- **Campo que já existe**: Previdenciário "Motivo da desqualificação"
  (`aa_motivo_desqualificacao`, Lista), com 0 valores preenchidos — livre
  para reorganizar.
- **Nenhum card tinha o motivo registrado** (quase nenhuma anotação; nenhum
  campo).
- **A IA já preenche Lista**: o pedido do agente diz "exactly one of: …"
  (`src/lib/ia-agentes/pedido.ts`) e a passagem grava campo antes de mover
  (`.claude/rules/ia-agentes-turno.md`).

## Listas de motivos aprovadas (Fase 0)

Toda lista termina com **"Outro"** (texto livre na janela).

| Área | Motivo da desqualificação | Motivo da perda |
| --- | --- | --- |
| Bancário | Dívida abaixo do valor mínimo · Só Pronampe/FGI (linha do governo) · Consignado ou dívida com garantia · Não é dívida bancária / spam | Desistiu / não quis seguir · Fechou com outro escritório · Parou de responder · Sem condição de pagar a proposta |
| Trabalhista | Não estava grávida na saída · Contato por engano / sem caso · Prazo de 2 anos vencido · Justa causa ou demissão homologada | Número inválido / sem WhatsApp · Parou de responder / bloqueou · Já tem ou escolheu outro advogado |
| Previdenciário | Sem sequela · Sem direito · Contato por engano / sem caso | Não respondeu · Não reengajou · Já tem advogado |

### Regra entre as duas etapas (aprovada, nas três áreas)

- **Desqualificado** = fora do perfil: o que o lead disse mostra que não há
  caso (decidido antes da proposta).
- **Perdido** = tinha o caso, ou não deu para saber, e não avançou: parou
  de responder, número inválido, escolheu outro advogado, desistiu, sem
  condição de pagar.

### Em aberto

- ⚠️ **Previdenciário não tem etapa "Perdido"**: as 6 automações de
  lembrete levam quem não responde para "Desqualificado", o que pela regra
  é perda. Decidir antes da Fase 3: criar a etapa "Perdido" no
  Previdenciário, ou o "Desqualificado" de lá perguntar uma lista que
  inclua "Não respondeu".
- O rótulo do valor mínimo do Bancário fica sem número até o operador
  confirmar o valor.

## Desenho

### Fase 0 — os campos (✅ 26/10/2026)

Resultado medido: INSERT dos 4 campos + UPDATE do nome do campo do
Previdenciário pela Management API, com o "pode gravar" do operador.
Conferido pelo `supabase-cb`: opções certas terminando em "Outro", 0
valores, dono = `accounts.owner_user_id`, e as 7 automações do
Previdenciário ainda apontam para o mesmo id. Catálogo conferido no
preview (Configurações → Campos e etiquetas). Desfazer: apagar os quatro
campos (nasceram vazios) e devolver o nome "Motivo da desqualificação".

- Quatro campos Lista agora (dois no Bancário, dois no Trabalhista), com a
  área no nome — "Motivo da perda (Bancário)" —, porque o seletor do passo
  "Atualizar campo" e o catálogo do agente de IA listam os campos sem o
  bloco. Chaves `ba_motivo_desqualificacao`, `ba_motivo_perda`,
  `tr_motivo_desqualificacao`, `tr_motivo_perda` (o Previdenciário já usa
  `aa_`).
- ⚠️ **O Previdenciário NÃO se divide na Fase 0** (medido em 26/10): as 6
  automações de lembrete já GRAVAM o motivo no campo atual
  (`update_contact_field`: "Não respondeu", "Não reengajou", "Outro") e a
  automação desligada "Volta do Desqualificado por 'Não respondeu'" DECIDE
  por ele (condição `equals`). Dividir agora quebraria as duas pontas. O
  campo só ganha a área no nome; a divisão vai junto com a decisão da etapa
  "Perdido" do Previdenciário (Em aberto), repontando as 7 automações.
- Dono durável: `custom_fields.user_id` CASCADEia de `auth.users` → grava
  `accounts.owner_user_id`, nunca o login de quem cria (CLAUDE.md, 8a).
- A chave (`field_key`) nasce do nome pelo gatilho da 948.

### Fase 1 — qual campo cada etapa pergunta (código pronto em 26/10/2026)

Arquivos: `supabase/migrations/1112_cb_campo_do_motivo_da_etapa.sql` (+ pino
`campo-do-motivo-1112.test.ts`), `src/lib/pipelines/motivo-da-etapa.ts`
(puro, testado), `src/components/pipelines/motivo-da-etapa-config.tsx`,
`pipeline-settings.tsx` (catálogo lido pela conta do funil, coluna no
upsert), `PipelineStage.campo_do_motivo_id`, `Pipelines.settings.motivo`
nos dois dicionários, regra `.claude/rules/motivos-de-perda.md`.

- `pipeline_stages.campo_do_motivo_id uuid NULL` → `custom_fields(id)`
  `ON DELETE SET NULL`. A etapa sem campo não pergunta nada (comportamento
  de hoje). Quem decide é a CONFIGURAÇÃO da etapa, não o `resultado`.
- **Mudou do desenho**: o gatilho confere só a CONTA, não o tipo. O upsert
  do Gerenciar funil regrava todas as etapas a cada "Salvar" (e o BEFORE
  INSERT do upsert roda até para a linha que vira UPDATE): conferir o tipo
  travaria o salvamento depois de o tipo do campo mudar. Quem lê confere o
  tipo (`motivoDaEtapa`).
- **Mudou do desenho**: seção própria ("Motivo ao entrar na etapa", acima
  do "Botão de avançar"), não uma quinta caixa na linha da etapa — a linha
  já não cabe abaixo de `lg`. Print: `~/Downloads/CB-CRM/motivos-de-perda-2026-10-26/fase1-gerenciar-funil.jpg`.
- Medido: replay de 235 migrations até a 1112 num Postgres 16 local limpo
  (verify-schema OK) e 7 cenários (mesma conta grava; outra conta recusada
  no INSERT, no UPDATE e no upsert; upsert com tipo trocado passa; apagar o
  campo zera a etapa; apagar a conta não trava; reaplicar passa).
  typecheck, lint e 869 testes verdes (Node 22).
- ⚠️ ADITIVA: aplicar a 1112 ANTES do deploy (sem a coluna, o PostgREST
  recusa o "Salvar" do Gerenciar funil inteiro). Conferir o número nas
  worktrees e no histórico logo antes.

### Fase 2 — a janela, nos caminhos de GENTE (código pronto em 26/10/2026)

Arquivos: `src/components/pipelines/janela-do-motivo.tsx` (NOVO:
`useJanelaDoMotivo`), funções puras em `motivo-da-etapa.ts` (`etapasDePerda`,
`ehOutro`, `opcoesDaJanela`, `escolhaInicial`, `valorDaEscolha`, testadas),
a página do funil e o quadro, `lista-de-leads.tsx`,
`painel-do-contato.tsx`, `avancar-etapa.tsx`, `deal-form.tsx`, a
sub-árvore `Pipelines.janelaDoMotivo` nos dois dicionários e o pino
`janela-do-motivo.chamadores.test.ts`.

- Caminhos ligados: arrastar no quadro, seletor de etapa do painel, botão
  "avançar", lista do funil, formulário do negócio (mudar etapa, ou criar
  direto numa etapa com motivo) e o botão "Perdido" (painel e formulário).
  Fora, por escrito: a pauta de reuniões (`reunioes/executar.ts`, só etapas
  de reunião).
- A janela mostra os motivos do campo como seletor, pré-marca o valor atual
  da ficha, e "Outro" abre texto livre. Confirmar grava o CAMPO
  (`salvarValoresDoContato`) e só depois move; falha ao gravar NÃO move;
  cancelar não grava nada e o card fica na coluna (o quadro não o marca
  como recém-solto).
- Botão "Perdido": a janela pergunta a etapa (as de `resultado = 'perdido'`
  do funil) e o motivo dela, e move com `status: 'lost'` junto (etapa igual
  não passa pelo gatilho da 950). Funil sem etapa de perda: como antes.
- **Decidido na implementação**: card sem contato (ficha na Lixeira) move
  sem janela, com aviso; campo que deixou de servir deixa mover sem motivo,
  com aviso (configuração quebrada não trava o trabalho); leitura que falhou
  trava com "Tentar de novo".
- **Limite aceito**: no "avançar", desfazer o movimento não apaga o motivo
  já gravado.
- Medido: typecheck e lint limpos nos arquivos da frente; suíte inteira
  verde (794 arquivos, 12.462 testes). Dois pinos atualizados sem mudar o
  que protegem: `ao-voltar.test.ts` (o movimento do quadro virou
  `persistirMovimento`) e o inventário de escritores de `deals`
  (`origem-dos-escritores.chamadores.test.ts`: o `marcarStatus` tem dois
  `update` literais, origem `user`). **e2e no preview pendente**: salvar a configuração e
  mover o card de teste gravam em produção e esperam a autorização do
  operador.

### Fase 3 — automações

- `move_deal_stage.step_config.motivo` (texto). O motor grava o motivo no
  campo da etapa de destino quando o movimento acontece. Validador avisa
  quando o destino pede motivo e o passo não tem. Descrição do passo e
  ajuda na tela mudam junto (doc acompanha, CLAUDE.md seção 11).
- As 6 automações do Previdenciário recebem o motivo (ex.: "Não
  respondeu") — edição em produção só com o "pode gravar", ou pelo
  operador na tela.

### Fase 4 — relatório

- No Desempenho: por funil e período, os CARDS que entraram em etapa com
  motivo, agrupados pelo motivo ATUAL da ficha (fora da lista → "Outro",
  com os textos), e "Sem motivo" separado por quem moveu (pessoa,
  automação, IA, API). Agregação no banco (RPC), nunca contar no navegador
  (corte de 1000 linhas do PostgREST).

### Fase 5 — IA (depois)

- O agente que move para etapa com motivo grava o campo da etapa na
  passagem. Hoje já dá pela configuração da passagem (campo + mover).

## Limites aceitos

- **O motivo é do CONTATO, não do negócio.** Lead que volta e é perdido de
  novo sobrescreve; o relatório mostra o motivo atual.
- API e integrações (Make, n8n) não são obrigadas a mandar motivo: aparecem
  em "Sem motivo — API".
