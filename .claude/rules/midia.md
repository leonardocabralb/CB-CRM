---
paths:
  - "src/lib/storage/**"
  - "src/lib/media/**"
  - "src/lib/acervo/**"
  - "src/lib/http/**"
  - "src/app/api/cb/acervo/**"
  - "src/app/api/whatsapp/media/**"
  - "src/components/settings/acervo-manager.tsx"
  - "src/components/inbox/acervo-picker.tsx"
  - "src/hooks/use-acervo*"
  - "src/lib/whatsapp/anexo-grande*"
  - "src/lib/whatsapp/mirror-inbound-media*"
  - "src/lib/whatsapp/transport/anexo-declarado*"
  - "src/lib/whatsapp/transport/evolution-media*"
  - "src/lib/inbox/arquivo-solto*"
  - "src/app/api/cb/groups/media/**"
  - "src/lib/whatsapp/transport/evolution-inbound*"
---

# Mídia — regras

Vale ao mexer no armazenamento de anexo (bucket `chat-media`), nos tetos de
tamanho, no nome do anexo, no acervo de mídias, no download de mídia da
Evolution (inclusive a rota sob demanda de grupo) e na leitura de corpo com
teto. A bolha, a fila de anexos do compositor e o player de áudio estão em
`.claude/rules/inbox-conversa.md`; o portão por tamanho na ingestão, em
`.claude/rules/ingestao.md`. O texto antigo, com a história, está em
`git show f5879b3f:CLAUDE.md`.

### Anexo grande (986): dois tetos

- ⚠️⚠️ **São DOIS tetos com perguntas diferentes, e usar um pelo outro apaga
  documento de cliente.** `MEDIA_MAX_BYTES_BY_KIND` espelha os limites da Meta
  e vale para o ENVIO (barra no navegador antes de virar órfão no bucket);
  `MEDIA_MAX_BYTES_ENTRADA` = 50 MiB é o `file_size_limit` do bucket e vale
  para o que CHEGA. Quando eram o mesmo valor, documentos de cliente de 16 a
  46 MiB viraram "Documento indisponível".
- ⚠️ **50 MiB, e não os 100 MB do WhatsApp**: o teto global de upload de um
  projeto Supabase começa em 50 MiB no plano gratuito (pedir mais valeria aqui
  e explodiria na próxima instalação), e o download da Evolution vem em
  base64 (~1,33× o tamanho em string no processo Node).
- ⚠️ **O número vive em DOIS lugares** — o código e o SQL da 986 —, amarrados
  por `anexo-declarado.test.ts`. Subir só o código troca a recusa nossa pela do
  Storage, já com o arquivo baixado; subir só o bucket não muda nada, porque
  quem recusa primeiro é o código.
- ⚠️ **O tamanho é lido do PAYLOAD antes de baixar** (`mediaBytesOf`, no
  módulo neutro `anexo-declarado.ts`); sem o portão, o CRM baixava 46 MiB para
  descartar. ⚠️ `fileLength` vem como STRING — comparar sem `Number()` erra
  sem erro nenhum. Tamanho AUSENTE conta como pequeno (tenta baixar); o teto
  real é o backstop de `fetchAndStoreEvolutionMedia`.
- ⚠️ **`media_state='too_large'` vale no 1:1 e em grupo** e faz a bolha dizer o
  NOME e o motivo em vez de "indisponível". `'failed'` só existe em grupo, de
  propósito: acende "tentar de novo", e a rota sob demanda só existe lá.
  `podeBaixarAnexo` exclui `too_large`.
- ⚠️⚠️ **Marcar `too_large` só por `marcarAnexoGrandeDemais`**
  (`src/lib/whatsapp/anexo-grande.ts`), nunca por UPDATE solto — pino
  default-deny `anexo-grande.chamadores.test.ts`. São dois passos que andam
  juntos: gravar o estado e apagar o ponteiro `cb_message_media_ref` (906), que
  guarda as CHAVES DE DECIFRAGEM e nunca mais será usado.
  ⚠️⚠️ **O ponteiro só sai DEPOIS de a marcação dar certo.** O Supabase
  devolve `error` sem lançar: apagar sem conferir deixa a mensagem `pending`
  ("toque para baixar") sem o ponteiro, e o clique responde 410 "o WhatsApp
  não tem mais este arquivo" — mentira. Os dois call sites (webhook e a rota de
  mídia de grupo) passam pelo helper; soltos, divergiram duas vezes.
- ⚠️ **O nome do arquivo é gravado MESMO quando o anexo é recusado**
  (`nomeDeArquivoDeclarado`): é a única informação que sobra do documento que
  não coube.
- **Legenda `￼` não é legenda.** Documento mandado do iPhone chega com o
  OBJECT REPLACEMENT CHARACTER no `caption`; `extractText` descarta legenda sem
  nada visível — senão uma caixinha na bolha, na prévia da lista e no
  transcrito do Radar.

### Nome do anexo (969)

- ⚠️ **O nome é coluna própria (`messages.media_filename`), nunca
  `content_text`.** Legenda e nome são coisas diferentes e um documento pode
  ter as duas; empilhá-las é o que faz o caminho da Meta PERDER o nome quando
  há legenda. E `content_text` alimenta a busca (929) e o Radar (941). ⚠️ No
  webhook da Meta o `contentText` continua `caption || filename` — não
  "simplificar" removendo o filename: lista e busca leem essa coluna.
- ⚠️ **`extractText` (`evolution-inbound.ts`) lê só o `caption` do
  `documentMessage`, nunca o `fileName`** — o nome vai para `media_filename`.
- ⚠️ **`fetchAndStoreEvolutionMedia` devolve `EvolutionMediaSalva`, não uma
  string**: `fileName` e `mimetype` morriam no `return`, e `media_type` ficava
  NULL em toda linha da Evolution. Os DOIS call sites (webhook e rota de
  download de mídia de grupo) gravam `media_filename` E `media_type`.
- ⚠️ **Nome ausente NÃO sobrescreve com NULL** (`...(filename ? {…} : {})`):
  foto e áudio chegam sem nome, e o UPDATE apagaria o que outro caminho gravou.
- ⚠️ **SEM backfill, e o histórico funciona.** `buildMediaPath` põe o nome no
  caminho do objeto (degradado: espaço e acento viram `_`, corte em 40
  caracteres) e `basenameFromUrl` o recupera — é a 2ª fonte de
  `mediaFilename`. Gravar a versão degradada congelaria a perda e apagaria a
  distinção entre nome verdadeiro e reconstruído.
- ⚠️ **Exibir é `mediaFilename(message)`** (`src/lib/media/filename.ts`, a
  cascata), nunca a coluna crua — ela é NULA antes da 969. A legenda só aparece
  quando DIFERE do nome resolvido: nas linhas antigas da Meta o filename está
  dentro do `content_text` e sairia duas vezes.
- ⚠️ **Áudio não mostra nome de arquivo**: nota de voz chega com o id
  hexadecimal do objeto. Mostra a transcrição quando pronta, senão um rótulo
  genérico.
- **`gallery.ts` NÃO cobre documento**, de propósito: alimenta as setas do
  visualizador, que só desenha imagem e vídeo.
- Print colado ganha nome com carimbo (`nomeParaColagem`): o Chrome chama toda
  colagem de `image.png`, e o nome viaja para o WhatsApp e para
  `media_filename`.

### MIME e upload

- ⚠️⚠️ **A lista de MIMEs aceitos é UMA** (`MIMES_ACEITOS`, `arquivo-solto.ts`),
  e o `accept=` dos seletores deriva dela (`aceiteDoSeletor`). Duas listas
  divergem, e o arquivo aceito por uma porta falha só no envio, longe da causa.
- ⚠️⚠️ **A página `.html` (`MIMES_SO_POR_QR_CODE`) só entra nas conexões por QR
  code, com o transporte CONHECIDO** (`mimesAceitos(porQrCode)`; decisão do
  operador, 02/10/2026). `MIMES_ACEITOS` é a lista da API oficial da Meta (PDF,
  Office e .txt, conferida na doc dela): pelo número oficial — ou com a lista
  de conexões ainda carregando — o `.html` passaria no compositor e a Meta o
  recusaria depois do envio. As três portas do compositor leem o MESMO
  `porQrCode`, e o envio da fila (`sendDraft`, antes de enviar OU agendar)
  confere de novo pelo `mime` do item: a conexão pode mudar com o `.html` já
  anexado (Codex, PR #376). Pino `arquivo-solto.chamadores.test.ts`.
- ⚠️⚠️ **O MIME é NORMALIZADO antes de subir** (`arquivoParaEnviar`), não só
  antes de comparar: `uploadAccountMedia` manda `file.type` como
  `contentType`, e o bucket tem lista EXATA (023) — `image/png;
  charset=binary`, que aparece em colagem, era recusado no upload. Caminho novo
  de upload repete a normalização.
- ⚠️ **`MIMES_POR_TIPO` (`src/lib/acervo/tipos.ts`) é ESPELHO da
  `allowed_mime_types` da 023.** Alargar só no código faz o upload falhar no
  Storage com "erro de upload"; só na migration faz a tela recusar arquivo que
  o WhatsApp aceita. Os dois, sempre — menos os tipos SÓ DE ENTRADA, que o
  bucket aceita e a lista de envio não: GIF, QuickTime, 3gp e Opus (042) e
  `text/html` (1060 — que o compositor também ENVIA nas conexões por QR code
  desde 02/10/2026; o acervo, não).
- ⚠️ **`.html` recebido é guardado (1060, decisão do operador) e oferecido para
  BAIXAR, nunca aberto a partir do Storage**: `urlParaAbrirAnexo`
  (`abrir-anexo.ts`) põe `?download=` na bolha e na aba Arquivos. Link novo
  para anexo passa por ele.
- ⚠️ **Nome de arquivo para URL ou cabeçalho passa por `semSurrogatoSolto`**
  (`filename.ts`) antes de `encodeURIComponent`, que LANÇA com meio emoji; e o
  corte de `sanitizeFilename` não parte o par (`cortarSemPartir`). No render
  da bolha, o erro derrubava a conversa (Codex, #436).
- ⚠️⚠️ **O proxy da Meta (`/api/whatsapp/media/<id>`) responde por
  `mediaProxyHeaders`** (`src/lib/media/proxy-response-headers.ts`, upstream
  #678): é a reserva do anexo que o espelho no `chat-media` não guardou (tipo
  fora da lista do bucket — SVG, ZIP, CSV —, acima de 50 MiB, Storage fora do
  ar), sai no NOSSO domínio com o tipo que o CLIENTE mandou, e a bolha o abre
  numa aba nova. Só imagem, áudio e vídeo comuns vão `inline`, com CSP sem
  script; o resto vai como `attachment`, com `sandbox`, e com o nome real
  (`nome=`, que `urlParaAbrirAnexo` põe no link). O `nosniff` global não
  impede HTML declarado como HTML, e a CSP do `next.config.ts` só relata.
  ⚠️ A mídia exibida NÃO leva `sandbox`: medido, o áudio aberto em aba fica
  sem fonte com ele. ⚠️ O `Cache-Control` do helper não chega ao navegador:
  vale o `no-store` que o `next.config.ts` grava em `/api/*` antes da rota.
  Rota nova que devolva bytes de fora repete o helper. Pinos
  `proxy-response-headers.test.ts` e `route.cabecalhos.test.ts`.

### Acervo de mídias (953/954)

Tabela `cb_media_library`, `src/lib/acervo/` (puro, com teste), rotas em
`/api/cb/acervo`, painel em Configurações → Acervo e o seletor
`acervo-picker.tsx` no clipe do compositor.

- ⚠️⚠️ **Enviar do acervo COPIA o arquivo (rota `copiar`).** O compositor APAGA
  o objeto quando o rascunho é descartado (`deleteAccountMedia`), e cancelar
  uma agendada também apaga: por
  referência, o envio falho de um estagiário levaria o contrato-padrão de todo
  mundo, sem ninguém ligar uma coisa à outra. E o que FOI ENVIADO não pode
  mudar quando alguém troca o item.
- ⚠️⚠️ **A guarda de papel mora em DUAS camadas**: a rota (admin monta e apaga)
  E as policies de Storage do `chat-media` (954: "não está em `acervo/` OU é
  admin" em INSERT/UPDATE/DELETE). Só com a rota, qualquer membro apagava ou
  TROCAVA o conteúdo pelo `storage.remove()` do navegador — o `media_path` não
  é segredo. A policy usa `IS DISTINCT FROM`, não `<>` (detalhe em
  `.claude/rules/supabase.md`). Subpasta nova com regra própria repete o par
  (rota + policy).
- ⚠️ **É o bucket `chat-media` de sempre, na subpasta `acervo/`**
  (`account-<conta>/acervo/`). As policies da 020/023 casam só o PRIMEIRO
  segmento, então aninhar é de graça, e a subpasta separa "arquivo do
  escritório" de "anexo de mensagem" numa varredura de órfãos. Bucket novo
  herda uma segunda RLS e uma segunda lista de MIMEs para manter em sincronia.
- ⚠️ **Toda escrita passa pela API** (sem policy de escrita, com REVOKE; ler é
  direto sob RLS): o papel é conferido lá, `media_url` é DERIVADA do caminho no
  servidor (aceitá-la do cliente casaria caminho legítimo com URL de fora) e o
  caminho é exigido sob `account-<conta>/acervo/`.
- ⚠️ **`storage.exists()` na rota**: lê SÓ o `r.data` do resultado resolvido e
  envolve a chamada em try/catch — a regra da raiz (seção 8b): ausente resolve
  com `data: false` E `error`; 5xx é lançado, e Storage fora do ar não é
  "sumiu".
- `categoria` é texto livre (NULL = "Geral", que a tela põe no fim). Trocar o
  ARQUIVO de um item não existe: o item mudaria de conteúdo sem mudar de nome.
  Trocar é apagar e cadastrar.
- **Áudio do acervo sai como NOTA DE VOZ** (`sendWhatsAppAudio`, PTT na
  Evolution). O seletor diz isso na linha do item, senão o operador manda "um
  arquivo" e o cliente recebe voz.
- ⚠️ **No número OFICIAL (API da Meta) só áudio .ogg (Opus) vira nota de
  voz**; mp3/m4a/aac/amr chegam como ARQUIVO de áudio. Pela Evolution todo
  áudio sai como nota de voz. O editor do robô avisa
  (`audioViraNotaDeVozNaMeta`, `src/lib/flows/tipo-da-midia.ts`); o selo "como
  nota de voz" do seletor do acervo no compositor ainda afirma sem distinguir.
- **A cópia mora em `copiarDoAcervo` (`src/lib/acervo/copiar.ts`)**, com DOIS
  chamadores: a rota `copiar` (compositor) e o nó "Enviar mídia" do robô, que
  copia a cada envio (`.claude/rules/whatsapp-envio.md`). Erro de banco é
  `leitura`, nunca `nao_encontrado`.

### Arquivo que SAI do `chat-media`: a fila (1097)

`cb_arquivos_a_apagar` (fechada ao navegador), a guarda
`cb_caminho_no_chat_media(url, conta)`, o espelho TS `caminhoNoChatMedia`
(`src/lib/storage/caminho-no-chat-media.ts`) e a drenagem
(`src/lib/storage/arquivos-a-apagar.ts`). Quem enfileira: excluir de vez da
Lixeira de contatos (prazo ou "Excluir agora"; `supabase.md`, "APAGAR
CONTATO") e o gatilho da anotação (1102, origem `anotacao`: anotação apagada
ou anexo tirado, fora do sinal `cb.lixeira`; `anotacoes.md`).

- ⚠️ **`notas/` (anexo de anotação) é subpasta com regra própria**, o par rota
  + policy da 954: o `POST /api/cb/notes` exige o prefixo e lê tamanho e tipo
  no bucket; ninguém troca pelo navegador; só o dono (`owner_id`) apaga. Os
  tipos são `MIMES_DA_ANOTACAO` (`MIMES_POR_TIPO` + o `.html`), com teste
  amarrando à lista do bucket.

- ⚠️⚠️ **Só sai arquivo NOSSO**: a guarda devolve NULL para URL externa,
  `flow-media`, outra conta, `acervo/` (o acervo tem dono próprio), `..`, `%`
  (nome codificado: na dúvida, fica) e barra sobrando, e é repetida no CHECK
  da fila e no reivindicar. Os dois lados respondem aos MESMOS exemplos (o
  pino em TS e a conferência da 1097): mudou um, muda o outro.
- ⚠️⚠️ **Sai só o que ninguém mais cita, conferido NA HORA**
  (`cb_arquivos_citados`): mensagens, agendadas, modelos, fotos de contato,
  perfil e grupo, acervo, passos de automação e nós de robô (no JSON),
  anexos de anotação (1102) e as fotografias dos OUTROS itens da Lixeira.
  Escritor NOVO de URL do
  `chat-media` (tabela ou coluna) entra em `cb_arquivos_citados` e no pino
  `arquivos-do-chat-media.chamadores.test.ts`, senão a drenagem apaga arquivo
  que ainda aparece numa bolha. O citado sai da fila e o arquivo fica: quem
  cita enfileira de novo ao sair. Todo escritor da fila usa `ON CONFLICT DO
  NOTHING` (a mensagem e a agendada enviada citam o MESMO objeto).
- **Quem drena é o servidor** (`drenarArquivosAApagar`, no `after()` de
  `/api/cb/scheduled/cron`, `deploy.md`): `cb_reivindicar_arquivos_a_apagar`
  carimba e CONTA a tentativa antes do trabalho; reivindicado há mais de 10
  min volta à fila, e na 10ª tentativa o item para — a tela da Lixeira avisa
  (`cb_arquivos_da_lixeira_parados`). ⚠️ Toda escrita na fila depois do
  reivindicar leva a cerca de posse (`reivindicado_em` = o carimbo do
  próprio lote), e o espelho TS confere o caminho DE NOVO antes do `remove`:
  o que ele recusa fica no bucket, com `ultimo_erro` (os dois lados
  divergiram, e isso tem de aparecer).

### Leitura de corpo com teto e visualizador

- ⚠️ **Corpo de URL de fora que vai para a memória passa por `lerComTeto`**
  (`src/lib/http/ler-com-teto.ts`), nunca `arrayBuffer()`: um corpo de
  gigabytes sem `content-length` derruba o processo de todas as contas. Só o
  teto (`TetoExcedido`) vira "maior que o limite"; tempo esgotado e conexão
  que cai no meio têm frase própria. Teste de teto usa corpo FINITO (sem fim, o
  mutante trava em vez de reprovar). Exceção conhecida, anterior: a foto de
  perfil (`foto-do-contato.ts`) lê a URL inteira antes de conferir
  `FOTO_MAX_BYTES`. A guarda de endereço (`ssrf.ts` em cada salto, redirect
  manual) está na raiz (8e).
- Anexo do Instagram baixa por `baixarUrlPublica` (a URL vem do corpo que a
  própria conexão assina; ver `.claude/rules/instagram.md`); a recusa vira
  "anexo indisponível" (`mirrorInboundMedia` engole o erro).
- O visualizador do inbox é o NOSSO `media-viewer.tsx` (giro e zoom).
  `media-lightbox.tsx` e `message-media.tsx` vieram do upstream e NÃO estão
  ligados — religá-los dá dois visualizadores. De `src/lib/media`, o
  `download.ts` serve o Baixar da nota de voz.
