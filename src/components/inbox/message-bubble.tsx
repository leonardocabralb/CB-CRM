"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Sparkles,
  Smartphone,
  Trash2,
  Pencil,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { FormattedText } from "./formatted-text";
import { MediaViewer } from "./media-viewer";
import { MessageReactions } from "./message-reactions";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /**
   * Rótulo do canal (cb_channels) por onde a mensagem passou. O thread só
   * o preenche em conta multi-canal (2+ números) — senão é ruído.
   */
  channelLabel?: string | null;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

/**
 * Anexo ainda em trânsito. O webhook grava a MENSAGEM primeiro e busca o
 * arquivo depois (assim uma falha no download não leva a mensagem junto),
 * então existe uma janela de segundos em que a bolha tem tipo de mídia e
 * `media_url` nulo. Sem distinguir, essa janela mostrava "indisponível" —
 * dizendo que o anexo se perdeu quando ele estava a caminho.
 *
 * A janela é decidida pela idade da mensagem porque não há estado no banco
 * para consultar: recém-chegada = baixando; antiga = o download falhou
 * mesmo. O teto é generoso (o download tem 30s de teto, mais a fila).
 */
const JANELA_DOWNLOAD_MS = 2 * 60 * 1000;

function anexoAindaChegando(message: Message): boolean {
  if (message.media_url) return false;
  const idade = Date.now() - new Date(message.created_at).getTime();
  return idade >= 0 && idade < JANELA_DOWNLOAD_MS;
}

function MediaLoading({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
      <span>{t("attachmentLoading")}</span>
    </div>
  );
}

function MediaUnavailable({ label, t }: { label: string, t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{t("unavailable", { label })}</span>
    </div>
  );
}

/** Falta o anexo: ou está baixando, ou se perdeu. */
function MediaPendente({
  message,
  label,
  t,
}: {
  message: Message;
  label: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const [chegando, setChegando] = useState(() => anexoAindaChegando(message));

  // A janela expira sozinha: sem isto a bolha ficaria girando para sempre
  // quando o download realmente falhasse, porque nada a re-renderiza.
  useEffect(() => {
    if (!chegando) return;
    const restante =
      JANELA_DOWNLOAD_MS - (Date.now() - new Date(message.created_at).getTime());
    const timer = setTimeout(() => setChegando(false), Math.max(0, restante));
    return () => clearTimeout(timer);
  }, [chegando, message.created_at]);

  return chegando ? <MediaLoading t={t} /> : <MediaUnavailable label={label} t={t} />;
}

/**
 * Nome sugerido no download. O caminho no bucket já carrega o nome original
 * do arquivo (`buildMediaPath` prefixa um carimbo de tempo), então o
 * basename é o melhor palpite disponível sem consultar mais nada.
 */
function nomeDeArquivo(message: Message): string | undefined {
  if (!message.media_url) return undefined;
  try {
    const caminho = new URL(message.media_url, window.location.origin).pathname;
    const base = decodeURIComponent(caminho.split("/").pop() ?? "");
    return base || undefined;
  } catch {
    return undefined;
  }
}

function MediaImage({ url, alt, fileName }: { url: string; alt: string; fileName?: string }) {
  const tv = useTranslations("Inbox.mediaViewer");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [ampliada, setAmpliada] = useState(false);

  const loadImage = useCallback(async () => {
    if (!url) return;

    // Proxy URLs need auth fetch to create blob URL
    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setSrc(blobUrl);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    loadImage();
    return () => {
      if (src?.startsWith("blob:")) {
        URL.revokeObjectURL(src);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadImage]);

  if (error) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAmpliada(true)}
        title={tv("open")}
        aria-label={tv("open")}
        className="block cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <img
          src={src ?? ""}
          alt={alt}
          className="max-h-64 max-w-60 rounded-lg object-cover"
          onError={() => setError(true)}
        />
      </button>
      {ampliada && src && (
        <MediaViewer
          src={src}
          alt={alt}
          fileName={fileName}
          onClose={() => setAmpliada(false)}
        />
      )}
    </>
  );
}

function MessageContent({ message, t }: { message: Message, t: ReturnType<typeof useTranslations> }) {
  switch (message.content_type) {
    case "text":
      return (
        <FormattedText texto={message.content_text} />
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage
              url={message.media_url}
              alt={message.content_text || t("photo")}
              fileName={nomeDeArquivo(message)}
            />
          ) : (
            <MediaPendente message={message} label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <FormattedText texto={message.content_text} className="mt-1" />
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <video
              src={message.media_url}
              controls
              className="max-h-64 max-w-60 rounded-lg"
            />
          ) : (
            <MediaPendente message={message} label={t("video")} t={t} />
          )}
          {message.content_text && (
            <FormattedText texto={message.content_text} className="mt-1" />
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <audio src={message.media_url} controls className="max-w-60" />
          ) : (
            <MediaPendente message={message} label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaPendente message={message} label={message.content_text || t("document")} t={t} />;
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || t("document")}
          </span>
        </a>
      );

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <FormattedText texto={message.content_text} className="mt-1" />
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <FormattedText texto={message.content_text || t("interactiveReply")} />
          </div>
        );
      }
      return (
        <FormattedText texto={message.content_text || t("interactiveReply")} />
      );
    }

    default:
      return (
        <FormattedText texto={message.content_text || t("unsupported")} />
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  channelLabel,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");
  // Confirmada pelo WhatsApp × só pedida por nós. As duas riscam a bolha,
  // mas dizem coisas diferentes — e a diferença importa: um pedido sem
  // confirmação pode significar que a mensagem segue no celular do cliente.
  const confirmada = !!message.deleted_at;
  const soPedida = !confirmada && !!message.delete_requested_at;
  const apagada = confirmada || soPedida;

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {apagada && (
          <span
            className={cn(
              "mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase leading-none tracking-wide",
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
            title={soPedida ? t("deleteRequestedHint") : undefined}
          >
            <Trash2 className="h-2.5 w-2.5" />
            {soPedida
              ? t("deleteRequested")
              : message.deleted_by === "customer"
                ? t("deletedByCustomer")
                : message.deleted_by === "agent"
                  ? t("deletedByUs")
                  : // Sem autor registrado, não se afirma quem apagou. O
                    // rótulo antigo dizia "Apagada" (= por nós) em qualquer
                    // caso que não fosse o cliente, inclusive neste.
                    t("deletedUnknown")}
          </span>
        )}
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        {/* O estilo de apagada fica NESTE invólucro, não no contêiner da
            bolha: o visualizador de mídia em tela cheia é renderizado como
            descendente e herdaria o `opacity-60`, deixando a foto ampliada
            desbotada sem motivo. */}
        <div
          className={cn(
            apagada && "opacity-60 [&_p]:line-through [&_a]:line-through [&_code]:line-through",
          )}
        >
          <MessageContent message={message} t={t} />
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.edited_at && !apagada && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[9px]",
                isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
              )}
              // O texto anterior só existe aqui: o WhatsApp não guarda
              // histórico de edição.
              title={
                message.text_before_edit
                  ? t("editedWas", { text: message.text_before_edit })
                  : t("edited")
              }
            >
              <Pencil className="h-2.5 w-2.5" />
              {t("edited")}
            </span>
          )}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          {/* Enviada pelo celular pareado, não pelo CRM. Num número
              atendido por várias pessoas isso importa: sem a marca, a
              equipe não tem como saber que aquela resposta não passou
              pelo sistema (e portanto não gerou registro, automação nem
              atribuição). */}
          {message.from_device && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("fromDeviceTitle")}
            >
              <Smartphone className="h-2.5 w-2.5" />
              {t("fromDevice")}
            </span>
          )}
          {channelLabel && (
            <span
              title={t("viaChannel", { label: channelLabel })}
              className={cn(
                "max-w-[7rem] truncate text-[9px]",
                isAgent ? "text-primary-foreground/60" : "text-muted-foreground",
              )}
            >
              {channelLabel}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
