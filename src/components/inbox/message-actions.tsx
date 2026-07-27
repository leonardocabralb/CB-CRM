"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CornerUpLeft, Copy, SmilePlus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Message } from "@/types";
import { useTranslations } from "next-intl";

// WhatsApp's own quick-reaction bar starts with these six. Picking the same
// set keeps the affordance familiar without pulling in a 300KB emoji library.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /**
   * Apagar/editar só existem em canal EVOLUTION — a API oficial da Meta não
   * expõe nenhum dos dois. Sem esta informação os botões apareceriam numa
   * conta Meta e o operador tentaria uma ação que não pode dar certo.
   */
  channelKind?: "meta" | "evolution" | null;
  onDelete?: () => void;
  onEdit?: () => void;
  children: ReactNode;
}

/** Prazos do WhatsApp. Fora deles a Evolution recusa, então o botão some. */
const MINUTOS_PARA_EDITAR = 15;
const HORAS_PARA_APAGAR = 48;

/**
 * Hover/long-press toolbar wrapper around a `<MessageBubble>`. The bubble
 * itself stays a pure presenter — this component owns the action surface so
 * the bubble's render path is unaffected when the toolbar isn't visible.
 */
export function MessageActions({
  message,
  onReply,
  onReact,
  channelKind = null,
  onDelete,
  onEdit,
  children,
}: MessageActionsProps) {
  const t = useTranslations("Inbox.actions");

  // Só mensagem NOSSA, em canal Evolution, dentro do prazo do WhatsApp, e
  // que ainda não tenha sido apagada. Esconder é melhor que deixar tentar e
  // receber erro — o operador não tem como saber os prazos de cabeça.
  const nossa = message.sender_type !== "customer";
  const podeMexer = channelKind === "evolution" && nossa && !message.deleted_at;

  // Os prazos são ABSOLUTOS, derivados de `created_at` — puro, sem relógio
  // no render. Chamar `Date.now()` ali deixaria o botão "Editar" visível
  // depois dos 15 minutos até algo forçar um novo render por acaso.
  const enviadaEm = new Date(message.created_at).getTime();
  const prazoEditar = enviadaEm + MINUTOS_PARA_EDITAR * 60_000;
  const prazoApagar = enviadaEm + HORAS_PARA_APAGAR * 3_600_000;

  // O relógio entra UMA vez, no inicializador — nunca no corpo do render.
  // Cada mensagem tem sua própria instância (o thread usa `key={msg.id}`),
  // então este estado nunca precisa ser recalculado para outra mensagem.
  const [vencido, setVencido] = useState(() => ({
    editar: Date.now() > prazoEditar,
    apagar: Date.now() > prazoApagar,
  }));

  // Temporizadores que disparam EXATAMENTE na virada de cada prazo, e só
  // enquanto a mensagem ainda está dentro dele. Sem relógio global e sem
  // intervalo por mensagem — numa conversa longa isso pesaria.
  useEffect(() => {
    if (!podeMexer) return;
    const agora = Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (agora <= prazoEditar) {
      timers.push(
        setTimeout(() => setVencido((v) => ({ ...v, editar: true })), prazoEditar - agora),
      );
    }
    if (agora <= prazoApagar) {
      timers.push(
        setTimeout(() => setVencido((v) => ({ ...v, apagar: true })), prazoApagar - agora),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [podeMexer, prazoEditar, prazoApagar]);

  const podeApagar = !!onDelete && podeMexer && !vencido.apagar;
  const podeEditar =
    !!onEdit && podeMexer && !vencido.editar && message.content_type === "text";

  // Touch devices have no hover. Long-press fires `contextmenu`; we capture
  // it, suppress the native menu, and pin the toolbar open until the user
  // interacts elsewhere.
  const [touchOpen, setTouchOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setTouchOpen(true);
  };

  const handleCopy = async () => {
    const text = message.content_text ?? "";
    if (!text) {
      toast.error(t("nothingToCopy"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
    setTouchOpen(false);
  };

  const handlePickEmoji = (emoji: string) => {
    onReact(emoji);
    setPickerOpen(false);
    setTouchOpen(false);
  };

  const handleReply = () => {
    onReply();
    setTouchOpen(false);
  };

  // Row alignment lives here (not in MessageBubble) so the `group/actions`
  // hover region matches the bubble's content width — hovering empty space
  // in the row no longer reveals the toolbar.
  return (
    <div
      className={cn(
        "flex w-full",
        isAgent ? "justify-end" : "justify-start",
      )}
      onContextMenu={handleContextMenu}
      onBlur={() => setTouchOpen(false)}
    >
      {/* `min-w-0` lets this flex child actually respect the 75% cap.
       *  Default `min-width: auto` lets content (a long quote preview,
       *  an unbroken URL) push past the cap and shove the row past
       *  100%, which used to bleed across into the contact-sidebar
       *  area. See issue #165. */}
      <div className="group/actions relative min-w-0 max-w-[75%]">
        {children}
      <div
        data-touch-open={touchOpen || pickerOpen ? "true" : undefined}
        className={cn(
          "absolute -top-3 z-10 flex h-7 items-center gap-0.5 rounded-full border border-border bg-popover/95 px-1 shadow-md backdrop-blur-sm transition-opacity",
          "opacity-0 group-hover/actions:opacity-100 group-focus-within/actions:opacity-100",
          "data-[touch-open=true]:opacity-100",
          isAgent ? "right-3" : "left-3",
        )}
      >
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("react")}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </PopoverTrigger>
          <PopoverContent
            className="flex w-auto flex-row gap-1 p-1.5"
            sideOffset={6}
          >
            {QUICK_EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => handlePickEmoji(e)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none transition-transform hover:scale-125 hover:bg-muted"
                aria-label={t("reactWith", { emoji: e })}
              >
                {e}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <button
          type="button"
          onClick={handleReply}
          className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("reply")}
        >
          <CornerUpLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("copyText")}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        {podeEditar && (
          <button
            type="button"
            onClick={() => {
              onEdit!();
              setTouchOpen(false);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {podeApagar && (
          <button
            type="button"
            onClick={() => {
              onDelete!();
              setTouchOpen(false);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-destructive/15 hover:text-destructive"
            aria-label={t("deleteForEveryone")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
