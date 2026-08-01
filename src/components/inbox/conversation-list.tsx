"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import {
  aplicarFiltros,
  FILTROS_VAZIOS,
  mapaDeEtapasPorContato,
  type FiltrosDoInbox,
} from "@/lib/inbox/filtros";
import { InboxFilters } from "@/components/inbox/inbox-filters";
import { tituloDaConversa } from "@/lib/cb-groups/display";
import { stripWhatsAppFormat } from "@/lib/inbox/whatsapp-format";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  ConversationStatus,
  PipelineStage,
  Profile,
  Tag,
} from "@/types";
import { Search, Users, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
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



export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");

  // ⚠️ A busca fica SEPARADA dos filtros, e de propósito. Ela responde "onde
  // está aquela conversa" (nome, telefone, nome do grupo, texto da última
  // mensagem); os filtros respondem "quais conversas se parecem com isto".
  // Trocar uma pela outra apagaria a busca por texto de mensagem e por nome
  // de grupo, que é o que a revisão prévia desta fase encontrou.
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDoInbox>(FILTROS_VAZIOS);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [etapas, setEtapas] = useState<PipelineStage[]>([]);
  // `contact_id` → etapas dos negócios dele. Busca separada porque `deals` NÃO
  // vem no CONVERSATION_SELECT — e não pode vir: aquele select é compartilhado
  // com a API pública v1, e embutir negócio ali mudaria o contrato público.
  // ⚠️ Esta segunda busca MORRE na fatia B, quando tudo virar uma consulta só.
  const [etapaPorContato, setEtapaPorContato] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  // Conta sem canais (ou deploy pré-901): a lista fica vazia e o seletor
  // simplesmente não aparece.
  const { channels } = useChannels();
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
  //
  // As três buscas abaixo alimentam SÓ os rótulos do painel de filtros. Todas
  // falham em silêncio: sem elas o filtro correspondente simplesmente não
  // aparece (o gate cuida disso), e o inbox continua inteiro. Rodam sob RLS,
  // então já vêm escopadas à conta.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const [tagsRes, profilesRes, etapasRes, dealsRes] = await Promise.all([
        supabase.from("tags").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
        supabase
          .from("pipeline_stages")
          .select("*")
          .order("position", { ascending: true }),
        supabase.from("deals").select("contact_id, stage_id"),
      ]);
      if (cancelled) return;
      if (tagsRes.data) setTags(tagsRes.data as Tag[]);
      if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);
      if (etapasRes.data) setEtapas(etapasRes.data as PipelineStage[]);
      if (dealsRes.data) {
        setEtapaPorContato(
          mapaDeEtapasPorContato(
            dealsRes.data as { contact_id: string | null; stage_id: string | null }[],
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // `resyncToken` porque negócio muda de etapa e etiqueta é criada em OUTRA
    // tela: `contacts`, `contact_tags` e `deals` não estão na publication do
    // realtime, então sem isto a aba aberta do inbox filtraria por um mundo
    // congelado no momento em que foi aberta.
  }, [resyncToken]);

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

  // Todo o recorte mora em `src/lib/inbox/filtros.ts`, testado lá. Aqui só
  // fica o estado e o que a tela precisa para desenhar os rótulos.
  const filtered = useMemo(
    () =>
      aplicarFiltros(conversations, filtros, {
        favoritas,
        etapaPorContato,
        busca: search,
      }),
    [conversations, filtros, favoritas, etapaPorContato, search],
  );

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

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Busca + filtros */}
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

        <InboxFilters
          filtros={filtros}
          onChange={setFiltros}
          canais={channels}
          etiquetas={tags}
          empresas={companies}
          responsaveis={profiles}
          etapas={etapas}
          temGrupos={temGrupos}
          exibindo={filtered.length}
          total={conversations.length}
        />
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
