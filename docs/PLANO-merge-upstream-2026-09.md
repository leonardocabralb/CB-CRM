# Plano — trazer as novidades do upstream (setembro/2026) sem retrocesso

Documento INTERNO e vivo. **Cada fase só começa depois de a anterior estar
validada na prática**, e o resultado de cada uma é escrito aqui — na seção da
fase e no diário do fim.

| | |
| --- | --- |
| **Estado** | Fases 0 a 10 em produção (a 3 partida em 3-I a 3-IV; ver o mapa), e o #289 (os achados do Codex nas Fases 8 e no #286) também; a 11 (BSUID) em andamento — o desenho e as decisões do operador estão na seção da fase. A prova real da Fase 5 foi feita em 24/09 (o modelo fora da janela foi ENTREGUE; ver a seção). ⚠️⚠️ **Em 23/09/2026 às 16:40Z o PR #259 — o merge CRU do original até `aee1b01f`, feito por outra pessoa — entrou no `main` e foi publicado.** Ele fechou a ancestralidade (a Fase 12 aconteceu sem querer) e pôs em produção, sem as adaptações, o conteúdo das Fases 4 a 11. A seção "O merge #259", no fim da seção 7, tem a auditoria e o que cada fase passa a ser. |
| **Alvo PINADO** | `upstream/main` = **`80c3f9a`** (13/09/2026). Base comum com o nosso `main`: `98b5bd2` (upstream #532, 31/08). Tudo neste plano se refere a esse commit — se o upstream andar, é outro ciclo. ⚠️ **Ele ANDOU (medido em 21/09/2026): `upstream/main` = `aee1b01f`, 2 commits novos** — `b9969fa2` (#586: exige `+` e código do país em telefone digitado e na API; 21 arquivos) e `f8a1cc72` (chaves do modal de importação em `pt`/`es`). Estão FORA deste plano até a decisão P9 (seção 8). Conferido de novo em 22/09/2026: não andou mais. ⚠️ **Desde o #259 (23/09/2026), `aee1b01f` é ANCESTRAL do nosso `main`**: o próximo merge do original parte dali, e o que o #259 descartou não volta por merge. |
| **Pedido do operador (21/09/2026)** | Trazer todas as atualizações como COMPLEMENTO ou CORREÇÃO, nunca retrocesso. BSUID por último (é o mais complexo e o de maior risco). Toda correção é **medida contra o nosso código**, **revisada em duas lentes** e **testada no preview, na prática**. Merge e migration estão autorizados quando o teste exigir. Só depois da validação passa-se à fase seguinte. |
| **PR #229** | Aberto por `devgabrielslv` com head em `ArnasDon/wacrm:main`. **Não tinha como ser mesclado**: resolver conflito ali seria commitar no upstream, e o conteúdo dele muda sozinho (a origem é uma branch viva). **FECHADO em 21/09/2026 por decisão do operador (P1)**, com comentário apontando para este plano — fechar o PR não descarta o conteúdo: ele entra pelas fases daqui, e a worktree `.claude/worktrees/merge-upstream` fica de pé para isso. |
| **Migrations deste plano** | Faixa **`1030+`** (decisão da Fase 0 — a sessão da Kommo aplicou a 1023 hoje e segue criando números; já houve 7 colisões de branches em paralelo). ~~Migration do upstream aplicada SEM mudança entra na faixa `00xx`~~ — **errado**: contradizia a regra do `db push` do CLAUDE.md (número novo vem depois do maior no `main`). O #259 seguiu esta linha e trouxe `0043`/`0045`; a correção do #259 as renumerou para **`1038`** (a 040, BSUID) e **`1039`** (a 042, motivo da falha). A `041` continua não usada (a 1030 a substitui). |

## 1. O problema, em uma frase

O upstream publicou **19 PRs** (40 commits, 101 arquivos) desde o nosso último
merge, e eles mexem exatamente onde o fork mais divergiu — envio, webhook,
fluxos, i18n. Um `git merge` direto dá **38 arquivos em conflito** e, pior,
**armadilhas que o Git não marca** (seção 2.3).

## 2. Medições (21/09/2026, contra `origin/main` = `7a1dbb4`)

### 2.1 O tamanho

| | |
| --- | --- |
| Arquivos que o upstream mexeu | 101 |
| …em que o fork TEM customização | 59 |
| …em conflito textual | **38** |
| …mesclados EM SILÊNCIO nos dois lados (revisão semântica obrigatória) | **21** |
| …só deles (arquivo novo, ou idêntico ao da base no nosso lado) | 42 (21 novos + 21 modificados) |
| Linhas novas do upstream em `src/` (fora testes) | 3.190 |
| Chaves novas no `en.json` deles | 269 — **50** já existem no nosso com o mesmo caminho; das **219** que não temos, **213** vêm traduzidas no `pt.json` deles |

### 2.2 Os conflitos, por natureza

- **Triviais (~8)** — regra já escrita no `CLAUDE.md`: `messages/ko.json` e
  `.github/workflows/migrations.yml` (apagar de novo), `src/i18n/messages.test.ts`
  (fica `pt-BR`), `README.md`, `.env.local.example`, `message-composer.tsx`
  (1 linha), `templates/[id]/route.ts`, `contact-sidebar.tsx` (o nosso é um
  wrapper; o que eles mudaram vai para `painel/painel-do-contato.tsx`).
- **Mecânicos e trabalhosos (~14)** — os DOIS lados traduziram as mesmas telas
  com nomes de chave diferentes (`acceptError` × `acceptFailed`): signup,
  forgot-password, join (15 blocos), notifications, ai-playground, ai-usage,
  cabeçalho e runs de fluxos, interactive-builder/preview, invite-dialog,
  `automations/page`, `trigger-meta`, e o `en.json` (9 blocos, 787 × 161 linhas).
- **Exigem reescrita (~12)** — BSUID (#533) e o "digitando…" (#527) mexem nos
  senders que reescrevemos para multi-canal/Evolution/Instagram:
  `flows/meta-send.ts` (12 blocos), `message-thread.tsx` (12), `webhook/route.ts`
  (6), `flows/engine.ts` (5), `send-message.ts` (4), `automations/meta-send.ts`,
  `react/route.ts`, `auto-reply.ts`, `types/index.ts`, `message-bubble.tsx`,
  `dashboard-shell.tsx` e dois arquivos de teste.

### 2.3 Armadilhas que o Git NÃO marca

1. **Numeração**: as migrations `040/041/042` deles colidem com as nossas
   `0040/0041/0042` (que são as 037–039 deles, renumeradas em 26/08) e têm 3
   dígitos — `nomes-das-migrations.test.ts` reprova.
2. **A `041` deles recria a função de disparo com 8 parâmetros** — a assinatura
   que a nossa 940 APAGOU de propósito (overload sem canal). E o
   `verify-schema.sql` deles faz `::regprocedure` na de 8 parâmetros: no nosso
   replay ela não existe, o cast ESTOURA e o deploy trava.
3. **`loadAccountMetaCredentials(db, accountId)`** (do #527) carrega UMA
   credencial por conta. Aceito em qualquer sender, o robô responde pelo número
   errado, sem erro nenhum.
4. **#534 e #505 caem em estrutura LEGADA**: o stub de modelo procura a conta em
   `whatsapp_config.waba_id` (as duas linhas da produção são Evolution, sem
   WABA — nunca dispararia), e a tela `whatsapp-config.tsx` não é importada em
   lugar nenhum (o canal Meta nasce por `src/lib/cb-channels/meta-admin.ts`).
   Inofensivos, e INERTES sem port.
5. **Notificação do navegador** ignora o recorte de conexões do perfil de acesso
   e dispararia em toda mensagem dos 58 grupos — contraria a decisão do Meu dia.
6. **`pt.json`/`es.json`/`ko.json`** chegam com 1.730 chaves contra as nossas
   3.923; o teste de paridade deles reprovaria.
7. **Marca**: "wacrm" volta em 5 trechos de `src/` e 1 chave do `en.json`.

### 2.4 O que JÁ nos protege

Varredura das 3.190 linhas novas atrás do que os nossos testes estruturais
reprovam: **zero** literal de transporte (`kind ===`), **zero** `user_id:
user.id`, **zero** `signOut` sem escopo; **um** `date-fns` sem locale (o eixo do
gráfico de uso da IA, exceção já escrita). Os dois portões de i18n, o
`messages.test.ts`, o `produto-gate` e o replay das migrations seguram o deploy.

## 3. A estratégia: PORTAR primeiro, MESCLAR por último

> ⚠️ **Superada em 23/09/2026 pelo merge #259**, que fez o merge PRIMEIRO (e
> cru). O método das fases continua; o merge de fechamento não existe mais —
> ver a seção "O merge #259", no fim da seção 7.

Cada correção do upstream entra **sozinha**, em branch própria saída de `main`
(cherry-pick quando aplica limpo, port à mão quando o fork divergiu), passa
pelo protocolo da seção 4 e vai para produção num deploy pequeno. O
`git merge 80c3f9a` — que registra a ancestralidade e impede estes 38 conflitos
de voltarem — é o **fechamento** (Fase 12): nessa altura todo o conteúdo já
está no nosso tree e validado, todo conflito se resolve com "fica o nosso", e a
prova é objetiva: **o diff entre o `main` e o resultado do merge tem de ser
(quase) vazio**, e cada linha que sobrar é revisada.

Por que não mesclar primeiro (o que eu havia sugerido antes do pedido de
21/09): mesclar traz 19 PRs num deploy só, e a exigência é validar cada
correção antes de passar à seguinte. Portar primeiro custa resolver os mesmos
conflitos em pedaços; em troca, cada deploy carrega UMA mudança e, se algo
quebrar, sabe-se qual.

## 4. O protocolo de cada fase (o portão)

1. **Medir contra o nosso código.** Provar que o defeito existe (ou não) no
   NOSSO código: teste que reproduz, consulta na produção ou leitura do fonte.
   Ler o commit do upstream inteiro. Se o defeito não existe aqui, o item fecha
   como "não se aplica" — com a medição escrita.
2. **Implementar** em branch saída de `main`, na worktree
   `.claude/worktrees/merge-upstream`. Cherry-pick com `-x` quando aplica limpo;
   port à mão quando não. Chave de i18n nova entra nos DOIS dicionários na
   mesma passada.
3. **Verificar local**: `typecheck`, `lint` (ler `✖ N problems`, nunca a última
   linha), suíte na major do CI (`npx -y node@22 node_modules/vitest/vitest.mjs
   run`), os dois portões de i18n, e `build` quando tocar dependência ou rota.
4. **Revisão em DUAS LENTES**, por dois subagentes independentes (modelo forte),
   cada um cego para o achado do outro:
   - **Lente 1 — correção (adversarial):** procura bug, corrida, borda, falha
     silenciosa; compara com o commit do upstream ("o que ele faz que o nosso
     port deixou de fazer?").
   - **Lente 2 — regressão do fork:** confere o diff contra as decisões
     load-bearing do `CLAUDE.md` (multi-canal, dono durável, nome fixado,
     transporte por predicado, i18n, migrations em banco vazio…) — "isto desfaz
     alguma decisão nossa?".
   P0/P1 corrige antes de seguir; P2 é decidido e registrado.
5. **Teste prático no preview** (dev server da worktree, contra o banco de
   produção), pelo roteiro da fase. Evidência: captura, consulta ou log.
   ⚠️ O agendador da VPS drena a MESMA base (memória de 08/09): teste com fila
   disputa a corrida com a produção. Dado de teste é criado rotulado e limpo no
   fim, com `WHERE` explícito.
   ⚠️⚠️ **O preview escreve na PRODUÇÃO, e ABRIR uma conversa já é escrita**
   (zera `unread_count` para a conta inteira). Regra desde a Fase 1: o teste só
   abre a conversa do LEAD DE TESTE autorizado (`?c=00cc34a4-…`), sempre pela
   URL ou pela busca do nome — nunca "a primeira linha da lista". Foi assim que
   o teste do voltar-no-celular zerou as 4 não lidas de um cliente real
   (seção da Fase 1).
   ⚠️ **`next dev` não prova navegação**: ele não faz prefetch. O que mexe em
   rota, roteador ou dependência de framework é testado num build de produção
   local (`next build`, copiar `.next/static` e `public` para
   `.next/standalone`, `PORT=… node --env-file=.env.local
   .next/standalone/server.js`).
   ⚠️ **Painel do navegador OCULTO = `requestAnimationFrame` parado.** O que
   depende de rAF (restauração de rolagem, animação) parece quebrado sem estar.
   Conferir `document.hidden` antes de acusar regressão.
6. **PR → CI verde → `@codex review` no HEAD** (conferir por `gh api` que a
   revisão é do HEAD; "usage limits" = sem revisão) → **merge = deploy de
   produção** → verificação pós-deploy: site 200, `/api/cb/scheduled/cron` 401
   (503 = env vazia), ingestão viva, e o roteiro mínimo da fase em produção.
   ⚠️ **Fase com MIGRATION: o passo 5 acontece NO MEIO deste** (a lição da 1010,
   reafirmada na Fase 2) — (a) PR em RASCUNHO → replay do CI verde no commit
   EXATO; (b) aplicar a migration e registrá-la no `CLAUDE.md`; (c) o passo 5;
   (d) pronto para revisão → Codex no HEAD → merge. Commit novo que toque o
   `.sql` volta a (a). Na janela entre (b) e o merge a PRODUÇÃO roda o código
   antigo contra o banco novo — escrever o pior caso na seção da fase.
7. **Registrar aqui** (resultado, evidências, desvios, decisões). O pós-deploy
   da fase N é escrito no PR da fase N+1, para não gerar deploy só de
   documentação.
8. **Só então a próxima fase.** Falhou na validação → conserta ou reverte
   (`git revert` do merge; migration aditiva fica).

## 5. Regras do fork que valem em TODAS as fases

- Canal é da CONVERSA: nada de credencial "da conta". Transporte por predicado
  (`ehMeta`/`ehEvolution`/`ehInstagram`), nunca literal.
- Quem cria contato/conversa/campo grava o DONO da conta, nunca o membro.
- `nome_fixado_em` protege o nome contra escrita automática.
- Migration: 4 dígitos, aplica em banco VAZIO (todo `REVOKE` com `GRANT` de
  volta; conferência não exige dado), aplicada ANTES do merge quando
  acrescenta. Conferir `ls` **e** o histórico do Supabase na hora de numerar.
- Frase de UI não cita o nome do produto; texto novo vai para `en.json` **e**
  `pt-BR.json`.
- `message-bubble.tsx`, `message-thread.tsx`, `conversation-list.tsx`,
  `deal-card.tsx` e `contact-sidebar.tsx` ficam NOSSOS: o que o upstream mudou
  ali é portado, nunca aceito cru.
- Divergência achada no `CLAUDE.md` é corrigida no mesmo PR.

> **Retomada em outra sessão:** comece por `docs/HANDOFF-merge-upstream-2026-09.md`
> (onde paramos, o que foi corrigido, o que falta).

## 6. Mapa das fases

| Fase | O que entra (PR upstream) | Valor hoje (medido) | Complexidade | Risco | Migration | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| **0** | Preparação: worktree, alvo pinado, linha de base | — | Baixa | — | — | ✅ concluída (P1 decidida em 21/09: #229 fechado) |
| **1** | Segurança e dependências (#563, #510, #506) | Real: estamos no Next 16.2.12 | Baixa | Médio-baixo | — | ✅ em produção (PR #239, 21/09) |
| **2** | Função de disparo (#536) + 2 achados nossos (params em 2-D; `channel_id` descartado) | Real: quebrada na produção | Baixa → Média | Baixo | `1030` (aplicada 21/09) | ✅ em produção (PR #242, 21/09) |
| **1b** | Segurança depois do alvo: #588 (SSRF), #587 (automação por conta), #589 (conversa por conta) — PRs ABERTOS do mantenedor — e a mídia do Instagram (achado nosso) | Real: brechas presentes; o #587 também dava 404 ao admin não-autor | Média | Médio-baixo | — | ✅ em produção (PR #261, 23/09) |
| **3** | Pequenas e independentes: CSV (#529), textarea (#559), vários App Secrets (#500), tags da v1 (#560, só medir), e o resolvedor do canal Meta (3e — achado NOSSO da Fase 2, sem PR do upstream); com a P9, a normalização do telefone digitado — dividida em 3-I a 3-IV | Moderado | Baixa | Baixo | — | ✅ em produção: 3-I, 3-II, 3-IV e 3-III (PRs #262, #265, #269 e #276, 23/09) |
| **4** | Fluxos: `{{vars}}` em botões e listas (#553) | Inerte hoje (0 fluxos ativos) | Média | Médio-baixo | — | ✅ em produção (PR #271, 23/09): porte manual — o #259 **descartou** o `engine.ts` deles; teste real feito com a janela aberta pelo operador |
| **5** | Motivo da falha da Meta (#535) | 2 `failed` desde 10/09 | Média | Baixo | `1039` | ✅ em produção (PR #283, merge `6cedb67a`, rollout 24/09 00:24Z): porte manual — o #259 descartou o webhook deles; falta o disparo REAL fora da janela (a janela do lead de teste fecha 24/09 19:14Z) |
| **6** | Modelos: cabeçalho de mídia (#562) e stub (#534) | Moderado | Média | Médio-baixo | — | ✅ em produção (PR #284, merge `fe2a7530`, rollout 24/09 12:24:56Z): 6a (o teto na leitura) e 6b (stub COMPLETO por `cb_channels`, ligado), com E2E contra a Meta; pós-deploy conferido (seção da fase) |
| **7** | Erros de conexão explicados (#505), portado para `cb-channels` | Moderado | Média | Baixo | — | ✅ em produção (PR #285, merge `f5879b3f`, rollout 24/09 14:17:55Z, na reexecução): o motivo da falha em *Conexões* (`POST /api/cb/channels`), o par WABA/número conferido, a assinatura da WABA fatal, o token limpo das mensagens, o POST legado aposentado (410) e `docs/conexao-meta.md`; testado contra a Meta real com o token da conexão oficial (só leituras); pós-deploy conferido (seção da fase) |
| **8** | Notificação do navegador (#516), com recorte por perfil | Bom no computador | Média | Médio | — | ✅ em produção (PR #287, merge `789370a0`, rollout 24/09 16:44:28Z): o ouvinte montado na casca, dentro da `<PortaDeEntrada>`, com a régua do operador (perfil, grupo fora, "quais conversas", texto opcional, mensagem antiga calada), a preferência por pessoa e o cartão de volta em *Seu perfil*; testado na preview; pós-deploy conferido (seção da fase) |
| **9** | "Digitando…" da IA (#527), sobre o canal da conversa | Inerte hoje (auto-reply desligado) | Média | Médio | — | ✅ em produção (PR #288, merge `7a082fdb`, rollout 24/09 17:02:35Z): o "digitando…" pelo canal da resposta, só Meta e com `wamid.`, melhor esforço; inerte (resposta automática desligada); aceito pela Meta real; pós-deploy conferido (seção da fase) |
| **10** | i18n das telas em inglês (#577, #578, #579) | 219 chaves | Média (braçal) | Baixo | — | ✅ em produção (PR #290, merge `6959c5ec`, rollout 24/09 18:48:36Z): as traduções prontas ligadas, o inglês fixo das telas NOSSAS no dicionário, 183 chaves órfãs fora, o aviso de atribuição escrito pelo tipo; pós-deploy conferido (seção da fase) |
| **11** | **BSUID (#533)** — por último | Preventivo (0 fichas sem telefone) | **Alta** | **Alto** | `1038` (+ a do CHECK da P4) | colunas aplicadas e a biblioteca (`wa-identity.ts`) no `main`; entrada, saída e tela pendentes |
| **12** | ~~Merge de ancestralidade~~ → **inventário do que o #259 descartou** | O merge já aconteceu (#259) | Média | Baixo | — | a fazer: a lista está na seção "O merge #259" |

## 7. As fases

### Fase 0 — Preparação

- [x] Worktree isolada `.claude/worktrees/merge-upstream` (o checkout principal
      tem dev server vivo e há outras sessões no repositório).
- [x] Alvo pinado (`80c3f9a`) e medições da seção 2.
- [x] O #232 (Kommo) entrou no `main` durante a medição; os 38 conflitos não
      mudaram.
- [x] Linha de base na worktree: `typecheck`, `lint`, suíte em Node 22, portões
      de i18n — os números de referência para atribuir qualquer vermelho depois.
- [x] Decisão P1 (o #229): **fechado em 21/09/2026** por ordem do operador, com
      comentário explicando por que não pode ser mesclado e apontando para este
      plano. A worktree fica de pé — é por ela que as correções seguem entrando.

**Resultado (21/09/2026) — linha de base sobre `7a1dbb4`:**

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | limpo |
| `npm run lint` | `✖ 51 problems (0 errors, 51 warnings)` |
| Suíte em Node 22 | **362** arquivos, **4.710** testes, todos verdes (13,5 s) |
| `i18n-parity.mjs` | OK (avisos de ICU conhecidos) |
| `i18n-chaves-usadas.mjs` | OK — 3.847 literais conferidas, 153 dinâmicas, 3 arquivos em modo folha |
| `npm audit` | **12** vulnerabilidades: **1 crítica** (`next` ≤ 16.3.2, dependência direta), **4 altas** (`sharp`, `js-yaml`, `fast-uri`, `browserslist`), 6 moderadas, 1 baixa |

Qualquer número diferente destes numa fase posterior é daquela fase.

### Fase 1 — Segurança e dependências

**Origem:** #563 (`ffa583a`), #510 (`4368afb`), #506 (`ca87b5e`).

**Já medido:** `main` em `next 16.2.12`; upstream em `16.3.5` (dois avisos
críticos corrigidos na 16.3.3, segundo o commit), mais `vitest`, `sharp`,
`js-yaml`, `fast-uri`, `hono` e `@xyflow/react`. O commit deles toca SÓ
`package.json` e os dois lockfiles — **nenhuma linha de código**. O nosso
`package-lock.json` é idêntico ao da base; o `package.json` difere só em
`name`/`homepage`/`repository`/`bugs`/`engines`.

**Falta medir (passo 1):** `npm audit` antes e depois; o guia de upgrade da 16.3
em `node_modules/next/dist/docs/` (exigência do `AGENTS.md`); onde o fork usa
API sensível a versão: `src/middleware.ts`, `after()` nos webhooks,
`generateImageMetadata` (`apple-icon.tsx`), `manifest.ts`, `metadata` do layout.

**Implementação:** versões e `overrides` no `package.json`; os dois lockfiles do
upstream; prova de consistência com `npx npm@10.9.9 ci` (o `packageManager` do
projeto — lock regenerado com npm 11 diverge do CI). `supabase/setup-cli` v1→v3
no `pipeline.yml` em commit SEPARADO: quem valida é o job `migrations` do
próprio PR; vermelho, o commit sai.

**Lentes:** L1 — mudanças de comportamento 16.2→16.3 contra o nosso uso. L2 —
CI, `Dockerfile` (standalone, build-args), `.nvmrc`/`engines`/`packageManager`.

**Teste no preview:** build de produção local + dev. Roteiro: login → painel;
rota protegida sem sessão → `/login`; `/inbox` abre conversa e recebe realtime;
envio real ao lead de teste; POST assinado no webhook LOCAL da Evolution grava
a mensagem (prova o `after()`); cron local 401; `<head>` com manifesto e
`apple-touch-icon`; funil; Configurações; console sem erro novo.

**Pós-deploy:** site 200, cron 401, `entrega_recebida_em` avançando nas conexões.

**Reversão:** `git revert` do merge.

**Resultado (21/09/2026) — ✅ EM PRODUÇÃO.** PR #239 (branch
`chore/upstream-f1-seguranca-e-deps`), CI verde (o replay já com o `setup-cli`
v3), Codex sem achados no HEAD `a5924f5`, mesclado às 15:00Z (`9277c6f`).

*Pós-deploy (rollout convergiu às 15:08Z, na PRIMEIRA tentativa — a imagem
`node:22-alpine` com o Next 16.3.5 construiu)*

| Verificação em produção | Resultado |
| --- | --- |
| `/login` · rota protegida sem sessão · cron sem segredo | 200 · 307 → `/login` · **401** (segredos no lugar) |
| Manifesto e `<head>` | 200; manifesto e os três `apple-touch-icon` |
| Webhook da Evolution sem segredo | 401 |
| Ingestão com o 16.3.5 no ar (15:09Z → 15:22Z) | **31** mensagens gravadas (16 de cliente), **30** recibos aplicados, as **3** conexões medindo entrega — o `after()` dos webhooks funciona em produção |

P8 resolvida: as 4 não lidas da conversa aberta por engano foram devolvidas
(UPDATE de uma linha, cercado por `unread_count = 0` E pela mesma
`aguardando_desde` — ninguém tinha respondido ao cliente).

*Medição contra o nosso código*

| | Antes | Depois |
| --- | --- | --- |
| `npm audit` | 12 (1 crítica no `next`, 4 altas) | **0** |
| `npx npm@10.9.9 ci` | — | passa, 690 pacotes |
| `typecheck` | limpo | limpo |
| `lint` | 51 avisos, 0 erros | 58 avisos, 0 erros |
| Suíte em Node 22 | 362 / 4.710 | 362 / 4.710 (vitest 4.1.11) |
| `next build` | — | compila em 10 s |

Os 7 avisos novos são de UMA regra que a 16.3 estreou
(`no-location-assign-relative-destination`): apontam `window.location.href = '/…'`
em sete lugares — navegações de página INTEIRA deliberadas (saída de sessão,
convite aceito, porta de entrada). Não se mexe nelas aqui.

O build avisa duas obsolescências que NÃO mudam nada hoje: a convenção
`middleware` (renomeada para `proxy` desde a 16.0; o upstream também a mantém) e
o Edge Runtime (`src/app/icon.tsx`, arquivo do upstream).

*Revisão em duas lentes*

- **Lente 2 (CI, Docker, deploy): nenhum P0/P1; quatro P2.**
  1. ⚠️ **O `next dev` da 16.3 REESCREVE o `AGENTS.md` rastreado** quando detecta
     um agente de IA (log: "Generated AGENTS.md for AI agents"). Decisão:
     `agentRules: false` no `next.config.ts` e o arquivo restaurado — pacote não
     escreve no arquivo que o `CLAUDE.md` importa, e worktree com dev server não
     fica suja. Conferido: depois do reinício o log não repete a escrita.
     (Reversível em uma linha — decisão P7.)
  2. O lock do upstream não é ponto fixo do npm 10.9.9 com o NOSSO
     `package.json` (8 linhas: `name`, `engines` e 5 marcações `dev`). Já era
     assim antes; `npm ci` não é afetado e nenhum caminho usa `--omit=dev`.
     Fica como veio: normalizar faria todo merge futuro do lock conflitar.
  3. ⚠️ A imagem `node:22-alpine` com o Next 16.3.5 só é construída DEPOIS do
     merge (o job `deploy` só roda no `main`, e não há Docker nesta máquina). Se
     o build da imagem falhar, o rollout não acontece e a produção fica na
     imagem antiga — **conferir o job `deploy` logo após o merge**.
  4. `eslint-visitor-keys` (dev) pede Node ≥ 22.13; o `engines` diz 22.12. Só
     aviso de `EBADENGINE`, já existia — anotado, sem mudança.
- **Lente 1 (comportamento 16.2 → 16.3): nenhum P0.** Mediu os dois `dist/`, as
  duas documentações embarcadas e o config RESOLVIDO de dois builds deste app.
  1. ⚠️ **P1 a confirmar — cinco padrões do roteador viraram sem opt-in**
     (`validateRSCRequestHeaders`, `optimisticRouting`, `prefetchInlining`,
     `varyParams`, `appNewScrollHandler`), o React embutido do App Router saltou
     de canário, e o cache de segmentos foi reescrito. **O meu primeiro teste
     não alcançava isso: `next dev` não faz prefetch.** Confirmado depois num
     build de PRODUÇÃO local (tabela abaixo) — limpo.
  2. P1 só na máquina de dev: o `next build` passou a checar tipos com o `tsc`
     do projeto inteiro, **incluindo `.next/dev/types`** — o `.next` velho de
     outra branch agora reprova também o BUILD local, não só o `typecheck`. CI
     e Docker não têm `.next` e não sentem.
  3. P2: a validação de RSC acrescenta um salto a todo redirect do middleware
     (uma passada a mais do `getUser()` em sessão expirada). Com o Traefik é
     inofensivo; se um CDN voltar à frente, o 307 sai com `s-maxage=300` —
     desliga-se com `experimental.validateRSCRequestHeaders: false`.
  4. P2: `useRouter()` deixou de ser um objeto único (um por componente, com
     `bfcacheId`). Os 4 efeitos do app que dependem de `router` foram lidos:
     todos com guarda e idempotentes. Vale para efeito NOVO.
  5. P2: o cache de build do Turbopack virou padrão (227 MB em
     `.next/cache/turbopack` por build; no Docker é escrito e nunca lido).
  6. Limpos, com evidência: middleware (9 sondas de caminho idênticas nas duas
     versões), `after()` (fiação `waitUntil`/`onClose` igual; ficou mais
     robusto), route handlers (corpo de 300 KB atravessa o middleware até o
     HMAC), ícones (Edge Runtime é só `warnOnce`), `next.config.ts`, next-intl,
     e os binários `musl` no lock para a imagem Alpine.

*Teste prático 2 — build de PRODUÇÃO local (standalone, como no Docker: `node
server.js` na porta 3140, Next 16.3.5)*

| Roteiro | Resultado |
| --- | --- |
| `/login`, cron sem segredo | 200 · 401 |
| Sessão expirada: navegação RSC sem cookie | `/inbox?c=abc` → 2 redirects → 200 em `/login` — **sem laço** (na 16.2.12 era 1 redirect) |
| Link direto para a conversa do lead de teste | abre com 116 mensagens e compositor |
| **Menu inteiro por clique** (navegação do cliente, com prefetch) | os 15 destinos renderizam; console só com os 403 de foto expirada |
| **Funil → card do lead de teste → conversa → "Voltar ao funil"** | abre `?c=00cc34a4…&de=funil`; na volta a rolagem é a de antes: **378 × 4.234** |
| `/automations/<id>/edit` × `/automations/new` | cada uma abre a SUA tela (a rota estática vence a dinâmica com o roteamento otimista) |
| Voltar no celular (375 px), só com o lead de teste | `push` (33 → 34), `history.back()` → `/inbox` com a conversa fechada |

⚠️ **Armadilha do teste, que custou um falso alarme:** com o painel do
navegador OCULTO o `requestAnimationFrame` não dispara (medido: não rodou em
2 s), e a restauração da rolagem do funil depende de dois. A primeira passada
deu rolagem 0 e parecia regressão do manipulador de scroll novo; com o rAF
apoiado em timer, restaurou. **Conferência visual pendente do operador** (painel
visível): funil → conversa → "Voltar ao funil".

Não exercitado: o editor de fluxos (`@xyflow/react` 12.11.3) — a conta não tem
fluxo nenhum, e criar um seria escrita só para o teste. Fica coberto na Fase 4,
que cria um fluxo de teste.

*Teste prático no preview (dev server da worktree, Next 16.3.5, porta 3130)*

| Roteiro | Resultado |
| --- | --- |
| `/login` | 200 |
| `/inbox` sem sessão | 307 → `/login` (o middleware protege) |
| `/api/cb/scheduled/cron` sem segredo | 401 (env carregada) |
| `<head>` | manifesto, `icon` e os três `apple-touch-icon` |
| `/manifest.webmanifest`, `/icon`, `/apple-icon/{180,192,512}` | 200, `scope: /`, `start_url: /inbox` |
| Meu dia → Continuar → caixa de entrada | renderiza; conversa do lead de teste abre com 116 mensagens e compositor ativo |
| Voltar no celular (375 px): abrir conversa = `push`, `history.back()` | histórico 6 → 7; volta para `/inbox` com a conversa fechada |
| Funil, Contatos, Configurações | renderizam (596 negócios; 25 linhas) |
| Console | só os dois 403 de foto de perfil EXPIRADA do WhatsApp (`pps.whatsapp.net`), que já existiam |
| **`after()` do webhook da Evolution** | POST sem `Authorization` → 401; com o segredo → 200 em 679 ms; o log da API do Supabase mostra o `PATCH …message_id=eq.TESTE-F1-AFTER-20260921-1635` rodando DEPOIS da resposta, casando zero linhas |

⚠️ **Erro do teste, registrado:** o roteiro do celular clicou na primeira linha
da lista — a conversa de um cliente real — e abrir zerou as 4 não lidas dela
(o alerta "em atraso" seguiu aceso; nada foi enviado). Virou regra no passo 5 do
protocolo. A restauração do contador depende de OK do operador.

Fora do roteiro desta fase, de propósito: envio real de WhatsApp (exige OK do
operador na conversa).

### Fase 2 — Disparos: a função que nunca funcionou

**Origem:** #536 (`e9b6c74`, `a8023ec`) — e DOIS achados nossos que o upstream
não tem.

**Medido contra o nosso código (21/09/2026)**

| O que | Resultado |
| --- | --- |
| A função vigente na produção | UMA, a de **9 parâmetros** da nossa 0940, com `RETURNING id, contact_id` AMBÍGUO |
| Pela rota de verdade, no preview, contra a produção | `POST /api/v1/broadcasts` → **500** "Failed to create broadcast"; no log, `42702 column reference "contact_id" is ambiguous`. Nada gravado, nada enviado |
| Quem chama a função | SÓ `createBroadcast` (`broadcast-core.ts`), alcançado só por `POST /api/v1/broadcasts` (e pelo MCP, via HTTP). ⚠️ O "retomar" NÃO chama, e a tela de Disparos grava a campanha direto na tabela — `broadcasts` com 0 linhas quer dizer que ninguém usou Disparos, não que a tela falha |
| Postgres 16 local, função da 0940 | reproduz o 42702, inclusive com as listas VAZIAS |
| A `041` do upstream aplicada crua | deixa **2 funções** com o mesmo nome (o overload de 8 que a 0940 apagou) |

**Os dois achados da revisão em duas lentes (nenhum está no upstream)**

1. ⚠️⚠️ **Lente 1 — o conserto do upstream NÃO basta: os parâmetros por
   destinatário chegam em DUAS DIMENSÕES.** `p_template_params` era `JSONB[]` e
   o app manda `string[][]`. O PostgREST converte o corpo com
   `json_to_record(... AS _(p_template_params jsonb[]))`, e a lista de listas
   vira um array 2-D. Medido (com SÓ a qualificação do upstream aplicada, e as
   restrições REAIS da tabela): 2 destinatários × 2 params → a função EXECUTA e
   grava **4 linhas para 2 contatos** — o 2º contato com o parâmetro do 1º, duas
   linhas SEM contato — e a campanha fica commitada em `sending`, órfã (o app
   estoura logo depois, ao parear as linhas devolvidas); 1 param → grava
   `"Ana"` (texto) em vez de `["Ana"]`, e o "retomar" (`Array.isArray`)
   reenviaria SEM as variáveis; contagens diferentes → `malformed JSON array`
   (22P02). Era invisível enquanto o defeito 1 derrubava toda chamada.
   ⚠️ **Erro meu, pego pela 2ª passada da Lente 1:** a primeira medição dizia
   "23502, a campanha inteira falha" — o meu banco descartável declarava
   `contact_id NOT NULL`, que a 0004 tirou. O dublê imitava a forma SUPOSTA, e
   a verdade era pior. Virou nota no `CLAUDE.md` (regra 3).
2. ⚠️ **Lente 2 — `POST /api/v1/broadcasts` DESCARTAVA o `channel_id`**, que
   `docs/public-api.md`, `docs/mcp.md` e a ferramenta `send_broadcast` do
   mcp-server prometem. Invisível enquanto a rota devolvia 500; com a função
   consertada e dois números oficiais, a campanha sairia pelo número errado, sem
   erro. (E um teste com `channel_id` inválido "esperando 400" devolveria 202 e
   ENVIARIA o modelo.)

**Implementação**

- `1030_cb_funcao_de_disparo_executavel.sql`: apaga as duas formas antigas (a
  de 8 e a de 9 com `JSONB[]`), recria a de 9 com `p_template_params JSONB`,
  pareia contato × lista por **ORDINALIDADE**, qualifica o RETURNING,
  `REVOKE`/`GRANT`, `NOTIFY pgrst`. A conferência **CHAMA a função pelo caminho
  do PostgREST** na conta que tem MAIS contatos — com dois, leva listas de
  tamanhos DIFERENTES e prova o PAREAMENTO (o mutante `ON true` no lugar de
  `USING (ord)` reprova) — e desfaz a chamada num subbloco (banco vazio pula
  com NOTICE). O app não muda: chama por NOME, e o mesmo corpo é convertido para
  o tipo novo.
- `src/app/api/v1/broadcasts/route.ts`: o `channel_id` chega ao núcleo, que já
  falhava FECHADO (canal inválido = 400, nada enviado). Presente e inválido
  (número, lista, texto vazio) também é **400** — num envio em massa, "tratar
  como ausente" é a campanha saindo por um número que ninguém pediu. O 202 e o
  `GET /broadcasts/{id}` passam a dizer por QUAL número a campanha saiu.
- Pinos: `supabase/migrations/funcao-de-disparo-1030.test.ts` (lê TODO `.sql`,
  casa as quatro grafias de `CREATE FUNCTION`, cobra a forma final e proíbe
  outra assinatura fora das três históricas) e
  `src/app/api/v1/broadcasts/route.test.ts`. Os dois reprovam por MUTAÇÃO.
- `verify-schema.sql`: uma assinatura, a final, por `to_regprocedure` (mensagem
  honesta com 0, com 2 e com a assinatura errada — provado nos quatro estados).
- `CLAUDE.md`: a exceção da `041` do upstream (APAGADA, não renomeada), a regra
  3 do banco vazio (função plpgsql tem de ser CHAMADA, pelo caminho do
  PostgREST, lendo o resultado em OUTRA instrução) e duas linhas na tabela de
  divergências. `docs/public-api.md`, `docs/mcp.md` e `CHANGELOG.md` (com a **migration
  necessária**).

⚠️ **Erro meu, pego pelo teste local:** a primeira conferência lia o que a
função gravou com um `JOIN` na MESMA instrução — que não enxerga a linha recém-
inserida — e acusava a função certa. Virou regra no `CLAUDE.md`.

**Ordem desta fase (sugestão da Lente 2, adotada — é a lição da 1010):** PR em
rascunho → replay do CI VERDE no commit exato → aplicar a 1030 → teste prático
no preview → pronto para revisão → Codex → merge.

⚠️ **A janela entre aplicar a 1030 e o deploy** (achado das duas lentes): a
produção roda a rota ANTIGA contra a função NOVA. O endpoint passa a funcionar,
mas ainda ignora o `channel_id` — um id inválido devolveria 202 e enviaria pelo
único número oficial. Quem alcança isso é só a chave de teste desta fase (a
única ativa). Por isso: todo pedido do teste vai SÓ para `localhost`, e a chave
é revogada logo depois do teste, sem esperar o Codex nem o merge.

**Reversão:** `git revert` do merge; a 1030 FICA (a função antiga não
executava — não há para onde voltar). Com o revert a rota volta a descartar o
`channel_id`: revogar as chaves com `broadcasts:send`.

**Teste prático no preview:** canal inválido → 400 e nada sai; depois o disparo
de verdade (1 destinatário, o lead de teste, modelo aprovado sem variáveis, pelo
número oficial) → 202, campanha gravada COM `channel_id`, destinatário `sent`;
e a função chamada pelo PostgREST de verdade com 1 contato × 2 parâmetros →
gravado como lista. Limpeza: revogar a chave; a campanha do disparo real fica
rotulada "TESTE"; a campanha criada pela chamada direta ao PostgREST (que nasce
`sending` com destinatário `pending` e botão "Retomar" na tela) é APAGADA por
id na mesma hora.

**Resultado (21/09/2026) — ✅ validada na prática; ⚠️ um achado fora do escopo, levado à Fase 5**

| Passo | Resultado |
| --- | --- |
| Replay do CI no commit exato (`01eb764b`) | verde nas duas etapas |
| Colisão de número | nenhuma: histórico até a `1026` (sessão da Kommo); nenhum arquivo em `1027–1030` no `origin/main` nem na branch do #241 |
| Chaves de API ativas ANTES de aplicar (o pior caso da janela) | UMA no banco inteiro — a de teste desta fase |
| `1030` aplicada pela Management API | histórico **`20260921164342`**. Depois: UMA função, `(…,uuid[],jsonb,uuid)`, RETURNING qualificado e SEM o cru, `USING (ord)`, `SECURITY DEFINER`, EXECUTE só do `service_role`. A conferência CHAMOU a função no Postgres 17 da produção (a conta tem 2+ contatos → provou o pareamento lá) e não deixou nada: 0 linhas em `broadcasts` |
| Canal presente e INVÁLIDO (`42`, lista, `'   '`) | **400** `bad_request` ×3 |
| UUID inexistente · canal Evolution DA PRÓPRIA conta | **400** `meta_channel_required` ×2 |
| Depois das cinco recusas | 0 campanhas, 0 destinatários |
| Disparo REAL ao lead de teste (`lembrete_reuniao_kckkhz`, `pt_BR`, canal oficial pedido por escrito) | **202** — a primeira resposta de sucesso da história deste endpoint — com `channel_id`. No banco: campanha COM `channel_id`; destinatário = a ficha do lead (achada, não recriada); `template_params = []` como LISTA; `wamid` gravado e `sent_at` 16:45:32Z (a Meta ACEITOU). `GET /broadcasts/{id}` → 200 com `channel_id` e as contagens |
| Pelo PostgREST de verdade, 1 contato × 2 parâmetros | 200; gravado `["Ana","10h"]`, `Array.isArray` verdadeiro, contato certo; campanha apagada por id (1 linha), 0 destinatário sobrando |
| Chave de teste | REVOGADA logo depois do disparo, antes do Codex e do merge: o uso seguinte devolve 401, e o banco ficou com ZERO chaves ativas — até o deploy ninguém alcança a rota antiga da produção |

Todos os pedidos saíram de `localhost:3130`. O que ficou no banco: UMA campanha,
rotulada "TESTE Fase 2 — merge do upstream (disparo real ao lead de teste)".

⚠️⚠️ **O que o teste achou e NÃO é desta fase: a Meta ACEITOU e depois FALHOU a
entrega — e o motivo se perdeu.** Segundos depois do `sent`, o destinatário
virou `failed` (a campanha fechou `sent` com `failed_count = 1`): foi o status
`failed` da Meta chegando pelo webhook da PRODUÇÃO, que o espelha no
destinatário pelo `wamid` — o que, de quebra, provou o espelho e o gatilho de
contagem sobre uma campanha criada pela função nova. `error_message` ficou NULO:
`handleStatusUpdate` grava só o status e descarta o `errors[]`. É exatamente o
defeito da **Fase 5** (#535), agora com um caso real. O código desta mensagem
não é recuperável: o payload não é logado, e a Meta não tem consulta de status.

O que dá para afirmar, medido: o MESMO modelo foi ENTREGUE ao MESMO contato pelo
MESMO número em 12/09 22:07Z — seis minutos depois de o lead escrever, com a
janela de atendimento ABERTA. Hoje a janela está fechada (a última mensagem dele
ao número oficial é de 12/09) e o modelo é da categoria **Marketing**. Hipótese
mais provável, NÃO confirmada: os limites da própria Meta para marketing fora
da janela (a família dos códigos 131049 "engajamento saudável", 131050 "o
usuário parou o marketing desta empresa" e 130472 "número em experimento") —
falha assíncrona, decidida do lado de lá, que nenhum código nosso alcança. Não
dá para excluir outra causa (pagamento, 131042) sem o código.

**Revisão final NO LUGAR do Codex (21/09/2026).** O Codex respondeu "usage
limits" no HEAD — **não houve revisão dele neste PR**, e isso fica escrito. No
lugar, uma TERCEIRA leitura independente do diff inteiro (revisor sem o
enquadramento do autor, medindo num Postgres 16 descartável e por mutação):
**nenhum P0 nem P1**; 2 P2 e 6 P3.

| Achado | Destino |
| --- | --- |
| P2 — nenhum teste reprovava se o NÚCLEO voltasse a descartar o `channel_id` (o pino da rota mocka o núcleo inteiro: o mesmo defeito, um nível abaixo, passava 18/18) | ✅ 3 casos em `broadcast-core.test.ts`, com uma fake que CONFERE os filtros; o mutante reprova |
| P2 — `channel_id: null` sai pelo número escolhido, e a doc dizia 400 | ✅ decidido por escrito: `null` = AUSENTE (é o JSON de "sem valor", e o 202 diz qual número saiu). Doc e comentário da rota corrigidos |
| P3 — o filtro por CONTA de `resolveMetaChannel` não tinha pino (a fake devolvia a linha às cegas) — e ele é a única barreira entre contas, porque quem chama usa a service role | ✅ a fake confere os filtros; o mutante sem `.eq('account_id')` reprova |
| P3 — `resolveAuditUserId` (2 SELECTs) rodava ANTES da validação do canal | ✅ invertido, com pino |
| P3 — `verify-schema.sql`: o LIKE é literal, e a mensagem enganava quem reescrevesse a função de forma legítima | ✅ a mensagem diz as duas causas e o que fazer (provada num 5º estado) |
| P3 — doc: o 202 pode trazer `channel_id: null` (configuração legada); "account default first" era impreciso (um CONECTADO vence o padrão desconectado); o cabeçalho da rota não listava o campo; nada prendia o `channel_id` do `GET` | ✅ corrigidos; pino estrutural no `select` da rota de progresso |
| P3 — `resolveMetaChannel` descarta o `error` da busca por id (um timeout vira 400 "conecte um número", e quem integra não reenvia) e não confere `status` | ➡️ FORA deste PR — o resolvedor é compartilhado com as rotas de modelo; virou cartão próprio e, em 22/09, o item **3e** deste plano (confirmado no `main` naquele dia) |
| P3 — a função commita entradas que o app não manda (lista de contatos vazia ou com NULL) | aceito: inalcançável (o núcleo barra lista vazia e os ids vêm do banco) — guarda para cenário impossível contraria a regra da casa |
| P3 — o teto de 1000 destinatários é igual ao "Max rows" padrão do PostgREST | aceito e anotado: com o limite REDUZIDO no painel do Supabase, a RPC devolveria menos linhas do que gravou (os que sobram ficam `pending`; o "Retomar" os recupera) |

Os quatro pinos novos reprovam por MUTAÇÃO. A rota mudou só de ORDEM (validar o
canal antes de ir ao banco) — reconferida no preview pela sonda pós-deploy
apontada para `localhost`.

**Pós-deploy (21/09/2026) — ✅ conferido.** Merge `7ecb0efb` às 17:27Z; os
três jobs verdes, e o rollout deu certo na PRIMEIRA tentativa (a segunda nem
rodou), terminando às 17:33:41Z.

| Conferência | Antes do merge | Depois do deploy |
| --- | --- | --- |
| Sonda na PRODUÇÃO: `channel_id: 42` + destinatário inválido (nenhuma das duas rotas consegue enviar) | 400 "No recipients had a valid E.164…" — a rota ANTIGA ignorava o canal | **400 "'channel_id' must be a non-empty string…"** — a rota NOVA |
| `GET /api/v1/broadcasts/{id}` da campanha de teste | sem `channel_id` | **com `channel_id`** |
| Sem chave | 401 | 401 |
| Site / rota protegida | — | `login` 200 · `/inbox` 307 → `/login` |
| Crons (agendadas, automações, radar) | — | 401 nos três (503 seria env vazia) |
| Webhooks sem assinatura (Evolution e Meta) · API v1 sem chave · manifesto | — | 401 · 401 · 401 · 200 |
| Ingestão depois do rollout | — | 3 mensagens gravadas em ~3 min (1 de cliente, 2 da equipe já com recibo); as 5 conexões `connected`, atraso de entrega de segundos |
| Chaves de API ativas no banco | 0 | 0 (a sonda cria a dela em processo, por 20 min, e a revoga no `finally`) |

⚠️ **Dois registros de método desta fase:**
- A sonda que prova "a rota nova está no ar" foi desenhada para NÃO conseguir
  enviar nem contra a rota antiga (destinatário inválido) — provar deploy com um
  pedido que a versão velha executaria é como se manda mensagem por engano.
  Rodá-la ANTES do merge deu a linha de base que torna o "depois" uma prova.
- Logo depois do merge, o classificador de permissões da sessão negou até
  leitura anônima do site ("[Production Deploy]"), porque o operador tinha
  pedido "resumo e pausa" no meio do turno. Parei, relatei, e a conferência só
  rodou com a ordem explícita dele ("finalize tudo da fase 2"). Instrução nova
  no meio do turno muda o que está autorizado — inclusive o que já estava.

Ficou no banco, de propósito: UMA campanha rotulada "TESTE Fase 2 — merge do
upstream…" (`fc068dcf-…`, 1 destinatário `failed`) — é a evidência do achado da
entrega e o alvo da sonda. Apagar é decisão do operador.

**Consequência para o escritório, fora deste plano:** campanha de Marketing para
quem não escreveu nas últimas 24 h pode simplesmente não ser entregue — e hoje a
tela só diz "falhou". → Vira o teste prático da Fase 5: repetir ESTE disparo com
o motivo sendo gravado (um `failed` real, sem precisar simular).

### Fase 1b — Segurança depois do alvo (acrescentada em 23/09/2026)

**Por que existe.** Na remedição de 22/09 o original não tinha andado além de
`aee1b01f`, mas o mantenedor tinha **3 PRs de segurança ABERTOS** (não
mesclados lá, e posteriores ao alvo `80c3f9a`) — e os três valem aqui. Pedido
do operador em 23/09: seguir o plano inteiro, conferindo o que já tinha sido
corrigido desde a última medição.

**Conferido antes de mexer (23/09, `origin/main` = `f2a61293`):**

| Item | Situação | O que se fez |
| --- | --- | --- |
| #597 — link de "esqueci a senha" | ✅ JÁ CORRIGIDO pelo nosso #254 (22/09): `curl -sI https://crm.cbadvogados.com/auth/callback` → `location: https://crm.cbadvogados.com/forgot-password?erro=link` (em 22/09 era `https://0.0.0.0:3000/…`) | nada; o resto do #597 (`token_hash`/`otp_expired`, cadastro pelo callback) não se aplica — o cadastro público foi FECHADO pelo #258 |
| Cadastro público aberto (amplificava os três) | ✅ FECHADO pelo #258 (22/09, `disable_signup`) | nada; os 4 logins avulsos que já existiam seguem podendo explorar — por isso a fase continua |
| #588 — SSRF por IPv6 mapeado/6to4/NAT64 | ❌ presente (`ssrf.ts` byte-idêntico ao do original) | cherry-pick `-x` |
| Download da mídia do Instagram sem guarda (achado NOSSO de 22/09) | ❌ presente | `baixarUrlPublica` |
| #587 — rotas de automação pelo AUTOR (= achado #234 da auditoria de 22/09) | ❌ presente na medição; ✅ corrigido pelo #260 (outra sessão) no meio da fase | só o que o #260 não tinha (ver abaixo) |
| #589 (1) — conversa do contexto sem conferência de conta | ❌ presente | port à mão |
| #589 (2)/(3) — ciclo de vida dos modelos só para admin | ✅ já nosso desde 26/08 (`barrarPorPapel`) | nada |

**O que entrou (PR da Fase 1b):**

- **#588** (cherry-pick `2f5b8156`): a guarda classifica por OCTETOS e falha
  fechada. Medido antes: o único destino real que passa por ela na produção é
  um `send_webhook` de automação DESLIGADA, sem URL; nenhum webhook de saída,
  nenhum fluxo com URL — a guarda mais rígida não bloqueia nada que funciona.
- **Instagram** (`src/lib/instagram/midia.ts`): a URL do anexo vem do corpo do
  webhook, que a própria conexão assina; baixada crua, era SSRF com LEITURA
  (a resposta ia para o bucket público). Agora: só `https`, cada salto por
  `isDeliverableUrl`, redirecionamento seguido à mão (até 3). O redirecionamento
  NÃO foi desligado: não foi medido se o CDN da Meta redireciona.
- **#587** (`api/automations/[id]` e `duplicate`): ⚠️ **o conserto em si
  entrou por OUTRA sessão enquanto esta fase era feita** — o PR #260
  ("correções da auditoria", mesclado em 23/09 de manhã) resolveu o achado
  #234 com a mesma forma do #587 (conta, não autor; GET por qualquer membro,
  escrita por `requireRole('admin')`; DELETE conferindo linhas; e, de quebra,
  a duplicata copiando o "Assinar como"). O port desta fase tinha sido escrito
  em paralelo; no rebase ficou a versão do #260 (já em produção) e esta fase
  acrescentou por cima só o que faltava: o UPDATE do PATCH com a conta e as
  linhas conferidas (apagada entre a leitura e a escrita: 404, sem regravar
  passos), o comentário que ainda dizia `agent`, e pinos no teste do #260 —
  o mock dele recusava o `agent` SEM olhar o piso pedido, então um merge que
  trouxesse o `requireRole('agent')` do original passava verde.
- **#589 (1)**: `dispararAutomacoes` e `resolveConversationId` conferem a
  conversa por conta, e os QUATRO envios do robô chamam
  `assertConversationInAccount` antes do provedor (arquivo do original,
  idêntico); as prévias ganharam `.eq('account_id')`.

**Verificação local:** `typecheck` limpo; suíte **377 arquivos / 4.924
testes**; lint `✖ 59 problems (0 errors, 59 warnings)` — nenhum aviso novo nos
arquivos da fase (o único ali, `_init` em `engine.test.ts`, já existe no
`main`); portões de i18n OK. **Mutação:** 22 mutantes, todos reprovam (5 no
Instagram, 7 nas rotas, 10 no #589). Um deles (o teto de saltos) só reprovava
travando o processo — o teste foi refeito para reprovar limpo.

**Teste prático (23/09, preview `localhost:3130`, sessão do operador):**

| Caso | Resultado |
| --- | --- |
| `GET` de automação existente / de id inexistente | 200 / 404 |
| `DELETE` e `PATCH` de id inexistente | **404** (antes: `ok`) |
| Duplicar automação inativa → renomear a cópia → apagar → ler → apagar de novo | 201 (cópia inativa) → 200 → 200 → 404 → 404; banco conferido depois: 17 automações, 0 cópias, 0 passos órfãos |
| `POST /api/automations/engine` com conversa de OUTRA conta (gatilho sem automação ativa na conta — nada rodaria mesmo se a guarda falhasse) | log: `conversation not in account, refusing dispatch` |
| O mesmo com a conversa do lead de teste | segue, sem recusa |
| Guarda de SSRF contra a rede REAL | recusa `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`, NAT64, 6to4, `127.1`, `2130706433`, `0x7f.0.0.1`; aceita o CRM, `lookaside.fbsbx.com`, `graph.instagram.com`, `api.calendly.com` |
| `baixarUrlPublica` contra a rede REAL | manifesto 200; `/inbox` (307 → `/login`) seguido à mão até 200 — prova que o `fetch` do Node devolve o `Location` em `redirect: 'manual'`; `http:`, `127.0.0.1` e `localhost` recusados |

Não testável ao vivo: o admin NÃO autor (não há sessão de outro membro no
preview — coberto pelo teste com banco falso que aplica os filtros) e a DM do
Instagram (nenhuma conexão Instagram na produção).

**Revisão em duas lentes (23/09):** nenhum P0/P1. A Lente 1 mediu o que
mais importava: o `fetch` do Node 22/24 devolve o 3xx com `Location` legível
em `redirect: 'manual'` (resposta `basic`, não opaca) — a mídia que redireciona
é seguida; e todas as formas estranhas de endereço interno (decimal, octal,
hex, `127.1`, `0`) chegam à guarda já canonizadas pelo `URL` e são recusadas.

| Achado | Destino |
| --- | --- |
| P2 (as duas lentes) — o piso `admin` das rotas de automação sem pino: o mock de `requireRole` ignorava o argumento, e o #587 do original escreve `agent` nas MESMAS linhas | ✅ o teste cobra `requireRole('admin')` nas três escritas e `getCurrentAccount` no GET (mutante `'agent'` reprova) |
| P2 — o download do Instagram lia o corpo inteiro para a memória antes do teto (o webhook não traz tamanho): DoS com URL pública gigante, no processo de todas as contas | ✅ `lerComTeto` (`content-length` acima recusa sem ler; sem ele, conta durante a leitura) |
| P3 — prazo POR salto (até 80 s) e corpo do 3xx não descartado | ✅ um prazo para a cadeia; `body.cancel()` antes do próximo salto |
| P3 — o teste da retomada sem controle positivo | ✅ par com a conversa da própria conta (envia) e o detalhe da falha conferido |
| P3 — nenhum pino obriga um envio NOVO do robô a conferir a conversa | ✅ `conversation-scope.chamadores.test.ts` (estrutural, nos dois arquivos de envio) |
| P3 — comentários ainda diziam `agent` ao lado de `requireRole('admin')` | ✅ reescritos |
| P3 — DELETE de automação já apagada (lista aberta em duas telas) dava 404 e o cartão fantasma ficava | ✅ a tela fecha o diálogo e recarrega no 404 |
| P3 — o comentário de `ResultadoDoDisparo.erro` não citava a conversa | ✅ |
| P3 — o CLAUDE.md não registrava a guarda do Instagram nem o piso nosso das rotas | ✅ seção do Instagram + duas linhas na tabela do que é nosso |
| P3 — NAT64 (`64:ff9b::/32`) bloqueado inteiro; faixas IPv6 especiais (`fec0::/10`, `3fff::/20`, `::ffff:0:0:0/96`) passam — medido que não alcançam o loopback | aceito e escrito: a guarda fica IDÊNTICA à do original (divergir é conflito no merge); a VPS tem IPv4 |
| P3 — o GET é de qualquer membro: um atendente abre o construtor e só descobre no "Salvar" que não pode (403) | aceito: não é vazamento (os passos já são legíveis por membro pela RLS); construtor somente-leitura para quem não administra fica como melhoria de TELA, fora desta fase |
| P3 — "Duplicar" ignora o erro da leitura dos passos (cópia vazia com 201) e não copia o "Assinar como" | o "Assinar como" foi corrigido pelo #260; o erro dos passos ignorado é PRÉ-EXISTENTE e fica anotado no diário como follow-up |
| P3 — soluço do banco na conferência nova vira `falhou` (não reprocessável) no Calendly/webhook de entrada | pré-existente (a mesma semântica da conferência do contato); o comentário foi corrigido, a regra fica |
| **Codex no HEAD `70e77961`** (cota voltou): P2 — PATCH só com os PASSOS pulava o UPDATE e, com ele, a conferência de linhas; apagada no meio, `replaceSteps` respondia 200 com lista vazia (ou 500 pela chave estrangeira) | ✅ o PATCH só de passos também toca a linha (`updated_at`, que o gatilho `set_updated_at` regrava) — 2 casos no teste, mutante reprova |
| **Codex, 2ª rodada (HEAD `c2b43689`)**: P2 — ainda sobrava o DELETE concorrente ENTRE o UPDATE e a troca dos passos (lista vazia → 200; cheia → 500 pela chave estrangeira) | ✅ releitura por conta DEPOIS de `replaceSteps`: sumiu = 404 (3 casos, mutante reprova). Fechar de vez pediria transação (RPC + migration) para dois admins editando e apagando a mesma automação no mesmo segundo — não compensa, aceito por escrito |
| **Codex, 3ª rodada (HEAD `c51aeb36`)**: P2 — a conferência da conversa olhava só a CONTA: "contato A + conversa de B" da mesma conta passava, e o cliente A recebia o que aparece no fio de B | ✅ com contato, a conversa tem de ser DELE também — no disparo, em `resolveConversationId` e nos 4 envios (`conversation-scope.ts` passa a divergir do original; linha no CLAUDE.md). Conferido antes que todo caminho legítimo (webhook, Evolution, Calendly, régua, webhooks de entrada, execução manual, `send_to_number`) já passa a conversa do próprio contato. 3 mutantes reprovam |
| **Codex, 4ª rodada (HEAD `caf9808e`)** | nenhum achado |

**Resultado (23/09/2026):** PR #261 mesclado às 13:45Z (merge `09efcfa6`),
rollout na primeira tentativa (as três etapas do `pipeline.yml` verdes).
**Pós-deploy, só leituras anônimas da produção:** login 200; `/inbox` 307 →
login; os crons, a API v1 sem chave e os webhooks da Evolution e da Meta sem
credencial, 401; `GET`/`PATCH` de automação e `POST /api/automations/engine`
sem sessão, 401; o webhook do Instagram responde 200 a um corpo sem `object`
(é o desenho: só assinatura que não casa vale 401); `/auth/callback` sem
código → `forgot-password?erro=link`. Ingestão conferida no banco depois do
rollout: as quatro conexões da Evolution gravando mensagem nos minutos
seguintes (74 nos últimos 30 min). **FASE 1b FECHADA.**

### Fase 3 — Correções pequenas e independentes

**3a. Importação de CSV (#529, `a0e804b`).** Medido: o nosso `dedupeByPhone`
conta telefone inválido como DUPLICATA (`dedupe.ts:146`) e o modal só diz "N
falharam", sem motivo. Chamadores: `import-modal.tsx` e `lib/broadcast-csv.ts`
(a forma de retorno ganha `invalid` — aditivo). `import-modal.tsx` mescla em
silêncio nos dois lados: conferir que a nossa régua (`chaveDeTag` na prévia, dono
durável) sobrevive. 6 chaves novas. Teste: CSV com linha válida, duplicada, sem
telefone e telefone inválido → contadores certos e o motivo por linha; limpar
os contatos criados.

**3b. Texto do nó em várias linhas (#559, `7f42918`).** 1 linha em
`node-config-form.tsx` (idêntico à base no nosso lado). Teste: abrir o editor.

**3c. Vários App Secrets (#500, `a4eb921`).** `webhook-signature.ts` idêntico à
base. Falha FECHADA preservada (vazio ou só vírgulas = recusa). Conflito só no
`.env.local.example`. `docs/multi-waba.md` entra adaptado (sem o nome do produto
original) e indexado em `docs/README.md`. Teste: POST assinado no webhook LOCAL
da Meta com o segredo certo (200), errado (401) e com `A,B` no env (os dois
passam). A assinatura do Instagram é outra e não é tocada.

**3d. Tags da v1 (#560, `77d403b`) — só medir.** Já corrigimos em 09/09
(`set-contact-tags.test.ts`). Medição: rodar os testes de regressão DELES contra
a NOSSA implementação; adotar os que acrescentam cobertura; o código fica o nosso.

**3e. O resolvedor do canal Meta — erro de banco não é "sem canal"** (achado
NOSSO, sem PR do upstream: dois P3 da revisão final do #242, deixados de fora
daquele PR porque o resolvedor é compartilhado com as rotas de modelo; era o
cartão `task_6706439b`). **Confirmado em 22/09/2026 no `origin/main`
(`ba5612ef`)**, em `src/lib/cb-channels/resolve-meta.ts`:

- **Busca por id (`:72-79`): o `error` é DESCARTADO.** Um tempo esgotado ou erro
  do PostgREST vira `null`, e o chamador responde 400 "conecte um número em
  Configurações" — e quem integra pela API não reenvia. É a regra da casa "erro
  de banco NÃO é não-encontrado" (o caso `getContactById`, seção da API pública
  do `CLAUDE.md`). ⚠️ `channel_id` com UUID MALFORMADO gera 22P02 no Postgres e
  hoje cai no mesmo ramo — esse caso TEM de continuar 400 (canal inválido):
  validar o formato ANTES (na rota ou no resolvedor) e tratar o resto como erro
  de verdade (500).
- **O mesmo descarte na LISTA e no espelho legado:** `:92` (`if (!error &&
  data)`) cai em silêncio para o `whatsapp_config` quando a lista falha, e a
  consulta do espelho (`:100-104`) também joga o `error` fora. Decidir e
  escrever o porquê.
- **Busca por id não confere o `status`** (`:79` só pergunta `utilizavel`): um
  canal Meta DESCONECTADO que ainda tem credenciais é aceito, e o disparo falha
  destinatário por destinatário. Não sai pelo número errado, mas a resposta
  poderia ser um erro claro ANTES de criar a campanha. (A busca SEM id já
  prefere `connected`, `:94`.) Decidir — recusar com motivo claro × manter — e
  escrever o porquê.

**Chamadores (7, em 6 arquivos) — hoje TODOS traduzem `null` em 400:**

| Chamador | De onde vem o canal | `null` vira |
| --- | --- | --- |
| `lib/whatsapp/broadcast-core.ts:125` (API v1 de disparos) | `channel_id` do corpo (validado na rota) | `BroadcastError('meta_channel_required', 400)` |
| `lib/whatsapp/broadcast-resume.ts:217` ("Retomar") | `broadcasts.channel_id` (NULL = campanha anterior à 903 → cai no padrão) | `BroadcastError('whatsapp_not_configured', 400)` |
| `app/api/whatsapp/broadcast/route.ts:134` (disparo pela tela) | `channel_id` do corpo, CRU | 400 "Broadcasts require an official Meta…" |
| `app/api/whatsapp/templates/submit/route.ts:171` | canal pedido | 400 "WhatsApp not configured…" |
| `app/api/whatsapp/templates/sync/route.ts:146` | `?channel_id=` | 400 "WhatsApp not configured…" |
| `app/api/whatsapp/templates/[id]/route.ts:152` (PATCH) | `channel_id` do próprio modelo | 400 |
| `app/api/whatsapp/templates/[id]/route.ts:299` (DELETE) | idem | 400 (também sem `wabaId`) |

Nenhum trata exceção vinda do resolvedor: mudar o contrato (lançar, ou devolver
um resultado com o motivo) exige ajustar os SETE na mesma passada e conferir o
`catch` de cada rota — não mudar o contrato sem isso.

**Verificação:** testes que reprovem por MUTAÇÃO (a fake de
`resolve-meta.test.ts` confere os filtros desde o #242 — os mutantes a provar:
erro engolido na busca por id, erro engolido na lista, UUID malformado virando
500, e o `status`, conforme a decisão); `typecheck`, `lint` (ler `✖ N
problems`), suíte em Node 22. Se o contrato de erro da API pública mudar (500
onde era 400, ou código novo), atualizar `docs/public-api.md` — e o `docs/mcp.md`
se a ferramenta `send_broadcast` descrever o erro. **Teste no preview:** o 500 de
erro de banco se prova no unitário (não se derruba o banco da produção);
no preview, pela API com chave de teste criada e revogada na hora: `channel_id`
malformado → 400; canal Meta desconectado → a resposta decidida, sem campanha
criada; caminho feliz → 202 (a sonda `f2-pos-deploy.mjs` da Fase 2 não envia
nada e serve de base). ⚠️ Toca `broadcast-core.ts`, que a metade aproveitável
do #586 (P9) também toca — se os dois entrarem na mesma fase, um PR só.

**Como a fase foi dividida (23/09/2026).** Com a P9 resolvida na retomada — o
`+` obrigatório do #586 NÃO entra (o escritório digita sem `+` e a nossa
`digitosDoTelefone` completa o 55 de propósito); entra a metade ADITIVA dele,
com a NOSSA régua —, a 3a deixou de ser pequena: ela passa a incluir a
normalização do telefone DIGITADO nas telas e na API. Para cada PR ter um raio
pequeno, a fase virou quatro, cada uma com revisão em duas lentes, preview,
Codex e deploy próprios:

| Sub-fase | O que entra | Estado |
| --- | --- | --- |
| **3-I** | 3b, 3c, 3d (só medir) e 3e — nada toca telefone | ✅ PR #262 |
| **3-II** | 3a (#529) + a metade aditiva do #586 NAS TELAS: formulário e ficha do contato, importação de CSV, CSV do disparo — telefone digitado sai normalizado pela nossa régua, e o inválido é CONTADO com motivo, nunca chamado de duplicata | ✅ PR #265 (23/09) |
| **3-III** | a mesma normalização na ENTRADA da API (v1 de contatos, mensagens e disparos) e em `/api/cb/conversas/abrir`, com `docs/public-api.md` — e, a pedido do operador, o webhook de entrada (Typebot) e o passo "Enviar para um número" | ✅ PR #276 (23/09); o passo "Enviar para um número" no ✅ PR #282 (23/09, merge `d7e597fd`, rollout 23:53Z; saúde, ingestão e o único passo de aviso conferidos) |
| **3-IV** | 3f — a CONTAGEM do público do disparo (#594) truncando em 1000 (o envio já pagina) | ✅ PR #269 (23/09; ver o resultado abaixo) |

**Resultado da 3-I (23/09/2026, PR #262):**

- **3b** (cherry-pick `7f42918`): o campo "Texto enviado ao cliente" do nó
  *Enviar mensagem* virou `textarea` de 3 linhas.
- **3c** (cherry-pick `a4eb921`): `META_APP_SECRET` aceita vários segredos
  separados por vírgula, cada um conferido em tempo constante; vazio ou só
  vírgulas continua recusando tudo. Só o webhook da Meta lê a variável (o do
  Instagram tem segredo próprio por conexão). `docs/multi-waba.md` foi
  REESCRITO em português para a nossa realidade (a conexão nasce em
  *Configurações → Conexões*; a tela legada que o original descreve não é
  montada aqui) e indexado no `docs/README.md`.
- **3d**: os 3 testes de regressão de tags do original passam contra o NOSSO
  `contacts.ts` (o 4º, de `serializeContact`, falha pela divergência esperada
  dos campos `instagram_*`) — fechado sem mudança; `set-contact-tags.test.ts`
  já cobre o caso.
- **3e**: o resolvedor LANÇA `ErroAoLerCanalMeta` quando a leitura falha — na
  busca por id, na lista (que antes caía em silêncio no espelho legado) e no
  próprio espelho — e os 7 chamadores já tinham `catch` que responde 500 (na
  v1, `internal`, sem o texto do banco). Id malformado (toda a classe `22` do
  Postgres) continua `null` → 400. **O `status` do canal pedido continua NÃO
  conferido, e a decisão foi escrita:** a sonda de saúde grava `disconnected` a
  qualquer erro da Meta — e só com um administrador com a tela aberta —, então
  recusar por ele barraria disparo sobre um canal que funciona.

**Verificação:** `typecheck` limpo; lint sem aviso novo nos arquivos da fase;
suíte em Node 22 verde; portões de i18n OK. **Mutação:** os pinos do 3e
reprovam os mutantes (erro engolido na busca por id, na lista e no espelho;
classe 22 virando 500; texto do banco na mensagem).

**Teste prático (preview `localhost:3130`, `next dev` com um `META_APP_SECRET`
de TESTE — dois segredos fictícios):**

| Caso | Resultado |
| --- | --- |
| Webhook da Meta LOCAL, corpo vazio assinado com o 1º segredo / com o 2º | 200 / 200 |
| Assinado com segredo errado / com a lista inteira como segredo / sem assinatura | 401 / 401 / 401 |
| 3b: fluxo rascunho "TESTE Fase 3b — apagar" (201), nó *Enviar mensagem* adicionado sem salvar | o campo é `textarea` de 3 linhas; fluxo apagado (200 → 404); banco: 0 fluxos de teste, 0 nós órfãos |
| 3e: sincronizar modelos com `channel_id` malformado / inexistente | 400 / 400, nada chamado na Meta |

O 500 por erro de banco se prova no unitário — não se derruba o banco da
produção para vê-lo.

**Revisão em duas lentes:** nenhum P0/P1.

| Achado | Destino |
| --- | --- |
| P2 (Lente 2, MEDIDO em bash) — `META_APP_SECRET=a, b` no `crm.env`, que o shell carrega com `set -a; .`, faz a variável SUMIR: o espaço termina a atribuição e todo webhook da Meta vira 401 | ✅ a doc manda escrever a lista SEM espaço e conferir com `printenv` dentro do contêiner (`.env.local.example`, `docs/multi-waba.md`, `CLAUDE.md`) |
| P2 (Lente 1) — o segredo não é amarrado ao número: um app da lista pode assinar entrega que diz ser de qualquer número | ✅ aviso escrito: só apps de confiança; a produção tem um app só |
| P3 — o motivo escrito para não conferir o `status` era FALSO | ✅ motivo corrigido (a sonda grava `disconnected` a qualquer erro); a decisão ficou |
| P3 — o texto do PostgREST chegava ao aviso na tela das rotas de modelo | ✅ mensagem genérica; o detalhe vai para o log |
| P3 — só `22P02` virava 400 | ✅ toda a classe `22` |
| P3 — "setup C" sem referência; CHANGELOG; lista de docs entregues no `CLAUDE.md`; item 10 do `multicanal-plano.md`; `META_APP_ID` descrito como se fosse medido | ✅ |
| Aceitos por escrito | as rotas de disparo e de retomada mostram "Internal server error" no lugar de "conecte um número" (mais honesto); na v1 o 500 é o contrato de erro interno |
| **Codex no HEAD `e583b291`** | nenhum achado |

**Pós-deploy (23/09/2026):** PR #262 mesclado às 14:00Z (merge `c063629e`;
a branch foi rebaseada sobre o `main` com a 1b e o Codex revisou de novo o
HEAD `961a39a8`: limpo), rollout na primeira tentativa. Leituras anônimas: o
webhook da Meta sem assinatura continua 401, crons 401, login 200; ingestão
das quatro conexões da Evolution viva depois do rollout. ⚠️ A prova com uma
entrega ASSINADA de verdade (o segredo da produção passando pelo
`parseAppSecrets`) depende do próximo evento do número oficial — conferir no
banco que ele continua gravando mensagem/status depois de 14:00Z.

**Resultado da 3-II (23/09/2026, telefone digitado nas telas + #529):**

- **A régua** (`src/lib/contacts/telefone.ts`, puros): `telefoneDigitado` usa
  `digitosDoTelefone` (brasileiro sem DDI ganha o 55, como sempre) e recusa,
  com o MOTIVO, o que ele deixaria passar: sem `+` e sem DDD (`curto` —
  "98874-5316" sairia para +98), letra no meio, 0 de tronco, DDI 55 com
  tamanho errado e mais de 15 dígitos (`invalido`). Antes, limpa as marcas
  invisíveis que o WhatsApp põe num número copiado, o traço tipográfico e o
  `.0` de planilha salva como decimal. `escritaDoTelefone` é a decisão ÚNICA
  das duas telas: na edição, telefone que não mudou não é conferido nem
  regravado; na criação, tudo passa; a ficha só do Instagram pode ficar sem
  (`null`).
- **Telas:** o formulário e a ficha do contato gravam o número normalizado, e
  o aviso de duplicata do formulário procura pelo número normalizado (o
  "81988745316" sem o 55 passa a BLOQUEAR como a ficha que já existe, em vez
  do aviso amarelo). A ficha deixou de estourar no `.trim()` do telefone nulo
  da ficha só do Instagram.
- **Planilhas (#529 adotado):** o dedupe conta o inválido À PARTE e a linha
  única sai normalizada — o CSV do disparo agora ACHA a ficha do cliente em
  vez de criar outra com +81; o parser mantém a linha sem telefone para ela ser
  contada (e pula a linha só de vírgulas); a importação mostra o motivo de cada
  linha que o banco recusou; o passo 2 do disparo avisa quantas ficaram de fora
  e o arquivo sem nenhum telefone válido deixa de dizer "não foi possível ler".
- **Pino** (`telefone-digitado.chamadores.test.ts`): uma chamada da régua por
  tela e nenhum `parseInternationalPhone` nas seis — o merge do original traz
  o `+` obrigatório para essas mesmas linhas.

**Medido antes, na produção:** 5.138 das 5.157 fichas já são dígitos com o
55; 1 com `+`; 17 estrangeiras só em dígitos, todas com 12 dígitos ou mais
(ZERO seriam relidas como brasileiras); 0 com `.0`.

**Verificação:** `typecheck` limpo; lint `✖ 59 problems (0 errors, 59
warnings)` = base; suíte em Node 22 **381 arquivos / 5.020 testes**; portões de
i18n OK (os 5 avisos de ICU são antigos). **Mutação:** 26 mutantes, todos
reprovam — um escapou na primeira rodada (o formulário tinha a régua em dois
lugares e o pino só procurava a presença), e a decisão foi para o helper único.

**Teste prático (preview `localhost:3130`, sessão do operador; números
fictícios `55 99 90000-000x`, conferidos inexistentes antes):**

| Caso | Resultado |
| --- | --- |
| Formulário: `90000-0001` / `99 90000 ramal 1` | "Faltou o DDD…" / "Telefone inválido…"; nada gravado |
| Formulário: `(99) 90000-0001` | gravado `5599900000001`, nome fixado, dono da conta |
| Formulário: `99900000001` de novo | bloqueado como duplicata; continua UMA ficha |
| Ficha: `90000-0002` / `+55 (99) 90000-0002` | recusado / gravado `5599900000002` |
| Ficha: só o nome | o corpo do PATCH não leva `phone` (conferido interceptando a requisição) |
| Importação: válida, repetida, sem telefone, sem DDD, com letra, já existente | 1 importada (normalizada, dono da conta), 2 ignoradas, 3 "sem telefone válido", com a dica da régua |
| CSV do disparo (só até o passo 2): as duas grafias do mesmo número + vazio + sem DDD | 1 contato, "2 linhas ficaram de fora"; só inválidos → a mensagem nova |
| CSV do disparo, depois das revisões: número colado com marcas invisíveis, `.0`, traço tipográfico, linhas `,`/`,,` | 3 contatos, nenhum aviso de linha perdida |
| Limpeza | as 2 fichas de teste apagadas; 0 disparos, 0 conversas, 0 negócios criados |

Não testável ao vivo: a linha que o BANCO recusa na importação (o motivo por
linha) — não há como provocar a recusa sem mexer em policy; o ramo é o do
#529, lido no código.

**Revisão em duas lentes:** nenhum P0/P1.

| Achado | Destino |
| --- | --- |
| P2 (AS DUAS, medido) — número copiado do WhatsApp traz U+202A/U+202C, e traço tipográfico: a régua os recusava como "inválido" sem nada visível errado; antes, o texto cru era gravado e funcionava | ✅ limpos antes da régua (`\p{Cf}` e o intervalo de traços), com 6 casos no teste |
| P2 (Lente 1, medido) — planilha salva pelo pandas escreve `81988745316.0`, e o zero virava dígito: +81 | ✅ o `.0` final da forma "dígitos.0" é cortado |
| P2 (Lente 1) — estrangeiro guardado só em dígitos com 10, ou 11 com 9 na 3ª posição, editado ou importado sem `+`, é relido como brasileiro | aceito por escrito: MEDIDO zero fichas assim (as 17 estrangeiras têm 12+ dígitos) |
| P2 (Lente 2, a medir) — ficha antiga gravada crua SEM o 55 deixaria de ser achada | MEDIDO: 1 ficha de 10/11 dígitos, e é dos EUA (`1` + DDD americano), não brasileira sem 55 — zero casos |
| P3 — linha só de vírgulas (fim de exportação do Excel) contava como "telefone inválido" | ✅ o parser a pula |
| P3 — vermelho da falha ilegível no escuro (`red-700` = 2,92) | ✅ `red-600`, MEDIDO no app: 4,77 claro / 3,94 escuro — o melhor dos dois modos (o `amber-700` já era o melhor âmbar) |
| P3 — o pino não cobria as planilhas nem o aviso de duplicata | ✅ estendido |
| P3 — "telefone inválido" também contava os vazios; `errorCsvParse` órfã | ✅ "sem telefone válido"; a chave saiu dos dois dicionários |
| P3 — comentários imprecisos (o motivo do `null`; o piso de 8) e o placeholder pt-BR | ✅ |
| P3 — a nota do `CLAUDE.md` dava a entender que TODO telefone digitado já passa pela régua | ✅ diz que a "Nova conversa" e a API v1 são a 3-III |
| P3 — número americano de 10 dígitos sem `+` vira DDD 40, que não existe | aceito: a dica manda escrever número de fora com `+`; validar DDD seria regra nova sem caso medido |
| Anotado para a Fase 10 | `toastImported`/`importBtn` usam chaves `_plural` que o next-intl não lê — "Importar 6 contato" no singular (defeito antigo, visto no teste) |
| **Codex, 1ª rodada (HEAD `5b4bb2b9`)**: P2 — "019 3456-7890" (DDD terminado em 9 + fixo, com o 0 de tronco) tem 11 dígitos com 9 na 3ª posição, ganhava o 55, e o 0 ficava escondido no meio (`5501934567890`) — a régua o aceitava | ✅ o 0 de tronco é conferido no que foi ESCRITO, antes de normalizar; 3 casos no teste, mutante reprova |
| **Codex, 2ª rodada (HEAD `ce17e04c`)**: P2 — o 0 de tronco DEPOIS do 55 escrito ("+55 011 3456-7890") dá 13 dígitos e passava pela régua de tamanho | ✅ `digitos` começando em `550` é recusado (nenhum DDD começa em 0); 5 casos (com `+`, com `00`, sem nada, e o número certo com o mesmo DDD passando), 2 mutantes reprovam |
| **Conflito com o `main` depois do #259** (o merge cru do upstream, mesclado por outra pessoa em 23/09) | ✅ resolvido pela P9. Três conflitos textuais (o parser de CSV e os dois dicionários: fica a nossa régua e o nosso `csvInvalidPhones`; entram as duas chaves novas do upstream). E um conflito SEM marca: o `contact-form.tsx` se mesclou sozinho com a checagem do `+` do upstream DEPOIS da nossa — a ficha nova com "(11) 99999-9999" seria recusada de novo. O pino `telefone-digitado.chamadores.test.ts` reprovava a mescla (medido com mutante); a checagem e a chave `phoneNeedsCountryCode` saíram |
| **Auditoria do #259** (10 agentes, 23/09): o merge deixou **4 chaves REPETIDAS** em `Contacts.importModal` — o #259 pôs as do #529/#586 no fim do objeto, o #265 as suas no meio, o Git juntou sem conflito e o `JSON.parse` ficava com as do #259 ("3 telefone inválido", sem o plural ICU). Os três portões de i18n usam `JSON.parse` e passaram verdes | ✅ o bloco do #259 saiu dos dois dicionários (com `toastPhoneNeedsCountryCode` e `invalidPhoneHint`, órfãs com o texto do `+` obrigatório); **teste novo** `src/i18n/chaves-duplicadas.test.ts` reprova chave repetida em qualquer `messages/*.json` (mutante reprova) |
| Codex, 3ª rodada (HEAD `35d6f857`) | **sem revisão**: "usage limits" do Codex. As duas lentes e a auditoria do #259 ficam como a revisão desta rodada |
| O `main` andou de novo (#266, a aba IDs da API e os avisos de negócio) depois do CI do `35d6f857` | ✅ mesclado; sem conflito textual (5 arquivos mudados dos dois lados); a importação combinada (etiqueta por id do #266 + inválido do #265) testada no preview |

**Resultado da 3-IV (23/09/2026, a contagem do público do disparo, #594):**

**Medido antes, na produção:** as etiquetas "kommo" (4.635 contatos),
"Trabalhista" (3.611) e "Cliente Fechado" (1.081) apareciam como **1.000** no
passo 2 e no passo 4 do assistente. O passo 4 também ignorava as exclusões e
dizia **0** para público por campo personalizado — o número que a confirmação
de um disparo PAGO mostra. O envio, que pagina, saía para o número certo: as
telas tinham leitura própria, sem paginar.

**O que mudou:** a contagem é a MESMA resolução do envio
(`contarPublico` → `contatosDaBase` + `aplicarRecortes`, lendo só
`id, phone`); as telas não leem mais `contacts`/`contact_tags`/
`contact_custom_values` (pino). O upstream resolveu com uma RPC que conta no
banco; aqui a escolha foi uma leitura só para as duas pontas, porque duas
leituras divergem na primeira mudança — foi exatamente o defeito.

**Revisão em duas lentes (independentes, e as duas acharam os três P2):**

| Achado | Destino |
| --- | --- |
| P2 — CSV com exclusão: a contagem devolvia o tamanho da lista; a confirmação dizia 500 para um envio de 380 | ✅ a contagem lê as fichas do CSV que JÁ existem (pelas duas grafias do nono dígito, por conta) e tira as que têm etiqueta excluída — sem gravar nada. `pessoasDoCsv` e `fichasDoCsvNaBase` saíram de dentro de `upsertCsvContacts` para o módulo: envio e contagem usam as mesmas |
| P2 — a contagem relia o público inteiro a cada clique e a cada TECLA do campo personalizado, e o pedido velho corria até o fim | ✅ espera de 400 ms antes de contar, e a contagem velha é INTERROMPIDA (`AbortSignal` levado até o `.abortSignal()` de cada consulta, e conferido entre as páginas) |
| P2 (anterior à 3-IV, agora compartilhado) — "todos os contatos" por OFFSET: uma ficha criada no meio da leitura repetia a última linha de uma página na seguinte, e o envio mandava o modelo pago EM DOBRO (não há UNIQUE em `broadcast_recipients`); uma apagada pulava uma que existia | ✅ "todos" é lido POR CHAVE (`buscarPorChave`), com pino; o pino de paginação do disparo aceita as duas formas, cada uma com as suas invariantes |
| P3 — lento: 47 idas ao banco em fila para a etiqueta "kommo" (~8 s MEDIDOS por clique) | ✅ as fatias de `.in('id', …)` (conjuntos FIXOS de 100 ids numa página só — fora da regra 5 do `paginar.ts`) correm 6 por vez: **2,7 s** medidos, com a espera inclusa |
| P3 — alcance 0 deixava o botão de enviar livre, e o diálogo dizia "enviar para 0 contatos" | ✅ bloqueado, com "Ninguém a alcançar com este público." |
| P3 — o teto (25.000) virava "tentar de novo", que nunca funcionaria | ✅ o erro carrega o motivo (`motivoDaLeitura`); com `teto` a tela diz que o público passa do que ela consegue contar, sem o botão. O passo 2 ganhou o "Tentar de novo" nas outras falhas |
| P3 — o resumo do passo 2 em inglês ("Audience Summary", "Calculating…", "estimated recipients", "Select an audience type…"), com as duas primeiras chaves já nos dicionários pelo #259 sem uso | ✅ traduzido (duas chaves novas, com `=0` no plural: o `one` do português inclui o zero) |
| P3 — testes: telefone `''`, exclusão que falha, etiquetas sobrepostas e teto sem caso; o pino das telas não proibia `from('contacts')`; o pino do envio não cobrava `'*'` | ✅ todos acrescentados; um mutante escapou na 1ª passada (dados simétricos no CSV) e o teste ganhou uma ficha a mais |
| P3 — `aplicarRecortes` dizia receber `Contact[]` quando a contagem lê só `id, phone` | ✅ genérica sobre `Pick<Contact, 'id' \| 'phone'>`: um recorte novo que olhe outro campo não compila até a contagem ler a coluna |
| P3 — a pastilha de etiqueta excluída em `text-red-300` sozinho (ilegível no claro, e o `dark:` está inerte) | ✅ `text-red-600 dark:text-red-300` |
| Aceito — nos 400 ms da espera o passo 2 ainda mostra o número anterior | o passo 2 é só informativo; o passo 4 recalcula e é ele que libera o envio |
| Fora da fase (vieram do #259) — `pt.json`/`es.json` e o `+` obrigatório | levados à correção do #259 e à 3-II/3-III |

**Verificação:** `typecheck` limpo; lint com os mesmos 59 avisos de antes;
suíte inteira no Node 22 verde; os dois portões de i18n verdes; os 8 mutantes da
primeira passada e **os 10 desta revisão
reprovam** (a leitura por chave, o CSV com exclusão, o `.eq('account_id')`, o
telefone vazio, a exclusão que falha, o sinal, o `'*'` do envio, o filtro
invertido, a chave de pessoa, a volta ao OFFSET).

**Teste prático (preview, banco real, NADA enviado):** todos os contatos
**5.172** (= o banco); "kommo" **4.635** (era 1.000); kommo sem "Cliente
Fechado" **3.554**; campo personalizado com exclusão **1.999** no passo 2 e no
passo 4 (era 0 no passo 4); três etiquetas somadas **3.984** (= o banco).
Quatro cliques rápidos geraram UMA leitura (46 requisições). CSV com o lead de
teste (na outra grafia do nono dígito) e dois números fictícios: 3; excluindo
"kommo", **2**; excluindo "Trabalhista", 3. Só o lead com "kommo" excluída:
passo 2 "0 destinatários estimados", passo 4 "Ninguém a alcançar" e o botão
de enviar bloqueado. Leitura que falha (simulada): "Não foi possível
calcular" com "Tentar de novo", que recupera. Conferido no banco depois: 0
disparos, 0 fichas criadas.

**Resultado da 3-III (23/09/2026, o telefone na API e na "Nova conversa"):**

- **As cinco portas** passam pela régua da 3-II (`telefoneDigitado`):
  `findOrCreateContact` (`POST /api/v1/contacts`), `resolveConversationByPhone`
  (`POST /api/v1/messages`), `createBroadcast` (`POST /api/v1/broadcasts`), a
  rota `/api/cb/conversas/abrir` e o diálogo "Nova conversa". Antes, as quatro
  primeiras apagavam o que não era dígito (`sanitizePhoneForMeta` +
  `isValidE164`) — "(81) 98874-5316" virava a ficha +81 e um JID de contato
  colado (`…@lid`, `…@s.whatsapp.net`) virava os dígitos dele; o `@g.us` já
  caía no teto de 15 — e o disparo exigia o `+` do #586.
- **O texto CRU vai ao find-or-create** (`ContactInput.phone`): a régua não é
  idempotente sobre o próprio resultado — os dígitos de "+41 55 555 12 12"
  relidos sem o `+` ganham o 55. O disparo lê o destinatário e manda `to`, não
  os dígitos lidos; há pino e teste.
- **A frase do 400** diz o motivo (`mensagemDoTelefoneDaApi`: curto demais /
  não é telefone, com a regra escrita); o código continua `bad_request`. A rota da
  "Nova conversa" devolve o `motivo`, e o diálogo mostra a frase das telas de
  contato (`Contacts.telefone.*`) ao sair do campo — digitando "(81" a régua
  diz "faltou o DDD", verdade sobre o texto e mentira sobre a intenção. Saíram
  as três chaves do diálogo que diziam "com DDI".
- **`parseInternationalPhone` apagada** de `phone-utils.ts` (sem chamador): o
  pino `telefone-digitado.chamadores.test.ts` reprova o nome em qualquer
  arquivo de `src/`, e o atalho antigo nas cinco portas
  (`sanitizePhoneForMeta`, `normalizePhone`, `isValidE164`, `replace(/\D/g`),
  e cobra de onde saem os dígitos gravados.
- **O custo, escrito na doc pública:** número ESTRANGEIRO com o código do
  país e sem `+`, de 10 dígitos (ou 11 com 9 na 3ª posição — celular do Peru,
  do Chile), passa a ser lido como brasileiro. É a P9, e é o mesmo limite que
  a 3-II aceitou nas telas (medido: zero fichas assim); a doc manda número de
  fora com `+`.
- **O webhook de entrada (o Typebot) entrou na fase, a pedido do operador**
  (23/09/2026, depois da revisão: "não tenho como mexer no formulário do
  Typebot" — o tratamento tem de ser do nosso lado). `processarAcionamento`
  lê por `telefoneDigitado` (era `digitosDoTelefone`, a régua dos sistemas:
  "98874-5316" virava a ficha +98), e o recusado vira `sem_telefone` com o
  motivo no log. MEDIDO antes: ZERO eventos recebidos até hoje (o Typebot
  ainda não foi ligado ao CRM); o fluxo exportado pergunta o telefone no
  bloco Phone com país padrão Brasil, que valida e entrega "+55…" — esse
  formato passa igual pelas duas réguas. ⚠️ Com a régua, o telefone que CHEGA
  e não serve deixaria de virar ficha errada para sumir em silêncio
  (`sem_telefone` não entra no Meu dia): a rota de pendências passou a contar
  o `sem_telefone` com `telefone` preenchido, em 7 dias (sem janela o aviso
  nunca apagaria — reprocessar dá o mesmo resultado).
- **Docs:** seção "Phone numbers" em `docs/public-api.md` (com o aviso da
  mudança para quem integra), a regra e o log em `docs/webhooks.md`, as descrições das ferramentas do `mcp-server`, a
  receita "Mandar uma mensagem" da aba Documentação, o CHANGELOG e as notas do
  CLAUDE.md.

**Medido antes, na produção:** a chave "Automação - Make" (a única ativa) tem
`messages:send` e `contacts:write` e foi usada hoje — ela passa pelas portas
desta fase. O formato que o cenário manda não é observável daqui (o CRM grava
só os dígitos). Nenhuma ficha fora da régua veio da API: as de 11 dígitos sem
55 são um americano e um francês que ESCREVERAM ao escritório; a única de 14
dígitos com 55 (um número que não existe: 55 + 12) veio da carga da Kommo
(está no livro-razão, com trilha `retroativo`), que lê por `digitosDoTelefone`
e não confere o tamanho do 55 — fora do escopo desta fase, fica anotada para
o operador. Nenhum endereço de webhook de saída cadastrado.

**Verificação:** `typecheck` limpo; lint `✖ 58 problems (0 errors, 58
warnings)` = base; suíte em Node 22 **5.538 testes** verdes; portões de i18n
OK. **Mutação:** 21 mutantes, todos reprovam (cada porta volta ao atalho, o
disparo volta ao `+`, o disparo manda os dígitos lidos ao find-or-create, a
régua do original volta ao `phone-utils.ts`, as frases do 400 trocadas ou
antigas, a rota da "Nova conversa" tirando os dígitos de `normalizePhone` ou
de um `replace` solto; e, com o webhook de entrada: a porta volta a apagar
não-dígito, a frase do curto, a contagem do Meu dia sem o filtro do telefone,
sem janela, com outra janela ou fora da soma, o clique dos webhooks de volta
a Integrações, a fonte somando o Calendly, a coluna gravada em branco e a
limpeza sem as marcas invisíveis).

**Teste prático (preview `localhost:3130`, banco real; nada enviado):**

| Caso | Resultado |
| --- | --- |
| API, chave de teste de 20 min (revogada no fim): `POST /contacts` "(99) 90000-0011" / "99900000011" | 201 `5599900000011` / 200 a MESMA ficha |
| `POST /contacts` sem DDD / JID colado | 400 "is too short" / 400 "is not a valid phone number" (a frase de "curto" foi trocada na revisão; a sonda repetida depois) |
| `POST /messages` JID colado / sem DDD (canal Evolution desconectado + modelo inexistente, para nada sair mesmo com a régua quebrada) | 400 / 400, antes de qualquer consulta |
| `POST /broadcasts` só com destinatários recusados também pelo `+` antigo | 400 com a frase NOVA — é ela que prova qual código respondeu |
| Rota da "Nova conversa": sem DDD, `@g.us`, 18 dígitos, `081 …`, vazio | 400 `INVALID_PHONE` com `motivo` curto / invalido / invalido / invalido / vazio |
| Rota: "(99) 90000-0019" | ficha `5599900000019` do dono da conta, nome fixado, conversa FIXADA no canal escolhido, 0 negócios |
| Diálogo: digitando "90000-0019" / ao sair do campo / JID colado | sem erro, botão desabilitado / "Faltou o DDD…" / "Telefone inválido…" |
| Aba Documentação | a receita nova renderiza |
| Limpeza | as 2 fichas de teste apagadas (a conversa foi junto, sem mensagens); 0 disparos; a única chave ativa é a do Make |

**Revisão em duas lentes (5 agentes: as duas lentes, cada achado P0–P2 com um
cético que tenta refutar medindo):** nenhum P0/P1.

| Achado | Destino |
| --- | --- |
| P2 (AS DUAS lentes, cético confirmou, medido) — a nota "lido exatamente como antes" da doc pública e do CHANGELOG era falsa: número estrangeiro com o código do país e SEM `+` (Peru, Chile, Noruega…) de 10 dígitos, ou 11 com 9 na 3ª posição, ganha o 55; e o disparo, que recusava sem `+`, passa a aceitar | ✅ a nota diz o que muda e manda número de fora com `+`, nos dois lugares; a nota do CLAUDE.md escreve o custo |
| P2 (Lente 1) — o disparo pode gravar o destinatário na ficha estrangeira (casada pelos 8 finais) e mandar para o número lido | ❌ refutado pelo cético: os `params` vêm do pedido, não da ficha, e a troca de ficha pela tolerância dos 8 finais é ANTERIOR à fase e vale também com `+` no `main` — anotado como pendência abaixo |
| P3 (Lente 2, medido) — o pino exigia a CHAMADA da régua mas não de onde saem os dígitos, e não proibia `normalizePhone` (o mesmo `replace`): a rota da "Nova conversa", sem teste de comportamento, voltava ao defeito sem nada reprovar | ✅ o pino cobra os dígitos gravados e proíbe as cinco formas do atalho; 2 mutantes novos reprovam |
| P3 (as duas) — "número sem + ganha o 55" generaliza (não vale para `5581…` nem `1415…`); a frase de "curto" dizia "no area code" também para número COM `+` curto; a lista de recusas não citava o `+` curto nem os símbolos (`,` `/` `tel:`) | ✅ "sem + e sem o código do país" na frase do 400, na receita e na regra das telas; "is too short (missing the area code?)"; a lista completa |
| P3 (Lente 1) — entradas que antes entregavam no destino certo agora dão 400: `tel:`, `whatsapp:`, `,`/`;` no fim, `++`, `55+` | aceito e ESCRITO na doc pública; conferir o formato do cenário do Make é pendência do operador (não é observável daqui) |
| P3 (Lente 2) — as notas diziam que o `@g.us` passava antes (o teto de 15 já o recusava) e que "as quatro primeiras" portas apagavam os não-dígitos (o disparo exigia o `+`) | ✅ CLAUDE.md, plano e comentário de `contacts.ts` |
| P3 — comentários velhos: `// required, E.164` na rota de mensagens; "o mesmo `isValidE164` das outras portas" em `validate.ts` | ✅ |
| P3 (as duas, fora do escopo declarado) — o webhook de ENTRADA (Typebot: o lead DIGITA o telefone num formulário público) e o passo `send_to_number` continuam em `digitosDoTelefone`: "98874-5316" vira ficha +98 e `…@lid` vira telefone | ✅ o webhook de entrada ENTROU na fase por decisão do operador (ver acima); `send_to_number` (número que o próprio operador digita no construtor) fica como pendência |

**Revisão em duas lentes do commit do webhook de entrada** (3 agentes): nenhum
P0/P1. A Lente 1 MEDIU o que o bloco Phone do Typebot entrega, lendo o código
dele: o E.164 do libphonenumber-js, sem espaço, e o número inválido é pedido
de novo antes de sair do Typebot — 33 formatos comparados nas duas réguas,
todo E.164 brasileiro e todo estrangeiro com `+` saem iguais.

| Achado | Destino |
| --- | --- |
| P2 (Lente 2, cético confirmou) — o clique "N entradas não viraram atendimento" do Meu dia levava a Integrações, que não tem o log dos webhooks; e agora conta um caso cuja única saída é ler esse log | ✅ duas fontes: `agendamentosNaoProcessados` → Integrações e `webhooksNaoProcessados` → Webhooks → Recebidos (gate da seção, só de admin), cada uma com chave própria |
| P3 (as duas) — telefone só de espaços ou de marcas invisíveis: o log dizia "não veio" e o Meu dia contava como "veio e não serve" | ✅ a rota grava a coluna por `comAlgoVisivel` (em branco = nulo), testado; a frase do vazio diz "não veio, ou veio vazio" |
| P3 (Lente 1) — o teste da janela só conferia que existe um `gte` | ✅ compara com a janela das retidas; um prazo diferente num lado só reprova |
| P3 (Lente 2, medido) — o pino proibia `digitosDoTelefone(`, e um import com apelido passava | ✅ proíbe o nome |
| P3 — o comentário de `RESULTADOS_REPROCESSAVEIS`, a linha "Sem contato" e a regra resumida em `docs/webhooks.md`, e o CHANGELOG que punha o webhook na frase do +81 (lá o 55 já era dado) | ✅ |
| P3 (as duas) — a contagem é por ACIONAMENTO (o Typebot chama o mesmo webhook em vários pontos), e o `falhou` continua sem janela | aceito e escrito no comentário da rota: com o bloco Phone o caso nem nasce, e prazo para o `falhou` é decisão de produto |

**Pendências que ficam desta fase (fora do escopo, cada uma com dono):**

- ~~**`send_to_number` fora da régua**~~ — resolvido a pedido do operador
  (23/09/2026), num PR próprio depois do #276: a validação da ativação, o
  motor, o resumo do passo e o campo do construtor leem por
  `telefoneDigitado`, e o campo mostra o motivo ao sair dele. MEDIDO antes:
  um passo só em produção ("Calendly → Reunião agendada"), com 13 dígitos —
  passa igual pelas duas réguas.

  **Revisão (duas lentes, cético no achado; 4/4 mutantes mortos):**

  | Achado | Destino |
  | --- | --- |
  | P2 (confirmado pelo cético, medido) — automação JÁ ATIVA com número que a régua velha lia certo (id do WhatsApp, `wa.me`, número com rótulo) passa a falhar no envio depois do deploy, e o passo que falha encerra a execução (o card do Calendly não anda); o CHANGELOG não avisava, e dizia que "com letra" o aviso ia para +98 | ✅ o CHANGELOG avisa quem atualiza, com a consulta que lista os passos, e a frase diz o que ia para outro país (sem DDD, e o `@lid`). Incidência nesta produção: zero |
  | P3 (as duas) — os testes diziam que o JID `…@s.whatsapp.net` mandava o aviso a outro número; medido, caía no número certo (quem ia errado era o `@lid`) | ✅ o exemplo virou `@lid`, e o comentário diz as duas coisas |
  | P3 (as duas) — número já SALVO fora da régua abria no construtor sem aviso nenhum | ✅ conta como tocado ao montar: o motivo aparece ao abrir o passo |
  | P3 (Lente 1) — o registro da execução mostrava o código do motivo ("curto") | ✅ a frase ("curto demais (faltou o DDD?)"), testada |
  | P3 (as duas) — o resumo do passo (grade do funil, linha do tempo) ficava "Avisar o número:" em branco para o número recusado | ✅ aparece como foi escrito, nunca formatado (seria "+980000016"); testado |
  | P3 (as duas) — o pino proíbe os atalhos no motor e no construtor INTEIROS | aceito como default-deny, escrito no comentário do pino |
  | P3 (as duas) — a tabela da Fase 3 com 3-II "pendente" e 3-IV "em PR", e o comentário de `SendToNumberStepConfig.phone` | ✅ |
  | P3 (Lente 2) — o toast da ativação recusada sai em inglês cru (`phone is too short…`), e a chave da lista não mostra o motivo | anterior (todas as frases do `validate.ts` são assim); o motivo em português está no campo, que agora aparece ao abrir |
- **O destinatário do disparo casado pela tolerância dos 8 finais** — a linha
  de `broadcast_recipients` pode ficar com uma ficha de outro número (a busca
  tolera o tronco), e o envio vai ao número lido. Anterior à fase; vale com
  `+`.
- **O formato do cenário "Automação - Make"** — conferir no histórico de
  execuções do Make que o `phone`/`to` não leva `tel:`, JID ou pontuação no
  fim (passa a dar 400).
- **A ficha de 14 dígitos da carga da Kommo** (55 + 12) — um número que não
  existe; decisão do operador.

### Fase 4 — Fluxos: `{{vars}}` em botões e listas

**Origem:** #553 (`56ed3d9`). **Medido:** o nosso engine manda `cfg.text` cru em
`sendButtonsAndSuspend`/`sendListAndSuspend` (`engine.ts:433` e `:470`) — o
defeito existe aqui. Inerte hoje: 0 fluxos ativos.

**O nó da fase:** os dois lados resolveram a FALHA desses nós de jeitos
diferentes — nós com `try/catch` nos nós interativos, eles com `logEvent` de
erro + `endRun('failed')` (e a re-pergunta mantém a run viva). Medir o que o
nosso faz hoje e ficar com UM contrato. `reply_id` NÃO é interpolado (é chave de
roteamento). Não truncar: o validador do `meta-api` acusa o estouro.

**Teste no preview:** fluxo de teste no canal OFICIAL, palavra-chave improvável:
`collect_input` (nome) → `send_buttons` "Oi {{vars.name}}". Entrada simulada por
POST assinado no webhook LOCAL da Meta, como o lead de teste → botões REAIS
chegam com o nome. Título acima do limite → run `failed` com evento. Canal
Evolution → o motivo claro de hoje continua. ⚠️ Fluxo ativo vale para cliente
real: ativo por minutos, desativado e apagado em seguida.

**Resultado (23/09/2026):**

- **Medido antes:** nenhum fluxo na produção (nem rascunho). O defeito existe
  no código (`engine.ts` mandava `cfg.text`, cabeçalho, rodapé e títulos crus)
  e é inerte hoje. ⚠️ O merge #259 DESCARTOU o `engine.ts` do original (caiu no
  "fica o nosso"), então este porte é o único caminho.
- **Contrato de falha: fica o NOSSO**, que já existia: os dois nós
  interativos registram `send_interactive_failed` e encerram o run `failed`,
  e a re-pergunta que falha também encerra (`reprompt_interactive_failed`).
  São dois custos, escolhidos por escrito: o nosso libera o contato na hora e
  deixa a falha visível, ao preço de perder o fluxo num erro TRANSITÓRIO (com
  os botões ainda na tela do cliente); o original segura o run até esgotar
  `max_reprompts` (2) ou o varredor de 24 h, consumindo as mensagens do
  cliente nesse meio. No envio INICIAL os dois contratos são iguais. Nada
  disso mudou, e agora há pino da re-pergunta (a revisão achou que nenhum
  teste passava por ela).
- **O que entrou:** `camposDosBotoes` e `camposDaLista` (puros, exportados)
  interpolam todo texto visível; o `reply_id` nunca; campo opcional ausente
  continua ausente; nada é cortado (o `meta-api` recusa com o motivo e o nó
  encerra o run). E um achado da auditoria do #259: a LISTA não passava o
  canal do nó (`preferredChannelId`), e um fluxo preso ao número X a mandava
  pelo canal atual da conversa — agora passa, como os botões. A revisão por
  duas lentes achou o MESMO defeito na pergunta do `collect_input` (e na
  re-pergunta dela): com a conversa fixada em outro número, o "Qual seu
  nome?" saía numa conversa e o "Oi, Ana" noutra. Corrigido na mesma fase
  (`channel_id` no tipo do nó, `nodeChannel` nos dois envios).
- **Verificação:** `typecheck` limpo; lint sem aviso novo; suíte inteira no
  Node 22 verde; **16 mutantes reprovam** — os 8 da primeira rodada (os dois
  envios sem a montagem, o canal da lista, o `reply_id` interpolado nos dois
  nós, o opcional virando "", o rótulo do botão e o título de seção crus) e 8
  da revisão: a montagem com `{}` no lugar de `run.vars` (botões e lista —
  sobrevivia, porque os testes rodavam num run sem variável), o canal da
  pergunta e o da re-pergunta do `collect_input`, a re-pergunta que falha sem
  encerrar, cabeçalho e rodapé da lista crus e o `null` do JSONB virando "".
- **Registrado para depois (fora desta fase, achados da revisão):** o
  validador do save mede o título CRU (`{{vars.name}}` passa e pode estourar
  no envio; "Confirmar, {{vars.name}}" é recusado mesmo cabendo depois) — um
  aviso no editor resolveria; `interpolateVars` lê a cadeia de protótipo
  (`{{vars.constructor}}` imprime a função; só o autor do fluxo provoca,
  `Object.hasOwn` resolve); os passos `send_buttons`/`send_list` das
  AUTOMAÇÕES mandam o texto cru (o mesmo defeito no outro motor; inerte, só
  saem pela Meta); a nota do nó `handoff` não interpola, e a ajuda do editor
  promete que sim; e o erro do validador da Meta leva o título interpolado ao
  `flow_run_events` — aceito: o mesmo texto já está em `messages`.
- **Teste real (23/09/2026, ~16h BRT), com o código da branch no preview:**
  o operador abriu a janela de 24h escrevendo ao número oficial às 15:43.
  Conferido antes que nada mais reagiria à entrada simulada (nenhuma
  automação de mensagem, nenhum fluxo, IA desligada, nenhum webhook de saída,
  nenhuma espera nem run do lead). Dois fluxos de teste criados pela API
  (presos ao número oficial, palavra-chave exata improvável, ativados pela
  rota — o validador aprovou "Sim, {{vars.name}}" com 18 letras) e entrada
  simulada por POST assinado no webhook LOCAL da Meta:
  - **Botões:** pergunta → "Ana Teste" → a Meta ENTREGOU (`delivered`)
    "TESTE DO CRM: Oi Ana Teste, confirme:", com cabeçalho, rodapé e o botão
    "Sim, Ana Teste" preenchidos, ids `sim`/`nao` crus; o toque simulado
    encerrou o run (`end_node`).
  - **Título acima do teto:** "Maria Aparecida dos Santos" → run `failed`,
    `send_interactive_failed`, evento com o motivo; nada enviado.
  - **Lista:** "Bia Teste" → saiu "TESTE DO CRM: Bia Teste, escolha uma
    opção", com cabeçalho, rodapé, título da seção, título e descrição da
    linha preenchidos e ids crus. A Meta aceitou (wamid), mas o recibo de
    entrega não voltou (ficou `sent`). Causa provável, não medida: o recibo
    da Meta é um UPDATE solto, e quem chega antes de a linha existir se
    perde — o caminho da Evolution espera (`aplicarReciboQuandoAMensagemExistir`),
    o da Meta não; em 10/09 uma mensagem do oficial já tinha ficado em `sent`
    assim. Registrado, fora desta fase. **A lista CHEGOU:** o operador recebeu
    as mensagens e, às 16:14, tocou no botão e na linha da lista — as duas
    respostas entraram pelo webhook da PRODUÇÃO com os ids crus (`sim`, `r1`)
    e os títulos preenchidos ("Sim, Ana Teste", "Opção de Bia Teste"). Como os
    fluxos já estavam apagados, entraram como mensagens comuns: nenhum run e
    nenhuma automação disparou (conferido).
  - ⚠️ Uma resposta mandada 2 s depois da palavra-chave, ANTES de a pergunta
    sair, não foi capturada (o run ainda não existia): efeito do teste, não
    defeito — cliente de verdade responde depois de a pergunta chegar.
  - **Limpeza, conferida por consulta:** fluxos apagados pela rota (cascata
    em nós, runs e eventos: 0 de cada), as 9 mensagens simuladas do
    "cliente" apagadas, a conversa com a prévia e o `janela_meta` devolvidos
    ao real (18:47:57, a última mensagem de verdade do lead no oficial);
    situação, canal fixado e responsável intocados. As 5 mensagens reais do
    robô ficaram no fio: chegaram ao celular.
  - **Não exercitado:** o canal Evolution (o `meta-send.ts` não mudou; o
    harness cobre o `failed` com o motivo) e o EDITOR de fluxos — a dívida
    da Fase 1 continua aberta: os fluxos foram criados pela API, não pela
    tela.

### Fase 5 — O motivo da falha da Meta na mensagem

**Origem:** #535 (`a52febf`). **Medido:** o nosso `handleStatusUpdate` grava só
`status` (escopado por canal); 2 mensagens `failed` desde 10/09.

**Implementação:** migration `1039_cb_motivo_da_falha_da_mensagem.sql` (a
`042` deles, 3 colunas anuláveis; o #259 a trouxe como `0045`, e a correção
dele a renumerou e APLICOU — o que falta aqui é o código). No webhook: os campos de erro entram no MESMO `UPDATE`
escopado por canal; status posterior não-falha NÃO limpa o motivo. Em
`broadcast_recipients`, o motivo é dobrado em `error_message`. A bolha é NOSSA:
portar o tooltip no X e a linha discreta para `message-bubble.tsx`.
`Inbox.bubble.notDelivered` nos dois dicionários. Asserção no `verify-schema.sql`.
Falha da Evolution não preenche essas colunas — dizer isso no código.
⚠️ **O `handleStatusUpdate` mudou em 23/09/2026** (a escada e a espera no
recibo da Meta; ver o CLAUDE.md, "A rota da META tem a mesma escada"). O UPDATE
de `messages` mora agora no `tentar()` e só alcança linha em degrau abaixo
(`aceitamORecibo`): os campos do erro entram no patch DELE quando o recibo é
`failed`. O `failed` que chega depois da entrega é recusado inteiro e não grava
motivo, de propósito. O espelho de `broadcast_recipients` passou para ANTES das
mensagens, o status que chega a ele continua cru (`status.status`), e o UPDATE
dele ficou condicional (`origensDoDestinatario`): o `error_message` entra no
patch desse mesmo UPDATE, e a falha que ele recusa não grava motivo. No teste
do preview, o passo "depois `delivered` → o motivo fica" confere também que a
situação CONTINUA `failed`: a escada recusa o `delivered` depois da falha, e sem
essa conferência o passo passa sem testar nada.

**Teste no preview:** POST assinado LOCAL com `statuses[failed]` + `errors[0]`
sobre uma mensagem de teste do canal oficial → colunas gravadas, bolha mostra o
motivo; depois `delivered` → o motivo fica. Limpeza: restaurar a mensagem.
⚠️ **Há um `failed` REAL à mão (achado da Fase 2, 21/09):** o disparo do modelo
de Marketing `lembrete_reuniao_kckkhz` ao lead de teste, FORA da janela de 24 h,
foi aceito pela Meta e falhou na entrega, e o motivo se perdeu porque o webhook
o descarta. Depois do deploy desta fase, repetir aquele disparo (chave de API de
teste, criada e revogada na hora) e ler o motivo gravado em
`broadcast_recipients.error_message` — é a prova de ponta a ponta com a Meta de
verdade, e responde a pergunta que a Fase 2 deixou aberta (131049? 131050?
130472? 131042?). ⚠️ O webhook que recebe esse status é o da PRODUÇÃO — por
isso só depois do deploy.

**Prova real (24/09/2026, 19:16Z):** o disparo repetido — o modelo de
Marketing `lembrete_reuniao_kckkhz` ao lead de teste, pelo número oficial,
FORA da janela (a última mensagem dele ao oficial era de 23/09 19:14:26Z),
pela API v1 com uma chave criada e revogada no próprio script, pedido só ao
`localhost` — foi **202** e a Meta o **ENTREGOU** 2 s depois (campanha
`c14a8942…`, `delivered`, sem erro). A falha da Fase 2 não se repetiu: era
decisão da Meta naquele dia (a família dos limites de marketing), não defeito
nosso. Sem falha, não há motivo a ler: a prova do caminho "a Meta falha → o
motivo aparece" continua sendo a do preview (recibo assinado local), e a
primeira falha real vai gravá-lo — conferido na mesma hora: nenhuma linha com
motivo desde o deploy desta fase (`messages.error_*` e
`broadcast_recipients.error_message`, 0 e 0). A campanha fica no banco,
rotulada "TESTE Fase 5".

**Resultado (em andamento, 23/09/2026):**

- **Medido antes, na produção:** as três colunas da 1039 existem
  (`error_code` integer, `error_title` e `error_details` text) e estão
  vazias. Das mensagens `failed`, nenhuma é da conexão oficial — as 3 são da
  Evolution (a "2 `failed` desde 10/09" da tabela era outra foto). Um
  destinatário de disparo `failed` (o da Fase 2, 21/09) com `error_message`
  nulo. A mudança vale daqui para a frente.
- **Porte manual** (o #259 descartou o webhook deles, e o #277 reescreveu
  `handleStatusUpdate`): `motivoDaFalhaDaMeta` e `linhaDoMotivo` em
  `recibo-da-meta.ts` — PARSE do `errors[0]`, porque o motivo vai no MESMO
  UPDATE que pinta a falha, e um código não numérico, fracionário ou fora do
  `integer`, ou um texto com NUL ou surrogate solto, derrubaria a situação
  junto (a versão do original grava cru). O código numérico que chegue em
  texto é aceito (o Postgres o converteria). O patch do `tentar()` leva as
  três colunas; o UPDATE condicional do destinatário leva o `error_message`
  (`[código] título: detalhes`). A bolha é NOSSA: ela já dizia "Não entregue"
  em palavras, então o motivo entra numa linha discreta abaixo
  (`motivoNaBolha`, em `src/lib/inbox/motivo-da-falha.ts`, até duas linhas, o
  texto inteiro no `title`), no `title` da linha vermelha e no do X do
  rodapé (o do original). Com motivo, a linha vermelha troca "Envie de novo"
  por "veja o motivo abaixo antes de enviar de novo" (`naoEntregueComMotivo`):
  nos motivos mais comuns da Meta, reenviar igual falha de novo. A chave
  `Inbox.bubble.notDelivered` do original SAIU dos dois dicionários (ficaria
  sem uso: a nossa frase é `naoEntregue`); entraram `motivoDaFalha` e
  `naoEntregueComMotivo`. Asserção das três colunas no `verify-schema.sql`.
- **Verificação:** suíte inteira no Node 22, typecheck, lint na base (60),
  os dois portões de i18n; mutantes (ver o PR). **Preview**, com o dev
  server subido com o `META_APP_SECRET` de TESTE: um recibo `failed` com
  motivo, assinado e mandado ao webhook LOCAL sobre a interativa de teste da
  Fase 4 (`bd2f0e6d…`, conexão oficial, conversa do lead de teste) → as três
  colunas gravadas no mesmo UPDATE, a bolha com o motivo em duas linhas
  (contraste 4,46 no claro e 6,01 no escuro, contra 3,86/4,09 da linha
  vermelha que já existia), uma linha de `console.warn`; depois `delivered`
  e `read` → a situação CONTINUA `failed` e o motivo fica. Restaurada
  (`sent`, sem motivo) por UPDATE cercado; nenhuma sobra. Ninguém assina
  `message.status_updated` nesta conta, então nada saiu para o n8n.

  **Revisão (duas lentes, cético no achado):**

  | Achado | Destino |
  | --- | --- |
  | P2 (confirmado) — o CHANGELOG dizia, na mesma versão, que nada grava as colunas da 1039 | ✅ as duas frases corrigidas |
  | P3 (Lente 1, medido num Postgres 16) — NUL ou surrogate solto no texto da Meta derrubaria o UPDATE que marca a falha (a mensagem ficaria `sent` para sempre) | ✅ `texto()` limpa o conteúdo, testado |
  | P3 (Lente 1) — "Envie de novo" logo acima de um motivo que diz que reenviar não adianta | ✅ `naoEntregueComMotivo` |
  | P3 (Lente 2, medido) — "um `code` em texto derrubaria" é falso para texto numérico | ✅ a frase corrigida nos três lugares, e o código numérico em texto passa a ser aceito |
  | P3 (Lente 2) — o tooltip no X do original não foi portado, sem decisão escrita | ✅ portado |

### Fase 6 — Modelos da Meta

**6a. Cabeçalho de vídeo/documento (#562, `8223896`).** Medido:
`ensureImageHeaderHandle` sai cedo para o que não é imagem — modelo com
documento ou vídeo vai à Meta com URL e é recusado. `submit/route.ts` e
`template-manager.tsx` mesclam em silêncio: conferir que token e WABA continuam
sendo os DO CANAL (`resolveMetaChannel`). 16 chaves. Teste: criar modelo com
cabeçalho PDF na WABA oficial → a Meta aceita (PENDING). ⚠️ **Efeito externo —
peço OK na hora** (cria um modelo de teste, apagável no painel da Meta).

**6b. Stub de modelo desconhecido (#534, `422895e`).** Medido:
`template-webhook.ts` é idêntico à base (só atualiza; evento de modelo criado no
painel da Meta é descartado). O stub deles resolve a conta por
`whatsapp_config.waba_id` — na produção nunca casaria. **Port:** resolver por
`cb_channels.waba_id`, carimbar `channel_id` (o catálogo é por WABA: uma
linha sem canal valeria para qualquer número da conta) e gravar o dono da
conta em `user_id`.
Teste: POST assinado LOCAL de `message_template_status_update` para id
desconhecido → stub COM canal; segundo evento atualiza, não duplica; "Sincronizar"
adota o stub. Limpeza: apagar o stub.

**Resultado (24/09/2026):**

- **Medido antes:** 9 modelos, todos na conexão oficial (uma só, WABA
  `1138963437989735`); nenhum com `channel_id` nulo. O token e a WABA das
  rotas de criar e editar modelo já saíam do canal (`resolveMetaChannel`) —
  o #259 manteve isso. O `META_APP_ID` não está no `.env.local`; a preview
  subiu com ele por variável de ambiente (é o id público do app, o mesmo do
  `crm.env` da VPS).
- **6a:** `lerComTeto` saiu de `instagram/midia.ts` para
  `src/lib/http/ler-com-teto.ts` (o Instagram reexporta); o cabeçalho confere
  o `content-length` antes (mensagem com o tamanho) e lê com teto (mensagem
  "larger than"). Os testes passaram a usar resposta de verdade, em stream —
  o dublê com só `arrayBuffer` esconderia a leitura sem teto — e um corpo
  de 64 MB sem `content-length` para no teto de 16 MB do vídeo (FINITO de
  propósito: sem fim, o mutante trava em vez de reprovar). Textos:
  `Settings.templates.mediaHint` ("nós o enviamos à Meta"),
  `.env.local.example` e `docs/multi-waba.md` (o `META_APP_ID` serve a
  imagem, vídeo e documento).
- **6b:** o stub por `cb_channels.waba_id` (`kind = 'meta'`, exatamente uma
  conexão), com `channel_id` e o DONO da conta em `user_id`, e sem nascer ao
  lado de uma linha de mesmo nome/idioma no canal (o índice único da 903 leva
  o `user_id`). A rota passa `wabaId: entry.id`. Pino estrutural lendo a rota
  e o módulo.
- **E2E na preview, contra a Meta de verdade** (P5, delegado pelo operador):
  1. `POST /api/whatsapp/templates/submit` com cabeçalho `document` e o PDF
     público de teste do W3C → 200, `header_handle` obtido pelo upload da
     Meta, modelo `teste_crm_cabecalho_pdf` criado `PENDING` na WABA (id
     `1643195673986609`), a linha com o canal e o dono;
  2. a linha LOCAL apagada (a Meta ainda o tem) e um `message_template_status_update`
     assinado mandado ao webhook LOCAL → stub com o canal, o dono como autor,
     o id da Meta, sem corpo;
  3. `message_template_quality_update` para o mesmo id → a MESMA linha
     (total continua 10);
  4. **Sincronizar** → 10 atualizados, 0 inseridos: o stub foi ADOTADO (a
     mesma linha ganhou o cabeçalho `document` e o `header_handle`);
  5. limpeza: `DELETE /api/whatsapp/templates/<id>` → apagado na Meta e no
     CRM; um segundo Sincronizar confirma 9 modelos na Meta.

  **Revisão (duas lentes, cético no achado):**

  | Achado | Destino |
  | --- | --- |
  | P2 (confirmado, medido) — o stub nascia com o corpo VAZIO e virava o modelo do envio: `buildSendComponents` contava zero variáveis e mandava `parameters: []`, e o envio pelo nome (API v1, disparo) de um modelo criado no painel, que funcionava sem linha local, passava a ser recusado pela Meta. Os seletores o mostravam como aprovado, sem campos | ✅ o stub lê o modelo na Meta pelo id (token da conexão) e usa a MESMA conversão da sincronização (`modelo-da-meta.ts`, extraída da rota); leitura que falha = nenhum stub. Pino: o envio com o stub leva os parâmetros |
  | P2 (confirmado, medido) — o `catch` sem filtro em volta do `lerComTeto` transformava tempo esgotado e conexão cortada em "maior que o limite da Meta" | ✅ `TetoExcedido`; tempo esgotado e queda têm frase própria |
  | P2 (confirmado) — o evento de exclusão (`PENDING_DELETION`) de um modelo apagado pelo CRM o ressuscitava como stub | ✅ evento de saída (valor cru) não cria stub |
  | P2 (confirmado, medido num Postgres 16) — a conferência "já existe" olhava só o canal; a sincronização adota a linha SEM canal, e o stub nascia ao lado dela, fazendo a sincronização daquele modelo falhar para sempre | ✅ `.or(canal, nulo)`, a régua da sincronização e da submissão |
  | P3 — frases do CLAUDE.md e do plano ("corpo sem fim", "qualquer membro", o motivo do `channel_id`, a regra do `arrayBuffer` sem a exceção da foto de perfil) e dois comentários velhos | ✅ corrigidas |
  | P3 — textos do #562 que não vieram ("Imagem enviada" depois de um PDF; a dica do documento sem os dois limites; `toastImageTooLarge` sem uso; comentários do bucket e do `docker-stack.yml`) | ✅ portados/corrigidos |
  | P3 — CHANGELOG × INSTALACAO.md (os campos do webhook; o stub de qualidade nascia DRAFT) | ✅ alinhados; o stub lê a situação na Meta |
  | P3 — o teste de rota do #534 não veio | ✅ portado (`route.test.ts`), e o pino estrutural ficou mais estrito |
  | P3 — cópia desnecessária do Buffer | ✅ sem cópia |
  | P3 — o Sincronizar troca o dono (`user_id`) pelo admin que clicou, e não só no stub nem só no primeiro: em TODO modelo que ele atualiza (`templates/sync/route.ts`, conferido em 24/09). Como a coluna apaga em cascata (`0001`), apagar o login desse admin apaga os modelos da conta no CRM até o próximo Sincronizar | registrado (defeito anterior da sincronização, M24) |
  | P3 — stub do dono e linha de OUTRO admin no mesmo instante podem nascer juntos (o índice único leva o `user_id`) | aceito e escrito no CLAUDE.md (raro: um vai-e-volta ao banco) |
  | 2ª revisão (só o commit das correções, um revisor com cético): nenhum P0–P2; mediu no Node 22 que o prazo vencido na leitura do corpo é `TimeoutError` e a queda é `TypeError('terminated')`, e que o Buffer sem cópia sai com os bytes certos | — |
  | P3 (2ª revisão) — a asserção "não cai no ramo de mensagens" do teste de rota portado passava por acidente | ✅ o valor do evento leva também a forma de uma mensagem; o mutante sem o `continue` reprova |
  | P3 (2ª revisão) — a dica prometia 100 MB por link, mas o prazo de 10 s vale para o corpo | ✅ a dica e o CHANGELOG dizem "precisa baixar em até 10 segundos" |
  | P3 (2ª revisão) — a leitura na Meta (até 10 s) roda em série no laço do webhook, antes das mensagens do mesmo POST | aceito e registrado no handoff (raro: modelo desconhecido e mensagem no mesmo POST) |

- **E2E refeito depois das correções** (P5): modelo `teste_crm_stub_completo`
  (cabeçalho PDF + `{{1}}` no corpo) criado na WABA (id `1037758085962344`),
  linha local apagada, evento assinado → o stub nasceu COMPLETO (corpo com a
  variável, cabeçalho `document` com o handle, o exemplo, a categoria e a
  situação que a Meta já tinha — APPROVED, embora o evento dissesse PENDING),
  com o canal e o dono; evento de qualidade → a MESMA linha (10); evento para
  um id que não existe na Meta → nenhum stub, e o log diz só
  `HTTP 400 (code 100)`; **Sincronizar** (a rota refatorada, contra os dados
  reais) → 10 atualizados, 0 inseridos, sem erro; limpeza pelo `DELETE` do CRM;
  `PENDING_DELETION` assinado em seguida → nada ressuscitou (9); Sincronizar →
  9 na Meta.
- **Merge e pós-deploy (24/09/2026):** PR #284 mesclado às 12:19:32Z (merge
  `fe2a7530`, cabeça `f8e27b2f`; o `main` não tinha andado), rollout
  "converged" às 12:24:56Z na primeira tentativa. Conferido depois: login
  200, `/inbox` 307, crons, API e webhooks 401 (segredos no lugar), manifesto
  200; ingestão viva (3 mensagens, 2 de cliente, até 12:26Z); 9 modelos na
  conta. Codex sem cota — a revisão ficou nas duas lentes e no cético.

### Fase 7 — Por que a conexão com a Meta falhou

**Origem:** #505 (`45c3d7a`). **Medido:** a tela legada não é montada; o canal
Meta nasce por `meta-admin.ts`. A rota legada mescla em silêncio com a guarda de
papel intacta.

**Implementação:** `MetaApiError`, `meta-error-explain.ts` e `waba-pairing.ts`
entram como vieram (o `message` do erro não muda — os consumidores atuais
seguem). **Port do benefício:** explicação acionável e conferência do par
WABA/telefone em `meta-admin.ts` / `POST /api/cb/channels`, exibidas no
`cb-channels-panel.tsx`. A `docs/whatsapp-connection-troubleshooting.md` do
original foi APAGADA na correção do #259 (em inglês, sobre a tela legada):
aqui ela é escrita do zero, para *Conexões*.
Anotado para depois, FORA deste plano: `MetaApiError.status` é o que faltava
para a retentativa de automação valer na Meta.

**Teste no preview:** tentar criar conexão Meta com token inválido e com WABA
trocada → mensagem acionável. ⚠️ **Só caminhos de falha e leitura** — nada de
registrar nem reconfigurar o número oficial da produção.

**Resultado (24/09/2026):**

- **Medido antes:** o `explainMetaError`, o `waba-pairing` e o `MetaApiError`
  do #505 chegaram pelo #259 só à rota LEGADA (`/api/whatsapp/config`), cuja
  tela não é montada; e o POST dela respondia 500 a TODA chamada desde 27/07
  (`75daeb97`, nosso: pedia `account_role` a `whatsapp_config`). Quem conecta
  número oficial de verdade passa por *Conexões* (`POST /api/cb/channels` →
  `meta-admin.ts`), que mostrava a frase crua da Meta num toast que sumia,
  aceitava WABA de outro número (a conexão salvava e o webhook nunca chegava)
  e engolia a falha da assinatura da WABA (a conexão nascia "conectada" sem
  receber nada). Em produção: 7 conexões, 1 oficial.
- **O que entrou:**
  - `explainMetaError` ganhou o campo `motivo`, de lista fechada
    (`MOTIVOS_DO_ERRO_DA_META`); a rota devolve `{ error, falha }`
    (`falha-da-meta.ts`, puro) e o painel traduz o motivo
    (`Settings.channels.metaErro.<motivo>`, 36 chaves por dicionário) num
    aviso que FICA no diálogo, com o campo a conferir destacado e, embaixo, a
    etapa, o código, o trace id e a mensagem da Meta.
  - `provisionMetaChannel` na ordem do #505: ids só-dígitos (recusados antes
    de chamar a Meta, nomeando o campo) → leitura do número → par WABA/número
    (`listWabaPhoneNumbers`) → registro por PIN (continua best-effort: a
    conexão salva desconectada, e o toast diz por quê) → assinatura da WABA,
    agora FATAL (nada é gravado).
  - A mensagem da Meta ECOA o token: `semTokenDaMeta` (o token inteiro,
    `access_token=` e qualquer `EAA…`) antes da tela e do log — também no GET
    e no `verify-registration` legados.
  - `meta-api.ts`: `paging.next` só dentro de `https://graph.facebook.com`, e
    o teto de páginas LANÇA em vez de devolver meia lista (meia lista diria
    "o número não mora nesta WABA"); o token do início do upload de cabeçalho
    de modelo sai da URL para `Authorization: OAuth` (a pendência que a Fase 6
    deixou).
  - O POST legado foi APOSENTADO (410, apontando para *Conexões*): consertado,
    ele gravaria a credencial da Meta por cima do espelho de uma conta
    Evolution, sem criar conexão. O pino da guarda de papel cobra a
    aposentadoria; `syncDefaultMetaChannelFromConfig` saiu junto.
  - "wacrm" → "the CRM" no texto do original; `docs/conexao-meta.md` reescreve
    para *Conexões* a doc que a correção do #259 apagou; o comentário de
    `retentativa.ts` e o CLAUDE.md dizem que ligar a Meta à retentativa ficou
    FORA do plano (seria uma régua por `code`: o 4xx da Meta costuma ser
    determinístico).
- **Verificado:** typecheck limpo; lint 60 avisos (a base); i18n OK; 5.956
  testes em 428 arquivos no Node 22; mutantes 21/21 (cerca de origem, teto de
  páginas, token na URL, assinatura engolida, par não conferido, registro
  fatal, token ecoado, motivo trocado de ramo, frase faltando no pt-BR, id
  não numérico, erro que não é da Meta, `await` do ramo Meta, POST legado
  falando com a Meta ou respondendo 200, erro local lido como "sem resposta",
  WABA trocada lida como "valor recusado" e outros); nenhum worker órfão.
- **Revisão (duas lentes, cético por achado):** nenhum P0–P2.

  | Achado | Destino |
  | --- | --- |
  | P3 — o registro que falha fecha o diálogo, e o toast mandava ler código e trace id "logo abaixo" sem mostrá-los | ✅ a segunda linha do toast leva a etapa e os detalhes, e fica 20 s |
  | P3 — cursor fora do Graph e teto de páginas lançavam `Error` simples, lido como "não foi possível falar com a Meta" | ✅ `MetaApiError` (a Meta respondeu), cai em `outro` |
  | P3 — resposta que chega depois de o diálogo fechar ou voltar devolvia o aviso vermelho a um formulário limpo (e, no sucesso, fechava um diálogo que já era outro) | ✅ `envioMetaRef` marca o envio vigente |
  | P3 — comentários que citavam o POST aposentado, e a frase do CHANGELOG sobre a limpeza do token prometendo mais que o código | ✅ corrigidos |
  | Pré-existente — a sonda de saúde (`health.ts`, ramo Meta) loga a mensagem crua da Meta, que pode ecoar o token | registrado, não corrigido (fora do escopo; quem lê o log da VPS já tem a `ENCRYPTION_KEY`) |
  | 2ª revisão (só os commits de correção, um revisor com cético): nenhum P0–P2; confirmou que o `envioMetaRef` cobre toda saída e que o `nonexisting field` não classifica errado caso real | — |
  | P3 (2ª revisão) — falha de um envio ABANDONADO não mostra o aviso fixo, e o toast mandava ler código e trace id "logo abaixo" sem mostrá-los | ✅ nesse caso a segunda linha do toast leva a etapa e os detalhes (conferido no preview contra a Meta: 190 e o trace id) |
  | P3 (2ª revisão) — o teste "os dois erros locais" só cobria o cursor fora do Graph | ✅ cobre o teto de páginas também; o mutante reprova |

- **E2E na preview** (P5; o operador entrou e autorizou o script com o token
  real):
  1. Phone Number ID que não é só dígitos → 400 antes de qualquer chamada à
     Meta, com o campo nomeado e destacado;
  2. token inválido contra a Meta de verdade → código 190; o aviso fica no
     diálogo com o código, o trace id e a mensagem da Meta, e o campo do
     token destacado;
  3. resposta atrasada: Voltar com a requisição no ar → a resposta que chega
     depois não devolve o aviso ao formulário limpo;
  4. upload de cabeçalho de modelo com o token no cabeçalho, contra a Meta:
     modelo de teste criado `PENDING` na WABA (id `2260845154760772`) e
     apagado pelo CRM — 9 modelos de novo;
  5. **com o token REAL da conexão oficial**, lido e decifrado só em memória
     por um script local, nunca impresso, só leituras (os dois casos param
     antes do registro e da assinatura): WABA trocada (número e token certos)
     → a Meta responde "(#100) Tried accessing nonexisting field
     (phone_numbers)", que a primeira versão lia como "a Meta recusou um
     valor" — a frase entrou na regra do código 100 (medido; mutante morto) e
     a tela passou a dizer que a Meta não encontra o WABA ID, com onde
     copiá-lo; Phone Number ID inexistente → código 100/33, "a Meta não
     encontra o Phone Number ID". Nada gravado: `cb_channels` continua com 7
     conexões, 1 oficial.

- **Merge e pós-deploy (24/09/2026):** PR #285 mesclado às 14:06:58Z (merge
  `f5879b3f`, cabeça `3c23f456`; o `main` não tinha andado). O rollout
  estourou o tempo do SSH até a VPS nas DUAS tentativas do job (run
  `36010441272`, falha de rede, não do código); `gh run rerun --failed`
  convergiu às 14:17:55Z. Conferido depois: saúde anônima em ordem e
  ingestão viva (16 mensagens, 5 de cliente, até 14:23:33Z). Codex sem cota —
  a revisão ficou nas duas lentes e no cético.

### Fase 8 — Notificação do navegador

**Origem:** #516 (`06b7b97`). Funcionalidade nova (5 arquivos, 24 chaves).

**Adaptações (proposta — decisão P2):** respeitar o recorte de conexões do perfil
(a régua do Meu dia, com o contexto REAL, nunca a lente do "Ver como"); **grupo
fora**; montar DENTRO da `<PortaDeEntrada>`, ao lado do `PresenceHeartbeat`. No
app instalado no iPhone não funciona (sem service worker) — o cartão diz
"não suportado". Custo: mais uma assinatura realtime por aba.

**Teste no preview:** ligar em Configurações → perfil; entrada simulada com a
aba em outra conversa → notificação (espiã de `Notification` na página; o aviso
do sistema operacional fica para o operador conferir); mensagem de grupo e de
conexão fora do perfil → nada; clique abre `/inbox?c=`.

**Resultado (24/09/2026):**

- **Medido antes:** o #259 trouxe a biblioteca, o hook, o ouvinte e o cartão,
  mas o ouvinte não estava montado em lugar nenhum e o cartão tinha saído de
  *Seu perfil* (correção do #259). A régua do original avisa TODA mensagem de
  cliente da conta — grupo, conexão fora do perfil, e também a mensagem antiga
  gravada agora (a carga da Kommo, a recuperada tardia pela 1010) — e a
  preferência morava numa chave GLOBAL do navegador
  (`wacrm:browser-notifications`): quem entrasse depois no mesmo computador
  herdava o "ligado". `conversations.last_message_at` não serve para "alguém
  escreveu depois": a ingestão o carimba com o relógio do servidor.
- **O que entrou:** `src/lib/notifications/aviso-no-navegador.ts` (puro) —
  `silencioDoAviso` (perfil sem a Caixa de entrada, grupo, fora do perfil pelo
  contexto REAL, "quais conversas", mensagem gravada mais de 1 h depois do
  próprio carimbo) e `lerPreferencia` (parse, nunca `as`); o hook portado
  (preferência POR PESSOA em `cb-notificacoes:<userId>`, a chave antiga apagada
  ao gravar; título por `nomeDoContato`; corpo escondido quando a pessoa pede;
  clique por `urlDoInbox`); o ouvinte na casca, dentro da `<PortaDeEntrada>`,
  só com `!entradaPendente`; o cartão de volta em *Seu perfil* (só com a Caixa
  de entrada no perfil), com as duas configurações. Decisão escrita sobre o
  opt-in antigo: a chave foi TROCADA — o "ligado" dado ao cartão do #259 nunca
  mandou aviso nenhum, e a chave global era o defeito.
- **Verificado:** typecheck; lint (60, a base); suíte no Node 22 (430
  arquivos, 6.140 testes); os dois portões de i18n; mutantes 18/18 (na
  primeira rodada escapou o que ignorava o silêncio da régua — o pino só
  conferia que ela era CHAMADA — e o pino foi reforçado).
- **E2E na preview** (mensagens inseridas direto na tabela, na conversa do
  lead de teste autorizado — o que esta fase muda é o OUVINTE do realtime, não
  a ingestão, e assim nenhuma automação, robô ou reabertura rodou; `Notification`
  trocada por uma espiã, porque o Browser pane não tem a caixa de permissão):
  1. o cartão aparece em *Seu perfil*; ligar grava `cb-notificacoes:<user>` e
     mostra as configurações;
  2. mensagem nova → aviso com o nome da ficha, o texto e a etiqueta da conversa;
  3. "Mostrar o texto" desligado → o aviso diz só "Mensagem nova";
  4. "Só as conversas atribuídas a você", conversa sem responsável → silêncio;
  5. mensagem com a hora de 2 h atrás (gravada agora) → silêncio; a seguinte,
     nova → aviso (prova de que o silêncio foi da régua, não do realtime);
  6. o clique abre `/inbox?c=<a conversa>`; com o pane OCULTO a mensagem
     seguinte avisou — o certo: o original só cala com a aba VISÍVEL naquela
     conversa (caso coberto pelo teste dele).
  Limpeza: as 6 mensagens apagadas e a conversa restaurada ao retrato
  (encerrada, sem não lidas, sem espera, a mesma última mensagem), conferido
  por consulta; a preferência de teste apagada do pane.
  7. (depois da revisão) com `/inbox` JÁ montado e nenhuma conversa aberta,
     o clique no aviso abriu a conversa no fio, na MESMA página (sem
     recarregar) — antes só a URL mudava. Limpeza conferida de novo.
- **Revisão** (duas lentes, um cético por achado; Codex sem cota):

  | Achado | Destino |
  | --- | --- |
  | P2 (AS DUAS lentes) — com o inbox já montado noutra conversa (segundo monitor), o clique no aviso só trocava a URL: a página não remonta, e o fio ficava na conversa antiga até uma recarga — que depois pulava de conversa sozinha | ✅ `EVENTO_ABRIR_CONVERSA`: a página abre pelo caminho do "Nova conversa" e não reabre a ativa; pino e mutante; E2E 7 |
  | P3 — no celular (Chrome do Android, app instalado no iPhone) a API existe e a permissão é dada, mas o construtor lança: a chave ligaria e nada chegaria | ✅ aparelho de toque é "não suportado", no cartão e no ouvinte |
  | P3 — conversa NOVA lida antes de receber o `channel_id` escaparia do recorte do perfil | ✅ na 1:1 sem canal vale o canal carimbado na mensagem; teste e mutante |
  | Refutados pelo cético (5): canal de realtime com nome fixo (o `leave` do phoenix 0.4.4 fecha o canal na hora); consulta antes dos cortes baratos (custo desprezível: uma leitura por PK por mensagem de cliente, só com o aviso ligado); `gravada_em` nulo tratado como ao vivo (a régua cai no relógio da tela, e a carga do histórico grava hora antiga); fila entregue depois de mais de 1 h fora do ar calada (é o recorte pedido — a conversa segue com a não lida); o cartão seguir a lente do "Ver como" e o ouvinte o contexto real (é a regra da casa: tela sob a lente, efeito como quem é) | — |

  Mutantes: 18/18 (os quatro das correções incluídos; um escapou na primeira
  rodada porque o pino procurava o `new CustomEvent(...)` e não o disparo, e
  foi amarrado ao `window.dispatchEvent`).

- **Merge e pós-deploy (24/09/2026):** PR #287 mesclado às 16:37:58Z (merge
  `789370a0`, cabeça `64d4b670`; o `main` não tinha andado), rollout
  "converged" às 16:44:28Z na primeira tentativa. Conferido depois: login 200,
  `/inbox` 307, crons 401, manifesto 200; ingestão viva. Codex sem cota.
- **Codex depois do merge (a cota voltou às 17:05Z):** um P1 e um P2,
  consertados no **PR #289**. P1: conversa SEM pino recebendo mensagem por
  outro número — o `follow` troca o canal DEPOIS do INSERT, e a régua lia o
  número velho (avisava o perfil errado); o recorte passou a usar o canal da
  MENSAGEM na conversa solta e o da conversa na fixada. P2: "só as minhas"
  perdia a mensagem que a automação atribui logo depois do INSERT. A 1ª
  versão (sono de 3 s) levou mais dois P2 do Codex (prazo fixo não garante a
  atribuição; depois do sono a pessoa podia já estar lendo a conversa) e,
  depois deles, uma borda por rodada — nove rodadas no total (oito do Codex,
  uma auditoria com cético por achado antes da quinta). Ficou: a mensagem
  calada por "não é sua" ESTACIONA (até 1 h contada da MENSAGEM, o mesmo
  limite de "mensagem nova"; a antiga é decidida antes e nunca estaciona) e o
  UPDATE da conversa atribuída à pessoa (realtime) a solta, relendo a
  conversa; a mais nova é decidida pela ordem de CHEGADA do realtime (o
  carimbo empata no milissegundo); a soltura de uma estacionada velha não
  troca o aviso de uma mais nova já exibida (`avisadas`); a atribuição que
  chega com a consulta no ar é guardada; a conversa que a pessoa ABRE com a
  aba visível vira uma GERAÇÃO de vista (`EVENTO_CONVERSA_ABERTA` da caixa de
  entrada, e a volta à aba) que toda consulta respeita; e a tela é conferida
  de novo antes de exibir. ⚠️ A cerca "a não lida zerada = alguém viu", que
  existiu por uma rodada, SAIU: a não lida é da CONTA, e uma aba oculta com o
  fio aberto a zera — calava o aviso de quem nunca viu. Aceitos e escritos na
  regra (latentes: nenhuma automação atribui conversa hoje): em "minhas e sem
  responsável", a conversa sem dono avisa na hora mesmo que a automação a
  entregue a outra pessoa em seguida; a estacionada de conversa alheia não é
  solta se a conversa ficar SEM dono; e com DUAS abas a vista numa não chega
  à outra (cada aba tem o seu ouvinte desde o original; no máximo um aviso
  redundante, nunca um perdido — o P2 da última rodada, aceito sem outra).
  Mutantes 30/30; E2E no preview contra o banco, duas vezes (só a conversa de
  teste; limpo e conferido contra o retrato). O P2 do #286 (arquivo movido
  entre áreas: `regras-do-diff.mjs` via só o destino) foi no mesmo PR:
  `--no-renames`. **Mesclado** em 24/09 21:16:44Z (merge `2f969c65`),
  rollout "converged" às 21:22:43Z na primeira tentativa; conferido depois:
  login 200, `/inbox` 307, crons 401, manifesto 200; ingestão viva (67
  mensagens, 29 de clientes, entre 21:24Z e 01:19Z).

### Fase 9 — "Digitando…" enquanto a IA responde

**Origem:** #527 (`ec010c7`). **Medido:** resposta automática DESLIGADA na
produção — inerte hoje. **Não adotar** `loadAccountMetaCredentials`: o indicador
sai pelo canal DA CONVERSA, e só quando `ehMeta`. Melhor esforço: falha vira
aviso no log e nunca segura a resposta.

**Teste:** unitário + prático sem ligar a IA para ninguém: o operador manda uma
mensagem do celular dele ao número oficial e um script local dispara o indicador
para aquele `wamid`. ⚠️ Depende do operador (decisão P5).

**Resultado (24/09/2026):**

- **Medido antes:** o #259 trouxe `sendTypingIndicator` (`meta-api.ts`) e o teste
  dele, mas não o chamador: a resposta automática não disparava o indicador e o
  webhook da Meta não passava o `wamid`. O original lê as credenciais da CONTA
  (`loadAccountMetaCredentials`, o número padrão): com dois números oficiais,
  marcaria a mensagem num número e responderia pelo outro. A resposta automática
  está DESLIGADA na produção — a fase entra inerte.
- **O que entrou:** `src/lib/ai/digitando.ts` (`mostrarDigitando`) — resolve o
  canal pela MESMA função da resposta (`resolveEngineChannelPreferring` com o
  canal da entrada), só age em canal Meta e com id `wamid.`, melhor esforço
  (nunca lança, sem `await`, log por `semTokenDaMeta`); chamado na resposta
  automática depois de TODOS os portões e antes de gerar o texto; o webhook da
  Meta passa `inboundMessageId: message.id`. A Evolution não passa nada.
  Decisão do operador (P6): manter, sabendo que a Meta marca a mensagem do
  cliente como LIDA junto.
- **Verificado:** typecheck; lint (60, a base); suíte no Node 22 (432 arquivos,
  6.150 testes); os dois portões de i18n; mutantes 9/9 (o do canal da entrada, depois da revisão).
- **Teste contra a Meta REAL** (P5, delegado pelo operador; o código da branch
  rodado por um script local, com o token decifrado só em memória), na última
  mensagem que o lead de teste mandou ao número oficial (a janela aberta até
  24/09 19:14Z): id da Evolution → pulado, sem chamada; o `wamid` do lead →
  "digitando…" ACEITO pela Meta (o efeito — a mensagem lida e o indicador no
  celular dele — não foi conferido na tela do aparelho); `wamid` inexistente → a Meta recusou (131009), a função não
  lançou, e o log saiu sem o token.
- **Merge e pós-deploy (24/09/2026):** PR #288 mesclado às 16:56:04Z (merge
  `7a082fdb`; o `main` não tinha andado), rollout "converged" às 17:02:35Z na
  primeira tentativa. Conferido depois: login 200, `/inbox` 307, crons 401,
  manifesto 200; ingestão viva (4 mensagens, 1 de cliente, entre 17:00Z e
  17:03:39Z). O Codex, com a cota de volta, revisou o #288 sem achados.

- **Revisão** (duas lentes, um cético por achado; Codex sem cota): nenhum P0–P2.

  | Achado | Destino |
  | --- | --- |
  | P3 — nenhum pino fixava que o indicador usa o canal da ENTRADA: `channelId: null` passava verde (medido por mutante) | ✅ o pino exige `channelId` na chamada e o `preferredChannelId: channelId` da resposta; mutante morto |
  | P3 — a ajuda de "Responder automaticamente" não dizia que, no número oficial, a mensagem do cliente passa a aparecer como LIDA (inclusive quando a conversa acaba indo para uma pessoa) | ✅ a frase entrou nos dois dicionários |
  | Refutados pelo cético (4): o indicador sai antes do handoff, da falha do provedor e da corrida do teto (é o desenho do original, escrito no código dele: "nothing to undo on the handoff path"; e o que a P6 aceitou); o `void` no lugar do `await` do original (troca deliberada e escrita: o `await` sem prazo seguraria a resposta; a ordem já vem quase garantida pelas idas ao banco e pela geração) — as duas lentes levantaram os dois | — |

### Fase 10 — i18n das telas que estavam em inglês

**Origem:** #577 (`6eb7eef`), #578 (`50c11b2`), #579 (`a8d8a12`, `bbb6ff1`).

Onde os DOIS traduziram (14 arquivos): fica o nosso, e as chaves deles que
sobrarem órfãs saem do `en.json`. Onde só ELES traduziram: entra o deles, com as
chaves no `en.json` e no `pt-BR.json` (aproveitando o `pt.json` deles, revisando
a terminologia da casa). `pt.json`, `es.json` e `ko.json` são apagados (decisão
P3); `messages.test.ts` fica em `pt-BR`. "wacrm" vira `{appName}` ou "este CRM".
Pode ser fatiada em 10a/10b/10c, uma por PR do upstream.

**Teste no preview:** percorrer em pt-BR cada tela tocada (signup,
forgot-password, join, notificações, agentes, cabeçalho do fluxo, construtor de
interativa, toasts) — nenhuma chave crua, nenhum inglês novo.

**Resultado (24/09/2026):**

- **Medido antes:** o #259 uniu as 240 chaves do #578, mas os componentes
  NOSSOS (que ficaram com "o nosso" nos conflitos) continuavam com inglês
  fixo, e as traduções prontas estavam órfãs: os toasts do fio e do
  compositor ("Failed to send: …", "network error"), aria-labels e o "Failed
  to load automations" da lista de automações, o convite, a presença
  ("Offline — last seen 2 hours ago"), o feed de atividade do painel ("New
  message from …"), o import de contatos sempre no SINGULAR (o next-intl não
  lê o sufixo `_plural` do i18next: "Importar 6 contato"), a dica do botão
  bloqueado ("seu papel não permite create broadcasts"), a validação da
  mensagem interativa, as falhas do upload ("Not signed in.") e o aviso de
  atribuição da página de Notificações, gravado em inglês pelo gatilho da
  0027 (9 avisos na produção). Mais 183 chaves sem uso (103 do #259, 80
  antigas).
- **O que entrou (cinco commits):** 10a/10b — as traduções do #578 ligadas nos
  componentes nossos; 10c — texto fixo para o dicionário, plural ICU no
  import, `formatLastSeen` por `Intl.RelativeTimeFormat` no idioma do app
  (`use-rotulo-de-presenca.ts`), o feed do painel devolvendo DADO e a frase
  saindo de `Dashboard.activityFeed.eventos.*`; 10d — `gateReason` tipado
  (`AcaoBloqueada`, 17 call sites), a validação da interativa com `codigo` +
  `params` traduzida na tela (o `error` em inglês fica: é contrato das rotas e
  do motor), `ErroDeUpload` com motivo; 10e — os achados da revisão, o plural
  dos disparos ("1 destinatários falharam"), o rótulo dos toasts ao leitor de
  tela ("Notifications alt+T") e o aviso de atribuição escrito pelo TIPO
  (`textoDoAviso`, com o nome de quem atribuiu e o do contato). Chaves:
  4.427 → 4.312 (183 fora, 68 novas); 12 textos do pt-BR mudaram, todos de
  propósito (11 viraram plural ICU; o aviso da IA desligada aponta para
  "Agentes de IA"). Pino `src/i18n/textos-portados.test.ts`.
- **Verificado:** typecheck; lint (60, a base); suíte no Node 22 (436
  arquivos, 6.187 testes); os dois portões de i18n; mutantes 7/7 (os da
  revisão e da 10e); preview
  em pt-BR — painel, Automações, Membros (presença), Contatos, detalhe do
  disparo, Notificações — sem chave crua nem inglês novo.
- **Revisão** (três lentes — chaves apagadas × uso dinâmico, correção,
  regressão do fork —, um cético por achado; conferi à parte os 11 usos
  dinâmicos de tradutor sob os namespaces que perderam chave: nenhum pede
  chave apagada):

  | Achado | Destino |
  | --- | --- |
  | P3 — a presença dizia "ontem"/"anteontem" (palavras de CALENDÁRIO) sobre blocos de 24 h: visto segunda 9h e olhado quarta 8h saía "ontem" | ✅ os dias com `numeric: "always"` ("há 1 dia"); teste de 47 h e 71 h |
  | P3 — o pino do `gateReason` não pegava a frase atrás de `as` (`{"create broadcasts" as AcaoBloqueada}` compila) e reprovaria um ternário legítimo (o cético refutou como defeito de TELA, porque nenhum call site o usa) | ✅ o regex casa o literal dentro de chaves; um regex só para a varredura e para o teste dele; mutante com o contorno morto |
  | Achados MEUS no preview: "1 destinatários falharam"; o sonner anunciando "Notifications alt+T"; o aviso de atribuição em inglês na página de Notificações | ✅ plural ICU; `containerAriaLabel`; `textoDoAviso` |

- **Merge e pós-deploy (24/09/2026):** PR #290 mesclado às 18:42:02Z (merge
  `6959c5ec`; o `main` não tinha andado; o Codex, na abertura, sem achados),
  rollout "converged" às 18:48:36Z na primeira tentativa. Conferido depois:
  login 200, `/inbox` 307, crons 401, manifesto 200; ingestão viva (mensagem
  de cliente às 18:49:19Z).
- **Fora desta fase, escrito:** os problemas que a ATIVAÇÃO de automação
  devolve (`src/lib/automations/validate.ts`) são frases do servidor, em
  inglês, em toda a lista — contrato; traduzir pede código por problema, é
  frente própria. E o texto do próprio Storage quando ele recusa o upload
  sai cru.

### Fase 11 — BSUID (por último)

**Origem:** #533 (`2cf9806`, 17 arquivos, +1.325). A Meta deixou de mandar o
telefone de quem adotou nome de usuário e não tem histórico recente com a
empresa: o webhook vem só com `from_user_id`.

**Medido:** o nosso webhook tem a mesma falha (`normalizePhone(undefined)` →
`''` → `findExistingContact('')` → contato E conversa novos a cada mensagem, e
resposta impossível). Na produção ainda não mordeu: **0** fichas sem telefone;
22 mensagens de cliente em 3 conversas no número oficial desde 10/09. Cresce
quando o número oficial assumir o lugar da Kommo.

**Decisões que abrem a fase (P4):** `phone = ''` (deles) × `NULL` (nosso, 989) —
proposta: `NULL`, alargando o CHECK para "telefone OU instagram OU BSUID";
BSUID só vale em canal Meta — Evolution e Instagram recusam com motivo claro;
a guarda `nome_fixado_em` e o backfill do BSUID viram DOIS `UPDATE`s; Asaas,
Calendly, régua, foto de perfil e "nova conversa" contam com telefone (a ficha
sem telefone já existe por causa do Instagram — reduz o risco, não zera).

**Subfases, cada uma pelo portão da seção 4:** 11.0 desenho e decisões ·
11.1 migration · 11.2 entrada (identidade, contato por BSUID primeiro, backfill)
· 11.3 saída (`recipientFields`, alvo de envio atrás de `ehMeta`, em TODOS os
senders do fork) · 11.4 tela (identidade sem telefone) · 11.5 teste de ponta a
ponta com entregas assinadas locais (duas mensagens só-BSUID → UMA ficha, UMA
conversa; depois payload com telefone + BSUID → backfill na mesma ficha).
Limite conhecido: envio real a BSUID só se prova com um cliente de verdade nessa
situação.

**11.0 — Desenho (24/09/2026; medido por quatro leitores e um crítico de completude, só leitura)**

**Medido, e conferido no código (worktree `merge-upstream`, só leitura).** Hoje, uma mensagem só com BSUID segue este caminho. `normalizePhone(message.from)` devolve `''` (`webhook/route.ts:863`). `findExistingContact('')` sai sem consultar nada (`dedupe.ts:123-124`). O INSERT grava `phone: ''` (`route.ts:1543-1552`), e esse valor passa no CHECK da 0989 (`0989:132-135`) e fica fora dos índices 0022/1024. O resultado é **uma ficha, uma conversa e um card novos a cada mensagem**. Com reação acontece o mesmo, porque o atalho da reação (`route.ts:911`) só vem depois de o contato e a conversa terem sido criados. Nada grava `wa_user_id` (grep em `src/`), então o índice da 1038 está vazio. Em produção, no dia 24/09, havia **0** fichas sem telefone ou com `wa_user_id`. A camada HTTP da saída já está no `main` (`meta-api.ts` `recipientFields`, usado nos 6 remetentes). O `resolveContactSendTarget` (`wa-identity.ts:186-199`) não tem nenhum chamador. O último número de migration no `main` é **1040**.

**Conflitos entre as medições e como ficaram:**

1. *Blindagem dentro do `wa-identity.ts`* (entrada) contra *não mexer no arquivo do original* (saída). **Fica fora do `wa-identity.ts`.** Ele é arquivo do upstream e está idêntico ao 2cf9806. A conversão (`''`→`null`, `from` com cara de BSUID → sem telefone, nome nunca BSUID) vai para um módulo NOSSO. A guarda "BSUID nunca vira busca por sufixo" vai para `findExistingContact`.
2. *"`automations/meta-send.ts` é só um wrapper"*: a regra está **errada**. `engine.ts:58-62` importa `engineSendText`/`engineSendTemplate` de `./meta-send`, e `sendViaMeta` (`automations/meta-send.ts:142`) é o remetente de `send_message`/`send_template`/`send_to_number`. A 11.3 corrige esse arquivo E corrige a nota em `.claude/rules/whatsapp-envio.md:102-105`.
3. *Pino da régua*: `regua.chamadores.test.ts:59-66` lê `flows/meta-send.ts`, mas o remetente da régua é `automations/meta-send.ts`. Ele só passa hoje porque os dois têm o mesmo trecho. Vai ser reescrito na 11.3.
4. *Onde muda o tipo `Contact`*: a tela o previa na 11.4, mas a saída precisa dele antes. **Vai para a 11.2.**
5. *Nomes do trato no pino da 1024*: as duas frentes propuseram nomes diferentes. Ficam unificados em `releitura-bsuid` (INSERT) e `preenche-em-branco` (UPDATE de telefone).
6. *Endurecer o CHECK contra `phone = ''`* (as duas frentes perguntaram). **Não agora.** Um CHECK que recusa `''` transforma uma regressão de merge em PERDA de mensagem: o 23514 não é absorvido e a Meta já recebeu 200. Sem ele, a regressão vira ficha duplicada. Quem protege é o teste da rota (`phone: null`, nunca `''`) mais a nota no `MERGE-UPSTREAM.md`.
7. *Apagar `pickContactDisplayName`* (`browser-notify.ts:163`, código morto do #259). **Não religar e não apagar**, pelo mesmo precedente do `media-lightbox.tsx`. Vai uma linha no `MERGE-UPSTREAM.md`.
8. *Ordem 11.2 × 11.3*: a entrada sozinha não é regressão, porque hoje o robô e a IA já falham com `phone ''` (`flows/meta-send.ts:115`). A ordem numerada fica valendo.

**Decisões técnicas tomadas aqui:**
- Busca por BSUID primeiro; o telefone só entra quando houver.
- Preenchimentos em UPDATEs **separados** do UPDATE de nome, cada um com objeto LITERAL e cerca no WHERE.
- `wa_user_id` só é preenchido quando está em branco (P4: a chave é por conta). `wa_username` e o pai são atualizados quando mudam.
- Na colisão, a mensagem fica na ficha achada pelo BSUID.
- O portão `!value.contacts` fica relaxado. Isso também conserta o TypeError com `contacts: []` (`route.ts:461`/`:864`).
- `recipient_type` segue o original.
- Modelo de categoria Authentication com alvo BSUID é recusado antes da Meta, com frase em pt-BR.
- A busca pelo @ entra no inbox e no seletor remoto. `/contatos` e a RPC 025 ficam como limite escrito.

**Ordem:** 11.1 → 11.2 → 11.3 → 11.4 → 11.5. Cada uma passa pelo portão da seção 4. A 11.1 é **aplicada antes do merge da 11.2**: ela alarga o CHECK, e sem ela o INSERT com `phone: null` leva 23514 e a mensagem se perde.

**11.1 — Migration `1041_cb_identidade_do_contato_com_bsuid.sql`**
Antes de criar, conferir `ls` e `list_migrations`.
- `SET LOCAL lock_timeout = '5s'`.
- DROP do CHECK pela FORMA (`pg_get_constraintdef ~ '\(instagram_id IS NOT NULL\)'`) e depois pelo nome.
- ADD `contacts_identidade_ck CHECK (phone IS NOT NULL OR instagram_id IS NOT NULL OR wa_user_id IS NOT NULL)`.
- Conferência:
  - UM CHECK de identidade, com as três pernas, validado;
  - o índice da 1038 de pé;
  - nenhuma ficha sem identidade;
  - subbloco desfeito por `SQLSTATE 'P1041'` (nunca `WHEN OTHERS`), no molde da 1024. Nele, duas fichas só-BSUID com `phone NULL` convivem, o mesmo BSUID colide (23505) e a ficha sem identidade é recusada (23514). Em banco vazio, `RAISE NOTICE`.
- Não cria objeto novo, então não há GRANT nem REVOKE.
- Prova num Postgres 16 descartável: vazio, com dado, reaplicada.

**11.2 — Entrada (`webhook/route.ts`, só Meta por construção: `resolveInboundMetaChannel` filtra `kind='meta'`)**
- **Novo `src/lib/whatsapp/identidade-na-entrada.ts`** (puro). Envolve `resolveInboundIdentity` e devolve `{ telefone: string|null, waUserId, waParentUserId, waUsername, nome: string|null }`. Regras: `''`→`null`; `from`/`wa_id` com cara de BSUID → telefone `null`; nome `''`→`null`; nunca `identityDisplayName`.
- **Novo `src/lib/contacts/bsuid.ts`**, com dois helpers:
  - `buscarPorBsuid(db, conta, bsuid)`: `.eq('account_id').eq('wa_user_id').maybeSingle()`, devolvendo `{contato, falhou}`;
  - `fichaQueVenceuPorBsuid`: reusa `ESPERAS_DA_RELEITURA_MS` (`dedupe.ts:175`).
- **`dedupe.ts` `findExistingContact`**: se o texto tem letra ou `isBusinessScopedUserId`, devolve `{null, falhou:false}` sem consultar. Os 8 finais de um BSUID casariam com o celular de um cliente.
- **`src/types/index.ts` `Contact`**: `wa_user_id?`, `wa_parent_user_id?` e `wa_username?`, com o comentário "só-BSUID = `phone` NULL".
- **`route.ts`**:
  - Tipos: `from?`, `from_user_id?`, `from_parent_user_id?`; `contacts?: WaContactPayload[]`; `recipient_id?` e `recipient_user_id?` no recibo (só tipo).
  - `:375` passa a ser `if (!value.messages) continue`; `:461` passa a ser `value.contacts?.[i] ?? value.contacts?.[0]`.
  - Em `processMessage`, sem telefone nem BSUID: log e return ANTES de `findOrCreateContact`/`findOrCreateConversation`.
  - `findOrCreateContact(conta, dono, identidade)` fica assim:
    - (a) busca por BSUID; senão, por telefone (só com telefone);
    - (b) ficha achada: até 4 escritas separadas:
      - nome, como hoje, com `.is('nome_fixado_em', null)`;
      - BSUID na ficha achada por telefone, com `.is('wa_user_id', null)`;
      - @ e pai na ficha achada pelo BSUID, com `.eq('wa_user_id', x)`, só quando mudou;
      - telefone na ficha achada pelo BSUID, com `.is('phone', null)` e `phone:` à vista.
      Nenhuma delas lança. 23505 no preenchimento é log com os dois ids, sem fusão.
    - (c) INSERT único: `{ phone: telefone ?? null, name: nome ?? telefone ?? null, wa_* }`;
    - (d) 23505: `fichaQueVenceuPorBsuid`, depois `fichaQueVenceu(telefone)`, e então o passo (b) na vencedora.
- **Pinos:**
  - `chave-canonica.chamadores.test.ts`: o trato do INSERT da rota passa a `releitura-bsuid`, que exige `fichaQueVenceuPorBsuid(` E `fichaQueVenceu(`; a rota entra em `UPDATES_DE_TELEFONE` como `preenche-em-branco`, exigindo `.is('phone', null)` + `isUniqueViolation(`.
  - `nome-fixado.chamadores.test.ts`: o manifesto da rota NÃO muda.
  - `dono-duravel.test.ts`: não muda, salvo decisão 7.
  - Novo `src/lib/contacts/bsuid.chamadores.test.ts`, default-deny: só a rota da Meta escreve `wa_user_id`.
- **Documentação:** uma linha na tabela de trechos NOSSOS do `docs/MERGE-UPSTREAM.md` (`phone` NULL, UPDATEs separados, cercas no WHERE, nome nunca BSUID; `pickContactDisplayName` não religar); `.claude/rules/ingestao.md`; `.claude/rules/supabase.md:351` (receita de fusão: zerar `wa_*` no perdedor antes de gravar no sobrevivente).
- **Testes (`route.test.ts`):**
  - portar os 9 casos do 2cf9806;
  - duas entregas só-BSUID → UMA ficha (`phone` null, não `''`), UMA conversa, UM `conversation.created`, e `new_contact_created` só na 1ª;
  - sem telefone, `findExistingContact` não é chamado;
  - telefone + BSUID sobre ficha de nome fixado → o BSUID é gravado e o nome fica;
  - `wa_user_id` diferente → não sobrescreve;
  - telefone já gravado → não sobrescreve;
  - 23505 no preenchimento (telefone ou BSUID) → mensagem gravada, log, nenhuma fusão;
  - corrida do INSERT → releitura por BSUID com nova tentativa;
  - nem telefone nem BSUID → nada criado;
  - reação só-BSUID → nada de ficha nova;
  - nome nunca vira BSUID nem @;
  - card "Novo contato";
  - payload antigo com telefone → mesmas consultas de antes;
  - entrega sem `contacts[]` → processada.
- **Mutantes que têm de morrer:**
  - sem `?? null` / `|| null`;
  - BSUID dentro do UPDATE de nome (com a guarda morre o teste da ficha fixada; sem ela, o pino nome-fixado);
  - `.update({...patch})` (morre a contagem de UPDATEs de telefone);
  - sem `.is('wa_user_id', null)`;
  - sem `.is('phone', null)`;
  - sem a releitura por BSUID;
  - descarte depois de `findOrCreateConversation`;
  - `identityDisplayName` como nome;
  - `findExistingContact` sem a guarda;
  - portão `!value.contacts` de volta.

**11.3 — Saída (alvo por BSUID só atrás de `ehMeta`)**
- **Novo `src/lib/whatsapp/alvo-de-envio.ts`** (puro): recebe `(contato, canal)` e devolve `{ok, alvo, ehTelefone}` ou `{ok:false, motivo}`.
  - Telefone válido vale em qualquer transporte.
  - BSUID só com `ehMeta(canal)`, via `resolveContactSendTarget`, sem alterá-lo.
  - Evolution sem telefone: recusa `so_numero_oficial`.
  - `wa_parent_user_id` nunca é alvo.
- **`send-message.ts`**:
  - `:310-334` passam a recusar só quando não há nem telefone nem `wa_user_id`;
  - o alvo passa a ser decidido DEPOIS do canal e das recusas (depois de `:442`/`:454`/`:475`);
  - o ramo Evolution (`:577`) exige `ehTelefone` e lança `not_supported` com frase em pt-BR;
  - no ramo Meta, variantes = `ehTelefone ? phoneVariants(alvo) : [alvo]` (`:725`) e a autocorreção `:754-765` fica **só com `ehTelefone &&`**;
  - Authentication + BSUID é recusado.
- **`flows/meta-send.ts`** (3 pontos: `:109-194`, `:274-368`, `:488-590`) e **`automations/meta-send.ts` `sendViaMeta`** (`:153-312`):
  - select passa a `id, phone, wa_user_id`, com `!contact`;
  - o alvo é decidido depois de `resolveEngineChannelPreferring`/`exigirWhatsApp`;
  - Evolution só com telefone, com frase própria. Hoje a frase é "contact not found", que engana; as recusas de Instagram em `:130/:295/:509/:174` são código morto e passam para a ordem nova;
  - variantes e autocorreção com `ehTelefone`.
- **`react/route.ts`**: `:78` passa a `contact:contacts(phone, wa_user_id)`; a exigência de `:104-109` sai do ramo Evolution; o Meta (`:132`) usa o alvo.
- **`transport/evolution-transport.ts` `toEvolutionNumber`**: lança se receber BSUID (segunda trava).
- **`api/whatsapp/send/route.ts`**: contato só-BSUID com conexão não-Meta é recusado ANTES de `pinConversationChannel` (`:178-190`).
- **`api/cb/scheduled/route.ts`**: 409 no agendamento (falha fechada). `not_supported` continua fora de `CODIGOS_POS_ENTREGA` (`dispatch.ts:143`).
- **Continuam só com telefone:** disparo em massa, régua, `send_to_number`, "nova conversa", `POST /v1/messages`.
- **Pinos e documentação:**
  - `regua.chamadores.test.ts` reescrito: lê `automations/meta-send.ts` e cobra `isValidE164(sanitizePhoneForMeta(...))` no ramo Evolution;
  - novo pino: nenhum ramo Evolution recebe alvo que não seja telefone;
  - `.claude/rules/whatsapp-envio.md:102-105` corrigido;
  - `docs/public-api.md`: o só-BSUID é alcançável por `/v1/conversations/{id}/messages`.
- **Testes:**
  - matriz do `alvo-de-envio`: Meta/Evolution × telefone válido/inválido/BSUID; LID não é aceito;
  - portar os 5 casos de `send-message.test.ts` do 2cf9806;
  - por remetente: corpo à Meta com `recipient` e sem `to`; Evolution recusa sem chamar o transporte; `contacts.update` nunca é chamado com alvo BSUID, nem depois de 131030;
  - `meta-api.recipient.test.ts`: reação, botões, lista;
  - agendada recusada com `entrega_incerta=false`.
- **Mutantes que têm de morrer:**
  - autocorreção sem `ehTelefone &&`;
  - alvo decidido antes do canal;
  - `phoneVariants` aplicado ao BSUID;
  - `toEvolutionNumber` sem a guarda;
  - `not_supported` em `CODIGOS_POS_ENTREGA`;
  - só o `flows/meta-send` corrigido (morre o teste de `sendViaMeta`).

**11.4 — Tela (identidade sem telefone, num lugar só)**
- **`src/lib/contacts/identidade.ts:16-32`**: `wa_username` na interface. A ordem é telefone → `@` do WhatsApp → `@` do Instagram (pende a decisão 2). Nunca o `wa_user_id`.
- **`src/lib/cb-groups/display.ts:52`**: passa a usar `nomeDoContato(...)`. Conserta de carona a ficha só-Instagram que hoje aparece como "Desconhecido" na lista.
- **Os 12 selects que embutem o contato com colunas nomeadas ganham `wa_username`**: `use-tarefas:81`, `use-radar:66`, `use-resumo-do-dia:153/293`, `use-area-de-trabalho:301/409`, `use-agendadas-da-conta:39`, `use-browser-notifications:112`, `flows/[id]/runs/route:50`, `automations/[id]/logs/page:56`, `dashboard/queries:520/531/552`, `seletor-de-contato-remoto:43`.
- **Seis `name || phone` crus passam a `nomeDoContato`**: `cb/agenda/route:121`, `cb/agenda/[id]/route:214`, `v1/meetings/route:190`, `cb/tldv/route:53`, `seletor-de-cliente:136-148`, `contacts/page:936`, `step3-personalize:238`.
- **Busca**: `filtros.ts` `casaComABusca` (`:390-411`) e `busca-remota.ts:142-146` passam a olhar `wa_username`, e `instagram_username` também no inbox.
- **Telefone apagável**: em `contact-detail-view.tsx:376-378` e `contact-form.tsx:172-175`, `podeFicarSem` também com `wa_user_id`. `contact-detail-view:547` passa a `nomeDoContato`.
- **Conforme as decisões**: seletor de conexão em `message-thread.tsx:2534-2557`; campos na v1 (`api/v1/contacts.ts`, `conversations.ts`, `webhooks/exemplos.ts`, `docs/public-api.md`).
- **i18n**: chave nova nos dois dicionários, com pino se for montada.
- **Pino default-deny**: `src/lib/contacts/identidade-nos-embeds.test.ts`. Todo select que embute `contacts(` com `instagram_username` precisa ter `wa_username`.
- **Testes:**
  - `identidade.test.ts`: só-BSUID com @ → `@user`; sem @ → `null`; com telefone → o telefone; os dois @ → a ordem decidida;
  - `tituloDaConversa`;
  - busca pelo @ (vazio não casa);
  - `podeFicarSem`.
- **Mutantes que têm de morrer:** identidade caindo no `wa_user_id`; embed sem `wa_username`; `tituloDaConversa` de volta a `name||phone`; `podeFicarSem` sem `wa_user_id`.

**11.5 — Ponta a ponta no preview (entregas assinadas com `META_APP_SECRET` local, `phone_number_id` do canal Meta)**
⚠️ O `.env.local` aponta para o banco de PRODUÇÃO. Antes de começar, conferir quais automações, robôs e IA estão ligados no canal Meta e se há funil padrão. A limpeza apaga a ficha de teste, que leva a conversa e as mensagens em cascata, e apaga também o card. Isso exige autorização explícita do operador na hora.

1. Duas entregas só-BSUID (`ZZ.…` fictício) → UMA ficha (`phone IS NULL`, `wa_user_id` gravado), UMA conversa, UM card "Novo contato". Conferir por SELECT.
2. Entrega com telefone fictício (conferido antes como livre) + o mesmo BSUID → preenchimento na MESMA ficha, sem ficha nova.
3. Tela: o @ na lista, no fio, no painel, na ficha, no aviso e no Meu dia. A busca pelo @ acha.
4. O compositor manda à Meta um corpo com `recipient`. A recusa numa conexão por QR Code sai com a frase clara.

**Limite:** o envio real a um BSUID só se prova com um cliente de verdade nessa situação.

**Limites que ficam escritos:**
- **Portfólio:** o BSUID vale só dentro do portfólio da Meta e a chave é por conta (P4). Hoje há 1 canal Meta. Um número de outro portfólio leva recusa da Meta, e a mesma pessoa ganha outro BSUID.
- **Fichas gêmeas:** Evolution, Asaas, Calendly, "nova conversa", CSV, v1 e Typebot casam por telefone e criam uma segunda ficha para quem só tem ficha por BSUID. A fusão segue a receita do `supabase.md`.
- **Envios:** o disparo em massa pula o só-BSUID, como o original. `{{contact.phone}}` fica vazio para essa ficha.
- **Busca:** `/contatos` e a RPC 025 não buscam pelo @.
- **Dono:** o `user_id` da ficha criada pela Meta é o dono da conexão, não `accounts.owner_user_id`. É pré-existente.

**Crítica de completude (9 faltas; entram na implementação da subfase indicada):**
- (média) Um remetente da API v1 ficou fora da 11.3. A linha proposta para o docs/public-api.md também está errada: `/v1/conversations/{id}/messages` não envia nada. O único caminho da v1 até uma ficha só-BSUID é `POST /v1/scheduled-messages`, e a recusa em 409 da 11.3 foi posta só na rota interna `api/cb/scheduled`.
- (média) O BSUID pode vir da entrada `contacts[]` de outra pessoa e ficar gravado na ficha errada para sempre. O desenho mantém o pareamento por posição com recuo para `contacts[0]`, e o `resolveInboundIdentity` aproveita o `user_id` do contacts[] quando a mensagem não traz `from_user_id`. Como o preenchimento usa `.is('wa_user_id', null)`, um BSUID errado nunca é corrigido: as mensagens só-BSUID da outra pessoa passam a cair nessa ficha.
- (média) O passo (a) não diz o que acontece quando `buscarPorBsuid` devolve `falhou: true`. O 23505 no preenchimento do BSUID deixa a mensagem na ficha achada pelo telefone. As duas coisas contrariam a decisão escrita no desenho: "Na colisão, a mensagem fica na ficha achada pelo BSUID".
- (média) O e2e da 11.5 não confere três efeitos colaterais em produção, e a limpeza deixa linhas órfãs. (a) O card criado enfileira um evento de funil, e quem o drena é o cron da VPS com o código de produção. (b) Automações com escopo de canal vazio disparam para qualquer número, então "as do canal Meta" não as cobre. (c) A rota emite eventos para os webhooks de saída da conta. (d) Apagar a ficha e o card deixa órfãs as tabelas com SET NULL.
- (média) No e2e, o `timestamp` das entregas fictícias tem de ser AGORA. Um carimbo antigo acende o alarme de entrega atrasada (`lagging`) na conexão Meta real. E "telefone fictício livre" tem de ser conferido pela régua de `findExistingContact`, não por igualdade.
- (baixa) A recusa "modelo Authentication + BSUID" só está prevista em `send-message.ts`. O passo `send_template` das automações envia modelo por outro remetente, que fica sem a guarda.
- (baixa) O pino `identidade-nos-embeds.test.ts`, como descrito ("select que embute `contacts(` com `instagram_username`"), não cobre parte dos lugares que a própria 11.4 lista. E os `name || phone` que passam a `nomeDoContato` leem selects sem `wa_username` nem `instagram_username`: trocar só a função continua mostrando o fallback, e o pino não reprova.
- (baixa) Faltam limites e buscas na lista. A busca de cliente da agenda é uma terceira busca, fora da 11.4. A RPC da lista do funil não traz o @, e os "limites escritos" citam só a RPC 025. Dois criadores de ficha gêmea não aparecem na lista.
- (baixa) Dois arquivos de teste da 11.3 não existem: vão ser criados do zero, não editados. E o pino default-deny `bsuid.chamadores.test.ts` cobre só `wa_user_id`, deixando de fora os escritores de `wa_username` e `wa_parent_user_id`, que a 11.2 também grava.

**Decisões (24/09/2026).** O operador respondeu a 1, a 2, a 3 e a 5 — em todas, a recomendação: ficha sem nome fica `name` NULO; `@usuario` puro (telefone → @WhatsApp → @Instagram); duplicata só no log; a API v1, os webhooks de saída e o MCP ganham `whatsapp_user_id`/`whatsapp_username`, só leitura. Na 4, na 6 e na 7 segue a recomendação sem pergunta (seletor desabilitado com o motivo; `{{contact.phone}}` só documentado; o dono durável da entrada da Meta corrigido num commit próprio da 11.2). O texto original das sete:
1. Ficha só-BSUID sem nome no perfil. Recomendação: `name` NULL, e o card nasce 'Novo contato' (o gatilho da 1008 troca pelo nome quando ele chegar). A alternativa é '@usuario', que congela o título, porque `cb_nome_para_titulo` lê '@x' como nome; mudar isso exige migration e afeta o Instagram também.
2. Exibição do @ do WhatsApp. Recomendação: '@usuario' puro, como já é com o Instagram. A alternativa é mostrar também de onde veio (WhatsApp ou Instagram). E na ficha que tem os dois @, qual aparece primeiro? Recomendação: telefone, depois @ do WhatsApp, depois @ do Instagram.
3. Ficha duplicada da mesma pessoa (uma achada pelo telefone, outra pelo BSUID): quando o telefone não pode ser gravado porque outra ficha já tem aquele número. Recomendação: nesta fase, só registrar no log, e a mensagem fica na ficha do BSUID. A alternativa é um aviso visível (bloco no Meu dia ou aviso na ficha) pedindo para unificar à mão.
4. Seletor de conexão na conversa, para contato sem telefone e com BSUID. Recomendação: desabilitar as conexões por QR Code e o Instagram, mostrando o motivo. A alternativa é deixar como está e contar com a recusa na hora do envio.
5. API v1, webhooks de saída e MCP: incluir `whatsapp_user_id` e `whatsapp_username` no contato (e no contato que vem dentro da conversa)? Recomendação: sim, só leitura. Sem isso, o integrador recebe `phone: null` sem nenhum identificador. Isso muda o contrato público da API.
6. Automações: para essa ficha, `{{contact.phone}}` sai vazio. Recomendação: apenas documentar. A alternativa é criar uma variável nova, como `{{contact.identidade}}`, que traria o @.
7. Dono das fichas e conversas que a entrada da Meta cria: hoje é o `user_id` de quem conectou o número, e não `accounts.owner_user_id` (o Instagram já usa o dono da conta). Se o login dessa pessoa for apagado, essas fichas são apagadas junto. Recomendação: corrigir em PR próprio, porque o problema é anterior ao BSUID e afeta todas as fichas da Meta. A alternativa é corrigir nesta fase.

Medido em 24/09/2026 para a decisão 7: hoje a única conexão oficial foi criada pelo dono da conta e nenhuma ficha tem outro dono — o defeito é latente aqui e real numa instalação em que outro admin conecta o número.

**Resultado:** — (a preencher)

### Fase 12 — Merge de ancestralidade e fechamento

> ⚠️ **Superada**: o merge aconteceu no #259 (23/09/2026), cru e antes das
> fases. O que resta da Fase 12 é o inventário da seção "O merge #259". O
> texto abaixo fica como registro do plano original.

`git merge 80c3f9a` em `chore/merge-upstream-2026-09-DD`. Todo conflito → o
nosso (já contém os ports). Apagar de novo: `ko.json`, `pt.json`, `es.json`,
`ci.yml`/`migrations.yml`, e os arquivos `040/041/042` deles (substituídos).
**Prova:** `git diff main <merge>` só lista sobras esperadas, cada uma revisada.
Portões, fumaça no preview, merge. Depois: bloco "Decisões fixadas no merge de
2026-09-DD" no `CLAUDE.md`. (O #229 já foi fechado em 21/09, decisão P1.)
⚠️ Se a P9 decidir trazer os 2 commits novos do original, o alvo do merge deixa
de ser `80c3f9a` e passa a ser o commit que os contém — e as medições da seção
2 são refeitas para a diferença.

**Resultado:** — (a preencher)

### O merge #259 (23/09/2026) — a Fase 12 aconteceu sem querer

**O fato:** o PR #259 (`chore/merge-upstream-2026-09-22`, 56 arquivos, sem
descrição) foi mesclado no `main` às 16:40Z por `devgabrielslv` e publicado
pelo pipeline. Ele é o `git merge` do original até `aee1b01f`, com os 43
conflitos resolvidos "o `main` vence, por arquivo inteiro". Ou seja: tudo o
que este plano previa portar fase a fase, com adaptação, entrou de uma vez —
cru onde não havia conflito, descartado onde havia.

**A auditoria (mesmo dia):** cinco lentes (telefone, conexão e modelos, robô
e telas, notificação e i18n, migrations e ancestralidade), cada uma com um
cético tentando refutar os achados — 10 agentes, só leitura dos objetos do
Git, e o banco medido à parte. O que ela confirmou que SOBREVIVEU: as guardas
de papel (`requireRole` nas 5 rotas, `barrarPorPapel` nas 2 nossas), o
`channelId` nos 5 call sites de `resolveTemplateRow`, o `resolveMetaChannel`
nos 7 chamadores, a guarda de SSRF do cabeçalho de modelo, o multi-segredo
da 3c, o escopo de canal dos construtores, o canal do passo 1 do disparo, o
recorte por perfil do menu, o `ko.json`/`ci.yml`/`migrations.yml`/`041`
fora, o `verify-schema.sql` com a nossa asserção, a paridade dos dicionários
(240 chaves unidas, nenhuma nossa apagada ou reescrita) e o webhook, o
núcleo de envio, os remetentes do robô, o fio, a lista e o compositor
intocados. A produção estava saudável na medição (as 5 conexões gravando,
rotas protegidas recusando).

**O que ela achou e onde foi resolvido:**

| Achado | Destino |
| --- | --- |
| O `+` obrigatório do #586 entrou pela METADE (pelos arquivos sem conflito): o formulário de contato RECUSAVA "(11) 99999-9999" em produção, e a API v1 de disparo recusa destinatário sem `+` — o contrário da P9. A nota do CLAUDE.md dizia que o #586 "ficou de fora" | formulário: **PR #265** (3-II); API de disparo: **3-III** (a chave de API ativa, "Automação - Make", não tem escopo de disparo — nenhum integrador afetado, medido) |
| 4 chaves REPETIDAS em `Contacts.importModal` depois do merge do #265 — as do #259 venceriam | **PR #265**, com o teste `chaves-duplicadas.test.ts` |
| `pt.json` e `es.json` do original (1.740 chaves contra 4.000+): a armadilha do `ko.json`; e o `docs/docker.md` passou a anunciar `en \| ko \| pt \| es` | **correção do #259**: apagados, pino `dicionarios-servidos.test.ts`, docker.md `en \| pt-BR` |
| O cartão "Notificações do navegador" montado em *Seu perfil* sem o ouvinte montado em lugar nenhum: a pessoa ligava, recebia o teste, e nunca a notificação real | **correção do #259**: o cartão sai até a Fase 8 (pino: cartão importado exige o ouvinte montado). ⚠️ Quem ligou a chave entre 16:40Z e o deploy da correção ficou com `wacrm:browser-notifications` no localStorage e a permissão concedida: a Fase 8 decide por escrito entre trocar a chave (zera o opt-in) e aceitar o antigo |
| `docs/whatsapp-connection-troubleshooting.md`: doc entregue a quem instala, em inglês, com "wacrm" sete vezes, descrevendo a tela legada que o fork não monta | **correção do #259**: apagada; ✅ a Fase 7 a reescreveu para *Conexões* (`docs/conexao-meta.md`, PR #285) |
| `0043`/`0045` abaixo da maior migration do `main` (a regra do `db push`), com cabeçalho do original (o `phone NOT NULL` que aqui é anulável desde a 0989), sem `lock_timeout` e não aplicadas | **correção do #259**: `1038`/`1039`, cabeçalho nosso, `lock_timeout`; aplicadas antes do merge |
| `Sidebar.title` recriada (o CLAUDE.md manda não recriar) e `fallbackAccountName` "our wacrm account" | **correção do #259**: apagadas; pino |
| As 2 guardas de papel só nossas sem teste nenhum | **correção do #259**: pino `guarda-de-papel-so-nossa.test.ts` (a ordem inclusive) |
| A nota do CLAUDE.md sobre o merge: números errados (195/242 em vez de 240/240), "nenhum código lê" (o hook lê `wa_username`), sem os arquivos auto-mesclados (dos 23 mudados pelos dois lados, 16 ficaram com trechos do original), sem pt/es, sem o cartão | **correção do #259** (e o #265 para o trecho do #586) |
| Stub de modelo desconhecido (#534) cru: resolve a conta por `whatsapp_config`, sem `channel_id`, com o `user_id` da config — inerte só porque a rota não passa o `wabaId` | **Fase 6b** (porte por `cb_channels.waba_id` + dono durável, e só então ligar o `wabaId`) |
| Upload de cabeçalho de vídeo/documento lê o corpo inteiro (`arrayBuffer`) antes de conferir o teto de 100 MB | **Fase 6a** (`lerComTeto`) |
| `Settings.templates.mediaHint` ainda diz "a Meta baixa uma vez… 24 h"; `.env.local.example` e `multi-waba.md` falam do `META_APP_ID` só para imagem | **Fase 6a** |
| A POST legada de `/api/whatsapp/config` seleciona `account_role` em `whatsapp_config` (não existe) e morre em 500 — PRÉ-EXISTENTE (75daeb97), deixa o #505 dela inalcançável | ✅ **Fase 7** (PR #285): aposentada (410); o #505 portado para `POST /api/cb/channels` |
| `meta-error-explain.ts` com "wacrm" no texto devolvido; `listWabaPhoneNumbers` segue `paging.next` sem cerca de host | ✅ **Fase 7** (PR #285): "the CRM"; cerca de `graph.facebook.com` e teto que lança |
| O comentário de `retentativa.ts` diz que a Cloud API lança `Error` genérico — agora é `MetaApiError` com `httpStatus` | ✅ **Fase 7** (PR #285): reescrito — ligar a Meta à retentativa ficou fora do plano |
| O ouvinte do #516, quando montado cru, avisaria mensagem de GRUPO, de conversa fora do perfil e a histórica (recuperada) | **Fase 8**, como a P2 já dizia |
| ~129 das 240 chaves unidas sem uso | **Fase 10** |
| Nenhuma entrada no CHANGELOG | **correção do #259** |

**Aceito:** o #259 não é revertido. Reverter um merge publicado é trocar
um estado conhecido e auditado por outro, e o que ele trouxe de útil (i18n
das telas do original, as bibliotecas das Fases 5 a 11) teria de voltar
depois. O caminho é corrigir o que a auditoria achou e seguir as fases.

**O que muda no método:** as Fases 4 a 11 continuam, mas como PORTES À MÃO
sobre um `main` que já tem os arquivos crus do original. O que o #259
DESCARTOU (caiu no "fica o nosso") não volta mais por merge — sem conflito e
sem aviso —, e só entra se alguém o trouxer:

| O que ficou de fora | Onde entra |
| --- | --- |
| `flows/engine.ts` do #553 (`{{vars}}` em botões e listas; e o nó de LISTA sem o canal do nó — achado nosso) | ✅ Fase 4 (PR #271) |
| `webhook/route.ts` do #535 (gravar o motivo), a bolha, os tipos e o espelho em `broadcast_recipients.error_message` | ✅ Fase 5 (PR #283) |
| a fiação do #534 (`wabaId: entry.id` na rota) | ✅ Fase 6b (PR #284) |
| `auto-reply.ts` e `flows/meta-send.ts` do #527 (o chamador do "digitando…"; `loadAccountMetaCredentials`), e a linha dele no `webhook/route.ts` (`inboundMessageId: message.id` na chamada de `dispatchInboundToAiReply` — sem o `wamid` o "digitando" não tem o que marcar) — ⚠️ a IA roda pelos DOIS transportes (a Evolution também chama `dispatchInboundToAiReply`), e o "digitando" só vale na Meta | Fase 9 |
| a montagem do ouvinte do #516 no `dashboard-shell.tsx` | Fase 8 (DENTRO da `<PortaDeEntrada>`) |
| a entrada e a saída do #519 (BSUID): `webhook/route.ts`, `send-message.ts`, `flows/meta-send.ts`, `automations/meta-send.ts`, `react/route.ts`, `contact-sidebar`, `contact-detail-view`, `message-thread` e os tipos (o serializador da v1 é ADAPTAÇÃO nossa, não código dele) | Fase 11 |
| o #577/#578 nos componentes NOSSOS (texto fixo em inglês em `message-composer.tsx`, `message-thread.tsx`, `automations/page.tsx`, `invite-member-dialog.tsx`, `ai-usage.tsx`…) | Fase 10 |
| os testes de regressão do original para esses caminhos | com cada fase |

A prova da Fase 12 muda de forma: não é mais "o merge deu diff quase vazio",
e sim `git diff aee1b01f origin/main -- <arquivo>` em cada arquivo da lista
acima, depois das fases, mostrando só divergência NOSSA.

## 8. Decisões pendentes do operador

| # | Decisão | Proposta | Trava qual fase |
| --- | --- | --- | --- |
| P1 | ~~Fechar o #229 agora (com comentário apontando para este plano) ou só no fim~~ | ✅ FECHADO em 21/09/2026 por ordem do operador ("siga com sua orientação e feche o PR, mantendo a worktree do plano com todas as correções ainda pendentes — pra que possamos ir corrigindo por aqui") | — |
| P2 | ~~Notificação: respeitar o perfil e deixar grupo de fora~~ | ✅ Decidida em 24/09/2026: só as conexões do PERFIL, grupo fora, e a pessoa pode DESLIGAR e CONFIGURAR a notificação do navegador | 8 |
| P3 | Apagar `pt.json`/`es.json` depois de aproveitar as traduções | Sim — ✅ feito em 23/09/2026 na correção do #259 (o #259 os tinha trazido de volta) | 10 |
| P4 | ~~BSUID: `NULL` + CHECK alargado, em vez de `''`~~ | ✅ Decidida em 24/09/2026: `NULL`, com a regra do banco alargada para "telefone OU Instagram OU BSUID"; a chave única do BSUID vale para a CONTA inteira (a que a 1038 já criou) | 11 |
| P5 | ~~Testes com efeito externo: modelo tarifado ao lead de teste (F2), modelo de teste na WABA (F6a), mensagem ao número oficial (F9)~~ | ✅ delegado pelo operador em 21/09 ("faça você o que precisar ser feito para o teste prático no preview e2e") — eu executo e limpo o que cada teste criar | — |
| P6 | ~~Alguma fase a DESCARTAR? (a 9 é inerte hoje)~~ | ✅ Decidida em 24/09/2026: manter todas. A 9 entra inerte — e o operador sabe que o "digitando…" da Meta marca a mensagem do cliente como LIDA (tique azul) | — |
| P7 | `agentRules: false` (o `next dev` da 16.3 não reescreve o `AGENTS.md`) — ou aceitar o bloco que o Next gera e commitá-lo | Manter desligado | nenhuma (já aplicado na Fase 1, reversível em uma linha) |
| P8 | ~~Restaurar para 4 as não lidas da conversa que o teste da Fase 1 abriu por engano~~ | ✅ feito em 21/09 (o operador: "faça o que precisar para o teste prático e2e") | — |
| P9 | ~~Os 2 commits que o original publicou DEPOIS do alvo (`b9969fa2` #586 e `f8a1cc72`): fase extra antes do fechamento, ou próximo ciclo?~~ | ✅ Resolvida na retomada (23/09/2026): a metade ADITIVA do #586 entrou com a NOSSA régua — o 55 completado no número brasileiro digitado sem `+` — e partiu a Fase 3 em 3-I a 3-IV; o `+` obrigatório ficou de fora (formulário no PR #265, API no #276). O `f8a1cc72` só traz chaves de `pt`/`es`, que não servimos (P3). Desde o #259 os dois são ancestrais do `main` | — |

## 9. Diário

| Data | Fase | O que aconteceu |
| --- | --- | --- |
| 21/09/2026 | 0 | Medições da seção 2; estratégia "portar primeiro"; worktree criada; o #232 entrou no `main` no meio da medição sem mudar os conflitos. Linha de base: 362 arquivos / 4.710 testes verdes; `npm audit` com 12 vulnerabilidades (1 crítica). |
| 21/09/2026 | 1 | Dependências do upstream aplicadas: `npm audit` 12 → 0. As duas lentes não acharam P0. A Lente 2 pegou o `next dev` da 16.3 reescrevendo o `AGENTS.md` (→ `agentRules: false`). A Lente 1 mostrou que o teste em `next dev` não exercitava o roteador novo (→ refeito num build de produção local: limpo). Dois erros MEUS de teste viraram regra do protocolo: abrir conversa de cliente real zera as não lidas, e painel oculto congela o `requestAnimationFrame`. |
| 21/09/2026 | 2 | A função de disparo NUNCA tinha executado (42702) — e as duas lentes acharam o que o upstream não tem: os parâmetros por destinatário chegavam em 2-D pelo PostgREST (Lente 1) e a rota descartava o `channel_id` (Lente 2). Na 2ª passada, a Lente 1 derrubou uma medição MINHA ("23502") feita num dublê com `NOT NULL` que a produção não tem. Ordem com migration: rascunho → replay verde no commit exato → `1030` aplicada (`20260921164342`) → teste prático: 5 recusas em 400 sem gravar nada, o PRIMEIRO 202 do endpoint, params como lista pelo PostgREST real → chave de teste revogada na hora (0 chaves ativas). Achado fora do escopo: a Meta aceitou e depois falhou a ENTREGA do modelo de Marketing fora da janela, e o motivo se perdeu — é o defeito da Fase 5, que ganhou um caso de teste real. |
| 21/09/2026 | 2 (fecho) | Codex SEM COTA no HEAD → terceira revisão independente no lugar dele: nenhum P0/P1; os 2 P2 e 3 P3 corrigidos (pino do salto núcleo → resolvedor, `null` = ausente, ordem da validação, mensagem do `verify-schema`, doc), 1 P3 corrigido em parte (o pino do filtro por conta entrou; o `error` descartado e o `status` não conferido de `resolveMetaChannel` viraram cartão) e 2 P3 aceitos por escrito. Merge 17:27Z, rollout 17:33Z na primeira tentativa. Pós-deploy: a sonda inverteu (rota antiga → rota nova; `GET` sem → com `channel_id`), saúde e ingestão conferidas, zero chaves ativas. **Operador pediu pausa antes da Fase 3.** |
| 21/09/2026 | 0 (P1) | **#229 FECHADO** por ordem do operador, com comentário explicando por que não podia ser mesclado (origem = o `main` do próprio original; conteúdo que muda sozinho; 19 PRs num deploy só) e apontando para este plano. A worktree fica de pé para as correções seguirem por aqui. Na conferência, o original tinha ANDADO: `upstream/main` = `aee1b01f`, 2 commits depois do alvo — o #586 (exige `+` e código do país; 21 arquivos, vários da Fase 3a) virou a decisão P9. |
| 22/09/2026 | 3 (plano) | A pedido do operador, o cartão do `resolveMetaChannel` (P3 da revisão final do #242) entrou no plano como **item 3e**, depois de confirmado no `origin/main` (`ba5612ef`): o `error` descartado na busca por id, na lista e no espelho, e o `status` não conferido. Levantados os 7 chamadores (6 arquivos), todos traduzindo `null` em 400. Nada implementado — a pausa antes da Fase 3 continua. |
| 23/09/2026 | 1b | Acrescentada a pedido do operador ("siga agora com todo o plano"): os 3 PRs de segurança ABERTOS do mantenedor valiam aqui, e o download da mídia do Instagram tinha SSRF com leitura. O #587 foi resolvido no meio da fase por OUTRA sessão (#260); ficou a versão dela, e esta fase acrescentou o que faltava. Quatro rodadas do Codex (3 com P2, todos corrigidos; a 4ª limpa). Mesclada e publicada; pós-deploy conferido. |
| 23/09/2026 | 3-I | A P9 resolvida (a metade aditiva do #586, com a nossa régua) partiu a Fase 3 em quatro. 3b/3c/3e entraram, a 3d fechou sem mudança. A Lente 2 MEDIU em bash que `a, b` no `crm.env` apaga o `META_APP_SECRET` inteiro (401 em todo webhook) → a doc manda escrever sem espaço. Codex limpo na 1ª rodada. |
| 23/09/2026 | 3-II | O telefone digitado nas telas e nas planilhas passa pela nossa régua, e a importação conta o inválido à parte (#529). As duas lentes, independentes, acharam o mesmo P2 — o número copiado do WhatsApp traz marcas invisíveis e era recusado —, e a Lente 1 achou o `.0` de planilha do pandas virando +81. Os dois P2 "de dado antigo" foram MEDIDOS na produção antes de decidir: zero casos. Um mutante escapou do pino na 1ª rodada e a decisão das telas virou um helper só. |
| 23/09/2026 | #259 | O merge CRU do original (`aee1b01f`) entrou no `main` por outra pessoa e foi publicado, com as Fases 4 a 11 dentro e a ancestralidade fechada. Auditado por 10 agentes (5 lentes, cada uma com um cético): as guardas do fork sobreviveram; o `+` do #586 entrou pela metade (o formulário recusava número brasileiro sem `+`), voltaram `pt.json`/`es.json`, um cartão de notificação sem ouvinte, uma doc da tela que não existe, e as migrations com número fora da regra. Consertado no #265 e no PR de correções do #259; o resto foi distribuído às fases, e a Fase 12 virou inventário. |
| 23/09/2026 | 3-IV, #259, 4 | O CI dos PRs #265, #269, #270 e #271 ficou horas parado pelo limite de downloads do GHCR (incidente do GitHub); outra sessão consertou o pipeline (#274, a CLI cai para outros registros) e trouxe o `main` às branches — conferido: merges automáticos, árvores idênticas às do Git. Ordem de merge: #265 → #269 → #270 → #271, cada um com o `main` anterior dentro; a `1038`/`1039` aplicadas ANTES do #270 (histórico `20260923202446`/`20260923202453`). O #271 e a resolução do conflito do #273 foram feitos pelo Gabriel no meio da fila — conferido: ele mesclou a cabeça já resolvida do #271, e a resolução do #273 só tirou as marcas do CHANGELOG. Pós-deploy de cada um: saúde anônima e ingestão viva. Codex sem cota em todos. |
| 23/09/2026 | fora do plano | Relato do operador na mensagem de teste da Fase 4: a conversa "não aparecia" na caixa de entrada até recarregar. Medido: a lista nunca reordenava pelo tempo real (defeito do original) — a conversa reaberta entrava em Abertas na posição da carga, abaixo da dobra. PR #273: ordena como o banco e só avança hora/prévia; a revisão pegou o aviso de sistema do grupo subindo a linha. Reproduzido antes e conferido depois no preview, só no lead de teste, e desfeito. |
| 23/09/2026 | 3-III | A API v1 (contatos, mensagens, disparo) e a "Nova conversa" passam pela régua da 3-II; `parseInternationalPhone` sai do código. As duas lentes acharam, independentes, a mesma frase falsa na doc pública ("lido exatamente como antes"), e a Lente 2 mostrou que o pino deixava a rota da "Nova conversa" voltar ao defeito por `normalizePhone`. O P2 do disparo (ficha casada pela tolerância) foi refutado pelo cético — anterior à fase, virou pendência, junto com o webhook de entrada fora da régua. |
| 23/09/2026 | fora do plano | O passo "Enviar para um número" das automações lia o telefone pela régua dos sistemas ("98000-0016" virava +98; um `…@lid` virava telefone). PR #282: a régua das telas na ativação, no motor, no resumo e no campo do construtor; o CHANGELOG traz a consulta das automações antigas afetadas. Mesclado por outra sessão com a cabeça anterior — conferido: árvore idêntica. |
| 24/09/2026 | 5 | O motivo da falha da Meta gravado na mensagem e no disparo, nos mesmos updates condicionais da escada; o `errors[0]` lido por parse (código estranho, NUL e surrogate solto derrubariam o UPDATE — medido num Postgres 16). PR #283, rollout 00:24Z; pós-deploy: a primeira mensagem entrou às 00:47Z. Falta o disparo REAL fora da janela (depois de 24/09 19:14Z). |
| 24/09/2026 | 6 | 6a (o teto na leitura do cabeçalho) e 6b (o stub por `cb_channels`). A revisão em duas lentes achou 4 P2 — o mais sério, o stub de corpo vazio virando o modelo do envio e derrubando o envio pelo nome com variáveis; consertado lendo o modelo na Meta com a conversão da sincronização (`modelo-da-meta.ts`). E2E refeito contra a Meta; mutantes 20/20. Dois workers de mutante órfãos (stream sem fim, rodada anterior) giraram 7,5 h e derrubaram a suíte por carga — mortos, e a regra foi para o handoff. PR #284. A passagem de sessão está em `docs/HANDOFF-merge-upstream-2026-09.md`. |
| 24/09/2026 | 7 | O #505 portado para *Conexões* (`POST /api/cb/channels`): o motivo da falha em lista fechada, traduzido num aviso que fica, com o campo destacado, o código e o trace id; o par WABA/número conferido; a assinatura da WABA fatal; o token limpo das mensagens da Meta; `paging.next` cercado; o token do upload fora da URL; o POST legado aposentado (410). Duas lentes: nenhum P0–P2, quatro P3 corrigidos. O teste com o token REAL da conexão oficial (só leituras, autorizado pelo operador) mostrou que a WABA trocada volta "nonexisting field" e era lida como "valor recusado" — a frase entrou na regra. Mutantes 21/21. Pós-deploy da Fase 6 registrado. PR #285. |
| 24/09/2026 | fora do plano (instruções) | O `CLAUDE.md` (626 KB, carregado INTEIRO em toda sessão e de novo a cada compactação; um subagente estourou 211 mil tokens antes de começar) virou uma raiz de 36 KB com as regras transversais e as decisões do operador, 32 regras de área em `.claude/rules/` (cada uma com `paths:`, só carregam quando a Read abre um arquivo da área) e duas listas de consulta (`docs/MERGE-UPSTREAM.md`, `docs/MIGRATIONS-APLICADAS.md`). Portão novo `scripts/instrucoes.test.ts` (teto de 40 KB/25 KB, `paths:` obrigatório, glob morto reprova, índice completo) e a consulta `scripts/regras-do-diff.mjs`. Seis revisores de cobertura, um por faixa do texto antigo (~1.160 regras conferidas), acharam 18 faltas, todas corrigidas, e nenhuma distorção além de um intervalo Unicode escrito com os caracteres literais; a segunda lente corrigiu a visibilidade (regra que só carregava longe de quem precisa dela). No mesmo PR: o pós-deploy da Fase 7, a P9 resolvida, P2/P4/P6 decididas pelo operador e a nota do Sincronizar corrigida. PR #286: merge `9da89dcb` às 16:06:16Z, rollout "converged" às 16:12:48Z na primeira tentativa; saúde anônima em ordem e ingestão viva. |
| 24/09/2026 | 8 | O #516 portado: `silencioDoAviso` (perfil pelo contexto real, grupo fora, "quais conversas", mensagem gravada mais de 1 h depois calada), preferência por pessoa, cartão de volta com as duas configurações (P2). Duas lentes: um P2 das duas (o clique com o inbox já montado só trocava a URL) e dois P3 (celular; conversa nova sem canal), corrigidos; 5 refutados. Mutantes 18/18. E2E na preview com mensagens inseridas direto na conversa do lead de teste, limpas no fim. PR #287. |
| 24/09/2026 | 9 | O #527 portado: `mostrarDigitando` pelo MESMO canal da resposta (não pelas credenciais da conta, como o original), só Meta e com `wamid.`, sem `await`, log sem token; a ajuda da resposta automática avisa do "lida" (P6). Teste contra a Meta real no `wamid` do lead de teste. Duas lentes: dois P3 corrigidos, quatro refutados. PR #288. |
| 24/09/2026 | Codex (8, 9, instruções) | A cota do Codex voltou às 17:05Z e ele revisou os seis PRs que tinham ficado sem ele: #283, #284, #285 e #288 sem achados; #287 (Fase 8) com um P1 (conversa sem pino lia o número velho) e um P2 (atribuição da automação depois do INSERT); #286 com um P2 (arquivo movido entre áreas). PR #289 com os três, e mais três rodadas do Codex nele (sono fixo → estacionar até a atribuição; 1 h; a antiga antes). O Codex mudou de formato no mesmo dia: um resumo "Running" editado para "Completed", 👀 e 👍 — o poller antigo, que filtrava por horário, deu "sem resposta" com dois P2 esperando. |
| 24/09/2026 | 10 | O inglês fixo das telas NOSSAS para o dicionário (10a–10d, com um agente por fatia) e 183 chaves órfãs fora; a revisão em três lentes achou dois P3 (a presença dizendo "ontem" sobre 24 h; o pino do `gateReason` furado pelo `as`), e o preview mais três (o plural dos disparos, o "Notifications alt+T" do leitor de tela, o aviso de atribuição gravado em inglês pelo gatilho da 0027) — 10e. Pós-deploy da Fase 9 registrado. |
