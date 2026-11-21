---
paths:
  - "src/lib/instagram/**"
  - "src/app/api/cb/instagram/**"
  - "src/lib/cb-channels/transporte*"
  - "src/lib/contacts/identidade*"
---

# Instagram Direct — regras

Vale ao editar ou revisar o terceiro transporte (Instagram Direct), os
predicados de transporte e a identidade do contato sem telefone. Estado e
fases pendentes (`ig_human_agent`, unificação de fichas):
`docs/PLANO-instagram-direct.md`. O que a ingestão do Instagram dispara (e
não dispara) está também em `.claude/rules/ingestao.md`.

### O transporte é PREDICADO, nunca literal

`src/lib/cb-channels/transporte.ts`: `ehMeta`, `ehEvolution`, `ehInstagram`,
`ehWhatsApp`, e `transporteDe`, que LANÇA em valor desconhecido.

- ⚠️⚠️ **`kind === 'evolution'` / `provider !== 'meta'` REPROVA o CI em todo
  `src/`** (fora de `transporte.ts`): qualquer identificador terminado em
  kind/provider, sem distinção de caixa. Antes do Instagram, dezenas de
  ternários tinham o `else` significando "Meta": um canal Instagram iria para
  a Cloud API com o token do Instagram e um IGSID no lugar do telefone. Pino:
  `transporte.chamadores.test.ts`. `.eq('kind', …)` em consulta é permitido.
- ⚠️ **`switch (x.kind)` sobre `Transporte` só com a asserção de
  exaustividade** (`default: { const nunca: never = x; throw … }`, como em
  `IconeDoTransporte` e `transport/index.ts`). O `tsconfig` não tem
  `noImplicitReturns`: sem ela, um 4º transporte compila e o `switch` devolve
  `undefined` em silêncio.
- ⚠️ **Os ramos de Instagram falham FECHADO**: senders do robô
  (`exigirWhatsApp` — robô não responde no Direct, D1), reação (400, e o botão
  some da bolha), apagar/editar (frase própria), canal padrão (recusa: o
  padrão é o WhatsApp que responde conversa sem canal), nova conversa (não
  oferece), compositor (sem modelo nem interativa, inclusive pelo atalho de
  resposta rápida). O núcleo de ENVIO responde desde a Fase 4 (abaixo), com
  as recusas dele.
- ⚠️ **Ramo de DUAS pernas (`ehEvolution ? … : <Meta>`) só atrás de uma guarda
  de Instagram anterior no mesmo caminho.** É a guarda que o sustenta, e o
  teste estrutural só pega o literal. Ramo novo de duas pernas sem guarda é
  bug; o censo é `grep -n 'if (eh' src`.
- ⚠️ **`pinConversationChannel` confere só a POSSE, nunca o transporte.**
  `POST /api/v1/messages` confere `ehWhatsApp` ANTES de criar contato e de
  fixar (pino `src/app/api/v1/messages/route.test.ts`): fixar a conta do
  Instagram na conversa do telefone prendia a conversa, e todo envio seguinte
  falhava. As rotas internas que fixam dependem da tela oferecer só o que
  serve; quem expuser outro seletor repete a guarda.

- **Na caixa de entrada, a conversa do Direct tem selo na foto, pastilha no
  cabeçalho e glifo na bolha** (decisão do operador, 21/11/2026):
  `.claude/rules/canal-na-conversa.md`.

### Contato sem telefone

- ⚠️ **`Contact.phone` é `string | null`**: a ficha só do Instagram não tem
  telefone (nem a só-BSUID do WhatsApp, 1041). Toda tela que mostra "o
  telefone" passa por `identidadeDoContato`/`nomeDoContato` (`identidade.ts`):
  telefone, senão o `@` do WhatsApp, senão o do Instagram (decisão do
  operador, 24/09/2026), senão o fallback que a TELA escolhe — parâmetro
  OBRIGATÓRIO, senão um padrão escondido sairia em inglês numa tela e em
  português noutra. Nunca o IGSID nem o BSUID na tela. O `tsc` não vê
  `{contact.phone}` em JSX, `name || phone` nem tipo local com
  `phone: string`: caçar por grep. Pino: `identidade.test.ts`.
- ⚠️ **Consulta que EMBUTE o contato leva `instagram_username` E
  `wa_username` junto**, senão o `@` não chega e a ficha sem nome vira
  "contato desconhecido". Pino default-deny `identidade-nos-embeds.test.ts`
  (toda lista `name, phone` em `src/`).
- ⚠️ **IGSID nunca vai para `contacts.phone`**: `findExistingContact` casa
  pelos últimos 8 dígitos e fundiria com um cliente real. A identidade do
  Instagram é `contacts.instagram_id` (989).

### Webhook e anexo

- ⚠️ **Quem assina o webhook é o Instagram App Secret da aba do PRODUTO** — não
  a "Chave secreta do aplicativo" que a doc da Meta sugere, e não
  `META_APP_SECRET`. É por canal e cifrado (`cb_channels.ig_app_secret`);
  `assinatura.ts` recebe o segredo por parâmetro, e segredo vazio nunca casa.
- ⚠️ **A porta é `/api/cb/instagram/webhook`: só assinatura que NÃO casa vale
  401.** `object` errado, conta desconhecida e forma estranha são 200 com log —
  4xx repetido faz a Meta desativar a assinatura.
- ⚠️ **Cada `entry` só é persistida se a SUA conexão assina** (`quaisAssinam`):
  o segredo é do APP da Meta, e sem isso quem tem o segredo do próprio app
  forjaria o `entry.id` de outra conta deste CRM.
- **Toda DM chega com um `message_edit` de `num_edit: 0`** — não é edição
  (`interpretarWebhook` ignora); consumido, cada DM viraria duas linhas.
- **Edição e exclusão alcançam a mensagem pela CONVERSA** do cliente na conta
  roteada, nunca por `mid` solto (só é único por conversa). Não lidas pela RPC
  atômica `bump_conversation_on_inbound`.
- **A nota de voz vem como `attachments[type=audio]`**, com URL assinada que
  EXPIRA (baixar na hora) e `content-type: video/mp4`: a classe sai do `type`
  do webhook (`midiaDoAnexo`), nunca do CDN, senão a voz vira vídeo no fio.
- ⚠️⚠️ **A URL do anexo NÃO é confiável**: ela vem do corpo que a própria
  conexão assina, e quem cadastra uma conexão com o próprio App Secret forja a
  entrega. Baixada crua, era SSRF com leitura (loopback, metadado da nuvem,
  nomes internos), e a resposta ia para o bucket público. Todo download passa
  por `baixarUrlPublica` (`midia.ts`): só `https`, `isDeliverableUrl` em CADA
  salto, redirecionamento seguido à mão (até `MAX_SALTOS`), UM prazo para a
  cadeia inteira e `lerComTeto` (`src/lib/http/ler-com-teto.ts`, teto
  `MEDIA_MAX_BYTES_ENTRADA`, conferido durante a leitura). Recusa vira "anexo
  indisponível". Pino: `midia.test.ts`.
- ⚠️ **Não desligar o redirecionamento e não trocar por lista de hosts da
  Meta**: o que se barra é o endereço não público. A guarda
  (`src/lib/webhooks/ssrf.ts`) é idêntica à do upstream de propósito — divergir
  é conflito no próximo merge.
- **O perfil (nome, @, foto) é lido ANTES do roteamento para o funil** — o card
  nasce com o nome —, só na criação, sem `@`, ou a cada 30 dias
  (`avatar_checked_at`, carimbado mesmo sem foto).
- ⚠️ **`persistir.ts` roda em `after()` e NÃO importa os motores** (robô fora,
  D1; pino `persistir.chamadores.test.ts`). Grava `user_id` =
  `accounts.owner_user_id` (dono durável, allowlist de `dono-duravel.test.ts`),
  e entra nas allowlists de `pipeline-routing.chamadores` e `reopen.chamadores`.
  O `conversation.created` começa sem `await` (pino `persistir.aviso.test.ts`).
- **Eco (`is_echo`) com `mid` já gravado é o nosso próprio envio** e o UNIQUE
  descarta; sem linha, veio do app do Instagram e entra como `from_device`.

### Responder pela caixa (Fase 4, 21/11/2026)

`sendMessageToConversation` com o canal do Instagram; a régua do que cabe é
`src/lib/instagram/envio.ts` (puro: núcleo, rotas de agendar e compositor).
Pino `send-message-instagram.test.ts`.

- ⚠️⚠️ **O host e o token moram SÓ em `graph.ts`** (`enviarMensagem`,
  `renovarTokenLongo`): o login unificado vai trocar host e token por lá.
  Rota, núcleo e cron nunca montam URL da Meta.
- ⚠️⚠️ **O destino é o IGSID (`contacts.instagram_id`), nunca o telefone da
  ficha**, e `ehTelefone` falso desliga a autocorreção. Conversa do Instagram
  com ficha sem IGSID recusa; ficha só do Instagram presa a um número de
  WhatsApp ouve "só existe no Instagram".
- ⚠️ **Recusado ANTES da Meta, com a frase** (`conferirParaODirect`): modelo e
  interativa; texto acima de 1000 BYTES UTF-8 (`text_too_long`), contados
  JÁ com a assinatura; anexo com legenda (o Direct não tem legenda: o campo
  some na tela, decisão de 21/11/2026); formato fora da doc (imagem png/jpeg,
  vídeo mp4/ogg/avi/mov/webm, áudio aac/m4a/wav/mp4, documento SÓ PDF), pela
  extensão do nome ou do caminho. O compositor recusa antes de subir
  (`arquivoCabeNoDirect`, pelo MIME; imagem até 8 MB), o acervo também.
- ⚠️⚠️ **A janela é conferida no SERVIDOR**: a última mensagem da PESSOA por
  ESTA conexão (`messages.channel_id`), 24 h. Sem mensagem dela, fechada (só
  ela abre). `window_closed` (409) e o subcódigo 2534022 da Meta dão a mesma
  frase, sem bolha gravada. Leitura que falha é `window_unknown` (503) — nunca
  `db_error`, que diria "saiu e não gravou". O fio conta a mesma janela
  (`janela-24h.ts`, pelo carimbo do canal) e a dica diz que só a pessoa
  reabre (sem "use um modelo").
- ⚠️⚠️ **4xx × "não sei"** (`envioRecusado`): só a resposta 4xx é recusa
  comprovada (`instagram_rejected`); rede, 5xx e 2xx sem `message_id` são
  `instagram_error`, que a agendada conta como `entrega_incerta`
  (`CODIGOS_POS_ENTREGA`) e a bolha como `incerto`. Os dois levam a
  `tentativa` (bolha "não enviada", `classificarFalha` conhece
  `InstagramApiError`).
- ⚠️⚠️ **O eco do nosso envio pode chegar ANTES da nossa linha**: o webhook
  entrega `is_echo` com o mesmo `mid`. `persistir.ts` procura a linha e, sem
  ela, espera 2 s (`ESPERA_PELO_NOSSO_ENVIO_MS`, o `jaGravada` da Evolution)
  antes de gravar o eco como "digitado no app"; se mesmo assim chegar
  primeiro, o núcleo pega o 23505 e ASSUME a linha do eco (autor, arquivo do
  Storage, citação, `from_device` falso) pelo admin. Sem as duas pontas, a
  resposta aparecia como do celular, ou o envio virava `db_error` incerto.
- **Citar cabe** (`reply_to: { mid }`; D5 revisto em 21/11/2026 pela doc
  nova): a citada é a DM inteira (o `#n` da linha irmã de anexo extra é
  cortado), e citada apagada ou de outra conexão é recusada. Reagir segue
  fora (o botão some).
- **Nota de voz em WAV** (D5): o compositor grava pelo `waveWorker` do
  opus-recorder (`/public/opus/`) quando o canal ativo é Instagram, com teto
  de 2 min 30 s (WAV 48 kHz ≈ 5,8 MB/min contra os 16 MB de envio).
- ⚠️ **O Direct não formata** (medido no 1º envio real, 21/11/2026: o
  `*Nome:*` chegou com os asteriscos). A assinatura sai `Nome:` (estilo
  `simples` de `assinatura.ts`), no núcleo, na bolha otimista e no "Tentar de
  novo" — os três pelo canal; os botões N/I/S/</> e os atalhos de formatação
  somem na conversa do Instagram.
- **Human Agent (D2) segue sem efeito**: o interruptor existe e diz isso;
  nada lê `ig_human_agent` até a Meta aprovar a feature.
- A agendada no Direct (tela e `POST /v1/scheduled-messages`) recusa no
  AGENDAMENTO o que não cabe; a janela fica para a hora do envio.
- ⚠️ **`POST /v1/messages` continua só WhatsApp** (endereça por telefone):
  passa `soWhatsApp: true` ao núcleo, que recusa com `not_supported` a
  conversa achada pelo telefone que responde pelo Instagram (ficha que ganhou
  telefone, ou unificada). Sem isso o lembrete do integrador virava DM.
- **Limites conhecidos** (revisão do PR #539): se o eco ainda ganhar a corrida
  depois dos 2 s, a linha é assumida mas os EFEITOS do eco ficam (reabertura
  sem responsável, a bolha otimista ao lado da linha até recarregar, a cópia
  do anexo do eco órfã no bucket); nos 4 envios reais a nossa linha ganhou. A
  voz WAV a 96 kHz estoura os 16 MB antes dos 2 min 30 s. Cada eco que não é
  nosso espera 2 s no lote do webhook.

### Token e Graph API

- ⚠️ **Token só no cabeçalho `Authorization: Bearer`, nunca em
  `?access_token=`; a mensagem de erro da Meta ECOA o token e passa por
  `semSegredo`; o host é preso a `graph.instagram.com`** (`graph.ts`). O token
  do painel dura 60 dias; a validade fica em `ig_token_expires_at`.
- ⚠️ **A renovação (Fase 6) roda na manutenção do ciclo das agendadas**
  (`renovar-token.ts` em `rodarManutencaoDoCiclo`, laço de 15 min), não em
  rota nova — rota nova pede `docker stack deploy` na VPS. Renova o token com
  `ig_token_refreshed_at` de 7 dias ou mais e ainda válido; o vencimento novo
  é o `expires_in` MEDIDO e tem de passar do antigo (200 sem estender não é
  renovação); a escrita é cercada pelo carimbo lido (reconectar no meio
  ganha). Só o 190 marca `disconnected` com `last_error`; o resto tenta no
  ciclo seguinte. É a segunda exceção do `Bearer`: a doc só mostra o token na
  query do `refresh_access_token`.

### Conexão pelo login do Instagram (OAuth)

O app da Meta (Instagram App ID + App Secret) fica POR CONTA em
`cb_instagram_config` (990, fechada ao navegador; `/api/cb/instagram/app`
devolve só o App ID). O canal criado pelo login continua gravando o segredo em
`cb_channels.ig_app_secret`. O token colado é a alternativa (D3).
`src/lib/instagram/oauth.ts`; pino `oauth.test.ts`.

- ⚠️⚠️ **O `state` é ASSINADO** (HMAC de chave derivada por HKDF da
  `ENCRYPTION_KEY`, `chaveDoEstado`) com conta, membro, nonce e validade de 15
  min; o nonce repete no cookie HttpOnly `cb_ig_oauth`; o callback exige os
  dois E a sessão de admin da MESMA conta. Sem isso, um link forjado amarraria
  o Instagram de um estranho à conta (login CSRF).
- ⚠️⚠️ **`origemDoPedido` decide a URI de retorno com `NEXT_PUBLIC_SITE_URL`
  como árbitro**: host do site → URL canônica; host local/privado (preview) →
  o pedido; host PÚBLICO estranho no cabeçalho → ignorado. Sem sessão a rota
  redireciona antes de qualquer checagem, e confiar no `Host` cru viraria
  redirect para fora a partir de um `curl`.
- ⚠️ **Trocar o App Secret NÃO repropaga para os canais já conectados**: a
  assinatura deles para de casar até reconectar cada um. A tela avisa. Segredo
  em branco no token colado supõe token do app cadastrado — token de outro app
  passa no `/me` e nasce canal mudo.
- ⚠️ **`POST /me/subscribed_apps` antes de gravar o canal**: canal que não
  recebe não pode nascer calado. A permissão de mensagens é conferida na
  resposta da troca (`permissions`): dá para desmarcá-la no consentimento.
- ⚠️ **A troca do código respondeu PLANO na primeira conexão real
  (21/11/2026)**, não `{ data: [ … ] }` como a doc mostra:
  `trocarCodigoPorToken` aceita as duas formas. O `user_id` dessa resposta não
  é gravado (o canal guarda o do `/me`): como número JSON, perde dígitos acima
  de 2^53. Formato de resposta da Meta se MEDE, não se tira da doc.
- **A única exceção à regra do `Bearer`**: o token CURTO e o `client_secret`
  viajam na query da troca pelo token longo (forma documentada do endpoint; o
  token vive 1 h e nunca é gravado; nenhum log imprime a URL). `semSegredo`
  apaga `access_token=` E `client_secret=`. O vencimento gravado é o
  `expires_in` medido.
- **Reconectar uma conta SOBRESCREVE a linha** (índice único global de
  `ig_user_id`): token, segredo e validade novos; rótulo e Human Agent ficam
  (`canal.ts` só os grava quando o chamador manda). Não nasce segunda conexão;
  o diálogo do webhook só abre na primeira conexão da conta (`?primeira=1`).
- ⚠️ **App criado HOJE na Meta não tem a tela "Configuração da API com login do
  Instagram"** (medido em 21/11/2026, nem por URL direta): só o login unificado
  e o do Facebook. Todo este fluxo serve só a app antigo; texto de tela ou
  manual que mande "criar o app" leva o escritório a uma aba que não existe.
- **Preview e produção geram URIs de retorno diferentes**, e as duas precisam
  estar registradas no painel da Meta — senão o teste local morre antes do
  callback.
- **Standard Access**: só conta adicionada ao app no painel da Meta autoriza;
  `force_reauth=true` obriga o Instagram a PERGUNTAR qual conta (senão
  autorizaria a que está logada no navegador).

### Decisões do operador (10/09/2026)

- D1: robô fora do Direct na v1.
- D2: janela de 24h; `ig_human_agent` opcional, só depois da aprovação da Meta.
- D3: login do Instagram com Standard Access; token colado como alternativa.
- D4: ficha própria do Instagram; unificação com a ficha de WhatsApp é MANUAL.
- D5: o que a API não cobre — apagar-para-todos, documento que não seja PDF,
  editar, reagir, legenda — fica INACESSÍVEL na conversa Instagram; nota de
  voz cabe via WAV. Revisto em 21/11/2026: responder citando cabe (a doc nova
  aceita `reply_to`), reagir continua fora.
