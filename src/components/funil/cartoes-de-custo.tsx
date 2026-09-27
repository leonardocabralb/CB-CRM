"use client";

import {
  CalendarCheck,
  FileSignature,
  FolderCheck,
  Megaphone,
  Send,
  Trophy,
  UserCheck,
  UserMinus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { noMeioDaFrase } from "@/lib/funil/apresentacao";
import type { Degrau } from "@/lib/funil/degraus";
import type { CartaoDeCusto } from "@/lib/funil/painel";

/**
 * Nome e ícone de cada cartão de custo (`src/lib/funil/painel.ts`), os
 * MESMOS no Desempenho, na Saúde e em Gerenciar funil. Os de degrau levam o
 * rótulo do degrau NESTE funil — o livre, se houver ("Custo por pasta
 * fechada", "Custo por processo protocolado"); o resto sai do dicionário,
 * com chaves LITERAIS (o portão de i18n as vê).
 */
export const ICONE_DO_CARTAO: Record<CartaoDeCusto, LucideIcon> = {
  investimento: Megaphone,
  lead: Wallet,
  mql: UserCheck,
  reuniao: CalendarCheck,
  proposta: Send,
  contrato: FileSignature,
  cac: Trophy,
  pasta: FolderCheck,
  perdidos: UserMinus,
};

export function useRotuloDoCartaoDeCusto(
  rotuloDoDegrau: (d: Degrau) => string,
): (cartao: CartaoDeCusto) => string {
  const t = useTranslations("Pipelines.funil.cartoesDeCusto");
  return (cartao) => {
    switch (cartao) {
      case "investimento":
        return t("investimento");
      case "lead":
        return t("lead");
      case "contrato":
        return t("contrato");
      case "cac":
        return t("cac");
      case "perdidos":
        return t("perdidos");
      case "mql":
      case "reuniao":
      case "proposta":
      case "pasta":
        return t("porDegrau", { degrau: noMeioDaFrase(rotuloDoDegrau(cartao)) });
    }
  };
}
