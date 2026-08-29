"use client";

// ============================================================
// Painel do contato — a coluna da direita do inbox (Fase 1).
//
// Vive em `painel/` (arquivo NOSSO) de propósito: o
// `contact-sidebar.tsx` é arquivo do upstream com camadas nossas, e
// reescrevê-lo inteiro a cada evolução aumenta a superfície de
// conflito no merge. Ele virou um wrapper fino que re-exporta este
// componente; a evolução do painel acontece aqui.
//
// Estrutura: cabeçalho compacto (fechar + avatar + nome + telefone),
// fileira de abas SÓ-ÍCONE e o conteúdo rolável de cada aba. As
// buscas de dados (negócios, etiquetas) e a assinatura realtime das
// notas moram NO TOPO do painel, não dentro das abas — trocar de aba
// não refaz query nenhuma, e fechar o painel (que agora só o esconde,
// sem desmontar) não derruba o realtime.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useChannels } from "@/hooks/use-channels";
import { useConversationNotes } from "@/hooks/use-conversation-notes";
import { toast } from "sonner";
import { ChannelCell } from "@/components/channels/channel-badge";
import { ActivityHistory } from "@/components/lead-events/activity-history";
import { ContactTasks } from "@/components/tasks/contact-tasks";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ConversationNote, Tag } from "@/types";
import {
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Smartphone,
  Building2,
  History,
  ListTodo,
  PanelRightClose,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

export interface PainelDoContatoProps {
  contact: Contact | null;
  /**
   * Conversa aberta. A anotação é chaveada pela CONVERSA desde a 918 — sem
   * ela dá para LER as anotações do contato (a coluna `contact_id` é
   * desnormalizada justamente para isso), mas não para escrever.
   */
  conversationId?: string | null;
  /**
   * Canal em que a conversa aberta corre. Sem isto a ficha do contato não
   * dizia por qual dos números do escritório aquela conversa acontece — a
   * informação existia só no cabeçalho da thread, que fica fora de vista
   * quando o atendente está lendo a ficha.
   */
  channelId?: string | null;
  /**
   * Contador de resync da página (reconexão de WS, aba voltou a ficar
   * visível). Repassado ao histórico de atividade, que sempre aceitou um
   * `token` e nunca o recebia daqui.
   */
  resyncToken?: number;
  /**
   * Fecha o painel. O botão mora AQUI, no cabeçalho do próprio painel —
   * antes ficava no cabeçalho do fio, do outro lado de quatro outros
   * controles, e o operador não o achava.
   */
  onClose?: () => void;
}

export function PainelDoContato({
  contact,
  conversationId,
  channelId,
  resyncToken = 0,
  onClose,
}: PainelDoContatoProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const tCanais = useTranslations("Channels");
  const { channels } = useChannels();

  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  /**
   * ⚠️ O rascunho MORRE ao trocar de conversa. Mesmo perigo, mesma correção
   * que a caixa do compositor.
   *
   * Este painel é renderizado sem `key`, numa posição fixa da página — trocar
   * de conversa o re-renderiza, nunca o remonta. O texto do campo só era
   * limpo quando o salvamento dava certo. Então: escrever "cliente mentiu
   * sobre a data do acidente" na conversa do cliente A, clicar no cliente B
   * na lista (o painel passa a mostrar o nome e o telefone de B, com o texto
   * de A ainda no campo) e clicar em `+` gravava aquilo na conversa de B,
   * visível para toda a equipe. Não é hipótese: é o caminho de escrita que
   * sobrou depois de a caixa do compositor ganhar a guarda dela.
   */
  useEffect(() => {
    setNewNote("");
  }, [conversationId]);

  /**
   * ⚠️ O MESMO hook que o fio do chat usa, e de propósito.
   *
   * Antes esta seção buscava as anotações uma vez, ao trocar de contato. O
   * resultado é que a anotação escrita no compositor — logo ali, na mesma
   * tela — não aparecia aqui até recarregar a página, e a P3.3 pede que ela
   * apareça nas três superfícies. Compartilhar o hook resolve pelo realtime
   * que ele já traz, em vez de inventar um segundo caminho de sincronia.
   *
   * Chaveia por CONVERSA, e não pelo `contact_id` que esta ficha usava:
   * `idx_conversations_account_contact` é UNIQUE em (account_id, contact_id),
   * então para conversa 1:1 os dois recortes devolvem o mesmo conjunto. A
   * ficha de fora do inbox (`contact-detail-view`) continua lendo por contato
   * porque lá não existe conversa aberta.
   */
  const { notas, acrescentar: acrescentarNota } =
    useConversationNotes(conversationId);

  // O hook devolve na ordem que o `intercalar` prefere (o fio reordena tudo).
  // Aqui a lista é lida direto, e a seção sempre mostrou a mais recente no
  // topo — ordenar é responsabilidade de quem exibe.
  const notes = useMemo(
    () =>
      [...notas].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [notas],
  );

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals and tags in parallel. As anotações saem daqui de propósito:
    // vêm do `useConversationNotes` acima, que traz realtime junto.
    const [dealsRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setDeals/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  /**
   * ⚠️ Vai pela ROTA, não por insert direto. `cb_conversation_notes` não tem
   * policy de INSERT e o papel `authenticated` teve o INSERT revogado — a
   * anotação nasce no servidor, que carimba o autor e valida as menções.
   * O insert direto que existia aqui (na `contact_notes`) agora daria 42501.
   *
   * ⚠️ E AVISA quando falha. A versão anterior (`if (!error && data)`) engolia
   * o erro: o texto continuava no campo, nada aparecia na lista, e não havia
   * como distinguir "falhou" de "ainda salvando". Com a rota no meio isso
   * ficou mais provável, não menos — 401 de sessão expirada e 403 de papel
   * passam por aqui.
   */
  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim() || !conversationId) return;
    setAddingNote(true);
    try {
      const res = await fetch("/api/cb/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          texto: newNote.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.note) {
        const nota = json.note as ConversationNote;
        // Mesma guarda do fio: a anotação foi GRAVADA no lugar certo (a
        // requisição levou o `conversationId` daquele render), mas quem
        // recebe a resposta é o render de agora. Trocar de conversa com o
        // salvamento no ar poria a anotação de um cliente na ficha de outro.
        if (nota.conversation_id === conversationId) acrescentarNota(nota);
        setNewNote("");
      } else {
        toast.error(json?.error || tSidebar("noteSaveError"));
      }
    } catch {
      toast.error(tSidebar("noteSaveError"));
    } finally {
      setAddingNote(false);
    }
  }, [contact, newNote, conversationId, acrescentarNota, tSidebar]);

  if (!contact) {
    return (
      <div className="flex h-full w-full flex-col border-l border-border bg-card">
        <CabecalhoDoPainel onClose={onClose} tThread={tThread} />
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-sm text-muted-foreground">
            {tThread("selectConversation")}
          </p>
        </div>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-card">
      {/* Cabeçalho compacto: fechar + avatar 40px + nome/telefone em linha.
          A identidade ocupava ~150px em três blocos centralizados; agora são
          ~60px, e o que sobrou de altura vai para o conteúdo das abas. */}
      <CabecalhoDoPainel onClose={onClose} tThread={tThread}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
          {contact.avatar_url ? (
            <img
              src={contact.avatar_url}
              alt={displayName}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </h3>
          <button
            onClick={handleCopyPhone}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            title={contact.phone}
          >
            <span className="truncate">{contact.phone}</span>
            {copied ? (
              <Check className="h-3 w-3 shrink-0 text-primary" />
            ) : (
              <Copy className="h-3 w-3 shrink-0" />
            )}
          </button>
        </div>
      </CabecalhoDoPainel>

      {/* Abas só-ícone. `title` + `aria-label` em cada gatilho: ícone sem nome
          acessível é um botão mudo para leitor de tela.
          ⚠️ Os overrides de altura são os mesmos que a ficha do contato
          (`contact-detail-view`) precisou descobrir na marra: o `h-8` do
          TabsList vem sob prefixo de variante, e `flex-1`/`h-[calc(100%-1px)]`
          do TabsTrigger se comportam mal em contêiner estreito. */}
      <Tabs
        defaultValue="principal"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="w-full shrink-0 justify-start gap-x-1 rounded-none border-b border-border bg-muted/30 px-2 py-1 group-data-horizontal/tabs:h-auto [&>button]:h-8 [&>button]:flex-1">
          <AbaDeIcone value="principal" label={tSidebar("tabMain")}>
            <User className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="historico" label={tSidebar("tabHistory")}>
            <History className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="notas" label={tSidebar("tabNotes")}>
            <StickyNote className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="tarefas" label={tSidebar("tabTasks")}>
            <ListTodo className="h-4 w-4" />
          </AbaDeIcone>
        </TabsList>

        {/* ⚠️ `overflow-y-auto` direto no TabsContent (padrão provado no
            `contact-detail-view`): overflow ≠ visible anula o clamp
            `min-height:auto` do item de flex — a mesma classe de bug que já
            cortou as notas desta coluna (issue #229). */}

        {/* ---- Principal: dados do contato + etiquetas + negócios ---- */}
        <TabsContent
          value="principal"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <div className="space-y-1">
            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
            {contact.company && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{contact.company}</span>
              </div>
            )}
            {/* Por qual número do escritório esta conversa corre. Só com 2+
                canais — com um só a resposta é óbvia. */}
            {channels.length >= 2 && channelId && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground">
                <Smartphone className="h-4 w-4 shrink-0" />
                <span className="text-xs">{tCanais("label")}</span>
                <ChannelCell
                  channels={channels}
                  channelId={channelId}
                  className="ml-auto"
                />
              </div>
            )}
          </div>

          {(contact.email || contact.company || (channels.length >= 2 && channelId)) && (
            <div className="my-4 border-t border-border" />
          )}

          {/* Etiquetas */}
          <div>
            <TituloDeSecao icon={<TagIcon className="h-3 w-3" />}>
              {tSidebar("tags")}
            </TituloDeSecao>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noTags")}
                </p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Negócios */}
          <div>
            <TituloDeSecao icon={<DollarSign className="h-3 w-3" />}>
              {tSidebar("deals")}
            </TituloDeSecao>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noDeals")}
                </p>
              ) : (
                deals.map((deal) => (
                  <div key={deal.id} className="rounded-lg bg-muted px-3 py-2">
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      {/* `formatCurrency`, não concatenação: a mão imprimia
                          "BRL1500" onde a conta inteira usa "R$ 1.500". */}
                      <span>{formatCurrency(deal.value, deal.currency)}</span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        {/* ---- Histórico de atividade (912) — o registro completo.
             Numa aba própria, sob demanda: é a tela de auditoria, não a de
             atendimento. `resyncToken` agora chega até ele. ---- */}
        <TabsContent
          value="historico"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <ActivityHistory contactId={contact.id} token={resyncToken} />
        </TabsContent>

        {/* ---- Notas ---- */}
        <TabsContent
          value="notas"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <div className="flex gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder={tSidebar("addNotePlaceholder")}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
            />
            <Button
              size="sm"
              className="h-auto bg-primary px-2 hover:bg-primary/90"
              onClick={handleAddNote}
              disabled={!newNote.trim() || addingNote || !conversationId}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          <div className="mt-2 space-y-2">
            {notes.map((note) => (
              <div key={note.id} className="rounded-lg bg-muted px-3 py-2">
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {note.texto}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                </p>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* ---- Tarefas (944). Fora do modo `compacto`: numa aba própria há
             altura de sobra, as concluídas não empurram nada para fora. ---- */}
        <TabsContent
          value="tarefas"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <ContactTasks contactId={contact.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Cabeçalho do painel. O botão de fechar fica na PONTA ESQUERDA — encostado
 * na fronteira com o fio, que é exatamente onde o operador procurava o
 * controle e não achava (ele morava no cabeçalho do fio, depois de quatro
 * outros botões). Renderizado também no estado vazio: o painel sem conversa
 * selecionada também precisa poder ser fechado.
 */
function CabecalhoDoPainel({
  onClose,
  tThread,
  children,
}: {
  onClose?: () => void;
  tThread: ReturnType<typeof useTranslations<"Inbox.messageThread">>;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={tThread("hideContactPanel")}
          title={tThread("hideContact")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      )}
      {children}
    </div>
  );
}

/** Gatilho de aba só-ícone: `title` + `aria-label`, senão é um botão mudo. */
function AbaDeIcone({
  value,
  label,
  children,
}: {
  value: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      title={label}
      aria-label={label}
      className="text-muted-foreground data-active:bg-muted data-active:text-primary"
    >
      {children}
    </TabsTrigger>
  );
}

/** Título de seção — a MESMA tipografia nas duas fichas (contato e grupo). */
export function TituloDeSecao({
  icon,
  children,
  className,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {icon}
      {children}
    </div>
  );
}
