# PLANO — Automações: multi-canal, funil e orquestração

> **Documento vivo.** Cada fase/PR concluído atualiza a seção
> [Registro de progresso](#registro-de-progresso) e marca os itens feitos.
> Uma sessão nova deve **ler este arquivo primeiro** para saber onde paramos.
>
> **Última atualização:** 2026-08-03 — **Fase 1 implementada** (não commitada,
> não mesclada). Nenhuma pergunta pendente.
> **Branch de trabalho:** `feat/automacoes-canal-por-passo`, saída de `main`.

---

## 1. Objetivo

O módulo de automações nasceu no upstream (`wacrm`) quando o sistema tinha **uma
conexão só** e **não tinha funis**. Hoje o CB CRM tem múltiplas conexões
(multi-canal, migration 903) e funis com etapas (908/911). O módulo ficou para
trás. O operador pediu:

1. **Gatilho por conexão** — "quando chegar mensagem **neste número**".
2. **Ação por conexão** — "envie a resposta **por este número**".
3. **Funil nos gatilhos e nas ações** — recortar por funil/etapa e agir sobre o card.
4. **IDs próprios** para etiquetas, etapas, funis e campos personalizados.
5. **Ações novas:** enviar documento/áudio, acionar e parar automações específicas,
   acionar e parar chatbots de IA.
6. **(Secundário) Builder por etapa**, no estilo Kommo: dentro da tela de Funis,
   pendurar automações em cada etapa do quadro. Só depois de a automação estar
   "redonda".

---

## 2. Estado atual — achados verificados

> Todos os itens abaixo foram lidos no código, não deduzidos. Medições de banco
> feitas em 2026-08-03 no projeto `hxnhakmyxyhalbsktzwe`.

### 2.0 Estado do banco (2026-08-03)

| | |
|---|---|
| Conexões | **2 linhas, mas em CONTAS DIFERENTES — 1 canal por conta.** As duas Evolution (nenhuma Meta), as duas conectadas |
| Funis / etapas | **1 / 9** |
| Etiquetas / campos personalizados | **0 / 0** |
| Automações / fluxos | **0 / 0** |
| Negócios | 56 |

⚠️⚠️ **NENHUMA CONTA É MULTI-CANAL HOJE — e isto explica o pedido original.**
Medido em 2026-08-03: `38f38852…` tem só "WhatsApp (QR Code)" e `a3af0191…`
(a do operador) tem só "Pessoal Leonardo". Todo seletor de canal do projeto
esconde-se com menos de 2 conexões, por convenção. Ou seja: **o escopo de
canal do gatilho sempre existiu e o operador nunca pôde vê-lo**, não porque
falte código, mas porque o segundo número está em outra conta. Enquanto os
dois números não estiverem na MESMA conta, nem o escopo do gatilho nem o
"Enviar por" novo aparecem na tela. É decisão do operador, não de código.

⚠️ **As duas conexões são Evolution.** Consequência dupla: (a) os passos
exclusivos da Meta (`send_template`, `send_buttons`, `send_list`) **não
funcionam nesta conta hoje** — a validação de ativação já recusa quando o
escopo é só-Evolution; (b) teste manual em produção só exercita texto e mídia.
Correções em código Meta-only se provam por teste automatizado, não na tela.

**Implicação central: não há nada em produção para migrar.** Nenhuma automação
ou fluxo foi criado ainda, então não existe pressão de compatibilidade sobre
formatos guardados em `trigger_config` / `step_config`. Podemos mudar a forma
sem escrever migração de dados.

### 2.1 Multi-canal — o que JÁ existe

- **Escopo de canal por automação já existe e já tem tela.**
  `automations.channel_ids uuid[]` (migration `903_cb_multicanal.sql:33`), lido
  por `channelInScope()` em `src/lib/automations/engine.ts:740-749`, editável
  pelo `ChannelMultiSelect` em `src/components/automations/automation-builder.tsx:869-887`.
  Como é **um gatilho por automação**, esse escopo *já é* "qual conexão disparou".
  O seletor só aparece com **2+ conexões** (`automation-builder.tsx:873`) — e a
  conta tem 2, então ele deveria estar visível hoje.
- **Condição `channel`** ramifica dentro de uma automação
  (`engine.ts:817-825`), com seletor próprio (`automation-builder.tsx:1494-1537`).
- **Canal de saída por passo existe no motor, mas não na tela.**
  `ChannelScopedStepConfig` (`src/types/index.ts:745-747`) e
  `stepChannel()` (`engine.ts:846-861`) resolvem, nesta ordem: escolha explícita
  do passo → canal do disparo → canal da conversa → padrão da conta.
  **Nenhuma tela escreve `step_config.channel_id`.**

### 2.2 Multi-canal — o que está QUEBRADO

| # | Defeito | Onde | Efeito |
|---|---|---|---|
| B1 | `engineSendInteractive` **descarta** `preferredChannelId` | `src/lib/automations/meta-send.ts:93-115` | Botões/listas ignoram o canal escolhido e o canal do disparo; saem pelo canal atual da conversa. Os destinos já aceitam o parâmetro (`src/lib/flows/meta-send.ts:379,394`) |
| B2 | `tag_added` **nunca** carrega `channel_id` | `src/lib/contacts/tag-events.ts:56`, `engine.ts:475`, `src/lib/flows/engine.ts:753` | Numa automação de etiqueta o escopo de canal é inerte e a condição `channel` dá **sempre falso** |
| B3 | Gatilho **"Conversa Atribuída" nunca dispara** | nenhum call site de `runAutomationsForTrigger` usa esse tipo | A opção existe na tela, tem rótulo e validação, e não faz nada |
| B4 | Gatilho **"Agendamento" (`time_based`) nunca dispara** | `/api/automations/cron` só drena `automation_pending_executions` | Idem |
| B5 | ~~`interactive_reply` só existe no transporte Meta~~ **Reclassificado na revisão: não é defeito prático.** A Evolution não ENVIA botão (`send-message.ts:571-577` rejeita `interactive`), logo nunca RECEBE resposta de botão — o parse ausente em `inbound-store.ts` não tem o que parsear. | — | Fica como limitação documentada: menu por botão é recurso Meta-only, e a validação de ativação já diz isso |
| B6 | Sem validação de canal no cliente, **e a do servidor não olha o canal por passo** — `validateChannelScopeForActivation` (`validate.ts:239-271`) só lê o escopo da automação; `step_config.channel_id` é ignorado, e com escopo vazio ela retorna cedo (`:245`) | `automation-builder.tsx:711-721` (cliente); `validate.ts:245` (servidor) | Quando a Fase 1 criar a UI de canal por passo, um `send_template` fixado num canal Evolution passaria na ativação. Os **fluxos já resolveram as duas metades**: `validateFlowChannelForActivation` calcula o canal EFETIVO por nó (`src/lib/flows/validate.ts:823-850`) e roda também no cliente (`flow-editor-state.tsx:340-354`) |
| B7 | Duas buscas de canais no mesmo builder | `automation-builder.tsx:262` e `:824` | Duas requisições por montagem. Fluxos buscam uma vez só (`flow-editor-state.tsx:259`) |
| B8 | Chave i18n `Automations.builder.delete` **não existe** nos dois dicionários | `automation-builder.tsx:1204` | O botão Excluir do card de passo renderiza o caminho cru da chave |

### 2.3 Funil — estado

- **Tudo tem UUID estável e o motor já referencia por ID, nunca por nome.**
  Isso responde ao item 4 do pedido: `tags.id`, `pipelines.id`,
  `pipeline_stages.id`, `custom_fields.id`, `cb_channels.id` — todos `uuid` PK, e
  o motor guarda `tag_id`, `pipeline_id`, `stage_id`, `custom:<uuid>`,
  `channel_id`. **Não há trabalho a fazer aqui.**
  Duas exceções, ambas por desenho: a condição `contact_field` e a ação
  `update_contact_field` usam o **nome da coluna** para campos nativos
  (`name`/`email`/`company`) — campo personalizado usa id.
- **Automação e funil quase não se falam.** O único ponto de contato é a ação
  `create_deal` (`engine.ts:576-646`). **Não há** gatilho, condição ou ação de
  etapa/funil.
- `create_deal` **insere direto na tabela**, contornando as validações de
  `src/lib/deals/create-deal.ts` (o próprio cabeçalho de lá, `:1-17`, avisa
  disso): não confere se o funil é da conta nem se a etapa pertence ao funil.
- **FKs compostas** em `deals`: `(pipeline_id, account_id)`,
  `(stage_id, pipeline_id)`, `(channel_id, account_id)`,
  `(conversation_id, account_id)` (908 e 910). Mover um card entre funis exige
  atualizar `pipeline_id` e `stage_id` **na mesma instrução**.
- **A trilha de auditoria (912) já calcula tudo que um gatilho de etapa precisa** —
  de/para de etapa e funil, posições, ator, origem — por **trigger de banco**
  (`cb_deals_log_event_update`, `AFTER UPDATE OF pipeline_id, stage_id, status`).
  Mas **não há nenhum mecanismo de entrega**: `cb_lead_events` não está no
  realtime, não há `pg_notify`, e o único consumidor é um hook que faz polling
  (`src/hooks/use-lead-events.ts`).
- ⚠️ **Movimento entre funis emite `pipeline_changed`, NUNCA `stage_changed`**
  (`912_cb_historico_de_atividade.sql:306-310`). Um gatilho "entrou na etapa X"
  que só escutar `stage_changed` **não dispara** quando o card vem de outro funil.

### 2.4 Muitos escritores, e alguns no navegador

Este é o fato que decide o desenho dos gatilhos novos.

**`deals.stage_id`** — 2 escritores de movimento, **os dois no navegador sob RLS**:
`src/app/(dashboard)/pipelines/page.tsx:223` (arrastar no Kanban) e
`src/components/pipelines/deal-form.tsx:189`. Mais 3 caminhos de criação no
servidor.

**`conversations.assigned_agent_id`** — 6 escritores, **um no navegador**:
`src/components/inbox/message-thread.tsx:1466` (seletor de responsável),
`src/app/api/ai/autoreply/[conversationId]/route.ts:78,87`,
`src/lib/ai/auto-reply.ts:199`, `src/lib/automations/engine.ts:518`,
`src/lib/flows/engine.ts:479`.

**Conclusão:** enxertar o disparo em cada call site é o caminho que quebra em
silêncio — é exatamente a razão pela qual a 912 pôs a auditoria num trigger de
banco. Os gatilhos novos seguem a mesma lição (ver §4.1).

### 2.5 Orquestração — o que existe para "acionar/parar"

| Capacidade pedida | Existe? | Primitiva a reusar |
|---|---|---|
| Desligar a IA numa conversa | coluna sim, escritor de motor **não** | `conversations.ai_autoreply_disabled` (`029_ai_reply.sql:100`); copiar `src/app/api/ai/autoreply/[conversationId]/route.ts:75` |
| Religar a IA numa conversa | idem | mesma rota `:87-93` — decidir se zera `ai_reply_count` |
| **Acionar "chatbot X"** | ❌ **não existe "X"** | `ai_configs` não tem coluna `name`; é **1 agente padrão por conta + 1 por canal**, chaveado por `(account_id, channel_id)`. E **não há API nem tela** para criar o por-canal — `/api/ai/config` fixa `channel_id IS NULL` em toda operação. → Feature futura pré-avaliada em §4.7 (D7) |
| Acionar "robô X" (fluxo) | ❌ falta a função | `flows` **tem `name` e `id`**, e tem um `trigger_type: 'manual'` que **nunca dispara** — esperando exatamente isto. `startNewRun` (`src/lib/flows/engine.ts:1136`) é privado e tem assinatura de webhook |
| Parar o fluxo em andamento | ⚠️ efetivamente sim | o bloco `pauseFlows` de `src/lib/whatsapp/send-message.ts:816-828` já é um UPDATE por contato; basta extrair como função exportada |
| Acionar automação Y por id | ❌ | `runAutomationsForTrigger` é **por tipo de gatilho**, não por id |
| Parar automação | ❌ | não há nenhum DELETE/cancel de `automation_pending_executions` fora do cron; o CHECK não tem `'cancelled'` |
| Guarda de laço | ✅ | `src/lib/contacts/tag-chain.ts` — profundidade em `context.vars`, teto 3, **sobrevive ao `wait`** porque o contexto é JSONB |

⚠️ **`idx_one_active_run_per_contact`** (`010_flows.sql:187`): **um fluxo ativo
por contato**. "Acionar robô Y" com um robô já rodando bate em `23505` — hoje
tratado como "outro webhook começou a run" e devolvido como sucesso silencioso.

⚠️ **Desativar uma automação NÃO para as execuções paradas em `wait`.**
`resumePendingExecution` (`engine.ts:148-153`) busca a automação **sem filtrar
`is_active`** e executa. Escopo de canal e casamento de gatilho também só são
avaliados no disparo, nunca no resume.

### 2.6 Mídia — o modelo já está pronto nos fluxos

- O nó `send_media` dos fluxos é o molde exato: arquivo enviado **uma vez, em
  tempo de desenho** (`uploadAccountMedia`, `src/lib/storage/upload-media.ts:79`),
  URL pública guardada no config JSONB, reusada em toda execução
  (`src/lib/flows/types.ts:105-126`, motor em `src/lib/flows/engine.ts:642-671`).
- **Sem migration**: `automation_steps.step_type` é `TEXT` **sem CHECK**
  (`006_automations.sql:58`).
- **Sem bloqueio técnico**: a Meta busca a URL sozinha a cada envio
  (`meta-api.ts:300`), a Evolution aceita a mesma URL pública.
- ⚠️ **`engineSendMedia` não grava `media_url` na linha de `messages`**
  (`src/lib/flows/meta-send.ts:336-347`) — mídia enviada por fluxo aparece como
  balão vazio no inbox. Herdaríamos o defeito.
- ⚠️ **Os três buckets são `public = true`** e a rota pública **não passa por
  RLS** — o próprio cabeçalho da `900_cb_storage_restringe_listagem.sql:24-30`
  diz isso. Quem tiver a URL abre o arquivo, para sempre, sem login. Para
  documento de cliente de escritório de advocacia, é exposição real, e **não há
  nenhum helper de URL assinada no repo**. *(Risco aceito pelo operador — D12.)*
- ⚠️ `flow-media` **não aceita áudio**; `chat-media` aceita.

### 2.7 Infra — o agendador existe e bate de 15 em 15 minutos

`docker-stack.yml:75-114`: um serviço `agendador` chama, em laço,
`/api/cb/scheduled/cron`, `/api/flows/cron` e `/api/automations/cron`, **a cada
900 s**. Isso significa:

- O passo `wait` das automações **funciona** (desde 2026-08-01).
- **15 minutos é rápido o bastante para "esperar", e lento demais para "moveu o
  card → manda a mensagem".** Um gatilho de etapa que dependa só do cron entrega
  a mensagem até 15 min depois do arrasto. Inaceitável — daí o desenho de §4.1.
- ⚠️ O CI **não** sobe esse serviço; `deploy.yml` só troca a imagem do `crm_crm`.
- `pg_cron`, `pg_net` e `http` estão **disponíveis mas não instalados** no
  Supabase deste projeto (medido em 2026-08-03).

---

## 3. Decisões tomadas

| # | Decisão | Quem/quando |
|---|---|---|
| D1 | Funil entra **como gatilho novo ("card mudou de etapa") E como filtro** dos gatilhos existentes | operador, 2026-08-03 |
| D2 | "Conversa Atribuída" e "Agendamento" **serão implementados de verdade** (nenhuma opção da tela pode mentir). *Revisto por D14:* o "Agendamento" cru sai do seletor; o tempo de verdade é §4.6 | operador, 2026-08-03 |
| D3 | Ações de funil: **mover para etapa**, **marcar ganho/perdido**, e **corrigir `create_deal`** para usar `createDeal` | operador, 2026-08-03 |
| D4 | Ações novas: **enviar documento/mídia**, **acionar/parar automação**, **acionar/parar chatbot** | operador, 2026-08-03 |
| D5 | Primeiro entregável = **conexão + funil**; builder por etapa fica por último | operador, 2026-08-03 |
| D6 | Gatilhos com muitos escritores usam **caixa de saída no banco**, não enxerto em call site | proposto 2026-08-03; sem objeção nas duas rodadas de perguntas construídas sobre ele |
| D7 (Q1) | **Agentes de IA nomeados** (geral, follow-up, satisfação, triagem — cada um com prompt e base próprios) são feature **futura, fora deste plano**; pré-avaliada em §4.7 para as decisões de agora não fecharem a porta | operador, 2026-08-03 |
| D8 (Q2) | Gatilho sem negócio no contexto age sobre **o negócio aberto mais recente** do contato | operador, 2026-08-03 |
| D9 (Q3) | O canal carimbado no evento de funil é **o da conversa atual**, não o do nascimento do card | operador, 2026-08-03 |
| D10 (Q4) | Religar a IA por automação **zera `ai_reply_count`** (atualizar o comentário da rota manual que dizia "não-automatizável") | operador, 2026-08-03 |
| D11 (Q5) | `run_flow` com robô ativo: **o novo substitui o atual** (encerrado como "substituído por automação"); segue valendo **uma run ativa por contato** | operador, 2026-08-03 |
| D12 (Q6) | **URL pública permanente aceita** para mídia de automação; a ressalva de §2.6 vira fato registrado, não pendência | operador, 2026-08-03 |
| D13 (Q7) | Movimento feito por automação **encadeia, SEM teto de profundidade** (teto recusado pelo operador). A guarda é **anti-ciclo**: a mesma cadeia não repassa pela mesma etapa/atribuição — garante término sem limitar esteira longa. Sem guarda nenhuma, X→Y→X mandaria mensagem ao cliente para sempre | operador (sem teto), 2026-08-03; guarda anti-ciclo proposta pela implementação |
| D14 (Q8) | **"Tempo" redefinido pelo operador:** (a) espera entre passos = o `wait` que já existe, com cadência afinada; (b) **gatilho relativo a data de campo personalizado** (lembrete de reunião: 24h/12h/1h antes). O `time_based` cru do upstream sai do seletor. Ver §4.6 | operador, 2026-08-03 |

---

## 4. Desenho das peças novas

### 4.1 Caixa de saída (`cb_automation_events`) — como um gatilho de banco vira automação

O problema: quem move o card e quem atribui a conversa está **no navegador**,
sob RLS. Não há ponto único no servidor por onde passar.

**Desenho proposto** — uma tabela de fila (não de auditoria; a auditoria já é a
`cb_lead_events` e não deve ser distorcida com CHECKs e linhas `reconstructed`):

```
cb_automation_events
  id, account_id, tipo ('deal_stage_changed' | 'deal_status_changed'
                        | 'conversation_assigned')
  contact_id, deal_id, conversation_id, channel_id
  from_stage_id, to_stage_id, from_pipeline_id, to_pipeline_id,
  from_status, to_status, assigned_agent_id
  origem ('usuario' | 'conexao' | 'automacao' | 'sistema'), cadeia jsonb
  criado_em, processado_em (NULL = pendente), tentativas, erro
```

Escrita por **triggers `SECURITY DEFINER`** em `deals`
(`AFTER INSERT OR UPDATE OF pipeline_id, stage_id, status`) e em `conversations`
(`AFTER UPDATE OF assigned_agent_id`), no mesmo molde da 912. Regras que a 912
já pagou para aprender, e mais três novas:

- **`IS NOT DISTINCT FROM` no topo** — o `deal-form` menciona as três colunas em
  todo save; sem a guarda, cada edição de anotação enfileira evento falso.
- **INSERT também enfileira** (`from_*` nulos). O print do Kommo é literal:
  "quando movido para **ou criado** nesta etapa" — e o card que o roteador de
  entrada cria (`routeInboundToPipeline`) precisa disparar igual.
- **`origem` e `cadeia`:** no INSERT a origem sai de `deals.source` (como a 912
  faz). No UPDATE, escritor de navegador = `auth.uid()` presente = `usuario`.
  Escritas do MOTOR passam a ir por RPC (`cb_mover_negocio(...)`) que carimba a
  **cadeia** — a lista de etapas/atribuições que este encadeamento já visitou —
  num GUC transacional (`set_config('cb.cadeia', ..., true)`); o trigger copia
  para o evento e o drain devolve ao contexto do disparo (mesmo transporte JSONB
  do `tag-chain.ts`, que sobrevive ao `wait`). **Guarda anti-ciclo, sem teto de
  comprimento (D13):** antes de disparar, o motor recusa evento cuja
  etapa/conversa já esteja na cadeia — esteira longa passa; círculo X→Y→X, que
  mandaria mensagem ao cliente para sempre, é barrado na segunda volta.
- **Carimbo de canal do evento = canal da conversa atual (D9):**
  `deals.conversation_id` → `conversations.channel_id`; sem conversa vinculada,
  a conversa mais recente do contato; pode ficar NULL (e aí o escopo de canal da
  automação deixa passar, como em todo disparo sem canal).
- **O trigger de `conversations` só enfileira atribuição de verdade:**
  `NEW.assigned_agent_id IS NOT NULL` e distinto do OLD. Desatribuir (o botão
  "Retomar IA" zera a coluna) não é "conversa atribuída".
- ⚠️ O passo `assign_conversation` de hoje atualiza **todas** as conversas do
  contato (`engine.ts:516-520`) — com o trigger ligado, um contato com 3
  conversas enfileira 3 eventos de uma vez. Corrigir o passo para mirar a
  conversa do contexto faz parte da entrega.
- **Nasce fechada** (lição da 931): `REVOKE ALL FROM anon, authenticated` — fila
  é assunto de service_role; conferir o resultado com `SET ROLE`, não a intenção.
- Índice parcial nos pendentes (`WHERE processado_em IS NULL`) e **GC** de
  processados com mais de 30 dias no próprio cron.

Três formas de drenar, nesta ordem de importância:

1. **Imediata, pelo escritor.** Os três escritores de navegador (Kanban,
   `deal-form`, seletor de responsável do `message-thread`) chamam uma rota
   `POST /api/automations/events/drain` logo depois do UPDATE, fire-and-forget.
   Os escritores de servidor chamam a função direto. → latência de segundos no
   caso comum.
2. **Rede de segurança:** o `/api/automations/cron` que já existe passa a drenar
   pendências no mesmo ciclo de 15 min. Pega o que o navegador não conseguiu
   avisar (aba fechada, rede caindo, SQL na mão).
3. **Reivindicação em dois passos** (`UPDATE … WHERE processado_em IS NULL`),
   igual ao cron de automações já faz, para o ping e o cron nunca dispararem duas
   vezes o mesmo evento.

**Por que não `pg_net`:** resolveria tudo pelo banco, mas exige instalar extensão,
guardar URL e segredo do CRM dentro do Postgres e depender de uma fila assíncrona
nova. Fica registrado como alternativa se o ping do cliente se mostrar
insuficiente.

**Política de falha, diferente da 912:** falha ao gravar o evento **engole com
`WARNING`, sempre** — inclusive com `auth.uid()` presente. A 912 re-levanta
porque perder auditoria é grave; aqui, re-levantar faria o arrasto do card
falhar na cara do operador por causa de uma automação.

⚠️ **O trigger tem de tratar `pipeline_changed` como mudança de etapa também.**
A 912 emite `pipeline_changed` e **não** `stage_changed` quando o card troca de
funil. Um gatilho que só escute `stage_changed` não dispara nesse caso.

### 4.2 Filtro de funil/etapa nos gatilhos existentes

Coluna própria `automations.stage_ids uuid[]`, no mesmo molde de `channel_ids`:

- **Vazio/`NULL` = todas as etapas** (nunca "nenhuma") — a convenção do projeto
  inteiro (`channelInScope`, `findEntryFlow`, `FILTROS_VAZIOS` do inbox).
- Etapa basta, funil é redundante: `(stage_id, pipeline_id)` é único, então a
  etapa já identifica o funil.
- Semântica: "o contato tem negócio **aberto** em alguma dessas etapas".
- ⚠️ Custo: exige consultar `deals`. Fazer **uma** consulta por disparo, e só
  quando existir automação com escopo de etapa — nunca uma por automação.
- ⚠️ Precisa de trigger de limpeza ao apagar etapa, no molde de
  `cb_channels_drop_from_automations` (`903:296-317`), senão sobra UUID órfão.

### 4.3 Ações e condições de funil

- `move_deal_stage` — **um `UPDATE` só** com `pipeline_id` + `stage_id`
  (exigência da 912: em dois updates a trilha conta que o lead saiu e voltou).
  Executa via a RPC `cb_mover_negocio` de §4.1, que carimba a profundidade.
- `set_deal_status` — `won` / `lost` / `open`.
- `create_deal` — passa a chamar `createDeal` de `src/lib/deals/create-deal.ts`.
- **Condição nova `deal_stage`** (e `deal_status`): "o card está na etapa X?".
  Sem ela, o padrão central do print do Kommo — *"movido para a etapa **depois
  de 240 horas** → agir"* — não é exprimível com segurança: vira gatilho de
  etapa → `wait 240h` → **condição "ainda está na etapa"** → ação. O `wait` já
  funciona; é a condição que falta para ele não agir às cegas sobre um card que
  o operador moveu nesse meio-tempo.

**`deal_id` entra no `AutomationContext`.** O evento da caixa de saída carrega o
card exato; o contexto o repassa (e ele sobrevive ao `wait` de graça, como
`channel_id` — JSONB intacto). As ações de funil agem **nesse** card quando ele
existe; para gatilho sem negócio no contexto (ex.: mensagem recebida → mover
card), a regra é **o negócio aberto mais recente do contato (D8)**.

⚠️ **Laço:** mover etapa e atribuir conversa emitem eventos que disparam
gatilhos que podem mover etapa e atribuir conversa. Encadeamento é permitido e
**sem teto (D13)**; a guarda anti-ciclo de §4.1 é o que garante que termina.

### 4.4 Acionar / parar

- `run_automation` — precisa de `runAutomationById()`, que não existe.
- `stop_automation` — precisa de `'cancelled'` no CHECK de
  `automation_pending_executions.status` (`006:129`). **Corrigir junto** o fato
  de desativar automação não parar execução parada em `wait`.
- `run_flow` — exportar/refatorar `startNewRun`, tornar opcional a dependência
  de `ParsedInbound`/`meta_message_id`. Com robô ativo no contato, **o novo
  substitui o atual (D11)**: encerra a run ativa com `end_reason` próprio
  ("substituído por automação") e inicia a nova — o invariante de uma run ativa
  por contato continua de pé.
- `stop_flow` — extrair `send-message.ts:816-828` como
  `abortActiveRunsForContact()` exportado.
- `set_ai` (ligar/desligar na conversa) — escreve `ai_autoreply_disabled`; ao
  **religar, zera `ai_reply_count` e limpa `ai_handoff_summary` (D10)** —
  atualizar o comentário da rota manual que dizia "não-automatizável", que a
  decisão do operador revogou. Config nasce com slot opcional `agent_id`,
  ignorado por ora (D7/§4.7).

### 4.5 Mídia

`send_media` copiando o nó de fluxos, bucket **`chat-media`** (é o que aceita
áudio). Corrigir de passagem o `media_url` que `engineSendMedia` não grava.
**Não** fazer GC do arquivo no envio — o mesmo arquivo serve toda execução.
URL pública permanente **aceita pelo operador (D12)** — sem trabalho de URL
assinada; a ressalva de §2.6 fica como fato registrado.

### 4.6 Tempo (D14) — o que "Agendamento" deveria ter sido

O operador definiu o que tempo precisa significar. São duas peças, e nenhuma é
o `time_based` do upstream (um cron cru sem alvo — **sai do seletor**):

**a) Espera entre passos — já existe, mas é grossa.** O passo `wait` estaciona
TODA espera em `automation_pending_executions` (`engine.ts:285-311`) e quem
acorda é o cron — que roda de 15 em 15 min. "Esperar 30 segundos" hoje significa
"até 15 minutos". Proposta: laço próprio no agendador batendo em
`/api/automations/cron` a cada **60 s** (`docker-stack.yml` — ⚠️ mudança de
infra **manual na VPS**, o CI não sobe serviço; o `CICLO_MINUTOS` das agendadas
não é afetado). Espera mínima efetiva vira ~1 min, e a tela diz isso: o seletor
do `wait` ganha piso de 1 minuto — prometer segundos que não existem é o mesmo
pecado da grade de 15 min da agendada, já resolvido lá.

**b) Gatilho relativo a data de campo — o lembrete de reunião.** O
"24 horas antes — Lead: Reunião Marcada" do print do Kommo. Gatilho novo
(`date_field_offset`): config `{ campo (custom_field_id), offset em horas,
antes | depois }`. Dispara **por contato** cujo valor do campo cruza a janela —
o que responde sozinho o "dispara para quem" que matava o `time_based`. Cada
offset (24h, 12h, 1h…) é uma automação, como no Kommo.

- **Varredura no cron** (15 min bastam para lembrete em horas): contatos com
  valor do campo dentro da janela do ciclo.
- **Dedup por disparo:** tabela própria (faixa 900+) com UNIQUE
  `(automation_id, contact_id, valor_do_campo)`. Reunião **remarcada** (valor
  mudou) re-arma o lembrete — desejável; mesmo valor nunca dispara duas vezes.
- **Guarda de atraso** no molde da agendada: alvo que já passou há mais de 1h
  não dispara — marca e espera gente. Reunião de ontem não recebe "faltam 24h".
- **Campo de data não existe na tela hoje:** o gerenciador só cria
  `field_type: 'text'` (`custom-fields-manager.tsx:112`). Ganha a opção
  `datetime` (a coluna é TEXT livre — sem migration; input `datetime-local`).
- ⚠️ **Fuso fixado na implementação:** o container roda em UTC e o operador
  digita hora de Brasília. Gravar o valor com offset explícito (ISO com fuso),
  senão todo lembrete erra por 3 horas.

Composição de graça: com o filtro de etapa (§4.2), "lembrete só para quem está
na etapa Reunião Marcada" é a soma das duas peças, sem código novo.

### 4.7 Pré-avaliação: agentes de IA nomeados (D7 — fora de escopo)

O que o operador quer um dia: vários chatbots **nomeados** (atendimento geral,
follow-up, satisfação, triagem), cada um com prompt e base de conhecimento
próprios. Estado real e o que faltaria:

- **Hoje:** `ai_configs` é 1 agente padrão por conta + no máximo 1 por canal,
  **sem coluna de nome**, chaveado por `(account_id, channel_id)` — e o
  por-canal nem tem tela/API (`/api/ai/config` fixa `channel_id IS NULL` em
  toda operação). A base de conhecimento é por conta com recorte opcional por
  **canal** (`ai_knowledge_documents.channel_id` + chunks, migration 903), e os
  RPCs `match_ai_knowledge_*` filtram por canal.
- **A feature exigiria:** coluna `name` + trocar os índices únicos da 903
  (1 padrão + 1 por canal) por unicidade por nome; um ponteiro
  `conversations.ai_agent_id` ("qual agente conduz ESTA conversa", NULL =
  resolução atual canal→padrão); knowledge e RPCs re-chaveados por agente
  (`ai_config_id`) em vez de canal; tela de gestão de agentes.
- **O que este plano já faz para não fechar a porta:** o passo `set_ai` nasce
  com slot opcional `agent_id`; qualquer referência futura usa `ai_configs.id`
  — PK estável que já existe, hoje sem nenhum leitor.

---

## 5. Plano por fase (PR)

> D5 escolheu "conexão + funil num PR": **Fases 1 e 2 são o MESMO PR** (mesma
> branch), em duas partes de trabalho — a parte A não depende de migration nova,
> a parte B carrega a caixa de saída. As ações de §4.4 e §4.5 vieram depois da
> decisão e não cabem no mesmo PR sem inchar a revisão — viraram PRs próprios.

### Fase 1 — Conexão (fechar o multi-canal) — **PR 1, parte A**

| | |
|---|---|
| Objetivo | O operador escolhe por onde a mensagem sai, e nenhum gatilho da parte A mente |
| Migration | **nenhuma** |
| Arquivos-chave | `src/components/automations/automation-builder.tsx`, `src/lib/automations/{engine,meta-send,validate}.ts`, `src/lib/contacts/tag-events.ts`, `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts`, `messages/{en,pt-BR}.json` |

- [x] Seletor "Enviar por" (`CanalDeSaida`) nos passos `send_message`,
      `send_template`, `send_buttons`, `send_list` → `step_config.channel_id`.
      Vazio = **herdar** o canal do disparo (rótulo próprio `outboundInherit`,
      nunca "todos os canais", que ali seria mentira). No interativo o
      `InteractiveBuilder` sobrescreve o `step_config` inteiro — o `channel_id`
      é remendado de volta no `onChange`.
- [x] **Aviso de conexão apagada** no seletor de saída
      (`config.outboundChannelGone`), com a escapatória do gate: ele aparece
      **mesmo com menos de 2 conexões** quando há órfão, senão apagar uma
      conexão de uma conta de duas esconderia o erro justo quando ele importa.
      *(Achado da revisão adversarial — eu tinha copiado o seletor da condição
      por canal sem copiar o aviso que ela já tinha.)*
- [x] **B1** — `engineSendInteractive` repassa `preferredChannelId`.
      5 testes novos em `meta-send.test.ts`; **3 deles falham contra o código
      antigo** (conferido), então guardam a regressão de verdade.
- [x] **B2** — `tag_added` passa a carregar canal. `canalDoContato` resolve a
      conversa mais recente **uma vez, no ponto central** (`tag-events.ts`), e
      o fluxo passa `run.channel_id` direto. Best-effort com try/catch: a
      etiqueta já foi gravada quando isto roda, e deixar a busca do canal subir
      transformaria uma escrita bem-sucedida em 500.
- [x] **B4 (revisto por D14)** — "Agendamento" e "Conversa Atribuída" **saíram
      do seletor**. O `useMemo` `opcoesDeGatilho` readiciona o valor corrente se
      a automação já estiver gravada com ele — senão o `<select>` mostraria a
      primeira opção da lista e o save gravaria essa mentira.
- [x] **B6, as duas metades** — servidor: `validateChannelScopeForActivation`
      passou a decidir pelo **canal efetivo do passo**; cliente: `AvisosDeCanal`
      roda a MESMA função ao vivo. 5 testes novos em `channel-scope.test.ts`.
- [x] **B7** — `TriggerCard` consome `useResources()`; uma busca de canais só.
- [x] **B8** — `Automations.builder.delete` nos dois dicionários, e os dois
      `defaultValue` enganosos removidos (o 2º argumento do next-intl são
      valores de interpolação, não fallback).
- [x] **B5 — descartado**, e a razão está em §2.2: a Evolution não envia botão,
      logo não recebe resposta de botão.
- [x] `i18n-parity` (1985/1985) · `typecheck` · `lint` (0 erros; baseline de
      70334 problemas é idêntico ao do `main` limpo) · `test` (**1282** passam,
      106 arquivos — 25 novos)

> **B3 (`conversation_assigned`) mudou para a parte B:** ele dispara pela caixa
> de saída, que é a peça central de lá. **B5 saiu do plano** — reclassificado
> como limitação documentada (ver §2.2).

**Como foi verificado** (2026-08-03):

- **Contrato do servidor, de ponta a ponta na sessão real:** POST criando passo
  com `channel_id` → GET devolve o mesmo id (round-trip pelo `step_config` opaco
  confirmado); PATCH tentando ativar `send_template` fixado num canal Evolution
  → **400** com `path: "steps[0].channel_id"` e a mensagem nova. Este segundo
  caso é exatamente o buraco que o código antigo deixava passar (escopo vazio →
  retornava cedo). Registros de teste apagados; banco de volta a 0 automações.
- **Na tela, com UMA conexão:** aviso de conexão apagada renderizado (o seletor
  se revela apesar do gate, como projetado), botão "Excluir" com texto em vez do
  caminho cru da chave, e o seletor de gatilho com 6 opções.
- **Na tela, com DUAS conexões:** interceptando só a resposta de
  `/api/cb/channels` no navegador (nenhum dado tocado) e navegando por dentro do
  app. Confirmado: "Vale para" = *Todos os canais* e "Enviar por" = *A mesma do
  disparo* aparecem lado a lado com as semânticas opostas corretas; a lista
  oferece as duas conexões; escolher "Comercial Oficial" e salvar grava
  `step_config = {"text":"...","channel_id":"ch-oficial"}` — **conferido no
  banco**. Registro apagado depois.
- **Precedência do canal, por teste** (`stepChannel` é privado, então o teste
  passa pelo motor e observa o que chega ao sender): passo vence disparo;
  sem passo herda o disparo; sem nada cai na conversa; `null` de config antiga
  não apaga o disparo. **Mutação conferida**: invertendo a precedência no
  código, o teste "o canal do PASSO vence o canal do disparo" falha.
- **`resolveEngineChannelPreferring` ganhou os primeiros testes** (6). É ele que
  transforma "o operador escolheu X" em "sai por X", e estava descoberto.
  Cobre: preferido vence a conversa; canal de OUTRA conta não vaza; canal
  apagado falha aberta; preferido apagado + conversa sem canal cai no padrão.

**Pendente para "pronto de verdade":** só o disparo real ponta a ponta — com as
duas conexões na MESMA conta, mensagem chegando pela A e saindo pela B de
verdade, pelo WhatsApp. Todo o resto da corrente está provado.

### Fase 2 — Funil nas automações — **PR 1, parte B**

| | |
|---|---|
| Objetivo | Automação lê e escreve o funil, e "Conversa Atribuída" dispara de verdade |
| Migration | `cb_automation_events` + triggers + RPC `cb_mover_negocio`, `automations.stage_ids`, trigger de limpeza |
| Arquivos-chave | migration nova, `src/lib/automations/engine.ts`, `src/app/api/automations/cron/route.ts`, rota de drain nova, `src/app/(dashboard)/pipelines/page.tsx`, `src/components/pipelines/deal-form.tsx`, `src/components/inbox/message-thread.tsx`, builder |

**Parte B1 — o gatilho (feito em 2026-08-03, migration `933_cb_gatilho_de_funil`):**

- [x] Caixa de saída `cb_automation_events` + trigger em `deals` (INSERT e
      UPDATE OF pipeline_id/stage_id/status), com as guardas de §4.1:
      `IS NOT DISTINCT FROM` no topo, INSERT enfileira, `origem` derivada como
      na 912, `REVOKE ALL FROM anon, authenticated` + RLS sem policy, índice
      parcial nos pendentes, poda de 30 dias. **Política de falha ENGOLE
      sempre** (diferente da 912): re-levantar faria o arrastar do card falhar
      por causa de uma automação.
- [x] `src/lib/automations/drain-events.ts` + rota
      `POST /api/automations/events/drain` + drenagem no cron de 15 min +
      poda. **Reivindicação em dois passos** para as duas pontas nunca
      dispararem o mesmo evento.
- [x] Aviso imediato pelos escritores de navegador via helper único
      (`avisar-drenagem.ts`, `keepalive`, fire-and-forget) — Kanban, save do
      `deal-form` e ganho/perdido.
- [x] Gatilho `deal_stage_changed` ("movido para **ou criado** na etapa") —
      troca de FUNIL tratada como mudança de etapa, que a 912 não emite.
- [x] Gatilho `deal_status_changed` (ganho/perdido/reaberto).
- [x] Recorte `automations.stage_ids` nos gatilhos existentes + trigger de
      limpeza ao apagar etapa (desativa se o escopo esvaziar) + **cópia no
      `duplicate`** + round-trip nas rotas POST/PATCH.
- [x] `deal_id`, `to_stage_id`, `from_stage_id` e `to_status` no
      `AutomationContext` — o evento carrega o card EXATO.
- [x] Tela: seletor de etapas agrupado por funil, nos dois papéis (config do
      gatilho e recorte da automação), com aviso de etapa apagada.

**Parte B2 — as ações (a fazer):**

- [ ] **B3** — gatilho `conversation_assigned` pela caixa de saída (trigger em
      `conversations`; só atribuição real, desatribuir não conta)
- [ ] Ações `move_deal_stage` (via RPC) e `set_deal_status`; `create_deal`
      passa a usar `createDeal`; `assign_conversation` mira a conversa do
      contexto, não todas as do contato
- [ ] Condições `deal_stage` e `deal_status` (§4.3 — o padrão "depois de X
      horas, se ainda está na etapa")
- [ ] **Cadeia anti-ciclo (D13)** e, com ela, remover a trava provisória do
      trigger da 933 que impede card criado por automação de re-enfileirar.
      Ela existe porque o passo `create_deal` já pode girar hoje ("criou card
      na etapa X → cria negócio") e não há guarda ainda.
- [ ] Tela: seletores de funil/etapa nas condições e nas ações

**Pronto quando:** arrastar um card no Kanban dispara a automação em segundos
(não em 15 min); um card criado pelo roteador de entrada dispara "criado na
etapa"; mover entre funis dispara sem a trilha registrar saída-e-volta; e
atribuir uma conversa (na tela ou por automação) dispara `conversation_assigned`
sem entrar em laço.

**Verificação da parte B1** (2026-08-03, no banco de produção, tudo desfeito
depois — 0 automações, 0 logs, 0 eventos, card de volta na etapa original):

- Movi um card de verdade: **1 evento** na fila, com contato, canal e etapas
  de origem/destino resolvidos.
- **A guarda que mais importa:** re-salvei o card mencionando as três colunas
  com os MESMOS valores (é o que o `deal-form` faz ao editar só a anotação) —
  a fila continuou com **1** evento, não 2. Sem ela, editar anotação mandaria
  mensagem ao cliente.
- Automação ativa com gatilho em "Qualificado" + passo `wait` (escolhido de
  propósito: registra log e estaciona **sem enviar nada a cliente**). Movi o
  card para Qualificado → `POST /events/drain` → `automation_logs` com
  `trigger_event = deal_stage_changed` e canal carimbado, e o contexto
  estacionado carregando `deal_id`, `to_stage_id`, `from_stage_id` e
  `channel_id` intactos no JSONB.
- **Negativo:** movi o card para "Lead", que NÃO está na config do gatilho. O
  evento foi entregue ao motor e o `triggerMatches` o descartou —
  `automation_logs` continuou com 1 linha. Isso revelou que o campo
  `disparados` do resultado da drenagem mentia (contava eventos entregues, não
  automações executadas); renomeado para `entregues`, com o porquê no tipo.
- 13 testes novos (`funil.test.ts`): casamento dos dois gatilhos, config vazia
  = qualquer etapa, contexto sem etapa não casa (falha fechada), contexto do
  evento e a guarda de atraso de 1h.

### Fase 2b — Tempo: lembretes por data — **PR 2**

| | |
|---|---|
| Objetivo | Confirmação de reunião e follow-up por horário — as duas peças de §4.6, "essenciais" na palavra do operador |
| Migration | tabela de dedup de disparos (faixa 900+) |
| Arquivos-chave | migration nova, `src/lib/automations/engine.ts`, `src/app/api/automations/cron/route.ts`, `docker-stack.yml`, `docs/DEPLOY-VPS.md`, `src/components/contacts/custom-fields-manager.tsx`, builder |

- [ ] Gatilho `date_field_offset` (§4.6b): varredura no cron + dedup por
      `(automation_id, contact_id, valor_do_campo)` + guarda de atraso de 1h
- [ ] Tipo `datetime` no gerenciador de campos personalizados (valor ISO com
      fuso — ⚠️ container em UTC, operador em Brasília)
- [ ] Laço de 60 s para `/api/automations/cron` no agendador (§4.6a) + piso de
      1 min no seletor do `wait` (⚠️ infra manual na VPS — o CI não sobe serviço)
- [ ] Tela: seletor de campo de data + offset (antes/depois) no card do gatilho
- [ ] Verificações de sempre (i18n-parity, typecheck, lint, test)

**Pronto quando:** contato com "Reunião" amanhã às 10h, numa automação "24h
antes → enviar mensagem", recebe hoje às ~10h (± um ciclo); remarcar re-arma o
lembrete; reunião passada não dispara; e um `wait` de 2 minutos resume em ~2
minutos, não em 15.

### Fase 3 — Orquestração (acionar/parar) — **PR 3**

- [ ] `runAutomationById` + ação `run_automation`
- [ ] `'cancelled'` em `automation_pending_executions` + ação `stop_automation`
- [ ] **Corrigir:** desativar automação passa a impedir o resume de execução parada
- [ ] `abortActiveRunsForContact()` extraído + ação `stop_flow`
- [ ] `startNewRun` exportável + ação `run_flow` (o "Executar Robô X" do print) —
      **substitui** a run ativa (D11)
- [ ] Ação `set_ai` — desligar/religar IA na conversa; religar **zera o
      contador** (D10); slot `agent_id` reservado (D7)
- [ ] Guarda anti-ciclo unificada (D13) para automação→automação→fluxo

### Fase 4 — Mídia — **PR 4**

- [ ] Passo `send_media` (imagem, vídeo, documento, áudio) com upload no builder
      (bucket `chat-media`; URL pública aceita — D12)
- [ ] Corrigir `media_url` não gravado por `engineSendMedia` (defeito herdado dos fluxos)

### Fase 5 — Builder por etapa, estilo Kommo — **PR 5**

- [ ] Painel por etapa dentro de `src/components/pipelines/`, listando e criando
      automações de `deal_stage_changed` daquela etapa
- [ ] Só faz sentido depois da Fase 2 (o gatilho) e da Fase 3 (o "acionar robô")

---

## 6. Armadilhas que valem para qualquer fase

1. **Escopo vazio = TUDO**, nunca "nenhum". Vale para canal, etapa e qualquer
   recorte novo. Uma tela que disser "nenhum" onde o motor lê "todos" faz o
   operador desativar a regra errada.
2. **Seletor some com menos de 2 opções** — convenção do projeto.
3. **Registro sem id mostra travessão**, nunca o padrão da conta.
4. **Filtro não esconde o irrestrito** — automação sem escopo dispara em tudo e
   continua visível sob qualquer filtro.
5. **Toda chave nova entra nos DOIS dicionários na mesma passada.** O fallback do
   next-intl é por arquivo, não por chave: chave faltando vira `MISSING_MESSAGE`
   na tela do usuário.
6. **UUID órfão em JSONB não é limpo por FK.** Apagar canal/etapa/funil deixa o
   id preso no `step_config`/`trigger_config`. Ou trigger de limpeza, ou aviso na
   tela (o builder já faz isso para canal, `automation-builder.tsx:1509-1519`).
7. **Migration nossa na faixa `900+` com prefixo `cb_`.** Rodar
   `ls supabase/migrations/` **e** `list_migrations` imediatamente antes de criar
   o arquivo — os dois já divergiram.
8. **`git push origin main` deploya produção.** Trabalhar em branch saída de
   `main`, PR só para o CB-CRM.

---

## 7. Perguntas em aberto

**Nenhuma.** As oito da primeira versão foram respondidas pelo operador em
2026-08-03 e viraram as decisões **D7–D14** (§3). Dois detalhes foram decididos
de ofício pela implementação e estão sinalizados para veto: a guarda
**anti-ciclo** no lugar do teto de profundidade que o operador recusou (D13,
§4.1) e o **fuso explícito** no valor do campo de data (§4.6b).

---

## Registro de progresso

| Fase | PR | Estado | Branch | Quando |
|---|---|---|---|---|
| 0 — investigação | — | ✅ concluída | — | 2026-08-03 |
| 1 — conexão | 1 (parte A) | 🟡 código pronto, **não commitado** | `feat/automacoes-canal-por-passo` | 2026-08-03 |
| 2 — funil | 1 (parte B) | 🟡 gatilho pronto; **faltam as ações** | `feat/automacoes-canal-por-passo` | 2026-08-03 |
| 2b — tempo (lembretes) | 2 | ⬜ não iniciada | — | — |
| 3 — orquestração | 3 | ⬜ não iniciada | — | — |
| 4 — mídia | 4 | ⬜ não iniciada | — | — |
| 5 — builder por etapa | 5 | ⬜ não iniciada | — | — |

### Histórico

**2026-08-03 — Fase 0, investigação.** Mapeado o motor de automações (8 gatilhos,
13 passos, 5 condições), a tela (1825 linhas, um gatilho por automação, passos em
árvore), o modelo de funil/etiqueta/campo personalizado, a IA, os fluxos e a
mídia. Achados 8 defeitos (B1–B8), sendo 2 gatilhos que nunca disparam. Confirmado
que **todo id já é UUID estável** — o item 4 do pedido não gera trabalho.
Confirmado que o agendador roda de 15 em 15 min e que isso é lento demais para o
gatilho de etapa, o que decidiu o desenho da caixa de saída. Nada implementado.

**2026-08-03 — Revisão do plano (2ª passada).** Correções sobre a 1ª versão:
(1) **B3 mudou da Fase 1 para a Fase 2** — dependia da caixa de saída, que só
nasce lá; a 1ª versão tinha essa dependência invertida. (2) **B5 reclassificado
como não-defeito**: a Evolution não envia botão, logo não recebe resposta de
botão — verificado que `inbound-store.ts` não tem o que parsear. (3) Medido que
**as duas conexões da conta são Evolution** → critérios de pronto ajustados
(Meta-only se prova por teste, não na tela). (4) **B6 dobrou de tamanho**:
verificado que `validateChannelScopeForActivation` ignora `step_config.
channel_id` e retorna cedo com escopo vazio — a validação por canal efetivo do
passo entrou na Fase 1. (5) **Q8 nova**: `time_based` não tem alvo natural
(dispara para quem?); proposta de desenho contactless registrada. (6) §4.1
ganhou as guardas que faltavam (`IS NOT DISTINCT FROM`, INSERT enfileira,
origem/profundidade via RPC + GUC, REVOKE, GC, trigger de conversa só em
atribuição real, fan-out do `assign_conversation`). (7) §4.3 ganhou as
**condições `deal_stage`/`deal_status`** — sem elas o padrão do Kommo "depois
de X horas, se ainda está na etapa" não é exprimível — e o `deal_id` no
contexto. (8) Mapeamento de PRs alinhado à decisão D5 (Fases 1+2 = PR 1).

**2026-08-03 — Rodada de decisões: Q1–Q8 respondidas (D7–D14).** Destaques:
agentes de IA **nomeados** são feature futura, pré-avaliada em §4.7 para o passo
`set_ai` já nascer com slot `agent_id`; encadeamento por automação é **sem
teto**, com guarda **anti-ciclo** (D13); e o operador redefiniu "tempo" (D14) —
o `time_based` cru sai do seletor (a parte A ficou **sem migration**) e nasce o
gatilho **relativo a data de campo personalizado** (§4.6, lembrete de reunião),
promovido a **PR 2 próprio (Fase 2b)** por ser "essencial" na palavra dele —
orquestração, mídia e builder viraram PRs 3/4/5. O `wait` ganha cadência de
60 s no agendador e piso honesto de 1 min na tela. Decisões D8–D12 destravaram
os pontos que faltavam nas Fases 1b/3/4. Nada implementado ainda.

**2026-08-03 — Fase 1 (parte A) implementada.** Branch
`feat/automacoes-canal-por-passo`, saída de `main`, **sem commit e sem migration**.
9 arquivos, +472/−47. Todos os itens da Fase 1 marcados acima.

Achado que muda o enquadramento do pedido original: **nenhuma conta tem 2
conexões** — os dois números estão em contas diferentes (§2.0). O escopo de
canal do gatilho sempre existiu; o operador nunca pôde vê-lo porque o seletor
se esconde com menos de 2 conexões. Nada a corrigir em código.

Revisão adversarial (3 lentes independentes → verificação cética por achado;
17 analisados, 14 refutados, **3 confirmados**):

1. **[alta] Conexão apagada no `step_config` não avisava nada** — achada por
   DUAS lentes independentes. Eu tinha copiado o seletor da condição por canal
   sem copiar o aviso `channelGone` que ela já tinha; o passo voltaria a herdar
   em silêncio e a mensagem sairia pelo número não oficial. **Corrigido**, com
   texto próprio (diz que a mensagem CONTINUA saindo, por outro número — o
   oposto do aviso da condição, que fica inerte) e com a escapatória do gate.
2. **[baixa] O docblock de `channelInScope` passou a mentir** — ele afirmava
   que `tag_added` chega sem canal e que barrá-lo seria regressão; depois do B2
   é justamente o contrário. **Corrigido** (só comentário), estreitando a nota
   para o resíduo que ainda passa livre.
3. O terceiro confirmado é a mesma causa-raiz do nº 1, por outra lente.

Os 14 refutados incluem quatro que pareciam graves e não eram: canal de outra
conta no `step_config` (o resolvedor falha aberta, de propósito e documentado),
regressão no `tag_added` (é a mudança pretendida, B2), e dois pré-existentes em
arquivos que este diff nem toca.

**2026-08-03 — Fase 1: fechamento da verificação.** Restavam duas lacunas, e as
duas eram fecháveis sem conexão nova. (1) **A precedência do canal não tinha
teste nenhum** — nem `stepChannel`, nem `resolveEngineChannelPreferring`, que é
justamente o que transforma a escolha do operador em envio. 10 testes novos, e
a mutação foi conferida: invertendo a precedência, o teste crítico falha.
(2) **O seletor com 2 conexões nunca tinha sido visto** — verificado
interceptando só a resposta de `/api/cb/channels` no navegador, com navegação
soft por dentro do app; a escolha grava no banco. Total: 1282 testes.
Sobra apenas o disparo real pelo WhatsApp, que depende de dado, não de código.

**2026-08-03 — Fase 2, parte B1: o gatilho de funil.** Migration **933**
aplicada em produção (`ls` + `list_migrations` conferidos antes; os dois
diziam 932). Caixa de saída, trigger, drenagem em duas pontas, os dois
gatilhos novos, o recorte por etapa e a tela. 1295 testes.

Dois defeitos meus achados durante a implementação, antes de aplicar:
(1) a busca do canal estava FORA do bloco de exceção do trigger — uma falha
ali derrubaria o arrastar do card, exatamente o que a política de falha
promete impedir; (2) o resultado da drenagem chamava de `disparados` o que era
"entregues ao motor", afirmando que uma automação rodou quando o filtro de
gatilho a tinha descartado.

⚠️ **Trava provisória no trigger:** card criado por automação (`source =
'automation'`) NÃO re-enfileira. O passo `create_deal` já existe e giraria
para sempre ("criou card na etapa X → cria negócio"), e a cadeia anti-ciclo
(D13) só chega com as ações de funil. A linha sai junto com ela.
