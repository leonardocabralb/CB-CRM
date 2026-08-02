"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { useChannels } from "@/hooks/use-channels";
import { useLeadEvents } from "@/hooks/use-lead-events";
import { useConversationNotes } from "@/hooks/use-conversation-notes";
import { useCan } from "@/hooks/use-can";
import { ScheduledBar } from "./scheduled-bar";
import { intercalar, type ItemDaLinhaDoTempo } from "@/lib/lead-events/describe";
import {
  aplicarAssinatura,
  assinaturaExistente,
  nomeDePessoa,
  removerAssinatura,
} from "@/lib/assinatura/assinatura";
import { LeadEventLine } from "@/components/lead-events/lead-event-line";
import { NoteLine } from "./note-line";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
  InteractiveMessagePayload,
  ConversationNote,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
  PanelRightClose,
  BadgeCheck,
  QrCode,
  Users,
} from "lucide-react";
import { nomeDoGrupo } from "@/lib/cb-groups/display";
import type { CbChannel } from "@/lib/cb-channels/repo";
import { format, isToday, isYesterday, differenceInHours } from "date-fns";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker } from "./template-picker";
import { AiThreadBanner } from "./ai-thread-banner";
import { buildReplyPreview } from "./reply-quote";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * Multi-canal: o operador trocou o canal de resposta da conversa (ou
   * voltou para o Automático). Opcional para os callers existentes; o
   * seletor só aparece quando a conta tem 2+ canais.
   */
  onChannelChange?: (
    conversationId: string,
    patch: { channel_id?: string; channel_pinned: boolean },
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
}

function formatDateSeparator(dateStr: string, t: ReturnType<typeof useTranslations>): string {
  const date = new Date(dateStr);
  if (isToday(date)) return t("today");
  if (isYesterday(date)) return t("yesterday");
  return format(date, "MMMM d, yyyy");
}

/**
 * Agrupa por dia a linha do tempo já intercalada (mensagens + eventos do
 * lead). Substituiu o `groupMessagesByDate` do upstream, que só conhecia
 * mensagem: os separadores de data precisam contar os eventos também, senão um
 * dia em que só houve mudança de funil apareceria sem cabeçalho — ou pior,
 * dentro do cabeçalho do dia anterior.
 */
function groupTimelineByDate(itens: ItemDaLinhaDoTempo<Message>[]) {
  const groups: { date: string; itens: ItemDaLinhaDoTempo<Message>[] }[] = [];
  let currentDate = "";

  for (const item of itens) {
    const day = format(new Date(item.quando), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: item.quando, itens: [item] });
    } else {
      groups[groups.length - 1].itens.push(item);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-primary" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
  { label: "Closed", value: "closed", color: "text-muted-foreground" },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onChannelChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
}: MessageThreadProps) {
  const t = useTranslations("Inbox.messageThread");
  const tTimer = useTranslations("Inbox.sessionTimer");
  const tQuote = useTranslations("Inbox.replyQuote");
  const tActions = useTranslations("Inbox.actions");
  const tNote = useTranslations("Inbox.note");

  const { user, profile, assinaturaAtiva } = useAuth();

  /**
   * O nome com que ESTA pessoa assina, ou null. Só para desenhar a bolha
   * otimista já assinada — quem assina de verdade é o servidor.
   *
   * ⚠️ Usa as MESMAS funções puras do envio (`nomeDePessoa`,
   * `aplicarAssinatura`). Reimplementar a regra aqui faria a bolha e a
   * mensagem real divergirem no dia em que a regra mudasse, que é o pior
   * jeito possível de errar isto: o operador veria uma coisa e o cliente
   * receberia outra.
   */
  const nomeQueAssina = assinaturaAtiva
    ? nomeDePessoa(profile?.full_name, profile?.email)
    : null;
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  /** Id da mensagem cujo anexo de grupo está sendo buscado agora. */
  const [anexoEmCurso, setAnexoEmCurso] = useState<string | null>(null);

  /**
   * Busca sob demanda o anexo de uma mensagem de grupo.
   *
   * ⚠️ O erro é mostrado como veio da rota, e não trocado por um "tente mais
   * tarde" genérico: mídia antiga EXPIRA no servidor do WhatsApp, e nesse caso
   * nenhuma tentativa futura vai funcionar. Dizer "tente depois" faria o
   * operador insistir por dias num arquivo que não existe mais.
   */
  const baixarAnexoDoGrupo = useCallback(
    async (messageId: string) => {
      setAnexoEmCurso(messageId);
      try {
        const res = await fetch(`/api/cb/groups/media/${messageId}`, {
          method: "POST",
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload.error ?? t("groupMediaFailed"));
          return;
        }
        if (payload.media_url) {
          onUpdateMessage(messageId, {
            media_url: payload.media_url,
            media_state: null,
          });
        }
      } catch {
        toast.error(t("groupMediaFailed"));
      } finally {
        setAnexoEmCurso(null);
      }
    },
    [onUpdateMessage, t],
  );

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
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

  // Canais de WhatsApp da conta (multi-canal). Uma busca por montagem —
  // a lista muda raramente (Settings → Conexões). Falha ou pré-migration
  // → lista vazia → seletor oculto e comportamento antigo preservado.
  const { channels } = useChannels();

  const channelsById = useMemo(() => {
    const map = new Map<string, CbChannel>();
    for (const c of channels) map.set(c.id, c);
    return map;
  }, [channels]);

  // Canal ativo da conversa: o fixado/seguido, senão o padrão da conta.
  //
  // Este valor também é o `expected_channel_id` do envio, então ele TEM de
  // espelhar o que o servidor resolve (`resolveChannelForConversation`).
  // Inferir o canal por outra via aqui — pela última mensagem carimbada,
  // por exemplo — faria a asserção discordar do servidor e devolver 409
  // `channel_changed` em loop, sem envio nenhum passar.
  const activeChannel = useMemo(() => {
    if (!channels.length) return null;
    return (
      channelsById.get(conversation?.channel_id ?? "") ??
      channels.find((c) => c.is_default) ??
      null
    );
  }, [channels, channelsById, conversation?.channel_id]);

  // Só a API oficial da Meta tem janela de 24h, e ela só REABRE por template.
  // No canal Evolution o atendente escolhe o número e conversa normalmente:
  // o cronômetro some, o aviso de "janela expirada" não aparece e o
  // compositor nunca trava (ver as props do MessageComposer).
  const evolutionActive = activeChannel?.kind === "evolution";

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: "" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg) return { expired: true, remaining: "No customer messages" };

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: tTimer("expired") };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? tTimer("xhRemaining", { hours: Math.floor(hoursLeft) })
        : tTimer("xmRemaining", { minutes: Math.floor(hoursLeft * 60) });

    return { expired, remaining };
  }, [messages, tTimer]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        onMessagesLoadedRef.current(data ?? []);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Trilha de atividade do lead (migration 912) — mudança de funil, etapa,
  // status e tags aparecem intercaladas na conversa. `resyncToken` entra como
  // gatilho para o botão de atualizar da thread arrastar a trilha junto.
  const { eventos: leadEvents } = useLeadEvents(contact?.id, resyncToken);

  // Anotações internas (migration 918). Chaveadas pela CONVERSA, não pelo
  // contato como a trilha acima — é a única chave que existe em grupo.
  //
  // ⚠️ Chamado aqui em cima, junto dos outros hooks, e não perto de
  // `messageGroups`: aquele trecho vem DEPOIS do early return da conversa
  // inexistente, e um hook ali violaria a regra dos hooks.
  const {
    notas,
    remover: removerNotaLocal,
    acrescentar: acrescentarNota,
    recarregar: recarregarNotas,
  } = useConversationNotes(conversationId, resyncToken);
  const podeAdministrar = useCan("manage-members");
  // Agendadas (925): a faixa acima do compositor e o compositor são
  // irmãos aqui, então o contador que os liga mora nesta tela mesmo.
  const podeEnviar = useCan("send-messages");
  const [agendadasResync, setAgendadasResync] = useState(0);

  /**
   * ⚠️ Confere a conversa antes de pôr a anotação no fio.
   *
   * A anotação é GRAVADA no lugar certo — a caixa manda o `conversationId`
   * que ela capturou. Mas esta thread não remonta ao trocar de conversa, e
   * quem responde ao POST é o render atual: trocar de cliente enquanto o
   * salvamento está no ar faria a anotação de um aparecer na tela do outro.
   * Some ao recarregar, mas até lá o operador lê a anotação de um cliente
   * dentro da conversa de outro — que é a coisa que esta feature inteira não
   * pode fazer.
   */
  const acrescentarNotaDaConversa = useCallback(
    (nota: ConversationNote) => {
      if (nota.conversation_id !== conversationId) return;
      acrescentarNota(nota);
    },
    [acrescentarNota, conversationId],
  );

  /**
   * Apagar anotação. Vai direto do navegador — ao contrário de criar, que
   * precisa da rota de servidor por causa da notificação da menção. Aqui a
   * própria RLS decide (autor ou admin), então não há o que validar no meio.
   *
   * ⚠️ Some da tela ANTES da confirmação do banco e volta se der errado. A
   * `cb_conversation_notes` tem REVOKE de UPDATE mas mantém DELETE, então um
   * erro aqui é erro de verdade — não o "0 linhas afetadas" silencioso que a
   * ausência de policy produziria.
   */
  const handleApagarNota = useCallback(
    async (id: string) => {
      const supabase = createClient();
      removerNotaLocal(id);
      const { error, count } = await supabase
        .from("cb_conversation_notes")
        .delete({ count: "exact" })
        .eq("id", id);
      // ⚠️ `count` e não só `error`. A policy é "autor OU admin", e RLS que
      // barra DELETE não devolve erro — devolve **0 linhas**, que aqui
      // pareceria sucesso. Sem isto a anotação sumia da tela, continuava no
      // banco e reaparecia na próxima abertura da conversa, sem explicação.
      // O botão já é escondido por `podeApagar`, então isto só dispara se a
      // tela e a RLS discordarem — que é exatamente quando não dá para calar.
      if (error || !count) {
        toast.error(tNote("deleteFailed"));
        void recarregarNotas();
      }
    },
    [removerNotaLocal, recarregarNotas, tNote],
  );

  // Auto-scroll to bottom on new messages.
  // `leadEvents` e `notas` entram na lista de dependências porque chegam em
  // buscas próprias, depois das mensagens: sem isso o conteúdo cresce embaixo
  // do usuário e a conversa deixa de abrir no fim. Vale também para a
  // anotação recém-escrita, que sem isto nasceria abaixo da dobra — o autor
  // salvaria e não veria o que acabou de escrever.
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, leadEvents, notas]);

  /**
   * Fecha a bolha otimista com o que o SERVIDOR gravou.
   *
   * ⚠️ Existe para os quatro caminhos de envio usarem a mesma regra. O de
   * texto já corrigia o texto; mídia, template e interativa só marcavam
   * "enviada" e deixavam o texto otimista de pé até o realtime chegar —
   * então uma legenda assinada aparecia sem o nome por segundos. A rota
   * devolve `content_text` para todos eles desde a 923.
   */
  const marcarEnviada = useCallback(
    (tempId: string, payload: { content_text?: unknown }) => {
      onUpdateMessage(tempId, {
        status: "sent",
        ...(typeof payload?.content_text === "string"
          ? { content_text: payload.content_text }
          : {}),
      });
    },
    [onUpdateMessage],
  );

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        // ⚠️ Já nasce ASSINADA. Sem isto a mensagem aparece sem o nome e
        // muda sozinha um instante depois, quando a resposta do servidor
        // chega — parecendo que o sistema reescreveu o que foi digitado.
        content_text: aplicarAssinatura(text, nomeQueAssina) ?? text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
            // Assert de canal: manda o número que ESTÁ NA TELA. Se o cliente
            // escreveu por outro número nesse meio-tempo, a conversa "segue"
            // e o envio sairia por ele — sem o atendente perceber, porque a
            // bolha aparece normal e o rótulo "via <canal>" é discreto. O
            // servidor devolve 409 e a gente pergunta em vez de mandar.
            expected_channel_id: activeChannel?.id ?? undefined,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (res.status === 409 && payload?.code === "channel_changed") {
          // NÃO é erro: é uma pergunta. O cliente escreveu por outro número
          // enquanto o atendente digitava.
          const novo = channels.find((c) => c.id === payload.current_channel_id);
          onNewMessage({ ...optimisticMsg, status: "failed" });
          toast.warning(
            t("channelChangedWhileTyping", {
              channel: novo?.label ?? t("channelChangedUnknown"),
            }),
            { duration: 12_000 },
          );
          return;
        }

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        //
        // ⚠️ E corrige o TEXTO junto. A bolha foi desenhada com o que o
        // atendente digitou; com a assinatura ligada (923) o servidor
        // prefixa, e sem isto a mensagem mudaria sozinha na tela quando o
        // realtime chegasse — parecendo que o sistema reescreveu o que ele
        // escreveu. Trocar aqui, na mesma resposta, faz a assinatura
        // aparecer de uma vez.
        marcarEnviada(tempId, payload);
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    // `activeChannel` e `channels` são load-bearing aqui: um closure obsoleto
    // mandaria o assert com o canal ERRADO, que é justamente o bug que ele
    // existe para impedir.
    // `nomeQueAssina` nas deps: sem ele a bolha otimista continuaria assinando
    // com o nome de antes depois de o interruptor mudar ou a sessão trocar.
    [
      conversation,
      onNewMessage,
      onUpdateMessage,
      activeChannel?.id,
      channels,
      t,
      marcarEnviada,
      nomeQueAssina,
    ]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        // `data` e a resposta; `payload` aqui e o CORPO da requisicao.
        marcarEnviada(tempId, data);
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation, onNewMessage, onUpdateMessage, marcarEnviada],
  );

  const handleSendInteractive = useCallback(
    async (payload: InteractiveMessagePayload, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;
      // Optimistic bubble — renders the buttons/list immediately via the
      // interactive_payload, same as the persisted row will.
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "interactive",
        content_text: payload.body,
        interactive_payload: payload,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "interactive",
            interactive_payload: payload,
            reply_to_message_id: replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send interactive message:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        // `data` e a resposta; `payload` aqui e o payload interativo.
        marcarEnviada(tempId, data);
      } catch (err) {
        console.error("Failed to send interactive message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, marcarEnviada],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id);

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed" });
          return;
        }

        marcarEnviada(tempId, payload);
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed" });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, marcarEnviada],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  //
  // ⚠️ Em GRUPO o autor é o participante, não "o contato" — que nem existe.
  // Sem este ramo, citar a mensagem de qualquer participante mostrava o
  // literal "Customer" (texto fixo em inglês) para todo mundo.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      if (isAgentMsg) return "You";
      return m.group_sender_name || contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg, tQuote),
      });
    },
    [authorLabelFor],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  // ---- Apagar / editar ------------------------------------------------
  //
  // Só chegam aqui em canal Evolution e dentro do prazo do WhatsApp — o
  // MessageActions esconde os botões fora disso. A rota revalida mesmo
  // assim: o prazo pode estourar entre o render e o clique.

  /** Mensagem em edição, ou null. */
  const [editando, setEditando] = useState<Message | null>(null);
  const [textoEdicao, setTextoEdicao] = useState("");
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  // ⚠️ O campo de edição recebe o corpo SEM a assinatura (923).
  //
  // Ele era pré-preenchido com o `content_text` inteiro, e com a assinatura
  // gravada ali o operador veria `*Leonardo Cabral Baptista:*` cru dentro do
  // campo — podendo apagar sem querer, ou "corrigir" o nome. O servidor
  // recoloca a assinatura ORIGINAL ao salvar, então o que se edita aqui é só
  // o que se quis dizer.
  useEffect(() => {
    setTextoEdicao(removerAssinatura(editando?.content_text) ?? "");
  }, [editando]);

  const apagarMensagem = useCallback(
    async (msg: Message) => {
      if (!window.confirm(tActions("deleteConfirm"))) return;
      // Otimista: a bolha risca na hora como "exclusão solicitada" — que é
      // o que de fato acontece. `deleted_at` (= "Apagada") só é escrito pelo
      // webhook do WhatsApp confirmando a revogação; se marcássemos aqui, a
      // tela afirmaria uma remoção que ninguém verificou.
      onUpdateMessage(msg.id, {
        delete_requested_at: new Date().toISOString(),
        deleted_by: "agent",
      });
      try {
        const res = await fetch("/api/whatsapp/message", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: msg.id }),
        });
        if (!res.ok) {
          const { error, code } = await res.json().catch(() => ({ error: "", code: "" }));
          // `talvez_enviado`: a revogação pode ter saído — o servidor
          // deliberadamente MANTEVE o pedido registrado. Desfazer a marca
          // aqui faria a tela contradizer o banco e afirmar que nada foi
          // pedido, quando talvez tenha sido.
          if (code === "talvez_enviado") {
            toast.warning(error);
            return;
          }
          throw new Error(error || String(res.status));
        }
        // "Solicitada", não "apagada": o WhatsApp não confirma revogação na
        // resposta, e a confirmação — quando vem — chega pelo webhook.
        toast.success(tActions("deleteRequested"));
      } catch (err) {
        // Falhou ANTES de o pedido sair: nada foi pedido, a bolha volta ao
        // normal.
        onUpdateMessage(msg.id, { delete_requested_at: null, deleted_by: null });
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [onUpdateMessage, tActions],
  );

  const salvarEdicao = useCallback(async () => {
    const alvo = editando;
    const texto = textoEdicao.trim();
    if (!alvo || !texto || salvandoEdicao) return;
    setSalvandoEdicao(true);
    try {
      const res = await fetch("/api/whatsapp/message", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: alvo.id, text: texto }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "" }));
        throw new Error(error || String(res.status));
      }
      onUpdateMessage(alvo.id, {
        // ⚠️ Recompõe com a assinatura ORIGINAL, igual ao servidor faz. Sem
        // isto a bolha ficava sem o nome logo depois de editar — batendo nem
        // com o banco nem com a tela do cliente — e só se corrigia quando o
        // realtime chegasse, que este código trata como perdível.
        content_text: assinaturaExistente(alvo.content_text) + texto,
        text_before_edit: alvo.content_text,
        edited_at: new Date().toISOString(),
      });
      toast.success(tActions("edited"));
      setEditando(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvandoEdicao(false);
    }
  }, [editando, textoEdicao, salvandoEdicao, onUpdateMessage, tActions]);

  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId })
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update assignment:", error);
        toast.error("Failed to update assignment");
        return;
      }

      onAssignChange(conversation.id, agentId);
    },
    [conversation, onAssignChange],
  );

  const handleChannelChange = useCallback(
    async (channelId: string | null) => {
      if (!conversation) return;

      // Escolher um canal FIXA a conversa nele; "Automático" solta o pino
      // (o channel_id fica — o próximo inbound o move, ver
      // followConversationChannel em src/lib/cb-channels/stamp.ts).
      const patch =
        channelId === null
          ? { channel_pinned: false }
          : { channel_id: channelId, channel_pinned: true };

      const supabase = createClient();
      const { error } = await supabase
        .from("conversations")
        .update(patch)
        .eq("id", conversation.id);

      if (error) {
        console.error("Failed to update channel:", error);
        toast.error(t("channelUpdateFailed"));
        return;
      }

      onChannelChange?.(conversation.id, patch);
    },
    [conversation, onChannelChange, t],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  // ⚠️ A condição era `!conversation || !contact`, e era ELA que impedia
  // qualquer conversa de grupo de abrir: grupo não tem contato (o CHECK
  // `cb_conv_contato_xor_grupo` garante um ou outro), então toda conversa de
  // grupo caía no estado vazio, como se nada estivesse selecionado.
  const ehGrupo = !!conversation?.group_id;
  if (!conversation || (!contact && !ehGrupo)) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          {t("selectConversation")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("selectConversationHint")}
        </p>
      </div>
    );
  }

  const grupo = conversation.group ?? null;
  const displayName = ehGrupo
    ? nomeDoGrupo(grupo, t("groupNoName"))
    : (contact?.name || contact?.phone) ?? "";
  // Linha de baixo do cabeçalho: no 1:1 é o telefone; num grupo, quantas
  // pessoas estão nele — que é a informação equivalente ("com quem eu estou
  // falando"). Fica vazia enquanto a sincronização não trouxe o número.
  const subtituloDoCabecalho = ehGrupo
    ? grupo?.participant_count
      ? t("groupParticipants", { count: grupo.participant_count })
      : ""
    : (contact?.phone ?? "");
  const messageGroups = groupTimelineByDate(
    intercalar(messages, leadEvents, notas)
  );
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? t("assigned"))
    : t("assign");

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header — solid card surface sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("backToConversations")}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-foreground">
              {ehGrupo && <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              <span className="truncate">{displayName}</span>
            </h2>
            {subtituloDoCabecalho && (
              <p className="truncate text-xs text-muted-foreground">
                {subtituloDoCabecalho}
              </p>
            )}
          </div>
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room. Canal Evolution não
              tem janela de 24h, então o cronômetro some. */}
          {!evolutionActive && (
            <Badge
              variant="outline"
              className={cn(
                "ml-1 hidden gap-1 border-border text-[10px] sm:inline-flex sm:ml-2",
                sessionInfo.expired ? "text-red-400" : "text-primary"
              )}
            >
              <Clock className="h-3 w-3" />
              {sessionInfo.remaining}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Contact-panel toggle — desktop only. The contact sidebar
              eats a chunk of horizontal width that crowds the thread on
              smaller laptops; this lets agents reclaim it when they just
              want to read and reply. Hidden on mobile, where the sidebar
              never renders as a permanent panel anyway. Issue #258. */}
          {onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label={
                contactPanelOpen ? t("hideContactPanel") : t("showContactPanel")
              }
              title={contactPanelOpen ? t("hideContact") : t("showContact")}
              aria-pressed={contactPanelOpen}
              className={cn(
                "hidden h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground lg:inline-flex",
                contactPanelOpen ? "text-primary" : "text-muted-foreground",
              )}
            >
              {contactPanelOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          )}

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label={t("refreshConversation")}
              title={t("refresh")}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Seletor de canal — só quando a conta tem 2+ números. Escolher
              fixa a conversa no canal; "Automático" volta a seguir o número
              que o cliente usou por último. */}
          {channels.length >= 2 && activeChannel && (
            <DropdownMenu>
              <DropdownMenuTrigger
                title={t("channelTitle")}
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  conversation.channel_pinned
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              >
                {activeChannel.kind === "meta" ? (
                  <BadgeCheck className="h-3 w-3" />
                ) : (
                  <QrCode className="h-3 w-3" />
                )}
                <span className="hidden max-w-[8rem] truncate sm:inline">
                  {activeChannel.label}
                </span>
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-border bg-popover">
                {channels.map((c) => {
                  const isSelected =
                    Boolean(conversation.channel_pinned) &&
                    c.id === activeChannel.id;
                  return (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => handleChannelChange(c.id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground",
                      )}
                    >
                      {c.kind === "meta" ? (
                        <BadgeCheck className="mr-2 h-3.5 w-3.5" />
                      ) : (
                        <QrCode className="mr-2 h-3.5 w-3.5" />
                      )}
                      <span className="flex-1">{c.label}</span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })}
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem
                  onClick={() => handleChannelChange(null)}
                  className={cn(
                    "text-sm",
                    conversation.channel_pinned
                      ? "text-muted-foreground"
                      : "text-primary",
                  )}
                >
                  <span className="flex-1">{t("channelAuto")}</span>
                  {!conversation.channel_pinned && (
                    <Check className="ml-2 h-3 w-3" />
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Status dropdown — escondido em grupo. Aberta/pendente/encerrada
              descreve um ATENDIMENTO, que começa e termina; um grupo não
              fecha. A conversa continua com `status='open'` no banco (a
              coluna é NOT NULL), só não se oferece o controle. */}
          {!ehGrupo && (
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  currentStatus?.color ?? "text-muted-foreground"
                )}>
                {currentStatus ? t(`status${currentStatus.label}`) : t("status")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {t(`status${opt.label}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          )}

          {/* Assign dropdown — SEGUE valendo em grupo: atribuir um grupo a
              alguém foi decisão explícita do operador. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                assignedAgentId ? "text-primary" : "text-muted-foreground"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
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
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground"
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now
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
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-muted-foreground"
                  >
                    {t("unassign")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : /* `messageGroups`, não `messages`: uma conversa sem mensagem mas
              com evento de funil registrado mostraria "nenhuma mensagem" e
              engoliria o evento. */
        messageGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">{t("noMessagesYet")}</p>
            <p className="text-xs text-muted-foreground">
              {t("sendTemplateHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date, t)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.itens.map((item) => {
                    // Evento da trilha do lead — aviso de sistema, não
                    // mensagem: sem bolha, sem ações, sem reação.
                    if (item.evento) {
                      return <LeadEventLine key={item.chave} evento={item.evento} />;
                    }
                    // ⚠️ A anotação interna tem de ser tratada AQUI, antes do
                    // `item.mensagem!` logo abaixo. Aquele `!` desliga a
                    // checagem do TypeScript, então um item de nota cairia no
                    // ramo de mensagem e derrubaria o fio inteiro em runtime.
                    if (item.nota) {
                      return (
                        <NoteLine
                          key={item.chave}
                          nota={item.nota}
                          podeApagar={
                            item.nota.author_user_id === user?.id || podeAdministrar
                          }
                          onApagar={handleApagarNota}
                        />
                      );
                    }
                    const msg = item.mensagem!;
                    // Aviso do WhatsApp dentro do grupo ("Fulano entrou").
                    // Mesmo tratamento do evento de lead logo acima: a bolha
                    // se desenha sozinha como faixa, e NÃO passa pelo
                    // MessageActions — responder, reagir ou apagar um aviso
                    // do sistema não quer dizer nada.
                    if (msg.content_type === "system") {
                      return <MessageBubble key={msg.id} message={msg} emGrupo />;
                    }
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel:
                            parent.sender_type === "agent" || parent.sender_type === "bot"
                              ? t("me")
                              // Em grupo o autor citado é o participante.
                              // Sem isto, citar qualquer um mostrava o
                              // literal "Unknown" — texto fixo em inglês.
                              : parent.group_sender_name ||
                                contact?.name ||
                                contact?.phone ||
                                t("unknownAuthor"),
                          preview: buildReplyPreview(parent, tQuote),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Rótulo do canal por mensagem — só em conta multi-canal
                    // e quando a mensagem foi carimbada (Fase 3).
                    const channelLabel =
                      channels.length >= 2 && msg.channel_id
                        ? (channelsById.get(msg.channel_id)?.label ?? null)
                        : null;
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                        channelKind={activeChannel?.kind ?? null}
                        onDelete={() => void apagarMensagem(msg)}
                        onEdit={() => setEditando(msg)}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                          channelLabel={channelLabel}
                          emGrupo={ehGrupo}
                          baixandoAnexo={anexoEmCurso === msg.id}
                          onBaixarAnexo={() => baixarAnexoDoGrupo(msg.id)}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI auto-reply banner — take over an active bot, or resume it
          after a handoff. Renders nothing unless the account has
          auto-reply configured. */}
      {/* IA não atua em grupo (906). O `/api/ai/autoreply` recusa com 400;
          esconder a faixa evita oferecer um controle que só daria erro. */}
      {!ehGrupo && (
      <AiThreadBanner
        conversationId={conversation.id}
        disabled={conversation.ai_autoreply_disabled ?? false}
        handoffSummary={conversation.ai_handoff_summary}
        assignedAgentId={assignedAgentId}
        currentUserId={user?.id}
        onChange={(patch) => {
          if ("assigned_agent_id" in patch) {
            onAssignChange(conversation.id, patch.assigned_agent_id ?? null);
          }
        }}
      />
      )}

      {/* Faixa AGENDADAS (925), colada no compositor e dentro do fio.
          ⚠️ Fica AQUI, e não na ficha lateral: quem abre a conversa precisa
          esbarrar no que já está marcado ANTES de escrever, senão escreve
          por cima e o cliente recebe duas. Some sozinha quando não há fila. */}
      <ScheduledBar
        conversationId={conversation.id}
        podeAgir={podeEnviar}
        resyncToken={agendadasResync}
      />

      {/* Composer — canal Evolution não tem janela de 24h (sessionExpired
          neutralizado) nem templates/interativas (channelKind esconde). */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={evolutionActive ? false : sessionInfo.expired}
        channelKind={activeChannel?.kind ?? null}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onSendInteractive={handleSendInteractive}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onNoteCreated={acrescentarNotaDaConversa}
        onScheduled={() => setAgendadasResync((n) => n + 1)}
      />

      {/* Diálogo de edição. O WhatsApp só permite editar por ~15 minutos;
          passado isso o botão nem aparece, e a rota recusa mesmo assim. */}
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tActions("editTitle")}</DialogTitle>
          </DialogHeader>
          <textarea
            value={textoEdicao}
            onChange={(e) => setTextoEdicao(e.target.value)}
            rows={4}
            autoFocus
            className="w-full resize-none rounded-lg border border-input bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              {tActions("cancel")}
            </Button>
            <Button
              onClick={() => void salvarEdicao()}
              disabled={!textoEdicao.trim() || salvandoEdicao}
            >
              {tActions("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        channelId={activeChannel?.id ?? null}
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />
    </div>
  );
}
