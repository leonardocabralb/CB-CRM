# Plano — Anotação com anexos e edição

> **O que é este arquivo.** Guia retomável do pedido do operador de
> 22/10/2026: a anotação interna passa a levar anexos (áudio gravado na hora,
> imagem, vídeo, PDF, Office, HTML), vários por anotação, e passa a ser
> editável. Editado a cada fase: ao iniciar uma, registra-se aqui a anterior
> (objetivo, arquivos, resultado MEDIDO).
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base nele, confirme
> contra o código e o banco; divergência se corrige no mesmo PR.

- **Criado:** 2026-10-22 · **Medido contra:** `main` @ `1ce13937`, produção
  `hxnhakmyxyhalbsktzwe` (só leitura) · **Decisões A1–A7:** 23/10/2026
  (recomendações aceitas) · **Implementação a partir de:** `main` @
  `5fe5693a` (a Lixeira de contatos já no ar)
- **Fluxo:** decisões em aberto → worktree a partir de `main` → implementar →
  typecheck/lint/test (Node 22) → replay da migration no CI → aplicar a
  migration com autorização do operador → preview 1440×900+ e 375 px →
  revisar 2× → PR.
- **Regras a abrir pela Read antes de mexer:** `anotacoes.md`,
  `inbox-conversa.md`, `midia.md`, `supabase.md`, `deploy.md` (limpeza no laço
  lento), `contatos.md` e `campos-e-nome.md` (ficha de `/contatos`),
  `i18n.md` e, na Fase 4, `api-v1.md`.
- **Plano irmão:** `docs/PLANO-lixeira-de-contatos.md`. Peças
  COMPARTILHADAS: a fila `cb_arquivos_a_apagar`, a função
  `cb_caminho_no_chat_media` (SQL + espelho TS + pino dos dois lados), a
  conferência universal "ninguém mais cita" (`cb_arquivos_citados`), o pino
  `arquivos-do-chat-media.chamadores.test.ts`, a drenagem no `after()` de
  `/api/cb/scheduled/cron` e a nota em `.claude/rules/supabase.md`.
  ⚠️ **A Lixeira chegou primeiro ao `main` (1097, 23/10/2026) e criou TODAS
  elas** — a fila já aceita a origem `anotacao`, e a fotografia da Lixeira já
  lê `anexos` das anotações (`cb_lixeira_arquivos`, prefixo `notas/`). Este
  plano só ACRESCENTA: o gatilho das anotações (com o sinal `cb.lixeira`, e
  declarado no inventário da restauração, `cb_lixeira_tratamento()`), os
  `anexos` das anotações como citadores em `cb_arquivos_citados`, a
  declaração no pino de citadores e as regras do armazenamento para
  `notas/`.

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **0** | Estudo, riscos conferidos no código e na produção, decisões | ✅ 22/10/2026 (este arquivo) | — | — |
| **1** | Banco e servidor: colunas, regras, gatilho na fila de arquivos a apagar (a fila e a drenagem já existem: Lixeira), regras do armazenamento para `notas/`, POST com anexos | ✅ código e migration na branch `feat/anotacao-com-anexos` (23/10/2026); migration provada no descartável, **NÃO aplicada**; a leitura do Storage (`info()`) medida pelo operador | `1102` | #434 |
| **2** | Tela: anexar, gravar, colar e arrastar na caixa; mostrar nos cinco lugares; aviso no sino | ✅ código na mesma branch (23/10/2026); **falta o preview** (1440×900 e 375 px) e o iPhone | — | #434 |
| **3** | Edição: editar no lugar, marca "editada", menção acrescentada | ✅ código na branch `feat/anotacao-editavel` (23/10/2026, a partir de `a268963d`), sem push; **falta o preview** (1440×900, ~305 e 375 px) e o iPhone | a da Fase 1 (`editada_em`) | — |
| **4** | API v1 (`GET /notes` com anexos e `editada_em`) e doc pública | ✅ na mesma branch (23/10/2026) | — | #434 |

PRs: Fases 1 e 2 juntas (a 1 sozinha não tem tela para provar no preview); a
Fase 3 em outro PR; a 4 entra no PR das Fases 1–2 se couber.

## O pedido (22/10/2026)

Marcar um colega e mandar um ÁUDIO pela anotação, em vez de só escrever: uma
conversa interna sem tela nova. Na mesma passada, anexar arquivos e editar a
anotação, que hoje não se edita.

## Como é hoje (medido em 22/10/2026)

- **Só texto, em três camadas:** a caixa não salva sem texto
  (`internal-note-box.tsx`, o `salvar` e o `disabled`), a rota recusa
  (`POST /api/cb/notes`, "texto is required") e o banco tem
  `cb_conversation_notes_texto_check` = `CHECK (btrim(texto) <> '')`
  (conferido na produção).
- **Não se edita:** a 918 revogou o UPDATE do navegador ("só criar e
  apagar"); o único UPDATE é o fixar (`PATCH /api/cb/notes/[id]`, 951).
  Apagar é DELETE direto do navegador, por dois caminhos: `useApagarNota`
  (fio, aba Notas, grupo) e o `deleteNote` próprio da ficha de `/contatos`.
- **Quatro escritores, todos no servidor:** a rota do painel, a API v1, o
  agente de IA e o passo de automação. Só a rota do painel ganha anexos e
  edição.
- **Cinco lugares desenham o `texto` direto:** `note-line.tsx` (fio),
  `cartao-de-nota.tsx` (aba Notas e grupo), `nota-fixada-bar.tsx`,
  `citacao-da-nota.tsx` e a ficha de `/contatos` (`contact-detail-view.tsx`,
  lista própria, arquivo do upstream).
- **Aviso:** o sino e o pop-up do navegador mostram os 280 primeiros
  caracteres do texto (o `body` gravado pela rota). A menção sai do TEXTO
  (`mencionadosNoTexto`).
- **Tempo real:** a tabela está na publicação SEM lista de colunas (`prattrs`
  nulo na produção) e com REPLICA IDENTITY FULL (921); o hook já ouve INSERT,
  UPDATE (o fixar) e DELETE e troca a linha inteira. Coluna nova viaja
  sozinha.
- **Armazenamento:** `chat-media` é PÚBLICO (`public: true`, 50 MiB por
  arquivo): quem tem o link abre sem login (0900, 1067). As regras de escrita
  deixam QUALQUER membro ativo, de qualquer perfil, gravar, trocar e apagar
  arquivo da conta fora de `acervo/` (954). O upload do navegador grava o
  `owner_id` (na produção, 630 dos 3.972 objetos dos últimos 30 dias têm
  dono).
- **Nada apaga arquivo sozinho:** no código, `remove()` do armazenamento só
  existe no acervo, na marca e no descarte do compositor e da agendada. Nada
  lista nem varre o bucket.
- **Unir fichas:** `cb_unir_fichas` move as anotações por UPDATE de
  `conversation_id`/`contact_id` (1093). Coluna nova da anotação vai junto;
  tabela nova com `contact_id`, ou com FK para a anotação, teria de entrar na
  função (a varredura de FKs dela recusa tabela que não conhece) e na Lixeira
  de contatos (`lixeira_sem_tratamento`).
- **API v1:** `GET /api/v1/notes` monta a resposta campo a campo
  (`serializeNote`): coluna nova não vaza. Nenhuma chave ativa tem
  `notes:read`.
- **Transcrição:** `transcreverAudio` só lê `messages` (e D4 a deixa fora).
- **Compositor:** `message-composer.tsx` é do upstream; a caixa de anotação
  (`InternalNoteBox`), os cartões e o `PlayerDeAudio` são nossos. No fio, a
  caixa monta DENTRO do compositor, sem `key`, e fecha por efeito ao trocar de
  conversa; no painel e no grupo, remonta por `key={conversationId}`.
- **Volume (30 dias):** ~370 anotações, ~110 com menção, ~30 respostas.

## Decisões do operador (22/10/2026)

- **D1.** O anexo mora na PRÓPRIA anotação, sem tela nova de conversa interna.
- **D2.** Mais de um anexo por anotação.
- **D3.** Tipos: todos os que o CRM aceita hoje — áudio (gravado na hora ou
  arquivo), imagem, vídeo, PDF, Word, Excel, PowerPoint, TXT e HTML.
- **D4.** Sem transcrição nos áudios da anotação.
- **D5.** Anexo da anotação fica FORA da aba Arquivos.
- **D6.** Todos os perfis anexam, inclusive leitura: a mesma régua de quem
  anota (`canWriteNotes`).
- **D7.** A anotação passa a ser EDITÁVEL (revoga o "só criar e apagar" da
  918).

## Decisões A1–A7 (23/10/2026: as recomendações ACEITAS pelo operador)

Resumo do que vale: A1 público; A2 só o autor edita; A3 sem prazo; A4 marca
"editada" com a hora, sem versões; A5 texto e anexos; A6 a ficha de
`/contatos` mostra anexos e marca, escreve só texto e não edita; A7 50 MiB
por arquivo. Valem também os padrões propostos abaixo (10 anexos, 5 min de
gravação, a menção acrescentada avisa só quem entrou). O texto de cada item
fica como estava, para registro do porquê.

- **A1. Armazenamento público ou privado.** *Recomendado: público, como todo
  o `chat-media`.* É a mesma exposição dos documentos de cliente hoje, e a
  anotação guarda só o CAMINHO (a URL nasce na tela): virar privado depois não
  exige migrar dado. Privado fecha o link vazado (o áudio interno é o que o
  cliente nunca pode ouvir), mas pede um segundo bucket com lista de tipos e
  regras próprias, link temporário gerado na tela e mais idas ao
  armazenamento, que já levaram o banco ao teto de conexões duas vezes em
  outubro.
- **A2. Quem edita.** *Recomendado: só o autor.* O admin continua APAGANDO
  qualquer anotação (regra de hoje), mas não reescreve a de outra pessoa: a
  autoria carimbada passaria a mentir. Anotação sem autor (automação, agente
  de IA: `author_user_id` nulo) não se edita; a da API v1 leva o dono da
  conta como autor, e só ele a edita.
- **A3. Prazo para editar.** *Recomendado: sem prazo, com a marca visível.*
  Alternativa: uma janela (por exemplo, 24 h).
- **A4. Rastro da edição.** *Recomendado: marca "editada" com a hora da
  edição*, como no WhatsApp, sem guardar versões. Alternativa: guardar o
  texto anterior a cada edição (tabela própria, visível ao admin), se a
  anotação servir de registro.
- **A5. O que se edita.** *Recomendado: texto e anexos* (tirar o arquivo
  errado, pôr o que faltou; o tirado é apagado pela fila). Alternativa: só o
  texto.
- **A6. Ficha de `/contatos`.** *Recomendado: mostra os anexos e a marca,
  continua escrevendo só texto e não edita.* A ficha tem caixa e lista
  próprias, num arquivo do upstream; levar a caixa nova para lá é trabalho à
  parte. Alternativa: a caixa completa lá também.
- **A7. Teto por arquivo.** *Recomendado: 50 MiB*, o limite do próprio
  armazenamento (a anotação não vai à Meta). Alternativa: os tetos do
  compositor (imagem 5 MB; vídeo, áudio e documento 16 MB).

**Padrões propostos** (mudam com uma palavra do operador): até 10 anexos por
anotação (o `MAX_ANEXOS` do compositor); gravação de até 5 min (a do
compositor); a menção ACRESCENTADA na edição avisa só quem entrou, e o aviso
antigo fica como foi escrito.

## Desenho

### Banco (uma migration, ADITIVA: aplicar antes do deploy)

Número = maior do `main` + 1 NA HORA (`ls supabase/migrations`,
`list_migrations` e as worktrees das outras sessões).

- **`anexos jsonb NOT NULL DEFAULT '[]'`** em `cb_conversation_notes`: lista
  de `{ caminho, nome, mime, bytes }`. Lista na linha, e não tabela filha,
  pelo precedente de `mencionados` (só se lê junto da nota) e por três
  motivos: o INSERT do tempo real chega com os anexos (com tabela filha,
  chegaria sem eles, e o colega veria a anotação em branco até recarregar);
  `cb_unir_fichas` move a anotação e os anexos vão junto, sem entrar na
  função; e anotação e anexos nascem numa escrita só.
- **`editada_em timestamptz`** (NULL = nunca editada).
- **Regras (CHECK):** a `cb_conversation_notes_texto_check` sai (DROP pela
  forma, ADD com nome: 989) e entram `cb_conversation_notes_conteudo_ck`
  (texto não vazio OU pelo menos um anexo) e `cb_conversation_notes_anexos_ck`
  (`anexos` é lista, com no máximo 10). Com `CASE`, não `AND`: o Postgres não
  garante a ordem, e `jsonb_array_length` estoura em não-lista.
- **Fila `cb_arquivos_a_apagar`** (`bucket`, `caminho`, `account_id`,
  `origem`, `criado_em`, `tentativas`, `ultima_tentativa`, `erro`), peça
  compartilhada: `account_id uuid NOT NULL` SEM FK para `accounts` (com o
  CASCADE de uma conta apagada, a FK derrubaria a exclusão da conta, e a linha
  precisa sobreviver para o arquivo sair); `origem` (`anotacao` | `lixeira`);
  `CHECK (bucket = 'chat-media')`; `CHECK (caminho LIKE 'account-' ||
  account_id || '/%')`; índice único `(bucket, caminho)`, com `ON CONFLICT DO
  NOTHING` em todo escritor. Fechada ao navegador (RLS sem policy, REVOKE de
  `anon` e `authenticated`).
- **Gatilho** `AFTER DELETE OR UPDATE OF anexos`, por linha, em
  `cb_conversation_notes`: enfileira os caminhos de OLD que não estão em NEW
  (no DELETE, todos). SECURITY DEFINER com `search_path` fixo: o DELETE vem do
  navegador, que não grava na fila. Pega os três jeitos de uma anotação sumir
  (a tela, o CASCADE de contato, conversa ou conta, e SQL à mão) e não dispara
  na união de fichas, que não mexe em `anexos`. ⚠️ Respeita o sinal
  `cb.lixeira = 'movendo'`, lido como `nullif(current_setting('cb.lixeira',
  true), '')`: mover a ficha para a Lixeira é um CASCADE na mesma transação, e
  os anexos só podem sair quando a ficha sair de vez. Se a Lixeira já estiver
  no `main`, este PR também (a) declara o gatilho no inventário da restauração
  ("pode disparar": não reage a INSERT); (b) faz o "Excluir agora" e o
  vencimento enfileirarem `anexos[].caminho` das anotações da fotografia; (c)
  declara `anexos` no pino de citadores.
- **Armazenamento (`chat-media`, as três regras da 954 refeitas):** gravar
  continua igual (qualquer membro ativo grava em `notas/`; `acervo/` segue só
  admin); TROCAR em `notas/`: ninguém pelo navegador; APAGAR em `notas/`: só
  o arquivo que a própria pessoa subiu (`owner_id`), para a caixa desfazer um
  envio que não virou anotação. `IS DISTINCT FROM`, nunca `<>`
  (`supabase.md`). As regras só apertam `notas/`, que hoje está vazia.
- **Conferência (banco vazio):** a migration CHAMA o gatilho num subbloco
  desfeito por SQLSTATE próprio (modelo 1030): monta conta, conversa e
  anotação com anexo, apaga e confere a linha na fila. No MESMO subbloco, com
  `set_config('cb.lixeira', 'movendo', true)`, apaga outra anotação com anexo
  e confere que a fila não recebeu nada (o rollback do subbloco desfaz o
  sinal junto); e apaga uma conta com anotação com anexo, conferindo a linha
  na fila. Confere as duas regras novas. Antes de aplicar, prova num Postgres
  descartável com as restrições REAIS, inclusive a regra do dono
  (`owner_id`) no armazenamento.

### Módulo puro `src/lib/notes/anexos.ts` (com teste)

- `MIMES_DA_ANOTACAO`: o `MIMES_POR_TIPO` do acervo (espelho do bucket:
  imagem, vídeo, documento, áudio) mais o `MIMES_SO_POR_QR_CODE` (o `.html`).
  Uma lista só, como manda `midia.md`; o teste amarra que ela cabe na
  `allowed_mime_types` do bucket.
- Tetos: `TETO_DO_ANEXO` (A7) e `MAX_ANEXOS_DA_NOTA` = `MAX_ANEXOS`;
  `SUBPASTA_DAS_NOTAS = 'notas'`.
- `lerAnexosDoCorpo` (forma, prefixo `account-<conta>/notas/`, sem
  repetição), `mantidosSaoDaNota` (Fase 3: na edição, os
  que ficam são os que a nota já tinha, gravados como a nota os guarda) e `resumoDosAnexos` ("🎤 Áudio", "📎 3 anexos") para o aviso, a
  citação e a faixa fixada.

### Rotas

- **`POST /api/cb/notes`** aceita `anexos`: texto OU anexo. Para cada
  caminho, o servidor confere o prefixo da conta e lê no PRÓPRIO
  armazenamento se o arquivo existe, o tamanho e o tipo (nunca do corpo); a
  forma da leitura (`info()` ou `list()`) se mede contra o Storage real.
  Armazenamento fora do ar não é arquivo sumido: responde 503, nunca 400. O
  nome vem do corpo, aparado. Se o insert falhar, os arquivos ficam para a
  nova tentativa da caixa, que apaga os seus quando a pessoa desiste.
- **`PUT /api/cb/notes/[id]`** (novo; o `PATCH` continua só para fixar): só o
  autor (A2), lido sob RLS; os anexos que ficam têm de ser da nota; os novos
  são conferidos como no POST; UPDATE cercado pelo autor, com a linha
  conferida; `editada_em` só muda se algo mudou; nota apagada no meio responde
  409. Os anexos tirados saem pelo gatilho.
- Os outros três escritores seguem só texto e nascem com `anexos = []`.

### Limpeza: drenar a fila no laço lento

- No `after()` de `/api/cb/scheduled/cron` (forma de CALLBACK), em
  sequência: `gerarTarefasRecorrentes`, o vencimento da Lixeira (quando
  existir; UM item por chamada, repetida pelo servidor) e por último a
  drenagem, sob UM prazo comum, definido num lugar só (o `after()` não tem o
  teto de 120 s do curl). Uma rota nova exigiria mudar o `command` do
  agendador, e isso só vale com `docker stack deploy` manual (`deploy.md`).
  Anotar no `deploy.md`: tirar a rota do laço cala a limpeza junto.
- Lote pequeno, tentativa carimbada ANTES do trabalho; `remove()` com
  service role; erro soma uma tentativa, e a linha para depois de 10.
- A drenagem é a MESMA da Lixeira de contatos: aplica ao `caminho` da fila a
  guarda de `cb_caminho_no_chat_media(p_url, p_conta)` com o `account_id` da
  linha (`account-<conta>/`, sem `..` nem `%`, fora de `acervo/`) e a
  conferência UNIVERSAL "ninguém mais cita" na hora de apagar — anotações,
  mensagens, agendadas, acervo, passos de automação, modelos, foto do contato
  e as fotografias da Lixeira. O prefixo `notas/` é conferido na ENTRADA
  (rotas e gatilho da anotação), não na drenagem, que é compartilhada.
- Efeito: o arquivo de anotação apagada e o de anexo tirado na edição saem do
  armazenamento em até ~15 min. O da anotação de contato apagado só sai
  quando a ficha sai de vez da Lixeira (vencimento ou "Excluir agora", pela
  fotografia); enquanto a Lixeira não estiver no `main`, sai pelo CASCADE,
  como os outros.

### Tela (Fase 2)

- **A caixa** (`InternalNoteBox`, nossa) ganha clipe, microfone, colar e
  arrastar, e a lista do que foi escolhido, com remover. O seletor usa o
  `accept` de `MIMES_DA_ANOTACAO`; colar e arrastar reaproveitam as funções
  puras de `arquivo-solto.ts` (`colagemEhAnexo`, `nomeParaColagem`,
  `arquivoParaEnviar`: o MIME é normalizado ANTES de subir).
- **Gravador próprio** (`useGravadorDeVoz`, nosso): cópia do gravador
  opus-recorder do compositor (Ogg/Opus, o mesmo encoder em `/opus/`), sem
  tocar no compositor do upstream. Solta o microfone quando a caixa some: no
  fio ela fecha ao trocar de conversa; no painel e no grupo, remonta por
  `key`.
- **Subir só ao Salvar:** os arquivos ficam na memória da aba (prévia por
  `URL.createObjectURL`); ao Salvar, sobem um por um para
  `account-<conta>/notas/`, com progresso, e só então vai o POST ou o PUT. Se
  um falhar, para, mantém o rascunho e não sobe de novo os que já subiram;
  desistir apaga os já subidos (regra do dono). O salvar leva a conversa de
  ORIGEM; a tela já ignora nota de outra conversa.
- **Mostrar:** componente novo `AnexosDaNota`, nos CINCO lugares. Áudio é o
  `PlayerDeAudio`, sem transcrever (D4); imagem e vídeo são miniaturas que
  abrem o `MediaViewer`, com setas entre as imagens da mesma anotação;
  documento é o cartão com o selo de `tipoDoDocumento`; `.html` só baixa
  (`urlParaAbrirAnexo`). A faixa fixada e a citação mostram o resumo. Nada de
  largura fixa que não encolha (fio de 305 px; `inbox-conversa.md`). A URL é
  derivada do caminho na tela e nunca gravada.
- **Pino** `anexos-da-nota.chamadores.test.ts` (default-deny): todo arquivo
  que desenha o `texto` da anotação também desenha `AnexosDaNota` ou o resumo.
- **Aviso:** o corpo do sino e do pop-up ganha o resumo ("@Fulano · 🎤
  Áudio"), escrito cru pela rota, como hoje.
- **Fora:** a aba Arquivos (D5) e a transcrição (D4). Chaves novas nos DOIS
  dicionários.
- **Ficha de `/contatos`** (A6): mostra os anexos. É arquivo do upstream:
  uma linha na tabela de `docs/MERGE-UPSTREAM.md`, e outra para
  `ConversationNote.anexos`/`editada_em` em `src/types/index.ts`.

### Edição (Fase 3)

- **Lápis** ao lado de Responder, Fixar e Apagar, só para o autor (A2).
- **Edita no LUGAR:** a anotação vira a caixa em modo edição (texto, anexos
  atuais removíveis, novos anexos). Nunca a caixa do compositor, onde o Enter
  envia ao cliente.
- **Marca "editada"** ao lado da hora, com a hora da edição no `title`, nos
  cinco lugares (A4).
- **Tempo real:** o hook já troca a linha no UPDATE; a citação e a faixa
  fixada leem a nota atual. (Na implementação o hook ganhou só `substituir`:
  a resposta do `PUT` troca a linha na hora, como o `acrescentar` do POST.)
- **Menção acrescentada** → `note_mention` só para quem entrou.
- Os comentários que afirmam "a nota não é editável" (918,
  `[id]/route.ts`, `use-conversation-notes.ts`, `anotacoes.md`) mudam junto.

### API v1 e doc (Fase 4)

- `GET /api/v1/notes` ganha `anexos` (`nome`, `tipo`, `tamanho`, `url`) e
  `editada_em`; o `POST` segue só texto. Sem isso, a anotação só de anexos
  sairia com `texto` vazio, sem sinal. Ninguém quebra hoje: nenhuma chave lê
  anotações. `docs/public-api.md` muda no mesmo PR (job `documentacao`).

## Riscos conferidos e a resposta do desenho

| Risco (conferido em 22/10/2026) | Resposta |
| --- | --- |
| Banco, rota e caixa recusam anotação sem texto | Regra "texto OU anexo" nas três camadas; os outros escritores seguem exigindo texto |
| Apagar a anotação (dois caminhos), o contato (CASCADE) ou tirar o anexo deixaria o arquivo no armazenamento | Gatilho + fila + limpeza no laço lento |
| Link público abre sem login, para sempre | A1; guardar só o caminho deixa a troca reversível |
| Qualquer membro apaga ou troca arquivo fora do acervo pela API do armazenamento | Regras próprias para `notas/`: ninguém troca; só o dono apaga o que subiu |
| Cinco lugares desenham o texto direto; esquecer um deixa a anotação em branco | `AnexosDaNota` + pino default-deny |
| Sino e pop-up mostram só o texto | Resumo dos anexos no corpo do aviso |
| Troca de conversa no meio da gravação ou do envio | O gravador solta o microfone quando a caixa some; o salvar leva a conversa de origem |
| A API devolveria `texto` vazio sem sinal | Fase 4 |
| Mais mídia, mais idas ao armazenamento (teto de conexões em 13/10 e 19/10) | Sobe só ao salvar; player com cache por endereço; volume pequeno (~370 anotações por mês) |

## Fora deste plano

- Transcrição do áudio da anotação (D4) e anexos na aba Arquivos (D5).
- Anexo pela API v1, pelo passo de automação e pelo agente de IA.
- Vídeo `.mov` do iPhone e GIF: hoje o CRM só os aceita na ENTRADA.
- Acervo de mídias no clipe da anotação.
- Os arquivos de MENSAGENS de contato apagado (lacuna antiga, achada neste
  estudo): plano próprio, `docs/PLANO-lixeira-de-contatos.md` (decisão do
  operador de 22/10/2026: Lixeira de 90 dias). As peças compartilhadas estão
  no cabeçalho.

## Limites conhecidos

- Aba fechada no meio do Salvar deixa arquivo sem anotação (raro; nada varre
  o bucket).
- O autor consegue apagar à mão, pela API do armazenamento, o arquivo da
  própria anotação (é a regra do dono).
- Gravação e reprodução no iPhone (app instalado) só se confirmam no
  aparelho.

## Teste de ponta a ponta (preview)

- ⚠️ O preview grava na PRODUÇÃO (`.env.local`): testar só na conversa de
  teste autorizada pelo operador; no fim, apagar as anotações de teste e
  conferir a fila vazia depois do ciclo do laço lento.
- 1440×900 e 375 px; duas sessões (outro usuário) para o tempo real.
- Casos: só áudio; texto + três anexos de tipos diferentes; `.html` só baixa;
  perfil leitura anexa; trocar de conversa gravando (o microfone solta e nada
  é salvo na outra); upload que falha (rede desligada) mantém o rascunho;
  editar texto e anexos; marca "editada" na tela do colega; menção
  acrescentada avisa só o novo; apagar → fila → arquivo some depois do ciclo.

## Docs que mudam junto

- `.claude/rules/anotacoes.md` (anexos, edição e fila; teto de 25 KB),
  `.claude/rules/deploy.md` (a limpeza no `cb/scheduled/cron`),
  `.claude/rules/supabase.md` (a fila e a guarda do caminho; o sinal
  `cb.lixeira`, que o gatilho dos anexos respeita), se este PR chegar antes
  do da Lixeira, CLAUDE.md
  seção 12 (D1–D7 e as respostas de A1–A7, em uma linha),
  `docs/MERGE-UPSTREAM.md` (as duas linhas da Fase 2),
  `docs/MIGRATIONS-APLICADAS.md` (ao aplicar) e `docs/public-api.md`
  (Fase 4).

## Fases 1, 2 e 4 — registro (23/10/2026)

**Objetivo:** anexos na anotação de ponta a ponta (banco, rota, caixa, os
cinco lugares que desenham a anotação, o aviso e a API v1), sem a edição.
Branch `feat/anotacao-com-anexos` (a partir do `main` @ `5fe5693a`), sem push.

**Arquivos.** Banco: `supabase/migrations/1102_cb_anotacao_com_anexos.sql`
(pino `anotacao-com-anexos-1102.test.ts`). Servidor: `src/lib/notes/anexos.ts`
(puro), `arquivo-do-anexo.ts` (a leitura no Storage), `POST /api/cb/notes`,
`GET /api/v1/notes`. Navegador: `src/lib/notes/subir-anexo.ts`,
`src/hooks/use-gravador-de-voz.ts`, `internal-note-box.tsx`,
`anexos-da-nota.tsx` (`AnexosDaNota` e `ResumoDosAnexos`, pino
`anexos-da-nota.chamadores.test.ts`), os cinco lugares, `player-de-audio.tsx`
(`corHerdada`), `ConversationNote.anexos`/`editada_em`, os dois dicionários,
`docs/public-api.md`, as regras (`anotacoes.md`, `midia.md`, `supabase.md`,
`deploy.md`, `inbox-conversa.md`) e `docs/MERGE-UPSTREAM.md`.

**Medido no Postgres 16 descartável** (o esquema da produção, a semente
fictícia, a 1097→1101 do `main`, um `storage.objects` mínimo com as policies
da 0900/0954; scripts em `…/scratchpad/lixeira-prova/refazer-anotacao.sh` e
`prova-anotacao.sql`):
- a 954 deixava um membro apagar o arquivo de `notas/` que OUTRO subiu (1
  linha) — o furo que a 1102 fecha;
- a 1102 aplicada DUAS vezes (a segunda deu o mesmo) e num banco sem conta
  (a conferência do gatilho pula com NOTICE); a conferência da migration
  CHAMOU o gatilho numa conversa da semente (desfeita);
- regras: só de anexo entra; sem texto e sem anexo, só espaços, 11 anexos,
  objeto ou escalar no lugar da lista não entram; 10 entram; o escritor
  antigo (só texto) segue valendo, com `anexos = []`;
- apagar pelo NAVEGADOR (a autora, papel `authenticated`, sem privilégio na
  fila) põe os 2 anexos na fila, origem `anotacao`; o navegador não lê a
  fila (42501);
- tirar 1 de 3 anexos põe SÓ o tirado; renomear, mexer no texto ou regravar
  a mesma lista, nada;
- com o sinal `cb.lixeira` (`movendo`, `restaurando`) nada vai à fila; com o
  sinal vazio (sessão do pool que já o usou), vai;
- contato apagado por SQL e CONTA apagada: os anexos vão à fila (a linha da
  conta sumida sobrevive, sem FK);
- a ida e volta da Lixeira (ficha fictícia, como a 1098): mover → nada na
  fila, o item cita o anexo e ele conta como citado → restaurar → a anotação
  volta com os MESMOS anexos → excluir de vez → o anexo vai à fila (origem
  `lixeira`);
- SEM o WHEN do sinal (gatilho recriado à mão, desfeito): o mover enfileira e
  a restauração recusa com `lixeira_gatilho_sem_sinal:cb_conversation_notes.
  cb_anexos_da_anotacao_para_a_fila` — o defeito que o WHEN e a declaração
  evitam;
- a drenagem: o caminho citado por anotação viva sai da fila sem ser
  devolvido para apagar; o não citado é devolvido;
- armazenamento (RLS, como `authenticated` com claims): a atendente grava em
  `notas/`; o ADMIN não apaga nem troca o arquivo dela (0 linhas); nem a dona
  troca; mover anexo comum para dentro de `notas/` é recusado; a dona apaga o
  dela; arquivo sem dono (service role) ninguém apaga; quem saiu da conta não
  apaga; fora de `notas/`, igual à 954 (anexo comum: todo membro troca e
  apaga; acervo: só admin).
- Sementes: a ficha A da semente não restaura no descartável
  (`cb_webhook_eventos_webhook_fk`: o webhook da semente não tem conta) —
  defeito da SEMENTE, não da 1102; a ida e volta usa ficha fictícia nova.

**Testes (Node 22):** suíte inteira verde (vitest: 755 arquivos, 11.764
testes), typecheck, lint (0 erros; nos arquivos tocados, só os 6 avisos que
já existiam em `contact-detail-view.tsx`), os dois portões de i18n e o
`doc-acompanha` contra `origin/main`. O gravador (`useGravadorDeVoz`) não tem
teste de unidade (o vitest roda sem DOM): confere-se no preview e no iPhone.

**Decisões tomadas na implementação (conferir com o operador):**
- caminho `account-<conta>/notas/<uuid>/<nome>`: pasta por arquivo, para o
  nome no fim do endereço ser o do arquivo (o PDF aberto numa aba sugere esse
  nome ao baixar);
- a gravação se chama `audio-<AAAAMMDD-HHMMSS>.ogg` (UTC, como o print
  colado);
- resumo: um anexo pelo tipo ("🎤 Áudio", "🖼️ Imagem", "🎬 Vídeo",
  "📄 <nome>"), vários pela contagem ("📎 3 anexos"); o corpo do aviso é
  "texto · resumo", e o texto encolhe para o resumo caber nos 280;
- o cartão FIXADO do painel, recolhido, mostra o resumo e ganha a seta mesmo
  com o texto inteiro; aberto, texto e anexos rolam juntos sob um teto;
- a faixa da fixada no fio e a citação mostram só o resumo;
- salvando (subindo os arquivos ou gravando a anotação), Cancelar e Esc não
  fecham a caixa: o salvar não se interrompe, e fechar faria parecer
  desistência; "Salvar" fica desligado enquanto grava, e o clipe e o
  microfone, com 10 anexos;
- na API, o `.html` sai com `?download=` também (a mesma régua da tela).

**Fica para depois:** aplicar a 1102 com autorização do operador (ADITIVA:
antes do deploy) e registrar em `docs/MIGRATIONS-APLICADAS.md`; o e2e da
seção "Teste de ponta a ponta"; a gravação e o player no iPhone; a Fase 3
(edição, `mantidosSaoDaNota`, a marca "editada"). Medido pelo operador em
23/10/2026 (sem pendência): o `info()` do Storage hospedado devolve `size` e
`contentType` no topo, e o ausente como `status: 400`, `statusCode: "404"`
(o que `lerArquivoDoAnexo` já trata); as policies de UPDATE, DELETE e INSERT
do `chat-media` na produção são exatamente as da 954; a linha da seção 12 do
CLAUDE.md entrou (`d87458f1`).

**Limite novo conhecido:** a aba fechada com o POST sem resposta deixa os
arquivos (a anotação pode ter sido salva; a caixa não apaga o incerto). E o
replay do CI precisa de `storage.objects.owner_id` (migration do próprio
storage-api, presente onde a 0023/0986/1060 já usam colunas mais novas do
bucket) — se faltar, a 1102 reprova no CI com a mensagem do Postgres.

### Correções da revisão (23/10/2026: revisor independente + Codex no PR #434)

- **Salvar que termina fora da tela** (trocou de conversa no meio): não
  chama mais `onSaved`/`onClose`/`onLimparResposta` (eram os do render do
  clique e mexiam na conversa aberta agora); avisa "salva", "não salva" ou
  "incerta" com frase própria (`naTelaRef`, efeito de layout).
- **Gravação parada e salva em seguida**: o gravador fica `finalizando` até
  os bytes chegarem, e o Salvar espera; arquivo solto ou colado durante o
  salvar avisa em vez de sumir.
- **Miniatura** de imagem pela transformação do Storage (`urlDaMiniatura`,
  160 px); o original só no visualizador; ícone se a transformação recusar.
- **Esc no visualizador dentro de Sheet** não fecha mais o Sheet (captura no
  `document`); o visualizador só trava a rolagem se ninguém travou antes.
- **Emoji no ponto do corte** (nome do anexo, corpo do aviso):
  `cortarSemPartir`, com teste em toda posição.
- **Pinos**: `anexos-da-nota.chamadores.test.ts` lê a árvore do TypeScript
  (`n.texto`, `nota!.texto`, desestruturação) em quem usa `ConversationNote`,
  com exceções pelas leituras exatas; `subirAnexoDaNota` em `AJUDANTES`.
- **Rota**: erro ao ler perfil ou conversa = 500 (era 403/404); id que não é
  UUID = 400 antes do banco; a recusa de um anexo diz qual (`anexo`).
- **1102 e as travas**: a regra do armazenamento em memória foi para ANTES da
  ALTER; depois dela, só catálogo (as regras pela definição,
  `cb_arquivos_citados` pelo corpo — não é mais CHAMADA com a trava tomada) e
  a DML mínima que chama o gatilho (um INSERT, um UPDATE, um DELETE, pela
  chave); `lock_timeout` de 1 s antes das policies de `storage.objects`.
  Provado de novo no descartável: as 2 aplicações, o banco vazio e os 28
  cenários; a 1102 inteira roda em ~20 ms ali; cinco mutantes (regra com 11,
  gatilho mudo, UPDATE que ignora NEW, `cb_arquivos_citados` sem as anotações,
  regra que deixa o admin apagar) são todos recusados pela conferência.
- **Textos**: a recusa de tipo diz os formatos aceitos de verdade (áudio OGG,
  MP3, AAC ou AMR; M4A, WAV e WebM ficam de fora), com teste que amarra a
  frase à régua.

## Fase 3 — registro (23/10/2026)

**Objetivo:** editar a anotação NO LUGAR (texto e anexos), só pelo autor, com
a marca "editada" nos cinco lugares e a menção acrescentada avisando só quem
entrou. Branch `feat/anotacao-editavel`, a partir de `a268963d` (a ponta do
#434), sem push. Sem migration: `editada_em` entrou na 1102.

**Arquivos.** Servidor: o `PUT` em `src/app/api/cb/notes/[id]/route.ts` (e o
`PATCH` de fixar passou a responder 500, não 403, quando a leitura do perfil
falha) e `mantidosSaoDaNota` em `src/lib/notes/anexos.ts`. Navegador: o modo
`editando` do `internal-note-box.tsx`, `src/hooks/use-edicao-de-nota.ts`, o
`substituir` do `use-conversation-notes.ts`, `marca-de-editada.tsx`, o lápis
em `note-line.tsx` e `cartao-de-nota.tsx`, a marca na faixa fixada, na
citação e na ficha de `/contatos`, os três que trocam a nota pela caixa
(`message-thread.tsx`, `painel-do-contato.tsx`, `group-sidebar.tsx`), o
comentário de `ConversationNote`, os dois dicionários, a frase do
`editada_em` em `docs/public-api.md` (o contrato da API não mudou),
`anotacoes.md` e `docs/MERGE-UPSTREAM.md`. `poderes.ts` não mudou: quem anota
(`canWriteNotes`, `viewer` para cima) edita a PRÓPRIA, e as telas já são
`viewer` em `ESCRITA_DA_TELA`.

**Decisões tomadas na implementação (conferir com o operador):**
- a cerca de concorrência é o próprio `editada_em` (a tabela não tem
  `updated_at`): a caixa manda a versão de quando ABRIU e o banco compara, na
  leitura e no UPDATE. Editada noutro lugar = 409 `NOTE_CHANGED`: nada se
  sobrescreve e o rascunho fica na caixa ("cancele e edite de novo"); não há
  mescla;
- apagada antes da leitura OU entre a leitura e o UPDATE = 409 `NOTE_GONE`
  (as duas medidas pela mesma releitura); a caixa diz que foi apagada;
- o corpo é `{ texto, mencionados, mantidos, novos, versao }`: `mantidos` são
  só os caminhos (o resto vem da nota), `novos` têm a forma dos `anexos` do
  POST;
- "nada mudou" compara o texto aparado e a lista de caminhos NA ORDEM: sem
  UPDATE, `editada_em` intacta, `mudou: false`;
- as menções gravadas FICAM quando não há conferência: leitura dos membros
  que falhou na rota, ou a caixa que ainda não tinha (ou não conseguiu) a
  lista de membros — ela então não manda `mencionados`. Sem isso, quem já
  estava mencionado "entraria" de novo na edição seguinte;
- a nota em edição que some da lista RESPONDIDA (apagada por outra pessoa)
  fecha a caixa com o aviso "foi apagada"; os anexos novos ainda não salvos
  ficam na memória e somem com ela (nada subiu antes do Salvar);
- o lápis vem antes do alfinete (no cartão, depois de "Ver na conversa"); no
  fio, só para quem anota (`podeAnotar`) e é o autor;
- a marca é "editada" em itálico ao lado da hora, com "Editada em <data e
  hora>" no `title` e no texto para leitor de tela;
- frases próprias da edição: o título "Editando a anotação interna:", o botão
  "Salvar alterações" e os avisos de apagada, editada noutro lugar, sem
  permissão e "não salva" com a caixa fora da tela; os de "salva" e "talvez
  salva" fora da tela são os da anotação nova.

**Testes (Node 22):** `[id]/route.test.ts` novo (32 casos do `PUT` e o
erro de perfil do `PATCH`: autor × não autor × admin × sem autor, mantido de
outra nota, novo ausente/grande/tipo recusado/armazenamento fora, nada
mudou, 409 nas duas janelas, a versão que vai ao banco como veio, erros de
leitura = 500, menção só para quem entrou, `mencionados` ausente), os de
`mantidosSaoDaNota` em `anexos.test.ts`, a marca e o lápis em
`cartao-de-nota.test.tsx`, e o default-deny estendido para a marca.

**Limites conhecidos (novos):**
- na aba Notas, a nota FIXADA ou desafixada por outra pessoa no meio da
  edição muda de lugar (do cartão preso para a lista, ou o contrário): a
  caixa remonta e o rascunho se perde, sem aviso;
- a recarga das anotações que FALHA (voltar ao app sem rede) esvazia a
  lista: a caixa some com o rascunho, sem o aviso de "apagada" (falha não é
  apagada), e a nota volta na recarga seguinte como está.

**Achado no e2e das Fases 1–2 e consertado aqui:** o "Cancelar" da caixa
(`ghost`) herdava a cor do tema e, no modo escuro, saía branco sobre o âmbar
(medido no preview: luminosidade 98 sobre 98,6) — já era assim no `main`. Na
edição é ele que desiste; ganhou o âmbar dos ícones ao lado.

**Fica para depois:** o e2e no preview, na conversa de teste autorizada
(editar texto e anexos; tirar um anexo e ver a fila esvaziar depois do ciclo;
a marca na tela do colega; a menção acrescentada avisando só o novo; editar
com a nota apagada noutra sessão; dois cliques em Salvar; ~305 e 375 px) e o
iPhone (a caixa no lugar com o teclado aberto).
