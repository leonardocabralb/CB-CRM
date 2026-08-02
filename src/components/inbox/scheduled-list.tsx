"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Clock,
  Loader2,
  Send,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAgendadas } from "@/hooks/use-agendadas";
import {
  clienteEscreveuDepois,
  estaAtrasada,
  ordenarParaTela,
  podeDispararAgora,
} from "@/lib/scheduled/display";
import { cn } from "@/lib/utils";
import type { ScheduledMessage } from "@/types";

interface ScheduledListProps {
  conversationId: string | null;
  /** `false` esconde os botões — `viewer` só olha. */
  podeAgir: boolean;
  /** Sinal externo para refazer a busca (agendou pelo compositor). */
  resyncToken?: number;
}

/**
 * As mensagens agendadas desta conversa (migration 925).
 *
 * Seção, não aba: a ficha do inbox é uma coluna rolável de seções — o
 * "Histórico" da 912 também é. Entra nas DUAS fichas (contato e grupo)
 * porque a P4.7 deixou grupo receber agendada.
 *
 * ⚠️ Esta é a única tela onde a agendada aparece. Não há lista global na v1:
 * mensagem marcada numa conversa que ninguém abre fica invisível até a hora.
 */
export function ScheduledList({
  conversationId,
  podeAgir,
  resyncToken,
}: ScheduledListProps) {
  const t = useTranslations("Inbox.scheduled");
  const { agendadas, ultimaEntradaEm, carregando, falhou, recarregar } =
    useAgendadas(conversationId);
  const [ocupada, setOcupada] = useState<string | null>(null);

  // Refaz a busca quando o compositor agenda. `resyncToken` muda de valor;
  // o hook não sabe nada sobre o compositor.
  const [ultimoToken, setUltimoToken] = useState(resyncToken);
  if (resyncToken !== ultimoToken) {
    setUltimoToken(resyncToken);
    recarregar();
  }

  const lista = ordenarParaTela(agendadas);

  async function enviarAgora(a: ScheduledMessage) {
    setOcupada(a.id);
    try {
      const res = await fetch(`/api/cb/scheduled/${a.id}/run`, {
        method: "POST",
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) toast.error(json.error ?? t("sendNowFailed"));
      else toast.success(t("sentNow"));
    } catch {
      toast.error(t("sendNowFailed"));
    } finally {
      setOcupada(null);
      recarregar();
    }
  }

  async function apagar(a: ScheduledMessage) {
    // ⚠️ O texto fala em "cancelar o envio agendado", nunca em "apagar
    // mensagem": na bolha do chat "Apagar" quer dizer revogar no WhatsApp do
    // cliente, e confundir os dois faz alguém achar que está desfazendo algo
    // que o cliente já viu.
    if (!window.confirm(t("cancelConfirm"))) return;
    setOcupada(a.id);
    const supabase = createClient();
    const { error } = await supabase
      .from("cb_scheduled_messages")
      .delete()
      .eq("id", a.id);
    setOcupada(null);
    if (error) toast.error(t("cancelFailed"));
    else toast.success(t("canceled"));
    recarregar();
  }

  if (!conversationId) return null;

  return (
    <div>
      <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Clock className="h-3 w-3" />
        {t("sectionTitle")}
      </div>

      <div className="mt-2 space-y-2">
        {carregando ? (
          <p className="px-1 text-xs text-muted-foreground">{t("loading")}</p>
        ) : falhou ? (
          // ⚠️ Distinto de "não há nada": lista vazia por falha faria alguém
          // reescrever uma mensagem que já está marcada, e o cliente
          // receberia duas.
          <p className="px-1 text-xs text-muted-foreground">
            {t("loadFailed")}
          </p>
        ) : lista.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          lista.map((a) => {
            const atrasada = estaAtrasada(a);
            const respondeu = clienteEscreveuDepois(a, ultimaEntradaEm);
            return (
              <div
                key={a.id}
                className={cn(
                  "rounded-lg border border-border bg-muted px-3 py-2",
                  a.status === "failed" && "border-destructive/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t(`status_${a.status}`)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {new Date(a.scheduled_for).toLocaleString(undefined, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <p className="mt-1 whitespace-pre-wrap text-xs text-foreground">
                  {a.body}
                </p>

                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t("scheduledBy", { name: a.autor_nome })}
                </p>

                {a.error && (
                  <p className="mt-1 text-[10px] text-destructive">{a.error}</p>
                )}

                {/* ⚠️ Passou da hora e continua pendente = o agendador não
                    está rodando. É a única pista que o operador tem disso —
                    sem ela, um agendador desligado é invisível, que foi
                    exatamente o que aconteceu com o cron das automações. */}
                {atrasada && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {t("overdue")}
                  </p>
                )}

                {/* P4.4: não impede o envio, só avisa. */}
                {respondeu && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {t("customerRepliedSince")}
                  </p>
                )}

                {podeAgir && (
                  <div className="mt-2 flex items-center gap-3">
                    {podeDispararAgora(a.status) && (
                      <button
                        type="button"
                        onClick={() => void enviarAgora(a)}
                        disabled={ocupada === a.id}
                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                      >
                        {ocupada === a.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Send className="h-3 w-3" />
                        )}
                        {a.status === "failed" ? t("retry") : t("sendNow")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void apagar(a)}
                      disabled={ocupada === a.id}
                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t("cancel")}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
