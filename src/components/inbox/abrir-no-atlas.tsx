"use client";

// ============================================================
// "Abrir no Atlas" (Fase 2 de docs/PLANO-integracao-atlas.md): a ficha do
// cliente no Atlas numa aba nova. Para TODOS que veem a conversa (D4) — o
// Atlas pede o login dele e confere o escritório.
//
// Duas formas do mesmo link: `circulo` no cabeçalho do painel da conversa
// (irmão do "Copiar link", no mesmo desenho) e `botao` na aba Atlas e na
// ficha de /contatos. SEM botão na faixa (Fase 1, D7: a faixa só informa).
//
// ⚠️ O endereço vem de FORA (o `app_url` do Atlas) e vira `href`: só se
// desenha com `https:` válido — um `javascript:` seria XSS. A rota já
// confere (`appUrlSegura`), e aqui confere de novo.
// ============================================================

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** O endereço só serve se for `https:` e legível; senão, nada se desenha. */
export function hrefDoAtlas(appUrl: string | null | undefined): string | null {
  if (!appUrl) return null;
  try {
    return new URL(appUrl).protocol === "https:" ? appUrl : null;
  } catch {
    return null;
  }
}

export function AbrirNoAtlas({
  appUrl,
  variante,
  className,
}: {
  appUrl: string | null | undefined;
  variante: "circulo" | "botao";
  className?: string;
}) {
  const t = useTranslations("Inbox.atlas");
  const href = hrefDoAtlas(appUrl);
  if (!href) return null;
  const rotulo = t("abrirNoAtlas");

  if (variante === "circulo") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={rotulo}
        title={rotulo}
        className={cn(
          "text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border transition-colors",
          className,
        )}
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={rotulo}
      title={rotulo}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)}
    >
      <ExternalLink aria-hidden="true" />
      {rotulo}
    </a>
  );
}
