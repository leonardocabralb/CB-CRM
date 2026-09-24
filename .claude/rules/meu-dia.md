---
paths:
  - "src/components/entrada/**"
  - "src/components/meu-dia/**"
  - "src/lib/meu-dia/**"
  - "src/lib/resumo-do-dia/**"
  - "src/hooks/use-resumo-do-dia*"
  - "src/hooks/use-area-de-trabalho*"
  - "src/hooks/use-guarda-de-inatividade*"
  - "src/app/*/meu-dia/**"
  - "src/app/api/cb/meu-dia/**"
  - "src/app/*/dashboard-shell.tsx"
  - "src/lib/auth/inatividade*"
  - "src/lib/auth/sair*"
  - "src/lib/auth/token*"
  - "src/components/notifications/**"
  - "src/lib/notifications/**"
  - "src/hooks/use-browser-notifications*"
  - "src/components/settings/browser-notifications-card.tsx"
  - "src/components/settings/profile-form.tsx"
---

# Meu dia — regras

Vale ao editar ou revisar a tela de entrada (a porta), a aba `/meu-dia`, a
rota de pendências, a casca do painel (`dashboard-shell.tsx`) e as
notificações do navegador. Sair, `sessionId` e a guarda de inatividade estão
em `.claude/rules/auth.md`; o recarregar ao voltar para o app, em
`.claude/rules/ao-voltar.md`. Plano vivo: `docs/PLANO-meu-dia.md`.

### Meu dia: a tela de entrada SUBSTITUI o app até o "Continuar"

- ⚠️ **A casca envolve o layout INTEIRO na `<PortaDeEntrada key={user.id}>`**,
  abaixo do `if (!user) return null`. Nunca renderizar pedaço do app fora dela.
- ⚠️⚠️ **Não é um Dialog, e a PÁGINA não monta por trás.** O fundo é o app de
  verdade (menu e cabeçalho), desfocado, com `inert` E `aria-hidden` (senão o
  Tab alcança o menu). A página e o `PresenceHeartbeat` NÃO montam — por isso
  o filho da porta é uma FUNÇÃO (`children(entradaPendente)`). Montada, a
  página devolveria os efeitos que a porta segura: um deep link `/inbox?c=X`
  abriria o fio e zeraria as não lidas da conversa para a conta inteira.
  Consequência aceita: com o Meu dia aberto, a pessoa aparece offline.
- ⚠️⚠️ **Trava de MÃO ÚNICA, decidida uma vez por carga de página.**
  `precisaMostrar` (login novo OU primeiro acesso do dia) roda no inicializador
  do `useState` da porta e só FECHA. Nunca reavaliar por evento de auth
  (`SIGNED_IN` dispara a cada volta à aba), por remontagem (daí o `Set` de
  módulo `liberadosNestaCarga`) nem pela virada do dia com a aba aberta: abrir
  no meio do uso desmontaria o compositor — rascunho perdido, anexo apagado do
  bucket, mensagem na janela de desfazer ENVIADA. A única exceção é `reabrir`,
  chamada só pela guarda de inatividade.
- ⚠️ **O registro é PARSE, nunca `as`** (`lerRegistro`): JSON estranho vira
  "sem registro", e a tela aparece — resumo a mais é barato, pendência
  escondida não. Chave `cb-meu-dia:<userId>`; storage que lança cai na memória.
- ⚠️ **Todo filtro "meu" é pelo `user.id`, ESCRITO na consulta**: `cb_tasks`,
  `conversations` e `notifications` guardam o id do LOGIN, e em duas delas a
  RLS deixa a conta inteira ler tudo. O id errado devolve zero sem erro.
- ⚠️⚠️ **Nenhum número afirmado como exato sai de lista com teto.** Novidades
  são COUNTs (`head: true`); tarefas vêm em duas consultas (vencidas / hoje)
  com `count: 'exact'`; lista recortada em JS carrega o seu sinal `truncada`, e
  a tela escreve "mais de N". Com mil tarefas vencidas, a de hoje ficava fora
  do teto do PostgREST e a tela dizia "0 vencem hoje".
- ⚠️ **Estado por BLOCO (carregando / falhou / pronto), nunca "0" sem
  resposta**: "0 vencidas" durante a carga liberaria o Continuar com uma
  mentira. O botão espera até `TETO_DE_ESPERA_MS` (8 s) e depois libera de
  qualquer jeito. Estouro numa consulta vira `falhou` daquele bloco; o
  `LimiteDeErro` cobre só erro de RENDER e renderiza o APP, nunca a entrada.
- ⚠️ **Cada bloco usa a régua da TELA para onde o clique leva**, senão os
  números discordam: tarefas por `agruparPorPrazo` (o DIA), conversas por
  `atrasoDeResposta` e por `conversaNoEscopo` com o contexto REAL
  (`{ papel: profile.account_role, perfil: perfilDeAcesso }`, nunca `acesso`,
  que carrega a lente do "Ver como"). O select é enxuto (`SELECT_DE_CONVERSA`,
  não o `CONVERSATION_SELECT`) e leva `group:cb_groups(channel_id)`: o recorte
  por canal precisa do canal do GRUPO.
- ⚠️ **"Sem responsável" é ACERVO, repartido pela confirmação anterior**: um
  número fixo toda manhã é o que o olho aprende a pular. `novas` começaram a
  esperar depois da última confirmação; `antigas`, em texto apagado. São DUAS
  consultas: numa só, ordenada e com teto, cairiam justamente as novas.
- ⚠️ **As novidades são RECORTADAS pelo perfil** (pedido do operador,
  12/09/2026). `note_mention` e `conversation_assigned` carregam
  `conversation_id` e respondem pela conexão; aviso de tarefa nunca é recortado
  (tarefa não tem conexão). Conversa fora do mapa CONTA como dentro (não
  esconder por ignorância). O que ficou fora aparece como "N fora do seu
  perfil". O SINO não recorta: os números divergem de propósito.
- ⚠️ **"Novidades desde a sua última entrada" conta `created_at` maior que a
  confirmação anterior, lidas ou não** — nunca as não lidas do sino, que
  acumulam avisos tratados por outro caminho. Sem registro, a janela é 24 h.
- ⚠️ **Todo link da tela CONFIRMA antes de navegar** (`onClick={onContinuar}`):
  a porta fica acima da página roteada, e o resumo ficaria na frente da
  conversa pedida.
- ⚠️ **Bloco cuja tela está fora do perfil: número SEM link, com aviso**
  (D8). Esconder calaria uma obrigação atribuída à pessoa.
- **Sem bloco de reuniões** (D13): `cb_meetings` está vazia; as reuniões
  vivem no Calendly.
- **`/meu-dia` fica FORA do catálogo de perfis** (`telaDoCaminho` devolve
  null): no catálogo, nasceria invisível para todo perfil já gravado. Não vira
  tela de chegada (D15). Está em `protectedPaths` e no `pageTitles`; pino
  `src/components/layout/rotulo-do-menu.test.ts` (chave montada).

### A ABA `/meu-dia` é uma ÁREA DE TRABALHO

Sete blocos (`src/lib/meu-dia/`, `use-area-de-trabalho.ts`,
`src/components/meu-dia/`, a rota `/api/cb/meu-dia/pendencias`, namespace
`MeuDia`). O cartão da entrada fica com os números e UM botão para a aba.

- ⚠️ **O bloco "o que precisa ser corrigido" é SÓ DO ADMINISTRADOR**
  (`useCan('view-reports')`, pedido do operador, 13/09/2026): é saúde da
  operação, e para o atendente seria alarme sobre o que ele não pode resolver.
  `useCan` segue o acesso efetivo, então o "Ver como" o esconde junto.
- ⚠️⚠️ **"Tudo em ordem" exige TODAS as fontes respondidas.**
  `resumirCorrecoes` tem estado próprio para zero-com-falha (`incompleto`),
  distinto de `limpo`; fonte ausente do mapa conta como "carregando", nunca
  zero. Um selo verde sobre consulta que falhou faz a pessoa fechar a aba
  enquanto a mensagem do cliente não saiu. Pino: `correcoes.test.ts`.
- ⚠️⚠️ **`deals.assigned_to` guarda `profiles.id`, NÃO o id do login** — a
  exceção deste arquivo. `user.id` ali devolve zero linhas sem erro. Por isso
  `PedidoDaArea` carrega `profileId` separado de `userId`, e o bloco ESPERA o
  perfil em vez de afirmar zero.
- ⚠️⚠️ **Automação que falhou é `desfecho = 'falhou'` com `finalizado_em` no
  dia, nunca `status`**: `status` nasce `'failed'` antes do primeiro passo e
  pintaria de vermelho toda automação que apenas começou.
- ⚠️⚠️ **Agendada `failed` e `entrega_incerta` são contadas SEPARADAS e
  disjuntas**: somadas cruas contam a mesma linha duas vezes, e as ações são
  opostas — reenviar o que falhou é seguro; reenviar o incerto manda a
  mensagem duas vezes ao cliente.
- ⚠️⚠️ **"Mensagens enviadas hoje" é número do ESCRITÓRIO**: quase tudo sai
  pelo celular pareado (`from_device`, `sender_id` nulo), sem autor a quem
  creditar. Pelo mesmo motivo não há "tarefas que VOCÊ concluiu" (não existe
  `concluida_por`) nem bloco de conversas encerradas (não existe carimbo de
  quem encerrou nem quando). Qualquer número desses seria inventado.
- ⚠️ **Ganho do dia vem de `cb_lead_events` (`to_status='won'`), do
  escritório**: ganho por automação ou pelo gatilho da etapa não tem ator. É
  nomeado pelo CONTATO — `cb_lead_events.deal_id` não tem FK, e o PostgREST
  não embute `deals`.
- ⚠️ **Tabelas fechadas ao navegador (`cb_calendly_eventos`,
  `cb_webhook_eventos`, `cb_mensagens_sem_telefone`) vêm pela rota
  `/api/cb/meu-dia/pendencias`**: do cliente devolveriam zero com
  `error: null`. A rota é de qualquer membro porque devolve só CONTAGENS; erro
  é 500, nunca `{}` com zeros. Agendamentos não processados levam a
  Integrações; webhooks não processados, a Webhooks → Recebidos (gate
  `podeVerSecao(acesso, 'webhooks')`) — são DUAS fontes. Pino: `route.test.ts`
  da rota.
- ⚠️ **Mensagens retidas (1010): `retidas: null` é "não consegui conferir",
  nunca zero** (`lerRetidas`). A falha só dessa consulta não vira 500 (levaria
  junto Calendly e webhooks). Da rota saem só CONEXÃO e HORA, nunca conteúdo,
  telefone ou LID. Janela `DIAS_DE_RETIDA_NA_TELA` (7), a mesma na rota e no
  texto.
- ⚠️ **`messages` não tem `account_id`**: a conta entra pelo embed
  `conversations!inner`, senão a contagem é de todas as contas da pessoa.
- **O recorte por perfil vai NA CONSULTA em `cb_scheduled_messages`** (a linha
  carrega o próprio `channel_id`), em JS nas conversas e por funil
  (`funilNoEscopo`) em `deals`. Conexão fora do ar também é recortada: aviso
  que não é seu ensina a ignorar o bloco.
- ⚠️ **Chave de i18n LITERAL por fonte de correção**, nunca montada com o
  nome da fonte: chave montada escapa do portão do CI.
- ⚠️ **Conexão ATRASADA é fonte SEPARADA de "fora do ar"**
  (`conexoesAtrasadas`), nunca somada: o conserto é outro, e "N conexões fora
  do ar" seria falso sobre conexão de pé. O teste é `detail === 'lagging'`,
  nunca `tone === 'warn'` (`warn` inclui estados transitórios que se resolvem
  sozinhos). A régua do atraso: `.claude/rules/canais.md`.
- ⚠️⚠️ **`useChannelHealth` expõe `falhou`**, e todo consumidor novo o lê: o
  zero de uma sonda que não respondeu não autoriza afirmar "tudo em ordem"
  (`unavailable: true` também conta como falha). `useAgendadorSaude` não
  precisa: batimento ilegível já acende `nuncaRodou`.
- ⚠️ **Cada destino de conserto é gateado pela tela PARA ONDE ELE LEVA**, nunca
  por Configurações (que todo perfil vê): o link cairia na `TelaBloqueada`. O
  parâmetro de Configurações é **`?tab=`**, nunca `?section=` — a página ignora
  o resto e abriria a Visão geral. Pino: `destinos-das-correcoes.test.ts`.
- ⚠️⚠️ **Agendamentos do Calendly NÃO entram no bloco da agenda.** A linha do
  agendamento nunca é marcada depois: o cancelamento chega como evento próprio
  (1013) e o reagendamento insere linha nova sem invalidar a antiga. Listar por
  `inicio >= agora` mostraria reunião cancelada e as duas pontas de um
  reagendamento. O bloco é só `cb_meetings`, e diz por quê; juntar exige casar
  cada agendamento com o seu cancelamento.

### Notificações do navegador (#516, portado na Fase 8)

`src/lib/notifications/aviso-no-navegador.ts` (puro, pino
`aviso-no-navegador.test.ts`), o hook `use-browser-notifications.ts`, o ouvinte
na casca e o cartão em *Seu perfil*. Pino estrutural:
`src/components/settings/cartao-de-notificacao.chamadores.test.ts`.

- ⚠️⚠️ **Quem recebe aviso é decidido por `silencioDoAviso`, não pela régua
  do original** (que avisa toda mensagem de cliente da conta). Decisão do
  operador (P2): só as conexões do PERFIL (`conversaNoEscopo`), GRUPO nunca, e
  a pessoa escolhe quais conversas (todas / suas e sem responsável / só as
  suas) e se o texto aparece. Perfil sem a Caixa de entrada não recebe aviso
  (o clique cairia na `TelaBloqueada`), e o cartão nem aparece.
- ⚠️ **O contexto é o REAL** (`{ papel: profile.account_role, perfil:
  perfilDeAcesso }`), nunca `acesso`: quem simula pelo "Ver como" continua
  sendo quem recebe o aviso.
- ⚠️ **O ouvinte monta UMA vez, na casca, e só com `!entradaPendente`** (como
  o `PresenceHeartbeat`): é efeito que a porta segura.
- ⚠️ **Conversa ilegível = silêncio**: sem ela não se sabe se é grupo ou de
  outra conexão — exatamente o que a P2 manda calar. A não lida continua na
  caixa de entrada.
- ⚠️ **Mensagem gravada mais de 1 h depois do próprio carimbo não avisa**
  (`LIMITE_DE_ATRASO_MS`, medido por `gravada_em`, com queda no relógio da
  tela): a carga do histórico e a fala recuperada tarde despejariam um aviso
  por conversa. O atraso de entrega real (até 50 min medidos) ainda avisa.
  Não use `conversations.last_message_at` para "alguém escreveu depois": a
  ingestão o carimba com o relógio do SERVIDOR, não com o do WhatsApp.
- ⚠️ **A preferência é POR PESSOA neste navegador** (`cb-notificacoes:<userId>`,
  JSON lido por `lerPreferencia`, nunca `as`): a chave global do original
  (`wacrm:browser-notifications`, apagada ao gravar a nova) fazia quem entrasse
  depois no mesmo computador herdar o "ligado". O snapshot do
  `useSyncExternalStore` é o TEXTO cru — objeto novo a cada leitura faria o
  componente renderizar sem parar.
- **O título sai de `nomeDoContato`** (telefone, senão `@instagram`), nunca do
  `pickContactDisplayName` do original.
- ⚠️ **O clique dispara `EVENTO_ABRIR_CONVERSA` além do `router.push`**: com
  o inbox já montado (visível noutra conversa, num segundo monitor), o push só
  troca a query — a página não remonta e o deep link só é lido quando a lista
  recarrega. A página escuta e abre pelo caminho do "Nova conversa", sem
  reabrir a que já está ativa (zeraria o fio carregado).
- ⚠️ **O canal do recorte: conversa FIXADA usa o dela; SOLTA usa o da
  MENSAGEM** (o `follow` grava o canal novo depois do INSERT, e o ouvinte pode
  ler antes — a coluna diria o número velho, ou nulo na conversa nova). Por
  isso o select traz `channel_pinned`.
- ⚠️ **A mensagem calada por "não é sua" fica ESTACIONADA
  (`JANELA_DA_ATRIBUICAO_MS` = `LIMITE_DE_ATRASO_MS`, 1 h: a cadeia de passos
  antes de atribuir não tem teto; depois de 1 h já não é aviso de mensagem
  nova; a mais antiga nunca substitui a mais nova — pela ordem de CHEGADA do
  realtime, não pelo carimbo, que empata no milissegundo) e o UPDATE da conversa atribuída à
  pessoa (realtime, `assigned_agent_id=eq.<id>`) a solta** — decidida de novo,
  lendo a conversa como está. A automação disparada pela própria mensagem pode
  atribuí-la depois do INSERT, e sem prazo: um sono fixo (a 1ª versão, 3 s)
  não garante nada, porque outros passos podem vir antes (Codex, #287 e #289).
  As cercas: a atribuição que chega com a consulta ainda no ar é guardada
  (`atribuidasAgora`) e decide na hora de estacionar; a conversa que a
  pessoa ABRE sai da fila por evento da caixa de entrada
  (`EVENTO_CONVERSA_ABERTA`; amostrar a URL perdia quem abre e sai entre
  dois tiques) e na volta à aba (⚠️ nunca pela não lida,
  que é da conta: uma aba oculta com o fio aberto a zera e calaria quem não
  viu); a soltura de uma estacionada velha não troca o aviso de uma mais nova
  já exibida (`avisadas`); o prazo conta da MENSAGEM. ⚠️ Aceito e escrito, porque hoje nenhuma automação
  atribui conversa (medido em 24/09/2026): em "minhas e sem responsável", a
  conversa lida sem dono avisa na hora mesmo que a automação a entregue a
  outra pessoa em seguida, e a estacionada com dono de outra pessoa não é
  solta se a conversa ficar SEM dono (o filtro do realtime não casa NULO).
- ⚠️ **A tela é conferida DE NOVO antes de exibir** (`vendoAgora`): entre o
  INSERT e o aviso cabem a consulta e, na estacionada, minutos — a pessoa pode
  ter aberto a conversa nesse meio.
- ⚠️ **Aparelho de toque é "não suportado"** (`avisoPossivelNoAparelho`,
  `MIDIA_DE_TOQUE`): sem service worker, `new Notification()` lança no Chrome
  do Android e no app instalado no iPhone — a chave ligaria e nada chegaria.
