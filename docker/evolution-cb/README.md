# Imagem `evolution-api-cb` — Evolution 2.4 (develop) com os nossos patches

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

Mesmo commit = mesmas migrations: trocar entre esta imagem e a `homolog` não
mexe no banco. O rollback é só trocar a imagem de volta.

A ordem de aplicação é a do workflow (`2708-citacao`, `foto-de-perfil` e
depois `sessao-unica-e-reconexao`); cada um foi gerado sobre os anteriores, em
regiões distintas de `whatsapp.baileys.service.ts` (o terceiro mexe também em
`instance.controller.ts` e `monitor.service.ts`).

Quando o upstream mesclar o #2708, corrigir a foto de perfil E o ciclo de
conexão (ou publicar uma `homolog` com tudo isso), esta imagem deixa de ser
necessária. Plano vivo: `docs/PLANO-baileys-7.md`, P10.
