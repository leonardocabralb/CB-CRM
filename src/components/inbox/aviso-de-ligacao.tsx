"use client";

import { useState } from "react";
import { format } from "date-fns";
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Video, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { PlayerDeAudio } from "@/components/inbox/player-de-audio";
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
 * A ligação pelo CRM (1134, `detalhes.pelo_crm`) é só REGISTRO (D6/D6b):
 * neutra, com quem ligou ou atendeu e a duração — nunca vermelha, nem a feita
 * que o cliente não atendeu (ninguém do escritório deixou de atender).
 *
 * ▶ Ouvir (4c): com a gravação no CRM (`gravacao` e `ligacao_id`), o player do
 * fio abre embaixo da faixa. O endereço é a ROTA estável
 * (`/api/cb/ligacoes/<id>/gravacao`), que confere o acesso à conversa e
 * redireciona para uma URL assinada curta do bucket PRIVADO — nunca a URL
 * assinada guardada na mensagem (ela expira). A transcrição é da 4d.
 *
 * ⚠️ A cor da perdida vive no ÍCONE e na borda, nunca no texto: o par
 * `text-red-700 dark:text-red-300` resolve para o vermelho escuro nos dois
 * modos (o variant `dark:` está inerte, ver o CLAUDE.md), e ficaria ilegível
 * no tema escuro.
 */
export function AvisoDeLigacao({ message }: { message: Message }) {
  const t = useTranslations("Inbox.ligacao");
  const [ouvindo, setOuvindo] = useState(false);
  const detalhes = message.ligacao ?? null;
  const peloCrm = detalhes?.pelo_crm === true;
  const feita = peloCrm && detalhes?.direcao === "feita";
  // Sem os detalhes (linha anterior a eles, ou gravada à mão), o lado da
  // conversa responde: a perdida é do cliente, a atendida é da equipe.
  const perdida = detalhes ? detalhes.desfecho === "perdida" : message.sender_type === "customer";
  const video = detalhes?.video === true;

  const inicio = Date.parse(detalhes?.inicio ?? message.created_at);
  const hora = Number.isFinite(inicio) ? format(new Date(inicio), "HH:mm") : null;

  const titulo = peloCrm
    ? feita
      ? t("feitaPeloCrm")
      : t("atendidaPeloCrm")
    : perdida
      ? video
        ? t("videoPerdida")
        : t("vozPerdida")
      : video
        ? t("videoAtendida")
        : t("vozAtendida");
  const partes = [titulo];
  if (peloCrm && detalhes?.atendente?.nome) partes.push(t("por", { nome: detalhes.atendente.nome }));
  if (hora) partes.push(hora);
  if (perdida && typeof detalhes?.tocou_seg === "number") {
    partes.push(t("tocou", { segundos: detalhes.tocou_seg }));
  }
  if (peloCrm && detalhes?.desfecho === "nao_atendida") {
    partes.push(t("naoAtendida"));
  } else if (peloCrm && typeof detalhes?.duracao_seg === "number") {
    const segundos = detalhes.duracao_seg % 60;
    const minutos = Math.floor(detalhes.duracao_seg / 60);
    partes.push(minutos > 0 ? t("duracaoMin", { minutos, segundos }) : t("duracaoSeg", { segundos }));
  }

  const Icone = video ? Video : feita ? PhoneOutgoing : perdida ? PhoneMissed : PhoneIncoming;
  const gravacao =
    peloCrm && detalhes?.gravacao === true && typeof detalhes.ligacao_id === "string"
      ? `/api/cb/ligacoes/${encodeURIComponent(detalhes.ligacao_id)}/gravacao`
      : null;

  return (
    <div className="flex flex-col items-center gap-1 py-1">
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
        {gravacao && (
          <button
            type="button"
            onClick={() => setOuvindo((aberto) => !aberto)}
            aria-expanded={ouvindo}
            title={ouvindo ? t("fecharGravacao") : t("ouvirDica")}
            className="-my-0.5 ml-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-medium text-foreground hover:bg-background/70"
          >
            {ouvindo ? <X aria-hidden className="h-3 w-3" /> : <Play aria-hidden className="h-3 w-3" />}
            {ouvindo ? t("fecharGravacao") : t("ouvir")}
          </button>
        )}
      </span>
      {gravacao && ouvindo && (
        // Teto como os quadros de carga da bolha (`w-64 max-w-full`): num fio
        // estreito o player não vaza para o lado.
        <div className="w-64 max-w-full rounded-xl bg-muted/70 px-3 py-2 text-foreground">
          <PlayerDeAudio src={gravacao} naBolhaDaEquipe={false} />
        </div>
      )}
    </div>
  );
}
