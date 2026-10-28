"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * A faixa de volta da jornada aviso → conversa (pedido do operador,
 * 28/10/2026): quem abriu a conversa por um aviso do sino volta às
 * Notificações; pelo card do Meu dia, ao Meu dia. Irmã de `voltar-ao-funil.tsx`
 * e `voltar-as-reunioes.tsx`, com o mesmo desenho: aparece com `de=notificacoes`
 * ou `de=meu-dia` na URL (preservado nos replaces por `urlDoInbox`), `shrink-0`
 * na coluna, TEXTO e não só ícone (no celular convive com a seta que volta
 * para a lista), `<Link>` para Ctrl+clique de graça.
 */
export function VoltarAosAvisos({
  origem,
  inert,
}: {
  origem: "notificacoes" | "meu-dia";
  inert?: boolean;
}) {
  const t = useTranslations("Inbox.page");
  return (
    <div
      inert={inert}
      className="flex shrink-0 items-center border-b border-border bg-card px-3 py-1.5"
    >
      <Link
        href={origem === "meu-dia" ? "/meu-dia" : "/notifications"}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs text-primary transition-colors hover:bg-primary/20"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {origem === "meu-dia" ? t("backToMeuDia") : t("backToNotifications")}
      </Link>
    </div>
  );
}
