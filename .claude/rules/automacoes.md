---
paths:
  - "src/lib/automations/**"
  - "src/components/automations/**"
  - "src/app/*/automations/**"
  - "src/app/api/automations/**"
  - "src/lib/execucoes/**"
  - "src/app/api/cb/execucoes/**"
  - "src/components/pipelines/automations-board.tsx"
  - "src/components/inbox/executar-automacao-dialog.tsx"
  - "src/components/inbox/aviso-de-execucao.tsx"
  - "src/components/inbox/painel/aba-automacoes.tsx"
  - "src/hooks/use-execucoes-*"
  - "src/hooks/use-sinal-de-execucoes*"
---

# Automações — regras

Vale ao mexer no motor (`src/lib/automations/`), no construtor, na grade de
automações do funil, nas execuções da conversa e no desfecho. A mecânica das
esperas ("parar se o cliente responder", presa à etapa, marca de interrupção,
retomada) está em `.claude/rules/automacoes-esperas.md`: abra as duas ao mexer
em `engine.ts`, na fila ou na retomada. Calendly:
`.claude/rules/integracoes-calendly.md`; régua do Asaas:
`.claude/rules/integracoes-asaas.md`. O dreno da fila do funil e o cron
também ENTREGAM e reentregam os avisos `deal.*` ao n8n (só o cron
reentrega): `.claude/rules/webhooks.md`.

### A automação é da CONTA

- ⚠️⚠️ **GET por qualquer membro; PATCH, DELETE e duplicar por qualquer ADMIN
  da conta** (`ctx.accountId` de `requireRole`), nunca `user_id = user.id`
  (decisão do operador, 23/09/2026). O upstream filtra pelo autor, e um
  segundo admin recebia 404 ao abrir, ativar ou duplicar. O #587 do original
  faz o mesmo com piso `agent`: num merge fica o nosso `admin`. Pino:
  `src/app/api/automations/[id]/route.test.ts` (cobra `requireRole('admin')`).
- **PATCH e DELETE levam a conta e conferem as linhas**: zero linhas voltavam
  `ok` e a tela dizia "excluída" sobre a automação intacta.
- **Duplicar copia `channel_ids` e `assinatura_personalizada`**: sem o
  primeiro a cópia vira irrestrita; sem o segundo, assina com o nome da conta.

### O motor (`engine.ts`)

- ⚠️ **`create_deal` chama `createDeal` e confere "um card por contato" ANTES
  do insert**: o índice único da 911 é parcial (`source = 'channel'`) e não
  barra a automação. Desiste em silêncio quando já há card — por isso é o
  passo que vem antes de `move_deal_stage` (que LANÇA sem card) em automação
  que recebe lead novo. A checagem é ler-e-depois-inserir, sem trava: a
  sequência da ingestão (abaixo) a protege entre automações da MESMA
  mensagem; duas mensagens em POSTs diferentes ainda correm, cada uma no seu
  `after()` (e os outros disparadores — Calendly, webhook de entrada, dreno do
  funil — correm com elas), e podem criar dois cards (conhecido, não
  tratado).
- ⚠️ **Na ingestão (webhook da Meta e `inbound-store.ts`), os tipos de gatilho
  rodam EM SEQUÊNCIA, com `await` no laço**, na ordem primeira mensagem →
  contato novo → mensagem/palavra-chave/botão, como o original (#409). Em
  paralelo (`Promise.allSettled`, a forma que ficou do merge de 26/08), as
  mensagens de automações diferentes saíam em qualquer ordem e duas com
  `create_deal` liam "sem card" e criavam dois. Custo: as conferências de
  cada tipo (posse do contato e da conversa, a busca das automações) passam
  a somar em série — dezenas de ms por mensagem. Pino nos testes das duas
  rotas ("em sequência").
- ⚠️ **Título LITERAL do `create_deal` nasce fixado; com `{{…}}` ou vazio fica
  solto** (`tituloFixadoEm`, 1007): o literal é escolha do autor; o
  `{{vars.agendamento_nome}}` tem de seguir a ficha.
- ⚠️⚠️ **`update_contact_field`: valor interpolado VAZIO não sobrescreve campo
  nenhum; NOME grava FIXADO, e valor que não é nome não entra.** O bloco do
  upstream grava o "" e apaga o que a ficha sabia (o Typebot manda "" em toda
  variável não respondida); sem a régua do nome, um telefone digitado entrava
  por cima de um nome fixado e a marca o congelava. Pino:
  `src/lib/contacts/nome-fixado.chamadores.test.ts` (enxerga a chave
  computada `[cfg.field]`). Nome nas telas: `.claude/rules/campos-e-nome.md`.
- **`runAutomationById` aceita `rotuloDoDisparo`**: a execução manual grava
  `'manual'`; sem ele o log diria que outra automação chamou.
- ⚠️ **`dispararAutomacoes` DEVOLVE o que fez** (`ResultadoDoDisparo`:
  candidatas, fora do escopo, executadas, com falha, em espera, erro);
  `runAutomationsForTrigger` continua `void` para os chamadores do upstream.
- ⚠️⚠️ **Gancho `antesDeExecutar`**: chamado UMA vez, depois dos recortes de
  canal, gatilho e etapa, antes da primeira automação que passou. Quem precisa
  de "só se alguma automação vai rodar" usa o gancho, nunca uma cópia dos
  recortes.
- ⚠️ **`executeAutomation` passa uma CÓPIA de `input.context`**: o objeto é o
  mesmo para todas as automações de um disparo, e o card fixado por uma
  vazaria para a seguinte.
- ⚠️⚠️ **Passo que falha ENCERRA a execução, inclusive dentro de um ramo de
  condição**: o ramo devolve o status do escopo e o de fora marca `failed` e
  para. "Aguardar" dentro de ramo sobe como `partial` no retorno mas NÃO
  segura o escopo de fora (semântica do upstream). Pinos: `engine.test.ts`
  ("ramo e espera"), cujo mock de `automation_steps` recorta por escopo por
  causa deles.
- ⚠️ **`close_conversation` zera `assigned_agent_id`**: encerrar SOLTA o
  responsável (decisão do operador), senão quem reabre herda o dono velho.
  Ele fecha TODAS as conversas do contato. Quem reabre e com que dono:
  `.claude/rules/ingestao.md`.
- ⚠️ **Remetente novo do robô confere a conversa por conta**
  (`assertConversationInAccount`, ANTES do canal e do provedor), em
  `engine.ts` e nos dois `meta-send.ts`. Pino:
  `src/lib/whatsapp/conversation-scope.chamadores.test.ts`.

### Variáveis (`interpolate`)

- ⚠️ **`interpolate` é ASSÍNCRONO** e conhece
  `{{contact.name|phone|email|company|link}}`,
  `{{contact.campo.<field_key>}}`, `{{contact.origem}}`,
  `{{conversation.link}}`, `{{deal.value}}`, `{{deal.created_at}}` e
  `{{now}}`. A chave do campo é a `field_key` do catálogo, não o nome exibido;
  `contact.origem` junta só as partes preenchidas; links usam
  `NEXT_PUBLIC_SITE_URL`.
- ⚠️ **O contato é carregado UMA vez por execução (`WeakMap` por `args`) e só
  quando o texto cita `contact.`/`conversation.`**: sem a guarda, todo
  `send_message` pagaria três consultas.
- ⚠️ **O negócio (`deal.*`) é lido a cada passo que o cita, SEM cache**: o valor
  muda durante um "Aguardar", e na execução à mão o card só entra no contexto
  no primeiro "Mover card". É o de `negocioAlvo`, com queda SÓ DE LEITURA no
  GANHO mais recente (senão a execução sobre cliente ganho mandava valor
  vazio). `deals.value` é NOT NULL DEFAULT 0: sem valor, sai 0.
- **Dois modos**: na mensagem, formatado ("R$ 3.500,00", "30/08/2026 às
  16:00h"); no dado (`update_contact_field`, `send_webhook`), cru (`3500`, ISO
  em UTC).
- ⚠️⚠️ **O corpo do `send_webhook` ESCAPA cada valor (`json: true`)**: uma aspa
  ou quebra de linha num nome quebrava o JSON e o passo falhava. Consequência:
  variável só DENTRO de string no modelo (`"valor": "{{deal.value}}"`).

### O card do negócio (`negocioAlvo`)

As regras de ganho/perdido e o gatilho de resultado estão em
`.claude/rules/funil.md`.

- ⚠️⚠️ **Alvo = o card ABERTO mais recente; sem aberto, o PERDIDO — menos
  quando o contato tem card GANHO** (é cliente: o formulário público reabriria
  o perdido antigo dele). O GANHO nunca é alvo de escrita.
- ⚠️ **"Ganho nunca é alvo" protege só o card FECHADO como ganho.** Os cards do
  Jurídico ficam ABERTOS (o operador os move lá sem fechar), então são alvo
  normal: o "Mover card" do Calendly de um cliente do Jurídico que marca
  reunião arrasta o card do caso para o comercial. Não tratado. Automação
  disparada por evento de funil não é afetada (carrega o card no contexto).
- ⚠️ **Escopo (`stageInScope`) e estadia (`so-na-etapa.ts`) olham só card
  ABERTO; as CONDIÇÕES de etapa e status usam o MESMO alvo das ações** —
  decisão: a automação do Typebot só puxa o desqualificado porque
  `deal_stage == Desqualificado` enxerga o perdido. Quem quer agir só com card
  aberto soma `deal_status == open`.
- ⚠️⚠️ **Toda escrita confere o status esperado** (`p_status_esperado` da RPC
  `cb_atualizar_negocio`): o que a busca viu, ou o que a execução gravou por
  último (`context.deal_status_fixado`, devolvido pela RPC). Sem isso, o card
  marcado ganho durante um "Aguardar" voltava ao comercial. Só o card do
  EVENTO de funil, antes da primeira escrita, vai sem conferir. A recusa
  encerra a execução com o motivo.
- ⚠️ **Nunca ler o status no motor e mandar `p_status: 'open'` depois**: o ganho
  marcado no meio seria sobrescrito. A reabertura do perdido é um CASE dentro
  do UPDATE da RPC (1031).
- ⚠️⚠️ **O card fica FIXADO no contexto no primeiro "Mover card"/"Marcar
  status"** (`deal_id` + `deal_status_fixado`), e os dois viajam para o
  "Aguardar" e para a automação acionada. Sem isso, depois de um passo que
  FECHA o card, o seguinte cairia no perdido de outro funil do contato.
- A conferência "tem ganho?" é uma ida ao banco antes da escrita: outro card
  ganho no mesmo instante não é visto. Aceito por escrito.

### Gatilhos e validação

- ⚠️ **`GATILHOS_SEM_DISPARO`** (`trigger-meta.ts`: `time_based`,
  `conversation_assigned`) não têm call site e não ganham cartão na grade. Há
  teste amarrando a lista ao `TRIGGER_OPTIONS` do construtor.
- ⚠️⚠️ **Os gatilhos da régua do Asaas (`asaas_cobranca_vencida`,
  `asaas_cobranca_vence_hoje`) casam SÓ com o `automation_id` do contexto**
  (`triggerMatches`): por tipo, a de 5 dias rodaria junto com a de 1.
  `runAutomationById` (botão e passo `run_automation`), o diálogo de executar
  e `POST /api/automations/engine` recusam esses gatilhos.
- ⚠️⚠️ **Nesses dois gatilhos, `validate.ts` exige `channel_id` em todo
  `send_message`/`send_media` (o MESMO, inclusive nos ramos) e pelo menos um
  `send_message`, e recusa em qualquer escopo "Aguardar", `run_automation`,
  `run_flow`, `send_template`, `send_buttons` e `send_list`.** A filha tem log
  próprio e pode retomar sem reconferir o pagamento; o passo só-Meta sai por
  conexão que ninguém sondou. Vale na ativação e na edição, não
  retroativamente. O seletor de conexão aparece sempre (`reguaDoAsaas` no
  contexto do construtor), e o motor LANÇA em vez de cair no padrão
  (`resolveEngineChannelPreferring` cai em silêncio: o link de pagamento
  sairia por outro número).
- **"Assinar como" (`assinatura_personalizada`)** é prefixo de todo
  `send_message` da automação, sob o interruptor `assinatura_ativa` da conta.
- **Gatilho novo precisa de `triggers.<tipo>.label` nos dois dicionários**:
  chave montada escapa do portão do CI. Pino:
  `src/lib/automations/rotulo-do-gatilho.test.ts`.
- **`formatRelative` usa `Intl.RelativeTimeFormat`** e recebe o texto de
  "nunca": devolvia `5m ago`/`never` em inglês.

### `send_to_number` (avisar outro número)

- ⚠️⚠️ **NÃO herda o canal do disparo** (ao contrário de `send_message`): o
  canal do disparo é por onde o CLIENTE escreveu. `channel_id` ausente = a
  conversa do número avisado, senão o padrão; preenchido = aquele número,
  falhando FECHADO.
- ⚠️ **Sai por `engineSendText` (robô)**: não roteia para funil nem reabre
  conversa. Ficha e conversa do avisado nascem por `resolverDestinatario`, com
  o DONO da conta (allowlist de `dono-duravel.test.ts`). Não usar
  `resolveConversationByPhone`: importa o motor (ciclo) e RENOMEIA contato
  existente.
- ⚠️ **O telefone passa por `telefoneDigitado`** na validação, no motor, no
  resumo do passo e no campo da tela: sem DDD, letra ou 0 de tronco são
  recusados na ATIVAÇÃO, com o motivo (com `digitosDoTelefone`, o aviso ao
  advogado saía para +98). Pino:
  `src/lib/contacts/telefone-digitado.chamadores.test.ts`.

### O construtor e as esperas

A mecânica está em `automacoes-esperas.md`; aqui fica o que vive no construtor
e no `validate.ts`.

- ⚠️⚠️ **A ÚNICA porta de nascimento da automação de etapa é o `?stage=` da
  grade do funil** (`TRIGGER_OPTIONS` não oferece `deal_stage_changed`; ele só
  volta à lista para automação já gravada com ele). O `?stage=` semeia o
  gatilho e `parar_ao_sair: true` (decisão do operador, 18/09/2026: nasce
  MARCADA nas novas; há pino). O seletor de etapas do construtor NÃO semeia ao
  editar: ligaria a interrupção numa regra antiga por um re-pique de etapa.
- ⚠️⚠️ **Só o booleano `true` liga `parar_ao_sair` e a caixa do "Aguardar"** —
  no motor, na grade, no construtor e em `validate.ts`. `"true"` e `1` chegam
  de JSONB e são truthy: a caixa apareceria marcada e o motor a ignoraria.
- **A caixa "Parar a automação se o cliente responder" mora no passo
  Aguardar**, com sufixo no resumo do cartão fechado. Merge que traga o bloco
  `wait` do motor cru a deixa de enfeite.
- **`descrever-passo.ts` tem a chave `wait_<unidade>_ou_resposta`**: as quatro
  variantes estão em `VARIANTES` do teste, que cobra os dois dicionários.
- ⚠️ **O voltar do construtor passa por `voltaDoConstrutor(origem)` e o
  `router.replace` depois de criar por `urlDoConstrutor({ id, origem })`**
  (`src/lib/pipelines/url.ts`): aberto pela grade (`?de=funil&funil=<id>`),
  volta à aba Automações DAQUELE funil. O `router.push("/automations")` do
  upstream devolve o bug sem conflito. Pino: `src/lib/pipelines/url.test.ts`.
- **A tela de registros pinta `skipped` NEUTRO** (`StepRow`, traço cinza):
  "parou porque o cliente respondeu" e condição de ramo vazio não são erro.
- ⚠️ **A tela de registros troca id por nome NA TELA** (`registro-legivel.ts`),
  nunca no motor: vale para os registros antigos e mostra o id que o passo
  USOU. Id sem nome só vira "(etapa apagada)" se aquele catálogo carregou;
  consulta que falhou deixa o id cru.

### A visão Automações do funil

`grade-do-funil.ts` e `descrever-passo.ts` (puros, com teste), `por-etapa.ts`
(a classificação) e `automations-board.tsx`. É desenho de dado: recorte por
etapa se mexe nos módulos, não no componente.

- ⚠️ **A LARGURA do cartão É a lista de etapas** ("Expandir" grava mais
  etapas). Não há coluna de banco para isso e não deve haver.
- ⚠️ **`trigger_config.stage_ids` VAZIO dispara em TODA etapa** (`triggerMatches`):
  é o cartão de largura total, em roxo. Listar só quem nomeia a coluna diria
  "nada acontece aqui" com o motor disparando.
- ⚠️ **Etapas NÃO vizinhas viram VÁRIOS cartões**, cada um com "também vale em
  outras etapas": um retângulo da 1 à 3 afirmaria que vale na 2.
- ⚠️ **São DUAS listas com significados opostos**: `trigger_config.stage_ids` =
  "para qual etapa o card tem de ENTRAR"; `automations.stage_ids` = "em qual
  etapa precisa ESTAR" (escopo). Trocar o gatilho esconde o seletor de escopo
  mas não limpa o valor — daí o grupo "Nunca dispara aqui".
- ⚠️ **Criar pela grade preenche só o GATILHO, nunca o escopo**: preencher os
  dois é como se fabrica automação morta.
- **Três tipos de cartão (`CartaoDaGrade.tipo`)**: `gatilho` (largura =
  `trigger_config.stage_ids`, "dispara ao entrar"), `chegada` (automação de
  outro gatilho que LEVA o card à etapa pelo `move_deal_stage`/`create_deal`;
  uma coluna, sem expandir) e `escopo` (largura = `automations.stage_ids`:
  dispara em outro lugar e só roda enquanto o card está aqui). Automação de
  gatilho de etapa não ganha cartão de chegada nem de escopo.
- ⚠️⚠️ **Toda automação que roda num funil aparece na aba daquele funil**
  (decisão do operador, 20/09/2026) — mas **escopo VAZIO não vira cartão**: no
  motor é "qualquer etapa", e na aba seria um cartão de largura total por
  regra manual e cobrança da conta. "Não pertence ao funil" se afirma não
  desenhando.
- ⚠️⚠️ **O "expandir" edita a lista DO CARTÃO** (`campo: 'gatilho' | 'escopo'`
  no estado do diálogo), nunca adivinhada pelo tipo de gatilho: gravaria na
  lista errada em silêncio. Desmarcar tudo num cartão de escopo tira a
  automação da aba, e a caixa avisa antes (`escopoVazioAviso`).
- **O raio (`contarAtivasNaEtapa`) conta só o que DISPARA na etapa e está
  LIGADO**: contar a pausada põe número onde nada acontece.
- ⚠️ **`descrever-passo.ts` devolve CHAVE + valores, nunca texto pronto**, e o
  teste cobra uma chave por tipo de passo nos dois dicionários: passo novo sem
  chave imprime `Pipelines.automacoes.resumo.send_x` cru no cartão.
- **Id órfão vira "(apagado)"**, nunca o UUID. **A consulta de automações NÃO
  filtra por funil**: a regra irrestrita vale para todo funil.
- **Há teste comparando `classificarNaEtapa` com o `triggerMatches` real** do
  `engine.ts`: mudou a regra do motor, ele quebra.

### Execuções na conversa (955)

Aba "Automações" do painel (robô ativo + esperas, com Parar e linha do tempo) e
"Executar automação" no menu + do compositor. `src/lib/execucoes/` (puro),
rotas em `/api/cb/execucoes`. A presença por conversa está em
`.claude/rules/inbox-conversa.md`.

- ⚠️ **As duas fontes da aba têm naturezas diferentes**: `flow_runs` lido sob
  RLS com realtime; as esperas pela rota GET, porque
  `automation_pending_executions` é service-role only — **não abrir policy de
  SELECT**. A aba recarrega por ação e pelo evento `cb:execucoes-mudaram`.
- ⚠️ **Parar espelha o motor**: esperas viram `cancelled` com as cercas do
  `stop_automation` (automação + conta + CONTATO + `pending`; sem o contato
  pararia a conta inteira); o robô encerra por `abortActiveRunsForContact` com
  `stopped_by_agent` — pessoa que DECIDIU, distinto de `paused_by_agent`
  (respondeu) e `stopped_by_automation` (regra).
- ⚠️⚠️ **A rota `executar` checa canal E etapa; o motor não.**
  `runAutomationById` pula recortes de chamador explícito, mas aqui é um
  clique: a restrita ao número A executada na conversa do B sairia pelo número
  errado. Canal falha ABERTO como o motor (conversa sem canal passa; o diálogo
  manda `conversation.channel_id ?? null` cru, de propósito). Etapa
  (`stageInScope`): erro de consulta passa; contato SEM negócio leva 422
  `stage_out_of_scope`. Grupo é recusado; o log ganha `trigger_event='manual'`.
- **Linha do tempo**: os futuros são os passos do MESMO escopo da espera
  (`parent_step_id` + `branch`, de `next_step_position` em diante); condição
  aparece como "depende da condição" e os passos dentro dos ramos ficam FORA
  (afirmar um ramo seria mentir). Rótulos por `descreverPasso`.

### Passo que falha volta para a fila (retentativa)

`src/lib/automations/retentativa.ts` (puro, com teste) e o `catch` de
`executeStepsFrom`. A régua é o ERRO, nunca o tipo do passo.

- ⚠️⚠️ **Só repete falha do PROVEDOR num passo de ENVIO, com RECUSA COMPROVADA
  (4xx).** Erro do próprio motor (configuração, banco, contato sem telefone)
  nunca volta: repetir erro determinístico só adia o aviso.
- ⚠️⚠️ **4xx × 5xx não é burocracia**: "recusou" (nada saiu) e "tempo esgotado"
  (pode ter saído) têm o mesmo texto, e repetir o segundo manda a mensagem
  DUAS vezes. Quem responde é `EvolutionApiError.status`, que chega inteiro ao
  motor porque `flows/meta-send.ts` o propaga cru.
- ⚠️ **Só a Evolution retenta.** `MetaApiError` tem status, mas o 4xx da Meta
  costuma ser determinístico (janela fechada, número que não recebe): ligar a
  Meta pediria régua por `code`. Decisão do operador (24/09/2026): fica de
  fora, e a régua falha FECHADA para a Meta.
- ⚠️ **`PASSOS_DE_ENVIO` é allowlist**: passo novo nasce SEM retentativa até
  alguém decidir por escrito. `send_webhook` fica fora (o n8n pode já ter
  criado o registro). Pino: `retentativa.test.ts`.
- ⚠️ **Volta para a fila do "Aguardar" na posição do PRÓPRIO passo** (o
  "Aguardar" enfileira `position + 1`); o contador mora no `context`.
- ⚠️⚠️ **O contador é amarrado à POSIÇÃO (`{ pos, n }`)**: um número solto
  deixaria o próximo passo a falhar nascer no teto, sem retentativa.
- ⚠️ **O teto (3 tentativas; 30 s e depois 5 min) é testado ANTES do tipo do
  passo**: invertido, um provedor que recusa sempre reenfileiraria para
  sempre, sem ninguém ver a falha.
- ⚠️ **Fila que recusa a linha = falha na hora**, nunca "vai tentar de novo"
  (ficaria `partial` para sempre, invisível). Em retentativa a execução fica
  `partial`, o que impede `fecharLog` de carimbar desfecho.

### Desfecho da execução (985)

`automation_logs.desfecho` (`concluida` | `barrada` | `falhou`) +
`finalizado_em`; `estado-da-execucao.ts` e `src/lib/execucoes/desfecho.ts`
(puros), `use-execucoes-do-fio.ts`, `aviso-de-execucao.tsx`, "Já rodou" na aba
e a marca na lista e no card por `/api/cb/execucoes/resumo`.

- ⚠️⚠️ **`status` NÃO responde "como terminou?"**: nasce `'failed'` no INSERT,
  antes do primeiro passo, e termina `'success'` quando uma condição desvia
  para ramo vazio. O vocabulário novo mora em coluna PRÓPRIA porque `status`
  tem consumidores que o TypeScript não cobre.
- ⚠️⚠️ **`fecharLog` é o ÚNICO escritor das duas colunas**, com a guarda "não
  sobrou espera VIVA deste log — MENOS a que está sendo processada agora".
  Sem a exceção, a retomada vê a própria espera `running` e nunca fecha: toda
  automação com "Aguardar" some do fio.
- ⚠️⚠️ **São DUAS escritas**: o desfecho com a cerca anti-regressão
  (`desfecho.is.null,desfecho.neq.falhou`) e a hora de fim em update PRÓPRIO,
  sem cerca. Juntas, a cerca recusa a linha inteira quando já diz `falhou`, e
  a falha fica sem hora de fim — invisível.
- ⚠️⚠️ **São TRÊS fechadores, e todos somam o histórico GRAVADO**: os contadores
  do motor (`fezTrabalho`/`barrouPorCondicao`) só conhecem uma chamada, e a
  retomada começa zerada. O escopo raiz soma `sinaisDoHistorico(...)` (que
  `appendResults` devolve); o raiz SEM passos (o "Aguardar" era o último) e a
  retomada de RAMO leem por `sinaisGravados`. Sem isso,
  `[enviar][aguardar][condição vazia]` fechava `barrada` sobre execução que já
  falou com o cliente.
- ⚠️ **`barrada` é ESTREITA**: só quando nada foi feito. O critério é "fez
  trabalho?", nunca `steps_executed.at(-1)` — a ordem não é cronológica
  quando há ramo cheio.
- ⚠️ **A régua do fio é PURA (`itensDoFio`)**: descarta o que não tem desfecho,
  colapsa por (automação, dia local, desfecho) com contador, teto de 12. Sem o
  colapso, o gatilho "mensagem recebida" dobra o fio.
- ⚠️ **O motivo CRU do motor NÃO vai para o fio** (inglês, com id): fica na aba,
  numa expansão.
- ⚠️ **Quem mexe na fila avisa a tela por `cb:execucoes-mudaram`**
  (`src/lib/execucoes/aviso.ts`, fora dos hooks para `avisar-drenagem.ts` não
  arrastar React). A drenagem do funil o emite quando a rota responde.
- ⚠️ **A marca "tem robô rodando" lê a FILA, pela rota**: só a fila sabe o que
  ainda vai rodar, e do navegador ela devolve 0 linhas com `error: null`.
  Erro vira 500, nunca `{}`; o hook devolve `null` (não sei).
- ⚠️ **O card do funil recebe um NÚMERO por prop**, nunca um hook: o `memo` dos
  ~120 cards só segura com props estáveis.
- **Cor de texto em par claro/escuro** (`text-red-700 dark:text-red-300`),
  escolhendo a PRIMEIRA cor para valer nos dois modos: o `dark:` está inerte
  (ver `.claude/rules/ui.md`).
- **Nada retroativo**: execução anterior à 985 fica sem desfecho e não aparece
  (carimbar `created_at` mentiria em toda automação com espera).
