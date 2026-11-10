"use client"

import { useTranslations } from "next-intl"

import { Input } from "@/components/ui/input"
import { lerLimitesDaCobranca, TETO_DE_DIAS, TETO_DE_PARCELAS } from "@/lib/automations/situacao-da-cobranca"

/**
 * Os dois limites da condição "Situação da cobrança" (régua do Asaas,
 * 10/11/2026): a partir de quantas parcelas vencidas e a partir de quantos
 * dias de atraso da mais antiga. Em branco TIRA a chave (não olha); a regra
 * mora em `situacao-da-cobranca.ts`, e a ativação recusa os dois em branco.
 * Módulo próprio para não crescer o construtor do upstream.
 */
export function SituacaoDaCobrancaFields({
  cfg,
  set,
}: {
  cfg: Record<string, unknown>
  set: (patch: Record<string, unknown>) => void
}) {
  const t = useTranslations("Automations.builder.config")
  const limites = lerLimitesDaCobranca(cfg)
  // O que está gravado, mesmo fora da faixa: o campo mostra o que se salva.
  const mostrar = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "")
  const ler = (texto: string): number | undefined => {
    if (texto.trim() === "") return undefined
    const n = Math.trunc(Number(texto))
    return Number.isFinite(n) ? n : undefined
  }
  const semLimite = limites.parcelas === null && limites.dias === null
  return (
    <div className="space-y-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cobrancaParcelasLabel")}</label>
        <Input
          type="number"
          min={1}
          max={TETO_DE_PARCELAS}
          inputMode="numeric"
          value={mostrar(cfg.cobranca_parcelas)}
          onChange={(e) => set({ cobranca_parcelas: ler(e.target.value) })}
          className="bg-muted text-foreground"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">{t("cobrancaParcelasAjuda")}</p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">{t("cobrancaDiasLabel")}</label>
        <Input
          type="number"
          min={1}
          max={TETO_DE_DIAS}
          inputMode="numeric"
          value={mostrar(cfg.cobranca_dias)}
          onChange={(e) => set({ cobranca_dias: ler(e.target.value) })}
          className="bg-muted text-foreground"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">{t("cobrancaDiasAjuda")}</p>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("cobrancaAjuda")}</p>
      {semLimite && <p className="text-[11px] text-amber-700 dark:text-amber-300">{t("cobrancaSemLimite")}</p>}
    </div>
  )
}
