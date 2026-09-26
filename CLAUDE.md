@AGENTS.md

# CLAUDE.md — Convenções do projeto CB CRM

## 0. Leia ANTES (obrigatório)

- **(a) Regra da área, pela Read.** Antes de EDITAR, CRIAR arquivo ou REVISAR
  diff numa área, abra pela ferramenta Read o arquivo de regra dela em
  `.claude/rules/` (índice na seção 13). Leia o código também pela Read: a
  regra só carrega sozinha quando a Read abre um arquivo que casa os `paths:`
  dela. `cat`, `sed`, `grep` e `git diff` no terminal NÃO carregam regra, e
  depois de um `/compact` ela só volta quando o arquivo é relido. Para um diff
  ou um arquivo que ainda não existe: `node scripts/regras-do-diff.mjs [base]`
  ou `--caminho <arquivo…>` diz quais regras abrir.
- **(b) Merge do upstream**, cherry-pick do original ou conflito com
  `upstream/main`: `docs/MERGE-UPSTREAM.md` INTEIRO antes.
- **(c) Qualquer comando na VPS** (docker service/stack, restart, Redis,
  `crm.env`): `docs/INFRA-VPS.md` INTEIRO antes.
- **(d) Escrita manual ou em lote no banco de PRODUÇÃO** (SQL pelo conector
  MCP, Management API, script): `.claude/rules/supabase.md` antes — gatilhos
  disparam POR LINHA, apagar contato deixa ponteiros nulos, fundir fichas só
  pela receita.
- **(e) Proposta que muda comportamento de produto:** seção 12 primeiro.
- **(f) Subagente:** o prompt manda ler este arquivo e as regras da área PELA
  Read (o subagente Plan não carrega o CLAUDE.md).
- **(g) O que já está aplicado no banco:** `docs/MIGRATIONS-APLICADAS.md` (o
  schema é a verdade; a lista envelhece).

**Como este arquivo funciona.** Só entra regra load-bearing: o que, ignorado,
quebra algo. Ele descreve o estado INTENCIONAL e envelhece: confirme contra a
realidade (grep, arquivo, consulta) antes de decidir, e corrija a divergência
no mesmo PR. Nota mentindo é pior que ausência de nota.

**Onde cada nota mora.** Transversal (vale em código de qualquer pasta) →
aqui, 1–3 linhas com UMA linha de porquê, sem data, PR nem rodada. De área →
o arquivo da área em `.claude/rules/`. Lista de consulta →
`docs/MERGE-UPSTREAM.md` e `docs/MIGRATIONS-APLICADAS.md`. Narrativa, medição
datada, rodada de revisão e PENDÊNCIA aberta → descrição do PR ou
`docs/PLANO-*.md` (a pendência muda de casa, nunca some).

**Teto.** Este arquivo tem teto de 40 KB e cada regra de área de 25 KB,
cobrados por `scripts/instrucoes.test.ts`; nota nova de área vai para o
arquivo da área, nunca para cá. O mesmo teste exige `paths:` em toda regra,
todo glob casando arquivo versionado, toda regra listada no índice. Estourou:
condensar ou mover, nunca subir o teto.

**Texto integral anterior:** `git show f5879b3f:CLAUDE.md` (626 KB, com a
história: datas, medições, rodadas de revisão). Comentário do código que diz
"ver CLAUDE.md, seção X": mapa no fim da seção 13, ou
`grep -rni 'X' CLAUDE.md .claude/rules docs` — os títulos antigos continuam
como `###` nas regras.

## 1. O que é este projeto

Fork do **wacrm** (`ArnasDon/wacrm`), CRM de WhatsApp (Next.js 16 + Supabase
+ Meta Cloud API) com inbox compartilhado, contatos, funis, disparos,
automações e IA. Moldado para o **CB Advogados**: gestão de WhatsApp com
integrações próprias. Seguimos incorporando melhorias do original por merge
pontual.

## 2. Como trabalhar

- **Planejar antes de agir.** Tarefa não trivial: expor o plano (passos,
  arquivos, riscos) antes de tocar em código.
- **Nunca deduzir.** Faltou informação (rota, schema, regra de negócio,
  intenção)? Pergunte ou verifique no código/banco. Não inferir requisito de
  nome de variável ou contexto vago.
- **Branch derivada de `main`, nunca commit direto no `main`** (é o nosso
  trunk).
- **Caminho mais simples.** Sem abstração para futuro hipotético, sem
  fallback para cenário impossível, sem helper de uma chamada só. Três linhas
  parecidas > abstração prematura.
- **Módulo novo em vez de reescrever o core:** customização isolada reduz
  conflito com o upstream.
- **Revisar 2x ao finalizar:** (1) bugs e bordas; (2) convenções e objetivo
  original. Relatar, mesmo que seja "nada encontrado".
- **Ação destrutiva só com confirmação explícita NAQUELA conversa:**
  `git push --force`, `reset --hard`, `branch -D`, `rm -rf`, `DROP TABLE`,
  `TRUNCATE`, `DELETE` sem `WHERE`, apagar arquivo ou migration aplicada,
  sobrescrever credencial, push no `upstream`. Aprovar uma vez ≠ aprovar
  sempre.
- **Ao pedir essa confirmação, explicar o impacto sem jargão:** o que se
  perde, o que pode quebrar, se dá para desfazer e como.
- **Subagente em tarefa ampla (planejamento, revisão) → modelo mais capaz.**
  Pesquisa simples pode ficar no padrão.

## 3. Estrutura

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Supabase (Postgres + Auth + Storage + RLS) · Meta Cloud API · Evolution API.

- `src/app/` — rotas; `(auth)` e `(dashboard)` são route groups; `api/` tem
  webhooks, crons e a API pública `/api/v1`. Next 16 com breaking changes
  (`AGENTS.md`).
- `src/lib/` — negócio por domínio; integração nova em módulo novo.
  `src/components/`, `src/hooks/`, `src/i18n/`, `src/types/`.
- `supabase/migrations/` (seção 7). `supabase/config.toml` só serve ao replay
  do CI: a CLI não é linkada.
- `messages/` — SÓ `en.json` (referência) e `pt-BR.json`, completos e em
  paridade. `src/i18n/dicionarios-servidos.test.ts` reprova outro arquivo: um
  dicionário pela metade, escolhido por `NEXT_PUBLIC_APP_LOCALE`, entrega
  chave crua na tela.
- `mcp-server/` — subprojeto com `package.json` próprio: `npm` dentro dele.
- `docs/` — ENTREGUES a quem instala: `README`, `INSTALACAO`, `ATUALIZAR`,
  `docker`, `public-api`, `mcp`, `webhooks`, `multi-waba`, `conexao-meta`.
  INTERNOS (nossa operação, não viajam): `PLANO-*`, `HANDOFF-*`, `INFRA-VPS`,
  `DEPLOY-VPS`, `MERGE-UPSTREAM`, `MIGRATIONS-APLICADAS`. `EVOLUTION-LID-FIX`
  está obsoleto.
- `.env.local` — segredos; nunca commitar; modelo em `.env.local.example`.
- `.claude/rules/` é versionado; o resto de `.claude/` é ignorado. O
  `.gitignore` mantém `!.claude/rules/`: resolvido pelo lado do upstream num
  merge, toda regra NOVA deixa de ser commitada, sem aviso.

## 4. Fork + upstream

- `origin` = `leonardocabralb/CB-CRM` (push e PR). `upstream` =
  `ArnasDon/wacrm`, só leitura: **nunca push, nunca PR**. O `main` é o NOSSO
  trunk (fork definitivo).
- **Regras de ouro:** (1) PR só para branches do CB-CRM — nunca para
  qualquer branch do upstream; (2) branch de desenvolvimento só a partir de
  `main`, nunca de outra branch nem do upstream.
- Merge, cherry-pick ou conflito com o upstream: `docs/MERGE-UPSTREAM.md`
  INTEIRO. Lá moram a receita, a lista do que se desfaz a CADA merge (só lá:
  a cópia que havia aqui já tinha divergido), as decisões dos merges, os
  arquivos que ficam nossos inteiros e a tabela dos trechos NOSSOS em
  arquivos do upstream.
- Trecho NOSSO novo num arquivo que veio do upstream
  (`git cat-file -e aee1b01f:<caminho>` responde se veio) → uma linha na
  tabela de `docs/MERGE-UPSTREAM.md` no mesmo PR. É ela que impede o próximo
  merge de apagá-lo.
- Ancestralidade fechada em `aee1b01f`: o que a resolução daquele merge
  descartou NÃO volta por merge — porte à mão.
- Conflito se resolve por ARQUIVO INTEIRO (`git checkout --ours/--theirs`),
  nunca `-X ours`: ele costura imports de um lado com código do outro.
  Arquivo que o Git mesclou SOZINHO também se revisa (o upstream renomeia em
  arquivo que não conflita).
- Conflito só nasce na mesma linha do mesmo arquivo: prefira módulo novo.

## 5. Toolchain e CI

- **Uma major de Node, no `.nvmrc` (22).** O CI lê `node-version-file`; o
  `ARG NODE_VERSION` do `Dockerfile` é o único número duplicado (mudou um,
  muda o outro); `engines` `>=22.12.0` na raiz e no `mcp-server/`;
  `packageManager: npm@10.9.9` acompanha a major. Teste de Intl, fuso ou
  colação só vale na major do CI: `nvm use` antes de tudo.
- **Um workflow só:** `.github/workflows/pipeline.yml` — verificar →
  migrations (replay num Postgres limpo) → deploy, com
  `needs: [verificar, migrations]` (pino `pipeline.test.ts`).
- `agentRules: false` no `next.config.ts`: sem ela o `next dev` reescreve o
  `AGENTS.md` rastreado (worktree suja; pacote escrevendo nas instruções).

## 6. Branches

`git checkout main && git pull origin main` antes de criar. Nome
`<tipo>/<descricao-kebab>`, tipo ∈ `feat`·`fix`·`chore`·`docs`·`refactor`.
Volta para `main` por PR no CB-CRM.

## 7. Migrations — o núcleo

- **Nome `NNNN_cb_<descricao>.sql`, 4 dígitos, número NOVO = maior do `main`
  + 1**, faixa nossa `0900+`/`1000+` com `cb_` (a `0037` é exceção
  histórica). Nunca completar com zero à esquerda: o replay ordena por NOME e
  a instalação que atualiza por `supabase db push` recusa número abaixo do
  maior aplicado (pino `nomes-das-migrations.test.ts`).
- Antes de escolher o número: `ls supabase/migrations` E `list_migrations`.
  Branches paralelas colidem, e o Git não acusa (os nomes diferem).
- Nunca renomear/renumerar migration aplicada. Nunca `supabase db push` na
  NOSSA produção (histórico por timestamp: tentaria reaplicar tudo). Nunca
  editar schema pela UI de tabelas (drift).
- Projeto = ref do `NEXT_PUBLIC_SUPABASE_URL` do `.env.local`
  (`hxnhakmyxyhalbsktzwe`). Ref errado dá "permission denied" que não é falta
  de permissão.
- **Ordem:** arquivo → replay verde do CI no commit exato → aplicar
  (conector MCP ou Management API, com autorização do operador) → merge.
  ADITIVA (coluna que o app novo lê): aplicar ANTES do deploy. RESTRITIVA
  (tira permissão, aperta índice): DEPOIS, senão o app antigo quebra na
  janela.
- **Tem de aplicar num banco VAZIO** (o replay; a próxima instalação): todo
  privilégio que a migration confere, ela concede (depois de `REVOKE`,
  `GRANT` de volta — o default do Supabase não existe em banco novo);
  conferência que precisa de dado o deriva do banco e pula com
  `RAISE NOTICE`; função plpgsql nova ou recriada é CHAMADA pela conferência
  num subbloco desfeito por SQLSTATE próprio (o corpo só é analisado quando
  roda). RPC se prova pelo caminho do PostgREST (o TIPO do argumento decide o
  que chega), num Postgres descartável com as restrições REAIS da tabela.
  Modelos em `.claude/rules/supabase.md`. Local: `supabase db start`.
- O histórico do Supabase não é fonte completa: para saber se algo está
  aplicado, consulte o schema. Ao aplicar, acrescente a entrada em
  `docs/MIGRATIONS-APLICADAS.md`.

## 8. Regras transversais

### 8a. Dados e posse

- **DONO DURÁVEL.** `contacts`, `conversations` e `custom_fields.user_id`
  CASCADEiam de `auth.users` (a conversa leva as mensagens). Todo INSERT
  grava `accounts.owner_user_id` (no cliente, `useAuth().ownerUserId`), com
  falha FECHADA, nunca `user.id`: apagar o login de quem saiu levaria os
  clientes junto. Pino `src/lib/contacts/dono-duravel.test.ts`.
- Nas outras tabelas `user_id` é AUTORIA: tela não recorta catálogo da conta
  com `.eq('user_id', …)` (o membro via o catálogo vazio). Só dado da PESSOA
  (favoritas, filtros salvos, avisos, perfil) se recorta assim.
- `profiles.id` ≠ `profiles.user_id`: `deals.assigned_to` guarda
  `profiles.id`; `cb_tasks`, `conversations` e `notifications` guardam o id
  do LOGIN. Trocar dá 0 linhas, sem erro.
- Apagar contato leva conversa e mensagens (CASCADE) e deixa ~15 tabelas com
  ponteiro nulo (card em branco no Kanban). Fundir fichas = a receita de
  `.claude/rules/supabase.md`; `merge_duplicate_contacts` não serve.
- Negócio só nasce por `createDeal` no servidor (exceção: formulário do
  Funil). Transferência de funil = UM UPDATE (`pipeline_id` + `stage_id`
  juntos), senão a trilha conta duas mudanças. `cb_lead_events` e
  `cb_automation_events` são escritos por GATILHO: o app nunca grava neles.

### 8b. Supabase e PostgREST

- ⚠️ **O `.env.local` aponta para o banco (e as integrações) da PRODUÇÃO:**
  teste no preview grava em dado real. Sem sandbox de integração neste banco
  (conectar o do Asaas trocaria a conexão de produção), sem registrar webhook
  de provedor a partir do preview, e nunca usar como destino de teste um
  número que é conexão do CRM (a outra conexão o grava como cliente).
- O supabase-js DEVOLVE `error`, não lança: confira sempre. Erro de leitura
  nunca é "não encontrado" (404 falso faz o integrador recriar e duplicar).
- **RLS que barra ESCRITA devolve 0 linhas com `error: null`.** Toda escrita
  do navegador confere count/retorno; o porquê de zero linhas se MEDE (a
  linha ainda existe?), nunca se infere do papel em cache. Tabela
  service-role only lida do navegador devolve vazio com cara de certo → ler
  por rota; rota que falha responde 500, nunca `{}`; o hook devolve `null`
  ("não sei").
- **PostgREST corta em 1000 linhas sem avisar:** paginar (`range` +
  `count: 'exact'`; por CHAVE quando há escrita concorrente). Lista com teto
  nunca vira número exato ("mais de N").
- Embed LEFT × `!inner`: filtro no embutido sem `!inner` devolve a linha com
  o embutido nulo; com `!inner` some quem não tem o embutido (toda conversa
  de grupo). Recorte por campo do contato vai em JS. Sem FK não há embed
  (buscar por id).
- `onConflict`/upsert só com índice único TOTAL: os parciais da 903 em
  `message_templates`/`ai_configs` não servem. Upsert exige as colunas NOT
  NULL → atualização parcial por RPC ou lookup + update. `maybeSingle` só com
  recorte que garante UMA linha (o canal, ou `.is('channel_id', null)`).
- `storage.exists()`: objeto ausente resolve `{ data: false, error }` → ler
  `data === false` ANTES do `error`; 5xx/rede é LANÇADO → try/catch;
  Storage fora do ar ≠ arquivo sumiu. URL de mídia é derivada do caminho
  (`getPublicUrl`), nunca aceita do cliente.
- Forma nova de consulta (caminho JSON, `!inner`, cabeçalho) se MEDE contra
  o PostgREST real: o dublê de teste imita a forma SUPOSTA.
- `custom_fields`: `.order('posicao', { nullsFirst: false }).order('field_name')`
  SÓ em quem reagrupa por bloco (`agruparCampos`/`ordenarCampos`). Lista
  PLANA (disparo, automação, API v1 — contrato com o n8n) ordena só por
  `field_name`: `posicao` reinicia em cada bloco e, ordenada na conta
  inteira, intercala os blocos sem erro nenhum.

### 8c. React e tela

- **EFEITO PASSIVO:** o primeiro render depois de trocar de conversa/contato
  mostra o estado ANTERIOR. Carimbe o dono dos dados (`{ de, … }`) e compare
  com a prop do render atual; derive `carregando`; `key` com o id quando o
  componente guarda rascunho. Nunca confie que a limpeza já rodou.
- **LISTA VAZIA VIRANDO AFIRMAÇÃO:** vazio durante carga ou falha nunca vira
  "nenhum", "tudo em ordem", "Expirada" nem controle desabilitado.
  Vazio-com-resposta ≠ vazio-por-ignorância. Aba que recebe dado por prop
  exige `carregando` como prop obrigatória.
- O React Compiler recusa `setState` síncrono no corpo de efeito e
  `Date.now()` no render: derive no render; relógio por tique em estado.
- **LAYOUT:** o tailwind-merge só desempata o MESMO prefixo de variante →
  repita o prefixo do primitivo (`group-data-horizontal/tabs:h-auto`;
  `data-[side=right]:sm:max-w-lg`, sem prefixar o `w-full`). `ScrollArea` em
  `flex-col` precisa `min-h-0`; filho de flex/grid com `truncate` precisa
  `min-w-0`; bolha em `items-start` precisa `max-w-full`. Tudo passa em
  revisão e em teste e só quebra na tela. Detalhes: `.claude/rules/ui.md`.
- Tailwind: classe LITERAL no fonte, nunca montada (`bg-${cor}-500` não é
  gerada). `dark:` está INERTE (o variant pede `.dark`, o app marca
  `html[data-mode]`): a primeira cor vale nos dois modos; consertar o variant
  é decisão própria. `font-mono` sai em Inter → `FONTE_MONO`.
- Booleano vindo de JSONB liga só com `=== true` (`"true"` e `1` são
  truthy).
- **Tela NOVA do painel** (nenhuma regra de área carrega sozinha para ela):
  entra no `protectedPaths` (`startsWith`: página pública não começa com
  prefixo protegido), no `pageTitles`/menu com a chave nos DOIS dicionários,
  e decide se vai ao catálogo de perfis — lá nasce INVISÍVEL para todo perfil
  já gravado. Altura cheia por `var(--altura-visivel,100dvh)`, nunca
  `h-screen`. Ler `.claude/rules/perfis.md` e `.claude/rules/auth.md`.

### 8d. Contatos, telefone, canal, grupo

- Telefone DIGITADO passa por `telefoneDigitado` (sem DDI ganha 55; letra ou
  mais de 15 dígitos recusado). Pessoa se casa por
  `chaveDePessoa`/`variantesDoNonoDigito`, nunca por grafia. Todo INSERT em
  `contacts` trata o 23505 da chave canônica (`fichaQueVenceu`; pino
  `chave-canonica.chamadores.test.ts`).
- `findExistingContact` casa pelos 8 últimos dígitos: nunca com JID de
  grupo, LID ou IGSID (fundiria com o celular de um cliente real). O LID
  jamais vira `contacts.phone`.
- **GRUPO ≠ CONTATO:** nunca em `contacts`; `conversations.contact_id` nulo;
  `conversations.channel_id` é NULO em grupo → `canalDaConversa()` /
  `cb_groups.channel_id`. Grupo não dispara automação/fluxo/IA (garantia
  estrutural: `src/lib/cb-groups/persist.ts` não importa os motores, e há
  teste lendo o fonte), não reabre com mensagem, não tem janela de 24h e fica
  fora do carimbo de canal por conversa.
- **TRANSPORTE por predicado** (`ehMeta`/`ehEvolution`/`ehInstagram`/
  `transporteDe`), nunca literal de `kind`/`provider` (pino
  `transporte.chamadores.test.ts`); `switch` sobre `Transporte` com asserção
  `never`; ramo de duas pernas (`ehEvolution ? … : <Meta>`) só atrás de uma
  guarda de Instagram anterior no mesmo caminho (o pino só pega o literal;
  sem a guarda, o Instagram cai no ramo da Meta). `Contact.phone` pode ser
  nulo → `identidadeDoContato`/`nomeDoContato` (nunca o IGSID na tela);
  consulta que embute contato leva `instagram_username`.
- **CANAL:** escopo vazio = TODOS (como o motor); registro sem `channel_id`
  mostra travessão, nunca o padrão; seletor some com menos de 2; "por qual
  número" se decide pela CONVERSA, nunca pela conta; coluna nova de
  `cb_channels` entra em `CB_CHANNEL_SAFE_COLUMNS` (senão salva e some).
- Reabrir conversa, abrir negócio, cancelar espera por resposta e medir
  entrega são dos caminhos de GENTE (ingestão e núcleo de envio). Broadcast,
  robô, automação, IA, grupo e carga de histórico não. Quem faz o quê, por
  caminho: `.claude/rules/ingestao.md`.
- Resposta de gente = `sender_id` OU `from_device` (a agendada sai com
  `sender_id`: excluir por `cb_scheduled_messages.message_id`).
  `messages.created_at` é o relógio do aparelho; `gravada_em` é o do banco.

### 8e. Segurança, integrações, envio

- Segredo de integração vai no CABEÇALHO, nunca na URL (vaza em log de
  proxy). Toda mensagem de erro de provedor passa por `semSegredo` (Meta,
  OpenAI e Asaas ecoam a chave). Cursor/`next` vindo da resposta só é seguido
  dentro do host esperado.
- `fetch` de URL vinda de fora: `isDeliverableUrl`
  (`src/lib/webhooks/ssrf.ts`) em cada salto, `redirect: 'manual'`, corpo por
  `lerComTeto` (`src/lib/http/ler-com-teto.ts`) — nunca `arrayBuffer()` cru.
  Não divergir do `ssrf.ts` do original.
- Webhook de provedor: só credencial inválida (assinatura, token da URL)
  vale 4xx (4xx repetido faz o provedor desativar a entrega); o resto responde 200 com log e trabalha em
  `after()`. Sem assinatura, o corpo é AVISO: o dado é relido na API com a
  nossa credencial.
- Trabalho reivindicado (claim): `UPDATE … RETURNING` cercado; toda escrita
  posterior leva a cerca de posse (o carimbo do próprio claim); teto de
  processamento menor que o recolhimento; cron com rodízio carimba a
  tentativa ANTES do trabalho.
- Envio a cliente nunca se repete quando pode ter saído (tempo esgotado/5xx
  = entrega incerta); só recusa comprovada (4xx) repete. Caminho novo de
  reenvio repete a guarda.
- API v1 roda em service role: `.eq('account_id', ctx.accountId)` em TODA
  consulta, inclusive lookups; escreve por `ctx.supabase` (`clienteDaApi`);
  instante exige offset escrito; escopo e rota nascem em par.
- `SUPABASE_SERVICE_ROLE_KEY` só em código de servidor. Tabela `cb_*` nova
  nasce sem nada para `anon` e com policy de leitura na forma da 1032
  (`.claude/rules/supabase.md`).
- Mudou a guarda de escrita de uma tela ou seção (`requireRole`,
  `useCan`/`RequireRole`, policy)? Atualize `ESCRITA_DA_TELA`/
  `ESCRITA_DA_SECAO` em `src/lib/perfis/poderes.ts` no mesmo PR: sem isso o
  editor de perfis AFIRMA um poder que a pessoa não tem, e nenhum teste
  acusa. Levar o `InternalNoteBox` a uma tela nova rebaixa a entrada dela
  para `viewer`.

### 8f. Cron, datas, testes, produto

- **NADA DISPARA SOZINHO:** o agendador externo (serviço do
  `docker-stack.yml`) bate em `/api/…/cron` (laço rápido ~15 s, lento
  ~15 min). Rota de cron NOVA entra num dos laços, senão nunca roda.
  `maxDuration` é decorativo em produção: o teto é o `-m` do curl
  (50 s/120 s), e worker novo se orça contra ele. Mudar o `command` do
  agendador só vale com `docker stack deploy` manual. `process.env.X` novo
  do servidor entra também no `environment:` da stack (pino
  `scripts/stack-env.test.ts`; sem `env_file`, fica vazio no contêiner).
- Datas: `toLocaleDateString(undefined, …)`, nunca locale fixo; date-fns só
  com `LOCALE_DAS_DATAS` e padrão localizado (`PPP`) (pino
  `idioma-das-datas.chamadores.test.ts`); coluna DATE nunca por
  `new Date()` direto (meia-noite UTC volta um dia no Brasil).
- CSV exportado passa por `neutralizarFormula` (`src/lib/csv.ts`): aspas não
  impedem o Excel de avaliar `=…`.
- Pino estrutural (`*.chamadores.test.ts`, default-deny) que reprova é
  decisão a escrever na allowlist, com motivo — nunca afrouxar o teste nem
  contornar o nome.
- Marca: nome, logo e nome curto só de `src/lib/marca.ts` (build-args,
  padrão genérico `'CRM'` — nunca o nome do escritório no código); nome de
  produto não é chave de dicionário, e frase de UI não cita nome de produto
  (o nosso nem o do upstream; onde precisa, `{appName}`).
  `scripts/produto-gate.test.ts` reprova nossa infra em `src/`, `messages/`,
  `supabase/` e na raiz (exceção só em `EXCECOES`, com motivo);
  `scripts/env-documentado.test.ts` exige toda `process.env.X` no
  `.env.local.example`.

## 9. i18n

Locale global e fixo (`NEXT_PUBLIC_APP_LOCALE`, hoje `pt-BR`). Portões por
dentro, exceções e testes de chave montada: `.claude/rules/i18n.md`.

- ⚠️ **O fallback do next-intl é por ARQUIVO, não por chave:** chave nova em
  `en.json` E `pt-BR.json` na mesma passada, senão `MISSING_MESSAGE` e a
  chave crua na tela.
- Chave MONTADA (`` `x.${id}` ``) escapa dos portões (`i18n-parity.mjs`,
  `i18n-chaves-usadas.mjs`): exige teste que leia os dois dicionários.
- ⚠️ `t('chave')` sem `values` NÃO parseia ICU: `INVALID_TAG` no log ≠ tela
  quebrada. Antes de "consertar", compare o que `t()` devolve antes e
  depois. Só `t.rich` falha visível; tag de rich text sem atributo; ICU
  literal (`'{{1}}'`) entre aspas simples.
- Rótulos que o operador vê em inglês no painel da Meta (`Phone Number ID`,
  `Access Token`…) não se traduzem.
- Achar texto da UI no código: `node scripts/i18n-find.mjs "<texto>"`.

## 10. Deploy

- ⚠️⚠️ **`git push origin main` PUBLICA em produção** (`pipeline.yml`; o
  deploy exige verificar e migrations verdes). Só com o operador ciente.
  Vários merges seguidos: o run do meio morre na fila e o último publica
  todos.
- `NEXT_PUBLIC_*` é build-arg (idioma, nome do app): muda no
  `pipeline.yml`/`docker-stack.yml` e exige rebuild. O `crm.env` não muda
  isso.
- ⚠️⚠️ **`docker stack deploy` SEM carregar o `crm.env` zera todos os
  segredos, com o site ainda em 200.** Sempre as três linhas juntas:
  ```bash
  set -a; . /root/crm.env; set +a
  export CRM_IMAGE="$(docker service inspect crm_crm --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)"
  docker stack deploy -c /root/docker-stack.yml crm
  ```
  A imagem sai do Spec, nunca do rótulo `com.docker.stack.image` (envelhece
  a cada deploy do CI e rolaria a produção para trás). Conferir depois:
  `printenv SUPABASE_SERVICE_ROLE_KEY | wc -c` no contêiner (0 = quebrado) e
  `curl -s -o /dev/null -w '%{http_code}' https://crm.cbadvogados.com/api/cb/scheduled/cron`
  (401 = ok; 503 = env vazia).
- Evolution: nunca trocar a imagem nem reiniciar o CONTÊINER com a fila de
  entrada represada (a fila se perde para o CRM); o restart da INSTÂNCIA
  (`POST /instance/restart`) é o paliativo que a drena. Voltar de versão está
  descartado. O resto da operação (digests, Redis compartilhado, prune,
  stack só para recriar) está em `docs/INFRA-VPS.md`, §9 e §10 (a leitura
  obrigatória da seção 0c).
- O webhook do WhatsApp exige HTTPS (Traefik na VPS). Detalhes do pipeline e
  do agendador: `.claude/rules/deploy.md`.

## 11. Integrações externas

- Mexeu em integração externa → atualize a doc visível (`docs/`, ajuda na
  tela) NA MESMA PASSADA. Doc obsoleta é bug latente.
- `META_APP_SECRET` valida o HMAC do webhook da Meta (sem ele, recusa tudo)
  e aceita vários segredos separados por vírgula SEM ESPAÇO: com `a, b` no
  `crm.env`, o `set -a` faz a variável SUMIR e todo webhook da Meta vira 401
  com o site em 200 — conferir `printenv META_APP_SECRET | wc -c` no
  contêiner. Qualquer segredo da lista assina para qualquer número: só apps
  de confiança (`docs/multi-waba.md`).
- `ENCRYPTION_KEY` cifra tokens e chaves (AES-256-GCM): rotacionar invalida
  todos — nunca sem avisar.
- `cb_channels` está na publicação realtime com LISTA FIXA de colunas: coluna
  nova não viaja; quem assinar reescreve a publicação.
- IA é BYOK por conta (OpenAI/Anthropic/Gemini). Embeddings/RAG exigem chave
  OpenAI (`vector(1536)`).

## 12. Decisões do operador — não reverter sem perguntar

O detalhe mora na regra da área; mudar qualquer uma é pergunta ao operador.

- Radar: sem aba "Todos"; falso negativo da IA não ganha botão.
- Funil: ganho que sai para etapa neutra segue ganho; perdido que entra em
  neutra volta aberto (21/09/2026).
- Funil comercial: "por período" é o padrão (18/09/2026); taxa acima de 100%
  aparece como é; negócio transferido conta no funil de origem.
- Card: título = nome da pessoa, sem prefixo de conexão; o Calendly renomeia
  até título escrito à mão e fixa o nome da ficha.
- Abrir conversa não cria negócio (o card nasce no primeiro envio).
- Encerrar conversa SOLTA o responsável; quem reabre enviando fica
  responsável; cliente, celular e API reabrem sem responsável (02/09/2026).
- De ADMIN: "Gerenciar funil", as abas Lista/Desempenho/Saúde e apagar
  contato (08/09/2026). A automação é da CONTA: qualquer admin edita, ativa,
  duplica e apaga, nunca só o autor (23/09/2026).
- Cadastro só por convite (22/09/2026); a saída para ex-membro que ainda
  tem login é BLOQUEAR no Supabase (apagar o login leva por CASCADE o que ele
  criou: etiquetas, modelos, automações).
- Webhook de saída `conversation.created` = SÓ "o cliente abriu a conversa"
  (entrada; 23/09/2026) — emitir noutro caminho muda o contrato publicado.
- Retentativa de passo de automação só na Evolution; na Meta fica de fora
  (24/09/2026).
- Calendly: a ficha do cliente nasce do agendamento (08/09/2026).
- Caixa de entrada: filtro salvo é de cada membro; Encerradas não é filtro
  nem vai na visão salva; busca no corpo das mensagens desligada por padrão.
- Ficha: um bloco de campos por vez, em menu horizontal.
- Canal: a faixa de divergência só informa, não bloqueia; cor derivada; anel
  no avatar e trilha colorida foram descartados.
- IA: chave por PROVEDOR, uma para a conta toda — nunca por conexão
  (28/08/2026; `cb_ia_chaves`, 1047). O modelo é do módulo (Radar) e, com os
  agentes, de cada agente (D1 de `docs/PLANO-agentes-de-ia.md`).
- Automação presa à etapa: caixa por automação, marcada só nas criadas pela
  grade; as antigas não mudam (18/09/2026).
- Asaas: o CRM cria a ficha, com nome fixado; ligar a régua não é
  retroativo.
- Instagram: robô não responde no Direct; unificar fichas é manual; o que a
  API não cobre fica inacessível na conversa.
- Webhook de entrada cria a conversa ENCERRADA (só ele; 21/09/2026).
- Evolution: voltar de versão da imagem está descartado.
- Celular: no toque o Enter pula linha; o app instalado abre em `/inbox`.
- "Sair" do menu sai só deste aparelho; 4 h inativo reabre o Meu dia, sem
  senha.

## 13. Índice das áreas

Abra pela Read o arquivo da área antes de editar, criar ou revisar nela
(seção 0a). Ele carrega sozinho só quando a Read abre um arquivo que casa os
`paths:` dele.

- `.claude/rules/supabase.md` — escrita manual no banco de produção,
  gatilhos por linha, receita de fusão, modelos do banco vazio,
  REVOKE/GRANT, policy da 1032, carga em lote.
- `.claude/rules/ingestao.md` — obrigações por caminho de entrada e de
  envio: canal no upsert, reabrir, abrir negócio, cancelar espera, medir
  entrega, foto de perfil.
- `.claude/rules/whatsapp-evolution.md` — Evolution 2.4/Baileys 7, LID sem
  telefone (retida, tardia, histórica), recibos fora de ordem, edição
  cifrada, link sem prévia, grupos.
- `.claude/rules/whatsapp-envio.md` — núcleo de envio, entrega incerta,
  modelos da Meta por WABA, `resolveTemplateRow`, escopo da conversa.
- `.claude/rules/canais.md` — peças de UI de canal, escopo vazio = todos,
  saúde das conexões, atraso de entrega (`lagging`).
- `.claude/rules/canal-na-conversa.md` — qual número nesta conversa, cor do
  canal, faixa de divergência, janela de 24h por número, ampulheta.
- `.claude/rules/inbox-lista.md` — duas abas, atraso de resposta, filtros e
  filtros salvos, busca em duas metades, nova conversa.
- `.claude/rules/inbox-conversa.md` — fio e rolagem, salto da busca,
  compositor, fila de anexos, anotação interna, player de áudio, painel.
- `.claude/rules/midia.md` — dois tetos de tamanho, `too_large`, nome do
  anexo, acervo de mídias.
- `.claude/rules/celular.md` — teclado virtual, voltar pelo histórico, app
  instalado (manifesto, ícone).
- `.claude/rules/ao-voltar.md` — telas que recarregam em silêncio ao voltar
  para o app.
- `.claude/rules/ui.md` — `select.tsx` nosso, tailwind-merge,
  `SheetContent`, `ScrollArea`, `DialogContent`, `dark:`, `font-mono`.
- `.claude/rules/automacoes.md` — motor e construtor, grade do funil,
  execuções na conversa, retentativa, desfecho da execução.
- `.claude/rules/automacoes-esperas.md` — Aguardar, parar se o cliente
  responder, presa à etapa, marca de interrupção, fila.
- `.claude/rules/funil.md` — card abre a conversa, ganho/perdido, título do
  card, `createDeal`, FKs compostas, concorrência do quadro.
- `.claude/rules/funil-metricas.md` — degraus, coorte × por período,
  Desempenho, Saúde, Meta Ads.
- `.claude/rules/contatos.md` — chave canônica do telefone, telefone
  digitado, exclusão de contato, etiquetas.
- `.claude/rules/campos-e-nome.md` — campo que salva sozinho, blocos de
  campos, e-mail espelhado, nome fixado.
- `.claude/rules/integracoes-calendly.md` — ficha nasce do agendamento,
  telefone em três fontes, cadeado, cancelamento e lembretes.
- `.claude/rules/integracoes-asaas.md` — espelho de cobranças, vínculo,
  ficha criada pelo CRM, cadeado do ciclo, webhook, régua.
- `.claude/rules/ia.md` — Radar, transcrição de áudio, chaves e modelos por
  módulo (Integrações).
- `.claude/rules/reunioes.md` — agenda (EXCLUDE, fuso), tl;dv e
  transcrições.
- `.claude/rules/agendadas.md` — mensagem agendada, anexo e citação, tela
  `/agendadas`.
- `.claude/rules/tarefas.md` — tarefas por cliente, `podeNaTarefa`, prazo
  sem fuso.
- `.claude/rules/webhooks.md` — webhooks de entrada, formulário público
  (Typebot), webhooks de saída `deal.*`.
- `.claude/rules/api-v1.md` — API pública, escopos, tags por nome,
  Configurações → API.
- `.claude/rules/perfis.md` — "Ver como", editor de perfis,
  `ESCRITA_DA_TELA`, o que é de admin.
- `.claude/rules/auth.md` — recuperação de senha, cadastro por convite,
  `signOut` com escopo, inatividade.
- `.claude/rules/meu-dia.md` — porta de entrada, resumo do dia, área de
  trabalho `/meu-dia`.
- `.claude/rules/instagram.md` — Instagram Direct, login OAuth, webhook,
  ramos que falham fechado.
- `.claude/rules/i18n.md` — portões de i18n por dentro, chave montada,
  date-fns.
- `.claude/rules/deploy.md` — pipeline, agendador, Node, stack deploy,
  Evolution na VPS, produto-gate.

**Títulos antigos citados em comentários do código → onde estão agora:**

- "efeito passivo", "lista vazia virando afirmação", "{ de, mapa }",
  "armadilhas de layout", "`min-width: auto`" → seção 8c
  (+ `.claude/rules/ui.md`).
- "0 linhas em silêncio", "erro de banco não é 'não encontrado'", "índices
  parciais (903)" → seção 8b.
- "maxDuration", "as três linhas do stack deploy" → seções 8f e 10
  (+ `.claude/rules/deploy.md`).
- "Workflow de migrations", "Migration tem de aplicar num banco VAZIO",
  "Fechar EXECUTE de função", "anon em `cb_*`", "APAGAR CONTATO", "trilha
  912" → seção 7 e `.claude/rules/supabase.md`.
- "merge de 2026-08-26/09-05/09-22", "tabela de divergências", "lightbox do
  upstream" → `docs/MERGE-UPSTREAM.md`.
- "Iniciar conversa pelo CRM" → seção 8a e `.claude/rules/inbox-lista.md`.
- "UI de canal" → `.claude/rules/canais.md`; "Qual NÚMERO nesta conversa",
  "`PALETA_DE_CANAIS`", "Selo da janela" → `.claude/rules/canal-na-conversa.md`.
- "Link sai SEM prévia", "Baileys 7", "`@lid` sem telefone" →
  `.claude/rules/whatsapp-evolution.md`.
- "regras das rotas v1", "origem `api`" → `.claude/rules/api-v1.md`.
- "Quem abre negócio" → `.claude/rules/ingestao.md`.
- "Radar", "pendência do feedback por atendente" → `.claude/rules/ia.md` (a
  pendência: `docs/PLANO-radar-de-atendimento.md`).
- "`tasks/permissoes.ts`" → `.claude/rules/tarefas.md`; "`protectedPaths`"
  → `.claude/rules/auth.md`; "`semAcento()` do fio" →
  `.claude/rules/inbox-conversa.md`; "seção Webhooks crua" →
  `.claude/rules/i18n.md`.

## 14. Antes de aplicar mudanças

- [ ] `nvm use`; branch derivada de `main` atualizado.
- [ ] Abriu pela Read a regra da área (seção 0a).
- [ ] Schema: as regras da seção 7 (número, banco vazio, ordem de aplicação).
- [ ] Nada de `.env.local` no commit (`git status`).
- [ ] `npm run typecheck`, `npm run lint` e `npm run test`.
- [ ] Nota nova no lugar certo, e o teto respeitado.

## 15. Não faça

- ❌ PR para qualquer branch de `ArnasDon/wacrm`; commit direto no `main`;
  push no `upstream`.
- ❌ `node-version:` cravado no `pipeline.yml` (sai do `.nvmrc`).
- ❌ Migration de 3 dígitos ou na sequência do upstream; renomear migration
  aplicada; schema pela UI.
- ❌ Policy de LEITURA com `is_account_member(account_id)` ou
  `IN (SELECT …)` — as duas rodam por linha; a forma é a da 1032 (pino
  `rls-leitura-1032.test.ts`).
- ❌ `SUPABASE_SERVICE_ROLE_KEY` no cliente; rotacionar `ENCRYPTION_KEY` sem
  avisar; `--no-verify` sem permissão.
- ❌ Reescrever arquivo do core quando dá para isolar em módulo novo.

## 16. Comandos úteis

```bash
nvm use              # Node do .nvmrc (22) — antes de tudo
npm run dev          # desenvolvimento (localhost:3000)
npm run build        # build de produção
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest
npm run format       # prettier --write
```
