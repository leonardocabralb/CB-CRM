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
import { useCan } from "@/hooks/use-can";
import { toast } from "sonner";
import { ChannelCell } from "@/components/channels/channel-badge";
import { ActivityHistory } from "@/components/lead-events/activity-history";
import { ContactTasks } from "@/components/tasks/contact-tasks";
import { CustomFieldsManager } from "@/components/contacts/custom-fields-manager";
import { DealForm } from "@/components/pipelines/deal-form";
import { avisarDrenagemDeFunil } from "@/lib/automations/avisar-drenagem";
import { CampoPersonalizadoInput } from "@/components/contacts/campo-personalizado-input";
import { LinhaDeEdicao } from "@/components/inbox/painel/linha-de-edicao";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { salvarValoresDoContato } from "@/lib/contacts/custom-values";
import {
  camposDeTraqueamento,
  camposFaltantes,
  camposGerais,
} from "@/lib/contacts/campos-de-traqueamento";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type {
  Contact,
  CustomField,
  Deal,
  DealStatus,
  ConversationNote,
  PipelineStage,
  Tag,
} from "@/types";
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
  Loader2,
  Maximize2,
  Megaphone,
  PanelRightClose,
  Pencil,
  Save,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  /**
   * Avisa a página que o CONTATO mudou (ex.: nome renomeado aqui). A página
   * é dona do `activeContact` e da lista de conversas — sem o aviso, o nome
   * novo apareceria no painel e continuaria velho no cabeçalho do fio e na
   * lista até o próximo refetch.
   */
  onContactUpdated?: (patch: Partial<Contact>) => void;
}

export function PainelDoContato({
  contact,
  conversationId,
  channelId,
  resyncToken = 0,
  onClose,
  onContactUpdated,
}: PainelDoContatoProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");
  const tCanais = useTranslations("Channels");
  // Rótulos do negócio vêm do namespace do funil — mesmo texto nas duas
  // telas, de propósito (Marcar como ganho etc.).
  const tForm = useTranslations("Pipelines.form");
  const tCard = useTranslations("Pipelines.card");
  const { channels } = useChannels();
  // `user`/`accountId` só para o seed do catálogo de traqueamento — o insert
  // de `custom_fields` exige os dois carimbados à mão (NOT NULL sem default).
  const { user, accountId } = useAuth();
  // O mesmo gate da RLS: `agent`+ escreve contato/etiqueta/valores ("viewer"
  // só olha). O catálogo de CAMPOS é admin — gate separado, mais abaixo.
  const podeEditar = useCan("send-messages");
  const podeGerirCampos = useCan("edit-settings");

  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  // ---- Fase 2: edição dentro da conversa --------------------------------
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagOcupada, setTagOcupada] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEdit, setNomeEdit] = useState("");
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [salvandoCampos, setSalvandoCampos] = useState(false);
  const [gerirCamposAberto, setGerirCamposAberto] = useState(false);
  const [semeando, setSemeando] = useState(false);

  // ---- Fase 4: o negócio dentro da conversa ------------------------------
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [allStages, setAllStages] = useState<PipelineStage[]>([]);
  /** null = fechado; "criar" = DealForm em modo criação; Deal = edição. */
  const [dealFormAberto, setDealFormAberto] = useState<"criar" | Deal | null>(
    null,
  );
  const [negocioOcupado, setNegocioOcupado] = useState(false);

  // Recortes por categoria (949): a seção CAMPOS da Principal mostra só os
  // gerais; a aba Traqueamento, só os de anúncio.
  const gerais = useMemo(() => camposGerais(customFields), [customFields]);
  const tracking = useMemo(
    () => camposDeTraqueamento(customFields),
    [customFields],
  );
  const faltantes = useMemo(() => camposFaltantes(customFields), [customFields]);

  /**
   * O negócio que a seção edita: o ABERTO mais recente; sem nenhum aberto, o
   * mais recente de qualquer status (ganho/perdido aparece com "Reabrir").
   * ~1 negócio por contato nesta conta — os demais ficam numa lista de
   * leitura abaixo do cartão.
   */
  const dealAtivo = useMemo(
    () => deals.find((d) => d.status === "open") ?? deals[0] ?? null,
    [deals],
  );
  const etapasDoFunilAtivo = useMemo(
    () =>
      dealAtivo
        ? allStages
            .filter((s) => s.pipeline_id === dealAtivo.pipeline_id)
            .sort((a, b) => a.position - b.position)
        : [],
    [allStages, dealAtivo],
  );

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

    // Tudo em paralelo, NO TOPO do painel (trocar de aba não refaz query).
    // As anotações saem daqui de propósito: vêm do `useConversationNotes`
    // acima, que traz realtime junto.
    const [dealsRes, tagsRes, allTagsRes, fieldsRes, valuesRes, funisRes, etapasRes] =
      await Promise.all([
        supabase
          .from("deals")
          .select("*, stage:pipeline_stages(*)")
          .eq("contact_id", contact.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("contact_tags")
          .select("id, tag_id, tags(*)")
          .eq("contact_id", contact.id),
        supabase.from("tags").select("*").order("name"),
        supabase.from("custom_fields").select("*").order("field_name"),
        supabase
          .from("contact_custom_values")
          .select("*")
          .eq("contact_id", contact.id),
        // Fase 4: os seletores de funil/etapa do cartão de negócio.
        supabase.from("pipelines").select("id, name").order("name"),
        supabase.from("pipeline_stages").select("*").order("position"),
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
    if (allTagsRes.data) setAllTags(allTagsRes.data);
    if (fieldsRes.data) setCustomFields(fieldsRes.data as CustomField[]);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      for (const v of valuesRes.data) map[v.custom_field_id] = v.value ?? "";
      setCustomValues(map);
    }
    if (funisRes.data) setPipelines(funisRes.data);
    if (etapasRes.data) setAllStages(etapasRes.data as PipelineStage[]);
  }, [contact]);

  // Load on contact change. setDeals/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    fetchContactData();
  }, [fetchContactData]);

  // Trocar de conversa NO MEIO de uma edição de nome descartaria o texto no
  // contato errado — mesma classe de bug do rascunho de nota, mesma guarda.
  useEffect(() => {
    setEditandoNome(false);
  }, [contact?.id]);

  /**
   * Renomear o contato — escrita direta sob RLS (`agent`+), como as telas de
   * contato já fazem. O aviso à página (`onContactUpdated`) é o que propaga o
   * nome novo para o cabeçalho do fio e a lista de conversas sem refetch.
   */
  const salvarNome = useCallback(async () => {
    if (!contact) return;
    const nome = nomeEdit.trim();
    setSalvandoNome(true);
    const supabase = createClient();
    // Nome vazio volta a NULL — a ficha então mostra o telefone, que é o
    // comportamento de contato sem nome no resto do app.
    const { error } = await supabase
      .from("contacts")
      .update({ name: nome === "" ? null : nome })
      .eq("id", contact.id);
    setSalvandoNome(false);
    if (error) {
      toast.error(tSidebar("nameSaveError"));
      return;
    }
    setEditandoNome(false);
    onContactUpdated?.({ id: contact.id, name: nome === "" ? null : nome } as Partial<Contact>);
  }, [contact, nomeEdit, onContactUpdated, tSidebar]);

  /**
   * ⚠️ Etiqueta SÓ pelo `tag-api` (rota `/api/contacts/[id]/tags`): é o único
   * caminho que dispara a automação `tag_added` e valida a posse. Um insert
   * direto em `contact_tags` criaria etiqueta sem automação — e o evento da
   * trilha (912) viria do trigger igual, mascarando a diferença.
   */
  const toggleTag = useCallback(
    async (tag: Tag) => {
      if (!contact) return;
      const temTag = tags.some((t) => t.id === tag.id);
      setTagOcupada(tag.id);
      try {
        if (temTag) {
          await deleteContactTag(contact.id, tag.id);
          setTags((prev) => prev.filter((t) => t.id !== tag.id));
        } else {
          await addContactTag(contact.id, tag.id);
          // `contact_tag_id` de verdade só viria num refetch; para chave de
          // lista o id da etiqueta serve (UNIQUE por contato+etiqueta).
          setTags((prev) => [...prev, { ...tag, contact_tag_id: tag.id }]);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : tSidebar("tagError"));
      } finally {
        setTagOcupada(null);
      }
    },
    [contact, tags, tSidebar],
  );

  /**
   * ⚠️ A escrita do NEGÓCIO espelha o QUADRO (`pipelines/page.tsx`), de
   * propósito — é ISSO que garante "mesmo efeito que o arrasto": update
   * direto sob RLS, e os triggers da 912 (trilha) e da 933 (fila de
   * automações) disparam para qualquer escritor. O `avisarDrenagemDeFunil`
   * só antecipa a drenagem — sem ele o cron pega em ≤15 min.
   *
   * Regras invioláveis do caminho (CLAUDE.md):
   * - troca de funil = UM update só (`pipeline_id` + `stage_id` juntos);
   * - nunca escrever em `cb_lead_events`/`cb_automation_events` (42501);
   * - `conversation_id` só no NASCIMENTO (o DealForm cuida), nunca aqui.
   *
   * `deals` não tem realtime — o estado local é atualizado na mão, e erro
   * refaz a busca (o otimismo não pode sobreviver a um update recusado).
   */
  const atualizarNegocio = useCallback(
    async (
      deal: Deal,
      // `expected_close_date` é anulável no BANCO (limpar a data grava NULL),
      // mas o tipo `Deal` a declara só opcional — o `Omit` + reunião alarga
      // SÓ este campo, sem mexer no tipo compartilhado (interseção não
      // serviria: `string & (string|null)` volta a estreitar).
      patch: Partial<Omit<Deal, "expected_close_date">> & {
        expected_close_date?: string | null;
      },
      drenar: boolean,
    ) => {
      setNegocioOcupado(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("deals")
        .update(patch)
        .eq("id", deal.id);
      setNegocioOcupado(false);
      if (error) {
        toast.error(tSidebar("dealSaveError"));
        void fetchContactData();
        return;
      }
      setDeals((prev) =>
        prev.map((d) =>
          d.id === deal.id
            ? {
                ...d,
                ...patch,
                // O NULL que o banco recebeu vira `undefined` no estado — o
                // tipo `Deal` só conhece opcional, e para o render dá no
                // mesmo (input vazio).
                expected_close_date:
                  patch.expected_close_date === null
                    ? undefined
                    : (patch.expected_close_date ?? d.expected_close_date),
                // O badge da etapa lê o embed `stage` — sem re-hidratar aqui
                // ele mostraria a etapa velha até o próximo refetch.
                stage: patch.stage_id
                  ? (allStages.find((st) => st.id === patch.stage_id) ?? d.stage)
                  : d.stage,
              }
            : d,
        ),
      );
      if (drenar) avisarDrenagemDeFunil();
    },
    [allStages, fetchContactData, tSidebar],
  );

  const mudarEtapa = useCallback(
    (deal: Deal, stageId: string) => {
      if (stageId === deal.stage_id) return;
      void atualizarNegocio(deal, { stage_id: stageId }, true);
    },
    [atualizarNegocio],
  );

  const mudarFunil = useCallback(
    (deal: Deal, pipelineId: string) => {
      if (pipelineId === deal.pipeline_id) return;
      // ⚠️ UM update com as DUAS colunas: em dois, a trilha (912) conta que o
      // lead saiu e voltou, e a FK composta recusa o estado intermediário.
      // A etapa de chegada é a primeira do funil novo — mesma regra do
      // `deal-form` ao trocar de funil (o operador ajusta em seguida se
      // quiser outra).
      const primeira = allStages
        .filter((st) => st.pipeline_id === pipelineId)
        .sort((a, b) => a.position - b.position)[0];
      if (!primeira) return;
      void atualizarNegocio(
        deal,
        { pipeline_id: pipelineId, stage_id: primeira.id },
        true,
      );
    },
    [allStages, atualizarNegocio],
  );

  const mudarStatus = useCallback(
    (deal: Deal, status: DealStatus) => {
      const toasts: Record<DealStatus, string> = {
        won: tForm("toastMarkedWon"),
        lost: tForm("toastMarkedLost"),
        open: tForm("toastReopened"),
      };
      void atualizarNegocio(deal, { status }, true).then(() =>
        toast.success(toasts[status]),
      );
    },
    [atualizarNegocio, tForm],
  );

  /**
   * Valores dos campos — upsert compartilhado (nunca delete-all). Cada botão
   * salva SÓ a própria seção (o subconjunto de ids que ela mostra): o Salvar
   * da Principal não pode arrastar junto uma edição meio-feita na aba de
   * Traqueamento, e vice-versa.
   */
  const salvarCampos = useCallback(
    async (campos: CustomField[]) => {
      if (!contact) return;
      setSalvandoCampos(true);
      const subconjunto = Object.fromEntries(
        campos.map((f) => [f.id, customValues[f.id] ?? ""]),
      );
      const erro = await salvarValoresDoContato(
        createClient(),
        contact.id,
        subconjunto,
      );
      setSalvandoCampos(false);
      if (erro) toast.error(tSidebar("fieldsSaveError"));
      else toast.success(tSidebar("fieldsSaved"));
    },
    [contact, customValues, tSidebar],
  );

  /**
   * Semeia o catálogo padrão de traqueamento (949) — só os que FALTAM, e a
   * falta é medida pela CHAVE em qualquer categoria: um `utm_source` já
   * criado como campo geral não pode nascer de novo (chave é única por
   * conta). Admin apenas, como todo o catálogo.
   */
  const semearTraqueamento = useCallback(async () => {
    if (!user || !accountId || faltantes.length === 0) return;
    setSemeando(true);
    const supabase = createClient();
    const { error } = await supabase.from("custom_fields").insert(
      faltantes.map((c) => ({
        field_name: c.nome,
        field_key: c.key,
        field_type: "text",
        categoria: "tracking",
        user_id: user.id,
        account_id: accountId,
      })),
    );
    setSemeando(false);
    if (error) {
      toast.error(tSidebar("seedError"));
      return;
    }
    toast.success(tSidebar("seedDone"));
    void fetchContactData();
  }, [user, accountId, faltantes, fetchContactData, tSidebar]);

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
          {editandoNome ? (
            <LinhaDeEdicao
              valor={nomeEdit}
              onChange={setNomeEdit}
              placeholder={contact.phone}
              salvando={salvandoNome}
              onSalvar={() => void salvarNome()}
              onCancelar={() => setEditandoNome(false)}
            />
          ) : (
            <>
              {/* Clicar no nome edita (pedido direto do operador). O lápis só
                  aparece no hover para não poluir, mas o alvo de clique é o
                  nome INTEIRO — um ícone de 12px sozinho seria mira de dardo. */}
              <button
                type="button"
                onClick={() => {
                  if (!podeEditar) return;
                  setNomeEdit(contact.name ?? "");
                  setEditandoNome(true);
                }}
                disabled={!podeEditar}
                title={podeEditar ? tSidebar("editName") : undefined}
                className="group/nome flex w-full min-w-0 items-center gap-1 text-left"
              >
                <h3 className="truncate text-sm font-semibold text-foreground">
                  {displayName}
                </h3>
                {podeEditar && (
                  <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/nome:opacity-100" />
                )}
              </button>
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
            </>
          )}
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
        {/* Ordem definida pelo operador (2026-08-29): Principal, Notas,
            Tarefas, Traqueamento, e o Histórico POR ÚLTIMO — é a aba de
            auditoria, a que menos se abre no atendimento. */}
        <TabsList className="w-full shrink-0 justify-start gap-x-1 rounded-none border-b border-border bg-muted/30 px-2 py-1 group-data-horizontal/tabs:h-auto [&>button]:h-8 [&>button]:flex-1">
          <AbaDeIcone value="principal" label={tSidebar("tabMain")}>
            <User className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="notas" label={tSidebar("tabNotes")}>
            <StickyNote className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="tarefas" label={tSidebar("tabTasks")}>
            <ListTodo className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="traqueamento" label={tSidebar("tabTracking")}>
            <Megaphone className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="historico" label={tSidebar("tabHistory")}>
            <History className="h-4 w-4" />
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
          {/* ---- NEGÓCIO — no TOPO, editável (Fase 4). O operador trabalha
               o funil DAQUI: "o funil vai ser um reflexo da caixa de
               entrada". A escrita espelha o arrasto do quadro (ver
               `atualizarNegocio`); o formulário completo continua sendo o
               `DealForm`, aberto pelo botão. ---- */}
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <TituloDeSecao icon={<DollarSign className="h-3 w-3" />}>
                {tSidebar("deals")}
              </TituloDeSecao>
              {podeEditar && dealAtivo && (
                <button
                  type="button"
                  onClick={() => setDealFormAberto(dealAtivo)}
                  title={tForm("editDeal")}
                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Maximize2 className="h-3 w-3" />
                  {tSidebar("openFullDeal")}
                </button>
              )}
            </div>

            {!dealAtivo ? (
              <div className="mt-2 space-y-2">
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noDeals")}
                </p>
                {podeEditar && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDealFormAberto("criar")}
                    className="w-full"
                  >
                    <Plus className="size-3.5" />
                    {tForm("newDeal")}
                  </Button>
                )}
              </div>
            ) : (
              <div className="mt-2 space-y-2 rounded-lg bg-muted px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-foreground">
                    {dealAtivo.title}
                  </p>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      dealAtivo.status === "won" &&
                        "bg-emerald-500/15 text-emerald-500",
                      dealAtivo.status === "lost" &&
                        "bg-destructive/15 text-destructive",
                      dealAtivo.status === "open" &&
                        "bg-primary/15 text-primary",
                    )}
                  >
                    {dealAtivo.status === "won"
                      ? tCard("won")
                      : dealAtivo.status === "lost"
                        ? tCard("lost")
                        : tSidebar("statusOpen")}
                  </span>
                </div>

                {/* Funil — só com 2+ (a mesma regra do deal-form: com um só,
                    o seletor não decide nada). */}
                {pipelines.length > 1 && (
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {tForm("pipeline")}
                    </Label>
                    <Select
                      value={dealAtivo.pipeline_id}
                      onValueChange={(v) =>
                        v != null && mudarFunil(dealAtivo, String(v))
                      }
                      disabled={!podeEditar || negocioOcupado}
                    >
                      <SelectTrigger className="h-8 w-full bg-card">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {pipelines.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Etapa — a cor da etapa na frente do nome, como no quadro. */}
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {tForm("stage")}
                  </Label>
                  <Select
                    value={dealAtivo.stage_id}
                    onValueChange={(v) =>
                      v != null && mudarEtapa(dealAtivo, String(v))
                    }
                    disabled={!podeEditar || negocioOcupado}
                  >
                    <SelectTrigger className="h-8 w-full bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {etapasDoFunilAtivo.map((st) => (
                        <SelectItem key={st.id} value={st.id}>
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: st.color }}
                            />
                            {st.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Valor e fechamento previsto — salvos no blur. A `key`
                    inclui o VALOR SALVO, não só o id: input não-controlado
                    com `defaultValue` mutável faz o Base UI avisar no console
                    a cada save; com o valor na chave, o save REMONTA o input
                    já com o default novo (o foco já se foi — o save é no
                    blur), e trocar de conversa remonta pelo id. */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {tForm("value")}
                    </Label>
                    <Input
                      key={`valor-${dealAtivo.id}-${dealAtivo.value}`}
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={dealAtivo.value || ""}
                      disabled={!podeEditar || negocioOcupado}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        if (v !== dealAtivo.value)
                          void atualizarNegocio(dealAtivo, { value: v }, false);
                      }}
                      className="h-8 bg-card text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {tForm("expectedCloseDate")}
                    </Label>
                    <Input
                      key={`fecha-${dealAtivo.id}-${dealAtivo.expected_close_date ?? ""}`}
                      type="date"
                      defaultValue={dealAtivo.expected_close_date ?? ""}
                      disabled={!podeEditar || negocioOcupado}
                      onBlur={(e) => {
                        const v = e.target.value || null;
                        if (v !== (dealAtivo.expected_close_date ?? null))
                          void atualizarNegocio(
                            dealAtivo,
                            { expected_close_date: v },
                            false,
                          );
                      }}
                      className="h-8 bg-card text-sm"
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  {formatCurrency(dealAtivo.value, dealAtivo.currency)}
                </p>

                {/* Ganho / Perdido / Reabrir — os MESMOS updates do
                    deal-form; o status também dispara automação (933). */}
                {podeEditar &&
                  (dealAtivo.status === "open" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={negocioOcupado}
                        onClick={() => mudarStatus(dealAtivo, "won")}
                        className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400"
                      >
                        {tCard("won")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={negocioOcupado}
                        onClick={() => mudarStatus(dealAtivo, "lost")}
                        className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        {tCard("lost")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={negocioOcupado}
                      onClick={() => mudarStatus(dealAtivo, "open")}
                      className="w-full"
                    >
                      {tForm("reopenDeal")}
                    </Button>
                  ))}
              </div>
            )}

            {/* Os DEMAIS negócios (raro nesta conta): leitura, como antes. */}
            {deals
              .filter((d) => d.id !== dealAtivo?.id)
              .map((deal) => (
                <div
                  key={deal.id}
                  className="mt-2 rounded-lg bg-muted/60 px-3 py-2"
                >
                  <p className="truncate text-sm font-medium text-foreground">
                    {deal.title}
                  </p>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
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
              ))}
          </div>

          <div className="my-4 border-t border-border" />

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

          {/* Etiquetas — clicar numa aplicada REMOVE; o "+" abre o catálogo
              da conta para aplicar. Criar etiqueta nova fica nas telas de
              Contatos/Configurações (catálogo é admin; aplicar é agent). */}
          <div>
            <div className="flex items-center justify-between">
              <TituloDeSecao icon={<TagIcon className="h-3 w-3" />}>
                {tSidebar("tags")}
              </TituloDeSecao>
              {podeEditar && allTags.length > 0 && (
                <Popover>
                  <PopoverTrigger
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={tSidebar("addTag")}
                  >
                    <Plus className="h-3 w-3" />
                    {tSidebar("addTag")}
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" sideOffset={6}>
                    <div className="flex max-h-56 flex-wrap gap-1 overflow-y-auto">
                      {allTags.map((tag) => {
                        const aplicada = tags.some((t) => t.id === tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            disabled={tagOcupada === tag.id}
                            onClick={() => void toggleTag(tag)}
                            className={cn(
                              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity disabled:opacity-50",
                              !aplicada && "opacity-50 hover:opacity-100",
                            )}
                            style={{
                              backgroundColor: `${tag.color}20`,
                              color: tag.color,
                            }}
                          >
                            {aplicada && <Check className="h-2.5 w-2.5" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noTags")}
                </p>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag.contact_tag_id}
                    type="button"
                    disabled={!podeEditar || tagOcupada === tag.id}
                    onClick={() => void toggleTag(tag)}
                    title={podeEditar ? tSidebar("removeTag") : undefined}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity enabled:hover:opacity-70"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="my-4 border-t border-border" />

          {/* Campos personalizados (948) — visíveis e editáveis DE DENTRO da
              conversa, que era a queixa: existiam só na ficha de /contacts.
              O catálogo (criar/renomear campo) abre o MESMO diálogo daquela
              tela; fechar o diálogo refaz a busca para o painel enxergar o
              campo recém-criado. */}
          <div>
            <div className="flex items-center justify-between">
              <TituloDeSecao icon={<Settings2 className="h-3 w-3" />}>
                {tSidebar("customFields")}
              </TituloDeSecao>
              {podeGerirCampos && (
                <button
                  type="button"
                  onClick={() => setGerirCamposAberto(true)}
                  className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Settings2 className="h-3 w-3" />
                  {tSidebar("manageFields")}
                </button>
              )}
            </div>
            <div className="mt-2 space-y-3">
              {gerais.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">
                  {tSidebar("noFields")}
                </p>
              ) : (
                <>
                  {gerais.map((field) => (
                    <div key={field.id} className="space-y-1">
                      <Label className="text-xs capitalize text-muted-foreground">
                        {field.field_name}
                      </Label>
                      <CampoPersonalizadoInput
                        field={field}
                        value={customValues[field.id] ?? ""}
                        onChange={(v) =>
                          setCustomValues((prev) => ({ ...prev, [field.id]: v }))
                        }
                        disabled={!podeEditar}
                      />
                    </div>
                  ))}
                  {podeEditar && (
                    <Button
                      size="sm"
                      onClick={() => void salvarCampos(gerais)}
                      disabled={salvandoCampos}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {salvandoCampos ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {tSidebar("saveFields")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
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

        {/* ---- Traqueamento (949) — os campos que o clique no anúncio
             produz (UTMs, fbclid, ctwa_clid, nomes de campanha/conjunto/
             anúncio). São campos personalizados comuns com categoria
             'tracking': a automação `update_contact_field` já os preenche e
             a futura integração com a API de Conversões da Meta os lê pelo
             `field_key`. O seed cria só os que FALTAM (admin). ---- */}
        <TabsContent
          value="traqueamento"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <div className="space-y-3">
            {tracking.length === 0 && (
              <p className="px-1 text-xs text-muted-foreground">
                {tSidebar("noTrackingFields")}
              </p>
            )}
            {podeGerirCampos && faltantes.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void semearTraqueamento()}
                disabled={semeando}
                className="w-full"
              >
                {semeando ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {tSidebar("seedTrackingFields", { count: faltantes.length })}
              </Button>
            )}
            {tracking.map((field) => (
              <div key={field.id} className="space-y-1">
                {/* Sem `capitalize`: utm_source/fbclid são nomes TÉCNICOS e
                    mudá-los visualmente atrapalha quem confere o parâmetro. */}
                <Label className="text-xs text-muted-foreground">
                  {field.field_name}
                </Label>
                <CampoPersonalizadoInput
                  field={field}
                  value={customValues[field.id] ?? ""}
                  onChange={(v) =>
                    setCustomValues((prev) => ({ ...prev, [field.id]: v }))
                  }
                  disabled={!podeEditar}
                />
              </div>
            ))}
            {podeEditar && tracking.length > 0 && (
              <Button
                size="sm"
                onClick={() => void salvarCampos(tracking)}
                disabled={salvandoCampos}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {salvandoCampos ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {tSidebar("saveFields")}
              </Button>
            )}
          </div>
        </TabsContent>

        {/* ---- Histórico de atividade (912) — o registro completo, POR
             ÚLTIMO na fileira: é a aba de auditoria, a que menos se abre no
             atendimento. `resyncToken` chega até ele. ---- */}
        <TabsContent
          value="historico"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <ActivityHistory contactId={contact.id} token={resyncToken} />
        </TabsContent>
      </Tabs>

      {/* O gerenciador do CATÁLOGO — o mesmo diálogo da tela de Contatos.
          Fechar refaz a busca: o campo recém-criado tem de aparecer na seção
          sem o operador precisar trocar de conversa. */}
      {podeGerirCampos && (
        <CustomFieldsManager
          open={gerirCamposAberto}
          onOpenChange={(aberto) => {
            setGerirCamposAberto(aberto);
            if (!aberto) void fetchContactData();
          }}
        />
      )}

      {/* O formulário COMPLETO do negócio — o mesmo Sheet da tela de Funis
          (zero caminho novo de escrita; criação continua sendo só dele, com
          o contato desta conversa pré-selecionado e o `conversation_id`
          carimbado no nascimento, como manda a 910). */}
      {podeEditar && dealFormAberto !== null && (
        <DealForm
          open
          onOpenChange={(aberto) => {
            if (!aberto) setDealFormAberto(null);
          }}
          deal={dealFormAberto === "criar" ? null : dealFormAberto}
          pipelineId={
            dealFormAberto === "criar"
              ? (dealAtivo?.pipeline_id ?? pipelines[0]?.id ?? "")
              : dealFormAberto.pipeline_id
          }
          stages={allStages.filter((st) =>
            dealFormAberto === "criar"
              ? st.pipeline_id === (dealAtivo?.pipeline_id ?? pipelines[0]?.id)
              : st.pipeline_id === dealFormAberto.pipeline_id,
          )}
          defaultContactId={contact.id}
          onSaved={() => {
            setDealFormAberto(null);
            void fetchContactData();
          }}
        />
      )}
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
