---
paths:
  - "src/components/ui/**"
  - "src/app/globals.css"
  - "src/components/settings/copiar.tsx"
  - "src/hooks/use-theme*"
---

# UI — regras

Vale ao mexer nos primitivos de `src/components/ui/`, no `globals.css`, no tema
ou em qualquer override de classe sobre um primitivo. As armadilhas de layout
abaixo passam em revisão, em typecheck e em teste: só aparecem na tela. O
`min-w-0` da coluna da lista do inbox está em `.claude/rules/inbox-lista.md`; o
compositor no celular, em `.claude/rules/inbox-conversa.md`.

### `select.tsx` divergiu do upstream — não deixar sobrescrever

- ⚠️ **O nosso `Select` deriva `items` percorrendo os próprios `<SelectItem>`
  da árvore.** Sem `items`, o `<Select.Value />` do base-ui mostra o VALOR cru
  (`openai`, `__queue__`, `keyword` na tela). Todo call site (~20) depende
  disso. Num merge, fica o nosso arquivo inteiro.
- **O wrapper repassa os genéricos `<Value, Multiple>`.** Tipado com o
  `Root.Props` não-genérico, o `onValueChange` de todo call site vira `any`
  implícito (20 erros de typecheck de uma vez).
- **A lista é memoizada por ASSINATURA, não por `children`.** `children` tem
  identidade nova a cada render, e o `store.update` do base-ui compara com
  `Object.is`: os assinantes seriam notificados à toa.
- **Rótulo JSX entra na assinatura por posição.** Rótulo complexo no gatilho
  vai como FUNÇÃO em `<SelectValue>` — é o que `channel-select.tsx` faz para
  mostrar só o nome do canal.

### Três armadilhas de layout

- ⚠️⚠️ **O tailwind-merge só desempata classes com o MESMO prefixo de
  variante.** `cn("group-data-horizontal/tabs:h-8", "h-auto")` devolve as
  DUAS, e a variante vence quando o seletor casa. Foi assim que as abas da
  ficha do contato (em `flex-wrap`, 3 linhas numa caixa de 32 px) caíram por
  cima dos campos. A cura é repetir o prefixo
  (`group-data-horizontal/tabs:h-auto`), nunca `h-auto` cru. Vale para todo
  override de classe que o primitivo declare sob variante (`group-*`,
  `data-*`, `dark:`, `sm:`). Na dúvida, meça:
  `node -e "console.log(require('tailwind-merge').twMerge('<a> <b>'))"`.
- ⚠️⚠️ **Largura do `SheetContent`: prefixe o `max-w`
  (`data-[side=right]:sm:max-w-lg`).** O `sheet.tsx` traz
  `data-[side=right]:sm:max-w-sm`, que vence o override cru por
  ESPECIFICIDADE: o painel abre com 384 px em vez de 512 px. Tela "apertada
  demais"? Desconfie da largura antes de reflowar o conteúdo.
- ⚠️ **Prefixe só o `max-w`, NUNCA o `w-full` junto.** Prefixado, o `w-full`
  vence o `data-[side=right]:w-3/4` e, abaixo de `sm`, o painel vira tela
  cheia, sem fundo para fechar tocando fora — no celular, a única saída.
- ⚠️ **São QUATRO os `SheetContent` do repo**: `contact-detail-view.tsx`,
  `pipelines/deal-form.tsx` e os DOIS de `flows/flow-canvas.tsx`. Todos com o
  `max-w` prefixado; quem criar um novo repete o padrão, senão painéis irmãos
  abrem com larguras diferentes.
- ⚠️ **`<ScrollArea>` dentro de `flex-col` precisa de `min-h-0`, sempre.**
  Filho de flex nasce com `min-height: auto` e o Root do base-ui não põe
  `overflow`: o painel CRESCE em vez de rolar, o conteúdo é cortado por um
  ancestral e nenhuma barra aparece (o base-ui esconde a nativa). O operador
  vê a informação sumir. Já mordeu na lista de conversas e nas duas barras
  laterais (contato e grupo).
- ⚠️ **Filho direto do `DialogContent` com `truncate` precisa de `min-w-0`.**
  O `DialogContent` é `grid`, e item de grid nasce com `min-width: auto`;
  `truncate` é `nowrap`, então o filho fica com a largura do texto inteiro
  (a busca do diálogo de executar automação atravessava a tela).
- ⚠️ **Filho de flex com `items-start`/`items-end` que recebe texto de fora
  precisa de `max-w-full`.** `max-width` não se herda, e `flex-start`
  dimensiona pelo conteúdo: a bolha do fio saía com 1040 px sob um pai de
  355 px, e uma URL sem espaços acendia barra horizontal na conversa inteira.
  O `break-words` não salva sem teto (a palavra sempre "cabe"). O
  `max-w-full` mora NA BOLHA (`message-bubble.tsx`).
- ⚠️ **Autosize de `<textarea>`: some a borda.** `scrollHeight` não inclui a
  borda, mas `style.height` sob `border-box` inclui: `height = scrollHeight`
  acende a barra com UMA linha. Use `el.offsetHeight - el.clientHeight`
  (medido com `height: auto`), como `message-composer.tsx` — o único autosize
  do repo.

### Tema e fontes

- ⚠️⚠️ **O `dark:` está INERTE.** O variant é `@custom-variant dark (&:is(.dark
  *))`, o modo escuro é marcado por `html[data-mode="dark"]` (`use-theme.tsx`)
  e nenhum elemento tem a classe `.dark`: `text-amber-700
  dark:text-amber-300` resolve para `amber-700` nos dois modos. Continue
  escrevendo o par claro/escuro, mas escolha a PRIMEIRA cor sabendo que ela
  vale nos dois: `amber-700` passa nos dois (4,90 no claro, 4,17 no escuro);
  `amber-500` dá 2,08 no claro, ilegível. `text-red-300` sozinho some no tema
  claro.
- ⚠️ **Consertar o variant é uma linha** (`&:is(.dark *, html[data-mode="dark"]
  *)`) e muda a cor de ~110 lugares de uma vez: decisão própria, com revisão
  de tela, nunca carona de outro PR.
- ⚠️ **A classe `font-mono` sai na INTER.** `--font-mono` aponta para
  `--font-geist-mono`, que não existe (o layout carrega só a Inter). Onde a
  monoespaçada importa (JSON, código), use `FONTE_MONO` de
  `src/components/settings/copiar.tsx`. Consertar a variável muda ~50 telas:
  decisão própria, nunca carona.
- **Classe do Tailwind é LITERAL** (`'bg-violet-500'`), nunca montada em tempo
  de execução (`bg-${cor}-500` ou `replace("stroke-", "fill-")`): o Tailwind
  varre o fonte atrás de strings, e a classe montada não é gerada — sem erro
  nenhum.
