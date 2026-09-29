# Plano — Meu dia v2: conexões, notificações, tarefas da equipe e tarefa vista

Pedido do operador (29/09/2026), sobre a aba `/meu-dia` (a área de trabalho;
o cartão da ENTRADA fica como está):

- no lugar do card com a LISTA de clientes esperando resposta, **indicadores
  por conexão** — as conexões que o operador enxerga, cada uma com quantos
  clientes estão **não lidos** e quantos estão **em atraso** esperando
  resposta;
- **ênfase** nas notificações e nas tarefas recebidas pela pessoa;
- sai o bloco "Negócios no funil" e sai "O dia até agora";
- a agenda e reuniões fica **maior** e cada reunião **leva ao cliente**;
- para administradores e gestores, um card com **prioridade** mostrando, de
  cada membro da equipe, as tarefas **vencidas** e as de **hoje**;
- a tarefa passa a ser **marcada como vista sozinha**, e a métrica separa
  "não vista e não cumprida" de "vista e não cumprida".

O plano anterior (a porta de entrada, a guarda de 4 h e a primeira versão da
aba) é `docs/PLANO-meu-dia.md`; as regras vivas, `.claude/rules/meu-dia.md`.

## Estado

| Fase | O quê | Estado |
| --- | --- | --- |
| 1 | Tela: indicadores por conexão, notificações e tarefas em destaque, agenda pela pauta de reuniões, saem "Negócios no funil" e "O dia até agora" | Implementada e testada no preview (29/09/2026): os números das 5 conexões bateram com o banco; "Ver como" Bancário - Geral e Gestor Geral conferidos |
| 2 | Tarefa vista: coluna `vista_em` (1068), rota que marca, observador na tela, "vista/não vista" para quem pediu | Implementada; migration provada num Postgres 16 local (duas aplicações, cenários e controle negativo). Falta aplicar a 1068 (autorização do operador) e testar no preview |
| 3 | Card "Equipe" (admin + quem vê o Painel): vencidas e de hoje por membro, com as não vistas | Implementada; o card aparece para Gestor Geral e some para Bancário - Geral. Os números dependem da 1068 |
| 4 | O clique no indicador abre a caixa de entrada filtrada (conexão + "Não lidas" ou "Em atraso") | Implementada e testada: 60 em atraso e 46 não lidas abriram 60 e 46 linhas; conexão inexistente é descartada |

## Decisões do operador (29/09/2026)

| # | Decisão | Por quê |
| --- | --- | --- |
| D1 | O card da equipe aparece para administradores e para **quem vê o Painel** (`podeVerTela(acesso, 'dashboard')`) — hoje, exatamente os 5 do perfil "Gestor Geral". Sem migration | O que separa gestor de operador nos perfis gravados é o Painel. Uma caixa nova no perfil exigiria migration e mexeria no editor |
| D2 | A tarefa conta como **vista** quando fica **visível ~1 s na tela do RESPONSÁVEL** (lista de Tarefas, ficha, conversa ou Meu dia). Na primeira vez, grava `vista_em` e marca lida (`lida_em`) | É o "viu" mais fiel sem criar uma tela de detalhe. "Marcar como não lida" continua e NÃO apaga `vista_em` |
| D3 | Ver a tarefa **não** marca o aviso dela no sino como lido | Decisão do operador: o aviso só sai do sino pelo clique, como hoje |
| D4 | O indicador da conexão abre a caixa de entrada **já filtrada** (`?conexao=<id>&ver=nao-lidas|em-atraso`) | Indicador que leva a uma caixa sem recorte obriga a filtrar à mão |

## Medido em produção (29/09/2026)

- **Conexões:** 5 (Bancário - Comercial, Bancário - Jurídico, Trabalhista -
  Comercial, Trabalhista e Prev - Jurídico, API - Meta - Comercial Bancário).
  Nenhum perfil recorta conexão (`channel_ids` vazio nos 4): todo operador vê
  as 5. 370 conversas 1:1 ativas; 4 sem conexão carimbada.
- **Tarefas:** 21 no total, e só 1 foi marcada como lida alguma vez. A Dra.
  Isa tem 13 abertas, 12 vencidas, todas "não lidas".
- **Agenda:** `cb_meetings` tem 0 linhas; o Calendly tem 9 reuniões entre hoje
  e amanhã. O bloco antigo dizia sempre "nenhuma reunião".
- **Notificações:** 15 nos últimos 30 dias (9 de atribuição, 6 de tarefa); 6
  não lidas na conta.
- **Equipe:** 13 membros — o dono, 5 "Gestor Geral" (papel `agent`), 4
  "Bancário - Geral", 3 "Trabalhista e Prev".

## Fase 1 — tela

**Layout** (grade de 6 colunas, de cima para baixo): conexões (faixa inteira)
→ equipe (só D1) → notificações | suas tarefas → agenda e reuniões (faixa
inteira) → o que precisa ser corrigido (só administrador, como antes).

- **Conexões:** uma peça por conexão que o perfil enxerga (`canaisVisiveis`
  com a LENTE), com a bolinha da cor do canal. Números EXATOS: as conversas
  1:1 ativas vêm INTEIRAS (paginadas por id) e a conta é em JS, com a régua da
  caixa de entrada — "não lidos" = `unread_count > 0` (o filtro "Não lidas");
  "em atraso" = `atrasoDeResposta` (10 min), com as de 30 min em vermelho (o
  selo da linha). Grupo fica de fora. Conversa sem conexão entra numa linha
  própria só quando tem algo a contar. Lista de conexões que falhou = bloco
  `falhou`, nunca "nenhuma conexão".
- **Notificações:** as NÃO LIDAS da pessoa (até 8, a mais nova primeiro), com o
  texto de `textoDoAviso`; o clique marca lida e abre o destino pela MESMA
  função do sino (`rotaDoAviso`: tarefa antes de conversa). Aviso de conversa
  fora do perfil vira "N fora do seu perfil" (a régua das novidades, 12/09).
- **Suas tarefas:** vencidas, de hoje e as NOVAS (recebidas e ainda não vistas,
  qualquer prazo), cada grupo com o seu `count: 'exact'`. O item leva à
  conversa do cliente, senão à ficha.
- **Agenda e reuniões:** a pauta de `/reunioes` (`usePautaDeReunioes`, hoje e
  amanhã no fuso da agenda), que já casa cancelamento e reagendamento do
  Calendly — a razão de o bloco antigo ler só `cb_meetings` deixou de existir.
  Recorte pelo FUNIL do perfil, como a pauta. Cada linha: hora, cliente (link
  para a conversa ou a ficha), evento, etapa do card, resultado, "Entrar".
- Saem `BlocoDeResultados`, `BlocoDeNegocios`, `src/lib/meu-dia/negocios.ts`
  e as consultas deles. O cartão da entrada (`resumo-do-dia.tsx`) não muda.

## Fase 2 — tarefa vista

- `1068_cb_tarefa_vista.sql` (ADITIVA — aplicar antes do deploy):
  `cb_tasks.vista_em timestamptz`, preenchida com `lida_em` onde houver (a
  única prova de que a pessoa viu). `cb_tasks` está na publicação do tempo
  real SEM lista de colunas (conferido: `prattrs` nulo), então a coluna nova
  viaja e o `REPLICA IDENTITY FULL` não quebra escrita.
- `POST /api/cb/tasks/vistas` `{ ids }`: só o RESPONSÁVEL (cerca na consulta:
  `responsavel_user_id = quem chama`, tarefa aberta, `vista_em IS NULL`).
  Grava `vista_em` e, se ainda não lida, `lida_em`. Idempotente.
- Observador (`useVistaDaTarefa`): um `IntersectionObserver` compartilhado,
  60% visível por 1 s com a aba visível; junta os ids e manda em lote.
- Criar tarefa para si mesmo já nasce vista e lida; redirecionar zera
  `vista_em` junto com `lida_em` (quem recebe ainda não viu).
- Quem PEDIU vê na linha "vista em dd/mm hh:mm" ou "ainda não vista".
- A API v1 devolve `select('*')`: `vista_em` aparece nas respostas de
  tarefas — documentado em `docs/public-api.md`.

## Fase 3 — card da equipe

- Tarefas ABERTAS com prazo até hoje, de toda a conta, paginadas por id;
  agrupadas por responsável em JS (`resumirEquipe`, puro). Menos a própria
  pessoa (as dela estão em "Suas tarefas").
- Por membro: vencidas e de hoje, cada uma com quantas NÃO vistas; quem não
  deve nada aparece numa linha "em dia"; suspenso marcado; tarefa órfã
  (responsável saiu) numa linha própria. Expandir mostra as tarefas.

## Fase 4 — caixa filtrada

- `urlDoInbox` ganha `conexao` + `ver`; a página lê os dois e a lista SEMEIA o
  filtro uma vez (como `?etapa=`), vencendo o filtro padrão. Conexão que não
  existe ou está fora do perfil é descartada quando o catálogo chega (senão a
  caixa abriria vazia). Os `replace` derrubam os dois (a pastilha do painel é
  quem conta o recorte).

## Riscos e armadilhas

- Número afirmado sai de consulta COMPLETA ou de `count: 'exact'`, nunca de
  lista com teto.
- Estado por bloco (carregando / falhou / pronto); "0" só com resposta.
- A lente do "Ver como" (`acesso`) em tudo que é da tela; o observador de
  vista usa o login REAL (quem vê é a pessoa, não o perfil simulado).
- Abrir conversa pelo Meu dia zera as não lidas da conta: no teste do preview,
  clicar só no lead de teste autorizado.
- `vista_em` só existe depois da 1068: aplicar ANTES do deploy.

## Verificação

- `npm run typecheck`, `npm run lint`, `npm run test`.
- Preview a 1440×900: operador (dono), "Ver como" Gestor Geral e Bancário -
  Geral; conferir os números das conexões contra a caixa de entrada filtrada.
