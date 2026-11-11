import type { useTranslations } from "next-intl";

import type { AutomacaoDoModulo, EtapaDoModulo } from "@/lib/asaas/modulo-da-cobranca";

/** O que `GET /api/cb/asaas/regua/modulo` devolve (tela "Cobrança automática", 1135). */
export interface RespostaDoModulo {
  conectado: boolean;
  config?: {
    ativa: boolean;
    ativadaEm: string | null;
    intervaloDias: number;
    escritorioNome: string | null;
    escritorioPadrao: string;
    avisoAtivo: boolean;
    assinaturaAtiva: boolean;
  };
  automacoes?: AutomacaoDoModulo[];
  envios7d?: { lembretes: number; cobrancas: number; falhas: number } | null;
  ligacoesPendentes?: number | null;
}


export type T = ReturnType<typeof useTranslations<"Settings.integracoes.cobranca">>;

export function rotuloDaEtapa(e: EtapaDoModulo, t: T): string {
  if (e.tipo === "lembrete") return e.turno === "noite" ? t("etapa.lembreteNoite") : t("etapa.lembreteDia");
  return t("etapa.cobranca", { dias: e.dias ?? 0 });
}

