# PLANO — Baileys 7 na Evolution: o conserto do "Aguardando mensagem"

> **Plano vivo.** Atualizar a cada fase: marcar as caixas, registrar as medições e
> as decisões com data. Foi escrito para sobreviver à compactação do contexto de
> quem o executa — tudo o que foi medido e decidido até aqui está registrado, com
> a fonte. Quem retomar o trabalho começa por **"Estado"** e **"Próximo passo"**.

| | |
| --- | --- |
| **Criado** | 09/09/2026 |
| **Estado** | **Fase 0 quase concluída** (09/09/2026 17:30): backup com restauração de prova, limpeza das órfãs/hashes e amostras **feitos na VPS**; ajustes 1–3 do CRM **escritos e testados** na branch `fix/lid-nos-campos-da-baileys-7` (PR aberto). Versão da Evolution **não** mudou. |
| **Próximo passo** | Mesclar o PR dos ajustes (publica no CRM); decidir P2 e a agendada pendente (P8); marcar a janela da Fase 1 com os 4 celulares; refazer o dump antes dela. |
| **Branch** | `docs/plano-baileys-7` (worktree separada, criada de `origin/main`) |
| **Estudo de origem** | seções 2–4 deste documento condensam o estudo de 09/09 |
| **Docs relacionadas** | `docs/EVOLUTION-LID-FIX.md` (fica OBSOLETA com este plano), `docs/INFRA-VPS.md`, `docs/DEPLOY-VPS.md`, `docs/INSTALACAO.md` |

**Sumário**

1. [O que acontece hoje](#1-o-que-acontece-hoje)
2. [O problema (diagnóstico com medições)](#2-o-problema-diagnóstico-com-medições)
3. [A resposta (decisões)](#3-a-resposta-decisões)
4. [O que muda de contrato entre o CRM e a Evolution](#4-o-que-muda-de-contrato-entre-o-crm-e-a-evolution)
5. [O que vai ser alterado no CRM](#5-o-que-vai-ser-alterado-no-crm)
6. [O que vai ser mexido na infraestrutura](#6-o-que-vai-ser-mexido-na-infraestrutura)
7. [Riscos](#7-riscos)
8. [Testes de aceitação](#8-testes-de-aceitação)
9. [Fases e checklist](#9-fases-e-checklist)
10. [Rollback](#10-rollback)
11. [Plano B de emergência (paliativo)](#11-plano-b-de-emergência-paliativo)
12. [Decisões pendentes e perguntas em aberto](#12-decisões-pendentes-e-perguntas-em-aberto)
13. [Anexo A — estado medido em 09/09/2026](#13-anexo-a--estado-medido-em-09092026)
14. [Anexo B — comandos de referência](#14-anexo-b--comandos-de-referência)
15. [Fontes](#15-fontes)

---

## 1. O que acontece hoje

**Sintoma.** Mensagens enviadas pelo CRM chegam ao celular do cliente como
*"Aguardando mensagem. Essa ação pode levar alguns instantes."* — com ✓✓ — e
o cliente responde "não está chegando suas mensagens". O **celular do
escritório** (aparelho pareado à mesma conta) mostra o mesmo aviso nas
próprias mensagens. É intermitente: numa mesma conversa, duas falham e a
terceira é lida.

**Casos medidos (09/09/2026, conexão Bancário - Comercial):**

| Hora | Cliente | Tipo | Origem | Status no CRM | No aparelho |
| --- | --- | --- | --- | --- | --- |
| 14:05:40 | Vitor | texto | CRM via Evolution (`from_device=false`) | `delivered` | "Aguardando mensagem" |
| 14:06:51 | Vitor | texto | CRM via Evolution | `delivered` | "Aguardando mensagem" |
| 14:08:35 | Vitor | texto | CRM via Evolution | **`read`** | chegou normal |
| 14:46:53 | Humberto | texto (com citação) | CRM via Evolution | `delivered` | "Aguardando mensagem" |

**Correção de premissa.** A queixa original falava em imagens. Os quatro casos
são **texto**. O problema não é de mídia.

**Por que o CRM não vê.** Em 12 dias, **zero** mensagens `failed`. O ✓✓ é
verdadeiro: os bytes chegaram; a **chave** para abri-los é que não serviu. O
WhatsApp não avisa o remetente disso. Hoje a única forma de descobrir é o
cliente reclamar. `Message.status = PENDING` no banco da Evolution **não**
indica falha (a mensagem lida de 14:08 também está `PENDING`; os acks chegam
pelo LID e a coluna não é atualizada).

**Contexto de uso.** O CRM **ainda não é o sistema principal**. O escritório
trabalha pelo celular pareado e por outro CRM: em 09/09 foram 105 textos pelo
celular contra 1 pelo CRM (08/09: 265 × 15). A Evolution está pareada como um
dispositivo vinculado nos 4 números reais do escritório.

---

## 2. O problema (diagnóstico com medições)

### 2.1 A causa

A Evolution 2.3.2 embarca a biblioteca **Baileys 6.7.19 (31/08/2025)** — o
`package.json` da tag declara `"baileys": "github:WhiskeySockets/Baileys"`,
**sem versão**; a nossa imagem congelou na data em que foi construída. Essa
versão **não conhece o endereçamento LID** que o WhatsApp adotou desde então.
Resultado: ela trata o LID como se fosse *outro telefone* e mantém **duas
sessões de criptografia para o mesmo aparelho** — uma pelo número, outra pelo
LID. Cada envio escolhe uma delas; quando cai na que o aparelho já descartou,
o cliente recebe os bytes sem a chave.

**Provas (Redis da instância Bancário - Comercial, hash `evolution:instance:44982408-…`):**

| Contato | Sessões gravadas | Leitura |
| --- | --- | --- |
| Vitor (5511995313317 ↔ LID 276819265749011) | `session-5511995313317.0`, `.99`, `session-276819265749011.0`, `.99` | **4 sessões para 2 aparelhos** |
| Humberto (555491761508 ↔ LID 29266007871686) | `session-555491761508.0`, `session-29266007871686.0` | **2 sessões para 1 aparelho** |
| Nosso número (5511964102992) | `.0 .21 .22 .29` | celular + **3 aparelhos vinculados** — cada envio é cifrado 4 vezes a mais |
| Em todos os hashes | sessões em formato LID (`_1`): **0**; `lid-mapping`: **0** | a biblioteca não faz ideia do que é LID |

- Enviamos para `…@s.whatsapp.net`; os recibos (`MessageUpdate`) voltam por
  `…@lid`. A Evolution **sabe** o mapeamento (`IsOnWhatsapp`:
  `5511995313317@s.whatsapp.net` ↔ `276819265749011@lid`); a biblioteca não o usa.
- Escala: **3.325 dos 7.019 chats** e **12.267 dos 22.618 `IsOnWhatsapp`** já são
  LID; **6.103 das 6.501** mensagens do CRM em 30 dias têm `remote_jid_lid`
  (medição das 16h de 09/09).
- Log da Evolution 4 min depois de subir: `Closing stale open session for new
  outgoing prekey bundle` — a linha exata das issues da Baileys.

### 2.2 O que foi descartado

| Hipótese | Por que não |
| --- | --- |
| Imagens | os quatro casos são texto |
| Bloqueio 463 / `tctoken` ("PENDING para sempre") | tudo é entregue (✓✓) e mensagens vizinhas são lidas |
| `CONFIG_SESSION_PHONE_VERSION` antiga | a variável está cravada em `2.3000.1025193442`, mas o log mostra a 2.3.2 buscando a atual (`2.3000.1047094411`, 10×) — ignorada |
| Celular do cliente | dois clientes e o nosso próprio aparelho falharam juntos |
| `Message.status = PENDING` como sinal | a de 14:08, lida, também é `PENDING` |

### 2.3 Achados de carona (não são a causa; entram na Fase 0)

- **Duas instâncias órfãs em laço de QR** (a cada ~45 s, `QRCODE_LIMIT=1902`):
  `Bancario` (id `385dac9a-…`, criada 06/2025, `ownerJid` **5511964102992 — o
  mesmo número da Bancário - Comercial**, 9.454 chaves no Redis) e `CBAdv`
  (`c68ecb8d-…`, `ownerJid` 558386262646 — o mesmo da Trabalhista - Jurídico,
  3.074 chaves). Não existem no CRM.
- **4 hashes no Redis de instâncias já apagadas**: `f71807c0-…` (3.078
  campos), `7fc75fe2-…` (86), `dcbf9851-…` (30), `60a309e7-…` (2.720).
- **1 duplicata em `Chat(instanceId, remoteJid)`**, na órfã `Bancario` — a
  migration da 2.4.0 cria índice único ali (com dedup antes).
- **O log da Evolution morre no reinício**: driver `json-file` (10 MB × 3), e o
  Swarm recria o contêiner — o log da hora da falha (14:05) se perdeu com o
  reboot da VPS às 14:47:59. Um `0` num grep sobre esse log não prova nada.
- A VPS foi **reiniciada em 09/09 às 14:47:59** (boot anterior desde 03/09
  09:00). O reinício funciona como o paliativo "reconectar" (sem QR).
- O celular do escritório tem **3 aparelhos vinculados** além do celular
  (Evolution, outro CRM, WhatsApp Web/Desktop) — desligar o outro CRM, já
  planejado, reduz o número de sessões a manter em dia.

---

## 3. A resposta (decisões)

### 3.1 O conserto

**Baileys ≥ 7.0.0-rc13.** É a linha que (a) cria as sessões no formato LID e
migra as existentes sozinha, (b) recria sessão quebrada automaticamente
(`enableAutoSessionRecreation: true` por padrão) e (c) manda o `tctoken`/
`cstoken` que o WhatsApp exige para não contar cada mensagem como "abordagem a
desconhecido" (o erro 463). A própria linha 6 foi abandonada para isso: a nota
da v6.7.21 diz *"Move to 7.0.0-rc.6 as soon as possible."*

A Baileys só chega até nós por dentro da Evolution:

| Versão da Evolution | Baileys | "Aguardando" | 463 | Cadastro obrigatório | Migrations novas | Prisma / Node | Release |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **2.3.2 + `lidfix` (hoje)** | 6.7.19 + patch nosso | tem | não tem (tolerado) | não | — | 6 / 20 | sim |
| 2.3.7 | 7.0.0-rc.9 | resolve | **cria** | não | +2 | 6 / 20 | sim (05/12/2025) |
| 2.4.0-rc2 | 7.0.0-rc.9 | resolve | **cria** | sim | +4 | 7 / 24 | pré-release (17/05/2026) |
| **`develop` = imagem `homolog`** | **7.0.0-rc13** | resolve | resolve | sim | +4 | 7 / 24 | não — branch (último commit 14/07/2026) |

**Descartadas:** 2.3.7 pura e 2.4.0-rc2 (rc.9 traz o "PENDING para sempre":
sem o carimbo, o WhatsApp conta toda mensagem como abordagem a estranho, o
limite estoura em dias e o número entra numa quarentena que dura dias — e o
risco de restrição do número é exatamente o que o escritório não pode correr).

**Escolhida (09/09/2026, confirmada pelo operador):** `develop`/`homolog`, com
o cadastro (seção 7.3) — e-mail do cadastro `leonardocabralb@gmail.com`; o
telefone foi informado e fica fora deste documento de propósito (pedir ao
operador na hora da ativação). **Alternativa** descartada, registrada para
histórico: 2.3.7 com `npm install baileys@7.0.0-rc13` no entrypoint — sem
cadastro, combinação não testada pelo projeto, e a 2.3.7 **perde o LID no
payload** (seção 4.2).

**Imagem candidata, conferida em 09/09 na própria VPS** (`docker pull` +
inspeção, sem tocar no serviço):
`evoapicloud/evolution-api:homolog@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549`
— criada 14/07/2026, 1,53 GB, **Evolution 2.4.0, Baileys 7.0.0-rc13,
`tc-token-utils` presente, Node 24.18.0, `patches/` vazio**. (Um relato de
21/07 dizia que o `homolog` ainda tinha rc.9 — era imagem antiga em cache; a
conferência local decide.)

### 3.2 Como aplicar

**Upgrade no lugar, com backup testado — sem ambiente paralelo.** Decisão do
operador em 09/09/2026, porque o CRM ainda não é o sistema principal: o
escritório continua atendendo pelo celular e pelo outro CRM durante a obra, e
o pior caso realista do rollback é **ler 4 QRs** num momento em que ninguém
depende do CRM. Daqui a meses, com a equipe dentro do sistema, esse custo não
caberia — é o argumento para fazer agora.

O paliativo (purga de sessões, seção 11) **não** foi escolhido como resposta:
é reset, a duplicidade volta em dias ou semanas. Fica documentado como plano
de emergência.

---

## 4. O que muda de contrato entre o CRM e a Evolution

### 4.1 O que NÃO muda (conferido nos fontes das três versões)

- **21 endpoints** que o CRM chama: `message/sendText`, `message/sendMedia`,
  `message/sendWhatsAppAudio`, `message/sendReaction`, `chat/markMessageAsRead`,
  `chat/deleteMessageForEveryone`, `chat/updateMessage`, `chat/sendPresence`,
  `chat/getBase64FromMediaMessage`, `chat/findChats`, `chat/fetchProfilePictureUrl`,
  `group/findGroupInfos`, `group/updateGroupSubject`, `webhook/set`, `webhook/find`,
  `instance/connectionState`, `instance/connect`, `instance/logout`,
  `instance/delete`, `instance/create`, `instance/fetchInstances` — todos
  existem no `develop`, mesmas rotas e corpos. `sendMessage.dto` só ganhou
  opcionais (`messageId`, `gifPlayback`); `webhook.schema.ts` é **byte a byte
  igual** ao da 2.3.2; `instance.dto` aceita `integration`, `qrcode`, `token` e
  o `webhook` aninhado.
- **8 eventos** assinados (`MESSAGES_UPSERT`, `MESSAGES_UPDATE`,
  `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `MESSAGES_DELETE`, `MESSAGES_EDITED`,
  `GROUPS_UPSERT`, `GROUP_PARTICIPANTS_UPDATE`): todos no enum do `develop`,
  que ganhou `GROUP_UPDATE` (nome do grupo mudou; a 2.3.2 não tem).
- Forma dos payloads de ack (`keyId` + `status`), exclusão (chave achatada ou
  aninhada em `key`) e edição (`protocolMessage` com `key` + `editedMessage`).
- `getBase64FromMediaMessage`: `m?.message ? m : getMessage(m.key)` — igual.
- Auth state (`use-multi-file-auth-state-prisma.ts`): **idêntico entre 2.3.7 e
  `develop`**, só cosmética desde a 2.3.2 — creds na tabela `Session`, chaves de
  sinal num hash do Redis por instância. A v7 grava os tipos novos
  (`lid-mapping`, `device-list`, `tctoken`) no mesmo hash.
- `AUTHENTICATION_API_KEY` continua sendo a chave HTTP (`auth.guard.ts` lê do
  env); a licença não a substitui. As chaves **por instância** (tabela
  `Instance.token`, guardadas cifradas em `cb_channels.api_key`) e a
  configuração de webhook de cada instância (tabela `Webhook`) ficam no banco
  da Evolution e sobrevivem ao upgrade — nada a refazer no CRM.
- Prisma 7 tirou a URL do banco do schema, mas o `prisma.config.ts` do
  `develop` lê **`DATABASE_CONNECTION_URI`** e **`DATABASE_PROVIDER`** — as duas
  variáveis que o nosso serviço já tem. O entrypoint da imagem roda
  `Docker/scripts/deploy_database.sh` (`npm run db:deploy` → `prisma migrate
  deploy`, depois `db:generate`) e só então `start:prod`; o log diz
  `Migration succeeded` ou `Migration failed` (e nesse caso o contêiner sai
  com erro — o serviço não sobe com banco pela metade).

### 4.2 O que muda: onde o telefone e o LID aparecem

| Versão | Mensagem endereçada por LID chega ao webhook como |
| --- | --- |
| **2.3.2 (+ patch)** | `key.remoteJid = senderPn` (telefone); LID em `key.previousRemoteJid` |
| **2.3.7** | `key.remoteJid = key.remoteJidAlt` (telefone). **O LID é perdido**: `remoteJidAlt` fica igual ao telefone, `previousRemoteJid` não existe |
| **`develop`** | **Troca**: `remoteJid` = telefone, `remoteJidAlt` = LID, `addressingMode = 'pn'`. O LID sobrevive |

O parser do CRM (`phoneJidFromKey`) já aceita `remoteJidAlt`/`senderPn`/
`participantPn`/`participantAlt` para achar o telefone — a mensagem **entra**
nas três versões. O que se perde sem ajuste é o `remote_jid_lid` (migration
917), que apagar/editar em conversa migrada exige.

### 4.3 O que muda: participantes de grupo

Baileys 7, tipo `Contact`: `{ id, lid?, phoneNumber?, … }` — `id` é o
identificador preferido (LID ou telefone), `phoneNumber` vem quando `id` é
LID, `lid` vem quando `id` é telefone. **Não existe mais `.jid`.** O `develop`
devolve `group.participants` cru em `findGroup`. Em mensagens de grupo, quando
`participant` é LID, `participantAlt` é o telefone (e vice-versa).

### 4.4 O que pode mudar: tamanho declarado do anexo

Hoje `fileLength` chega como **string**. Dentro do `develop` o campo é um
`Long {low, high}` (ele lê `size.fileLength?.low`). A forma no webhook só a
medição dirá. `mediaBytesOf` já devolve `null` para forma desconhecida, e
`null` cai em "tamanho desconhecido = baixa e confere no backstop".

### 4.5 Comportamentos novos da biblioteca que interessam

- Sessões nascem em formato LID; as PN existentes são migradas sozinhas, sem
  re-parear (guia v7; relato de campo rc.x → rc13 sem QR).
- `enableAutoSessionRecreation` e `enableRecentMessageCache` ligados por
  padrão: o *retry receipt* do aparelho que não decifrou vira reenvio automático.
- **Recibo de entrega continua sendo enviado** para toda mensagem recebida
  (conferido no fonte da rc13, `src/Socket/messages-recv.ts` 1740–1758); o guia
  fala em "parou de mandar acknowledgments", mas a opção `sendActiveReceipts`
  controla só o "lido". O cliente continua vendo ✓✓ ao nos escrever.
- 2.3.7: "Resolve *waiting for message* state after reconnection" — chaves
  velhas deixam de ser carregadas na reconexão.
- 2.4.0-rc2: bypass do `onWhatsApp` para `@lid` (`sendMessageWithTyping` e
  `sendPresence` deixam de lançar 400 para JID LID); `quoted` passa a valer em
  `sendWhatsAppAudio` (hoje áudio com citação não sai encadeado — melhora).
- `develop`: `sendMessageWithTyping` recebe o número, `createJid` monta o JID
  de telefone e a Baileys 7 resolve o LID por baixo; `deleteMessage` chama
  `client.sendMessage(del.remoteJid, { delete })` direto; `updateMessage` exige
  `oldMessage.key.remoteJid === createJid(number)` (a Evolution grava telefone
  no `key.remoteJid` — igual a hoje); `reactionMessage` passa por
  `sendMessageWithTyping(data.key.remoteJid, …)`; a mensagem citada é buscada
  **por `key.id`** no banco dela (`m?.message ? m : getMessage(m.key, true)`).

---

## 5. O que vai ser alterado no CRM

Todos os ajustes são **retrocompatíveis** (funcionam com a 2.3.2 de hoje) e
entram **antes** do upgrade, num PR próprio, para que uma falha nos testes
seja atribuível à Evolution e não ao CRM.

### 5.1 Ajuste 1 — reter o LID (`src/lib/whatsapp/transport/evolution-inbound.ts`)

- Em `normalizeUpsert`, `remoteJidLid` passa a ser o **primeiro** LID entre
  `key.previousRemoteJid` (2.3.2), `key.remoteJidAlt` (`develop`) e
  `key.remoteJid` cru (caso a Evolution não troque e o telefone tenha vindo de
  um campo alternativo). Na 2.3.7 os dois são telefone → continua `null`
  (limitação documentada daquela versão).
- `EvolutionMessageKey` ganha `addressingMode?: 'pn' | 'lid'` (informativo).
- Testes: fixtures com as três formas (2.3.2 medida hoje; `develop` conforme
  o código das linhas 1668–1675; "sem troca").
- Sem isso: `remote_jid_lid` nasce `NULL` e **apagar/editar mensagem do
  celular em conversa LID volta a não fazer nada** (o bug de 28/07).

### 5.2 Ajuste 2 — nosso LID e o remetente de grupo (`evolution-group-inbound.ts`, `src/lib/cb-groups/persist.ts`, `webhook/route.ts`)

- `normalizeGroupUpsert` passa a expor **`senderLid`** (o `participant` ou
  `participantAlt` que for `@lid`) separado de `senderJid`.
- `aprenderNossoLid` recebe `senderLid` (hoje recebe `senderJid`, que com a
  Baileys 7 passa a ser o telefone — e a função só aceita `@lid`, então nunca
  mais aprenderia). Hoje só o canal Bancário - Jurídico tem `own_lid`
  (`40373380473043@lid`, 12 grupos); os outros três estão `NULL`.
- **Decisão proposta (confirmar):** `group_sender_jid` continua sendo o **LID**
  quando houver — identidade estável e igual a 100% das linhas existentes
  (`remetenteDoGrupo` hoje prefere o telefone dos campos alternativos, que na
  6.7.19 não vêm; na v7 viriam e trocariam a forma da coluna). O telefone, se
  um dia for gravado, ganha coluna própria — fora deste plano.

### 5.3 Ajuste 3 — participantes de grupo (`src/lib/cb-groups/sync.ts`, `parseGroupInfo`)

- Achar a nossa linha por `soDigitos(p.phoneNumber ?? p.jid) === nosso`.
- `ourLid = p.lid ?? (isLidJid(p.id) ? p.id : null)`.
- Teste com participante nas duas formas (`{id, jid, lid}` de hoje e
  `{id, phoneNumber, lid?}` da v7).

### 5.4 Ajuste 4 — `fileLength` como objeto (`src/lib/whatsapp/transport/anexo-declarado.ts`)

- **Só depois de medir** (T5). Se vier `{low, high, unsigned}`: bytes =
  `high × 2³² + low`. Teste com as três formas (string, número, objeto).

### 5.5 Ajuste 5 — `GROUP_UPDATE` (`evolution-provision.ts`) — **DEPOIS do upgrade**

- ⚠️ **Não antes.** A 2.3.2 recusa o pedido de webhook INTEIRO quando a lista
  traz evento que ela não conhece (conferido em 28/07/2026 com `GROUPS_UPDATE`):
  incluir agora quebraria a criação de conexão nova.
- Depois do upgrade: incluir e clicar "Ressincronizar" nas 4 conexões (a
  Evolution guarda a lista no momento do registro).

### 5.6 Documentação e regras

- `docs/EVOLUTION-LID-FIX.md`: marcar **obsoleto** (o `remoteJidAlt` é nativo
  na v7); manter como histórico. O workflow `.github/workflows/evolution-lid-fix.yml`
  **falha de propósito** com base ≠ 6.7.19 — não aplicar sobre a imagem nova.
- `docs/INFRA-VPS.md` (linha da imagem), `docs/INSTALACAO.md` (versão da
  Evolution: 2.3.2 → a nova, com o passo do cadastro), `docs/DEPLOY-VPS.md`.
- `CLAUDE.md`: a nota que desaconselha a 2.3.7 fala do erro 463 e continua
  verdadeira para a 2.3.7 pura — reescrever citando este plano; registrar a
  imagem por digest, `TELEMETRY_ENABLED=false`, e que `docker stack deploy`
  segue proibido para a Evolution.
- `.env.local.example`: nada muda (as variáveis da Evolution já estão lá).

### 5.7 Testes automatizados a acrescentar

- `evolution-inbound.test.ts`: as três formas de chave (5.1).
- `evolution-group-inbound.test.ts`: `senderLid` com `participant`/`participantAlt`
  em cada ordem.
- `cb-groups/sync.test.ts`: `parseGroupInfo` com participante v6 e v7.
- `anexo-declarado.test.ts`: `fileLength` objeto (quando medido).
- Fixtures **reais** capturadas em produção antes e depois do upgrade
  (Fase 0, item 5), com telefones anonimizados.

---

## 6. O que vai ser mexido na infraestrutura

Tudo na VPS (`vps.cbadvogados.com`, Swarm). **Regra que segue valendo:
`docker stack deploy` é proibido para a Evolution** — o `/root/evolution.yaml`
(28/07) não carrega as 7 variáveis `S3_*` nem várias outras que o serviço tem
(hoje `S3_ENABLED=false`, mas a regra é a mesma). Toda mudança vai por
`docker service update`.

### 6.1 Fase 0 — preparação (sem trocar versão)

1. **Instâncias órfãs**: `DELETE /instance/delete/Bancario` e `/CBAdv` (chave
   global). Conferir depois que os hashes `evolution:instance:385dac9a-…` e
   `…c68ecb8d-…` sumiram do Redis db 8; se não, `DEL` à mão. Apagar também os
   4 hashes de instâncias inexistentes (`f71807c0-…`, `7fc75fe2-…`,
   `dcbf9851-…`, `60a309e7-…`). ⚠️ Ação destrutiva: pede autorização explícita.
2. **Backup** (criar `/root/backups/`):
   - Postgres: `pg_dump -U postgres -Fc evolution` (579 MB; 348.735 `Message`,
     317.219 `MessageUpdate`). Contém a tabela `Session` (creds das 4 conexões).
   - Redis **só o db 8** — o Redis é compartilhado (db0: 559 chaves de outros
     serviços; db2: 4). Duas cópias: (a) `COPY <chave> <chave> DB 9 REPLACE`
     para cada chave do db 8 (restauração instantânea, preserva TTL);
     (b) `SAVE` + `docker cp` do `/data/dump.rdb` para `/root/backups/`
     (cópia fora do Redis; restaurar dele restauraria os outros dbs também —
     só em último caso).
   - `docker cp` de `/evolution/instances` (28 K; volume `evolution_instances`).
   - Anotar: digest atual
     `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694`,
     a lista de env do serviço, e o `_prisma_migrations` (última:
     `20250613143000_add_lid_column_to_is_onwhatsapp`, aplicada 04/09/2025).
3. **Restauração de prova**: `createdb evolution_ensaio` + `pg_restore` +
   `select count(*) from "Message"` = 348.735 + `dropdb evolution_ensaio`.
   Backup que nunca foi restaurado é esperança, não rollback.
4. **Guardar o log atual** da Evolution (`docker service logs … > /root/backups/`).
5. **Capturar payloads reais** (upsert 1:1 do cliente, eco do celular, grupo,
   imagem, documento) como fixtures — do log do CRM ou de um webhook de
   captura temporário.
6. **Fila de agendadas**: `cb_scheduled_messages` com `status = 'pending'`
   tem de estar vazia na janela (cancelar e reagendar depois). ⚠️ Em
   09/09 às 16h havia **1 pendente** — conferir o que é antes de marcar a
   janela.
7. **Aviso à equipe**: usar celular/outro CRM na janela (a Dra. Isa mandou 17
   pelo CRM em 09/09).

### 6.2 Fase 1 — o upgrade (janela combinada; os 4 celulares à mão)

```bash
# 1. imagem nova por digest (conferida em 09/09), telemetria desligada
docker service update \
  --image evoapicloud/evolution-api:homolog@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549 \
  --env-add TELEMETRY_ENABLED=false \
  evolution_evolution

# 2. acompanhar: o entrypoint roda `prisma migrate deploy` (4 migrations) e sobe
docker service logs evolution_evolution --since 5m -f
```

3. **Cadastro/ativação**: `https://api.cbadvogados.com/manager/login` (o
   Traefik já roteia `api.cbadvogados.com` para o serviço; `/manager` e
   `/license/*` passam pelo portão). Registrar com o e-mail/telefone
   decididos; ou, se o e-mail já estiver registrado, `--env-add
   EVOLUTION_OPERATOR_EMAIL=…` antes do passo 1. Conferir:
   `curl https://api.cbadvogados.com/license/status` (hoje responde **404** —
   a rota não existe na 2.3.2; é a linha de base).
4. **Conexões**: `instance/fetchInstances` → 4 × `open` sem QR. Se alguma
   pedir QR: ler (é o custo aceito).
5. **Sinais no Redis**: campos `lid-mapping-*` e `session-*_1.*` começam a
   aparecer nos hashes vivos.
6. **Testes** da seção 8 no lead de teste autorizado.
7. **Observação de 48 h** com os medidores da seção 8.3.
8. **Depois**: ajuste 5 (`GROUP_UPDATE` + Ressincronizar), atualizar
   `/root/evolution.yaml` com a imagem por digest e `TELEMETRY_ENABLED=false`
   (para um futuro `stack deploy`, ainda proibido, não regredir), docs.

`CONFIG_SESSION_PHONE_VERSION` fica como está (é ignorada). Variáveis novas do
`develop` (Kafka, SQS, métricas, proxy, EvoHub) são todas opcionais e
desligadas por padrão; o EvoHub fica inerte sem chave.

---

## 7. Riscos

### 7.1 Funcionais (por funcionalidade do CRM)

**B** = baixo (contrato igual) · **M** = médio (comportamento muda ou depende
de teste) · **A** = alto (perda de mensagem/dado possível).

| # | Funcionalidade | O que muda | Risco | Cobertura |
| --- | --- | --- | --- | --- |
| 1 | Receber texto de cliente | LID muda de campo (4.2) | B | ajuste 1, T4 |
| 2 | **Mensagem enviada pelo celular pareado** (`from_device`) | mesmo caminho do item 1; o patch `lidfix` deixa de existir e a v7 entrega `remoteJidAlt` nativo | **M** — já falhou uma vez (83% dos ecos perdidos em 07/2026) e o CRM **descarta em silêncio** | **T17**; medidor `DESCARTADA` |
| 3 | Mensagem enviada pelo WhatsApp Web / Desktop / outro CRM | idêntico ao item 2 | **M** | **T18** |
| 4 | Eco do que o próprio CRM enviou (dedup) | nada (`jaGravada` por `message_id`) | B | — |
| 5 | Enviar texto | nada; a v7 resolve LID por baixo — é o conserto | B | T1 |
| 6 | Enviar imagem/vídeo/documento | nada (DTO só ganhou opcionais) | B | T2 |
| 7 | Nota de voz (gravador e acervo) | nada; citação em áudio passa a funcionar | B | T3 |
| 8 | Mensagem agendada | nada de contrato; risco de horário (dispara sem gente olhando) | B, com fila vazia | T20 |
| 9 | Receber mídia | endpoint igual; `mediaKey` mais robusto desde a 2.3.3 | B | T4, T5 |
| 10 | Tamanho declarado do anexo (`too_large`, "sob demanda") | forma de `fileLength` pode mudar (4.4) | M (degradação: baixa antes de decidir) | T5, ajuste 4 |
| 11 | Pré-visualização de mídia no CRM | nada (é o nosso Storage) | B | — |
| 12 | Link preview no envio | igual (`linkPreview` ligado por padrão) | B | T6 |
| 13 | Citação — preview no aparelho do cliente | busca por `key.id` igual; `participant` montado pela v7 em conversa LID | M (cosmético, visível) | T7, T8 |
| 14 | Reação (enviar) | passa por `sendMessageWithTyping` com bypass `@lid` | M | T9 |
| 15 | Reação (receber) | nada | B | — |
| 16 | Apagar para todos | sem ajuste 1, volta o bug de 28/07; com a v7, apagar pelo telefone pode passar a funcionar | M | T10, T11 |
| 17 | Editar | igual (Evolution grava telefone no `key.remoteJid`) | B | T12 |
| 18 | Exclusão/edição feitas pelo cliente | formas iguais | B | T13 |
| 19 | ✓/✓✓/lido das nossas mensagens | igual (casado por `keyId`); retry vira reenvio automático | B | — |
| 20 | ✓✓ que o cliente vê nas mensagens dele | recibo de entrega continua (fonte rc13) | B | T14 |
| 21 | Marcar como lida (✓✓ azul no cliente) | igual; em conversa LID depende do servidor | B/M | T15 |
| 22 | Presença (digitando/gravando) | igual, com bypass `@lid` | B | — |
| 23 | Foto de perfil | igual; `findChats` já filtra `@s.whatsapp.net` (3.325 chats LID ficam fora do botão em lote — pré-existente; o caminho por mensagem cobre) | B | — |
| 24 | Grupos — mensagens | `participantAlt` traz telefone; forma de `group_sender_jid` decidida no ajuste 2 | B/M | T19 |
| 25 | Grupos — participantes / somos admin / nosso LID | `participants[]` sem `.jid` | M | ajuste 3, T19 |
| 26 | Grupos — menção a nós (`mentions_us`) | `own_lid` deixaria de ser aprendido | M (canais novos) | ajuste 2, T19 |
| 27 | Grupos — avisos de entrada/saída | `participants` mantido + `participantsData` novo | B | — |
| 28 | Nome do grupo mudou | `GROUP_UPDATE` passa a existir | B (melhora) | ajuste 5 |
| 29 | Conexão nova / QR / estado / Ressincronizar | schemas iguais | B | T16 |
| 30 | Automações, fluxos, IA, Radar, transcrição, busca, funil, webhooks de saída | não falam com a Evolution; só dependem de a mensagem entrar | indireto | itens 1–3, 9 |
| 31 | Canal Meta Cloud API | não existe em produção | — | — |

**Onde está o risco real:** itens 2–3 e 16. Os três já quebraram uma vez,
quebram em silêncio e se resolvem com o ajuste 1 + T17/T18.

### 7.2 Operacionais

| Risco | Detalhe | Mitigação |
| --- | --- | --- |
| **Migração das sessões exigir QR** | v7 migra PN → LID sozinha (guia + relato); há relatos de re-pareamento em outros setups | 4 celulares à mão; CRM fora de uso; é o custo aceito |
| **Regressão da `develop`** (branch sem release) | `homolog` é retag; pode mudar | imagem **por digest** conferido (3.1); observação de 48 h; gatilhos de rollback (8.4) |
| **463 / quarentena do número** | só com rc.9; a rc13 manda o carimbo; hoje a 6.7.19 não manda e é tolerada | usar rc13 (conferido na imagem); volume de envio pelo CRM baixo (17 a 77 textos/dia em 09/09 e 08/09, contra 225–493 pelo celular); watch de `463` no log |
| **Efeitos colaterais reportados com rc13** | (a) entrada 1:1 em lotes de 0–60 s; (b) FK em `IntegrationSession` bloqueando `instance/create` | (a) T21 mede; (b) não usamos chatbots internos — `DELETE FROM "IntegrationSession"` é seguro |
| **Migrations sem volta** | 4 migrations; dedup de `Chat` mexe na órfã `Bancario` | backup + restauração de prova (6.1) |
| **Redis compartilhado** | restaurar o RDB inteiro regrediria db0/db2 (outros serviços) | backup por chave para o db 9 (6.1) |
| **Telemetria** | nova, ligada por padrão, manda nome do evento + versão para `log.evolution-api.com` | `TELEMETRY_ENABLED=false` no `service update` |
| **Log morre no reinício** | prova do defeito some | guardar antes; capturar depois; (futuro) log fora do contêiner |
| **`docker stack deploy`** | yaml incompleto zeraria env | proibido; só `service update` |
| **Sessão paralela no checkout** | outra sessão mudou a branch do checkout principal em 09/09 | trabalhar **só na worktree** desta branch |

### 7.3 O cadastro (licença) — decisão do operador

- **Gratuito.** Doc oficial: *"The community license is free"*, *"no usage,
  message or instance limit for the community tier"*, sem função bloqueada.
- **Obrigatório**: sem ativação, toda rota de negócio responde
  `503 LICENSE_REQUIRED`. Ativação uma vez (e-mail + telefone do operador) pelo
  `/manager`, ou sem navegador com `EVOLUTION_OPERATOR_EMAIL` (e-mail já
  registrado). Depois: **portão local** (hash no banco; funciona com o servidor
  deles fora do ar — conferido em `licensing/runtime.ts`); heartbeat separado
  e não bloqueante (relato de campo com heartbeat 404 e API normal).
- **O que sai**: na ativação, e-mail, telefone, versão e UUID da instância; nos
  heartbeats, versão, **contadores agregados** (ex.: total de mensagens no
  período), features ligadas e IP. A doc diz que **não** manda mensagens,
  contatos, números de clientes, mídia nem tokens. **Não documentado**: o que
  acontece se revogarem.
- Reinstalação do zero exige ativar de novo (`RuntimeConfig`).
- **Hoje × depois**: hoje ninguém sabe que temos a Evolution e nada sai do
  servidor; depois, cadastro único + relatório periódico de volume. O preço
  não é dinheiro — é dependência e um relatório saindo do escritório.

---

## 8. Testes de aceitação

Todos no **lead de teste autorizado** (contato "Leonardo Cabral Baptista"),
num contato **endereçado por LID** (conferir em `IsOnWhatsapp`), com o log da
Evolution e do CRM abertos. Registrar resultado e data em cada linha.

### 8.1 Roteiro

| T | Teste | Passa quando | Resultado |
| --- | --- | --- | --- |
| T1 | Texto pelo CRM | legível no celular do cliente (sem "Aguardando"); ✓✓ no CRM | |
| T2 | Imagem, PDF e vídeo pelo CRM | abrem no cliente; `media_type`/`media_filename` gravados | |
| T3 | Nota de voz (gravador e acervo), com e sem citação | toca como voz; com citação, encadeada | |
| T4 | Cliente manda foto | aparece no CRM com arquivo no Storage | |
| T5 | Cliente manda documento >16 MiB e outro >50 MiB | o primeiro entra; o segundo vira `too_large` com nome; **anotar a forma de `fileLength`** | |
| T6 | Texto com URL | preview do link no cliente | |
| T7 / T8 | Responder citando mensagem do cliente / nossa | o cliente vê o preview da citação | |
| T9 | Reagir a mensagem do cliente | reação aparece no celular dele | |
| T10 / T11 | Apagar para todos: mensagem do CRM / do celular | some no cliente; `messages.delete` volta | |
| T12 | Editar mensagem nossa (<15 min) | edita no cliente; `text_before_edit` gravado | |
| T13 | Cliente apaga e edita mensagem dele | CRM risca / atualiza | |
| T14 | Cliente nos escreve | ele vê ✓✓ na mensagem dele | |
| T15 | Abrir a conversa no CRM (marcar lida) | ✓✓ azul no cliente | |
| T16 | Criar canal de teste pelo CRM, ler QR, Ressincronizar, apagar | `open`, webhook aplicado, mensagem entra | |
| **T17** | **Mensagem pelo CELULAR pareado para contato LID** | **aparece no CRM "pelo celular"; `DESCARTADA` = 0** | |
| **T18** | **Mensagem pelo WhatsApp Web para contato LID** | idem | |
| T19 | Grupo: mensagem nossa e de participante, menção a nós | entra; `mentions_us` acende no canal com `own_lid`; `findGroupInfos` acha nossa linha | |
| T20 | Agendar mensagem para +3 min | sai na hora, `sent`, sem duplicar | |
| T21 | Latência de entrada | 5 mensagens espaçadas do cliente; atraso até o webhook (medir `messageTimestamp` × `created_at`) | |
| T22 | Reinício do serviço (`service update --force`) | 4 instâncias voltam `open` sem QR | |

### 8.2 O que só o teste responde

1. Citação e reação em conversa LID chegam com preview? (T7–T9)
2. Apagar pelo telefone passa a funcionar, ou continua exigindo o LID? (T10–T11)
3. `fileLength`: string, número ou objeto? (T5)
4. As 4 sessões sobrevivem sem QR? (T22 e o próprio upgrade)
5. A entrada em lotes de 0–60 s acontece aqui? (T21)

### 8.3 Medidores (antes, durante e nas 48 h seguintes)

| Medidor | Onde | Esperado depois |
| --- | --- | --- |
| `Closing session` / `Closing stale open session` | log da Evolution | tende a zero após a migração das sessões |
| `"463"` / `messageStubParameters` | log da Evolution | **zero** — qualquer ocorrência é gatilho de rollback |
| `DESCARTADA: endereçada por @lid` | log do CRM (`crm_crm`) | **zero** |
| campos `session-*_1.*` e `lid-mapping-*` | Redis db 8, hashes vivos | aparecem e crescem. **Linha de base (09/09 17:30, depois da limpeza)**: `44982408` (Bancário - Comercial) PN=291, `be282022` (Bancário - Jurídico) PN=35, `200ac9ef` (Trabalhista - Comercial) PN=152, `d1d9caf5` (Trabalhista - Jurídico) PN=140; LID=0 e `lid-mapping`=0 em todos |
| acks (`MessageUpdate`) e `read` no CRM | banco da Evolution / `messages.status` | continuam chegando |
| latência de entrada | T21 | segundos, não minutos |
| relato de "Aguardando mensagem" | equipe / clientes | nenhum em 48 h |

### 8.4 Gatilhos de rollback (decididos antes, sem discutir na hora)

- Alguma instância não volta a `open` em 10 min (nem com QR).
- Qualquer `463` no log.
- T17 ou T18 reprovando **depois** dos ajustes do CRM.
- T1 reprovando (texto do CRM não chega legível).
- Latência de entrada consistentemente > 60 s (decisão do operador).

---

## 9. Fases e checklist

### Fase 0 — preparação (sem trocar versão)

- [x] Operador: e-mail e telefone do cadastro decididos (09/09)
- [ ] PR com os ajustes 1, 2, 3 + testes (5.1–5.3, 5.7) — branch `fix/lid-nos-campos-da-baileys-7`, 95 testes verdes, lint e typecheck limpos (09/09); **mesclar e publicar**
- [ ] Decisão do ajuste 2 (`group_sender_jid` = LID) confirmada (P2)
- [x] Instâncias órfãs `Bancario` e `CBAdv` removidas (autorizado e executado 09/09 17:27; a API respondeu `Instance deleted` e a remoção completou em segundo plano — `Instance` ficou com 4 linhas)
- [x] 6 hashes do Redis removidos (2 órfãs + 4 mortos); sobraram os 4 vivos
- [x] `/root/backups/` criado (09/09 17:04): `evolution-20260909-1704.dump` (105,8 MB), `redis-20260909-1704.rdb` (33,9 MB), cópia do db 8 no **db 9**, `instances-…`, `evolution-log-…txt` (25.968 linhas), `evolution-env-…txt` (600), `evolution-image-…txt`, `evolution-migrations-…txt`
- [x] Restauração de prova feita e removida (ver registro em 9.1)
- [x] Payloads reais capturados: `/root/backups/evolution-amostras-20260909-1704.jsonl` (10 linhas, 600) — falta anonimizar e transformar em fixtures no repositório
- [x] Fila de agendadas conferida: a única pendente é um resto de teste marcado para 2030 (P8) — nada real dispara na janela
- [ ] Equipe avisada para usar celular/outro CRM na janela
- [ ] Janela marcada, 4 celulares confirmados
- [ ] **Refazer o `pg_dump` e a cópia db 8 → db 9 imediatamente antes da janela** (o de 17:04 é anterior à limpeza das órfãs e vai envelhecendo)

#### 9.1 Registro da execução da Fase 0 (09/09/2026, 17:04–17:30)

- **Prova de restauração** (`evolution_ensaio`, 0 avisos do `pg_restore`), comparando o mesmo corte:
  `Message` até 1 h antes do dump **348.805 = 348.805**, última hora **116 = 116**; `Chat` 7.019 = 7.019; `Contact` 17.202 = 17.202; `IsOnWhatsapp` 22.622 = 22.622; `Instance` 6 = 6; `Session` 6 = 6; `Webhook` 5 = 5; `Setting` 6 = 6. Banco de ensaio apagado.
  ⚠️ Duas armadilhas da conferência, para não repetir: (1) comparar a contagem TOTAL de `Message` da produção com a do dump reprova sempre — chegam mensagens entre o dump e a conta (14 em 15 min); (2) `Message.id` é **texto (cuid)**, não inteiro — o corte tem de ser por `messageTimestamp`, não por `id`.
- **Amostras** (forma real da 2.3.2 em produção): mensagem de cliente em conversa LID chega com `remoteJid` = telefone, `previousRemoteJid` = LID e o telefone repetido em `senderPn`/`remoteJidAlt`; `fileLength` chega como **string** (`'43407'`, `'148421'`); `source` ∈ {`ios`, `web`, `unknown`}.
- **Órfãs**: `DELETE /instance/delete/{Bancario,CBAdv}` → `Instance deleted`; 5 s depois ainda apareciam como `close` (remoção assíncrona); ao fim, 4 instâncias, duplicata em `Chat` = 0, **0 linhas de QR** no minuto seguinte, 4 conexões `open`.
- **Redis**: 6 `DEL` confirmados; sobraram os 4 hashes vivos; o db 9 guarda a cópia de 17:04 (as chaves `evolution:baileys:*` têm TTL e expiram também na cópia — o que interessa são os hashes das instâncias, sem TTL).
- **Log durante a Fase 0**: `error in sending keep alive` (Timed Out) às 17:14, 17:18, 17:22 e 17:25 — **antes** das exclusões, durante o dump/restore (I/O pesado no mesmo Postgres) e com as órfãs ainda em laço; `stream:error 503` às 17:26:39 seguido de `connection.update` → `state: 'open'` às 17:26:40. As 4 conexões vivas terminaram `open`.
- **Agendada pendente**: ver a linha em 12 (P8).

### Fase 1 — upgrade

- [ ] `service update` com a imagem por digest + `TELEMETRY_ENABLED=false`
- [ ] Migrations aplicadas (log) — anotar as 4 em `_prisma_migrations`
- [ ] Cadastro/ativação feito; `/license/status` OK
- [ ] 4 conexões `open` (QR lido em: ______)
- [ ] `lid-mapping-*` / `session-*_1.*` no Redis
- [ ] T1–T22 executados e registrados (8.1)
- [ ] Forma de `fileLength` anotada; ajuste 4 decidido

### Fase 2 — observação (48 h) e fechamento

- [ ] Medidores (8.3) registrados em 24 h e 48 h
- [ ] Nenhum "Aguardando mensagem" relatado
- [ ] Ajuste 5 (`GROUP_UPDATE`) + Ressincronizar nas 4 conexões
- [ ] `/root/evolution.yaml` atualizado (imagem por digest, `TELEMETRY_ENABLED`)
- [ ] Docs e `CLAUDE.md` atualizados (5.6); `EVOLUTION-LID-FIX.md` marcado obsoleto
- [ ] Memória do projeto atualizada
- [ ] (Depois) log da Evolution fora do contêiner; desligar o outro CRM reduz aparelhos vinculados

---

## 10. Rollback

1. `docker service update --image ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694 --env-rm TELEMETRY_ENABLED evolution_evolution`
2. `docker service scale evolution_evolution=0` (para não escrever durante o restore).
3. Postgres: `dropdb evolution` + `createdb evolution` + `pg_restore` do dump
   (as 4 migrations novas **não** são desfeitas pela Evolution — só o dump volta).
4. Redis db 8: `FLUSHDB` no 8 + `COPY` de cada chave do db 9 de volta para o 8.
5. `docker service scale evolution_evolution=1`; conferir 4 × `open`.
6. **Se chegar "Aguardando mensagem" no CRM depois do rollback**: os clientes já
   usam as chaves publicadas pela v7 e o estado restaurado não as tem —
   desconectar e ler QR nas 4 conexões. O celular do escritório não é afetado.
7. O cadastro na fundação fica registrado (inofensivo). Mensagens recebidas
   durante a janela quebrada ficam no celular/outro CRM, não no nosso.

**O que o rollback NÃO devolve:** o que o WhatsApp registrou do lado dele
(chaves/aparelho) — coberto pelo passo 6; e o cadastro.

---

## 11. Plano B de emergência (paliativo)

Se a operação precisar de alívio **antes** do upgrade: purgar as sessões da
instância afetada e reiniciar a Evolution. É **reset**, não conserto — a
duplicidade volta em dias ou semanas (relatos de 1–2 dias a semanas).

1. `docker service scale evolution_evolution=0` — **obrigatório**: a Evolution
   (2.3.2 e `develop`, conferido no fonte) envolve as chaves em
   `makeCacheableSignalKeyStore`, um cache em memória; apagar no Redis com a
   instância viva deixa sessão fantasma em memória até o cache expirar.
2. No Redis db 8, no hash `evolution:instance:<id>`: apagar **só** os campos
   `session-*` (manter `pre-key-*`, `app-state-sync-*`, `sender-key-*`; as creds
   estão no Postgres e não são tocadas). Fazer a cópia para o db 9 antes.
3. `docker service scale evolution_evolution=1`. Sem QR. A primeira mensagem a
   cada contato reestabelece uma sessão única.
4. Também remover as instâncias órfãs (6.1, item 1).

---

## 12. Decisões pendentes e perguntas em aberto

| # | Pendência | De quem |
| --- | --- | --- |
| ~~P1~~ | **Resolvida 09/09**: cadastro com `leonardocabralb@gmail.com` (telefone informado ao executor, fora do repositório) | — |
| P2 | `group_sender_jid` continua LID (5.2) | operador confirma |
| ~~P3~~ | **Autorizada 09/09** e executada (seção 9, Fase 0) | — |
| P4 | Janela do upgrade e disponibilidade dos 4 celulares | operador |
| P5 | Forma de `fileLength` na versão nova → ajuste 4 | teste T5 |
| P6 | Latência de entrada com rc13 (5.6 dos riscos) | teste T21 |
| P7 | Log da Evolution fora do contêiner (fora deste plano, registrar) | depois |
| P8 | A única agendada `pending` (09/09) é **resto de teste automatizado** de 30/08 ("TESTE Fase 3 - fora do escopo", autor "TESTE AUTOMATIZADO", marcada para 01/01/**2030**) — não dispara na janela; cancelar quando quiser | operador (sem urgência) |

---

## 13. Anexo A — estado medido em 09/09/2026

### Instâncias na Evolution (tabela `Instance`) × canais do CRM (`cb_channels`)

| Instância (Evolution) | `id` | `ownerJid` | Estado | Canal no CRM | `own_lid` | Grupos | Hash Redis (campos) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cbcrm-a3af0191-5adc-4fa8-9c27-d69c2e5666d8-76ac04` | `44982408-b357-449c-adae-06ff28dc1dd3` | 5511964102992 | open | Bancário - Comercial (padrão) | NULL | 0 | 1.235 (280 sessões PN, 908 pre-keys, 13 sender-keys) |
| `juridico-bancario-d5a458` | `be282022-d83d-4800-a4da-f139ce034310` | 558388711991 | open | Bancário - Jurídico | `40373380473043@lid` | 12 | 274 |
| `comercial-trabalhista-e7c7ea` | `200ac9ef-98e0-4f35-a43e-f22ea168e7bd` | 558399673788 | open | Trabalhista - Comercial | NULL | 0 | 407 |
| `trabalhista-juridico-bf8a08` | `d1d9caf5-24db-48a6-a58c-8d0953200f7c` | 558386262646 | open | Trabalhista - Jurídico (`display_phone` NULL) | NULL | 0 | 664 |
| ~~`Bancario`~~ (órfã, **removida 09/09 17:27**) | `385dac9a-e446-44d9-be94-68ab94935e2e` | 5511964102992 | era `connecting` em laço de QR | — | — | — | 9.454 (cópia no db 9) |
| ~~`CBAdv`~~ (órfã, **removida 09/09 17:27**) | `c68ecb8d-5b13-4d0b-85b9-c3d9b89a01a2` | 558386262646 | era `connecting` em laço de QR | — | — | — | 3.074 (cópia no db 9) |
| ~~(apagadas, só hash)~~ **removidas 09/09** | `f71807c0-…`, `7fc75fe2-…`, `dcbf9851-…`, `60a309e7-…` | — | — | — | — | — | 3.078 / 86 / 30 / 2.720 (cópias no db 9) |

Canais do CRM sem instância na Evolution: "WhatsApp (QR Code)" (`Gabriel -
Teste`, padrão, 0 msgs) e "TESTE Bancario" (`teste-bancario-fase3`,
desconectado) — sobras de teste.

### Serviço `evolution_evolution`

- Imagem: `ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:dd3e46aadd696c07ac4a099f7e8e59b970f8a59e3df6c8c8beb4bf31f5848694`
  (Evolution 2.3.2, Baileys 6.7.19 com o patch `peer_recipient_pn`, sem `tc-token-utils`).
- Label `com.docker.stack.image` diz `evoapicloud/evolution-api:latest` — **stale**, como o `CLAUDE.md` já documenta; nunca pinar por ele.
- Traefik: `Host(api.cbadvogados.com)`, entrypoint `websecure`.
- Volume: `evolution_instances` → `/evolution/instances` (28 K).
- Log: `json-file`, `max-size 10m`, `max-file 3`.
- Env relevante: `CACHE_REDIS_ENABLED=true`, `CACHE_LOCAL_ENABLED=false`,
  `CACHE_REDIS_SAVE_INSTANCES=false`, `CACHE_REDIS_PREFIX_KEY=evolution`,
  Redis `redis://redis:6379/8` (sem senha), Postgres host `postgres`, banco
  `evolution`, user `postgres` (PostgreSQL 14.17), `DATABASE_SAVE_DATA_NEW_MESSAGE=true`,
  `DATABASE_SAVE_MESSAGE_UPDATE=true`, `S3_ENABLED=false`, `WEBHOOK_GLOBAL_ENABLED=false`,
  `QRCODE_LIMIT=1902`, `CONFIG_SESSION_PHONE_VERSION=2.3000.1025193442` (ignorada),
  `TELEMETRY`/`TELEMETRY_URL` presentes com nome que a versão nova **não lê**
  (ela lê `TELEMETRY_ENABLED`).
- Redis 7.4.2, `dir /data`; keyspace: db0 559 chaves (outros serviços), db2 4, db8 130 (Evolution). `COPY … DB n REPLACE` conferido funcionando (teste em db descartável).
- Tabela `Session` (creds): uma linha por instância, as 6 presentes (1,2–3,2 KB cada); `psql -U postgres` pelo socket do contêiner entra sem senha.
- Postgres: bancos `evolution` (579 MB), `n8n_queue` (262 MB), `postgres`.
- VPS: 2 CPUs, 8 GB RAM (5 GB disponíveis), 67 GB livres em disco.
- `/root/evolution.yaml` (28/07/2026) incompleto; `/root/backups` não existe.

### Envios por origem (CRM, `messages.from_me = true`)

| Dia | Texto pelo celular | Texto pelo CRM | Áudio | Imagem | Documento |
| --- | --- | --- | --- | --- | --- |
| 09/09 (até ~15h) | 225 | 17 | 31 | 1 | 1 |
| 08/09 | 493 | 77 | 90 | 16 | 0 |
| 04/09 | 306 | 49 | 44 | 7 | 5 |

Zero `failed` em 12 dias.

---

## 14. Anexo B — comandos de referência

Acesso: `ssh -i ~/.ssh/cb-crm-vps root@vps.cbadvogados.com` (chave da máquina do operador). Todos os comandos abaixo são de leitura, salvo onde marcado.

```bash
# Contêiner e imagem em execução
CID=$(docker ps -q -f name=evolution_evolution | head -1)
docker service inspect evolution_evolution --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
docker exec $CID sh -c 'grep -m1 "\"version\"" package.json; grep -m1 "\"version\"" node_modules/baileys/package.json'

# Medidores no log (o log só cobre desde o último reinício do contêiner)
docker service logs evolution_evolution --since 24h 2>&1 | grep -cE 'Closing session|Closing stale'
docker service logs evolution_evolution --since 24h 2>&1 | grep -c '"463"'
docker service logs crm_crm --since 24h 2>&1 | grep -c 'DESCARTADA: endereçada por @lid'

# Estado das instâncias (token não impresso)
KEY=$(docker exec $CID printenv AUTHENTICATION_API_KEY)
curl -s -H "apikey: $KEY" https://api.cbadvogados.com/instance/fetchInstances | python3 -c 'import sys,json; [print(i["name"], i["connectionStatus"]) for i in json.load(sys.stdin)]'

# Redis db 8: hashes e composição (só contagens)
RC="docker exec $(docker ps -q -f name=redis_redis | head -1) redis-cli -n 8"
$RC --scan --pattern 'evolution:instance:*'
$RC HKEYS evolution:instance:<id> | awk '/^session-[0-9]+_1\./{lid++} /^session-[0-9]+\./{pn++} /^lid-mapping/{lm++} END{print "PN="pn" LID="lid" lid-mapping="lm}'

# Postgres da Evolution (a senha está no env do contêiner; não imprimir)
PGCID=$(docker ps -q -f name=postgres_postgres | head -1)
docker exec $PGCID psql -U postgres -d evolution -Atc 'select name, "connectionStatus", "ownerJid" from "Instance"'
docker exec $PGCID psql -U postgres -d evolution -Atc 'select migration_name from _prisma_migrations order by finished_at desc limit 5'
docker exec $PGCID psql -U postgres -d evolution -Atc 'select "remoteJid", lid from "IsOnWhatsapp" where "remoteJid" like '"'"'55119953%'"'"''

# Backup (Fase 0) — cria arquivos; não altera o serviço
mkdir -p /root/backups
docker exec $PGCID pg_dump -U postgres -Fc evolution > /root/backups/evolution-$(date +%F).dump
$RC --scan --pattern '*' | while read -r k; do $RC COPY "$k" "$k" DB 9 REPLACE >/dev/null; done   # db 8 → db 9
$RC SAVE && docker cp $(docker ps -q -f name=redis_redis | head -1):/data/dump.rdb /root/backups/redis-$(date +%F).rdb
docker cp $CID:/evolution/instances /root/backups/instances-$(date +%F)

# Restauração de prova (cria e apaga um banco de ensaio). ⚠️ `-d <banco>` vem ANTES
# de `-Atc`; e a contagem de Message compara o MESMO corte de tempo (o id é cuid,
# e a produção continua recebendo enquanto se confere) — ver 9.1.
docker exec $PGCID createdb -U postgres evolution_ensaio
docker exec -i $PGCID pg_restore -U postgres -d evolution_ensaio < /root/backups/evolution-$(date +%F).dump
MTS=$(docker exec $PGCID psql -U postgres -d evolution_ensaio -Atc 'select max("messageTimestamp") from "Message"')
docker exec $PGCID psql -U postgres -d evolution_ensaio -Atc "select count(*) from \"Message\" where \"messageTimestamp\" < $MTS - 3600"
docker exec $PGCID psql -U postgres -d evolution        -Atc "select count(*) from \"Message\" where \"messageTimestamp\" < $MTS - 3600"   # têm de bater
docker exec $PGCID dropdb -U postgres evolution_ensaio
```

Consultas no Supabase do CRM (projeto `hxnhakmyxyhalbsktzwe`):

```sql
-- mensagens por origem e status (últimos dias)
select date_trunc('day', created_at at time zone 'America/Sao_Paulo')::date dia, content_type, status,
       count(*) filter (where from_device) pelo_celular, count(*) filter (where not from_device) pelo_crm
from messages where from_me and created_at > now() - interval '7 days' group by 1,2,3 order by 1 desc;

-- canais e own_lid
select label, instance_name, display_phone, own_lid, groups_enabled, status from cb_channels order by created_at;

-- agendadas pendentes (tem de ser zero na janela)
select count(*) from cb_scheduled_messages where status = 'pending';
```

---

## 15. Fontes

- Evolution API — fontes por tag/branch (`src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts`, `src/api/dto/*`, `src/validate/instance.schema.ts`, `src/api/integrations/event/**`, `src/config/env.config.ts`, `src/utils/use-multi-file-auth-state-prisma.ts`, `src/utils/sendTelemetry.ts`, `src/licensing/runtime.ts`, `src/api/guards/auth.guard.ts`, `prisma/postgresql-migrations/**`, `Dockerfile`, `package.json`): https://github.com/evolution-foundation/evolution-api — tags `2.3.2`, `2.3.7`, `2.4.0-rc2`, branch `develop` (commit de 14/07/2026)
- Notas de release 2.3.3 → 2.4.0-rc2: https://github.com/evolution-foundation/evolution-api/releases
- Licença: https://docs.evolutionfoundation.com.br/en/licensing · issue #2534 (ativação e deploys automatizados): https://github.com/evolution-foundation/evolution-api/issues/2534
- `PENDING` para sempre / 463 (rc.9) e relatos com rc13: https://github.com/evolution-foundation/evolution-api/issues/2597
- "Aguardando mensagem" na Evolution: https://github.com/EvolutionAPI/evolution-api/issues/1731 · https://github.com/evolution-foundation/evolution-api/issues/1934
- Baileys — guia v7: https://baileys.wiki/migration/v7 · rc13: https://github.com/WhiskeySockets/Baileys/releases/tag/v7.0.0-rc13 · investigação do 463: https://github.com/WhiskeySockets/Baileys/issues/2441 · sessões: https://github.com/WhiskeySockets/Baileys/issues/1701 · https://github.com/WhiskeySockets/Baileys/issues/1964
- Baileys rc13 — fontes conferidos: `src/Socket/messages-recv.ts` (recibos), `src/Types/Contact.ts` e `src/Types/GroupMetadata.ts` (participantes), `src/Defaults/index.ts` (opções padrão)
- Docker Hub `evoapicloud/evolution-api` (tags/datas) e inspeção local da imagem `homolog` na VPS (09/09/2026)
- Medições próprias de 09/09/2026: Supabase do CRM, banco `evolution`, Redis db 8, logs e serviço na VPS, código do CRM (`src/lib/whatsapp/transport/*`, `src/app/api/whatsapp/evolution/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts`, `src/lib/cb-groups/*`, `src/lib/contacts/foto-de-perfil.ts`, `src/lib/whatsapp/send-message.ts`)
