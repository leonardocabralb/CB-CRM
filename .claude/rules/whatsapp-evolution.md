---
paths:
  - "src/lib/whatsapp/transport/**"
  - "src/lib/whatsapp/sem-telefone/**"
  - "src/app/api/whatsapp/evolution/**"
  - "src/lib/cb-channels/evolution-admin*"
  - "src/lib/cb-groups/**"
  - "src/app/api/cb/groups/**"
  - "docker/evolution-cb/**"
  - "ops/**"
---

# WhatsApp pela Evolution — regras

Vale ao editar ou revisar o transporte da Evolution, a mensagem 1:1 sem
telefone, os grupos, a imagem própria da Evolution e `ops/`. O que cada
caminho de ENTRADA dispara (reabrir, motores, funil, entrega) está em
`.claude/rules/ingestao.md`; anexo e mídia em `.claude/rules/midia.md`.
Operação da VPS e da imagem (digests, rollback, stack, backup): leia
`docs/INFRA-VPS.md` inteiro antes de qualquer comando na VPS.

### Baileys 7 / Evolution 2.4

A produção roda a NOSSA imagem da Evolution 2.4 (Baileys 7.0.0-rc13), com
dois patches em `docker/evolution-cb/`: a citação do cliente e a foto de
perfil. Plano vivo: `docs/PLANO-baileys-7.md`.

- ⚠️ **Voltar de versão da imagem está DESCARTADO** (decisão do operador): a
  2.4 foi escolhida para acabar com o "Aguardando mensagem" — a Baileys 6 não
  conhecia o LID e abria duas sessões de criptografia por aparelho.
- ⚠️⚠️ **Trocar a imagem ou reiniciar o contêiner só com a fila de entrada
  VAZIA** (`entrega_recebida_em − entrega_carimbo_em` da 1002 em ~0 s em todas
  as conexões). A Baileys confirma ao servidor ANTES do handler: a fila
  represada se perde para o CRM e fica só no celular.
- ⚠️ **O LID muda de CAMPO conforme a versão**: a 2.3.2 o põe em
  `previousRemoteJid`; a 2.4 em `remoteJidAlt` (telefone em `remoteJid`); a
  2.3.7 o perde. `lidJidFromKey` (`evolution-inbound.ts`) lê os três lugares.
  Ler só um faz `remote_jid_lid` nascer nulo, e apagar/editar pelo celular em
  conversa LID deixa de fazer efeito. Pino: `evolution-inbound.test.ts`.
- ⚠️ **O nosso LID em grupo vem de `senderLid` (`lidDoRemetente`), nunca de
  `senderJid`.** `remetenteDoGrupo` prefere o telefone, e `aprenderNossoLid`
  só aceita `@lid`: pelo `senderJid` ele nunca mais aprenderia.
- ⚠️ **Participante de grupo é `Contact`**: `id`, mais `phoneNumber` quando
  `id` é LID ou `lid` quando `id` é telefone (`.jid` não existe mais).
  `parseGroupInfo` (`cb-groups/sync.ts`) lê as duas formas.
- ⚠️ **Edição chega CIFRADA** (`secretEncryptedMessage`, `secretEncType` 2,
  com `targetMessageKey`), e a rc13 não decifra. `normalizeUpsert` descarta o
  item (virava bolha vazia) e a rota carimba `edited_at` na mensagem alvo,
  MANTENDO o texto antigo. O texto novo não existe do nosso lado: antes de
  "consertar" a bolha, ler `isSecretEncrypted`/`edicaoCifrada`.
- ⚠️ **Todo `protocolMessage` vira `messages.edited`**, inclusive a revogação
  (`type: 0`, sem `editedMessage`). A rota ignora o `edited` sem texto de
  propósito: o apagar-para-todos chega pelo `messages.delete`. Não tratar o
  `edited` vazio como edição.

### Recibos: a escada e a espera

- ⚠️ **Recibo fora de ordem**: a 2.4 manda `SERVER_ACK` depois do
  `DELIVERY_ACK` da mesma mensagem. Todo UPDATE de status passa pela ESCADA
  (`escada-de-status.ts`: `.in('status', aceitamAvancoPara(novo))`), e
  `message.status_updated` só sai quando alguma linha avançou. Sem ela a bolha
  volta a ✓ com a mensagem entregue. Pinos: `escada-de-status.test.ts` e o
  `route.recibo.test.ts` de cada webhook.
- ⚠️ **Recibo ANTES da mensagem** (não é da Baileys 7): a mensagem do celular
  só é gravada depois da espera de 2 s do `jaGravada`, e o envio pelo CRM só
  depois que a Evolution responde. O recibo que chega antes acha zero linhas
  e morre, e a bolha fica em ✓ até o cliente LER.
  `aplicarReciboQuandoAMensagemExistir` (`recibo-antes-da-mensagem.ts`) tenta
  de novo por até ~30 s; linha que existe e não avança é recibo velho, e ele
  desiste; recibo de mensagem RECEBIDA não espera. Quem escrever outro
  consumidor de recibo repete a espera — o UPDATE solto perde em silêncio.
- **A rota da META tem a mesma escada e a mesma espera** (`recibo-da-meta.ts`),
  com três diferenças de propósito: espera de 7 s
  (`PAUSAS_DO_RECIBO_DA_META_MS`), porque a maioria dos recibos que chegam lá
  é de mensagem que não existe no CRM (outro sistema no mesmo número) e
  esperaria até o fim sempre; `sent` e recibo de DISPARO não esperam (todo
  envio grava `sent`; disparo não grava em `messages`); os recibos de um POST
  rodam depois das mensagens dele, um de cada vez. `ACEITA_FALHA` e
  `aceitamORecibo` moram em `escada-de-status.ts`, para as duas rotas. Pino:
  `recibo-da-meta.test.ts`.

### Link sai SEM prévia

- ⚠️⚠️ **`linkPreview: false` em todo texto pela Evolution**
  (`EvolutionClient.sendText`). A 2.4 monta a prévia no formato de ANÚNCIO
  (`externalAdReply`) e parte dos Android não exibe a mensagem (recibo ERROR,
  ou o aparelho pede de novo até desistir). Caminho novo de TEXTO pela
  Evolution repete o campo. Pino: `evolution-transport.test.ts`. A verificação
  pendente está em `docs/PLANO-link-sem-previa.md` §4.
- O balão "Não confirmada", que pinta o que provavelmente não chegou, está em
  `.claude/rules/inbox-conversa.md`.
- ⚠️ **Número que é CONEXÃO do CRM não serve de destino para teste de entrega**
  (conferir `cb_channels.display_phone`). O Baileys da instância confirma
  sozinho, e a outra conexão grava a mensagem como se fosse de cliente — já
  reabriu uma conversa interna encerrada.

### O atraso de entrega é uma linha da Evolution 2.4

- **A causa é da Evolution, não do CRM.** O handler de `messages.upsert` roda
  um lote por vez e, dentro dele, consulta a foto de perfil pelo LID, que o
  WhatsApp não responde; a Baileys espera 60 s. Resultado: 1 mensagem por
  minuto por conexão, nos dois sentidos. Conserto:
  `docker/evolution-cb/foto-de-perfil-por-telefone-com-teto.patch` (consulta
  pelo telefone, teto de 5 s só nesse chamador). O CRM não lê esse campo; a
  foto vem da 973.
- **`POST /instance/restart/<instância>` é só PALIATIVO**: drena a fila
  represada ao CRM (16 min em 1 min, medido), não tira a causa. ⚠️ A regra da
  fila VAZIA, acima, é para o CONTÊINER e a imagem, não para este restart de
  instância — que é justamente o que se usa com a fila represada. Receita em
  `docs/INFRA-VPS.md`, §9.
- Medir por `messages.gravada_em − created_at` (1003), mensagem a mensagem,
  EXCLUINDO `cb_mensagens_sem_telefone.message_id`: a recuperada é gravada
  tarde de verdade. O alarme de atraso por conexão (1002) está em
  `.claude/rules/canais.md`.

### Mensagem 1:1 em `@lid` SEM telefone (1010)

`src/lib/whatsapp/sem-telefone/` (`modo.ts` puro; `resolver-lid`, `retidas`,
`historica`, `tardia`, `entregar`, `receber`, `religar`), `ehLidSemTelefone`,
a opção `telefoneResolvido` de `normalizeUpsert` e a tabela
`cb_mensagens_sem_telefone`. Causa, riscos e limites aceitos:
`docs/PLANO-lid-sem-telefone.md`.

- **A causa é a Baileys, não o WhatsApp.** A cópia que o celular reenvia
  depois de uma falha ao decifrar (`requestPlaceholderResend` sem `msgData`)
  chega só com o LID, sem telefone nem nome. Atualizar a biblioteca não
  resolve. Boa parte dessas cópias é DUPLICATA de mensagem que chegou normal.
- ⚠️⚠️ **O LID JAMAIS vira `contacts.phone`.** `findExistingContact` casa pelos
  últimos 8 dígitos e fundiria a mensagem com um cliente real. O telefone só
  vem de mensagem REAL já gravada (`messages.remote_jid_lid → remote_jid`), e
  `normalizeUpsert` só aceita "telefone resolvido" que termine em
  `@s.whatsapp.net`. `resolverTelefoneDoLid` confere a CONTA no `!inner` E em
  JS: o banco falso dos testes não lê o `select`, e tirar o `!inner` passaria
  verde devolvendo mensagem de outra conta.
- ⚠️⚠️ **Três modos (`modo.ts`).** `nova` = é a última da conversa e tem até
  4 min → caminho normal, motores inclusive (se a recuperada nunca disparasse
  motor e ganhasse o UNIQUE da cópia normal, os motores não rodariam para ela).
  `tardia` = é a última, mas tarde demais para os motores → entra como
  história e a conversa a reflete (reabre, prévia, `last_message_at`).
  `historica` = alguém escreveu depois → só entra no fio. Não saber qual é a
  última = `historica`. Tardia e histórica não disparam nada: o robô e a IA
  responderiam a algo de horas atrás.
- ⚠️⚠️ **"A última" é carimbo ESTRITAMENTE maior (`>`); EMPATE é história.** O
  carimbo vem em segundos, e a irmã do mesmo segundo já passou pelos motores:
  com `>=`, a fala retida da rajada virava resposta ao menu do robô.
- ⚠️ **O teto é 4 min, não os 5 do alarme da 1002**: `registrarEntrega` mede
  depois da espera do `jaGravada`. Há teste cobrando a folga.
- ⚠️⚠️ **"Sem motor" é ESTRUTURAL.** `historica.ts` e `tardia.ts` não importam
  motores, funil, `followConversationChannel`, `registrarEntrega` (mediria
  horas de atraso numa conexão sadia) nem `cancelarEsperasPorResposta`; só
  `entregar.ts` chama `reopenClosedConversation`, e só no modo `tardia`. Pinos:
  `historica.chamadores.test.ts` e `inbound-store.chamadores.test.ts`
  (default-deny de quem chama `persistInboundMessage`/`persistDeviceMessage`,
  que são o pacote inteiro). Mensagem gravada com carimbo antigo passa por
  `cb_assentar_mensagem_historica` (vigente na 1011) — ver
  `.claude/rules/ingestao.md`.
- ⚠️⚠️ **A religação roda DEPOIS de todos os itens do lote** (`paraReligar`,
  um por LID), nunca dentro do laço: ~6 idas ao banco por retida atrasariam —
  e, num corte do `after()`, perderiam — os itens seguintes. `receberSemTelefone`
  só DEVOLVE o pedido (`religar`); quem religa é a rota, antes da fase de
  anexos. `MAXIMO_DE_RETIDAS_POR_VEZ` (10) limita. Há pino lendo a rota.
- ⚠️⚠️ **A primeira passada é UMA página, e o resto é drenado na mesma
  entrega** (`haMais` → `comResto` → `religarOResto`, na segunda leva da fase
  de anexos, pelo MESMO corpo — sem cópia, há pino). Esperar a próxima
  mensagem daquele LID deixaria presas as falas mais recentes do lead.
  Limitado por `MAXIMO_DE_PASSADAS_DO_RESTO`; para quando uma passada não
  resolve ninguém. Retida que FALHA segue retida até a próxima mensagem do LID.
- Consequência aceita: quando quem destrava é o ECO do escritório, a fala
  retida entra antes de o cliente escrever de novo, e a mensagem seguinte dele
  deixa de contar como `first_inbound_message`.
- ⚠️ **Depois de reter, o LID é resolvido DE NOVO** (`receber.ts`): o eco que
  traz o par pode ter sido gravado durante a retenção.
- ⚠️ **Invariante: se qualquer peça nova falhar, vale o comportamento antigo**
  — a mensagem não entra e o log diz `DESCARTADA` (o texto que o medidor do
  plano procura). Nenhuma função do módulo lança; exceção na chegada cai na
  RETENÇÃO, nunca no descarte. Banco sem a 1010 é tolerado.
- ⚠️ **`nova` que perde o UNIQUE é `duplicada`, não `falhou`** (`entregar.ts`
  confere): `falhou` mandaria reter mensagem já entregue, e o Meu dia avisaria
  "retida" por dias sobre conversa completa.
- ⚠️ **O anexo da retida é baixado pela conexão DA RETIDA** (`channelId` no
  item de `semAnexo`, lido com `'channelId' in pendente`, nunca `??`): a fala
  do número A pode ser destravada por mensagem no número B, e a mídia só
  existe na instância do A. Conexão apagada (`null`) = download pulado (senão
  cairia no canal padrão). Item normal não carrega a chave. Há pino na rota.
- ⚠️ **O payload cru existe só enquanto a mensagem está retida**
  (`CHECK ((situacao = 'retida') = (payload IS NOT NULL))`). Tabela fechada ao
  navegador; o Meu dia recebe só CONEXÃO e HORA (ver `.claude/rules/meu-dia.md`);
  o log de falha do insert leva só código e mensagem (o `details` traz o texto
  do cliente). ⚠️ Retida que nunca religa guarda o payload sem prazo e SEM
  vínculo com ficha: apagar o contato (inclusive por pedido de exclusão) não a
  alcança — decisão pendente do operador, registrada no plano.
- O fio aberto acrescenta a recuperada no FIM, não pelo carimbo (ver
  `.claude/rules/inbox-conversa.md`).
- Os limites aceitos (apagada ou editada antes de religar, citação sem
  vínculo, eco de envio do CRM não destrava, "alguém escreveu depois" conta
  máquina, o par anotado só depois dos motores, a não lida decidida antes da
  função) estão no plano. A Fase 3 (consulta local `getPNForLID` na imagem)
  ficou fora por decisão do operador.

### Grupo de WhatsApp (906/916): detalhes da Evolution

Grupo não é contato — a regra geral está na raiz. Aqui, o que é do transporte:

- ⚠️ **A regra do `@lid` do 1:1 NÃO vale em grupo.** O remetente vai
  desnormalizado em `messages.group_sender_*`, sem FK e sem criar contato.
  Quase todo participante chega em `@lid`: a regra do 1:1 esvaziaria o recurso.
- **Grupo não dispara automação, fluxo nem IA**: `cb-groups/persist.ts` não
  importa os motores, e um teste lê o fonte. Grupo nas automações = import
  visível ali, nunca uma flag.
- ⚠️ **`persist.ts` não reabre conversa encerrada.** Grupo encerrado some da
  caixa enquanto as mensagens continuam chegando; só um envio da equipe o
  reabre. Por isso o encerramento em lote (1018) deixa grupo de fora por padrão.
- ⚠️ **`group/fetchAllGroups` estoura** (mais de 90 s). Use `chat/findChats`
  filtrando `@g.us` (traz nome e foto). `findGroupInfos` (~650 ms por grupo)
  só para participantes, announce, admin e o nosso LID.
- ⚠️ **Um evento desconhecido faz a Evolution recusar a lista INTEIRA de
  eventos do webhook.** `GROUPS_UPDATE` não existe. `GROUP_UPDATE` existe na
  2.4, mas ainda não está na lista do CRM (pendente em `PLANO-baileys-7.md`,
  ajuste 5: conferir o enum e "Ressincronizar" as conexões).
- **Ligar `cb_channels.groups_enabled` não basta**: instância já conectada só
  recebe os eventos novos depois de reaplicar o webhook ("Ressincronizar").
- **Menção chega em `@lid`**: `cb_channels.own_lid` (916) é aprendido na
  primeira mensagem nossa num grupo. Sem ele, `mentions_us` fica falso para
  sempre.
- **Insert em BLOCO preenche coluna ausente com NULL**: `from_device` e
  `mentions_us` (NOT NULL) estouram se as linhas do lote não forem uniformes.

### Nome da instância Evolution

- ⚠️ **Derivado do RÓTULO, com sufixo aleatório, fixado na criação**
  (`buildChannelInstanceName`: "Comercial" → `comercial-3f2a91`). O sufixo não
  é enfeite: `provisionEvolutionInstance` é create-or-ADOPT por nome, e um
  rótulo igual a uma instância que já existe no servidor compartilhado faria o
  CRM assumi-la e reapontar o webhook dela, em silêncio e com 200.
- Renomear o canal NÃO renomeia a instância: `instance_name` é a chave de
  roteamento da entrada, e a Evolution não renomeia (seria apagar e recriar,
  perdendo o pareamento e a `api_key`).
