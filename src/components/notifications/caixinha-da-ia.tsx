"use client";

import { Bot, BotOff, X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A caixinha dentro do CRM dos avisos da IA. Desenhada por
 * `useAvisoDaIaNaTela` num `toast.custom` sem prazo — o sonner não estiliza
 * toast próprio. O cartão INTEIRO é o botão de agir; o X só fecha (o aviso
 * continua no sino, não lido).
 *
 * - `aviso` (1139, D5 do operador): a IA passou a conversa para a equipe —
 *   ÂMBAR, abre a conversa. Âmbar, e não vermelho: vermelho no CRM é falha.
 * - `falha` (1140, F1): a IA PAROU de responder (créditos, chave, modelo,
 *   provedor) — VERMELHO, leva às clientes "Em atraso".
 *
 * ⚠️ O `dark:` está inerte (`ui.md`): cada cor vale nos DOIS temas — fundo do
 * popover com véu translúcido; o texto do âmbar é o `amber-700` (4,90 no
 * claro, 4,17 no escuro) e o do vermelho o `red-600` (4,83 no claro, 4,68 no
 * escuro). Classes LITERAIS, nunca montadas.
 */
export function CaixinhaDaIa({
  tom = "aviso",
  titulo,
  corpo,
  onAbrir,
  onFechar,
}: {
  tom?: "aviso" | "falha";
  titulo: string;
  corpo: string | null;
  onAbrir: () => void;
  onFechar: () => void;
}) {
  const t = useTranslations("AvisoDaIaNaTela");
  const falha = tom === "falha";
  const Icone = falha ? BotOff : Bot;
  return (
    // Sem `role` próprio: o sonner já anuncia cada toast ao leitor de tela.
    <div
      className={
        falha
          ? "relative w-full overflow-hidden rounded-lg border-2 border-red-500 bg-popover text-popover-foreground shadow-xl"
          : "relative w-full overflow-hidden rounded-lg border-2 border-amber-500 bg-popover text-popover-foreground shadow-xl"
      }
    >
      <button
        type="button"
        onClick={onAbrir}
        className={
          falha
            ? "flex w-full min-w-0 items-start gap-3 bg-red-500/10 p-3.5 pr-10 text-left transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            : "flex w-full min-w-0 items-start gap-3 bg-amber-500/10 p-3.5 pr-10 text-left transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        }
      >
        <span
          className={
            falha
              ? "flex size-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
              : "flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"
          }
        >
          <Icone className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug text-foreground">{titulo}</span>
          {corpo ? (
            <span className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-foreground/80">{corpo}</span>
          ) : null}
          <span
            className={
              falha
                ? "mt-2 block text-sm font-semibold text-red-600 dark:text-red-400"
                : "mt-2 block text-sm font-semibold text-amber-700 dark:text-amber-300"
            }
          >
            {falha ? t("verEmAtraso") : t("abrir")} →
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onFechar}
        aria-label={t("fechar")}
        className={
          falha
            ? "absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            : "absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-amber-500/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        }
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
