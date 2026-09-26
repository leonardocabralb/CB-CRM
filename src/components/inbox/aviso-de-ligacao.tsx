"use client";

import { format } from "date-fns";
import { PhoneIncoming, PhoneMissed, Video } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { Message } from "@/types";

/**
 * A ligação no fio (1044), como o próprio WhatsApp a mostra: uma faixa no meio
 * da conversa, sem balão, sem horário de envio e sem ações — responder, reagir
 * ou apagar uma ligação não quer dizer nada.
 *
 * A hora escrita é a de quando COMEÇOU a tocar (`ligacao.inicio`), não o
 * `created_at` da linha: a linha nasce quando o CRM decide o desfecho, alguns
 * segundos depois do fim (ver `lib/whatsapp/ligacoes/registrar.ts`).
 *
 * ⚠️ A cor da perdida vive no ÍCONE e na borda, nunca no texto: o par
 * `text-red-700 dark:text-red-300` resolve para o vermelho escuro nos dois
 * modos (o variant `dark:` está inerte, ver o CLAUDE.md), e ficaria ilegível
 * no tema escuro.
 */
export function AvisoDeLigacao({ message }: { message: Message }) {
  const t = useTranslations("Inbox.ligacao");
  const detalhes = message.ligacao ?? null;
  // Sem os detalhes (linha anterior a eles, ou gravada à mão), o lado da
  // conversa responde: a perdida é do cliente, a atendida é da equipe.
  const perdida = detalhes ? detalhes.desfecho === "perdida" : message.sender_type === "customer";
  const video = detalhes?.video === true;

  const inicio = Date.parse(detalhes?.inicio ?? message.created_at);
  const hora = Number.isFinite(inicio) ? format(new Date(inicio), "HH:mm") : null;

  const titulo = perdida
    ? video
      ? t("videoPerdida")
      : t("vozPerdida")
    : video
      ? t("videoAtendida")
      : t("vozAtendida");
  const partes = [titulo];
  if (hora) partes.push(hora);
  if (perdida && typeof detalhes?.tocou_seg === "number") {
    partes.push(t("tocou", { segundos: detalhes.tocou_seg }));
  }

  const Icone = video ? Video : perdida ? PhoneMissed : PhoneIncoming;

  return (
    <div className="flex justify-center py-1">
      <span
        title={perdida ? t("dicaPerdida") : undefined}
        className={cn(
          "inline-flex max-w-[85%] items-center gap-1.5 rounded-full border px-3 py-1 text-center text-[11px] leading-snug",
          perdida
            ? "border-red-500/40 bg-red-500/10 text-foreground"
            : "border-transparent bg-muted/70 text-muted-foreground",
        )}
      >
        <Icone
          aria-hidden
          className={cn("h-3.5 w-3.5 shrink-0", perdida && "text-red-600")}
        />
        <span>{partes.join(" · ")}</span>
      </span>
    </div>
  );
}
