---
paths:
  - "src/app/api/whatsapp/webhook/**"
  - "src/app/api/whatsapp/evolution/webhook/**"
  - "src/app/api/cb/instagram/webhook/**"
  - "src/lib/whatsapp/inbound-store*"
  - "src/lib/whatsapp/send-message*"
  - "src/lib/whatsapp/mirror-inbound-media*"
  - "src/lib/whatsapp/foto-do-contato*"
  - "src/lib/whatsapp/sem-telefone/**"
  - "src/lib/instagram/persistir*"
  - "src/lib/cb-groups/persist*"
  - "src/lib/cb-channels/stamp*"
  - "src/lib/cb-channels/pipeline-routing*"
  - "src/lib/cb-channels/atraso-de-entrega*"
  - "src/lib/cb-channels/resolve-inbound*"
  - "src/lib/conversations/**"
  - "src/lib/automations/parar-se-responder*"
  - "src/lib/contacts/nome-fixado*"
  - "src/lib/contacts/foto-de-perfil*"
  - "src/lib/whatsapp/webhook-signature*"
  - "src/lib/whatsapp/resolve-conversation*"
  - "src/lib/whatsapp/transport/escada-de-status*"
  - "src/lib/whatsapp/transport/recibo-*"
  - "src/app/api/cb/channels/*/fotos/**"
---

# Ingestão e núcleo de envio — regras

Vale para todo caminho que GRAVA mensagem (webhooks da Meta, da Evolution e do
Instagram, `inbound-store`, `sem-telefone/`, grupo) e para o núcleo de envio de
gente (`sendMessageToConversation`). Cada caminho tem obrigações, quase todas
com pino default-deny: quem cria um caminho novo repete a lista abaixo. Irmãs:
`whatsapp-evolution.md` (payload, LID, Baileys), `midia.md` (anexo),
`canais.md` (saúde da conexão), `whatsapp-envio.md` (o resto do envio).

## Os caminhos

- **Meta, cliente**: `src/app/api/whatsapp/webhook/route.ts`.
- **Evolution, cliente**: `persistInboundMessage` (`inbound-store.ts`), chamado
  pela rota do webhook da Evolution.
- **Evolution, celular pareado** (a equipe falando pelo aparelho — é por onde o
  escritório mais fala): `persistDeviceMessage`.
- **Instagram**: `src/lib/instagram/persistir.ts`.
- **Recuperada sem telefone** (1010): `sem-telefone/` — modo `nova` vai pelo
  caminho normal; `tardia`/`historica` por `tardia.ts`/`historica.ts`.
- **Grupo**: `src/lib/cb-groups/persist.ts`.
- **Núcleo de envio**: `sendMessageToConversation` (`send-message.ts`) —
  compositor, ficha, agendada e API v1. Broadcast, fluxo, automação e IA NÃO
  passam por ele, e é assim que ficam de fora das regras de "gente".

## Obrigações, por caminho

- ⚠️⚠️ **Canal no PRÓPRIO insert.** Meta e `persistInboundMessage` gravam por
  `gravarComCanal` (`stamp.ts`), que repete SEM canal quando a conexão foi
  apagada no meio (23503 de `messages_channel_id_fkey`) — o provedor já recebeu
  200, e perder a linha seria perder a mensagem. Nunca um UPDATE separado
  depois: ele engolia a falha e a janela de 24h por número lia a mensagem como
  de outro número. Pino `stamp.chamadores.test.ts`. Os demais caminhos
  carimbam no insert pelo seu lado.
- ⚠️⚠️ **Reabrir: `reopenClosedConversation(id)` na instrução SEGUINTE ao
  INSERT da mensagem**, antes de prévia/canal/entrega. Quem decide "está
  encerrada?" é o BANCO (UPDATE condicional), nunca o status lido no começo da
  requisição — um encerramento no meio deixaria a mensagem nova fora da caixa.
  Seis chamadores: Meta, `persistInboundMessage`, `persistDeviceMessage`, núcleo
  de envio, Instagram e `tardia.ts` (só via `entregar.ts`). ⚠️ GRUPO NÃO
  REABRE com mensagem no grupo (`persist.ts` não toca `status`). Broadcast,
  fluxo, automação e IA não reabrem (um disparo para 500 encerradas devolveria
  as 500). Pino `reopen.chamadores.test.ts`.
  - Quem reabre fica responsável: o envio reabre com `assignTo:
    senderUserId`; cliente, celular e API por chave ESCREVEM
    `assigned_agent_id = NULL` (a encerrada antiga guarda o dono velho).
  - Encerrar SOLTA o responsável (decisão do operador, 02/09/2026): o fio
    grava por `patchDeSituacao` e o passo `close_conversation` zera
    `assigned_agent_id`. Caminho novo que encerra repete isso, senão quem
    reabre recebe a conversa com o dono velho. Aberta ↔ pendente não mexe no
    responsável. Sem backfill nas encerradas antigas, de propósito (o dono
    que ficou diz quem atendeu por último).
  - `aguardando_desde` NÃO é devolvida na reabertura (acenderia "em atraso"
    sobre cliente já respondido).
- ⚠️⚠️ **Quem abre negócio: `routeContactToPipeline`** em Meta, `persistInboundMessage`,
  `persistDeviceMessage`, núcleo de envio e Instagram. No núcleo, via
  `supabaseAdmin()`: sob a RLS do operador um `agent` deixaria de abrir card em
  silêncio. Gatilho por ESTADO ("o contato já tem card?"). Abrir conversa não
  cria negócio (decisão do operador): o card nasce no primeiro envio. ⚠️ O
  sender REAL do robô é `src/lib/flows/meta-send.ts` (o de `automations/` é
  wrapper). "Reusar o núcleo no broadcast" traz o roteador junto — 500 cards
  de uma vez. Pino `pipeline-routing.chamadores.test.ts` (default-deny).
- ⚠️⚠️ **`cancelarEsperasPorResposta` ANTES de `dispatchInboundToFlows`**, sem
  olhar `flowConsumed`, SÓ nos dois caminhos de CLIENTE do WhatsApp (Meta e
  `persistInboundMessage`). Depois do despacho, a mensagem cancelaria a espera
  da automação que ela mesma iniciou. Celular, grupo, Instagram e robô ficam
  de fora por decisão ("a mensagem de QUEM para a sequência?"). Pino
  `parar-se-responder.chamadores.test.ts` (ordem + default-deny).
- ⚠️ **`registrarEntrega` nos quatro caminhos com conexão própria**: Meta,
  `persistInboundMessage`, `persistDeviceMessage` e Instagram. Caminho novo que
  esqueça deixa a conexão sem medição, sem erro. Nunca lança (é o que torna o
  `await` seguro). Grupo fica de fora (o `channel_id` de grupo é o do webhook
  que chegou PRIMEIRO, e mediria sempre o número mais rápido); histórica e
  tardia também (mediriam horas de atraso numa conexão sadia). A escrita é
  cercada no WHERE — só avança, carimbo no futuro recusado; detalhes em
  `canais.md`.
- **`followConversationChannel`** nos quatro. No celular pareado é o que aponta
  a conversa para o número por onde a EQUIPE falou: sem ele o CRM responderia
  pelo canal padrão.
- ⚠️⚠️ **Nome do perfil do WhatsApp**: o UPDATE que troca o nome leva
  `.is('nome_fixado_em', null)` DENTRO do UPDATE (a busca não traz a coluna),
  em três arquivos: webhook da Meta, `inbound-store.ts` e
  `resolve-conversation.ts` (envio por telefone da API v1, que também trata o
  23505 por `fichaQueVenceu` e o telefone por `telefoneDigitado`). Sem a
  guarda, o nome fixado pelo agendamento vira o do WhatsApp na mensagem
  seguinte. O `pushName` de mensagem NOSSA (celular) é descartado — é o nome do
  advogado. Pino `nome-fixado.chamadores.test.ts` (conjunto exato de
  escritores de `contacts.name`).
- ⚠️ **INSERT em `contacts` trata o 23505 da chave canônica** por
  `fichaQueVenceu` (relê, com nova tentativa se a leitura falhar): desistir na
  primeira leitura descarta a mensagem que o provedor deu por entregue.
- ⚠️ **`conversation.created` começa SEM `await`** (`avisoDeConversaCriada`) e
  é esperado antes do `message.received` e em todo retorno antecipado — Meta,
  `inbound-store` e Instagram. Com `await` antes do upsert, um endpoint de
  saída fora do ar segurava a primeira mensagem de toda conversa nova. A ordem
  garantida é só `created` → `received`. Pinos: os testes "conversation.created
  não segura a gravação" (`route.test.ts`, `inbound-store.test.ts`,
  `persistir.aviso.test.ts`). ⚠️ O evento quer dizer SÓ "o cliente abriu a
  conversa" (decisão do operador): emiti-lo noutro caminho (envio, eco,
  histórica) muda o contrato publicado — ver `.claude/rules/webhooks.md`.
- ⚠️⚠️ **Motores (robô, automações, IA) só nos caminhos de cliente do
  WhatsApp.** Grupo, `historica.ts`, `tardia.ts` e Instagram (decisão D1) não
  importam motor nenhum — garantia ESTRUTURAL (`persist.test.ts`,
  `historica.chamadores.test.ts`, `persistir.chamadores.test.ts`). E há
  default-deny de quem chama `persistInboundMessage`/`persistDeviceMessage`
  (`inbound-store.chamadores.test.ts`): eles são o pacote inteiro, e o
  chamador novo não cita motor nenhum.
- **Carga de histórico NÃO passa pela ingestão**: nunca reaproveitar
  `persistInboundMessage` para importar — dispara tudo por mensagem antiga.
  Como importar: `supabase.md`.

## Webhook: o que responde
- Só assinatura inválida vale 4xx; o resto responde 200 com log e trabalha em
  `after()` — 4xx repetido faz o provedor desativar a entrega. A Evolution não
  reentrega: o 200 sai antes do `after()`.
- O webhook recebe só a CHAVE de roteamento (`instance_name` na Evolution,
  `phone_number_id` na Meta), nunca a conta: `resolve-inbound.ts` a traduz na
  conexão de `cb_channels`.
- O webhook da Meta também recebe eventos de MODELO (`template-webhook.ts`,
  com `wabaId: entry.id`): o stub nasce completo, com canal e dono — regras
  em `.claude/rules/whatsapp-envio.md`.
- `META_APP_SECRET` aceita vários segredos separados por vírgula (sem espaço).
  Qualquer um deles assina entrega para QUALQUER número da instalação: só apps
  de confiança (`docs/multi-waba.md`).
- Instagram: cada `entry` só é gravada se a SUA conexão assina
  (`quaisAssinam`) — senão quem tem o segredo de um app forjaria outra conta.
  Edição e exclusão alcançam a mensagem pela CONVERSA, nunca por `mid` solto.
  Não lidas pela RPC `bump_conversation_on_inbound`. Perfil lido ANTES do
  roteamento (o card nasce com o nome). Eco com `mid` já gravado é o nosso
  envio; sem linha, é o app do Instagram (`from_device`).

## Recibo de status
- ⚠️ **Escada**: status só AVANÇA (`escada-de-status.ts`: `aceitamAvancoPara`,
  `aceitamORecibo`, `ACEITA_FALHA`), com a condição no WHERE; o fan-out
  `message.status_updated` só sai quando alguma linha avançou. Sem ela a bolha
  volta a um ✓ com a mensagem entregue (a 2.4 manda `SERVER_ACK` depois do
  `DELIVERY_ACK`; a Meta manda `sent` e `delivered` em POSTs separados).
- ⚠️ **Espera da linha**: o recibo pode chegar ANTES da mensagem gravada
  (`aplicarReciboQuandoAMensagemExistir`). Evolution espera até ~30 s; Meta, 7 s
  (`pausasDoReciboDaMeta`), e `sent` e recibo de DISPARO não esperam. Recibo de
  mensagem RECEBIDA não espera. UPDATE solto perde a corrida em silêncio.
- Meta: `reciboDaMeta` traduz (`played` → `read`; valor desconhecido não toca
  nada); só linhas `agent`/`bot`, escopo por canal. Os recibos de um POST rodam
  DEPOIS das mensagens dele, um por vez. `broadcast_recipients` é espelhado
  ANTES, com UPDATE condicional (`origensDoDestinatario`). O motivo da falha sai
  de `motivoDaFalhaDaMeta` (PARSE, nunca `as`: código não numérico derrubaria o
  UPDATE) nos mesmos updates condicionais; falha recusada pela escada não grava
  motivo, e recibo posterior não o apaga. Pinos `route.recibo.test.ts` (as duas
  rotas), `recibo-da-meta.test.ts`, `escada-de-status.test.ts`.
- ⚠️ Recibo de DISPARO só é reconhecido quando o destinatário JÁ tem o wamid.
  No disparo pela tela, o wamid é gravado quando o lote de 10 volta ao
  navegador; o recibo que chega antes espera os 7 s como mensagem comum e se
  perde para a contagem da campanha. A perda é anterior à espera: aumentar a
  pausa não conserta. Limite conhecido, não tratado.
- Consumidor novo de recibo repete escada E espera.

## Conteúdo e anexo na entrada
- Meta: `contentText` continua `caption || filename` — não "simplificar": a
  lista e a busca leem essa coluna. O nome vai também em `media_filename`
  (coluna própria); nome ausente NÃO sobrescreve com NULL.
- Legenda sem nada visível (o `￼` do iPhone) não é legenda.
- Meta: a mídia recebida é COPIADA para `chat-media` (`mirror-inbound-media.ts`,
  a Meta apaga em ~30 dias) em best effort: nunca lança, e na falha fica a URL
  de proxy. Webhook que falha faz a Meta reentregar e re-rodar contato, fluxos,
  automações e IA.
- ⚠️ **Portão por tamanho ANTES de baixar** (`mediaBytesOf`; `fileLength` vem
  como STRING → `Number()`; ausente conta como pequeno). O teto de ENTRADA é
  `MEDIA_MAX_BYTES_ENTRADA` (o do bucket), nunca o de envio — usar um pelo
  outro apaga documento de cliente. O nome do arquivo é gravado mesmo quando o
  anexo é recusado.
- Evolution: `fetchAndStoreEvolutionMedia` devolve `EvolutionMediaSalva`, e
  os DOIS call sites (este webhook e a rota de mídia de grupo) gravam
  `media_filename` E `media_type` — com string só, os dois morriam no
  `return` (`.claude/rules/midia.md`).
- ⚠️⚠️ `too_large` só por `marcarAnexoGrandeDemais`: grava o estado e SÓ ENTÃO
  apaga o ponteiro `cb_message_media_ref`. Pino
  `anexo-grande.chamadores.test.ts`. Detalhes em `midia.md`.
- Edição cifrada da 2.4 (`secretEncryptedMessage`): o item sai do upsert e a
  rota carimba `edited_at` na mensagem alvo MANTENDO o texto.
  `messages.edited` sem texto é ignorado de propósito (a revogação chega por
  `messages.delete`).

### Foto de perfil do contato (973)
- `contacts.avatar_checked_at` impede a chamada infinita: a Evolution devolve
  `null` para "sem foto" e para "privada". Revalida em 30 dias.
- `null` NÃO apaga a foto que já temos; só o carimbo avança.
- A imagem é COPIADA para `chat-media` em `account-<conta>/avatares/<contato>.jpg`
  (caminho estável com `upsert`) e a URL leva `?v=<epoch>` contra o cache.
- O webhook confere UM contato, depois de a mensagem e o anexo gravados, só
  1:1; a falha vira log, nunca quebra a ingestão.
- O 2º caminho é o botão "Buscar fotos dos contatos" (Conexões, `POST
  /api/cb/channels/[id]/fotos`): `chat/findChats` traz a foto de TODOS os
  chats numa chamada e casa com `contacts` pelos 8 últimos dígitos (a régua
  de `findExistingContact`); a rota responde 202 e trabalha em `after()`.
- Sem policy nova para `avatares/`: as da 020/023 casam só o 1º segmento, e
  o objeto que um membro apagar pelo Storage volta na conferência seguinte
  (aceito).

### Mensagem 1:1 em `@lid` sem telefone (1010)
- ⚠️⚠️ O LID JAMAIS vira `contacts.phone` (`findExistingContact` casa pelos 8
  últimos dígitos). O telefone vem do acervo de mensagens reais
  (`remote_jid_lid → remote_jid`), conferindo a conta duas vezes; senão a
  mensagem fica RETIDA.
- ⚠️⚠️ Três modos (`modo.ts`, puro): `nova` = é a ÚLTIMA da conversa e tem até 4
  min → caminho normal, motores inclusive (senão a cópia normal perderia o
  UNIQUE e os motores não rodariam); `tardia` = última, mas tarde → entra como
  história e a conversa reflete (reabre, prévia); `historica` = alguém já
  escreveu depois → só o fio. "A última" é carimbo ESTRITAMENTE maior (`>`):
  empate é história. O teto é 4 min, não os 5 do alarme da 1002 (há teste).
- `nova` que perde o UNIQUE é `duplicada`, não `falhou`.
- Mensagem gravada com `created_at` no passado chama
  `cb_assentar_mensagem_historica` (o gatilho da 972 decide pela ordem de
  inserção). Detalhes em `supabase.md`.
- A religação roda DEPOIS de todos os itens do lote, na rota, e o resto das
  retidas de um LID é drenado na segunda leva da fase de anexos — nunca dentro
  do laço dos itens.
- Invariante: peça nova que falha volta ao comportamento de ANTES (log
  `DESCARTADA`); nenhuma função do módulo lança.
- O anexo da retida é baixado pela conexão DA RETIDA; conexão apagada = pula o
  download (o padrão da conta nunca viu a mensagem).

### Grupo (`cb-groups/persist.ts`)
Nunca grava em `contacts` (JID de grupo fundiria com o celular de um cliente);
remetente desnormalizado em `messages.group_sender_*`. Não dispara motor, não
reabre, não mede entrega, não entra na janela nem no carimbo de canal por
conversa.
