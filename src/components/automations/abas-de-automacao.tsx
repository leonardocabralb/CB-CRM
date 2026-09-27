"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, FolderCog, Loader2, Plus, Trash2 } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import {
  ABA_GERAL,
  TETO_DO_NOME_DA_AREA,
  lerNomeDaArea,
  moverArea,
  type AreaDeAutomacao,
} from "@/lib/automations/areas"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

// ============================================================
// As ABAS da tela de Automações (1055): a barra e o diálogo que as gerencia.
// Só organizam a lista — ver `src/lib/automations/areas.ts`.
// ============================================================

type Tradutor = ReturnType<typeof useTranslations>

function Aba({
  ativa,
  rotulo,
  contagem,
  onClick,
}: {
  ativa: boolean
  rotulo: string
  contagem: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativa}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        ativa
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      <span className="max-w-[12rem] truncate">{rotulo}</span>
      <span className={cn("tabular-nums", ativa ? "opacity-90" : "opacity-70")}>{contagem}</span>
    </button>
  )
}

/**
 * A barra de abas. `aba = null` = "Todas". As contagens incluem as abas
 * vazias: aba criada e ainda sem automação precisa aparecer, senão quem
 * acabou de criá-la acha que não salvou.
 */
export function BarraDeAbas({
  areas,
  contagem,
  total,
  aba,
  onAba,
  podeGerenciar,
  onGerenciar,
}: {
  areas: AreaDeAutomacao[]
  contagem: Map<string, number>
  total: number
  aba: string | null
  onAba: (aba: string | null) => void
  podeGerenciar: boolean
  onGerenciar: () => void
}) {
  const t = useTranslations("Automations.list.abas")
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Aba ativa={aba === null} rotulo={t("todas")} contagem={total} onClick={() => onAba(null)} />
      <Aba
        ativa={aba === ABA_GERAL}
        rotulo={t("geral")}
        contagem={contagem.get(ABA_GERAL) ?? 0}
        onClick={() => onAba(ABA_GERAL)}
      />
      {areas.map((a) => (
        <Aba
          key={a.id}
          ativa={aba === a.id}
          rotulo={a.nome}
          contagem={contagem.get(a.id) ?? 0}
          onClick={() => onAba(a.id)}
        />
      ))}
      {podeGerenciar && (
        <button
          type="button"
          onClick={onGerenciar}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("gerenciar")}
        </button>
      )}
    </div>
  )
}

/** Traduz o erro do banco numa frase. */
function mensagemDoErro(t: Tradutor, erro: { code?: string } | null, linhas: number): string | null {
  if (erro?.code === "23505") return t("erros.repetido")
  if (erro?.code === "42501") return t("erros.semPermissao")
  if (erro) return t("erros.falhou")
  // RLS que barra UPDATE/DELETE devolve 0 linhas SEM erro.
  if (linhas === 0) return t("erros.semPermissao")
  return null
}

/**
 * Criar, renomear, reordenar e apagar abas. Escreve direto sob RLS (a policy
 * da 1055 exige admin) e confere as LINHAS de toda escrita. Apagar devolve
 * as automações da aba para "Geral" — é o `ON DELETE SET NULL` da FK, e a
 * pergunta diz quantas.
 */
export function GerenciarAbasDialog({
  open,
  onOpenChange,
  areas,
  contagem,
  accountId,
  onMudou,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  areas: AreaDeAutomacao[]
  contagem: Map<string, number>
  accountId: string | null
  onMudou: () => Promise<void>
}) {
  const t = useTranslations("Automations.list.abas")
  const [nova, setNova] = useState("")
  const [erroNova, setErroNova] = useState<string | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [ocupado, setOcupado] = useState(false)
  const [apagando, setApagando] = useState<AreaDeAutomacao | null>(null)

  const erroDoNome = (motivo: "vazio" | "longo" | "reservado" | "repetido") =>
    t(`erros.${motivo}`, { max: TETO_DO_NOME_DA_AREA })

  async function criar() {
    const lido = lerNomeDaArea(nova, areas)
    if (!lido.ok) {
      setErroNova(erroDoNome(lido.motivo))
      return
    }
    if (!accountId) {
      setErroNova(t("erros.falhou"))
      return
    }
    setOcupado(true)
    const posicao = areas.length > 0 ? Math.max(...areas.map((a) => a.posicao)) + 1 : 0
    const { data, error } = await createClient()
      .from("cb_areas_de_automacao")
      .insert({ account_id: accountId, nome: lido.nome, posicao })
      .select("id")
    const erro = mensagemDoErro(t, error, data?.length ?? 0)
    if (erro) {
      setErroNova(erro)
      setOcupado(false)
      return
    }
    setNova("")
    setErroNova(null)
    await onMudou()
    setOcupado(false)
    toast.success(t("criada", { nome: lido.nome }))
  }

  async function renomear(area: AreaDeAutomacao) {
    const digitado = rascunhos[area.id]
    if (digitado === undefined) return
    const descartar = () =>
      setRascunhos((r) => {
        const resto = { ...r }
        delete resto[area.id]
        return resto
      })
    if (digitado.replace(/\s+/g, " ").trim() === area.nome) {
      descartar()
      return
    }
    const lido = lerNomeDaArea(digitado, areas, area.id)
    if (!lido.ok) {
      toast.error(erroDoNome(lido.motivo))
      descartar()
      return
    }
    setOcupado(true)
    const { data, error } = await createClient()
      .from("cb_areas_de_automacao")
      .update({ nome: lido.nome })
      .eq("id", area.id)
      .select("id")
    const erro = mensagemDoErro(t, error, data?.length ?? 0)
    descartar()
    if (erro) toast.error(erro)
    else toast.success(t("renomeada"))
    await onMudou()
    setOcupado(false)
  }

  async function mover(area: AreaDeAutomacao, delta: -1 | 1) {
    const reordenadas = moverArea(areas, area.id, delta)
    if (!reordenadas) return
    const antes = new Map(areas.map((a) => [a.id, a.posicao]))
    const mudaram = reordenadas.filter((a) => antes.get(a.id) !== a.posicao)
    setOcupado(true)
    const supabase = createClient()
    const respostas = await Promise.all(
      mudaram.map((a) =>
        supabase.from("cb_areas_de_automacao").update({ posicao: a.posicao }).eq("id", a.id).select("id"),
      ),
    )
    const falha = respostas
      .map((r) => mensagemDoErro(t, r.error, r.data?.length ?? 0))
      .find((m) => m !== null)
    if (falha) toast.error(falha)
    await onMudou()
    setOcupado(false)
  }

  async function apagar(area: AreaDeAutomacao) {
    setOcupado(true)
    const { data, error } = await createClient()
      .from("cb_areas_de_automacao")
      .delete()
      .eq("id", area.id)
      .select("id")
    const erro = mensagemDoErro(t, error, data?.length ?? 0)
    setApagando(null)
    if (erro) toast.error(erro)
    else toast.success(t("apagada", { nome: area.nome }))
    await onMudou()
    setOcupado(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setApagando(null)
          setErroNova(null)
          setRascunhos({})
        }
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderCog className="h-4 w-4" />
            {t("dialogoTitulo")}
          </DialogTitle>
          <DialogDescription>{t("dialogoDescricao")}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <form
            className="space-y-1"
            onSubmit={(e) => {
              e.preventDefault()
              void criar()
            }}
          >
            <div className="flex gap-2">
              <input
                value={nova}
                onChange={(e) => {
                  setNova(e.target.value)
                  setErroNova(null)
                }}
                maxLength={TETO_DO_NOME_DA_AREA + 10}
                placeholder={t("novaPlaceholder")}
                aria-label={t("novaPlaceholder")}
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground"
              />
              <Button type="submit" disabled={ocupado || !nova.trim()} size="sm" className="h-9">
                {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t("adicionar")}
              </Button>
            </div>
            {erroNova && <p className="text-xs text-red-700 dark:text-red-300">{erroNova}</p>}
          </form>

          <ul className="divide-y divide-border rounded-lg border border-border">
            <li className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-foreground">{t("geral")}</span>
              <span className="text-xs text-muted-foreground">{t("fixa")}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {contagem.get(ABA_GERAL) ?? 0}
              </span>
            </li>
            {areas.map((a, i) =>
              apagando?.id === a.id ? (
                <li key={a.id} className="space-y-2 bg-muted/40 px-3 py-2 text-sm">
                  <p className="text-foreground">
                    {t("confirmarApagar", { nome: a.nome, count: contagem.get(a.id) ?? 0 })}
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setApagando(null)} disabled={ocupado}>
                      {t("cancelar")}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => apagar(a)} disabled={ocupado}>
                      {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      {t("apagar")}
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={a.id} className="flex items-center gap-1.5 px-3 py-1.5 text-sm">
                  <input
                    value={rascunhos[a.id] ?? a.nome}
                    onChange={(e) => setRascunhos((r) => ({ ...r, [a.id]: e.target.value }))}
                    onBlur={() => void renomear(a)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        e.currentTarget.blur()
                      }
                    }}
                    maxLength={TETO_DO_NOME_DA_AREA + 10}
                    aria-label={t("renomearAria", { nome: a.nome })}
                    disabled={ocupado}
                    className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm text-foreground hover:border-border focus:border-border focus:bg-background focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => mover(a, -1)}
                    disabled={ocupado || i === 0}
                    aria-label={t("antes", { nome: a.nome })}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => mover(a, 1)}
                    disabled={ocupado || i === areas.length - 1}
                    aria-label={t("depois", { nome: a.nome })}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                    {contagem.get(a.id) ?? 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => setApagando(a)}
                    disabled={ocupado}
                    aria-label={t("apagarAria", { nome: a.nome })}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ),
            )}
          </ul>
          {areas.length === 0 && <p className="text-xs text-muted-foreground">{t("nenhuma")}</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
