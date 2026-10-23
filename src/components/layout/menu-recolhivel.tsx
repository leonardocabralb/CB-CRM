"use client";

// ============================================================
// Menu lateral recolhível — as peças que a barra lateral e o cabeçalho
// (os dois vieram do original) usam, num módulo nosso: cada um deles muda
// em poucas linhas, e o merge do upstream não tem o que costurar aqui.
// O estado mora em `useMenuRecolhido`.
// ============================================================

import Link from "next/link";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMenuRecolhido } from "@/hooks/use-menu-recolhido";

/**
 * O link de um item do menu. Recolhido, o nome sai da linha e aparece na
 * dica ao lado do ícone; aberto, a dica fica desligada (repetiria o nome).
 */
export function ItemDoMenu({
  href,
  rotulo,
  recolhido,
  className,
  children,
}: {
  href: string;
  rotulo: string;
  recolhido: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip disabled={!recolhido}>
      <TooltipTrigger render={<Link href={href} />} className={className}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {rotulo}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * O botão que recolhe e expande o menu, no cabeçalho, só do `lg` para cima
 * (abaixo, o menu é a gaveta do botão de três traços, no mesmo lugar).
 */
export function BotaoDeRecolherMenu() {
  const t = useTranslations("Header");
  const { recolhido, alternar } = useMenuRecolhido();
  const rotulo = recolhido ? t("expandirMenu") : t("recolherMenu");
  const Icone = recolhido ? PanelLeftOpen : PanelLeftClose;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={alternar}
            aria-label={rotulo}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:flex"
          />
        }
      >
        <Icone className="h-[18px] w-[18px]" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{rotulo}</TooltipContent>
    </Tooltip>
  );
}
