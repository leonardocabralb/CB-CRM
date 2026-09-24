---
paths:
  - "src/lib/pipelines/**"
  - "src/components/pipelines/**"
  - "src/app/*/pipelines/**"
  - "src/lib/deals/**"
  - "src/lib/cb-channels/pipeline-routing*"
  - "src/app/api/v1/deals/**"
  - "src/app/api/v1/pipelines/**"
  - "src/lib/lead-events/**"
  - "src/components/lead-events/**"
  - "src/hooks/use-lead-events*"
  - "src/components/inbox/painel/seletor-funil-etapa.tsx"
  - "src/lib/dashboard/**"
  - "src/components/dashboard/**"
  - "src/components/valor/**"
  - "src/lib/valor/**"
  - "src/app/*/dashboard/**"
---

# Funil (quadro, negócio, etapa, card) — regras

Vale no quadro Kanban e na página do Funil, em `src/lib/pipelines/` e
`src/lib/deals/`, no roteador de entrada (`pipeline-routing.ts`: etapa de
entrada, título, guarda de grupo), na trilha do lead (`lead-events`), no seletor de funil/etapa
do painel da conversa, no Painel (dashboard) e nas rotas v1 de negócios e
funis. As métricas (Lista, Desempenho, Saúde, Meta Ads) estão em
`.claude/rules/funil-metricas.md`; a recarga ao voltar para o app, em
`.claude/rules/ao-voltar.md`; as automações que movem card (alvo, card fixado,
`create_deal`), em `.claude/rules/automacoes.md`; o SQL dos gatilhos, em
`.claude/rules/supabase.md`. O texto antigo, com a história, está em
`git show f5879b3f:CLAUDE.md`.

### Funil-com-conversas: o card do Kanban ABRE A CONVERSA, não o negócio

`cartao.ts`, `campos-do-card.ts`, `retorno.ts` (puros, testados) e
`src/lib/inbox/url.ts`. Editar o negócio é o lápis do card.

- ⚠️ **A conversa do CONTATO manda; `deals.conversation_id` é só fallback**
  (`conversaDoCard`; o link "ver conversa" do `deal-form` segue a MESMA regra).
  Invertido, trocar o contato do negócio deixava o card com a cara do novo e o
  clique abrindo a conversa do antigo — o vínculo só é escrito no NASCIMENTO.
  O fallback cobre contato apagado e o plano B do select. Pino: `cartao.test.ts`.
- ⚠️ **`deal-card.tsx` é NOSSO inteiro** (num merge, fica o nosso): wrapper +
  botão do corpo (abre a conversa) + lápis IRMÃO (button aninhado é inválido),
  campos por `CamposDoCard`, etiquetas/última mensagem/não lidas, `memo` com
  canais por prop, barra de cor com `pointer-events-none`.
- ⚠️ **O quadro carrega em DUAS etapas** (o porquê está em `DEAL_SELECT_ENXUTO`,
  `cartao.ts`): a lista ENXUTA de todos os cards e o conteúdo só dos que as
  colunas desenham, por id e só do funil aberto. Na junção (`juntarConteudo`)
  os campos da lista enxuta VENCEM; campo lido de TODOS os cards (indicador,
  soma, filtro) vai no select enxuto, porque no conteúdo ele só existe para os
  desenhados; o plano B só liga com a RECUSA do embed (`RECUSA_DO_EMBED`),
  nunca com rede fora ou 5xx. Um merge que traga a busca única do upstream
  devolve a lentidão do funil grande.
- **`DEAL_SELECT_DO_QUADRO` é separado do `CONVERSATION_SELECT`** (que é
  contrato da API v1 — ver `.claude/rules/inbox-lista.md`). Embed recusado cai
  no `DEAL_SELECT_BASICO` (lembrado em flag de módulo: a recusa é persistente);
  a falha do PRÓPRIO plano B vira toast + lista vazia, nunca quadro "vazio" com
  cara de funil sem negócio. `contact.tags` fica AUSENTE no plano B — fabricar
  `[]` afirmaria "sem etiquetas" sobre dado não carregado.
- **O retorno de rolagem EXPIRA (10 min), não é apagado no consumo**
  (`retorno.ts`): apagar antes dos rAF perdia a restauração, e ir-e-voltar duas
  vezes teleportava para o topo. A restauração mora no BOARD, com `aplicadoRef`
  marcado DENTRO do rAF (StrictMode), cleanup cancelando os rAF e `scrollTo`
  com `behavior: "instant"` (o `.pipeline-scroll` é `smooth`). O `quadroRef`
  nasce na PÁGINA: o link "ver conversa" do formulário grava o mesmo retorno
  (props `origemFunil`/`aoIrParaConversa` do `DealForm`; o painel do inbox não
  as passa).
- **Sem realtime no quadro, por desenho**: não lidas e última mensagem são foto
  da carga. Os canais são buscados UMA vez no board (`useChannels` no card
  custava um GET por card) e o `DealCard` é `memo` com handlers `useCallback`
  — prop nova instável volta a redesenhar o quadro inteiro a cada tecla.
- **O deep link para o inbox** (`?etapa=`, `?de=funil`, `urlDoInbox`,
  `recorteDeEtapaConfiavel`, o filtro semeado que morre com a jornada) está em
  `.claude/rules/inbox-lista.md`. Na página do funil, `?vista=` e `?funil=`
  são porta de ENTRADA, lidas uma vez na montagem; o voltar do construtor de
  automações (`voltaDoConstrutor`, pino `url.test.ts`) está em
  `.claude/rules/automacoes.md`.
- **Trechos nossos no quadro e na página** (lista completa em
  `docs/MERGE-UPSTREAM.md`): o raio com contador no cabeçalho da coluna e a
  carga das automações de funil, o botão de conversas por coluna,
  `navegarParaInbox` com a restauração de rolagem, `useChannels` içado e o
  popover de campos; no `PipelineSettings`, degrau (975) e resultado (950) por
  etapa e os avisos de conexão que usa o funil ou a etapa.

### Concorrência do quadro: leituras, arrastos e formulários

O quadro não tem realtime, e toda tela que grava negócio parte de uma foto.
Pinos: `src/lib/celular/ao-voltar.test.ts`, `cartao.test.ts`
(`movidosParaALeitura`, `juntarConteudo`) e
`src/components/pipelines/rascunho-dos-formularios.test.ts`.

- ⚠️ **`refreshDeals` (depois de salvar, da lista e do arrasto recusado) e
  `refreshStages` (Gerenciar funil) descartam a resposta de funil que já não
  está aberto** — senão trocar de funil logo depois de salvar punha os cards
  (ou as etapas) do anterior no quadro do novo. É cerca de FUNIL, não de
  versão, de propósito: o preenchimento do conteúdo (`carregarConteudo`)
  avança a versão, e uma cerca de versão descartaria o refresh que desfaz o
  arrasto recusado pelo banco.
- ⚠️⚠️ **No mesmo funil, nenhuma leitura de negócios grava por cima de outra
  pedida DEPOIS dela**: `refreshDeals` e a carga do funil tomam um número
  (`pedidoDosNegociosRef`), e a régua é a última que GRAVOU
  (`ultimoGravadoRef`). Nunca "só o último PEDIDO grava": a leitura que falha
  não grava, e aquela régua calaria a mais velha — inclusive a carga do funil
  novo.
- ⚠️⚠️ **`gravarNegocios` mantém etapa e status da TELA dos cards arrastados
  que a leitura pode não ter lido** (`movidosRef`, regra pura em
  `movidosParaALeitura`): arrasto ainda não confirmado, ou confirmado depois de
  a leitura partir. Sem isso, a resposta velha devolvia o card à coluna
  antiga. O arrasto marca o card no gesto e na confirmação, e desmarca na
  recusa, antes do `refreshDeals` que o devolve à etapa do banco.
- **`refreshDeals` que FALHA não grava nada** (gravar a lista vazia esvaziava
  todas as colunas).
- ⚠️ **O `DealForm` só zera o rascunho numa sessão NOVA** (`sessaoRef`: abrir,
  ou outro negócio) e compara o salvamento com o negócio do INÍCIO da sessão
  (`dealDaSessaoRef`), nunca com a prop: a recarga da volta ao app troca
  `stages` e apagava o que tinha sido digitado.
- ⚠️ **Ao EDITAR, o `DealForm` só manda funil e etapa se o operador os
  mudou**: regravar a etapa de um card que outro operador ou uma automação já
  moveu o levava de volta — disparando as automações da etapa antiga. Na
  criação o payload inteiro vai.
- ⚠️⚠️ **O `PipelineSettings` busca etapas e nome no BANCO a cada abertura**
  (efeito de `[open, pipeline.id]`; `aberturaRef` numera a abertura; a leitura
  espera a gravação ainda no ar, `gravacaoRef`; "Salvar"/"Adicionar"
  desabilitados até chegar). Chave de sessão sobre as props falhou três vezes;
  ler do banco elimina a classe. Nunca voltar a semear o diálogo pelas props —
  a versão do upstream semeia, e num merge fica a nossa.

### Etapa com RESULTADO (950/1031): quem carimba ganho/perdido é o BANCO

`pipeline_stages.resultado` ('ganho' | 'perdido' | null) + gatilho BEFORE em
`deals`: ENTRAR numa etapa marcada grava o status, para os seis escritores de
etapa (painel da conversa, arrasto, lista do funil, formulário, RPC das
automações, API).

- ⚠️ **GANHO que sai para etapa neutra CONTINUA ganho** (decisão do operador:
  fechou → transfere para o funil do jurídico → segue ganho). Não "corrigir"
  para o modelo Kommo.
- ⚠️⚠️ **PERDIDO que entra em etapa neutra VOLTA ABERTO** (1031, decisão do
  operador, 21/09/2026): o lead desqualificado pode voltar a ser qualificado.
  Só quando o update não trocou o status (`OLD` e `NEW` = `lost`) e com a
  etapa achada. ⚠️ O gatilho não distingue "não mexeu no status" de "mandou
  'lost' de novo": PATCH v1 com `status: 'lost'` + etapa neutra sobre card já
  perdido volta aberto (está na doc da API).
- ⚠️ **Etapa IGUAL não passa pelo gatilho** — e é o caso comum: o card perdido
  pelo BOTÃO fica na etapa. Por isso a RPC das automações
  (`cb_atualizar_negocio`) reabre o perdido que o "Mover card" leva a etapa
  neutra — inclusive a mesma — com um CASE DENTRO do UPDATE, e só escreve se o
  card continua no status esperado (`p_status_esperado`). ⚠️ Nunca ler o
  status no motor e mandar `p_status: 'open'` depois: um ganho marcado no meio
  seria sobrescrito. Quem é o card-alvo (ganho nunca é alvo; contato com card
  ganho não tem o perdido puxado) e o card fixado na execução estão em
  `.claude/rules/automacoes.md`.
- **Etapa marcada VENCE status explícito no mesmo update**; o Reabrir muda só o
  status (sem tocar a etapa) e o gatilho passa reto — de propósito.
- ⚠️ **`src/lib/pipelines/resultado.ts` é ESPELHO do gatilho**
  (`statusAoEntrarNaEtapa`, que recebe só o status de antes): mudou a regra,
  muda nos dois. Pino: `resultado.test.ts`, que lê o SQL da 1031. Ele é só o
  palpite OTIMISTA: quadro e lista gravam com `.select('id, status')` e trocam
  o palpite pelo status que o BANCO gravou; o painel da conversa usa direto o
  do banco.
- Ganho/perdido **não some com nada**: o card fica na coluna (selo), a conversa
  fica intocada; sai das métricas de aberto e entra em "Ganhos no mês".

### O TÍTULO DO CARD é o NOME da pessoa, e acompanha a ficha (1007–1009)

`src/lib/deals/titulo-do-card.ts` (puro), `deals.titulo_fixado_em` e o gatilho
`cb_titulo_do_card_segue_a_ficha` em `contacts`.

- ⚠️ **O título nasce com o NOME e nada mais** (`routeContactToPipeline`), sem
  prefixo de conexão (decisão do operador, 19/09/2026): a conexão aparece na
  pílula do card. Sem nome na ficha, o nome já é o telefone.
- ⚠️⚠️ **Quem mantém o título em dia é o GATILHO, nunca código**:
  `contacts.name` tem escritores demais para espelhar em TS.
- ⚠️⚠️ **Mas ele NÃO segue a ficha sempre — a exceção é o coração da
  feature.** Título que ainda é o telefone é trocado por qualquer nome de
  verdade; título que já identifica alguém só muda com nome ESCOLHIDO
  (`nome_fixado_em`: Calendly, Asaas, gente digitando). Seguir cegamente
  rebaixava o nome do contrato para o apelido do perfil.
- ⚠️ **`deals.titulo_fixado_em` é gravada por quem DIGITA o título** (lápis do
  card via `escritaDoTituloManual`, POST e PATCH da v1), **só quando o título
  MUDOU**: o formulário reenvia tudo, e regravar congelaria o card que ninguém
  batizou (ou devolveria o título antigo, fixado). O `payload` comum do
  `deal-form` NÃO carrega `title`. Pino default-deny:
  `titulo-do-card.chamadores.test.ts` — todo escritor de `deals.title` declara
  se FIXA, DERIVA ou RESPEITA.
- ⚠️ **O Calendly vence o título escrito à mão** (decisão do operador,
  19/09/2026): `renomearCardAberto` não olha a marca. "Consertar" isso reverte
  a decisão.
- **Só o card ABERTO mais recente é renomeado**; o alvo é escolhido ANTES de
  olhar a marca (recente fixado + antigo solto = nada muda).
- **Renomear não deixa rastro**: UPDATE só de `title` não dispara a trilha nem
  a fila do funil (as duas são `AFTER UPDATE OF pipeline_id, stage_id,
  status`); o `set_updated_at` dispara.
- ⚠️⚠️ **"Novo contato" (`TITULO_SEM_NOME`) NÃO é nome** (1008): é a reserva
  do card que nasce sem nome nenhum (a coluna é NOT NULL), e sem o caso
  especial o gatilho o leria como "já identifica alguém" e o card ficaria
  assim para sempre. O texto vive em DOIS lugares (a constante TS e a
  comparação no gatilho), com pino nos dois
  (`supabase/migrations/titulo-do-card-1007.test.ts`); trocá-lo exige
  migration nova.
- ⚠️ **No passo `create_deal`, título LITERAL do autor nasce FIXADO; com `{{…}}`
  ou vazio fica solto**: o literal é texto escolhido para todo card daquela
  automação; o interpolado deriva da pessoa e tem de acompanhar a ficha.
- ⚠️ **No Instagram, o chamador cai no `@usuario`** (`persistir.ts`, via
  `identidadeDoContato`): a ficha de lá não tem telefone de reserva.
- **A ficha criada pelo Asaas nasce com o nome FIXADO** (decisão do operador,
  19/09/2026) — só as de `vinculo_origem = 'criada'` e com `nome_fixado_em`
  nula.

### Negócio só nasce por `createDeal` (908/910)

`src/lib/deals/create-deal.ts`, no servidor: o roteador de entrada
(`pipeline-routing.ts`), o passo `create_deal` e a v1 passam por ele. O
formulário da tela de Funis é a exceção (roda no cliente, sob RLS).
`createDeal` devolve a linha inserida (`deal`, de onde a v1 serializa) e aceita
`tituloFixadoEm`.

- **A etapa de entrada é explícita (`default_stage_id`), nunca
  `MIN(position)`**: por posição o cliente cai numa faixa de estacionamento
  ("Contato Avulso", "Desqualificado") — e com negócio parado lá,
  `deals_stage_pipeline_fkey` (NO ACTION) trava reestruturar a etapa.
- **As FKs de `deals` são COMPOSTAS** (`(pipeline_id, account_id)`,
  `(stage_id, pipeline_id)`, `(channel_id, account_id)`,
  `(conversation_id, account_id)`): a ingestão roda em service role e ignora
  RLS, e FK simples só garante "existe um id".
- **`deals.user_id` é anulável com `ON DELETE SET NULL`**: os cards
  automáticos são do dono da conta, e CASCADE apagaria o funil se ele saísse
  do `auth.users`.
- **`deals.contact_id` é NULLABLE**, e `routeContactToPipeline` depende disso:
  sem o `if (!contactId)`, conversa de grupo criaria card órfão, em branco no
  Kanban.
- **O roteador dispara por ESTADO** ("este contato já tem card?"), não por
  evento: `first_inbound_message` é por conversa, e cliente que muda de número
  nunca dispararia. Quem chama o roteador (só os caminhos de gente) está em
  `.claude/rules/ingestao.md`. Abrir conversa não cria negócio (decisão do
  operador): o card nasce no primeiro envio.
- ⚠️ **Um card por contato é regra de CÓDIGO**: o índice único da 911 é
  parcial (`source = 'channel'`), então `create_deal` e a v1 conferem antes do
  insert (a v1 responde 409 `contact_already_has_deal`).
- **`deals.channel_id` é do NASCIMENTO do card** ("por qual número o cliente
  chegou"), não de onde ele está. Negócio criado à mão fica com a coluna nula
  e some de qualquer recorte por canal.
- **`deals.conversation_id` só é escrito no nascimento** (910); a FK composta
  tem `ON DELETE SET NULL (conversation_id)` — com NO ACTION, apagar contato e
  remover membro estouravam — e já barra conversa de outra conta.
- **Apagar funil ou etapa mexe em conexão**: `cb_channels.default_pipeline_id`
  e `default_stage_id` zeram por SET NULL e o roteamento para em silêncio. A
  tela de Funis avisa (`channelsUsingPipeline`/`channelsUsingStage`, em
  `display.ts`); outro caminho de exclusão tem de avisar também.
- **Transferência de funil é UM UPDATE** (`pipeline_id` + `stage_id` juntos,
  como o `deal-form` faz): em dois, a trilha — escrita por gatilho; o app
  nunca grava em `cb_lead_events` — conta que o lead saiu e voltou.

### Funil: o que é de ADMIN (981)

- ⚠️⚠️ **"Gerenciar funil" SOME para quem não é admin** (esconder, não
  desabilitar): as policies de `pipelines`/`pipeline_stages` exigem admin, e
  RLS que barra escrita devolve 0 linhas sem erro — o atendente renomeava a
  etapa, via a mudança e a achava intacta no reload.
- ⚠️ **Lista, Desempenho e Saúde são de admin** (`canViewReports`), e a barra
  de abas some quando sobra uma. É recorte de TELA, não barreira (`deals` e
  `cb_lead_events` são legíveis por qualquer membro). O Kanban continua de
  `agent`.
- ⚠️ **A aba vigente é resolvida no RENDER** (`vistaVigente`, `vistas.ts`, pino
  `vistas.test.ts`), nunca guardada por efeito: a lente "Ver como" troca o
  papel com a tela montada, e uma aba proibida sobreviveria até o efeito.

### Painel (dashboard): o filtro por canal é PARCIAL

`src/lib/dashboard/queries.ts` e `metric-card.tsx` (`accountWideNote`). Sob
filtro de canal, o cartão que o recorte não alcança diz "Conta inteira"
(contato não tem `channel_id`), e o de negócios diz "Originados neste número"
(`deals.channel_id` é do nascimento). Sem a ressalva, qualquer um dos dois é
lido como "isto é do Comercial".
