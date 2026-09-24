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
  e o `accept=` dos seletores deriva dela (`ACEITE_DO_SELETOR`). Duas listas
  divergem, e o arquivo aceito por uma porta falha só no envio, longe da causa.
- ⚠️⚠️ **O MIME é NORMALIZADO antes de subir** (`arquivoParaEnviar`), não só
  antes de comparar: `uploadAccountMedia` manda `file.type` como
  `contentType`, e o bucket tem lista EXATA (023) — `image/png;
  charset=binary`, que aparece em colagem, era recusado no upload. Caminho novo
  de upload repete a normalização.
- ⚠️ **`MIMES_POR_TIPO` (`src/lib/acervo/tipos.ts`) é ESPELHO da
  `allowed_mime_types` da 023.** Alargar só no código faz o upload falhar no
  Storage com "erro de upload"; só na migration faz a tela recusar arquivo que
  o WhatsApp aceita. Os dois, sempre.

### Acervo de mídias (953/954)

Tabela `cb_media_library`, `src/lib/acervo/` (puro, com teste), rotas em
`/api/cb/acervo`, painel em Configurações → Acervo e o seletor
`acervo-picker.tsx` no clipe do compositor.

- ⚠️⚠️ **Enviar do acervo COPIA o arquivo (rota `copiar`).** O compositor APAGA
  o objeto quando o envio falha ou o rascunho é descartado
  (`deleteAccountMedia`), e cancelar uma agendada também apaga: por
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
