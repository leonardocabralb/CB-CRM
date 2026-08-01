"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  matchesTypeFilter,
  normalizeConversations,
  type TipoDeConversa,
} from "@/lib/inbox/conversations";
import { tituloDaConversa } from "@/lib/cb-groups/display";
import { stripWhatsAppFormat } from "@/lib/inbox/whatsapp-format";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X, Users, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChannels } from "@/hooks/use-channels";
import { useFavoritas } from "@/hooks/use-favoritas";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
};



type InboxFilter = ConversationStatus | "all" | "unread";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  
  const FILTER_OPTIONS: { label: string; value: InboxFilter }[] = useMemo(() => [
    { label: t("filterAll"), value: "all" },
    { label: t("filterUnread"), value: "unread" },
    { label: t("filterOpen"), value: "open" },
    { label: t("filterPending"), value: "pending" },
    { label: t("filterClosed"), value: "closed" },
  ], [t]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  // Todas / só diretas / só grupos. Começa em "todas" porque grupo entra no
  // mesmo inbox por decisão de produto — o filtro serve para focar, não para
  // esconder por padrão.
  const [tipo, setTipo] = useState<TipoDeConversa>("todas");
  const [loading, setLoading] = useState(true);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  // Filtro por canal. `null` = todos. Só aparece com 2+ canais: numa conta de
  // um número o seletor seria ruído puro.
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  // Conta sem canais (ou deploy pré-901): a lista fica vazia e o seletor
  // simplesmente não aparece.
  const { channels } = useChannels();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  // Favoritas são de CADA MEMBRO (migration 924) — o hook já lê só as minhas.
  const { favoritas, alternar: alternarFavorita } = useFavoritas();

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable, empty-dep identity. Previously the fetch useCallback
  // depended on `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  // Mutation lives in an effect (not render) per React 19's refs rule;
  // the fetch runs once on mount so it's fine to read the slightly
  // older value — the very next render updates the ref for any
  // subsequent async completion.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        // ⚠️ `nullsFirst: false` é load-bearing desde os grupos (906). Em
        // ordem DECRESCENTE o Postgres põe NULL PRIMEIRO por padrão, e um
        // grupo sincronizado em que ninguém falou ainda tem
        // `last_message_at` nulo. Sem isto, ligar o interruptor num número
        // com 58 grupos empurra as conversas ativas para baixo de 58 linhas
        // vazias — o inbox vira inútil no exato instante em que o operador
        // liga o recurso.
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  // O seletor de tipo só aparece quando existe grupo. Numa conta sem nenhum —
  // que é toda conta até alguém ligar o interruptor — ele não decide nada e
  // só ocupa espaço. Mesma convenção do filtro de canal, que some com menos
  // de 2 canais.
  const temGrupos = useMemo(
    () => conversations.some((c) => !!c.group_id),
    [conversations],
  );

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    // Tipo (todas / diretas / grupos). Ortogonal ao resto — ver
    // `matchesTypeFilter`.
    if (tipo !== "todas") {
      result = result.filter((c) => matchesTypeFilter(c, tipo));
    }

    if (filter === "unread") {
      result = result.filter((c) => c.unread_count > 0);
    } else if (filter !== "all") {
      result = result.filter((c) => c.status === filter);
    }

    // Canal: `channel_id` já vem de graça no CONVERSATION_SELECT ('*').
    // Conversas sem carimbo (anteriores à Fase 3) só aparecem em "Todos" —
    // incluí-las em todo canal faria o filtro mentir.
    if (selectedChannelId) {
      result = result.filter((c) => c.channel_id === selectedChannelId);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        // Sem isto, buscar não acha grupo NENHUM: grupo não tem contato, e
        // os dois campos acima ficam vazios.
        const grupo = c.group_id
          ? `${c.group?.alias ?? ""} ${c.group?.subject ?? ""}`.toLowerCase()
          : "";
        const lastMsg = stripWhatsAppFormat(c.last_message_text).toLowerCase();
        return (
          name.includes(q) ||
          phone.includes(q) ||
          grupo.includes(q) ||
          lastMsg.includes(q)
        );
      });
    }

    return result;
  }, [conversations, filter, tipo, search, selectedTagIds, selectedCompany, selectedChannelId]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
    setSelectedChannelId(null);
  }, []);

  const hasContactFilters =
    selectedTagIds.length > 0 || selectedCompany !== null || selectedChannelId !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const handleToggleFavorita = useCallback(
    async (conversationId: string) => {
      const ok = await alternarFavorita(conversationId);
      // A estrela já voltou sozinha (o hook faz rollback); o aviso existe
      // porque um marcador que se apaga sem explicação parece bug da tela.
      if (!ok) toast.error(t("favoriteFailed"));
    },
    [alternarFavorita, t]
  );

  const activeFilter = FILTER_OPTIONS.find((o) => o.value === filter);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Search + Filter */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted">
                {activeFilter?.label ?? t("filterAll")}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "text-sm",
                    filter === opt.value
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tipo: só aparece quando existe grupo na lista. */}
          {temGrupos && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  tipo !== "todas"
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tipo === "grupos"
                  ? t("typeGroups")
                  : tipo === "diretas"
                    ? t("typeDirect")
                    : t("typeAll")}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="border-border bg-popover">
                {(
                  [
                    ["todas", t("typeAll")],
                    ["diretas", t("typeDirect")],
                    ["grupos", t("typeGroups")],
                  ] as [TipoDeConversa, string][]
                ).map(([valor, rotulo]) => (
                  <DropdownMenuItem
                    key={valor}
                    onClick={() => setTipo(valor)}
                    className={cn(
                      "text-sm",
                      tipo === valor ? "text-primary" : "text-popover-foreground",
                    )}
                  >
                    {rotulo}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Canal: só com 2+ números. Numa conta de um número o seletor
              seria ruído puro. */}
          {channels.length >= 2 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedChannelId
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {selectedChannelId
                  ? (channels.find((c) => c.id === selectedChannelId)?.label ??
                    t("channelFilter"))
                  : t("channelFilter")}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedChannelId(null)}
                  className={cn(
                    "text-sm text-popover-foreground",
                    selectedChannelId === null && "text-primary"
                  )}
                >
                  {t("channelFilterAll")}
                </DropdownMenuItem>
                {channels.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => setSelectedChannelId(c.id)}
                    className={cn(
                      "text-sm text-popover-foreground",
                      selectedChannelId === c.id && "text-primary"
                    )}
                  >
                    <span className="truncate">{c.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("tags")}
                {selectedTagIds.length > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                    className="text-sm text-popover-foreground"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex max-w-40 items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                  selectedCompany
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="truncate">{selectedCompany ?? t("company")}</span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-64 w-56 border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(
                    "text-sm",
                    selectedCompany === null
                      ? "text-primary"
                      : "text-popover-foreground"
                  )}
                >
                  {t("allCompanies")}
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(
                      "text-sm",
                      selectedCompany === co
                        ? "text-primary"
                        : "text-popover-foreground"
                    )}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag?.color ?? "var(--muted-foreground)" }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? t("tags")}</span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">{t("noConversations")}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                favorita={favoritas.has(conv.id)}
                onToggleFavorita={handleToggleFavorita}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  favorita: boolean;
  onToggleFavorita: (conversationId: string) => void;
  t: ReturnType<typeof useTranslations>;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  favorita,
  onToggleFavorita,
  t,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const ehGrupo = !!conversation.group_id;
  const displayName = tituloDaConversa(conversation, {
    semNome: t("groupNoName"),
    desconhecido: t("unknown"),
  });
  const initials = displayName.charAt(0).toUpperCase();
  // Foto do grupo quando houver; senão o ícone de grupo faz o trabalho de
  // dizer, à distância, que aquela linha não é um cliente.
  const avatarUrl = ehGrupo ? conversation.group?.picture_url : contact?.avatar_url;

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const handleFavorita = useCallback(() => {
    onToggleFavorita(conversation.id);
  }, [onToggleFavorita, conversation.id]);

  const timeAgo = conversation.last_message_at
    ? formatDistanceToNow(new Date(conversation.last_message_at), {
        addSuffix: false,
      })
    : "";

  return (
    // ⚠️ A estrela NÃO pode ficar dentro do botão da linha: `<button>` dentro
    // de `<button>` é HTML inválido, e o React nem sempre avisa — o navegador
    // desmonta a árvore sozinho e o clique passa a chegar no elemento errado.
    // Por isso ela é irmã do botão, sobreposta numa faixa que o `pr-9` abaixo
    // reserva para ela.
    <div className="relative">
      <button
        onClick={handleClick}
        className={cn(
          "flex w-full items-start gap-3 py-3 pl-3 pr-9 text-left transition-colors hover:bg-muted/50",
          isActive && "border-l-2 border-primary bg-muted/70"
        )}
      >
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : ehGrupo ? (
            <Users className="h-5 w-5 text-muted-foreground" />
          ) : (
            initials
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {/* Ícone junto do nome mesmo quando há foto: com foto de grupo o
                  avatar sozinho não distingue de uma foto de perfil. */}
              {ehGrupo && (
                <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate text-sm font-medium text-foreground">
                {displayName}
              </span>
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-muted-foreground">
              {stripWhatsAppFormat(conversation.last_message_text) || t("noMessagesYet")}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {conversation.unread_count > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {conversation.unread_count}
                </span>
              )}
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  STATUS_COLORS[conversation.status]
                )}
                title={conversation.status}
              />
            </div>
          </div>
        </div>
      </button>

      {/* A estrela fica SEMPRE visível, e não só no hover: metade do uso do
          inbox é em tela de toque, onde hover não existe — um controle que só
          aparece ao passar o mouse simplesmente não existe no celular. */}
      <button
        type="button"
        onClick={handleFavorita}
        aria-pressed={favorita}
        title={favorita ? t("unfavorite") : t("favorite")}
        aria-label={favorita ? t("unfavorite") : t("favorite")}
        className={cn(
          "absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-muted",
          favorita
            ? "text-amber-500"
            : "text-muted-foreground/40 hover:text-muted-foreground"
        )}
      >
        <Star className={cn("h-4 w-4", favorita && "fill-current")} />
      </button>
    </div>
  );
}
