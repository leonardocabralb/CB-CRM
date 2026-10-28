"use client";

import { User, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ClienteDoAviso } from "@/lib/notifications/texto-do-aviso";
import { cn } from "@/lib/utils";

/**
 * De quem é o aviso — o cliente ou o grupo da conversa —, numa linha própria
 * sob o título (pedido do operador, 28/10/2026). A MESMA peça no sino e no
 * card de notificações do Meu dia. `null` não desenha nada: aviso sem cliente
 * não ganha um nome inventado (`clienteDoAviso`).
 *
 * `min-w-0` + `truncate`: nome de empresa longo ("JULIO … - DIGITCOM LTDA")
 * dentro de item de flex, que nasce com `min-width: auto`.
 */
export function LinhaDoCliente({
  cliente,
  className,
}: {
  cliente: ClienteDoAviso | null;
  className?: string;
}) {
  const t = useTranslations("NotificationsPage");
  if (!cliente) return null;
  const Icone = cliente.tipo === "grupo" ? Users : User;
  const rotulo = cliente.tipo === "grupo" ? t("grupoDoAviso") : t("clienteDoAviso");
  return (
    <span
      className={cn("flex min-w-0 items-center gap-1 text-xs text-muted-foreground", className)}
      title={`${rotulo}: ${cliente.nome}`}
    >
      <Icone className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">{rotulo}:</span>
      <span className="truncate font-medium text-foreground/80">{cliente.nome}</span>
    </span>
  );
}
