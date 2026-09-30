"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"

import { SITUACOES_DO_GATILHO, SITUACOES_PADRAO_DO_GATILHO, VARIAVEIS_DA_MUDANCA } from "@/lib/atlas/gatilho"
import { FONTE_MONO } from "@/components/settings/copiar"

/**
 * Config do gatilho "Situação mudou no Atlas" (1073, Fase 4 de
 * docs/PLANO-integracao-atlas.md): para quais situações NOVAS a mudança
 * dispara e em quais FUNIS o card do cliente precisa estar (obrigatório: o
 * disparo leva sempre o card do evento — decisão do operador, 30/09/2026).
 * Só roda pela leitura periódica do Atlas; "Executar automação", o agente de
 * IA e "Acionar automação" não a oferecem.
 *
 * Os defaults moram na CONFIG (`semearAtlas`, chamado pelo construtor), não
 * só na tela: o que se vê é o que se salva.
 */

/** Semeia as situações padrão e a lista de funis (nada é sobrescrito quando já existe). */
export function semearAtlas(cfg: Record<string, unknown>): Record<string, unknown> {
  return {
    ...cfg,
    situacoes: Array.isArray(cfg.situacoes) ? cfg.situacoes : [...SITUACOES_PADRAO_DO_GATILHO],
    pipeline_ids: Array.isArray(cfg.pipeline_ids) ? cfg.pipeline_ids : [],
  }
}

type EstadoDaLista = "carregando" | "pronto" | "falhou"

export function AtlasTriggerConfig({
  config,
  onChange,
  pipelines,
  estadoDosFunis,
}: {
  config: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  pipelines: readonly { id: string; name: string }[]
  estadoDosFunis: EstadoDaLista
}) {
  const t = useTranslations("Automations.builder.atlasGatilho")
  const situacoes = Array.isArray(config.situacoes) ? config.situacoes.filter((s): s is string => typeof s === "string") : []
  const funis = Array.isArray(config.pipeline_ids) ? config.pipeline_ids.filter((s): s is string => typeof s === "string") : []
  // "Apagado" só com a lista CARREGADA: durante a carga ela está vazia.
  const orfaos = estadoDosFunis === "pronto" ? funis.filter((id) => !pipelines.some((p) => p.id === id)) : []

  const alternar = (lista: string[], valor: string, ligado: boolean) => (ligado ? [...new Set([...lista, valor])] : lista.filter((v) => v !== valor))

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {t("descricao")}{" "}
        <Link href="/settings?tab=integracoes" className="underline">
          {t("abrirIntegracoes")}
        </Link>
      </p>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("situacoesLabel")}</p>
        <div className="grid grid-cols-2 gap-1">
          {SITUACOES_DO_GATILHO.map((s) => (
            <label key={s} className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={situacoes.includes(s)}
                onChange={(e) => onChange({ ...config, situacoes: alternar(situacoes, s, e.target.checked) })}
              />
              {/* chave montada: `situacao.<s>` — a lista é `SITUACOES_DO_GATILHO` (teste em `src/lib/atlas/gatilho.test.ts`) */}
              {t(`situacao.${s}` as Parameters<typeof t>[0])}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t("situacoesAjuda")}</p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">{t("funisLabel")}</p>
        {pipelines.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {estadoDosFunis === "carregando" ? t("funisCarregando") : estadoDosFunis === "falhou" ? t("funisFalhou") : t("funisVazio")}
          </p>
        ) : (
          <div className="space-y-1">
            {pipelines.map((p) => (
              <label key={p.id} className="flex min-w-0 items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={funis.includes(p.id)}
                  onChange={(e) => onChange({ ...config, pipeline_ids: alternar(funis, p.id, e.target.checked) })}
                />
                <span className="min-w-0 truncate">{p.name}</span>
              </label>
            ))}
          </div>
        )}
        {orfaos.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-red-700">
            <span>{t("funisApagados", { n: orfaos.length })}</span>
            <button type="button" className="underline" onClick={() => onChange({ ...config, pipeline_ids: funis.filter((id) => !orfaos.includes(id)) })}>
              {t("tirarApagados")}
            </button>
          </div>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">{t("funisAjuda")}</p>
      </div>

      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700">{t("aviso")}</p>

      <div className="rounded-md border border-border bg-muted/40 p-2">
        <p className="text-[11px] font-medium text-muted-foreground">{t("variaveisTitulo")}</p>
        <p className="mt-1 break-all text-[11px] leading-5 text-foreground" style={{ fontFamily: FONTE_MONO }}>{VARIAVEIS_DA_MUDANCA.map((v) => `{{vars.${v}}}`).join("  ")}</p>
      </div>
    </div>
  )
}
