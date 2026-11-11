"use client"

import Link from "next/link"
import { Receipt } from "lucide-react"
import { useTranslations } from "next-intl"

import { ehGatilhoDaRegua } from "@/lib/asaas/regua"

/**
 * As automações da régua do Asaas são as ETAPAS da "Cobrança automática"
 * (1134): na lista de Automações ganham o selo e o atalho para a tela do
 * módulo, e no construtor um aviso (`AvisoDaRegua`). Decisão do operador
 * (11/11/2026): o construtor só AVISA, não trava — a tela do módulo lê o que
 * está gravado, então nada fica dessincronizado.
 */

export const LINK_DA_COBRANCA_AUTOMATICA = "/settings?tab=integracoes&aba=cobranca"

export function SeloDaRegua({ gatilho }: { gatilho: string }) {
  const t = useTranslations("Automations.regua")
  if (!ehGatilhoDaRegua(gatilho)) return null
  return (
    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
      {t("selo")}
    </span>
  )
}

export function LinkDaRegua({ gatilho }: { gatilho: string }) {
  const t = useTranslations("Automations.regua")
  if (!ehGatilhoDaRegua(gatilho)) return null
  return (
    <Link href={LINK_DA_COBRANCA_AUTOMATICA} className="hidden text-xs font-medium text-primary underline-offset-2 hover:underline sm:inline">
      {t("editarNaRegua")}
    </Link>
  )
}

export function AvisoDaRegua({ gatilho }: { gatilho: string }) {
  const t = useTranslations("Automations.regua")
  if (!ehGatilhoDaRegua(gatilho)) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900" role="note">
      <Receipt className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t("aviso")}</span>
      <Link href={LINK_DA_COBRANCA_AUTOMATICA} className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100">
        {t("abrir")}
      </Link>
    </div>
  )
}
