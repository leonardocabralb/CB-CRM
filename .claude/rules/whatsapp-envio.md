---
paths:
  - "src/lib/whatsapp/send-message*"
  - "src/lib/whatsapp/broadcast-*"
  - "src/lib/whatsapp/conversation-scope*"
  - "src/lib/whatsapp/meta-api*"
  - "src/lib/whatsapp/meta-error-explain*"
  - "src/lib/whatsapp/template-*"
  - "src/lib/whatsapp/modelo-da-meta*"
  - "src/lib/whatsapp/resolve-conversation*"
  - "src/lib/whatsapp/interactive*"
  - "src/lib/flows/**"
  - "src/lib/automations/meta-send*"
  - "src/lib/cb-channels/engine-send*"
  - "src/lib/cb-channels/meta-admin*"
  - "src/lib/cb-channels/falha-da-meta*"
  - "src/lib/cb-channels/resolve-meta*"
  - "src/app/api/whatsapp/send/**"
  - "src/app/api/whatsapp/templates/**"
  - "src/app/api/whatsapp/config/**"
  - "src/app/api/whatsapp/broadcast/**"
  - "src/app/api/whatsapp/react/**"
  - "src/app/api/whatsapp/message/**"
  - "src/app/api/flows/**"
  - "src/app/api/v1/broadcasts/**"
  - "src/app/api/v1/messages/**"
  - "src/components/broadcasts/**"
  - "src/components/flows/**"
  - "src/components/settings/template-manager.tsx"
  - "src/hooks/use-broadcast-sending*"
  - "src/lib/broadcast-*"
  - "src/components/settings/whatsapp-config.tsx"
  - "src/lib/assinatura/**"
  - "src/components/settings/assinatura-settings.tsx"
  - "src/app/*/broadcasts/**"
  - "src/app/*/flows/**"
  - "src/components/interactive/**"
  - "src/lib/whatsapp/wa-identity*"
  - "src/lib/whatsapp/waba-pairing*"
---

# Envio pelo WhatsApp — regras

Vale ao mexer no núcleo de envio, nos modelos da Meta, no cliente da Graph API,
no robô e nos fluxos, no disparo (broadcast) e na assinatura. Reabrir conversa,
abrir negócio e carimbo de canal na ingestão estão em
`.claude/rules/ingestao.md`; qual número a conversa usa e a janela de 24h, em
`.claude/rules/canal-na-conversa.md`. O texto antigo, com a história, está em
`git show f5879b3f:CLAUDE.md`.

### Núcleo de envio (`send-message.ts`)

- Resolve o canal, carimba `channel_id`, devolve `channelId` e busca o modelo
  FILTRANDO por canal. Com `channelId` explícito (agendada) ele exige aquele
  canal e **falha fechado**: o degradar silencioso para o padrão da conta
  mandaria pelo número errado. `pauseFlows` é o outro parâmetro da agendada.
- ⚠️ **`evolution_rejected` (4xx: a Evolution recusou, nada saiu) ×
  `evolution_error` (tempo esgotado/5xx: pode ter saído).** Só o segundo vira
  `entrega_incerta`. Juntar os dois esconde o "tentar de novo" de quem não
  recebeu ou manda em dobro a quem recebeu.
- `media_filename` vai no INSERT: sem ele a bolha do que NÓS enviamos cai no
  rótulo genérico.
- A rota `/api/whatsapp/send` devolve `channel_id`, e a mensagem otimista nasce
  carimbada com o canal da tela. Um 5º caminho de envio repete os dois
  (`.claude/rules/canal-na-conversa.md`).
- ⚠️ **Apagar mensagem aqui é apagar MOLE** (`deleted_at`): o núcleo citaria o
  que o cliente vê como "Esta mensagem foi apagada". Quem enviar citação em
  código novo confere `deleted_at` — `send-message.ts` não confere.
- ⚠️ **`sendMessageToConversation` é o caminho de GENTE** (compositor, ficha,
  agendada, API v1): é nele que mora o gancho que abre negócio e reabre a
  conversa, via `supabaseAdmin()`. Broadcast e robô NÃO passam por ele, e é
  assim que ficam de fora sem linha de guarda — "reusar o núcleo no broadcast"
  parece limpeza e traz o roteador de funil junto (500 cards de uma vez). Pino
  default-deny `pipeline-routing.chamadores.test.ts`.
- Instagram falha FECHADO no envio: `not_supported` no núcleo,
  `exigirWhatsApp` nos senders do robô (robô não responde no Direct).
  `POST /api/v1/messages` confere `ehWhatsApp` ANTES de criar contato e de
  fixar o canal — `pinConversationChannel` confere só a POSSE, e a conta do
  Instagram fixada prendia a conversa do telefone. Pino
  `src/app/api/v1/messages/route.test.ts`. As rotas internas que fixam
  (`/api/whatsapp/send`) dependem da tela oferecer só o que serve.
- Telefone que chega pela API v1 (mensagens, disparo) e por
  `resolve-conversation.ts` passa por `telefoneDigitado` (sem DDI ganha o 55;
  JID colado é recusado), com a frase `mensagemDoTelefoneDaApi` no 400. ⚠️
  `ContactInput.phone` é o texto CRU: o disparo manda `to`, nunca os dígitos
  já lidos ("+41 55 555 12 12" relido sem o `+` ganharia o 55). Custo escrito
  na doc pública: estrangeiro sem `+` com 10–11 dígitos é lido como
  brasileiro.

### O destino: telefone ou BSUID (Fase 11.3)

A Meta manda só o BSUID (`wa_user_id`) de quem adotou nome de usuário, e a
ficha dessa pessoa não tem telefone. A Cloud API a alcança pelo campo
`recipient` (`recipientFields` de `meta-api.ts` decide pelo FORMATO do alvo).

- ⚠️⚠️ **O destino sai de `alvoDeEnvio` (`alvo-de-envio.ts`; no robô,
  `alvoDoRobo`), decidido DEPOIS do canal e das recusas dele**: telefone válido
  vale em qualquer transporte; o BSUID, SÓ com `ehMeta`. Pela Evolution as
  letras sumiriam e a mensagem iria ao número formado pelos dígitos do BSUID.
  `resolveContactSendTarget` (do original, ignora o transporte) só é chamado
  ali. Segunda trava: `toEvolutionNumber` LANÇA com BSUID. Pino
  `alvo-de-envio.chamadores.test.ts` (default-deny dos remetentes).
- ⚠️ **Variantes do nono dígito e a autocorreção do 131030 só com
  `ehTelefone`**: sem a guarda, o envio ao BSUID gravaria o BSUID em
  `contacts.phone`. Nos três remetentes (núcleo e os dois `meta-send.ts`).
- ⚠️ **A recusa vem ANTES do efeito**: `/api/whatsapp/send` confere antes de
  `pinConversationChannel` (senão a conversa ficava presa num número que não
  alcança o cliente); `/api/cb/scheduled` e `POST /v1/scheduled-messages`
  dão 409 no AGENDAMENTO. `not_supported` fica fora de `CODIGOS_POS_ENTREGA`:
  nada saiu, reenviar é seguro.
- ⚠️ **Modelo de AUTENTICAÇÃO (código de acesso) não vai a BSUID** — a
  documentação da Meta sobre BSUID o exclui (`modeloExigeTelefone`, no núcleo
  e em `sendViaMeta`): recusado antes da Meta, com a frase. Sem linha local a
  categoria é desconhecida, e a Meta decide.
- A reação pela Evolution usa só a CHAVE da mensagem (o telefone da ficha
  nunca foi usado ali); pela Meta, o alvo.
- Continuam só com telefone: disparo em massa, a régua do Asaas (a varredura
  pula ficha sem telefone), `send_to_number`, "nova conversa" e
  `POST /v1/messages`.

### Conversa do contexto (`conversation-scope.ts`)

- ⚠️⚠️ **A conversa do contexto é conferida por CONTA E por CONTATO**
  (`assertConversationInAccount`, ANTES do canal e do provedor) no disparo, em
  `resolveConversationId` e em cada envio do robô; as prévias levam
  `.eq('account_id')`. Só a conta deixava passar "contato A + conversa de B",
  e o cliente A recebia o que aparece no fio de B. DIVERGE do original (#589):
  num merge, fica o nosso. Remetente NOVO do robô repete a conferência — pino
  `src/lib/whatsapp/conversation-scope.chamadores.test.ts`.

### Robô e fluxos

- ⚠️ **Há DOIS `meta-send.ts`, e os DOIS enviam**: `src/lib/flows/meta-send.ts`
  (fluxo, resposta de IA, mídia de automação, botões e lista) e `sendViaMeta`
  em `src/lib/automations/meta-send.ts` (`send_message`, `send_template`,
  `send_to_number` e a régua do Asaas). Só botão e lista da automação delegam
  aos fluxos. Uma versão desta nota chamava o segundo de "só um wrapper", e o
  pino da régua lia o arquivo errado. Guarda nova de envio vai nos DOIS.
- ⚠️⚠️ **O sender do robô propaga o erro do transporte CRU**
  (`EvolutionApiError`, com `.status`): a retentativa das automações decide
  por ele entre "recusou, nada saiu" (4xx, repete) e "pode ter saído" (5xx,
  nunca repete). Embrulhar em `new Error(msg)` desliga a retentativa em
  silêncio (`retentativa.ts` só reconhece a classe). Regra em
  `.claude/rules/automacoes.md` ("retentativa").
- ⚠️ **O contrato de falha é o NOSSO** (`send_interactive_failed`; a
  re-pergunta que falha ENCERRA o run): libera o contato na hora e deixa a
  falha visível, ao preço de perder o fluxo num erro transitório. O do
  original mantém o run vivo até `max_reprompts`. Num merge fica o nosso —
  pino `engine-channel.test.ts`.
- `{{vars}}` só nos textos VISÍVEIS (`camposDosBotoes`/`camposDaLista`), NUNCA
  no `reply_id` — é ele que casa a resposta do cliente. Botões, lista e a
  pergunta do `collect_input` saem pelo canal do NÓ (senão o do run), nunca
  pelo canal atual da conversa.
- `findEntryFlow` por canal; `flow_runs.channel_id`; try/catch nos nós
  interativos. O `substituicao` de `startFlowForContact` carimba a run
  substituída como gente (`stopped_by_agent`/`replaced_by_agent`), não como
  regra.

### Modelos da Meta

- ⚠️⚠️ **`resolveTemplateRow` (`template-body.ts`) tem o 5º parâmetro NOSSO,
  `channelId`, e os 5 call sites o passam.** O catálogo da Meta é POR WABA: sem
  o recorte, numa conta com dois números o atendente vê o preview de um modelo
  e o cliente recebe outro. Conferir os 5 a cada merge.
- ⚠️⚠️ **`message_templates` tem índices PARCIAIS (903)**: `.upsert(…,
  { onConflict })` não funciona (42P10) — lookup + insert/update. E
  `.maybeSingle()` só com recorte de canal (`.is('channel_id', null)` para o
  padrão), senão estoura com modelo homônimo em outra WABA.
- ⚠️ **Submit** (`templates/submit/route.ts`): busca o modelo local pela CONTA
  (nome + idioma + canal igual ou nulo, preferindo o do canal e o vinculado)
  ANTES de chamar a Meta; erro de busca é 500 sem chamar a Meta. Recusa da
  Meta com linha VINCULADA (`meta_template_id`) não grava nada. O rascunho da
  recusa é regravado com a cerca `.is('meta_template_id', null)` NO UPDATE
  (outra aba pode ter vinculado no meio); zero linhas ou 23505 = busca de novo.
  `modelo_ja_existe` só com linha vinculada E recusa 4xx que não é limite,
  nunca 5xx/rede/tempo. O UPDATE nunca leva `user_id`. O upstream faz o
  `.upsert` com `onConflict` — num merge cru, toda criação aceita pela Meta
  volta 500. Pino `submit/route.test.ts`.
- ⚠️⚠️ **O stub do modelo criado direto no painel da Meta
  (`template-webhook.ts`) nasce COMPLETO, com canal e DONO.** A conexão sai de
  `cb_channels.waba_id` (`kind='meta'`, exatamente UMA; duas viram só log),
  nunca de `whatsapp_config`; `channel_id` da conexão (linha sem canal valeria
  para todo número); `user_id` = dono da conta (CASCADE de `auth.users`). O
  corpo vem de `lerModeloNaMeta` + `conteudoDoModeloDaMeta`, a MESMA conversão
  da sincronização: com `body_text: ''`, `buildSendComponents` contava zero
  variáveis e descartava os parâmetros, e o envio passava a ser recusado.
  Leitura que falha = nenhum stub. Não nasce com linha de mesmo nome e idioma
  no canal OU sem canal, nem para evento de SAÍDA (`PENDING_DELETION`,
  `DELETED`, `ARCHIVED` — ressuscitaria o modelo apagado). A rota passa
  `wabaId: entry.id`. Pino `template-webhook.test.ts`.
- A amostra do cabeçalho de mídia (`template-header-handle.ts`) é lida por
  `lerComTeto`, com `content-length` conferido antes: a URL é colada pelo admin
  e o corpo inteiro na memória deixava o processo derrubável. Pino
  `template-header-handle.test.ts`.
- Catálogo de modelos (`template-manager.tsx`): leitura SEM
  `.eq('user_id', …)` e escrita só para admin (`useCan('edit-settings')`). O
  upstream filtra pelo autor e devolve o catálogo vazio a todo membro que não o
  criou. Pino `src/components/settings/catalogo-da-conta.test.ts`.
- Broadcast e rotas de modelo resolvem a conexão por `resolveMetaChannel`,
  nunca pelo espelho `whatsapp_config`.

### Graph API e configuração da conexão

- ⚠️ **O WABA ID é OBRIGATÓRIO na conexão Meta** (`POST /api/cb/channels` e o
  formulário, 25/09/2026): é a WABA que `provisionMetaChannel` assina ao app,
  e sem ela a conexão nascia `connected` sem a Meta entregar nada. O teste
  que fixava "WABA em branco continua opcional" virou o contrário
  (`route.meta.test.ts`). Revisão do PR #285.
- ⚠️ `listWabaPhoneNumbers` só segue `paging.next` dentro de
  `https://graph.facebook.com` (`isGraphUrl`: o cursor vem da RESPOSTA e o
  token vai no cabeçalho) e LANÇA quando o teto de páginas acaba com página
  sobrando — meia lista seria lida como "o número não mora nesta WABA". Pino
  `meta-api.waba-numbers.test.ts`.
- Token no cabeçalho, nunca `?access_token=` (no upload resumable,
  `Authorization: OAuth`; pino `meta-api.resumable.test.ts`). A mensagem da
  Meta ECOA o token: passa por `semTokenDaMeta` antes de ir para tela ou log.
- `meta-error-explain.ts`: todo ramo tem `motivo` (`MOTIVOS_DO_ERRO_DA_META`),
  que a tela traduz (`Settings.channels.metaErro.<motivo>`) — o `summary` do
  original é inglês. Ramo novo sem motivo não compila; pinos
  `meta-error-explain.test.ts` e `falha-da-meta.test.ts` (a frase nos dois
  dicionários). "nonexisting field" no código 100 = WABA ID trocado.
- ⚠️⚠️ **O POST de `/api/whatsapp/config` está APOSENTADO** (410, aponta para
  `POST /api/cb/channels`): consertado, gravaria a credencial da Meta por cima
  do espelho de uma conta Evolution, sem criar conexão. A tela
  `whatsapp-config.tsx` não é montada. GET e DELETE ficam; o GET passa a
  mensagem da Meta por `semTokenDaMeta`.
- **Guarda de papel**: o `requireRole` do upstream nas 5 rotas que ambos
  cobrimos (`send`, `react`, `broadcast`, `templates/submit`,
  `templates/sync`); o nosso `barrarPorPapel` nas 2 que só nós cobrimos
  (`whatsapp/config`, `whatsapp/templates/[id]`) — sem ele um `viewer`
  reconfigura a conexão. Um merge que traga essas duas cruas, ou o POST do
  config de volta, reprova `guarda-de-papel-so-nossa.test.ts`.

### Disparo (broadcast)

- ⚠️⚠️ **A CONTAGEM do público nos passos 2 e 4 é `contarPublico`, a MESMA
  resolução do envio** (`contatosDaBase` + `aplicarRecortes`; no CSV,
  `pessoasDoCsv` + `fichasDoCsvNaBase`). Contar por outra via mostrava 1.000
  contatos onde havia milhares e ignorava a exclusão. "Todos os contatos" é
  lido POR CHAVE (`buscarPorChave`): por OFFSET, ficha criada no meio da
  leitura repetia um destinatário, e o modelo pago chegava em dobro. Pinos
  `use-broadcast-sending.contagem.test.ts` e `.paginacao.test.ts`.
- ⚠️⚠️ **`create_broadcast_with_recipients` tem UMA assinatura: NOVE
  parâmetros, `p_template_params JSONB`** (lista de listas) e RETURNING
  qualificado (1030). Com `JSONB[]`, o `json_to_record` do PostgREST fazia um
  array de duas dimensões e espalhava os parâmetros entre os contatos. A forma
  de OITO (a `041` do upstream) é APAGADA, não renumerada. O
  `supabase/ci/verify-schema.sql` confere a nossa e as policies de escrita de
  disparo e regras (964), numa instrução só; o do upstream confere a de oito
  por `::regprocedure`, que estoura no replay e trava o deploy. Pino
  `supabase/migrations/funcao-de-disparo-1030.test.ts`.
- ⚠️ **`POST /api/v1/broadcasts` leva o `channel_id` do corpo até
  `createBroadcast`**: a rota do upstream o descarta, e a doc pública e o
  `send_broadcast` do `mcp-server` prometem que ele vale. O núcleo falha
  FECHADO (canal inválido = 400 `meta_channel_required`, nada enviado). Pino
  `src/app/api/v1/broadcasts/route.test.ts`.
- Canal escolhido no passo 1; `channel_id` no corpo da API e na linha de
  `broadcasts`. `marcarDestinatario` confere o update pelo retorno.
- ⚠️⚠️ **Disparo pela tela: quem grava o envio na linha é a ROTA do lote, na
  hora** (`anotarEnvio` em `api/whatsapp/broadcast`, com o `recipient_id` que
  o hook manda; revisão do PR #277). O wamid chegava só quando o lote de 10
  voltava ao navegador, e o recibo da Meta que viesse antes se perdia. Por
  isso o navegador (`gravarDesfechoDoLote`) NÃO regrava o que a rota anotou e
  só mexe em linha `pending`: a linha já pode estar `delivered` pelo recibo,
  e o `failed` de um lote que caiu no meio apagaria envios que aconteceram. O
  que não gravou é conferido numa leitura só — continua `pending` = escrita
  perdida (RLS), já andou = outro escritor. Pinos `route.anotar.test.ts` e
  `use-broadcast-sending.lote.test.ts`.
- ⚠️ **CSV do disparo (`upsertCsvContacts`)**: deduplica e casa por PESSOA
  (`chaveDePessoa`), busca as duas grafias do nono dígito em FATIAS e, na
  corrida, relê e insere um a um — casar por grafia, com o índice canônico
  (1024), mata a campanha inteira no 23505. A ficha criada grava
  `user_id: ownerUserId` com falha fechada (`if (!ownerUserId) throw`), nunca
  `user.id` (`contacts.user_id` CASCADEia de `auth.users`); o upstream grava
  `user.id`. Pino `src/hooks/use-broadcast-sending.dono-do-csv.test.ts`.

### Assinatura

- O teto da legenda é 1024 MENOS a assinatura, e o núcleo revalida no envio: a
  assinatura pode ser ligada depois de agendar, e quem sai da conta passa a
  assinar o nome do escritório. O "Assinar como" da automação
  (`assinatura_personalizada`) entra por `nomePersonalizadoParaAssinar`, sob o
  interruptor `assinatura_ativa` da conta.
