---
paths:
  - "src/components/inbox/message-thread.tsx"
  - "src/components/inbox/message-bubble.tsx"
  - "src/components/inbox/conversation-list.tsx"
  - "src/lib/inbox/canais-do-fio*"
  - "src/lib/inbox/ordem-do-fio*"
  - "src/lib/inbox/janela-24h*"
  - "src/lib/inbox/selo-da-janela*"
  - "src/lib/inbox/aviso-da-conexao*"
  - "src/components/inbox/faixa-de-conexao.tsx"
  - "src/lib/cb-channels/cores*"
---

# Canal na conversa — regras

Vale no fio (`message-thread.tsx`, `message-bubble.tsx`), na linha da lista
(`conversation-list.tsx`) e nos módulos puros `canais-do-fio.ts`, `cores.ts`,
`janela-24h.ts`, `selo-da-janela.ts` e `aviso-da-conexao.ts`. Responde três
perguntas: por qual NÚMERO esta conversa corre, ele está DE PÉ, e a janela de
24h da Meta está aberta nele? A UI de canal
em geral (peças, escopo vazio = todos, saúde das conexões) está em
`.claude/rules/canais.md`. O texto antigo, com a história, está em
`git show f5879b3f:CLAUDE.md`.

### Qual NÚMERO nesta conversa: o critério é a CONVERSA, nunca a conta

`canais-do-fio.ts` e `cores.ts` (puros, com teste), o `SeparadorDeCanal` e a
faixa de divergência no fio, o rótulo com bolinha embaixo da mensagem e a
bolinha antes do nome na lista.

- ⚠️⚠️ **Grupo fica de fora — lá o carimbo NÃO é escolha do cliente.** Com os
  dois números no mesmo grupo, o WhatsApp entrega às duas instâncias, o
  `UNIQUE (conversation_id, message_id)` descarta a segunda e fica o
  `channel_id` do webhook que chegou primeiro. Pintar isso afirmaria uma
  escolha que ninguém fez. Em grupo, "por qual número" é `cb_groups.channel_id`,
  e só no cabeçalho.
- ⚠️ **O gatilho é `fioMulticanal`, não `channels.length >= 2`.** Pela CONTA, o
  rótulo aparecia em quase toda conversa, onde não informa nada — e o olho
  aprendia a ignorá-lo justo nos poucos casos que decidem a resposta.
- ⚠️⚠️ **A cor sai da ordem de `created_at`, calculada DENTRO de
  `coresPorCanal` — nunca do índice do array recebido.** `listChannels` ordena
  `is_default DESC`: sem o sort próprio, marcar outra conexão como padrão
  repinta todas as conversas do escritório de uma vez, sem erro nenhum.
  Conexão nova entra no fim; apagar uma recolore as posteriores (aceito).
- ⚠️ **As classes da `PALETA_DE_CANAIS` são LITERAIS** (`'bg-violet-500'`):
  `bg-${cor}-500` não é gerada pelo Tailwind e a bolinha nasce transparente.
  Pino: a regex de `cores.test.ts`.
- ⚠️⚠️ **As perguntas de ORDEM (`aberturasDeCanal`, `ultimoCanalDoCliente`)
  passam por `naOrdemDoFio`** (`src/lib/inbox/ordem-do-fio.ts`; `created_at`,
  desempate pelo id — o comparador
  de `intercalar`, que desenha o fio). A lista em memória não é cronológica: o
  tempo real acrescenta no fim, e a ligação (1044) e a recuperada (1010) entram
  com carimbo no passado. Na ordem crua, o separador caía na mensagem errada e
  o aviso de número fixado lia uma mensagem antiga como "a última do cliente"
  (Codex, PR #304). Pergunta nova que dependa de ordem passa pelo mesmo helper.
- ⚠️ **Mensagem SEM carimbo não abre nem fecha trecho de canal** (histórico
  anterior ao multi-canal, acervo de conexão apagada): um separador não teria
  nome para escrever, e atribuí-la ao canal vizinho seria inventar.
- ⚠️ **A cor vive na BOLINHA; texto colorido só no separador.** A bolha da
  equipe é `bg-primary`: nome na cor do canal fica ilegível no canal da mesma
  cor e muda de contraste conforme o lado do fio. Na lista, a borda esquerda
  já é da SELEÇÃO (`border-l-2 border-primary`). O rótulo embaixo da mensagem
  é a prop `canal` (nome + cor) do `message-bubble`, 10 px, teto de 9rem.
  Trilha colorida na borda e anel no avatar foram descartados pelo operador —
  não voltar com eles.
- ⚠️ **Na lista, o canal sai de `canalDaConversa()`**, nunca de
  `conversation.channel_id` (sempre nulo em grupo).
- ⚠️ **A faixa de divergência cala com `canalDeSaida` nulo — é o gate de
  carregamento.** `activeChannel` só resolve depois do `useChannels`, e um
  aviso montado sobre lista vazia nomearia a divergência errada.
- ⚠️⚠️ **A faixa só aparece com a conversa FIXADA (`channel_pinned`).** Solta,
  a conversa SEGUE o cliente, e o carimbo da mensagem chega antes da
  atualização da conversa (duas escritas): a faixa piscaria a cada troca
  legítima, e o botão clicado nesse instante fixaria o número errado e
  desligaria o seguimento em silêncio. Com pino, a divergência é permanente e
  escolhida — toda resposta cai noutra conversa no celular do cliente. Não
  exige `fioMulticanal`. O botão re-fixa no número do cliente; "Automático" no
  menu solta. A automação também fixa (passo "Fixar a conversa no número",
  `automacoes-passos.md`): é assim que o cliente do Bancário passa ao Jurídico.
- ⚠️ **A mensagem otimista nasce carimbada com o canal da tela, e
  `/api/whatsapp/send` devolve `channel_id`.** Sem os dois, a resposta enviada
  pelo número B ficava desenhada no trecho de A até o realtime trocar a bolha
  (e realtime atrasado a deixava lá). Um 5º caminho de envio repete os dois: o
  carimbo na otimista e `marcarEnviada` com o `channel_id` da resposta.
- **Informativa, não bloqueante** (decisão do operador, 02/09/2026): confirmar
  a cada envio custaria um clique em toda conversa mista para prevenir um erro
  que a faixa já torna visível.
- **A cor é DERIVADA, não configurável.** Se um dia for, o lugar é uma coluna
  `cor` em `cb_channels` com queda para `PALETA_DE_CANAIS` — e ela entra em
  `CB_CHANNEL_SAFE_COLUMNS`, senão salva e some no reload.
- **O gatilho do seletor do cabeçalho mostra a bolinha, não o ícone de
  transporte** (que segue no menu): numa conta só de Evolution o ícone é igual
  em todas as linhas; a cor amarra o cabeçalho aos rótulos das bolhas.

### O número da conversa está FORA DO AR: faixa vermelha e compositor TRAVADO

`aviso-da-conexao.ts` (puro, pino `aviso-da-conexao.test.ts`), a
`FaixaDeConexao` colada no compositor, a pastilha "Fora do ar" no seletor de
número (gatilho e menu) e a prop `conexaoForaDoAr` do compositor. Decisão do
operador (05/10/2026, depois de a Bancário - Comercial cair sem ninguém ver):
não reverter sem perguntar.

- ⚠️⚠️ **Vermelha (`tone === 'down'`) TRAVA o que sai para o cliente**: texto,
  anexo (inclusive a fila já montada: `sendDraft` e o Enviar do
  `MediaDraftPreview`), voz, agendar, modelo e o menu +. A anotação interna
  fica livre. **Âmbar** (`detail` `webhook` = não recebe, ou `lagging` =
  atrasada) só avisa — o mesmo lado do `ENVIA_MESMO_EM_AMARELO`. `pairing`,
  `stale` e `lastError` não acendem nada: transitórios, a faixa piscaria a
  cada reconexão. É o oposto da faixa de divergência (só informa) de
  propósito: lá a mensagem chega, aqui não sai.
- ⚠️⚠️ **Sonda carregando ou que FALHOU = sem faixa e SEM trava.** Na falha,
  `useChannelHealth` guarda a lista BOA anterior; afirmar "fora do ar" a
  partir dela travaria o compositor sobre informação velha. Por isso a sonda
  é UMA por aba e agrupa a rajada do realtime (`canais.md`): com uma por
  leitor, a rota batia no teto de 40/min, o 429 virava `falhou` e a faixa
  sumia no meio da queda.
- ⚠️⚠️ **O número é o de SAÍDA, o `activeChannel` — também no GRUPO.** O
  núcleo de envio resolve pelo `conversations.channel_id` (nulo no grupo que
  ninguém fixou) e cai no padrão da conta; o `cb_groups.channel_id` é por onde
  o grupo CHEGA. Travar pelo número do grupo deixava a conversa presa sem saída
  (fixar outro número não o muda) e calava a queda do número que de fato envia.
  No grupo só o vermelho: o âmbar fala da entrada, e a medição de atraso já
  deixa grupo de fora (`canais.md`).
- ⚠️ **"Troque o número no seletor" só com um número que SERVE**
  (`podeTrocarNumero`): outro que a sonda PROVA que envia (`vivaParaEnviar`,
  `cb-channels/viva-para-enviar.ts`, a MESMA régua da cobrança do Asaas —
  reconectando ou sem configuração não serve; Codex, #386), de WhatsApp, que
  alcança o contato (`canaisQueNaoAlcancam`); no grupo, por QR Code. Conversa
  do Instagram, não.
- ⚠️ **Lê o `tone`/`detail` do servidor (`toneFor`), nunca reavalia a régua.**
  O pino colhe os motivos do próprio `toneFor`: renomear um lá apaga a faixa.
- ⚠️ **`conexaoForaDoAr` não é `sessionExpired`**: a fila de anexos NÃO trava
  pela janela (o fio recusa no disparo) e a dica da janela oferece o modelo;
  com a conexão caída nem o modelo sai, e a dica cala. Diálogo que já estava
  aberto quando a sonda virou confere de novo no enviar (`handleSendTemplate`
  no fio, `sendInteractive` no compositor, a prop `conexaoForaDoAr` do
  `ExecutarAutomacaoDialog`; Codex, #386). Diálogo NOVO que envia a partir da
  conversa repete a conferência.
- **A trava é da TELA.** A rota de envio não consulta a saúde: um envio
  disparado antes da sonda seguinte segue e falha como antes. Ficam livres o
  "Executar agora" da agendada, reagir, editar e apagar no fio, e as automações
  do motor (o "Executar automação" do menu + trava junto com o menu).
- **A volta destrava com atraso:** a rota guarda o `fetchInstances` por 15 s, e
  a sonda pedida pelo realtime ainda pode responder "fora" (e regravar
  `disconnected` por cima do `connected` do webhook) até o tique seguinte —
  ~30–45 s depois de a conexão voltar.
- **Não vê a conexão "aberta" que parou de receber sem erro** (02/10/2026: o
  provedor diz `open`, o webhook aponta para cá e a medição de atraso
  envelhece). Esse é outro alarme ("nada chega há tempo demais").

### A janela de 24h da Meta é POR NÚMERO (`janela-24h.ts`)

- ⚠️⚠️ **A Meta só conta a mensagem que o cliente mandou ao número oficial por
  onde se vai responder.** Contando o fio inteiro, quem escreveu só pelo número
  por QR Code deixava a etiqueta aberta e o compositor livre, e a Meta recusava
  o texto (131047). A regra recebe o canal de SAÍDA (id + transporte) e conta
  a mensagem do cliente carimbada com ele.
- ⚠️⚠️ **Sem carimbo, decide pela PROCEDÊNCIA** (ao contrário do separador):
  conta se veio pela API da Meta (`message_id` com `wamid.`) e a saída é Meta;
  não conta se veio da Evolution. Não contar nada trancava o compositor sobre
  cliente que acabou de escrever, sem saída na tela; contar tudo reabria o
  131047.
- **Canal de saída NULO** (conta sem conexão nenhuma, legado de número único)
  conta o fio inteiro. "Fio vazio = aberta" vale para o FIO inteiro, nunca
  para o recorte do canal.
- ⚠️ **`canalDaJanela` (= `activeChannel`, id + transporte, o mesmo do
  `expected_channel_id`) é parâmetro OBRIGATÓRIO de `janelaFechada` e
  `minutosRestantes`**, e os dois relógios passam o MESMO canal. Pino
  estrutural: `janela-24h.chamadores.test.ts`.
- ⚠️ **A janela é lida no DISPARO.** Os três caminhos de envio (texto, mídia,
  interativa) passam por `janelaFechadaAgora()` antes do `fetch` — nunca por
  `sessionInfo.expired`, um `useMemo` que só recomputa no tique de 1 min da
  etiqueta. Um merge que traga o `sessionInfo` inline do upstream devolve os
  três buracos.
- ⚠️ **`janelaDe24h = !canaisCarregando && !canaisFalharam && !evolutionActive
  && !ehGrupo`** — os QUATRO termos. Com os canais carregando (ou a consulta
  falhando), "não é Evolution" era lido como "é Meta": a etiqueta "Expirada"
  piscava e o compositor nascia desabilitado no instante em que o operador
  abria a conversa para responder. Grupo é só Evolution e não tem janela (o
  `activeChannel` dele cai no padrão da conta).
- ⚠️ **Conta SEM canal nenhum continua na regra da Meta**, de propósito: ali a
  lista resolveu vazia, e vazio-com-resposta é conhecimento, não lacuna. A
  distinção entre os dois vazios é a feature inteira.
- **`restanteParaExibir` fala minutos na última hora** (antes ela aparecia
  inteira como "1h restantes").

### Selo da janela de 24h na lista (991/993): a ampulheta lê o BANCO, e o banco espelha o fio

`conversations.janela_meta` (mapa número → instante, mais a chave
`sem_carimbo`; gatilho em `messages` e dobra na exclusão de conexão),
`selo-da-janela.ts` (puro) e a ampulheta em `conversation-list.tsx`
(`canalDeSaidaDaLinha`, `canaisPorId`/`canalPadrao`, `tTimer`). Decisões do
operador (10/09/2026): só a ampulheta, expandindo no hover; cor padrão de 24 h
a 12 h, âmbar de 12 h a 3 h, vermelha abaixo de 3 h; fora das Encerradas; só
WhatsApp oficial; sem filtro "janela aberta".

- ⚠️⚠️ **O gatilho é ESPELHO de `contaParaOCanal`.** Mensagem do CLIENTE
  carimbada com conexão `meta` avança a chave do número; sem carimbo, só com
  id `wamid.`, e na chave `sem_carimbo` (conta para qualquer oficial de
  saída); QR Code e Instagram não tocam no mapa. Para o número de saída, a
  lista pega a mais recente entre a chave dele e a `sem_carimbo`. Mudou a regra
  num lado, muda no outro: `selo-da-janela.test.ts` lê o SQL e compara o
  `restante` da lista com o `minutosRestantes` do fio sobre as mesmas
  mensagens, inclusive com DOIS oficiais.
- ⚠️ **A condição "janela de 24h aberta" das automações lê o MESMO mapa**
  (`minutosRestantesNoMapa`; regra em `automations/janela-da-meta.ts`), nunca
  o `seloDaJanela`: encerrada CONTA (o selo cala por decisão de tela), mapa
  vazio é FECHADA (o "fio vazio = aberta" existe só para não travar o
  compositor), QR Code é sempre aberta, e erro de leitura responde "não" — o
  modelo é o lado seguro. Mudou a leitura do mapa, os dois mudam juntos.
- ⚠️ **UMA divergência escrita, para o lado sem selo:** a conta SEM canal
  nenhum (o fio conta o fio inteiro; a lista cala, porque não sabe por qual
  número se responde).
- ⚠️ **Conexão oficial apagada: a chave dela é DOBRADA em `sem_carimbo`**
  (gatilho AFTER DELETE em `cb_channels`, fica a mais recente das duas) — é o
  espelho do `ON DELETE SET NULL` nas mensagens; sem a dobra, a lista
  esconderia a janela que o fio mostra.
- ⚠️ **Só AVANÇA, e mensagem apagada continua contando**: apagar para todos
  não fecha a janela do lado da Meta, e replay do webhook com mensagem antiga
  não recua o relógio.
- ⚠️ **O número de saída da linha é resolvido como no fio** (canal da
  conversa, senão o padrão da conta) e fica `null` enquanto os canais carregam
  ou se a consulta falhou — lista vazia não vira a afirmação "é Meta".
- ⚠️ **Encerrada é escondida pela TELA, não pelo banco** (a reabertura vem
  depois do insert; a reaberta volta a mostrar). Grupo nunca, nos dois lados.
- **`COR_DA_AMPULHETA` são classes LITERAIS.** O texto do hover é o mesmo da
  etiqueta do cabeçalho do fio (`Inbox.sessionTimer.xhRemaining`/
  `xmRemaining`). No toque não há hover: vale a cor, e o tempo vai no `title`.
