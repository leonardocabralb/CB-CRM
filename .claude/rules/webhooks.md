---
paths:
  - "src/lib/webhooks/**"
  - "src/lib/webhooks-de-entrada/**"
  - "src/app/api/cb/entrada/**"
  - "src/app/api/cb/webhooks/**"
  - "src/app/api/cb/webhooks-de-saida/**"
  - "src/app/api/v1/webhooks/**"
  - "src/components/settings/webhooks-panel.tsx"
  - "src/components/settings/trecho-da-resposta*"
  - "src/components/automations/webhook-trigger-config.tsx"
  - "src/lib/automations/drain-events*"
  - "docs/webhooks.md"
---

# Webhooks — regras

Vale ao mexer nos webhooks de ENTRADA (a porta `/api/cb/entrada/[token]`,
`src/lib/webhooks-de-entrada/`, o gatilho `webhook_received`), nos de SAÍDA
(`src/lib/webhooks/`, `webhook_endpoints`, os eventos `deal.*`), na seção
Configurações → Webhooks e no dreno da fila do funil (`drain-events.ts`). A API
v1 está em `.claude/rules/api-v1.md`; o motor, em
`.claude/rules/automacoes.md`. Doc do operador: `docs/webhooks.md`; plano e
configuração do escritório: `docs/PLANO-webhooks-de-entrada.md`.

### Webhooks de entrada (982)

`src/lib/webhooks-de-entrada/` (`achatar.ts` e o `resultadoDoDisparo`/
`escutamEsteWebhook` de `processar.ts` são puros; `claim.ts` e `repo.ts` fazem
I/O), a porta, o admin em `/api/cb/webhooks*` e a seção de Configurações.

- ⚠️⚠️ **A porta é `/api/cb/entrada/[token]`, NÃO `/api/cb/webhooks/[token]`.**
  O Next recusa dois nomes de segmento dinâmico na mesma posição, e
  `/api/cb/webhooks/[id]` é o admin. "Arrumar" a URL para ficar simétrica
  quebra o build.
- ⚠️⚠️ **O token na URL é ENDEREÇO; o segredo do cabeçalho é a CREDENCIAL.**
  Typebot e n8n não assinam, e URL vaza em log de proxy e captura de tela. O
  CHECK `cb_webhooks_credencial_ck` só admite linha COM segredo ou
  declaradamente aberta (`sem_segredo`), nunca aberta por esquecimento.
- ⚠️⚠️ **O achatamento (`achatar.ts`) é o contrato do `interpolate` do motor.**
  A chave é casada por `[\w.]` e o motor lê UM nível: acento, hífen e
  aninhamento deixam o `{{vars.x}}` literal ou vazio no texto que sai ao
  cliente, sem erro. Daí `observação`→`observacao`,
  `pedido.total`→`pedido_total`, lista →`_0`/`_1`.
- ⚠️⚠️ **O sublinhado inicial é PODADO: é a defesa das chaves reservadas**
  (`_cadeia`, a guarda anti-ciclo, e `_tag_chain_depth` vivem em `vars`).
  Payload de fora que as sobrescrevesse furaria as duas. Há teste cobrando que
  nenhuma chave produzida comece com `_`.
- ⚠️⚠️ **O telefone passa pela régua das TELAS (`telefoneDigitado`)**, não pela
  dos sistemas (decisão do operador, 23/09/2026: o formulário não é nosso para
  mudar). Com `digitosDoTelefone`, "98874-5316" sem DDD virava a ficha +98. O
  recusado vira `sem_telefone` com o motivo (`detalheDoTelefone`); "veio e não
  serve" conta no Meu dia, numa janela de 7 dias. A coluna `telefone` é
  gravada por `comAlgoVisivel` (em branco = nulo). Pino:
  `src/lib/contacts/telefone-digitado.chamadores.test.ts`.
- ⚠️⚠️ **A consulta de automações vem ANTES de criar a ficha**: ninguém
  escutando = `sem_automacao`, sem materializar nada. Invertido, a tela de
  Contatos enche de lead de teste.
- ⚠️ **`id_externo` é NOT NULL com DEFAULT aleatório, e o DEFAULT é
  load-bearing**: mantém o `UNIQUE (webhook_id, id_externo)` TOTAL, e só
  índice total serve de alvo do `ON CONFLICT`. Com `campo_id` configurado, a
  reentrega é descartada antes de disparar automação.
- ⚠️ **O cadeado é GÊMEO de `src/lib/calendly/claim.ts`**, de propósito NÃO
  fatorado: um helper genérico esconderia as cercas que precisam ser lidas.
  Mudou a mecânica de um, confira o outro.
- ⚠️ **A conversa criada nasce com `channel_id` NULO**, e `channelInScope`
  deixa passar canal nulo: automação restrita a uma conexão ainda dispara para
  lead novo. Apertar a regra desliga o webhook para quem acabou de chegar.
- ⚠️ **E nasce ENCERRADA** (decisão do operador, 21/09/2026):
  `resolverDestinatario(..., { conversaNovaEncerrada: true })`, só deste
  chamador. Lead de formulário ainda não escreveu; a primeira mensagem dele
  ou da equipe a reabre (`reopen.ts`). Conversa que já existia não é tocada.
  ⚠️ Não trocar por um passo "Encerrar conversa": ele fecha TODAS as
  conversas do contato e solta o responsável.
- ⚠️ **Lead novo não tem card, e `move_deal_stage` LANÇA**: automação de
  webhook que mexe no funil precisa de `create_deal` ANTES.
- **`variaveis` guarda o ACHATADO, não o corpo cru**: a pergunta do operador é
  "por que `{{vars.nome}}` saiu vazio"; o cru seria uma segunda cópia de dado
  de cliente.
- ⚠️ **A seção está em `SECOES_SO_DE_ADMIN`**: marcá-la `admin` em
  `ESCRITA_DA_SECAO` não bastaria (`podeVerSecao` é fail-open para membro sem
  perfil), e as rotas são todas `requireRole("admin")` — a seção apareceria
  quebrada. `editor.test.ts` deriva a lista, nunca a crava.
- **Apagar o webhook leva o LOG junto** (CASCADE): a pergunta mostra o número
  de registros.

### Formulário público (Typebot e afins)

- ⚠️⚠️ **Formulário PÚBLICO não prova posse do telefone**: qualquer um aciona as
  automações sobre a ficha do número digitado. Toda escrita (etiqueta, e-mail,
  respostas, campanha) e todo movimento vivem no ramo SIM de uma CONDIÇÃO de
  etapa (ex.: `deal_stage == Lead - Type e Forms`). Sem a trava, o formulário
  reescreve o e-mail de quem já é cliente — e o e-mail é o que liga tl;dv e
  Asaas. O card PERDIDO é alcançado de propósito, menos o de contato com card
  GANHO.
- ⚠️ **Condição, nunca escopo de etapa (`automations.stage_ids`)**: o escopo
  falha ABERTO em erro de leitura (o `move_deal_stage` arrastaria o card de um
  cliente do Jurídico) e, fora dele, o acionamento vira `sem_automacao`, que o
  Meu dia conta para sempre. A condição falha FECHADO e termina `barrada`.
- ⚠️ **Nenhuma automação de formulário grava o NOME**: o passo de nome grava
  FIXADO e o gatilho do título retitularia o card aberto. O lead novo nasce com
  o nome digitado (`campo_nome`); quem fixa é o Calendly.
- ⚠️ **O Typebot NUNCA repete POST** (401, 404, 429, timeout = perdido), e o CRM
  não registra 401/404/429 (voltam antes do INSERT do log): o ponto que "não
  chegou" só aparece nos logs do Typebot. Pergunta não respondida chega vazia,
  e `update_contact_field` vazio não grava.

### Webhooks de saída: a aba Enviados e o teste

- **A aba "Enviados" é a tela dos `webhook_endpoints` (028).** As rotas de
  sessão são `/api/cb/webhooks-de-saida*`, separadas das da v1: reusar aquelas
  faria a tela carregar uma chave de API para falar com o próprio CRM. A tela
  DECLARA as limitações (uma tentativa de 5 s por entrega; 15 falhas seguidas
  desligam o endpoint).
- ⚠️⚠️ **`record_webhook_failure` é fechada (1037)**: era SECURITY DEFINER com
  EXECUTE para PUBLIC/`anon`/`authenticated`, e o id do endpoint viaja no
  cabeçalho `X-Wacrm-Webhook-Id` de TODA entrega — quinze chamadas anônimas
  desligavam o endpoint do escritório.
- ⚠️ **"Enviar teste" NÃO mexe no contador de falhas**, manda dados fictícios
  com `"test": true` assinados pelo MESMO `pedidoDeEntrega` e posta na URL
  CADASTRADA (não alimenta o "Listen for test event" do n8n).
- ⚠️ **Toda entrega, real e teste, passa pela guarda de `ssrf.ts`** antes de
  postar (a do original, por octetos, com o IPv6 mapeado). Não divergir dela.
- ⚠️⚠️ **O teste LÊ o começo do corpo** (até `TETO_DO_TRECHO` = 2 KB, só
  `content-type` textual; `resultado-do-teste.ts`): no 404 do n8n é o corpo
  que diz o motivo. Com isso, um DNS rebinding que vença `ssrf.ts` lê 2 KB de
  um serviço interno (só admin, só POST) — aceito com o teto. Subir o teto ou
  tirar o filtro de `content-type` reabre a conta. Quem decide o resultado é o
  STATUS: corpo lento ou quebrado num 2xx é "entregue".
- ⚠️ **`webhooks:manage` entrega contato completo** (telefone, e-mail,
  etiquetas, campos) e negócio sem `contacts:read`/`deals:read`: assinar =
  receber o fluxo da conta, e a descrição do escopo diz isso.

### O contrato dos eventos (`deliver.ts`, `events.ts`)

- ⚠️⚠️ **`dados-dos-eventos.ts` é o contrato, cobrado pelo compilador nas três
  pontas**: `dispatchWebhookEvent` é GENÉRICO sobre ele (5º parâmetro `opcoes`
  com `id`/`occurredAt`), `exemplos.ts` é tipado por ele, e a aba Documentação
  mostra esses exemplos. Evento novo sem entrada no mapa não compila
  (`CoberturaDosEventos`). O `deliver.ts` cru do upstream devolve
  `data: unknown`.
- ⚠️ **`dispatchWebhookEvent` devolve `ResultadoDoDisparo`**
  (`tentado` | `sem_destino` | `falhou_antes`): a fila do funil só dá o aviso
  por encerrado quando a tentativa aconteceu. Cru, volta a `Promise<void>`, e
  a leitura de endpoints que falha parece "sem destino". Os `CABECALHO_*` e
  `pedidoDeEntrega` também são nossos.
- ⚠️⚠️ **`conversation.created` quer dizer SÓ "o cliente abriu a conversa"**
  (decisão do operador, 23/09/2026): sai nos três caminhos de ENTRADA (webhook
  da Meta, `persistInboundMessage`, a DM do Instagram); o eco do Instagram e a
  DM apagada não emitem (pino: `src/lib/instagram/persistir.aviso.test.ts`).
  Conversa criada por qualquer outro caminho não emite, nem depois. Emitir num
  caminho novo muda o contrato publicado: `events.ts`, os dois dicionários
  (`catalogoDeEventos.conversationCreated`), `docs/public-api.md` e
  `docs/webhooks.md`.

### Webhooks de saída de negócio (`deal.*`)

`deal.created`, `deal.stage_changed`, `deal.status_changed`.
`src/lib/webhooks/eventos-de-funil.ts` (puro), `entregar-eventos-de-funil.ts`
e `reentregar-eventos-de-funil.ts` (E/S), a coleta em `drain-events.ts`.

- ⚠️⚠️ **O dreno de `cb_automation_events` é o ÚNICO ponto de disparo.** São
  seis escritores de etapa, metade no navegador; a fila é enchida por gatilho
  para todos. A linha é coletada logo depois da reivindicação e do
  cancelamento de esperas, ANTES das guardas de ciclo, de atraso e de "sem
  contato": evento atrasado mais de 1 h SAI, com a hora real (decisão do
  operador). Pino: `entregar-eventos-de-funil.chamadores.test.ts`. A carga da
  Kommo desliga os gatilhos de `deals`, então o delta não avisa; apagar
  negócio não gera evento.
- ⚠️⚠️ **A entrega vai por `after()`, fora do caminho crítico** (com queda para
  `await` fora de requisição, onde `after` lança). Com `await`, o cron
  esperava as entregas antes dos lembretes e das retomadas de "Aguardar". No
  SIGTERM, o Next espera os `after()` só até o `stop_grace_period` do Swarm
  (10 s).
- ⚠️⚠️ **O aviso é DURÁVEL (1040): sai PELO MENOS UMA VEZ, com o mesmo id.** A
  reivindicação grava `webhooks_pendente_desde` na MESMA escrita de
  `processado_em` (um carimbo por ciclo); a entrega o limpa, com a cerca
  `= carimbo`, quando a tentativa ACONTECEU (sucesso, falha HTTP ou ninguém
  assina). Leitura que falha, `falhou_antes` ou processo morto deixam a linha
  pendente, e o CRON (nunca o aviso imediato) reentrega depois de 10 min por
  compare-and-swap no carimbo, até `TETO_DE_REENTREGAS` (5, em
  `webhooks_tentativas`; `tentativas`/`erro` são do motor). No teto a linha
  fica marcada, como registro; a poda poupa o pendente abaixo do teto. Sem
  backfill: o NULL do acervo é o que impede reenviar 30 dias. O preço é a
  repetição — a doc manda deduplicar pelo `id`.
- ⚠️⚠️ **A entrega RENOVA a posse (compare-and-swap no carimbo) antes do
  catálogo e dos disparos de CADA conta**, e limpa com o carimbo renovado: o
  laço do dreno passa dos 10 min do prazo, e sem renovar a reentrega de outro
  pedido tomaria a linha em curso (aviso em dobro sem ninguém ter morrido).
  Pinos: `entregar-eventos-de-funil.chamadores.test.ts`,
  `supabase/migrations/origem-e-aviso-duravel-1040.test.ts`.
- ⚠️⚠️ **Ordem de deploy: a migration ANTES do app.** Sem a coluna, o PostgREST
  recusa o UPDATE da reivindicação e NENHUMA automação de funil dispara.
- ⚠️⚠️ **O INSERT do card é `deal.created`** (`eventoDaLinha`): ele entra na
  fila como `deal_stage_changed` sem "de onde". Assinar só `stage_changed`
  perde quase tudo. Card CRIADO já em etapa de ganho/perdido gera SÓ
  `deal.created` (o gatilho de resultado é BEFORE e a fila grava uma linha).
- ⚠️ **`stage` é a etapa DESTE evento; `deal` é lido NA HORA DA ENTREGA** e pode
  já ter andado. Catálogo que falha não entrega nada (a linha fica pendente):
  nulo, para quem recebe, quer dizer "apagado".
- ⚠️ **O `id` do envelope é o id da linha da fila** (= `data.event_id`), e
  `occurred_at` é o `criado_em` do fato. Nos eventos de mensagem continua um
  uuid por envio.
- ⚠️ **`channel_id` é a conexão da conversa NO MOMENTO do movimento**, nulo
  para lead de formulário/Calendly que ainda não escreveu.
- ⚠️⚠️ **`source`: `user`, `channel`, `automation`, `api`, `system`.** O gatilho
  decide NESTA ordem: `auth.uid()` → `cb.cadeia` (a RPC das automações a
  carimba sempre) → `source` do INSERT → cabeçalho `x-cb-origem: api` → resto.
  Cadeia antes do cabeçalho: o que uma automação faz é `automation` mesmo
  dentro de um pedido da API. O cabeçalho vem do `clienteDaApi` das rotas v1
  e chega pela GUC `request.headers`, lida num bloco com EXCEPTION (um
  `::jsonb` malformado fora dele derrubaria toda escrita em `deals`). Rota v1
  que escreva por `supabaseAdmin()` sai `system` (há pino).
- ⚠️⚠️ **A marca `api` é RÓTULO, não credencial, e a queda é silenciosa**: se o
  cabeçalho deixar de chegar (troca de gateway, cliente sem
  `global.headers`), o movimento pela API volta a `system` sem erro, e a
  receita `source != api` deixa de cortar o laço do fluxo que reage movendo o
  card pela API. Quem mexer no cliente da API mede de novo contra o PostgREST
  real (mover o card do lead de teste e conferir `origem = 'api'` em
  `cb_automation_events`). Mesmo com a marca, o filtro não corta laço que
  ATRAVESSA uma automação do CRM (a escrita pela API grava `cadeia` vazia); a
  doc diz isso ao integrador.
- ⚠️ **A marca `api` existe só na fila do funil** (`cb_automation_events.origem`).
  A trilha da 912 (`cb_lead_events`) continua gravando API e automação juntas
  como `origin = 'sistema'`: quem precisar separar as duas lê a fila, nunca a
  trilha (ficou de fora de propósito).
