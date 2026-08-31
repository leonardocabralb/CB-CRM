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
  recorteTemDoisNiveis,
  type FiltrosDoInbox,
} from "@/lib/inbox/filtros";
import {
  TERMO_MINIMO,
  termoBuscavel,
  type AchadoNoTexto,
} from "@/lib/inbox/busca-em-mensagens";
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
import { Search, Users, Star, MessageSquareText, MessageSquarePlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NovaConversaDialog } from "@/components/inbox/nova-conversa-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBuscaEmMensagens } from "@/hooks/use-busca-em-mensagens";
import { useChannels } from "@/hooks/use-channels";
import { useAuth } from "@/hooks/use-auth";
import { canaisVisiveis, conversaNoEscopo } from "@/lib/perfis/escopo";
import { canSendMessages, isAccountRole } from "@/lib/auth/roles";
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
  /**
   * O termo da busca, já assentado (ver `termoAplicado` em
   * `useBuscaEmMensagens`), para quem estiver fora desta lista.
   *
   * ⚠️ Existe porque a caixa de busca mora AQUI e o fio da conversa é irmão,
   * não filho: sem este aviso ao pai, o fio não tem como saber que existe uma
   * busca em curso — e é ele quem precisa rolar até a mensagem e destacá-la.
   * O estado continua sendo desta lista; o pai só ESPELHA, para repassar.
   * Subir o `useState` da caixa para a página faria o fio inteiro
   * re-renderizar a cada tecla digitada.
   */
  onTermoDeBusca?: (termo: string) => void;
  /**
   * Abriu uma conversa pelo botão "nova conversa". O pai é quem sabe
   * recarregar a lista e navegar até ela (`?c=`), então o botão mora aqui só
   * visualmente — sem o callback ele nem aparece.
   */
  onConversaAberta?: (conversationId: string) => void;
  /**
   * Etapa de funil vinda da URL (`?etapa=`, botão da coluna do quadro).
   * Semeia o filtro UMA vez, no estado inicial — a lista não remonta quando
   * a URL muda (App Router preserva o state em navegação na mesma rota),
   * então o seed não reaplica por cima de um filtro que o operador limpou.
   * O recorte em si espera os dados (`recorteDeEtapaConfiavel` no ctx).
   */
  etapaInicial?: string | null;
  /**
   * `de === "funil"` na URL — a jornada quadro→inbox está viva. ⚠️ Quando ela
   * MORRE (clique em "Caixa de entrada" na sidebar, numa notificação: a URL
   * limpa, a faixa "Voltar ao funil" some), o filtro SEMEADO morre junto —
   * sem isso, a página não remonta e a lista continuava recortada por uma
   * etapa que nada na tela explicava. Só o seed é limpo: etapa escolhida à
   * mão no painel não é tocada.
   */
  jornadaDoFunil?: boolean;
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
  onTermoDeBusca,
  onConversaAberta,
  etapaInicial = null,
  jornadaDoFunil = false,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  const [novaConversaAberta, setNovaConversaAberta] = useState(false);

  // ⚠️ A busca fica SEPARADA dos filtros, e de propósito. Ela responde "onde
  // está aquela conversa" (nome, telefone, nome do grupo, texto da última
  // mensagem); os filtros respondem "quais conversas se parecem com isto".
  // Trocar uma pela outra apagaria a busca por texto de mensagem e por nome
  // de grupo, que é o que a revisão prévia desta fase encontrou.
  const [search, setSearch] = useState("");
  const [filtros, setFiltros] = useState<FiltrosDoInbox>(() =>
    etapaInicial ? { ...FILTROS_VAZIOS, etapaId: etapaInicial } : FILTROS_VAZIOS,
  );
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [etapas, setEtapas] = useState<PipelineStage[]>([]);
  // Nome do funil de cada etapa — só é usado quando há mais de um funil, e aí
  // vira load-bearing: dois funis costumam ter "Lead" e "Qualificado" com o
  // mesmo nome, e o seletor mostraria dois itens idênticos ordenados por
  // posição, sem o operador poder distingui-los.
  const [funis, setFunis] = useState<Map<string, string>>(new Map());
  // ⚠️ Sem isto o filtro de etapa RESPONDE ERRADO em vez de sumir. O gate dele
  // olha `pipeline_stages`, que é OUTRA consulta: se `deals` falhar sozinha, o
  // seletor aparece completo, escolher qualquer etapa devolve zero e escolher
  // "Sem negócio" devolve as 64 — a resposta exatamente invertida, sem erro na
  // tela.
  // O estado do PAR de consultas que sustenta o filtro de etapa
  // (`pipeline_stages` + `deals`): "carregando" segura o spinner do deep
  // link `?etapa=`, "ok" libera o recorte, "indisponivel" liga o aviso
  // inline. Um enum, e não dois booleans, para o estado impossível
  // (resolvido-mas-não-resolvido) não existir.
  const [etapasStatus, setEtapasStatus] = useState<
    "carregando" | "ok" | "indisponivel"
  >("carregando");
  const [temPerfis, setTemPerfis] = useState(false);
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
  // `resyncToken` porque `cb_conversation_favorites` não está no realtime:
  // marcar no celular não apareceria nesta aba até recarregar a página.
  const {
    favoritas,
    pronto: favoritasProntas,
    falhouAoCarregar: falhouFavoritas,
    alternar: alternarFavorita,
  } = useFavoritas(resyncToken);

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

  // As buscas abaixo alimentam SÓ o painel de filtros. Rodam sob RLS, então já
  // vêm escopadas à conta.
  //
  // ⚠️ NENHUMA delas pode falhar "em silêncio" de verdade. Um filtro que
  // aparece sem os dados por trás não some: ele RESPONDE ERRADO, com cara de
  // resposta certa. Por isso cada uma tem um sinalizador próprio, e o painel
  // esconde o campo cujo dado não chegou — some é honesto, mentir não é.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    // TODOS os negócios da conta, PAGINANDO além do teto de ~1000 linhas do
    // PostgREST. Antes a consulta era única e o `count: 'exact'` só DETECTAVA
    // a truncagem — passar de 1000 negócios derrubava o filtro de etapa para
    // sempre (achado da revisão do PR #71); agora o count fecha o laço.
    // `linhas: null` = não dá para confiar (erro, ou dado mudando no meio).
    const buscarDeals = async (): Promise<{
      linhas: { contact_id: string | null; stage_id: string | null }[] | null;
    }> => {
      const PAGINA = 1000;
      const acumulado: { contact_id: string | null; stage_id: string | null }[] =
        [];
      let total: number | null = null;
      for (let pagina = 0; pagina < 25; pagina++) {
        const de = pagina * PAGINA;
        const { data, error, count } = await supabase
          .from("deals")
          .select("contact_id, stage_id", { count: "exact" })
          .range(de, de + PAGINA - 1);
        if (error || !data) return { linhas: null };
        acumulado.push(...(data as typeof acumulado));
        total = count ?? total;
        if (total == null || acumulado.length >= total || data.length < PAGINA) {
          return {
            linhas:
              total != null && acumulado.length < total ? null : acumulado,
          };
        }
      }
      // 25k+ negócios: admitir que não coube é melhor que recortar errado.
      return { linhas: null };
    };

    (async () => {
      const [tagsRes, profilesRes, etapasRes, funisRes, dealsRes] =
        await Promise.all([
          supabase.from("tags").select("*").order("name"),
          supabase.from("profiles").select("*").order("full_name"),
          supabase
            .from("pipeline_stages")
            .select("*")
            .order("position", { ascending: true }),
          supabase.from("pipelines").select("id, name"),
          buscarDeals(),
        ]);
      if (cancelled) return;

      if (tagsRes.data) setTags(tagsRes.data as Tag[]);

      setTemPerfis(!profilesRes.error && (profilesRes.data?.length ?? 0) > 0);
      if (profilesRes.data) setProfiles(profilesRes.data as Profile[]);

      if (etapasRes.data) setEtapas(etapasRes.data as PipelineStage[]);
      if (funisRes.data) {
        setFunis(
          new Map(
            (funisRes.data as { id: string; name: string }[]).map((p) => [
              p.id,
              p.name,
            ]),
          ),
        );
      }

      const { linhas } = dealsRes;
      setEtapasStatus(linhas && etapasRes.data ? "ok" : "indisponivel");
      if (linhas) setEtapaPorContato(mapaDeEtapasPorContato(linhas));
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

  // A metade da busca que mora no banco: quais conversas têm alguma mensagem
  // com este texto, no histórico inteiro (RPC 929). A outra metade — nome,
  // telefone, grupo, última mensagem — continua sendo resolvida em JS.
  const {
    achados: achadosNoTexto,
    buscando: buscandoNoTexto,
    falhou: falhouBuscaNoTexto,
    termoAplicado,
  } = useBuscaEmMensagens(search);

  // Espelha o termo assentado para quem estiver fora da lista (o fio da
  // conversa, que precisa dele para destacar as mensagens que casaram).
  useEffect(() => {
    onTermoDeBusca?.(termoAplicado);
  }, [termoAplicado, onTermoDeBusca]);

  // `aplicarFiltros` só precisa saber QUAIS conversas casaram; o trecho é da
  // linha. Memoizado pela identidade do mapa, que só muda quando a resposta
  // muda.
  const idsAchadosNoTexto = useMemo(
    () => new Set(achadosNoTexto.keys()),
    [achadosNoTexto],
  );

  // Todo o recorte mora em `src/lib/inbox/filtros.ts`, testado lá — inclusive
  // a neutralização do filtro de etapa sem dados: `recorteDeEtapaConfiavel` é
  // campo OBRIGATÓRIO do ctx (como `achadasNoTexto`), então quem consumir
  // `aplicarFiltros` em outra tela é cobrado pelo compilador. Enquanto os
  // dados não chegam, o spinner de `aguardandoEtapas` segura a tela; se
  // chegarem inutilizáveis, o aviso inline abaixo da busca assume.
  // Recorte por perfil (Fase 3) como PREDICADO, não import dentro de
  // filtros.ts — escopo.ts importa canalDaConversa de lá, e o import na
  // direção contrária fecharia ciclo de módulos.
  const { acesso } = useAuth();
  // ⚠️ Memoizado porque `canaisVisiveis` FILTRA quando o perfil tem recorte,
  // e `.filter()` devolve array novo a cada render. Ele desce como prop para
  // o diálogo de nova conversa, cujo efeito de pré-seleção depende desta
  // lista — com identidade nova a cada render, o efeito reexecutaria sem
  // parar. (Sem recorte a função devolve a MESMA referência, então o
  // problema só apareceria numa conta com perfil configurado — o tipo de
  // coisa que passa no teste de hoje e quebra quando o primeiro perfil
  // nascer.)
  const canaisDoPerfil = useMemo(
    () => canaisVisiveis(acesso, channels),
    [acesso, channels],
  );
  const foraDoPerfil = useCallback(
    (c: Conversation) => !conversaNoEscopo(acesso, c),
    [acesso],
  );

  // `stage_id` → `pipeline_id`, para o primeiro nível do recorte (escolher só
  // o funil). Sai da MESMA consulta de `pipeline_stages` que alimenta o
  // seletor, então nunca discorda dele.
  const funilPorEtapa = useMemo(
    () => new Map(etapas.map((e) => [e.id, e.pipeline_id])),
    [etapas],
  );

  const filtered = useMemo(
    () =>
      aplicarFiltros(conversations, filtros, {
        favoritas,
        etapaPorContato,
        funilPorEtapa,
        busca: search,
        achadasNoTexto: idsAchadosNoTexto,
        recorteDeEtapaConfiavel: etapasStatus === "ok",
        foraDoPerfil,
      }),
    [
      conversations,
      filtros,
      etapasStatus,
      favoritas,
      etapaPorContato,
      funilPorEtapa,
      search,
      idsAchadosNoTexto,
      foraDoPerfil,
    ],
  );
  const aguardandoEtapas =
    (filtros.etapaId !== null || filtros.funilId !== null) &&
    etapasStatus === "carregando";

  /**
   * Ciclo de vida do filtro SEMEADO por `?etapa=` (e só dele — etapa
   * escolhida à mão no painel não passa por aqui):
   * · a jornada do funil acaba (URL limpa pela sidebar/notificação — a
   *   página NÃO remonta) → o seed morre junto com a faixa, senão a lista
   *   ficava recortada sem nada na tela explicando;
   * · os dados chegam e a etapa semeada NÃO existe (link velho, etapa
   *   apagada) → o seed é descartado, senão a lista abria "nenhuma
   *   conversa" sem aviso.
   */
  const seedDeEtapaRef = useRef(etapaInicial);
  const jornadaAnteriorRef = useRef(jornadaDoFunil);
  useEffect(() => {
    const seed = seedDeEtapaRef.current;
    const jornadaAcabou = jornadaAnteriorRef.current && !jornadaDoFunil;
    jornadaAnteriorRef.current = jornadaDoFunil;
    if (!seed) return;
    const daSemeada = etapas.find((e) => e.id === seed);
    const seedSumiu = etapasStatus === "ok" && !daSemeada;
    if (!jornadaAcabou && !seedSumiu) {
      // ⚠️ O funil da etapa semeada é preenchido AQUI, quando as etapas
      // chegam — a URL traz só a etapa. Sem isto o painel de dois níveis
      // abriria em "Qualquer funil" com uma etapa escolhida, que é um estado
      // que o seletor não sabe mostrar (o segundo nível nem apareceria).
      //
      // ⚠️ E SÓ onde esse seletor existe. Numa conta de um funil só — ou com
      // a consulta de `pipelines` falhando sozinha — o painel é a lista
      // chapada de sempre: carimbar `funilId` ali deixaria um recorte de
      // funil ativo sem campo nenhum que o mostrasse, e "Qualquer etapa"
      // (que significa "não filtro por etapa") passaria a esconder quem não
      // tem negócio. Achado do Codex no PR #73.
      if (daSemeada && recorteTemDoisNiveis(etapas, funis)) {
        setFiltros((prev) =>
          prev.etapaId === seed && prev.funilId === null
            ? { ...prev, funilId: daSemeada.pipeline_id }
            : prev,
        );
      }
      return;
    }
    seedDeEtapaRef.current = null;
    // Os DOIS níveis morrem juntos: o funil só está aqui porque a etapa o
    // trouxe, e deixá-lo de pé manteria a lista recortada pelo funil inteiro
    // sem nada na tela explicando.
    setFiltros((prev) =>
      prev.etapaId === seed ? { ...prev, etapaId: null, funilId: null } : prev,
    );
  }, [jornadaDoFunil, etapasStatus, etapas, funis]);

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

  // ⚠️ Avisa UMA vez quando a leitura das favoritas falhou. Sem isto a tela
  // mostra todas as estrelas apagadas e "Favoritas" não acha nada — que, para
  // quem marcou vinte conversas ontem, lê como "o sistema perdeu as minhas".
  const jaAvisouFavoritas = useRef(false);
  useEffect(() => {
    if (falhouFavoritas && !jaAvisouFavoritas.current) {
      jaAvisouFavoritas.current = true;
      toast.error(t("favoritesLoadFailed"));
    }
  }, [falhouFavoritas, t]);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed 320px on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-80">
      {/* Busca + filtros */}
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center gap-2">
          {/* `min-w-0` porque item de flex nasce com `min-width: auto` e o
              campo tem largura intrínseca — sem ele o botão é empurrado para
              fora da coluna de 320px. */}
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder={t("searchPlaceholder")}
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
            />
          </div>

          {/* Abordar um cliente é falar com ele: mesmo papel que ENVIAR, não
              o de anotar. A rota confere de novo — isto só evita oferecer ao
              `viewer` um botão que responderia 403. */}
          {onConversaAberta && isAccountRole(acesso.papel) && canSendMessages(acesso.papel) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              title={t("novaConversa")}
              aria-label={t("novaConversa")}
              onClick={() => setNovaConversaAberta(true)}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          )}
        </div>

        {onConversaAberta && (
          <NovaConversaDialog
            open={novaConversaAberta}
            onOpenChange={setNovaConversaAberta}
            // As conexões DO PERFIL, como no filtro logo abaixo: oferecer
            // uma conexão fora do escopo faria o operador abrir a conversa
            // num número que ele não deveria usar.
            canais={canaisDoPerfil}
            onAberta={onConversaAberta}
          />
        )}

        {/* O que está acontecendo com a metade da busca que mora no banco.
            ⚠️ As três linhas existem porque, sem elas, os três estados são
            indistinguíveis de "não existe mensagem com esse texto" — e o
            operador conclui que a conversa que ele procura não existe. */}
        {search.trim().length > 0 && !termoBuscavel(search) && (
          <p className="px-0.5 text-[11px] text-muted-foreground">
            {t("searchMinChars", { n: TERMO_MINIMO })}
          </p>
        )}
        {falhouBuscaNoTexto && (
          <p className="px-0.5 text-[11px] text-destructive">
            {t("searchInMessagesFailed")}
          </p>
        )}
        {buscandoNoTexto && !falhouBuscaNoTexto && (
          <p className="px-0.5 text-[11px] text-muted-foreground">
            {t("searchingInMessages")}
          </p>
        )}
        {/* Filtro de funil OU de etapa ativo com os dados por trás
            indisponíveis: o recorte foi neutralizado (ver
            `recorteDeEtapaConfiavel`) e isto é o que impede a lista completa
            de passar por "filtrada".
            ⚠️ Os DOIS níveis, não só a etapa: um recorte só de funil cai
            junto, e sem esta linha ele exibia a pastilha do funil sobre a
            lista inteira, sem nada explicando. */}
        {(filtros.etapaId !== null || filtros.funilId !== null) &&
          etapasStatus === "indisponivel" && (
          <p className="px-0.5 text-[11px] text-destructive">
            {t("stageFilterUnavailable")}
          </p>
        )}

        <InboxFilters
          filtros={filtros}
          onChange={setFiltros}
          // O seletor de canal só oferece as conexões DO PERFIL — oferecer
          // as outras seria um filtro que devolve sempre vazio, com cara de
          // "não há conversas". (As linhas de outra área que a BUSCA traz
          // continuam aparecendo; isto recorta só as OPÇÕES do filtro.)
          canais={canaisDoPerfil}
          etiquetas={tags}
          empresas={companies}
          responsaveis={temPerfis ? profiles : []}
          // A lista COMPLETA sempre: é ela que resolve o NOME da pastilha de
          // um filtro ativo (deep link chega antes dos dados; e etapas podem
          // estar íntegras com só a consulta de deals quebrada). Quem gateia
          // OFERECER o campo é `etapasConfiaveis`.
          etapas={etapas}
          etapasConfiaveis={etapasStatus === "ok"}
          funis={funis}
          temGrupos={temGrupos}
          busca={search}
          onLimparBusca={() => setSearch("")}
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
        {loading || aguardandoEtapas ? (
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
                favoritaHabilitada={favoritasProntas}
                achado={achadosNoTexto.get(conv.id)}
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
  /** `false` enquanto a sessão/conta não resolveu — ver `useFavoritas`. */
  favoritaHabilitada: boolean;
  /**
   * Presente quando esta conversa entrou no resultado pelo CORPO das mensagens
   * (RPC 929). `undefined` no uso normal, sem busca.
   */
  achado?: AchadoNoTexto;
  t: ReturnType<typeof useTranslations>;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  favorita,
  onToggleFavorita,
  favoritaHabilitada,
  achado,
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
          "flex w-full items-start gap-3 py-3 pl-3 pr-10 text-left transition-colors hover:bg-muted/50",
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
            {/* ⚠️ Durante a busca, a prévia de sempre MENTE. Ela mostra a
                ÚLTIMA mensagem da conversa; se o que casou foi uma mensagem de
                três meses atrás, a linha aparece no resultado exibindo um texto
                que não contém o termo — e o operador lê aquilo como defeito da
                busca. Por isso, quando o achado veio do corpo, a prévia dá
                lugar ao trecho que casou de verdade. */}
            {achado ? (
              <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <MessageSquareText className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate">
                  {stripWhatsAppFormat(achado.trecho)}
                </span>
                {achado.quantas > 1 && (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {t("searchHitCount", { n: achado.quantas })}
                  </span>
                )}
              </p>
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                {stripWhatsAppFormat(conversation.last_message_text) ||
                  t("noMessagesYet")}
              </p>
            )}
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
      {/* ⚠️ `disabled` enquanto a sessão/conta não resolveu. Sem isso, clicar
          nos primeiros instantes cai fora e o operador leva um "não deu,
          tente de novo" sem que NADA tenha sido enviado ao banco — e se o
          perfil falhar ao carregar, esse erro falso se repetiria a sessão
          inteira. */}
      <button
        type="button"
        onClick={handleFavorita}
        disabled={!favoritaHabilitada}
        aria-pressed={favorita}
        title={favorita ? t("unfavorite") : t("favorite")}
        aria-label={favorita ? t("unfavorite") : t("favorite")}
        className={cn(
          // 36px de alvo: o de 28 ficava a 4px do botão da linha, e num toque
          // impreciso o dedo abria a conversa em vez de favoritar.
          "absolute right-0.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40",
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
