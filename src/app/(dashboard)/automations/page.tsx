"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Zap,
  Plus,
  MoreVertical,
  Copy,
  Pencil,
  Trash2,
  FileText,
  MessageCircle,
  Clock,
  Users,
  PhoneCall,
  Loader2,
  FolderInput,
  Check,
} from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { useCan } from "@/hooks/use-can"
import { useTranslations } from "next-intl"
import type { Automation } from "@/types"
import { Button } from "@/components/ui/button"
import { GatedButton } from "@/components/ui/gated-button"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import { ChannelScopeBadge } from "@/components/channels/channel-badge"
import { ChannelFilter } from "@/components/channels/channel-filter"
import { useChannels } from "@/hooks/use-channels"
import type { CbChannel } from "@/lib/cb-channels/repo"
import { TRIGGER_META, triggerMeta, formatRelative } from "@/lib/automations/trigger-meta"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { useAreasDeAutomacao } from "@/hooks/use-areas-de-automacao"
import { ABA_GERAL, abaDaAutomacao, contarPorAba, type AreaDeAutomacao } from "@/lib/automations/areas"
import { BarraDeAbas, GerenciarAbasDialog } from "@/components/automations/abas-de-automacao"

// A aba escolhida fica lembrada NESTE aparelho (conveniência de quem usa;
// storage que falha só volta para "Todas").
const CHAVE_DA_ABA = "cb-automacoes-aba"

function lerAbaGuardada(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(CHAVE_DA_ABA)
  } catch {
    return null
  }
}

function guardarAba(aba: string | null) {
  try {
    if (aba) window.localStorage.setItem(CHAVE_DA_ABA, aba)
    else window.localStorage.removeItem(CHAVE_DA_ABA)
  } catch {
    // sem storage, a aba só não é lembrada
  }
}

const TEMPLATE_ORDER: TemplateSlug[] = [
  "welcome_message",
  "out_of_office",
  "lead_qualifier",
  "follow_up_reminder",
]

const TEMPLATE_ICON: Record<TemplateSlug, typeof Zap> = {
  welcome_message: MessageCircle,
  out_of_office: Clock,
  lead_qualifier: Users,
  follow_up_reminder: PhoneCall,
}

export default function AutomationsPage() {
  const router = useRouter()
  const canCreate = useCan("manage-automations")
  const t = useTranslations("Automations.list")
  const tCanais = useTranslations("Channels")
  const [automations, setAutomations] = useState<Automation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Automation | null>(null)
  const [deleting, setDeleting] = useState(false)
  const { channels } = useChannels()
  // Filtro por canal. `null` = todas. Uma automação SEM escopo vale para
  // todos os números, então ela aparece em qualquer filtro — esconder a
  // regra que dispara em todo lugar seria a leitura mais perigosa da tela.
  const [filtroCanal, setFiltroCanal] = useState<string | null>(null)
  const tAbas = useTranslations("Automations.list.abas")
  const { accountId } = useAuth()
  const { areas, falhou: abasFalharam, recarregar: recarregarAbas } = useAreasDeAutomacao()
  // `null` = "Todas". Lida uma vez (a primeira renderização é o spinner, então
  // o servidor e o navegador desenham a mesma coisa).
  const [aba, setAba] = useState<string | null>(lerAbaGuardada)
  const [gerenciando, setGerenciando] = useState(false)

  function escolherAba(nova: string | null) {
    setAba(nova)
    guardarAba(nova)
  }

  async function load() {
    try {
      const supabase = createClient()
      const { data, error: fetchErr } = await supabase
        .from("automations")
        .select("*")
        .order("created_at", { ascending: false })
      if (fetchErr) throw fetchErr
      setAutomations((data ?? []) as Automation[])
    } catch (err) {
      // "" = falhou sem mensagem: o texto traduzido entra no render, e o
      // `load` fica sem `t` (senão o efeito de montagem pede `load` nas deps).
      setError(err instanceof Error && err.message ? err.message : "")
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function toggleActive(a: Automation, next: boolean) {
    // Optimistic flip so the switch feels instant.
    setAutomations((prev) =>
      prev?.map((x) => (x.id === a.id ? { ...x, is_active: next } : x)) ?? prev,
    )
    const res = await fetch(`/api/automations/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    })
    if (!res.ok) {
      // Roll back on error.
      setAutomations((prev) =>
        prev?.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x)) ?? prev,
      )
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.updateError"))
      return
    }
    toast.success(next ? t("toasts.activated") : t("toasts.paused"))
  }

  async function duplicate(a: Automation) {
    const res = await fetch(`/api/automations/${a.id}/duplicate`, { method: "POST" })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.duplicateError"))
      return
    }
    toast.success(t("toasts.duplicated"))
    load()
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    const res = await fetch(`/api/automations/${pendingDelete.id}`, { method: "DELETE" })
    setDeleting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toasts.deleteError"))
      // 404 = já não existe nesta conta (outra pessoa apagou com a lista
      // aberta): fecha o diálogo e recarrega, senão o cartão fantasma fica.
      if (res.status === 404) {
        setPendingDelete(null)
        load()
      }
      return
    }
    toast.success(t("toasts.deleted"))
    setPendingDelete(null)
    load()
  }

  async function moverParaAba(a: Automation, areaId: string | null) {
    const antes = a.area_id ?? null
    if (antes === areaId) return
    setAutomations(
      (prev) => prev?.map((x) => (x.id === a.id ? { ...x, area_id: areaId } : x)) ?? prev,
    )
    const res = await fetch(`/api/automations/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area_id: areaId }),
    })
    if (!res.ok) {
      setAutomations(
        (prev) => prev?.map((x) => (x.id === a.id ? { ...x, area_id: antes } : x)) ?? prev,
      )
      toast.error(tAbas("erros.mover"))
      // A aba pode ter sido apagada com a tela aberta: relê as duas listas.
      void recarregarAbas()
      return
    }
    const nome = areaId ? areas?.find((x) => x.id === areaId)?.nome ?? "" : tAbas("geral")
    toast.success(tAbas("movida", { aba: nome }))
  }

  async function startFromTemplate(slug: TemplateSlug) {
    router.push(`/automations/new?template=${slug}`)
  }

  if (error !== null) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error || t("loadError")}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </div>
    )
  }

  if (automations === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const noCanal = filtroCanal
    ? automations.filter((a) => {
        const escopo = a.channel_ids
        return !escopo || escopo.length === 0 || escopo.includes(filtroCanal)
      })
    : automations
  // As abas só entram com a lista delas LIDA: sem ela, toda automação cairia
  // em "Geral" por um instante (ver `useAreasDeAutomacao`). Até lá, e se a
  // leitura falhar, a lista é a de sempre, sem abas.
  const abas = areas
  const idsDasAbas = new Set((abas ?? []).map((x) => x.id))
  // Aba guardada que não existe mais (apagada) volta para "Todas".
  const abaVigente =
    abas === null || aba === null || aba === ABA_GERAL || idsDasAbas.has(aba) ? aba : null
  const visiveis =
    abas && abaVigente !== null
      ? noCanal.filter((a) => abaDaAutomacao(a.area_id, idsDasAbas) === abaVigente)
      : noCanal
  const contagem = contarPorAba(noCanal, abas ?? [])
  // Em "Todas", a lista vem AGRUPADA por aba (Geral primeiro), só com as abas
  // que têm automação — é o que tira a lista comprida de uma coluna só.
  const grupos: { id: string; nome: string; itens: Automation[] }[] | null =
    abas && abas.length > 0 && abaVigente === null
      ? [{ id: ABA_GERAL, nome: tAbas("geral") }, ...abas.map((x) => ({ id: x.id, nome: x.nome }))]
          .map((g) => ({ ...g, itens: noCanal.filter((a) => abaDaAutomacao(a.area_id, idsDasAbas) === g.id) }))
          .filter((g) => g.itens.length > 0)
      : null

  const showTemplates = automations.length < 3

  return (
    <div className="space-y-6">
      {/* `flex-wrap`: no celular o filtro de canal e o "Criar automação" não
          cabiam ao lado do título, e o botão saía cortado na borda. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ChannelFilter
            channels={channels}
            value={filtroCanal}
            onChange={setFiltroCanal}
          />
          <GatedButton
            canAct={canCreate}
            gateReason="createAutomations"
            onClick={() => router.push("/automations/new")}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t("create")}
          </GatedButton>
        </div>
      </div>

      {abas !== null && automations.length > 0 && (
        <BarraDeAbas
          areas={abas}
          contagem={contagem}
          total={noCanal.length}
          aba={abaVigente}
          onAba={escolherAba}
          podeGerenciar={canCreate}
          onGerenciar={() => setGerenciando(true)}
        />
      )}
      {abasFalharam && abas === null && (
        <p className="text-xs text-muted-foreground">{tAbas("carregarFalhou")}</p>
      )}

      {showTemplates && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("templatesTitle")}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {TEMPLATE_ORDER.map((slug) => {
              const t = AUTOMATION_TEMPLATES[slug]
              const Icon = TEMPLATE_ICON[slug]
              return (
                <button
                  key={slug}
                  onClick={() => startFromTemplate(slug)}
                  className="group flex flex-col items-start rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-card/80"
                >
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold text-foreground">{t.name}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {automations.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">{t("emptyTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("emptyDesc")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {/* Filtro que não casa nada precisa DIZER isso. Sem esta linha a
              lista ficava simplesmente vazia e parecia que as automações
              tinham sumido. */}
          {visiveis.length === 0 && (
            <li className="rounded-xl border border-dashed border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
              {abaVigente !== null && noCanal.length > 0 ? tAbas("vazia") : tCanais("noneOnChannel")}
            </li>
          )}
          {(grupos ?? [{ id: "", nome: "", itens: visiveis }]).map((g) => (
            <li key={g.id || "lista"} className="space-y-3">
              {grupos && (
                <h2 className="flex items-center gap-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.nome}
                  <span className="tabular-nums font-normal">{g.itens.length}</span>
                </h2>
              )}
              <ul className="space-y-3">
                {g.itens.map((a) => (
                  <AutomationCard
                    key={a.id}
                    automation={a}
                    channels={channels}
                    abas={abas}
                    podeMover={canCreate}
                    onMover={(areaId) => moverParaAba(a, areaId)}
                    onToggle={(next) => toggleActive(a, next)}
                    onEdit={() => router.push(`/automations/${a.id}/edit`)}
                    onDuplicate={() => duplicate(a)}
                    onLogs={() => router.push(`/automations/${a.id}/logs`)}
                    onDelete={() => setPendingDelete(a)}
                    t={t}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {abas !== null && (
        <GerenciarAbasDialog
          open={gerenciando}
          onOpenChange={setGerenciando}
          areas={abas}
          contagem={contagem}
          accountId={accountId}
          onMudou={async () => {
            // Apagar uma aba devolve as automações dela para "Geral" no
            // banco (SET NULL): relê as duas listas.
            await Promise.all([recarregarAbas(), load()])
          }}
        />
      )}

      <Dialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDesc", { name: pendingDelete?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AutomationCard({
  automation,
  channels,
  abas,
  podeMover,
  onMover,
  onToggle,
  onEdit,
  onDuplicate,
  onLogs,
  onDelete,
  t,
}: {
  automation: Automation
  channels: CbChannel[]
  /** `null` = as abas ainda não foram lidas (o item "Mover" não aparece). */
  abas: AreaDeAutomacao[] | null
  podeMover: boolean
  onMover: (areaId: string | null) => void
  onToggle: (next: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onLogs: () => void
  onDelete: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const meta = triggerMeta(automation.trigger_type)
  const tGatilhos = useTranslations("Automations.builder.triggers")
  const tAbas = useTranslations("Automations.list.abas")
  const atual = automation.area_id ?? null
  return (
    <li className="rounded-xl border border-border bg-card transition-colors hover:border-border">
      <div className="flex items-center gap-4 p-4">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10"
          aria-hidden
        >
          <Zap className="h-5 w-5 text-primary" />
        </div>

        <button
          type="button"
          onClick={onEdit}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {automation.name}
            </span>
            {automation.is_active && (
              <span className="relative flex h-2 w-2" aria-label={t("activeIndicator")}>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
            )}
          </div>
          {automation.description && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{automation.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                meta.pillClass,
              )}
            >
              {automation.trigger_type in TRIGGER_META
                ? tGatilhos(`${automation.trigger_type}.label` as Parameters<typeof tGatilhos>[0])
                : meta.label}
            </span>
            <span className="tabular-nums">
              {automation.execution_count === 1
                ? t("runs", { count: automation.execution_count })
                : t("runsPlural", { count: automation.execution_count })}
            </span>
            <span aria-hidden>·</span>
            <span>
              {t("lastRun", {
                time: formatRelative(automation.last_executed_at, t("never")),
              })}
            </span>
            {/* Só as restritas ganham etiqueta: "todos os canais" em cada
                linha viraria ruído, e é quem TEM escopo que precisa saltar. */}
            <ChannelScopeBadge channels={channels} scope={automation.channel_ids} />
          </div>
        </button>

        <div className="flex items-center gap-3">
          <Switch
            checked={automation.is_active}
            onCheckedChange={(v) => onToggle(!!v)}
            aria-label={automation.is_active ? t("deactivate") : t("activate")}
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("openMenu")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                {t("edit")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4" />
                {t("duplicate")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onLogs}>
                <FileText className="h-4 w-4" />
                {t("viewLogs")}
              </DropdownMenuItem>
              {podeMover && abas && abas.length > 0 && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderInput className="h-4 w-4" />
                    {tAbas("moverPara")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {[{ id: null as string | null, nome: tAbas("geral") }, ...abas].map((x) => (
                      <DropdownMenuItem
                        key={x.id ?? "geral"}
                        disabled={x.id === atual}
                        onClick={() => onMover(x.id)}
                      >
                        {x.id === atual ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
                        <span className="max-w-[14rem] truncate">{x.nome}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" />
                {t("delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  )
}
