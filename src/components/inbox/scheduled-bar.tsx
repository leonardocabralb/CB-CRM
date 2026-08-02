"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  Loader2,
  Trash2,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAgendadas } from "@/hooks/use-agendadas";
import { useChannels } from "@/hooks/use-channels";
import { channelLabel } from "@/lib/cb-channels/display";
import {
  clienteEscreveuDepois,
  estaAtrasada,
  ordenarParaTela,
  podeDispararAgora,
} from "@/lib/scheduled/display";
import { cn } from "@/lib/utils";
import type { ScheduledMessage } from "@/types";

interface ScheduledBarProps {
  conversationId: string | null;
  /** `false` esconde os botões — `viewer` só olha. */
  podeAgir: boolean;
  /** Sinal externo para refazer a busca (agendou pelo compositor). */
  resyncToken?: number;
}

/**
 * A faixa AGENDADAS, logo acima do compositor (migration 925).
 *
 * ⚠️ FICA NO FIO, não na ficha lateral, e a diferença é de uso: quem abre a
 * conversa precisa VER que existe mensagem marcada antes de escrever — senão
 * escreve por cima e o cliente recebe duas. Na coluna da direita a
 * informação até existia, mas ninguém tropeçava nela.
 *
 * ⚠️ Só aparece quando há o que mostrar, e "o que mostrar" é a FILA (mais o
 * que falhou, que pede decisão). Agendada já ENVIADA sai daqui de propósito:
 * ela virou uma bolha no fio logo acima, e repeti-la numa faixa permanente
 * seria a mesma mensagem contada duas vezes, para sempre.
 */
export function ScheduledBar({
  conversationId,
  podeAgir,
  resyncToken,
}: ScheduledBarProps) {
  const t = useTranslations("Inbox.scheduled");
  const { agendadas, ultimaEntradaEm, falhou, recarregar } =
    useAgendadas(conversationId);
  const [aberta, setAberta] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);
  // P4.3 pediu o canal no card. Só aparece com 2+ números: num só ele não
  // informa nada e ocupa a linha que carrega o texto da mensagem.
  const { channels } = useChannels();
  const mostrarCanal = channels.length > 1;

  // Refaz a busca quando o compositor agenda. `resyncToken` muda de valor;
  // o hook não sabe nada sobre o compositor.
  const [ultimoToken, setUltimoToken] = useState(resyncToken);
  if (resyncToken !== ultimoToken) {
    setUltimoToken(resyncToken);
    recarregar();
    // Acabou de agendar: abrir sozinha é o retorno visual de que deu certo.
    setAberta(true);
  }

  const naFila = ordenarParaTela(agendadas.filter((a) => a.status !== "sent"));

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
    //
    // ⚠️ E o texto MUDA em `sending`/entrega incerta. Ali a promessa "a
    // mensagem não vai sair" seria falsa: o worker já reivindicou a linha, ou
    // o WhatsApp já aceitou. Apagar continua permitido — é a única saída para
    // uma linha travada —, mas quem aperta precisa saber o que está e o que
    // não está desfazendo.
    const incerta = a.status === "sending" || a.entrega_incerta;
    if (!window.confirm(t(incerta ? "cancelConfirmUncertain" : "cancelConfirm"))) {
      return;
    }
    setOcupada(a.id);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("cb_scheduled_messages")
      .delete()
      .eq("id", a.id)
      .select("id");
    setOcupada(null);
    // ⚠️ Conferir o RESULTADO, não só o erro. Sem policy que case, a RLS
    // devolve zero linhas SEM erro — e um toast de sucesso mentiria. É a
    // armadilha que o CLAUDE.md descreve.
    if (error) toast.error(t("cancelFailed"));
    else if (!data?.length) toast.error(t("cancelNothing"));
    else toast.success(t("canceled"));
    recarregar();
  }

  if (!conversationId) return null;

  // ⚠️ A faixa some quando não há fila — MENOS quando a busca falhou. Sumir
  // por falha afirmaria "não há nada marcado" sem ninguém ter perguntado, e é
  // justamente essa frase que faz o atendente escrever a mesma coisa de novo.
  if (falhou && naFila.length === 0) {
    return (
      <div className="mx-3 mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {t("loadFailed")}
      </div>
    );
  }
  if (naFila.length === 0) return null;

  return (
    <div className="mx-3 mt-2 overflow-hidden rounded-lg border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted"
      >
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        {t("sectionTitle")}
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {naFila.length}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
            aberta && "rotate-180",
          )}
        />
      </button>

      {aberta && (
        <div className="max-h-56 space-y-2 overflow-y-auto border-t border-border px-3 py-2">
          {naFila.map((a) => {
            const atrasada = estaAtrasada(a);
            const respondeu = clienteEscreveuDepois(a, ultimaEntradaEm);
            return (
              <div
                key={a.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2",
                  a.status === "failed" && "border-destructive/40",
                )}
              >
                <div className="w-[5.5rem] shrink-0">
                  <span
                    className={cn(
                      "inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                      a.status === "failed"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-primary/15 text-primary",
                    )}
                  >
                    {t(`status_${a.status}`)}
                  </span>
                  <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                    {new Date(a.scheduled_for).toLocaleString(undefined, {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-xs text-foreground">
                    {a.body}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {t("scheduledBy", { name: a.autor_nome })}
                    {mostrarCanal && (
                      <>
                        {" · "}
                        {channelLabel(channels, a.channel_id) ?? t("channelGone")}
                      </>
                    )}
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

                  {/* ⚠️ 926: falhou DEPOIS de o WhatsApp aceitar. Sem esta
                      linha, "Falhou" convida a mandar de novo — e o cliente
                      recebe duas vezes. O botão de retentar já sumiu; o
                      recado explica por quê. */}
                  {a.entrega_incerta && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {t("uncertainDelivery")}
                    </p>
                  )}

                  {/* P4.4: não impede o envio, só avisa. */}
                  {respondeu && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-amber-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {t("customerRepliedSince")}
                    </p>
                  )}
                </div>

                {podeAgir && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {podeDispararAgora(a) && (
                      <button
                        type="button"
                        onClick={() => void enviarAgora(a)}
                        disabled={ocupada === a.id}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-[10px] font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
                      >
                        {ocupada === a.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Zap className="h-3 w-3" />
                        )}
                        {a.status === "failed" ? t("retry") : t("sendNow")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void apagar(a)}
                      disabled={ocupada === a.id}
                      title={t("cancel")}
                      aria-label={t("cancel")}
                      // ⚠️ `text-white`, não `text-destructive-foreground`:
                      // neste tema aquele token resolve para uma cor escura,
                      // e a lixeira saía preta em cima do vermelho.
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-destructive text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
