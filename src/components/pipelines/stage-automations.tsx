"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, Globe, Pencil, Plus, Zap } from "lucide-react"
import { useTranslations } from "next-intl"

import type { Automation, PipelineStage } from "@/types"
import { automacoesDaEtapa } from "@/lib/automations/por-etapa"
import { formatRelative } from "@/lib/automations/trigger-meta"
import { useCan } from "@/hooks/use-can"
import { GatedButton } from "@/components/ui/gated-button"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/**
 * O painel de automações de UMA etapa — a peça central da Fase 5, no formato
 * do Kommo: cada coluna do quadro carrega as suas regras.
 *
 * ⚠️ Ele mostra TRÊS grupos, e isso não é enfeite. A automação de gatilho
 * vazio dispara em toda etapa: um painel que listasse só quem nomeia a coluna
 * diria "nenhuma automação" numa etapa que tem regra ativa rodando. A
 * classificação mora em `lib/automations/por-etapa.ts`, com teste comparando
 * com o motor.
 */
export function StageAutomations({
  open,
  onOpenChange,
  stage,
  automations,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stage: PipelineStage
  automations: Automation[]
  onChanged: () => void
}) {
  const t = useTranslations("Pipelines.stageAutomations")
  const router = useRouter()
  const canCreate = useCan("send-messages")
  const [salvando, setSalvando] = useState<string | null>(null)

  const grupos = useMemo(
    () => automacoesDaEtapa(automations, stage.id),
    [automations, stage.id],
  )

  const vazio =
    grupos.especificas.length === 0 &&
    grupos.irrestritas.length === 0 &&
    grupos.mortas.length === 0

  async function alternar(a: Automation, next: boolean) {
    setSalvando(a.id)
    const res = await fetch(`/api/automations/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    })
    setSalvando(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      toast.error(body?.error ?? t("toastUpdateError"))
      return
    }
    // Recarrega da fonte em vez de mexer no estado local: a lista é do dono da
    // página, e uma cópia otimista aqui divergiria da etiqueta da coluna.
    onChanged()
    toast.success(next ? t("toastActivated") : t("toastPaused"))
  }

  function criar() {
    // A etapa viaja na URL e o construtor já nasce com o gatilho certo — é o
    // que torna "automação DESTA coluna" um gesto e não um formulário.
    router.push(`/automations/new?stage=${encodeURIComponent(stage.id)}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: stage.color }}
              aria-hidden
            />
            <span className="truncate">{t("title", { stage: stage.name })}</span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{t("intro")}</p>

        {vazio ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center">
            <Zap className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-foreground">{t("emptyTitle")}</p>
            <p className="max-w-xs text-xs text-muted-foreground">{t("emptyDesc")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {grupos.especificas.length > 0 && (
              <Grupo titulo={t("groupThisStage")}>
                {grupos.especificas.map((a) => (
                  <Linha
                    key={a.id}
                    automation={a}
                    salvando={salvando === a.id}
                    onToggle={(v) => alternar(a, v)}
                    onEdit={() => router.push(`/automations/${a.id}/edit`)}
                    t={t}
                  />
                ))}
              </Grupo>
            )}

            {/* Aparecem em TODAS as colunas, de propósito: é isso que elas
                fazem. Escondê-las daria a impressão de que a etapa está
                limpa. */}
            {grupos.irrestritas.length > 0 && (
              <Grupo titulo={t("groupAllStages")} dica={t("groupAllStagesHint")}>
                {grupos.irrestritas.map((a) => (
                  <Linha
                    key={a.id}
                    automation={a}
                    icone={<Globe className="h-3.5 w-3.5" />}
                    salvando={salvando === a.id}
                    onToggle={(v) => alternar(a, v)}
                    onEdit={() => router.push(`/automations/${a.id}/edit`)}
                    t={t}
                  />
                ))}
              </Grupo>
            )}

            {/* Gatilho aponta para cá, escopo aponta para outra etapa. Ligada,
                configurada e incapaz de disparar — sem este aviso o operador
                fica esperando por uma mensagem que nunca sai. */}
            {grupos.mortas.length > 0 && (
              <Grupo titulo={t("groupNeverFires")} dica={t("groupNeverFiresHint")} alerta>
                {grupos.mortas.map((a) => (
                  <Linha
                    key={a.id}
                    automation={a}
                    icone={<AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                    salvando={salvando === a.id}
                    onToggle={(v) => alternar(a, v)}
                    onEdit={() => router.push(`/automations/${a.id}/edit`)}
                    t={t}
                  />
                ))}
              </Grupo>
            )}
          </div>
        )}

        <GatedButton
          canAct={canCreate}
          gateReason="create automations"
          onClick={criar}
          className="w-full"
        >
          <Plus className="mr-1 h-4 w-4" />
          {t("create")}
        </GatedButton>
      </DialogContent>
    </Dialog>
  )
}

function Grupo({
  titulo,
  dica,
  alerta,
  children,
}: {
  titulo: string
  dica?: string
  alerta?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </div>
      {dica && (
        <p
          className={
            alerta
              ? "mb-2 text-[11px] text-amber-400"
              : "mb-2 text-[11px] text-muted-foreground"
          }
        >
          {dica}
        </p>
      )}
      <ul className="space-y-2">{children}</ul>
    </div>
  )
}

function Linha({
  automation,
  icone,
  salvando,
  onToggle,
  onEdit,
  t,
}: {
  automation: Automation
  icone?: React.ReactNode
  salvando: boolean
  onToggle: (next: boolean) => void
  onEdit: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-card p-2.5">
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          {icone}
          <span className="truncate text-sm font-medium text-foreground">
            {automation.name}
          </span>
        </div>
        {/* Com zero disparos, "0 disparos · última nunca" diz a mesma coisa
            duas vezes. Uma frase só. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {(automation.execution_count ?? 0) === 0 ? (
            <span>{t("neverRun")}</span>
          ) : (
            <>
              <span className="tabular-nums">
                {t("runs", { count: automation.execution_count })}
              </span>
              <span aria-hidden>·</span>
              <span>
                {t("lastRun", {
                  time: formatRelative(automation.last_executed_at, t("neverRun")),
                })}
              </span>
            </>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={t("edit")}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Switch
        checked={automation.is_active}
        disabled={salvando}
        onCheckedChange={(v) => onToggle(!!v)}
        aria-label={automation.is_active ? t("deactivate") : t("activate")}
      />
    </li>
  )
}
