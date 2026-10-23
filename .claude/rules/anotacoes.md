---
paths:
  - "src/components/inbox/note-line.tsx"
  - "src/components/inbox/cartao-de-nota.tsx"
  - "src/components/inbox/citacao-da-nota.tsx"
  - "src/components/inbox/internal-note-box.tsx"
  - "src/components/inbox/nota-fixada-bar.tsx"
  - "src/components/inbox/anexos-da-nota*"
  - "src/hooks/use-apagar-nota*"
  - "src/hooks/use-conversation-notes*"
  - "src/hooks/use-fixar-nota*"
  - "src/hooks/use-gravador-de-voz*"
  - "src/lib/notes/**"
  - "src/app/api/cb/notes/**"
  - "src/app/api/v1/notes/**"
  - "supabase/migrations/1102_cb_anotacao_com_anexos.sql"
---

# Anotações internas — regras

Vale ao editar ou revisar a anotação interna nas quatro telas (o fio, a aba
Notas do painel, a do grupo e a ficha de `/contatos`), a caixa de escrever, a
fixada, a resposta à anotação e os anexos. O resto da conversa (fio,
compositor, links clicáveis na nota) está em `.claude/rules/inbox-conversa.md`;
o sino e o Meu dia, em `.claude/rules/meu-dia.md`; a fila de arquivos e o
bucket, em `.claude/rules/midia.md`. São QUATRO escritores, todos no servidor:
a rota do painel `POST /api/cb/notes`, a API v1 `POST /api/v1/notes` (sem
menção), o agente de IA (`anotarNaConversa`) e o passo de automação
"Escrever anotação interna" (autor nulo; `.claude/rules/automacoes-passos.md`)
— regra nova de escrita vale em todos. Anexo, SÓ a rota do painel.

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
- ⚠️ **Aba Notas do painel (decisão do operador, 29/09/2026): caixa de
  escrever PRIMEIRO, fixada logo abaixo, RECOLHIDA** (`destaque` no
  `CartaoDeNota`: duas linhas, seta só com texto cortado de verdade — ou com
  anexo, que recolhida vira o resumo —, aberta com UM teto e rolagem própria
  para o texto e os anexos). Presa e inteira, uma nota longa cobria a
  lista toda. O sticky respeita o padding do `TabsContent`: `-top-4` + faixa
  `bg-card`, senão a lista aparece por cima do cartão. Pino
  `cartao-de-nota.test.tsx`.
- **`contact-detail-view` tem `deleteNote` próprio, de propósito**: distingue
  "proibido" de "falhou".
- **A frase do autor é `Inbox.note.wrote` nas quatro telas.**
- Quem levar o `InternalNoteBox` a uma tela nova põe a entrada dela em
  `ESCRITA_DA_TELA` como `viewer` (anotar conta como operação; ver a raiz).

### Resposta à anotação (1075)

`resposta_de` (FK composta: mesma conversa; `SET NULL (resposta_de)` ao
apagar a respondida), `src/lib/notes/resposta.ts` (pino `resposta.test.ts`) e
`CitacaoDaNota`. Decisões do operador (01/10/2026):

- **A resposta é uma anotação desenhada ONDE FOI ESCRITA**, com a respondida
  citada em cima (como no WhatsApp) — no fio, nas abas e na ficha de
  `/contatos` (lá sem Responder). Nunca empilhada sob a original: quem abre
  pelo sino cai vendo a resposta. A citação é do que foi tocado (pode ser
  outra resposta); no fio ela salta até a respondida (`irParaNota`).
- ⚠️ **O aviso `note_reply` vai ao autor da respondida e a quem já escreveu
  na conversa dela** (subindo por `resposta_de`, com a conversa lida
  INTEIRA em páginas por `id` — o teto de 1000 cortava a respondida
  recente); quem responde, nunca; quem
  foi mencionado na mesma resposta recebe só o `note_mention`. Conferido
  contra a conta, como a menção. `respostaNotificada: false` vira aviso na
  tela.
- ⚠️ **O "Responder" é estado de quem monta a caixa** (fio → compositor;
  painel e grupo → a caixa do topo da aba), carimbado com a conversa e
  comparado no render. O X da citação (e a respondida apagada, 409
  `REPLIED_NOTE_NOT_FOUND`) desfaz a citação SEM fechar a caixa: o texto fica.

### Anexos na anotação (1102)

Decisões D1–D7 e A1–A7 do operador e o desenho:
`docs/PLANO-anotacao-com-anexos-e-edicao.md`. `src/lib/notes/anexos.ts` (puro,
a régua das três pontas), `arquivo-do-anexo.ts` (a leitura no armazenamento),
`subir-anexo.ts` (o navegador), `use-gravador-de-voz.ts` e `anexos-da-nota.tsx`.

- ⚠️⚠️ **Anotação = texto OU anexo, nas TRÊS camadas**: o CHECK
  `cb_conversation_notes_conteudo_ck` (com CASE; `..._anexos_ck` = lista de
  até 10), a rota e o `disabled` da caixa. Só de anexos, o `texto` é `''`:
  toda tela esconde o parágrafo vazio. Os outros três escritores seguem
  exigindo texto e gravam `anexos = []` pelo padrão.
- ⚠️⚠️ **A anotação guarda o CAMINHO** (`account-<conta>/notas/<único>/<nome>`,
  com `nome`, `mime` e `bytes`), **nunca a URL**: ela nasce na tela por
  `urlPublicaDoAnexo` (a mesma de `getPublicUrl`; virar o bucket privado não
  migra dado). Ler o JSON é `lerAnexosDaNota`, campo a campo.
- ⚠️⚠️ **A rota nunca confia no corpo**: o caminho tem de ser desta conta e de
  `notas/`, pela guarda da 1097 (`lerAnexosDoCorpo`), e o tamanho e o tipo
  são LIDOS no armazenamento (`lerArquivoDoAnexo`, `info()` com o service
  role; a forma ainda se mede no preview). Ausente = 400
  `ATTACHMENT_NOT_FOUND`; fora do ar = 503 `STORAGE_UNAVAILABLE`, nunca 400.
- ⚠️⚠️ **O que SAI da anotação vai para a fila de arquivos** (gatilho
  `cb_anexos_da_anotacao_para_a_fila`, AFTER DELETE OR UPDATE OF anexos,
  SECURITY DEFINER): apagar pela tela, o CASCADE da conversa, do contato ou
  da conta, SQL à mão e o anexo tirado numa edição. A drenagem (`midia.md`)
  apaga em até ~15 min, se ninguém mais cita (`cb_arquivos_citados` conta os
  anexos das anotações vivas). ⚠️ Só com o WHEN do sinal `cb.lixeira` e
  declarado nos `calados` de `cb_lixeira_tratamento()`: mover a ficha para a
  Lixeira NÃO enfileira (a fotografia guarda os anexos; saem no "Excluir
  agora" ou no vencimento). Sem o WHEN, o arquivo sumiria com a ficha na
  Lixeira; sem a declaração, TODA restauração recusa. Pinos
  `anotacao-com-anexos-1102.test.ts` e `lixeira-1097.test.ts`.
- ⚠️⚠️ **No armazenamento, `notas/` tem regra própria** (as policies da 954
  refeitas na 1102): gravar, todo membro ativo (D6, `canWriteNotes`); TROCAR,
  ninguém pelo navegador; APAGAR, só o arquivo que a própria pessoa subiu
  (`owner_id`). Recriar as policies do `chat-media` sem isso reabre a porta
  (o pino lê a ÚLTIMA definição do replay).
- ⚠️⚠️ **A caixa sobe SÓ ao Salvar, um por um, com progresso, e leva a
  conversa de ORIGEM** até o fim (no fio ela fecha na troca e o salvar segue
  sozinho; por isso, salvando, Cancelar e Esc não fecham a caixa). Falha:
  para, mantém texto e arquivos, e o que subiu não sobe de
  novo (`caminho` no item). Desistir (tirar da lista, Cancelar, a caixa
  sumir) apaga o que a pessoa subiu; o que virou anotação, nunca — a lista
  zera ANTES de fechar. POST sem resposta (rede) PODE ter salvo: aqueles
  caminhos ficam incertos e a caixa nunca os apaga.
- ⚠️ **Um funil para clipe, colar, arrastar e gravar** (`escolherAnexosDaNota`:
  tipo de `MIMES_DA_ANOTACAO`, 50 MiB por arquivo — A7 —, 10 por anotação,
  cada recusa com aviso), com `arquivoParaEnviar` antes. ⚠️ O arrastar dá
  `stopPropagation`: a caixa mora DENTRO do compositor, e o arquivo viraria
  anexo de mensagem ao cliente. O `.html` entra (a anotação não vai à Meta)
  e só BAIXA.
- ⚠️ **Gravador PRÓPRIO** (`useGravadorDeVoz`, cópia do opus-recorder do
  compositor do upstream, 5 min): o desmonte da caixa descarta a gravação e
  solta o microfone, e o pedido de permissão que volta depois do desmonte o
  fecha na hora (geração). O teto para no tique do relógio, nunca por efeito.
- ⚠️ **A caixa é da conversa em que NASCEU** (`de`): no fio ela não remonta, e
  no render da troca o rascunho apareceria sob o cabeçalho de outro cliente.
- **Mostrar: `<AnexosDaNota>` no fio, nas abas e na ficha de `/contatos` (A6:
  lá só mostra; a caixa de lá segue só texto); `<ResumoDosAnexos>` na faixa
  fixada e na citação.** Pino default-deny `anexos-da-nota.chamadores.test.ts`:
  quem lê `nota.texto` desenha um dos dois. Áudio no `PlayerDeAudio` sem
  transcrição (D4; `corHerdada` na nota âmbar); imagem e vídeo em miniatura que
  abre o visualizador por portal; documento no cartão com o selo. Fora da aba
  Arquivos (D5).
- **O aviso (sino e pop-up) leva o resumo no corpo** (`corpoDoAviso`: "@Ana
  confere · 🎤 Áudio"), cru como o título.
- **API v1**: `GET /notes` traz `anexos` (`nome`, `tipo`, `tamanho`, `url`) e
  `editada_em`; o `POST` segue só texto. Doc em `docs/public-api.md`.
