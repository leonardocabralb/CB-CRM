"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { NotaDoAviso } from "@/lib/notifications/nota-do-aviso";

/**
 * "Anotação apagada" no aviso de menção/resposta (1132), no sino e no Meu
 * dia: quem apagou e quando (quando se sabe) e o texto INTEIRO — o pedido do
 * operador é que a pessoa consiga ler, dentro do aviso, o que a anotação
 * dizia. Só `span`: mora dentro do botão da linha do aviso.
 */
export function NotaApagadaNoAviso({
  nota,
  className,
}: {
  nota: Extract<NotaDoAviso, { estado: "apagada" }>;
  className?: string;
}) {
  const t = useTranslations("NotificationsPage.notaApagada");
  const quando = nota.apagadaEm
    ? new Date(nota.apagadaEm).toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return (
    <span className={cn("block", className)}>
      <span className="text-destructive inline-flex items-center gap-1 text-[11px] font-semibold">
        <Trash2 className="h-3 w-3 shrink-0" aria-hidden />
        {quando && nota.apagadaPor
          ? t("apagadaPor", { nome: nota.apagadaPor, quando })
          : quando
            ? t("apagadaEm", { quando })
            : t("apagada")}
      </span>
      {nota.texto.trim() && (
        <span className="text-foreground/80 mt-1 block text-xs leading-relaxed break-words whitespace-pre-wrap">
          {nota.texto}
        </span>
      )}
    </span>
  );
}
