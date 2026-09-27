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
  - "src/components/automations/automation-builder.tsx"
---

# Automações — passos com regra própria

Vale ao mexer no "Enviar modelo", no "Criar tarefa" pelo responsável, nas
condições "Janela de 24h da Meta aberta" e "Hora do dia" e no "Aguardar até
estar dentro do horário" (Fase 2 do plano do previdenciário, 26/09/2026). As
regras são puras e testadas:
`parametros-do-modelo.ts`, `responsavel-da-tarefa.ts`, `janela-da-meta.ts` e
`hora-do-dia.ts`, em `src/lib/automations/`.
O resto do motor: `.claude/rules/automacoes.md`; o mapa da janela por número:
`.claude/rules/canal-na-conversa.md`.

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
