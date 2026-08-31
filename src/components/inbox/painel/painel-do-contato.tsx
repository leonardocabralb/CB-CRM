'use client';

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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useConversationNotes } from '@/hooks/use-conversation-notes';
import { useFixarNota } from '@/hooks/use-fixar-nota';
import { useCan } from '@/hooks/use-can';
import { funilNoEscopo, funisVisiveis } from '@/lib/perfis/escopo';
import { toast } from 'sonner';
import { ActivityHistory } from '@/components/lead-events/activity-history';
import { ContactTasks } from '@/components/tasks/contact-tasks';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { DealForm } from '@/components/pipelines/deal-form';
import { SeletorFunilEtapa } from '@/components/inbox/painel/seletor-funil-etapa';
import { AbaAutomacoes } from '@/components/inbox/painel/aba-automacoes';
import { useExecucoesDoContato } from '@/hooks/use-execucoes-do-contato';
import { statusAoEntrarNaEtapa } from '@/lib/pipelines/resultado';
import { avisarDrenagemDeFunil } from '@/lib/automations/avisar-drenagem';
import { CampoPersonalizadoInput } from '@/components/contacts/campo-personalizado-input';
import { LinhaDeEdicao } from '@/components/inbox/painel/linha-de-edicao';
import { InternalNoteBox } from '@/components/inbox/internal-note-box';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { salvarValoresDoContato } from '@/lib/contacts/custom-values';
import { agruparCampos } from '@/lib/contacts/grupos-de-campos';
import { useAuth } from '@/hooks/use-auth';
import { ValorInput } from '@/components/valor/valor-input';
import { formatCurrency } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type {
  Contact,
  CustomField,
  Deal,
  DealStatus,
  GrupoDeCampos,
  PipelineStage,
  Tag,
} from '@/types';
import {
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  Building2,
  History,
  ListTodo,
  ChevronDown,
  ChevronUp,
  Loader2,
  Maximize2,
  PanelRightClose,
  Pencil,
  Pin,
  PinOff,
  Save,
  Settings2,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useTranslations } from 'next-intl';

export interface PainelDoContatoProps {
  contact: Contact | null;
  /**
   * Conversa aberta. A anotação é chaveada pela CONVERSA desde a 918 — sem
   * ela dá para LER as anotações do contato (a coluna `contact_id` é
   * desnormalizada justamente para isso), mas não para escrever.
   */
  conversationId?: string | null;
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
  resyncToken = 0,
  onClose,
  onContactUpdated,
}: PainelDoContatoProps) {
  const tSidebar = useTranslations('Inbox.sidebar');
  /** Só para o rótulo do bloco Geral (965) — o mesmo que o catálogo usa, para
   *  que a ficha e a tela de Configurações chamem o bloco pelo mesmo nome. */
  const tCampos = useTranslations('Contacts.customFields');
  const tThread = useTranslations('Inbox.messageThread');
  // Rótulos do negócio vêm do namespace do funil — mesmo texto nas duas
  // telas, de propósito (Marcar como ganho etc.).
  const tForm = useTranslations('Pipelines.form');
  const tCard = useTranslations('Pipelines.card');
  // O mesmo gate da RLS: `agent`+ escreve contato/etiqueta/valores ("viewer"
  // só olha). O catálogo de CAMPOS é admin — gate separado, mais abaixo.
  const podeEditar = useCan('send-messages');
  const { acesso } = useAuth();
  const podeGerirCampos = useCan('edit-settings');

  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  /**
   * Tarefas ABERTAS deste cliente (qualquer responsável) — o número da
   * etiqueta na aba Tarefas. `null` = ainda não contado (etiqueta some).
   * Contado aqui, e não dentro da aba: o conteúdo dela só monta quando é
   * aberta, e a etiqueta precisa existir antes disso.
   */
  const [tarefasAbertas, setTarefasAbertas] = useState<number | null>(null);
  /**
   * Execuções vivas do cliente (955): robô ativo + esperas de automação.
   * No TOPO como as outras buscas — a etiqueta da aba precisa do número
   * antes de a aba abrir, e trocar de aba não refaz query. O hook zera
   * sozinho na troca de contato (mesma régua de staleness das 7 queries).
   */
  const execucoes = useExecucoesDoContato(contact?.id ?? null);
  /**
   * `true` só depois que as consultas POR-CONTATO do contato ATUAL
   * aterrissaram sem erro. Enquanto `false`, salvar campos e o cartão de
   * negócio ficam travados: o painel re-renderiza com o nome do contato
   * novo NA HORA da troca, mas os dados demoram um fetch — sem o gate,
   * essa janela mostrava (e deixava salvar!) os valores do contato
   * anterior sob o cabeçalho do novo.
   */
  const [dadosProntos, setDadosProntos] = useState(false);
  /**
   * Régua de staleness do fetch: as 7 queries podem resolver FORA de
   * ordem numa rede lenta, e a resposta atrasada do contato anterior não
   * pode sobrescrever os dados do atual. Atualizado no efeito de troca de
   * contato (declarado antes do efeito que dispara o fetch).
   */
  const contactIdRef = useRef<string | null>(null);

  // ---- Fase 2: edição dentro da conversa --------------------------------
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tagOcupada, setTagOcupada] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeEdit, setNomeEdit] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [grupos, setGrupos] = useState<GrupoDeCampos[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [salvandoCampos, setSalvandoCampos] = useState(false);
  const [gerirCamposAberto, setGerirCamposAberto] = useState(false);

  // ---- Fase 4: o negócio dentro da conversa ------------------------------
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>(
    []
  );
  const [allStages, setAllStages] = useState<PipelineStage[]>([]);
  /** null = fechado; "criar" = DealForm em modo criação; Deal = edição. */
  const [dealFormAberto, setDealFormAberto] = useState<'criar' | Deal | null>(
    null
  );
  const [negocioOcupado, setNegocioOcupado] = useState(false);
  /** Detalhes do negócio (data, ganho/perdido, formulário) — só sob demanda. */
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  /**
   * Âncora do cartão: o id do último negócio em que o operador MEXEU.
   * Sem ela, marcar o negócio aberto como perdido fazia o `find(open)`
   * re-eleger OUTRO card no mesmo clique — e o "Reabrir" seguinte, que o
   * operador lê como "desfazer", reabria o negócio errado.
   */
  const [ultimoNegocioMexido, setUltimoNegocioMexido] = useState<string | null>(
    null
  );
  /**
   * Sobe quando um save do negócio FALHA. Entra na `key` dos inputs
   * não-controlados (valor, data): a key deriva do VALOR salvo, e um save
   * recusado devolve o mesmo valor — sem o nonce o input continuava
   * exibindo o texto não salvo por cima do estado revertido.
   */
  const [resetNegocio, setResetNegocio] = useState(0);

  /**
   * Os BLOCOS da seção CAMPOS (965). Substituíram o recorte por categoria da
   * 949: até aqui os gerais ficavam nesta aba e os de traqueamento numa aba
   * própria (o megafone), o que dava ao operador uma divisão fixa de duas
   * gavetas. Agora a divisão é a que ele montou em Configurações, e a aba
   * separada deixou de existir — o bloco "Traqueamento" é um bloco como os
   * outros, logo abaixo dos demais.
   *
   * ⚠️ Sem `incluirVazios`: aqui o bloco vazio some. Cabeçalho sem campo
   * embaixo não informa nada e ainda ocupa a coluna estreita da conversa —
   * quem precisa vê-lo é o catálogo, para poder soltar campo dentro.
   */
  const blocos = useMemo(
    () => agruparCampos(customFields, grupos),
    [customFields, grupos]
  );

  /**
   * O negócio que a seção edita: o ABERTO mais recente; sem nenhum aberto, o
   * mais recente de qualquer status (ganho/perdido aparece com "Reabrir").
   * ~1 negócio por contato nesta conta — os demais ficam numa lista de
   * leitura abaixo do cartão.
   */
  const dealAtivo = useMemo(() => {
    // A âncora vence enquanto o negócio existir: depois de "Perdido" o
    // cartão continua NELE (mostrando "Reabrir"), em vez de saltar para o
    // próximo aberto no meio da interação.
    const fixado = ultimoNegocioMexido
      ? deals.find((d) => d.id === ultimoNegocioMexido)
      : undefined;
    return fixado ?? deals.find((d) => d.status === 'open') ?? deals[0] ?? null;
  }, [deals, ultimoNegocioMexido]);

  /**
   * ⚠️ Etapas do DealForm MEMOIZADAS, e a identidade é o ponto: o efeito de
   * reset do formulário tem `stages` nas dependências, e um filtro inline
   * criava array NOVO a cada render do painel — uma nota chegando por
   * realtime, com o Sheet aberto, re-rodava o reset e apagava o que o
   * operador tinha digitado (título, valor, anotação). O quadro de Funis
   * nunca sofreu disso porque passa o próprio estado, estável.
   */
  const stagesDoForm = useMemo(() => {
    if (dealFormAberto === null) return [];
    const alvo =
      dealFormAberto === 'criar'
        ? (dealAtivo?.pipeline_id ?? pipelines[0]?.id)
        : dealFormAberto.pipeline_id;
    return allStages.filter((st) => st.pipeline_id === alvo);
  }, [dealFormAberto, dealAtivo, pipelines, allStages]);

  /**
   * ⚠️ Trocar de CONTATO invalida tudo que é por-contato, NA HORA — sem
   * isto os negócios/etiquetas/valores do anterior ficavam visíveis e
   * EDITÁVEIS sob o cabeçalho do novo até o fetch resolver (salvar nessa
   * janela gravava dado do contato A no contato B). O catálogo da conta
   * (allTags, funis, etapas, campos) fica: não é por-contato e limpar só
   * causaria flicker. Declarado ANTES do efeito que dispara o fetch, para
   * o ref já apontar para o contato novo quando ele rodar.
   */
  useEffect(() => {
    contactIdRef.current = contact?.id ?? null;
    setDadosProntos(false);
    setDeals([]);
    setTags([]);
    setCustomValues({});
    setUltimoNegocioMexido(null);
    setDetalhesAbertos(false);
    setTarefasAbertas(null);
  }, [contact?.id]);

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
  const {
    notas,
    acrescentar: acrescentarNota,
    aplicarFixacao,
  } = useConversationNotes(conversationId, resyncToken);
  /**
   * Fixar/desafixar (951). ⚠️ A ação mora no hook porque a faixa do topo do
   * fio faz a MESMA coisa: duas cópias das guardas divergiriam, e a
   * divergência apareceria como duas anotações fixadas na tela.
   */
  const { fixarNota, fixando } = useFixarNota(aplicarFixacao);

  // O hook devolve na ordem que o `intercalar` prefere (o fio reordena tudo).
  // Aqui a lista é lida direto, e a seção sempre mostrou a mais recente no
  // topo — ordenar é responsabilidade de quem exibe.
  const notes = useMemo(
    () =>
      [...notas].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [notas]
  );

  // A fixada (951) sai do fluxo e vira o cartão sticky do topo. No máximo
  // uma por cliente — o índice parcial garante; aqui é só find.
  const notaFixada = useMemo(
    () => notes.find((n) => n.fixada_em) ?? null,
    [notes]
  );
  const notasComuns = useMemo(
    () => (notaFixada ? notes.filter((n) => n.id !== notaFixada.id) : notes),
    [notes, notaFixada]
  );

  const fetchContactData = useCallback(async () => {
    if (!contact) return;
    // Congela o alvo: quem valida a chegada é o ref, que o efeito de troca
    // de contato mantém apontando para o contato ATUAL.
    const idPedido = contact.id;

    const supabase = createClient();

    // Tudo em paralelo, NO TOPO do painel (trocar de aba não refaz query).
    // As anotações saem daqui de propósito: vêm do `useConversationNotes`
    // acima, que traz realtime junto.
    const [
      dealsRes,
      tagsRes,
      allTagsRes,
      fieldsRes,
      valuesRes,
      funisRes,
      etapasRes,
      tarefasRes,
      gruposRes,
    ] = await Promise.all([
      supabase
        .from('deals')
        .select('*, stage:pipeline_stages(*)')
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('contact_tags')
        .select('id, tag_id, tags(*)')
        .eq('contact_id', contact.id),
      supabase.from('tags').select('*').order('name'),
      supabase
        .from('custom_fields')
        .select('*')
        .order('posicao', { nullsFirst: false })
        .order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contact.id),
      // Fase 4: os seletores de funil/etapa do cartão de negócio.
      supabase.from('pipelines').select('id, name').order('name'),
      supabase.from('pipeline_stages').select('*').order('position'),
      // Só o NÚMERO (head:true viaja sem linhas): tarefas abertas deste
      // cliente, de qualquer responsável — a etiqueta da aba.
      supabase
        .from('cb_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', contact.id)
        .eq('status', 'aberta'),
      // Os blocos (965) — catálogo da conta, como as etiquetas e os campos.
      supabase
        .from('cb_grupos_de_campos')
        .select('*')
        .order('posicao')
        .order('nome'),
    ]);

    // Resposta atrasada de OUTRO contato (ou de um refetch disparado antes
    // da troca) morre aqui — senão ela sobrescrevia os dados do atual.
    if (contactIdRef.current !== idPedido) return;

    // Falha em qualquer consulta POR-CONTATO: nada de estado meio-carregado.
    // Na 1ª carga `dadosProntos` fica false e a edição segue travada (um
    // `customValues` vazio por falha + Salvar seria DELETE dos valores
    // reais); num refetch o estado anterior — ainda deste contato — fica.
    if (dealsRes.error || tagsRes.error || fieldsRes.error || valuesRes.error) {
      toast.error(tSidebar('loadError'));
      return;
    }
    // Recorte por perfil (Fase 4): negócio de funil fora do escopo não
    // aparece na barra da conversa — mesmo cliente podendo ter caso nas duas
    // áreas, cada equipe vê o seu. `pipeline_id` nulo (negócio órfão) passa,
    // como todo "sem carimbo" do projeto.
    setDeals(
      ((dealsRes.data ?? []) as Deal[]).filter(
        (d) => !d.pipeline_id || funilNoEscopo(acesso, d.pipeline_id),
      ),
    );
    const mapped = (tagsRes.data ?? [])
      .filter((ct: Record<string, unknown>) => ct.tags)
      .map((ct: Record<string, unknown>) => ({
        ...(ct.tags as Tag),
        contact_tag_id: ct.id as string,
      }));
    setTags(mapped);
    setCustomFields((fieldsRes.data ?? []) as CustomField[]);
    const map: Record<string, string> = {};
    for (const v of valuesRes.data ?? [])
      map[v.custom_field_id] = v.value ?? '';
    setCustomValues(map);
    // Catálogo da CONTA: falha aqui não trava a edição do contato — segue
    // tolerante, como antes (o estado anterior continua servindo).
    if (allTagsRes.data) setAllTags(allTagsRes.data);
    // Idem para os BLOCOS (965): falhando, `agruparCampos` joga todo campo no
    // bloco Geral — a ficha perde a divisão, mas nenhum campo some.
    if (gruposRes.data) setGrupos(gruposRes.data as GrupoDeCampos[]);
    if (funisRes.data) setPipelines(funisVisiveis(acesso, funisRes.data));
    if (etapasRes.data) setAllStages(etapasRes.data as PipelineStage[]);
    if (!tarefasRes.error) setTarefasAbertas(tarefasRes.count ?? 0);
    setDadosProntos(true);
  }, [contact, tSidebar, acesso]);

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
    //
    // ⚠️ Conferir o RESULTADO, não só o erro: escrita que a RLS descarta
    // (ou contato que sumiu numa fusão de duplicados) volta com `error`
    // NULO e zero linhas — e a tela fechava o editor como se tivesse
    // salvado. A armadilha do "0 linhas" documentada no CLAUDE.md.
    const { data, error } = await supabase
      .from('contacts')
      .update({ name: nome === '' ? null : nome })
      .eq('id', contact.id)
      .select('id');
    setSalvandoNome(false);
    if (error || !data?.length) {
      toast.error(tSidebar('nameSaveError'));
      return;
    }
    setEditandoNome(false);
    onContactUpdated?.({
      id: contact.id,
      name: nome === '' ? null : nome,
    } as Partial<Contact>);
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
        toast.error(e instanceof Error ? e.message : tSidebar('tagError'));
      } finally {
        setTagOcupada(null);
      }
    },
    [contact, tags, tSidebar]
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
      patch: Partial<Omit<Deal, 'expected_close_date'>> & {
        expected_close_date?: string | null;
      },
      drenar: boolean
    ): Promise<boolean> => {
      setNegocioOcupado(true);
      const supabase = createClient();
      // `.select("id")` = checagem de ROWCOUNT: update que casa 0 linhas
      // (negócio apagado por outro operador; RLS barrando) volta com
      // `error: null` e cara de sucesso — a classe "0 linhas em silêncio"
      // do CLAUDE.md. Sem isto o otimista carimbava um estado que o banco
      // nunca gravou.
      const { data: linhas, error } = await supabase
        .from('deals')
        .update(patch)
        .eq('id', deal.id)
        .select('id');
      setNegocioOcupado(false);
      if (error || !linhas || linhas.length === 0) {
        toast.error(tSidebar('dealSaveError'));
        // O nonce remonta os inputs não-controlados (valor/data): a key
        // deriva do valor salvo, e um save recusado devolve o MESMO valor
        // — sem isto o input seguia exibindo o texto não salvo.
        setResetNegocio((n) => n + 1);
        void fetchContactData();
        // `false` = quem chamou NÃO pode anunciar sucesso — sem isto o
        // `.then` do mudarStatus soltava "Reaberto ✓" em cima do toast de
        // erro (achado da revisão de 2026-08-29).
        return false;
      }
      // Ancora o cartão no negócio mexido — ver `ultimoNegocioMexido`.
      setUltimoNegocioMexido(deal.id);
      // Espelho do gatilho da 950: entrar em etapa marcada carimba o
      // status. O BANCO já gravou (BEFORE trigger, mesma escrita); aqui só
      // refletimos para o selo aparecer sem esperar refetch.
      const carimbo = patch.stage_id
        ? statusAoEntrarNaEtapa(allStages, patch.stage_id)
        : null;
      setDeals((prev) =>
        prev.map((d) =>
          d.id === deal.id
            ? {
                ...d,
                ...patch,
                ...(carimbo ? { status: carimbo } : {}),
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
                  ? (allStages.find((st) => st.id === patch.stage_id) ??
                    d.stage)
                  : d.stage,
              }
            : d
        )
      );
      if (drenar) avisarDrenagemDeFunil();
      return true;
    },
    [allStages, fetchContactData, tSidebar]
  );

  /**
   * O seletor dois-níveis entrega funil E etapa escolhidos num gesto.
   * ⚠️ Transferência entre funis é UM update com as DUAS colunas: em dois, a
   * trilha (912) conta que o lead saiu e voltou, e a FK composta recusa o
   * estado intermediário. E o lead chega na etapa ESCOLHIDA — não mais na
   * primeira do funil novo.
   */
  const moverPara = useCallback(
    (deal: Deal, pipelineId: string, stageId: string) => {
      if (stageId === deal.stage_id) return;
      const patch =
        pipelineId === deal.pipeline_id
          ? { stage_id: stageId }
          : { pipeline_id: pipelineId, stage_id: stageId };
      void atualizarNegocio(deal, patch, true);
    },
    [atualizarNegocio]
  );

  const mudarStatus = useCallback(
    (deal: Deal, status: DealStatus) => {
      const toasts: Record<DealStatus, string> = {
        won: tForm('toastMarkedWon'),
        lost: tForm('toastMarkedLost'),
        open: tForm('toastReopened'),
      };
      void atualizarNegocio(deal, { status }, true).then((ok) => {
        if (ok) toast.success(toasts[status]);
      });
    },
    [atualizarNegocio, tForm]
  );

  /**
   * Valores dos campos — upsert compartilhado (nunca delete-all).
   *
   * Recebe a lista a salvar, e hoje o único chamador manda TODOS os campos.
   * Até a 965 eram dois botões salvando subconjuntos, porque os de
   * traqueamento moravam numa aba separada e um Salvar não podia arrastar
   * junto uma edição meio-feita que estava fora da tela. Com os blocos, tudo
   * o que o botão salva está visível acima dele — o motivo da separação
   * deixou de existir junto com a aba.
   */
  const salvarCampos = useCallback(
    async (campos: CustomField[]) => {
      // ⚠️ O gate de `dadosProntos` é de CORREÇÃO, não de conforto: com os
      // valores ainda não carregados, o subconjunto sai todo `?? ""` — e
      // `""` no upsert compartilhado significa DELETE do valor real.
      if (!contact || !dadosProntos) return;
      setSalvandoCampos(true);
      const subconjunto = Object.fromEntries(
        campos.map((f) => [f.id, customValues[f.id] ?? ''])
      );
      const erro = await salvarValoresDoContato(
        createClient(),
        contact.id,
        subconjunto
      );
      setSalvandoCampos(false);
      if (erro) toast.error(tSidebar('fieldsSaveError'));
      else toast.success(tSidebar('fieldsSaved'));
    },
    [contact, customValues, dadosProntos, tSidebar]
  );

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
   * Refaz SÓ o número da aba Tarefas — chamado pela própria aba a cada
   * criação/conclusão/reabertura lá dentro. A mesma régua de staleness do
   * fetch grande: resposta de outro contato morre na chegada.
   */
  const recontarTarefas = useCallback(async () => {
    if (!contact) return;
    const idPedido = contact.id;
    const { count, error } = await createClient()
      .from('cb_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', idPedido)
      .eq('status', 'aberta');
    if (contactIdRef.current !== idPedido || error) return;
    setTarefasAbertas(count ?? 0);
  }, [contact]);

  if (!contact) {
    return (
      <div className="border-border bg-card flex h-full w-full flex-col border-l">
        <CabecalhoDoPainel onClose={onClose} tThread={tThread} />
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-muted-foreground text-center text-sm">
            {tThread('selectConversation')}
          </p>
        </div>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="border-border bg-card flex h-full w-full flex-col border-l">
      {/* Cabeçalho compacto: fechar + avatar 40px + nome/telefone em linha.
          A identidade ocupava ~150px em três blocos centralizados; agora são
          ~60px, e o que sobrou de altura vai para o conteúdo das abas. */}
      <CabecalhoDoPainel onClose={onClose} tThread={tThread}>
        <div className="bg-muted text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
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
                  setNomeEdit(contact.name ?? '');
                  setEditandoNome(true);
                }}
                disabled={!podeEditar}
                title={podeEditar ? tSidebar('editName') : undefined}
                className="group/nome flex w-full min-w-0 items-center gap-1 text-left"
              >
                <h3 className="text-foreground truncate text-sm font-semibold">
                  {displayName}
                </h3>
                {podeEditar && (
                  <Pencil className="text-muted-foreground h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/nome:opacity-100" />
                )}
              </button>
              <button
                onClick={handleCopyPhone}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
                title={contact.phone}
              >
                <span className="truncate">{contact.phone}</span>
                {copied ? (
                  <Check className="text-primary h-3 w-3 shrink-0" />
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
        <TabsList className="border-border bg-muted/30 w-full shrink-0 justify-start gap-x-1 rounded-none border-b px-2 py-1 group-data-horizontal/tabs:h-auto [&>button]:h-8 [&>button]:flex-1">
          <AbaDeIcone value="principal" label={tSidebar('tabMain')}>
            <User className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="notas" label={tSidebar('tabNotes')}>
            <StickyNote className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone
            value="tarefas"
            label={tSidebar('tabTasks')}
            badge={tarefasAbertas}
          >
            <ListTodo className="h-4 w-4" />
          </AbaDeIcone>
          {/* ⚠️ A aba Traqueamento (o megafone da 949) SAIU na 965: os campos
              de anúncio viraram um bloco como qualquer outro, dentro da
              Principal. Decisão do operador — uma gaveta fixa para dez campos
              técnicos, enquanto os campos do caso ficavam todos amontoados
              numa lista só, era a divisão errada. */}
          <AbaDeIcone
            value="automacoes"
            label={tSidebar('tabAutomations')}
            badge={
              execucoes.carregou && !execucoes.erro
                ? execucoes.robos.length + execucoes.esperas.length
                : null
            }
          >
            <Zap className="h-4 w-4" />
          </AbaDeIcone>
          <AbaDeIcone value="historico" label={tSidebar('tabHistory')}>
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
            <TituloDeSecao icon={<DollarSign className="h-3 w-3" />}>
              {tSidebar('deals')}
            </TituloDeSecao>

            {!dadosProntos ? (
              /* Carregando o contato: mostrar "sem negócios" (ou o negócio
                 do contato ANTERIOR) aqui seria mentira — e o botão de
                 criar nasceria sobre dado ainda não conferido. */
              <div className="mt-2 flex justify-center py-3">
                <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
              </div>
            ) : !dealAtivo ? (
              <div className="mt-2 space-y-2">
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noDeals')}
                </p>
                {podeEditar && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDealFormAberto('criar')}
                    className="w-full"
                  >
                    <Plus className="size-3.5" />
                    {tForm('newDeal')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="bg-muted mt-2 space-y-2 rounded-lg px-3 py-2.5">
                {/* COMPACTO por pedido do operador: só ETAPA e VALOR à vista
                    ("ficou com muita informação"). O selo Ganho/Perdido é a
                    exceção — escondê-lo faria um negócio ganho parecer
                    aberto. O resto mora na expansão. */}
                <SeletorFunilEtapa
                  pipelines={pipelines}
                  stages={allStages}
                  pipelineId={dealAtivo.pipeline_id}
                  stageId={dealAtivo.stage_id}
                  onEscolher={(pId, sId) => moverPara(dealAtivo, pId, sId)}
                  disabled={!podeEditar || negocioOcupado}
                  ariaLabel={tForm('stage')}
                />

                <div className="flex items-center gap-2">
                  {/* Sem `key` de reset aqui, ao contrário da data logo
                      abaixo: o campo de valor é CONTROLADO por
                      `dealAtivo.value`, então um save recusado já o devolve
                      ao valor salvo sozinho. */}
                  <ValorInput
                    valor={dealAtivo.value}
                    disabled={!podeEditar || negocioOcupado}
                    aria-label={tForm('value')}
                    placeholder={tForm('value')}
                    aoConfirmar={(v) =>
                      void atualizarNegocio(dealAtivo, { value: v }, false)
                    }
                    className="bg-card h-8 flex-1 text-sm"
                  />
                  {dealAtivo.status !== 'open' && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                        dealAtivo.status === 'won' &&
                          'bg-emerald-500/15 text-emerald-500',
                        dealAtivo.status === 'lost' &&
                          'bg-destructive/15 text-destructive'
                      )}
                    >
                      {dealAtivo.status === 'won'
                        ? tCard('won')
                        : tCard('lost')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setDetalhesAbertos((v) => !v)}
                    aria-expanded={detalhesAbertos}
                    aria-label={tSidebar('dealDetails')}
                    title={tSidebar('dealDetails')}
                    className="text-muted-foreground hover:bg-card hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors"
                  >
                    {detalhesAbertos ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {detalhesAbertos && (
                  <div className="border-border space-y-2 border-t pt-2">
                    <p className="text-muted-foreground truncate text-xs">
                      {dealAtivo.title} ·{' '}
                      {formatCurrency(dealAtivo.value)}
                    </p>

                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] tracking-wider uppercase">
                        {tForm('expectedCloseDate')}
                      </Label>
                      <Input
                        key={`fecha-${dealAtivo.id}-${dealAtivo.expected_close_date ?? ''}-${resetNegocio}`}
                        type="date"
                        defaultValue={dealAtivo.expected_close_date ?? ''}
                        disabled={!podeEditar || negocioOcupado}
                        onBlur={(e) => {
                          const v = e.target.value || null;
                          if (v !== (dealAtivo.expected_close_date ?? null))
                            void atualizarNegocio(
                              dealAtivo,
                              { expected_close_date: v },
                              false
                            );
                        }}
                        className="bg-card h-8 text-sm"
                      />
                    </div>

                    {/* Ganho/Perdido continuam existindo, mas na expansão: o
                        caminho principal do operador é a ETAPA marcada (950)
                        carimbar sozinha. Os MESMOS updates do deal-form; o
                        status também dispara automação (933). */}
                    {podeEditar &&
                      (dealAtivo.status === 'open' ? (
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={negocioOcupado}
                            onClick={() => mudarStatus(dealAtivo, 'won')}
                            className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-400"
                          >
                            {tCard('won')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={negocioOcupado}
                            onClick={() => mudarStatus(dealAtivo, 'lost')}
                            className="border-destructive/40 text-destructive hover:bg-destructive/10"
                          >
                            {tCard('lost')}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={negocioOcupado}
                          onClick={() => mudarStatus(dealAtivo, 'open')}
                          className="w-full"
                        >
                          {tForm('reopenDeal')}
                        </Button>
                      ))}

                    {podeEditar && (
                      <button
                        type="button"
                        onClick={() => setDealFormAberto(dealAtivo)}
                        className="text-muted-foreground hover:bg-card hover:text-foreground flex w-full items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors"
                      >
                        <Maximize2 className="h-3 w-3" />
                        {tSidebar('openFullDeal')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Os DEMAIS negócios (raro nesta conta): leitura, como antes. */}
            {deals
              .filter((d) => d.id !== dealAtivo?.id)
              .map((deal) => (
                <div
                  key={deal.id}
                  className="bg-muted/60 mt-2 rounded-lg px-3 py-2"
                >
                  <p className="text-foreground truncate text-sm font-medium">
                    {deal.title}
                  </p>
                  <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                    <span>{formatCurrency(deal.value)}</span>
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

          <div className="border-border my-4 border-t" />

          <div className="space-y-1">
            {contact.email && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
            {contact.company && (
              <div className="text-muted-foreground flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{contact.company}</span>
              </div>
            )}
            {/* A linha "Canal" morava aqui e SAIU (pedido do operador,
                2026-08-29): o seletor de canal no cabeçalho do fio já diz e
                troca o número — aqui era eco. */}
          </div>

          {(contact.email || contact.company) && (
            <div className="border-border my-4 border-t" />
          )}

          {/* Etiquetas — clicar numa aplicada REMOVE; o "+" abre o catálogo
              da conta para aplicar. Criar etiqueta nova fica nas telas de
              Contatos/Configurações (catálogo é admin; aplicar é agent). */}
          <div>
            <div className="flex items-center justify-between">
              <TituloDeSecao icon={<TagIcon className="h-3 w-3" />}>
                {tSidebar('tags')}
              </TituloDeSecao>
              {podeEditar && allTags.length > 0 && (
                <Popover>
                  <PopoverTrigger
                    className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-6 items-center gap-1 rounded-md px-1.5 text-xs transition-colors"
                    aria-label={tSidebar('addTag')}
                  >
                    <Plus className="h-3 w-3" />
                    {tSidebar('addTag')}
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
                              'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity disabled:opacity-50',
                              !aplicada && 'opacity-50 hover:opacity-100'
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
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noTags')}
                </p>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag.contact_tag_id}
                    type="button"
                    disabled={!podeEditar || tagOcupada === tag.id}
                    onClick={() => void toggleTag(tag)}
                    title={podeEditar ? tSidebar('removeTag') : undefined}
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

          <div className="border-border my-4 border-t" />

          {/* Campos personalizados (948) — visíveis e editáveis DE DENTRO da
              conversa, que era a queixa: existiam só na ficha de /contacts.
              O catálogo (criar/renomear campo) abre o MESMO diálogo daquela
              tela; fechar o diálogo refaz a busca para o painel enxergar o
              campo recém-criado. */}
          <div>
            <div className="flex items-center justify-between">
              <TituloDeSecao icon={<Settings2 className="h-3 w-3" />}>
                {tSidebar('customFields')}
              </TituloDeSecao>
              {podeGerirCampos && (
                <button
                  type="button"
                  onClick={() => setGerirCamposAberto(true)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-6 items-center gap-1 rounded-md px-1.5 text-xs transition-colors"
                >
                  <Settings2 className="h-3 w-3" />
                  {tSidebar('manageFields')}
                </button>
              )}
            </div>
            <div className="mt-2 space-y-3">
              {blocos.length === 0 ? (
                <p className="text-muted-foreground px-1 text-xs">
                  {tSidebar('noFields')}
                </p>
              ) : (
                <>
                  {blocos.map((bloco, i) => (
                    <div
                      key={bloco.grupo?.id ?? 'geral'}
                      className="space-y-3"
                    >
                      {/* O bloco Geral (grupo_id nulo) não ganha cabeçalho
                          quando é o PRIMEIRO: o título "Campos personalizados"
                          logo acima já o nomeia, e repetir "Geral" embaixo
                          dele só empilharia dois rótulos para a mesma coisa.
                          Os demais blocos se apresentam. */}
                      {(bloco.grupo !== null || i > 0) && (
                        <p className="text-muted-foreground border-border mt-1 border-t pt-2 text-[10px] font-medium tracking-wider uppercase">
                          {bloco.grupo?.nome ?? tCampos('groupGeneral')}
                        </p>
                      )}
                      {bloco.campos.map((field) => (
                        <div key={field.id} className="space-y-1">
                          {/* ⚠️ Sem `capitalize`. Ele maiusculava CADA palavra
                              e o operador via "Data De Fechamento Do Contrato"
                              no lugar do nome que cadastrou — e estragava de
                              vez os técnicos (`utm_source`), que por isso
                              tinham de morar numa aba à parte. O nome do campo
                              já vem escrito como deve aparecer. */}
                          <Label className="text-muted-foreground text-xs">
                            {field.field_name}
                          </Label>
                          <CampoPersonalizadoInput
                            field={field}
                            value={customValues[field.id] ?? ''}
                            onChange={(v) =>
                              setCustomValues((prev) => ({
                                ...prev,
                                [field.id]: v,
                              }))
                            }
                            disabled={!podeEditar || !dadosProntos}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                  {podeEditar && (
                    <Button
                      size="sm"
                      // UM botão para todos os blocos: tudo o que ele salva
                      // está visível acima dele. Um Salvar por bloco daria ao
                      // operador quatro botões idênticos e a dúvida de qual
                      // deles guarda o que ele acabou de digitar.
                      onClick={() => void salvarCampos(customFields)}
                      disabled={salvandoCampos || !dadosProntos}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
                    >
                      {salvandoCampos ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {tSidebar('saveFields')}
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
          // ⚠️ `keepMounted` porque o rascunho da anotação mora DENTRO do
          // `InternalNoteBox` (o `key` pela conversa existe justamente
          // porque a caixa guarda estado próprio). O TabsPanel do base-ui
          // DESMONTA a aba inativa por padrão: digitar meia anotação, dar
          // uma olhada na aba Principal e voltar apagava o texto em
          // silêncio — na MESMA conversa. As buscas não mudam (moram no
          // topo do painel, não na aba); o custo é só DOM escondido.
          keepMounted
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          {/* A nota FIXADA (951) vem antes de tudo e é sticky: rolar a
              lista não a leva embora. `top-0` gruda na borda do scrollport
              — o padding do TabsContent rola junto com o conteúdo. */}
          {notaFixada && (
            <div className="border-primary/40 bg-card sticky top-0 z-10 mb-2 rounded-lg border px-3 py-2 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="text-primary flex items-center gap-1 text-[10px] font-semibold tracking-wider uppercase">
                  <Pin className="h-3 w-3" />
                  {tSidebar('pinnedNote')}
                </span>
                <button
                  type="button"
                  onClick={() => void fixarNota(notaFixada, false)}
                  disabled={fixando === notaFixada.id}
                  aria-label={tSidebar('unpinNote')}
                  title={tSidebar('unpinNote')}
                  className="text-muted-foreground hover:text-foreground -m-1 p-1 transition-colors disabled:opacity-50"
                >
                  <PinOff className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-foreground mt-1 text-xs whitespace-pre-wrap">
                {notaFixada.texto}
              </p>
              <p className="text-muted-foreground mt-1 text-[10px]">
                {new Date(notaFixada.created_at).toLocaleString(undefined, {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          )}

          {/* A MESMA caixa amarela do compositor (918/919): menção por `@`
              com autocomplete e aviso quando o sino de menção falha. `key`
              pela conversa — a caixa guarda rascunho próprio, e sem o
              remonte o texto escrito para um cliente sobreviveria à troca
              e seria salvo no seguinte (a armadilha documentada do
              rascunho de nota). Lista de sugestões para BAIXO: aqui a
              caixa fica no topo do painel, não no rodapé da tela. */}
          {conversationId ? (
            <InternalNoteBox
              key={conversationId}
              conversationId={conversationId}
              listaParaBaixo
              autoFocus={false}
              onSaved={(nota) => {
                if (nota.conversation_id === conversationId)
                  acrescentarNota(nota);
              }}
            />
          ) : null}

          <div className="mt-2 space-y-2">
            {notasComuns.map((note) => (
              <div
                key={note.id}
                className="bg-muted relative rounded-lg px-3 py-2"
              >
                {/* Fixar é para qualquer um que anota (viewer incluso — a
                    rota decide); sem hover-para-aparecer, que não existe no
                    toque do celular. */}
                {note.contact_id && (
                  <button
                    type="button"
                    onClick={() => void fixarNota(note, true)}
                    disabled={fixando === note.id}
                    aria-label={tSidebar('pinNote')}
                    title={tSidebar('pinNote')}
                    className="text-muted-foreground/60 hover:text-foreground absolute top-1.5 right-1.5 p-1 transition-colors disabled:opacity-50"
                  >
                    <Pin className="h-3 w-3" />
                  </button>
                )}
                <p className="text-muted-foreground pr-5 text-xs whitespace-pre-wrap">
                  {note.texto}
                </p>
                <p className="text-muted-foreground mt-1 text-[10px]">
                  {/* Locale do NAVEGADOR (undefined), nunca fixo — o formato
                      antigo do date-fns imprimia "Aug 29" num app pt-BR. */}
                  {new Date(note.created_at).toLocaleString(undefined, {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
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
          <ContactTasks contactId={contact.id} aoAlterar={recontarTarefas} />
        </TabsContent>


        {/* ---- Automações (955) — o que está RODANDO para o cliente: robô
             ativo e esperas futuras de automação, com o botão de parar. Os
             dados vêm do hook no topo (etiqueta da aba precisa do número
             antes de a aba abrir). ---- */}
        <TabsContent
          value="automacoes"
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          <AbaAutomacoes
            contactId={contact.id}
            robos={execucoes.robos}
            esperas={execucoes.esperas}
            carregou={execucoes.carregou}
            erro={execucoes.erro}
            recarregar={execucoes.recarregar}
          />
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
          deal={dealFormAberto === 'criar' ? null : dealFormAberto}
          pipelineId={
            dealFormAberto === 'criar'
              ? (dealAtivo?.pipeline_id ?? pipelines[0]?.id ?? '')
              : dealFormAberto.pipeline_id
          }
          stages={stagesDoForm}
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
  tThread: ReturnType<typeof useTranslations<'Inbox.messageThread'>>;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border flex shrink-0 items-center gap-2 border-b px-2 py-2">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={tThread('hideContactPanel')}
          title={tThread('hideContact')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
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
  badge,
  children,
}: {
  value: string;
  label: string;
  /** Número ao lado do ícone (ex.: tarefas abertas). 0/null = sem etiqueta. */
  badge?: number | null;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      title={label}
      aria-label={badge ? `${label} (${badge})` : label}
      className="text-muted-foreground data-active:bg-muted data-active:text-primary"
    >
      {children}
      {badge ? (
        <span className="bg-primary/15 text-primary ml-1 rounded-full px-1 text-[10px] leading-4 font-semibold">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
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
        'text-muted-foreground flex items-center gap-2 px-1 text-xs font-medium tracking-wider uppercase',
        className
      )}
    >
      {icon}
      {children}
    </div>
  );
}
