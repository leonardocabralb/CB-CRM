---
paths:
  - "src/lib/cb-groups/**"
  - "src/app/api/cb/groups/**"
  - "src/components/inbox/group-sidebar.tsx"
  - "src/components/inbox/painel/participantes-do-grupo.tsx"
  - "src/hooks/use-participantes-do-grupo.ts"
  - "src/hooks/use-grupos-do-contato.ts"
  - "src/components/inbox/painel/grupos-do-contato.tsx"
  - "supabase/migrations/1117_cb_grupos_dos_contatos.sql"
  - "supabase/migrations/1119_cb_recibos_do_grupo.sql"
  - "src/components/inbox/dados-da-mensagem-do-grupo*"
  - "src/hooks/use-nomes-nos-grupos*"
  - "supabase/migrations/1126_cb_nomes_nos_grupos.sql"
---

# Grupos de WhatsApp — regras

Vale para a ingestão de grupo (`cb-groups/persist.ts`), a sincronização e o
detalhamento (`sync.ts`, `detalhar-na-chegada.ts`), as rotas
`/api/cb/groups/**`, o painel do grupo (`group-sidebar.tsx`, aba
Participantes) e o grupo na ficha do cliente (1117). Grupo não é contato: a regra geral está na raiz (8d); o que
a ingestão de grupo NÃO faz (reabrir, motores, entrega), em `ingestao.md`; o
transporte da Evolution em geral, em `whatsapp-evolution.md`. Plano e
medições: `docs/PLANO-participantes-do-grupo.md`.

### O transporte (906/916)

- ⚠️ **A regra do `@lid` do 1:1 NÃO vale em grupo.** O remetente vai
  desnormalizado em `messages.group_sender_*`, sem FK e sem criar contato.
  Quase todo participante chega em `@lid`: a regra do 1:1 esvaziaria o recurso.
- ⚠️⚠️ **Recibo de grupo** (04/11/2026, 1119; decisões do operador): o ERROR
  não vira "não entregue" (só o `479`, quando vem o código), e a bolha vira
  ✓✓/azul quando TODOS os participantes de fora receberam/leram, como o
  WhatsApp — pelo recibo por participante que o 5º patch repassa
  (`recibos-do-grupo.ts`, `cb_recibos_do_grupo`, `cb_registrar_recibo_do_grupo`
  com trava por mensagem: sem ela, dois recibos juntos contavam "1" cada).
  O transporte: `whatsapp-evolution.md` (Recibos); o plano:
  `docs/PLANO-recibos-de-grupo.md`.
- ⚠️⚠️ **O recibo guarda o participante (o JID como chegou, sem o
  aparelho), a FICHA e as horas, nunca o telefone à parte** (a D4 de 29/10,
  abaixo: o telefone de quem não é cliente só existe na leitura ao vivo). No
  grupo endereçado por telefone (raro) o próprio JID é o número, como já em
  `messages.group_sender_jid`. A ficha sai do telefone da CHEGADA
  (`fichaDoRecibo`, pela chave de pessoa) e fica sem FK, como na 1117; o
  `participantAlt` do aviso morre na rota do webhook. Só com
  `groups_enabled` (a conexão que desliga grupos não grava nada) e nunca o
  número da conta (`ehNumeroDaConta`: o `own_lid` ou a chave do
  `display_phone`).
- ⚠️ **O denominador `cb_groups.participantes_de_fora` sai da MESMA conferência
  das fichas** (`participantesDeFora`, pelos `chavesDasConexoes`), no detalhe
  e no painel; NULO = não se sabe, e a bolha fica em ✓. Sem telefone conta
  como de fora (o denominador só erra para cima). Envelhece com a
  conferência: quem entrou depois não conta. Não guarda a LISTA.
- ⚠️ **"Dados da mensagem"** (barra de ações da bolha nossa de grupo que
  saiu, `dados-da-mensagem-do-grupo.tsx`) lê do BANCO, nunca ao vivo
  (`GET /api/cb/groups/[id]/recibos`): quem leu e quem recebeu. Nome pela
  ficha do recibo, senão pela regra dos participantes; telefone só quando o
  participante É um JID de telefone; nunca o LID. Vazio = "nenhum recibo
  REGISTRADO" (a mensagem de antes do patch não tem), falha = 500 e "Tentar
  de novo". O resumo "N de M" some com a lista cortada (o `total` vem do
  `count`) e com mais recibos que o denominador.
- **Grupo não dispara automação, fluxo nem IA**: `cb-groups/persist.ts` não
  importa os motores, e um teste lê o fonte. Grupo nas automações = import
  visível ali, nunca uma flag. `persist.ts` também não chama a Evolution:
  quem detalha é a rota do webhook.
- ⚠️ **`persist.ts` não reabre conversa encerrada.** Grupo encerrado some da
  caixa enquanto as mensagens continuam chegando; só um envio da equipe o
  reabre. Por isso o encerramento em lote (1018) deixa grupo de fora por padrão.
- ⚠️ **`group/fetchAllGroups` estoura** (mais de 90 s). Use `chat/findChats`
  filtrando `@g.us` (traz nome e foto). `findGroupInfos` (~650–850 ms por
  grupo) só para participantes, announce, admin, `restrict` e o nosso LID.
- ⚠️⚠️ **Na 2.4, todo `GET /group/…` exige CORPO** (`getComCorpo` em
  `evolution-client.ts`, pino `evolution-client.get-com-corpo.test.ts`): ela
  roda no Express 5, que deixa `req.body` INDEFINIDO no pedido sem corpo, e o
  `groupValidate` faz `Object.assign(body, …)` em cima dele — "Cannot convert
  undefined or null to object". Medido em 29/10/2026: nenhum grupo era
  detalhado desde a troca de versão (os 12 detalhados eram de 01/09). O
  `fetch` do Node recusa corpo em GET e descarta o `Content-Length`; por isso
  o `node:http(s)`, que NÃO segue redirecionamento (`server_url` atrás de 301
  falha só aí). GET de grupo novo passa pelo mesmo método.
- ⚠️ **Um evento desconhecido faz a Evolution recusar a lista INTEIRA de
  eventos do webhook.** `GROUPS_UPDATE` não existe. `GROUP_UPDATE` existe na
  2.4, mas ainda não está na lista do CRM (pendente em `PLANO-baileys-7.md`,
  ajuste 5: conferir o enum e "Ressincronizar" as conexões).
- **Ligar `groups_enabled` não basta**: instância já conectada só recebe os
  eventos novos depois do "Ressincronizar".
- **Menção chega em `@lid`**: `cb_channels.own_lid` (916) é aprendido na
  primeira mensagem nossa num grupo; sem ele, `mentions_us` fica sempre falso.
- **Insert em BLOCO preenche coluna ausente com NULL**: `from_device` e
  `mentions_us` (NOT NULL) estouram com linhas não uniformes no lote.

### Detalhe do grupo: nome, contagem, "somos admin?"

- ⚠️⚠️ **Grupo sem `participant_count` (ou com a conferência das fichas
  vencida, abaixo) é detalhado na CHEGADA** (`detalhar-na-chegada.ts`): a
  gravação devolve `grupoParaDetalhar`, a rota do
  webhook junta os jids num `Set` e detalha UMA vez por grupo DEPOIS dos
  itens, dos anexos e das fotos (dentro do laço, ~0,8 s por grupo atrasaria —
  e num corte do `after()` perderia — as mensagens seguintes). Freio de 15
  min por `<conta>:<jid>` no processo, carimbado ANTES da chamada (vale também
  na falha). Pino `route.grupo-sem-detalhe.test.ts` (inclusive a ordem
  contra o download do anexo).
- ⚠️ **O sinal é `participant_count` nulo, nunca o `synced_at`**: a parte
  rápida da sincronização e o `groups.upsert` carimbam o `synced_at` sem
  participantes nem admin, e o grupo cujo detalhamento falhou ficaria travado
  para sempre.
- ⚠️⚠️ **Só pela conexão DO grupo** (`channel_id` igual ao do webhook): com
  dois números nossos no mesmo grupo, o "somos admin?" do outro número seria
  gravado, e o renomear sai pela `channel_id` do grupo. Grupo sem conexão (a
  dele foi apagada) não é detalhado por ninguém.
- **`camposDoDetalhe` é a lista ÚNICA do que o detalhe grava** (o lote da
  sincronização e a leitura do painel): nome, descrição, foto e dono só
  quando vieram — nunca NULL por cima.
- ⚠️ **A nossa linha entre os participantes se acha pela chave de pessoa**
  (`chaveDePessoa`), nunca pela grafia (o canal gravado sem o nono dígito e o
  WhatsApp entregando com ele davam "não admin" ao próprio admin), ou pelo
  `own_lid` do canal. ⚠️ Sem achá-la, `weAreAdmin` é `null`, nunca `false`:
  `camposDoDetalhe` não o grava e quem decide o renomear completa com o
  gravado (`?? we_are_admin`) — um "não achei" travaria o admin de verdade.
- ⚠️ **Telefone de participante só sai de `@s.whatsapp.net` ou de dígitos**
  (`digitosDeTelefone`), nunca de um `@lid`: ele alimenta a ficha e o
  "Conversar", e o LID jamais vira número de contato.

### Participantes e renomear: AO VIVO

Decisões do operador (29/10/2026): D2 (renomear também quando o grupo deixa
qualquer participante mudar os dados) e D4 (quem vê o grupo vê os telefones,
como no próprio WhatsApp).

- ⚠️⚠️ **A lista não é guardada** (só o vínculo com as FICHAS, abaixo):
  `GET /api/cb/groups/[id]/participantes` lê o `findGroupInfos` na hora e
  devolve; telefone de participante só existe nessa resposta. Guardar exigiria acompanhar cada entrada e saída, e a lista
  envelheceria sem aviso. A mesma leitura grava o espelho
  (`camposDoDetalhe`) e devolve `podeRenomear`.
- ⚠️ **Lista vazia é FALHA (502), nunca "nenhum participante"**: o número da
  conexão está no grupo, senão a Evolution nem leria os dados. Conexão
  ausente ou que não é da Evolution = 409 `SEM_CONEXAO`.
- **Nome, nesta ordem** (`nomes-dos-participantes.ts`): a ficha do CRM pelo
  `telefone_canonico` (em fatias); senão o nome mais recente com que a pessoa
  escreveu NESTE grupo (as últimas 1000 mensagens, pela chave de pessoa do
  telefone ou pelo LID);
  senão o telefone; sem telefone, "Número oculto" — nunca o LID cru. O
  `findGroupInfos` não traz nome, e o da Evolution vem dos contatos do
  celular, não do grupo.
- ⚠️⚠️ **Renomear vale para admin OU grupo com `restrict === false`**
  (`podeRenomearAoVivo`), conferido AO VIVO também no `PATCH`: o
  `we_are_admin` gravado envelhece (o número rebaixado), e o `restrict` nem é
  guardado. Só sem resposta legível vale o gravado. `null` não destrava.
- **O painel lê o grupo assim que o mostra** (`useParticipantesDoGrupo`, não
  só com a aba aberta): o renomear depende da leitura. Até ela voltar (ou se
  falhar), vale o `we_are_admin` gravado, com a frase "Conferindo…". ⚠️ O
  painel fica MONTADO mesmo fechado: a última leitura boa de cada grupo é
  reaproveitada por 3 min (`leiturasRecentes`, de módulo; o "Tentar de novo"
  passa por cima), e o patch do grupo NÃO é reaplicado dela (desfaria um
  renomear feito depois).
- ⚠️⚠️ **`onGrupoAtualizado` da página aplica o patch na conversa ABERTA**,
  não pelo id do grupo: o hook só o chama com o grupo ainda NA TELA
  (`grupoNaTelaRef`, efeito de LAYOUT) — a resposta de A que pousa entre a
  troca e a limpeza do efeito gravaria a contagem de A em B.
- **"Conversar" com um participante** abre a Nova conversa da lista
  (`pedirConversaComContato`), só para `send-messages` e só com telefone.

### O grupo na ficha do cliente (1117)

Pedido do operador (30/10/2026): o participante com conversa no CRM abre a
conversa individual pelo grupo, e o cliente vê e abre os grupos dele pela
própria conversa. `cb_grupos_dos_contatos` e `fichas-do-grupo.ts`.

- ⚠️⚠️ **Guarda-se só a FICHA de quem está no grupo** (grupo, ficha,
  `visto_em`), nunca a lista: o telefone de quem não é cliente segue só na
  leitura ao vivo. Escreve só o servidor (nenhuma policy de escrita; o
  navegador sem INSERT/UPDATE/DELETE).
- ⚠️⚠️ **Refeito por INTEIRO a cada leitura completa** (o painel, o
  "Sincronizar", a chegada), SÓ pela função `cb_gravar_fichas_do_grupo`:
  apaga quem saiu, grava quem está e carimba
  `cb_groups.participantes_conferidos_em` numa transação, com o grupo
  TRAVADO. Em três pedidos soltos, duas conferências ao mesmo tempo se
  cruzavam e apagavam quem estava nas duas listas (revisão de 30/10/2026).
- ⚠️⚠️ **Só com a lista, as fichas (`fichasPorTelefone` → `completa`) e os
  números do escritório (`chavesDasConexoes`) lidos por inteiro**: lista
  vazia é falha, e um conjunto pela metade apagaria o vínculo de quem não se
  leu. `fichasParaGravar` tira o nosso número E os das outras conexões da
  conta (a ficha da conversa interna não é cliente do grupo) e devolve NULO
  quando ninguém além de nós tem telefone (a Evolution mudou o campo ou
  perdeu o par do LID): aí só se carimba, nunca "ninguém".
- ⚠️ **Envelhece entre leituras**: mensagem num grupo conferido há mais de
  24 h (`conferenciaVencida`) o detalha de novo; quem entra ou sai de um grupo
  PARADO, ou ganha ficha depois, só aparece quando alguém o abre ou
  sincroniza. Não há evento de participantes no webhook (evento desconhecido
  derruba a lista, acima). Depois da 1117, todo grupo começa sem conferência.
  O `conversaId` da lista vem do cache de 3 min do painel.
- ⚠️ **A ingestão lê o grupo com `select('*')`** (`COLUNAS_DO_GRUPO`): pela
  lista de colunas, um banco sem a 1117 derrubava a leitura e o INSERT
  (42703) e TODA mensagem de grupo se perdia.
- ⚠️⚠️ **`contact_id` SEM FK, de propósito**: a Lixeira e `cb_unir_fichas`
  são default-deny sobre FKs para `contacts` (`supabase.md`; o precedente é o
  `note_id` da 1114). A ficha que sai (Lixeira, união, exclusão de vez)
  deixa a linha solta até a próxima conferência, que a apaga; a restaurada
  (mesmo id) é religada na conferência seguinte. A tela lê pelo contato
  aberto. Para `cb_groups`, FK composta com CASCADE.
- **Os dois pulos são o da PÁGINA** (`onAbrirConversaRelacionada`,
  `inbox-conversa.md`). No grupo, o participante com conversa (`conversaId`
  da rota) é a LINHA inteira, e a faixa diz o nome do GRUPO (`nomeDoGrupo`
  da origem); sem conversa, o "Conversar". Na ficha, a seção "Grupos de
  WhatsApp" da aba Relacionados (`useGruposDoContato`, `{ de }`) abre o grupo
  com a faixa "Voltar para" o cliente; a etiqueta da aba soma os dois só
  quando os dois responderam. A ficha de `/contatos` não mostra os grupos.

### Apelido × nome do WhatsApp; a busca por participante (1126)

Pedido do operador (06/11/2026): o apelido interno não pode esconder o nome
real do grupo, e a busca acha o grupo pelo nome das pessoas.

- **O apelido continua sendo o TÍTULO** (`nomeDoGrupo`), e o nome do WhatsApp
  fica à vista sob ele por `nomeRealSobApelido` (só com apelido E nome, e
  diferentes, sem contar caixa e espaço): na linha cinza do cabeçalho do fio
  e do topo do painel ("Nome · N participantes"), rotulado na aba Informações
  e no `title` da linha da lista (a linha não tem espaço para os dois).
- ⚠️ **A busca por participante só conhece os nomes que o CRM GUARDA**
  (`cb_nomes_nos_grupos`, 1142): as fichas ligadas (1117) e o nome com que cada um
  escreveu no grupo (`messages.group_sender_name`), nas ÚLTIMAS 1000
  mensagens com nome de cada grupo (o teto de `nomes-dos-participantes.ts`).
  Quem só escreveu antes delas, ou nunca, e não tem ficha não é achado — a
  lista inteira não é guardada (D4, acima). ⚠️ Sem o teto, a RPC lia todo o
  histórico dos grupos a cada busca e chegava aos 8 s do `authenticated`. É a
  terceira fonte do OU da busca (`participanteQueCasa`, `inbox-lista.md`).
- ⚠️ **Os nomes só são lidos com TERMO de busca e grupo na conta**
  (`useNomesNosGrupos`): a lista recarrega ~1.500 vezes por dia e o banco já
  esteve no teto de conexões. Lidos uma vez; a volta à aba (`resyncToken`)
  relê — na hora, com termo na caixa. `null` não recorta nada, só deixa de
  somar. ⚠️ A lista DIZ "buscando" e "falhou" ao lado da busca (`carregando`/
  `falhou` do hook; a primeira que falha tenta de novo em 30 s): sem isso, o
  grupo achado só pelo participante sumia com "Nenhuma conversa".
- A linha do grupo achado SÓ pelo participante troca a prévia por
  "Participante: Fulano" (antes do trecho do corpo das mensagens): sem isso o
  grupo apareceria no resultado sem dizer por quê.
