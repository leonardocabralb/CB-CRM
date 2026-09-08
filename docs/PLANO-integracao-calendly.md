# Plano — Calendly → automação "Reunião agendada" (vivo e checável)

> **O que é este arquivo.** Guia retomável da integração com o Calendly,
> pedida pelo operador em 2026-09-07: toda vez que alguém marcar um horário
> num evento do Calendly (inicialmente "Reunião com Advogado - Kommo"), o CRM
> acha o cliente pelo telefone, atualiza o nome, preenche "Data e Hora
> Reunião" e "Link Reunião", move o card para "Reunião Agendada" e avisa o
> número 83 98874-5316 pela conexão "Bancário - Comercial". **Ele é editado a
> cada fase** — quem pegar o plano depois sabe o que foi feito e onde parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco).

- **Criado:** 2026-09-07 · **Medido contra:** `main` @ `bdb4d99`, produção
  `hxnhakmyxyhalbsktzwe` (queries de leitura em 07/09).
- **Fluxo:** executar → typecheck/lint/test (Node 22) / i18n-parity /
  i18n-chaves-usadas → preview em 1440×900 → revisar 2× → PR → migration
  aplicada em produção via conector ANTES do merge, com autorização do
  operador (convenção das 972–976).

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Integração (cartão em Integrações + webhook), gatilho `calendly_booking`, passo `send_to_number` | ✅ **código pronto** (2026-09-07) — aguarda: migration em produção, merge/deploy | `977_cb_calendly` (**não aplicada** — aguarda autorização) | — |
| **2** | Depois do deploy: operador conecta o Calendly (token); a automação "Calendly → Reunião agendada" é criada (seção 3.5), o evento é escolhido no gatilho e ela é ATIVADA | ⏳ depende do operador | — | — |

**Decisões travadas pelo pedido (07/09):**

- O fluxo é montado **com as ferramentas de automação do CRM** (gatilho +
  passos no mesmo editor das automações), não como módulo fechado. Cada
  passo do pedido vira um passo da automação, editável pelo operador.
- A integração mora em **Configurações → Integrações**, ao lado do Meta Ads,
  seguindo o mesmo padrão (token cifrado, tela nunca vê o token).
- O evento do Calendly é **configurável** (o pedido diz que "poderá ser
  mudado dentro das configurações"): é a config do gatilho, com "qualquer
  evento" como padrão.

**Decisões com recomendação (o plano segue com a recomendação como hipótese
até o operador dizer o contrário):**

| # | Decisão | Recomendação | Por quê |
| --- | --- | --- | --- |
| **D1** | De onde sai o **telefone** do cliente no Calendly | `text_reminder_number` (lembrete por SMS) se vier; senão a pergunta do formulário configurada no cartão ("Pergunta do telefone", ex.: `WhatsApp`); senão a primeira resposta que parece telefone (10–13 dígitos) | o payload não tem campo "telefone": ele existe só se o evento pede; a régua fica visível e ajustável no cartão |
| **D2** | Agendamento cujo telefone **não está no CRM** | registrar no cartão como "sem contato" e **não criar** contato/conversa/card | o pedido diz "quando encontrado"; criar ficha a partir de um número digitado num formulário (sem WhatsApp confirmado) é o mesmo risco do "abrir conversa" que o operador recusou para o card automático |
| **D3** | **Escopo** da assinatura do webhook no Calendly | `organization` (todos os eventos da organização), com queda para `user` quando o token não é de admin | o evento pode ser de outro advogado; o token de admin enxerga todos |
| **D4** | Onde fica a escolha do **evento** | na config do **gatilho** (select alimentado pela API do Calendly; vazio = qualquer evento) | permite mais de uma automação por evento no futuro sem mexer na integração |
| **D5** | ⚠️ **O nome vindo do Calendly é sobrescrito pela próxima mensagem do cliente no WhatsApp** | aceitar e avisar; NÃO mudar a ingestão neste PR | `inbound-store.ts:95-100`, o webhook da Meta e a API v1 gravam o `pushName` do WhatsApp sempre que ele difere do nome salvo — é o comportamento do upstream para TODO nome, inclusive o que o operador edita à mão. Fixar o nome do Calendly exige uma marca "nome fixado pelo escritório" na ficha, que é feature à parte |
| **D6** | **Ordem** dos passos na automação criada | nome → campos → **aviso ao número** → mover card | um passo que falha ENCERRA a execução (`engine.ts`, `break` no catch), e `move_deal_stage` falha quando o contato não tem card aberto — o aviso do agendamento não pode depender disso |
| **D7** | Cancelamento no Calendly (`invitee.canceled`) | fora deste PR; a assinatura escuta só `invitee.created` | não foi pedido; reagendamento já chega como `invitee.created` novo (campos atualizados, aviso de novo) |

---

## 1. O pedido, traduzido para o que já existe

| Pedido | No CB CRM | O que falta |
| --- | --- | --- |
| "toda vez que houver um agendamento no calendly" | nada escuta o Calendly (`date_field_offset` só LÊ o campo de data que alguém preencheu) | webhook de entrada + gatilho `calendly_booking` |
| 1. achar conversa e card pelo telefone | `findExistingContact` (últimos 8 dígitos, tolerante a tronco); conversa única por contato (036); card = negócio ABERTO mais recente (`negocioAlvo`) | chamar a partir do webhook e entregar `contact_id`/`conversation_id` ao motor |
| 2. nome = nome do Calendly | passo `update_contact_field` com `field: 'name'` | valor `{{vars.agendamento_nome}}` |
| 3. campos "Data e Hora Reunião" (`datetime`) e "Link Reunião" (`text`) | `update_contact_field` com `custom:<id>`; datetime grava ISO UTC (`campo-data.ts`) | `{{vars.agendamento_inicio}}` e `{{vars.agendamento_link}}` |
| 4. mover para "Reunião Agendada" | passo `move_deal_stage` (RPC `cb_atualizar_negocio`) | só a etapa (`3ab137e6…`, funil Bancário - Comercial) |
| 5. avisar 83 98874-5316 pela "Bancário - Comercial" | **não existe**: `send_message` só fala com o contato do disparo | passo novo `send_to_number` (telefone + conexão + texto) |

---

## 2. O que foi medido antes de desenhar

### 2.1 Produção (07/09/2026)

| Medida | Valor | Consequência |
| --- | --- | --- |
| Etapa "Reunião Agendada" | só no funil **Bancário - Comercial** (`3ab137e6-1be6-439e-a88d-3b66ac59dee7`, posição 4) | o passo aponta para ela; contato com card em OUTRO funil é transferido pela RPC (deriva o funil da etapa) |
| Campos | `data_e_hora_reuniao` (`datetime`, `e40ad0f2…`) e `link_reuniao` (`text`, `a5d00f62…`) já existem, bloco Geral | nenhum campo novo |
| Conexão "Bancário - Comercial" | `f2f9820b-3cbe-4581-870b-92415fd547aa`, padrão da conta, Evolution, conectada | o aviso sai por ela |
| Contato 83 98874-5316 | **não existe** em `contacts` (nenhum telefone terminando em 88745316) | o passo cria contato + conversa na primeira vez, pelo mesmo caminho da API pública (`resolveConversationByPhone`) |
| Automações | 2 (webhook Atlas em `deal_stage_changed`; teste do plano 955) | nenhuma escuta o Calendly |
| `custom_fields.field_type` | CHECK `(text, datetime, select, number)`; valor é TEXT | datetime em ISO `…Z` |
| Conta | `a3af0191-…` (Leonardo, 2 membros) | 5 contas no banco: a rota do webhook identifica a conta por um token na URL |

### 2.2 Motor de automações (código)

- **Não há CHECK de `trigger_type`/`step_type` no banco** (936 confirma): tipo
  novo é união TS + `validate.ts` + builder + `trigger-meta.ts` +
  `descrever-passo.ts` (com teste cobrando chave i18n por passo).
- `interpolate` (engine.ts) conhece `{{message.text}}`, `{{vars.X}}` e
  `{{channel.id}}` — **`{{contact.name}}` não existe**. O webhook entrega os
  dados em `context.vars`, e o builder passa a listar as variáveis.
- `runAutomationsForTrigger({accountId, triggerType, contactId, context})`
  nunca lança; confere posse do contato; aplica `channelInScope`,
  `triggerMatches` e `stageInScope`.
- Passo que falha **encerra a execução** (D6).
- `engineSendText` (flows/meta-send.ts) manda como robô: persiste `sender_type='bot'`,
  não reabre conversa, não roteia para funil — é o caminho certo para o aviso.
- `resolveConversationByPhone` (whatsapp/resolve-conversation.ts) cria
  contato + conversa com o dono durável; já está na allowlist de
  `dono-duravel.test.ts`.

### 2.3 Calendly (API v2, medido na doc em 07/09)

- Auth por **Personal Access Token** (Integrations → API & Webhooks →
  Personal access tokens). Webhooks exigem **plano pago** (Standard+).
- `POST /webhook_subscriptions` `{url, events, organization, user?, scope, signing_key}`;
  `GET /webhook_subscriptions?organization=&scope=`; `DELETE /webhook_subscriptions/{uuid}`;
  `GET /users/me` (uri, current_organization, name, email, scheduling_url);
  `GET /event_types?organization=|user=` (uri, name, active, scheduling_url).
- Assinatura: header `Calendly-Webhook-Signature: t=<unix>,v1=<hex>`,
  HMAC-SHA256 da string `t + '.' + corpo cru` com a `signing_key` que NÓS
  informamos ao assinar. Tolerância recomendada: minutos.
- Entrega: timeout de 10s (conexão) / 15s (leitura); 3xx/4xx/5xx são
  retentados por 24h com backoff e depois a assinatura é **desativada** —
  daí responder 200 na hora e processar em `after()`.
- Payload `invitee.created`: `payload.name`, `email`, `text_reminder_number`
  (ou null), `questions_and_answers[{question, answer}]`, `timezone`,
  `scheduled_event.{uri, name, start_time, end_time, event_type,
  location{type, location, join_url?}}`, `cancel_url`, `reschedule_url`,
  `old_invitee` (reagendamento), `uri` do invitee (chave de idempotência).

---

## 3. Desenho

### 3.1 Migration `977_cb_calendly.sql`

- `cb_calendly_config` (uma linha por conta): `access_token` (PAT, cifrado),
  `signing_key` (cifrado), `webhook_token` (segredo de rota, único —
  identifica a conta na URL), `user_uri`, `organization_uri`, `user_name`,
  `user_email`, `scheduling_url`, `webhook_uri`, `webhook_scope`,
  `pergunta_telefone`, `status`, `last_event_at`, `last_error`, `created_by`,
  timestamps. **Fechada** para `authenticated` (sem policy, sem GRANT), como
  a `cb_meta_ads_config`; `anon` sem nada (931); `service_role` tudo.
- `cb_calendly_eventos`: o que chegou e o que aconteceu com cada agendamento
  (`evento`, `invitee_uri`, `event_type_uri/nome`, `nome`, `email`,
  `telefone`, `inicio`, `fim`, `link`, `perguntas`, `contact_id`,
  `resultado` ∈ {recebido, disparado, sem_automacao, sem_contato,
  sem_telefone, ignorado, falhou}, `detalhe`). `UNIQUE (account_id, evento,
  invitee_uri)` = idempotência (o Calendly reenvia). Fechada como a config —
  a tela lê pela rota.
- Conferências válidas em banco VAZIO; teste `rls-das-tabelas-do-calendly.test.ts`
  lendo o `.sql` (o mesmo racional do teste do Meta Ads).

### 3.2 `src/lib/calendly/` (puros, com teste, salvo os marcados)

| Módulo | Faz |
| --- | --- |
| `telefone.ts` | `digitosDoTelefone` (Calendly manda "+55 96 99112-6767" ou o que o cliente digitou; 10–11 dígitos sem DDI ganham 55), `formatarTelefone` ("(96) 99112-6767" para BR, `+…` para o resto), `pareceTelefone` |
| `payload.ts` | `lerAgendamento(corpo, {perguntaTelefone})` → `Agendamento` normalizado (ou `null` para evento que não é `invitee.created`); D1 mora aqui |
| `assinatura.ts` | `verificarAssinatura(header, corpoCru, chave, agoraSeg)`, `gerarChaveDeAssinatura`, `gerarTokenDeWebhook` |
| `variaveis.ts` | `variaveisDoAgendamento(a)` → `vars` do contexto: `agendamento_nome`, `agendamento_email`, `agendamento_telefone`, `agendamento_evento`, `agendamento_data` (dd/mm/aaaa hh:mm em `America/Sao_Paulo`, montado por `formatToParts` — nunca `toLocaleString`, que muda de forma entre majors do Node), `agendamento_inicio` (ISO UTC, o que o campo `datetime` guarda), `agendamento_link`, `agendamento_local`, `agendamento_cancelar`, `agendamento_remarcar`, `agendamento_situacao` ("Novo agendamento" / "Reagendamento") |
| `cliente.ts` | API do Calendly com Bearer no cabeçalho, erros como CÓDIGO (`token_invalido`, `sem_permissao`, `limite`, `rede`, `calendly_error`), `semSegredo` limpando o token de qualquer mensagem (lição do Meta Ads) |
| `cartao.ts` | o estado do cartão a partir da config (sem segredos) e dos últimos eventos |
| `conexao.ts` (I/O) | conectar (valida em `/users/me`, assina o webhook org→user, grava cifrado), reassinar, desconectar |
| `processar.ts` (I/O) | do evento gravado ao `runAutomationsForTrigger`: acha o contato, a conversa, conta quem escuta, despacha, carimba o resultado |

### 3.3 Rotas (`src/app/api/cb/calendly/`)

| Rota | Papel | Faz |
| --- | --- | --- |
| `GET /api/cb/calendly` | admin | cartão + últimos 20 eventos (service role; nada de token) |
| `PUT /api/cb/calendly/config` | admin | `{access_token}` → valida, assina o webhook, grava |
| `PATCH /api/cb/calendly/config` | admin | `{pergunta_telefone}` |
| `DELETE /api/cb/calendly/config` | admin | apaga a assinatura no Calendly (melhor esforço) e a config; eventos ficam |
| `POST /api/cb/calendly/reassinar` | admin | recria a assinatura com o token guardado (a assinatura desativada pelo Calendly exige recriar) |
| `GET /api/cb/calendly/event-types` | admin | lista para o select do gatilho |
| `POST /api/cb/calendly/webhook/[token]` | **público** (assinado) | confere assinatura → grava o evento (idempotente) → **200** → processa em `after()` |

A URL do webhook sai de `NEXT_PUBLIC_SITE_URL` e é recusada quando não é
alcançável de fora (`ehUrlAlcancavel`, a guarda da Evolution) — um dev
local assinando `localhost` no Calendly da produção quebraria a entrega em
silêncio.

### 3.4 Motor

- `AutomationTriggerType` += `calendly_booking`; `CalendlyTriggerConfig
  {event_type_uri?, event_type_nome?}`; `AutomationContext.calendly_event_type?`;
  `triggerMatches`: config vazia = qualquer evento, senão igualdade de URI.
- `AutomationStepType` += `send_to_number`; `SendToNumberStepConfig
  {phone, contact_name?, text, channel_id?}`. Execução: valida o telefone,
  exige que a conexão escolhida seja DESTA conta e resolva de fato (falha
  fechada — nada de cair no padrão), acha/cria contato + conversa pelo
  telefone (`resolveConversationByPhone`; o nome só na criação), envia por
  `engineSendText` com `preferredChannelId`. Não roteia para funil, não
  reabre conversa (é o robô falando com a equipe).
- `validate.ts`, `descrever-passo.ts` (+ chave `resumo.send_to_number`),
  `trigger-meta.ts`, builder (opção de gatilho com select de evento;
  editor do passo com telefone, nome, conexão e texto; dica das variáveis).

### 3.5 A automação criada (Fase 1, inativa; o operador ativa na Fase 2)

"Calendly → Reunião agendada", gatilho `calendly_booking` (evento:
qualquer, até a conexão existir), passos nesta ordem (D6):

1. `update_contact_field` `name` = `{{vars.agendamento_nome}}`
2. `update_contact_field` `custom:e40ad0f2…` (Data e Hora Reunião) = `{{vars.agendamento_inicio}}`
3. `update_contact_field` `custom:a5d00f62…` (Link Reunião) = `{{vars.agendamento_link}}`
4. `send_to_number` telefone `5583988745316`, conexão Bancário - Comercial, texto:
   ```
   Novo Agendamento:
   Tipo: {{vars.agendamento_evento}}
   Nome: {{vars.agendamento_nome}}
   Data: {{vars.agendamento_data}}
   Telefone: {{vars.agendamento_telefone}}
   ```
5. `move_deal_stage` → Reunião Agendada

---

## 4. Passos do operador (Fase 2)

1. No Calendly (plano pago): Integrations → API & Webhooks → gerar um
   Personal Access Token com a conta que ENXERGA o evento (admin da
   organização, de preferência).
2. Configurações → Integrações → Calendly → colar o token → Conectar. O CRM
   assina o webhook na hora e mostra o estado.
3. Se o formulário do evento pergunta o telefone com um rótulo específico
   ("WhatsApp"), escrever esse rótulo em "Pergunta do telefone".
4. Automações → "Calendly → Reunião agendada" → escolher o evento "Reunião
   com Advogado - Kommo" no gatilho → ativar.
5. Marcar um horário de teste com um telefone que exista no CRM e conferir:
   ficha renomeada, campos preenchidos, card em Reunião Agendada, aviso no
   83 98874-5316, e a linha no cartão da integração.

---

## 5. Fora deste PR

- `invitee.canceled` / no-show (D7).
- Criar contato/card para telefone desconhecido (D2).
- Fixar o nome vindo do Calendly contra o `pushName` do WhatsApp (D5).
- OAuth do Calendly (o token pessoal basta para um escritório).

---

## 6. Resultado medido — Fase 1 (2026-09-07, worktree em `main` @ `bdb4d99`)

- **Código:** `src/lib/calendly/` (`payload`, `assinatura`, `variaveis`,
  `cartao`, `cliente` puros; `conexao`, `processar` I/O) e
  `src/lib/contacts/telefone.ts`; migration `977_cb_calendly.sql` + teste
  estrutural de RLS; motor (`calendly_booking`, `send_to_number`,
  `destinatario.ts`); rotas `/api/cb/calendly/{,config,reassinar,
  event-types,webhook/[token]}`; `calendly-card.tsx` em Integrações;
  `calendly-trigger-config.tsx` + editor do passo no builder; chaves nos
  dois dicionários; CLAUDE.md.
- **Testes:** 89 novos (telefone 11, assinatura 11, payload 14, variáveis
  8, cliente 9, cartão 5, processar 3, rota do webhook 9 com banco e
  `after()` mockados, RLS da 977 7, motor 8, validação 2, resumo do passo
  2). Suíte inteira **2.754** verdes no Node 22; `typecheck` limpo; `eslint` 0 problemas nos arquivos tocados;
  `i18n-parity` e `i18n-chaves-usadas` OK; `icu-safety` OK (as chaves
  duplas entram por VALOR, nunca escritas no dicionário).
- **Preview (localhost:3111, 1440×900, conta real):**
  - Integrações → cartão "Calendly" aparece depois do Meta Ads. Sem a
    migration aplicada a rota devolve 500 e o cartão mostra o caminho de
    ERRO ("Não foi possível carregar… Tentar de novo", chip "Com erro") —
    que é o comportamento certo para tabela ausente. O estado "não
    conectado" com o formulário do token só é alcançável com a 977
    aplicada.
  - Automações → nova → gatilho "Agendamento no Calendly": dica, escopo
    por conexão e por etapa (herdados), select "Evento do Calendly" com
    "Qualquer evento" e a mensagem de carga falha (sem a tabela; com ela e
    sem conexão vira "Conectar em Integrações"), a caixa com as 12
    variáveis. Passo "Avisar um número": telefone (dica do 55), nome na
    ficha, texto com placeholder das variáveis, "Enviar por" com "A
    conversa do número (ou a conexão padrão)". Salvo como rascunho
    ("Automação criada"), conferido no banco (`trigger_type =
    calendly_booking`, `send_to_number` com `phone`, `contact_name`,
    `text`) e **apagado** em seguida — a automação de verdade nasce
    depois do deploy (seção 3.5), porque o builder em produção hoje não
    conhece o passo e quebraria se alguém a abrisse antes.
- **NÃO medido, e por quê:** a conexão real com o Calendly (token do
  escritório), a assinatura do webhook e um agendamento de ponta a ponta —
  exigem a migration em produção, o deploy (URL pública) e o token, que o
  operador tem e eu não. O caminho do webhook está coberto por teste com o
  banco mockado; `supabase db start` não rodou (Docker parado nesta
  máquina) — o replay da 977 em banco vazio fica para o CI.
- ⚠️ **Achado durante a execução (pego pelo próprio teste):** a heurística
  de telefone lia CPF (11 dígitos, como celular sem DDI) como telefone.
  Corrigido com a lista de rótulos de documento e a pontuação de CPF/CNPJ
  (`payload.ts`); a pergunta configurada pelo operador vence a exclusão.
- ⚠️ **Achado de desenho:** `send_message` herda o canal do disparo, e um
  `send_to_number` que fizesse o mesmo avisaria o advogado pelo número por
  onde o CLIENTE escreveu. O passo NÃO herda (só a escolha explícita, que
  falha fechada). Está no teste do motor e no CLAUDE.md.
