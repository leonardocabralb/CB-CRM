---
paths:
  - "src/components/inbox/note-line.tsx"
  - "src/components/inbox/cartao-de-nota.tsx"
  - "src/components/inbox/citacao-da-nota.tsx"
  - "src/components/inbox/internal-note-box.tsx"
  - "src/components/inbox/nota-fixada-bar.tsx"
  - "src/hooks/use-apagar-nota*"
  - "src/hooks/use-conversation-notes*"
  - "src/hooks/use-fixar-nota*"
  - "src/lib/notes/**"
  - "src/app/api/cb/notes/**"
---

# Anotações internas — regras

Vale ao editar ou revisar a anotação interna nas quatro telas (o fio, a aba
Notas do painel, a do grupo e a ficha de `/contatos`), a caixa de escrever, a
fixada e a resposta à anotação. O resto da conversa (fio, compositor, links
clicáveis na nota) está em `.claude/rules/inbox-conversa.md`; o sino e o Meu
dia, em `.claude/rules/meu-dia.md`.

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
  `CartaoDeNota`: duas linhas, seta só com texto cortado de verdade, aberta
  com teto e rolagem própria). Presa e inteira, uma nota longa cobria a
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
  na conversa dela** (subindo por `resposta_de`); quem responde, nunca; quem
  foi mencionado na mesma resposta recebe só o `note_mention`. Conferido
  contra a conta, como a menção. `respostaNotificada: false` vira aviso na
  tela.
- ⚠️ **O "Responder" é estado de quem monta a caixa** (fio → compositor;
  painel e grupo → a caixa do topo da aba), carimbado com a conversa e
  comparado no render. O X da citação (e a respondida apagada, 409
  `REPLIED_NOTE_NOT_FOUND`) desfaz a citação SEM fechar a caixa: o texto fica.
