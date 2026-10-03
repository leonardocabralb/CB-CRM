---
paths:
  - "src/lib/tasks/**"
  - "src/app/api/cb/tasks/**"
  - "src/components/tasks/**"
  - "src/app/*/tarefas/**"
  - "src/app/*/notifications/**"
  - "src/hooks/use-tarefas*"
  - "src/hooks/use-acoes-da-tarefa*"
  - "src/hooks/use-vista-da-tarefa*"
  - "src/app/api/v1/tasks/**"
  - "src/lib/api/v1/tasks*"
---

# Tarefas — regras

Vale ao mexer em tarefas por cliente: `src/lib/tasks/` (puro, testado), as rotas
`/api/cb/tasks` e `/api/v1/tasks`, as telas em `src/components/tasks/` e na
página de Tarefas, e o sino (`notifications/page.tsx`). A recarga silenciosa ao
voltar para o app está em `.claude/rules/ao-voltar.md`. O texto antigo, com a
história, está em `git show f5879b3f:CLAUDE.md`.

### Tarefas por cliente (944): o navegador NÃO escreve em `cb_tasks`

- ⚠️ **Toda escrita passa pela API.** Não há policy de INSERT/UPDATE/DELETE e o
  privilégio foi revogado: `.from('cb_tasks').update()` do cliente leva
  **42501**, de propósito — criar tarefa grava em `notifications` (sem policy
  de INSERT desde a 027) e os nomes são carimbados no servidor.
- ⚠️ **Quem-pode-o-quê mora em `permissoes.ts`, num lugar só.** A rota decide
  com `podeNaTarefa` e a tela desabilita o botão com a MESMA função. Reescrever
  a regra em RLS ou no componente diverge na primeira mudança. Só o
  destinatário marca lida (nem admin); editar e apagar é do criador; a porta
  do admin existe para a tarefa ÓRFÃ (criador e responsável são
  `ON DELETE SET NULL` — sem ela, ninguém alcança a tarefa de quem saiu).
  Pino: `permissoes.test.ts`.
- ⚠️ **Os ids de pessoa em `cb_tasks` são do LOGIN** (`auth.users.id`, o
  `user.id`), nunca `profiles.id`: o id errado devolve zero linhas, sem erro.
- ⚠️ **`vence_em date` + `vence_as time`, separadas e sem fuso.** Nunca
  `new Date(vence_em)`: meia-noite UTC volta um dia no Brasil. Use
  `dataParaExibir`/`diaLocal`/`situacaoDoPrazo` de `prazo.ts`; "venceu?" se
  responde no NAVEGADOR. Pino: `prazo.test.ts`.
- ⚠️ **A resposta volta para quem pediu, e quem decide é o SERVIDOR.** Com
  `tipo: 'resposta'`, a rota fixa o destinatário no `criador_user_id` do pai e
  IGNORA `responsavel_user_id` e `contact_id` do corpo (toda derivada herda o
  contato do pai). Criador que saiu → 409 `PARENT_CREATOR_GONE`.
- **`tarefa_pai_id` é SET NULL, com `tarefa_pai_titulo` congelado**: apagar a
  origem não apaga a derivada nem a informação de onde ela veio.
- **A etiqueta do menu depende de `REPLICA IDENTITY FULL`**: o contador tira o
  delta comparando a linha ANTES e DEPOIS de cada UPDATE (marcar não lida,
  concluir, reabrir e redirecionar mexem na conta em sentidos diferentes).
- **Redirecionar zera `lida_em` E `vista_em`**: a tarefa chega "não lida" e
  "não vista" para quem acabou de recebê-la; senão some da contagem do menu da
  pessoa nova e o card da equipe diria "vista" sobre quem nunca a abriu.

### Tarefa VISTA (1068): registro, não estado

Decisão do operador (29/09/2026): a tarefa conta como vista quando fica
visível na tela do RESPONSÁVEL (Tarefas, ficha, conversa, Meu dia); o card
"Equipe" do Meu dia separa "não vista" de "vista e não cumprida".

- ⚠️ **`vista_em` só é gravada pela rota `POST /api/cb/tasks/vistas`**, com a
  cerca NA CONSULTA (`responsavel_user_id` = quem chama, `aberta`,
  `vista_em IS NULL`) — `contaComoVista` (`src/lib/tasks/vista.ts`) é só o
  filtro do navegador. São duas escritas: a não lida ganha `vista_em` e
  `lida_em`; a lida à mão, só a vista.
- ⚠️ **É a PRIMEIRA vez, e não volta**: "marcar como não lida" não toca
  `vista_em` (senão a rota remarcaria lida a cada aparição e o botão não
  serviria); marcar lida à mão grava a vista se faltar; o lembrete para si
  mesmo nasce visto e lido.
- **`useVistaDaTarefa` devolve o `ref` da linha**: um `IntersectionObserver`
  de MÓDULO (60% visível por 1 s, aba à vista; a volta à aba religa o relógio
  de quem está na tela), ids em lote a cada 1,5 s, balde `tarefaVista`
  próprio. A linha NÃO muda na tela quando grava — o "Não lida" fica até a
  próxima carga. Tela nova que lista tarefa usa o mesmo `ref`.
- **Ver a tarefa não marca o aviso dela no sino** (decisão do operador, D3):
  o aviso só sai pelo clique. Quem não é o responsável vê na linha "vista em
  …" ou "ainda não vista" (só tarefa aberta e delegada).
- **Aviso de tarefa nasce SEM `conversation_id`** e roteia por
  `notifications.task_id`: em `rotaDoAviso` (`src/lib/notifications/`, a
  mesma do sino e do Meu dia) o teste de `task_id` vem ANTES do de
  `conversation_id`, senão o clique cai no inbox.
- **`TYPE_ICON` do sino é exaustivo, de propósito**: tipo `task_*` novo sem
  ícone quebra o typecheck — inclusive o que um merge do upstream trouxer.
- **A conversa da linha é DERIVADA do contato na tela** (uma conversa por
  contato, UNIQUE da 036), nunca coluna: cliente sem conversa cai na ficha por
  `/contacts?contact=<id>` (deep link resolvido no estado inicial da página de
  Contatos).
- **Trechos nossos em arquivos do upstream** (lista completa em
  `docs/MERGE-UPSTREAM.md`): a aba de tarefas na ficha do contato (com
  `[&>button]:flex-none` na `TabsList`), a seção na barra da conversa, o item
  "Tarefas" com etiqueta realtime no menu, o deep link `?contact=` e o bucket
  `tarefa` do rate limit.

### Tarefa RECORRENTE (1074): pelo calendário

Decisões do operador (30/09/2026): a próxima nasce SOZINHA no dia do prazo
dela, concluída ou não a anterior (as atrasadas se acumulam); o intervalo
(1, 2, 5, 7, 15 ou 30 dias) conta do PRAZO ANTERIOR; só o formulário da tela
oferece (API v1, automação e agente de IA não); cada nova avisa no sino.

- **A série é um grupo de tarefas comuns** com o mesmo `serie_id` (o id da
  primeira). A ATIVA é a mais recente — `repetir_a_cada_dias` preenchido e
  `proxima_gerada_em` nulo (`ehAtivaDaSerie`) — e é o MOLDE da próxima
  (título, descrição, hora, cliente, responsável). Editar a ativa muda as
  próximas; editar uma antiga muda só ela. O índice único
  `cb_tasks_uma_ativa_por_serie` garante uma ativa por série.
- ⚠️ **Quem gera é o banco** (`cb_tarefas_recorrentes_gerar`, numa transação:
  carimba a ativa e insere a próxima; `FOR UPDATE … SKIP LOCKED`), chamado
  pelo ciclo das AGENDADAS em `after()` (`src/lib/tasks/gerar-recorrentes.ts`)
  — rota de cron própria exigiria `docker stack deploy` à mão. O "hoje" vai
  do app (`diaNoFuso(FUSO_PADRAO)`): o banco em UTC erraria das 21h à
  meia-noite. Dias com o agendador parado não despejam as perdidas: sai só a
  da data mais recente da grade `prazo + k·N`.
- ⚠️ **Mudar o intervalo ou desligar vale para a SÉRIE inteira** (só as que
  ainda repetem), gravado ANTES da linha. Ligar numa tarefa que não repete
  cria uma série NOVA com ela de ativa. Resposta (`tipo: 'resposta'`) não
  repete: a rota recusa e o formulário esconde o campo.
- ⚠️ **Apagar a ativa ENCERRA a série**: `proxima_gerada_em` é carimbo, não FK
  — com ponteiro `SET NULL`, a anterior voltaria a ser ativa e a rotina
  recriaria a tarefa apagada. A rota tira a repetição das irmãs antes de
  apagar (a etiqueta "Repete" não sobra) e a tela avisa na confirmação.
- **Responsável que saiu ou está suspenso PAUSA a série** (a função exige
  membro ativo da conta): volta a gerar quando alguém redireciona a ativa ou
  a suspensão acaba.
- A nova nasce não lida e não vista, com aviso `task_assigned` ("Tarefa
  recorrente para hoje", ator = quem criou a série) — inclusive no lembrete
  para si mesmo: ninguém acabou de escrevê-la.
