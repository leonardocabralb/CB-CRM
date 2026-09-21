# Plano — as automações do escritório

> Este documento é sobre **o conteúdo** das automações que o CB Advogados vai
> usar (quais são, o que cada passo faz, que texto sai para o cliente). Não
> confundir com `PLANO-automacoes-multicanal-e-funil.md`, que é sobre a
> *ferramenta* de automações.
>
> Estado: **as oito estão criadas, todas DESATIVADAS**, com o prefixo
> `(PENDENTE)` no nome. Escrito em 20/09/2026 a partir do pedido de 08/09 e do
> que o motor ganhou desde então; construído e testado em 21/09.
>
> ⚠️ **Nenhuma pode ser ligada por engano.** A validação de ativação é o
> portão: a de contrato fechado, por exemplo, recusa com "webhook URL is
> required" e "task assignee is required", e o interruptor volta sozinho para
> desligado. Rascunho incompleto pode ser salvo; ativado, não.

---

## 1. Como está a conta hoje

| Automação | Gatilho | Passos | Ativa |
| --- | --- | --- | --- |
| (PENDENTE) Contrato fechado | entrou em Contrato Fechado | 12 | não |
| (PENDENTE) Documentos de gestão de passivo | manual | 7 | não |
| (PENDENTE) Lembrete de reunião · 24h antes | data de campo | 1 | não |
| (PENDENTE) Lembrete de reunião · 4h antes | data de campo | 1 | não |
| (PENDENTE) Lembrete de reunião · 1h antes | data de campo | 1 | não |
| (PENDENTE) Lembrete de reunião · 10min antes | data de campo | 1 | não |
| (PENDENTE) Desqualificado | entrou em Desqualificado | 2 | não |
| (PENDENTE) No-show · recuperação | entrou em No Show | 20 | não |
| Calendly → Reunião agendada | agendamento do Calendly | 7 | **sim** |
| Cobrança · 1, 5 e 30 dias · vence hoje | Asaas | 1 cada | não |

As três que já existiam foram **transformadas, não duplicadas**: se nascesse
uma segunda ao lado da do Atlas, ela aplicaria a etiqueta primeiro e a trava da
nova barraria tudo. O que elas tinham antes:

- **Envio Webhook CB OS - Atlas** (29/08): etiqueta + webhook para
  `https:Teste.url.br` com corpo `testeteste`. Virou a de contrato fechado.
- **No-Show Recuperação** (18/09): só a etiqueta. Virou a de no-show.
- **Desqualificado - Encerrar** (18/09): já estava completa. Só foi renomeada.

### O que o motor ganhou desde 08/09

Três coisas mudam o desenho combinado naquele dia:

- **"Parar a automação se o cliente responder"**, uma caixa em cada passo
  Aguardar. Resolve o cliente que responde na terceira mensagem e recebia as
  outras sete.
- **"Interromper se o card sair desta etapa"**, uma caixa no gatilho de etapa.
  Lê a etapa do banco toda vez que a espera acorda, então vale por qualquer
  caminho — inclusive quando o Calendly move o card porque o cliente
  reagendou.
- **Seletor de conexão por passo de mensagem.** Já existe na tela, e aparece
  porque a conta tem mais de uma conexão.

Juntas, as duas primeiras apagam a parte mais feia do plano antigo: a
sequência de no-show ia precisar de uma condição "ainda está em No Show?"
antes de cada mensagem, cada uma aninhada dentro do ramo da anterior. Dez
níveis de profundidade. Agora é uma lista plana.

---

## 2. Sobre a conexão de saída

> Resposta à pergunta de 20/09: **sim, já existe.**

Cada passo de mensagem tem um campo **Conexão de saída**. O padrão dele é
*herdar a conexão do disparo*, com queda para a conexão atual da conversa.

Três coisas a saber:

- **Vazio não é "todas as conexões".** Uma mensagem sai por um número só.
  Vazio quer dizer "herda", não "qualquer um".
- **Herdar é o padrão certo na maioria dos casos.** É o que faz um follow-up
  de 24 horas sair pelo mesmo número por onde o cliente falou. A conexão do
  disparo viaja junto com a execução e sobrevive à espera.
- **Fixar a conexão joga essa herança fora.** Vale a pena quando o disparo não
  tem conexão nenhuma para herdar — que é exatamente o caso dos lembretes de
  reunião, cujo gatilho é uma data, não uma mensagem.

**Decisão tomada na construção: os quatro lembretes ficaram HERDANDO**, sem
conexão fixada. O pedido foi "independentemente da conexão", e herdar é o que
faz o lembrete sair pelo mesmo número por onde o cliente conversa. O lead que
nasceu do Calendly tem conversa sem conexão e cai na padrão da conta, que é
Bancário - Comercial — o mesmo resultado que fixar daria, sem perder a herança
para quem veio por outro número. Fixar é um clique, se preferir o contrário.

---

## 3. As cinco automações

### Automação 1 — Contrato fechado

**Gatilho:** card entrou em *Contrato Fechado* (funil Bancário - Comercial).
**Interromper se o card sair da etapa: DESMARCADA.** Ver a nota no fim.

A condição é o passo único do escopo de fora. **O corpo inteiro vive dentro do
ramo NÃO** — "se ainda não tem a etiqueta, faça tudo isto":

| # | Passo | Onde | Configuração |
| --- | --- | --- | --- |
| 1 | Condição | raiz | tem a etiqueta `Cliente Fechado`? |
| 2 | Aplicar etiqueta | ramo NÃO | `Cliente Fechado` |
| 3 | Aplicar etiqueta | ramo NÃO | `Bancário` |
| 4 | Mover card | ramo NÃO | para *Contrato Fechado* (redundante de propósito) |
| 5 | Disparar webhook | ramo NÃO | **URL pendente** — corpo já rascunhado |
| 6 | Aguardar | ramo NÃO | 30 segundos |
| 7 | Marcar ganho | ramo NÃO | redundante: a etapa já carrega o resultado |
| 8 | Aguardar | ramo NÃO | 10 segundos |
| 9 | Enviar mensagem | ramo NÃO | boas-vindas (texto no item 4) |
| 10 | Aguardar | ramo NÃO | 10 segundos |
| 11 | Criar tarefa | ramo NÃO | **responsável pendente**; título e prazo rascunhados |
| 12 | Mover card | ramo NÃO | para *Bancário - Jurídico → Cliente Ativo* |

> ⚠️⚠️ **O corpo TEM de ficar dentro do ramo, e a primeira versão deste plano
> errava nisso.** Eu havia escrito "condição primeiro, ramo SIM vazio, corpo
> depois". Não funciona: ramo vazio **não interrompe o escopo de fora** — o
> motor segue nos passos seguintes, e a trava não travaria nada. Quem já
> tivesse a etiqueta receberia as boas-vindas de novo a cada vez.
>
> Medido em 21/09 com uma automação temporária de mesma estrutura, rodada duas
> vezes no card do Leonardo: sem a etiqueta, `branch=no` e o corpo executou;
> com a etiqueta, `branch=yes`, nada executou e o desfecho foi **barrada**. O
> fio mostra "parou numa condição", em cinza.

> ⚠️ **Por que a caixa "interromper se o card sair" tem de ficar desmarcada
> aqui.** Com ela ligada, executar a automação à mão num lead que não está em
> Contrato Fechado **não manda nada** — o motor confere a etapa antes de cada
> passo e o primeiro já encontra o card fora. E ela nasce marcada quando a
> automação é criada pelo botão da grade do funil. Como você pediu justamente
> para poder rodar isso à mão em lead de outra etapa, é preciso desmarcar de
> propósito. O passo 11, que move o card para outro funil, também a
> interromperia.

**Falta para poder ligar:** URL do Atlas, campos que ele espera, e
título/prazo/responsável da tarefa.

---

### Automação 2 — Documentos de gestão de passivo

**Gatilho:** manual (botão *Executar automação* no menu + da conversa).

| # | Passo | Configuração |
| --- | --- | --- |
| 1 | Enviar mensagem | abertura (texto no item 4) |
| 2 | Aguardar | 10 segundos |
| 3 | Enviar mensagem | documentos pessoais |
| 4 | Aguardar | 10 segundos |
| 5 | Enviar mensagem | documentos das dívidas |
| 6 | Aguardar | 10 segundos |
| 7 | Enviar mídia | a planilha (Excel) |

Sem gatilho automático: ela só roda quando alguém clica. Nenhuma espera leva
"parar se o cliente responder" — são pausas de segundos, e o cliente não teria
tempo de responder no meio.

**Falta para poder ligar:** o arquivo Excel e a confirmação dos três textos.

---

### Automação 3 — Lembretes de reunião

**Quatro automações**, uma por antecedência. Gatilho de cada uma: *data de um
campo*, lendo **Data e Hora Reunião** (o campo que o Calendly preenche).

| Automação | Antecedência |
| --- | --- |
| Lembrete de reunião · 24h | 24 horas antes |
| Lembrete de reunião · 4h | 4 horas antes |
| Lembrete de reunião · 1h | 1 hora antes |
| Lembrete de reunião · 10min | 10 minutos antes |

Cada uma tem **um passo só**: enviar mensagem, com a conexão fixada em
Bancário - Comercial.

**Escopo: etapa *Reunião Agendada*.** O motor confere isso no instante do
disparo, então lead que saiu da etapa não recebe lembrete. Sem escopo de
conexão — vale para qualquer número, como você pediu.

O que funciona sozinho, sem configuração:

- **A data sai formatada** como você escolheu: `30/08/2026 às 16:00h`. O
  campo guarda o instante cru e o motor formata na hora de montar a mensagem.
- **Reagendamento recomeça a série.** O Calendly reescreve o campo, e a trava
  que impede repetição é por valor de data — data nova, lembretes novos.
- **Janela perdida é pulada.** Se o sistema ficar fora do ar na hora do
  lembrete de 1 hora, aquele não sai e os seguintes saem. Você já aceitou isso.

Hoje **53 contatos** têm esse campo preenchido.

**Falta para poder ligar:** confirmação dos quatro textos.

---

### Automação 4 — Desqualificado

**Já está montada.** Gatilho: card entrou em *Desqualificado*.

| # | Passo |
| --- | --- |
| 1 | Aplicar etiqueta `Desqualificado` |
| 2 | Encerrar a conversa |

Duas consequências a confirmar antes de ligar:

- Encerrar **solta o responsável** da conversa.
- Qualquer mensagem do cliente depois disso **devolve a conversa** para a
  caixa de entrada, e ela volta sem responsável.

**Falta para poder ligar:** só a sua palavra.

---

### Automação 5 — No-show

**Uma automação**, gatilho: card entrou em *No Show*.
**Interromper se o card sair da etapa: MARCADA.**

Estrutura plana — etiqueta, depois mensagem e espera alternando:

| # | Passo | Quando cai |
| --- | --- | --- |
| 1 | Aplicar etiqueta `No-Show` | — |
| 2 | Mensagem 1 | na hora |
| 3 | Aguardar 1 hora | |
| 4 | Mensagem 2 | 1h |
| 5 | Aguardar 2 horas | |
| 6 | Mensagem 3 | 3h |
| 7 | Aguardar 21 horas | |
| 8 | Mensagem 4 | 24h |
| 9 | Aguardar 2 dias | |
| 10 | Mensagem 5 | 72h |
| 11 | Aguardar 4 dias | |
| 12 | Mensagem 6 | 7 dias |
| 13 | Aguardar 8 dias | |
| 14 | Mensagem 7 | 15 dias |
| 15 | Aguardar 15 dias | |
| 16 | Mensagem 8 | 30 dias |
| 17 | Aguardar 30 dias | |
| 18 | Mensagem 9 | 60 dias |
| 19 | Aguardar 30 dias | |
| 20 | Mensagem 10 | 90 dias |

As esperas são as **diferenças** entre os seus marcos, não os marcos.

**Cada uma das nove esperas leva "parar se o cliente responder" marcada.** A
etiqueta é aplicada uma vez só — o motor não duplica etiqueta que o contato já
tem, e o card que sai e volta para No Show recomeça a sequência sem etiqueta
nova.

Duas formas de a sequência parar, e as duas são automáticas:

1. **O cliente responde** — para na espera em curso.
2. **O card sai de No Show** — inclusive quando o próprio Calendly o move para
   Reunião Agendada porque o cliente reagendou.

> ⚠️ **Limite honesto, a partir da espera de 30 dias.** A pergunta "o card se
> mexeu desde que esta execução começou?" enxerga só os últimos 30 dias de
> histórico de movimento; o mais antigo é podado. O que continua protegendo é
> a **posição atual do card**: se ele não estiver em No Show na hora do envio,
> a mensagem não sai. Na prática isso cobre o caso real, que é o cliente ter
> reagendado. O furo teórico seria um card que saiu, voltou e ficou parado
> mais de um mês.

**Falta para poder ligar:** confirmação dos dez textos e o **link público de
agendamento** (a página do Calendly onde o cliente escolhe novo horário).

---

## 4. Esboço dos textos

> **Tudo abaixo é rascunho meu, para você corrigir.** Não conheço o tom que o
> escritório usa com o cliente. Marcadores entre chaves são preenchidos pelo
> sistema; `[ENTRE COLCHETES]` é o que falta você me dar.

### Lembretes de reunião

**24 horas antes**

```
Olá, {{contact.name}}! Tudo bem?

Passando para lembrar da sua reunião com a equipe do CB Advogados:
*{{contact.campo.data_e_hora_reuniao}}*

É uma conversa por vídeo, de cerca de 30 minutos, para entendermos seu caso e
te mostrarmos os caminhos possíveis.

Link de acesso: {{contact.campo.link_reuniao}}

Se precisar remarcar, é só me avisar por aqui.
```

**4 horas antes**

```
Oi, {{contact.name}}! Sua reunião com o CB Advogados é hoje:
*{{contact.campo.data_e_hora_reuniao}}*

Link de acesso: {{contact.campo.link_reuniao}}

Uma dica: se tiver em mãos os contratos ou extratos da dívida, a conversa
rende bem mais.
```

**1 hora antes**

```
{{contact.name}}, falta *1 hora* para a sua reunião.

Link de acesso: {{contact.campo.link_reuniao}}

Já deixe aberto para não perder o horário.
```

**10 minutos antes**

```
{{contact.name}}, sua reunião começa em *10 minutos*.

Entre por aqui: {{contact.campo.link_reuniao}}

Estamos te esperando!
```

### No-show

**1 — na hora**

```
{{contact.name}}, tentamos te encontrar na reunião agora e não conseguimos.

Imagino que algo tenha surgido — acontece.

Quer remarcar para outro horário? É só escolher aqui: [LINK DE AGENDAMENTO]
```

**2 — 1 hora depois**

```
Oi, {{contact.name}}! Se preferir, me diga por aqui qual o melhor dia e
horário para você, que eu encaixo na agenda do advogado.
```

**3 — 3 horas depois**

```
{{contact.name}}, a análise do seu caso continua reservada com a gente.

Remarcar leva menos de um minuto: [LINK DE AGENDAMENTO]
```

**4 — 24 horas depois**

```
{{contact.name}}, passando rapidinho: sua consulta sobre a renegociação da
dívida ainda está de pé.

É sem compromisso e dura cerca de 30 minutos. Escolha um horário:
[LINK DE AGENDAMENTO]
```

**5 — 3 dias depois**

```
Oi, {{contact.name}}. Muita gente adia essa conversa por achar que não tem
saída — e quase sempre tem.

Se quiser entender o que dá para fazer no seu caso: [LINK DE AGENDAMENTO]
```

**6 — 7 dias depois**

```
{{contact.name}}, faz uma semana que tentamos falar sobre a sua dívida.

Se o momento não for bom, tudo bem. Mas se quiser retomar, é só responder
aqui.
```

**7 — 15 dias depois**

```
Oi, {{contact.name}}! Uma dúvida rápida: você chegou a resolver a questão com
o banco?

Se ainda estiver em aberto, a gente conversa quando fizer sentido para você.
```

**8 — 30 dias depois**

```
{{contact.name}}, faz um mês que nos falamos.

Se a situação mudou, ou se ficou mais apertada, podemos reavaliar seu caso sem
custo: [LINK DE AGENDAMENTO]
```

**9 — 60 dias depois**

```
Oi, {{contact.name}}. Só para você saber: as regras sobre juros abusivos e
superendividamento mudaram bastante nos últimos anos.

Se quiser uma análise atualizada do seu contrato, é só responder aqui.
```

**10 — 90 dias depois**

```
{{contact.name}}, esta é a última vez que te procuro sobre isso, para não
ficar insistindo.

Se um dia quiser retomar, guarde este contato — a porta continua aberta.

Um abraço, equipe CB Advogados.
```

### Contrato fechado — boas-vindas

```
{{contact.name}}, seja muito bem-vindo(a) ao CB Advogados!

Seu contrato está assinado e seu caso já entrou na fila do nosso time
jurídico.

Este mesmo número continua sendo o seu canal com a gente. Qualquer dúvida
sobre o andamento, é só chamar aqui.

Em breve um dos nossos advogados entra em contato com os próximos passos.
```

### Documentos de gestão de passivo

**Mensagem 1 — abertura**

```
{{contact.name}}, para darmos andamento à gestão do seu passivo, vou precisar
de alguns documentos seus.

Mando a lista em duas partes, para ficar mais fácil de organizar.
```

**Mensagem 2 — documentos pessoais**

```
*Documentos pessoais:*

• RG e CPF, ou CNH
• Comprovante de residência atualizado
• Comprovante de renda dos últimos 3 meses
```

**Mensagem 3 — documentos das dívidas**

```
*Documentos das dívidas:*

• Contratos de empréstimo e financiamento
• Extratos bancários dos últimos 6 meses
• Faturas do cartão de crédito
• Notificações ou cobranças que você tenha recebido

Na planilha em anexo está a relação completa, com um campo para marcar o que
já separou.
```

---

## 4b. O que foi testado em 21/09

Tudo no card do Leonardo Cabral Baptista, com automações temporárias que foram
apagadas depois. Nenhuma das oito foi ativada em momento nenhum.

**As variáveis, num envio real de WhatsApp.** Todas resolveram:

| Variável | Saiu como |
| --- | --- |
| `{{contact.name}}` | Leonardo Cabral Baptista |
| `{{contact.campo.data_e_hora_reuniao}}` | **09/09/2026 às 17:30h** |
| `{{contact.campo.link_reuniao}}` | o link do Google Meet |
| `{{contact.phone}}` | 558388745316 |
| `{{contact.email}}` | leonardocabralb@gmail.com |
| `{{conversation.link}}` | o link da conversa no CRM |
| `{{contact.origem}}` | vazio (ele não veio de anúncio) |

A data fica guardada em UTC e sai no fuso do escritório, no formato escolhido.
⚠️ A mensagem sai com o prefixo `*CB Advogados:*` — a assinatura da conta está
ligada e vale para toda mensagem de automação.

**A trava por etiqueta**, rodada duas vezes: sem a etiqueta o corpo executou
(`branch=no`, desfecho *concluída*); com a etiqueta nada executou
(`branch=yes`, desfecho *barrada*). É o achado que corrigiu o plano.

**O alvo dos lembretes**, sem enviar nada: a função que procura quem deve
receber foi chamada com a janela de uma hora que o lembrete de 24h usaria, e
devolveu os dois contatos com reunião ali dentro; com uma janela deslocada,
devolveu zero. As quatro configurações de deslocamento passam na validação,
inclusive a de 10 minutos, que tem zero horas.

**O portão de ativação**, na tela: ligar a de contrato fechado e salvar foi
recusado com os dois pontos que faltam, nomeados, e o interruptor voltou
sozinho para desligado.

**O que NÃO deu para testar:** o disparo automático de ponta a ponta. Para
isso seria preciso ativar uma automação em produção, e **treze clientes reais
têm reunião marcada**, seis delas amanhã — o risco de mandar texto não
aprovado para gente de verdade não se justifica antes de você confirmar os
textos.

---

## 5. O que falta você decidir ou me mandar

| # | O que | Trava qual automação |
| --- | --- | --- |
| 1 | Confirmar ou corrigir os textos acima | todas |
| 2 | Link público de agendamento do Calendly | 5 (no-show) |
| 3 | URL do webhook do Atlas e os campos que ele espera | 1 |
| 4 | Título, prazo e responsável da tarefa | 1 |
| 5 | O arquivo Excel dos documentos | 2 |
| 6 | Os lembretes ficaram herdando a conexão. Fixar Bancário - Comercial? | 3 |
| 7 | Ligar a de Desqualificado como está? | 4 |

⚠️ **Antes de ligar os lembretes, saiba que eles pegam gente na hora.** Treze
clientes têm reunião marcada no campo, seis delas amanhã. O lembrete de 24h
começa a disparar para essas pessoas no mesmo dia em que for ligado.

---

## 6. Decisões já travadas

Registradas para não voltarem à discussão:

- **Contrato fechado é uma automação só**, com trava por etiqueta no primeiro
  passo. (08/09)
- **O passo redundante "mover para Contrato Fechado" fica**, porque a
  automação pode ser executada à mão em lead de outra etapa. (08/09)
- **Mover para o funil Jurídico é o último passo**, para quem só enxerga o
  funil jurídico receber o lead já preparado. (08/09)
- **Automação 2 é manual.** (08/09)
- **Formato de data: `30/08/2026 às 16:00h`.** (08/09)
- **Etiqueta de no-show aplicada uma vez só.** (20/09)
- **Lembretes valem para qualquer conexão**, e só enquanto o lead estiver na
  etapa Reunião Agendada. (20/09)
