"use client";

// ============================================================
// Avatares de quem MAIS está com esta conversa aberta (956) — a pedido do
// operador, DISCRETO: fileira de bolinhas 20px sobrepostas no cabeçalho do
// fio, com o nome no tooltip. Some por completo quando não há ninguém (o
// caso de todo dia numa conta de um membro).
// ============================================================

import { useTranslations } from "next-intl";

import type { Profile } from "@/types";

interface AvataresNaConversaProps {
  /** user_ids de quem está vendo (já sem o próprio operador), ordem estável. */
  userIds: string[];
  /** Roster da conta — o fio já o carrega para o dropdown de atribuição. */
  profiles: Profile[];
}

export function AvataresNaConversa({ userIds, profiles }: AvataresNaConversaProps) {
  const t = useTranslations("Inbox.messageThread");

  if (userIds.length === 0) return null;

  const porUserId = new Map(profiles.map((p) => [p.user_id, p]));

  return (
    <div className="flex shrink-0 -space-x-1.5" aria-live="polite">
      {userIds.map((userId) => {
        const perfil = porUserId.get(userId);
        // Profile ainda não carregado (chegada por realtime antes do
        // roster): melhor nada do que uma bolinha anônima piscando.
        if (!perfil) return null;
        const nome = perfil.full_name || perfil.email;
        const rotulo = t("tambemNaConversa", { nome });
        return (
          <span
            key={userId}
            title={rotulo}
            aria-label={rotulo}
            className="border-card bg-muted text-foreground flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 text-[10px] font-semibold"
          >
            {perfil.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={perfil.avatar_url}
                alt={rotulo}
                className="h-full w-full object-cover"
              />
            ) : (
              nome.charAt(0).toUpperCase()
            )}
          </span>
        );
      })}
    </div>
  );
}
