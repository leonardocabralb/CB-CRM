"use client"

/**
 * O campo de texto das automações que mostra cada `{{código}}` como ETIQUETA
 * com o nome do campo e o código juntos (decisão D1 do operador, 29/09/2026 —
 * `docs/PLANO-seletor-de-variaveis.md`).
 *
 * ⚠️⚠️ O TEXTO NÃO MUDA. O documento do CodeMirror É a string gravada, sem
 * conversão ida e volta: a etiqueta é uma decoração que SUBSTITUI o código só
 * na tela (`Decoration.replace`), e `atomicRanges` faz o cursor e o apagar
 * tratarem o código como uma peça. Copiar leva o código; desfazer é o do
 * editor; acento por tecla morta (composição) é tratado por ele. Por isso não
 * é um `contenteditable` nosso: é nele que texto de mensagem se corrompe.
 *
 * ⚠️⚠️ Nada é emitido sem o operador mexer. O valor que muda POR FORA (modelo
 * trocado, outro passo) entra por `view.setState` — que não passa pelos
 * ouvintes, então não volta como `onChange`, e zera o desfazer (senão Ctrl+Z
 * devolveria o texto do modelo anterior). E o render ATRASADO de algo que o
 * próprio editor emitiu é reconhecido como eco (`decidirSincronia`): sem isso,
 * o efeito de um render velho que roda depois de uma tecla nova reverteria o
 * documento (input fora de evento discreto: EditContext no Android, composição
 * no iOS). As peças puras têm pino em `editor-com-etiquetas.test.ts`; a
 * montagem, que precisa de DOM, foi conferida no preview.
 *
 * A etiqueta sai da MESMA régua do motor (`FONTE_DO_CODIGO`): o que não casa
 * fica texto, como no envio.
 */

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from "react"
import { history, historyKeymap, insertNewline, standardKeymap } from "@codemirror/commands"
import {
  Compartment,
  EditorSelection,
  EditorState,
  Facet,
  StateField,
  Transaction,
  type Extension,
} from "@codemirror/state"
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  placeholder as extensaoDoPlaceholder,
  type DecorationSet,
} from "@codemirror/view"

import { FONTE_MONO } from "@/components/settings/copiar"
import { FONTE_DO_CODIGO } from "@/lib/automations/variaveis/codigos"
import { cn } from "@/lib/utils"

/** O que a etiqueta de um código mostra. */
export interface InfoDaEtiqueta {
  /** O nome do campo; `null` = só o código (lista ainda carregando). */
  rotulo: string | null
  legenda?: string | null
  /** Preenchido = etiqueta ÂMBAR, com o motivo no título. */
  alerta?: string | null
}

export type ResolverDeEtiqueta = (codigo: string) => InfoDaEtiqueta

export interface EditorComEtiquetasApi {
  /** Escreve no cursor; sem o operador ter clicado no campo ainda, no FIM. */
  inserir: (texto: string) => void
}

const SEM_NOME: ResolverDeEtiqueta = () => ({ rotulo: null })

const resolverDaEtiqueta = Facet.define<ResolverDeEtiqueta, ResolverDeEtiqueta>({
  combine: (valores) => valores[valores.length - 1] ?? SEM_NOME,
})

/**
 * O valor que chegou por props precisa ENTRAR no editor? Puro, com pino.
 *
 * - igual ao documento: nada (e o que foi emitido está reconhecido);
 * - algo que o próprio editor emitiu e a tela ainda não alcançou: é ECO de um
 *   render atrasado — trocar reverteria a tecla digitada no intervalo;
 * - qualquer outro: veio de FORA e entra.
 */
export function decidirSincronia(
  doc: string,
  valor: string,
  emitidos: readonly string[],
): { trocar: boolean; emitidos: string[] } {
  if (doc === valor) return { trocar: false, emitidos: [] }
  const eco = emitidos.lastIndexOf(valor)
  if (eco >= 0) return { trocar: false, emitidos: emitidos.slice(eco + 1) }
  return { trocar: true, emitidos: [] }
}

/**
 * Campo de UMA linha (título, valor de modelo): Enter não quebra, e o que
 * chega colado com quebra de linha vira espaço. ⚠️ Recusa só a transação que
 * AUMENTA as linhas — um valor antigo que já tenha quebra continua editável.
 * (O valor que muda por fora entra por `setState`, que não passa por filtro.)
 */
export const umaLinha: Extension = [
  EditorView.clipboardInputFilter.of((texto) => texto.replace(/\r\n|\r|\n/g, " ")),
  EditorState.transactionFilter.of((tr) =>
    tr.docChanged && tr.newDoc.lines > tr.startState.doc.lines ? [] : tr,
  ),
]

/** Texto COLADO entra sem `\r`; o `\r` que já estava no texto fica (ver `montarEstado`). */
const colarSemRetorno: Extension = EditorView.clipboardInputFilter.of((texto) => texto.replace(/\r\n?/g, "\n"))

const CLASSE_ETIQUETA =
  "rounded-md px-1 py-px ring-1 ring-inset [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
const CLASSE_CONHECIDA = "bg-primary/10 text-primary ring-primary/25"
// ⚠️ `amber-700` vale nos dois modos: o `dark:` está inerte (ui.md).
const CLASSE_ALERTA = "bg-amber-500/15 text-amber-700 ring-amber-600/30 dark:text-amber-300"

class Etiqueta extends WidgetType {
  constructor(
    readonly bruto: string,
    readonly info: InfoDaEtiqueta,
  ) {
    super()
  }

  eq(outra: Etiqueta): boolean {
    return (
      outra.bruto === this.bruto &&
      outra.info.rotulo === this.info.rotulo &&
      (outra.info.legenda ?? null) === (this.info.legenda ?? null) &&
      (outra.info.alerta ?? null) === (this.info.alerta ?? null)
    )
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span")
    el.className = cn(CLASSE_ETIQUETA, this.info.alerta ? CLASSE_ALERTA : CLASSE_CONHECIDA)
    el.dataset.variavel = this.bruto
    el.title = [this.info.rotulo, this.bruto, this.info.legenda, this.info.alerta].filter(Boolean).join("\n")
    if (this.info.rotulo) {
      el.append(this.info.rotulo, " ")
    }
    const codigo = document.createElement("span")
    codigo.className = "text-[10px] opacity-75"
    codigo.style.fontFamily = FONTE_MONO
    codigo.textContent = this.bruto
    el.append(codigo)
    return el
  }

  ignoreEvent(): boolean {
    return false
  }
}

function montarEtiquetas(state: EditorState): DecorationSet {
  const resolver = state.facet(resolverDaEtiqueta)
  const texto = state.doc.toString()
  const faixas = []
  for (const m of texto.matchAll(new RegExp(FONTE_DO_CODIGO, "g"))) {
    const de = m.index ?? 0
    faixas.push(
      Decoration.replace({ widget: new Etiqueta(m[0], resolver(m[1])) }).range(de, de + m[0].length),
    )
  }
  return Decoration.set(faixas)
}

/**
 * As etiquetas por CAMPO DE ESTADO, não por plugin: decoração que substitui
 * texto com quebra de linha dentro (`{{\n now }}` casa na régua do motor) só é
 * aceita vinda de um campo. Recalcula a cada mudança — texto de automação é
 * curto — e quando o resolvedor muda (a lista de campos chegou).
 */
const etiquetas = StateField.define<DecorationSet>({
  create: montarEtiquetas,
  update(atual, tr) {
    return tr.docChanged || tr.startState.facet(resolverDaEtiqueta) !== tr.state.facet(resolverDaEtiqueta)
      ? montarEtiquetas(tr.state)
      : atual
  },
  provide: (campo) => [
    EditorView.decorations.from(campo),
    EditorView.atomicRanges.of((view) => view.state.field(campo)),
  ],
})

/** As etiquetas do estado — `[de, até, código como escrito, nome]` —, para o pino. */
export function etiquetasDoEstado(state: EditorState): [number, number, string, string | null][] {
  const lista: [number, number, string, string | null][] = []
  state.field(etiquetas).between(0, state.doc.length, (de, ate, deco) => {
    const w = deco.spec.widget as Etiqueta
    lista.push([de, ate, w.bruto, w.info.rotulo])
  })
  return lista
}

const tema = EditorView.theme({
  "&": { backgroundColor: "transparent", fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.5" },
  ".cm-content": { padding: "0", caretColor: "currentColor" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--muted-foreground)" },
})

export interface OpcoesDoEstado {
  resolver: ResolverDeEtiqueta
  compartimento: Compartment
  linhaUnica?: boolean
  placeholder?: string
  ariaLabel?: string
  /** Cada mudança de texto feita NO editor (tecla, colar, desfazer, inserir). */
  aoMudar?: (texto: string) => void
  /**
   * O operador pôs a mão no campo: foco, ou qualquer seleção/edição dele. Pelos
   * DOIS caminhos porque o evento de foco nem sempre chega (janela sem foco
   * do sistema), e a seleção de um clique sempre vem marcada como do usuário.
   */
  aoTocar?: () => void
}

/** O estado inteiro do editor para um texto. Puro, com pino. */
export function montarEstado(doc: string, o: OpcoesDoEstado): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      // ⚠️ Só "\n" separa linhas: por padrão o CodeMirror também separa em
      // "\r\n" e "\r", e o `toString()` devolveria "\n" — a primeira tecla em
      // qualquer ponto regravaria o texto inteiro sem os `\r`.
      EditorState.lineSeparator.of("\n"),
      history(),
      keymap.of([
        // Shift+Enter também: sem ele caía no `insertNewlineAndIndent` do
        // `standardKeymap`, que apaga os espaços depois do cursor e copia o
        // recuo da linha — comportamento de editor de código.
        o.linhaUnica
          ? { key: "Enter", run: () => true, shift: () => true }
          : { key: "Enter", run: insertNewline, shift: insertNewline },
        ...standardKeymap,
        ...historyKeymap,
      ]),
      // Quebra de EXIBIÇÃO também no campo de uma linha: a etiqueta (nome +
      // código) passa da largura do cartão, e sem isto aparecia uma barra de
      // rolagem horizontal. O texto continua com uma linha só.
      EditorView.lineWrapping,
      o.linhaUnica ? umaLinha : colarSemRetorno,
      o.placeholder ? extensaoDoPlaceholder(o.placeholder) : [],
      EditorView.contentAttributes.of({
        "aria-label": o.ariaLabel ?? "",
        "aria-multiline": o.linhaUnica ? "false" : "true",
        spellcheck: "true",
        autocorrect: "on",
        autocapitalize: "sentences",
      }),
      EditorView.domEventHandlers({
        focus: () => {
          o.aoTocar?.()
        },
      }),
      // `setState` (o valor de fora) não passa por aqui: só o que foi feito
      // no editor avisa a tela.
      EditorView.updateListener.of((u) => {
        if (u.transactions.some((tr) => tr.annotation(Transaction.userEvent) !== undefined)) o.aoTocar?.()
        if (u.docChanged) o.aoMudar?.(u.state.doc.toString())
      }),
      o.compartimento.of(resolverDaEtiqueta.of(o.resolver)),
      etiquetas,
      tema,
    ],
  })
}

/**
 * O valor como TEXTO para o editor. Todo campo trocado guarda string (medido
 * em produção, 29/09/2026), mas um passo gravado por fora com número não pode
 * derrubar o construtor. Só para EXIBIR: sem o operador editar, nada é
 * emitido e o valor gravado continua o que era.
 */
export function comoTexto(valor: unknown): string {
  return typeof valor === "string" ? valor : valor === null || valor === undefined ? "" : String(valor)
}

/** Teto da fila de ecos: um pai que nunca devolve o valor não a faz crescer para sempre. */
const MAX_EMITIDOS = 100

export function EditorComEtiquetas({
  value,
  onChange,
  resolver,
  placeholder,
  ariaLabel,
  linhaUnica = false,
  monoespacado = false,
  className,
  ref,
}: {
  value: string
  onChange: (texto: string) => void
  resolver: ResolverDeEtiqueta
  placeholder?: string
  ariaLabel: string
  linhaUnica?: boolean
  /** A classe `font-mono` sai na Inter (ui.md): a fonte vai por estilo. */
  monoespacado?: boolean
  className?: string
  ref?: Ref<EditorComEtiquetasApi>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [compartimento] = useState(() => new Compartment())
  // Sem o operador ter clicado no campo, a seleção do CodeMirror está no
  // início: inserir ali poria o código antes do "Olá". Até o primeiro foco,
  // o "Inserir campo" escreve no FIM.
  const tocado = useRef(false)
  // O que o editor emitiu e a tela ainda não devolveu (ver `decidirSincronia`).
  const emitidos = useRef<string[]>([])

  const avisar = useEffectEvent((texto: string) => onChange(texto))
  // Lê as props do render MAIS RECENTE: o editor nasce uma vez e é
  // reconstruído (setState) só quando o valor muda por fora.
  const criarEstado = useEffectEvent((doc: string) =>
    montarEstado(doc, {
      resolver,
      compartimento,
      linhaUnica,
      placeholder,
      ariaLabel,
      aoMudar: (texto) => {
        emitidos.current.push(texto)
        if (emitidos.current.length > MAX_EMITIDOS) emitidos.current.shift()
        avisar(texto)
      },
      aoTocar: () => {
        tocado.current = true
      },
    }),
  )
  const valorAtual = useEffectEvent(() => comoTexto(value))

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({ parent: host, state: criarEstado(valorAtual()) })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [compartimento])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const texto = comoTexto(value)
    const decisao = decidirSincronia(view.state.doc.toString(), texto, emitidos.current)
    emitidos.current = decisao.emitidos
    if (decisao.trocar) view.setState(criarEstado(texto))
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartimento.reconfigure(resolverDaEtiqueta.of(resolver)) })
  }, [resolver, compartimento])

  useImperativeHandle(
    ref,
    () => ({
      inserir(texto: string) {
        const view = viewRef.current
        if (!view) return
        const { state } = view
        const alvo = tocado.current ? state.selection.main : EditorSelection.cursor(state.doc.length)
        view.dispatch({
          changes: { from: alvo.from, to: alvo.to, insert: texto },
          selection: EditorSelection.cursor(alvo.from + texto.length),
          scrollIntoView: true,
          userEvent: "input.variavel",
        })
        view.focus()
      },
    }),
    [],
  )

  return (
    <div
      ref={hostRef}
      className={cn(
        "w-full cursor-text rounded-lg border border-input bg-muted px-2.5 py-2 text-base text-foreground transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 md:text-sm",
        linhaUnica ? "min-h-9" : "[&_.cm-content]:min-h-[4.5em]",
        monoespacado && "text-xs md:text-xs",
        className,
      )}
      style={monoespacado ? { fontFamily: FONTE_MONO } : undefined}
      onMouseDown={(e) => {
        // Clique no respiro em volta do texto (o padding do contêiner) põe o
        // cursor no fim, como na caixa de texto de antes.
        if (e.target === hostRef.current) {
          e.preventDefault()
          const view = viewRef.current
          if (!view) return
          view.focus()
          view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) })
        }
      }}
    />
  )
}
