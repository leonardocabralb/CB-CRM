// ============================================================
// Os filtros do inbox (F2 fatia A).
//
// Funções PURAS: recebem a lista já carregada e devolvem o recorte. Nada aqui
// consulta o banco.
//
// ⚠️ POR QUE FILTRAR NO CLIENTE, E NÃO NA CONSULTA
// Porque filtrar por campo do contato no PostgREST **dá resultado errado sem
// dar erro**, nos dois sentidos:
//
//   - Com o embed atual (LEFT), `.eq('contact.name', …)` aplica o filtro só ao
//     recurso embutido. As conversas que não casam CONTINUAM VINDO, com
//     `contact: null` — a lista mostra tudo, metade dos nomes vira
//     "Desconhecido", e parece um filtro que não faz nada.
//   - Trocando para `contacts!inner` vira INNER JOIN e APAGA toda conversa de
//     grupo (`contact_id IS NULL`), inclusive com o filtro vazio.
//
// Nenhum dos dois dá erro e os dois passam em revisão de código. A lista já é
// carregada inteira (sem `limit`), então filtrar em JS é também o caminho mais
// simples. Quando a fatia B trouxer a busca no corpo das mensagens, **tudo**
// muda para uma RPC de uma vez — nunca metade aqui e metade lá, que produziria
// um filtro enxergando 64 conversas e outro enxergando a página carregada.
// ============================================================

import {
  matchesContactFilters,
  matchesTypeFilter,
  type ModoDeEtiqueta,
  type TipoDeConversa,
} from "@/lib/inbox/conversations";
import { stripWhatsAppFormat } from "@/lib/inbox/whatsapp-format";
import type { Conversation, ConversationStatus } from "@/types";

/**
 * "Sem etapa" e "sem responsável" são opções DE VERDADE, não ausência de
 * filtro.
 *
 * ⚠️ Sem elas o recorte mente por omissão: 9 das 64 conversas não têm negócio
 * nenhum e 63 das 64 não têm responsável — esse pessoal sumiria de qualquer
 * recorte, e "quem ainda não foi distribuído" é exatamente a pergunta que o
 * operador faz de manhã.
 */
export const SEM_ETAPA = "__sem_etapa__";
export const SEM_RESPONSAVEL = "__sem_responsavel__";

export interface FiltrosDoInbox {
  /** Todas / só diretas / só grupos. */
  tipo: TipoDeConversa;
  /** `todos` = não filtra. Arquivada É encerrada (`closed`), decisão P2.3. */
  status: ConversationStatus | "todos";
  /** `null` = todos os canais. */
  canalId: string | null;
  /** `auth.users.id`, ou {@link SEM_RESPONSAVEL}, ou `null` para todos. */
  responsavelId: string | null;
  etiquetaIds: string[];
  modoDeEtiqueta: ModoDeEtiqueta;
  /** Nome exato da empresa, ou `null`. */
  empresa: string | null;
  /** Id da etapa, ou {@link SEM_ETAPA}, ou `null` para todas. */
  etapaId: string | null;
  /** Só as que EU marquei. */
  favoritas: boolean;
  /**
   * Só as que têm mensagem não lida.
   *
   * ⚠️ **É da CONTA INTEIRA, não "as que eu não li".** `unread_count` é uma
   * coluna da conversa, zerada por quem abrir primeiro — quem quer "as minhas
   * não lidas" combina este botão com o filtro de responsável, que é
   * exatamente o que o operador descreveu. Tornar por pessoa seria mudança de
   * schema, não de tela.
   *
   * ⚠️ E é INDEPENDENTE da situação. Antes "não lidas" era uma opção DENTRO do
   * menu de situação e escolhê-la SUBSTITUÍA o status — mostrava não lida
   * encerrada junto. Agora soma como todo o resto.
   */
  naoLidas: boolean;
}

export const FILTROS_VAZIOS: FiltrosDoInbox = {
  tipo: "todas",
  status: "todos",
  canalId: null,
  responsavelId: null,
  etiquetaIds: [],
  modoDeEtiqueta: "qualquer",
  empresa: null,
  etapaId: null,
  favoritas: false,
  naoLidas: false,
};

/**
 * Quantos filtros estão pegando. É o número no distintivo do botão — sem ele,
 * um painel fechado com filtro ativo esconde a razão de a lista estar curta.
 *
 * ⚠️ `modoDeEtiqueta` NÃO conta: ele não recorta nada sozinho, só muda como as
 * etiquetas já escolhidas se combinam.
 */
export function contarFiltrosAtivos(f: FiltrosDoInbox): number {
  let n = 0;
  if (f.tipo !== "todas") n++;
  if (f.status !== "todos") n++;
  if (f.canalId) n++;
  if (f.responsavelId) n++;
  if (f.etiquetaIds.length > 0) n++;
  if (f.empresa !== null) n++;
  if (f.etapaId) n++;
  if (f.favoritas) n++;
  if (f.naoLidas) n++;
  return n;
}

/**
 * `contact_id` → as etapas dos negócios daquele contato.
 *
 * ⚠️ É um CONJUNTO, não um valor. O índice único da 911 só cobre
 * `source='channel'`: negócio criado à mão ou por automação pode duplicar o
 * contato, e aí ele está em duas etapas ao mesmo tempo. Tratar como valor
 * único faria o segundo negócio desaparecer do filtro em silêncio.
 */
export function mapaDeEtapasPorContato(
  deals: { contact_id: string | null; stage_id: string | null }[],
): Map<string, Set<string>> {
  const mapa = new Map<string, Set<string>>();
  for (const d of deals) {
    if (!d.contact_id || !d.stage_id) continue;
    const atual = mapa.get(d.contact_id);
    if (atual) atual.add(d.stage_id);
    else mapa.set(d.contact_id, new Set([d.stage_id]));
  }
  return mapa;
}

export interface ContextoDosFiltros {
  /** Ids das conversas que ESTE membro marcou (migration 924). */
  favoritas: Set<string>;
  /** Saída de {@link mapaDeEtapasPorContato}. */
  etapaPorContato: Map<string, Set<string>>;
  /** O texto da caixa de busca, cru. */
  busca: string;
}

/**
 * A busca livre: nome, telefone, nome do grupo e texto da última mensagem.
 *
 * ⚠️ Os quatro campos são load-bearing e nenhum é decorativo. Sem o do grupo,
 * buscar não acha grupo NENHUM (grupo não tem contato, então nome e telefone
 * ficam vazios); sem o da última mensagem, some a única forma de achar uma
 * conversa pelo que foi dito nela — que é como se procura quando não se lembra
 * do nome de quem falou.
 */
export function casaComABusca(conversation: Conversation, busca: string): boolean {
  const q = busca.trim().toLowerCase();
  if (!q) return true;

  const nome = conversation.contact?.name?.toLowerCase() ?? "";
  const telefone = conversation.contact?.phone?.toLowerCase() ?? "";
  const grupo = conversation.group_id
    ? `${conversation.group?.alias ?? ""} ${conversation.group?.subject ?? ""}`.toLowerCase()
    : "";
  const ultima = stripWhatsAppFormat(conversation.last_message_text).toLowerCase();

  return (
    nome.includes(q) ||
    telefone.includes(q) ||
    grupo.includes(q) ||
    ultima.includes(q)
  );
}

/** Um filtro só, isolado para ser testável e para o `aplicarFiltros` ler bem. */
export function casaComOResponsavel(
  conversation: Conversation,
  responsavelId: string | null,
): boolean {
  if (!responsavelId) return true;
  const atual = conversation.assigned_agent_id ?? null;
  if (responsavelId === SEM_RESPONSAVEL) return atual === null;
  return atual === responsavelId;
}

/**
 * Por qual número esta conversa corre.
 *
 * ⚠️ **Conversa de GRUPO tem `conversations.channel_id` NULO — sempre, e não
 * por ser antiga.** `src/lib/cb-groups/persist.ts` cria a conversa do grupo
 * com `{ account_id, user_id, group_id }` e nenhum dos dois `update` seguintes
 * preenche a coluna; quem guarda o número é `cb_groups.channel_id` ("por qual
 * número vimos este grupo"). Sem esta função, escolher um número no filtro
 * APAGARIA TODOS OS GRUPOS daquele número, em silêncio — que é exatamente a
 * armadilha "grupo some sem erro" que o CLAUDE.md descreve, só que por um
 * caminho diferente do `!inner`.
 *
 * ⚠️ Não confundir com o outro NULO legítimo: conversa 1:1 anterior à 903 não
 * tem carimbo nenhum, e essa continua aparecendo só em "Todos" — incluí-la em
 * todo número faria o filtro afirmar algo que ninguém sabe.
 */
export function canalDaConversa(conversation: Conversation): string | null {
  if (conversation.group_id) return conversation.group?.channel_id ?? null;
  return conversation.channel_id ?? null;
}

export function casaComAEtapa(
  conversation: Conversation,
  etapaId: string | null,
  etapaPorContato: Map<string, Set<string>>,
): boolean {
  if (!etapaId) return true;

  // Grupo não tem contato e portanto não tem negócio. Ele cai em "sem etapa"
  // de propósito: é literalmente verdade, e o filtro de tipo é quem esconde
  // grupo de quem não quer ver grupo.
  const doContato = conversation.contact_id
    ? etapaPorContato.get(conversation.contact_id)
    : undefined;

  if (etapaId === SEM_ETAPA) return !doContato || doContato.size === 0;
  return !!doContato?.has(etapaId);
}

/**
 * ⚠️ CONSEQUÊNCIA A VIGIAR QUANDO `groups_enabled` FOR LIGADO.
 *
 * Grupo não tem responsável nem contato, então ele casa com "Sem responsável"
 * E com "Sem negócio" ao mesmo tempo. As duas opções existem para responder
 * "quem ninguém pegou ainda" — e no dia em que os 58 grupos já sincronizados
 * entrarem na lista, as duas passam a devolver os 58 junto com as pessoas.
 *
 * Não há conserto certo aqui: as duas respostas são literalmente verdadeiras.
 * A saída é o filtro de TIPO, que existe exatamente para isso — quem quer
 * gente escolhe "diretas". Fica escrito para quem for ligar o interruptor não
 * achar que é bug.
 */

/**
 * O recorte inteiro.
 *
 * ⚠️ **Todos os filtros se aplicam JUNTOS (E lógico)** — decisão do operador em
 * 2026-08-01. Nenhum substitui outro nem "ganha" do resto: responsável = Ana
 * mais favoritas mostra *as favoritas da Ana*. É o que faz o contador
 * "Exibindo N" importar — ele é a única coisa que explica um resultado vazio.
 */
export function aplicarFiltros(
  conversations: Conversation[],
  f: FiltrosDoInbox,
  ctx: ContextoDosFiltros,
): Conversation[] {
  return conversations.filter((c) => {
    if (!matchesTypeFilter(c, f.tipo)) return false;
    if (f.status !== "todos" && c.status !== f.status) return false;

    // Ver `canalDaConversa`: em grupo o número mora em `cb_groups`, não na
    // conversa.
    if (f.canalId && canalDaConversa(c) !== f.canalId) return false;

    if (!casaComOResponsavel(c, f.responsavelId)) return false;
    if (f.favoritas && !ctx.favoritas.has(c.id)) return false;
    if (f.naoLidas && c.unread_count <= 0) return false;
    if (!casaComAEtapa(c, f.etapaId, ctx.etapaPorContato)) return false;

    if (f.etiquetaIds.length > 0 || f.empresa !== null) {
      if (
        !matchesContactFilters(c, {
          tagIds: f.etiquetaIds,
          tagMode: f.modoDeEtiqueta,
          company: f.empresa,
        })
      ) {
        return false;
      }
    }

    return casaComABusca(c, ctx.busca);
  });
}
