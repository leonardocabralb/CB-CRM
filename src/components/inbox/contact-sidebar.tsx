"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useChannels } from "@/hooks/use-channels";
import { useConversationNotes } from "@/hooks/use-conversation-notes";
import { toast } from "sonner";
import { ChannelCell } from "@/components/channels/channel-badge";
import { ActivityHistory } from "@/components/lead-events/activity-history";
import { ContactTasks } from "@/components/tasks/contact-tasks";
import { cn } from "@/lib/utils";
import type { Contact, Deal, ConversationNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
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
}

export function ContactSidebar({ contact, conversationId, channelId }: ContactSidebarProps) {
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
   * Esta ficha é renderizada sem `key`, numa posição fixa da página — trocar
   * de conversa a re-renderiza, nunca a remonta. O texto do campo só era
   * limpo quando o salvamento dava certo. Então: escrever "cliente mentiu
   * sobre a data do acidente" na conversa do cliente A, clicar no cliente B
   * na lista (a ficha passa a mostrar o nome e o telefone de B, com o texto
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

  // Load on contact change. setContactData/setTags run inside async
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
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      {/* `min-h-0` é load-bearing: filho de flex nasce com
          min-height:auto, então sem ele este ScrollArea CRESCE para
          caber a ficha inteira em vez de encolher para o espaço que
          sobra — a coluna transborda, o fim (notas) é cortado e não
          aparece barra de rolagem nenhuma. Mesma causa da issue #229,
          já documentada em `conversation-list.tsx`. */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}

            {/* Por qual número do escritório esta conversa corre. Só com 2+
                canais — com um só a resposta é óbvia. */}
            {channels.length >= 2 && channelId && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Smartphone className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs">{tCanais("label")}</span>
                <ChannelCell
                  channels={channels}
                  channelId={channelId}
                  className="ml-auto"
                />
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
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

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
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

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tarefas (944) — o que ainda falta fazer com este cliente.
              ⚠️ Fica ANTES do Histórico de propósito: as duas são listas
              cronológicas e parecidas de longe, mas uma olha para a frente e a
              outra para trás. Quem está com a conversa aberta e pensa "preciso
              ligar para ele semana que vem" precisa da primeira ao alcance —
              se tiver de sair para a tela de Contatos, não cria a tarefa.
              `compacto` porque a barra lateral é estreita: as concluídas ficam
              atrás de um botão em vez de empurrarem as pendentes para fora. */}
          <ContactTasks contactId={contact.id} compacto />

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Histórico de atividade — o registro completo (migration 912).
              Fica aqui, e não só na conversa, porque é esta a tela que
              responde à pergunta de auditoria: a conversa mostra o que é
              relevante para o atendimento, esta mostra tudo, inclusive
              exclusão de negócio e linhas retroativas. */}
          <ActivityHistory contactId={contact.id} />

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
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
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.texto}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
