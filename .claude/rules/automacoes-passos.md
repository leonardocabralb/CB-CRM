---
paths:
  - "src/lib/automations/engine*"
  - "src/lib/automations/meta-send*"
  - "src/lib/automations/validate*"
  - "src/lib/automations/templates*"
  - "src/lib/automations/parametros-do-modelo*"
  - "src/lib/automations/responsavel-da-tarefa*"
  - "src/lib/automations/janela-da-meta*"
  - "src/lib/automations/hora-do-dia*"
  - "src/lib/automations/sem-conversa*"
  - "src/lib/automations/condicao-por-campo*"
  - "src/lib/automations/nao-repetir*"
  - "src/components/automations/automation-builder.tsx"
  - "src/components/automations/condicao-por-campo-fields*"
---

# Automações — passos com regra própria

Vale ao mexer no "Enviar modelo", no "Criar tarefa" pelo responsável, nas
condições "Janela de 24h da Meta aberta", "Hora do dia" e "Campo
personalizado da ficha", no "Aguardar até estar dentro do horário" (Fase 2
do plano do previdenciário, 26/09/2026), no "Aguardar N sem conversa"
(03/10/2026), no "Fixar a conversa no número" e na opção
"Não repetir para o mesmo contato por N horas" do gatilho. As regras são puras e testadas:
`parametros-do-modelo.ts`, `responsavel-da-tarefa.ts`, `janela-da-meta.ts`,
`hora-do-dia.ts`, `sem-conversa.ts` e `condicao-por-campo.ts`, em
`src/lib/automations/`.
O resto do motor: `.claude/rules/automacoes.md`; o mapa da janela por número:
`.claude/rules/canal-na-conversa.md`. O nó "Atlas" (cinco ações, uma entrada
no menu): `.claude/rules/integracoes-atlas-acoes.md`.

### Enviar modelo (`send_template`)

- ⚠️ **O CORPO é POSICIONAL** (`body[N-1]` é o `{{N}}`), cada valor passa pela
  interpolação do motor e tem texto de RESERVA para quando sai vazio (a Meta
  recusa parâmetro vazio). A versão do upstream ordenava as chaves e
  compactava as lacunas. Posição acima de 50 é ignorada no motor e recusada na
  ativação (um laço por posição).
- ⚠️ **O que FALTOU é conferido em `sendViaMeta` (`faltaNoModelo`)**, ANTES da
  Meta: só lá a linha do modelo é conhecida (o catálogo é por WABA). E
  `recortarAoModelo` corta o que SOBROU: corpo além dos `{{N}}` (o construtor
  emite `body` com lista vazia num modelo sem variável) e parâmetro de botão
  que não é URL com `{{1}}` (trocaria o `payload` da resposta rápida).
- ⚠️ **A tela escolhe a linha do modelo por `linhaDoModeloNaTela`, ESPELHO de
  `resolveTemplateRow`** (a do envio). Mudou um, muda o outro — senão o
  operador preenche os campos de um modelo e o envio usa outro.
- **Botão de URL**: o valor SUBSTITUÍDO sai codificado (`interpolate` com
  `url: true`); o literal do operador, não. `{{deal.*}}` é lido UMA vez por
  passo (`interpolate` com `negocio`), não uma por variável.

### Criar tarefa pelo responsável

- ⚠️ **`assigned_agent_id` é id de LOGIN; `deals.assigned_to` é
  `profiles.id`** — o motor traduz pelos membros. Trocar dá "ninguém" sem erro.
- ⚠️ **A RESERVA é OBRIGATÓRIA na ativação** nos modos `conversa`/`card`.
  Medido em 26/09/2026: nenhum card tem `assigned_to` (só o formulário do
  negócio o grava). Opcional, a tarefa falhava de madrugada e o `break` do
  motor parava as mensagens seguintes ao cliente. O motor ainda FALHA com o
  motivo (nunca o autor da regra) quando não há reserva que sirva; o registro
  diz POR QUÊ a tarefa foi para a reserva (`fraseDaEscolha`).

### Condição "Janela de 24h da Meta aberta"

- ⚠️ **As mensagens do "Sim" precisam sair pelo número que a condição
  pergunta.** Em branco ela pergunta pelo do disparo; texto do "Sim" FIXADO
  noutro número oficial faria "sim" sobre a janela errada, e a Meta recusaria
  o texto (131047) com o passo concluído. `validateChannelScopeForActivation`
  recusa a divergência (e o construtor mostra ao vivo). O seletor lista só
  números oficiais: QR Code é sempre "sim", Instagram sempre "não".
  ⚠️ Vale também para o texto que HERDA o disparo com o operando preenchido
  (Codex, PR #315): ele sai pelo número de onde o disparo veio. Só passa
  quando todo número oficial que o escopo alcança é o próprio operando
  (escopo vazio = a conta inteira; QR Code no escopo não conta).
- **Erro de leitura responde "não"** (o modelo é o lado seguro) e o registro
  diz `janela não conferida`, para o "não" não parecer medido.

### Condição "Hora do dia" (`time_of_day`)

- ⚠️ **A hora e o dia são os do FUSO DO ESCRITÓRIO** (`avaliarHoraDoDia`, por
  `partesNoFuso`). O upstream lia `getHours()` do processo, e o contêiner roda
  em UTC: a janela valia três horas antes, e o "Out of Office" respondia às
  15h. Há pino reprovando `getHours`/`getMinutes`/`getDay` em `engine.ts`.
  ⚠️ `executeStepsFrom` DESVIA a hora antes de `evaluateCondition` (para
  gravar a nota): o `case 'time_of_day'` de lá é cópia, e o pino vigia o
  desvio.
- **O operando continua `"HH:mm-HH:mm"`** (compatível com o gravado; o
  upstream aceitava "9-18", segundos ignorados e "24:00" no fim, e continua
  valendo). O início conta e o fim não; início maior que o fim atravessa a
  meia-noite; início igual ao fim é janela VAZIA (sempre "não", como antes) e
  a ativação recusa o que o motor não lê. "O dia inteiro" é
  `"00:00-24:00"` — uma caixa na tela, porque os campos de hora não escrevem
  24:00.
- **`somente_seg_a_sex`** (só `true` liga): na janela que atravessa a
  meia-noite, a madrugada é do dia em que a janela COMEÇOU. Feriado não entra
  — o rótulo diz "segunda a sexta", não "dia útil" (a régua do Asaas tem
  `ehDiaUtil`, com feriados fixos, se um dia pedirem).
- O registro da condição diz a hora lida (`hora no escritório: sex 20:59`).
- O modelo pronto "Out of Office" (`templates.ts`) pergunta pelo EXPEDIENTE
  (`09:00-18:00`, segunda a sexta) e responde no "Não" — o `18:00-09:00` do
  upstream calava no fim de semana de dia.

### "Aguardar até estar dentro do horário" (`wait` com `modo: 'horario'`)

Decisão "B6a" do operador: a cadência da pré-qualificação só manda lembrete
das 8h às 21h; o que cairia fora sai UM só no início seguinte, e a contagem
segue dali (`Aguardar 1 h → Aguardar o horário → lembrete → …`).
`esperaPeloHorario` e `proximoInicioDaJanela` (`hora-do-dia.ts`).

- **Dentro da janela, segue na hora sem estacionar** (o registro diz
  `dentro do horário (sex 10:00); segue`); fora, estaciona até o PRÓXIMO
  início (`fora do horário (sex 22:40); aguarda até seg 08:00`). "Dentro" é
  `avaliarHoraDoDia` — a mesma janela, a mesma madrugada e o mesmo
  "segunda a sexta" da condição. Janela ilegível FALHA o passo (o lado
  seguro) e a ativação a recusa; o dia inteiro passa.
- ⚠️ **O próximo início anda por DIAS DE CALENDÁRIO do escritório**
  (`diaNoFuso` + `somarDias` + `paraInstante`), nunca soma 24 h a um
  instante (erra uma hora no horário de verão). Sempre ESTRITAMENTE depois
  de agora: estacionar num instante passado faria o agendador girar em falso.
- ⚠️ **É o MESMO estacionamento do "Aguardar" comum**: `cb_estacionar_espera`,
  `contextoDaEspera` (a marca "parar se o cliente responder" vale nesta
  espera; a estadia na etapa é conferida antes do passo e na retomada) e
  retomada em `position + 1`. A janela NÃO é reconferida ao acordar: com o
  agendador parado das 21h em diante, o passo seguinte sairia atrasado. E a
  retentativa de um envio que falhou às 20:59 pode sair depois das 21h.
- **`amount`/`unit` continuam gravados no modo horário** (voltar para "por
  um tempo" devolve o valor) e são IGNORADOS por motor, validação e resumo.
  Voltar para o tempo TIRA `janela` e `somente_seg_a_sex`.
- Resumo: chaves `wait_horario[_seg_a_sex][_ou_resposta]` nos dois
  dicionários (cobradas por `descrever-passo.test.ts`). A régua do Asaas
  continua recusando todo "Aguardar", este incluso.

### "Aguardar N sem conversa" (`wait` com `modo: 'sem_conversa'`, 03/10/2026)

Pedido do operador (funil Trabalhista): o card das etapas de demissão vai à
Recuperação "15 dias depois da ÚLTIMA troca de mensagens, de qualquer lado".
O "Aguardar" comum conta do início, e o "parar se responder" só vê o CLIENTE
e encerra em vez de recomeçar. `sem-conversa.ts` (puro + a leitura).

- ⚠️⚠️ **Estaciona na posição do PRÓPRIO passo** (o +0 da retentativa, que
  `decidirRetomada` já trata) e, ao acordar, RODA DE NOVO: a recontagem se
  reconhece por `esperaEmCurso` + `_passo_da_fila.id` = o passo
  (`ehRecontagemDaEspera`); sem os dois, é CHEGADA. No +1 do comum, a
  reconferência nunca rodaria.
- **Prazo = N a partir do mais recente entre a chegada e a última
  mensagem**: a chegada não lê a conversa (espera N inteiro); ao acordar,
  segue com N de silêncio desde a última, senão estaciona até `última + N`.
- ⚠️ **Toda linha de `messages` conta** (cliente, equipe pelo CRM e pelo
  celular, robô, ligação, apagada), em todas as conversas do contato na
  conta: a mensagem do celular não passa pelo motor, só a leitura a vê.
  Pelo `gravada_em` (relógio do BANCO); `created_at` só na sem ele (carga):
  pelo do aparelho, celular adiantado prenderia a espera até aquela data. A
  de carga datada no FUTURO fica de fora (`lte` na leitura): contada como
  agora, cada despertar adiaria N de novo até a data passar.
- **"Parar se o cliente responder" não vale**: o motor ignora a caixa
  (`esperaParaSeResponder`: sem marca na fila), a ativação recusa a combinação
  (`espera_sem_conversa_com_resposta`) e o construtor a esconde — menos
  quando veio marcada de fora, para ser desmarcada.
- ⚠️ **Leitura que falha FALHA o passo** (`MOTIVO_CONVERSA_NAO_CONFERIDA`),
  visível: seguir agiria sobre quem pode estar conversando.
- Resumo `wait_sem_conversa_<unidade>` nos dois dicionários; o registro sai
  em português, no fuso do escritório ("houve conversa em 10/10 09:00;
  aguarda até 25/10 09:00"), e o "Já rodou" o mostra como está.
- **A aba Automações da conversa** não lista a própria espera como próxima
  (`linha-do-tempo.ts`): ela só se reconfere ao acordar.
- **Limites aceitos**: trocar o modo com a execução parada (sem conversa →
  tempo) espera N a mais; com gatilho de MENSAGEM, cada mensagem abre uma
  execução e todas convergem em `última + N` — usar "Não repetir por N
  horas" ou gatilho de etapa.
- **Rollback do deploy** com automação ligada neste modo: o motor antigo o
  lê como "por um tempo" e retoma pelo próprio passo — espera N de novo e
  segue. A contagem pela conversa se perde; nada quebra.
- **E2E no preview**: a espera estacionada pelo código local é retomada pelo
  agendador da VPS (mesmo banco) com o código do `main`. Ganhar a corrida
  reivindicando SÓ as esperas da automação de teste (o `UPDATE`
  pending→running do claim, filtrado pelo `automation_id`) e chamando a
  `resumePendingExecution` da branch por script (jiti). O cron LOCAL em laço
  também ganha, mas retoma as esperas de clientes reais com o código da branch.

### Condição "Campo personalizado da ficha" (`custom_field`, 2.10)

É o que devolve ao robô SÓ o "Desqualificado" por "Não respondeu" (o
`contact_field` do upstream lê só colunas de `contacts`). `operand` =
`custom_fields.id`, `operator` (`equals`/`contains`/`empty`/`not_empty`;
ausente = `equals`), `value`.

- ⚠️⚠️ **O motor confere o campo pela CONTA antes de o valor valer**
  (`avaliarCampoPersonalizado`, service role): sem isso, um id de campo de
  outra conta viraria oráculo de dado alheio. O contato já vem conferido do
  disparo. Há pino no `engine.test.ts`.
- **Erro de leitura responde "não"** e o registro diz `campo não conferido`;
  campo apagado (ou de outra conta) também "não", com a nota. ⚠️ O VALOR lido
  NUNCA vai para o registro: o campo pode guardar a senha do gov.br.
- **Operadores por tipo** (`operadoresDoTipo`): texto os quatro; lista e
  número sem "contém"; data só vazio/preenchido (a coluna guarda ISO em UTC).
  "é"/"contém" comparam aparado e sem maiúsculas (acento conta); número pela
  régua do robô (`numeroDigitado`: "150.000" é 150 mil). Sem linha em
  `contact_custom_values` = vazio.
- **Duas camadas na ativação**: a forma em `validateOne` (operador conhecido,
  valor para "é"/"contém"); o que só o banco sabe (campo da conta, operador
  do tipo, valor entre as OPÇÕES da lista) nas rotas de automação, por
  `carregarCamposParaCondicoes` + `validateCustomFieldConditionsForActivation`
  (leitura que falha pula — o motor é a guarda).
- **O construtor (`condicao-por-campo-fields.tsx`) recorta os campos pela
  conta** (`useAuth().accountId`), nunca só pela RLS, e os reparte por BLOCO.
- **Resumo: `condition_campo_<operador>`** (`descrever-passo.ts`, nos dois
  dicionários) com o NOME do campo — quem desenha condição precisa carregar
  `nomes.campos` (a página do funil e `GET /api/cb/execucoes` carregam), senão
  sai "(apagado)".

### "Fixar a conversa no número" (`pin_conversation_channel`)

A troca de número Comercial → Jurídico (29/09/2026): o cliente do Bancário
que escreve no Comercial é avisado e passa a ser atendido pelo Jurídico.

- ⚠️⚠️ **Enviar por um número NÃO muda o número da conversa**: `sendViaMeta`
  só grava a prévia, e a mensagem seguinte do cliente pelo número antigo a
  puxa de volta (`followConversationChannel`, conversa solta). Sem este passo,
  a resposta dada pelo CRM depois do aviso sairia pelo Comercial. Fixada
  (`channel_pinned`), ela fica no número até alguém escolher "Automático" no
  cabeçalho, e a faixa de divergência aparece quando o cliente escreve por
  outro (`canal-na-conversa.md`).
- ⚠️ **A recusa vem ANTES do efeito**, como em `/api/whatsapp/send`: conexão
  apagada ou de outra conta, que não é de WhatsApp, ou que não alcança o
  contato (`alvoDeEnvio`: só o BSUID num QR Code) FALHA o passo — nunca "fica
  onde estava" nem prende a conversa num número que não chega ao cliente.
  Grupo é recusado (segunda tranca, como no `set_ai`). Sem conversa, falha
  como o `set_ai`: o passo não fala com ninguém, então não cria conversa.
- **Conexão obrigatória, sem "a do disparo"** (`fixar_sem_conexao`); a
  ativação recusa Instagram (`validateChannelScopeForActivation`), e id
  desconhecido não trava (o motor falha fechado nele). O seletor aparece
  mesmo com um número só e lista só WhatsApp; sem número para escolher,
  `ListaSemEscolha` diz se está carregando, se falhou ou se não há nenhum
  (Codex, PR #353), e "conexão apagada" só com a lista carregada.
- O registro diz o NOME do número (`conversa fixada no número "…"`): o motor
  já leu a conexão para a recusa. O resumo do cartão (`descrever-passo.ts`)
  fica sem o nome — nenhuma tela que resume passo carrega `nomes.canais`.

### "Não repetir para o mesmo contato por N horas" (`trigger_config.nao_repetir_horas`)

A troca Comercial → Jurídico (30/09/2026): o aviso sai de novo depois de
24 h, e a mensagem do cliente dentro do prazo não vira registro.
`nao-repetir.ts` (puro + a consulta).

- ⚠️⚠️ **É um RECORTE de `dispararAutomacoes`, depois de número, gatilho e
  etapa, antes do gancho `antesDeExecutar`**: dentro do prazo sai "fora do
  escopo", SEM registro. Condição nos passos não serve para isto: o registro
  nasce antes do primeiro passo, e cada mensagem virava "parou numa
  condição" (um cliente gerou 31 num dia).
- ⚠️ **O prazo conta do `created_at` da última execução que não foi
  `barrada`**: `falhou` e a que ainda roda (desfecho nulo) CONTAM — o envio
  que falhou pode ter saído. Índice `(automation_id, created_at DESC)`.
- ⚠️ **Leitura que falha DESCARTA o disparo** (falha fechada, com
  `console.error`): rodar às cegas repetiria o aviso; a próxima mensagem
  pergunta de novo.
- ⚠️ **Só no disparo automático**: `runAutomationById` ("Executar
  automação", agente, "Acionar automação") ignora o prazo, e a execução dele
  CONTA para o prazo seguinte.
- **Só nos gatilhos por mensagem** (`aceitaNaoRepetir`: nova mensagem,
  palavra-chave, resposta de botão), default-deny. A chave sobra ao trocar o
  gatilho no construtor; motor, tela e validação a ignoram nos outros.
- **Inteiro de 1 a 720** (`horasSemRepetirValidas`) na ativação; no motor,
  inválido = sem prazo, nunca outro número. Na tela, em branco tira a chave.
- **Conhecido, não tratado:** ler-e-depois-registrar, sem trava — duas
  mensagens em POSTs simultâneos passam as duas (milissegundos; a mesma
  janela da trava por etiqueta que isto substituiu).

# Ficha sem conversa (27/09/2026, #322)

- ⚠️ **Ficha SEM conversa: os passos que FALAM com o contato a criam
  ENCERRADA** (`criarSeFaltar` em `resolveConversationId` → `conversaDoContato`:
  enviar texto, botões/lista, modelo, mídia e `run_flow`). Ficha da API v1 (o
  lead de anúncio) não tem conversa. `set_ai` e a condição da janela não
  criam; `conversation_id` alheio no contexto segue recusado.
- **Limite aceito (Codex, #322):** a conversa criada DENTRO de um ramo de
  condição não chega aos dados do contato já lidos pelo escopo de fora: um
  `{{conversation.link}}` desse escopo, depois do ramo, sai vazio naquela
  execução. O link é o interno do CRM (aviso à equipe), quase nunca vai ao lead.
