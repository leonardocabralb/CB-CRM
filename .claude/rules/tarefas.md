---
paths:
  - "src/lib/tasks/**"
  - "src/app/api/cb/tasks/**"
  - "src/components/tasks/**"
  - "src/app/*/tarefas/**"
  - "src/app/*/notifications/**"
  - "src/hooks/use-tarefas*"
  - "src/hooks/use-acoes-da-tarefa*"
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
- **Redirecionar zera `lida_em`**: a tarefa chega "não lida" para quem acabou
  de recebê-la; senão some da contagem do menu da pessoa nova.
- **Aviso de tarefa nasce SEM `conversation_id`** e roteia por
  `notifications.task_id`: em `notifications/page.tsx` o teste de `task_id`
  vem ANTES do de `conversation_id`, senão o clique cai no inbox.
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
