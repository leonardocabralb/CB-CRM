# Imagem `evolution-api-cb` — Evolution 2.4 (develop) com os nossos patches

## Por que esta versão, e não a mais nova

A versão é ESCOLHIDA, medida em produção, para acabar com o "Aguardando
mensagem" sem trocar um defeito por outro pior. Decisão do operador de
09/09/2026; voltar de versão está descartado (`docs/DECISOES-DO-OPERADOR.md`).

- **Evolution 2.3.2 / Baileys 6.7.19** (a de antes): não conhece o LID e
  mantém DUAS sessões de criptografia por aparelho, uma pelo telefone e outra
  pelo LID (medido no Redis em 09/09/2026: 4 sessões para 2 aparelhos, zero
  `lid-mapping`). Quando o envio cai na sessão que o aparelho descartou, o
  cliente vê "Aguardando mensagem". Atualizar só a Baileys não sobe: a 2.3.2
  importa `isJidUser`, que a 7.x removeu.
- **2.3.7 e 2.4.0-rc2 / Baileys 7.0.0-rc.9**: resolvem o "Aguardando", mas a
  rc.9 não manda o `tctoken`: o WhatsApp conta toda mensagem como abordagem a
  desconhecido, as mensagens ficam "PENDING para sempre" (463) e o número entra
  numa quarentena de dias, o risco de restrição que não dá para correr. A
  2.3.7 ainda perde o LID no payload (`remoteJidAlt` igual ao telefone).
- **`develop` no commit `e273b904` / Baileys 7.0.0-rc13** (a escolhida): LID
  nativo (sessões no formato LID, migração das antigas, sessão quebrada
  recriada sozinha) e o carimbo. Sem release, por isso o commit fixo no
  workflow e a imagem sempre por digest.
- ⚠️ **Nunca `evoapicloud/evolution-api:latest`**: em 04/11/2026 a tag
  apontava para a 2.3.7 com a rc.9 (commit `b900770a`, build de 06/05/2026).
  A `homolog` oficial é uma tag que pode andar; em 04/11/2026 ainda era o
  digest `1e656f95…` de 14/07/2026, o mesmo commit desta, sem os patches
  abaixo e sem o `prisma.config.ts`.

Fontes: `docs/PLANO-baileys-7.md` §2 e §3 (diagnóstico, tabela das versões,
decisão) e `docs/INFRA-VPS.md` §4 (a imagem no ar). O guia entregue
(`docs/INSTALACAO.md`, passo 3.1) e o `docker-compose.evolution.yml`
recomendam esta imagem e repetem o porquê: trocar aqui o commit, a Baileys ou
um patch muda os dois no mesmo PR. Para quem ficou na 2.3.x, a ponte é
`docker/evolution-lid-fix/`, que leva o ack do `<status>` (item 5) para a
6.7.19 e não resolve o "Aguardando".

## O que a imagem muda

Construída pelo workflow `.github/workflows/evolution-cb.yml` a partir do
**mesmo commit** da imagem `evoapicloud/evolution-api:homolog` que está em
produção (`e273b904`, build de 14/07/2026), com estas diferenças:

1. `2708-citacao.patch` — o PR upstream evolution-foundation/evolution-api#2708
   ("preserve reply metadata when flattening extendedTextMessage"): o
   `prepareMessage` da 2.4 achata `extendedTextMessage` em `conversation` e
   descartava o `contextInfo` (stanzaId/quotedMessage) — toda resposta de
   cliente citando uma mensagem nossa chegava sem a citação (issue #2713).
   O patch copia o `contextInfo` para o nível de cima antes de apagar o
   invólucro. 27 linhas, um arquivo.
2. O Dockerfile passa a copiar `prisma.config.ts` para a imagem — sem ele o
   Prisma 7 não roda `migrate deploy` (medido em 09/09/2026: a `homolog` não o
   traz e a produção sobe com um bind mount de `/root/evolution/`).
3. `foto-de-perfil-por-telefone-com-teto.patch` (17/09/2026) — o handler de
   `messages.upsert` roda dentro do `concatMap` do `BaileysMessageProcessor`
   (um lote por vez) e esperava `profilePicture(received.key.remoteJid)`: a
   consulta de foto ao WhatsApp feita com o **LID**, que o servidor não
   responde, e a Baileys 7 espera os 60 s de `defaultQueryTimeoutMs` — **1
   mensagem por minuto por conexão**, medido. Trinta linhas antes a própria
   Evolution já tinha trocado o LID pelo telefone em `messageRaw.key.remoteJid`.
   O patch consulta por esse telefone e passa um teto de 5 s **só nesse
   chamador** (`profilePicture` ganhou um `timeoutMs?` opcional; o endpoint
   HTTP que a 973 do CRM usa continua sem teto). 22 linhas, um arquivo. O
   `develop` do upstream em 17/09/2026 ainda tem o defeito (linha 1699).
   Diagnóstico, medições e o protocolo de verificação: `docs/PLANO-baileys-7.md`,
   5.10.
4. `sessao-unica-e-reconexao.patch` (06/10/2026) — quatro defeitos do ciclo de
   conexão, vistos juntos em produção em 06/10/2026:
   - **Dois sockets com as mesmas credenciais, em laço.** `GET /instance/connect`
     com o estado em memória `close` sempre abria um socket novo sem encerrar o
     anterior, e os eventos de TODOS os sockets mexiam no mesmo estado. Depois
     de uma queda que ela mesma reconecta (440, 515, 428…) a Evolution agenda a
     reconexão em 3 s; um connect nessa janela (o diálogo de QR do CRM pede um a
     cada 5 s fora de `open`) criava o segundo socket, e os dois se derrubavam
     (`conflict`/`replaced` → 440 → reconecta) sem parar. Agora há **um socket
     por instância**: um contador de geração sobe a cada socket criado e no
     logout; `createClient` encerra o anterior num bloco síncrono depois dos
     `await` (e desiste se outro terminou antes); `connection.update` e
     `creds.update` de socket superado são ignorados (as mensagens dele seguem);
     o timer de 3 s confere a geração, `isDeleting` e `endSession` antes de
     reconectar.
   - **Depois do "Reparear" a instância não reconectava mais sozinha.** O logout
     liga `isDeleting` e nada o desligava: nem o 515 obrigatório depois da
     leitura do QR reconectava, até reiniciar o contêiner. `connectToWhatsapp`
     o zera (é o caminho explícito de voltar a conectar). O logout também zera o
     QR guardado (o connect seguinte podia devolver o QR do pareamento anterior)
     e deixa de parar no `close` em memória: só instância inexistente responde
     "already disconnected", porque `close` em memória não prova que não há
     socket nem credencial. ⚠️ Com o socket já morto, esse logout apaga a
     credencial sem avisar o WhatsApp: o aparelho antigo continua listado em
     "Aparelhos conectados" no celular (conta no limite de 4) e se remove à mão.
   - **Uma queda de rede com 408 desfazia o pareamento.** O 408 está em
     `codesToNotReconnect`, e o ramo que não reconecta emite `logout.instance`,
     cuja limpeza apaga a linha `Session` (as credenciais). Na Baileys, 408 é
     também o keepalive perdido ("Connection was lost", ~35 s), o tempo
     esgotado do handshake e qualquer erro de conexão `E…` (DNS, recusada) numa
     reconexão: aconteceu às 14:05 BRT numa conexão de produção. Com o socket
     pareado (`creds.account`, gravado só no pair-success — `creds.me` não
     prova, o código de pareamento o preenche antes), o 408 reconecta como os
     outros; sem pareamento (fim dos QR) continua como estava. Toda reconexão
     agora grava `connecting` no banco antes do timer: sem isso, uma queda de
     rede longa (408 atrás de 408) ficava `open` no banco — que é o que o
     `fetchInstances` e a saúde do CRM leem — durante a queda inteira.
   - **A limpeza que apaga as credenciais deixava as chaves.** Com o auth state
     no Prisma e o Redis ligado (`CACHE_REDIS_SAVE_INSTANCES=false`, o nosso),
     as credenciais ficam na linha `Session` e as chaves Signal (sessões,
     pre-keys, sender keys) no hash `evolution:instance:<id>` do Redis. O
     `cleaningUp` do monitor apagava só a `Session`; o pareamento seguinte nascia
     por cima das chaves de um aparelho morto (medido em 06/10/2026: ~5 mil
     campos sobrando; pareado por cima deles, o aparelho novo foi removido pelo
     celular duas vezes — a relação de causa não está provada). Agora apaga o
     hash junto, como o `removeCreds` do logout já fazia.

   Três arquivos (`whatsapp.baileys.service.ts`, `instance.controller.ts` e
   `monitor.service.ts`), +105/−15 linhas. As partes vão juntas: zerar o
   `isDeleting` sem o filtro de geração deixaria o 408 de um socket de QR extra
   apagar o pareamento novo. Limites conhecidos: o filtro vale quando o evento
   SAI da fila — um `open` cujo handler já estava em curso (ele espera a foto de
   perfil) quando o socket foi superado ainda grava; e um connect que chegue de
   FORA do CRM no meio de um logout (o `/manager`) não é serializado com ele.
   O `develop` do upstream em 06/10/2026 ainda é o `e273b904`; há PRs abertos e
   não mesclados para pedaços disso (#2560, #2655, #2656, #2732), nenhum com o
   filtro de geração.

5. `baileys+7.0.0-rc13.patch` (04/11/2026) — **na Baileys compilada**, não no
   fonte da Evolution: o WhatsApp passou a entregar o Status (stories) dos
   contatos a ALGUMAS contas como um stanza `<status>` de topo, em vez de
   `<message from="status@broadcast">`, e a Baileys só registra `message`,
   `call`, `receipt`, `notification` e `ack,class:message` — o `<status>` nunca
   recebia ack. ~50 min depois o servidor encerra o stream nomeando o ack que
   faltou (`stream:error` com `<ack class="status" type="media|text">`, que a
   Baileys mapeia para 500/`badSession`); na reconexão ele reentrega o mesmo
   `<status>` e a fila de ENTRADA da conta (mensagens, recibos, acks dos nossos
   envios) fica represada atrás dele, andando uns poucos itens a cada 50 min.
   Medido em produção em 04/11/2026 na Trabalhista e Previdenciário - Jurídico:
   22 quedas com 500 cravadas a cada ~50 min desde 03/11, entrada 23 h atrasada,
   73 envios sem recibo; as outras 3 conexões, no mesmo contêiner, sem nada (a
   mudança do servidor é gradual, por conta). Reiniciar a instância, parear de
   novo pelo QR e o `readStatus` NÃO resolvem (o stanza nem chega ao
   `handleMessage`). O patch é o do PR upstream WhiskeySockets/Baileys#2866
   (issue #2858, abertos e não mesclados em 04/11/2026): `ws.on('CB:status')`
   manda o ack pelo `sendMessageAck` que já existe (`class="status"`, com
   `type` e `participant`), SEM código de erro (um NACK deixaria o stanza
   pendente no servidor). O stanza não é decodificado — o CRM não lê Status.
   Entra pelo `patch-package` que o Dockerfile do upstream já roda (`patches/`
   copiado antes do `npm ci`); o nome do arquivo casa a versão instalada, e o
   build falha se o handler não estiver no `messages-recv.js`. 7 linhas.
6. `recibo-de-grupo.patch` (04/11/2026) — **mensagem enviada a GRUPO nunca
   passava de ✓.** Na Baileys 7.0.0-rc13 o recibo de grupo (entrega e
   leitura) sai UM POR PARTICIPANTE no evento `message-receipt.update`
   (`handleReceipt`), nunca no `messages.update`, e a Evolution só o usava
   para marcar como lidas, no banco DELA, as mensagens RECEBIDAS
   (`updateMessagesReadedByTimestamp`): nada ia ao webhook. Medido em
   04/11/2026 no banco do CRM, 30 dias de mensagens da equipe e do robô nas
   conexões da Evolution: em grupo, 83 `sent`, 10 `failed` e ZERO entregue ou
   lida; no 1:1, milhares de entregues e de lidas.
   O patch, depois do que o bloco já fazia, manda ao webhook, para cada
   recibo de mensagem NOSSA (`fromMe`) num `@g.us`, um `messages.update` com
   `{ keyId, remoteJid, fromMe: true, participant, participantAlt,
   reciboDoGrupo, instante, instanceId }`:
   - `reciboDoGrupo` é `READ` (o recibo traz `readTimestamp`) ou
     `DELIVERY_ACK` (`receiptTimestamp`), e `instante` é esse carimbo, em
     segundos; recibo sem carimbo válido não sai;
   - `participant` é o `userJid` do recibo (sem aparelho); `participantAlt`,
     só quando ele é LID, o telefone que a própria Evolution conhece para o
     LID (`lidMapping.getPNForLID`); sem o par, ou com erro, o campo não vai;
   - o próprio número da instância fica de fora (o `sender` e o `read-self`
     dos nossos aparelhos também chegam como leitura), comparado com o
     `user.id` e o `user.lid` do socket; e nada sai com `groupsIgnore` ligado;
   - **SEM o campo `status`, de propósito**: o CRM que ainda não lê
     `reciboDoGrupo` não acha `status` e ignora o aviso, em vez de pintar ✓✓
     no primeiro recibo (que pode ser o do nosso outro número);
   - cada recibo num try/catch com `warn` (`CB recibo-de-grupo: …`): falha num
     não derruba os outros nem o resto do lote.

   O mesmo patch põe no `messages.update` o `messageStubParameters` (o código
   do erro do ack, ex.: `"479"`, que antes só o log trazia), quando vem
   preenchido, só na CÓPIA que vai ao webhook: o objeto original segue para o
   `messageUpdate.create` do Prisma, que recusaria o campo novo.
   Limites: um aviso por recibo, sem juntar nada — a entrega e a leitura de
   cada participante, mais uma leitura quando ele ouve uma mensagem de voz (o
   recibo `played` também chega como `readTimestamp`); num grupo de 200
   pessoas, são centenas de avisos por mensagem. O recibo do nosso OUTRO
   número (outra conexão no mesmo grupo) sai como o de qualquer participante:
   quem o separa é o CRM (`docs/PLANO-recibos-de-grupo.md`). A imagem sem o
   patch não manda nada, como antes. Um arquivo, +82/−1 linhas.

Mesmo commit = mesmas migrations: trocar entre esta imagem e a `homolog` não
mexe no banco. O rollback é só trocar a imagem de volta.

A ordem de aplicação é a do workflow (`2708-citacao`, `foto-de-perfil`,
`sessao-unica-e-reconexao` e depois `recibo-de-grupo`); cada um foi gerado
sobre os anteriores, em regiões distintas de `whatsapp.baileys.service.ts` (o
terceiro mexe também em `instance.controller.ts` e `monitor.service.ts`). O da
Baileys não passa pelo `git apply`: vai para `patches/` e é aplicado na
instalação das dependências. Quando a Evolution subir a Baileys, ele tem de
ser refeito para a versão nova (ou sai, se ela já trouxer o `CB:status`).

Quando o upstream mesclar o #2708, corrigir a foto de perfil E o ciclo de
conexão e repassar o recibo de grupo (ou publicar uma `homolog` com tudo
isso), esta imagem deixa de ser necessária. Plano vivo:
`docs/PLANO-baileys-7.md`, P10.
