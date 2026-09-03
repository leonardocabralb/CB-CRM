"use client";

// ============================================================
// Responsável pela conversa — o menu de atribuição, que MOROU no cabeçalho
// do fio até 2026-09-03 e saiu de lá a pedido do operador ("desobstruir a
// camada de cima, onde a gente tem a conexão e a situação"). Agora vive no
// cabeçalho do painel lateral, logo abaixo do nome — visível em qualquer
// aba, como o "Responsável" do Chatguru.
//
// É o MESMO menu que o fio tinha (perfis sob RLS, presença ao lado de cada
// nome, "Remover atribuição" no fim), num arquivo próprio para servir aos
// DOIS painéis: a ficha do contato e o painel de grupo — atribuir grupo a
// alguém foi decisão explícita do operador, e tirar o menu do fio sem levar
// ao painel de grupo apagaria isso em silêncio.
//
// A escrita continua sendo `conversations.assigned_agent_id` direto, sob
// RLS, e a página espelha no estado por `onAssignChange` — o mesmo contrato
// que o fio cumpria.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { PresenceDot } from "@/components/presence/presence-dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { presenceLabel } from "@/lib/presence";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Profile } from "@/types";

export function ResponsavelMenu({
  conversationId,
  assignedAgentId,
  onAssignChange,
  className,
}: {
  conversationId: string;
  assignedAgentId: string | null;
  onAssignChange: (conversationId: string, assignedAgentId: string | null) => void;
  className?: string;
}) {
  const t = useTranslations("Inbox.messageThread");
  const { user } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Perfis sob RLS — hoje só os membros da conta. Uma busca por montagem,
  // como o fio fazia.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const atribuir = useCallback(
    async (agentId: string | null) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversationId);
      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error(t("assignUpdateFailed"));
        return;
      }
      onAssignChange(conversationId, agentId);
    },
    [conversationId, onAssignChange, t],
  );

  const atual = profiles.find((p) => p.user_id === assignedAgentId);
  const rotulo = assignedAgentId
    ? (atual?.full_name ?? t("assigned"))
    : t("assign");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted",
          assignedAgentId ? "text-foreground" : "text-muted-foreground",
          className,
        )}
        title={t("assignee")}
      >
        <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-muted-foreground">{t("assignee")}</span>
        <span className="min-w-0 flex-1 truncate text-left font-medium">{rotulo}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="border-border bg-popover">
        {profiles.length === 0 ? (
          <DropdownMenuItem disabled className="text-sm text-muted-foreground">
            {t("noTeammates")}
          </DropdownMenuItem>
        ) : (
          profiles.map((p) => {
            const isSelected = p.user_id === assignedAgentId;
            const presence = getPresence(p.user_id);
            return (
              <DropdownMenuItem
                key={p.id}
                onClick={() => void atribuir(p.user_id)}
                className={cn(
                  "text-sm",
                  isSelected ? "text-primary" : "text-popover-foreground",
                )}
              >
                <PresenceDot
                  status={presence}
                  label={presenceLabel(
                    presence,
                    getRow(p.user_id)?.last_seen_at ?? null,
                    now,
                  )}
                  className="mr-2"
                />
                <span className="flex-1">
                  {p.full_name}
                  {p.user_id === user?.id ? t("me") : ""}
                </span>
                {isSelected && <Check className="ml-2 h-3 w-3" />}
              </DropdownMenuItem>
            );
          })
        )}
        {assignedAgentId && (
          <>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              onClick={() => void atribuir(null)}
              className="text-sm text-muted-foreground"
            >
              {t("unassign")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
