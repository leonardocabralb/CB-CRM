"use client";

import { Bot, X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A caixinha dentro do CRM quando um agente de IA passa a conversa para a
 * equipe (1139, decisões D3/D4 do operador): o cartão INTEIRO abre a
 * conversa; o X só fecha (o aviso continua no sino, não lido). Desenhada
 * por `useAvisoDaIaNaTela` num `toast.custom` sem prazo — o sonner não estiliza
 * toast próprio.
 *
 * DESTAQUE ÂMBAR (D5 do operador, 12/11/2026): a versão discreta, igual aos
 * outros toasts, passava despercebida. Âmbar, e não vermelho: vermelho no CRM
 * é falha ("não enviada"). Toda passagem tem o MESMO destaque (D7). ⚠️ O
 * `dark:` está inerte (`ui.md`): cada cor vale nos DOIS temas — o fundo é o
 * do popover com um véu âmbar translúcido, e o texto âmbar é o `amber-700`
 * (4,90 no claro, 4,17 no escuro).
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
    <div className="relative w-full overflow-hidden rounded-lg border-2 border-amber-500 bg-popover text-popover-foreground shadow-xl">
      <button
        type="button"
        onClick={onAbrir}
        className="flex w-full min-w-0 items-start gap-3 bg-amber-500/10 p-3.5 pr-10 text-left transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
          <Bot className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug text-foreground">{titulo}</span>
          {corpo ? (
            <span className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-foreground/80">{corpo}</span>
          ) : null}
          <span className="mt-2 block text-sm font-semibold text-amber-700 dark:text-amber-300">{t("abrir")} →</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onFechar}
        aria-label={t("fechar")}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-amber-500/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
