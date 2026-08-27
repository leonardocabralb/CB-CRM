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
deploy** (`Dockerfile`, `docker-stack.yml`, `.github/workflows/deploy.yml`,
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
- ⚠️ **Um workflow só: `.github/workflows/pipeline.yml`.** O `ci.yml` e o
  `migrations.yml` eram DO UPSTREAM e foram removidos; as três etapas
  (verificar → migrations → deploy) viraram jobs de um arquivo nosso, com o
  `deploy` dependendo das outras duas. Antes os três rodavam **em paralelo** no
  push do `main`, e o cabeçalho do deploy dizia "after CI passes" sem que
  existisse `needs:` — um CI vermelho não impedia a publicação. **Todo merge do
  upstream vai trazer `ci.yml` e `migrations.yml` de volta: apagar de novo**, ou
  as etapas passam a rodar duas vezes por push.

- **`src/i18n/messages.test.ts` checa `pt-BR`, não `ko`.** O upstream o escreveu
  para `ko`, que não servimos; deixar assim daria um teste permanentemente
  vermelho sobre um idioma que ninguém usa. Ao mesclar, ele volta com `['ko']`.

⚠️ **Vários arquivos do upstream ganharam mudanças NOSSAS para o multi-canal —
cuidado no merge.** Ao mesclar upstream, manter os nossos trechos e não deixar o
upstream sobrescrevê-los:

| Arquivo do upstream | O que é nosso |
| --- | --- |
| `src/lib/whatsapp/send-message.ts` | resolve o canal, carimba `channel_id`, devolve `channelId` no resultado, busca o template **filtrando por canal**, e os dois parâmetros da agendada (925): `channelId` (exige aquele canal, **falha fechada**) e `pauseFlows` |
| `src/components/inbox/message-composer.tsx` | anotação interna (918) e o **agendamento** (925): o relógio abre um seletor, e com hora escolhida o `handleSend` DESVIA antes da janela de desfazer. Mais a 932: `sendDraft` desvia igual (anexo agendado), o seletor virou `<SeletorDeHorario>` de módulo — reusado dentro do `MediaDraftPreview`, que SUBSTITUI o compositor — e `entreguesRef` impede a limpeza de desmonte de apagar arquivo que já é de uma agendada |
| `src/lib/whatsapp/send-message.ts` (2ª linha nossa) | a 932 separou `evolution_rejected` (4xx: a Evolution recusou, nada saiu) de `evolution_error` (tempo esgotado/5xx: pode ter saído). Só o segundo vira `entrega_incerta` |
| `src/components/inbox/message-thread.tsx` | além do fio intercalado, renderiza a faixa `ScheduledBar` logo acima do compositor e guarda o contador que a liga ao compositor |
| `src/app/api/whatsapp/webhook/route.ts` | carimba `channel_id` na entrada; varre `cb_channels` na verificação (GET); escopa o ACK por canal; passa `channelId` a flows/automações/IA |
| `src/lib/whatsapp/inbound-store.ts` | idem, no lado Evolution |
| `src/lib/automations/engine.ts` | `channelInScope`, condição `channel`, canal de saída por passo, e o `create_deal` que agora **lê o erro do insert** (antes devolvia `'deal created'` incondicionalmente) |
| `src/app/api/whatsapp/webhook/route.ts` e `src/lib/whatsapp/inbound-store.ts` | além do carimbo de canal, a chamada de uma linha a `routeInboundToPipeline` no fan-out. ⚠️ São **dois** call sites porque não há função compartilhada de abrir conversa — enxertar só num deles faz a feature valer só num transporte, e produção roda Evolution |
| `src/lib/flows/engine.ts` | `findEntryFlow` por canal, `flow_runs.channel_id`, try/catch nos nós interativos |
| `src/lib/ai/{auto-reply,config,knowledge,usage}.ts` | agente por canal, interruptor, RAG por canal |
| `src/lib/whatsapp/broadcast-core.ts` + rotas de template | `resolveMetaChannel` no lugar do espelho |
| `src/lib/api/v1/conversations.ts`, `src/lib/api-keys/scopes.ts` | `channel_id` nos serializers, escopo `channels:read` |
| `src/components/automations/automation-builder.tsx`, `src/components/flows/{flow-builder,flow-editor-state}.tsx` | escopo de canal editável (multi-select / select), canais no contexto do editor, validação de canal no cliente |
| páginas de `automations`, `flows`, `broadcasts`, `dashboard` | etiqueta e filtro de canal, coluna de canal nos históricos, filtro do painel |
| `src/components/broadcasts/step{1,4}-*.tsx`, `src/hooks/use-broadcast-sending.ts` | canal escolhido no passo 1, `channel_id` no corpo da API e na linha de `broadcasts` |
| `src/components/settings/template-manager.tsx` | seletor de WABA para criar/sincronizar, etiqueta de canal por modelo |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx` | canal no primeiro contato, canal da conversa na ficha, e a seção/aba **Histórico** (912). No detail view a `TabsList` ganhou `flex-wrap h-auto` — com 5 abas ela já estourava a largura do painel e escondia "Negócios" |
| `src/components/inbox/message-thread.tsx` | `groupMessagesByDate` virou `groupTimelineByDate`, sobre mensagens **e** eventos do lead intercalados (`intercalar`), e o laço de render passou a ramificar em `item.evento` |
| `src/components/inbox/conversation-list.tsx` | ⚠️ **praticamente reescrito** (924): todo o recorte saiu para `src/lib/inbox/filtros.ts`, a barra de filtros virou `<InboxFilters>`, e cada linha ganhou a estrela de favoritar. Num merge do upstream, esperar conflito grande e **manter a nossa versão**, levando só o que for novo dele. Mais o `onTermoDeBusca`, que espelha o termo assentado para a página |
| `src/components/inbox/message-thread.tsx` | o **salto da busca**: `<LinhaDaMensagem>` envolvendo as duas formas de bolha (a comum e o aviso de sistema do grupo), a faixa "2 de 5" com ↑/↓, os efeitos de centralizar/suprimir e o `saltoAtivoRef` |
| `src/app/(dashboard)/inbox/page.tsx` | espelha o termo da busca da lista para o fio — são irmãos, e a página é o único caminho entre eles |
| `src/lib/dashboard/queries.ts`, `src/components/dashboard/metric-card.tsx` | filtro por canal (parcial) e marca "conta inteira" |
| `src/app/api/automations/[id]/duplicate/route.ts` | copia `channel_ids` (sem isso a cópia vira irrestrita) |
| `src/app/api/cb/channels/[id]/route.ts` (DELETE) | barra a exclusão quando há agendada na FILA e limpa o acervo — a FK da 925 é RESTRICT |
| `src/components/pipelines/pipeline-board.tsx`, `src/app/(dashboard)/pipelines/page.tsx` | o painel por etapa (Fase 5): o raio com contador no cabeçalho da coluna e a carga das automações de funil |
| `src/app/(dashboard)/automations/new/page.tsx` | o `?stage=` que faz a automação nascer com o gatilho de funil já apontando para a etapa clicada |
| `src/lib/automations/trigger-meta.ts` | `formatRelative` passou a usar `Intl.RelativeTimeFormat` e a receber o texto de "nunca" — devolvia `5m ago`/`never` em inglês nas três telas |
| `src/lib/ai/types.ts`, `generate.ts`, `defaults.ts`, `config.ts`, `usage.ts`, `providers/` | o TERCEIRO provedor (`gemini`, 941) e o modo `'radar'` no log de uso — o upstream conhece só openai/anthropic. `structured.ts` e `providers/gemini.ts` são arquivos NOSSOS |
| `src/components/settings/ai-config.tsx`, `src/app/api/ai/config/route.ts` | a opção Gemini no seletor e na validação do provider |
| `src/components/settings/cb-channels-panel.tsx`, `src/app/api/cb/channels/[id]/route.ts`, `src/lib/cb-channels/repo.ts` | o toggle `radar_enabled` por canal (dialog, PATCH allowlist e SAFE_COLUMNS) |
| `src/components/layout/sidebar.tsx`, `header.tsx`, `src/middleware.ts` | a aba `/radar` (item de navegação, título do cabeçalho e rota protegida) |

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
  código novo confere `data === false` antes do `error`.**
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
- **Escopo vazio = TUDO**, igual ao resto do projeto: `FILTROS_VAZIOS` não
  recorta nada, e "sem responsável"/"sem negócio" são opções explícitas, não
  a ausência de filtro.
- **Filtro cujo dado não carregou some da tela.** Um seletor sem os dados por
  trás não fica inerte: ele responde ERRADO com cara de certo (o de etapa
  chegaria a dizer que 55 negócios não existem). Cada busca do painel tem
  sinalizador próprio.

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
  avaliação pela aba Network. Barreira real (pendente, migration `943`):
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
- ⚠️ **Toda escrita pós-claim do worker tem CERCA DE POSSE**
  (`.eq('status','running').eq('running_desde', <carimbo do próprio claim>)`).
  Sem ela, um worker recolhido como travado continuava com direito de escrita
  e atropelava a análise seguinte. E **"mensagem nova" exige `janela_fim` NÃO
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
  `routeInboundToPipeline` depende disso: sem a guarda `if (!contactId)`, uma
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
  `routeInboundToPipeline` captura tudo e o lead simplesmente não viraria card,
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
  ⚠️ Aplicadas até aqui (conferido em 2026-07-27 via `list_migrations`):
  `900`, `901`, `902`, `903_cb_multicanal`, `904_cb_mensagem_do_aparelho`,
  `904_cb_grupos` (⚠️ **número 904 DUPLICADO** — o arquivo local foi
  renumerado para `906_cb_grupos.sql` numa branch, mas o histórico do banco
  guarda o nome antigo), `905_cb_mensagem_apagada_editada`,
  `907_cb_exclusao_solicitada`, `908_cb_funil_por_canal`,
  `909_cb_saude_das_conexoes`, `910_cb_negocio_e_conversa`,
  `911_cb_um_funil_por_vez`, `912_cb_historico_de_atividade`,
  `913_cb_revoke_de_public`, `914_cb_fecha_rpc_de_manutencao` e
  `915_cb_fecha_rpc_de_manutencao_de_fato`, `906_cb_grupos` e
  `916_cb_lid_do_canal`. Depois disso (conferido em 2026-08-02):
  `917_cb_endereco_lid_da_mensagem`, `918_cb_notas_na_conversa`,
  `919_cb_mencao_na_anotacao`, `920_cb_fecha_grants_das_anotacoes`,
  `921_cb_anotacao_apagada_em_tempo_real`, `922_cb_aposenta_contact_notes`,
  `923_cb_assinatura`, `924_cb_favoritar`, `925_cb_mensagem_agendada`,
  `926_cb_entrega_incerta`, `927_cb_batimento_do_agendador` e
  `928_cb_quando_reivindicou`. Depois disso (conferido em 2026-08-03):
  `929_cb_busca_em_mensagens`, `930_cb_reticencia_no_trecho` e
  `931_cb_fecha_anon_nas_tabelas_antigas`.
  Depois disso (conferido em 2026-08-03):
  `932_cb_agendada_com_midia_e_citacao`.
  Depois disso (conferido em 2026-08-27 via `list_migrations`):
  `933_cb_gatilho_de_funil`, `934_cb_acoes_de_funil`,
  `935_cb_lembrete_por_data`, `936_cb_orquestracao`,
  `937_cb_batimento_das_automacoes`, as três do upstream renumeradas
  (`040`/`041`/`042`), `940_cb_broadcast_com_canal` e
  `941_cb_radar_de_atendimento`.
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
  Conferir com paridade de chaves antes de commitar.
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
  `.github/workflows/deploy.yml` roda a cada push no `main`: builda a imagem,
  publica no GHCR (`ghcr.io/leonardocabralb/cb-crm`) e faz rollout no serviço do
  **Docker Swarm da VPS** (`82.25.76.63` / `vps.cbadvogados.com`), atrás do
  **Traefik** (TLS Let's Encrypt). **Nunca dar push no `main` sem o operador
  saber que aquilo vai para produção.**
- Domínio: `crm.cbadvogados.com`. ✅ O cutover de DNS **já foi feito** (conferido
  em 2026-07-25): `crm.cbadvogados.com` → `vps.cbadvogados.com` → `82.25.76.63`,
  respondendo 200 com TLS do Traefik. Ou seja, o domínio público serve a VPS —
  **o push no `main` atinge usuário real**, não mais um serviço isolado.
- ⚠️ **`NEXT_PUBLIC_APP_LOCALE` é build-arg, não env de runtime.** Como todo
  `NEXT_PUBLIC_*` é inlinado no bundle **em tempo de build**, editar o `crm.env`
  da VPS **não** muda o idioma — é preciso alterar `deploy.yml`/`docker-stack.yml`
  e **rebuildar a imagem**. Isso já mordeu: até 2026-07-25 os dois arquivos
  fixavam `en` e a produção inteira servia inglês, enquanto o dev local (que lê
  `.env.local`, com `pt-BR`) parecia certo. Ao investigar "produção está
  diferente do meu local", checar build-arg antes de env de runtime.
- Segredos de runtime vivem em `crm.env` **na VPS** (fora do git), espelhando o
  `.env.local`. A Evolution API roda como serviço `evolution_evolution` no mesmo
  Swarm.
- Arquivos: `Dockerfile`, `docker-stack.yml`, `.github/workflows/deploy.yml`,
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
- **Assistente de IA:** bring-your-own-key (OpenAI/Anthropic/Gemini, desde a
  941) — cada conta cola sua chave em Settings → AI Assistant, guardada
  criptografada com `ENCRYPTION_KEY`. Não há env var global de provider.
  Embeddings (RAG) continuam exigindo chave OpenAI (modelo fixo, vector 1536).

## Antes de aplicar mudanças

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
npm run dev          # servidor de desenvolvimento (localhost:3000)
npm run build        # build de produção
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run format       # prettier --write
```
