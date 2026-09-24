"use client";

// ============================================================
// O texto da bolinha de presença (dica e aria-label): "Online — ativo
// agora", "Offline — visto por último há 2 horas".
//
// Até a Fase 10 do merge do upstream isto era `presenceLabel` em
// `src/lib/presence.ts`, com as frases em inglês escritas no código — a aba
// Membros e o menu de responsável da conversa mostravam "Offline — last
// seen 2 hours ago" com o resto da tela em português. A moldura vem do
// dicionário (`Presence.*`); o "há 2 horas" vem de `formatLastSeen`, no
// idioma do app (`LOCALE_DAS_DATAS`), nunca no do navegador.
// ============================================================

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { LOCALE_DAS_DATAS } from "@/lib/idioma-das-datas";
import { formatLastSeen, type PresenceStatus } from "@/lib/presence";

export function useRotuloDePresenca() {
  const t = useTranslations("Presence");
  return useCallback(
    (
      status: PresenceStatus,
      lastSeenAt: string | null | undefined,
      now: number,
    ): string => {
      switch (status) {
        case "online":
          return t("online");
        case "away":
          return t("away");
        case "offline": {
          const quando = formatLastSeen(lastSeenAt, now, LOCALE_DAS_DATAS.code);
          return quando ? t("offlineLastSeen", { quando }) : t("offline");
        }
      }
    },
    [t],
  );
}
