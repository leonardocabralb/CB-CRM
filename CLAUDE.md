@AGENTS.md

# CLAUDE.md — Convenções do projeto CB CRM

Regras "load-bearing" — coisas que já causaram (ou causariam) bug/drift e que
Claude precisa respeitar em qualquer máquina/sessão. Não é changelog nem doc de
feature: só entra aqui o que, se ignorado, quebra algo.

> **Este arquivo descreve o estado *intencional* do projeto e fica stale
> conforme o código muda. Antes de decidir com base em algo aqui, confirme
> contra a realidade (grep, leitura do arquivo, query no banco). Ao achar
> divergência, atualize o CLAUDE.md no mesmo PR. Nota mentindo é pior que
> ausência de nota.**

## O que é este projeto

Fork do CRM open source **wacrm** (`ArnasDon/wacrm`) — um CRM de WhatsApp
(Next.js 16 + Supabase + Meta Cloud API) com inbox compartilhado, contatos,
pipelines, broadcasts, automações e assistente de IA.

Estamos moldando este fork para uso interno do **CB Advogados**: um sistema de
**gestão de WhatsApp** com **integrações próprias**, adaptado às necessidades do
escritório. Partimos do código open source e construímos nossas customizações
por cima, continuando a receber melhorias e correções de bugs do original.

## Como trabalhar

- **Sempre planejar antes de agir.** Para qualquer tarefa não-trivial, expor o
  plano (passos, arquivos, riscos) antes de tocar em código. Pequenas dúvidas?
  Pergunte; não deduza.
- **Nunca deduzir nada.** Se faltar informação (rota, schema, regra de negócio,
  intenção), pergunte ou verifique no código/banco. Não inferir requisitos a
  partir de nome de variável ou contexto vago.
- **Trabalhar sempre numa branch derivada de `main`, nunca commitar direto no
  `main`.** No CB-CRM o `main` é o nosso trunk (não é mais espelho do upstream).
  Ver seção "Fork + upstream".
- **Caminho mais simples que cumpre o objetivo.** Sem overengineering: nada de
  abstração para futuro hipotético, nada de fallback para cenário impossível,
  nada de helper de uma chamada só. Três linhas parecidas > abstração prematura.
- **Preferir arquivos/módulos novos a reescrever o core.** Customização isolada
  reduz conflito futuro com o upstream (ver seção Fork + upstream).
- **Revisar 2x ao finalizar.** Antes de declarar pronto: (1) bugs/edge cases
  óbvios; (2) consistência com convenções do projeto e com o objetivo original.
  Reportar achados, mesmo que seja "nada encontrado".
- **Ações destrutivas exigem confirmação explícita.** Nunca executar sem o
  operador autorizar com clareza naquela conversa: `git push --force`,
  `reset --hard`, `branch -D`, `rm -rf`, `DROP TABLE`, `TRUNCATE`, `DELETE` sem
  `WHERE`, deletar arquivo/migration aplicada, sobrescrever credenciais, **push
  no `upstream`**. Aprovar uma vez ≠ aprovar para sempre.
- **Ao pedir confirmação destrutiva, explicar impacto em linguagem clara e
  não-técnica.** Traduzir o que acontece no mundo real: o que se perde, o que
  pode quebrar, se dá pra desfazer e como.
- **Subagentes em tarefas complexas → modelo forte.** Planejamento/revisão de
  escopo amplo → passar o modelo mais capaz. Pesquisa simples pode ficar no padrão.

## Estrutura

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Postgres + Auth + Storage + RLS) · Meta Cloud API.

- `src/app/` — rotas do App Router. `(auth)` e `(dashboard)` são route groups;
  `api/` são as rotas de servidor (webhook do WhatsApp, cron de automações, API
  pública `/api/v1`). ⚠️ **É Next.js 16 com breaking changes** — ler o guia em
  `node_modules/next/dist/docs/` antes de escrever código (ver `AGENTS.md`).
- `src/lib/` — lógica de negócio por domínio (`whatsapp`, `webhooks`, `inbox`,
  `automations`, `flows`, `broadcast`, `contacts`, `ai`, `account`, `auth`,
  `api`, `api-keys`, `storage`, `supabase`, `dashboard`). É aqui que a maior
  parte das nossas integrações próprias deve viver, em módulos novos.
- `src/components/`, `src/hooks/`, `src/i18n/`, `src/types/` — UI, hooks, i18n e
  tipos compartilhados.
- `supabase/migrations/` — migrations SQL (ver seção própria). ⚠️ **Passou a
  existir um `supabase/config.toml`** (veio do upstream #498, junto com
  `.github/workflows/migrations.yml` e `supabase/ci/verify-schema.sql`): ele
  serve ao CI que replaya as migrations contra um Postgres limpo. **A CLI
  continua não-linkada** — o `config.toml` não muda a regra de nunca usar
  `supabase db push` (ver seção de migrations).
- `messages/` — dicionários i18n: `en.json` (referência), `pt-BR.json` (o que o
  app usa hoje) e `ko.json` (veio do upstream, não usamos). Ver seção "i18n".
- `mcp-server/` — subprojeto separado (tem `package.json` próprio) que expõe o
  CRM via MCP. Rodar `npm` dentro dele, não na raiz.
- `docs/` — `mcp.md`, `public-api.md`. A doc completa de self-host vive em
  `wacrm.tech/docs` (repo separado `ArnasDon/wacrm-site`).
- `.env.local` — segredos (Supabase URL/keys, `META_APP_SECRET`,
  `ENCRYPTION_KEY`). Gitignored; **nunca commitar**. Modelo em
  `.env.local.example`.

## Fork + upstream (remotes e branches)

| Remote     | Aponta para                | Papel                                          |
| ---------- | -------------------------- | ---------------------------------------------- |
| `origin`   | `leonardocabralb/CB-CRM`   | Nosso repositório — para onde fazemos **push** e **PRs** |
| `upstream` | `ArnasDon/wacrm`           | Original — de onde só **puxamos** (read-only). **Nunca push. Nunca PR.** |

| Branch  | Função                                                                             |
| ------- | ---------------------------------------------------------------------------------- |
| `main`  | **Nosso trunk.** Contém todas as customizações do CB Advogados. É de onde saem as branches e para onde elas voltam. (Fica no `origin`/CB-CRM.) |

> **Regras de ouro (inegociáveis):**
>
> 1. **PRs só para o CB-CRM.** É **estritamente proibido** abrir Pull Request
>    para qualquer branch do repositório `ArnasDon/wacrm` (upstream). Todo e
>    qualquer PR tem como alvo **apenas** branches do `leonardocabralb/CB-CRM`.
> 2. **Branches novas saem só de `main`.** A criação de branch de
>    desenvolvimento ocorre **única e exclusivamente a partir de `main`**, dentro
>    do CB-CRM — nunca de outra branch, nunca do upstream.

Este é um **fork definitivo**: `main` deixou de ser espelho do upstream e passou
a ser o nosso trunk. Ainda incorporamos correções e melhorias do original, mas
por **merge pontual** (abaixo), não por espelhamento.

**Puxar atualizações do original** (o upstream muda `messages/en.json` e às vezes
o core, então trate como merge com conflito, não fast-forward):

```bash
git fetch upstream                        # busca novidades (não altera nada)
git checkout main && git pull origin main
git checkout -b chore/merge-upstream-AAAA-MM-DD   # branch de integração, a partir de main
git merge upstream/main                   # conflitos esperados (resolver)

node scripts/i18n-parity.mjs              # ⚠️ OBRIGATÓRIO — ver abaixo
npm run typecheck && npm run test

git checkout main
git merge chore/merge-upstream-AAAA-MM-DD  # traz o merge já resolvido e testado
git push origin main
```

⚠️ **Rodar `scripts/i18n-parity.mjs` depois de todo merge do upstream.** Se o
upstream adicionou chave nova em `messages/en.json`, ela **precisa** entrar no
`pt-BR.json` no mesmo merge: o fallback do next-intl é por arquivo, não por
chave, então chave faltando vira `MISSING_MESSAGE` e aparece crua na tela do
usuário. O script sai com código 1 nesse caso. Ele reporta erro de parse ICU
apenas como *aviso* — de propósito, porque isso quase nunca é bug de verdade
(ver seção i18n).

Conflitos só ocorrem quando o original e nós editamos **a mesma linha do mesmo
arquivo** — por isso preferir módulos novos a reescrever o core.

**Onde já divergimos do upstream** (checar a cada merge com
`git diff --stat upstream/main main`): `messages/en.json` é o campo de
batalha — o upstream mexe nele a cada feature e nós temos tradução por cima.
Também são nossos: `messages/pt-BR.json`, `CLAUDE.md`, `.gitignore`,
`scripts/`, as migrations `037_evolution_transport.sql`, `900_cb_*` e
`901`/`902`/`903_cb_*`, a **integração Evolution API** (`src/lib/whatsapp/transport/`,
`src/app/api/whatsapp/evolution/`, `src/components/settings/evolution-connect.tsx`,
`src/lib/whatsapp/inbound-store.ts`), o **multi-canal** (`src/lib/cb-channels/`,
`src/app/api/cb/`, `src/components/settings/cb-channels-panel.tsx`), a **infra de
deploy** (`Dockerfile`, `docker-stack.yml`, `.github/workflows/pipeline.yml`,
`docs/DEPLOY-VPS.md`) e os componentes que internacionalizamos (o upstream tem
string literal onde nós temos `t('chave')` — ao resolver, manter a nossa forma e
levar o texto novo dele para os **dois** dicionários).

**Decisões fixadas no merge de 2026-08-26** (releia antes do próximo merge, são
as que voltam a conflitar):

- **`resolveTemplateRow` (`src/lib/whatsapp/template-body.ts`) ganhou um 5º
  parâmetro nosso, `channelId`.** O catálogo da Meta é POR WABA. A versão do
  upstream busca só por `(account_id, name)`; sem o recorte, numa conta com dois
  números o atendente vê o preview de um modelo e o cliente recebe outro. Os
  **5** call sites passam o canal — conferir todos a cada merge.
- **Guarda de papel: adotamos o `requireRole` deles nas 5 rotas que ambos
  cobriam** (`send`, `react`, `broadcast`, `templates/submit`, `templates/sync`),
  com os mesmos níveis. O nosso `barrarPorPapel` **continua** nas 2 rotas que só
  nós cobrimos: `whatsapp/config` e `whatsapp/templates/[id]`. Se um merge
  futuro trouxer a versão deles crua nessas duas, um `viewer` volta a
  reconfigurar a conexão.
- **`src/components/inbox/message-bubble.tsx` e `message-thread.tsx` ficam
  NOSSOS, inteiros.** O visualizador de mídia do upstream (#467) foi descartado:
  o nosso `media-viewer.tsx` tem giro e zoom, que a versão deles não tem. Os
  arquivos `media-lightbox.tsx`, `message-media.tsx` e `lib/media/*` vieram no
  merge mas **não estão ligados** — se um merge futuro os religar, o inbox passa
  a ter dois visualizadores.
- ⚠️ **Uma major de Node só, e ela mora no `.nvmrc` (hoje `22`, o LTS).**
  Chegaram a existir TRÊS ao mesmo tempo — dev 24, CI 20, produção 22 — e isso
  já custou um vermelho real: o PR #66 passou na máquina do dev e reprovou no
  CI em `formatCurrencyShort`, porque cada V8 resolvia `notation: 'compact'`
  de um jeito (`R$ 900` vs `R$ 900,0`). Teste que toque **Intl, fuso ou
  colação** é loteria quando as majors divergem. Quem mexer nisso:
  - O CI **não escreve o número**: `node-version-file: .nvmrc`. Um merge do
    upstream traz o `node-version: <n>` cravado de volta — **trocar de novo
    pelo `node-version-file`**, senão o CI volta a poder divergir sozinho.
  - **Sobra um número duplicado, e é inevitável**: o `ARG NODE_VERSION` do
    `Dockerfile`. `FROM` não lê arquivo do contexto de build, então produção
    não tem como derivar do `.nvmrc`. Mudou um, muda o outro.
  - `engines` (raiz **e** `mcp-server/`) é `>=22.12.0` — piso **derivado**, não
    escolhido: `vite` e `rolldown` exigem `^20.19.0 || >=22.12.0`, e o ramo do
    20 caiu. Não baixar sem conferir os `engines` das dependências.
  - `packageManager: npm@10.9.9` é a linha de npm que o Node 22 embarca. Subir
    a major do Node sem subir esse pin volta a descasar CI e Dependabot.
  - Máquina nova: `nvm use` na raiz. Quem usa **asdf** precisa de
    `legacy_version_file = yes` no `~/.asdfrc` para ele respeitar o `.nvmrc`.

- ⚠️ **Um workflow só: `.github/workflows/pipeline.yml`.** O `ci.yml` e o
  `migrations.yml` eram DO UPSTREAM e foram removidos; as três etapas
  (verificar → migrations → deploy) viraram jobs de um arquivo nosso, com o
  `deploy` dependendo de `verificar`. Antes os três rodavam **em paralelo** no
  push do `main`, e o cabeçalho do deploy dizia "after CI passes" sem que
  existisse `needs:` — um CI vermelho não impedia a publicação. **Todo merge do
  upstream vai trazer `ci.yml` e `migrations.yml` de volta: apagar de novo**, ou
  as etapas passam a rodar duas vezes por push.
  ⚠️ **O replay de migrations NÃO segura o deploy**, e o próprio
  `pipeline.yml` diz isso por escrito ("SINAL, não portão"): `deploy` tem
  `needs: [verificar]` e mais nada. Migration vermelha no `main` PUBLICA
  assim mesmo — medido em 2026-08-31, revisando o trem de PRs do dia
  anterior. Esta seção afirmava "com as duas etapas verdes"; era mentira, e
  mentira do tipo que faz alguém confiar num portão que não existe.

- **`src/i18n/messages.test.ts` checa `pt-BR`, não `ko`.** O upstream o escreveu
  para `ko`, que não servimos; deixar assim daria um teste permanentemente
  vermelho sobre um idioma que ninguém usa. Ao mesclar, ele volta com `['ko']`.

⚠️ **Vários arquivos do upstream ganharam mudanças NOSSAS para o multi-canal —
cuidado no merge.** Ao mesclar upstream, manter os nossos trechos e não deixar o
upstream sobrescrevê-los:

| Arquivo do upstream | O que é nosso |
| --- | --- |
| `src/lib/whatsapp/send-message.ts` | resolve o canal, carimba `channel_id`, devolve `channelId` no resultado, busca o template **filtrando por canal**, e os dois parâmetros da agendada (925): `channelId` (exige aquele canal, **falha fechada**) e `pauseFlows` |
| `src/components/inbox/message-composer.tsx` | o **acervo** no menu do clipe (953) e o botão de **gravar voz** fora dele, à direita da caixa — um merge que traga o menu do upstream cru devolve a gravação para dentro do menu e some com o acervo. Mais a anotação interna (918) e o **agendamento** (925): o relógio abre um seletor, e com hora escolhida o `handleSend` DESVIA antes da janela de desfazer. Mais a 932: `sendDraft` desvia igual (anexo agendado), o seletor virou `<SeletorDeHorario>` de módulo — reusado dentro do `MediaDraftPreview`, que SUBSTITUI o compositor — e `entreguesRef` impede a limpeza de desmonte de apagar arquivo que já é de uma agendada. Mais o item **Executar automação** no menu + (955), atrás da prop opcional `onExecutarAutomacao` — o dialog mora no FIO, não aqui |
| `src/lib/whatsapp/send-message.ts` (2ª linha nossa) | a 932 separou `evolution_rejected` (4xx: a Evolution recusou, nada saiu) de `evolution_error` (tempo esgotado/5xx: pode ter saído). Só o segundo vira `entrega_incerta` |
| `src/lib/whatsapp/send-message.ts` (3ª linha nossa) | `media_filename` no INSERT (969) — o `filename` já chegava na função e ia só para o WhatsApp; sem ele a bolha do que NÓS enviamos cai no rótulo genérico |
| `src/app/api/whatsapp/webhook/route.ts` (2ª linha nossa) | `mediaFilename` no tipo de retorno da extração, no `empty`, no case `document` e no upsert (969). ⚠️ O `contentText` continua `caption \|\| filename` — não "simplificar" removendo o filename de lá: a lista de conversas e a busca já leem essa coluna há meses |
| `src/components/inbox/message-bubble.tsx` (além de ser nosso inteiro) | o case `document` usa `mediaFilename(message)` e mostra a legenda embaixo só quando ela DIFERE do nome; `nomeDeArquivo` delega para a cascata em vez de derivar o basename cru |
| `src/components/inbox/message-bubble.tsx` (canal, 2026-09-02) | a prop `canal` (nome + cor) no lugar do antigo `channelLabel`: o rótulo embaixo da mensagem ganhou a bolinha da cor, 10px (era 9) e teto de 9rem (era 7). ⚠️ Uma versão desta nota dizia que em 7rem os nomes truncavam "no ponto em que ainda são iguais" — MEDIDO em 02/09: os seis nomes da conta cabem em 7rem até a 10px (o mais longo, "Trabalhista - Comercial", dá 110px); o 9rem é folga, não conserto. A cor vive na BOLINHA, não no texto: a bolha da equipe é `bg-primary`, violeta nesta conta. Uma trilha de 3px na borda foi feita e DESCARTADA pelo operador na hora ("não gostei dessa borda colorida") |
| `src/components/inbox/message-thread.tsx` | além do fio intercalado, renderiza a faixa `ScheduledBar` logo acima do compositor e guarda o contador que a liga ao compositor |
| `src/components/inbox/message-thread.tsx` (rolagem, 2026-09-01) | ⚠️ `coladoNoFimRef` + `onScroll` guardam o auto-scroll, e o spinner só entra quando a CONVERSA muda (`conversaCarregadaRef`). Sem os dois, voltar de uma aba nova — o `visibilitychange` incrementa o `resyncToken` — perdia a posição de quem lia o histórico E o empurrava para o fim, três vezes por retorno (mensagens, eventos e notas chegam em buscas próprias). O `saltoAtivoRef` NÃO cobre isso: é armado só pelo salto da busca, e `liberarSalto` está no `onWheel`, então rolar à mão o DESLIGA. A guarda é re-armada em `publicarMensagemOtimista` e ao acrescentar nota — senão o autor manda e não vê |
| `src/app/api/whatsapp/webhook/route.ts` | carimba `channel_id` na entrada; varre `cb_channels` na verificação (GET); escopa o ACK por canal; passa `channelId` a flows/automações/IA |
| `src/lib/whatsapp/inbound-store.ts` | idem, no lado Evolution |
| `src/lib/automations/engine.ts` | `channelInScope`, condição `channel`, canal de saída por passo, e o `create_deal` que virou chamada a `createDeal` com a checagem "um card por contato" ANTES do insert — o índice da 911 é parcial (`source = 'channel'`) e não barra o insert da automação, então sem a checagem nasce card duplicado. Mais o `rotuloDoDisparo` opcional de `runAutomationById` (955): a execução manual da conversa grava `'manual'` no log — sem ele, o registro diria que outra automação chamou |
| `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts` (×2) e `src/lib/whatsapp/send-message.ts` | a chamada a `routeContactToPipeline`. ⚠️ São **QUATRO** call sites: os dois de ingestão (não há função compartilhada de abrir conversa — enxertar só num faz a feature valer só num transporte, e produção roda Evolution), o `persistDeviceMessage` do celular pareado e o núcleo de envio. Ver "Quem abre negócio" abaixo |
| `src/lib/whatsapp/inbound-store.ts` (`persistDeviceMessage`) | o `followConversationChannel` que aponta a conversa para o número por onde a EQUIPE falou. Sem ele a conversa nasce com `channel_id` nulo e o CRM responde pelo canal PADRÃO — o advogado aborda pelo Jurídico e o sistema responderia pelo Comercial |
| `src/lib/flows/engine.ts` | `findEntryFlow` por canal, `flow_runs.channel_id`, try/catch nos nós interativos, e o parâmetro opcional `substituicao` de `startFlowForContact` (955): o start manual carimba a run substituída como gente (`stopped_by_agent`/`replaced_by_agent`), não como regra |
| `src/lib/ai/{auto-reply,config,knowledge,usage}.ts` | agente por canal, interruptor, RAG por canal |
| `src/lib/whatsapp/broadcast-core.ts` + rotas de template | `resolveMetaChannel` no lugar do espelho |
| `src/lib/api/v1/conversations.ts`, `src/lib/api-keys/scopes.ts` | `channel_id` nos serializers, escopo `channels:read` |
| `src/components/automations/automation-builder.tsx`, `src/components/flows/{flow-builder,flow-editor-state}.tsx` | escopo de canal editável (multi-select / select), canais no contexto do editor, validação de canal no cliente |
| páginas de `automations`, `flows`, `broadcasts`, `dashboard` | etiqueta e filtro de canal, coluna de canal nos históricos, filtro do painel |
| `src/components/broadcasts/step{1,4}-*.tsx`, `src/hooks/use-broadcast-sending.ts` | canal escolhido no passo 1, `channel_id` no corpo da API e na linha de `broadcasts` |
| `src/components/settings/template-manager.tsx` | seletor de WABA para criar/sincronizar, etiqueta de canal por modelo |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx` | canal no primeiro contato e a seção/aba **Histórico** (912). (A linha "canal da conversa" que o painel do inbox exibia foi REMOVIDA em 2026-08-29 a pedido do operador — o seletor do cabeçalho do fio já responde isso.) No detail view a `TabsList` ganhou `flex-wrap` com a altura **prefixada** (`group-data-horizontal/tabs:h-auto` + `[&>button]:h-auto`, NUNCA `h-auto` cru — ver a armadilha do tailwind-merge abaixo; um merge que "simplifique" para `h-auto` quebra a tela de novo) — com 5 abas ela já estourava a largura do painel e escondia "Negócios" |
| `src/components/inbox/message-thread.tsx` | `groupMessagesByDate` virou `groupTimelineByDate`, sobre mensagens **e** eventos do lead intercalados (`intercalar`), e o laço de render passou a ramificar em `item.evento` |
| `src/components/inbox/conversation-list.tsx` | ⚠️ **praticamente reescrito** (924): todo o recorte saiu para `src/lib/inbox/filtros.ts`, a barra de filtros virou `<InboxFilters>`, e cada linha ganhou a estrela de favoritar. Num merge do upstream, esperar conflito grande e **manter a nossa versão**, levando só o que for novo dele. Mais o `onTermoDeBusca`, que espelha o termo assentado para a página. Mais o menu de **filtros salvos** (967/968): o hook, os catálogos que dão nome aos ids, o `limparOrfaos` do aplicar e a semente do filtro padrão |
| `src/components/inbox/message-thread.tsx` (canal, 2026-09-02) | o `SeparadorDeCanal` entre trechos, a faixa de divergência colada no compositor, a bolinha de cor no gatilho e nos itens do seletor de canal, e o `Fragment` que embrulha separador + `LinhaDaMensagem` (a `key` mudou de lugar) |
| `src/components/inbox/message-thread.tsx` | o **salto da busca**: `<LinhaDaMensagem>` envolvendo as duas formas de bolha (a comum e o aviso de sistema do grupo), a faixa "2 de 5" com ↑/↓, os efeitos de centralizar/suprimir e o `saltoAtivoRef` |
| `src/components/inbox/conversation-list.tsx` (canal, 2026-09-02) | a prop `corDoCanalDaLinha` do `ConversationItem` e a bolinha antes do nome — bolinha, e não trilha, porque a borda esquerda já é da seleção |
| `src/app/(dashboard)/inbox/page.tsx` | espelha o termo da busca da lista para o fio — são irmãos, e a página é o único caminho entre eles. Mais o escritor da presença por conversa (963): `useMarcarConversaAberta(activeConversation?.id)` — a página é a dona da seleção |
| `src/components/inbox/message-thread.tsx` (955/963) | monta o `<ExecutarAutomacaoDialog>` (é o fio que tem o contato; o canal passado é `conversation.channel_id ?? null` — o PR #74 trocou o `activeChannel` resolvido pelo cru DE PROPÓSITO, para a checagem de escopo da rota falhar aberta igual ao motor em conversa sem canal; grupo fica de fora) e os avatares `<AvataresNaConversa>` no cabeçalho, alimentados por `useQuemVeAConversa` |
| `src/components/inbox/message-thread.tsx` (#84) | a **janela de 24h**: a regra saiu para `src/lib/inbox/janela-24h.ts` (puro, com teste) e os TRÊS caminhos de envio (texto, mídia, interativa) passam por `janelaFechadaAgora()` antes do `fetch` — o portão lê o RELÓGIO no disparo, nunca `sessionInfo.expired` (que é `useMemo` em `[messages]` e não recomputa com o passar das horas). Um merge que traga o `sessionInfo` inline do upstream devolve os três buracos de uma vez |
| `src/lib/dashboard/queries.ts`, `src/components/dashboard/metric-card.tsx` | filtro por canal (parcial) e marca "conta inteira" |
| `src/app/api/automations/[id]/duplicate/route.ts` | copia `channel_ids` (sem isso a cópia vira irrestrita) |
| `src/app/api/cb/channels/[id]/route.ts` (DELETE) | barra a exclusão quando há agendada na FILA e limpa o acervo — a FK da 925 é RESTRICT |
| `src/components/pipelines/pipeline-board.tsx`, `src/app/(dashboard)/pipelines/page.tsx` | o painel por etapa (Fase 5): o raio com contador no cabeçalho da coluna e a carga das automações de funil. Mais o funil-com-conversas (PR #71): botão de conversas por coluna, `navegarParaInbox`/restauração de rolagem no board (quadroRef vem da página), `useChannels` içado, select `DEAL_SELECT_DO_QUADRO` com plano B, popover de campos |
| `src/components/pipelines/deal-card.tsx` | ⚠️ **reestruturado inteiro no PR #71 — manter a NOSSA versão** (como `conversation-list.tsx`): wrapper + botão do corpo (abre a CONVERSA) + lápis IRMÃO (edita; button aninhado é inválido), campos por `CamposDoCard`, etiquetas/última mensagem/não lidas, `memo` + canais por prop, barra de cor com `pointer-events-none` |
| `src/components/pipelines/deal-form.tsx` | além do que a linha antiga já dizia: o link "ver conversa" prefere a conversa do CONTATO (fallback no vínculo da 910), usa `urlDoInbox` e as props `origemFunil`/`aoIrParaConversa` da jornada do funil |
| `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/conversation-list.tsx`, `inbox-filters.tsx` | os params `?etapa=` (semeia o filtro de etapa UMA vez) e `?de=funil` (faixa "Voltar ao funil") — os `router.replace` usam `urlDoInbox`, que preserva `de` e derruba `etapa` DE PROPÓSITO; na lista, `etapaInicial` + `etapasResolvidas` e o recorte de etapa gateado por `etapasUsaveis`; nos filtros, o fallback da pastilha virou `labelStage` (era "Qualquer etapa" sobre filtro ativo) |
| `src/app/(dashboard)/automations/new/page.tsx` | o `?stage=` que faz a automação nascer com o gatilho de funil já apontando para a etapa clicada |
| `src/lib/automations/trigger-meta.ts` | `formatRelative` passou a usar `Intl.RelativeTimeFormat` e a receber o texto de "nunca" — devolvia `5m ago`/`never` em inglês nas três telas |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx`, `src/app/(dashboard)/notifications/page.tsx`, `src/components/layout/{sidebar,header}.tsx`, `src/app/(dashboard)/contacts/page.tsx`, `src/lib/rate-limit.ts` | as tarefas (944): 7ª aba na ficha (com `[&>button]:flex-none` na TabsList), seção na barra da conversa, ícones/navegação dos tipos `task_*` no sino (o `TYPE_ICON` é exaustivo — merge que trouxer tipo novo sem ícone quebra o typecheck), item "Tarefas" com etiqueta realtime no menu, deep link `?contact=`, bucket `tarefa` |
| `src/lib/ai/types.ts`, `generate.ts`, `defaults.ts`, `config.ts`, `usage.ts`, `providers/` | o TERCEIRO provedor (`gemini`, 941) e o modo `'radar'` no log de uso — o upstream conhece só openai/anthropic. `structured.ts` e `providers/gemini.ts` são arquivos NOSSOS |
| `src/components/settings/ai-config.tsx`, `src/app/api/ai/config/route.ts` | a opção Gemini no seletor e na validação do provider |
| `src/components/settings/cb-channels-panel.tsx`, `src/app/api/cb/channels/[id]/route.ts`, `src/lib/cb-channels/repo.ts` | o toggle `radar_enabled` por canal (dialog, PATCH allowlist e SAFE_COLUMNS) |
| `src/components/layout/sidebar.tsx`, `header.tsx`, `src/middleware.ts` | a aba `/radar` (item de navegação, título do cabeçalho e rota protegida) |
| `src/lib/api-keys/scopes.ts`, `docs/public-api.md`, `src/components/settings/api-keys-settings.tsx` | os doze escopos das features do fork (tarefas/agendadas/negócios/reuniões/anotações/campos personalizados) e a rolagem da lista no diálogo — o upstream tem só os 8 originais |
| `src/lib/deals/create-deal.ts` | devolve `deal` (a linha inserida), não só `ok/created` — a rota v1 serializa a resposta a partir dele |
| `src/components/settings/settings-sections.ts`, `settings-chip.tsx`, `src/app/(dashboard)/settings/page.tsx` | a seção `integracoes` no rail e a variante `err` (vermelha) do chip |
| `src/lib/ai/types.ts`, `config.ts`, `structured.ts`, `defaults.ts`, `src/lib/cb-radar/worker.ts`, `src/app/api/ai/config/route.ts` | o modelo do Radar separado do modelo de chat (946): `radarModel` no tipo e em `CONFIG_COLUMNS`, o parâmetro `model` do `generateStructured`, `AI_PROVIDER_MODELS`, e a validação do modelo do Radar no save |
| `src/components/settings/ai-config.tsx` | `<datalist>` de sugestão no campo Modelo e a frase de escopo com link para Integrações |

⚠️ **Qual NÚMERO nesta conversa: o critério é a CONVERSA, nunca a conta.**
`src/lib/inbox/canais-do-fio.ts` e `src/lib/cb-channels/cores.ts` (puros, com
teste), o `SeparadorDeCanal` e a faixa de divergência em `message-thread.tsx`,
o rótulo com bolinha embaixo da mensagem e a bolinha da linha da lista.
Nasceu de uma medição: em
produção, **4 das 228** conversas correm por mais de um número (2 delas
grupos), e o rótulo de canal acendia em TODAS. O que morde código novo:

- ⚠️⚠️ **GRUPO FICA DE FORA, e não é conservadorismo — lá o carimbo NÃO é
  escolha do cliente.** Com os dois números dentro do mesmo grupo, o WhatsApp
  entrega a mensagem às duas instâncias Evolution, o
  `UNIQUE (conversation_id, message_id)` descarta a segunda, e o `channel_id`
  gravado é o do webhook que CHEGOU PRIMEIRO. Medido no grupo `f68d7fe3`: 14
  mensagens "Comercial" e 15 "Jurídico" alternando por corrida de rede.
  Pintar isso afirmaria uma escolha que ninguém fez. Em grupo quem responde
  "por qual número" é `cb_groups.channel_id`, e só no cabeçalho.
- ⚠️ **O gatilho é `fioMulticanal`, não `channels.length >= 2`.** O critério
  antigo era a CONTA: o rótulo cinza de 9px aparecia em 98% das conversas,
  onde não informa nada, e por isso o olho aprendia a ignorá-lo justamente
  nos 4 casos que decidem a resposta. Presente demais é o mesmo que ausente.
  (Uma versão desta nota culpava o truncamento em 7rem; medido em 02/09, os
  nomes cabiam — o defeito era a onipresença, não a largura.)
- ⚠️⚠️ **A cor sai da ordem de `created_at`, calculada DENTRO de
  `coresPorCanal` — nunca do índice do array recebido.** `listChannels`
  ordena `is_default DESC, created_at ASC`: sem o sort próprio, marcar outra
  conexão como padrão a joga para a frente e **repinta todas as conversas do
  escritório de uma vez**. Não estoura em lugar nenhum e passa em revisão.
  Conexão nova entra no fim e não mexe em ninguém; apagar uma recolore as
  posteriores (aceito — apagar canal já anula o `channel_id` das mensagens).
- ⚠️ **As classes da paleta são LITERAIS** (`'bg-violet-500'`), nunca
  interpoladas: o Tailwind varre o fonte atrás de strings e não executa
  código, então `bg-${cor}-500` simplesmente não é gerada e a bolinha
  nasce transparente, sem erro nenhum. Há teste com regex cobrando a forma.
- ⚠️ **Mensagem SEM carimbo não abre nem fecha trecho de canal.** São 117
  conversas com histórico anterior ao multi-canal (mais o acervo do canal
  apagado, cujo `channel_id` foi anulado): tratá-las como trecho próprio
  desenharia um separador que não tem nome para escrever, e atribuí-las ao
  canal vizinho seria inventar.
- ⚠️ **A cor vive na BOLINHA em toda parte; texto colorido só no separador.**
  A bolha da equipe é `bg-primary` (violeta nesta conta): nome na cor do
  canal ficaria ilegível justamente no canal violeta, e o mesmo rótulo
  teria contraste diferente conforme o lado do fio. A bolinha se sustenta
  sobre qualquer fundo. Na LISTA a razão é outra e se soma: a borda esquerda
  da linha já é da SELEÇÃO (`border-l-2 border-primary` no botão), e uma
  trilha ali disputaria a faixa. Na lista o canal sai de `canalDaConversa()`,
  nunca de `conversation.channel_id`: em grupo aquela coluna é sempre nula.
- ⚠️ **A faixa de divergência cala com `canalDeSaida` nulo, e esse é o gate
  de carregamento.** `activeChannel` só resolve depois do `useChannels`, e um
  aviso montado sobre lista vazia nomearia a divergência errada — mesma
  família da badge "Expirada" que piscava no cabeçalho (2026-08-31).
- ⚠️⚠️ **A faixa só aparece com a conversa FIXADA (`channel_pinned`).**
  Solta, a conversa SEGUE o cliente: o `inbound-store` carimba a mensagem e
  só depois atualiza a conversa, em duas escritas, e o realtime entrega
  nessa ordem — a mensagem no número B está na tela enquanto `activeChannel`
  ainda é A. Divergência sem pino é trânsito (corrige-se em milissegundos)
  ou `follow` que falhou (raro; a próxima mensagem conserta). A faixa ali
  PISCARIA a cada troca legítima, e o botão, clicado nesse instante, fixaria
  B e desligaria o seguimento em silêncio (achado do Codex no PR #105). Com
  pino a divergência é permanente e escolhida — toda resposta cai noutra
  conversa no celular do cliente — e é para ela que a faixa existe. Não
  exige `fioMulticanal`: fixada em A com o cliente só em B, o fio tem UM
  canal. O botão re-fixa no número do cliente; "Automático" no menu solta.
- ⚠️ **A mensagem otimista nasce carimbada com o canal da tela, e a rota
  `/api/whatsapp/send` devolve `channel_id`** (o núcleo já o devolvia; a
  rota descartava). Sem os dois, em conversa mista a resposta enviada por B
  nascia sem carimbo e ficava desenhada no trecho de A até o realtime trocar
  a bolha — e realtime atrasado a deixava lá (Codex, PR #105). Quem criar
  um 5º caminho de envio repete os dois: o carimbo na otimista e o
  `marcarEnviada` com o `channel_id` da resposta.
- **Informativo, não bloqueante** (decisão do operador, 2026-09-02): com 2
  casos em 90 conversas, confirmar a cada envio custaria um clique em toda
  conversa mista para prevenir um erro que a faixa já torna visível.
- **A cor é DERIVADA, não configurável.** Se um dia o operador quiser mandar
  nela, o lugar é uma coluna `cor` em `cb_channels` com queda para
  `PALETA_DE_CANAIS` — e aí entra no `CB_CHANNEL_SAFE_COLUMNS`, senão salva e
  some no reload.
- **O gatilho do seletor do cabeçalho trocou o ícone de transporte pela
  bolinha da cor** (o transporte segue no menu): numa conta 100% Evolution
  aquele ícone é o mesmo em todas as linhas e não informa nada, enquanto a
  cor é o que amarra o cabeçalho aos rótulos das bolhas.

⚠️ **A visão "Automações" do funil (grade estilo Kommo) é desenho de dado, não
tela nova.** `src/lib/automations/grade-do-funil.ts` e
`descrever-passo.ts` (puros, com teste), `por-etapa.ts` (a classificação),
`src/components/pipelines/automations-board.tsx`. Quem for mexer em recorte de
automação por etapa mexe nos módulos, não dentro do componente.

⚠️ **A LARGURA DO CARTÃO É O `trigger_config.stage_ids`.** "Expandir" grava
mais etapas; sem etapa nenhuma o cartão atravessa o quadro. Não há coluna de
banco para isso e não deve haver. O que morde código novo:

- ⚠️ **Automação com `trigger_config.stage_ids` VAZIO dispara em TODA etapa**
  (`engine.ts`, `triggerMatches`). Uma tela que listasse só quem NOMEIA a
  coluna diria "nada acontece nesta etapa" enquanto o motor dispara a cada
  card que entra. É o cartão de largura total, em roxo.
- ⚠️ **Etapas NÃO vizinhas viram VÁRIOS cartões.** Um retângulo da coluna 1
  até a 3 afirmaria que a regra vale na 2 — e ela não vale. Cada trecho
  contínuo é um cartão, e os dois carregam o aviso "também vale em outras
  etapas", senão parecem automações diferentes.
- ⚠️ **`descrever-passo.ts` devolve CHAVE + valores, nunca texto pronto**, e há
  teste lendo `messages/*.json` que COBRA uma chave por tipo de passo. Sem
  ele, adicionar um passo ao motor sem tocar no dicionário põe
  `Pipelines.automacoes.resumo.send_x`, cru, dentro do cartão — o fallback do
  next-intl é por arquivo, não por chave.
- **Id órfão vira "(apagado)", nunca o UUID**: impresso, o operador o lê como
  se fosse o nome da tag.
- **A consulta de automações NÃO filtra por funil**, de propósito: a regra
  irrestrita vale para toda etapa de todo funil, e filtrar a esconderia.
- ⚠️ **São DUAS listas de etapa com significados opostos**, e trocá-las é o
  erro fácil: `trigger_config.stage_ids` é "para qual etapa o card tem de
  ENTRAR"; `automations.stage_ids` é "em qual etapa o contato precisa ESTAR"
  (o escopo). O gatilho alcançar a etapa e o escopo barrá-la é estado
  alcançável pela tela — trocar o tipo de gatilho para "mudou de etapa"
  esconde o seletor de escopo mas **não limpa o valor**. Daí o grupo "Nunca
  dispara aqui": ligada, configurada e incapaz de rodar.
- ⚠️ **Criar pela grade preenche só o GATILHO, nunca o escopo.** Preencher os
  dois funciona hoje e vira armadilha amanhã — é exatamente como se fabrica
  uma automação morta.
- **A etiqueta do raio conta só o que dispara E está LIGADO.** Contar a pausada
  põe um número numa coluna onde nada acontece, e o operador vai caçar defeito
  no motor.
- **Há teste comparando `classificarNaEtapa` com o `triggerMatches` de
  verdade**, importado do `engine.ts`. Se a regra do motor mudar, ele quebra.

⚠️ **Mensagem agendada (925/926): NADA dispara sozinho.** A tabela guarda a
linha; quem a transforma em mensagem é um agendador EXTERNO batendo em
`/api/cb/scheduled/cron`. Sem ele, `cb_scheduled_messages` só enche — o mesmo
destino de `broadcasts.scheduled_at`, viva e sem leitor desde a 001. O que
morde código novo:

- **Agendar não passa pela janela de desfazer.** Ela tem três saídas que
  disparam na hora (trocar de conversa, desmontar, Enter de novo); um "modo"
  pendurado no botão Enviar mandaria em 3s a mensagem marcada para amanhã. O
  desvio é a primeira coisa do `handleSend`, antes de qualquer `setPendente`.
- **`failed` NÃO quer dizer "não saiu".** `db_error` e tempo esgotado da
  Evolution estouram DEPOIS de o WhatsApp aceitar — daí `entrega_incerta`
  (926). Nada reenvia a partir dela nem de `sending`: retentar manda duas
  vezes ao cliente. Quem criar outro caminho de reenvio precisa da mesma
  guarda (`podeDispararAgora`).
- **O canal é FIXADO no agendamento e falha fechado.** O núcleo degrada em
  silêncio para o padrão da conta, e numa agendada isso é a mensagem saindo
  pelo número errado, de madrugada, sem ninguém na tela.
- ⚠️ **Grupo lê `cb_groups.channel_id`**, nunca `conversations.channel_id`,
  que é sempre NULO ali — a mesma armadilha do recorte por canal.
- **Guarda de atraso de 1h no worker.** Agendador dias fora do ar + conserto
  despejaria a fila inteira de uma vez, às 2 da manhã. Passado o prazo a linha
  vira `failed` com o motivo escrito e espera decisão de gente.

⚠️ **Agendada com ANEXO e CITAÇÃO (932): tudo aqui existe porque passam HORAS
entre escrever e enviar.** `src/lib/scheduled/midia.ts` (puro, com teste),
`dispatch.ts`, a rota `api/cb/scheduled` e
`src/components/scheduled/anexo-e-citacao.tsx`. O que morde código novo:

- ⚠️ **Áudio NÃO leva legenda, e o dano é silencioso.** A nota de voz sai por
  `message/sendWhatsAppAudio`, que não tem campo de legenda: um texto ali
  seria gravado em `messages.content_text`, apareceria no fio para a equipe e
  **não viajaria**. A regra está em três lugares de propósito (CHECK da 932,
  rota, tela).
- ⚠️ **O arquivo é conferido ANTES de reivindicar a linha.** Reivindicar põe em
  `sending`, o estado do qual nada pode ser reenviado — a linha ficaria presa
  até o recolhimento de 10 min e sairia como "entrega incerta", que seria
  mentira. E **Storage fora do ar não conta como "sumiu"**: falso negativo
  cancelaria uma mensagem perfeita.
- ⚠️⚠️ **`storage.exists()` devolve `data: false` E `error` PREENCHIDO quando o
  objeto não existe** — os dois juntos, porque o 400/404 do HEAD vira
  `StorageError` e volta com a resposta. Ler o `error` primeiro faz a função
  responder "existe" para todo arquivo sumido, que é o único caso para o qual
  ela serve. Já foi cometido, e só a medição em produção pegou: o teste
  passava porque o stub imitava a forma SUPOSTA. **Quem usar `exists()` em
  código novo confere `data === false` antes do `error`.** ⚠️ E a SEGUNDA
  metade (revisão 48h): a forma resolvida `{data:false, error}` só existe
  para 400/404 — **qualquer outra falha (5xx, rede) é LANÇADA** (`throw
  error` no storage-js). Sem try/catch, o ramo "Storage fora do ar" fica
  inalcançável e o blip vira 500: código novo precisa das DUAS defesas,
  como `anexoAindaExiste` (dispatch) e a rota do acervo fazem.
- ⚠️ **A URL do anexo é DERIVADA do caminho (`getPublicUrl`), nunca aceita do
  cliente.** Aceitando-a, a conferência de posse olha um campo (`media_path`) e
  o envio usa outro (`media_url`), sem nada amarrando os dois — dá para casar
  um caminho legítimo da conta com uma URL de fora e o CRM entrega aquilo ao
  cliente.
- ⚠️ **Cancelar apaga o objeto do bucket — MENOS quando há `message_id`.** O
  teste é a coluna, não o status, e as duas vêm do RETORNO do `delete`: a lista
  da tela é uma foto de segundos atrás, e entre a carga e o clique o worker
  pode ter enviado. Com `message_id` preenchido o arquivo já é da mensagem que
  está no fio do cliente.
- ⚠️ **`reply_to_message_id` não tem FK**, e as três formas foram descartadas
  com motivo na migration (`RESTRICT` faria apagar mensagem falhar, `CASCADE`
  apagaria a agendada, `SET NULL` apagaria a informação de que houve citação).
  Preço: **sem FK o PostgREST não embute** — quem precisar da citada busca por
  id (`useCitadas`), e precisa do sinalizador de "já carregou", senão a tela
  avisa "citação apagada" sobre citação viva.
- ⚠️ **Apagar mensagem aqui é apagar MOLE**, então o núcleo citaria alegremente
  o que o cliente vê como "Esta mensagem foi apagada". Quem enviar citação em
  código novo precisa checar `deleted_at` — `send-message.ts` não checa.
- **O teto da legenda é 1024 MENOS a assinatura**, e a validação do
  agendamento não é garantia: a assinatura pode ser ligada depois, ou quem
  agendou sai da conta e passa a assinar o nome do escritório. Por isso o
  núcleo revalida e o disparador **traduz** — `SendMessageError.message` é
  escrito em inglês e cai cru na coluna que as duas telas mostram.

⚠️ **Execuções na conversa (955) e presença por conversa (963).** Aba
"Automações" no painel da conversa (robô ativo + esperas, com Parar e linha
do tempo), item "Executar automação" no menu + do compositor, e avatares de
quem mais está com a conversa aberta. `src/lib/execucoes/` e
`src/lib/presenca-na-conversa.ts` (puros, com teste), rotas em
`/api/cb/execucoes`, hooks `use-execucoes-do-contato` e
`use-conversa-aberta`. O que morde código novo:

- ⚠️ **As duas fontes da aba têm naturezas DIFERENTES, de propósito.**
  `flow_runs` é lido direto sob RLS e tem realtime (010); as esperas vêm da
  rota GET porque `automation_pending_executions` é service-role only desde
  a 006 — **não abrir policy de SELECT** para ganhar o que a rota já dá. Sem
  realtime nas esperas, a aba recarrega por ação e pelo evento global
  `cb:execucoes-mudaram` (o dialog Executar vive em outra árvore).
- ⚠️ **Parar espelha o motor, nunca inventa caminho novo**: esperas viram
  `cancelled` com as MESMAS cercas do passo `stop_automation`
  (automação+conta+**contato**+`status='pending'` — sem o contato, pararia a
  conta inteira); robô encerra por `abortActiveRunsForContact` com
  `stopped_by_agent` (955) — TERCEIRO status, pessoa que DECIDIU, distinto de
  `paused_by_agent` (pessoa respondeu) e `stopped_by_automation` (regra).
- ⚠️ **A rota `executar` checa os DOIS escopos (canal E etapa); o motor NÃO.**
  `runAutomationById` pula recortes de propósito (chamador explícito), mas
  "explícito" aqui é um clique — automação restrita ao número A executada na
  conversa do número B sairia pelo número errado. As duas checagens têm
  direções DIFERENTES, e isso é deliberado: a de CANAL falha ABERTA como o
  motor (conversa sem canal deixa passar); a de ETAPA (`stageInScope`,
  acrescentada no PR #74) mistura as duas com motivo — ERRO de consulta
  deixa passar (ignorância), mas contato SEM NEGÓCIO leva 422
  `stage_out_of_scope` (não é ignorância: sem card, ele não está em etapa
  nenhuma — `engine.ts`). Uma versão desta nota dizia "falha ABERTA" para a
  rota inteira e não mencionava a etapa (M16 do plano de 31/08). Grupo é recusado
  (automação não roda em grupo, 906) e o log ganha `trigger_event='manual'`.
- **Linha do tempo da expansão**: futuros são os passos do MESMO escopo da
  espera (`parent_step_id`+`branch`, de `next_step_position` em diante);
  condição aparece como "depende da condição" e os passos DENTRO dos ramos
  ficam FORA — afirmar um ramo seria o cartão da grade mentindo de novo.
  Rótulos por `descreverPasso` (`Pipelines.automacoes.resumo.*`, uma chave
  por tipo, cobrada por teste).
- **`cb_conversa_aberta` é clone deliberado da `member_presence` (024)**,
  tabela NOSSA: escrita SÓ pela RPC `cb_marcar_conversa_aberta` (conta do
  profile, conversa validada contra a conta — fora vira NULL em silêncio),
  leitura por membro, realtime SEM lista de colunas. "Saiu" é staleness com
  o MESMO limiar do roster (`OFFLINE_AFTER_MS`, 75s) — limiar próprio faria
  bolinha e avatar discordarem sobre a mesma pessoa. O escritor serializa as
  RPCs numa fila (troca rápida de conversa não pode deixar a resposta
  atrasada vencer a intenção nova).
- **Conta de UM membro**: a presença fica dormente em produção até o convite
  real — testada em 2026-08-30 com usuária fixture (criada e removida).

⚠️ **Acervo de mídias (953): enviar do acervo COPIA o arquivo.** Tabela
`cb_media_library`, `src/lib/acervo/` (puro, com teste), rotas em
`/api/cb/acervo`, painel em Configurações → Acervo e o seletor
`acervo-picker.tsx` no clipe do compositor. O que morde código novo:

- ⚠️⚠️ **A rota `copiar` existe para não destruir o arquivo do escritório.**
  O compositor APAGA o objeto do bucket quando o envio falha ou o rascunho é
  descartado (`deleteAccountMedia`), e cancelar uma agendada apaga também
  (932). Enviando por referência, um envio falho de um estagiário levaria
  junto o contrato-padrão de todo mundo — e ninguém ligaria uma coisa à
  outra. Medido na tela: descartar o rascunho apaga a CÓPIA (400) e o
  original do acervo segue de pé (200). O segundo motivo é jurídico: o que
  FOI ENVIADO não pode mudar quando alguém troca o item.
- ⚠️⚠️ **A guarda de papel do acervo mora em DUAS camadas (954).** A rota
  exige admin para apagar, mas as policies de Storage da 023 conferiam só o
  primeiro segmento do caminho: qualquer membro — `viewer` incluso — podia
  chamar `storage.remove()` do navegador e apagar o arquivo do escritório, ou
  dar UPDATE e TROCAR o conteúdo mantendo o nome, sem nada mudar na tela. O
  `media_path` não é segredo: a policy de SELECT da 953 o mostra a todo mundo.
  A 954 reescreveu INSERT/UPDATE/DELETE do `chat-media` com "não está em
  `acervo/` OU é admin". ⚠️ Usa `IS DISTINCT FROM`, e não `<>`: em anexo comum
  a segunda pasta é NULA, e com `<>` a expressão viraria NULL, a policy
  reprovaria e ninguém mais apagaria rascunho descartado. Quem criar outra
  subpasta com regra própria repete o par (rota + policy).
- ⚠️ **É o bucket `chat-media` de sempre, na subpasta `acervo/`.** As policies
  da 020/023 casam só o PRIMEIRO segmento do caminho, então aninhar é de
  graça — e a subpasta é o que permite distinguir "arquivo do escritório" de
  "anexo de mensagem" numa varredura futura de órfãos. Quem criar bucket novo
  herda uma segunda RLS e uma segunda lista de mimes para manter em sincronia.
- ⚠️ **`MIMES_POR_TIPO` (`lib/acervo/tipos.ts`) é ESPELHO da
  `allowed_mime_types` da 023.** Alargar só no código faz o upload falhar no
  Storage com "erro de upload"; alargar só na migration faz a tela recusar
  arquivo que o WhatsApp aceita. Os dois, sempre.
- ⚠️ **Toda escrita passa pela API** (sem policy de INSERT/UPDATE/DELETE, com
  REVOKE): o papel é conferido lá (admin+ monta o acervo), `media_url` é
  DERIVADA do caminho no servidor (aceitá-la do cliente casaria caminho
  legítimo com URL de fora — lição da 932) e o caminho é exigido sob
  `account-<conta>/acervo/`. LER é direto sob RLS.
- ⚠️ **`storage.exists()` de novo**: a rota lê SÓ o `r.data` do resultado
  resolvido (objeto ausente resolve com `data: false` E `error` preenchido —
  ler o `error` como falha responderia "existe" para todo arquivo sumido) e
  envolve a chamada em try/catch, porque falha que não é 400/404 é LANÇADA
  pelo storage-js — Storage fora do ar não é "sumiu". O #74 reescreveu a
  conferência nessa forma; uma versão desta nota descrevia a forma antiga
  ("`data === false` antes do `error`") e ensinava a repeti-la.
- **`categoria` é texto livre**, não tabela de pastas, e NULL = "Geral" (que a
  tela põe no fim). O conjunto real é meia dúzia de rótulos.
- **Trocar o ARQUIVO de um item não existe**: o item mudaria de conteúdo sem
  mudar de nome e ninguém na equipe saberia. Trocar é apagar e cadastrar.
- **Áudio do acervo sai como NOTA DE VOZ** — é o mesmo caminho do gravador
  (`sendWhatsAppAudio`, PTT na Evolution). O seletor diz isso na linha do
  item, senão o operador manda "um arquivo" e o cliente recebe voz.

⚠️ **Campo personalizado SALVA SOZINHO — não existe mais "Salvar campos".**
`src/lib/contacts/salvamento-de-campo.ts` (puro, com teste) e
`src/components/contacts/campo-com-salvamento.tsx`, usado pelas DUAS telas
(painel da conversa e ficha de `/contatos`). O que morde código novo:

- ⚠️⚠️ **O campo só pode ser MONTADO quando os valores já forem do contato
  atual.** O rascunho nasce do `valorSalvo` de montagem e NÃO persegue a prop
  depois — e a limpeza da troca de contato roda num EFEITO, então existe um
  render com o contato NOVO e os valores do ANTERIOR. Medido no navegador:
  sem o portão, o valor do cliente A ficava na ficha do B **nas 35 amostras
  de 3,5s** (não é um piscar — é permanente, porque nada reescreve o
  rascunho), e a primeira edição gravaria aquilo no B. Por isso `customValues`
  guarda o DONO junto (`{ de, mapa }`) nas duas telas e a comparação é contra
  o PROP DO RENDER ATUAL. Achado do Codex no PR #83.
- ⚠️⚠️ **A `key` de quem monta o campo PRECISA incluir o `contact.id`.** Sem
  ela o React reusa a instância ao trocar de cliente, o rascunho de A sobrevive
  sob o cabeçalho de B, e a descarga de desmonte grava no cliente errado — a
  mesma janela que o painel já documentava, agora alcançável sem clicar em
  botão nenhum.
- ⚠️⚠️ **UM campo por gravação, nunca o mapa inteiro.** O botão antigo mandava
  todos de uma vez porque era um gesto só; a cada blur isso seria um envio do
  mapa — e `""` no upsert compartilhado significa DELETE da linha, então
  bastaria um campo ainda não carregado para o blur de OUTRO apagar dado real.
  O gate de `dadosProntos` continua pelo mesmo motivo.
- ⚠️ **Desmontar não dispara `blur`**, então há descarga na limpeza de
  desmonte: sem ela, digitar e trocar de bloco (o menu horizontal da 966),
  fechar o painel ou trocar de aba apagaria o texto — em silêncio, e sem o
  botão para servir de segunda chance. Ela não grava duas vezes porque o
  `enfileirar` da fila compara contra `desejado` (o que já se pediu gravar) e
  descarta o que não mudou — a idempotência mora DENTRO de
  `criarFilaDeGravacao`, não em ref nenhuma do componente. (Uma versão
  anterior desta nota creditava um `salvoRef` que nunca existiu no código.)
- ⚠️⚠️ **Toda gravação passa pela FILA (`criarFilaDeGravacao`), nunca por
  `aoGravar` direto.** Duas requisições concorrentes na mesma linha chegam ao
  banco fora de ordem — mudar uma lista duas vezes rápido, ou
  sair-voltar-editar-sair antes de a primeira voltar — e a ANTIGA chegando por
  último apaga a edição mais nova, em silêncio. A fila serializa, guarda só o
  pendente MAIS NOVO e faz o último valor vencer (mesma classe do `emVoo` das
  favoritas, aqui por campo). ⚠️ Dentro dela, "mudou?" é medido contra o que
  se QUER gravar, não contra o que o banco confirmou: com `salvo` ainda
  antigo durante o voo, desfazer para o valor original seria descartado como
  não-evento e a tela terminaria discordando do banco (pego pelo teste da
  própria fila). Achado do Codex no PR #83. ⚠️ E o ramo de FALHA tem duas
  sutilezas com teste próprio (achados #09/#10 do plano de 31/08): a régua
  `desejado` só reverte para `salvo` quando NÃO há pendente (com pendente,
  reverter engolia o desfazer seguinte), e REJEIÇÃO de `aoGravar` é tratada
  como falha comum — sem o catch, o laço morria com `rodando = true` e o
  campo parava de gravar para sempre, com o spinner aceso.
- ⚠️ **`select` grava na ESCOLHA, o resto no blur** (`gravaAoSair`). O popover
  fecha e não há blur útil para esperar. O campo de DATA fica no blur apesar de
  disparar `change`: ele dispara a cada pedaço digitado, com datas
  intermediárias absurdas — e a 935 lê essa coluna para disparar lembrete.
- ⚠️ **A comparação "mudou?" é APARADA dos dois lados** (`valorMudou`), porque
  o helper grava `v.trim()`. Sem isso, entrar e sair de um campo que a
  automação preencheu com `" 300 "` gravaria `"300"` — uma edição na ficha que
  ninguém fez.
- **Sucesso é discreto (um "Salvo" que some em 2s por campo), erro é ALTO** e
  nomeia o CAMPO e o CLIENTE: com o botão o erro chegava com o operador olhando
  a tela; agora ele já pode estar em outra conversa.
- **Etapa e valor do negócio JÁ salvavam sozinhos** desde a Fase 4/5 do painel
  (`SeletorFunilEtapa` no clique, `ValorInput` no blur) — só os campos
  personalizados dependiam do botão. Quem for "consertar" etapa/valor está
  mexendo em coisa que já funciona.

⚠️ **Blocos de campos personalizados (966): o operador define a ordem, e ela
vale para TODO cliente.** `cb_grupos_de_campos` (nome + posição),
`custom_fields.grupo_id`/`posicao`, o módulo puro `src/lib/contacts/
grupos-de-campos.ts` (testado) e o catálogo com arrastar em
`custom-fields-manager.tsx`. O que morde código novo:

- ⚠️⚠️ **NA FICHA DO CLIENTE SÓ UM BLOCO APARECE POR VEZ**, escolhido num menu
  horizontal de pastilhas. Não é enfeite: é o PONTO da feature. A primeira
  versão empilhava os blocos um sob o outro, o que organizava e não REDUZIA
  nada — os 15 campos continuavam todos na tela, que é exatamente a poluição
  que os blocos existem para resolver. O operador devolveu com o exemplo do
  outro CRM ("a separação e a visualização são feitas por um menu selecionável
  de forma horizontal"). Quem empilhar de novo desfaz a feature inteira.
  ⚠️ O menu SOME com menos de dois blocos (mesma regra do seletor de canal:
  com um bloco só ele não decide nada). E o bloco à vista é resolvido NO
  RENDER (`blocos.find(...) ?? blocos[0]`), nunca guardado por efeito — bloco
  apagado, ou esvaziado, deixaria a seção em branco com uma pastilha acesa.
- ⚠️ **`grupo_id` NULO É o bloco "Geral", e ele vem SEMPRE primeiro.** Não
  existe linha para ele: por isso não é renomeável nem arrastável, e o rótulo
  sai do dicionário (`Contacts.customFields.groupGeneral`), não do banco. Uma
  tela que mostre "Geral" vindo do banco está lendo uma linha que não existe.
  ⚠️ **Ele some quando todo campo está num grupo de verdade SÓ nas telas de
  LEITURA** (`incluirVazios: false` — ficha e painel, onde cabeçalho sem campo
  embaixo não informa nada). **No CATÁLOGO ele fica, mesmo vazio**, e isso é
  load-bearing: o seletor de bloco de cada linha oferece "Geral" SEMPRE, e sem
  o bloco renderizado `moverCampo` não acha o destino, devolve `null` e a tela
  não faz NADA — sem toast, sem erro, sem escrita. Arrastar também precisa do
  bloco na tela, então não havia segunda porta: campo posto num grupo ficava
  preso em grupo para sempre. "Simplificar" para `if (geral.length > 0)`
  parece obviamente certo e mata a volta. (Achado do Codex no PR #78.)
- ⚠️ **`categoria` (949) NÃO é o bloco, e não morreu.** Continua sendo a marca
  SEMÂNTICA "campo técnico": é o que o semeador dos 10 campos escreve e o que
  a API v1 expõe como `category` (dropar a coluna quebra o n8n do gestor).
  `grupo_id` é só ONDE o campo aparece. O seletor de categoria saiu do
  formulário de criação — quem cria campo escolhe BLOCO.
- ⚠️⚠️ **`posicao` É POSIÇÃO DENTRO DO BLOCO, e por isso só quem REAGRUPA pode
  ordenar por ela.** Ela reinicia em cada bloco, então ordenar a conta inteira
  por `posicao` INTERCALA os blocos — todo "1" antes de todo "2" — e devolve
  uma ordem que não é nem alfabética nem a que o operador arrumou. Não estoura
  em lugar nenhum e passa em revisão. São DUAS famílias de consulta, e trocá-las
  é o erro fácil:
  - **Reagrupam** (catálogo, painel da conversa, ficha de contato):
    `.order('posicao', { nullsFirst: false }).order('field_name')`, porque
    `agruparCampos` reparte antes de exibir. `ordenarCampos` é o espelho EXATO
    dessa cláusula — mudar um lado sem o outro faz o arrastar pousar o campo
    num lugar e o próximo carregamento mostrá-lo em outro.
  - **Listas PLANAS** (broadcast ×2, automação, API v1): `.order('field_name')`
    e mais nada. A da v1 é CONTRATO com o integrador (o n8n do gestor lê o
    array). Quem criar consulta plana nova repete esta metade.
  `posicao` NULA cai no FIM de propósito: campo criado por caminho que não a
  carimba (o semeador cria dez de uma vez) nasce no fim do bloco em vez de
  embaralhar a ordem montada. (As duas famílias saíram da revisão do Codex no
  PR #78, que pegou a ordenação global aplicada às quatro listas planas.)
- ⚠️ **Reordenar passa por RPC (`cb_ordenar_campos_personalizados`), nunca por
  `upsert`.** O upsert do PostgREST teria de carregar as quatro colunas NOT
  NULL de `custom_fields` junto (o NOT NULL é conferido ANTES de o Postgres
  decidir pelo ramo do ON CONFLICT — mandar só o id NÃO passa), e aí um
  arrastar pode reescrever o NOME do campo com um valor velho do estado da
  tela. É a mesma armadilha do `/api/ai/config`. As duas RPCs são
  `SECURITY INVOKER`: quem decide é a policy de admin que já existe.
- ⚠️⚠️ **ARRASTAR NÃO PODE SER A ÚNICA PORTA.** A primeira versão só deixava
  mudar um campo de bloco arrastando, e punha o "novo bloco" no RODAPÉ do
  cartão, depois de uma lista de 538px. O operador testou e não achou nenhuma
  das duas coisas ("não achei as possibilidades de criar os grupos" / "nem de
  colocar campos já criados em outros grupos") — metade da funcionalidade
  existia e era invisível. Hoje: o formulário de bloco fica ACIMA da lista, e
  cada linha tem um `<select>` de bloco ao lado da chave. O arrastar continua,
  como atalho de quem já sabe. Vale para qualquer gesto novo nesta tela.
- ⚠️ **`handleDragEnd` normaliza QUALQUER id do bloco para o mesmo destino**
  (`blocoDoAlvo`). Três nós ocupam praticamente a mesma caixa — o bloco
  arrastável, a ÁREA de soltura dentro dele e as linhas de campo — e entre os
  dois primeiros, que têm o MESMO centro, o desempate do `closestCenter` é a
  ordem de registro no `DndContext`, não a geometria. Medido: reordenando
  blocos, o `over` vem SEMPRE como `bloco:<id>`, nunca `grupo:<id>` — a versão
  que exigia o prefixo `grupo:` deixava reordenar bloco 100% quebrado, sem
  erro nenhum no caminho.
- ⚠️ **Alça de arrastar precisa de área de toque, não do tamanho do ícone.**
  A do bloco nasceu `size-3.5` num cabeçalho `py-1`: 14px que o ponteiro erra
  por um pixel, e aí o bloco não é agarrado — sem cursor mudando, sem aviso,
  sem nada a depurar. Hoje é `size-4` com `p-1` (24×24), igual à da linha.
- ⚠️ **O arrastar manda o BLOCO INTEIRO (0..N-1), não só quem se moveu.** As
  posições do banco não são densas — campo novo nasce nulo e o semeador cria
  dez de uma vez —, então reordenar por diferença deixaria buraco que
  reaparece como ordem errada no arrastar seguinte.
- ⚠️ **A aba "Traqueamento" do painel da conversa (o megafone da 949) DEIXOU DE
  EXISTIR**, e com ela as chaves `Inbox.sidebar.tabTracking`/
  `noTrackingFields`/`seedTrackingFields`/`seedDone`/`seedError` e a
  `Contacts.detailView.trackingHeading`. O semeador dos 10 campos padrão
  mudou de casa: agora vive no CATÁLOGO (Configurações → Campos e etiquetas) e
  cria os campos no bloco selecionado no formulário de cima — o botão diz qual,
  porque um lote de dez campos no bloco errado é trabalhoso de desfazer.
- ⚠️ **`ON DELETE SET NULL (grupo_id)`, com a coluna NOMEADA.** `account_id` é
  NOT NULL e faz parte da FK composta; um SET NULL sem lista tentaria zerar as
  duas colunas, e apagar um bloco passaria a estourar violação em vez de
  devolver os campos ao Geral. Medido: apagar o bloco preserva os campos.
- ⚠️ **O botão "Salvar campos" NÃO EXISTE MAIS** — o PR #83 trocou por
  salvamento automático POR CAMPO (blur/escolha + descarga de desmonte; ver a
  seção "Campo personalizado SALVA SOZINHO"). O que resta desta nota é o
  motivo dela: o valor digitado num bloco fora de vista CONTINUA no
  `customValues` e sobrevive à troca de pastilha (medido na tela) — quem um
  dia recriar um save em LOTE precisa resolver antes o que fazer com o que
  ficou escondido, porque perder digitação é pior que gravar digitação.
- **Sem `capitalize` nos rótulos** (nas duas fichas): ele maiusculava cada
  palavra e o operador via "Data De Fechamento Do Contrato" no lugar do nome
  que cadastrou — e estragava os técnicos (`utm_source`), que por isso
  precisavam de uma aba própria.
- **A altura da lista do catálogo é PROP** (`alturaDaLista`). Configurações
  passa `max-h-[min(36rem,60vh)]`; o diálogo da página de Contatos fica nos
  288px porque o `DialogContent` deste projeto **não tem teto de altura** —
  lista alta ali cresce para fora da viewport sem barra que a alcance.

⚠️ **Efeito passivo = o primeiro render mostra o estado VELHO.** Já mordeu
duas vezes em 2026-08-30, nas duas features do dia: a faixa da nota fixada
mostrava a anotação do cliente anterior sob o cabeçalho do novo (o
`useConversationNotes` esvazia num efeito — achado do Codex no PR #64), e o
seletor do acervo dizia "o acervo está vazio" antes de a primeira consulta
sair (`carregando` nasce falso). As duas correções são do mesmo tipo:
comparar contra o PROP do render atual (`conversation_id === conversationId`)
ou esperar um sinalizador de "já carregou uma vez" — nunca confiar em que o
efeito de limpeza já rodou.

⚠️ **A terceira (2026-08-31) é a variante PERIGOSA: lista vazia virando
AFIRMAÇÃO.** `message-thread.tsx` derivava `evolutionActive` de
`useChannels()` sem olhar o `loading` — e enquanto os canais não chegam,
"não é Evolution" era lido como "é Meta, logo a janela de 24h vale". Numa
conta 100% Evolution isso pintava a badge vermelha **"Expirada"** no
cabeçalho por alguns segundos ao abrir CADA conversa e, o dano real,
DESABILITAVA o compositor com "Sessão expirada — use um modelo" no exato
instante em que o operador abre a conversa para responder: as primeiras
teclas iam para o vazio. Reportado da tela pelo operador. A cura é o
sinalizador do próprio hook (`janelaDe24h = !canaisCarregando &&
!evolutionActive`) — `useChannels` expõe `loading` desde sempre, e
`step1-choose-template.tsx` e `template-manager.tsx` já o usavam.
⚠️ **Conta SEM canal nenhum continua na regra da Meta**, de propósito: ali a
lista resolveu vazia, e vazio-COM-resposta é conhecimento, não lacuna. A
distinção entre os dois vazios é a feature inteira.
⚠️ Os outros ~18 consumidores de `useChannels` usam a lista só para
rótulo/filtro, onde vazio-durante-a-carga é cosmético e se corrige sozinho
(é o contrato escrito no cabeçalho do hook). O que torna este caso diferente
— e o teste para código novo — é a lista vazia ser convertida numa
afirmação POSITIVA que desabilita um controle.

⚠️ **A QUARTA (2026-09-01) é a mesma armadilha num painel novo**, e vale como
teste para qualquer aba que receba dado por prop: a aba **Arquivos** afirma
"Nenhum arquivo nesta conversa" quando `messages` vem vazio — e ele vem vazio
DURANTE A CARGA, porque a página zera o array ao trocar de conversa. Numa
conversa com 93 documentos a frase aparecia por ~1s. O fio não sofre disso
porque tem `loading` próprio; **o painel é IRMÃO do fio, não filho, e não
enxerga esse estado**. A cura é a página carimbar de quem é o array
(`messagesDaConversa`) e passar `carregando` — prop OBRIGATÓRIA no
`AbaArquivos`, para o compilador cobrar de quem montar a aba em tela nova.

⚠️ **Nome do anexo (969): o nome SEMPRE chegou, e era descartado na porta.**
`messages.media_filename`, `src/lib/media/filename.ts` (a cascata) e
`src/lib/media/anexos.ts` (o acervo da conversa, puro e testado). O que morde
código novo:

- ⚠️ **`extractText` (`evolution-inbound.ts`) lê só o `caption` do
  `documentMessage`, nunca o `fileName`** — por isso 166 dos 188 documentos
  em produção não tinham nome nenhum e a bolha caía em "Documento". O caminho
  da **Meta** não tem o defeito (`caption || filename`), e produção roda
  **Evolution**: é a divergência de transporte que a doc do `filename.ts`
  afirmava não existir.
- ⚠️ **`fetchAndStoreEvolutionMedia` devolve `EvolutionMediaSalva`, não uma
  string.** `fileName` e `mimetype` chegavam nela e morriam no `return`: o
  nome ia só para o caminho do objeto e `media_type` ficava NULL em 100% das
  linhas do Evolution. São DOIS call sites (webhook e a rota de download de
  mídia de grupo) — os dois gravam as duas colunas.
- ⚠️ **Coluna própria, nunca `content_text`.** Legenda e nome são coisas
  diferentes e um documento pode ter as duas; empilhá-las é o que faz o
  caminho da Meta PERDER o nome quando há legenda. E `content_text` alimenta
  a busca (929) e o transcrito do Radar (941).
- ⚠️ **Nome ausente NÃO sobrescreve com NULL** (`...(filename ? {…} : {})`):
  foto e áudio chegam sem nome, e o UPDATE apagaria o que outro caminho
  gravou.
- ⚠️ **SEM backfill, e o histórico ainda funciona.** `buildMediaPath` põe o
  nome no caminho do objeto (degradado: espaço e acento viram `_`, corte em
  40 chars), e `basenameFromUrl` o recupera — é a 2ª fonte de
  `mediaFilename`. Gravar a versão degradada congelaria a perda no banco e
  apagaria a distinção entre nome verdadeiro e reconstruído.
- ⚠️ **Exibir é `mediaFilename(message)`, nunca `media_filename` cru** — a
  coluna é NULA em toda linha anterior à 969. E a legenda só é mostrada
  quando DIFERE do nome resolvido: nas linhas antigas da Meta o filename está
  DENTRO do `content_text`, e sem a guarda o texto sai duas vezes.
- ⚠️ **Áudio não mostra nome de arquivo.** Nota de voz não tem nome — o
  WhatsApp entrega o id hexadecimal do objeto (`3A0B…oga`), e a lista virava
  trinta linhas de gibberish. Mostra a transcrição (943) quando `pronta`, e
  um rótulo genérico quando não.
- **`gallery.ts` NÃO foi alargado para documento**, de propósito: ele
  alimenta as setas ‹ › do visualizador, que só sabe desenhar imagem e vídeo.

⚠️ **Agenda de reuniões (945, Fase 1): o calendário é a parte fácil.**
`src/lib/agenda/` — `fuso.ts`, `vagas.ts`, `grade.ts` e `validar.ts`, todos
puros e com teste (85 casos); a tela é `/agenda`, e a escrita passa por
`/api/cb/agenda`. O que morde código novo:

- ⚠️ **A SOBREPOSIÇÃO É BARRADA PELO BANCO**, por uma restrição `EXCLUDE
  USING gist` sobre `tstzrange(starts_at, ends_at)` por advogado (exige
  `btree_gist`). Conferir "está livre?" antes de inserir NÃO resolve: entre a
  conferência e a inserção cabe a outra requisição, e é exatamente o que
  acontece com dois operadores marcando ao mesmo tempo. Quem criar outro
  caminho de escrita precisa traduzir o código **`23P01`** numa frase — cru,
  ele chega ao operador como "conflicting key value violates exclusion
  constraint".
- ⚠️ **O `EXCLUDE` ignora `status = 'cancelada'`**, senão desmarcar não
  liberaria o horário. `realizada` e `falta` continuam ocupando: aquele
  horário foi consumido de fato.
- ⚠️ **`cb_availability` guarda `time` + `timezone`, NUNCA `timestamptz`.**
  "Nove da manhã" não é instante: é regra que só vira instante aplicada a um
  dia num fuso. E o fuso **não é validado pelo banco** — `pg_timezone_names` é
  view e CHECK exige IMMUTABLE —, então a validação mora em
  `fusoValido()`. Ela recusa deslocamento fixo (`-03:00`), que o `Intl`
  aceitaria: constante não sabe horário de verão.
- ⚠️ **Mover reunião de dia RECONSTRÓI pela hora de parede**, nunca soma dias
  em milissegundos. Somar preserva o instante, não a hora local — atravessar
  uma virada de horário de verão mudaria a reunião das 14h para 13h sozinha.
  Invisível no Brasil (sem DST desde 2019), real no dia em que houver advogado
  em outro país.
- ⚠️ **`/agenda` no `protectedPaths` cobre `/agendadas` DE GRAÇA** (o teste é
  `startsWith`) — e é por isso que a página pública de auto-agendamento da
  Fase 2 tem de se chamar **`/marcar/<token>`**, nunca `/agendar/<token>`:
  aquela linha mandaria o cliente, que não tem login, para a tela de login.
- **`contact_id` é NULLABLE** e não pode entrar em CHECK de forma: apagar
  contato faz SET NULL, que é UPDATE, e UPDATE revalida CHECK — exigir o
  contato faria a exclusão de contato falhar (lição da 912).
- **A tela LÊ direto sob RLS; a escrita passa pela rota**, como em `cb_tasks`.
  A rota carimba `autor_nome`/`owner_nome` e confere o responsável contra a
  conta — `auth.users` é global, então a FK sozinha não impede marcar reunião
  na agenda de alguém de outro escritório.
- **Fora da v1, por decisão:** recorrência. Reunião que repete é marcada de
  novo.

⚠️ **Tarefas por cliente (944): o navegador NÃO escreve em `cb_tasks`.**
`src/lib/tasks/` (puro, testado), rotas em `/api/cb/tasks`, telas em
`src/components/tasks/`. O que morde código novo:

- ⚠️ **Toda escrita passa pela API.** Não há policy de INSERT/UPDATE/DELETE e
  o privilégio foi revogado — um `.from('cb_tasks').update()` do cliente leva
  **42501**, e é assim que tem de ser: criar tarefa grava em `notifications`
  (sem policy de INSERT desde a 027) e os nomes são carimbados no servidor.
- ⚠️ **Quem-pode-o-quê mora em `permissoes.ts`, num lugar só** — a rota decide
  com `podeNaTarefa` e a tela desabilita botão com a MESMA função. Não
  reescrever a regra em RLS nem no componente: divergem na primeira mudança.
  Só o destinatário marca lida (nem admin); editar/apagar é do criador; a
  porta do admin existe para a tarefa ÓRFÃ (criador e responsável são
  `ON DELETE SET NULL` — sem ela, ninguém alcança a tarefa de quem saiu).
- ⚠️ **`vence_em date` + `vence_as time`, separadas e sem fuso.** Nunca
  `new Date(vence_em)` — meia-noite UTC retrocede um dia no Brasil (armadilha
  do CLAUDE.md para coluna DATE). Use `dataParaExibir`/`diaLocal`/
  `situacaoDoPrazo` de `prazo.ts`; "venceu?" é respondido no NAVEGADOR.
- ⚠️ **A resposta volta para quem pediu, e é o SERVIDOR que decide**: com
  `tipo: 'resposta'`, a rota fixa o destinatário no `criador_user_id` do pai e
  IGNORA `responsavel_user_id` e `contact_id` do corpo (o contato é herdado do
  pai em qualquer derivada). Criador que saiu → 409 `PARENT_CREATOR_GONE`.
- **`tarefa_pai_id` é SET NULL com `tarefa_pai_titulo` congelado** — apagar a
  origem não apaga a derivada nem a informação de onde ela veio. Verificado em
  produção.
- **A etiqueta do menu depende de `REPLICA IDENTITY FULL`**: o contador deriva
  o delta comparando a linha ANTES e DEPOIS de cada UPDATE (marcar não lida,
  concluir, reabrir, redirecionar mudam a conta em sentidos diferentes).
- **Aviso de tarefa nasce SEM `conversation_id`** e roteia por
  `notifications.task_id` — em `notifications/page.tsx` o teste de `task_id`
  vem ANTES do de `conversation_id`, senão o clique cairia no inbox.
- **A conversa da linha é DERIVADA do contato na tela** (UNIQUE da 036), nunca
  coluna: cliente sem conversa cai na ficha via `/contacts?contact=<id>`
  (deep link resolvido no estado inicial da página de Contatos).
- **Redirecionar zera `lida_em`** — a tarefa chega "não lida" para quem acabou
  de recebê-la, senão some da contagem do menu da pessoa nova.

⚠️ **Funil-com-conversas (PR #71): o card do Kanban ABRE A CONVERSA, não o
negócio.** `src/lib/pipelines/cartao.ts`, `campos-do-card.ts`, `retorno.ts` e
`src/lib/inbox/url.ts` (puros, testados); editar o negócio é o lápis do card.
O que morde código novo:

- ⚠️ **A conversa do CONTATO manda; `deals.conversation_id` é só fallback**
  (`conversaDoCard`, e o link do `deal-form` segue a MESMA regra). Invertido,
  trocar o contato do negócio deixava o card com a cara do contato novo e o
  clique abrindo a conversa do antigo — o update nunca reescreve o vínculo
  ("`conversation_id` só no NASCIMENTO"). O fallback cobre contato apagado e
  o plano B do select.
- ⚠️ **O recorte por etapa sem dados é neutralizado DENTRO de
  `aplicarFiltros`**, por `ContextoDosFiltros.recorteDeEtapaConfiavel` —
  campo OBRIGATÓRIO, como `achadasNoTexto`: o compilador cobra de qualquer
  consumidor novo. Com o mapa contato→etapa vazio, `casaComAEtapa` reprova
  toda conversa e o deep link `?etapa=` abriria "nenhuma conversa" com cara
  de resposta certa (pino em `filtros.test.ts`). A lista pagina a consulta de
  `deals` (o teto de ~1000 do PostgREST derrubava o filtro PARA SEMPRE ao
  passar de 1000 negócios); o painel recebe `etapas` SEMPRE (dá nome à
  pastilha) e `etapasConfiaveis` gateia só OFERECER o campo.
- ⚠️ **O filtro SEMEADO por `?etapa=` morre com a jornada**: a página do
  inbox NÃO remonta quando só a query muda (sidebar limpa a URL, a faixa
  some) — sem o efeito de ciclo de vida na lista, o recorte ficava aplicado
  sem nada na tela explicando. Etapa semeada que não existe mais também é
  descartada. Só o seed: etapa escolhida à mão no painel não é tocada.
- **`DEAL_SELECT_DO_QUADRO` é separado do `CONVERSATION_SELECT`** de
  propósito — o do inbox é contrato da API pública v1. Embed recusado pelo
  PostgREST cai no `DEAL_SELECT_BASICO` (lembrado em flag de módulo — recusa
  é persistente) e a falha do PRÓPRIO plano B vira toast + lista vazia, nunca
  quadro "vazio" com cara de funil sem negócio. `contact.tags` fica AUSENTE
  no plano B (fabricar `[]` afirmaria "sem etiquetas" sobre dado não
  carregado).
- **O retorno de rolagem EXPIRA (10 min), não é apagado no consumo**
  (`retorno.ts`): apagar antes dos rAF perdia a restauração se o quadro
  desmontasse na janela, ir-e-voltar duas vezes teleportava para `list[0]`, e
  funil sem etapas nunca consumia o registro. A restauração mora no BOARD
  (o `loading` da página cobre só a carga dos funis) com `aplicadoRef`
  marcado DENTRO do rAF (StrictMode) e cleanup cancelando os rAF; o
  `scrollTo` usa `behavior: "instant"` porque o `.pipeline-scroll` tem
  `scroll-behavior: smooth`. O `quadroRef` é criado na PÁGINA: o link "ver
  conversa" do formulário grava o mesmo retorno (props `origemFunil`/
  `aoIrParaConversa` do `DealForm` — o painel do inbox não as passa).
- **`urlDoInbox` preserva `de` (só o valor "funil") e derruba `etapa` nos
  replaces, por decisão**: `etapa` é porta de entrada que semeia o filtro uma
  vez; preservá-la faria o filtro limpo no painel voltar no reload.
- **Sem realtime no quadro, por desenho**: não lidas/última mensagem são foto
  da carga, e voltar do inbox remonta a página e refaz o fetch. Os canais são
  buscados UMA vez no board (`useChannels` dentro do card custava um GET por
  card) e o `DealCard` é `memo` com handlers `useCallback` — quem criar prop
  nova instável quebra isso e volta a re-renderizar 120 cards por tecla.

⚠️ **Filtros do inbox: o recorte é PURO e mora fora da tela (924).**
`src/lib/inbox/filtros.ts` (testado), `src/components/inbox/inbox-filters.tsx`
e `src/hooks/use-favoritas.ts`. Quem for mexer em filtro de conversa mexe lá,
não dentro da lista. O que morde código novo:

- ⚠️ **Filtrar conversa por campo do contato NA CONSULTA dá resultado errado
  sem dar erro.** Com o embed LEFT atual, `.eq('contact.algo', …)` filtra só o
  recurso embutido e as conversas que não casam **continuam vindo** com
  `contact: null`; trocando para `contacts!inner` vira INNER JOIN e **apaga
  toda conversa de grupo**. Nenhum dos dois estoura e os dois passam em
  revisão. Filtre em JS enquanto a lista for carregada inteira.
- ⚠️ **Conversa de grupo tem `conversations.channel_id` NULO — sempre.**
  `src/lib/cb-groups/persist.ts` não grava a coluna; quem sabe o número é
  `cb_groups.channel_id`. Recorte por canal precisa de `canalDaConversa()`,
  senão apaga todos os grupos daquele número em silêncio. **Vale para
  qualquer código novo que agrupe ou conte conversa por canal**, não só para
  o filtro do inbox (o painel, por exemplo, ainda não foi conferido).
- ⚠️ **O recorte de funil/etapa tem DOIS níveis, e `funilId` é escrito SÓ
  pelo seletor de funil.** Escolher uma etapa nunca o carimba. Carimbando,
  numa conta de um funil só ele ficaria preenchido por tabela e "Qualquer
  etapa" — que hoje significa "não filtro por etapa" — passaria a significar
  "quem tem negócio neste funil", sumindo em silêncio com quem ainda não
  virou negócio (é o mesmo pessoal que "Sem negócio" existe para achar). Por
  isso a etapa VENCE o funil em `casaComAEtapa`, e não se somam.
- ⚠️ **`funilPorEtapa` (etapa→funil) é campo OBRIGATÓRIO do ctx**, pela mesma
  razão de `achadasNoTexto`: esquecê-lo não dá erro — o recorte por funil só
  não acha ninguém, e a tela diz "nenhuma conversa" sobre um funil cheio.
- **O campo vira dois níveis só com 2+ funis NOMEADOS.** Com um funil, ou com
  a consulta de `pipelines` falhando sozinha (os nomes vêm dela, o gate de
  `etapasStatus` não a olha), ele cai na lista chapada de antes — subdividir
  sem poder dizer em quê é pior que não subdividir.
- **Uma pastilha POR NÍVEL.** A pastilha única mostrava
  "Bancário - Comercial · Contato Avulso" (198px) numa caixa de 128px: o
  operador lia o funil e NÃO enxergava a etapa. Tirar a do funil tira a
  etapa junto — o seletor não sabe exibir etapa sem funil.
- **Escopo vazio = TUDO**, igual ao resto do projeto: `FILTROS_VAZIOS` não
  recorta nada, e "sem responsável"/"sem negócio" são opções explícitas, não
  a ausência de filtro.
- **Filtro cujo dado não carregou some da tela.** Um seletor sem os dados por
  trás não fica inerte: ele responde ERRADO com cara de certo (o de etapa
  chegaria a dizer que 55 negócios não existem). Cada busca do painel tem
  sinalizador próprio.

⚠️ **Filtros SALVOS do inbox (967/968): o filtro é da CONTA, o padrão é de
CADA UM.** `src/lib/inbox/filtros-salvos.ts` (puro, com teste),
`src/hooks/use-filtros-salvos.ts`, o menu em
`src/components/inbox/filtros-salvos-menu.tsx` (colado no botão "Filtros") e a
semente em `conversation-list.tsx`. Aplicar é `setFiltros(...)`: nada muda em
`aplicarFiltros`. O que morde código novo:

- ⚠️⚠️ **Filtro salvo apontando para id APAGADO devolve ZERO conversas sem dar
  erro** — etapa removida, conexão desconectada, etiqueta ou funil apagados. É
  a mesma família de `recorteDeEtapaConfiavel`: filtro sem o dado por trás não
  some, RESPONDE ERRADO. Por isso aplicar passa SEMPRE por `limparOrfaos`.
  ⚠️ E **catálogo VAZIO não limpa nada**: lista vazia pode ser "ainda não
  carregou" ou "a busca falhou" (o `useChannels` engole erro por desenho), e
  descartar ali jogaria fora um recorte perfeitamente bom por causa de rede.
  `empresa` fica FORA da limpeza de propósito — é texto casado contra
  `contact.company`, não referência a linha: "nenhuma conversa desta empresa
  agora" é uma resposta VERDADEIRA.
- ⚠️ **`lerFiltroSalvo` é PARSE, nunca `as FiltrosDoInbox`.** A linha é JSONB e
  pode ter sido gravada por uma versão que não conhecia um campo de hoje; um
  cast entregaria `undefined` ao recorte e a lista responderia de um jeito que
  ninguém escolheu. Parte de `FILTROS_VAZIOS`, só aceita chave conhecida com o
  tipo certo, e booleano só é ligado pelo booleano `true` (`"false"` e `1` são
  truthy em JS).
- ⚠️ **As pastilhas do painel continuam sendo montadas em `inbox-filters.tsx`**,
  e o menu descreve pelo `descreverFiltro` do módulo. O elo que impede as duas
  descrições de divergirem é um TESTE: `AMOSTRAS` é um
  `Record<keyof FiltrosDoInbox, …>`, então o **compilador** cobra uma entrada
  para todo campo novo do recorte e o teste cobra que ele apareça, saiba se
  desfazer e sobreviva à ida e volta pelo banco. Campo novo em `FiltrosDoInbox`
  = mexer nos dois lugares, e o teste avisa.
- ⚠️ **A semente do padrão roda UMA VEZ** (`semeouPadraoRef`) e só sobre
  recorte INTACTO. Reaplicar faria o filtro que o operador acabou de limpar
  voltar sozinho; semear por cima de uma escolha feita nos centésimos em que a
  consulta voltava desfaria o que a pessoa acabou de fazer.
- ⚠️ **`?etapa=` do funil VENCE o padrão**, e a lista SEGURA o spinner enquanto
  o padrão pode entrar (`esperandoPadrao`). Sem a espera, o inbox pinta as 176
  conversas e pula para 8 um segundo depois; sem a precedência, a faixa "Voltar
  ao funil" mentiria sobre o que está na tela.
- ⚠️ **Toda escrita confere ROWCOUNT.** A policy da 967 exige `admin`, e RLS que
  barra escrita volta **0 linhas com `error: null`** — medido: `agent` renomeia,
  vê o nome mudar e encontra o velho no reload. INSERT barrado volta sem erro
  E sem linha (o `RETURNING` não enxerga o que a RLS recusou).
- **Escolher o PADRÃO é de qualquer membro** (a policy é por `auth.uid()`, não
  por papel): o filtro é do escritório, a preferência é de quem usa.
- **Filtro cujo canal está fora do escopo do perfil SOME do menu** — aplicá-lo
  devolveria vazio sem nada explicando. ⚠️ E o "aplicado" do gatilho é
  procurado SÓ entre os visíveis, e só entre os que ainda RECORTAM algo
  depois de `limparOrfaos`: o filtro do canal fora do escopo perde o canal na
  limpeza, vira vazio, e vazio casa com o inbox sem recorte — o gatilho
  mostrava o nome de um filtro escondido que ninguém aplicou. A faixa
  "Filtro padrão: X" segue a mesma régua (`contarFiltrosAtivos(limpo) > 0`):
  padrão com todos os ids mortos não está "na tela" — e o "mostrar tudo"
  gravava o mesmo vazio, então a faixa não saía nunca (Codex, PR #92).
- **Nome é único por conta, aparado e em minúsculas**, e o `23505` vira
  PERGUNTA na tela ("já existe 'SDR' — substituir?"), não erro cru.
- **A faixa "Filtro padrão: X · mostrar tudo"** existe porque o distintivo de
  contagem explica um recorte que o operador ACABOU de fazer; este ele não fez.

⚠️ **A caixa de busca do inbox tem DUAS metades, e elas se somam com um OU
(929/930).** Nome, telefone, grupo e última mensagem são resolvidos em JS
(`casaComABusca`); o corpo do histórico é respondido pelo banco
(`cb_buscar_conversas_por_texto`), consumido por `use-busca-em-mensagens.ts`.
O que morde código novo:

- ⚠️ **O OU vale só entre as duas metades da busca, dentro do `.filter()`.**
  Tirá-lo de lá faria a busca ATROPELAR o painel — buscar "contrato" com
  "Favoritas" ligado passaria a devolver conversa não favorita.
- ⚠️ **A busca do banco devolve o conjunto COMPLETO, nunca uma página.** É o
  que permite os filtros continuarem no cliente sem resultado inconsistente. Se
  um dia a lista paginar, isto tem de ser revisto **junto** com o realtime.
- ⚠️ **Consulta direta a `messages` para buscar texto é armadilha:** uma linha
  por MENSAGEM estoura o teto de 1000 linhas do PostgREST **sem avisar**, e a
  busca fica incompleta com cara de completa. A RPC colapsa com `DISTINCT ON`
  antes de sair do banco.
- **Uma função para as duas pontas** (`cb_texto_para_busca`, minúsculas + sem
  acento). Índice e consulta com expressões diferentes desligam o índice em
  silêncio — resultado certo, só lento.
- **`%` e `_` digitados são escapados** no SQL. Sem isso, `%` "acha" a conta
  inteira.
- **Piso de 3 caracteres, e ele mora no BANCO.** Abaixo disso a caixa ainda
  acha por nome/telefone, então a tela **precisa dizer** que só a parte do corpo
  ficou de fora.
- **Só o texto vigente:** `deleted_at IS NULL`, e `text_before_edit` fora.
- **A prévia da linha MENTE durante a busca** (mostra a última mensagem). Por
  isso a RPC devolve o trecho que casou, e a linha o exibe no lugar da prévia.

⚠️ **O salto da busca dentro do fio roda em JS, e isso tem prazo de validade.**
`src/lib/inbox/achados-no-fio.ts` (puro, 15 testes) enumera as mensagens que
casam DENTRO da conversa aberta; a rolagem, o destaque e o ↑/↓ estão em
`message-thread.tsx`. O que morde código novo:

- ⚠️ **Só funciona porque o fio carrega a conversa INTEIRA** (`.eq(...)
  .order(...)`, sem `limit`; a maior tem 158 mensagens). Pôr paginação ali
  faz o contador "2 de 5" mentir em silêncio — nada aqui percebe que faltou
  mensagem. **O teto de 1000 linhas do PostgREST chega sozinho**, por
  crescimento de dados, sem ninguém mudar código.
- ⚠️ **`semAcento()` usa `\p{Mn}`, nunca `\p{Diacritic}`.** A segunda faixa
  inclui o acento que existe SOZINHO (`^`, `` ` ``, `´`, `¨`, `~`): buscar
  `^^^` virava agulha vazia, e `includes("")` é verdadeiro para tudo —
  acendia todas as bolhas da conversa e o contador dizia "113 de 113".
- ⚠️ **As duas normalizações são próximas, NÃO idênticas, e nos dois
  sentidos.** Medido: o `unaccent` do Postgres dobra `…`, `–` e `×`; o JS
  não. Há teste fixando a divergência — replicar a tabela do `unaccent` faria
  o código AFIRMAR uma equivalência que não teria.
- ⚠️ **O piso de 3 caracteres é medido no termo NORMALIZADO**, como no banco,
  e o termo vai `.trim()`ado para a RPC (o `btrim` do Postgres apara só o
  U+0020).
- ⚠️ **A supressão do auto-scroll é solta por AÇÃO do operador** — enviar,
  anotar **e rolar à mão** (`wheel`/`touchmove`, nunca `scroll`: o próprio
  salto escreve `scrollTop` e dispararia um). Suprimir para sempre fazia a
  mensagem recém-enviada nascer abaixo da dobra sem nada rolar até ela; não
  soltar na rolagem fazia a chegada de mensagem nova arrastar de volta quem
  estava lendo o contexto em volta do achado.
- ⚠️ **`messages` nas dependências do efeito que centraliza é load-bearing:**
  no resync o fio vira spinner, o `scrollHeight` desaba e o navegador grampeia
  o `scrollTop` em zero — sem isso ninguém re-centraliza, porque o `alvoId`
  não mudou.
- **A âncora é `messages.id`**, nunca `message_id` (o wamid).

⚠️ **A tela global de agendadas (`/agendadas`) é irmã da faixa do fio, não
substituta.** `src/hooks/use-agendadas-da-conta.ts`,
`src/lib/scheduled/tela-global.ts` (puro, com teste) e
`src/hooks/use-acoes-da-agendada.ts`. O que morde código novo:

- ⚠️ **As ações ("Executar agora" e "Cancelar") moram no hook, não na tela.**
  Elas mandam mensagem a cliente e apagam registro; duas cópias divergindo nas
  guardas (`podeDispararAgora`) fazem o cliente receber duas vezes.
- ⚠️ **São TRÊS consultas.** Fila e acervo têm ordens opostas; numa consulta
  só com teto, o `ORDER BY` errado engoliria um dos dois inteiro. E **só as
  enviadas paginam** — falha de seis meses atrás ainda espera decisão, e é ela
  que a paginação empurraria para fora da tela.
- ⚠️ **O acervo ordena por `sent_at`**, não por `scheduled_for`: depois de um
  "Executar agora" as duas se separam de vez.
- ⚠️ **O canal exibido é o `channel_id` DA AGENDADA**, fixado no agendamento —
  aqui `canalDaConversa()` seria ERRADO, ao contrário do resto do projeto.
- **Contagem de aba vem do `count: 'exact'`** (viaja no cabeçalho, de graça),
  nunca de contar a lista carregada: com o acervo paginado, "Enviadas" diria
  50 numa conta com 300.
- **Números somem enquanto a carga falha.** Quatro zeros ao lado das abas
  afirmariam "não há nada" logo acima da caixa que admite não saber de nada.

⚠️ **Radar de Atendimento (941): worker + tabela + aba `/radar`.** A IA lê as
conversas dos últimos 7 dias e grava `cb_conversation_insights` (UMA linha
viva por conversa); o painel só lê. `src/lib/cb-radar/` (puro, testado),
`worker.ts` server-side, rotas em `api/cb/radar/`. O que morde código novo:

- ⚠️⚠️ **O PAINEL SÓ MOSTRA QUEM TEM GATILHO (`temGatilho`, 2026-08-30).**
  Até aqui a tela exibia TODA análise concluída, e o Radar virou boletim
  de todas as conversas: medido em produção, 7 dos 8 cartões abertos eram
  nota 9–10 sem nada a tratar ("resumos de conversas", nas palavras do
  operador). São quatro gatilhos, e só eles: insatisfação, pedido sem
  resposta, urgência média/alta, ou espera ≥ `LIMIAR_ALARME_MS`. Fora
  ficaram, DE PROPÓSITO: nota baixa sozinha (é julgamento, não pendência),
  `mencaoProcesso` sozinha (num escritório bancário quase toda conversa
  cita processo — como alarme seria ruído universal) e `pontosDeAtencao`
  (o campo que a IA usa para resumir o CASO: "detalhamento de dívidas
  bancárias"). A análise da conversa saudável **continua sendo gravada** —
  a nota média da semana sai dela; ela só não vira trabalho para ninguém.
- ⚠️ **Duas réguas de espera, e trocá-las é o erro fácil.**
  `LIMIAR_ALARME_MS` = 24h **CORRIDAS** decide se abre cartão;
  `LIMIAR_PENDENCIA_SEG` = 30min **ÚTEIS** decide só se a etiqueta
  aparece. Em horas úteis (11h/dia) "24h" seriam dois dias e meio de
  calendário e "48h" quase uma semana — o alarme chegaria tarde para quem
  escreveu na sexta. A exibição segue em horas úteis porque é a régua
  justa com a equipe.
  ⚠️ **O vão entre elas produzia CARTÃO MUDO** e foi fechado em 2026-08-31:
  quem escreveu sexta 19h30 e é olhado no sábado tem 24h corridas (entra na
  lista) e ~0 hora útil (etiqueta suprimida) — o cartão aparecia em "1 sinal
  aberto" sem UMA etiqueta dizendo por quê. A saída NÃO foi misturar as
  réguas: quando a de horas úteis não alcança o piso, a etiqueta cai para o
  INSTANTE (`semRespostaDesde`, "Sem resposta desde sex, 22/08 19:30"), que
  é verdade sem depender de régua nenhuma. Mexer numa das duas constantes
  sem olhar esse ramo devolve o cartão mudo.
- ⚠️ **A pendência é conferida AO VIVO na tela, não lida do banco**
  (`respostasDepoisDaPendencia`, em `use-radar.ts`). `aguardando_desde` é
  o retrato da última análise: entre a resposta do atendente e a próxima
  passada do worker somam-se o ciclo do agendador e o throttle, e até lá o
  cartão ficava na tela com o contador "aguardando há 26h" CRESCENDO sobre
  cliente já atendido. A conferência **falha para o lado do alarme**: erro
  de rede mantém o cartão, e lista TRUNCADA continua valendo (a consulta é
  DESC — o teto só pode omitir resposta ANTIGA, e faltar resposta mantém o
  cartão; descartar tudo no teto desligava a conferência inteira de vez,
  porque pendência congelada puxa o piso da consulta para semanas atrás).
  Mensagem APAGADA não conta como resposta (`deleted_at IS NULL`).
- ⚠️⚠️ **"Resposta de gente" NÃO é `sender_id IS NOT NULL`** — é
  `sender_id` preenchido **OU `from_device = true`**. O celular pareado
  (`persistDeviceMessage`) grava `sender_type='agent'` com `from_device`
  true e `sender_id` NULO: não há usuário do CRM por trás, mas há um
  advogado digitando. Medido em produção (2026-08-30): **948** mensagens
  da equipe são `from_device` contra **8** digitadas dentro do CRM — a
  versão só-`sender_id` reconhecia 8 de 978 e o alarme de 24h sobrevivia
  ao atendimento em quase todo caso real (achado da revisão do PR #72).
  Continuam NÃO fechando a pendência: broadcast, automação e fluxo (saem
  sem `sender_id` e sem `from_device`) — e a **AGENDADA**, que é o caso
  TRAIÇOEIRO: ela SAI COM `sender_id` (o `dispatch.ts` passa o
  `created_by` de quem a criou, dias antes, e o send-message persiste).
  Pela coluna sozinha ela conta como resposta; a proveniência que a
  denuncia é `cb_scheduled_messages.message_id`, e o worker E a
  conferência ao vivo a excluem por ele (achado do Codex no PR #74 — uma
  versão anterior desta nota afirmava que a agendada saía sem `sender_id`,
  e estava ERRADA). ⚠️ O
  `houveHumanoNaJanela` do worker usa a régua ANTIGA (só `sender_id`) —
  lá ela decide outra coisa (se preserva a análise congelada quando a
  janela não tem cliente), e uma saída `from_device` sozinha realmente não
  deveria refazer a análise. Não unificar as duas sem entender qual
  pergunta cada uma responde.
- ⚠️ **Análise `failed` aparece no painel INDEPENDENTE de gatilho.** A
  linha que esgotou as 3 tentativas fica com os defaults do schema
  (`urgencia='nenhuma'`, sem insatisfação, sem pedido): pelo filtro comum
  ela sumiria e o vazio afirmaria "nenhum sinal aberto" sobre conversa que
  o Radar NÃO CONSEGUIU LER, com a etiqueta de falha e o botão
  "Reanalisar" inalcançáveis. A consulta de RESGATE dela (M3) filtra
  `estado = 'aberto'` como a irmã da pendência: a tela só mostra abertas, e
  100 falhas tratadas/descartadas consumiam o resgate inteiro escondendo uma
  falha aberta mais antiga (Codex, PR #96).
- ⚠️ **O painel recarrega sozinho a cada 2 min com a aba visível.** O
  tique de 1 min só re-renderiza (reconta a espera); quem descobre que
  alguém respondeu é a consulta de `respondidas`. Sem a recarga, o cartão
  de cliente já atendido por um colega ficava na tela até o operador
  trocar de aba e voltar.
- ⚠️ **Insatisfação exige evidência recente — 2 dias de expediente, em TEMPO
  ÚTIL** (`JANELA_INSATISFACAO_UTIL_SEG`, 22h úteis via `segundosUteisEntre`;
  era "48h corridas" até 31/08). A janela analisada tem 7 dias: sem a régua,
  irritação de terça já resolvida seguia acendendo cartão no domingo. Em
  CORRIDAS, porém, a reclamação analisada na sexta expirava no DOMINGO —
  antes de qualquer pessoa abrir o painel — e sem a aba "Todos" o sumiço era
  definitivo (#22). Não é "48h úteis" de propósito: isso inflaria a régua
  para ~6 dias corridos (o racional que manteve `LIMIAR_ALARME_MS` em
  corridas, apontado acima). As DUAS réguas (escrita e leitura) usam a MESMA
  unidade e SE SOMAM — o teto real é ~4 dias úteis, por desenho.
  ⚠️ **A âncora é o INSTANTE DA ANÁLISE (`agoraMs`), não a última linha do
  transcrito** — mudou em 2026-08-31. Ancorada na conversa, a régua não
  funcionava justamente no caso que a motivou: cliente reclama, a equipe
  responde e a conversa MORRE ali; o corte envelhecia junto com a última
  linha e nunca a alcançava, então o sinal ficava aceso para sempre sobre
  caso encerrado. A função segue PURA — quem chama passa o instante (o
  worker, `Date.now()`; os testes, um valor fixo), e há pino cobrindo os
  dois lados. Chamar `interpretarAnalise` sem o 3º argumento volta à âncora
  velha, de propósito, para não quebrar chamador antigo em silêncio.
- ⚠️ **Não existe mais aba "Todos"** (decisão do operador): listar toda
  conversa analisada era o próprio ruído que o filtro passou a cortar.
  Consequência que o desenho tem de sustentar: sem ela, um descarte errado
  esconde o alarme daquele cliente **para sempre** — `descartado` nunca
  reabre sozinho. São DUAS saídas, e nenhuma sobra: o "Desfazer" do toast
  (~4s) e o cartão que **FICA na lista enquanto a tela estiver aberta**,
  apagado e com o botão "Reabrir" (`mexidasAqui`, em `radar/page.tsx`). Só
  o toast não bastava — e foi o que houve até 2026-08-31, com o "Reabrir"
  como código morto, porque a lista só aceita `estado === 'aberto'`. Sair
  da tela limpa o conjunto: é o fim do expediente de triagem, e a aba
  "Todos" continua não existindo.
- ⚠️ **O falso NEGATIVO da IA não tem botão, e isso é decisão fechada
  (2026-08-31), não pendência.** Análise sem gatilho não entra na lista,
  então o "Reanalisar" dela é inalcançável — e a leitura ingênua ("falta um
  caminho de correção") leva direto a ressuscitar a aba "Todos", que é
  justamente o ruído que o operador mandou cortar. O que sustenta o NÃO: o
  `generateStructured` roda a temperatura padrão sobre o MESMO transcrito,
  então reanalisar um falso negativo tende a devolver o mesmo veredito —
  o botão custaria uma geração paga para repetir a resposta. E os casos em
  que reanalisar REALMENTE muda a resposta já têm caminho próprio:
  `status='failed'` entra na lista independente de gatilho (com o botão),
  `sem_ia` acende o aviso de conta que aponta para Integrações, e mensagem
  nova reanalisa sozinha pelo worker. Sobra só a troca de modelo/prompt,
  que é conta inteira e pediria um "reanalisar tudo" — não um botão por
  conversa. Quem for reabrir isto começa por aí, nunca pela aba.
- **NADA dispara sozinho** — mesma classe da 925: quem move é o agendador
  batendo em `/api/cb/radar/cron` (incluído no laço LENTO do
  `docker-stack.yml`). ⚠️ O CI não relê o `command` do `agendador`: a
  inclusão só vale depois de `docker stack deploy` manual na VPS.
- ⚠️ **`cb_channels.radar_enabled` nasce FALSE e é `=== true` na rota** — a
  exceção DELIBERADA à convenção "escopo vazio = todos": o Radar manda
  conversa de cliente para provedor de IA externo, e há canal de uso
  PESSOAL conectado na conta. Não "corrigir" para a convenção.
- **`authenticated` só tem SELECT na tabela.** Tratar/descartar passa por
  `PATCH /api/cb/radar/[conversationId]/estado` (service-role). UPDATE do
  navegador volta "0 linhas" com cara de sucesso — é o REVOKE da 941 agindo.
- **Sinal sem evidência é DESCARTADO pelo parser** (`interpretarAnalise`,
  rubrica.ts). É o princípio do produto — evidência = índice de linha do
  transcrito, mapeado para `messages.id`. Quem mexer na rubrica mantém a
  regra, senão o painel vira gerador de alarme falso.
- **Feedback por atendente exige AUTORIA, não só evidência**: a observação
  em `observacoes_por_atendente` só passa se citar linha ESCRITA pelo
  atendente nomeado (o transcrito rotula "Equipe (Nome)" via
  `messages.sender_id` → `profiles`; `LinhaDoTranscrito.autor` é o que o
  parser confere). Sem isso, cliente que digita "a Ana demorou" viraria
  auditoria da Ana. Nome não resolvido → rótulo genérico "Equipe" e a IA é
  instruída a não avaliar. Na tela, a seção só aparece para
  `useCan('manage-members')` — é avaliação de pessoa, não de conversa.
  ⚠️ **O gate é SÓ de renderização**: o dado viaja em `detalhes.analise`
  e a policy da 941 dá SELECT a qualquer membro — um `agent` lê a própria
  avaliação pela aba Network. Barreira real (pendente, na PRÓXIMA migration
  livre — a 943 virou a transcrição de áudio):
  coluna separada sem GRANT ao `authenticated` + rota server-side com
  `requireRole` + trocar o `select('*')` do hook por colunas nomeadas
  (senão a coluna sem grant derruba a consulta inteira). Decisão do
  operador se isso bloqueia o merge.
- **`generateStructured` (`src/lib/ai/structured.ts`) é separado de
  `generateReply` DE PROPÓSITO.** Não fundir: o caminho do
  auto-reply/draft não pode herdar regressão do caminho de análise.
- **Gemini**: chave SEMPRE no header `x-goog-api-key`, nunca `?key=` na
  URL (vaza em log de proxy). Embeddings/RAG continuam exigindo chave
  OpenAI (modelo fixo, `vector(1536)`). Em produção, chave do TIER PAGO —
  a faixa gratuita do Google pode usar os dados enviados.
- **Tempos em segundos ÚTEIS com fuso FIXO -03:00** (o Brasil não tem
  horário de verão desde 2019) — `horario-comercial.ts` é o único arquivo
  a mudar se isso um dia voltar. Intervalo negativo (relógio do WhatsApp
  na entrada vs `now()` do banco na saída) vira zero lá dentro.
- ⚠️ **Ciclo de vida do sinal tem TRÊS regras assimétricas, todas com motivo:**
  `tratado` reabre SÓ com mensagem DO CLIENTE posterior ao `estado_em` (a
  resposta do próprio operador não reabre, e um clique dado durante a análise
  não é atropelado — o reset é um UPDATE condicional separado);
  `descartado` NUNCA reabre sozinho (descartar = "a IA errou"; reanálise
  repetiria o falso positivo a cada mensagem — reabre só pelo botão);
  `aberto` fica. Quem mexer no reset mexe no UPDATE condicional do worker,
  não no UPDATE principal.
  ⚠️ **UMA exceção escrita (#23, 31/08), e ela é ESTREITA:** descarte dado
  sobre linha `failed` que NUNCA teve análise concluída (`analisado_em`
  nulo no claim — `descarteFoiSobreFalha`) reabre quando a primeira análise
  BOA gravar. Ali o operador descartou o aviso "análise falhou", não um
  veredito — e a linha `failed` com tentativas < 3 reanalisa SOZINHA no
  ciclo seguinte, então sem a exceção o sinal real nascia invisível para
  sempre. Linha que já teve análise concluída fica na regra geral mesmo com
  falha por cima: o que o descarte rejeitou era conteúdo real. Não remover
  como "inconsistência" — o próximo leitor vai querer.
- ⚠️ **Toda escrita pós-claim do worker tem CERCA DE POSSE**
  (`.eq('status','running').eq('running_desde', <carimbo do próprio claim>)`).
  Sem ela, um worker recolhido como travado continuava com direito de escrita
  e atropelava a análise seguinte. ⚠️ O RECOLHEDOR tem a cerca dele próprio:
  o UPDATE exige o MESMO `running_desde` velho que o SELECT viu (`is null`
  quando nulo — `.eq()` nunca casa NULL). Entre os dois cabe uma reanálise
  manual TOMANDO o claim abandonado (#28 permite), e sem a cerca o recolhedor
  marcava `failed` o claim fresco e a escrita do worker vivo era descartada
  (Codex, PR #89). E **"mensagem nova" exige `janela_fim` NÃO
  NULO** — tratá-lo nulo como "tem novidade" furava o teto de tentativas e
  virava retentativa paga infinita (4 ângulos da revisão acharam).
- **A janela de mensagens lê DESC + reverse** — com mais linhas que o teto,
  quem cai é o COMEÇO da janela. Com ASC, o corte descartava as mensagens de
  HOJE e `aguardando_desde` mentia "ninguém aguardando".
- ⚠️ **Janela sem NENHUMA mensagem do cliente NÃO chama a IA** (só métricas;
  `detalhes.sem_cliente_na_janela`). Existe porque o ENVIO também atualiza
  `conversations.last_message_at`: sem o pulo, um broadcast tornava cada
  destinatário candidato e disparava dezenas de análises pagas de conversas
  onde só nós falamos. Janela COM fala do cliente reanalisa mesmo quando a
  novidade é só nossa — a resposta da equipe resolve pendência/pedido, e
  congelar a análise deixava alarme velho na tela. Não "otimizar" isso.
- ⚠️ **Nesse caminho, saída AUTOMÁTICA não fecha pendência.** Se a janela só
  tem máquina (nenhum cliente, nenhum `agent` com `sender_id` — broadcast,
  agendada, automação e fluxo mandam sem gente) e a linha JÁ tem análise
  completa, o worker faz um UPDATE preservador: avança só `janela_fim` e
  mantém a análise congelada INTEIRA (`aguardando_desde` incluído). Sem
  isso, um broadcast apagava o alarme do cliente esquecido — o caso que a
  exceção do painel existe para proteger. Resposta HUMANA na janela cai no
  UPDATE completo e fecha a pendência normalmente.
- **O transcrito colapsa repetição EXATA do robô** (`botRepetidas`, rubrica):
  fluxo reapresentando o mesmo menu entra uma vez só — **sobrevive a
  ocorrência mais RECENTE**, a mesma regra dos tetos (mantendo a primeira,
  o corte de cauda de conversa acima do teto a derrubava e o menu sumia
  inteiro). O prompt declara a omissão. HUMANO (cliente OU equipe) nunca é
  colapsado — insistência é exatamente o sinal que o Radar caça. Colapso
  não marca `janela_cortada`.
- **A legenda da tela (`como-funciona.tsx`) IMPORTA as constantes reais**
  (`JANELA_DIAS`/`THROTTLE_MS` de `ordenacao.ts`, `TETO_MENSAGENS` da
  rubrica, `CICLO_MINUTOS`) — por isso `THROTTLE_MS` mora em `ordenacao.ts`
  (client-safe), não no worker. Número digitado à mão no dicionário mente na
  primeira mudança de constante.
- **`loadAiConfig` do Radar usa `requireActive: false`** — o Radar precisa da
  CREDENCIAL; `is_active` é o interruptor do assistente DE CONVERSA. Amarrar
  os dois silenciava a análise quando o operador desligava o auto-reply.
- **O painel aplica a MESMA régua do worker na leitura**: esconde insight de
  conversa fora da janela de 7 dias e de canal com `radar_enabled` desligado
  (desligar o canal tem de sumir com as análises antigas dele — o caso
  nomeado é o canal pessoal ligado por engano). ⚠️ **UMA exceção: pendência
  aberta não expira.** Conversa parada além da janela com `aguardando_desde`
  e `estado='aberto'` FICA no painel (selo "parada há mais de N dias") —
  sumir com o cliente esquecido no 8º dia apagava o alarme quando ele fica
  mais grave. A análise congelada é fiel (nada mudou na conversa; a primeira
  resposta a reativa e o worker refaz), mas os CARTÕES ignoram
  urgência/insatisfação/nota dessas linhas via `foraDaJanela` — só a
  pendência conta.
- **O upsert em `cb_conversation_insights` FUNCIONA** porque o UNIQUE de
  `conversation_id` é TOTAL — não é o caso dos índices parciais da 903.
- `ai_usage_log.mode` ganhou `'radar'` e os CHECKs de `provider` ganharam
  `'gemini'` (941) — modo/provedor novo exige migration no CHECK, senão o
  `logAiUsage` engole o erro e o custo some do painel de uso.

⚠️ **Transcrição de áudio (943): função ÚNICA, Gemini-only, chave BYO.**
`src/lib/transcricao/transcrever.ts` (testado), rota
`POST /api/cb/transcricao/[messageId]`, colunas `transcricao_*` em
`messages`. Três chamadores da MESMA função idempotente: botão da bolha,
worker do Radar e (futuro) auto-reply. O que morde código novo:

- **A transcrição NUNCA vai para `content_text`** — o que o cliente
  escreveu e o que a máquina ouviu são coisas diferentes, e sobrescrever é
  irreversível (o original é NULL). Num CRM jurídico isso é inegociável.
- ⚠️ **O cadeado `UPDATE…RETURNING` não é opcional**: no deploy
  (`start-first`) há DOIS processos Node vivos e o rate limit é um Map em
  memória por processo — só o banco impede pagar o mesmo áudio duas vezes.
  Teto de tentativas DENTRO do WHERE; travada de 10 min recolhida pelo
  próprio cadeado. Escrita final e falha com cerca (`transcricao_desde`).
- ⚠️ **Sem chave Gemini (ou provedor ≠ gemini) devolve `recusada` SEM
  GRAVAR** — gravar o estado terminal mataria o botão para sempre por um
  problema de configuração passageiro. Mensagem apagada, não-áudio, conta
  errada e **áudio recém-chegado ainda sem `media_url`** (o webhook grava
  a mensagem primeiro e o arquivo segundos depois — janela de 2 min)
  também devolvem sem gravar. `recusada` GRAVADA é só para o irreversível
  da PRÓPRIA mensagem: URL relativa (proxy Meta exige sessão) em mensagem
  antiga, áudio grande demais, `MAX_TOKENS` (determinístico a temperatura
  0 — retentar pagaria o mesmo corte de novo) e tentativas esgotadas.
  A chave é resolvida PELO CANAL da conversa (como a análise) — sem isso,
  canal apontado para outro provedor mandava o áudio ao Google.
- **O modelo é FIXADO em `MODELO_TRANSCRICAO`** (`gemini-3.7-flash` desde
  2026-08-28; era `gemini-3.5-flash-lite`), separado do modelo de
  chat/análise da conta. Trocar de modelo/provedor é mexer SÓ neste módulo
  (plano B documentado: ElevenLabs, único com `audio/opus` por escrito —
  a doc do Gemini lista "OGG Vorbis" e a nota do WhatsApp é Opus).
  ⚠️ **Um modelo para os DOIS chamadores, de propósito.** Modelo por
  chamador (bom no botão, barato no Radar) foi avaliado e descartado em
  2026-08-28: não existe "transcrever de novo" — a idempotência devolve o
  texto gravado ANTES do cadeado e a bolha esconde o botão quando já há
  texto —, então quem chega primeiro fixa o modelo daquele áudio para
  sempre, nenhuma coluna registra qual escreveu o quê, e o teto de 3
  tentativas é compartilhado (falha do barato num áudio difícil carimba
  `recusada` terminal e mata o bom). Economia teto: R$ 4/mês.
  ⚠️ **Não desligar o raciocínio** (`thinkingConfig.thinkingBudget: 0`):
  corta a conta pela metade e piora o erro de 12,1% para 13,9% (medido).
  ⚠️ **Trocar o modelo NÃO refaz o que já foi transcrito** — não existe
  caminho de re-transcrição, e nenhuma coluna guarda o modelo (só dá para
  inferir por `transcricao_em`). Quem trocar de modelo decide, na mesma
  passada, se limpa `transcricao*` do acervo antigo para ele ser refeito.
  🔭 O `gemini-3.5-transcribe` mede melhor e custa menos, mas **não atende
  no `generateContent`** (200 com `parts: [{}]` vazio, cobrando a entrada)
  — vive na API de Interações. Em 2026-08-28 o modo `smart` apagava fala e
  diarização/timestamps devolviam zero anotações. Detalhes e a forma da
  chamada estão no comentário da constante, em `transcrever.ts`.
- **O worker do Radar transcreve SÓ áudio do CLIENTE e SÓ nunca-tentado**
  (`transcricao_status` nulo), até 5 por análise e dentro do `deadlineMs`
  do ciclo (reserva download + 2× o timeout de IA). ⚠️ `falhou` fica para
  o botão HUMANO — o retry automático a cada ciclo queimava o teto de 3
  em ~45 min e uma cota estourada carimbava `recusada` terminal em tudo.
  Falha/recusa NÃO derruba a análise — o áudio segue como lacuna
  declarada. O texto entra com `PREFIXO_AUDIO` (contrato com a rubrica:
  linha de áudio tem teto de 2.000 chars, não 500, e truncamento por
  linha é declarado ao modelo via `truncadas`).
- **A transcrição NÃO entra no índice GIN da busca (929)** — trade-off
  aceito no plano; busca por conteúdo de áudio é migration futura.
- O mime enviado é `messages.media_type` (042) → `Content-Type` do
  Storage → `audio/ogg`, nesta ordem.

⚠️ **Integrações é o lar das CHAVES e dos modelos por MÓDULO; Agentes de IA
ficou com o COMPORTAMENTO do agente de conversa.** `src/lib/integracoes/montar.ts`
(puro, com teste), a rota `GET /api/cb/integracoes/status` e
`src/components/settings/integracoes-panel.tsx`. A divisão nasceu de um engano
real: um único campo "Modelo" servia ao assistente, à resposta automática, ao
Playground **e ao Radar**, e o operador cadastrou um modelo "para o Radar"
configurando outra coisa. O que morde código novo:

- ⚠️ **Só o Radar tem coluna própria (`ai_configs.radar_model`, 946; NULL =
  herda `model`).** Transcrição e RAG já tinham modelo próprio — constantes
  no código (`MODELO_TRANSCRICAO`, `EMBEDDING_MODEL`). Nelas o problema era
  VISIBILIDADE, não separação, e continuam não-configuráveis.
- ⚠️ **O modelo do Radar aparece em TRÊS lugares do worker** — a chamada a
  `generateStructured`, o `logAiUsage` e a coluna `model` do insight.
  Resolver `config.radarModel ?? config.model` UMA vez e usar nos três;
  deixar um para trás faz a aba Uso e o cartão atribuírem o custo ao modelo
  errado, no exato lugar onde o operador iria conferir a separação.
- ⚠️ **`generateStructured` recebe o modelo por PARÂMETRO explícito**, nunca
  por `{...config, model}`: o spread não deixa rastro no tipo, e um merge do
  upstream que reescreva `structured.ts` devolveria o Radar ao modelo do
  chat sem quebrar o typecheck.
- ⚠️ **O formulário de Integrações ECOA os campos que não edita.** `POST
  /api/ai/config` reescreve a linha (`system_prompt` ausente vira NULL,
  `is_active` ausente vira false): salvar a chave a partir de Integrações
  sem devolver esses campos apagaria as instruções da empresa e desligaria o
  assistente — a partir de uma tela que fala de outro assunto.
- ⚠️ **`radar_model` ausente do corpo = "não mexe"** (mesma convenção de
  `handoff_agent_id`), senão um save vindo de Agentes zeraria o modelo do
  Radar configurado na outra tela.
- ⚠️ **O modelo do Radar é validado no SAVE, contra o provedor** — inclusive
  quando muda só o PROVEDOR (senão um `radar_model` do Gemini sobrevive à
  troca para OpenAI e o Radar falha de madrugada). O ping da aba testa só o
  modelo do CHAT, de propósito: pingar o do Radar custaria uma segunda
  chamada paga a cada carga de tela.
- ⚠️ **DECISÃO DE PRODUTO (operador, 2026-08-28): configuração POR MÓDULO,
  uma para a conta inteira.** O modelo e a chave de cada módulo valem para
  TODAS as conexões — nunca chave por conexão. Por isso `montar.ts` lê só o
  agente PADRÃO e a lista de canais aparece SÓ no Radar, onde significa o
  interruptor `radar_enabled` (privacidade, 941), não escopo de chave. A
  transcrição não lista canal nenhum. ⚠️ O backend (`loadAiConfig`) ainda
  resolve canal→padrão e o schema da 903 ainda permite linha por canal —
  mas NÃO existe escritor de agente por canal no app. Se um dia esse
  escritor nascer, `montar.ts` tem de voltar a espelhar a resolução do
  backend, senão a tela mente.
- ⚠️ **`?ping=0` existe porque cada ping é uma GERAÇÃO PAGA por agente.** A
  tela carrega em dois tempos (config na hora, pings depois) e o botão
  repete só os pings. O `useEffect` tem guarda própria (`disparouRef`)
  porque o StrictMode do `next dev` dobraria as chamadas pagas.
- **Nenhuma chave sai da rota de STATUS, nem mascarada** — ali a falha volta
  como CÓDIGO, nunca como `AiError.message` (a mensagem da OpenAI ecoa a
  chave enviada: "Incorrect API key provided: sk-…abcd"). ⚠️ O SAVE do
  modelo do Radar (`/api/ai/config`) é DIFERENTE de propósito: devolve a
  mensagem do provedor, porque é ela que diz "modelo não encontrado" —
  EXCETO quando `code === 'invalid_key'`, o único caso que ecoa chave, que
  vira texto genérico. Quem mexer ali preserva essa exceção.
- **`MODELO_TRANSCRICAO` e `EMBEDDING_MODEL` entram em `montarCartoes` por
  PARÂMETRO**, importados na rota — nunca redigitados no módulo puro nem no
  dicionário, senão a tela mente na primeira troca.
- **Radar exige `radar_enabled === true`** (exceção deliberada à convenção
  "vazio = todos", acima); transcrição é Gemini-only; RAG é OpenAI-only e
  aparece no cartão da OpenAI mesmo quando o chat da conta é outro provedor.
- **Módulo sem uso ativo NÃO some da lista** — aparece marcado com o motivo.
  Esconder era o que a primeira versão fazia, e é justamente o caso em que o
  operador mais precisa da tela: ele acabou de cadastrar a chave e precisa
  descobrir que o Radar está desligado na conexão.
- **`AI_PROVIDER_MODELS` é SUGESTÃO (`<datalist>`), nunca allow-list**: o
  campo continua aceitando qualquer id e o servidor gravando qualquer string
  não vazia. Ids de modelo mudam mais rápido que a lista.
- ⚠️ **MEDIDO em 2026-08-28: `gemini-3.5-transcribe` NÃO serve.** O modelo
  dedicado existe no catálogo e responde HTTP 200, mas devolve `parts: [{}]`
  e ZERO tokens de saída pelo `:generateContent` — testado em três formas de
  chamada sobre cinco áudios reais, enquanto o `gemini-3.5-flash-lite`
  transcreveu todos. Quem tentar de novo precisa de outra superfície de API,
  não de outra configuração.
- **Google Agenda é cartão "não conectado" de propósito**: a integração não
  existe no código (as colunas `google_*` da 945 nascem nulas). Quando ela
  for construída, é este cartão que vira o ponto de conexão.

⚠️ **API pública: as features do fork têm escopo E rota, sempre em par.**
Escopo sem endpoint não faz nada, e endpoint sem escopo é buraco. Os dez
escopos novos (`tasks|scheduled|deals|meetings|notes:read|write`) moram em
`src/lib/api-keys/scopes.ts` (sem migration — a coluna é `text[]`) e as
rotas em `src/app/api/v1/`. O que morde código novo:

- ⚠️ **Toda rota v1 roda em SERVICE-ROLE e ignora RLS** — cada consulta
  precisa do `.eq('account_id', ctx.accountId)` explícito, inclusive os
  lookups secundários (`profiles`, `contacts`, `conversations`, `pipelines`).
- ⚠️ **Erro de banco NÃO é "não encontrado".** Um `maybeSingle()` que
  descarta o `error` transforma timeout do PostgREST em `404 Contact not
  found` — e o integrador recria o contato, duplicando. Trate o erro antes
  do vazio.
- ⚠️ **Instante vindo da API exige OFFSET escrito** (`Z` ou `±HH:MM`) em
  `scheduled_for` e na janela `from`/`to` das reuniões. O navegador sempre
  manda; um integrador não, e sem offset o Postgres lê como UTC — a
  armadilha de 3h da 935, que não estoura em lugar nenhum.
- ⚠️ **`POST /api/v1/deals` exige `stage_id` e recusa segundo card do mesmo
  contato** (409 `contact_already_has_deal`). Etapa por `MIN(position)`
  despeja o lead na faixa de estacionamento, e o índice único da 911 só
  cobre `source='channel'` — a regra semântica é de código.
- **Escrita de negócio pela API chama `drenarEventosDeFunil()`** (fire-and-
  forget), como a tela faz: sem isso a automação de etapa espera o próximo
  batimento do agendador — o laço RÁPIDO do `docker-stack.yml`, `sleep 60`
  (uma versão desta nota dizia "15 min", que é o laço LENTO; o próprio #74
  mediu e corrigiu `lembretes.ts` e `DEPLOY-VPS.md`, e esta linha ficou).
- **Nome carimbado vem de `resolveApiAuthor`** (`src/lib/api/v1/authorship.ts`):
  usuário de auditoria da v1, com queda para o DONO da conta quando aquele
  já saiu — e `membro: false` quando nem o dono resolve. Quem exigir um
  membro de verdade (dono de reunião) confere esse sinalizador.
- **Grupo continua fora da v1** (`.is('group_id', null)` nas conversas), e a
  agendada resolve canal por `cb_groups` quando a conversa é de grupo.

⚠️ **UI de canal: peças próprias, prefira reusá-las.** `src/hooks/use-channels.ts`
(uma busca por montagem, falha silenciosa), `src/lib/cb-channels/display.ts`
(funções puras, com teste) e `src/components/channels/` (`ChannelBadge`,
`ChannelCell`, `ChannelScopeBadge`, `ChannelSelect`, `ChannelMultiSelect`,
`ChannelFilter`). Convenções que valem em toda tela nova:

- **Escopo vazio = TODOS os canais**, nunca "nenhum" — igual ao motor
  (`channelInScope`, `findEntryFlow`). Uma tela que disser "nenhum canal" onde o
  motor lê "todos" faz o operador desativar a regra errada.
- **Seletor some com menos de 2 canais.** Numa conta de um número ele não decide
  nada e só ocupa espaço.
- **Registro sem `channel_id` mostra travessão**, nunca o canal padrão: em
  registro anterior à 903 o disparo pode ter vindo de outro número.
- **Filtro não esconde o irrestrito.** Uma automação sem escopo dispara em todos
  os números e continua visível sob qualquer filtro.
- ⚠️ **O nome da instância Evolution é DERIVADO DO RÓTULO e fixado na criação**
  (`buildChannelInstanceName`): "CBAdv" → `cbadv-3f2a91`. O **sufixo aleatório
  não é enfeite** — `provisionEvolutionInstance` é create-or-**adopt** por
  nome, então rótulo batendo com instância já existente no servidor
  compartilhado faria o CRM assumi-la e reapontar o webhook dela, em silêncio
  e com 200. Renomear o canal depois **não** renomeia a instância:
  `instance_name` é a chave de roteamento da entrada e a Evolution não
  renomeia (seria apagar e recriar, perdendo pareamento e `api_key`).

⚠️ **`src/components/ui/select.tsx` divergiu do upstream — não deixar sobrescrever.**
O `<Select.Value />` do base-ui mostra o **valor cru** quando o `Root` não recebe
`items`: a tela de Agentes exibia literalmente `openai` e `__queue__` para o
usuário, e o editor de fluxos, `keyword`. Nosso `Select` agora **deriva `items`
percorrendo os próprios `<SelectItem>` da árvore**, então todo call site (~20)
mostra o rótulo certo sem mudar nada. Ao mesclar upstream, manter o wrapper.

- O wrapper repassa os genéricos `<Value, Multiple>`. Tipá-lo com o
  `Root.Props` não-genérico apaga a inferência e joga o `onValueChange` de
  todo call site para `any` implícito (20 erros de typecheck de uma vez).
- A lista é memoizada por **assinatura**, não por `children` — `children` tem
  identidade nova a cada render, e o `store.update` do base-ui compara com
  `Object.is`, então sem isso os assinantes eram notificados à toa.
- Rótulo que é JSX (não texto) entra na assinatura por posição. Quem precisar
  de rótulo dinâmico complexo no gatilho passa a função em `<SelectValue>` —
  é o que `channel-select.tsx` faz, para o gatilho mostrar só o nome do canal
  em vez da linha inteira com bolinha e telefone.

⚠️ **Etapa com RESULTADO (950): quem carimba ganho/perdido é o BANCO.**
`pipeline_stages.resultado` ('ganho'|'perdido'|null) + gatilho BEFORE em
`deals`: ENTRAR numa etapa marcada grava o status — para os CINCO escritores
de etapa (painel da conversa, arrasto, formulário, RPC das automações, API).
O que morde código novo:

- ⚠️ **SAIR de etapa marcada para etapa neutra NÃO reabre** — decisão do
  operador (fluxo: fechou → transfere para o funil do jurídico → CONTINUA
  ganho). Não "corrigir" para o modelo Kommo. Reabrir é só por botão ou por
  entrar em etapa com outro resultado.
- **Etapa marcada VENCE status explícito no mesmo update**; o Reabrir muda só
  o status (sem tocar etapa) e o gatilho passa reto — de propósito.
- **`src/lib/pipelines/resultado.ts` é ESPELHO do gatilho** (para o selo
  aparecer sem refetch). Quem mudar a regra muda nos DOIS, e o teste fixa o
  comportamento MEDIDO em produção.
- Ganho/perdido **não some com nada**: card fica na coluna (selo), conversa
  intocada; sai das métricas de aberto e entra em "Ganhos no mês".

⚠️ **Três armadilhas de LAYOUT que já quebraram tela e voltam a quebrar.** As
três passam em revisão de código, em typecheck e em teste — só aparecem na tela,
e as três já morderam de verdade.

- ⚠️⚠️ **O tailwind-merge só desempata classes com o MESMO prefixo de
  variante.** `cn("group-data-horizontal/tabs:h-8", "h-auto")` devolve as
  **duas** (medido com o twMerge do projeto), e a variante vence quando o
  seletor casa. Foi assim que a ficha do contato quebrou: o `TabsList` de
  `src/components/ui/tabs.tsx` traz `group-data-horizontal/tabs:h-8`, o
  `contact-detail-view.tsx` passava `h-auto` para poder usar `flex-wrap`, o
  `h-8` sobreviveu — e as 8 abas, quebradas em 3 linhas dentro de uma caixa de
  32px, foram renderizadas **por cima** dos campos do painel. A correção é
  repetir o prefixo (`group-data-horizontal/tabs:h-auto`), não remover o
  `h-auto`. **Vale para qualquer override de classe que o primitivo declare sob
  variante** — `group-*`, `data-*`, `dark:`, `sm:`. Na dúvida, meça:
  `node -e "console.log(require('tailwind-merge').twMerge('<a> <b>'))"`.
  ⚠️ **A MESMA tela tinha a MESMA armadilha na largura**, e essa era a causa de
  as abas precisarem de 3 linhas: o `sheet.tsx` traz
  `data-[side=right]:sm:max-w-sm`, o call site pedia `sm:max-w-lg w-full` cru, e
  o painel abria com **384px em vez de 512px** — aqui o override ainda perde por
  ESPECIFICIDADE, porque a classe do primitivo carrega o seletor de atributo.
  Com o prefixo (`data-[side=right]:sm:max-w-lg`), 512px e 2 linhas de aba. Ou
  seja: quando uma tela parece "apertada demais", desconfie da largura ANTES de
  reflowar o conteúdo — pode ser este bug, não falta de espaço.
  ⚠️ **Prefixe só o `max-w`, NUNCA o `w-full` junto.** Prefixado, o `w-full`
  passa a vencer o `data-[side=right]:w-3/4` do primitivo e abaixo de `sm` o
  painel vira TELA CHEIA — sem fundo sobrando para fechar tocando fora, que no
  celular é a única saída à mão. Com `w-3/4` o desktop dá os mesmos 512px (3/4
  de 1440 estoura o teto de qualquer jeito) e o celular mantém a saída.
  São QUATRO os `SheetContent` do repo — `contact-detail-view.tsx`,
  `pipelines/deal-form.tsx` e os DOIS de `flows/flow-canvas.tsx` (o painel do
  nó; uma versão anterior desta nota dizia "dois" e o flow-canvas ficou de
  fora, abrindo com 384px em vez dos 448px pedidos até a revisão 48h).
  Todos com o `max-w` prefixado; arrumar só parte deles deixa painéis irmãos
  com larguras diferentes. Quem criar um `SheetContent` novo confere os
  quatro e repete o padrão.
- ⚠️ **`<ScrollArea>` dentro de `flex-col` precisa de `min-h-0`, sempre.** Filho
  de flex nasce com `min-height: auto`, e o Root do base-ui só põe
  `position: relative` — o `overflow` fica `visible`, então o clamp não é
  anulado e o painel **cresce** para caber o conteúdo em vez de encolher para o
  espaço restante. O conteúdo vaza, é cortado por um `overflow-hidden` de
  ancestral, e **não aparece barra nenhuma** (o base-ui esconde a barra nativa
  por CSS e a própria é `position: absolute`) — o operador vê a informação
  sumir, não uma barra que não rola. Já mordeu três vezes: `conversation-list`
  (issue #229), `contact-sidebar` e `group-sidebar` (as notas do lead ficavam
  fora de alcance).
- ⚠️ **`scrollHeight` não inclui a borda, mas `style.height` sob `border-box`
  inclui.** Autosize de `<textarea>` que faça `el.style.height = scrollHeight`
  rouba a borda do espaço do texto e acende a barra de rolagem com UMA linha
  digitada. Some a borda de volta: `el.offsetHeight - el.clientHeight` (medido
  com `height: auto`). É o que `message-composer.tsx` faz — é o único autosize
  do repo; os outros `<textarea>` têm `rows` fixo.
- ⚠️ **`max-width` NÃO se herda, e `align-items: flex-start` dimensiona o
  filho por `fit-content`.** A bolha do fio (`message-bubble.tsx`) mora dentro
  de um `flex flex-col items-start`, cujo pai já carrega o teto de 75% do
  `<MessageActions>`. O teto funcionava — medido, o pai resolvia em 355px —, e
  a bolha saía com **1040px** assim mesmo, porque `flex-start` a dimensiona
  pelo conteúdo e nada a limitava: uma URL sem espaços
  (`https://pje.tjce.jus.br/…`) vazava para fora e acendia **barra horizontal
  na conversa inteira** (contêiner 505px, `scrollWidth` 1056px). A cura é
  `max-w-full` NA BOLHA. ⚠️ E o `break-words` do `<FormattedText>` não
  salvava: ele só parte a palavra quando ela NÃO CABE — sem teto, cabia
  sempre. Reportado da tela pelo operador em 2026-09-01. **Vale para qualquer
  filho de flex alinhado com `items-start`/`items-end` que possa receber texto
  de fora**; `truncate` também depende disso (nome de anexo longo estouraria
  igual).
- ⚠️ **Filho direto do `DialogContent` precisa de `min-w-0` quando carrega
  texto com `truncate`.** O `DialogContent` é `grid`, e item de grid nasce
  com `min-width: auto`; `truncate` é `nowrap`, então o intrínseco do filho
  vira a largura do TEXTO INTEIRO numa linha — medido no dialog de executar
  automação: card com 448px e conteúdo com 1124px, a busca atravessando a
  tela. O `min-w-0` no wrapper direto devolve o clamp e o `truncate` volta a
  funcionar. (Primo do caso `<ScrollArea>`/flex acima — mesma família:
  `min-width: auto` anulando o limite do pai.)

⚠️ **QUEM ABRE NEGÓCIO: os dois sentidos da conversa, decididos por GENTE.**
Até 2026-08-31 só a mensagem RECEBIDA chamava `routeContactToPipeline` (que
até então se chamava `routeInboundToPipeline`). Medido em produção naquele
dia: **1.041** mensagens da equipe saíram pelo celular pareado contra **8**
digitadas dentro do CRM — o caminho por onde o escritório realmente trabalha
nunca abria negócio, e cliente que nunca respondeu ficava fora do funil para
sempre. O que morde código novo:

- ⚠️ **O gancho do ENVIO mora no NÚCLEO (`sendMessageToConversation`), e é a
  escolha do LUGAR que define a regra.** Por ali passam os quatro envios de
  gente: compositor, ficha do contato, agendada e API v1. Broadcast
  (`src/lib/whatsapp/broadcast-core.ts` e `broadcast-resume.ts`) e
  automação/fluxo/IA **não passam** — e é assim que ficam de fora sem uma
  linha de guarda. ⚠️ **Há DOIS `meta-send.ts`**: o sender REAL do robô é
  `src/lib/flows/meta-send.ts` (fluxo, resposta de IA e mídia de automação
  saem por ele); `src/lib/automations/meta-send.ts` é só um wrapper que
  delega para ele. Uma versão desta nota citava "meta-send.ts" sem caminho e
  o teste estrutural passou a vigiar o wrapper — o sender real ficou
  descoberto (achado #14 do plano de 31/08). Um disparo para 500 contatos
  abriria 500 cards de uma vez; "o robô respondeu" não é o escritório
  decidindo abordar ninguém.
  ⚠️ O teste estrutural (`pipeline-routing.chamadores.test.ts`) agora tem
  uma varredura DEFAULT-DENY: quem citar `routeContactToPipeline` ou
  `sendMessageToConversation` fora da allowlist explícita reprova por
  padrão — sender novo entra na allowlist por decisão visível no diff, não
  por esquecimento. "Reusar o núcleo de envio no broadcast" parece limpeza
  de código e traz o roteador junto, escondido.
- ⚠️ **Via `supabaseAdmin()` no núcleo**, como o carimbo de canal ao lado: a
  rota `/api/whatsapp/send` entrega o client do OPERADOR (sob RLS), e o
  roteador lê `accounts` e escreve em `deals` — sob RLS um `agent` deixaria
  de abrir card em silêncio.
- **Abrir conversa NÃO cria negócio** (decisão do operador): o card nasce no
  primeiro ENVIO. Número digitado errado viraria card no funil para alguém
  caçar e apagar à mão. Ver `POST /api/cb/conversas/abrir`.
- **Não houve migration de recuperação**, de propósito: o gatilho é por
  ESTADO ("este contato já tem card?"), então as conversas que ficaram sem
  card se resolvem sozinhas na próxima mensagem trocada, em qualquer sentido.

⚠️ **Iniciar conversa pelo CRM (`POST /api/cb/conversas/abrir`).** Botão no
cabeçalho da lista do inbox → `nova-conversa-dialog.tsx`. ABRE, não envia:
cria/reencontra contato e conversa, **FIXA** o canal escolhido
(`pinConversationChannel`, não `follow` — quem clicou escolheu) e devolve o
id; a página recarrega a lista e navega por `?c=`. O que morde código novo:

- ⚠️⚠️ **`contacts.user_id`, `conversations.user_id` e `custom_fields.user_id`
  são `ON DELETE CASCADE` para `auth.users`, e `conversations.contact_id`
  cascateia de novo.** Todo caminho que CRIA contato, conversa ou campo grava
  o **dono da conta** (`accounts.owner_user_id`, NOT NULL — no client vem de
  `useAuth().ownerUserId`), nunca o membro que clicou — senão, no dia em que o
  LOGIN dessa pessoa for apagado, o contato é apagado junto e leva a conversa
  e TODAS as mensagens daquele cliente, que são do escritório. ⚠️ O gatilho
  NÃO é "remover da equipe" pela UI (`remove_account_member` e a 961 só
  realocam o perfil, sem tocar `auth.users`): é apagar o usuário FORA do app —
  dashboard do Supabase ou admin API, o passo normal de offboarding. Isso já
  nasceu errado três vezes (rota de abrir no #79; `/api/whatsapp/send`,
  formulário/CSV e o CSV do broadcast até o plano de 31/08): a tela tem o
  `user` em mão, `user_id: user.id` parece óbvio, passa no typecheck e
  funciona. Sem o dono resolvido a criação FALHA — nunca cair para `user.id`.
  Há varredura estrutural de `src/**` com allowlist exata
  (`src/lib/contacts/dono-duravel.test.ts`) porque isto volta.
  ⚠️ **E a POSSE também precisa ser durável (971).** `accounts.owner_user_id`
  é `ON DELETE RESTRICT`: o dono vigente nunca é apagável do `auth.users` —
  o primeiro dia em que um ex-dono pode ser apagado é o dia seguinte à
  transferência, e tudo que a conta carimbou com ele no mandato iria junto.
  Por isso `transfer_account_ownership` REPARENTA `contacts`,
  `conversations` e `custom_fields` para o novo dono na mesma transação
  (Codex, PR #90). SÓ essas três, de propósito: `tags`, `message_templates`,
  `pipelines`, `automations`, `flows`, `broadcasts` e cia. têm o MESMO
  CASCADE, mas guardam quem CRIOU e telas do upstream ainda filtram por
  essa coluna — mover mudaria o que cada pessoa vê; é decisão de produto
  pendente (M24 do plano de 31/08), não carona.
- ⚠️ **Selecionar a conversa recém-aberta NÃO pode depender do `?c=`.** O
  refetch (`resyncToken`) e o `router.replace` saem juntos, e se a consulta
  voltar antes de a navegação propagar os searchParams, `deepLinkConvId`
  ainda tem o valor ANTIGO — a conversa nova não é selecionada e nada se
  recupera depois, porque o efeito da lista só reage a `resyncToken`. Fica a
  URL apontando para a conversa certa com o centro VAZIO. Por isso existe
  `conversaRecemAbertaRef` na página do inbox, consumida antes do caminho de
  deep link. (Também do Codex no #79 — o fluxo passou no teste manual porque
  a navegação costuma ganhar a corrida.)
- ⚠️ **O teto de 15 dígitos é load-bearing.** `findExistingContact` casa
  pelos ÚLTIMOS 8 DÍGITOS com tolerância a tronco, então um JID de grupo
  (~18 dígitos) colado no campo poderia FUNDIR com o celular de um cliente
  real. `isValidE164` barra nos dois lados (tela e rota).
- **Reusa `findExistingContact`**, não uma busca própria: sem isso, digitar
  o número com o nono dígito quando o cliente já existe sem ele criaria uma
  segunda ficha, cada uma com metade do histórico.
- **A conversa nasce sem `last_message_at`** e, com `nullsFirst: false`, vai
  para o FIM da lista até a primeira mensagem. Ela abre selecionada e a
  busca a encontra ("Nenhuma mensagem ainda"), mas quem mexer na ordenação
  precisa saber que existe conversa legítima com a coluna nula.
- **A rota confere POSSE do canal, não escopo de perfil** — nenhuma rota
  deste projeto valida `canalNoEscopo` hoje. Ver o comentário no arquivo.

⚠️ **Negócio (`deals`) só nasce por `src/lib/deals/create-deal.ts` no servidor.**
A 908 deu à conexão um funil padrão, e o roteador de entrada
(`src/lib/cb-channels/pipeline-routing.ts`) seria o terceiro escritor de deal
— por isso a regra foi consolidada num módulo só. Quem for criar negócio em
código novo chama `createDeal`, não `.from('deals').insert(...)`. O formulário
da tela de Funis é a exceção (roda no client, sob RLS).

Coisas da 908 que mordem código novo:

- **A etapa de entrada é explícita (`default_stage_id`), nunca `MIN(position)`.**
  O funil real desta conta tem `position` 0 = "Contato Avulso" e 1 =
  "Desqualificado"; a entrada é "Lead", na 2. Resolver por posição despeja o
  cliente numa faixa de estacionamento — e com negócio parado lá,
  `deals_stage_pipeline_fkey` (NO ACTION) trava reestruturar aquela etapa.
- **As FKs de `deals` para funil/etapa/canal são COMPOSTAS** (`(pipeline_id,
  account_id)`, `(stage_id, pipeline_id)`, `(channel_id, account_id)`), na
  mesma forma que a 903 deu a `conversations`. A ingestão roda em service-role
  e ignora RLS: FK simples só garante "existe uma linha com esse id".
- **`deals.user_id` virou anulável com `ON DELETE SET NULL`.** Os cards
  automáticos pertencem todos ao dono da conta; o CASCADE anterior apagaria o
  funil inteiro se essa pessoa saísse do `auth.users`.
- **`deals.contact_id` é NULLABLE** (a 001 diz NOT NULL, mas a 004 dropou), e
  `routeContactToPipeline` depende disso: sem a guarda `if (!contactId)`, uma
  conversa de grupo criaria card órfão que renderiza em branco no Kanban.
- O roteador dispara por **estado**, não por evento. `first_inbound_message`
  não serve: é contado por conversa e há uma conversa por contato por conta
  (036), então cliente que muda de número nunca dispararia.
- **`deals.channel_id` é do NASCIMENTO do card**, não de onde ele está agora.
  Recorte por canal responde "por qual número o cliente chegou". Negócio
  criado à mão fica com a coluna nula e some de qualquer filtro por canal —
  por isso a etiqueta do painel é "Originados neste número", não "Conta
  inteira".
- **`deals.conversation_id` passou a ser escrito (910).** A FK virou
  `(conversation_id, account_id)` com `ON DELETE SET NULL (conversation_id)`
  — antes era NO ACTION, e preencher a coluna fazia **apagar contato** e
  **remover membro da equipe** estourarem violação (os dois cascateiam em
  `conversations`). Quem for gravar essa coluna em código novo não precisa
  validar posse: a FK composta já barra conversa de outra conta.
- **Apagar funil ou etapa mexe em conexão.** `cb_channels.default_pipeline_id`
  e `default_stage_id` zeram via SET NULL, e o roteamento para em silêncio. A
  tela de Funis avisa; quem criar outro caminho de exclusão precisa avisar
  também. As funções `channelsUsingPipeline`/`channelsUsingStage` de
  `display.ts` respondem quem depende do quê.

⚠️ **Grupo de WhatsApp (906/916) NÃO é contato, e a distinção é load-bearing.**
`cb_groups` + `conversations.group_id`, com CHECK XOR contra `contact_id` (que
perdeu o NOT NULL). Só existe no transporte Evolution — a Cloud API da Meta não
entrega mensagem de grupo. O que morde código novo:

- **Nunca gravar grupo em `contacts`.** `findExistingContact` casa por LIKE nos
  ÚLTIMOS 8 DÍGITOS com `phonesMatch` tolerante a tronco; um JID de grupo tem
  ~18 dígitos e pode FUNDIR silenciosamente com o celular de um cliente real.
- **`conversations.contact_id` é NULLABLE.** Código novo que leia
  `conversation.contact.algo` precisa do caminho de grupo — hoje não há nenhum
  acesso não-opcional no repo, e vale manter assim.
- **Grupo não dispara automação, flow nem IA.** A garantia é ESTRUTURAL:
  `src/lib/cb-groups/persist.ts` não importa os motores, e há teste lendo o
  próprio fonte. Se um dia grupos entrarem nas automações, o import entra ali,
  visível na revisão — não atrás de uma flag.
- **A regra do `@lid` do 1:1 NÃO vale em grupo.** Lá o LID sem telefone é
  descartado para não criar contato falso; aqui o remetente é desnormalizado em
  `messages.group_sender_*`, sem FK e sem criar contato. Em produção 100% dos
  participantes chegam em `@lid`, então aplicar a regra do 1:1 esvaziaria o
  recurso.
- **`group/fetchAllGroups` da Evolution ESTOURA** (>90s com 58 grupos). Use
  `chat/findChats` filtrando `@g.us` — rápido e já traz nome e foto.
  `findGroupInfos` custa ~650ms/grupo e serve só para participantes, announce,
  admin e o nosso LID.
- **`GROUPS_UPDATE` não existe** na Evolution 2.3.2 e o enum recusa o pedido
  INTEIRO — incluí-lo derruba junto os eventos válidos da mesma lista.
  Assináveis: `GROUPS_UPSERT` e `GROUP_PARTICIPANTS_UPDATE`.
- **Ligar `cb_channels.groups_enabled` não basta**: instância já conectada só
  recebe os eventos novos depois de reaplicar o webhook ("Ressincronizar").
- **Menção chega em `@lid`, nunca em telefone** — daí `cb_channels.own_lid`
  (916), aprendido na 1ª mensagem nossa dentro de um grupo. Sem ele
  `messages.mentions_us` seria false para sempre.
- **`nullsFirst: false` na ordenação do inbox é load-bearing**: grupo
  sincronizado sem mensagem tem `last_message_at` NULL, e em DESC o Postgres
  põe NULL primeiro — 58 grupos vazios empurrariam as conversas ativas para
  baixo no instante em que o operador liga o recurso.
- **`CB_CHANNEL_SAFE_COLUMNS` precisa listar toda coluna de configuração** —
  fora dela o valor salva e some no reload (já mordeu com `default_agent_id`).
- **Insert em BLOCO preenche coluna ausente com NULL**, então `from_device` e
  `mentions_us` (NOT NULL) estouram se as linhas do lote não forem uniformes.
  O caminho de produção grava uma linha por vez e não é afetado.

✅ **RESOLVIDO (2026-08-27) — `maxDuration` NÃO é aplicado em produção.**
Conferido na VPS: `docker service inspect crm_crm` mostra Command/Args nulos e
o Dockerfile termina em `CMD ["node", "server.js"]` (standalone do Next) — o
`maxDuration` das rotas é decorativo aqui. **O teto real de cada rota de cron
é o `-m` do curl do agendador** (50s no laço rápido, 120s no lento; ver
`docker-stack.yml`). Quem escrever worker novo orça o ciclo contra o curl,
não contra o `maxDuration` — o worker do Radar faz isso (`TETO_ABSOLUTO_MS`).

⚠️ **A trilha de auditoria (912) é escrita por TRIGGER, não por código.**
`cb_lead_events` registra criação/exclusão de negócio, mudança de etapa, de
funil, de status e tag aplicada/removida. Foi para o banco porque há **6
escritores de `deals` e 9 de `contact_tags`**, metade no navegador direto
contra a tabela sob RLS — e porque já existiam dois helpers centrais de tag
(`tag-write.ts`, `tag-events.ts`) com **três** call sites de produção passando
por fora deles. O que morde código novo:

- **Não chame nenhum "logger" — não existe.** Insert/update/delete normal em
  `deals` ou `contact_tags` já gera o evento. Código que tentar gravar em
  `cb_lead_events` pelo cliente leva **42501**: `authenticated` só tem SELECT,
  e o REVOKE é essencial — sem ele um DELETE volta "0 linhas" (a RLS filtra) e
  parece ter dado certo.
- **Transferência entre funis tem de ser UM `UPDATE` só** (`pipeline_id` e
  `stage_id` juntos, como `deal-form.tsx` faz). Em dois updates a trilha grava
  duas linhas e conta a história errada: que o lead saiu e voltou.
- **A política de falha é assimétrica.** Erro ao gravar o evento **estoura**
  quando `auth.uid()` existe (ação de gente, erro aparece na tela) e é
  **engolido com WARNING** quando não existe (ingestão/automação) — porque
  `routeContactToPipeline` captura tudo e o lead simplesmente não viraria card,
  em silêncio.
- **`AFTER UPDATE OF pipeline_id, stage_id, status`** dispara quando a coluna é
  *mencionada*, mesmo sem mudar — e o formulário manda as três em todo save. O
  `IS NOT DISTINCT FROM` no topo do trigger é o que evita linha falsa a cada
  edição de anotação; não remova.
- **Rótulos são gravados junto com os IDs, de propósito.** Etapa que o lead já
  deixou pode ser apagada, e renomear reescreveria o passado em silêncio.
  `from/to_stage_position` existe para responder "foi avanço?" — comparar
  posição **entre funis diferentes** é comparar réguas distintas, e
  `direcaoDoMovimento` devolve `null` nesse caso.
- **`deal_deleted` não aparece no chat**, só na ficha: apagar um funil
  cascateia todos os negócios dele e despejaria uma linha solta em centenas de
  conversas sem relação. Linha `reconstructed` também fica fora do chat.
- **CHECK de forma não pode exigir `contact_id`**: apagar contato faz SET NULL
  nessa coluna, que é um UPDATE, e UPDATE revalida CHECK — exigir o contato
  faria a exclusão de contato falhar.

⚠️ **Fechar `EXECUTE` de função exige revogar de PUBLIC *e* dos papéis — e
conferir depois.** A forma da concessão **varia por função**, conforme o
`ALTER DEFAULT PRIVILEGES` que valia quando ela nasceu, e olhar só uma das duas
engana. Os dois formatos que existem hoje neste banco:

```
funções cb_* (901/903/912)
  {=X/postgres, postgres=X/postgres, service_role=X/postgres}
   ^^ `=X` sem papel antes do `=` é PUBLIC — `FROM anon, authenticated` não tira nada

merge_duplicate_* (upstream 022/036)
  {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...}
   ^^ concessão explícita por papel, sem PUBLIC — `FROM PUBLIC` não tira nada
```

Este erro já foi cometido **três** vezes: a 903 e a 912 revogaram só dos papéis
(sem efeito, cinco funções seguiram abertas até a **913**); a 914 revogou só de
PUBLIC (sem efeito, corrigido pela **915**). Escreva sempre as duas metades:

```sql
REVOKE EXECUTE ON FUNCTION minha_funcao(args) FROM PUBLIC, anon, authenticated;
SELECT has_function_privilege('anon', 'minha_funcao(uuid)', 'EXECUTE');  -- tem de dar false
```

- **Confira o resultado, nunca a intenção.** Só o teste pegou os dois enganos.
  `get_advisors(type: 'security')` também pega (lints 0028/0029), inclusive em
  função que retorna `trigger`.
- Revogar **não impede o trigger de disparar**: o privilégio é checado no
  `CREATE TRIGGER`, não a cada disparo. Verificado com escritas reais.
- `service_role` tem concessão explícita e não é atingido — o caminho
  server-side continua funcionando.
- ⚠️ **`SECURITY INVOKER` checa o privilégio de TUDO que roda dentro**, como o
  usuário que chamou. Fechar uma função auxiliar derruba a função principal
  para todo mundo logado — e o bloco de conferência da migration, que roda como
  DONO, **passa verde**. Quem escrever função `SECURITY INVOKER` nova precisa
  testar trocando de papel:
  ```sql
  DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.minha_funcao('x');
    RESET ROLE;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'authenticated não consegue executar: %', SQLERRM;
  END $$;
  ```
  Pego antes de aplicar na 929; sem esse bloco teria ido para produção verde.

⚠️ **Tabela `cb_*` nova nasce SEM nada para `anon` — e as antigas foram
fechadas na 931.** `REVOKE ALL ON TABLE ... FROM anon`, sempre. Não é teoria: a
901, a 906 e a 912 deixaram concessão aberta (a `cb_channels` chegava a dar
INSERT/UPDATE/DELETE ao `anon`), e a única coisa entre um pedido anônimo e o
dado era a RLS. Nunca houve vazamento — medido com `SET ROLE anon`, dava 0
linhas em todas —, mas era **uma** barreira onde as tabelas novas têm duas.
Confira as duas metades, como no caso das funções: que o `anon` perdeu, **e**
que `authenticated`/`service_role` não perderam.

⚠️ **A 903 removeu dois índices únicos.** `message_templates(user_id, name,
language)` e `ai_configs(account_id)` viraram pares de índices **parciais**
(global + por canal). Consequências que já morderam durante a implementação e
mordem de novo em qualquer código novo:

- **`.upsert(..., { onConflict })` não funciona mais nessas tabelas** — índice
  parcial não serve como alvo de `ON CONFLICT`. Use lookup + insert/update.
- **`.maybeSingle()` filtrando só por `account_id` estoura** assim que existir
  uma segunda linha (agente por canal, template homônimo em outro WABA).
  Toda consulta precisa escopar o canal, ou `.is('channel_id', null)` quando o
  alvo é explicitamente o padrão da conta.

## Branches — criação e nomenclatura

- **Toda branch nova sai única e exclusivamente de `main`** e faz merge **de
  volta para `main`** (via PR no CB-CRM). Nunca criar branch a partir de outra
  branch de feature nem do upstream.
- Nomenclatura: `<tipo>/<descricao-kebab-case>`, com `tipo` ∈
  `feat` · `fix` · `chore` · `docs` · `refactor`. (Mesma convenção do upstream.)
  Ex.: `feat/integracao-processos-tj`, `fix/webhook-duplicado`.
- `git checkout main && git pull origin main` **antes** de criar a branch, para
  sair do `main` atualizado.

## Workflow de migrations (Supabase)

- **Nomenclatura:** `NNN_descricao_snake_case.sql`, sequencial de 3 dígitos
  (o upstream está em `036`). ⚠️ **NÃO é timestamp.**
- ⚠️ **Evitar colisão de número com o upstream:** como o original também numera
  em sequência, se criarmos `037_...` e o upstream criar `037_...`, colidem no
  merge. **Nossas migrations próprias usam a faixa reservada `900+`** e prefixo
  `cb_` na descrição: `900_cb_<descricao>.sql`, `901_cb_...`. Assim ficam
  isoladas da numeração do upstream.
- ⚠️ **Exceção existente:** a integração Evolution criou
  `037_evolution_transport.sql` na sequência do upstream, não no `900+`. Já está
  aplicada e no `main` — **não renumerar**. É exceção conhecida; daqui em diante
  seguir o `900+`. Se o upstream um dia criar um `037_*`, resolver o conflito de
  número renomeando o **do upstream** no merge, nunca o nosso já aplicado.
  ✅ **Isso aconteceu no merge de 2026-08-26.** O upstream criou
  `037_webhook_broadcast_reliability.sql`, colidindo com a nossa. As **três**
  dele foram renumeradas — `037→040`, `038→041`, `039→042` — e não só a que
  colidia: a `041` dropa a função que a `040` cria, então a ordem relativa
  tinha de ser preservada. ⚠️ O Git **não** reporta essa colisão como
  conflito (são nomes de arquivo diferentes) — conferir à mão a cada merge.
  ⚠️ **Aplicadas até aqui** (última conferência: 2026-08-28, via Management
  API). A lista é acumulada e foi consolidada nesta data — antes tinha camadas
  repetidas com datas fora de ordem:

  - **900–932** — as nossas até a agendada com mídia (`932`).
  - **933–937** — gatilho e ações de funil, lembrete por data, orquestração,
    batimento das automações.
  - **040/041/042** — as três do upstream renumeradas no merge de 2026-08-26.
  - **940–943** — broadcast com canal, radar de atendimento, índices do radar,
    transcrição de áudio.
  - **944_cb_tarefas** — painel de tarefas (PR #39).
  - **945_cb_agenda_de_reunioes** — agenda, Fase 1 (PR #40). Aplicada em
    2026-08-28 e registrada no histórico como `20260828183655`.
  - **946–947** — modelo do Radar e lembrete da reunião. ⚠️ A **947 está
    aplicada mas SEM registro no histórico** (função
    `cb_alvos_de_lembrete_reuniao` + índice conferidos no schema em
    2026-08-29) — é a segunda da lista da 037: o histórico não é fonte de
    verdade completa.
  - **948–951** — plano do painel do contato (948 chave/tipos de campo, 949
    categoria de traqueamento, 950 etapa com resultado) e **951_cb_nota_fixada**
    (fixar anotação por cliente, 2026-08-29).
  - **952_cb_lembrete_depois_de_realizada** — recria
    `cb_alvos_de_lembrete_reuniao` com `p_incluir_realizadas` (follow-up
    "depois" tem de aceitar reunião realizada) e alarga o índice parcial.
    Aplicada em 2026-08-30. ⚠️ DROP + CREATE, não REPLACE: parâmetro novo
    muda a assinatura e o REPLACE deixaria um overload ambíguo para o RPC.
  - **953_cb_acervo_de_midias** — acervo de mídias da conta (`cb_media_library`),
    aplicada em 2026-08-30.
  - **954_cb_acervo_so_admin_no_storage** — a guarda de papel do acervo também
    nas policies de Storage do `chat-media`. Aplicada em 2026-08-30.
  - **955_cb_robo_parado_pela_equipe** — `stopped_by_agent` no CHECK de
    `flow_runs.status` (parada DECIDIDA por gente, via aba da conversa).
    Aplicada em 2026-08-30.
  - **956_cb_perfis_de_acesso a 962_cb_papel_segue_o_perfil** — perfis de
    acesso, Fases 1–6 (PR #69). Aplicadas em 2026-08-30.
  - **963_cb_conversa_aberta** — presença por conversa (tabela + RPC +
    realtime). Aplicada em 2026-08-30. ⚠️ NASCEU como `956` e COLIDIU com a
    `956_cb_perfis_de_acesso` (duas branches em paralelo); o replay do CI
    estoura com número duplicado, então o ARQUIVO foi renumerado no merge —
    o da presença, porque as 957–962 dependem da de perfis. O histórico do
    Supabase não muda (registra por timestamp), mesmo caso da 906.
  - **964_cb_disparo_e_regras_so_admin** — as 12 policies de ESCRITA de
    `automations`, `automation_steps`, `flows`, `flow_nodes`, `broadcasts` e
    `broadcast_recipients` passam de `'agent'` para `'admin'`, alcançando a
    decisão que a Fase 2 dos perfis só tinha aplicado nas ROTAS. Aplicada em
    2026-08-31. SELECT continua aberto a qualquer membro da conta.
  - **965_cb_transferencia_limpa_perfil** — `transfer_account_ownership`
    (018) passa a limpar `perfil_id` ao promover o novo dono: o caminho da
    transferência ficara fora da 962 e deixava a divergência papel×perfil
    presa num owner, irremovível pela UI. Aplicada em 2026-08-31.
  - **966_cb_grupos_de_campos** — blocos de campos personalizados
    (`cb_grupos_de_campos` + `custom_fields.grupo_id`/`posicao` + as duas RPCs
    de ordenação). Aplicada em 2026-08-31. ⚠️ NASCEU como `965` e COLIDIU com
    a `965_cb_transferencia_limpa_perfil` — o TERCEIRO caso de duas branches
    em paralelo (depois da 906 e da 963), e o mais instrutivo: as duas foram
    APLICADAS no mesmo banco com 15 minutos de diferença, então o histórico do
    Supabase tem duas entradas `965` e nenhum comando reclamou. O `git merge`
    também passou limpo — são nomes de arquivo diferentes, então não há
    conflito para o Git relatar. Quem pega é o replay do CI, depois. O ARQUIVO
    foi renumerado (o desta, porque a outra já estava no `main`); o histórico
    não se mexe, como na 906 e na 963.
  - **967_cb_filtros_salvos** — recorte nomeado da caixa de entrada
    (`cb_inbox_saved_filters`): DA CONTA, admin+ escreve e qualquer membro lê.
    Aplicada em 2026-08-31.
  - **968_cb_filtro_padrao** — qual filtro salvo abre a caixa de entrada DE
    CADA MEMBRO (`cb_inbox_filtro_padrao`, uma linha por pessoa por conta) +
    o único `(id, account_id)` em `cb_inbox_saved_filters` que a FK composta
    exige. Aplicada em 2026-08-31.
  - **969_cb_nome_do_anexo** — `messages.media_filename`: o nome do arquivo
    como o remetente o enviou. Aplicada em 2026-09-01. SEM backfill, de
    propósito (ver a seção "Nome do anexo").
  - **970_cb_indice_da_agendada_por_mensagem** — índice PARCIAL em
    `cb_scheduled_messages(message_id) WHERE message_id IS NOT NULL`, para
    a pergunta "esta mensagem nasceu de agendada?" do Radar (worker e
    painel). Aplicada em 2026-09-01.
  - **971_cb_transferencia_leva_o_acervo** — `transfer_account_ownership`
    reparenta `contacts`/`conversations`/`custom_fields` para o novo dono +
    backfill idempotente (medido: 0 linhas fora do dono em produção).
    Aplicada em 2026-09-01.

  ⚠️ **Não existe 938/939**, nem local nem no histórico — não "preencher" a
  lacuna: a numeração é cronológica, não densa.
  ⚠️ A `906` foi aplicada FORA DE ORDEM (antes da 907), e o histórico do
  Supabase a registra com o nome antigo `904_cb_grupos` — ela nasceu numerada
  como 904, colidiu com `904_cb_mensagem_do_aparelho` e o ARQUIVO foi
  renumerado para 906; a entrada no histórico não foi mexida de propósito, por
  ser metadado compartilhado com outra sessão ativa no mesmo banco.
  ⚠️ **Nunca deduzir o próximo número desta lista** — ela envelhece a cada
  branch em paralelo. Rodar `ls supabase/migrations/` **e** `list_migrations`
  imediatamente antes de criar o arquivo; os dois, porque já divergiram.
  ⚠️ A `037` é a **única** aplicada *sem* registro no histórico do Supabase: as
  colunas dela existem no banco (`whatsapp_config.provider`, `base_url`,
  `instance_name`, `api_key`, `instance_state`, …), mas `list_migrations` não a
  lista. Ou seja, **o histórico não é fonte de verdade completa** — para checar
  se algo foi aplicado, consultar o schema, não só o histórico.
- Criar o arquivo de migration **antes** de aplicar.
- ⚠️ **O projeto Supabase é `hxnhakmyxyhalbsktzwe`** (nome "CB CRM Whatsapp"),
  e é o `project_id` de toda chamada do conector. O ref sai do
  `NEXT_PUBLIC_SUPABASE_URL` do `.env.local`
  (`https://<ref>.supabase.co`) — tirar de qualquer outro lugar já custou uma
  sessão inteira de "permission denied" que **não era** falta de permissão, era
  ref errado.
- Aplicar em **ordem numérica** no projeto Supabase. Caminho preferido: o
  **conector MCP do Supabase** (`apply_migration` / `execute_sql`), que dispensa
  senha de banco. Alternativa: colar os SQL no **SQL Editor** em ordem. ⚠️ **Não**
  usar `supabase db push`: o histórico do projeto hoje tem as 001–036 do upstream
  mais `900`/`901`/`902` (conferido em 2026-07-24 via `list_migrations`), mas
  registradas com **version em timestamp** (`20260721164546` = `001_initial_schema`),
  que não corresponde ao prefixo `NNN_` dos nossos arquivos — o push não casaria
  local↔remoto e tentaria re-aplicar tudo. **Nunca** editar schema à mão pelo
  editor de tabelas da UI (causa drift).
- **Nunca renomear nem renumerar** migration já aplicada.
- Antes de criar nova, **validar drift** entre local e o projeto Supabase.

### ⚠️ Migration tem de aplicar num banco VAZIO, não só no nosso

Desde o merge do upstream de 2026-08-26 existe um CI (`pipeline.yml`, etapa
`Apply to a clean database`) que sobe um Postgres limpo e reaplica **todas** as
migrations em ordem, do zero. Antes dele, nenhum `.sql` deste repositório tinha
sido executado por CI nenhuma vez — as migrations foram escritas contra um banco
que já existia, e **nove delas reprovaram** na primeira execução real.

Foram só DUAS causas. Escrever migration nova sem cair nelas é a regra abaixo.

**1. Privilégio herdado do Supabase não existe em banco novo.**

Tabela criada por `postgres` no `public` recebe tudo para
`anon`/`authenticated`/`service_role` por um *default privilege* que o Supabase
configura (`pg_default_acl`). Isso é do AMBIENTE, não do nosso SQL. Num banco
criado do zero ele não se repete. Duas consequências, ambas já morderam:

- Uma conferência do tipo `IF NOT has_table_privilege('authenticated', …)`
  reprova, porque o privilégio nunca foi concedido por escrito.
- `REVOKE … FROM PUBLIC` numa FUNÇÃO tira o `EXECUTE` de quem dependia de
  PUBLIC — **inclusive do `service_role`**, já que em Postgres o EXECUTE de
  função nasce concedido a PUBLIC. Em produção não aparece; em banco novo, sim.

  ✅ **Regra:** todo privilégio que a migration CONFERE, ela tem de CONCEDER.
  Depois de qualquer `REVOKE`, escreva o `GRANT` de volta para quem precisa —
  em produção é no-op, e `GRANT` é idempotente. Não confie no ambiente nem para
  abrir nem para fechar.

  Exemplo (939 em diante, siga este formato):
  ```sql
  REVOKE EXECUTE ON FUNCTION cb_minha_rpc(uuid) FROM PUBLIC, anon, authenticated;
  -- O motor/cron chama com service_role, que perdeu o EXECUTE junto com PUBLIC.
  GRANT  EXECUTE ON FUNCTION cb_minha_rpc(uuid) TO service_role;
  ```

  ⚠️ Vale também para RLS: política avaliada com o privilégio de QUEM CHAMOU.
  A de `messages` consulta `conversations`, então `authenticated` precisa de
  `SELECT` nas duas. A cadeia para em `is_account_member`, que é
  `SECURITY DEFINER`.

**2. Conferência não pode exigir dado que só existe aqui.**

Várias conferências provavam mecânica usando dado de produção — uma busca pelo
literal `'docker'`, `count(*) >= 2` numa tabela, "a busca tem de achar a
mensagem de onde o termo saiu". Em banco vazio não há o que achar, e elas
reprovavam por falta de dado, não por defeito.

  ✅ **Regra:** conferência que precisa de dado deve DERIVAR o dado do banco e
  **pular quando não houver**, com `RAISE NOTICE`. Afirmar ausência
  (`IF EXISTS … THEN RAISE`) é sempre seguro — é verdade trivial num banco
  vazio. Afirmar presença é que quebra.

  ```sql
  SELECT substr(content_text, 1, 6) INTO v_termo FROM messages LIMIT 1;
  IF v_termo IS NULL THEN
    RAISE NOTICE 'NNN: banco vazio, nada a provar.';
  ELSE
    -- a prova de verdade
  END IF;
  ```

  Para "o DROP não levou nada junto", guarde a contagem ANTES numa **variável**
  do bloco e compare — nunca um número absoluto, e nunca `CREATE TEMP TABLE`
  (sem guarda ele estoura na segunda passada e quebra a idempotência).

**Como conferir antes de abrir o PR:** `supabase db start` na raiz do projeto
reaplica tudo do zero, igual ao CI. Exige Docker rodando e ~2 GB livres.

**O replay NÃO trava o deploy** — ver a nota em `pipeline.yml`. Ele é sinal, não
portão, justamente porque as migrations antigas ainda carregam essa dívida.

## i18n (armadilhas que já morderam)

O locale é **global e fixo**, vindo de `NEXT_PUBLIC_APP_LOCALE` no `.env.local`
(hoje `pt-BR`). `src/i18n/request.ts` importa `messages/<locale>.json`.

- ⚠️ **O fallback é por ARQUIVO, não por chave.** Se `pt-BR.json` existe mas
  falta uma chave, o app **não** cai para o inglês — ele dispara
  `MISSING_MESSAGE` e mostra a chave crua na tela. Portanto: **ao adicionar
  qualquer chave em `en.json`, adicione no `pt-BR.json` na mesma passada.**
- ✅ **Desde 31/08/2026 os dois scripts de i18n são PORTÃO no CI** (job
  `verificar`, antes de `test`/`build`). Antes deles, a chave usada-e-ausente
  não tinha guarda nenhuma (o `src/i18n/messages.test.ts` já gateava a
  PARIDADE no mesmo job — e mais rígido que o parity: reprova chave órfã —
  mas é cego para chave que falta nos DOIS dicionários): o console de
  produção despejava `Inbox.sidebar.tabTracking`, `noTrackingFields` e
  `seedTrackingFields` às dezenas. São dois porque respondem perguntas
  diferentes:
  - `i18n-parity.mjs` — a chave existe num dicionário e falta no outro?
    ⚠️ Chave SÓ no `pt-BR.json` é "inofensiva" para ele, mas o
    `messages.test.ts` REPROVA — a mensagem do script avisa isso desde a F6.
  - `i18n-chaves-usadas.mjs` — o código pede chave que não existe em
    dicionário NENHUM? ⚠️ **Este é o que faltava.** Durante aquele defeito a
    paridade estava VERDE (2673/2673): as três chaves faltavam nos dois
    arquivos, então os dicionários "concordavam" — em não ter.
  ⚠️ O segundo é análise estática de TEXTO e declara o próprio alcance a
  cada execução (literais conferidas, dinâmicas ignoradas, arquivos em modo
  folha) — e **tem testes próprios** (`scripts/i18n-chaves-usadas.test.ts`,
  fixtures via `I18N_CHECK_ROOT`; o vitest inclui `scripts/**`). Decisões
  que parecem detalhe e não são (recalibradas na F6 do plano 31/08, que
  mediu quatro modos de o portão mentir):
  - **Cobra contra TODOS os namespaces do arquivo, não contra o binding** —
    o tradutor viaja como prop (`<SeletorDeHorario t={tAgendadas}>`) e o
    parâmetro SOMBREIA o do módulo. Amarrado ao binding, acusava 7 chaves
    boas de faltantes no compositor. ⚠️ E "todos" inclui REDECLARADOS: dois
    `const t` com namespaces próprios acumulam (nome → Set), senão o último
    apagava o primeiro e chave válida reprovava (#19).
  - **`.raw` e `.markup` contam junto com `.rich`** — os três disparam
    MISSING_MESSAGE igual, e `t.raw` sozinho aparece 15 vezes no repo.
  - **Modo folha** para arquivo que RECEBE o tradutor e não declara binding
    (`flows/shared.tsx`, `message-media.tsx`): sem namespace, a chave é
    cobrada como SUFIXO de alguma chave do dicionário (último segmento
    reprovava `t('table.name')` válida, #20). Garantia mais fraca — e por
    isso o total sai impresso —, mas pular o arquivo inteiro era buraco:
    chave apagada dos dois dicionários mantinha o CI verde. ⚠️ Só o
    identificador `t` EXATO entra no modo folha: a forma antiga casava
    `twMerge(`/`toast(` e um literal neles reprovava o CI (#18).
  - **Verde exige COBERTURA, não só zero faltantes** (#24): piso de
    literais conferidas (`PISO_CONFERIDAS`; se reprovar, o defeito é o
    ALCANCE do script) e arquivo que importa o tradutor sem produzir
    binding nem uso reconhecível reprova nomeado — um alias
    (`useTranslations as useT`) tirava o arquivo da cobertura em silêncio.
    ⚠️ A guarda vale para TODO arquivo e conta CHAMADAS da fábrica, não a
    ausência de binding: para cada `useTranslations`/`getTranslations`
    importado em valor (alias incluso), toda chamada tem de ser `const t =
    …(…)` ou a invocação direta `…('NS')('chave')`; alias, envelope local
    (`function useTraducao(ns) { return useTranslations(ns) }`) ou chamada
    passada adiante reprovam com o nome e a contagem. Duas versões deixaram
    passar caso — a que só rodava sem `t(` folha (Codex, PR #91) e a que só
    rodava sem binding NENHUM, onde um `const t = useTranslations(...)`
    legítimo escondia o alias ao lado (Codex, PR #104). `import type {
    useTranslations }` (só para `ReturnType<typeof …>`, message-media.tsx)
    fica de fora — não há fábrica a cobrir — e é por isso que aquele import
    É `import type`: voltar a importar em valor reprova o portão. A guarda
    olha o fonte SEM comentários: um comentário que descreva a forma
    proibida logo acima do import real casava o regex (medido).
- ⚠️ **`t('chave')` sem `values` NÃO parseia ICU** — devolve a string crua.
  Erro `INVALID_TAG`/`MALFORMED_ARGUMENT` no console **não significa** tela
  quebrada: pode ser só ruído de log, com a renderização correta. Já
  removemos um `<strong>` que funcionava por confiar no log (commit `4e8f2c6`,
  revertido em `22b6d4f`). **Antes de "consertar" uma mensagem, compare o que
  `t()` devolve antes e depois.**
- Só **`t.rich(...)`** falha de forma visível (mostra o caminho da chave). Tags
  de rich text no dicionário **não podem ter atributos** (`<code>` sim,
  `<code className="...">` não) — o atributo vem do handler no componente.
- Rótulos que o operador vê **em inglês no painel da Meta** (`Phone Number ID`,
  `Access Token`, `Verify Token`, `Webhook Callback URL`) **não se traduzem** —
  traduzir torna as instruções de configuração inúteis.
- Chaves ICU literais (`{{1}}`, `{{name}}`, JSON de exemplo) precisam de aspas
  simples (`'{{1}}'`) para silenciar o log — mas isso é cosmético, a saída é a
  mesma.
- Datas/moeda: usar `toLocaleDateString(undefined, ...)`, **nunca** locale fixo
  (`'en-US'`), senão a data sai em inglês com o app em português.
- ⚠️ Coluna Postgres `DATE` (ex.: `expected_close_date`) chega como
  `"2026-05-18"`, e `new Date()` interpreta isso como **meia-noite UTC** — no
  Brasil retrocede um dia. Concatenar `T00:00:00` antes de parsear.
- **Achar texto da UI no código:** `node scripts/i18n-find.mjs "<texto>"` — faz
  os dois saltos (texto → chave → componente), já que buscar o texto em
  português só encontra o dicionário.
- Há ~11 componentes com texto **fixo em inglês**, sem i18n (o upstream os
  adicionou assim). Eles não passam pelo dicionário.

## Deploy

- ⚠️⚠️ **`git push origin main` DISPARA DEPLOY DE PRODUÇÃO.** O workflow
  `.github/workflows/pipeline.yml` roda a cada push no `main`: verifica
  (lint/typecheck/test/build), replaya as migrations num banco limpo e, com a
  etapa **`verificar`** verde — só ela; o replay de migrations é SINAL, não
  portão, e migration vermelha publica assim mesmo —, builda a imagem,
  publica no GHCR
  (`ghcr.io/leonardocabralb/cb-crm`) e faz rollout no serviço do **Docker Swarm
  da VPS** (`82.25.76.63` / `vps.cbadvogados.com`), atrás do **Traefik** (TLS
  Let's Encrypt). O rollout é `docker service update --image <repo>:<sha>` —
  guardar isso, é a raiz da armadilha do `CRM_IMAGE` mais abaixo. **Nunca dar
  push no `main` sem o operador saber que aquilo vai para produção.**
  ⚠️ Mesclar vários PRs seguidos NÃO gera um deploy por PR. O
  `cancel-in-progress` é `false` no `main` (run EM ANDAMENTO não é
  interrompido), mas o GitHub guarda só **um** run pendente por grupo de
  concorrência: o do meio é cancelado ainda na FILA. Observado em 2026-08-29
  ao mesclar #43, #45 e #46 em sequência — o run do #45 morreu na fila. O
  resultado fica correto (o último run constrói a partir do `main` já com
  todos), mas os merges do meio não têm run próprio, e o histórico de
  Actions passa a mentir sobre o que foi publicado quando.
- Domínio: `crm.cbadvogados.com`. ✅ O cutover de DNS **já foi feito** (conferido
  em 2026-07-25): `crm.cbadvogados.com` → `vps.cbadvogados.com` → `82.25.76.63`,
  respondendo 200 com TLS do Traefik. Ou seja, o domínio público serve a VPS —
  **o push no `main` atinge usuário real**, não mais um serviço isolado.
- ⚠️ **`NEXT_PUBLIC_APP_LOCALE` é build-arg, não env de runtime.** Como todo
  `NEXT_PUBLIC_*` é inlinado no bundle **em tempo de build**, editar o `crm.env`
  da VPS **não** muda o idioma — é preciso alterar `pipeline.yml`/`docker-stack.yml`
  e **rebuildar a imagem**. Isso já mordeu: até 2026-07-25 os dois arquivos
  fixavam `en` e a produção inteira servia inglês, enquanto o dev local (que lê
  `.env.local`, com `pt-BR`) parecia certo. Ao investigar "produção está
  diferente do meu local", checar build-arg antes de env de runtime.
- Segredos de runtime vivem em `crm.env` **na VPS** (fora do git), espelhando o
  `.env.local`. A Evolution API roda como serviço `evolution_evolution` no mesmo
  Swarm.
- ⚠️⚠️ **`docker stack deploy` SEM carregar o `crm.env` ZERA TODOS os segredos
  de produção — e o site continua respondendo 200.** O `docker-stack.yml` usa
  `${VAR}`, que o Docker substitui pelo **ambiente do shell**: variável ausente
  vira **string vazia**, sem erro nem aviso. O front sobrevive porque todo
  `NEXT_PUBLIC_*` foi inlinado no build, então a tela de login pinta normal
  enquanto o servidor inteiro está sem credencial — webhook não grava mensagem,
  envio não sai, IA não roda, e **as quatro rotas de cron passam a devolver 503**
  (`if (!expected) return 503`), o que derruba agendadas, automações, fluxos e
  Radar de uma vez. Aconteceu em 2026-08-27 e passou despercebido por horas
  porque as verificações usuais (site 200, digest da imagem intocado) **não
  cobrem env vars**. A forma correta, sempre as três linhas juntas:
  ```bash
  set -a; . /root/crm.env; set +a          # sem isto, tudo vira ""
  export CRM_IMAGE="$(docker service inspect crm_crm \
    --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)"  # senão volta para :latest
  docker stack deploy -c /root/docker-stack.yml crm
  ```
  ⚠️ **A imagem sai de `.Spec.TaskTemplate.ContainerSpec.Image`, NUNCA do
  rótulo `com.docker.stack.image`.** Esse rótulo só é reescrito por
  `docker stack deploy`; o CI publica com `docker service update --image`
  (`pipeline.yml`), que não o toca — então ele guarda a imagem do último
  deploy MANUAL e envelhece a cada merge. Medido em 2026-08-29, minutos
  depois de um deploy pelo CI: o rótulo dizia `30bf0b6` (PR #37, dois dias e
  **dez merges** atrás) enquanto o serviço rodava `823061a`. Pinar pelo
  rótulo aqui **rola a produção para trás em silêncio** — e esta é
  justamente a receita que se roda quando algo já está quebrado. O
  `docs/DEPLOY-VPS.md` já usava o campo certo; era esta seção que estava
  fora de passo.
  **Conferir DEPOIS, dentro do container** (o spec do serviço engana — mostra o
  nome da variável mesmo com valor vazio):
  ```bash
  cid=$(docker ps --filter name=crm_crm --format '{{.ID}}' | head -1)
  docker exec $cid printenv SUPABASE_SERVICE_ROLE_KEY | wc -c   # 0 = quebrado
  curl -s -o /dev/null -w '%{http_code}\n' https://crm.cbadvogados.com/api/cb/scheduled/cron
  # 401 = segredo no lugar · 503 = env vazia, produção cega
  ```
- Arquivos: `Dockerfile`, `docker-stack.yml`, `.github/workflows/pipeline.yml`,
  `docs/DEPLOY-VPS.md`. (Trazidos pela integração da Evolution — ver abaixo.)
- Restrição fixa: o webhook do WhatsApp **exige HTTPS** — o endpoint precisa de
  URL pública com SSL (o Traefik resolve isso na VPS).

## Integrações externas

**Sempre que mexer em integração externa, atualizar a doc visível ao usuário na
mesma passada** (help/config no app, `docs/`, ou README do módulo). Doc obsoleta
= bug latente.

- **Meta Cloud API (WhatsApp Business):** webhook em `src/app/api` valida
  assinatura HMAC-SHA256 com `META_APP_SECRET` (sem ele, rejeita todo request).
  Tokens do WhatsApp são gravados criptografados (AES-256-GCM) com
  `ENCRYPTION_KEY` — **rotacionar essa chave invalida todos os tokens salvos**.
- **Supabase:** Postgres + Auth + Storage + RLS. `SUPABASE_SERVICE_ROLE_KEY`
  ignora RLS e só pode ser usada em código server-side (webhook, automações,
  auth da API pública). Nunca no client.
  ⚠️ **`cb_channels` está na publicação realtime com LISTA FIXA de colunas**
  (a 909 fez `ADD TABLE cb_channels (…)`; medido em `pg_publication_rel.prattrs`
  em 2026-08-30): coluna adicionada depois disso NÃO viaja no realtime. Hoje
  nada assina essa tabela (`use-channels` é fetch único) — quem for assinar
  `cb_channels` no futuro precisa reescrever a entrada na publicação. As
  demais tabelas publicadas (ex.: `cb_conversation_notes`) estão sem lista
  (todas as colunas).
- **Assistente de IA:** bring-your-own-key (OpenAI/Anthropic/Gemini, desde a
  941) — cada conta cola sua chave em Settings → AI Assistant, guardada
  criptografada com `ENCRYPTION_KEY`. Não há env var global de provider.
  Embeddings (RAG) continuam exigindo chave OpenAI (modelo fixo, vector 1536).

## Antes de aplicar mudanças

- [ ] Está no Node do `.nvmrc` (`nvm use` na raiz)? Rodar teste numa major
      diferente da do CI é como o PR #66 passou aqui e reprovou lá.
- [ ] Estamos numa branch derivada de `main`? Não commitar direto no `main`.
- [ ] Branch criada a partir de `main` atualizado (`git pull origin main`)?
- [ ] Se mexer em schema: migration na faixa `900+`/`cb_` e check de drift.
- [ ] A migration aplica num banco **VAZIO**? Todo `REVOKE` tem `GRANT` de volta
      para quem precisa, e nenhuma conferência exige dado que só existe aqui?
      (Ver "Migration tem de aplicar num banco VAZIO".) Conferir com
      `supabase db start`, que é o que o CI faz.
- [ ] Não commitar `.env.local` (confirmar com `git status`).
- [ ] Rodar `npm run typecheck` e `npm run lint` antes de finalizar.

## Não faça

- ❌ **Abrir PR para qualquer branch de `ArnasDon/wacrm` (upstream).** PR só para
  branch do CB-CRM. (Regra de ouro 1.)
- ❌ **Criar branch de desenvolvimento a partir de algo que não seja `main`.**
  (Regra de ouro 2.)
- ❌ Cravar a major do Node no `pipeline.yml` (`node-version:`) em vez de
  deixá-la sair do `.nvmrc` — é assim que CI e máquina voltam a divergir.
- ❌ Commitar direto no `main` sem passar por branch de feature.
- ❌ `git push` no `upstream` (é read-only).
- ❌ Numerar migration nossa na sequência do upstream (`037`, `038`…) em vez da
  faixa reservada `900+`.
- ❌ Renomear/renumerar migration já aplicada.
- ❌ Conferir privilégio numa migration sem tê-lo CONCEDIDO ali. O que vem do
  *default privilege* do Supabase não existe em banco novo — nove migrations
  nossas reprovaram por isso na primeira vez que o CI as reaplicou do zero.
- ❌ Conferência de migration que exige DADO presente (busca por literal,
  `count(*) >= N`). Em banco vazio ela reprova por falta de dado, não por
  defeito. Derive o dado e pule com `RAISE NOTICE` quando não houver.
- ❌ Aplicar mudança de schema pela UI de tabelas em vez do comando canônico.
- ❌ Usar `SUPABASE_SERVICE_ROLE_KEY` em código client-side.
- ❌ Rotacionar `ENCRYPTION_KEY` sem avisar (invalida tokens do WhatsApp).
- ❌ Usar `--no-verify` em commits sem permissão explícita.
- ❌ Reescrever arquivo do core quando dá para isolar em módulo novo.

## Comandos úteis

```bash
nvm use              # entra no Node do .nvmrc (22) — ANTES de tudo
npm run dev          # servidor de desenvolvimento (localhost:3000)
npm run build        # build de produção
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run format       # prettier --write
```
