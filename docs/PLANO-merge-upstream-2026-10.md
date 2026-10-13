# Plano — atualização pelo upstream de outubro/2026 (revisão e decisão)

Documento INTERNO. Serviu a duas coisas: (1) ser conferido por uma segunda
revisão independente ANTES da decisão; (2) depois dela, ser o inventário do que
entrou, do que foi adaptado e do que ficou de fora. A decisão está logo abaixo;
as seções 0 a 9 são a revisão de 12/10/2026, mantida como estava.

| | |
| --- | --- |
| **Estado (13/10/2026)** | **Decidido: SEM merge.** O #399 foi fechado; sete itens entraram por PORTE MANUAL na branch `chore/porte-upstream-2026-10` (ver "Decisão"). Nenhuma migration do original entrou nem foi aplicada. |
| **Intervalo** | Base comum `aee1b01f` → `upstream/main` = **`27c6bdf4`** (07/10/2026): 61 commits, 22 PRs do original, 159 arquivos, +8.743/−1.673. |
| **Nosso lado** | Medido contra `origin/main` = `d6b103cf`; o `main` andou no mesmo dia (`7af1e0bc`, PR #400, migration 1082) e o ensaio refeito dá os MESMOS 80 conflitos. Números de linha deste documento são de `d6b103cf`. |
| **PRs** | #398 (direto no `main`): fechado sem merge, três minutos depois de aberto. #399: fechado sem merge em 13/10/2026, com a decisão no comentário de fechamento. #401: o rascunho deste documento, que entrou junto com o porte. Os dois primeiros têm como origem o `main` do repositório ORIGINAL. |

## Decisão do operador (13/10/2026)

**Não se faz o merge deste lote.** O operador confirmou a conclusão da revisão
(muitos conflitos, e boa parte das melhorias já está no nosso código) e pediu,
num PR só e testado a cada passo, o porte MANUAL de sete itens. A
ancestralidade com o original continua em `aee1b01f`: a próxima atualização
volta a apresentar estes 61 commits. Os trechos portados ficaram iguais aos do
original sempre que possível, para o Git vê-los como a mesma mudança dos dois
lados e não acusar conflito ali.

**Entrou (porte manual):**

| Item | O quê | Onde |
| --- | --- | --- |
| Dependências (2.4) | Pisos de segurança do #629 e as atualizações do #582, #583/#622, #623/#637, #509 e #598/#620 — `package.json` e lock pela união da seção 2.4 (as três `@codemirror/*` ficam); no `mcp-server`, o `package.json` mesclado e o lock do original | `package.json`, `package-lock.json`, `mcp-server/package*.json` |
| #626 | Páginas com `Cache-Control: private, no-store`; `opus/` e `inbox-doodle.svg` fora da regra (ficam com o `public, max-age=0` do Next, revalidado por ETag). Teste do original + dois casos nossos | `next.config.ts`, `src/next-config.test.ts` |
| #607 | `/flows`, `/agents`, `/notifications` e `/tarefas` no `protectedPaths`. Teste do original (lê a pasta `(dashboard)`) | `src/middleware.ts`, `src/middleware.test.ts` |
| #589, parte 2 | A conta nas três escritas da rota de modelo. Teste do original + um bloco nosso que confere o filtro de cada escrita | `src/app/api/whatsapp/templates/[id]/route.ts` e `route.test.ts` |
| #597, signup | `emailRedirectTo` pelo nosso `/auth/callback` no ramo SEM convite | `src/app/(auth)/signup/page.tsx` |
| #630, retomada | A retomada lê uma página de 1.000 com `count: 'exact'`, soma ao "restante" o que não carregou e marca os sem telefone em lotes de 100 (`chunk` do `paged-query.ts` do original, trazido inteiro com o teste) | `src/lib/whatsapp/broadcast-resume.ts` e teste, `src/lib/supabase/paged-query.ts` |
| #625, telas | Os textos fixos em inglês das telas que entravam sem conflito: seletor de modelo da conversa, "Opção N" do robô, cor do funil, perfil, aparência, formulário de contato, amostra do disparo, falha do disparo, gráfico do Painel (dias da semana pelo idioma) e o "Fechar" de `Dialog`/`Sheet`. 15 chaves nos dois dicionários, texto do `pt.json` do original | 13 telas (seção 2.3, "Telas sem conflito") |

**Não entrou:**

- Por decisão (13/10/2026): o merge em si; o #636 ("aguardar a resposta do
  cliente") e a migration 045; o #609 (quarto provedor de IA) e a migration
  046; as migrations 043 e 044; o aviso `?error=link_*` do login e o
  `docs/auth-emails.md` do #597.
- Fora desta rodada (não pedidos): os avisos do servidor pelo tradutor `getT`
  (os 34 arquivos de servidor e o `translate.ts`, seção 2.3); as asserções
  novas do `verify-schema.sql` (#628); a leitura do bucket `avatars` restrita
  à própria pasta (#628, seção 2.1 — continua valendo como achado); o
  `token_hash` do #597 (link de senha em outro aparelho); o "Menu" do
  `interactive-builder.tsx` (igual em português); o `whatsapp-config.tsx`
  (tela legada, não montada); o `dependabot.yml` do #627; e a página de
  detalhe da campanha que lê só 1.000 destinatários (defeito nosso, item 6
  da seção 8).

**Medido no porte:** typecheck limpo; lint com os mesmos 61 avisos do `main`;
suíte inteira em Node 22 (701 arquivos, 10.809 testes); build de produção;
`npm ci` com o npm 10.9.9. No build de produção servido localmente: páginas
com `private, no-store`, as quatro telas novas redirecionando ao login, o
gravador de voz respondendo 304 ao ETag; na tela, os dias do gráfico em
português, "Fechar" no diálogo e no painel lateral (que manteve 512 px), o
seletor do base-ui 1.8 mostrando o rótulo e os menus do cabeçalho abrindo para
baixo no celular. A consulta nova da retomada rodou sem erro contra o PostgREST
de produção (só leitura; há 3 destinatários na tabela inteira, então o caso
acima de 1.000 é provado só pelos testes).

## 0. Como conferir este documento

O pedido a quem revisa é **tentar refutar**, com o código na mão. Em ordem de
custo do erro:

1. Todo **"já temos"** de conserto de segurança (seção 2.1). Um falso "já
   temos" é o erro mais caro deste plano.
2. Todo **"descartar"** (seções 2.2 e 2.3): há algo que o descarte joga fora e
   que nos faz falta?
3. As resoluções **"voltar ao main"** e **"apagar"** de arquivo que entra SEM
   conflito (seção 5): são as que desfazem o que o Git faria sozinho.
4. O que a seção 7 declara como **não medido**.

Os commits do original estão neste repositório por causa do PR #399:

```bash
git fetch origin pull/399/head          # FETCH_HEAD = 27c6bdf4
git merge-tree --write-tree --name-only origin/main FETCH_HEAD   # o ensaio: 1ª linha = árvore, depois os conflitos
git diff aee1b01f FETCH_HEAD -- <arquivo>     # o que o original mudou
git diff aee1b01f origin/main -- <arquivo>    # o que nós mudamos
```

## 1. O que está na mesa

| | |
| --- | --- |
| Arquivos que o original mexeu | 159 |
| …que os dois lados mexeram | 112 |
| …em conflito textual | **80** |
| …mesclados SOZINHOS pelo Git (entram em silêncio) | **32** |
| …que só o original mexeu (entram inteiros) | **47** (19 são arquivos novos; outros 5 arquivos novos do original conflitam como add/add) |
| Migrations novas do original | 4, todas com 3 dígitos (043 a 046) |
| Chaves novas no `en.json` deles | 573 (30 já existem no nosso; 8 delas com outro texto) |

**O PR #399 não serve de veículo.** A origem dele é a branch `main` do
repositório original: ninguém do nosso lado grava ali a resolução dos
conflitos (e gravar seria push no upstream), o conteúdo muda sozinho quando o
original publica, e PR em conflito não roda CI. Resolver pelo editor do GitHub
seria costura trecho a trecho, que a §3.1 do `docs/MERGE-UPSTREAM.md` proíbe.
É o mesmo caso do #229 de setembro. O caminho é o da receita (§1 de lá):
branch de integração nossa, a partir do `main`.

## 2. Veredito por item do original

Legenda de **Já temos?**: *sim+* = temos, e mais forte; *sim* = equivalente;
*parcial*; *não*.

### 2.1 Segurança

| Item | O que faz | Já temos? | Proposta | Evidência no nosso código |
| --- | --- | --- | --- | --- |
| **#587** (GHSA-xvrq-88hg-44q6) | Rotas de `/api/automations/[id]` casam pela conta, não pelo autor. Piso deles: `agent` | sim+ | Nada a trazer. Conflitos: nosso inteiro | `src/app/api/automations/[id]/route.ts:40,50` (GET), `:74,92,204` (PATCH `admin` + conta + linhas conferidas), `:247,259` (DELETE); `duplicate/route.ts:17,30`; pino `route.test.ts:326` |
| **#588** (GHSA-m4cp-pqxq-x9f7, GHSA-q4p6-pj4g-26xx) | Guarda de SSRF classifica o IP pelos octetos, IPv6 incluso | sim | Nada a trazer. **`ssrf.ts` fica o DELES inteiro** (única exceção à regra dos conflitos) | `git diff origin/main 4881110c -- src/lib/webhooks/ssrf.ts src/lib/webhooks/ssrf.test.ts` sai vazio. Contra `27c6bdf4` a diferença (+32/−5) é só o 2º parâmetro OPCIONAL do #609; os 5 chamadores nossos passam um argumento |
| **#589**, parte 1 (GHSA-m4fx-g6pr-hrw8) | Conversa do contexto conferida pela conta no motor e nos remetentes do robô | sim+ (conta E contato) | Nada a trazer. Conflitos: nosso inteiro | `src/lib/whatsapp/conversation-scope.ts:37-56`; `src/lib/automations/meta-send.ts:190,443`; `src/lib/flows/meta-send.ts:228,424,646` e `:362,553,791`; `src/lib/automations/engine.ts:403-426,3206-3225`; pino `conversation-scope.chamadores.test.ts` |
| **#589**, parte 2 | Editar/apagar modelo da Meta só para admin, com a conta também nas escritas | parcial | **Portar 3 linhas**: `.eq('account_id', …)` nas três escritas. O teste deles entra e passa 5/5 contra a nossa rota (medido) | Guarda de papel: `src/app/api/whatsapp/templates/[id]/route.ts:89,285` (`barrarPorPapel` admin); leitura por conta `:105,292`. Faltam: escritas só por `id` em `:191`, `:214`, `:327`. Sem caminho explorável hoje (cliente da sessão; em produção as policies de UPDATE e DELETE de `message_templates` exigem admin da conta) |
| **#607** | Middleware redireciona o deslogado de `/flows`, `/agents`, `/notifications` | não | **Trazer adaptado**: acrescentar os três e a nossa `/tarefas` ao `protectedPaths` | `src/middleware.ts:80` não tem os quatro. Hoje quem manda ao login é a casca do cliente (`dashboard-shell.tsx:61-65`), sem vazamento de dado. O `middleware.test.ts` deles entra inteiro, lê a pasta `(dashboard)` e reprova 4 testes contra o nosso middleware (medido); com os quatro caminhos, passa |
| **#626** (GHSA-8wxh-rv3x-hxvm) | Respostas de página fora de cache compartilhado (`private, no-store`) | não | **Trazer adaptado**: nosso `next.config.ts` inteiro + o valor novo, deixando `opus/` e `inbox-doodle.svg` fora da regra | `next.config.ts:160-167` ainda tem o valor antigo; medido em produção por GET público: páginas e redirects de login saem `public, max-age=0, s-maxage=300, stale-while-revalidate=86400`. O teste deles (`src/next-config.test.ts`) entra inteiro e reprova 7 de 10 contra o nosso config (medido) |
| **#628**, 043 | Policies de SELECT do Storage restritas | **parcial** (0900): `chat-media` e `flow-media` iguais; **`avatars` não** | **Apagar** a 043 e **portar o predicado do avatar** em migration NOSSA (o maior número do `main` + 1): a leitura do bucket `avatars` passa de "qualquer autenticado" para "a pasta do próprio login" | `0900_cb_storage_restringe_listagem.sql:41-44` cria `"Avatars are readable by authenticated users"` com `using (bucket_id = 'avatars')`; a 043 exige também `auth.uid()::text = (storage.foldername(name))[1]`, o predicado que a `0008:41-42` já usa na escrita. Produção (12/10): a policy é a da 0900; o bucket é público e está com 0 objeto. O app só faz `upload` na própria pasta e `getPublicUrl` (`src/components/settings/profile-form.tsx:126-139`); nenhum `list`/`download` em `src/`. Achado da segunda revisão (seção 9) |
| **#628**, 044 | `REVOKE EXECUTE` de `anon`/`authenticated` em seis funções SECURITY DEFINER internas | sim+ (0915, 1037, 1049, 1066) | **Apagar** a migration | Produção (`has_function_privilege`): `_bcast_bump`, `recompute_broadcast_counts`, `claim_ai_reply_slot`, `record_webhook_failure`, `merge_duplicate_contacts`, `merge_duplicate_conversations` — anon e authenticated sem EXECUTE, service_role com |
| **#628**, asserções | Quatro asserções novas no `supabase/ci/verify-schema.sql` | parcial | **Voltar ao nosso arquivo** e portar as asserções ADAPTADAS (nossos nomes de policy; só anon/authenticated nas funções; sem o bloco da 045) | O arquivo mescla SOZINHO. As nossas (964, 1030, 1039) ficam, mas as novas exigem os nomes de policy da 043 e o CHECK/índice da 045: sem as migrations deles, o replay reprova e o deploy trava |

### 2.2 Consertos e recursos

| Item | O que faz | Já temos? | Proposta | Evidência no nosso código |
| --- | --- | --- | --- | --- |
| **#554** | Salvar a config do WhatsApp sem verify token mantém o guardado | sim | Nada a trazer. `whatsapp/config/route.ts`: nosso inteiro | O POST deles conserta rota que aposentamos (410) e tela que nenhum arquivo importa. No caminho real, `src/app/api/cb/channels/route.ts:385,444` só gravam `verify_token` quando veio valor |
| **#597**, `/auth/callback` e `/reset-password` | Cria as duas rotas e passa os links de e-mail pela origem do app | sim+ (PR #254) | Nada a trazer. Conflitos (add/add): nosso inteiro. **Apagar** `src/lib/auth/callback.ts` e o teste (entram sozinhos, código morto) | `src/app/auth/callback/route.ts:40-65`; `src/lib/auth/destino-seguro.ts:38-73`. Sem variável de ambiente nova do lado deles |
| **#597**, `token_hash` | Link de recuperação que vale em outro aparelho | não | **Decisão do operador** (seção 8, item 5) | O nosso callback lê só `code` (PKCE). Trade-off: o `token_hash` deixa de prender o link ao navegador que pediu |
| **#597**, signup | Cadastro passa `emailRedirectTo` pelo callback | **parcial** | **Nosso inteiro + porte de 1 linha**: `emailRedirectTo` no ramo SEM convite. O arquivo deles não entra | O lado deles apaga o ramo `if (inviteToken) { cadastrarPorConvite… }` — o cadastro por convite (decisão de 22/09/2026; pino `src/lib/auth/cadastro-por-convite.test.ts`). Mas o nosso ramo público (`src/app/(auth)/signup/page.tsx:176-184`) chama `signUp` sem `emailRedirectTo`: com cadastro aberto e confirmação de e-mail ligada, o link do e-mail vai para o Site URL do Supabase e não passa pelo nosso callback. Pela decisão de 22/09 o cadastro público fica fechado na nossa produção (não reconferido nesta revisão), então nada muda para nós; vale para outra instalação. Achado da segunda revisão (seção 9) |
| **#597**, login e doc | Aviso `?error=link_*` no login; `docs/auth-emails.md` | sim (por outro caminho) | **Descartar**: `login/page.tsx` e `forgot-password/page.tsx` voltam ao `main`; **apagar** a doc e levar três notas dela para `docs/INSTALACAO.md` | O nosso callback só manda falha para `/forgot-password?erro=link`; nada em `src/` emite `/login?error=`. A doc está em inglês, cita o produto original e descreve o fluxo DELES |
| **#630**, público | Público do disparo paginado acima de 1.000 | sim+ (PR #269), **até 25.000 linhas por leitura** | Nada a trazer. Hook, passo 2 e passo 4: nosso inteiro. **Apagar** `src/lib/broadcast-audience.ts` e o teste (código morto). **Limite conhecido:** acima de 25.000 o nosso RECUSA o disparo com aviso (falha fechada); o deles lê sem teto. Subir `MAX_PAGINAS` é mudança de uma constante, a fazer quando a base se aproximar (hoje 5.718 contatos) | `src/hooks/use-broadcast-sending.ts:403-458,698-718,1082-1095`; `src/lib/supabase/paginar.ts:56-57` (o teto) e `:93-170`; o aviso do teto em `step2-select-audience.tsx:537` e `use-broadcast-sending.ts:160`; pinos `.paginacao.test.ts` e `.contagem.test.ts`. O teto é achado da segunda revisão (seção 9) |
| **#630**, retomada | Retomada do disparo lê a sobra real acima de 1.000 | **não** | **Trazer**: a mesclagem do Git serve em `broadcast-resume.ts` (mantém `resolveMetaChannel` e o 5º parâmetro de `resolveTemplateRow`); `paged-query.ts` inteiro; no teste, nosso + porte do dublê | Nosso `src/lib/whatsapp/broadcast-resume.ts:160-167` lê sem `range` nem `count`. Medir a consulta nova contra o PostgREST real antes do merge (regra 8b) |
| **#636** | Automação "aguardar a resposta do cliente" depois de Enviar botões/lista | não (temos o INVERSO: "parar se o cliente responder") | **Descartar neste merge**. Se o operador quiser o recurso (seção 8, item 3), é frente própria, no nosso desenho | Os seis arquivos conflitam e ficam nossos. O desenho deles insere direto na fila (o pino `parar-se-responder.chamadores.test.ts` exige `cb_estacionar_espera`), usa status que os nossos cancelamentos não enxergam e só liga o webhook da Meta. Uso hoje: botão e lista só saem pelo número oficial; em produção, 0 passos de botão/lista em 62 automações |
| **#636**, 045 | Recria o CHECK de status da fila de automações | — | **Apagar** | A lista deles não tem `cancelled`, que o nosso motor grava em 12 pontos. Ver a seção 3 |
| **#609** | Quarto provedor de IA ("compatível com a OpenAI", com URL base) | não | **Descartar neste merge**: 9 conflitos pelo nosso; `generate.ts` volta ao `main`; **apagar** `openai-compatible.ts`, o teste dele e `auto-reply.test.ts` (volta como modify/delete). Se o operador quiser (seção 8, item 4), é frente própria em `cb_ia_chaves` | Guarda URL e chave em `ai_configs`, o contrário da decisão de 28/08/2026; não conhece o `gemini` (`src/lib/ai/types.ts:9`). Em produção só há chave do Gemini |
| **#609**, 046 | Coluna `base_url` e CHECKs de provedor recriados | — | **Apagar** | Os dois CHECKs deles tiram `gemini`. Ver a seção 3 |

### 2.3 Tradução (#625) e o pacote do cliente (`7287c2a5`)

O #625 troca frases fixas em inglês por chave de dicionário em 108 arquivos e
cria um tradutor de servidor (`getT`, em `src/lib/i18n/translate.ts`) que lê o
dicionário pelo alias `@app-messages`.

| Fatia | Já temos? | Proposta |
| --- | --- | --- |
| **32 arquivos de servidor em conflito** (21 rotas, 11 bibliotecas) | sim+ (guardas de papel, escopo por conta, `cb_ia_chaves`, canal) | **Nosso inteiro.** Do lado deles só se perde texto traduzido (resíduo do diff sem as linhas de tradução: zero em 26 arquivos; nos demais, andaime de tradução ou PR de outro item) |
| **34 arquivos de servidor SEM conflito** (18 rotas, 16 bibliotecas) | não | **Aceitar**, com as chaves que eles pedem (≈171) nos DOIS dicionários. Não mudam guarda, consulta nem assinatura exportada. Alcance: `toErrorResponse`/`requireRole` (`src/lib/auth/account.ts`) e `rateLimitResponse` — todo 401/403/429/500 do painel |
| **`translate.ts` + alias** | parcial (`src/lib/ia-agentes/textos-do-servidor.ts`, só para os agentes) | **Aceitar adaptado**: o bloco do alias portado para o NOSSO `next.config.ts`, com a lista de idiomas que servimos (`en`, `pt-BR`); a mesma lista em `translate.ts`; `vitest.config.ts` volta ao `main` (o nosso já tem `tsconfigPaths`) |
| **Telas sem conflito** (11 mescladas sozinhas + 4 só deles) | não | **Aceitar** com as ≈18 chaves nos dois dicionários. Nenhum trecho nosso da §4 foi atropelado (régua do telefone em `contact-form`, rascunho do funil em `pipeline-settings`, cartões do perfil: conferidos no resultado do ensaio) |
| **Telas em conflito** (inbox, páginas, gerenciadores, `gated-button`) | sim+ (Fase 10 de setembro) | **Nosso inteiro.** Sobram poucos casos de inglês fixo nosso para portar à mão depois (etapas padrão do funil, textos padrão do robô, status dos modelos, erros do disparo) |
| **Dicionários** | — | `en.json`: nosso + **união por script só das chaves que os arquivos aceitos pedem**, nos dois dicionários. Nunca "tudo o que falta": ressuscita ≈200 chaves que tiramos de propósito. `es/ko/pt.json`: apagar de novo (§6, item 1), depois de colher do `pt.json` as traduções das chaves aceitas. Não trazer `GatedButton.reasons.*`, `Metadata.*` nem `Currency.*` |

**Idioma do que o servidor responde.** Com o alias apontado para `en`, nada
muda para quem usa (os avisos do servidor já saem em inglês hoje). Apontado
para `pt-BR`, passam a sair em português — e isso muda texto GRAVADO (registro
de automação, `error_message`) que o nosso "Já rodou" traduz casando frase em
inglês (`src/lib/execucoes/texto-do-motor.ts`), além da frase humana de um 404
da API v1 (`tag-write.ts`). A proposta é entrar em inglês e virar o idioma em
PR próprio (seção 8, item 1).

### 2.4 Dependências

| Item | Proposta | Observação |
| --- | --- | --- |
| **#629** — pisos de segurança (Next 16.3.8 e `overrides`), raiz e `mcp-server` | **Trazer** | `npm audit --package-lock-only` no nosso lock: 18 pacotes vulneráveis (2 críticos, 13 altos). Com o lock unido: 8, nenhum crítico (os que sobram são da cadeia do CLI `shadcn` e do eslint, iguais no original) |
| **#582** — `@base-ui/react` 1.6 → 1.8 | **Trazer**, com roteiro de tela | Dependem dela: `src/components/ui/select.tsx` (deriva `items`), `popover.tsx` e `dropdown-menu.tsx` (`collisionAvoidance`). Conferir os popups do cabeçalho em tela de celular e os Selects |
| **#623/#637** — `lucide-react` 1.52 | **Trazer** | Os 220 ícones que importamos existem na 1.52; `Trash2` e `Building2` viram apelido |
| **#583/#622** — `next-intl` 4.14.8 | **Trazer** | Comparar a contagem de avisos do `i18n-parity.mjs` antes e depois |
| **#637** — `supabase-js` `~2.109.0`, `sonner`, `tailwind-merge` 3.7 | **Trazer** | Repetir a medição do `ui.md` com a 3.7 (`twMerge('group-data-horizontal/tabs:h-8 h-auto')` devolve as duas classes) |
| **#509**, **#598/#620** — `dagre`, `@types/node`, `prettier` | **Trazer** | — |
| **#627** — `dependabot.yml` ignora releases que pedem Node 22 | A mesclagem do Git serve | Inerte para nós (o original roda Node 20; nós, 22) |

`package.json` e `package-lock.json` **não se resolvem por nenhum dos dois
lados inteiros**: o deles tira as três `@codemirror/*` (o build quebra) e o
nosso fica nas versões vulneráveis. O conflito é de um trecho só em cada
arquivo; o lock unido passa em `npm ci --dry-run` e é ponto fixo do npm 10.9.9.

## 3. O que quebra se o conteúdo entrar cru

- **Migration 045**: recria `automation_pending_executions_status_check` com
  `pending, running, done, failed, awaiting_reply, expired, superseded` — sem
  `cancelled`. Em produção o `ADD CONSTRAINT` é recusado (há centenas de linhas
  `cancelled`). Num banco VAZIO (replay, instalação nova) aplica limpa, e daí
  "parar a automação", desativar, "parar se o cliente responder" e "presa à
  etapa" não conseguem mais gravar `cancelled`: a espera que devia parar acorda
  e manda mensagem ao cliente. Só renumerada, é a armadilha: replay verde.
- **Migration 046**: recria os CHECKs de provedor de `ai_configs` e
  `ai_usage_log` com `openai, anthropic, openai_compatible` — sem `gemini`. Em
  produção falha ao aplicar (o uso registrado é todo `gemini`); em banco vazio
  recusa a configuração com Gemini e o registro de uso some sem erro.
- **`verify-schema.sql` mesclado sozinho**: trava o replay (e o deploy) se as
  migrations deles não entrarem com os nomes deles; com as quatro só
  renumeradas, fica verde e esconde as duas perdas acima.
- **`meta-send.ts` (automações e robôs) pelo lado deles**: os remetentes voltam
  a ser só Meta, pelo espelho `whatsapp_config` — some o envio pelas conexões
  de QR code (Evolution), o carimbo de canal, o BSUID por transporte e a bolha
  "não enviada".
- **`signup/page.tsx` pelo lado deles**: some o cadastro por convite.
- **34 arquivos de servidor sem as chaves**: todo 401/403/429/500 do painel sai
  com o caminho da chave no lugar da frase. O CI segura (portão de chaves e 53
  testes, medido), mas ≈25 chaves pedidas por `getT` o portão não enxerga.
- **`src/lib/flows/templates.ts` sem as chaves**: o robô criado por um modelo
  pronto nasce com o caminho da chave como texto dos nós; o de captura de lead
  dispara na primeira mensagem de contato novo.
- **`package.json` pelo lado deles**: saem as `@codemirror/*`; o build quebra.
- **`next.config.ts` pelo lado deles**: sai o `agentRules: false` (§6, item 7)
  e entra um alias de dicionário que não conhece `pt-BR`.
- **`vitest.config.ts` mesclado sozinho**: o alias usa `new URL(...).pathname`;
  em pasta com espaço no caminho (a do operador) 124 de 704 arquivos de teste
  falham com "Cannot find package @app-messages" (medido). O CI não acusa.
- **Testes do original que entram inteiros e reprovam o nosso código**, travando
  o deploy até a correção: `src/middleware.test.ts` (4), `src/next-config.test.ts`
  (7) e, se `ssrf.ts` ficar o nosso, `ssrf.test.ts` (1 teste e 2 erros de tipo).

A maior parte disso o CI barra antes de publicar. O custo de um merge mal
resolvido no `main` não é publicar errado: é o `main` vermelho segurando o
deploy de todos os PRs seguintes.

## 4. Caminho proposto

Três PRs nossos, a partir do `main`. Os dois primeiros não dependem de
nenhuma decisão da seção 8.

1. **Dependências** (item 2.4), no modelo da Fase 1 de setembro (PR #239):
   `package.json` e locks unidos, `npm ci`, typecheck, suíte, build e o roteiro
   de tela do base-ui 1.8.
2. **Três consertos no nosso código**, com os testes do original:
   - `next.config.ts`: `private, no-store`, com `opus/` e `inbox-doodle.svg`
     fora da regra (#626);
   - `src/middleware.ts`: `/flows`, `/agents`, `/notifications` e `/tarefas` no
     `protectedPaths` (#607);
   - `src/app/api/whatsapp/templates/[id]/route.ts`: a conta nas três escritas
     (#589);
   - `src/app/(auth)/signup/page.tsx`: `emailRedirectTo` pelo nosso callback
     no ramo SEM convite (#597), como o `forgot-password` já faz;
   - migration nossa trocando a policy de leitura do bucket `avatars` pela
     pasta do próprio login (#628). É RESTRITIVA, mas nenhuma versão do app lê
     avatar de outra pessoa pela API (a tela usa a URL pública), então a ordem
     em relação ao deploy é indiferente. ⚠️ O bucket é público: a policy fecha
     a LISTAGEM (enumerar as pastas `<user_id>/…`), não o arquivo de quem já
     conhece o endereço.
3. **Branch de integração** pela receita da §1 do `docs/MERGE-UPSTREAM.md`
   (merge real, que fecha a ancestralidade em `27c6bdf4`), resolvida por
   arquivo inteiro conforme a seção 5: retomada do disparo, os 34 arquivos de
   servidor e as telas da tradução com a união das chaves, o tradutor adaptado
   e as asserções adaptadas do `verify-schema`. No mesmo PR: ensinar o `getT`
   ao portão `scripts/i18n-chaves-usadas.mjs`, teste para as chaves montadas de
   papel (`LibErrors.auth.roleNames.<papel>`), as linhas novas da §4 e da §6
   do `docs/MERGE-UPSTREAM.md` (seção 6 daqui) e `Doc-inalterada:` no commit (o
   merge toca `rate-limit.ts`, `meta-api.ts`, `template-send-builder.ts` e
   `ssrf.ts`, que o job `documentacao` trata como contrato).

Nenhuma das quatro migrations do original entra. Entra UMA nossa (a do
avatar, no PR 2); se algum item da seção 8 pedir outra, o número é o maior do
`main` + 1, conferido na hora (a 1082 foi aplicada em 12/10/2026).

## 5. Resolução proposta por arquivo

Como ler a coluna **Resolução**:

- *nosso inteiro* — arquivo em conflito: `git checkout --ours`.
- *deles inteiro* — o arquivo do original, como veio.
- *a mesclagem do Git serve* — os dois lados mudaram, sem conflito, e o
  resultado foi lido e aceito.
- *voltar ao main* — o Git mesclaria sozinho (ou traria inteiro), e a proposta
  é DESFAZER: `git checkout origin/main -- <arquivo>`.
- *nosso + porte à mão* — fica o nosso e um trecho pequeno do original é
  portado.
- *apagar* — `git rm`; entra na lista "apagar de novo" da §6 do
  `docs/MERGE-UPSTREAM.md`.
- *união* — nem um lado nem o outro inteiro: as dependências (seção 2.4) e os
  dicionários (seção 2.3).

A coluna **Recorte** diz qual das revisões temáticas da seção 9 avaliou o
arquivo.

| Arquivo | Classe | Resolução | Recorte |
| --- | --- | --- | --- |
| `.env.local.example` | conflito | nosso inteiro | ia |
| `.github/dependabot.yml` | mesclado sozinho | a mesclagem do Git serve | deps |
| `README.md` | conflito | nosso inteiro | auth |
| `docs/auth-emails.md` | só do upstream | apagar | auth |
| `mcp-server/package-lock.json` | só do upstream | deles inteiro | deps |
| `mcp-server/package.json` | mesclado sozinho | a mesclagem do Git serve | deps |
| `messages/en.json` | conflito | nosso + união das chaves pedidas | i18n_cliente |
| `messages/es.json` | conflito | apagar | i18n_cliente |
| `messages/ko.json` | conflito | apagar | i18n_cliente |
| `messages/pt.json` | conflito | apagar (depois de colher as traduções) | i18n_cliente |
| `next.config.ts` | conflito | nosso + porte à mão | i18n_cliente, rede |
| `package-lock.json` | conflito | união dos dois lados | deps |
| `package.json` | conflito | união dos dois lados | deps |
| `src/app/(auth)/forgot-password/page.tsx` | mesclado sozinho | voltar ao main | auth, i18n_cliente |
| `src/app/(auth)/login/page.tsx` | só do upstream | voltar ao main | auth |
| `src/app/(auth)/reset-password/page.tsx` | conflito | nosso inteiro | auth |
| `src/app/(auth)/signup/page.tsx` | conflito | nosso inteiro | auth |
| `src/app/(dashboard)/automations/page.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/app/(dashboard)/broadcasts/[id]/page.tsx` | conflito | nosso inteiro | disparo, i18n_cliente |
| `src/app/(dashboard)/broadcasts/new/page.tsx` | mesclado sozinho | a mesclagem do Git serve | disparo, i18n_cliente |
| `src/app/(dashboard)/broadcasts/page.tsx` | conflito | nosso inteiro | disparo, i18n_cliente |
| `src/app/(dashboard)/contacts/page.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/app/(dashboard)/flows/page.tsx` | conflito | nosso + porte à mão | i18n_cliente |
| `src/app/(dashboard)/pipelines/page.tsx` | conflito | nosso + porte à mão | i18n_cliente |
| `src/app/api/account/api-keys/[id]/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/account/api-keys/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/account/invitations/[id]/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/account/invitations/route.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/app/api/account/members/[userId]/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/account/members/route.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/app/api/account/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/account/transfer-ownership/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/ai/autoreply/[conversationId]/route.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/app/api/ai/config/route.ts` | conflito | nosso inteiro | i18n_servidor, ia |
| `src/app/api/ai/draft/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/ai/knowledge/[id]/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/ai/knowledge/reindex/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/ai/knowledge/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/ai/playground/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/ai/test/route.ts` | conflito | nosso inteiro | i18n_servidor, ia |
| `src/app/api/ai/usage/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/automations/[id]/duplicate/route.ts` | conflito | nosso inteiro | authz, i18n_servidor |
| `src/app/api/automations/[id]/route.test.ts` | conflito | nosso inteiro | authz |
| `src/app/api/automations/[id]/route.ts` | conflito | nosso inteiro | authz, i18n_servidor |
| `src/app/api/automations/cron/route.ts` | conflito | nosso inteiro | espera |
| `src/app/api/automations/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/contacts/[id]/tags/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/flows/[id]/activate/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/flows/[id]/route.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/app/api/flows/[id]/runs/route.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/app/api/flows/route.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/app/api/flows/templates/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/invitations/[token]/redeem/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/quick-replies/[id]/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/quick-replies/route.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/app/api/whatsapp/broadcast/[id]/resume/route.ts` | mesclado sozinho | a mesclagem do Git serve | disparo, i18n_servidor |
| `src/app/api/whatsapp/broadcast/route.ts` | conflito | nosso inteiro | disparo, i18n_servidor |
| `src/app/api/whatsapp/config/route.ts` | conflito | nosso inteiro | i18n_servidor, rede |
| `src/app/api/whatsapp/config/verify-registration/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/whatsapp/media/[mediaId]/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/whatsapp/react/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/whatsapp/send/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/whatsapp/templates/[id]/route.test.ts` | só do upstream | a mesclagem do Git serve | authz |
| `src/app/api/whatsapp/templates/[id]/route.ts` | conflito | nosso + porte à mão | authz, i18n_servidor |
| `src/app/api/whatsapp/templates/submit/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/whatsapp/templates/sync/route.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/app/api/whatsapp/webhook/route.test.ts` | conflito | nosso inteiro | espera |
| `src/app/api/whatsapp/webhook/route.ts` | conflito | nosso inteiro | espera |
| `src/app/auth/callback/route.test.ts` | conflito | nosso inteiro | auth |
| `src/app/auth/callback/route.ts` | conflito | nosso inteiro | auth |
| `src/app/layout.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/components/automations/automation-builder.tsx` | conflito | nosso inteiro | espera, i18n_cliente |
| `src/components/broadcasts/step2-select-audience.tsx` | conflito | nosso inteiro | disparo, i18n_cliente |
| `src/components/broadcasts/step3-personalize.tsx` | mesclado sozinho | a mesclagem do Git serve | disparo, i18n_cliente |
| `src/components/broadcasts/step4-schedule-send.tsx` | conflito | nosso inteiro | disparo |
| `src/components/contacts/contact-detail-view.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/components/contacts/contact-form.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente |
| `src/components/contacts/import-modal.tsx` | conflito | nosso + porte à mão | i18n_cliente |
| `src/components/dashboard/response-time-chart.tsx` | só do upstream | deles inteiro | i18n_cliente |
| `src/components/flows/flow-editor-state.tsx` | conflito | nosso + porte à mão | i18n_cliente |
| `src/components/flows/forms/node-config-form.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente |
| `src/components/inbox/message-bubble.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/components/inbox/message-composer.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/components/inbox/message-thread.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/components/inbox/template-picker.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente |
| `src/components/interactive/interactive-builder.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente |
| `src/components/pipelines/pipeline-settings.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente |
| `src/components/settings/ai-config.tsx` | conflito | nosso inteiro | i18n_cliente, ia |
| `src/components/settings/appearance-panel.tsx` | só do upstream | deles inteiro | i18n_cliente |
| `src/components/settings/invite-member-dialog.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente |
| `src/components/settings/password-form.tsx` | só do upstream | deles inteiro | i18n_cliente |
| `src/components/settings/profile-form.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente |
| `src/components/settings/quick-replies-manager.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/components/settings/sessions-card.tsx` | só do upstream | deles inteiro | i18n_cliente |
| `src/components/settings/template-manager.tsx` | conflito | nosso + porte à mão | i18n_cliente |
| `src/components/settings/whatsapp-config.tsx` | mesclado sozinho | a mesclagem do Git serve | i18n_cliente, rede |
| `src/components/ui/dialog.tsx` | só do upstream | deles inteiro | i18n_cliente |
| `src/components/ui/gated-button.tsx` | conflito | nosso inteiro | i18n_cliente |
| `src/components/ui/sheet.tsx` | só do upstream | deles inteiro | i18n_cliente |
| `src/hooks/use-broadcast-sending.ts` | conflito | nosso inteiro | disparo, i18n_cliente |
| `src/lib/ai/auto-reply.test.ts` | conflito | apagar | ia |
| `src/lib/ai/config.test.ts` | conflito | nosso inteiro | ia |
| `src/lib/ai/config.ts` | conflito | nosso inteiro | ia |
| `src/lib/ai/defaults.ts` | conflito | nosso inteiro | ia |
| `src/lib/ai/embeddings.ts` | só do upstream | deles inteiro | i18n_servidor, ia |
| `src/lib/ai/generate.test.ts` | conflito | nosso inteiro | ia |
| `src/lib/ai/generate.ts` | mesclado sozinho | voltar ao main | ia |
| `src/lib/ai/providers/anthropic.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor, ia |
| `src/lib/ai/providers/openai-compatible.test.ts` | só do upstream | apagar | ia |
| `src/lib/ai/providers/openai-compatible.ts` | só do upstream | apagar | i18n_cliente, i18n_servidor, ia |
| `src/lib/ai/providers/openai.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor, ia |
| `src/lib/ai/providers/shared.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor, ia |
| `src/lib/ai/types.ts` | conflito | nosso inteiro | ia |
| `src/lib/auth/account.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/lib/auth/callback.test.ts` | só do upstream | apagar | auth |
| `src/lib/auth/callback.ts` | só do upstream | apagar | auth |
| `src/lib/automations/engine.test.ts` | conflito | nosso inteiro | authz, espera |
| `src/lib/automations/engine.ts` | conflito | nosso inteiro | authz, espera, i18n_cliente, i18n_servidor |
| `src/lib/automations/meta-send.ts` | conflito | nosso inteiro | authz, i18n_servidor |
| `src/lib/automations/templates.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/lib/automations/validate.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/lib/broadcast-audience.test.ts` | só do upstream | apagar | disparo |
| `src/lib/broadcast-audience.ts` | só do upstream | apagar | disparo |
| `src/lib/contacts/tag-write.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/lib/currency.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/lib/dashboard/queries.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/lib/flows/meta-send.ts` | conflito | nosso inteiro | authz, i18n_servidor |
| `src/lib/flows/templates.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/lib/flows/validate.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/lib/i18n/translate.test.ts` | só do upstream | deles inteiro | i18n_cliente, i18n_servidor |
| `src/lib/i18n/translate.ts` | só do upstream | deles inteiro | i18n_cliente, i18n_servidor |
| `src/lib/media/download.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/lib/rate-limit.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/lib/storage/upload-media.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/lib/supabase/paged-query.test.ts` | só do upstream | deles inteiro | disparo |
| `src/lib/supabase/paged-query.ts` | só do upstream | deles inteiro | disparo |
| `src/lib/template-status.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/lib/webhooks/ssrf.test.ts` | mesclado sozinho | a mesclagem do Git serve | rede |
| `src/lib/webhooks/ssrf.ts` | conflito | deles inteiro | rede |
| `src/lib/whatsapp/broadcast-resume.test.ts` | conflito | nosso + porte à mão | disparo |
| `src/lib/whatsapp/broadcast-resume.ts` | mesclado sozinho | a mesclagem do Git serve | disparo |
| `src/lib/whatsapp/conversation-scope.ts` | conflito | nosso inteiro | authz, i18n_servidor |
| `src/lib/whatsapp/meta-api.ts` | mesclado sozinho | a mesclagem do Git serve | i18n_servidor |
| `src/lib/whatsapp/template-header-handle.ts` | conflito | nosso inteiro | i18n_servidor |
| `src/lib/whatsapp/template-send-builder.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/lib/whatsapp/template-validators.ts` | só do upstream | deles inteiro | i18n_servidor |
| `src/lib/whatsapp/verify-token.test.ts` | só do upstream | deles inteiro | rede |
| `src/lib/whatsapp/verify-token.ts` | só do upstream | deles inteiro | rede |
| `src/middleware.test.ts` | só do upstream | a mesclagem do Git serve | authz |
| `src/middleware.ts` | conflito | nosso + porte à mão | authz |
| `src/next-config.test.ts` | só do upstream | deles inteiro | i18n_cliente, rede |
| `src/types/index.ts` | mesclado sozinho | voltar ao main | espera |
| `supabase/ci/verify-schema.sql` | mesclado sozinho | voltar ao main + porte à mão | banco |
| `supabase/migrations/043_storage_scoped_select.sql` | só do upstream | apagar | banco |
| `supabase/migrations/044_internal_definer_grants.sql` | só do upstream | apagar | banco |
| `supabase/migrations/045_automation_wait_for_reply.sql` | só do upstream | apagar | banco, espera |
| `supabase/migrations/046_ai_openai_compatible.sql` | só do upstream | apagar | banco, ia |
| `tsconfig.json` | só do upstream | deles inteiro | i18n_cliente |
| `vitest.config.ts` | mesclado sozinho | voltar ao main | i18n_cliente |

Notas sobre as resoluções que mais pesam:

- `src/lib/webhooks/ssrf.ts` é o ÚNICO conflito que fica com o lado deles.
- `src/lib/ai/providers/{shared,openai,anthropic}.ts` e `src/lib/ai/embeddings.ts`
  entram com `getT` (a tradução), sem as chaves `LibErrors.ai.compat*`, que
  saem com o #609. `providers/gemini.ts` e `structured.ts`, nossos, continuam
  com frase fixa em inglês.
- `src/lib/whatsapp/verify-token.ts` e o teste ficam como vieram (código sem
  chamador, inerte). Os outros módulos mortos do original são apagados porque
  duplicam um nosso com régua mais fraca, ou arrastam chave, variável de
  ambiente ou teste vermelho.
- `src/types/index.ts` volta ao `main`: o único trecho do original nele é do
  #636.
- A `043_storage_scoped_select.sql` é apagada, mas NÃO inteira no conteúdo: o
  predicado de dono na leitura do `avatars` é portado numa migration nossa
  (seção 2.1). As outras duas policies dela já são as da 0900.

## 6. A lista da §6 do `docs/MERGE-UPSTREAM.md` neste merge

Acionados: **1** (`ko/pt/es.json` voltam), **7** (`agentRules: false`), **8**
(quatro migrations de 3 dígitos — nenhuma se renumera crua), **9** (a 043
recria policies de leitura; apagada, só o predicado do avatar entra, por
migration nossa), **10** (dicionários por
união), **13** (32 mesclados sozinhos), **15** (as linhas da §4).

Não acionados: 2, 3, 4, 5, 6, 11, 12 e 14 (o typecheck da árvore simulada só
acusa erros do #609; a única assinatura exportada que muda é
`isDeliverableUrl(url, opções?)`, compatível com os 5 chamadores).

A acrescentar à §6 de lá quando o merge acontecer ("apagar de novo"):
`docs/auth-emails.md`, `src/lib/auth/callback.ts` (+ teste),
`src/lib/broadcast-audience.ts` (+ teste),
`src/lib/ai/providers/openai-compatible.ts` (+ teste),
`src/lib/ai/auto-reply.test.ts` e as migrations 043 a 046.

A acrescentar à §4 de lá: o canal na retomada do disparo
(`broadcast-resume.ts`), o cadastro por convite em `signup/page.tsx`, o aviso
`?erro=link` em `forgot-password/page.tsx`, e os três testes do original que
viram pino nosso (`middleware.test.ts` exige toda pasta nova de `(dashboard)`
no `protectedPaths`; `next-config.test.ts` fixa o valor do `Cache-Control`;
`templates/[id]/route.test.ts` depende da queda de `resolveMetaChannel` no
espelho `whatsapp_config`).

## 7. O que NÃO foi medido

- `next build` e `lint` sobre a árvore mesclada: se o Turbopack resolve
  `@app-messages` com e sem o bloco no `next.config.ts`, e o peso do dicionário
  nos chunks de cliente (atenuante: o dicionário inteiro já vai ao cliente pelo
  `NextIntlClientProvider`, `src/app/layout.tsx:100`).
- `npm ci` real, suíte e build com as versões novas das dependências (só
  `--dry-run`); nada foi instalado.
- O replay de migrations (`supabase db reset`) com as asserções adaptadas.
- O efeito do `no-store` no voltar/avançar e no app instalado no iPhone, e o do
  base-ui 1.8 nos popups do cabeçalho no iPhone.
- A consulta nova da retomada do disparo contra o PostgREST real.
- O texto das ≈171 chaves do `pt.json` deles, chave a chave (só amostra).
- Os padrões de `texto-do-motor.ts` contra as frases em português (por isso a
  virada de idioma fica para PR próprio).
- As simulações rodaram em Node 24; o CI usa 22. Nenhuma falha encontrada
  depende de Intl, fuso ou colação.

## 8. Decisões do operador (abertas)

1. Os avisos de erro do servidor passam para português já, ou entram em inglês
   como hoje e viram em PR próprio? Se virarem: a API pública (n8n/Make) fica
   sempre em inglês? *Proposta: entrar em inglês; virar depois, com os textos
   revisados e a API pública mantida em inglês.*
2. Os três robôs prontos e o funil padrão nascem em português? Com quais
   textos? (Os robôs do original falam de suporte, preço e reembolso.)
3. "Enviar uma pergunta e só seguir quando o cliente responder" nas
   automações: queremos? *Proposta: não neste merge.*
4. Um quarto provedor de IA (OpenRouter, Groq, modelo próprio): queremos?
   *Proposta: não neste merge.*
5. O link de "esqueci a senha" deve funcionar aberto em outro aparelho?
6. A página de detalhe da campanha lê os destinatários sem paginar (tabela,
   exportação e contadores param em 1.000; o original tem o mesmo defeito):
   consertar antes do primeiro disparo acima de 1.000? *Fora deste merge.*

## 9. Como esta revisão foi feita

Dez revisões temáticas independentes (autorização, rede, autenticação, banco,
espera por resposta, IA, disparo, tradução no servidor, tradução nas telas,
dependências), cada uma lendo o diff do original, o nosso código, o resultado
do ensaio de merge e as regras da área; o banco foi conferido no catálogo de
produção, só leitura. Uma décima primeira conferiu a cobertura (159 de 159
arquivos, 61 de 61 commits), as 14 divergências entre as dez e, no código, 32
afirmações de maior peso: 27 confirmadas, 4 inconclusivas, 1 refutada.

O que a conferência corrigiu:

- **Refutada**: "o próximo número de migration é 1082" — a 1082 foi aplicada
  em 12/10/2026.
- **Causa corrigida**: o servidor responder em inglês com `pt-BR` não vem da
  lista de `translate.ts` (ela só escolhe o locale de plural e formato), e sim
  do alias (`next.config.ts` deles sem `pt-BR`; sem o bloco, o `paths` do
  `tsconfig.json` aponta `en.json`). O ajuste é nos dois lugares.
- **Inconclusivas**: o worker de áudio baixar inteiro a cada gravação com o
  #626 cru (não medido em navegador); as `merge_duplicate_*` sem EXECUTE para
  `service_role` em banco vazio (ninguém rodou o replay); o peso do dicionário
  no pacote do cliente (nenhum build medido); a fatia da tradução nos arquivos
  de IA (depende da decisão sobre o `getT`).

### Segunda revisão (Codex, PR #401)

Rodada 1, sobre `78b17538`: um achado, confirmado no código e no catálogo de
produção.

- **O "já temos" da 043 estava incompleto.** A conferência interna comparou os
  predicados de `chat-media` e `flow-media` (iguais aos da 0900) e deu a 043
  por coberta; no `avatars` a 0900 deixa a leitura para qualquer autenticado,
  sem o predicado de dono que a 043 acrescenta. A revisão temática do banco
  tinha visto a diferença e a tratado como opcional; o plano a achatou em
  "sim". Corrigido na seção 2.1 e na seção 4. Em produção o bucket está vazio,
  então nada foi exposto.

Rodada 2, sobre `a6302273`: dois achados, os dois com o fato confirmado no
código.

- **O signup não era "não se aplica".** O arquivo deles continua de fora (apaga
  o cadastro por convite), mas o nosso ramo sem convite chama `signUp` sem
  `emailRedirectTo`. Aceito: porte de uma linha, no PR 2 (seções 2.2 e 4). Não
  muda nada na nossa produção, onde o cadastro público é fechado.
- **O "sim+" do público do disparo tem teto.** A nossa leitura para em 25.000
  linhas e recusa o disparo; a do original não tem teto. O fato procede; a
  PROPOSTA fica a mesma (o hook é o nosso, `broadcast-audience.ts` sai): o teto
  é falha fechada escolhida de propósito — a leitura roda no navegador, contra
  uma tabela que muda —, e trocar pelo laço sem teto deles desfaria a leitura
  por chave. Registrado como limite conhecido na seção 2.2.
