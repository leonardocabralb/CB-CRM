'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Search,
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Filter,
  X,
  Trash,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { MoverParaLixeiraDialog } from '@/components/contacts/mover-para-lixeira-dialog';
import { useCan } from '@/hooks/use-can';
import { useAoVoltarParaOApp } from '@/hooks/use-ao-voltar-para-o-app';
import { selecaoRestante } from '@/lib/contacts/exclusao';
import { escaparLike, ramoContem } from '@/lib/postgrest/literal';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';
import { identidadeDoContato, nomeDoContato } from '@/lib/contacts/identidade';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const t = useTranslations('Contacts.page');
  const supabase = createClient();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');
  // ⚠️ APAGAR contato é de admin (decisão do operador, 08/09/2026), enquanto
  // EDITAR segue de `agent`. Desde a 1097 apagar é MOVER PARA A LIXEIRA (90
  // dias, restaurável; `cb_mover_contatos_para_lixeira` confere admin por
  // dentro) — a ficha some de todas as telas com a conversa e as mensagens.
  // A policy `contacts_delete` (981) continua: sem os dois lados, o botão
  // sumiria e um `.delete()` do navegador ainda apagaria.
  const podeApagarContatos = useCan('delete-contacts');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  // Deep link `?contact=<id>` — o caminho de volta para a ficha a partir de uma
  // tarefa cujo cliente nunca trocou mensagem (e por isso não tem conversa
  // para abrir no inbox).
  //
  // ⚠️ Resolvido no ESTADO INICIAL, não num efeito: a ficha só precisa do id
  // para carregar sozinha, então não há nada a esperar. Num efeito, a lista
  // pintaria uma vez com a gaveta fechada e ela abriria depois, com um salto
  // visível. Consequência aceita: chegar a `/contacts` e depois trocar SÓ a
  // query, sem remontar a página, não reabre a gaveta — não há caminho na
  // interface que faça isso hoje.
  const deepLinkContactId = useSearchParams().get('contact');
  const [detailOpen, setDetailOpen] = useState(!!deepLinkContactId);
  const [detailContactId, setDetailContactId] = useState<string | null>(
    deepLinkContactId,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  // As fichas do "Mover para a Lixeira" (uma, pelo menu da linha, ou a
  // seleção), capturadas na abertura; NULO = diálogo fechado.
  const [moverIds, setMoverIds] = useState<string[] | null>(null);

  // Bulk selection (page-scoped — only the loaded rows are selectable)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      // ⚠️ Troca o mapa SÓ quando o catálogo mudou. `fetchContacts` depende de
      // `tagsMap`, e um mapa novo com o mesmo conteúdo refaria a lista inteira
      // com spinner e seleção zerada — a cada volta ao app, que recarrega o
      // catálogo (`useAoVoltarParaOApp`; Codex, PR #216, 2ª rodada).
      setTagsMap((prev) => {
        const ids = Object.keys(map);
        const igual =
          ids.length === Object.keys(prev).length &&
          ids.every((id) => JSON.stringify(prev[id]) === JSON.stringify(map[id]));
        return igual ? prev : map;
      });
      // Drop any filter selections whose tag no longer exists (e.g. a tag
      // deleted elsewhere) so it can't linger invisibly in the query.
      setSelectedTagIds((prev) => {
        const pruned = prev.filter((id) => map[id]);
        return pruned.length === prev.length ? prev : pruned;
      });
    }
  }, [supabase]);

  const fetchContacts = useCallback(async (opcoes?: { preservarSelecao?: boolean; silencioso?: boolean }) => {
    const seq = ++fetchSeq.current;
    // ⚠️ `silencioso` mantém a tabela na tela até a resposta chegar: é o
    // recarregar de quem VOLTA para o app (`useAoVoltarParaOApp`), e ligar o
    // `loading` trocaria as linhas pelo spinner a cada volta do WhatsApp.
    if (!opcoes?.silencioso) setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    //
    // ⚠️ MENOS quando quem recarrega já cuidou da seleção: uma exclusão
    // recusada não muda linha nenhuma, e limpar ali jogaria fora a seleção
    // que o operador precisa manter para tentar de novo (achado do Codex no
    // PR #138 — sem esta saída, a poda por `selecaoRestante` não valia na
    // prática; hoje é o `aposMover` da Lixeira que a usa).
    // Chamador que passa um EVENTO (onUpdated/onImported) não tem a chave e
    // cai no comportamento normal.
    if (!opcoes?.preservarSelecao) setSelected(new Set());

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let contactRows: Contact[];
    let count: number;

    if (selectedTagIds.length > 0) {
      // Tag filter active — resolve it server-side (join + distinct +
      // windowed total count + pagination) so a tag covering many
      // contacts can't silently truncate the result or overflow an IN
      // clause. See migration 025_filter_contacts_by_tags.
      const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
        p_tag_ids: selectedTagIds,
        // A função faz `ILIKE '%' || p_search || '%'` (025): o termo vai com
        // o escape do LIKE, senão `%` e `_` digitados viram curingas.
        p_search: term ? escaparLike(term) : null,
        p_limit: PAGE_SIZE,
        p_offset: from,
      });
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      contactRows = rows.map((r) => r.contact);
      count = rows.length > 0 ? Number(rows[0].total_count) : 0;
    } else {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (term) {
        // ⚠️ Literal (`ramoContem`): cru, a vírgula e o parêntese de
        // "silva, jr" ou "(83) 9887" quebravam o `.or()` (400, e a tela dizia
        // "falha ao carregar"), e `%`, `_` e `*` viravam curingas.
        query = query.or(
          ['name', 'phone', 'email'].map((coluna) => ramoContem(coluna, term)).join(','),
        );
      }

      const { data, count: exactCount, error } = await query;
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      contactRows = data ?? [];
      count = exactCount ?? 0;
    }

    setTotalCount(count);

    // ⚠️ A recarga SILENCIOSA (volta ao app) preserva a seleção, mas a página
    // pode ter mudado enquanto a pessoa estava fora — outro membro apagou,
    // criou ou reetiquetou contatos. Id que saiu da página NÃO pode continuar
    // selecionado: a ação em massa age sobre `selected` inteiro, e apagaria um
    // contato que ninguém está vendo marcado (Codex, PR #216). Fica marcado só
    // o que continua na tela.
    const podarSelecao = (visiveis: { id: string }[]) => {
      if (!opcoes?.silencioso) return;
      const naPagina = new Set(visiveis.map((c) => c.id));
      setSelected((prev) => {
        const podada = new Set([...prev].filter((id) => naPagina.has(id)));
        return podada.size === prev.size ? prev : podada;
      });
    };

    if (contactRows.length === 0) {
      setContacts([]);
      podarSelecao([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = contactRows.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = contactRows.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    podarSelecao(enriched);
    setLoading(false);
  }, [supabase, page, search, selectedTagIds, tagsMap, t]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  // ⚠️ Quando SÓ o catálogo de etiquetas mudou — a página, a busca e o filtro
  // são os mesmos —, a lista é refeita em silêncio e com a seleção. O
  // `fetchContacts` depende de `tagsMap`, e a volta ao app recarrega o
  // catálogo: um refetch comum ali ligaria o spinner e zeraria a seleção de
  // quem preparava uma ação em massa (Codex, PR #216, 3ª rodada). Mudou a
  // página, a busca ou o filtro: recarga comum, com a seleção zerada, como
  // sempre.
  const chaveDaListaRef = useRef<string | null>(null);
  useEffect(() => {
    const chave = JSON.stringify([page, search, selectedTagIds]);
    const soOCatalogo = chaveDaListaRef.current === chave;
    chaveDaListaRef.current = chave;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts(
      soOCatalogo ? { silencioso: true, preservarSelecao: true } : undefined,
    );
  }, [fetchContacts, page, search, selectedTagIds]);

  // O app instalado no celular não tem botão de recarregar: voltar para ele
  // depois de um tempo fora atualiza a página aberta da tabela, sem trocá-la
  // pelo spinner e sem perder a seleção de quem estava no meio de uma ação.
  // ⚠️ O catálogo de etiquetas vai junto: etiqueta criada, renomeada ou
  // apagada por outro membro enquanto a pessoa estava fora sumiria da linha,
  // ficaria com o nome velho ou seguiria filtrando a lista (Codex, PR #216).
  // Se o catálogo não mudou, o `fetchTags` não troca o mapa e nada mais roda.
  useAoVoltarParaOApp(() => {
    void fetchTags();
    void fetchContacts({ preservarSelecao: true, silencioso: true });
  });

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  /**
   * Depois de mover para a Lixeira: a seleção perde os RESOLVIDOS (movidos e
   * os que já não existiam) e só eles — o recusado continua marcado, que é o
   * que falta resolver —, e a recarga PRESERVA o que sobrou (ela zera a
   * seleção por conta própria; Codex, #138/#139). Nada resolvido: nada mudou
   * na lista.
   */
  function aposMover(resolvidos: string[]) {
    if (resolvidos.length === 0) return;
    setSelected((atual) => selecaoRestante(atual, resolvidos));
    void fetchContacts({ preservarSelecao: true });
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Tag filter helpers. Every change resets to page 0 — the result set
  // shrinks/grows so page N may no longer be valid (mirrors the search box).
  const allTags = Object.values(tagsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const hasActiveFilters = search.trim().length > 0 || selectedTagIds.length > 0;

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearTagFilters() {
    setSelectedTagIds([]);
    setPage(0);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount > 0 ? t('subtitle', { count: totalCount }) : t('subtitleZero')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A Lixeira (1097) é de quem exclui: some para quem não é admin.
              No celular, só o ícone — a fileira já tem três botões. */}
          {podeApagarContatos && (
            <Link
              href="/contacts/lixeira"
              aria-label={t('lixeiraBtn')}
              title={t('lixeiraBtn')}
              className={buttonVariants({
                variant: 'outline',
                className: 'border-border text-muted-foreground hover:bg-muted',
              })}
            >
              <Trash className="size-4" />
              <span className="hidden sm:inline">{t('lixeiraBtn')}</span>
            </Link>
          )}
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setCustomFieldsOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="size-4" />
              {t('customFieldsBtn')}
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="addOrImportContacts"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            {t('importBtn')}
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="addOrImportContacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            {t('addContactBtn')}
          </GatedButton>
        </div>
      </div>

      {/* Search + tag filter */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Reset pagination when the query changes — the result
                // set shrinks/grows, page N may no longer be valid.
                setPage(0);
              }}
              placeholder={t('searchPlaceholder')}
              className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                />
              }
            >
              <Filter className="size-4" />
              {t('filterByTags')}
              {selectedTagIds.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedTagIds.length}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-sm font-medium text-popover-foreground">
                  {t('filterByTags')}
                </span>
                {selectedTagIds.length > 0 && (
                  <button
                    onClick={clearTagFilters}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('clearAll')}
                  </button>
                )}
              </div>
              {allTags.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {t('noTagsYet')}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto py-1">
                  {allTags.map((tag) => (
                    <label
                      key={tag.id}
                      className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedTagIds.includes(tag.id)}
                        onCheckedChange={() => toggleTagFilter(tag.id)}
                        aria-label={t('filterByTag', { name: tag.name })}
                      />
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-sm text-popover-foreground truncate">
                        {tag.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Active tag-filter chips */}
        {selectedTagIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTagIds.map((id) => {
              const tag = tagsMap[id];
              if (!tag) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: tag.color + '20',
                    color: tag.color,
                  }}
                >
                  {tag.name}
                  <button
                    onClick={() => toggleTagFilter(id)}
                    aria-label={t('removeTagFilter', { name: tag.name })}
                    className="hover:opacity-70"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            <button
              onClick={clearTagFilters}
              className="text-xs text-muted-foreground hover:text-foreground px-1"
            >
              {t('clearAll')}
            </button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-4 py-2">
          <p className="text-sm text-foreground">
            {t('selectedCount', { count: selected.size })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('clearSelection')}
            </Button>
            {/* ⚠️ SOME para quem não é admin, como o item do menu da linha.
                Um `GatedButton` desabilitado anunciaria um dos dois caminhos
                de exclusão a quem não pode usá-lo — os dois têm de
                desaparecer juntos (achado do Codex no PR #137). */}
            {podeApagarContatos && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setMoverIds([...selected])}
              >
                <Trash2 className="size-4" />
                {t('moverSelecionados')}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && someOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={contacts.length === 0}
                  aria-label={t('selectAllOnPage')}
                />
              </TableHead>
              <TableHead className="text-muted-foreground">{t('tableColumns.name')}</TableHead>
              <TableHead className="text-muted-foreground">{t('tableColumns.phone')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('tableColumns.email')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('tableColumns.company')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('tableColumns.tags')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('tableColumns.createdAt')}</TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">{t('loading')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? t('noContactsMatch')
                        : t('noContactsYet')}
                    </p>
                    {!hasActiveFilters && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="addOrImportContacts"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        {t('addFirstContact')}
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(contact.id)}
                      onCheckedChange={() => toggleSelect(contact.id)}
                      aria-label={t('selectContact', { name: nomeDoContato(contact, t('unnamed')) })}
                    />
                  </TableCell>
                  <TableCell className="text-foreground font-medium">
                    {contact.name || <span className="text-muted-foreground italic">{t('unnamed')}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {identidadeDoContato(contact)}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                    {contact.email || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell text-sm">
                    {contact.company || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                    {new Date(contact.created_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-popover border-border"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          {t('editAction')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        {/* ⚠️ Some para quem não é admin, em vez de aparecer
                            desabilitado: até 08/09/2026 este item não tinha
                            gate NENHUM — era o único caminho de exclusão sem
                            guarda na tela, e a policy da 017 deixava o
                            atendente apagar de verdade. */}
                        {podeApagarContatos && (
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMoverIds([contact.id]);
                            }}
                          >
                            <Trash2 className="size-4" />
                            {t('moverParaLixeira')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('showingPagination', {
              start: page * PAGE_SIZE + 1,
              end: Math.min((page + 1) * PAGE_SIZE, totalCount),
              total: totalCount
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {t('pageCount', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchContacts}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      {/* Mover para a Lixeira (1097): a exclusão de UMA ficha e a da seleção.
          A prévia, o toast com "Desfazer" e as recusas moram no componente. */}
      <MoverParaLixeiraDialog
        ids={moverIds}
        aoFechar={() => setMoverIds(null)}
        aoMover={aposMover}
        aoDesfazer={() => void fetchContacts({ preservarSelecao: true, silencioso: true })}
      />
    </div>
  );
}
