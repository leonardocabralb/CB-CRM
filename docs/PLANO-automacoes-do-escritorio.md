# Automações do escritório — os textos para aprovar

> Este documento é sobre **o conteúdo** das automações do CB Advogados: quais
> são, o que cada uma faz e **que texto sai para o cliente**. A *ferramenta*
> de automações está em `PLANO-automacoes-multicanal-e-funil.md`.
>
> **Atualizado em 23/09/2026**, a partir do que está GRAVADO em cada
> automação na produção — não do rascunho antigo. Duas coisas mudaram desde a
> versão de 21/09:
>
> - **Os quatro lembretes de reunião foram reescritos em 21/09** (entre 17:57
>   e 18:02), depois desta versão, e perderam o prefixo `(PENDENTE)` do nome.
>   Os textos abaixo são esses, como estão gravados.
> - **Os meus rascunhos das outras automações foram gravados SEM ACENTO**
>   ("reuniao", "e so chamar aqui"). Do jeito que estão, sairiam errados para
>   o cliente. Abaixo eles aparecem com a acentuação corrigida; ao aprovar,
>   eu regravo cada automação com a versão aprovada.

## Como aprovar

Cada texto tem uma caixa **[ ] Aprovado**. Para aprovar, me responda com os
números (ex.: "aprovo 2.1 a 2.10 e 3.1") ou corrija o texto e me mande. Nada
é ligado sem você mandar ligar — aprovar o texto e ligar a automação são dois
passos.

⚠️ **Toda mensagem de automação chega com o prefixo `*CB Advogados:*`** — a
assinatura da conta está ligada e vale para todas. Leia cada texto imaginando
esse prefixo na frente. Os lembretes, por exemplo, falam em primeira pessoa
("te encontro já!"). Se preferir, cada automação pode **assinar com outro
nome** (campo "Assinar como", ex.: o nome da SDR); é só me dizer qual.

---

## 1. Como está a conta hoje (23/09)

| # | Automação | Gatilho | Ligada | Texto para o cliente |
| --- | --- | --- | --- | --- |
| 1 | Lembrete de reunião · 24h / 4h / 1h / 10min | data do campo "Data e Hora Reunião" | não | **4 textos — seção 1** |
| 2 | (PENDENTE) No-show · recuperação | card entrou em No Show | não | **10 textos — seção 2** |
| 3 | (PENDENTE) Contrato fechado | card entrou em Contrato Fechado | não | **boas-vindas + tarefa — seção 3** |
| 4 | (PENDENTE) Documentos de gestão de passivo | manual (botão da conversa) | não | **3 textos + planilha — seção 4** |
| 5 | Typebot · Abaixo de 150 mil com processo | Typebot (webhook) | **sim** | **texto NOVO — seção 5** |
| 6 | (PENDENTE) Desqualificado | card entrou em Desqualificado | não | nenhum (etiqueta + encerra a conversa) |
| 7 | Typebot · Lead e respostas / Recebeu o link / Desqualificado | Typebot (webhook) | **sim** | nenhum (só ficha e funil) |
| 8 | Calendly → Reunião agendada | agendamento do Calendly | **sim** | aviso ao ADVOGADO — anexo A |
| 9 | Cobrança · 1, 5 e 30 dias / Lembrete · vence hoje | Asaas | não | cobrança — anexo B |

**Quem pode mexer nelas:** decisão sua de 23/09, qualquer admin da conta
abre, edita, duplica e exclui qualquer uma — correção no PR #260. Até ela
entrar no ar, só quem criou consegue: as 17 foram criadas pelo login do
Leonardo, e o Ricardo recebe "não encontrado" em todas.

---

## 2. O que muda o comportamento desde 21/09

- **Reunião cancelada no Calendly desarma os lembretes** daquela data. Quem
  desmarca não recebe "sua reunião começa em 10 minutos".
- **Card PERDIDO volta a ser aberto** quando entra numa etapa neutra (21/09).
  Um lead desqualificado que volta a "Lead - Type e Forms" pelo Typebot sai
  da perda sozinho.
- **As conversas criadas pelo Typebot nascem ENCERRADAS.** Mensagem de
  automação não reabre conversa: ela volta para a caixa quando o lead
  responder. Vale para o texto novo da seção 5.

---

## Seção 1 — Lembretes de reunião

**Como funcionam:** quatro automações, uma por antecedência, todas lendo o
campo "Data e Hora Reunião" (o que o Calendly preenche). Só disparam com o
card em *Reunião Agendada*, saem **sempre por Bancário - Comercial** (fixado,
decisão de 21/09) e a data sai no formato `30/08/2026 às 16:00h`.
Reagendar recomeça a série; cancelar desarma.

✅ **Os quatro textos abaixo são os seus, de 21/09, como estão gravados.**
Deixei só sugestões pequenas embaixo de cada um — aprove como está ou com a
sugestão.

**1.1 — 24 horas antes** · [ ] Aprovado

```
Ola, {{contact.name}}! Tudo bem?

Passando para lembrar da sua reuniao com a equipe do CB Advogados:
*{{contact.campo.data_e_hora_reuniao}}*

Nela o advogado irá te explicar as estratégias disponíveis para conseguirmos reduzir os débitos bancários e proteger o patrimônio da empresa.

Amanhã te enviarei o link da videochamada.

Qualquer dúvida, só chamar aqui!
```

> Sugestões: "Ola" → **"Olá"** e "reuniao" → **"reunião"** (vieram do meu
> rascunho sem acento). E uma pergunta: **"patrimônio da empresa"** vale para
> o cliente pessoa física? O Typebot pergunta se a dívida é no CPF ou no CNPJ.

**1.2 — 4 horas antes** · [ ] Aprovado

```
Oi, {{contact.name}}! tô passando pra te lembrar da nossa reunião de hoje!

*{{contact.campo.data_e_hora_reuniao}}*

Link de acesso: {{contact.campo.link_reuniao}}

A apresentação da sua solução já está sendo finalizada pelo advogado responsável.

Durante a reunião preciso que você esteja em um local tranquilo e preferencialmente no computador, ta certo?

*Vamos conversar sobre pontos muito importantes e preciso da sua total atenção.*
```

> Sugestões: "tô" → **"Tô"** (começa frase) e "ta certo?" → **"tá certo?"**.

**1.3 — 1 hora antes** · [ ] Aprovado

```
{{contact.name}}, segue link da nossa reunião:

Link de acesso: {{contact.campo.link_reuniao}}

Nossa reunião será daqui *1 hora*, te encontro já!
```

**1.4 — 10 minutos antes** · [ ] Aprovado

```
Oi! O advogado que realizará sua reunião está finalizando um atendimento e daqui 10 minutos entrará no link que te mandei acima pra te aguardar, ok?
```

> ⚠️ **Antes de ligar, saiba que os lembretes pegam gente na hora.** Na
> manhã de 23/09, **11 contatos tinham reunião futura** no campo — **5 nas
> 24 horas seguintes**, a primeira às 10:00 daquele dia. O de 24h começa a
> disparar para essas pessoas no mesmo dia em que for ligado.

**Falta para ligar:** a sua aprovação dos quatro textos.

---

## Seção 2 — No-show · recuperação

**Como funciona:** uma automação, gatilho "card entrou em No Show". Aplica a
etiqueta `No-Show` e manda dez mensagens: na hora, 1h, 3h, 24h, 72h, 7 dias,
15, 30, 60 e 90 dias. **A sequência para sozinha** se o cliente responder
(cada espera tem "parar se o cliente responder") ou se o card sair de No Show
— inclusive quando o Calendly o move porque o cliente reagendou.

Só vale para quem ENTRAR em No Show depois de ligada: os **97 cards que já
estão lá hoje** não recebem nada (dá para rodar à mão num card específico).

✏️ **Os dez textos são rascunhos meus** — nunca foram revisados por você. O
`[LINK DE AGENDAMENTO]` é o que falta você me dar: a página do Calendly onde
o cliente escolhe um novo horário.

**2.1 — na hora** · [ ] Aprovado

```
{{contact.name}}, tentamos te encontrar na reunião agora e não conseguimos.

Imagino que algo tenha surgido — acontece.

Quer remarcar para outro horário? É só escolher aqui: [LINK DE AGENDAMENTO]
```

**2.2 — 1 hora depois** · [ ] Aprovado

```
Oi, {{contact.name}}! Se preferir, me diga por aqui qual o melhor dia e horário para você, que eu encaixo na agenda do advogado.
```

**2.3 — 3 horas depois** · [ ] Aprovado

```
{{contact.name}}, a análise do seu caso continua reservada com a gente.

Remarcar leva menos de um minuto: [LINK DE AGENDAMENTO]
```

**2.4 — 24 horas depois** · [ ] Aprovado

```
{{contact.name}}, passando rapidinho: sua consulta sobre a renegociação da dívida ainda está de pé.

É sem compromisso e dura cerca de 30 minutos. Escolha um horário: [LINK DE AGENDAMENTO]
```

**2.5 — 3 dias depois** · [ ] Aprovado

```
Oi, {{contact.name}}. Muita gente adia essa conversa por achar que não tem saída — e quase sempre tem.

Se quiser entender o que dá para fazer no seu caso: [LINK DE AGENDAMENTO]
```

**2.6 — 7 dias depois** · [ ] Aprovado

```
{{contact.name}}, faz uma semana que tentamos falar sobre a sua dívida.

Se o momento não for bom, tudo bem. Mas se quiser retomar, é só responder aqui.
```

**2.7 — 15 dias depois** · [ ] Aprovado

```
Oi, {{contact.name}}! Uma dúvida rápida: você chegou a resolver a questão com o banco?

Se ainda estiver em aberto, a gente conversa quando fizer sentido para você.
```

**2.8 — 30 dias depois** · [ ] Aprovado

```
{{contact.name}}, faz um mês que nos falamos.

Se a situação mudou, ou se ficou mais apertada, podemos reavaliar seu caso sem custo: [LINK DE AGENDAMENTO]
```

**2.9 — 60 dias depois** · [ ] Aprovado

```
Oi, {{contact.name}}. Só para você saber: as regras sobre juros abusivos e superendividamento mudaram bastante nos últimos anos.

Se quiser uma análise atualizada do seu contrato, é só responder aqui.
```

**2.10 — 90 dias depois** · [ ] Aprovado

```
{{contact.name}}, esta é a última vez que te procuro sobre isso, para não ficar insistindo.

Se um dia quiser retomar, guarde este contato — a porta continua aberta.

Um abraço, equipe CB Advogados.
```

> Dois pontos de conteúdo para você decidir: a 2.4 fala em "renegociação da
> dívida" e a 2.7 em "questão com o banco" — cabem para todo lead do
> Bancário? E a 2.10 assina "equipe CB Advogados", que o prefixo da conta já
> faz.

**Falta para ligar:** os dez textos e o link de agendamento.

---

## Seção 3 — Contrato fechado

**Como funciona:** gatilho "card entrou em Contrato Fechado". Uma trava na
frente: **se o contato já tem a etiqueta `Cliente Fechado`, nada acontece**
(testado em 21/09). Sem a etiqueta, faz tudo, nesta ordem: aplica
`Cliente Fechado` e `Bancário`, move para Contrato Fechado (redundante, para
poder rodar à mão em lead de outra etapa), avisa o sistema do escritório por
webhook, marca ganho, manda as boas-vindas, cria a tarefa e move o card para
**Bancário - Jurídico → Cliente Ativo**.

✏️ **Rascunhos meus.**

**3.1 — boas-vindas ao cliente** · [ ] Aprovado

```
{{contact.name}}, seja muito bem-vindo(a) ao CB Advogados!

Seu contrato está assinado e seu caso já entrou na fila do nosso time jurídico.

Este mesmo número continua sendo o seu canal com a gente. Qualquer dúvida sobre o andamento, é só chamar aqui.

Em breve um dos nossos advogados entra em contato com os próximos passos.
```

**3.2 — a tarefa criada para a equipe** (não vai para o cliente) · [ ] Aprovado

```
Título:     Novo cliente fechado: {{contact.name}}
Descrição:  Contrato assinado. Dar início ao atendimento jurídico.
Prazo:      1 dia
Responsável: [QUEM?]
```

**3.3 — o que vai para o sistema do escritório (webhook)** (não vai para o cliente)

```
{
  "nome": "{{contact.name}}",
  "telefone": "{{contact.phone}}",
  "email": "{{contact.email}}",
  "origem": "{{contact.origem}}",
  "link_crm": "{{conversation.link}}"
}
```

**Falta para ligar:** o texto 3.1, o **responsável** da tarefa, e a **URL do
webhook** do sistema do escritório (Atlas) com os campos que ele espera. A
tela recusa ligar sem esses dois — testado.

---

## Seção 4 — Documentos de gestão de passivo

**Como funciona:** só roda quando alguém clica em **Executar automação** no
menu + da conversa. Manda três mensagens, com 10 segundos entre elas, e a
planilha.

✏️ **Rascunhos meus.**

**4.1 — abertura** · [ ] Aprovado

```
{{contact.name}}, para darmos andamento à gestão do seu passivo, vou precisar de alguns documentos seus.

Mando a lista em duas partes, para ficar mais fácil de organizar.
```

**4.2 — documentos pessoais** · [ ] Aprovado

```
*Documentos pessoais:*

- RG e CPF, ou CNH
- Comprovante de residência atualizado
- Comprovante de renda dos últimos 3 meses
```

**4.3 — documentos das dívidas** · [ ] Aprovado

```
*Documentos das dívidas:*

- Contratos de empréstimo e financiamento
- Extratos bancários dos últimos 6 meses
- Faturas do cartão de crédito
- Notificações ou cobranças que você tenha recebido

Na planilha em anexo está a relação completa, com um campo para marcar o que já separou.
```

> A lista de documentos é chute meu. Confira com o que o jurídico pede de
> verdade — e se o cliente for empresa, entram contrato social e documentos
> dos sócios?

**Falta para ligar:** os três textos e o **arquivo Excel** da planilha.

---

## Seção 5 — Typebot · Abaixo de 150 mil com processo (TEXTO NOVO)

**Como funciona hoje (ligada desde 21/09):** quando o lead responde no
Typebot que a dívida é menor que R$ 150 mil e **tem processo judicial**, a
automação grava a resposta no campo "Processo Judicial" e aplica a etiqueta
`-150k`. Tudo atrás da trava de etapa: só age sobre card em
*Lead - Type e Forms* — quem digitar o telefone de um cliente no formulário
não o alcança.

**O que o Typebot já disse ao lead nesse ponto:** *"Dentro de alguns
instantes, um especialista irá entrar em contato com você."* A mensagem
abaixo é esse primeiro contato, pelo WhatsApp.

✏️ **Rascunho meu — é o texto que faltava** (você pediu em 21/09 que a
mensagem ao lead fosse "posteriormente configurada").

**5.1 — primeiro contato do especialista** · [ ] Aprovado

```
Olá, {{contact.name}}! Aqui é da equipe do CB Advogados.

Recebemos suas respostas: a sua dívida já tem um processo judicial em andamento, e quero entender melhor o seu caso.

Para adiantar, me mande por aqui:
- o nome do banco (ou dos bancos);
- o número do processo, se tiver em mãos.

Em seguida um dos nossos especialistas continua o atendimento com você.
```

Três escolhas que vêm junto, para você confirmar:

- **Sai na hora**, logo depois da etiqueta. Se preferir um intervalo (o
  Typebot ainda está na tela do lead), me diga quantos minutos.
- **Sai por Bancário - Comercial**, fixado — a conversa criada pelo Typebot
  não tem conexão para herdar.
- **A conversa continua ENCERRADA** depois do envio (mensagem de automação
  não reabre). Ela volta para a caixa de entrada quando o lead responder,
  sem responsável. Se quiser que ela já apareça em "Abertas" para a equipe
  acompanhar, dá para acrescentar um passo que reabre — me diga.

**Falta para ligar:** o texto (a automação já está ligada; o passo de
mensagem entra quando você aprovar).

---

## Seção 6 — Desqualificado

**Já montada, sem texto.** Gatilho: card entrou em *Desqualificado*. Aplica a
etiqueta `Desqualificado` e **encerra a conversa**.

- Encerrar **solta o responsável** da conversa.
- Qualquer mensagem do cliente depois disso **devolve a conversa** para a
  caixa de entrada, sem responsável.
- ⚠️ Ligada, ela também pega os leads que o **Typebot** move para
  Desqualificado. A conversa deles nasce encerrada; se o lead ainda não
  respondeu, só a etiqueta muda.

**Falta para ligar:** só a sua palavra.

---

## Anexo A — Já no ar: o aviso do Calendly (vai para o ADVOGADO, não ao cliente)

Ligada desde 07/09; alterada pela última vez **hoje, 23/09, às 08:23**. Vai
para o número 5583988745316 por Bancário - Comercial a cada agendamento.

```
*Novo Agendamento:*
*Nome:* {{vars.agendamento_nome}}
*Data:* {{vars.agendamento_data}}
*Telefone:* {{vars.agendamento_telefone}}
*Origem:* {{contact.origem}}
*Tamanho da Dívida:* {{contact.campo.tamanho_da_divida}}
*Link CRM:* {{conversation.link}}
```

Só para conferência — não faz parte desta aprovação.

## Anexo B — Desligadas: a régua de cobrança do Asaas

Os quatro textos foram escritos com a integração do Asaas (13/09) e estão
**desligados** junto com a régua. Saem por Bancário - Comercial. Só para
conferência; se quiser mexer, é outra frente.

**Cobrança · 1, 5 e 30 dias** (o mesmo texto nas três):

```
Olá, {{vars.cliente_primeiro_nome}}! Aqui é do {{vars.escritorio_nome}}.
Constam em aberto no seu cadastro {{vars.cobranca_quantidade}} parcela(s), num total de {{vars.cobranca_valor}}:
{{vars.cobranca_detalhe}}
{{vars.vence_hoje_detalhe}}
Se já pagou, pode desconsiderar esta mensagem. Qualquer dúvida, é só responder por aqui.
```

**Lembrete · vence hoje:**

```
Olá, {{vars.cliente_primeiro_nome}}! Aqui é do {{vars.escritorio_nome}}.
Passando para lembrar que {{vars.vencimento_texto}}:
{{vars.cobranca_detalhe}}
Se já pagou, pode desconsiderar. Qualquer dúvida, é só responder por aqui.
```

---

## O que falta você me dar

| # | O quê | Destrava |
| --- | --- | --- |
| 1 | Aprovar ou corrigir os textos (1.1–1.4, 2.1–2.10, 3.1–3.2, 4.1–4.3, 5.1) | todas |
| 2 | Link público de agendamento do Calendly | No-show |
| 3 | URL do webhook do Atlas e os campos que ele espera | Contrato fechado |
| 4 | Responsável da tarefa de contrato fechado | Contrato fechado |
| 5 | O arquivo Excel dos documentos | Documentos de gestão de passivo |
| 6 | Ligar a de Desqualificado como está? | Desqualificado |
| 7 | Assinatura: fica `*CB Advogados:*` em todas, ou alguma assina com outro nome? | todas |

## Referência técnica

**As variáveis foram testadas num envio real em 21/09** (no card do
Leonardo): `{{contact.name}}` (o nome da ficha), `{{contact.campo.data_e_hora_reuniao}}`
(sai como **09/09/2026 às 17:30h** — gravada em UTC, sai no fuso do
escritório), `{{contact.campo.link_reuniao}}` (o link do Meet),
`{{contact.phone}}`, `{{contact.email}}`, `{{conversation.link}}` (o link da
conversa no CRM) e `{{contact.origem}}` (vazio para quem não veio de anúncio).

**A trava por etiqueta** (contrato fechado) foi rodada duas vezes: sem a
etiqueta o corpo executou; com a etiqueta nada executou e o desfecho foi
*barrada*. O corpo da automação TEM de ficar dentro do ramo "não tem a
etiqueta" — ramo vazio não interrompe o resto, e a primeira versão deste
plano errava nisso.

**A caixa "interromper se o card sair desta etapa"** fica DESMARCADA no
contrato fechado (senão executar à mão num lead de outra etapa não manda
nada, e o último passo, que muda o card de funil, a interromperia) e
MARCADA no no-show.

**Limite do no-show a partir da espera de 30 dias:** a pergunta "o card se
mexeu desde que a execução começou?" enxerga só 30 dias de histórico de
movimento. O que continua protegendo é a posição atual do card: fora de No
Show na hora do envio, a mensagem não sai.

**O disparo automático de ponta a ponta não foi testado em produção** — seria
preciso ligar uma automação com textos não aprovados, e há clientes reais com
reunião marcada. Com os textos aprovados, o teste é o primeiro passo depois
de ligar.

## Decisões já travadas

- **Contrato fechado é uma automação só**, com trava por etiqueta. (08/09)
- **O passo redundante "mover para Contrato Fechado" fica**, para rodar à mão
  em lead de outra etapa. (08/09)
- **Mover para o funil Jurídico é o último passo.** (08/09)
- **Documentos de gestão de passivo é manual.** (08/09)
- **Formato de data: `30/08/2026 às 16:00h`.** (08/09)
- **Etiqueta de no-show aplicada uma vez só.** (20/09)
- **Lembretes DISPARAM para lead de qualquer conexão**, e só enquanto o card
  estiver em Reunião Agendada. (20/09)
- **Lembretes SAEM sempre por Bancário - Comercial.** (21/09)
- **Qualquer admin da conta gerencia qualquer automação.** (23/09; PR #260)
