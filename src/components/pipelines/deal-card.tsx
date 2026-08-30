"use client";

import { memo } from "react";
import type { Deal, PipelineStage } from "@/types";
import type { CbChannel } from "@/lib/cb-channels/repo";
import { Calendar, Check, Pencil, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import { findChannel } from "@/lib/cb-channels/display";
import { conversaDoCard, type DealDoQuadro } from "@/lib/pipelines/cartao";
import type { CamposDoCard } from "@/lib/pipelines/campos-do-card";
import { stripWhatsAppFormat } from "@/lib/inbox/whatsapp-format";

interface DealCardProps {
  deal: DealDoQuadro;
  stage: PipelineStage | null;
  /** O que o card exibe — escolha por dispositivo (popover da barra). */
  campos: CamposDoCard;
  /** Carregados UMA vez pelo board — um hook aqui custaria um GET por card. */
  channels: CbChannel[];
  onEdit: (deal: Deal) => void;
  /** Clique no corpo do card, quando há conversa para abrir. */
  onAbrirConversa: (conversationId: string) => void;
  isOverlay?: boolean;
}

// Um formatter de módulo: `toLocaleDateString` cria um Intl.DateTimeFormat a
// cada chamada, e isso custava ~2,7ms por passe de 120 cards (medido).
const FORMATO_DE_DATA = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(dateStr: string) {
  // `expected_close_date` is a Postgres DATE, so PostgREST sends it as a
  // date-only string ("2026-05-18"). `new Date()` parses that as UTC
  // midnight, which lands on the previous day in any negative-offset
  // timezone — the whole of Brazil. Appending a time makes the spec parse
  // it as local midnight instead. Timestamps that already carry a time are
  // left untouched.
  const local = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? `${dateStr}T00:00:00`
    : dateStr;
  return FORMATO_DE_DATA.format(new Date(local));
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

// `memo` porque o board redesenha os ~120 cards a cada tecla digitada em
// qualquer diálogo irmão — com props estáveis (o board usa useCallback nos
// handlers), o card só re-renderiza quando o SEU dado muda.
export const DealCard = memo(function DealCard({
  deal,
  stage,
  campos,
  channels,
  onEdit,
  onAbrirConversa,
  isOverlay,
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  // Por qual número o cliente CHEGOU (908). Com um canal só a etiqueta não
  // responde nada e vira poluição em todo card — mesma convenção do seletor
  // de canal. Card sem `channel_id` (criado à mão, ou anterior à 908)
  // simplesmente não exibe: inventar o canal padrão seria mentir sobre a
  // origem, que é justamente o que esta etiqueta existe para contar.
  const canalDeOrigem =
    campos.canal && channels.length > 1
      ? findChannel(channels, deal.channel_id)
      : null;

  // A conversa que o corpo abre (a do CONTATO; vínculo da 910 é fallback —
  // ver conversaDoCard). Sem nenhuma, o clique cai no formulário de sempre.
  const conversa = conversaDoCard(deal);
  const resumo = conversa?.resumo ?? null;

  const etiquetas = campos.etiquetas ? (deal.contact?.tags ?? []) : [];
  // Sem useMemo aqui de propósito: o React Compiler (ativo no projeto) já
  // memoiza este componente e recusava preservar o memo manual.
  const ultimaMensagem =
    campos.ultimaMensagem && resumo?.last_message_text
      ? stripWhatsAppFormat(resumo.last_message_text)
      : null;
  const naoLidas = campos.naoLidas ? (resumo?.unread_count ?? 0) : 0;

  const editar = (e: React.MouseEvent) => {
    if (isOverlay) return;
    e.stopPropagation();
    onEdit(deal);
  };

  return (
    // ⚠️ O lápis NÃO pode ficar dentro do botão do card: `<button>` dentro de
    // `<button>` é HTML inválido e o navegador desmonta a árvore sozinho.
    // Mesmo padrão da estrela de favoritar na lista do inbox: irmãos num
    // wrapper `relative`, com a linha do título reservando a faixa (pr-7).
    <div
      className={`relative rounded-xl border border-border/50 bg-muted/70 shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color. `pointer-events-none` é
          load-bearing: como irmã POSICIONADA do botão, sem ele a barra ganha
          o hit-test e os 4px da borda viram zona morta de clique. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      {/* Sem aria-label: o nome acessível vem do CONTEÚDO (título, selo,
          contato, valor, não lidas…), como no card original — um rótulo fixo
          esconderia de leitores de tela justamente os campos novos. */}
      <button
        type="button"
        onClick={(e) => {
          // `onClick` still fires after a non-drag tap because the PointerSensor
          // requires 5px movement before it counts as a drag.
          if (isOverlay) return;
          e.stopPropagation();
          if (conversa) onAbrirConversa(conversa.id);
          else onEdit(deal);
        }}
        className="block w-full cursor-pointer rounded-xl py-3 pl-4 pr-3 text-left"
      >
        <div className="flex items-start justify-between gap-2 pr-7">
          <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
            {deal.title}
          </h4>
          {deal.status === "won" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              <Check className="h-3 w-3" />
              {t("won")}
            </span>
          )}
          {deal.status === "lost" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
              <X className="h-3 w-3" />
              {t("lost")}
            </span>
          )}
        </div>

        {/* Contact row */}
        <div className="mt-2 flex items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
            {initials(deal.contact?.name, deal.contact?.phone)}
          </span>
          <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
          {canalDeOrigem && (
            <span
              title={t("cameFrom", { channel: canalDeOrigem.label })}
              className="ml-auto shrink-0 truncate rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {canalDeOrigem.label}
            </span>
          )}
        </div>

        {/* Etiquetas do contato — mesmo chip do resto do app (cor da tag a 20%) */}
        {etiquetas.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {etiquetas.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            {etiquetas.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{etiquetas.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Última mensagem + não lidas — o resumo vem de `conversaDoCard`;
            no fallback pelo vínculo histórico (contato apagado, plano B) ele
            é null e nada aqui pinta dado de outra linha. */}
        {(ultimaMensagem || naoLidas > 0) && (
          <div className="mt-2 flex items-center justify-between gap-2">
            {ultimaMensagem ? (
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {ultimaMensagem}
              </span>
            ) : (
              <span className="min-w-0 flex-1" />
            )}
            {naoLidas > 0 && (
              <span
                title={t("unreadCount", { count: naoLidas })}
                className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground"
              >
                {naoLidas}
              </span>
            )}
          </div>
        )}

        {(campos.valor || (campos.dataPrevista && deal.expected_close_date)) && (
          <div className="mt-2 flex items-center justify-between gap-2">
            {campos.valor ? (
              <span className="text-sm font-bold text-primary">
                {formatCurrency(deal.value)}
              </span>
            ) : (
              <span />
            )}
            {campos.dataPrevista && deal.expected_close_date && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {formatDate(deal.expected_close_date)}
              </span>
            )}
          </div>
        )}

        {campos.responsavel && assigneeLabel && (
          <div className="mt-2 flex items-center justify-end">
            <span
              title={assigneeLabel}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
            >
              {initials(assigneeLabel)}
            </span>
          </div>
        )}
      </button>

      {/* Editar o negócio — a função que o clique no corpo tinha antes.
          Sempre visível: no celular (onde este quadro é usado de verdade)
          não existe hover. */}
      <button
        type="button"
        aria-label={t("editDealTitled", { titulo: deal.title })}
        title={t("editDeal")}
        onClick={editar}
        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
