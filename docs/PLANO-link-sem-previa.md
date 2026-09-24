# Link sem prévia e balão "não confirmada" (23/09/2026)

Documento interno. Registra por que o CRM passou a mandar link sem prévia,
o que o balão vermelho novo faz e **a verificação que ficou pendente** (pedido
do operador: "deixar anotado para fazer o teste futuramente").

## 1. O que aconteceu

Mensagens com link enviadas **pelo CRM** não chegavam a parte dos clientes. O
WhatsApp não devolvia erro, e a bolha ficava em ✓ como qualquer mensagem.

| Dia | Mensagem | Cliente | O que se viu |
| --- | --- | --- | --- |
| 15/09 | link do Meet | cliente A, Android | recibo **ERROR**. O mesmo cliente tinha recebido um link do Meet pelo CRM em 08/09, ainda na Evolution 2.3.2 |
| 17/09 | link do ZapSign | cliente B, Android | ✓ para sempre; o escritório reenviou pelo celular e ele leu |
| 21/09 | link do Asaas | cliente C, Android | ✓ para sempre; a anterior e a seguinte foram lidas; o cliente respondeu **"Não veio"** |
| 23/09 | link da reunião | cliente B, Android | ✓ para sempre; a seguinte, 18 s depois, foi lida; às 14:49 ele pediu o link; o mesmo texto pelo celular às 14:56 foi lido |

(Os nomes ficam de fora de propósito: o repositório é público.)

Medido desde a Evolution 2.4 (09/09):

- Links enviados pelo CRM a **iPhone**: 68 de 68 entregues (62 eram avisos de
  automação).
- Links a **Android**: 0 de 4.
- Textos **sem link**: 113 de 113 entregues, inclusive a esses mesmos clientes.

## 2. A causa

A Evolution 2.4 (commit `53f47d5f` do upstream, de 04/01/2026) monta, para
**todo** texto com link, uma prévia no formato de **anúncio**: um
`contextInfo.externalAdReply` com `mediaType: 2`, `thumbnailUrl` externa e
`renderLargerThumbnail`. É o formato dos anúncios "clique para o WhatsApp". A
mudança foi um contorno para a prévia da Baileys, que não aparecia. Com
`linkPreview` ausente no pedido, a Baileys gera ainda a prévia dela por cima.
O CRM mandava só `{ number, text }`, então toda mensagem com link saía assim.

A prova do lado do WhatsApp:

- **Recibo ERROR** (15/09): na Baileys (`handleBadAck`), o recibo com erro vem
  com o comentário literal *"device could not display the message"*.
- **3 confirmações do servidor quase simultâneas, mais uma depois, e nenhuma
  entrega** (23/09): é o padrão do aparelho pedindo a mensagem de novo
  (reenvio) até desistir.

**Nem todo Android falha.** O Android da conexão Bancário - Jurídico exibiu os
dois formatos no teste de 23/09. Com a prévia de anúncio, a mensagem aparecia
com um quadro grande em branco em cima (a imagem nunca carregou). A falha
depende do aparelho de cada cliente, provavelmente da versão do WhatsApp.

## 3. O que mudou

1. **`linkPreview: false`** em `EvolutionClient.sendText`
   (`src/lib/whatsapp/transport/evolution-client.ts`), o ponto único de todo
   texto pela Evolution: atendente, agendada, API v1, automação, robô e IA.
   A Evolution deixa de montar a prévia de anúncio e a Baileys deixa de gerar
   a dela. O link sai no mesmo formato de um texto sem link, e o WhatsApp o
   torna clicável sozinho. Conferido no banco da Evolution: com o campo, a
   mensagem sai sem `externalAdReply`. Pino em `evolution-transport.test.ts`.
2. **Balão vermelho "Não confirmada"** (`src/lib/inbox/entrega-nao-confirmada.ts`,
   com teste). Das 4 falhas desde 11/09, só uma virou `failed` (recibo ERROR,
   que já tinha o seu balão vermelho). As outras 3 ficaram em ✓. O novo aviso
   acende quando a mensagem saiu pelo CRM por uma conexão **Evolution** e
   continua em ✓ depois de 1 minuto, com prova de que o aparelho do
   destinatário estava no ar: uma mensagem nossa posterior foi entregue ou
   lida (**pelo CRM ou pelo celular**, por qualquer conexão), ou o
   destinatário escreveu mais de 1 minuto depois dela. Ele usa o mesmo balão
   vermelho do "Não entregue", com outra frase. Nas 152 mensagens enviadas
   pelo CRM pela Evolution de 11/09 até 23/09, marca exatamente as 3 falhas
   reais, e nenhuma outra.
   - **Só Evolution** (revisão do PR #272): até 23/09/2026 a rota da Meta
     gravava a situação sem a escada (um "sent" atrasado rebaixava
     "delivered") e não esperava a mensagem existir para aplicar o recibo,
     então lá ✓ parado não provava nada. A Meta avisa a recusa de verdade com
     `failed`. A rota ganhou a escada e a espera nesse dia; o aviso continua
     só na Evolution até a medição abaixo ("Limites conhecidos").
   - **Confere no banco antes de pintar**: a recarga da conversa substitui a
     lista inteira e pode atropelar um recibo que acabou de chegar, deixando a
     tela em ✓ com ✓✓ no banco. A candidata que o banco já confirmou tem a
     tela corrigida; só fica vermelha a que o banco ainda diz "enviada".

### Limites conhecidos

- **Edição de mensagem** (`chat/updateMessage`): a Evolution não aceita
  `linkPreview` ali. Ao editar um texto para incluir link, a Baileys ainda
  pode gerar a prévia dela (a de anúncio, não). Não foi medido; é raro.
- **Meta fora do aviso novo.** O defeito que a tirava daqui (a rota dela
  gravava o recibo sem a escada de status e sem esperar a mensagem existir)
  foi consertado em 23/09/2026 (`handleStatusUpdate`, em
  `src/app/api/whatsapp/webhook/route.ts`). Medido no mesmo dia, antes do
  conserto: uma interativa de teste que o destinatário respondeu por botão
  ficou em ✓, rebaixada por um `sent` gravado depois do `delivered`. As
  mensagens da Meta gravadas antes do conserto continuam com a situação que o
  defeito deixou, então alargar o aviso pede: esperar mensagens suficientes
  pela Meta depois do deploy, medir os falsos positivos só nelas (corte na
  data do deploy, como o `RECIBOS_CONFIAVEIS_DESDE_MS` fez para a Evolution)
  e a decisão do operador. Em 23/09 eram só 10 mensagens de saída pela Meta
  desde 10/09, todas na conversa de teste.
- **Sem evidência não há aviso**: mensagem única e cliente calado ficam em
  ✓. Daqui não há como separar "não chegou" de "celular desligado".
- **A explicação ao passar o mouse não aparece no celular** (`title`). A
  frase do balão, que diz o que fazer, aparece sempre.

## 4. Verificação pendente

**Quando:** depois do deploy (23/09/2026), assim que houver ao menos 3 links
enviados **pelo CRM** a clientes Android. Na prática, o escritório manda
links de reunião quase todo dia. Se em uma semana não houver, rodar assim
mesmo e registrar o que houver.

⚠️ **Link mandado pelo CELULAR não prova nada**: ele não passa pela Evolution.
Só vale mensagem com `from_device = false`. A mensagem do celular entra só
como evidência (se ela foi entregue, o aparelho do cliente estava no ar).

⚠️ **Não testar mandando para um número que é CONEXÃO do CRM** (conferir
`cb_channels.display_phone`). Cada conexão tem um aparelho Baileys que
confirma sozinho tudo o que recebe, então o "entregue" não prova nada. Além
disso, a outra conexão grava a mensagem como se fosse de cliente e reabre a
conversa. Foi o que aconteceu no teste de 23/09.

### A. No CRM: links enviados pelo CRM depois do deploy, por aparelho do destinatário

⚠️ Filtrar por `sender_type`, nunca por `from_me`: o caminho da Meta grava
`from_me` nulo, e uma medição de 23/09 perdeu as mensagens da Meta por isso.

```sql
with saida as (
  select m.id, m.conversation_id, m.status, m.created_at
  from messages m
  join conversations cv on cv.id = m.conversation_id
  join cb_channels ch on ch.id = m.channel_id
  where m.sender_type in ('agent', 'bot') and coalesce(m.from_device, false) = false
    and cv.group_id is null and ch.kind = 'evolution'
    and m.deleted_at is null and m.content_type = 'text'
    and m.content_text ~* 'https?://'
    and m.created_at >= '2026-09-24 00:00:00+00'
    and m.created_at < now() - interval '30 minutes'
), plataforma as (
  -- Identificador de 32 (ou 21) caracteres = Android; de 20 = iPhone.
  select m.conversation_id,
    bool_or(length(m.message_id) in (21, 32)) as android,
    bool_or(length(m.message_id) = 20) as iphone
  from messages m
  where m.conversation_id in (select conversation_id from saida)
    and m.sender_type = 'customer' and m.message_id not like 'wamid.%'
  group by 1
)
select case when p.android and not coalesce(p.iphone, false) then 'android'
            when p.iphone and not coalesce(p.android, false) then 'iphone'
            when p.android and p.iphone then 'misto'
            else 'sem mensagem do cliente' end as aparelho,
       count(*) as links,
       count(*) filter (where s.status in ('delivered', 'read')) as entregues,
       count(*) filter (where s.status = 'sent') as em_enviada,
       count(*) filter (where s.status = 'failed') as falharam,
       count(distinct s.conversation_id) as conversas
from saida s left join plataforma p on p.conversation_id = s.conversation_id
group by 1 order by 1;
```

### B. No banco da Evolution: nenhuma mensagem enviada pela API leva a prévia de anúncio

O acesso ao banco da Evolution está em `docs/INFRA-VPS.md`
(`psql -U postgres -d evolution` dentro do contêiner do Postgres).

```sql
select count(*) filter (where "contextInfo" ? 'externalAdReply') as com_previa_de_anuncio,
       count(*) as enviadas_pela_api
from "Message"
where source = 'web' and (key->>'fromMe')::boolean
  and "messageType" = 'conversation'
  and to_timestamp("messageTimestamp") >= '2026-09-24 00:00:00+00';
```

⚠️ A consulta B só enxerga o `externalAdReply` porque o patch da citação na
nossa imagem (`docker/evolution-cb/2708-citacao.patch`) grava o
`contextInfo` do texto na coluna `contextInfo`. Numa imagem sem esse patch, a
coluna guarda só o `messageContextInfo`, e B daria zero sem provar nada.
Antes de confiar no zero, confira que a coluna traz `mentionedJid` (que toda
mensagem 1:1 pela API leva).

Os recibos de uma mensagem específica ficam em `"MessageUpdate"`, pela coluna
`"keyId"`. `ERROR` é a recusa do aparelho. Várias `SERVER_ACK` sem
`DELIVERY_ACK` são o aparelho pedindo reenvio.

### Critério

- **B:** `com_previa_de_anuncio = 0`. Se der mais que zero, a correção não
  está no ar (imagem ou deploy errados) e o resto não vale.
- **A:** para `android`, `entregues = links`. Uma mensagem em `em_enviada`
  só é problema se o balão dela estiver vermelho no CRM, ou seja, se o
  cliente escreveu depois ou se uma mensagem posterior foi entregue. Nesse
  caso, olhar os recibos dela no `MessageUpdate`.
- **Se ainda houver link do CRM que não chega a Android sem a prévia de
  anúncio,** a causa é outra e a investigação reabre. Os dois suspeitos de
  23/09 já estão fora, porque `linkPreview: false` desliga as duas prévias.

Resultado da verificação: *(preencher: data, números de A e B, conclusão)*.

Até 24/09/2026 esta pendência também estava escrita no `CLAUDE.md` (o 🔭
"VERIFICAÇÃO PENDENTE" da seção do link sem prévia), com a ordem de
registrar o resultado aqui e tirar a linha de lá. Com a reestruturação, esta
seção é a casa da pendência. Ao registrar o resultado, apague também todo
aviso de "verificação pendente" que ainda aponte para cá —
`grep -rn "PLANO-link-sem-previa" CLAUDE.md .claude/rules` acha os que
sobrarem.
