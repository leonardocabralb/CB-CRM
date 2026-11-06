"use client";

// ============================================================
// O selo do CLIENTE IDEAL (1124) — o MESMO na lista de conversas, no card do
// funil e no cabeçalho do fio (duas marcas para o mesmo fato fariam o
// operador aprender duas linguagens).
//
// ICP = pastilha dourada SÓLIDA; ICP? (possível: o critério principal casa e
// o resto está em branco) = só o CONTORNO. Classes LITERAIS (o Tailwind não
// gera classe montada), e sem par `dark:` — o variant está inerte: a sólida
// é autossuficiente nos dois temas, e o contorno usa `text-foreground`, que
// vira com o tema. Amarelo não está na paleta das conexões nem nas marcas da
// linha (violeta, âmbar, vermelho).
// ============================================================

import { Gem } from "lucide-react";
import { useTranslations } from "next-intl";

import type { NivelDeClienteIdeal } from "@/lib/contacts/cliente-ideal";
import { cn } from "@/lib/utils";

export function SeloDeClienteIdeal({
  nivel,
  compacto = false,
  className,
}: {
  nivel: NivelDeClienteIdeal;
  /**
   * Só o diamante, sem o texto — a LINHA da lista de conversas. Medido no
   * preview (05/11/2026): com "ICP" escrito, a linha com raio e atraso
   * espremia o NOME do cliente até sumir; a regra da linha é cortar a marca,
   * nunca o nome (as outras marcas dela também são só ícone).
   */
  compacto?: boolean;
  className?: string;
}) {
  const t = useTranslations("ClienteIdeal");
  const ideal = nivel === "ideal";
  const dica = ideal ? t("dicaIdeal") : t("dicaPossivel");
  return (
    <span
      title={dica}
      aria-label={compacto ? dica : undefined}
      role={compacto ? "img" : undefined}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full text-[10px] leading-4 font-bold",
        compacto ? "p-0.5" : "py-px pr-1.5 pl-1",
        ideal
          ? "bg-yellow-400 text-yellow-950"
          : "border border-yellow-500 text-foreground",
        className,
      )}
    >
      <Gem className={cn("h-3 w-3", !ideal && "text-yellow-500")} aria-hidden="true" />
      {compacto ? null : ideal ? t("selo") : t("seloPossivel")}
    </span>
  );
}
