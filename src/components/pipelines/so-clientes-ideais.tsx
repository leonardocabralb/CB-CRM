"use client";

// ============================================================
// "Só clientes ideais" no cabeçalho do quadro do funil (1124, Fase 3).
//
// Quem cumpre o perfil e nunca respondeu tem a conversa ENCERRADA e fica fora
// da aba padrão da caixa de entrada, mas tem card aberto no funil: a lista de
// quem LIGAR mora no quadro (D5). As colunas cheias desenham 20 cards por vez,
// e só a borda dourada não bastava para achá-los.
//
// Só o nível `ideal` (o "ICP?" fica de fora), a mesma régua do selo do card.
// O recorte é do quadro (`negociosIdeais` do `PipelineBoard`); aqui só o
// gesto e o estado: carregando, quantos, ou a falha (o quadro mostra todos).
// ============================================================

import { AlertTriangle, Gem, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface SoClientesIdeaisProps {
  ligado: boolean;
  onAlternar: () => void;
  /** Cards de cliente ideal neste funil; `null` = ainda não sei. */
  quantos: number | null;
  /** A leitura falhou sem uma anterior: o quadro NÃO está recortado. */
  falhou: boolean;
}

export function SoClientesIdeais({ ligado, onAlternar, quantos, falhou }: SoClientesIdeaisProps) {
  const t = useTranslations("ClienteIdeal");
  const dica = ligado && falhou
    ? t("filtroDoQuadroFalhou")
    : ligado && quantos === null
      ? t("filtroDoQuadroCarregando")
      : t("filtroDoQuadroDica");

  return (
    <button
      type="button"
      onClick={onAlternar}
      aria-pressed={ligado}
      aria-label={t("filtroDoQuadro")}
      title={dica}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
        // `dark:` está inerte no app: as cores do selo, que servem nos dois.
        ligado
          ? "border-yellow-500/60 bg-yellow-400/15 text-foreground hover:bg-yellow-400/25"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {ligado && falhou ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      ) : ligado && quantos === null ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <Gem className="h-4 w-4 shrink-0 text-yellow-500" aria-hidden="true" />
      )}
      {/* No celular, só o ícone: o cabeçalho quebra linha e o rótulo
          empurraria os botões de criar para baixo. */}
      <span className="hidden sm:inline">{t("filtroDoQuadro")}</span>
      {ligado && quantos !== null && !falhou && (
        <span className="tabular-nums font-semibold">{quantos}</span>
      )}
    </button>
  );
}
