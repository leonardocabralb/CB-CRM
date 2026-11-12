"use client";

import { Bot, X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A caixinha dentro do CRM quando um agente de IA passa a conversa para a
 * equipe (1139, decisões D3/D4 do operador): o cartão INTEIRO abre a
 * conversa; o X só fecha (o aviso continua no sino, não lido). Desenhada
 * por `useAvisoDaIaNaTela` num `toast.custom` sem prazo — o sonner não estiliza
 * toast próprio, então as cores são as dos tokens do popover, nos dois temas.
 */
export function CaixinhaDaIa({
  titulo,
  corpo,
  onAbrir,
  onFechar,
}: {
  titulo: string;
  corpo: string | null;
  onAbrir: () => void;
  onFechar: () => void;
}) {
  const t = useTranslations("AvisoDaIaNaTela");
  return (
    // Sem `role` próprio: o sonner já anuncia cada toast ao leitor de tela.
    <div className="relative w-full rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full min-w-0 items-start gap-3 rounded-lg p-3 pr-10 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Bot className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{titulo}</span>
          {corpo ? (
            <span className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{corpo}</span>
          ) : null}
          <span className="mt-1.5 block text-xs font-medium text-primary">{t("abrir")}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onFechar}
        aria-label={t("fechar")}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
