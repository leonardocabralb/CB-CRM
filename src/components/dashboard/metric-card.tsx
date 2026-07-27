import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
  /**
   * Ressalva exibida no cartão quando há filtro de canal ativo. Duas usam
   * esta prop, por motivos diferentes:
   *  · "Conta inteira" — o número NÃO é filtrável (contatos não têm
   *    `channel_id`, e nem faria sentido: contato é do escritório).
   *  · "Originados neste número" — o número É filtrável, mas o recorte
   *    significa outra coisa: `deals.channel_id` (908) marca por onde o
   *    cliente CHEGOU, não onde o negócio está agora.
   * Sem a ressalva, o operador lê qualquer um dos dois como "isto é do
   * Comercial".
   */
  accountWideNote?: string
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  delta,
  subtitle,
  accountWideNote,
}: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {accountWideNote && (
            <span className="w-fit rounded border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {accountWideNote}
            </span>
          )}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-[28px] leading-none font-bold tabular-nums text-foreground">
        {value}
      </p>
      {delta ? <DeltaRow sign={delta.sign} label={delta.label} /> : subtitle ? (
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
      ? 'text-red-400'
      : 'text-muted-foreground'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
