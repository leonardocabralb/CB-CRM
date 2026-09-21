import type { Deal } from "@/types";

// ============================================================
// O quadro do funil em DUAS camadas (21/09/2026).
//
// Medido em produção no funil "Trabalhista - Comercial": 3.669 cards, 6,3 MB
// de JSON, ~1,7 KB por card — o negócio inteiro, a ficha do contato, as
// etiquetas completas, a conversa e o responsável. O quadro desenha 100 por
// coluna (`CARDS_POR_COLUNA`, PR #231), ~700 cards, e baixava os 3.669. Com
// a 1032 aplicada o banco responde em ~250 ms por página; o que sobrou é
// VOLUME: páginas em paralelo levam o dobro do tempo cada uma.
//
// Por isso o quadro carrega:
//   1. a lista ENXUTA de todos os cards (`DEAL_SELECT_ENXUTO`, ~180 bytes
//      por card): é dela que saem a ordem, a coluna de cada card, o
//      contador e a soma do cabeçalho, os 6 indicadores do topo e o
//      arrasto — tudo o que precisa da coluna INTEIRA, exatamente como
//      antes;
//   2. o conteúdo COMPLETO (`DEAL_SELECT_DO_QUADRO`) só dos cards que a
//      coluna DESENHA: os primeiros `CARDS_POR_COLUNA` de cada etapa, e os
//      seguintes quando o operador pede "carregar mais".
//
// ⚠️ A lista enxuta continua sendo a verdade sobre ONDE está cada card. O
// conteúdo completo é por id, e um card desenhado sem conteúdo ainda (o
// "carregar mais" acabou de ser pedido, ou o card nasceu entre as duas
// consultas) aparece como "carregando" no lugar certo — nunca some da
// coluna nem muda o contador.
// ============================================================

/**
 * O que o quadro precisa de TODOS os cards do funil. Cada coluna aqui tem
 * um consumidor: `stage_id` (coluna e arrasto), `title` (o card que ainda
 * está carregando), `value` (a soma do cabeçalho e os indicadores),
 * `status`/`created_at`/`updated_at` (os indicadores do mês e a ordem). Quem
 * acrescentar coluna aqui paga ~40 bytes por card, em todos os cards.
 */
export const DEAL_SELECT_ENXUTO =
  "id, stage_id, title, value, status, created_at, updated_at";

export type NegocioEnxuto = Pick<
  Deal,
  "id" | "stage_id" | "title" | "value" | "status" | "created_at" | "updated_at"
>;

/**
 * Quantos cards uma coluna desenha de uma vez.
 *
 * ⚠️⚠️ O PR #227 consertou o DADO (a consulta de `deals` da página passou a
 * paginar); o RENDER continuava desenhando TUDO. Medido contra o que a
 * migração da Kommo traz: o funil "Trabalhista - Comercial" fica com ~8.400
 * cards, e a coluna "Perdido" sozinha com 2.719. Um `deals.map` por coluna
 * monta 8.400 componentes React e registra 8.400 `useDraggable` num commit
 * só, e a coluna estica a página para centenas de milhares de pixels: no
 * computador tranca a thread principal, e no CRM instalado no iPhone o
 * provável é o app ser morto pelo sistema — a tela principal do funil deixa
 * de abrir.
 *
 * 100 POR COLUNA, no molde da lista de leads (`funil/lista-de-leads.tsx`,
 * que usa o mesmo número para a tabela inteira). Desde 21/09/2026 é também
 * o que se BAIXA por coluna — ver o cabeçalho deste arquivo.
 *
 * Sem biblioteca de virtualização, de propósito: o "carregar mais" é uma
 * linha de estado, e virtualizar DENTRO de um `DndContext` (cada card é um
 * `useDraggable`, a coluna é um `useDroppable`) é outra obra.
 */
export const CARDS_POR_COLUNA = 100;

/**
 * O teto de linhas que o PostgREST devolve por pedido. Coluna revelada além
 * disso (dez "carregar mais") pede o que falta por id, depois.
 */
export const LINHAS_POR_PEDIDO = 1000;

/**
 * Quantos ids vão num `.in('id', …)`. É GET: cada id custa ~37 caracteres na
 * URL, e 100 dão ~4 KB — longe do limite de qualquer proxy no caminho.
 */
export const IDS_POR_PEDIDO = 100;

/**
 * Os cards que a coluna desenha: os `limite` primeiros, mais o card que
 * ACABOU de ser solto aqui quando ele cairia fora do teto.
 *
 * ⚠️ A segunda metade não é zelo: sem ela o arrasto SOME com o card. A
 * ordem do quadro é `created_at DESC, id ASC` (a consulta da página) e
 * mover não reordena nada — o negócio de meses atrás arrastado para
 * "Perdido" entra na posição ~2.700 de uma coluna que desenha 100, e o
 * operador vê o card desaparecer no instante em que o soltou, sem erro
 * nenhum. Ele entra no TOPO porque é a única posição que existe qualquer
 * que seja o teto (a natural dele está atrás do "carregar mais").
 *
 * Nunca duplica: só entra quando NÃO está entre os visíveis.
 */
export function cardsDaColuna<T extends { id: string }>(
  deals: T[],
  limite: number,
  recemSolto: string | null,
): T[] {
  if (deals.length <= limite) return deals;
  const visiveis = deals.slice(0, limite);
  if (!recemSolto || visiveis.some((d) => d.id === recemSolto)) return visiveis;
  // Nulo quando o card foi solto em OUTRA coluna — o id é do quadro inteiro.
  const solto = deals.find((d) => d.id === recemSolto);
  return solto ? [solto, ...visiveis] : visiveis;
}

/** O teto de uma coluna: o que o operador revelou, ou o inicial. */
export function limiteDaColuna(limites: Record<string, number>, etapaId: string): number {
  return limites[etapaId] ?? CARDS_POR_COLUNA;
}

/**
 * Os ids que o quadro DESENHA agora, coluna a coluna, na ordem do quadro.
 * Etapa fora de `etapaIds` não é desenhada (o card de etapa apagada no meio
 * não entra em coluna nenhuma — o mesmo `dealsByStage` do quadro).
 */
export function idsDesenhados(
  negocios: readonly NegocioEnxuto[],
  etapaIds: readonly string[],
  limites: Record<string, number>,
  recemSolto: string | null,
): string[] {
  const porEtapa = new Map<string, NegocioEnxuto[]>(etapaIds.map((id) => [id, []]));
  for (const n of negocios) porEtapa.get(n.stage_id)?.push(n);
  const ids: string[] = [];
  for (const etapaId of etapaIds) {
    const coluna = porEtapa.get(etapaId) ?? [];
    for (const n of cardsDaColuna(coluna, limiteDaColuna(limites, etapaId), recemSolto)) {
      ids.push(n.id);
    }
  }
  return ids;
}

/** Os ids desenhados que ainda não têm conteúdo completo. */
export function semConteudo(
  desenhados: readonly string[],
  detalhes: ReadonlyMap<string, unknown>,
): string[] {
  return desenhados.filter((id) => !detalhes.has(id));
}

/** Em fatias de `tamanho` — para `.in('id', …)` não passar do limite da URL. */
export function emFatias<T>(itens: readonly T[], tamanho: number): T[][] {
  const fatias: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) fatias.push(itens.slice(i, i + tamanho));
  return fatias;
}

type ItemDoQuadro = { id: string; stage_id: string; status?: Deal["status"] };

/** As duas camadas, na forma em que a página as guarda. */
export interface CamadasDoQuadro<D extends ItemDoQuadro> {
  negocios: NegocioEnxuto[];
  detalhes: ReadonlyMap<string, D>;
}

/**
 * O arrasto, otimista, nas DUAS camadas: a enxuta decide a coluna (e o
 * contador), e o conteúdo completo decide o selo do card. Mexer só numa
 * delas punha o card na coluna nova com o selo velho, ou o contrário.
 *
 * `carimboPara` recebe o status que o card TEM — o da lista enxuta, a
 * verdade do quadro — e devolve o que a etapa nova grava, ou nulo para
 * "mantém": é o `statusAoEntrarNaEtapa`, espelho do gatilho da 950/1031
 * (etapa com resultado carimba ganho/perdido, e o PERDIDO que entra numa
 * etapa neutra volta aberto). Calculado UMA vez, vale para as duas camadas.
 * ⚠️ É só o palpite: o status que o banco devolve na escrita vence
 * (`statusGravadoNoQuadro`).
 */
export function moverNoQuadro<D extends ItemDoQuadro>(
  negocios: readonly NegocioEnxuto[],
  detalhes: ReadonlyMap<string, D>,
  dealId: string,
  etapaId: string,
  carimboPara: (statusAntes: Deal["status"] | undefined) => Deal["status"] | null,
): { negocios: NegocioEnxuto[]; detalhes: Map<string, D> } {
  const carimbo = carimboPara(negocios.find((n) => n.id === dealId)?.status);
  const mudar = <T extends ItemDoQuadro>(item: T): T => ({
    ...item,
    stage_id: etapaId,
    ...(carimbo ? { status: carimbo } : {}),
  });
  const novoDetalhe = new Map(detalhes);
  const atual = novoDetalhe.get(dealId);
  if (atual) novoDetalhe.set(dealId, mudar(atual));
  return {
    negocios: negocios.map((n) => (n.id === dealId ? mudar(n) : n)),
    detalhes: novoDetalhe,
  };
}

/**
 * O status que o BANCO gravou no arrasto, nas DUAS camadas. O quadro não tem
 * realtime: o status que a tela lembra pode ser de antes de outro operador
 * fechar ou reabrir o card, e o gatilho decide pelo que está GRAVADO — por
 * isso o palpite de `moverNoQuadro` é trocado pela resposta da escrita
 * (Codex, PR #245).
 *
 * Só troca onde o card AINDA está na etapa para onde foi arrastado: um
 * arrasto seguinte já decidiu por conta própria. ⚠️ Trocar só a enxuta
 * compila, e deixa o selo do card (que vem do conteúdo) discordando da
 * coluna e dos indicadores. Devolve o MESMO quadro quando nada muda.
 */
export function statusGravadoNoQuadro<D extends ItemDoQuadro>(
  quadro: CamadasDoQuadro<D>,
  dealId: string,
  etapaId: string,
  gravado: Deal["status"],
): CamadasDoQuadro<D> {
  const trocar = (item: ItemDoQuadro) =>
    item.id === dealId && item.stage_id === etapaId && item.status !== gravado;
  const naEnxuta = quadro.negocios.some(trocar);
  const atual = quadro.detalhes.get(dealId);
  const noConteudo = atual !== undefined && trocar(atual);
  if (!naEnxuta && !noConteudo) return quadro;
  let detalhes = quadro.detalhes;
  if (atual && noConteudo) {
    const copia = new Map(quadro.detalhes);
    copia.set(dealId, { ...atual, status: gravado });
    detalhes = copia;
  }
  return {
    negocios: naEnxuta
      ? quadro.negocios.map((n) => (trocar(n) ? { ...n, status: gravado } : n))
      : quadro.negocios,
    detalhes,
  };
}
