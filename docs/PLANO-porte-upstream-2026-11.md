# Plano — porte do upstream (lote `34bce1a8..c81299d1`, 16–30/10/2026)

Documento INTERNO e VIVO. Quem edita: só o orquestrador (a sessão que abriu os
lotes). Os lotes LEEM; o que cada um descobre vai no relatório dele e na
descrição do PR dele.

Origem: análise de 17/11/2026 dos 11 PRs do original `ArnasDon/wacrm` (#679,
#680, #681, #682, #683, #697, #700, #715, #720, #721, #722), reconferida item a
item no nosso código e medida na produção (só leitura). Sem merge do upstream:
a ancestralidade continua em `aee1b01f` e tudo entra por PORTE MANUAL
(`docs/MERGE-UPSTREAM.md`, §3.4 e §3.5).

## Situação dos lotes

| Lote | Sessão | Situação | Branch | PR (base = integração) |
|---|---|---|---|---|
| A — Contatos, funil e robô | `lote-a` | integrado; revisão independente aprovada | `fix/porte-upstream-2026-11-a` | #529 |
| B — Pequenos | `lote-b` | integrado; revisão independente aprovada | `fix/porte-upstream-2026-11-b` | #526 |
| C — API pública, webhooks e MCP | `lote-c` | integrado; revisão independente aprovada | `fix/porte-upstream-2026-11-c` | #527 |
| D — Modelos da Meta | `lote-d` | integrado; revisão aprovada, ajustes do orquestrador (`00ce643d`) | `fix/porte-upstream-2026-11-d` | #530 |
| E — Equipe e permissões | `lote-e` | integrado; revisão aprovada, ajustes do orquestrador (`3a4f2ac3`) | `fix/porte-upstream-2026-11-e` | #531 |
| F — Disparo | `lote-f` | integrado; revisão aprovada, ajustes do orquestrador (`2184bad5`) | `fix/porte-upstream-2026-11-f` | #528 |

Os seis lotes foram mesclados na integração (17/11/2026) e revistos, cada um,
por um revisor independente: nenhum P1 nem P2. Os P3 que valiam foram
corrigidos na integração; o resto está na §13.

Decisões dos checkpoints 1 (17/11), além das recomendações de cada lote:
B não faz escrita "sem efeito" em aviso real; C prova o C4 só por teste; E
confere a 1148 na produção pelo modelo da 1067 (subbloco desfeito, dado
sintético, conferência que aborta) e só atribui a conversa do lead de teste se
nenhuma automação ligada escutar atribuição; F faz a trava do envio pela API;
o modelo nomeado de teste na Meta (D) fica para depois do merge, com o OK do
operador.

Branch de integração: `chore/porte-upstream-2026-11` (cortada do `main` em
`c86812b1`). Pasta do orquestrador:
`.claude/worktrees/porte-upstream-2026-11`.

## 0. Decisões do operador (17/11/2026)

- **#16 Remover membro devolve as conversas à fila: SIM** (com a correção das
  que já estão assim — hoje nenhuma na produção).
- **#17 "O Visualizador continua podendo subir arquivo fora das anotações?":
  SIM** → nada muda no `chat-media` (confirmado pelo operador em 17/11).
- **#18 Botão direito na mensagem: MANTER o nosso comportamento**; só corrigir
  erro, se existir (checagem no Lote B).
- **#19 A API renomeia o contato existente: MANTER como está.**
- **Demais: a recomendação do orquestrador.** `cpus: 4` entra (inofensivo aqui;
  ajuda quem instala e compila em servidor da Hostinger). Os itens de baixa
  prioridade entram TODOS, com as cercas de cada um.

## 1. Como cada lote trabalha (vale para todos)

### 1.1 Ordem de trabalho

1. **Ler, pela ferramenta Read:** `CLAUDE.md`, `AGENTS.md`, este plano (§0–§3 e
   a seção do seu lote) e as regras de área de `.claude/rules/` de TODO arquivo
   que for tocar (`node scripts/regras-do-diff.mjs --caminho <arquivo…>` diz
   quais). Memórias a ler: `sessoes-paralelas-worktree.md`,
   `worktree-guard-do-bash.md`, `preview-em-worktree-isolada.md`,
   `verde-local-vermelho-no-ci.md`, `lead-de-teste-autorizado.md`,
   `codex-conferir-revisao-final-antes-do-merge.md`,
   `banco-no-teto-de-conexoes.md` e, se o lote tem migration,
   `postgres-local-para-testar-migration.md`.
2. **Pasta e branch:** a sessão nasce numa worktree própria cortada do `main`.
   Renomear a branch para `fix/porte-upstream-2026-11-<letra>`
   (`git branch -m`). Copiar o `.env.local` do checkout principal e clonar o
   `node_modules` (`cp -cR`, clone APFS) — receitas nas memórias acima. Dev
   server na PORTA DO LOTE (§2), por Bash em segundo plano, aberto no Browser
   pane por URL.
3. **ANÁLISE — checkpoint 1.** Para cada item: confirmar o defeito no NOSSO
   código (caminho:linha); ler a correção do original
   (`git show <commit>` / `git diff <merge>^1 <merge> -- <arquivo>`); riscos;
   **blast radius** (quem chama, que telas, rotas, automações, integrações,
   contratos e pinos mudam; migration aditiva ou restritiva); plano de teste
   e de e2e. Encerrar o turno com o relatório (cabe numa tela) e ESPERAR o
   "pode seguir" do orquestrador. Dúvida → pergunta no COMEÇO do relatório.
4. **Implementar** cada item adaptado ao NOSSO código. Nunca copiar arquivo do
   original por cima do nosso; módulo novo > reescrever o core; trecho nosso em
   arquivo que veio do upstream (`git cat-file -e aee1b01f:<caminho>`) vira
   uma linha para a §4 do `MERGE-UPSTREAM.md` (lista no PR, ver 1.2).
5. **Testes locais em Node 22:** `npm run typecheck`, `npm run lint`,
   `npm run test` (vitest pelo caminho absoluto do checkout principal se
   preciso — memória `verde-local-vermelho-no-ci`), `node scripts/i18n-parity.mjs`,
   e `node scripts/doc-acompanha.mjs` se tocar contrato de integração.
   Migration: replay no Postgres local (§1.4) + cenários com dado fictício.
6. **E2E no preview** com as cercas da §1.3, guardando a prova (captura ou
   leitura da página/rede).
7. **Revisão em duas lentes** (bugs e bordas; convenções e objetivo) + UM
   revisor independente (subagente, modelo forte) sobre o diff. Corrigir.
8. **Commit e push** da branch do lote (nunca `git add -A`; conferir
   `git branch --show-current` antes). Mensagens em português; terminar com
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
9. **PR com BASE `chore/porte-upstream-2026-11`** (nunca o `main`), corpo em
   arquivo (`gh pr create --base chore/porte-upstream-2026-11 --body-file …`).
   Codex: revisa ao abrir; se não começar em ~5 min, comentar `@codex review`.
   Cada rodada: os achados num push só + UM `@codex review`; casar a revisão
   com o SHA do HEAD (memória do Codex). Cota esgotada ("usage limits") =
   revisão NÃO aconteceu: avisar no relatório.
10. **Checkpoint 2 — relatório final** (encerrar o turno): o que mudou por
    item, testes, e2e (prova), rodadas do Codex e o HEAD limpo, riscos que
    sobram, linhas para a §4, roteiro de e2e pós-migration (se houver) e
    pendências. NÃO mesclar o PR: quem integra é o orquestrador.

### 1.2 O que o lote NUNCA faz

- PR para o `main`, merge de qualquer PR, push no `main`, `push --force`.
- Aplicar migration ou escrever no banco de produção por SQL. Leitura pelo
  `supabase-cb`, UMA consulta por vez, pequena (o banco está no teto de
  conexões).
- Editar `docs/MERGE-UPSTREAM.md`, `docs/MIGRATIONS-APLICADAS.md` ou este
  plano: o lote LISTA no PR (seção "Para o orquestrador") as linhas da §4 e
  qualquer nota para esses arquivos.
- Tocar arquivo que a §3 dá a outro lote sem combinar com o orquestrador.
- Apagar worktree, branch ou dado que não criou.
- Mandar mensagem ou modelo a cliente real; editar modelo real da Meta (a
  edição volta o modelo para PENDING e para o envio); mover para a Lixeira,
  apagar ou alterar ficha, funil, etapa, membro, automação ou robô REAIS.

### 1.3 Testes contra a produção (o `.env.local` aponta para ela)

- Mensagem: só para o lead de teste autorizado (memória
  `lead-de-teste-autorizado.md`; abrir a conversa errada zera não lidas).
- Escrita que o teste exige: só registro FICTÍCIO criado pela própria sessão,
  com "TESTE porte-upstream" no nome, removido no fim. Listar no relatório o
  que foi criado e removido.
- Funcionalidade que depende de migration nova: provar no Postgres local; o
  e2e com a migration vira ROTEIRO no relatório (o orquestrador roda depois de
  aplicar com o "pode gravar" do operador).
- Nunca `supabase db push`. Nunca registrar webhook de provedor a partir do
  preview.

### 1.4 Postgres local para migration

A ferramenta é `~/Downloads/CB-CRM/ferramentas/pg-replay/recriar.sh`
(porta 54331, dados na própria pasta). Três lotes têm migration: cada um
COPIA a pasta (sem `dados/`) para o próprio scratchpad e troca a porta para a
do lote (§2) antes de rodar — a pasta compartilhada derrubaria o banco do
outro. Esqueleto sem GRANT que o CI não dá (memória).

### 1.5 CI — por que os PRs dos lotes não vão ao `main`

O `pipeline.yml` roda só em PR para o `main` e em push no `main`. PR com base
na branch de integração NÃO roda CI, mas recebe a revisão do Codex. No fim,
UM PR da integração para o `main` roda o CI (verificar, replay das migrations,
documentação) e o Codex sobre o conjunto; o merge dele é o único deploy.

## 2. Lotes, migrations e portas

| Lote | Itens (numeração da análise) | Migration (provisória) | Porta do dev | Porta do Postgres local |
|---|---|---|---|---|
| A — Contatos, funil e robô | #1, #2, #3, #21 (6 do robô) | — | 3101 | — |
| B — Pequenos | #4, #13, #14, #15, #18 (checagem), #20, #22 | — | 3102 | — |
| C — API pública, webhooks e MCP | #9, #10, #11, #12 | — | 3103 | — |
| D — Modelos da Meta | #5, #6, #23, #25 | `1150` (restritiva) | 3104 | 54341 |
| E — Equipe e permissões | #7, #16, #24 | `1148` (antes do deploy), `1149` (restritiva) | 3105 | 54351 |
| F — Disparo | #8 + destinatários acima de 1.000 | `1147` (aditiva) | 3106 | 54361 |

Números PROVISÓRIOS (o maior no `main` é a `1146`, conferido em 17/11 em todas
as worktrees e branches remotas). O orquestrador reconfere antes de aplicar e
renumera se outro PR chegar antes. Nome: `NNNN_cb_<descricao>.sql`.

## 3. Dono de cada arquivo

Cada arquivo de código tem UM lote dono (o que a seção do lote lista). Os
compartilhados:

- `messages/en.json` e `messages/pt-BR.json`: todo lote acrescenta chave nos
  DOIS, dentro do objeto da própria tela, perto das chaves vizinhas — nunca no
  fim do arquivo. Conflito de linha vizinha o orquestrador resolve.
- `docs/public-api.md`, `docs/webhooks.md`, `docs/mcp.md` e
  `src/components/settings/documentacao-de-integracao.tsx`: dono = Lote C. O
  Lote D escreve só a parte das variáveis nomeadas (se mudar o que a API
  aceita).
- `src/lib/whatsapp/broadcast-core.ts` e `src/app/api/v1/broadcasts/route.ts`:
  dono = Lote C. O Lote F, se precisar deles para a posse do envio, combina
  com o orquestrador.
- `.claude/rules/whatsapp-envio.md` estava a 41 bytes do teto (17/11): só o
  Lote D a edita, movendo "Modelos da Meta" para
  `.claude/rules/modelos-da-meta.md` (+ uma linha no índice da seção 13 do
  `CLAUDE.md`, único lote que toca o `CLAUDE.md`). A e F mandam as notas de
  "Robô e fluxos" e "Disparo" no PR ("Para o orquestrador").
- `src/app/api/v1/broadcasts/route.ts`: C mexe só no objeto da resposta
  (`duplicates`); F mexe só no bloco do `after()` (a trava da retomada no envio
  pela API).
- `src/hooks/use-broadcast-sending.ts`: dono = F; o D altera SÓ a função
  `resolveVariables` (variáveis nomeadas).
- `mcp-server/`: dono = C (inclui a frase das variáveis nomeadas que o D
  definiu). `docs/public-api.md`: dono = C, menos os parágrafos das nomeadas
  (bloco `params` do `POST /messages` e a frase do `POST /broadcasts`), do D.
- `docs/DECISOES-DO-OPERADOR.md`: só o Lote E (#16–#19). `docs/ATUALIZAR.md`:
  só o Lote D (nota da 1150).
- `docs/MERGE-UPSTREAM.md`, `docs/MIGRATIONS-APLICADAS.md`, este plano: só o
  orquestrador.

## 4. Lote A — Contatos, funil e robô

Original: #679 (`4e9bbd76`; commits `a482da9f`, `aad10904`) e a parte do robô
do #683 (`5262f138`; `cebea5f1`, `3de12605`); a detecção de ciclo vem do #674
(lote anterior; ver §3.5 do MERGE-UPSTREAM).

- **A1 (#1) Contatos: a última página some depois da Lixeira.** Mover para a
  Lixeira todas as fichas da última página mostra "Nenhum contato ainda." com
  "Página 3 de 2", ou "Falha ao carregar" com as fichas já movidas na tela (o
  pedido passa do total; o PostgREST devolve `PGRST103`). Solução: voltar para a
  última página que existe (ideia do `page-bounds.ts` deles). Nosso:
  `src/app/(dashboard)/contacts/page.tsx` (~170–248; vazio ~641–649). Cuidar de
  `silencioso`, `preservarSelecao`, `podarSelecao` e de não entrar em laço na
  página 0.
- **A2 (#2) Contatos: buscar telefone formatado não acha a ficha.**
  "(83) 98874-5316" não acha "+5583988745316". Solução NOSSA: usar
  `ramosDaBuscaDeContato` (`src/lib/contacts/busca-remota.ts`: dígitos e as
  duas grafias do nono dígito, `phone_normalized`) + o ramo de e-mail; NÃO
  trazer o `search-filter.ts` deles. A busca de 1 letra continua funcionando
  (o helper exige 2). No filtro por etiqueta (RPC 025), termo com cara de
  telefone vai como dígitos; ficha gravada com pontuação continua sem casar ali
  (limite aceito, 1 de 1.214 em 20/09) — mudar a RPC seria migration:
  perguntar antes. Atualizar o pino `src/lib/postgrest/literal.chamadores.test.ts`
  (decisão visível) e a nota de limite em `.claude/rules/contatos.md`.
- **A3 (#3) Gerenciar funil não atualiza o quadro.** Adicionar ou remover
  etapa grava na hora, mas o quadro só muda depois de "Salvar"; e o "Salvar"
  recria etapa que outro admin apagou com a janela aberta. Solução:
  `onStagesChanged()` depois de adicionar e de remover; antes do upsert, ler
  os ids que ainda existem e gravar só esses, mantendo as nossas colunas
  (resultado, degrau, desfecho, próximas etapas, situação, desqualificação,
  campo do motivo). NÃO trazer o `reconcileStages` (a nossa janela lê do
  banco — `funil.md`). Nosso: `src/components/pipelines/pipeline-settings.tsx`
  (~232–394).
- **A4 (#21) Editor do robô: "Ativar" segue com o "Salvar" falho.** `save()`
  engole o erro e `setStatus('active')` ativa assim mesmo. Solução: `save`
  devolve sucesso; a ativação para se falhar. Nosso:
  `src/components/flows/flow-editor-state.tsx` (~389–445).
- **A5 (#21) Editor do robô: "Adicionar nó" devolve a chave errada** na
  primeira adição depois de abrir/salvar (o `setDirty(true)` antes impede o
  cálculo imediato do updater; o nó antigo do mesmo tipo pula para o centro).
  Solução: calcular a chave pela lista mais recente (ref), fora do updater; o
  teste deles (`flow-editor-state.test.ts`). Nosso: mesmo arquivo (~531–555)
  e `flow-canvas.tsx` (~726).
- **A6 (#21) Motor: erro passageiro ao ler os nós encerra a execução.**
  `loadAllNodes` devolve mapa vazio no erro (`src/lib/flows/engine.ts` ~329).
  Solução: "não sei" — a execução segue/repete depois, sem virar `failed`. O
  `loadFlow` que devolve nulo FICA (é usado de propósito para o robô
  desativado — `whatsapp-envio.md`, "Robô e fluxos").
- **A7 (#21) Motor: duas respostas fora do esperado repetem os botões ou
  encerram em dobro.** O contador de re-pergunta sobe sem cerca
  (`engine.ts` ~1300–1405). Solução: UPDATE condicional (status,
  `current_node_key`, `reprompt_count` antigo); quem perde a corrida não envia.
  Sem `transition_seq` (não temos a 052). O contrato de falha é o NOSSO (a
  re-pergunta que falha ENCERRA a run; pino `engine-channel.test.ts`).
- **A8 (#21) Ativação recusa ciclo de nós automáticos** (mensagem → condição →
  mensagem dispara dezenas de mensagens até o teto de 64 passos em
  `engine.ts` ~769). Solução: a detecção de ciclo do #674
  (`findAutoAdvancingCycles`) + a checagem de cadeia acima do teto do #683,
  com os NOSSOS tipos automáticos (inclui `move_deal_stage`), em
  `src/lib/flows/validate.ts` e na rota de ativação.
- **A9 (#21) Cron dos robôs lê só as primeiras 1.000 execuções ativas**
  (`src/app/api/flows/cron/route.ts` ~58–70). Solução: paginar por chave no
  próprio código (nosso `buscarPorChave`), mantendo o ramo do robô desativado.
  Sem migration.

Uso: o robô NUNCA rodou na produção (0 ativos, 0 execuções). E2E: robô de
TESTE em rascunho; ativar só se indispensável, com gatilho impossível
("teste-porte-upstream-zzz"), e desativar e apagar no fim. Contatos: fichas
fictícias criadas, movidas para a Lixeira e excluídas de lá no fim. Funil:
funil de TESTE criado e apagado no fim.

## 5. Lote B — Pequenos

Originais: #682 (`d0fc3fa9`), #680 (`5d306013`), #697 (`5dc43bb1`),
#722 (`d574ae6f`), #721 (`c81299d1`, só referência), #683 (`5262f138`, a parte
da base de conhecimento).

- **B1 (#4) Sino: o contador de avisos desce sozinho.** O tempo real entrega a
  TODOS os conectados todo DELETE de `notifications` (sem RLS no DELETE, só o
  id), e a tela desconta 1 a cada um. Mover ficha para a Lixeira apaga em
  cascata os avisos da conversa dela. Solução: no DELETE, recontar no banco.
  Nosso: `src/hooks/use-unread-notifications.ts`. O recorte por conta do
  original já é garantido pela 1067 (não trazer).
- **B2 (#13) Envio pela ficha do contato pode dar 500.** `findOrCreateConversation`
  (`src/app/api/whatsapp/send/route.ts` ~342) ignora erro de leitura (trata
  como "não existe") e, no 23505 do índice da 0036, devolve nulo. Solução:
  erro de leitura vira erro; no 23505 (`isUniqueViolation`), reler a conversa
  que a outra criou e seguir.
- **B3 (#14) Convite: a página quebra no limite de tentativas.** O `peek` tem
  30/min por IP; o 429 (`rateLimitResponse`) vem sem `ok`/`reason`, e
  `FAIL_COPY[undefined].title` lança (`src/app/join/[token]/page.tsx`
  ~124–160, ~240). Solução: estado próprio "muitas tentativas" com "tentar de
  novo" (ideia do `peek-result.ts` deles, com as NOSSAS chaves `fail*`, nos
  dois dicionários).
- **B4 (#15) Login: o Tab pula para "Esqueceu a senha?".** Link ao lado do
  rótulo, antes do campo. Solução: o link abaixo do campo de senha
  (`src/app/(auth)/login/page.tsx` ~124–146).
- **B5 (#20) `experimental.cpus: 4` no `next.config.ts`.** Conferir com a
  nossa config (Next 16.4) e que o `npm run build` passa.
- **B6 (#18) Checagem do botão direito/toque longo — SEM mudar o
  comportamento.** Procurar erro real em `message-actions.tsx` e no
  `LinkDoTexto` (barra que não fecha, link sem o menu do navegador, toque
  longo no Android). Achou? Relatar no checkpoint antes de mexer.
- **B7 (#22) Base de conhecimento: reprocessar apaga os trechos antes de gerar
  os novos** (`src/lib/ai/knowledge.ts` ~27–73). Solução: gerar os
  embeddings, gravar os novos e só então apagar os antigos (por id, sem o
  corte de 1.000), mantendo o contrato de lançar `embedError` depois de
  gravar. A base está VAZIA na produção: e2e só se barato (documento de teste
  não ligado a agente, removido no fim).

## 6. Lote C — API pública, webhooks e MCP

Original: #681 (`987e2258`; commits `e74bfb78`, `0dada1a2`). A doc acompanha o
contrato no MESMO PR (CLAUDE.md, seção 11): `docs/public-api.md`,
`docs/webhooks.md`, `docs/mcp.md` e a aba Configurações → API → Documentação
(`src/components/settings/documentacao-de-integracao.tsx`).

- **C1 (#9) Cursor da API aceita texto que mexe no filtro.** `decodeCursor`
  valida com `Date.parse` (aceita "2020-01-01 (,id.not.is.null)") e o texto vai
  cru para o `.or()` do `keysetFilter` (`src/lib/api/v1/pagination.ts`
  ~78–107). Solução: só data ISO estrita (regex do original + `Date.parse`).
- **C2 (#10) Webhook de saída com usuário e senha na URL.** Aceito na API e na
  tela; toda entrega falha (o Node recusa URL com credencial), o endpoint se
  desliga depois de 15 falhas e a senha aparece na listagem. Solução: recusar
  no cadastro, com a frase do segredo de assinatura. Nosso:
  `src/lib/webhooks/endpoints.ts` (~56) e as 4 rotas
  (`src/app/api/v1/webhooks/route.ts`, `[id]/route.ts`,
  `src/app/api/cb/webhooks-de-saida/route.ts`, `[id]/route.ts`) + a tela. Hoje
  há 1 endpoint, sem credencial.
- **C3 (#11) "bearer" minúsculo leva 401** (`src/lib/auth/api-context.ts`
  ~94–101). Solução: aceitar sem diferenciar maiúscula. Sem doc:
  `Doc-inalterada: <motivo>` no commit, se o portão cobrar.
- **C4 (#12) Disparo pela API não informa os repetidos; textos do MCP.**
  `createBroadcast` colapsa contato repetido em silêncio
  (`src/lib/whatsapp/broadcast-core.ts` ~187–199) e a resposta do
  `POST /api/v1/broadcasts` traz só aceitos/recusados. Solução: campo
  ADITIVO `duplicates`. MCP: `mcp-server/src/tools/read.ts` (o
  `get_broadcast` promete "rejected"; a rota devolve
  sent/delivered/read/replied/failed) e `mcp-server/src/index.ts`
  (`VERSION` = a do `package.json`, 0.1.1). O texto do `create_contact` NÃO
  muda (o nosso contrato é `replace` + `tags_mode`).

E2E: chave de API de TESTE criada e revogada no fim; cursor adulterado, URL
com credencial e `bearer` direto no preview; disparo pela API só para o lead
de teste (no máximo 1 envio) — senão, só pelos testes.

## 7. Lote D — Modelos da Meta

Originais: #680 (`5d306013`; `021e82db`, `a52b5ae9`) e #700 (`3a5b1e7f`;
`f4970d33`). Regras: `whatsapp-envio.md` ("Modelos da Meta": índices parciais
da 903, sem upsert, `resolveTemplateRow` com canal, o stub do webhook).

- **D1 (#5) Categoria editada não chega à Meta.** A tela deixa trocar; o CRM
  grava; a Meta mantém a antiga (e é a dela que define o preço) até a próxima
  sincronização. Solução: travar a categoria do modelo APROVADO (seletor
  desabilitado com a frase; a rota recusa com 400) e, nos outros estados,
  mandar `category` à Meta (`editMessageTemplate` em `meta-api.ts` já aceita;
  `src/app/api/whatsapp/templates/[id]/route.ts` ~182–207 não passa).
  `template-manager.tsx` + `template-category-edit.ts` + as frases nos dois
  dicionários.
- **D2 (#6) "Sincronizar" troca o autor e pode travar.** O UPDATE regrava
  `user_id` com quem clicou; o `.maybeSingle()` com
  `.or(channel_id.eq.X, channel_id.is.null)` estoura se coexistirem a linha do
  canal e a sem canal (0 casos hoje). Solução: `user_id` só no INSERT; UMA
  linha pela régua do submit (a do canal, depois a vinculada).
  `src/app/api/whatsapp/templates/sync/route.ts` (~110–175). Nada de upsert.
- **D3 (#23) Variáveis nomeadas (`{{nome}}`).** Lidas como "zero variáveis":
  a Meta recusa o envio por todos os caminhos. Solução: ler e montar os
  parâmetros pelo nome — núcleo (`template-validators.ts`,
  `template-send-builder.ts`, `template-body.ts`), caixa (`template-picker.tsx`
  e o envio de modelo do fio), disparo (`step3-personalize.tsx`), automação
  (`parametros-do-modelo.ts`, `src/lib/automations/validate.ts`,
  `faltaNoModelo`, `recortarAoModelo`) e `modelo-da-meta.ts` (exemplos de
  `body_text_named_params`). O POSICIONAL fica IDÊNTICO (todos os pinos
  verdes). API v1/MCP: como `params` mapeia para nomes é contrato — a doc
  muda junto (combinar o texto com o Lote C pelo orquestrador). Nenhum modelo
  nomeado hoje: criar modelo de teste na Meta SÓ com o OK do operador.
- **D4 (#25) Banco: modelo repetido só é impedido por AUTOR** (índices
  parciais da 903 por `user_id`). Solução nossa (a 057 deles apagaria o modelo
  de outro número): migration `1150` com índices únicos por conta + canal (e
  conta, para os sem canal), SEM apagar nada; a conferência mede duplicatas
  antes (0 em 17/11) e recusa se houver. Decidir na análise se os índices por
  autor saem. RESTRITIVA: aplicada DEPOIS do deploy.

E2E: NUNCA editar modelo real. A trava da categoria se prova pela tela
(seletor desabilitado, sem salvar) e pelos testes; "Sincronizar" é ação de
rotina e serve para provar que o autor não muda.

## 8. Lote E — Equipe e permissões

Original: #682 (`d0fc3fa9`; `4606bf49`, `e7113329`; a
`055_authz_membership_holes.sql` é REFERÊNCIA, nunca vem crua: recria
`enforce_profile_privilege_columns`, `remove_account_member`, as policies de
`chat-media`/`flow-media` e `notify_conversation_assigned` por cima das
nossas). Regras: `supabase.md`, `perfis.md`, `auth.md`, `inbox-conversa.md`.

- **E1 (#7) Conversa presa a quem saiu da conta.** O banco aceita responsável
  que não é membro: a automação "Atribuir" com atendente fixo só barra o
  suspenso (`src/lib/automations/engine.ts` ~2050–2085) e o menu Responsável
  grava sem conferir (`src/components/inbox/painel/responsavel-menu.tsx`
  ~82–95; RLS que barra devolve 0 linhas sem erro). Solução: gatilho na
  migration `1148` — troca para quem não é membro mantém o anterior (se ainda
  for membro) ou deixa sem responsável; suspenso CONTA como membro (1067); a
  restauração da Lixeira passa (`cb.lixeira`); REVOKE/GRANT e conferência que
  CHAMA a função (banco vazio, seção 7 do CLAUDE.md). Tela: `.select()`,
  conferir o que gravou, aviso "não é mais membro" (chave nos dois
  dicionários) e recarga da lista. O motor registra o motivo quando a
  atribuição não pega (decidir na análise).
- **E2 (#16) Remover membro devolve as conversas dele à fila** (decisão do
  operador). Recriar a NOSSA `remove_account_member`
  (`supabase/migrations/1067_cb_membro_suspenso.sql` ~400–484) com: as
  conversas da conta em que ele é responsável voltam para sem responsável; a
  trava `FOR UPDATE` nas linhas de `profiles` (corrida com a transferência de
  dono). Correção das conversas cujo responsável já não é membro (0 na
  produção; vale para as instalações do Atlas): medir o efeito dos gatilhos
  por linha (`set_updated_at`, trilha 1083, tempo real). Mesma migration
  `1148`. Pino `membro-suspenso-1067` atualizado.
- **E3 (#24) `flow-media` aberto a qualquer login.** Hoje qualquer membro (até
  Visualizador) grava na pasta da conta e qualquer login (até suspenso) na
  pasta `<user_id>/` (pendência escrita na 1067). Solução: migration `1149`
  (RESTRITIVA, depois do deploy): escrita só para agent+ na pasta da conta e
  sem a pasta por usuário. Bucket vazio hoje; conferir que o construtor grava
  na pasta da conta (`node-config-form.tsx`, `upload-media.ts`).
- **Fora:** `chat-media` (#17, mantido), `notify_conversation_assigned`
  (redundante com E1), `profiles_insert` (a 1103 já fechou).

Testes: Postgres local (§1.4) com dado fictício — membro, não membro,
suspenso, nulo, restauração da Lixeira, remoção (conversas voltam à fila),
policies do storage (se os stubs cobrirem). NUNCA remover membro real nem
trocar responsável de conversa real. E2E com a migration = roteiro para o
orquestrador.

## 9. Lote F — Disparo

Originais: #683 (`5262f138`; `058_engine_race_gaps.sql` e
`broadcast-delivery-lease.ts` como REFERÊNCIA — a 058 depende da 052, que
descartamos) e o item dos destinatários do #679. Regras: `whatsapp-envio.md`
("Disparo (broadcast)": contadores por gatilho SECURITY DEFINER da 1066,
`anotarEnvio`, retomada, `buscarPorChave`).

- **F1 (#8) "Retomar" durante o envio manda o modelo pago duas vezes.**
  Enquanto o assistente envia (navegador de quem disparou), a tela da campanha
  diz "parado" (`isStalled`) e oferece "Retomar" (`broadcasts/[id]/page.tsx`
  ~338–480); a retomada (`claimBroadcastDelivery`, `broadcast-resume.ts`
  ~71–94) não sabe do assistente, e a rota do lote não reconfere o
  destinatário antes de enviar. Solução: POSSE do envio com prazo, renovada
  pelo assistente a cada lote (`use-broadcast-sending.ts` ~1131–1210); a
  retomada respeita a posse; posse perdida = parar com aviso, nunca reenviar;
  a tela esconde "Retomar"/"parado" com envio em andamento. Migration `1147`
  (ADITIVA, antes do deploy): coluna + funções, com o papel de quem dispara
  aqui (`requireRole('admin')`), REVOKE/GRANT e conferência que chama as
  funções. Analisar se o disparo pela API (`createBroadcast`, dono = Lote C)
  precisa da posse — combinar pelo orquestrador.
- **F2 (#679) A tela da campanha lê no máximo 1.000 destinatários**
  (`broadcasts/[id]/page.tsx` ~189–196): tabela, filtro "Falhou", contagens
  do "Retomar" e CSV param ali. Solução: paginar por `buscarPorChave`
  (`src/lib/supabase/paginar.ts`); falha ou teto = erro, nunca lista parcial.

Uso: 3 disparos em 60 dias (o último em 26/09). Testes: unidade (tomar,
renovar, perder a posse), Postgres local para as funções; e2e com a
migration = roteiro (disparo de 1 destinatário, o lead de teste, e a tela da
campanha durante o envio).

## 10. Não vale trazer (registro)

As migrations 055, 057 e 058 cruas; links clicáveis (#715, temos); `min-w-0`
da lista (#720, temos); a API somando etiquetas por padrão (#681, contrato
`replace`); a importação de etiquetas deles (apaga a repetida); ids
malformados (já 400); `conversation.created` pela API (decisão); 503 na falha
da chave (contrato); não lidas acima de 1.000, estimativa do público, seletor
de contato, campos personalizados, busca com vírgula, funil padrão, "remover
configuração da IA", `?search=` da v1 (#679: já resolvidos ou não existem);
auto-reply atribuindo responsável (#683: o turno da IA já confere); modelo
repetido ao criar, catálogo por conta, `registeredAt` (#680: já temos);
aviso de atribuição só a membro e `profiles_insert` (#682); `replace_flow_graph`
e o teto de 87.600 h (#683: dependem da 052); `reconcileStages` (#679).

## 11. Integração (orquestrador)

1. Cada lote no checkpoint 2: conferir o PR (HEAD do Codex limpo, testes, e2e)
   e mesclar a branch do lote na integração (`git merge --no-ff`), resolvendo
   conflito por arquivo; rodar typecheck, lint, test e i18n na integração.
2. `docs/MERGE-UPSTREAM.md`: §3.6 desta rodada + as linhas da §4 dos lotes.
3. Replay local de todas as migrations novas; reconferir os números.
4. `git merge origin/main` na integração; abrir UM PR para o `main` (CI +
   Codex do conjunto); rodadas de correção num push só.
5. "Pode gravar" do operador → aplicar `1147` e `1148` ANTES do deploy;
   registrar em `docs/MIGRATIONS-APLICADAS.md`.
6. Roteiros de e2e pós-migration (E e F) no preview da integração.
7. "Pode mesclar" do operador → merge (deploy) → conferência pós-deploy (cron
   401, login, tráfego real) → aplicar `1149` e `1150` → registrar.

## 12. Atlas CRM (depois do deploy)

O produto derivado recebe as correções depois do deploy aqui, numa sessão
própria aberta no repositório dele (os repositórios, servidores e o registro
dos portes estão nas notas internas do operador, fora deste repo). Cada item é
reconferido no código do produto, que diverge deste; PR de desenvolvimento
com Codex e CI; versão; publicação nos repositórios de distribuição e de
clientes com o OK do operador; atualização do servidor de teste; instrução
para os servidores de clientes.

## 13. Fica para depois (achados das revisões, fora do escopo do porte)

Nenhum é regressão deste porte; os marcados "antes" já existiam.

- ~~**Disparo (antes, regra 8e):** lote cuja chamada falha marca `failed` as
  linhas `pending`, e o "Tentar de novo os que falharam" pode reenviar a quem
  recebeu.~~ **Resolvido em 18/11/2026 (branch `fix/disparo-entrega-incerta`,
  migration 1151):** quem envia RESERVA a linha antes da Meta (`uncertain`),
  o 5xx/tempo esgotado fica "Entrega incerta" fora de todo reenvio, e o
  assistente para no lote que cai. Notas em `whatsapp-envio.md` ("ENTREGA
  INCERTA").
- **Disparo:** o caminho `erro` da trava na API v1 entrega sem trava (reler a
  campanha antes de seguir); o roteiro não cobre o terceiro desfecho (posse
  incerta). A janela da chamada à Meta mais longa que a posse fechou com a
  reserva por linha da 1151 (o Retomar não pega a linha reservada).
- **Equipe:** remover quem é dono de OUTRA conta falha em
  `idx_accounts_one_per_owner`; o nó "Transferir" do robô e a passagem da IA
  não releem o que gravaram; o "Reabrir" do fio aceita 0 linhas sem erro
  (antes).
- **Modelos:** a rota de apagar conexão promove a sucessora antes do DELETE
  (não atômico); envio real de modelo NOMEADO à Meta e o PATCH de categoria em
  REJECTED/PAUSED só provados com dublê (o teste real pede o OK do operador).
- **Pequenos:** o 503 `lookup_failed` sem "Tentar de novo";
  `currentConversationChannel` engole erro de leitura e vira 409
  `channel_changed` falso; a recontagem que falha não tenta de novo.
- **Contatos e robô:** lista de contatos sem desempate por id; seletores com
  dígitos ("Maria 2"); a rota de ativação com `nodes ?? []`; a RPC da 025 usa
  os dígitos do termo com cara de telefone também no nome e no e-mail; o
  caminho da resposta que casa não tem cerca; mensagens do validador em
  português literal.
- **Webhooks:** o passo "Enviar webhook" da automação aceita URL com
  credencial e `http`.
- **Dependência:** o aviso de vulnerabilidade do Next 16.4.3 (a atualização é
  decisão à parte).
