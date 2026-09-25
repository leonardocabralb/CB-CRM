# Merge do upstream — o que é nosso e o que se desfaz a cada merge

Documento INTERNO: descreve a nossa relação com o original (`ArnasDon/wacrm`)
e não vai para quem instala. É consulta, não regra de área — nenhum arquivo
de `.claude/rules/` o carrega sozinho.

> ⚠️ **Leia INTEIRO antes de qualquer merge do upstream, cherry-pick do
> original ou conflito com `upstream/main`.** É a leitura obrigatória que a
> raiz do `CLAUDE.md` aponta (seção 0, item b). O `git merge` não avisa quando tira
> um trecho nosso: arquivo que não conflita entra em silêncio.

**Regra de manutenção:** trecho NOSSO novo num arquivo que veio do upstream
ganha uma linha na tabela da §4, no mesmo PR. Para saber se o arquivo veio do
upstream, ver a §7.

Como ler:

- §1 a §4 são o texto que vivia no `CLAUDE.md` até 24/09/2026, movido sem
  reescrever. As referências a seções ("ver a seção X", "acima", "abaixo")
  são daquele arquivo: os títulos hoje moram em `.claude/rules/` (índice na
  raiz do `CLAUDE.md`, seção 13), e o texto integral de antes está em
  `git show f5879b3f:CLAUDE.md`.
- ⚠️ O commit `aee1b01f` do original é ancestral do `main` desde o merge de
  22/09/2026 (§3.1). Toda nota que diz "o próximo merge vai trazer X de
  volta" vale só para mudança do original DEPOIS dali. O que a resolução
  daquele merge descartou não volta por merge.
- A §6 é a ÚNICA cópia da lista do que se desfaz a cada merge. A raiz só
  aponta para cá.

Sumário: §1 receita · §2 onde divergimos · §3 decisões fixadas nos merges ·
§4 arquivos do upstream com trechos nossos · §5 migrations do original ·
§6 o que se desfaz a cada merge · §7 arquivos que ficam nossos inteiros.

## 1. Puxar atualizações do original (a receita)

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

⚠️ Nota de 24/09/2026: o fim da receita (`git merge` no `main` +
`git push origin main`) publica em produção sem revisão — push no `main`
dispara o deploy. O merge de 22/09/2026 entrou por PR (#259), como
qualquer branch; faça o mesmo com a branch de integração.

⚠️ **Rodar `scripts/i18n-parity.mjs` depois de todo merge do upstream.** Se o
upstream adicionou chave nova em `messages/en.json`, ela **precisa** entrar no
`pt-BR.json` no mesmo merge: o fallback do next-intl é por arquivo, não por
chave, então chave faltando vira `MISSING_MESSAGE` e aparece crua na tela do
usuário. O script sai com código 1 nesse caso. Ele reporta erro de parse ICU
apenas como *aviso* — de propósito, porque isso quase nunca é bug de verdade
(ver seção i18n).

Conflitos só ocorrem quando o original e nós editamos **a mesma linha do mesmo
arquivo** — por isso preferir módulos novos a reescrever o core.

## 2. Onde já divergimos do upstream

**Onde já divergimos do upstream** (checar a cada merge com
`git diff --stat upstream/main main`): `messages/en.json` é o campo de
batalha — o upstream mexe nele a cada feature e nós temos tradução por cima.
Também são nossos: `messages/pt-BR.json`, `CLAUDE.md`, `.gitignore`,
`scripts/`, as migrations `0037_evolution_transport.sql`, `900_cb_*` e
`901`/`902`/`903_cb_*`, a **integração Evolution API** (`src/lib/whatsapp/transport/`,
`src/app/api/whatsapp/evolution/`, `src/components/settings/evolution-connect.tsx`,
`src/lib/whatsapp/inbound-store.ts`), o **multi-canal** (`src/lib/cb-channels/`,
`src/app/api/cb/`, `src/components/settings/cb-channels-panel.tsx`), a **infra de
deploy** (`Dockerfile`, `docker-stack.yml`, `.github/workflows/pipeline.yml`,
`docs/DEPLOY-VPS.md`) e os componentes que internacionalizamos (o upstream tem
string literal onde nós temos `t('chave')` — ao resolver, manter a nossa forma e
levar o texto novo dele para os **dois** dicionários).

## 3. Decisões fixadas nos merges

Releia antes do próximo merge: são as que voltam a conflitar.

### 3.1 O merge de 2026-09-22

**Decisões fixadas no merge de 2026-09-22** (upstream #533–#596, 43 commits):

- ⚠️ **A regra deste merge foi "o `main` vence", e por ARQUIVO INTEIRO.** Os 43
  conflitos foram resolvidos com `git checkout --ours <arquivo>`, nunca
  costurando os dois lados. Tentou-se antes `git merge -X ours`, que resolve
  TRECHO a trecho: onde os dois lados reestruturaram regiões diferentes do
  mesmo arquivo, o resultado não era de ninguém — imports de um lado e código
  do outro, `try` sem `catch`, variável declarada duas vezes. Deu 37 erros de
  typecheck que só pioravam a cada conserto. Por arquivo inteiro deu 5. **Não
  usar `-X ours` neste repositório.**
- ⚠️ **Resolver por arquivo não basta: o upstream renomeia coisas em arquivos
  que NÃO conflitam.** Eles entram em silêncio e o nosso código fica chamando
  o nome antigo. Os três casos desta rodada, e o critério:
  - `ensureImageHeaderHandle` → `ensureMediaHeaderHandle`
    (`template-header-handle.ts`): **ADOTADO**. Mesma assinatura, e `media` é
    superconjunto de `image`; três arquivos já usavam o nome novo, só o nosso
    `templates/[id]/route.ts` ficou para trás.
  - `formatRelative(iso, nunca: string)` → `(iso, t: Translator)`: **NOSSO**.
    Mudança de comportamento, não renomeação — `automations/[id]/logs/page.tsx`
    voltou para a versão do `main`.
  - `dedupeByPhone` ganhando `invalid` (o #529/#586 deles): ficou o NOSSO no
    merge, e a Fase 3-II (PR #265) acrescentou o `invalid` com a NOSSA régua
    (`telefoneDigitado`), não com a deles — ver abaixo.
  - ⚠️ **Chave de dicionário que os dois lados acrescentam ao MESMO objeto
    vira chave REPETIDA, sem conflito nenhum**: o #259 pôs as chaves do
    #529/#586 no fim de `Contacts.importModal`, o #265 pôs as suas no meio, e
    o `JSON.parse` fica com a última — as do #259 venciam. Os três portões de
    i18n usam `JSON.parse` e não enxergam isso; quem enxerga é
    `src/i18n/chaves-duplicadas.test.ts`.
- ⚠️⚠️ **O conserto #586 do upstream NÃO ficou de fora — entrou pela METADE,
  pelos arquivos que não conflitaram**, e é o contrário da nossa régua (a
  decisão P9 do `docs/PLANO-merge-upstream-2026-09.md`: número brasileiro
  sem `+` ganha o 55, porque é o que o escritório digita). Pela regra do
  merge, `dedupe.ts`, `broadcast-csv.ts` e `step2-select-audience.tsx`
  ficaram os nossos; mas `phone-utils.ts` (`parseInternationalPhone` e o piso
  de `isValidE164` de 7 para 8 dígitos), `broadcast-core.ts` (a API v1 de
  disparo recusa destinatário sem `+`) e a checagem do `+` no
  `contact-form.tsx` entraram SEM conflito — e a ficha nova com
  "(11) 99999-9999" passou a ser recusada em produção. A Fase 3-II (PR #265)
  tira a checagem do formulário (o pino `telefone-digitado.chamadores.test.ts`
  reprova quem a trouxer de volta) e a 3-III (23/09/2026) pôs a API v1 —
  contatos, mensagens e disparo — e a "Nova conversa" na mesma régua, e
  APAGOU o `parseInternationalPhone` (o pino reprova o nome em qualquer
  arquivo de `src/`). A chave `phoneNeedsCountryCode` saiu dos dois
  dicionários, e o `csvInvalidPhones` ficou com o texto da nossa régua.
- ⚠️ **As migrations do upstream viraram 1038 e 1039** (PR de correções do
  #259, 23/09/2026): `040_contact_business_scoped_user_id` →
  `1038_cb_contato_bsuid` e `042_message_failure_reason` →
  `1039_cb_motivo_da_falha_da_mensagem`, com o cabeçalho reescrito para a
  nossa realidade e `lock_timeout`. O #259 as trouxera como `0043`/`0045`,
  seguindo a linha "Migrations deste plano" do plano — que contradizia a
  regra do `db push` escrita no CLAUDE.md (número NOVO vem depois do maior
  no `main`; a instalação que atualiza por `supabase db push` recusa o
  número fora de ordem). Nenhuma das duas tinha sido aplicada em banco
  nenhum, então renumerar não custou nada. A `041_fix_broadcast_contact_id_ambiguity`
  deles continua APAGADA, não renumerada — ela redefine
  `create_broadcast_with_recipients` com 8 parâmetros, desfazendo a forma
  final de 9 que a 1030 fixou (pino `funcao-de-disparo-1030.test.ts`).
  ⚠️ Com o cabeçalho reescrito, o Git NÃO pareia a 040/042 com a 1038/1039
  (medido: apagar + criar). Uma edição do original na 040/042 volta como
  conflito modify/delete, com o arquivo de 3 dígitos na árvore: apagar de
  novo e portar à mão numa migration nova. Quem recebe edição do original EM
  SILÊNCIO são as nossas `0040`–`0042` (as 037–039 deles, renomeadas a
  92–94% de semelhança) — conferir `git diff --summary` em
  `supabase/migrations/` a cada merge.
- ⚠️ **As colunas da 1038 (a identidade BSUID) são gravadas SÓ pelo
  webhook da Meta** (Fase 11.2) e lidas pelos remetentes (Fase 11.3, por
  `alvoDeEnvio`). O hook de notificação do navegador lia `wa_username` e,
  portado na Fase 8, passou a usar `nomeDoContato`. As da **1039** (o motivo
  da falha da Meta) são gravadas pelo webhook da Meta desde a Fase 5 — ver a
  linha do RECIBO na tabela abaixo.
- **`ci.yml` e `migrations.yml` apagados de novo**, como a nota do
  `pipeline.yml` manda.
- **Dicionários: UNIÃO, não substituição.** Nosso lado venceu o `en.json`
  inteiro, o que apagaria as chaves novas deles — e os componentes deles que
  entraram sem conflito as pedem, virando `MISSING_MESSAGE` na tela. Foram
  **240** chaves acrescentadas em cada dicionário (a nota original dizia 195
  e 242; o `messages.test.ts` reprova diferença entre os dois). Umas ~129
  delas não têm uso nenhum (heurística da auditoria) e ficam para a Fase 10;
  as que contrariavam regra escrita já saíram: `Sidebar.title` (recriada) e
  `Settings.invite.fallbackAccountName` ("our wacrm account"). ⚠️ Duas
  seções que vieram na união (`Settings.sections.whatsapp` e `.deals`) não
  existem no nosso `settings-sections.ts` e foram removidas — o
  `rotulo-da-secao.test.ts` reprova seção órfã.
- ⚠️⚠️ **"O `main` vence por arquivo inteiro" valeu só para os 43 conflitos.**
  Dos 23 arquivos que os dois lados mudaram e o Git mesclou SOZINHO, 16
  ficaram com trechos do original (7 voltaram ao nosso); dos 43 que só o
  original mudou, 37 entraram inteiros. Foi assim que
  a metade do #586 entrou (o `+` obrigatório no formulário de contato e na API
  de disparo) e que o `pt.json`/`es.json`, o cartão de notificação e a doc
  `whatsapp-connection-troubleshooting.md` chegaram ao `main`. A auditoria de
  23/09/2026 (10 agentes, cinco lentes com um cético cada) está registrada no
  plano; o que ela achou e foi consertado:
  - `messages/pt.json` e `messages/es.json` APAGADOS (1.740 chaves contra mais
    de 4.000 — a armadilha do `ko.json`; pino em
    `src/i18n/dicionarios-servidos.test.ts`) e o `docs/docker.md`, que o
    #259 fez listar `en | ko | pt | es`, passou a dizer `en | pt-BR`.
  - O cartão "Notificações do navegador" SAIU de *Seu perfil*: o ouvinte que
    dispara os avisos não estava montado em lugar nenhum, e a pessoa ligava a
    chave, recebia a notificação de teste e nunca a de uma mensagem real. A Fase 8
    (24/09/2026) portou o hook, montou o ouvinte DENTRO da `<PortaDeEntrada>`
    e devolveu o cartão — ver as linhas do hook, do cartão e da casca na
    tabela abaixo.
  - A `docs/whatsapp-connection-troubleshooting.md` foi APAGADA: em inglês,
    com "wacrm" sete vezes, descrevendo a tela legada que o fork não monta. A
    Fase 7 (24/09/2026) a reescreveu para *Conexões*: é a
    `docs/conexao-meta.md`. Um merge do original que mexa no arquivo antigo o
    traz de volta como conflito modify/delete — apagar de novo.
  - As duas rotas que só nós guardamos por papel (`whatsapp/config` e
    `whatsapp/templates/[id]`) sobreviveram, mas não tinham teste: pino em
    `src/app/api/whatsapp/guarda-de-papel-so-nossa.test.ts`.
- ⚠️⚠️ **Este merge FECHOU a ancestralidade: `aee1b01f` é ancestral do
  `main`.** O próximo merge do original parte dali, e o que a resolução deste
  descartou (tudo o que caiu no "fica o nosso") NÃO volta mais por merge —
  sem conflito e sem aviso. A Fase 12 do plano (o merge de ancestralidade)
  aconteceu sem querer, e as Fases 4 a 11 viraram portes MANUAIS, com o
  inventário do que ficou de fora no plano. Pela mesma razão, as notas do
  CLAUDE.md, das regras e deste documento que dizem "todo merge do upstream
  vai trazer X de volta" valem só
  para mudança do original DEPOIS de `aee1b01f`.

### 3.2 O merge de 2026-08-26

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
  arquivos `media-lightbox.tsx` e `message-media.tsx` vieram no merge mas **não
  estão ligados** — se um merge futuro os religar, o inbox passa a ter dois
  visualizadores. (De `lib/media/*`, o `download.ts` passou a ser usado em
  23/09/2026 pelo **Baixar** da nota de voz — ver "Player de áudio".)
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

- ⚠️ **`agentRules: false` no `next.config.ts` (21/09/2026, Next 16.3.5).** A
  16.3 estreou a geração automática de regras para agentes: o `next dev`
  REESCREVE o `AGENTS.md` rastreado sempre que detecta um agente de IA (log:
  "Generated AGENTS.md for AI agents"). Medido na Fase 1 do
  `docs/PLANO-merge-upstream-2026-09.md`: o arquivo mudou um segundo depois de
  o servidor subir. Desligado por dois motivos: toda worktree com dev server
  ficaria suja (e mudança alheia já pegou carona em PR), e este `CLAUDE.md`
  abre com `@AGENTS.md` — um pacote escreveria nas instruções que todo agente
  do projeto lê. **O `next.config.ts` já diverge do upstream: um merge que
  traga o deles cru tira a linha**, e o sintoma é ` M AGENTS.md` aparecendo
  sozinho no `git status` de quem só subiu o servidor.

- ⚠️ **Um workflow só: `.github/workflows/pipeline.yml`.** O `ci.yml` e o
  `migrations.yml` eram DO UPSTREAM e foram removidos; as três etapas
  (verificar → migrations → deploy) viraram jobs de um arquivo nosso, com o
  `deploy` dependendo de `verificar`. Antes os três rodavam **em paralelo** no
  push do `main`, e o cabeçalho do deploy dizia "after CI passes" sem que
  existisse `needs:` — um CI vermelho não impedia a publicação. **Todo merge do
  upstream vai trazer `ci.yml` e `migrations.yml` de volta: apagar de novo**, ou
  as etapas passam a rodar duas vezes por push.
  ✅ **O replay de migrations SEGURA o deploy desde 2026-09-08**:
  `needs: [verificar, migrations]`. Durante meses foi só `[verificar]`, e
  migration vermelha no `main` publicava assim mesmo (medido em
  2026-08-31) — a etapa era SINAL porque as migrations históricas ainda
  carregavam a dívida do banco vazio. A dívida foi paga (as duas regras
  estão na seção de migrations), a etapa vinha verde, e manter o portão
  aberto só preservava o buraco: quem descobriria a migration quebrada
  seria a PRÓXIMA instalação, que constrói o banco do zero e não tem
  produção antiga para disfarçar. Há pino em
  `.github/workflows/pipeline.test.ts` — tirar `migrations` do `needs`
  reprova o CI.

- **`src/i18n/messages.test.ts` checa `pt-BR`, não `ko`.** O upstream o escreveu
  para `ko`, que não servimos; deixar assim daria um teste permanentemente
  vermelho sobre um idioma que ninguém usa. Ao mesclar, ele volta com `['ko']`
  — e junto volta o `messages/ko.json`, que foi apagado (ver a nota em
  "Estrutura"). Apagar os dois de novo.

### 3.3 O merge de 2026-09-05

**Decisão fixada no merge de 2026-09-05** (upstream #532, o upload de CSV do
assistente de broadcast — 1 PR, o único desde o merge anterior):

- **`upsertCsvContacts` (`src/hooks/use-broadcast-sending.ts`) fica com os
  DOIS lados.** Do upstream: o CSV passa a casar com o contato pelo número
  NORMALIZADO (`.in('phone_normalized', …)`, a coluna gerada da 022) em vez do
  texto cru — "+55 (11) 9…" no arquivo agora acha o "5511 9…" da base em vez
  de tentar inserir de novo e morrer em 23505. ⚠️ Desde a 1024 o trecho mudou
  de forma (é NOSSO agora também): deduplica e casa por PESSOA
  (`chaveDePessoa`), busca as duas grafias do nono dígito em fatias e, na
  corrida, relê e insere um a um — a versão do upstream casa por grafia, e
  com o índice canônico a campanha inteira morreria no 23505.
  Nosso: o contato criado grava `user_id: ownerUserId` com falha fechada
  (`if (!ownerUserId) throw`), nunca `user.id` — `contacts.user_id` CASCADEia
  de `auth.users`, e o offboarding do operador levaria os contatos do CSV com
  conversas e mensagens. A versão do upstream grava `user.id` ali, e o próximo
  merge vai trazê-la de volta. Pino:
  `src/hooks/use-broadcast-sending.dono-do-csv.test.ts`.

## 4. Arquivos do upstream com trechos NOSSOS

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
| `src/app/api/whatsapp/webhook/route.ts` (3ª linha nossa) | o `.is('nome_fixado_em', null)` no UPDATE que troca o nome do contato pelo do perfil (999). O bloco é do upstream e volta cru num merge — sem a guarda, o nome fixado pelo agendamento do Calendly vira o do WhatsApp na mensagem seguinte. Pino: `src/lib/contacts/nome-fixado.chamadores.test.ts` |
| `src/components/inbox/message-bubble.tsx` (além de ser nosso inteiro) | o case `document` usa `mediaFilename(message)` e mostra a legenda embaixo só quando ela DIFERE do nome; `nomeDeArquivo` delega para a cascata em vez de derivar o basename cru |
| `src/components/inbox/message-bubble.tsx` (canal, 2026-09-02) | a prop `canal` (nome + cor) no lugar do antigo `channelLabel`: o rótulo embaixo da mensagem ganhou a bolinha da cor, 10px (era 9) e teto de 9rem (era 7). ⚠️ Uma versão desta nota dizia que em 7rem os nomes truncavam "no ponto em que ainda são iguais" — MEDIDO em 02/09: os seis nomes da conta cabem em 7rem até a 10px (o mais longo, "Trabalhista - Comercial", dá 110px); o 9rem é folga, não conserto. A cor vive na BOLINHA, não no texto: a bolha da equipe é `bg-primary`, violeta nesta conta. Uma trilha de 3px na borda foi feita e DESCARTADA pelo operador na hora ("não gostei dessa borda colorida") |
| `src/components/inbox/message-actions.tsx` (áudio, 23/09/2026) | o botão **Baixar** da nota de voz (`podeBaixar` + `downloadMediaMessage`). O download morava no menu de três pontos do `<audio controls>` nativo, que a bolha trocou pelo `player-de-audio.tsx` — um merge que traga a barra crua do upstream tira o download do áudio sem conflito nenhum |
| `src/components/inbox/message-thread.tsx` | além do fio intercalado, renderiza a faixa `ScheduledBar` logo acima do compositor e guarda o contador que a liga ao compositor |
| `src/components/inbox/message-thread.tsx` (rolagem, 2026-09-01) | ⚠️ `coladoNoFimRef` + `onScroll` guardam o auto-scroll, e o spinner só entra quando a CONVERSA muda (`conversaCarregadaRef`). Sem os dois, voltar de uma aba nova — o `visibilitychange` incrementa o `resyncToken` — perdia a posição de quem lia o histórico E o empurrava para o fim, três vezes por retorno (mensagens, eventos e notas chegam em buscas próprias). O `saltoAtivoRef` NÃO cobre isso: é armado só pelo salto da busca, e `liberarSalto` está no `onWheel`, então rolar à mão o DESLIGA. A guarda é re-armada em `publicarMensagemOtimista` e ao acrescentar nota — senão o autor manda e não vê |
| `src/app/api/whatsapp/webhook/route.ts` | carimba `channel_id` na entrada — **no próprio upsert** desde 10/09/2026 (o UPDATE separado `stampMessageChannel` engolia falha e deixava mensagem de cliente sem número, e a janela de 24h por número a leria como vinda de outro número; o mesmo no `persistInboundMessage` da Evolution). Os dois gravam por `gravarComCanal` (`stamp.ts`), que repete SEM canal quando a conexão foi apagada no meio (23503 da FK `messages_channel_id_fkey`) — senão a mensagem do cliente se perderia, porque o provedor já recebeu 200; há pino estrutural em `stamp.chamadores.test.ts`; varre `cb_channels` na verificação (GET); escopa o ACK por canal; passa `channelId` a flows/automações/IA |
| `src/lib/whatsapp/inbound-store.ts` | idem, no lado Evolution |
| `src/lib/automations/engine.ts` | o `tituloFixadoEm` do `create_deal` (1007: título literal do autor nasce fixado, `{{…}}` fica solto). Mais `channelInScope`, condição `channel`, canal de saída por passo, e o `create_deal` que virou chamada a `createDeal` com a checagem "um card por contato" ANTES do insert — o índice da 911 é parcial (`source = 'channel'`) e não barra o insert da automação, então sem a checagem nasce card duplicado. Mais o `rotuloDoDisparo` opcional de `runAutomationById` (955): a execução manual da conversa grava `'manual'` no log — sem ele, o registro diria que outra automação chamou. Mais o ramo de NOME do `update_contact_field` (999): grava FIXADO e não sobrescreve com valor que não é nome. Mais a guarda do mesmo passo para QUALQUER campo (21/09/2026): valor interpolado VAZIO não sobrescreve — o bloco do upstream grava o "" e apaga o que a ficha sabia. Mais o gancho `antesDeExecutar` de `dispararAutomacoes` (chamado uma vez, antes da primeira automação que passou nos recortes) |
| `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts` (×2) e `src/lib/whatsapp/send-message.ts` | a chamada a `routeContactToPipeline`. ⚠️ São **QUATRO** call sites: os dois de ingestão (não há função compartilhada de abrir conversa — enxertar só num faz a feature valer só num transporte, e produção roda Evolution), o `persistDeviceMessage` do celular pareado e o núcleo de envio. Ver "Quem abre negócio" abaixo |
| `src/lib/whatsapp/inbound-store.ts` (`persistDeviceMessage`) | o `followConversationChannel` que aponta a conversa para o número por onde a EQUIPE falou. Sem ele a conversa nasce com `channel_id` nulo e o CRM responde pelo canal PADRÃO — o advogado aborda pelo Jurídico e o sistema responderia pelo Comercial |
| `src/lib/flows/engine.ts` | `findEntryFlow` por canal, `flow_runs.channel_id`, try/catch nos nós interativos, e o parâmetro opcional `substituicao` de `startFlowForContact` (955): o start manual carimba a run substituída como gente (`stopped_by_agent`/`replaced_by_agent`), não como regra. Mais (Fase 4 do plano do merge do upstream, 23/09/2026) as montagens `camposDosBotoes`/`camposDaLista` — o `{{vars}}` do #553 nos textos visíveis, NUNCA no `reply_id` — e o canal do nó (senão o do run) também na LISTA e na pergunta do `collect_input`, que saíam pelo canal atual da conversa. ⚠️ O contrato de falha é o NOSSO (`send_interactive_failed`; a re-pergunta que falha ENCERRA o run): libera o contato na hora e deixa a falha visível, ao preço de perder o fluxo num erro transitório. O do original mantém o run vivo na re-pergunta até esgotar `max_reprompts` (2) ou o varredor de 24 h. Num merge, fica o nosso — há pino em `engine-channel.test.ts` |
| `src/lib/ai/{auto-reply,config,knowledge,usage}.ts` | agente por canal, interruptor, RAG por canal |
| `src/lib/ai/auto-reply.ts` e `src/app/api/whatsapp/webhook/route.ts` (Fase 9, 24/09/2026) | o "digitando…" do #527 PORTADO: `mostrarDigitando` (`src/lib/ai/digitando.ts`, arquivo NOSSO) resolve o canal pela MESMA função da resposta (`resolveEngineChannelPreferring` com o canal da entrada) e só age em canal Meta com id `wamid.` — o original lia as credenciais da CONTA (`loadAccountMetaCredentials`, não adotado): com dois números oficiais, marcaria a mensagem num número e responderia pelo outro. O webhook da Meta passa `inboundMessageId: message.id`; a Evolution não passa nada. Pino: `src/lib/ai/digitando.chamadores.test.ts` |
| `src/lib/whatsapp/broadcast-core.ts` + rotas de template | `resolveMetaChannel` no lugar do espelho |
| `src/app/api/whatsapp/templates/submit/route.ts` (23/09/2026) | a busca do modelo local é pela CONTA (nome + idioma + canal igual ou nulo, preferindo o do canal e o vinculado), ANTES de qualquer chamada à Meta, e erro de busca é 500 sem chamar a Meta. A Meta recusou com linha VINCULADA (`meta_template_id`): não grava nada. ⚠️ O rascunho da recusa é regravado com a cerca `.is('meta_template_id', null)` NO UPDATE — a foto é de antes da Meta, e outra aba ou outro admin pode ter vinculado a linha no meio; zero linhas (ou 23505 no INSERT) = busca de novo e responde como linha vinculada. O `code: 'modelo_ja_existe'` sai com linha vinculada E recusa 4xx da Meta que não é limite (`httpStatus` do `MetaApiError`), nunca em 5xx, rede ou tempo esgotado — e mesmo assim a recusa pode ter outro motivo, por isso o texto diz "se foi pelo nome". O UPDATE nunca leva `user_id` (autoria; reatribuir é o M24). A versão do upstream faz `.upsert` com `onConflict: 'user_id,name,language'`, que desde a 903 não tem índice para casar (42P10, medido num Postgres 16 com os dois índices parciais): num merge cru, toda criação aceita pela Meta volta 500 e não é gravada, e o rascunho da recusa se perde em silêncio. (Quem rebaixava a linha aprovada a rascunho era a NOSSA versão anterior, que buscava pelo autor depois da Meta.) Pino: `submit/route.test.ts` |
| `src/lib/api/v1/conversations.ts`, `src/lib/api-keys/scopes.ts` | `channel_id` nos serializers, escopo `channels:read` |
| `src/app/api/v1/broadcasts/route.ts` (21/09/2026) | o `channel_id` do corpo chegando a `createBroadcast` — a rota do upstream o DESCARTA, e `docs/public-api.md`, `docs/mcp.md` e a ferramenta `send_broadcast` do `mcp-server` prometem que ele vale. Ninguém viu enquanto o endpoint devolvia 500 em toda chamada (a função de disparo não executava, 1030); com dois números oficiais a campanha sairia pelo que `resolveMetaChannel` escolhesse, sem erro. O núcleo falha FECHADO (canal inválido = 400 `meta_channel_required`, nada enviado). Pino: `src/app/api/v1/broadcasts/route.test.ts` |
| `supabase/ci/verify-schema.sql` | as DUAS asserções nossas: policies de escrita de disparo/regras (964) e a função de disparo (1030: UMA assinatura, a de NOVE parâmetros com `p_template_params JSONB`, RETURNING qualificado). ⚠️ O upstream confere a de OITO por `::regprocedure` — aceita crua, o cast estoura no replay e TRAVA o deploy. Manter a nossa; o arquivo continua com UMA instrução |
| `src/components/automations/automation-builder.tsx`, `src/components/flows/{flow-builder,flow-editor-state}.tsx` | escopo de canal editável (multi-select / select), canais no contexto do editor, validação de canal no cliente |
| páginas de `automations`, `flows`, `broadcasts`, `dashboard` | etiqueta e filtro de canal, coluna de canal nos históricos, filtro do painel |
| `src/components/broadcasts/step{1,4}-*.tsx`, `src/hooks/use-broadcast-sending.ts` | canal escolhido no passo 1, `channel_id` no corpo da API e na linha de `broadcasts`. No hook, mais: `marcarDestinatario` (update conferido pelo retorno, #15) e o `ownerUserId` do `upsertCsvContacts` (ver a decisão do merge de 2026-09-05 acima) |
| `src/components/broadcasts/step{2,4}-*.tsx`, `src/hooks/use-broadcast-sending.ts` (Fase 3-IV, 23/09/2026) | ⚠️ a CONTAGEM do público nos passos 2 e 4 é `contarPublico`, a MESMA resolução do envio (`contatosDaBase` + `aplicarRecortes`; no CSV, `pessoasDoCsv` + `fichasDoCsvNaBase`, que o `upsertCsvContacts` também usa). O upstream (#594) conta por uma RPC e a versão antiga das telas lia sozinha, sem paginar — as etiquetas de 4.635 contatos apareciam como 1.000 e o passo 4 ignorava a exclusão. "Todos os contatos" é lido POR CHAVE (`buscarPorChave`): por OFFSET, ficha criada no meio da leitura repetia um destinatário e o modelo pago chegava em dobro. Pinos em `use-broadcast-sending.contagem.test.ts` e `.paginacao.test.ts` |
| `src/components/settings/template-manager.tsx` | seletor de WABA para criar/sincronizar, etiqueta de canal por modelo |
| `src/components/settings/{template-manager,tag-manager,settings-overview}.tsx` (23/09/2026) | a leitura do catálogo SEM `.eq('user_id', …)` (ver a nota do M24 em "Iniciar conversa pelo CRM"), e os controles de escrita só para admin (`useCan('edit-settings')`: criar/apagar etiqueta; criar, sincronizar, editar, reenviar e apagar modelo), mais o `count` do DELETE de etiqueta com o motivo medido por `lerExclusao`. O upstream filtra por quem criou e mostra os botões a todos: um merge cru devolve o catálogo vazio a todo membro que não é o dono. Pino: `src/components/settings/catalogo-da-conta.test.ts` |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx` | canal no primeiro contato e a seção/aba **Histórico** (912). (A linha "canal da conversa" que o painel do inbox exibia foi REMOVIDA em 2026-08-29 a pedido do operador — o seletor do cabeçalho do fio já responde isso.) No detail view a `TabsList` ganhou `flex-wrap` com a altura **prefixada** (`group-data-horizontal/tabs:h-auto` + `[&>button]:h-auto`, NUNCA `h-auto` cru — ver a armadilha do tailwind-merge abaixo; um merge que "simplifique" para `h-auto` quebra a tela de novo) — com 5 abas ela já estourava a largura do painel e escondia "Negócios" |
| `src/components/inbox/message-thread.tsx` | `groupMessagesByDate` virou `groupTimelineByDate`, sobre mensagens **e** eventos do lead intercalados (`intercalar`), e o laço de render passou a ramificar em `item.evento` |
| `src/components/inbox/conversation-list.tsx` | ⚠️ **praticamente reescrito** (924): todo o recorte saiu para `src/lib/inbox/filtros.ts`, a barra de filtros virou `<InboxFilters>`, e cada linha ganhou a estrela de favoritar. Num merge do upstream, esperar conflito grande e **manter a nossa versão**, levando só o que for novo dele. Mais o `onTermoDeBusca`, que espelha o termo assentado para a página. Mais o menu de **filtros salvos** (967/968): o hook, os catálogos que dão nome aos ids, o `limparOrfaos` do aplicar e a semente do filtro padrão. Mais (23/09/2026) o `ordenarComoOBanco(conversations)` num memo ANTES do recorte: o upstream nunca reordena, e a conversa que recebia mensagem ficava na posição da carga — abaixo da dobra — até recarregar. Espelha os DOIS `.order` da consulta: mudou um, muda o outro. A lista passa a se mover sob o ponteiro (como no WhatsApp), de propósito. Ver `src/lib/inbox/ordem-da-lista.ts` |
| `src/components/inbox/message-thread.tsx` (canal, 2026-09-02) | o `SeparadorDeCanal` entre trechos, a faixa de divergência colada no compositor, a bolinha de cor no gatilho e nos itens do seletor de canal, e o `Fragment` que embrulha separador + `LinhaDoFio` (ex-`LinhaDaMensagem`; a `key` mudou de lugar) |
| `src/components/inbox/message-thread.tsx` | o **salto da busca**: `<LinhaDoFio>` (ex-`LinhaDaMensagem`) envolvendo as duas formas de bolha (a comum e o aviso de sistema do grupo) E a anotação intercalada, a faixa "2 de 5" com ↑/↓, os efeitos de centralizar/suprimir e o `saltoAtivoRef`. Mais (09/09/2026) a **busca dentro da conversa** (lupa do cabeçalho, `buscaLocal`/`termoEfetivo`) e o **salto PONTUAL** (`useSaltoPontual`, UMA mecânica para o clique na citação do PR #179 e para o "Ver na conversa" do painel — `destaqueDaCitacao`/`destaqueDoPainel`) — ver a seção própria |
| `src/components/inbox/conversation-list.tsx` (09/09/2026) | o interruptor **"Buscar também dentro das mensagens"** (`buscarNasMensagens`, desligado por padrão) e o placeholder que muda com ele; `useBuscaEmMensagens` ganhou o 2º parâmetro `ativa` |
| `src/components/inbox/conversation-list.tsx` (canal, 2026-09-02) | a prop `corDoCanalDaLinha` do `ConversationItem` e a bolinha antes do nome — bolinha, e não trilha, porque a borda esquerda já é da seleção |
| `src/components/inbox/conversation-list.tsx` (janela, 12/09/2026) | a AMPULHETA da janela de 24h da Meta (991): a prop `canalDeSaidaDaLinha` do `ConversationItem`, `canaisPorId`/`canalPadrao` no pai, o `tTimer` da linha e `COR_DA_AMPULHETA` — ver a seção "Selo da janela de 24h na lista" |
| `src/app/(dashboard)/inbox/page.tsx` | espelha o termo da busca da lista para o fio — são irmãos, e a página é o único caminho entre eles. Mais o escritor da presença por conversa (963): `useMarcarConversaAberta(activeConversation?.id)` — a página é a dona da seleção. Mais (14/09/2026) a navegação por HISTÓRICO no celular: abrir conversa pela lista ou pelo "nova conversa" é `push` (`navegacaoAoAbrir`), o botão voltar desfaz o passo (`router.back()`), e um ouvinte de `popstate` fecha ou reabre — um merge que traga o `replace` cru do upstream faz o gesto de voltar do iPhone SAIR da caixa de entrada de novo. Ver a seção "Voltar da conversa pelo HISTÓRICO". Mais (23/09/2026) o INSERT de mensagem do tempo real passa por `comMensagemNova`: hora e prévia só AVANÇAM (com a lista reordenando, carimbo antigo puxaria a linha para baixo) e aviso de SISTEMA do grupo não mexe na linha. O upstream grava `last_message_at: newMsg.created_at` cru — há pino em `ordem-da-lista.test.ts` |
| `src/components/inbox/message-thread.tsx` (955/963) | monta o `<ExecutarAutomacaoDialog>` (é o fio que tem o contato; o canal passado é `conversation.channel_id ?? null` — o PR #74 trocou o `activeChannel` resolvido pelo cru DE PROPÓSITO, para a checagem de escopo da rota falhar aberta igual ao motor em conversa sem canal; grupo fica de fora) e os avatares `<AvataresNaConversa>` no cabeçalho, alimentados por `useQuemVeAConversa` |
| `src/components/inbox/message-thread.tsx` (#84) | a **janela de 24h**: a regra saiu para `src/lib/inbox/janela-24h.ts` (puro, com teste) e os TRÊS caminhos de envio (texto, mídia, interativa) passam por `janelaFechadaAgora()` antes do `fetch` — o portão lê o RELÓGIO no disparo, nunca `sessionInfo.expired` (um `useMemo`: recomputa no tique de 1 min da badge, nunca no instante exato do disparo). Um merge que traga o `sessionInfo` inline do upstream devolve os três buracos de uma vez. Desde 10/09/2026 a janela é **POR NÚMERO**: os dois relógios passam `canalDaJanela` (= `activeChannel`, id + transporte, o mesmo do `expected_channel_id`) — parâmetro OBRIGATÓRIO em `janelaFechada`/`minutosRestantes`, com pino estrutural cobrando o MESMO canal nos dois —, grupo fica fora (`!ehGrupo` em `janelaDe24h`), e a etiqueta fala minutos na última hora (`restanteParaExibir`; antes o ramo de minutos era código morto e a última hora aparecia inteira como "1h restantes") |
| `src/lib/dashboard/queries.ts`, `src/components/dashboard/metric-card.tsx` | filtro por canal (parcial) e marca "conta inteira" |
| `src/app/api/automations/[id]/duplicate/route.ts` | copia `channel_ids` (sem isso a cópia vira irrestrita) e, desde 23/09/2026, `assinatura_personalizada` (sem ela a cópia assina com o nome da conta) |
| `src/app/api/automations/[id]/route.ts` e `duplicate/route.ts` (23/09/2026) | ⚠️⚠️ a automação é da CONTA, não de quem a criou: GET por qualquer membro, PATCH/DELETE/duplicar por qualquer ADMIN da conta (`ctx.accountId` de `requireRole`), nunca `user_id = user.id` (decisão do operador). O upstream filtra pelo autor — herança de quando cada login era uma conta —, e com um segundo admin ele recebia 404 ao abrir, ativar, duplicar ou mudar o escopo pela aba do funil. O DELETE confere quantas linhas saíram: antes, zero linhas voltavam `ok` e a tela dizia "excluída" sobre a automação intacta. Um merge que traga as rotas cruas devolve os dois sem conflito nenhum — há pino em `route.test.ts`. ⚠️ O #587 do original (GHSA-xvrq-88hg-44q6, ABERTO lá desde 17/09) faz o mesmo conserto com piso **`agent`** nas três escritas: num merge, fica o nosso `admin` — o pino cobra o papel PEDIDO (`requireRole('admin')`), não só que o `agent` é recusado. O UPDATE do PATCH também leva a conta e confere as linhas (Fase 1b do plano do upstream) |
| `src/lib/automations/meta-send.ts`, `src/lib/flows/meta-send.ts` e `engine.ts` (23/09/2026, upstream #589) | a conversa do contexto é conferida por conta no disparo, em `resolveConversationId` e em cada envio do robô (`assertConversationInAccount`, ANTES do canal e do provedor); as prévias levam `.eq('account_id')`. Remetente NOVO do robô nestes arquivos repete a conferência — pino estrutural em `src/lib/whatsapp/conversation-scope.chamadores.test.ts` |
| `src/lib/whatsapp/conversation-scope.ts` (23/09/2026) | ⚠️ DIVERGE do original do #589: com `contactId`, a conversa tem de ser DAQUELE contato também (Codex, 3ª rodada do PR #261) — só a conta deixava passar "contato A + conversa de B" da mesma conta, e o cliente A recebia o que aparece no fio de B. O disparo e `resolveConversationId` fazem o mesmo. Num merge, fica o nosso |
| `src/components/contacts/contact-form.tsx`, `contact-detail-view.tsx`, `import-modal.tsx`, `src/lib/contacts/dedupe.ts` (`dedupeByPhone`), `src/lib/broadcast-csv.ts` e `step2-select-audience.tsx` (23/09/2026, Fase 3-II) | ⚠️⚠️ o telefone DIGITADO passa pela NOSSA régua (`telefoneDigitado`/`escritaDoTelefone`, em `telefone.ts`): brasileiro sem DDI ganha o 55, sem `+` e sem DDD é recusado, e a linha do CSV SAI normalizada. O upstream (#586) resolveu o mesmo defeito EXIGINDO o `+` nessas mesmas linhas (`parseInternationalPhone`) — o contrário do que o escritório digita. Num merge, fica o nosso; há pino estrutural (`telefone-digitado.chamadores.test.ts`) reprovando `parseInternationalPhone` nessas telas. Na edição, telefone que não mudou não é conferido nem regravado. O `invalid` do dedupe e o motivo por linha da importação são do #529, adotados. |
| `src/lib/api/v1/contacts.ts` (`findOrCreateContact`), `src/lib/whatsapp/resolve-conversation.ts`, `broadcast-core.ts`, `src/app/api/cb/conversas/abrir/route.ts` e `nova-conversa-dialog.tsx` (23/09/2026, Fase 3-III) | a MESMA régua (`telefoneDigitado`) no telefone que chega pela API v1 e pela "Nova conversa" (e, arquivo nosso, pelo webhook de entrada — ver a seção própria). Antes, contatos, mensagens, a rota e o diálogo da "Nova conversa" apagavam o que não era dígito (`sanitizePhoneForMeta` + `isValidE164`, ou o mesmo `replace` no diálogo): "(81) 98874-5316" virava a ficha +81, e um JID de contato colado (`…@lid`, `…@s.whatsapp.net`) virava os dígitos dele — o LID como telefone de ficha (o `@g.us` já caía no teto de 15 dígitos). O disparo exigia o `+` do #586. ⚠️ O custo, escrito na doc pública: número ESTRANGEIRO com o código do país, sem `+`, de 10 dígitos (ou 11 com 9 na 3ª posição) passa a ser lido como brasileiro. ⚠️ `ContactInput.phone` é o texto CRU: o disparo manda `to`, nunca os dígitos já lidos — "+41 55 555 12 12" relido sem o `+` ganharia o 55 (há pino). A frase do 400 é `mensagemDoTelefoneDaApi`; a regra para quem integra está em `docs/public-api.md#phone-numbers` |
| `src/app/api/cb/channels/[id]/route.ts` (DELETE) | barra a exclusão quando há agendada na FILA e limpa o acervo — a FK da 925 é RESTRICT |
| `src/components/pipelines/pipeline-board.tsx`, `src/app/(dashboard)/pipelines/page.tsx` | o painel por etapa (Fase 5): o raio com contador no cabeçalho da coluna e a carga das automações de funil. Mais o funil-com-conversas (PR #71): botão de conversas por coluna, `navegarParaInbox`/restauração de rolagem no board (quadroRef vem da página), `useChannels` içado, select `DEAL_SELECT_DO_QUADRO` com plano B, popover de campos. Mais a carga em DUAS etapas (22/09/2026): lista enxuta de todos + conteúdo só dos desenhados, `CardDoQuadro` e o card "carregando" — um merge que traga a busca única do upstream devolve os ~3 s do Trabalhista |
| `src/components/pipelines/deal-card.tsx` | ⚠️ **reestruturado inteiro no PR #71 — manter a NOSSA versão** (como `conversation-list.tsx`): wrapper + botão do corpo (abre a CONVERSA) + lápis IRMÃO (edita; button aninhado é inválido), campos por `CamposDoCard`, etiquetas/última mensagem/não lidas, `memo` + canais por prop, barra de cor com `pointer-events-none` |
| `src/components/pipelines/deal-form.tsx` | o título digitado FIXA o card (1007, `escritaDoTituloManual` nos dois ramos; o `payload` comum NÃO carrega `title`). Ao EDITAR, funil e etapa só vão quando o operador os mudou (23/09/2026): o quadro não tem realtime, e regravar a etapa de um card que outro operador ou uma automação já moveu o levava de volta — disparando as automações da etapa antiga. E o reset do rascunho é por sessão (`sessaoRef`), não por identidade de `stages`. Mais o que a linha antiga já dizia: o link "ver conversa" prefere a conversa do CONTATO (fallback no vínculo da 910), usa `urlDoInbox` e as props `origemFunil`/`aoIrParaConversa` da jornada do funil |
| `src/components/pipelines/pipeline-settings.tsx` | o rascunho de "Gerenciar funil" vem do BANCO a cada abertura (23/09/2026: `aberturaRef`, `gravacaoRef`, carregando com Salvar/Adicionar desabilitados), não das props `pipeline`/`stages` — a versão do upstream semeia das props, e um merge que a traga crua devolve o rascunho apagado a cada volta ao app e as etapas do funil anterior logo depois de uma troca. Mais o que já era nosso: degrau (975) e resultado (950) por etapa, e os avisos de conexão que usa o funil ou a etapa (908) |
| `src/app/(dashboard)/inbox/page.tsx`, `src/components/inbox/conversation-list.tsx`, `inbox-filters.tsx` | os params `?etapa=` (semeia o filtro de etapa UMA vez) e `?de=funil` (faixa "Voltar ao funil") — os `router.replace` usam `urlDoInbox`, que preserva `de` e derruba `etapa` DE PROPÓSITO; na lista, `etapaInicial` + `etapasResolvidas` e o recorte de etapa gateado por `etapasUsaveis`; nos filtros, o fallback da pastilha virou `labelStage` (era "Qualquer etapa" sobre filtro ativo) |
| `src/app/(dashboard)/automations/new/page.tsx` | o `?stage=` que faz a automação nascer com o gatilho de funil já apontando para a etapa clicada |
| `src/lib/automations/engine.ts` (espera, 18/09/2026) | o "Aguardar" estaciona com `contextoDaEspera(...)` e CONFERE o erro do INSERT (fila que recusa vira falha visível); `resumePendingExecution` limpa a marca com `semMarcaDeResposta`. Um merge que traga o bloco do `wait` cru devolve o insert não conferido e a marca para de ser gravada — a caixa do construtor vira enfeite, sem erro nenhum. Ver a seção "Aguardar — parar se o cliente responder" |
| `src/app/api/whatsapp/webhook/route.ts` (4ª linha nossa) e `src/lib/whatsapp/inbound-store.ts` | a chamada a `cancelarEsperasPorResposta`, ANTES de `dispatchInboundToFlows` — nos DOIS transportes (há pino estrutural com a ordem) |
| `src/app/api/whatsapp/webhook/route.ts` (5ª linha nossa) | o `conversation.created` começa SEM `await` (`avisoDeConversaCriada`) e é esperado antes do `message.received` e em todo retorno antecipado (23/09/2026). O upstream o aguarda ANTES do upsert: um endpoint de saída fora do ar (até 5 s por POST) segurava a primeira mensagem de toda conversa nova e os motores atrás dela. Um merge que traga o `await` cru devolve o atraso sem conflito. O mesmo desenho está em `inbound-store.ts` e `instagram/persistir.ts` (esses dois são NOSSOS — o upstream não emite o evento neles). ⚠️ A ordem garantida é só `conversation.created` → `message.received`: robô, automações e IA já rodam com o aviso em voo, então o `message.status_updated` da resposta deles (outra requisição do provedor) pode chegar ao assinante antes do `conversation.created`. Pinos: os testes "conversation.created não segura a gravação" (`route.test.ts`, `inbound-store.test.ts`, `persistir.aviso.test.ts`) |
| `src/app/api/whatsapp/webhook/route.ts` (BSUID, Fase 11.2, 25/09/2026) | a entrada do BSUID é NOSSA, não a do #519: a identidade sai de `identidadeNaEntrada` (NOSSO, `src/lib/whatsapp/identidade-na-entrada.ts`) com telefone `null` — nunca `''` —, o `contacts[]` é pareado pela IDENTIDADE (`contatoDaMensagem`, nunca por posição com recuo para `[0]`), o portão EXIGE `contacts` como o original (a mensagem de SISTEMA vem sem ele) e a `type: 'system'` é descartada também com `contacts` — relaxar o portão fazia o aviso de troca de número entrar como fala do cliente —, a entrega sem telefone nem BSUID é descartada antes de criar qualquer coisa, e a reação só-BSUID não cria ficha. Em `findOrCreateContact`: BSUID primeiro, com releitura (`fichaQueVenceuPorBsuid`), depois o telefone; os preenchimentos em UPDATEs SEPARADOS do nome, cada um com a cerca no WHERE (`.is('wa_user_id', null)`, `.is('phone', null)`, `.eq('wa_user_id', …)`); 23505 num preenchimento = log com os dois ids, sem fusão, e a mensagem na ficha do BSUID. O original grava `phone: ''`, junta tudo num patch (o nome fixado barraria o BSUID) e pareia por posição — um merge que traga o bloco dele cru devolve a ficha por mensagem e o BSUID da pessoa errada. Pinos `route.bsuid.test.ts`, `bsuid.chamadores.test.ts` e `chave-canonica.chamadores.test.ts` |
| `src/lib/contacts/dedupe.ts` (Fase 11.2) | `findExistingContact` RECUSA texto com letra (BSUID, LID, JID) sem consultar: `normalizePhone` deixaria os dígitos, e os 8 finais casariam com o celular de um cliente |
| `src/types/index.ts` (Fase 11.2) | `Contact.phone` documentado como nulo também na ficha só-BSUID (1041), e os três campos `wa_*` opcionais |
| `src/lib/whatsapp/send-message.ts`, `src/lib/flows/meta-send.ts` (3 remetentes) e `src/lib/automations/meta-send.ts` (`sendViaMeta`) (BSUID, Fase 11.3) | o destino sai de `alvoDeEnvio`/`alvoDoRobo` (NOSSO, `src/lib/whatsapp/alvo-de-envio.ts`), decidido DEPOIS do canal e das recusas dele: o BSUID só com `ehMeta`. O original chama `resolveContactSendTarget` direto, ANTES do canal, e ignora o transporte — com a Evolution, as letras do BSUID sumiriam e a mensagem iria ao número formado pelos dígitos dele. Variantes do nono dígito e autocorreção do 131030 só com `ehTelefone`, nos três. Modelo de AUTENTICAÇÃO a quem só tem BSUID é recusado antes da Meta (`modeloExigeTelefone`, no núcleo e em `sendViaMeta` — a doc da Meta sobre BSUID o exclui; o original não recusa). O original também não cobre `sendViaMeta` como nós (é o remetente da régua). Um merge que traga os blocos crus devolve o BSUID à Evolution sem conflito visível. Pinos `alvo-de-envio.chamadores.test.ts` (default-deny: só `alvo-de-envio.ts` chama `resolveContactSendTarget`; cada `.sendText(`/`.sendMedia(` manda o alvo decidido), `regua.chamadores.test.ts`, `send-message.test.ts`, `flows/meta-send.test.ts`, `automations/meta-send.bsuid.test.ts` |
| `src/app/api/whatsapp/react/route.ts` (Fase 11.3) | o contato vem com `wa_user_id`; o telefone deixou de ser exigido antes do canal (a reação pela Evolution usa só a chave da mensagem); pela Meta, o alvo é `alvoDeEnvio` depois do canal. O original exige `resolveContactSendTarget` para os dois transportes. Pino `react/route.test.ts` |
| `src/app/api/whatsapp/send/route.ts` (Fase 11.3) | com `channel_id` escolhido, a ficha só-BSUID por conexão que não é da Meta leva 400 `not_supported` ANTES de `pinConversationChannel` — o núcleo recusaria o envio, mas com a conversa já fixada num número que não alcança o cliente. Pino `send/route.test.ts` ("canal escolhido × ficha só-BSUID") |
| `src/lib/api/v1/contacts.ts` e `src/lib/api/v1/conversations.ts` (Fase 11.4, decisão 5 do operador) | `whatsapp_user_id` e `whatsapp_username` (só leitura, das colunas `wa_user_id`/`wa_username`) no contato e no contato embutido na conversa — e, por `serializeContact`, no contato dos avisos `deal.*`. O original não expõe o BSUID: sem os campos, o integrador recebia `phone: null` sem identificador. Um merge que traga o serializador cru tira o que a doc pública promete. Pinos `contacts.test.ts`, `conversations.test.ts` |
| Consultas que embutem o contato em arquivos do original (`automations/[id]/logs/page.tsx`, `notifications/page.tsx`, `flows/[id]/runs/route.ts` e a página, `use-browser-notifications.ts`, `dashboard/queries.ts`) (Fase 11.4) | `wa_username` ao lado de `instagram_username`: sem a coluna, `nomeDoContato` cai no fallback para a ficha só-BSUID. Pino `src/lib/contacts/identidade-nos-embeds.test.ts` (default-deny: toda lista `name, phone` traz os dois @, com exceções escritas) |
| `src/app/(dashboard)/contacts/page.tsx`, `src/components/broadcasts/step3-personalize.tsx`, `src/components/contacts/contact-detail-view.tsx` e `contact-form.tsx` (Fase 11.4) | o nome por `nomeDoContato` no lugar do `name \|\| phone` cru (aviso de exclusão, prévia do disparo, erro do campo); o telefone apagável por `podeFicarSemTelefone` (Instagram OU BSUID, o CHECK da 1041) — o original só conhece o Instagram |
| `src/components/inbox/message-thread.tsx` (Fase 11.4, decisão 4 do operador) | o seletor de conexão DESABILITA, com o motivo (`Inbox.messageThread.channelSoOficial`), a conexão que não alcança a ficha só-BSUID — a régua é a do envio (`alvoDeEnvio`) |
| `src/app/api/whatsapp/webhook/route.ts` (6ª linha nossa) | o RECIBO (23/09/2026). `handleStatusUpdate` traduz o status por `reciboDaMeta` (`played` vira `read`; valor fora da lista não toca em nada), grava em `messages` só com a escada (`aceitamORecibo`, só linhas `agent`/`bot`, escopo por canal mantido) e pela espera da linha (`aplicarReciboQuandoAMensagemExistir` + `pausasDoReciboDaMeta`), e anuncia `message.status_updated` só quando alguma linha avançou, com a conta DESSA linha. O espelho de `broadcast_recipients` passou para ANTES (o disparo não grava em `messages` e não espera), e o UPDATE dele ficou CONDICIONAL (`origensDoDestinatario`, derivada de `isValidStatusTransition`): o do upstream lê, confere em memória e grava sem condição, e dois recibos do mesmo destinatário ao mesmo tempo se atropelavam (um `delivered` por cima do `read`, um `failed` por cima do `delivered`). Os recibos de um POST rodam DEPOIS das mensagens dele (`processarEntradas` + `finally`). O upstream grava o status cru. A reescrita cobre a função inteira, então mudança futura dele nela CONFLITA — e resolver o conflito com a versão deles devolve a bolha rebaixada. O motivo da falha (#535, Fase 5 do `PLANO-merge-upstream-2026-09.md`, colunas da 1039) foi portado À MÃO: `motivoDaFalhaDaMeta` (PARSE do `errors[0]`, nunca `as` — um código não numérico, fracionário ou fora do `integer`, ou um texto com NUL ou surrogate solto, derrubaria o UPDATE que pinta a falha; medido num Postgres 16) entra no patch do `tentar()` e no `error_message` do destinatário, nos MESMOS updates condicionais; a falha que a escada recusa não grava motivo, e recibo posterior não o apaga (a falha é terminal). A bolha mostra o texto da Meta (`motivoNaBolha`, em `src/lib/inbox/motivo-da-falha.ts`). Pinos: `route.recibo.test.ts` e `recibo-da-meta.test.ts` |
| `src/lib/whatsapp/template-webhook.ts` e a chamada em `src/app/api/whatsapp/webhook/route.ts` (Fase 6b do merge do upstream, 24/09/2026) | o STUB do modelo criado direto no painel da Meta (#534). O original resolve a conta por `whatsapp_config.waba_id` — o espelho de UM número, que nesta produção nunca casa — e grava o stub sem canal, com o `user_id` da config. O NOSSO: a conexão sai de `cb_channels.waba_id` (`kind = 'meta'`, exatamente UMA — dois números na mesma WABA viram só log, como o original faz com duas configs); o stub nasce com o `channel_id` (o catálogo é POR WABA: linha sem canal valeria para qualquer número da conta, e a sincronização de outra WABA poderia adotá-la) e com o DONO da conta em `user_id` (`message_templates.user_id` CASCADEia de `auth.users` — ⚠️ todo Sincronizar regrava o dono de TODO modelo que atualiza com o admin que clicou — defeito anterior da rota de sincronização, M24). ⚠️⚠️ O stub nasce COMPLETO: `lerModeloNaMeta` (`modelo-da-meta.ts`) lê o modelo pelo id com o token da conexão, e `conteudoDoModeloDaMeta` é a MESMA conversão da sincronização. O original grava `body_text: ''`, e essa linha vazia virava o modelo do ENVIO: `buildSendComponents` contava zero variáveis e descartava os parâmetros de quem mandava pelo nome (API v1, disparo) — o envio que funcionava sem linha local passava a ser recusado pela Meta (revisão da Fase 6). Leitura que falha = nenhum stub, só log. NÃO nasce se já existe linha de mesmo nome e idioma no canal OU sem canal (a régua da sincronização e da submissão; sem o nulo, o stub nascia ao lado da linha global e o `maybeSingle` da sincronização falhava para aquele modelo para sempre), nem para evento de SAÍDA (`PENDING_DELETION`/`DELETED`/`ARCHIVED`, o valor CRU: a rota de exclusão apaga a linha local logo depois de apagar na Meta, e o aviso seguinte ressuscitaria o modelo). Aceito e escrito: o stub do dono e a linha de OUTRO admin (submissão ou sincronização no mesmo instante) podem nascer juntos com o mesmo `meta_template_id` — o índice único leva o `user_id`. A rota passa `wabaId: entry.id` (sem ele o stub é inerte, o estado do #259). Um merge que traga o arquivo cru devolve o `whatsapp_config` e o corpo vazio sem conflito. Pinos em `template-webhook.test.ts` (inclusive o envio com o stub levando os parâmetros) e o teste da rota do original (`route.test.ts`, #534) |
| `src/lib/whatsapp/template-header-handle.ts` (Fase 6a, 24/09/2026) | a amostra do cabeçalho de mídia é lida por `lerComTeto` (`src/lib/http/ler-com-teto.ts`), com o `content-length` conferido antes: o original lia o corpo INTEIRO (`arrayBuffer`) antes do teto de 100 MB do documento, com a URL colada pelo admin. Só o teto (`TetoExcedido`) vira "maior que o limite da Meta": o prazo de 10 s do fetch vale também para o corpo, e tempo esgotado ou conexão que cai no meio têm frase própria. Um merge que traga a leitura crua devolve o processo derrubável por uma URL. Pino em `template-header-handle.test.ts` (um corpo de 64 MB sem `content-length` para no teto de 16 MB do vídeo — FINITO de propósito: sem fim, o mutante trava em vez de reprovar) |
| `src/lib/whatsapp/meta-error-explain.ts` (Fase 7, 24/09/2026) | o campo `motivo` em cada ramo (`MOTIVOS_DO_ERRO_DA_META`): a tela de Conexões recebe o MOTIVO e o traduz (`Settings.channels.metaErro.<motivo>`), porque o `summary` do original é inglês e era o texto da rota legada. Um ramo novo do original sem `motivo` não compila — e a tabela de `meta-error-explain.test.ts` cobra o motivo de cada ramo, e `falha-da-meta.test.ts` cobra a frase nos dois dicionários. Mais os dois "wacrm" do texto trocados por "the CRM" (a regra da marca). Mais o `nonexisting field` no ramo do código 100: MEDIDO contra a Meta real (24/09/2026), WABA ID trocado em `/{waba}/phone_numbers` volta "(#100) Tried accessing nonexisting field (phone_numbers)", e sem ele a tela dizia "a Meta recusou um valor" em vez de "a Meta não encontra o WABA ID" |
| `src/lib/whatsapp/meta-api.ts` (Fase 7, 24/09/2026) | duas mudanças nossas num arquivo que era IDÊNTICO ao do original: (1) `listWabaPhoneNumbers` só segue `paging.next` dentro de `https://graph.facebook.com` (`isGraphUrl` — o cursor vem da RESPOSTA e o token vai no cabeçalho; é a cerca do `doGraph` do Meta Ads) e LANÇA quando o teto de 5 páginas acaba com página sobrando, porque meia lista seria lida como "o número não mora nesta WABA"; (2) o passo 1 de `uploadResumableMedia` manda o token no cabeçalho `Authorization: OAuth`, não em `?access_token=` (o exemplo da Meta usa a URL). Pinos em `meta-api.waba-numbers.test.ts` e `meta-api.resumable.test.ts`. Um merge que traga o arquivo cru desfaz os dois sem conflito |
| `src/app/api/whatsapp/config/route.ts` (Fase 7, 24/09/2026) | ⚠️⚠️ o **POST foi APOSENTADO** (410, apontando para `POST /api/cb/channels`): respondia 500 a TODA chamada desde 27/07 (o `75daeb97`, nosso, pedia `account_role` a `whatsapp_config`) e, consertado, gravaria a credencial da Meta por cima do espelho de uma conta Evolution (o UPDATE não toca em `provider`) sem criar conexão. A única tela que o chamava (`whatsapp-config.tsx`) não é montada. O que o #505 lhe deu foi portado para `POST /api/cb/channels` (`meta-admin.ts` + `falha-da-meta.ts`). O GET e o DELETE ficam; o GET (e o `verify-registration`) passam a mensagem da Meta por `semTokenDaMeta` — ela ECOA o token. Um merge que traga o POST cru de volta REPROVA o pino `guarda-de-papel-so-nossa.test.ts`, que agora cobra a aposentadoria. O `syncDefaultMetaChannelFromConfig` do `legacy-mirror.ts` saiu junto (só o POST o usava) |
| `src/components/automations/automation-builder.tsx` (18/09/2026) | a caixa "Parar a automação se o cliente responder" no passo Aguardar e o sufixo no resumo do cartão fechado |
| `src/app/(dashboard)/automations/[id]/logs/page.tsx` | `skipped` com traço NEUTRO em vez do ✗ vermelho (`StepRow`) |
| `src/app/(dashboard)/inbox/page.tsx` (24/09/2026) | o efeito da conversa aberta dispara `EVENTO_CONVERSA_ABERTA` — o aviso do navegador tira da fila de espera a mensagem que a pessoa acabou de ver (pino `cartao-de-notificacao.chamadores.test.ts`) |
| `src/app/(dashboard)/inbox/page.tsx` (18/09/2026) | no INSERT de mensagem do CLIENTE na conversa aberta, `setTimeout(avisarExecucoesMudaram, 3000)` — a aba Automações descobre o cancelamento por resposta sem recarregar a página |
| `src/lib/automations/engine.ts` (etapa, 18/09/2026) | `resumePendingExecution` confere `cardSaiuDaEtapa` depois do freio de `is_active` E da marca de interrupção (`execucaoJaInterrompida`, 1005): fora da etapa (ou estadia encerrada) → `cancelled` + varredura das irmãs + anotação; leitura falhou → falha VISÍVEL. Um merge que traga o resume cru devolve a sequência de No Show cobrando quem reagendou, sem erro nenhum |
| `src/lib/automations/drain-events.ts`, `src/app/(dashboard)/automations/new/page.tsx`, `src/lib/automations/validate.ts` | a chamada a `cancelarEsperasAoSairDaEtapa` no laço do dreno (arquivo NOSSO, mas o ponto de chamada tem pino); o `parar_ao_sair: true` semeado no `?stage=`; e a validação booleana das duas opções novas |
| `src/components/automations/automation-builder.tsx`, `src/app/(dashboard)/automations/[id]/edit/page.tsx` e `src/app/(dashboard)/pipelines/page.tsx` (voltar ao funil, 18/09/2026) | o voltar do construtor passa por `voltaDoConstrutor(origem)` e o `router.replace` depois de CRIAR por `urlDoConstrutor({ id, origem })` (`src/lib/pipelines/url.ts`): aberto pela grade de automações do funil (`?de=funil&funil=<id>`), o voltar devolve à aba Automações DAQUELE funil, e não à tela de Automações do menu. Um merge que traga o `router.push("/automations")` cru do upstream devolve o bug sem conflito nenhum — há pino em `url.test.ts`. Na página do funil, `?vista=` e `?funil=` são porta de ENTRADA, lidas uma vez na montagem (trocar de aba ou de funil depois não reescreve a URL) |
| `src/lib/automations/trigger-meta.ts` | `formatRelative` passou a usar `Intl.RelativeTimeFormat` e a receber o texto de "nunca" — devolvia `5m ago`/`never` em inglês nas três telas |
| `src/components/contacts/contact-detail-view.tsx` (987) e `src/components/inbox/painel/painel-do-contato.tsx` | a seção `<ReunioesTranscritasDoContato>` dentro da aba Reuniões, abaixo de `<ReunioesDoContato>` — na ficha E na 7ª aba só-ícone (`reunioes`) do painel da conversa, montada em 09/09/2026 a pedido do operador para a transcrição estar à mão durante o atendimento. Um merge que traga a aba crua do upstream apaga o histórico de transcrições da ficha |
| `src/components/contacts/contact-detail-view.tsx`, `src/components/inbox/contact-sidebar.tsx`, `src/app/(dashboard)/notifications/page.tsx`, `src/components/layout/{sidebar,header}.tsx`, `src/app/(dashboard)/contacts/page.tsx`, `src/lib/rate-limit.ts` | as tarefas (944): 7ª aba na ficha (com `[&>button]:flex-none` na TabsList), seção na barra da conversa, ícones/navegação dos tipos `task_*` no sino (o `TYPE_ICON` é exaustivo — merge que trouxer tipo novo sem ícone quebra o typecheck), item "Tarefas" com etiqueta realtime no menu, deep link `?contact=`, bucket `tarefa` |
| `src/app/(dashboard)/pipelines/page.tsx` e `src/app/(dashboard)/contacts/page.tsx` (voltar ao app, 14/09/2026) | a chamada a `useAoVoltarParaOApp` com recarregar SILENCIOSO: no Funil, uma recarga PRÓPRIA (`buscarFunis`/`buscarEtapas`/`buscarNegocios`/`buscarAutomacoes`, com as cercas de versão e de funil — ela NÃO passa pelo `refreshDeals` nem mantém arrasto no ar, e é por isso que a gravação confirmada de um arrasto avança a versão; nunca a carga inicial, que liga o `loading` e desmonta o quadro); em Contatos, a opção `silencioso` do `fetchContacts`, que não liga o `loading`. Ver a seção "Telas que se atualizam ao VOLTAR para o app" |
| `src/lib/ai/types.ts`, `generate.ts`, `defaults.ts`, `config.ts`, `usage.ts`, `providers/` | o TERCEIRO provedor (`gemini`, 941) e o modo `'radar'` no log de uso — o upstream conhece só openai/anthropic. `structured.ts` e `providers/gemini.ts` são arquivos NOSSOS |
| `src/components/settings/ai-config.tsx`, `src/app/api/ai/config/route.ts` | a opção Gemini no seletor e na validação do provider |
| `src/components/settings/cb-channels-panel.tsx`, `src/app/api/cb/channels/[id]/route.ts`, `src/lib/cb-channels/repo.ts` | o toggle `radar_enabled` por canal (dialog, PATCH allowlist e SAFE_COLUMNS) |
| `src/components/layout/sidebar.tsx`, `header.tsx`, `src/middleware.ts` | a aba `/radar` (item de navegação, título do cabeçalho e rota protegida) |
| `src/lib/api-keys/scopes.ts`, `docs/public-api.md`, `src/components/settings/api-keys-settings.tsx` | os doze escopos das features do fork (tarefas/agendadas/negócios/reuniões/anotações/campos personalizados) e a rolagem da lista no diálogo — o upstream tem só os 8 originais |
| `src/lib/deals/create-deal.ts` | devolve `deal` (a linha inserida), não só `ok/created` — a rota v1 serializa a resposta a partir dele —, e aceita `tituloFixadoEm` (1007): a v1 fixa o título, o roteador e o passo `create_deal` derivam |
| `src/components/settings/settings-sections.ts`, `settings-chip.tsx`, `src/app/(dashboard)/settings/page.tsx` | a seção `integracoes` no rail e a variante `err` (vermelha) do chip. Mais (23/09/2026) `api: <ApiPanel/>` no lugar de `<ApiKeysSettings/>` e o `go()` apagando o parâmetro `aba` ao trocar de seção |
| `src/lib/webhooks/events.ts`, `deliver.ts` (23/09/2026) | os três eventos `deal.*` e `DEAL_WEBHOOK_EVENTS`; `dispatchWebhookEvent` GENÉRICO sobre `WebhookEventData` com o 5º parâmetro `opcoes` (`id`/`occurredAt`), os `CABECALHO_*` e `pedidoDeEntrega` (o botão de teste assina pelo mesmo). Um merge que traga o `deliver.ts` cru devolve o `data: unknown` e desliga a cobrança do contrato nos pontos de disparo. Mais (1040) o RETORNO `ResultadoDoDisparo` (`tentado`/`sem_destino`/`falhou_antes`): a fila do funil só dá o aviso por encerrado quando a tentativa aconteceu — o `deliver.ts` cru volta a `Promise<void>` e a leitura de endpoints que falha volta a parecer "sem destino" |
| `src/lib/auth/api-context.ts` (1040) | `requireApiKey` devolve `clienteDaApi()` (`src/lib/api/v1/cliente-da-api.ts`, cabeçalho `x-cb-origem: api`), nunca o `supabaseAdmin()` compartilhado. Um merge que traga o arquivo cru do upstream faz os movimentos de card pela API voltarem a sair `system` nos avisos `deal.*`, sem erro nenhum — há pino em `cliente-da-api.test.ts` |
| `src/components/settings/api-keys-settings.tsx` (23/09/2026) | virou o CORPO da aba Chaves: sem `SettingsPanelHead` (o cabeçalho é do `ApiPanel`), com o "Nova chave" no topo da aba e o estado de carga que falhou |
| `src/app/api/v1/contacts/route.ts`, `[id]/route.ts`, `[id]/tags/route.ts`, `src/lib/api/v1/contacts.ts` (23/09/2026) | a etiqueta por NOME OU ID (`lerTagsPedidas` antes de qualquer escrita, `TagReferenceError`), o 400 para item de `tags` que não é string e para id de contato malformado. Mais (23/09/2026) o `tags_mode: "add"` do POST e do PATCH (`setContactTags(…, { somenteAcrescentar })`) e o `avisarRecusaDeEtiqueta` nos 400 de etiqueta das três rotas — um merge que traga a rota crua do upstream devolve o `tags` substitutivo sem saída numa chamada só. Ver "Tag ADITIVA na API v1" |
| `src/lib/ai/types.ts`, `config.ts`, `structured.ts`, `defaults.ts`, `src/lib/cb-radar/worker.ts`, `src/app/api/ai/config/route.ts` | o modelo do Radar separado do modelo de chat (946): `radarModel` no tipo e em `CONFIG_COLUMNS`, o parâmetro `model` do `generateStructured`, `AI_PROVIDER_MODELS`, e a validação do modelo do Radar no save |
| `src/components/settings/ai-config.tsx` | `<datalist>` de sugestão no campo Modelo e a frase de escopo com link para Integrações |
| `src/lib/ai/config.ts`, `src/app/api/ai/config/route.ts`, `src/app/api/ai/test/route.ts`, `src/app/api/ai/draft/route.ts`, `src/app/api/ai/playground/route.ts`, `src/components/settings/ai-config.tsx`, `src/components/settings/ai-knowledge.tsx` (F1a dos agentes de IA, 1042) | a CHAVE é do PROVEDOR, uma por conta, em `cb_ia_chaves` (lida por `lerChave`, `src/lib/ia-chaves/repo.ts`, com o cliente de serviço): `loadAiConfig` não lê mais `api_key`/`embeddings_api_key` de `ai_configs` (a de embeddings é a chave da OpenAI da conta); o `POST /api/ai/config` IGNORA `api_key` no corpo e recusa com `sem_chave` quando o provedor não tem chave; o `DELETE /api/ai/config` foi REMOVIDO (apagava a chave que o Radar e a transcrição usam); o `/api/ai/test` testa a chave guardada do provedor; a tela de Agentes perdeu os campos de chave e o "Remover" e aponta para Integrações; chave que não decifra LANÇA `key_decrypt_failed` em `loadAiConfig`, e o rascunho e o Playground separam isso da falha de leitura (`config_read_failed`); a base de conhecimento aceita `hasEmbeddingsKey = null` ("não sei"). Um merge que traga a versão do upstream crua devolve a leitura de `ai_configs.api_key` — que o app novo não grava mais —, e o assistente, o rascunho e o Playground passam a dizer "sem chave" numa conta configurada. Pino: `src/lib/ia-chaves/chaves.chamadores.test.ts` |
| `src/app/(dashboard)/agents/page.tsx`, `src/lib/ai/usage.ts` (F1b dos agentes de IA, 1043) | a página `/agents` é NOSSA inteira: virou a LISTA dos agentes de IA (`src/components/agentes-de-ia/`), e a tela do upstream (Playground, Configuração e Uso do assistente único) mudou para `/agents/legado`, sem mexer no conteúdo. Um merge que traga o `agents/page.tsx` cru devolve a tela antiga no lugar da lista — resolver pelo nosso e levar o que for novo do original para `agents/legado/page.tsx`. Em `usage.ts`, os modos `agente`/`agente_teste` e os campos `iaAgenteId`/`iaAgenteNome` (gravados só quando há agente) |
| `src/components/settings/profile-form.tsx` (Fase 8, 24/09/2026) | o cartão `<BrowserNotificationsCard>` do original (#516) só aparece com a Caixa de entrada no perfil (`podeVerTela(acesso, 'inbox')`). Pino em `src/components/settings/cartao-de-notificacao.chamadores.test.ts` |
| `src/hooks/use-browser-notifications.ts` (Fase 8, 24/09/2026) | PORTADO: a preferência é POR PESSOA (`usePreferenciaDeAviso`, chave `cb-notificacoes:<userId>`); quem recebe aviso é `silencioDoAviso` (perfil pelo contexto REAL, grupo fora, "quais conversas", mensagem antiga); o título é `nomeDoContato`; o corpo esconde o texto quando a pessoa pede; o clique usa `urlDoInbox`. A versão crua do original avisa grupo e conexão fora do perfil — manter a nossa inteira. Pino no mesmo arquivo de teste |
| `src/components/settings/browser-notifications-card.tsx` (Fase 8, 24/09/2026) | lê e grava pela `usePreferenciaDeAviso` e ganhou as duas configurações (quais conversas e mostrar o texto). Manter a nossa |
| `src/app/(dashboard)/dashboard-shell.tsx` (Fase 8, 24/09/2026) | `{!entradaPendente && <BrowserNotificationsListener />}` ao lado do `PresenceHeartbeat`, dentro da `<PortaDeEntrada>` |
| `src/app/(dashboard)/inbox/page.tsx` (Fase 8, 24/09/2026) | o ouvinte de `EVENTO_ABRIR_CONVERSA` (`src/lib/inbox/url.ts`): o clique no aviso do navegador com o inbox JÁ montado abre a conversa por `conversaRecemAbertaRef` + `resyncToken` — o `router.push` sozinho só troca a query e o fio ficava na conversa antiga. Não reabre a conversa já ativa. Pino em `cartao-de-notificacao.chamadores.test.ts` |
| `src/app/(dashboard)/dashboard-shell.tsx` (Meu dia, 12/09/2026) | envolve o layout INTEIRO (menu, cabeçalho, página, heartbeat) na `<PortaDeEntrada key={user.id}>`, abaixo do `if (!user) return null` — nunca renderizar pedaço do app fora dela; e o "Loading..." traduzido (`DashboardShell.loading`) |
| `dashboard-shell.tsx`, `inbox/page.tsx`, `message-composer.tsx`, `message-thread.tsx` e `src/app/globals.css` (teclado do celular, 14/09/2026) | a altura por `var(--altura-visivel,100dvh)` na casca e na caixa de entrada (um merge que devolva `h-screen`/`100vh` devolve o cabeçalho sumindo com o teclado) e o `useTelaAcimaDoTeclado()` na casca; no compositor, o Enter por `enterEnvia` e a dica por `useMediaQuery(MIDIA_DE_TOQUE)`; no fio, o `data-acima-do-teclado` na raiz, o `onTouchStart`/`onTouchMove` do contêiner (recolhe o teclado) e o `ResizeObserver` que mantém o fim; no CSS, a regra dos 16 px FORA de camada. Ver a seção "O teclado do celular" |
| `src/hooks/use-auth.tsx` (Meu dia) | `sessionId` no contexto (o `session_id` do token, publicado no MESMO passo que `user`, no init e no listener) e o `signOut` do menu via `sairDesteAparelho` (escopo `local`, D4, 12/09/2026; erro vira toast e não navega) — além do que já era nosso (lente de simulação, perfis, `resolvedUserIdRef`) |
| `src/components/layout/header.tsx` (Meu dia) | `"/agenda": "agenda"` no `pageTitles`, DEPOIS de `/agendadas` (o mapa casa por `startsWith` na ordem de inserção); e `"/meu-dia": "meuDia"` |
| `src/components/layout/sidebar.tsx` (Meu dia, F3) | o item `/meu-dia` em `navItems`, fora do catálogo de perfis |
| `src/middleware.ts` (Meu dia, F3) | `/meu-dia` em `protectedPaths` |
| `src/app/layout.tsx` (app no celular, 14/09/2026) | `appleWebApp` com `NOME_CURTO_DO_APP` (o nome que o iPhone sugere embaixo do ícone) e a REMOÇÃO do `icons` do upstream: declarado, ele faz o Next ignorar os ícones de arquivo, e o `<head>` sai sem `apple-touch-icon` — um merge que o traga de volta tira o ícone do app instalado sem conflito nenhum (há pino). O manifesto e o ícone são arquivos NOSSOS (`manifest.ts`, `apple-icon.tsx`); ver a seção "App instalado no celular" |
| `src/lib/dashboard/queries.ts` (i18n, Fase 10c, 24/09/2026) | `loadActivity` devolve DADO (`quem`, `titulo`/`etapa`, `nome`/`status`/`total`, `automacao`/`falhou`), não a frase pronta em inglês ("New message from …", "Automation … triggered for …"), e o contato embutido leva `instagram_username` (nome por `nomeDoContato`). Um merge que traga o `text:` cru não compila contra o nosso `ActivityItem`; pino em `src/i18n/textos-portados.test.ts` |
| `src/lib/dashboard/types.ts` (Fase 10c) | `ActivityItem` virou união discriminada por `kind`, SEM `text`: é o que obriga a frase do feed a sair do dicionário |
| `src/components/dashboard/activity-feed.tsx` (Fase 10c) | `textoDoItem`: a frase de cada linha sai de `Dashboard.activityFeed.eventos.*` (chave literal por tipo, nome desconhecido com texto de queda traduzido) e a situação do disparo de `Broadcasts.status` |
| `src/lib/presence.ts` (Fase 10c) | os dias saem com `numeric: "always"` ("há 1 dia", nunca "ontem": são blocos de 24 h, não dias de calendário); `formatLastSeen` recebe o IDIOMA (`LOCALE_DAS_DATAS.code`, nunca o do navegador) e usa `Intl.RelativeTimeFormat`, devolvendo `null` sem data; `presenceLabel` SAIU — a moldura em inglês ("Offline — last seen …") virou `Presence.*`, no hook NOSSO `src/hooks/use-rotulo-de-presenca.ts`. Um merge que traga o arquivo cru devolve o inglês e quebra o hook no typecheck |
| `src/app/(dashboard)/notifications/page.tsx` (Fase 10e) | o aviso de ATRIBUIÇÃO é escrito pelo TIPO (`textoDoAviso`, `src/lib/notifications/texto-do-aviso.ts`, NOSSO), com o nome de quem atribuiu (`useMembros`) e o do contato (embutido no select); o gatilho da 0027 grava o texto em inglês ("New conversation assigned"), e a versão do original mostra `n.title`/`n.body` crus |
| `src/components/themed-toaster.tsx` (Fase 10e) | `containerAriaLabel` traduzido (`Toaster.rotulo`): sem ele o sonner anuncia "Notifications alt+T" ao leitor de tela |
| `src/components/settings/members-tab.tsx` (Fase 10c) | o texto da bolinha de presença vem de `useRotuloDePresenca()`, não do `presenceLabel` do original |
| `src/components/ui/gated-button.tsx` (Fase 10d) | `gateReason` é `AcaoBloqueada` (id TIPADO) traduzido por `rotuloDaAcao` (`GatedButton.acoes.*`, uma chave literal por ação, `switch` com `never`), não a frase em inglês do call site — que saía "seu papel não permite create broadcasts". Um merge que traga o arquivo cru devolve o `string` |
| páginas `broadcasts`, `broadcasts/[id]`, `contacts`, `flows`, `automations`, `pipelines` e `message-composer.tsx` (Fase 10d) | os `gateReason` como id (`createBroadcasts`, `addOrImportContacts`, `sendMessages`…). O tipo recusa a frase em inglês que um merge traga, e o pino `textos-portados.test.ts` varre o repo atrás de `gateReason` com espaço |
| `src/lib/whatsapp/interactive.ts` (Fase 10d) | a falha leva `codigo` (`CodigoDaInterativa`, de `interativa-mensagem.ts`, NOSSO) + `params`, que a TELA traduz; o `error` em inglês FICA (contrato das rotas de respostas rápidas, do núcleo de envio e da ativação de automação). Cada `fail(` passa um código, e `interativa-mensagem.test.ts` confere que todo código da lista é produzido aqui. O teste do original (`interactive.test.ts`) ganhou `codigo`/`params` no `toEqual` do id repetido |
| `src/components/interactive/interactive-builder.tsx` (Fase 10c/10d) | o erro de validação por `mensagemDaInterativa(validation, tValidacao)` (era `{validation.error}`, inglês cru) e o título "Preview" pela chave `Interactive.builder.preview` |
| `src/components/inbox/message-composer.tsx` (i18n, Fase 10c/10d) | a falha da interativa por `mensagemDaInterativa` (era `toast.error(result.error)`), a do upload por `mensagemDoUpload`, e `uploadFailed`/`arquivoGrandeDemais` no lugar do inglês fixo |
| `src/lib/storage/upload-media.ts` (Fase 10d) | as duas falhas antes do upload ("Not signed in.", "Could not resolve your account.") lançam `ErroDeUpload` (NOSSO, `erro-de-upload.ts`) com o motivo que a tela traduz; a mensagem em inglês fica na exceção. Pino em `erro-de-upload.test.ts` |
| `src/components/settings/template-manager.tsx`, `src/components/flows/forms/node-config-form.tsx`, `src/components/automations/automation-builder.tsx` (Fase 10d) | o erro do upload por `mensagemDoUpload(err, tUpload, …)` (era `err.message` cru); no `template-manager`, também o `alt` da amostra do cabeçalho por chave |
| `src/app/(dashboard)/automations/page.tsx`, `contacts/page.tsx`, `broadcasts/[id]/page.tsx`, `src/components/flows/flow-editor-state.tsx`, `src/components/settings/invite-member-dialog.tsx`, `src/components/contacts/import-modal.tsx` (Fase 10c) | chaves no lugar do inglês fixo (falha de carga, aria-labels, "Funnel", contato desconhecido, falhas do fluxo e do convite, o "(+N more)"). Um merge que traga a versão crua devolve o inglês sem conflito — o pino `textos-portados.test.ts` reprova |

## 5. Migrations do original: a história das renumerações

A regra de numeração mora na raiz do `CLAUDE.md` (seção 7) e em
`.claude/rules/supabase.md`. Aqui fica o que aconteceu com as migrations
DELES a cada merge, que é o que se repete. Texto movido do `CLAUDE.md`
(seção "Workflow de migrations"), sem reescrever.

- **Todo merge do upstream traz migration nova com 3 dígitos: RENUMERE para
  o número seguinte ao maior do `main`, com prefixo `cb_` — nunca completando com zero à
  esquerda** (`043_x` → `1040_cb_x`, não `0043_x`). O zero à esquerda ordena
  a migration ANTES das já aplicadas, e o `supabase db push` de quem instalou
  a recusa; foi o que o merge #259 fez com a `0043`/`0045` (renumeradas para
  1038/1039 na correção dele). O teste reprova o arquivo de 3 dígitos E
  qualquer número novo abaixo de 0900
  (`supabase/migrations/nomes-das-migrations.test.ts`).
- ⚠️⚠️ **UMA exceção: a `041_fix_broadcast_contact_id_ambiguity.sql` DELES é
  APAGADA, não renomeada** (não confundir com a nossa `0041_broadcast_resume`,
  que é a 038 deles). Ela recria `create_broadcast_with_recipients` com OITO
  parâmetros — o overload que a 0940 apagou de propósito. Renomeada para
  `0044_`, o replay passa (a 0940 roda depois e a apaga), mas a PRODUÇÃO aplica
  por ordem CRONOLÓGICA e ficaria com as duas: chamada sem `p_channel_id` cai na
  que não carimba o canal. Medido num Postgres 16 em 21/09/2026. O conserto
  equivalente — e maior — é a nossa **1030**. Quem pega o arquivo renomeado é o
  pino (`supabase/migrations/funcao-de-disparo-1030.test.ts`, vitest); o
  `verify-schema.sql` só pega o caso em que as duas chegam ao FIM do replay —
  arquivo numerado DEPOIS da 1030. E a própria 1030, reaplicada, APAGA a de
  oito.
- ⚠️ **Evitar colisão de número com o upstream:** como o original também numera
  em sequência, se criarmos `0037_...` e o upstream criar `037_...`, colidem no
  merge. **Nossas migrations próprias usam a faixa reservada `0900+`** (e, a
  partir de `1000`, a continuação dela) e prefixo `cb_` na descrição:
  `1000_cb_<descricao>.sql`, `1001_cb_...`. Assim ficam isoladas da numeração
  do upstream, que não passa de dezenas.
- ⚠️ **Exceção existente:** a integração Evolution criou
  `0037_evolution_transport.sql` na sequência do upstream, não no `900+`. Já está
  aplicada e no `main` — **não renumerar**. É exceção conhecida; daqui em diante
  seguir o `900+`. Se o upstream um dia criar um `037_*`, resolver o conflito de
  número renomeando o **do upstream** no merge, nunca o nosso já aplicado.
  ✅ **Isso aconteceu no merge de 2026-08-26.** O upstream criou
  `037_webhook_broadcast_reliability.sql`, colidindo com a nossa. As **três**
  dele foram renumeradas — `037→040`, `038→041`, `039→042` — e não só a que
  colidia: a `041` dropa a função que a `040` cria, então a ordem relativa
  tinha de ser preservada. ⚠️ O Git **não** reporta essa colisão como
  conflito (são nomes de arquivo diferentes) — conferir à mão a cada merge.
- **As `040`/`042` do original viraram 1038 e 1039** no merge de
  22/09/2026 (o #259 as trouxera como `0043`/`0045`): ver a §3.1, item
  "As migrations do upstream viraram 1038 e 1039". Com o cabeçalho
  reescrito, o Git não as pareia — edição do original nelas volta como
  conflito modify/delete (§6, item 12).

## 6. O que se desfaz a CADA merge

Única cópia desta lista. Cada item volta sem conflito, ou como conflito que a
regra "fica o nosso" não resolve sozinha. Vale para mudança do original
depois de `aee1b01f` (§3.1).

**Apagar de novo:**

1. `messages/ko.json`, `messages/pt.json` e `messages/es.json`. O
   `src/i18n/request.ts` carrega o dicionário do locale se o arquivo existir,
   e dicionário pela metade mostra caminho de chave cru na tela. Pino:
   `src/i18n/dicionarios-servidos.test.ts` (só `en.json` e `pt-BR.json`).
2. O `['ko']` do `src/i18n/messages.test.ts`: o teste confere `pt-BR`.
3. `.github/workflows/ci.yml` e `.github/workflows/migrations.yml`. O
   workflow é um só, o `pipeline.yml`; com os dois de volta as etapas rodam
   duas vezes por push. Pino do portão: `.github/workflows/pipeline.test.ts`.
4. `docs/whatsapp-connection-troubleshooting.md`. Volta como conflito
   modify/delete quando o original mexe nele. O nosso é `docs/conexao-meta.md`.
5. A `041_fix_broadcast_contact_id_ambiguity.sql` do original: APAGADA, nunca
   renumerada (§5). Pino: `supabase/migrations/funcao-de-disparo-1030.test.ts`.

**Refazer:**

6. `node-version: <n>` cravado no workflow → `node-version-file: .nvmrc`.
   Sem isso o CI volta a poder rodar outra major do Node.
7. `agentRules: false` no `next.config.ts`. Sem a linha, o `next dev`
   reescreve o `AGENTS.md` rastreado; o sintoma é ` M AGENTS.md` sozinho no
   `git status` de quem só subiu o servidor.
8. Migration nova do original, com 3 dígitos → o maior número do `main` + 1,
   com prefixo `cb_`, nunca zero à esquerda (§5). Pino:
   `supabase/migrations/nomes-das-migrations.test.ts`.
9. Policy de LEITURA do original (tabela nova ou policy recriada) → a forma
   da 1032, `account_id = ANY (ARRAY(SELECT public.cb_contas_do_usuario()))`.
   A do original roda por linha e devolve a lentidão sem quebrar tela
   nenhuma. Pino: `supabase/migrations/rls-leitura-1032.test.ts`.
10. Dicionários por UNIÃO, nunca substituição: as chaves novas do `en.json`
    deles entram nos DOIS dicionários (`node scripts/i18n-parity.mjs`, §1).
    Chave que os dois lados acrescentam ao mesmo objeto vira chave REPETIDA,
    sem conflito — quem pega é `src/i18n/chaves-duplicadas.test.ts`. Chave
    nova com o nome do produto do original ("wacrm") segue a regra da marca.
    Seção de Configurações que só existe no dicionário deles sai
    (`src/components/settings/rotulo-da-secao.test.ts` reprova seção órfã).
11. `.gitignore`: manter `.claude/*` + `!.claude/rules/`. Resolver o conflito
    ficando com o lado deles faz toda regra NOVA deixar de ser commitada, sem
    aviso (as já rastreadas continuam).

**Conferir à mão:**

12. `git diff --summary supabase/migrations/`: as nossas `0040`–`0042` (as
    037–039 deles, renomeadas) recebem edição do original EM SILÊNCIO —
    portar à mão numa migration nova. A 040/042 deles (hoje 1038/1039) volta
    como conflito modify/delete, com o arquivo de 3 dígitos: apagar de novo e
    portar à mão.
13. Os arquivos que o Git mesclou SOZINHO (os dois lados mudaram, sem
    conflito): revisar um por um. Foi por eles que metade do #586 entrou no
    merge de 22/09 (§3.1).
14. Renomeação do original em arquivo que NÃO conflitou: o nosso código fica
    chamando o nome antigo. Critério de adoção na §3.1.
15. As linhas da §4, uma por uma. As que mais voltam sem conflito:
    `resolveTemplateRow` com `channelId` nos 5 call sites (§3.2), as rotas
    `whatsapp/config` e `whatsapp/templates/[id]` (pino
    `src/app/api/whatsapp/guarda-de-papel-so-nossa.test.ts`) e o
    `supabase/ci/verify-schema.sql` com as NOSSAS asserções.

## 7. Arquivos que ficam NOSSOS inteiros

Nestes, conflito se resolve ficando com o nosso lado INTEIRO e trazendo à mão
só o que for novo do original. Costurar trecho a trecho já produziu código
que não era de ninguém (§3.1, o `-X ours`).

| Arquivo | Por quê |
| --- | --- |
| `src/components/inbox/message-bubble.tsx` | o visualizador de mídia é o nosso (`media-viewer.tsx`, com giro e zoom); o do original (#467) foi descartado. `media-lightbox.tsx` e `message-media.tsx` vieram num merge e NÃO estão ligados: religá-los põe dois visualizadores no inbox |
| `src/components/inbox/message-thread.tsx` | o mesmo motivo, mais o fio intercalado, a janela de 24h por número, a rolagem, o salto da busca e o canal na conversa (linhas da §4) |
| `src/components/inbox/conversation-list.tsx` | praticamente reescrito na 924: o recorte mora em `src/lib/inbox/filtros.ts` e a barra é o `<InboxFilters>` |
| `src/components/pipelines/deal-card.tsx` | reestruturado inteiro no PR #71: o corpo abre a CONVERSA, o lápis irmão edita |
| `src/components/ui/select.tsx` | deriva `items` dos próprios `<SelectItem>`. Sem isso o `<Select.Value />` do base-ui mostra o valor CRU (`openai`, `__queue__`) em ~20 telas. O wrapper repassa os genéricos `<Value, Multiple>`: tipado sem eles, todo `onValueChange` vira `any` implícito |

**Este arquivo veio do upstream?**

```bash
git cat-file -e aee1b01f:<caminho> && echo "veio do upstream" || echo "não estava no upstream em aee1b01f"
```

`aee1b01f` é o commit do original que o merge de 22/09/2026 tornou ancestral
do `main`. Se o arquivo existia lá, trecho nosso nele ganha linha na §4.
Arquivo que o original criou DEPOIS de `aee1b01f` não aparece ali — confira
também com `git cat-file -e upstream/main:<caminho>` (depois de
`git fetch upstream`).
