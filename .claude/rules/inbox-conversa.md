---
paths:
  - "src/components/inbox/message-*.tsx"
  - "src/components/inbox/player-de-audio.tsx"
  - "src/components/inbox/painel/**"
  - "src/components/inbox/contact-sidebar.tsx"
  - "src/components/inbox/group-sidebar.tsx"
  - "src/components/inbox/cartao-de-nota.tsx"
  - "src/components/inbox/internal-note-box.tsx"
  - "src/components/inbox/nota-fixada-bar.tsx"
  - "src/components/inbox/note-line.tsx"
  - "src/components/inbox/reply-quote.tsx"
  - "src/components/inbox/media-*.tsx"
  - "src/components/inbox/formatted-text.tsx"
  - "src/components/inbox/avatares-na-conversa.tsx"
  - "src/components/inbox/copiar-link-da-conversa.tsx"
  - "src/lib/inbox/achados-no-fio*"
  - "src/lib/inbox/salto-no-fio*"
  - "src/lib/inbox/arquivo-solto*"
  - "src/lib/inbox/entrega-nao-confirmada*"
  - "src/lib/inbox/motivo-da-falha*"
  - "src/lib/inbox/fila-de-anexos*"
  - "src/lib/inbox/nao-lidas-abaixo*"
  - "src/lib/inbox/whatsapp-format*"
  - "src/lib/audio/**"
  - "src/lib/presenca-na-conversa*"
  - "src/lib/contacts/origem*"
  - "src/hooks/use-apagar-nota*"
  - "src/hooks/use-conversation-notes*"
  - "src/hooks/use-fixar-nota*"
  - "src/hooks/use-conversa-aberta*"
  - "src/app/*/inbox/**"
  - "src/components/presence/**"
  - "src/lib/presence*"
  - "src/hooks/use-presence*"
  - "src/lib/notes/**"
  - "src/app/api/cb/notes/**"
  - "src/components/inbox/template-picker.tsx"
  - "src/components/inbox/quick-reply-picker.tsx"
  - "src/components/inbox/ai-thread-banner.tsx"
  - "src/components/inbox/conversa-fora-da-area.tsx"
---

# Caixa de entrada: a conversa — regras

Vale ao editar ou revisar o fio, a bolha, o compositor, a fila de anexos, o
painel lateral, as anotações internas e a presença por conversa. Irmãs: a
LISTA (abas, filtros, busca, ordem) em `.claude/rules/inbox-lista.md`; qual
NÚMERO responde e a janela de 24h em `.claude/rules/canal-na-conversa.md`;
teclado e histórico no celular em `.claude/rules/celular.md`; campos e nome da
ficha em `.claude/rules/campos-e-nome.md`.

### `message-bubble.tsx` e `message-thread.tsx` ficam NOSSOS, inteiros

- ⚠️ **O visualizador de mídia do upstream foi descartado**: o nosso
  `media-viewer.tsx` tem giro e zoom. `media-lightbox.tsx` e `message-media.tsx`
  NÃO estão ligados; religá-los dá dois visualizadores. O que é nosso dentro de
  arquivo do upstream está em `docs/MERGE-UPSTREAM.md`.
- ⚠️ **Conversa fora das conexões do perfil: `ConversaForaDaArea` SUBSTITUI o
  `<MessageThread>`, nunca o embrulha.** Montado, o fio buscaria as mensagens e
  zeraria as não lidas em nome de quem nem pode responder.

### O fio: rolagem, linha do tempo e faixas

- ⚠️ **`coladoNoFimRef` + `onScroll` guardam o auto-scroll, e o spinner só
  entra quando a CONVERSA muda (`conversaCarregadaRef`).** Sem os dois, voltar
  de outra aba (o `visibilitychange` sobe o `resyncToken`) empurrava para o fim
  quem lia o histórico. O `saltoAtivoRef` não cobre isso. A guarda é re-armada
  em `publicarMensagemOtimista` e ao acrescentar nota, senão o autor não vê.
- **A linha do tempo intercala mensagens E eventos do lead**
  (`groupTimelineByDate`, `intercalar`, ramo `item.evento`); a `ScheduledBar`
  fica logo acima do compositor.
- ⚠️ **Mensagem do realtime entra no FIM do fio aberto, não pelo carimbo — de
  propósito**: pelo carimbo, toda mensagem atrasada nasceria acima da dobra,
  despercebida. Ao recarregar, ela vai para o lugar do carimbo.
- ⚠️ **A faixa da nota fixada compara `conversation_id` com a prop do render
  atual**: o `useConversationNotes` esvazia num efeito, e a nota do cliente
  anterior aparecia sob o cabeçalho do novo.

### O salto da busca dentro do fio roda em JS, e isso tem prazo de validade

`src/lib/inbox/achados-no-fio.ts` (pino `achados-no-fio.test.ts`); rolagem,
destaque e ↑/↓ em `message-thread.tsx`.

- ⚠️ **Só funciona porque o fio carrega a conversa INTEIRA** (sem `limit`).
  Paginar faz o contador "2 de 5" mentir em silêncio, e o teto de 1000 linhas do
  PostgREST chega sozinho, por crescimento de dados.
- ⚠️ **`semAcento()` usa `\p{Mn}`, nunca `\p{Diacritic}`**: a segunda inclui o
  acento solto, `^^^` virava agulha vazia e `includes("")` acendia tudo.
- ⚠️ **A normalização do JS e o `unaccent` do banco NÃO são idênticos**, e há
  teste fixando a divergência: copiar a tabela do `unaccent` afirmaria uma
  equivalência falsa.
- ⚠️ **O piso de 3 caracteres é medido no termo NORMALIZADO**, como no banco; o
  termo vai aparado para a RPC.
- ⚠️ **A supressão do auto-scroll é solta por AÇÃO do operador** — enviar,
  anotar, rolar à mão (`wheel`/`touchmove`, nunca `scroll`: o salto escreve
  `scrollTop`). Sem soltar, a mensagem enviada nasceria abaixo da dobra; sem
  soltar na rolagem, mensagem nova arrastaria de volta quem lia o contexto.
- ⚠️ **`messages` nas dependências do efeito que centraliza é load-bearing**:
  no resync o `scrollTop` volta a zero e ninguém re-centralizaria.
- **A âncora é `messages.id`**, nunca `message_id` (o wamid).
- ⚠️ **O botão "N mensagens não lidas" conta na ordem do DESENHO**
  (`contarNovasDoCliente` e a âncora `ultimaMensagemRef` passam por
  `naOrdemDoFio`): o tempo real acrescenta no fim da lista, e a ligação (1044)
  entra com carimbo no passado — pela ordem crua ela acendia o botão sobre uma
  bolha desenhada acima da âncora (Codex, PR #304).

### Busca DENTRO do fio e "Ver na conversa"

- ⚠️ **A barra de busca local SUBSTITUI a faixa da busca da lista enquanto
  aberta**: `termoEfetivo` é a ÚNICA origem de `acharNoFio`, `alvoId` e das
  setas — duas contagens na mesma tela discordariam. Enter anda para o achado
  mais ANTIGO, Shift+Enter volta, Esc fecha. A barra é carimbada com a conversa
  (`buscaLocal.conversationId`), nunca zerada por efeito.
- ⚠️⚠️ **O salto PONTUAL tem UMA mecânica, `useSaltoPontual`**, para a citação
  (`irParaCitada`) e para o "Ver na conversa" do painel (`saltoPedido`, com
  `conversationId` + `n`). Origem nova instancia o hook, não copia o efeito.
  Quatro cercas: atende UMA vez por `n` (`atendidoRef`), senão mensagem nova
  re-centralizaria o alvo velho; o pedido do painel só vale para ESTA conversa;
  chama `liberarSalto()` antes de rolar, senão o achado da busca puxa de volta;
  o timer do destaque vive num REF, fora da limpeza do efeito, senão o destaque
  ficaria aceso para sempre. O destaque é DERIVADO (`pedido.n !== apagado`),
  sem `setState` síncrono em efeito.
- ⚠️ **`LinhaDoFio` embrulha mensagem E anotação** (`data-message-id` OU
  `data-nota-id`, os dois nomes em `seletorDoAlvo`). Pino `salto-no-fio.test.ts`
  lê o fio: renomear um lado sem o outro faz o botão não fazer nada.
- **`onVerNaConversa` é OPCIONAL em `AbaArquivos` e `CartaoDeNota`**: sem ele (a
  ficha de `/contatos`) o botão não existe. É IRMÃO do link e da miniatura
  (button aninhado é inválido). No celular, a página fecha o painel antes de
  saltar.

### O compositor

- ⚠️ **Agendar DESVIA antes da janela de desfazer** (`handleSend` e
  `sendDraft`): a janela dispara na hora ao trocar de conversa, desmontar ou
  dar Enter de novo, e mandaria em 3 s a mensagem marcada para amanhã.
  `<SeletorDeHorario>` é de módulo (reusado no `MediaDraftPreview`), e
  `entreguesRef` impede o desmonte de apagar arquivo que já é de uma agendada.
  Regras da agendada: `.claude/rules/agendadas.md`.
- **O acervo mora no menu do clipe; gravar voz fica FORA dele**, à direita.
  "Executar automação" fica no menu +, atrás da prop `onExecutarAutomacao`; o
  diálogo mora no FIO.
- **No toque, o retorno pula linha e só o botão envia** (`enterEnvia`, decisão
  do operador): o teclado do celular não tem Shift+Enter.
- ⚠️ **No celular o compositor QUEBRA linha** (`flex-wrap sm:flex-nowrap`,
  `<textarea>` com `order-first basis-full`): com sete botões a caixa sobrava
  com 85 px. Gravar/agendar/enviar à direita (`max-sm:ml-auto` no microfone E no
  enviar). A dica do ✨ some abaixo de `sm` (`hidden sm:block`): senão viram três
  linhas de 10 px sob um compositor que já ocupa duas.
- ⚠️ **A formatação sobe para a linha dos botões a partir de 390 px**
  (`formatacaoNaLinha`; pedido do operador). A conta é de pixel (358 de 366 px):
  com o botão de modelos ou abaixo de 390 px ela volta à linha própria. Quem
  acrescentar botão ali refaz a conta.
- ⚠️ **A etiqueta da hora agendada tem linha própria no celular**
  (`etiquetaEmLinhaPropria`): ao lado do relógio, empurrava o agendar para outra
  linha. Escolha do operador: a peça de segurança fica mais visível. Ela empata
  em `order-first` com a caixa de texto, e é a ORDEM DO CÓDIGO (caixa antes)
  que a põe logo abaixo: reordenar o JSX a move.
- **Conversa Instagram não oferece modelo nem interativa**, nem pelo atalho de
  resposta rápida (`.claude/rules/instagram.md`).

### Anexo por ARRASTAR e por COLAR; a fila de anexos

`src/lib/inbox/arquivo-solto.ts` e `message-composer.tsx`.

- ⚠️⚠️ **A lista de MIMEs é UMA** (`MIMES_ACEITOS`; o `accept=` deriva dela em
  `ACEITE_DO_SELETOR`): duas listas divergiriam e o arquivo falharia só no envio.
- ⚠️⚠️ **O MIME é NORMALIZADO antes de SUBIR** (`arquivoParaEnviar`): o bucket
  tem lista exata, e `image/png; charset=binary` era recusado. Outro caminho de
  upload repete a normalização.
- ⚠️⚠️ **Colagem COM texto não vira upload** (`colagemEhAnexo`): Word e Google
  Docs mandam texto e imagem juntos, e o texto se perderia.
- ⚠️ **`dragenter`/`dragleave` contam PROFUNDIDADE** (senão o destaque pisca) e
  só interceptam com `Files` em `dataTransfer.types`. O alvo de soltura é
  `pointer-events-none`, senão engole o `drop`.
- ⚠️ **Print colado ganha nome com carimbo** (`nomeParaColagem`): toda colagem
  se chama `image.png`, e o nome vai ao WhatsApp e a `media_filename`.
- ⚠️⚠️ **Até `MAX_ANEXOS` (10), cada anexo uma mensagem, em SEQUÊNCIA com
  `await`**: todos juntos chegariam fora de ordem. O que JÁ saiu deixa a fila
  item a item (reenviar do começo repetiria o primeiro). Agendado: uma linha por
  anexo.
- ⚠️⚠️ **`onSendMedia` DEVOLVE se entregou, e o pai NÃO apaga o objeto na
  falha**: o item fica na fila, do compositor. O envio PARA no primeiro que não
  entregou (a causa costuma ser a mesma para todos).
- ⚠️⚠️ **Trinco SÍNCRONO (`enviandoFilaRef`) que guarda a POSSE (um número por
  envio), nunca um booleano.** Estado não serializa o segundo clique (reenviaria
  tudo); o `finally` só solta quem ainda é dono — com booleano, o fim do envio
  de A soltava o trinco de B.
- ⚠️⚠️ **A troca de conversa solta o trinco, e a posse é a GERAÇÃO que cancela o
  laço**: depois de cada `await`, `enviandoFilaRef.current !== posse` desiste.
  Sem soltar, o `fetch` sem prazo travava o Enviar do cliente seguinte; sem
  cancelar, o laço de A escrevia na tela de B. Comparar o `conversationId` NÃO
  basta: em A → B → A o laço velho retomaria. Laço novo com `await` sobre estado
  da tela usa a posse.
- ⚠️⚠️ **O fim da fila só limpa a citação se ela ainda for A QUE SAIU, e quem
  compara é o dono do estado**: `onClearReply?.(citada)`, decidido dentro do
  `setReplyTo((atual) => …)`. Ref alimentado por efeito reabre a corrida (efeito
  é passivo). O teste é `typeof idQueSaiu !== "string"`: um `onClick` passaria o
  MouseEvent como id.
- ⚠️ **Os dois envios da fila (imediato e agendado) levam a `citada` CAPTURADA
  na entrada do laço**, nunca `replyTo?.id` relido a cada volta: o operador pode
  clicar Responder noutra mensagem enquanto os anexos sobem, e os restantes
  trocariam de citação no meio.
- ⚠️⚠️ **`handleSendMedia` NÃO limpa a citação — só o fim da fila**: ele tem
  saídas que RETÊM o anexo, e a nova tentativa sairia sem a citação. Pino:
  `src/lib/inbox/fila-de-anexos.chamadores.test.ts`.
- ⚠️ **Todo caminho passa pelo MESMO funil** (`receberArquivos`: teto e aviso do
  que ficou de fora) e acrescenta à fila com a guarda de troca de conversa. As
  limpezas (desmonte, anotação) percorrem a fila INTEIRA; uma esquecida vaza
  objeto no bucket.
- ⚠️ **O item exibido é resolvido no RENDER** (`find(...) ?? drafts[0]`), nunca
  por efeito. Cada descarte tem aviso (`recusados`, `excedentes`). A tira de
  miniaturas só aparece com MAIS DE UM anexo (a regra do seletor de canal: com
  um item ela não decide nada).

### Player de áudio

`player-de-audio.tsx` e `src/lib/audio/onda.ts` (pino `onda.test.ts`), no
desenho do WhatsApp (pedido do operador).

- ⚠️⚠️ **O "Baixar" do áudio mora na BARRA DE AÇÕES** (`podeBaixar` em
  `message-actions.tsx`, `downloadMediaMessage`): vivia no menu do player
  nativo. A barra crua do upstream o tira sem conflito.
- ⚠️ **A onda é LIDA do arquivo, nunca sorteada**: `OfflineAudioContext` a 8 kHz
  (segura a memória), só quando o player aparece (`IntersectionObserver`),
  guardada por endereço. Falha vira fileira de pontos.
- **Cor por `currentColor`**: a bolha não entregue troca o texto para
  `!text-foreground`, e cor fixa sumiria.
- **No toque, encostar NÃO pula** (o dedo pode estar rolando): pula no arraste
  horizontal de mais de 8 px ou no toque curto.
- **Uma velocidade para todos** (`cb-audio-velocidade`, `lerVelocidade`), um
  áudio por vez. O rascunho de voz continua no player nativo.

### Balão "Não confirmada" e o motivo da falha

`src/lib/inbox/entrega-nao-confirmada.ts` (pino `entrega-nao-confirmada.test.ts`).
O WhatsApp quase nunca anuncia a falha; este vermelho é INFERIDO.

- ⚠️⚠️ **Acende quando saiu pelo CRM, está em ✓ há mais de 1 min e há prova de
  que o aparelho estava no ar** (mensagem nossa posterior entregue ou lida, por
  qualquer conexão, ou o destinatário escreveu mais de 1 min depois). Recortes,
  cada um contra um alarme falso: só EVOLUTION (alargar para a Meta exige medir
  de novo e decisão do operador, `docs/PLANO-link-sem-previa.md`); só o que saiu
  pelo CRM; só desde 11/09/2026 00:00 UTC; grupo fora.
- ⚠️⚠️ **O fio CONFERE NO BANCO antes de pintar**: a recarga
  (`handleMessagesLoaded`) pode atropelar um recibo do realtime, e o vermelho
  levaria a reenviar o que já chegou. O banco corrige a tela
  (`onUpdateMessage`); o id `temp-…` nunca é pintado.
- ⚠️ **O relógio é o tique da badge (`agoraDaBadge`)**, sem depender da janela
  da Meta (senão apagaria num fio parado da Evolution).
- ⚠️ **Saída se mede por `sender_type`, nunca por `from_me`** (a Meta grava nulo).
- **A falha da Meta mostra o texto dela na bolha** (`motivoNaBolha`).

### Nome do anexo na bolha

- ⚠️ **Exibir é `mediaFilename(message)`, nunca `media_filename` cru** (nula
  antes da 969). A legenda só aparece quando DIFERE do nome — nas linhas antigas
  da Meta o nome está no `content_text` e sairia duas vezes. Mais em
  `.claude/rules/midia.md`.
- **Áudio não mostra nome** (o WhatsApp manda um id hexadecimal): mostra a
  transcrição quando pronta.

### Anotação interna: são QUATRO telas

`src/hooks/use-apagar-nota.ts` e `src/components/inbox/cartao-de-nota.tsx`.

- ⚠️⚠️ **Apagar SEMPRE pelo `useApagarNota`**: a policy é "autor OU admin", e
  RLS que barra DELETE devolve 0 linhas sem erro — sem o `count`, a nota some
  da tela e volta na próxima abertura.
- ⚠️ **`podeApagar` = `author_user_id === user.id || useCan('manage-members')`**,
  igual nas telas; divergir mostra lixeira que a RLS recusa.
- ⚠️ **Nota de GRUPO não fixa** (o índice parcial exige `contact_id`): sem
  `onFixar` o alfinete não aparece. Quem monta a aba decide, e também o
  `sticky`.
- **`contact-detail-view` tem `deleteNote` próprio, de propósito**: distingue
  "proibido" de "falhou".
- **A frase do autor é `Inbox.note.wrote` nas quatro telas.**
- Quem levar o `InternalNoteBox` a uma tela nova põe a entrada dela em
  `ESCRITA_DA_TELA` como `viewer` (anotar conta como operação; ver a raiz).

### Cabeçalho do fio, painel lateral e aba Arquivos

- **O menu de ATRIBUIÇÃO mora no painel lateral** (`painel/responsavel-menu.tsx`,
  pedido do operador), nos DOIS painéis (contato e grupo). O fio CONTINUA
  chamando `onAssignChange` pela situação (encerrar solta o responsável) — não
  remover a prop.
- **Situação é PASTILHA no cabeçalho** (`STATUS_OPTIONS`, com `pill`/`dot`),
  numa paleta ÚNICA com a lista (`STATUS_PILL`): `primary` (violeta) = aberta, âmbar =
  pendente, cinza = encerrada (decisão do operador). Cor diferente num lado
  leria como outra situação. ⚠️ O anel colorido no avatar foi RETIRADO pelo
  operador — não voltar com ele.
- **Copiar link** (`copiar-link-da-conversa.tsx`) usa `/inbox?c=<id>` via
  `urlDoInbox`; no fio, é IRMÃO do botão do nome.
- ⚠️ **"Origem do contato" na aba Histórico** (`lib/contacts/origem.ts`, pino
  `origem.test.ts`): canal sem carimbo vira TRAVESSÃO, nunca o padrão; a
  primeira mensagem é comparada com a prop do render (`de === conversationId`).
- ⚠️ **`carregando` é prop OBRIGATÓRIA da `AbaArquivos`**: o painel é IRMÃO do
  fio e recebe `messages` vazio DURANTE a carga, e dizia "Nenhum arquivo" sobre
  conversa cheia. A página carimba de quem é o array (`messagesDaConversa`).

### Presença por conversa (963)

`src/lib/presenca-na-conversa.ts` (pino `presenca-na-conversa.test.ts`) e
`src/hooks/use-conversa-aberta.ts`.

- **`cb_conversa_aberta` clona a `member_presence`**: escrita SÓ pela RPC
  `cb_marcar_conversa_aberta` (conversa de outra conta vira NULL em silêncio),
  leitura por membro.
- **`cb_conversa_aberta` está na publicação realtime SEM lista de colunas** (ao
  contrário de `cb_channels`, seção 11 da raiz). Quem reescrever a entrada não
  põe lista, senão coluna nova deixa de viajar e a presença envelhece na tela
  sem erro nenhum.
- ⚠️ **"Saiu" usa o MESMO limiar do roster (`OFFLINE_AFTER_MS`)**, senão bolinha
  e avatar discordam sobre a mesma pessoa.
- ⚠️ **O escritor serializa as RPCs numa fila**: na troca rápida de conversa, a
  resposta atrasada não pode vencer a intenção nova.
- **A página do inbox é a dona da seleção** (`useMarcarConversaAberta`); o
  cabeçalho mostra `<AvataresNaConversa>` por `useQuemVeAConversa`.

### Automações na conversa

- ⚠️ **O fio passa ao `<ExecutarAutomacaoDialog>` o canal CRU
  (`conversation.channel_id ?? null`), nunca o `activeChannel` resolvido**: a
  checagem de escopo da rota falha aberta como o motor em conversa sem canal.
  Grupo fica de fora. A aba e as rotas: `.claude/rules/automacoes.md`.
- ⚠️ **Mensagem do CLIENTE na conversa ABERTA chama
  `setTimeout(avisarExecucoesMudaram, 3000)`** (página do inbox): o servidor pode
  ter cancelado uma espera ("parar se responder"), e a aba diria "próximo passo
  em 27 h". Com atraso porque o INSERT chega antes do cancelamento; só na
  conversa aberta porque o evento recarrega a marca da lista inteira.
