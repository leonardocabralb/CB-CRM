# Plano — o motivo da falha de envio na bolha, e "Tentar de novo"

Documento INTERNO (não vai para quem instala). Plano vivo: a tabela de Estado
muda a cada fase.

## Por quê

19/10/2026: a atendente mandou uma mensagem pela conexão Bancário - Comercial
e a bolha ficou vermelha com "Não entregue — o destinatário não recebeu.
Envie de novo." O log do CRM mostrou a causa: a Evolution recusou o envio
ANTES de mandar (`number … is not on WhatsApp`). Nada saiu. A frase estava
errada duas vezes:

- ela é a mesma da falha de RECIBO (a mensagem saiu e o WhatsApp avisou depois
  que não entregou) — aqui nada tinha saído;
- ela manda "envie de novo", e reenviar a um número sem WhatsApp falha igual.

O motivo real só aparecia no aviso do canto da tela, que some em segundos.

Pedido do operador: mostrar o motivo na bolha e ter um botão de reenvio. A
conferência (19/10) separou três situações que hoje caem na mesma bolha:

| Situação | Exemplo | Dá para reenviar com segurança? |
|---|---|---|
| Recusa comprovada: nada saiu | número sem WhatsApp, recusa 4xx da Evolution ou da Meta, conexão fechada, limite de envios, sessão expirada | Sim, quando a recusa pode mudar |
| Entrega incerta: pode ter saído | tempo esgotado, erro 5xx, queda de rede no meio, erro ao gravar depois de enviar | Não: reenviar pode mandar em dobro (CLAUDE.md, 8e) |
| Falha de RECIBO: saiu, o WhatsApp avisou depois | erro 479 de aparelho secundário, "Não entregue" da Meta | Não: não há consulta de entrega; decisões de 05/10 (#390) e do 479 em grupo |

Não existe leitura que responda "saiu?" com certeza no caso incerto: WhatsApp e
Meta não têm consulta de status, e o eco `fromMe` de envio feito pela API da
Evolution NUNCA foi medido (há indícios de que não existe: `route.ts` da
Evolution trata `send.message` como "just ack"; `WEBHOOK_EVENTS` sem
`SEND_MESSAGE`). Por isso o botão só existe onde a recusa é comprovada.

## Estado

| Fase | O quê | Estado |
|---|---|---|
| 1 | Motivo na bolha otimista + "Tentar de novo" só em recusa comprovada | Implementada e testada na tela (19/10/2026), branch `fix/motivo-da-recusa-na-bolha`; falta PR e merge |
| 2 | Gravar no banco a tentativa da equipe que falhou (vale para todos, sobrevive ao recarregar) | Aguarda decisão do operador |
| 3 | "Conferir e reenviar" no caso incerto | Não recomendada; só depois de medir uma leitura confiável |

## Fase 1 — o que entra

Pronto quando: a bolha da tentativa recusada diz por que não saiu, com a frase
certa para cada caso; "Tentar de novo" aparece só na recusa comprovada e
reenvia pelo caminho do compositor (com a janela de desfazer); nada muda na
falha de recibo, no robô nem no banco.

1. **Servidor** (`src/app/api/whatsapp/send/route.ts`): a resposta de erro do
   núcleo passa a trazer `code` e `motivo` (+ `detalhe`), além do `error` de
   sempre. O motivo sai de `motivoDaFalhaDoNucleo`
   (`src/lib/whatsapp/envio-que-falhou.ts`), que reaproveita o
   `classificarFalha` do robô sobre o erro do PROVEDOR — que o núcleo passa a
   carregar em `SendMessageError.cause` (sem mudar código nem status, nada muda
   para a API v1).
2. **Motivo novo `barrado`** em `MOTIVOS_DO_ENVIO`: o envio parou NO CRM, antes
   de chegar a qualquer conexão (conversa não achada, conexão sem
   configuração, janela de 24h, número trocado no meio, limite, sessão). A frase
   do `recusado` diz "o WhatsApp recusou", o que seria falso aqui.
3. **Tela** (`src/lib/inbox/falha-do-envio.ts`): `falhaDaResposta` lê a resposta
   da rota (o `motivo` do servidor; sem ele, 4xx = `barrado` e o resto =
   `incerto`) e decide `podeTentarDeNovo` — só `recusado`, `conexao_fora_do_ar`
   e o `barrado` transitório (401, 429). Erro de rede no navegador = `incerto`.
4. **Bolha otimista** (`message-thread.tsx`, os quatro caminhos: texto, mídia,
   interativa, modelo): na falha ganha `nao_saiu` + `error_title` (motivo) +
   `error_details`, e a bolha usa as frases "não enviada" que já existem
   (decisão de 06/10 para o robô). Nada é gravado no banco.
5. **"Tentar de novo"** (`message-bubble.tsx`): só no TEXTO, só na bolha
   otimista com recusa comprovada, e some com a conexão fora do ar ou a janela
   de 24h fechada. O clique entrega o texto ao compositor
   (`reenviarTexto`), que o RETÉM na janela de desfazer e o manda pela fila de
   saída da conversa, como o Enviar (decisões de 05/10 e 15/10). O envio
   reaproveita a MESMA bolha (sem bolha duplicada). "Desfazer" cancela o
   reenvio e devolve o botão; o texto NÃO vai para o campo (senão a pessoa
   poderia mandar pelos dois).
6. **Sem botão**: anexo (já volta para a prévia), número sem WhatsApp,
   entrega incerta, 409 de número trocado (o aviso já é a pergunta), janela de
   24h fechada, e qualquer bolha com `message_id` (falha de recibo).
7. **Conserto achado no caminho**: o 409 de número trocado chamava
   `onNewMessage` sobre a bolha já publicada, que os dois hosts ignoram (dedupe
   por id) — a bolha ficava "enviando". Passa a `onUpdateMessage`.

Limites conhecidos (aceitos na Fase 1):
- a bolha continua só na tela de quem enviou, e some: ao recarregar a página;
  na recarga silenciosa do fio (`handleMessagesLoaded` troca a lista pela do
  banco — ao voltar para a aba e ao reconectar o tempo real); e quando chega
  qualquer mensagem nova na conversa (o INSERT do realtime tira todas as
  `temp-`). Medido no teste de 19/10: as quatro bolhas de teste sumiram numa
  recarga silenciosa, sem nenhuma mensagem nova. Já era assim antes; quem
  resolve é a Fase 2 (a tentativa gravada no banco);
- o texto do motivo que vem do servidor pode estar em inglês (é o mesmo que o
  aviso do canto já mostrava);
- ~~modelo da Meta com cabeçalho de mídia SEM o arquivo aparece como "envio
  incerto"~~ — RESOLVIDO no mesmo PR (19/10/2026, pedido do operador): o
  núcleo monta o modelo (`buildSendComponents`) antes do laço de variantes e
  do número na conversa sem número; o que ele recusa (mídia sem arquivo,
  menos valores que as variáveis do corpo, variável do cabeçalho vazia, botão
  de URL sem o final — valor de corpo VAZIO ainda vai à Meta) é 400 `bad_request` →
  "Não enviada — o envio parou antes de sair", com o motivo. Na API v1 esses
  casos passam de 502 `meta_error` a 400 `bad_request` (doc pública junto).

### Resultado medido (19/10/2026)

- Suíte inteira em Node 22, typecheck e lint (0 erros) verdes; mutação: tirar o
  `cause` da Evolution reprova os dois testes novos de `send-message.test.ts`.
- Teste na tela (preview da branch, só a conversa do lead de teste, nenhuma
  mensagem real enviada — o `fetch` da rota de envio interceptado):
  - rota REAL com pedido inválido: "Não enviada — o envio parou antes de sair"
    + "Motivo: …", sem botão;
  - número sem WhatsApp, incerto e recusa simulados: a frase de cada um; botão
    só na recusa;
  - "Tentar de novo" → barra "Enviando em 3s… Desfazer", botão some, nenhum
    envio; "Desfazer" → botão volta, campo intacto; de novo → UM envio, com o
    texto cru e o `expected_channel_id`, na MESMA bolha, que vira ✓;
  - Desfazer depois de a recarga silenciosa levar a bolha: o texto volta ao
    campo, somado ao rascunho que estava lá.
  - Banco: zero linhas novas na conversa do lead durante o teste.
- Revisão adversária (3 lentes + um cético por achado): corrigidos o Desfazer
  sem bolha, as linhas da tabela do `MERGE-UPSTREAM.md` e dois pinos de teste;
  o modelo de mídia sem arquivo foi resolvido em seguida, no mesmo PR (acima).
  Mutação: tirar a montagem antecipada reprova os dois testes de recusa.

## Fase 2 — riscos já levantados (para a decisão)

- Muda a regra "o envio de GENTE não grava bolha" (`whatsapp-envio.md`): a bolha
  "não enviada" de 06/10 foi decidida só para o robô.
- A linha `agent` + `sender_id` + `nao_saiu` pausaria o agente de IA como "gente
  respondeu" (gatilho da 1049 não filtra `nao_saiu`) e entraria no ramo `agent`
  da `cb_ia_reservar_envio` (1080): migration nova.
- Três leitores com o predicado `sender_id`/`from_device` sem `nao_saiu`
  (`ligacoes/registrar.ts`, `sem-telefone/historica.ts`, `dashboard/queries.ts`).
- Autoria: gravar como `bot` perde quem mandou; como `agent`, dispara os itens
  acima.
- Botão visível a toda a equipe: dois cliques mandam em dobro sem um cadeado no
  banco (`UPDATE … RETURNING`).
- Não gravar o `incerto` (o eco, se existir, viraria segunda bolha).
- Gravar só na rota do compositor, nunca no núcleo (agendada e API v1 têm o
  próprio contrato).
