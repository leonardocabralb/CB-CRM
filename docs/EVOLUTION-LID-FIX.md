# Mensagens enviadas pelo celular não aparecem no CRM (`@lid`)

Procedimento para aplicar o conserto na Evolution da VPS.

## O que está acontecendo

O WhatsApp trocou o endereço de parte das conversas: em vez do telefone
(`5511999999999@s.whatsapp.net`), passa um identificador interno
(`192603597332721@lid`). Medido na instância do escritório em **27/07/2026**:
**263 dos 551 chats** já migraram.

Quando alguém responde pelo **celular** (ou pelo WhatsApp Web), esse eco chega
ao CRM endereçado só pelo identificador, sem telefone nenhum. O CRM não tem
como saber de qual conversa é, e descarta.

| | |
| --- | --- |
| Ecos do aparelho perdidos | **119 de 143 em ~29h — 83%** |
| Mensagens de cliente perdidas | **0** |
| Como se percebe | comparando o celular com a tela; **não há erro nem aviso** |

O tipo da mensagem não importa: some texto, áudio e imagem igualmente. A
percepção de "só a mídia some" foi coincidência de amostra.

## A causa, e por que o conserto é uma linha

O telefone da outra ponta vem, nesse tipo de mensagem, num campo chamado
`peer_recipient_pn`. A biblioteca que a Evolution usa (Baileys) só passou a
ler esse campo em **2025-09-07**. A versão que roda aqui é de **2025-08-31** —
sete dias antes — e a correção nunca foi trazida de volta para essa linha.

Uma linha basta porque as duas pontas já sabem lidar com o dado: a Evolution
2.3.2 já troca o identificador pelo telefone sozinha assim que o recebe, e o
CB CRM já lê esse campo. **Nenhuma mudança no CRM é necessária.**

---

## Antes de começar

**1. Descubra a imagem que está rodando.** Na VPS:

```bash
docker service inspect evolution_evolution --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
```

Guarde a saída inteira, com o `@sha256:...` se aparecer. É ela que vai como
`base_image`, e é para ela que se volta se algo der errado.

**2. Confirme que a VPS consegue puxar do GHCR.** Ela já puxa a imagem do CRM
de lá, então normalmente sim. Para ter certeza:

```bash
docker pull ghcr.io/leonardocabralb/cb-crm:latest
```

Se pedir autenticação, faça `docker login ghcr.io` com um token de leitura de
pacotes antes de seguir.

**3. Anote a hora.** Serve para comparar o antes e o depois nos logs.

---

## Aplicar

**Passo 1 — construir a imagem.** No GitHub, aba *Actions* → workflow
**`evolution-lid-fix`** → *Run workflow*. Preencha `base_image` com a saída do
passo anterior. O resumo do workflow devolve a linha pronta com o digest.

O build **falha de propósito** se a imagem base não for o que se espera — se
já vier patcheada, ou se for de outra linha da biblioteca. Falhar aqui é o
comportamento certo: significa que a base mudou e o procedimento precisa ser
revisto, não empurrado.

**Passo 2 — aplicar na VPS.** Com a linha que o workflow imprimiu:

```bash
docker service update --image ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:... evolution_evolution
```

O Swarm troca o contêiner. **A sessão do WhatsApp não é afetada** — o patch
não toca em credenciais nem no estado de criptografia. Não é preciso ler QR.

**Passo 3 — conferir que subiu.**

```bash
docker service ps evolution_evolution --no-trunc | head -3
curl -s https://api.cbadvogados.com/ | head -c 200
```

---

## Verificar se funcionou

Esta é a parte que decide, e ela tem uma resposta objetiva.

**Teste direto:** mande uma mensagem **pelo celular** para um contato cuja
conversa já esteja em `@lid`, e veja se ela aparece no CRM em segundos.

**Teste pelo log — é o medidor de verdade.** O CRM registra cada descarte
desde o PR #16. No log do serviço do CRM:

```bash
docker service logs crm_crm --since 30m 2>&1 | grep -c 'DESCARTADA: endereçada por @lid'
```

- **Contagem cai a zero** com mensagens saindo do celular → funcionou.
- **Contagem continua subindo** → o patch aplicou, mas o campo
  `peer_recipient_pn` não está vindo nesta conta. Ver "Se não funcionar".

Vale rodar esse mesmo comando **antes** da troca, para ter a linha de base.

---

## Voltar atrás

```bash
docker service update --image <a imagem original, do passo 1> evolution_evolution
```

Só isso. Nada a desfazer no banco, no CRM ou no pareamento.

---

## Se não funcionar

Significa que a premissa não se confirmou: o WhatsApp não manda
`peer_recipient_pn` nos ecos desta conta. **Isso é informação, não fracasso** —
é a única medição que ninguém conseguiu fazer sem aplicar o patch.

Nesse caso, o próximo fio a puxar já foi localizado: a Baileys 6.7.19 emite um
evento `chats.phoneNumberShare` (`lib/Socket/messages-recv.js:643`) carregando
exatamente o par identificador ↔ telefone, quando o WhatsApp o compartilha. A
Evolution 2.3.2 não parece repassá-lo ao webhook — mas o dado chega ao
processo, e isso muda o problema de "não existe" para "não está exposto".

O que **não** fazer nesse cenário, e o porquê:

- **Subir para Evolution 2.3.7** — troca a perda do eco por um risco pior:
  há falha aberta e ativa em que a mensagem **não chega ao cliente** e a API
  responde "pendente" para sempre. Hoje perdemos o registro de mensagem que o
  cliente **recebeu**; lá o cliente não recebe.
- **Forçar a biblioteca 7 sobre a Evolution 2.3.2** — não sobe. A 2.3.2
  importa uma função que a linha 7 removeu; o contêiner entra em crash-loop.

---

## Dois avisos que valem independentemente disto

**A imagem não está fixada.** A Evolution 2.3.2 declara a biblioteca como
`github:WhiskeySockets/Baileys`, sem versão. Estarmos na 6.7.19 é acidente da
data em que a imagem foi construída — um rebuild qualquer traz a linha 7 e o
serviço não sobe. Vale fixar o serviço por **digest**, com ou sem este patch.

**A regra dos 14 dias.** O celular pareado precisa se conectar à internet ao
menos uma vez a cada 14 dias, ou o WhatsApp derruba o dispositivo vinculado e
a Evolution precisa de QR novo. É regra do WhatsApp, não da Evolution, e vale
para qualquer integração por QR.
