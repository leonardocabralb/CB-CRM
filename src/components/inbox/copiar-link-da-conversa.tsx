"use client";

// ============================================================
// "Copiar link da conversa" (pedido do operador, 2026-09-03, a partir do
// círculo com ícone de link do Chatguru).
//
// O link é o deep link que o sistema JÁ usa — `/inbox?c=<id>`, o mesmo que
// notificações, radar e tarefas produzem (`urlDoInbox`). Nada novo a ler do
// outro lado: colar o link abre a conversa selecionada.
//
// Duas formas do mesmo botão: `circulo` no cabeçalho do painel (como na
// referência) e `icone` ao lado do nome no cabeçalho do fio, para quando o
// painel está fechado.
// ============================================================

import { useCallback, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { urlDoInbox } from "@/lib/inbox/url";
import { cn } from "@/lib/utils";

export function CopiarLinkDaConversa({
  conversationId,
  variante = "icone",
  className,
}: {
  conversationId: string;
  variante?: "icone" | "circulo";
  className?: string;
}) {
  const t = useTranslations("Inbox.messageThread");
  const [copiado, setCopiado] = useState(false);

  const copiar = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${urlDoInbox({ c: conversationId })}`,
      );
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(t("copyLinkFailed"));
    }
  }, [conversationId, t]);

  return (
    <button
      type="button"
      onClick={copiar}
      aria-label={t("copyLink")}
      title={copiado ? t("linkCopied") : t("copyLink")}
      className={cn(
        "inline-flex shrink-0 items-center justify-center transition-colors",
        variante === "circulo"
          ? "h-7 w-7 rounded-full border border-border"
          : "h-6 w-6 rounded-md",
        copiado
          ? "text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {copiado ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
    </button>
  );
}
