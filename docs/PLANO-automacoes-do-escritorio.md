# Automações do escritório — textos aprovados e o que falta

> Este documento é sobre **o conteúdo** das automações do CB Advogados: quais
> são, o que cada uma faz e **que texto sai para o cliente**. A *ferramenta*
> de automações está em `PLANO-automacoes-multicanal-e-funil.md`.
>
> **Atualizado em 23/09/2026 (noite)**, depois da rodada de aprovação: o
> operador marcou os textos, reescreveu vários e deu três instruções de
> estrutura (boas-vindas pelo Bancário - Jurídico, documentos em cadeia depois
> do contrato fechado, envio ao Atlas e à planilha no lugar do n8n da Kommo).
> Pediu também que a **data da proposta** passasse a ser controlada pelo CRM.
>
> **Gravado na produção em 23/09/2026 à noite** (todas desligadas, menos a da
> data da proposta, que não manda mensagem). O fluxo do n8n foi importado e
> ativado pelo operador no mesmo dia.

## Onde estamos

| # | Automação | Textos | Ligada | Falta para ligar |
| --- | --- | --- | --- | --- |
| 1 | Lembrete de reunião · 24h / 4h / 1h / 10min | **aprovados** | não | só a sua ordem |
| 2 | (PENDENTE) No-show · recuperação | **aprovados** (9 mensagens) | não | link de agendamento, imagem (2.6), PDF (2.7) |
| 3 | (PENDENTE) Contrato fechado | **boas-vindas aprovada** | não | link do Google, responsável da tarefa |
| 4 | (PENDENTE) Documentos de gestão de passivo | **aprovados** (4 mensagens) | não | arquivo Excel da planilha |
| 5 | Typebot · Abaixo de 150 mil com processo | texto 5.1 **fica para depois** | sim (sem mensagem) | — |
| 6 | (PENDENTE) Desqualificado | não tem texto | não | só a sua palavra |
| 7 | Funil · grava a data da proposta (**nova**) | não tem texto | **sim** | — |

Nenhuma delas é ligada sem ordem sua. Aprovar o texto e ligar são dois
passos — os lembretes, por exemplo, pegam na hora quem já tem reunião marcada.

## O que você decidiu nesta rodada

- **Lembretes:** os quatro aprovados como estão.
- **No-show:** a sequência passa a ter **9 mensagens** — a de 90 dias saiu; a
  de 60 dias é a despedida. A 2.6 leva uma **imagem** entre as duas partes do
  texto e a 2.7 um **PDF** logo depois do texto.
- **Contrato fechado:** as boas-vindas saem pelo **Bancário - Jurídico** (o
  texto pede ao cliente que salve esse número). O aviso ao Atlas manda o que o
  n8n da Kommo ("Contador Bancário") manda hoje, e a planilha **Controle
  Clientes - CB Advogados** continua recebendo a linha.
- **Documentos:** deixa de ser só manual — roda sozinha **2 minutos depois do
  fim** do contrato fechado. As mensagens são assinadas pela **Dra. Maura
  Emília - Jurídico**.
- **Typebot -150k:** fica pendente; será feito depois.
- **Data da proposta:** é a data em que o card entra na etapa da proposta, e o
  CRM a controla num campo da ficha.

## Correções de grafia aplicadas

Só grafia — nenhuma palavra trocada, o tom ficou como você escreveu. Se
alguma não era para mudar, me diga o número.

- **1.1:** Ola → **Olá**; reuniao → **reunião** (vieram do meu rascunho).
- **1.2:** tô → **Tô** (começa a frase); ta certo? → **tá certo?**
- **2.4:** ", Não tive" → ", **não** tive".
- **2.5:** ultimas → **últimas**.
- **2.6 e 2.8:** ta? → **tá?**
- **2.7, 2.8 e 2.9:** dividas → **dívidas**.
- **4.1:** "Tudo bem?  para" → "Tudo bem? **Para**".
- **4.2:** "para a iniciar" → "para iniciar"; residencia → **residência**;
  emprestimos → **empréstimos**; "Não precisar ser" → "Não **precisa** ser";
  "no formado de PDF" → "no **formato** de PDF".
- **4.3:** baixa-los → **baixá-los**; solicita-los → **solicitá-los**;
  Whatsapp → **WhatsApp**.
- **4.4:** persisitir → **persistir**.
- **Documentos:** a linha `*Dra. Maura Emília - Jurídico:*` que você pôs no
  alto das mensagens virou a **assinatura da automação** ("Assinar como"): o
  resultado no WhatsApp é o mesmo, vale para as quatro mensagens (a 4.2 não a
  tinha) e não duplica com a assinatura automática da conta.

---

## Seção 1 — Lembretes de reunião ✅ aprovados

Quatro automações, uma por antecedência, lendo o campo "Data e Hora Reunião"
(o que o Calendly preenche). Só disparam com o card em *Reunião Agendada*,
saem **sempre por Bancário - Comercial** e a data sai como
`30/08/2026 às 16:00h`. Reagendar recomeça a série; cancelar desarma.

**1.1 — 24 horas antes**

```
Olá, {{contact.name}}! Tudo bem?

Passando para lembrar da sua reunião com a equipe do CB Advogados:
*{{contact.campo.data_e_hora_reuniao}}*

Nela o advogado irá te explicar as estratégias disponíveis para conseguirmos reduzir os débitos bancários e proteger o patrimônio da empresa.

Amanhã te enviarei o link da videochamada.

Qualquer dúvida, só chamar aqui!
```

**1.2 — 4 horas antes**

```
Oi, {{contact.name}}! Tô passando pra te lembrar da nossa reunião de hoje!

*{{contact.campo.data_e_hora_reuniao}}*

Link de acesso: {{contact.campo.link_reuniao}}

A apresentação da sua solução já está sendo finalizada pelo advogado responsável.

Durante a reunião preciso que você esteja em um local tranquilo e preferencialmente no computador, tá certo?

*Vamos conversar sobre pontos muito importantes e preciso da sua total atenção.*
```

**1.3 — 1 hora antes**

```
{{contact.name}}, segue link da nossa reunião:

Link de acesso: {{contact.campo.link_reuniao}}

Nossa reunião será daqui *1 hora*, te encontro já!
```

**1.4 — 10 minutos antes**

```
Oi! O advogado que realizará sua reunião está finalizando um atendimento e daqui 10 minutos entrará no link que te mandei acima pra te aguardar, ok?
```

> ⚠️ **Ao ligar, eles pegam gente na hora.** Na manhã de 23/09, 11 contatos
> tinham reunião futura no campo, 5 nas 24 horas seguintes.

**Falta para ligar:** só a sua ordem.

---

## Seção 2 — No-show · recuperação ✅ aprovados

Gatilho: card entrou em *No Show*. Aplica a etiqueta `No-Show` e manda
**nove** mensagens: na hora, 1h, 3h, 24h, 72h, 7 dias, 15, 30 e 60 dias.
**Para sozinha** se o cliente responder (cada espera longa tem "parar se o
cliente responder") ou se o card sair de No Show — inclusive quando o Calendly
o move porque o cliente reagendou. Os 97 cards que já estão em No Show não
recebem nada (dá para rodar à mão num card específico).

**2.1 — na hora**

```
{{contact.name}}, tentamos te encontrar na reunião agora e não conseguimos.

Imagino que algo tenha surgido, acontece.

Quer remarcar para outro horário? É só escolher aqui: [LINK DE AGENDAMENTO]
```

**2.2 — 1 hora depois**

```
Oi, {{contact.name}}! Se preferir, me diga por aqui qual o melhor dia e horário para você, que eu encaixo na agenda do advogado.
```

**2.3 — 3 horas depois**

```
{{contact.name}}, ainda tem interesse em resolver a sua situação?

Surgiu uma vaga na agenda, vou te enviar novamente o link pra marcar a conversa: [LINK DE AGENDAMENTO]
```

**2.4 — 24 horas depois**

```
{{contact.name}}, não tive seu retorno ontem, ainda é uma prioridade pra você encontrar uma solução para os débitos bancários?

Caso tenha mudado de ideia, basta avisar que eu encerro seu chamado aqui.
```

**2.5 — 3 dias depois**

```
Oi, {{contact.name}}. Acabei não tendo seu retorno sobre as últimas mensagens, então vou considerar que você já tenha resolvido sua situação.

Se algum dia esses débitos bancários apertarem o caixa da empresa e você precisar de alguma orientação sobre o que fazer, pode chamar.

Abraço!
```

**2.6 — 7 dias depois** (texto → imagem → texto, 10 segundos entre as partes)

```
{{contact.name}}, como vão as coisas?

Essa semana fechamos alguns acordos e eu queria compartilhar os resultados com você.
```

`(IMAGEM — falta o arquivo)`

```
Se quiser entender melhor como funciona esse procedimento vou deixar aqui abaixo o link de agendamento, tá?

[LINK DE AGENDAMENTO]
```

**2.7 — 15 dias depois** (texto → PDF, 10 segundos depois)

```
Oi, {{contact.name}}! Acabei não tendo seu retorno, de toda forma, acho que vou conseguir te ajudar.

Vou te enviar abaixo um PDF que explica um pouco sobre o trabalho do escritório.

Se você tiver dívidas bancárias e estiver com dificuldades para fazer o pagamento, certamente terão informações que podem te ajudar.
```

`(PDF — falta o arquivo)`

**2.8 — 30 dias depois**

```
{{contact.name}}, como vão as coisas?

Abrimos algumas vagas especiais na agenda do nosso sócio pra poder conversar com clientes que precisem de proteção patrimonial e redução de dívidas bancárias.

Vou deixar aqui abaixo o link pra você marcar uma reunião, caso te interesse, tá?

[LINK DE AGENDAMENTO]
```

**2.9 — 60 dias depois** (a despedida)

```
Oi, {{contact.name}}. Não tive seu retorno sobre as últimas mensagens então vou considerar que você já tenha resolvido sua situação, ok?

Se algum dia precisar de ajuda para tratar sobre dívidas bancárias, pode nos chamar.

Forte abraço!
```

**Falta para ligar:** o link público de agendamento do Calendly (entra nas
2.1, 2.3, 2.6 e 2.8), a imagem da 2.6 e o PDF da 2.7. Os dois passos de
arquivo estão na automação sem arquivo, e é isso que **impede de ligar por
engano**: a tela recusa ativar passo de mídia vazio. O link não tem essa
trava — a automação continua com "(PENDENTE)" no nome até ele entrar.

---

## Seção 3 — Contrato fechado

Gatilho: card entrou em *Contrato Fechado*. Uma trava na frente: **se o
contato já tem a etiqueta `Cliente Fechado`, nada acontece** (é o que impede
o cliente de receber tudo duas vezes). Sem a etiqueta, nesta ordem:

1. aplica `Cliente Fechado` e `Bancário`;
2. move para Contrato Fechado (redundante, para poder rodar à mão em lead de
   outra etapa);
3. grava a **Data de Fechamento do Contrato** na ficha (hoje);
4. espera 30 s, marca **ganho**, espera 10 s;
5. manda as **boas-vindas pelo Bancário - Jurídico** (3.1);
6. espera 10 s, cria a **tarefa** para a equipe (3.2);
7. move o card para **Bancário - Jurídico → Cliente Ativo**;
8. **avisa o Atlas e a planilha** (3.3);
9. espera **2 minutos** e **aciona a automação de Documentos** (seção 4).

> **Por que o aviso ao Atlas foi para o fim** (antes vinha logo depois do
> passo 2): passo que falha encerra a execução, e a trava por etiqueta impede
> rodar de novo. Com o aviso no começo, um soluço do n8n deixaria o cliente
> sem boas-vindas, sem o card no Jurídico e sem os documentos — e sem como
> repetir. No fim, uma falha dele só deixa de criar a linha no Atlas e na
> planilha, e o resto já aconteceu.

**3.1 — boas-vindas ao cliente** ✅ aprovado · sai pelo **Bancário - Jurídico**

```
{{contact.name}}, seja muito bem-vindo(a) ao CB Advogados!

Seu contrato está assinado e seu caso já entrou na fila do nosso time jurídico.

A partir de agora este será o número do seu canal com a gente, *peço que salve nos seus contatos.*

Em alguns instantes você será transferido para um dos nossos advogados.

Enquanto isso, gostaria de te pedir para avaliar com 05 estrelas nosso atendimento até aqui através do link abaixo, essa avaliação é muito importante para nós.

[LINK GOOGLE]
```

**3.2 — a tarefa criada para a equipe** (não vai para o cliente) · ⏳ sem
resposta

```
Título:      Novo cliente fechado: {{contact.name}}
Descrição:   Contrato assinado. Dar início ao atendimento jurídico.
Prazo:       1 dia
Responsável: [QUEM?]
```

Sem responsável a tela recusa ligar a automação. Se a tarefa não for
necessária, me diga e eu tiro o passo.

**3.3 — o aviso ao Atlas e à planilha**

O CRM manda um aviso ao **n8n do escritório**, e o n8n faz as duas coisas que
o "Contador Bancário" faz hoje: **grava a linha na planilha "Controle
Clientes - CB Advogados"** e **cria o cliente no Atlas**. A planilha não tem
como ser escrita pelo CRM sem uma integração com o Google, e o n8n já tem a
credencial; a chave do Atlas também fica só lá, fora do CRM.

O que o CRM manda (tudo sai do CRM, nada mais vem da Kommo):

| Campo | De onde vem no CRM |
| --- | --- |
| nome | nome da ficha |
| telefone | telefone da ficha (o n8n acrescenta o 9 que faltar e tira o estado do DDD) |
| e-mail | e-mail da ficha |
| valor do contrato | **valor do card** — preencher o valor antes de mover para Contrato Fechado |
| data do primeiro contato | campo "Data do Primeiro Contato" se preenchido; senão, **a data de criação do card** (nos cards da Kommo é a data do lead lá) |
| data da proposta | campo **"Data da Proposta"** (seção 7) |
| data do fechamento | campo "Data de Fechamento do Contrato", gravado pelo passo 3 |
| link | **link da conversa no CRM** (vai na coluna "Link Kommo" da planilha e no `chatLink` do Atlas) |

No Atlas o cliente entra como hoje: `create_client`, contrato `fixo`, estado
pela sigla do DDD, datas `aaaa-mm-dd`. Na planilha: "Status Contrato" =
Ativo, "Tipo de Contrato" = Fixo, datas `dd/mm/aaaa`. Duas diferenças do fluxo
da Kommo: o campo `notes` do Atlas deixa de dizer "TESTE_N8N_ATLAS" e passa a
dizer "Enviado pelo CB CRM em …"; e a planilha **"Planilha Geral BI"**, que o
fluxo da Kommo também alimenta, **não** entrou (você pediu só a Controle
Clientes — se ela também deve receber, é um nó a mais no n8n).

**No n8n (feito em 23/09):** os nós novos entraram no próprio fluxo do
"Contador Bancário" (renomeado "CB CRM · Contrato fechado → Atlas e
planilha"), com o endereço
`https://webhook.cbadvogados.com/webhook/crm-contrato-fechado`, que é o que o
passo do CRM chama. Conferido na exportação: token, código de formatação,
planilha (credencial "Google Sheets account 2", cabeçalho na linha 5) e Atlas.

> ⚠️ **O gatilho antigo da Kommo (`contador-bancario`) foi DESATIVADO no mesmo
> dia**, e o contrato fechado do CRM continua desligado. Enquanto os dois
> estiverem assim, **contrato fechado não chega ao Atlas nem à planilha por
> caminho nenhum**. A troca tem de ser no mesmo dia: reativar o nó antigo até
> ligar o contrato fechado no CRM, e desativá-lo nesse dia (os dois ligados =
> o cliente entra duas vezes). E a **"Planilha Geral BI"** só era alimentada
> pela cadeia antiga — com ela desativada, a BI parou de receber.

O aviso leva um **token** no cabeçalho que o fluxo novo confere: quem
descobrir o endereço não consegue criar cliente no Atlas. Falha na planilha ou
no Atlas aparece no **histórico de execuções do n8n**, como hoje — o CRM só
sabe que o n8n recebeu.

**Falta para ligar:** o link do Google (3.1), o responsável da tarefa (3.2) e
o fluxo do n8n importado e ativo.

---

## Seção 4 — Documentos de gestão de passivo ✅ aprovados

**Roda sozinha 2 minutos depois do fim do contrato fechado** (a de contrato a
aciona) e continua podendo ser rodada à mão pelo menu + da conversa. Sai pelo
**Bancário - Jurídico**, **assinada como "Dra. Maura Emília - Jurídico"**,
com 10 segundos entre as mensagens e a planilha no fim.

> ⚠️ **Ligar esta ANTES da de contrato fechado.** O motor se recusa a acionar
> automação desligada — de propósito, para o interruptor continuar sendo o
> freio. Com esta desligada, o contrato fechado terminaria em "falhou" no
> último passo.

**4.1**

```
Olá! Tudo bem? Para darmos andamento à gestão do seu passivo, vou precisar de alguns documentos seus.
```

**4.2**

```
Abaixo está a lista de todos os documentos que precisamos para iniciar nosso processo de Gestão de Passivo.

1) RG ou CNH (frente e verso) da PF ou sócio administrador da empresa (Em caso de PJ)
2) Comprovante de residência
3) Contrato social atualizado. (Em caso de PJ)
4) Demonstrativo de resultado financeiro (DRE) da empresa do último mês (Em caso de PJ)
5) Última negociação firmada e assinada com o banco, constando o número de contrato dos empréstimos a serem revisionados.
6) IRPF e IRPJ (Em caso de PJ)
7) Extrato do SERASA (PF / sócio da empresa)

*O DRE é um documento que demonstre as entradas e saídas da empresa durante os últimos 03 ou 06 meses. É interessante que esse documento demonstre que a empresa teve mais despesas do que receita, comprovando o prejuízo operacional. Não precisa ser um documento fiscal, pode ser um documento simples contendo os dados e assinado pelo contador.

*ATENÇÃO:* Essa documentação deverá ser reunida e enviada via e-mail para *documentos@cbadvogados.com* preferencialmente no formato de PDF, já nomeada ou então, se preferir, pode enviar aqui pelo WhatsApp.
```

**4.3**

```
Caso você não tenha os contratos bancários, você precisará baixá-los através do APP do seu banco ou então solicitá-los ao gerente via e-mail ou WhatsApp.

Caso ele negue o envio faremos a solicitação por aqui através de uma reclamação no BACEN, mas pra essa reclamação dar certo precisamos comprovar que houve uma tentativa de solicitação administrativa.
```

**4.4**

```
Por fim vou te enviar uma planilha pra que você possa preencher! Ela é bem intuitiva e vou precisar que você preencha com bastante atenção.

Caso você tenha dificuldade no preenchimento pode me perguntar por aqui. Se mesmo assim a dificuldade persistir não se preocupe que faremos o preenchimento juntos na nossa reunião de alinhamento.

Mas novamente, o ideal é que você já chegue na reunião com os documentos prontos e planilha preenchida para que possamos apenas fazer os ajustes juntos.
```

`(PLANILHA — falta o arquivo Excel)`

**Falta para ligar:** o arquivo Excel. O CRM aceita `.xlsx` e `.xls`.

---

## Seção 5 — Typebot · Abaixo de 150 mil com processo ⏸️ pendente

Decisão sua: fica para depois. A automação continua ligada fazendo o que já
faz (campo "Processo Judicial" e etiqueta `-150k`), sem mandar mensagem. O
rascunho 5.1 está guardado no histórico deste documento.

---

## Seção 6 — Desqualificado

Sem mudança. Aplica a etiqueta `Desqualificado` e **encerra a conversa**;
qualquer mensagem do cliente depois a devolve à caixa. Ligada, também pega os
leads que o Typebot move para Desqualificado. **Falta para ligar:** só a sua
palavra.

---

## Seção 7 — A data da proposta (NOVO)

"Data da proposta" = **a data em que o card entra em *Proposta Realizada***
(Bancário - Comercial). O CRM a guarda no campo **"Data da Proposta"** da
ficha — o campo já existia e estava vazio em todos os contatos.

- **Daqui para a frente:** a automação **"Funil · grava a data da proposta"**
  preenche o campo toda vez que um card entra em Proposta Realizada. Se o
  card sair e voltar, fica a data da volta (a proposta mais recente). O campo
  continua editável na ficha — dá para corrigir à mão.
- **Para trás:** o histórico do funil guarda a data real de cada entrada em
  Proposta Realizada, inclusive a dos cards que vieram da Kommo. São **408
  cards de 407 contatos** (274 ainda nessa etapa); o campo é preenchido com a
  entrada mais recente de cada um, só onde estiver vazio.
- **Feito em 23/09:** 407 contatos preenchidos (274 com o card hoje em
  Proposta Realizada), todos no formato do campo; a lista dos contatos
  gravados ficou guardada para desfazer.
- Ela não manda mensagem, e foi ligada depois que o PR #275 entrou no ar
  (antes disso a variável `{{now}}` não existe e o passo não gravaria nada).

---

## O que falta você me dar

| # | O quê | Destrava |
| --- | --- | --- |
| 1 | Ordem para ligar os lembretes | Lembretes |
| 2 | Link público de agendamento do Calendly | No-show |
| 3 | A imagem (2.6) e o PDF (2.7) | No-show |
| 4 | O link de avaliação do Google | Contrato fechado |
| 5 | Responsável da tarefa (ou tirar a tarefa) | Contrato fechado |
| 6 | O gatilho da Kommo no n8n: reativar até ligar o contrato fechado? E a Planilha Geral BI? | Atlas e planilhas sem buraco |
| 7 | O arquivo Excel da planilha | Documentos |
| 8 | Ligar a de Desqualificado como está? | Desqualificado |

## Referência técnica

**Variáveis novas do motor (PR #275):** `{{deal.value}}` (valor do card),
`{{deal.created_at}}` (criação do card) e `{{now}}` (o instante do passo). Na
mensagem saem formatadas ("R$ 3.500,00", "30/08/2026 às 16:00h"); no webhook e
ao gravar campo, cruas (`3500`, data ISO). O corpo do webhook passou a
escapar cada valor — um nome com aspas quebrava o JSON inteiro.

**O corpo que o CRM manda ao n8n** (passo 8 do contrato fechado):

```
{
  "nome": "{{contact.name}}",
  "telefone": "{{contact.phone}}",
  "email": "{{contact.email}}",
  "valor_do_contrato": "{{deal.value}}",
  "negocio_criado_em": "{{deal.created_at}}",
  "data_do_primeiro_contato": "{{contact.campo.data_do_primeiro_contato}}",
  "data_da_proposta": "{{contact.campo.data_da_proposta}}",
  "data_de_fechamento": "{{contact.campo.data_de_fechamento_do_contrato}}",
  "origem": "{{contact.origem}}",
  "link_crm": "{{conversation.link}}"
}
```

**O fluxo do n8n** (`n8n-crm-contrato-fechado.json`): Webhook → confere o
token (`x-cb-crm-token`) → formata (telefone com o 9, estado pelo DDD, datas no
fuso do escritório, valor com vírgula para a planilha) → planilha e Atlas em
paralelo. Os arquivos exportados têm a chave do Atlas e o token: apague-os de
Downloads. ⚠️ O JSON do "Contador Bancário" que você me mandou tem **o token da
Kommo (válido até 2029) e a chave do Atlas em texto aberto** — não o
compartilhe.

**As variáveis de contato** foram testadas num envio real em 21/09:
`{{contact.name}}`, `{{contact.campo.data_e_hora_reuniao}}` (sai
`09/09/2026 às 17:30h`), `{{contact.campo.link_reuniao}}`,
`{{contact.phone}}`, `{{contact.email}}`, `{{conversation.link}}` e
`{{contact.origem}}`.

**A trava por etiqueta** do contrato fechado foi rodada duas vezes em 21/09:
sem a etiqueta o corpo executou; com a etiqueta nada executou e o desfecho foi
*barrada*. O corpo fica dentro do ramo "não tem a etiqueta".

**A caixa "interromper se o card sair desta etapa"** fica DESMARCADA no
contrato fechado (o próprio passo 7 muda o card de funil) e MARCADA no
no-show.

**O disparo automático de ponta a ponta não foi testado em produção** —
exigiria ligar automação com cliente real no caminho. Com as pendências
resolvidas, o teste é o primeiro passo depois de ligar, num card de teste.

## Decisões já travadas

- **Contrato fechado é uma automação só**, com trava por etiqueta. (08/09)
- **O passo redundante "mover para Contrato Fechado" fica.** (08/09)
- **Formato de data: `30/08/2026 às 16:00h`.** (08/09)
- **Etiqueta de no-show aplicada uma vez só.** (20/09)
- **Lembretes disparam para lead de qualquer conexão**, só com o card em
  Reunião Agendada, e **saem sempre por Bancário - Comercial.** (20–21/09)
- **Qualquer admin da conta gerencia qualquer automação.** (23/09; PR #260)
- **No-show com 9 mensagens; boas-vindas pelo Bancário - Jurídico; documentos
  2 minutos depois do contrato fechado, assinados pela Dra. Maura; Atlas e
  planilha pelo n8n; data da proposta = entrada em Proposta Realizada.**
  (23/09)
- **O aviso ao Atlas é o último passo do contrato fechado antes dos
  documentos** (antes vinha logo depois do "mover"), para uma falha dele não
  impedir o resto. (23/09)
- **Atlas e planilha pelo n8n, não por integração própria do CRM**: o CRM
  manda os dados, o n8n formata e distribui; as chaves do Atlas e do Google
  ficam só no n8n. (23/09)
