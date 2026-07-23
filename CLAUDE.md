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
- **Trabalhar sempre em `cb-advogados` (ou branch derivada), nunca no `main`.**
  Ver seção "Fork + upstream". O `main` é espelho limpo do original.
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
- `supabase/migrations/` — migrations SQL (ver seção própria). **Não há
  `config.toml`** — a CLI do Supabase ainda não está linkada neste repo.
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
| `origin`   | `leonardocabralb/CB-CRM`   | Nosso fork — para onde fazemos **push**        |
| `upstream` | `ArnasDon/wacrm`           | Original — de onde só **puxamos** (read-only). **Nunca push.** |

| Branch         | Função                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| `main`         | **Espelho limpo do original.** NÃO customizar aqui. Só reflete `upstream/main`. |
| `cb-advogados` | **Branch de trabalho.** Todas as customizações do CB Advogados vivem aqui.  |

> **Regra de ouro:** o `main` deve permanecer idêntico ao `upstream/main`. Todo
> código nosso vai para `cb-advogados` (ou branches derivadas). Isso mantém as
> atualizações do upstream sem conflito.

**Puxar atualizações do original:**

```bash
git fetch upstream                 # busca novidades (não altera nada)
git checkout main
git merge upstream/main            # fast-forward, sem conflito
git push origin main               # backup no nosso fork
git checkout cb-advogados
git merge main                     # aqui podem surgir conflitos (resolver)

node scripts/i18n-parity.mjs       # ⚠️ OBRIGATÓRIO — ver abaixo
npm run typecheck && npm run test

git push origin cb-advogados
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
`git diff --stat upstream/main cb-advogados`): `messages/en.json` é o campo de
batalha — o upstream mexe nele a cada feature e nós temos tradução por cima.
Também são nossos: `messages/pt-BR.json`, `CLAUDE.md`, `.gitignore`,
`scripts/`, `supabase/migrations/900_*` e os componentes que
internacionalizamos (o upstream tem string literal onde nós temos `t('chave')`
— ao resolver, manter a nossa forma e levar o texto novo dele para os **dois**
dicionários).

## Branches — criação e nomenclatura

- Toda branch nova sai **de `cb-advogados`** (nunca de `main`) e faz merge **de
  volta para `cb-advogados`**.
- Nomenclatura: `<tipo>/<descricao-kebab-case>`, com `tipo` ∈
  `feat` · `fix` · `chore` · `docs` · `refactor`. (Mesma convenção do upstream.)
  Ex.: `feat/integracao-processos-tj`, `fix/webhook-duplicado`.
- `git pull` na `cb-advogados` antes de criar a branch.

## Workflow de migrations (Supabase)

- **Nomenclatura:** `NNN_descricao_snake_case.sql`, sequencial de 3 dígitos
  (o upstream está em `036`). ⚠️ **NÃO é timestamp.**
- ⚠️ **Evitar colisão de número com o upstream:** como o original também numera
  em sequência, se criarmos `037_...` e o upstream criar `037_...`, colidem no
  merge. **Nossas migrations próprias usam a faixa reservada `900+`** e prefixo
  `cb_` na descrição: `900_cb_<descricao>.sql`, `901_cb_...`. Assim ficam
  isoladas da numeração do upstream.
- Criar o arquivo de migration **antes** de aplicar.
- Aplicar em **ordem numérica** no projeto Supabase — via CLI do Supabase
  (`supabase db push`, exige `supabase link` antes, ainda não configurado) ou
  colando os SQL no **SQL Editor** em ordem. **Nunca** editar schema à mão pelo
  editor de tabelas da UI (causa drift).
- **Nunca renomear nem renumerar** migration já aplicada.
- Antes de criar nova, **validar drift** entre local e o projeto Supabase.

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

- ⚠️ **Alvo de deploy do CB Advogados ainda não definido** — não deduzir.
  Confirmar com o operador antes de qualquer ação de deploy.
- Referência do upstream: recomenda **Hostinger** (Node.js gerenciado; push no
  `main` builda). Roda em qualquer host Node (Vercel, Railway, VPS).
- Restrição fixa: o webhook do WhatsApp **exige HTTPS** — o endpoint precisa de
  URL pública com SSL.

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
- **Assistente de IA:** bring-your-own-key (OpenAI/Anthropic) — cada conta cola
  sua chave em Settings → AI Assistant, guardada criptografada com
  `ENCRYPTION_KEY`. Não há env var global de provider.

## Antes de aplicar mudanças

- [ ] Estamos em `cb-advogados` (ou branch derivada dela)? Nunca no `main`.
- [ ] `git pull` antes de começar.
- [ ] Se mexer em schema: migration na faixa `900+`/`cb_` e check de drift.
- [ ] Não commitar `.env.local` (confirmar com `git status`).
- [ ] Rodar `npm run typecheck` e `npm run lint` antes de finalizar.

## Não faça

- ❌ Customizar/commitar no `main` (ele é espelho limpo do `upstream`).
- ❌ `git push` no `upstream` (é read-only).
- ❌ Numerar migration nossa na sequência do upstream (`037`, `038`…) em vez da
  faixa reservada `900+`.
- ❌ Renomear/renumerar migration já aplicada.
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
