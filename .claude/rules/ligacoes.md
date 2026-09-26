---
paths:
  - "src/lib/whatsapp/ligacoes/**"
  - "src/components/inbox/aviso-de-ligacao.tsx"
  - "supabase/migrations/*ligacoes*"
  - "docs/PLANO-ligacoes-do-whatsapp.md"
---

# Ligações de WhatsApp — regras

Vale ao mexer na ligação que vira faixa no fio (1044): `src/lib/whatsapp/ligacoes/`
(`evento`, `desfecho`, `telefone`, `previa` puros e testados; `registrar` faz o
I/O), o ramo `call` da rota do webhook da Evolution, a faixa
`aviso-de-ligacao.tsx` e todo leitor de `messages.content_type`. Plano vivo,
medições e decisões do operador: `docs/PLANO-ligacoes-do-whatsapp.md`. As
obrigações gerais de caminho de entrada estão em `.claude/rules/ingestao.md`.

## O aviso CALL

- ⚠️⚠️ **A Evolution só manda o aviso quando `CALL` está na lista de eventos
  da instância**, e a lista é gravada na criação. Conexão já existente só passa
  a receber depois de **"Ressincronizar"** (`WEBHOOK_EVENTS` em
  `evolution-provision.ts`). O sintoma da falta é ausência, não erro.
- ⚠️⚠️ **"Rejeitar ligação" e "mensagem ao ligar" da Evolution ficam
  DESLIGADOS** (`rejectCall`/`msgCall`): o primeiro recusa a chamada também nos
  celulares do escritório; o segundo sai em TODA ligação e volta pelo webhook
  como mensagem do aparelho — o CRM a leria como resposta de gente e apagaria o
  "em atraso".
- Uma ligação gera vários avisos com o mesmo `id`, em POSTs separados e sem
  ordem garantida: `offer` → sinalização → `terminate`/`timeout`/`reject`, e
  `accept` (vindo do PRÓPRIO aparelho do escritório) quando alguém atende no
  celular, no mesmo segundo do fim. `lerEventoDeLigacao` descarta o que não é
  uma dessas cinco situações.
- Só o `offer` diz quem ligou: no `accept` o `from`/`chatId` é o aparelho do
  escritório.
- Chamada de GRUPO é ignorada. Número de Meta Cloud API não tem este aviso.
- ⚠️⚠️ **A ligação FEITA pelo celular do escritório não gera aviso nenhum**
  (medido ao vivo em 26/09/2026): o WhatsApp só avisa os aparelhos conectados
  da chamada RECEBIDA. Não há como marcar a feita a partir do `CALL`.

## O desfecho

- Cada aviso grava SÓ as suas colunas em `cb_ligacoes`, e só se estiverem
  vazias (`.is(coluna, null)`): reentrega e ordem trocada não se atropelam.
- `accept` → **atendida**. Fim sem `accept` → **perdida**, mas só depois da
  FOLGA (`FOLGA_DO_DESFECHO_MS`, 10 s) contada do relógio do CRM
  (`encerramento_gravado_em`), nunca do `date` do WhatsApp: o `accept` do mesmo
  segundo pode estar noutro POST. `accept` atrasado mais que a folga sai como
  perdida (limite aceito).
- ⚠️ **Um UPDATE condicional (`desfecho IS NULL` + `select`) reivindica a
  linha**: só quem ganha grava a bolha. Ler-então-escrever gravaria duas.
- Sem `offer` gravado não se decide: a espera do `offer` decide quando ele
  chegar.

## Quem ligou

- Ordem: JID de telefone → acervo (`consultarTelefoneDoLid`, 1010) →
  `callerPn` conferido (`telefoneDoCallerPn`). ⚠️ **O LID jamais vira
  telefone** (a armadilha dos 8 últimos dígitos, `whatsapp-evolution.md`).
- ⚠️⚠️ O `callerPn` com o defeito do zero a mais (issue #2154 da Baileys:
  número de 12 dígitos + 0) é RECUSADO, nunca "consertado". Duas formas: 13
  dígitos sem o 9 na 5ª posição (fixo) e, com DDD 31 em diante (onde o
  WhatsApp registra o celular com 12), 13 dígitos terminados em 0 — o celular
  antigo começando em 9 + 0 é o número válido de OUTRA pessoa.
- O LID é comparado SEM o `:aparelho` (`lidSemAparelho`), no acervo e contra
  o `own_lid`.
- O acervo que NÃO RESPONDE (`consultarTelefoneDoLid` → `'falhou'`) vira
  `falhou`, nunca `sem_telefone`: seria afirmar que o CRM não conhece um
  cliente que ele conhece.
- Sem telefone resolvível → `sem_telefone`, sem bolha (a pessoa não aparece na
  tela: limite da v1). O próprio aparelho (`own_lid`) ou número de uma conexão
  da conta → `do_escritorio`.

## A bolha

- `content_type = 'call'`, `content_text` NULO, `message_id = 'call:<id>'`
  (o `UNIQUE (conversation_id, message_id)` descarta a segunda; 23505 é
  ignorado), detalhes em `messages.ligacao`.
- **Perdida** = `sender_type 'customer'`: não lida pela RPC atômica
  `bump_conversation_on_inbound` e o gatilho da 972 acende "em atraso".
  **Atendida** = `'agent'` + `from_device`: sem não lida, e a 972 apaga o "em
  atraso" (é resposta de gente).
- ⚠️⚠️ **`created_at` é a hora REAL: o fim (perdida) ou o `accept`
  (atendida), pelo relógio do WhatsApp — nunca a hora da decisão.** A perdida
  é decidida só depois da folga (~11 s) e a atendida em ~2 s: com a hora da
  decisão, no teste real de 26/09/2026 a recusada foi gravada DEPOIS da
  atendida que veio em seguida — fio na ordem trocada e "em atraso" aceso
  sobre cliente atendido. Se já há mensagem depois da ligação, a bolha é
  HISTÓRIA: não reabre, não sobe a conversa, não segue o canal, e chama
  `cb_assentar_mensagem_historica` (1011), que acerta a espera e a não lida
  pela hora real — o gatilho da 972 decide pela ORDEM DE INSERÇÃO. A espera de
  antes e o "há mensagem depois?" são lidos ANTES do insert, e a pergunta se
  REPETE logo depois da reabertura (colada no insert): uma resposta gravada no
  meio faria a bolha subir a conversa sobre cliente atendido (Codex, PR #304).
  Não é atômico: sobra a janela entre a 2ª pergunta e a escrita na conversa
  (limite aceito, no plano). A faixa escreve `ligacao.inicio`.
- Com a conversa aberta, a bolha "no passado" é acrescentada no FIM da lista
  em memória (o tempo real não reordena, de propósito): quem pergunta por
  ORDEM (`aberturasDeCanal`, `ultimoCanalDoCliente`) passa por `naOrdemDoFio`
  — ver `canal-na-conversa.md`.
- A ficha e a conversa nascem por `resolverDestinatario` (dono durável) quando
  o número nunca escreveu (decisão do operador), com o telefone no lugar do
  nome — o aviso não traz o perfil.
- Depois de gravar, na ordem: reabrir LOGO DEPOIS do insert (`reopen.ts`) →
  subir a conversa → seguir o canal (os três só quando a ligação é a última;
  a histórica assenta) → abrir o card no funil → ligar a bolha à linha.
- ⚠️ "Depois" inclui o MESMO segundo (`gte`, a própria bolha excluída na 2ª
  conferência): as mensagens da Evolution têm carimbo em segundos.

## O que NÃO roda — e há pino (`ligacoes.chamadores.test.ts`)

- ⚠️⚠️ Robô, automações, IA, `persistInboundMessage`/`persistDeviceMessage`,
  o núcleo de envio e `registrarEntrega` ficam FORA: a ligação não tem texto a
  responder, e um robô respondendo "não entendi" a uma chamada é o pior caso.
- ⚠️⚠️ **A ligação NÃO para as sequências "parar se o cliente responder"**
  (decisão do operador, 26/09/2026: só mensagem escrita é resposta). São DUAS
  pontas: `cancelarEsperasPorResposta` não é chamada aqui (pino), e
  `clienteRespondeuDesde` — a segunda linha de defesa, na retomada — filtra
  `content_type <> 'call'`, senão a perdida (linha do cliente) pararia a
  sequência quando a espera acordasse.
- ⚠️ O webhook de saída NÃO emite nada: nem `message.received`, nem
  `conversation.created` (ele quer dizer só "o cliente abriu a conversa
  ESCREVENDO" — contrato publicado).
- ⚠️ O CARD que a ligação abre segue o caminho de todo card novo: as
  automações da etapa de entrada e o `deal.created` rodam (D5 do plano).
- Ligação que cria a ficha não dispara "Novo contato criado", e a perdida
  antes da 1ª mensagem faz "Primeira mensagem" não disparar para aquela
  conversa (a contagem é por linha do cliente). Limite escrito no plano.

## Quem lê `content_type` (conferir a cada tipo novo)

- `message-bubble.tsx` (retorno cedo para `<AvisoDeLigacao>`) e
  `message-thread.tsx` (a ligação sai do `MessageActions`, como o aviso de
  grupo — senão haveria "apagar para todos" numa ligação — e desenha o
  `SeparadorDeCanal` quando ABRE um trecho de outro número).
- Núcleo de envio: citar uma ligação é 400 (o `call:<id>` não existe no
  WhatsApp). Aviso do navegador: a perdida tem rótulo próprio (`labels.call`).
- A prévia no banco é o marcador `[call]` (`PREVIA_DA_LIGACAO`), o formato de
  todo tipo sem texto; a lista, o card do funil e o tempo real
  (`comMensagemNova`) o trocam por "📞 Ligação" (`ehPreviaDeLigacao`).
- Radar (`textoDe` do worker): a ligação é linha do transcrito.
- Painel e Meu dia: `.neq('content_type', 'call')` nas contagens de mensagem —
  a atendida é `agent`, e contaria como mensagem enviada.
- ⚠️ `messages_content_type_check` é do upstream: um merge que o recrie tira
  o `'call'`, e a ligação passa a ser recusada com 23514, sem aviso na tela.

## A tabela

- `cb_ligacoes` é FECHADA ao navegador (RLS sem policy, REVOKE das duas
  metades): a tela lê a mensagem, nunca a tabela. Chave `(account_id,
  call_id)` TOTAL — alvo do `ON CONFLICT` do upsert.
