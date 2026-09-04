"use client";

import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";

import { PRESETS, type Personalizado, type Preset } from "@/lib/funil/periodo";

/**
 * Os presets de período da lista e do painel (Este mês · Mês passado · Este
 * ano · Ano passado · Total · Personalizar), mais os dois campos de data
 * quando é personalizado. Não há date picker no projeto: `<input
 * type="date">` nativo, como as demais telas.
 */
export function SeletorDePeriodo({
  preset,
  personalizado,
  onChange,
}: {
  preset: Preset;
  personalizado: Personalizado;
  onChange: (preset: Preset, personalizado: Personalizado) => void;
}) {
  const t = useTranslations("Pipelines.funil.periodo");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap rounded-lg border border-border bg-card p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p, personalizado)}
            aria-pressed={p === preset}
            className={
              p === preset
                ? "inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                : "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {p === "personalizado" && <CalendarDays className="mr-1 h-3 w-3" />}
            {/* chave montada: `periodo.<preset>` — cobrada em lista.test.ts */}
            {t(p as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>
      {preset === "personalizado" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">
            {t("de")}
            <input
              type="date"
              value={personalizado.desde}
              onChange={(e) => onChange(preset, { ...personalizado, desde: e.target.value })}
              className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-foreground"
            />
          </label>
          <label className="flex items-center gap-1">
            {t("ate")}
            <input
              type="date"
              value={personalizado.ate}
              onChange={(e) => onChange(preset, { ...personalizado, ate: e.target.value })}
              className="h-7 rounded-md border border-border bg-card px-1.5 text-xs text-foreground"
            />
          </label>
        </div>
      )}
    </div>
  );
}
