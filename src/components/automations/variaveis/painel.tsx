"use client"

/**
 * O botão "Inserir campo" e o painel dele: busca, grupos que abrem e fecham
 * (como o seletor da Make, pedido do operador em 29/09/2026), e em cada item
 * o nome, o código, a legenda e o valor do cliente da prévia. Clicar devolve
 * o código a quem abriu — quem escreve no texto é o editor.
 */

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Braces, ChevronDown, ChevronRight } from "lucide-react"

import { FONTE_MONO } from "@/components/settings/copiar"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import { useVariaveis, type GrupoDoPainel, type ModoDoValor, type ValorParaMostrar } from "./contexto"

/** Minúsculas e sem acento: "credito" acha "Crédito". */
function paraBusca(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}

function filtrar(grupos: GrupoDoPainel[], termo: string): GrupoDoPainel[] {
  const alvo = paraBusca(termo.trim())
  if (!alvo) return grupos
  return grupos
    .map((g) => ({
      ...g,
      itens: g.itens.filter((i) =>
        paraBusca(`${i.rotulo} ${i.codigo} ${i.legenda ?? ""} ${g.titulo}`).includes(alvo),
      ),
    }))
    .filter((g) => g.itens.length > 0)
}

export function BotaoInserirCampo({
  onEscolher,
  modo,
}: {
  onEscolher: (codigo: string) => void
  modo: ModoDoValor
}) {
  const t = useTranslations("Automations.variaveis")
  const v = useVariaveis()
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState("")
  const [fechados, setFechados] = useState<ReadonlySet<string>>(() => new Set())
  const visiveis = useMemo(() => filtrar(v.grupos, termo), [v.grupos, termo])
  const buscando = termo.trim() !== ""

  const escolher = (codigo: string) => {
    setAberto(false)
    onEscolher(codigo)
  }

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o)
        // A busca nasce limpa a cada abertura.
        if (o) setTermo("")
      }}
    >
      <PopoverTrigger
        aria-label={t("inserirAria")}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Braces className="size-3.5 text-primary" aria-hidden />
        {t("inserir")}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-1.5 p-2">
        <Input
          autoFocus
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder={t("buscar")}
          className="h-8"
          onKeyDown={(e) => {
            // Enter pega o PRIMEIRO resultado da BUSCA: digitou o bastante para
            // sobrar um. Sem nada digitado, Enter não insere nada — o primeiro
            // item da lista inteira não é escolha de ninguém.
            if (e.key === "Enter") {
              e.preventDefault()
              const primeiro = buscando ? visiveis[0]?.itens[0] : undefined
              if (primeiro) escolher(primeiro.codigo)
            }
          }}
        />
        {v.podePrevia && (
          <p className={cn("px-1 text-[11px]", v.previa === "falhou" ? "text-destructive" : "text-muted-foreground")}>
            {v.previa === "sem-cliente"
              ? t("previa.semValores")
              : v.previa === "carregando"
                ? t("previa.calculando")
                : v.previa === "falhou"
                  ? t("previa.falhou")
                  : v.nomeDaPrevia
                    ? t("previa.valoresDe", { nome: v.nomeDaPrevia })
                    : t("previa.valoresDoCliente")}
          </p>
        )}
        <div className="-mx-1 max-h-[min(26rem,60vh)] overflow-y-auto px-1">
          {visiveis.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t("nenhum")}</p>
          ) : (
            visiveis.map((g) => {
              const fechado = !buscando && fechados.has(g.id)
              return (
                <div key={g.id} className="mb-1">
                  <button
                    type="button"
                    onClick={() =>
                      setFechados((atual) => {
                        const novo = new Set(atual)
                        if (novo.has(g.id)) novo.delete(g.id)
                        else novo.add(g.id)
                        return novo
                      })
                    }
                    aria-expanded={!fechado}
                    className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    {fechado ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
                    <span className="min-w-0 truncate">{g.titulo}</span>
                    <span className="ml-auto font-normal">{g.itens.length}</span>
                  </button>
                  {!fechado &&
                    g.itens.map((item) => (
                      <button
                        key={item.codigo}
                        type="button"
                        onClick={() => escolher(item.codigo)}
                        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm leading-tight text-foreground">{item.rotulo}</span>
                          <span className="block truncate text-[10px] text-primary" style={{ fontFamily: FONTE_MONO }}>
                            {`{{${item.codigo}}}`}
                          </span>
                          {item.legenda && (
                            <span className="block text-[11px] leading-snug text-muted-foreground">{item.legenda}</span>
                          )}
                        </span>
                        <ValorDoItem valor={v.valorDe(item.codigo, modo)} t={t} />
                      </button>
                    ))}
                </div>
              )
            })
          )}
          {v.camposEstado === "carregando" && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">{t("carregando")}</p>
          )}
          {v.camposEstado === "falhou" && (
            <p className="px-2 py-1 text-[11px] text-destructive">{t("falhouCampos")}</p>
          )}
          {v.notaDoEvento && <p className="px-2 py-1 text-[11px] text-muted-foreground">{v.notaDoEvento}</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** O valor do item, à direita: do cliente, exemplo ou último acionamento. */
function ValorDoItem({
  valor,
  t,
}: {
  valor: ValorParaMostrar | null
  t: ReturnType<typeof useTranslations>
}) {
  if (!valor || valor.origem === "evento" || valor.origem === "nenhum") return null
  const vazio = valor.texto.trim() === ""
  const marca =
    valor.origem === "exemplo"
      ? t("previa.exemplo")
      : valor.origem === "ultimo"
        ? t("previa.ultimoAcionamento")
        : null
  return (
    <span className="flex max-w-[45%] shrink-0 flex-col items-end text-right">
      <span
        className={cn(
          "max-w-full truncate text-[11px]",
          vazio ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
        )}
        title={valor.texto}
      >
        {vazio ? t("previa.vazio") : valor.texto}
      </span>
      {marca && <span className="text-[10px] text-muted-foreground/80 italic">{marca}</span>}
    </span>
  )
}
