// ============================================================
// A situação do CONTRATO do cliente pela etapa do funil (1070): o que a
// faixa "Cliente rescindido / finalizado" da conversa mostra. Plano:
// docs/PLANO-integracao-atlas.md, Fase 1.
//
// A etapa diz a situação pela MARCA (`pipeline_stages.situacao_do_cliente`,
// escolhida em Gerenciar funil), nunca pelo nome: o CRM é vendido a quem dá
// outros nomes, e renomear a etapa não pode desligar a faixa em silêncio.
//
// ⚠️⚠️ UM card por contato, e ele VIAJA entre funis (o roteador, o
// `create_deal` e a v1 recusam o segundo). O ex-cliente rescindido que volta
// (agenda pelo Calendly, ou alguém move o card para o Comercial) leva o
// ÚNICO card para fora do Jurídico — e é justamente aí que a faixa importa.
// Por isso, por FUNIL:
//   1. o contato TEM card nele → vale a etapa ATUAL do card mais recente;
//   2. não tem mais → vale a etapa de onde o card SAIU na última saída
//      (`pipeline_changed` para outro funil, ou `deal_deleted`), que a trilha
//      grava com `from_stage_id`.
// A faixa só apaga quando um card volta ao funil numa etapa SEM marca (o
// contrato novo leva o card para "Cliente Ativo"), ou quando alguém o move
// para uma etapa sem marca antes de tirá-lo do funil.
//
// ⚠️ Nunca "o último evento por `occurred_at`" para a etapa ATUAL: a carga da
// Kommo gravou trilha RETROATIVA com data histórica, e em ~260 cards o
// `deal_created` da conexão é mais novo que os eventos que os puseram onde
// estão (medido em 29/09/2026). As SAÍDAS não têm esse problema: as feitas no
// CRM são gravadas na hora e ficam depois de toda a história retroativa.
//
// Puro: quem busca (o hook `use-situacao-do-cliente.ts`) e quem desenha ficam
// fora. Pino: `situacao-do-cliente.test.ts`, que também confere o CHECK da
// migration.
// ============================================================

/** Os valores do CHECK da 1070, na ordem de gravidade (a primeira vence). */
export const SITUACOES_DO_CLIENTE = ['rescindido', 'finalizado'] as const;

export type SituacaoDoCliente = (typeof SITUACOES_DO_CLIENTE)[number];

/** Lê o valor cru da coluna; qualquer outra coisa é "a etapa não diz nada". */
export function lerSituacaoDoCliente(valor: unknown): SituacaoDoCliente | null {
  return valor === 'rescindido' || valor === 'finalizado' ? valor : null;
}

/** Os cards do contato como estão AGORA. */
export interface NegocioDoContato {
  id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  created_at: string;
}

/** Os eventos da trilha que podem ser uma SAÍDA de funil. */
export interface EventoDeSaida {
  id: string;
  event_type: string;
  from_pipeline_id: string | null;
  from_stage_id: string | null;
  to_pipeline_id: string | null;
  occurred_at: string;
}

/** Uma etapa com a marca, com o funil embutido para a faixa dizer ONDE. */
export interface EtapaMarcada {
  id: string;
  name: string;
  situacao_do_cliente: string | null;
  pipeline: { name: string } | null;
}

export interface SituacaoNoFunil {
  situacao: SituacaoDoCliente;
  /** Nome do funil — "finalizado no Bancário" não é "finalizado no Trabalhista". */
  funil: string;
  etapa: string;
}

function instante(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** `a` vem depois de `b`? No empate de instante, o id desempata (escolha estável). */
function depois(aQuando: string, aId: string, bQuando: string, bId: string): boolean {
  const da = instante(aQuando);
  const db = instante(bQuando);
  return da !== db ? da > db : aId > bId;
}

function ehSaida(e: EventoDeSaida): boolean {
  if (!e.from_pipeline_id) return false;
  if (e.event_type === 'deal_deleted') return true;
  return e.event_type === 'pipeline_changed' && e.to_pipeline_id !== e.from_pipeline_id;
}

/**
 * Uma entrada por funil em que o contato está (ou estava, ao sair) numa
 * etapa marcada — a mais grave primeiro (rescindido antes de finalizado) e,
 * no empate, pelo nome do funil. Vazio = nenhuma etapa marcada diz nada
 * sobre este cliente.
 */
export function situacoesDoCliente(
  negocios: NegocioDoContato[],
  eventos: EventoDeSaida[],
  etapasMarcadas: EtapaMarcada[],
): SituacaoNoFunil[] {
  const etapaPorId = new Map(etapasMarcadas.map((e) => [e.id, e]));

  // 1. A etapa atual do card mais recente de cada funil.
  const cardPorFunil = new Map<string, NegocioDoContato>();
  for (const n of negocios) {
    if (!n.pipeline_id) continue;
    const atual = cardPorFunil.get(n.pipeline_id);
    if (!atual || depois(n.created_at, n.id, atual.created_at, atual.id)) cardPorFunil.set(n.pipeline_id, n);
  }
  const etapaPorFunil = new Map<string, string | null>();
  for (const [funil, card] of cardPorFunil) etapaPorFunil.set(funil, card.stage_id);

  // 2. Funil de onde o contato já saiu: a etapa da ÚLTIMA saída.
  const saidaPorFunil = new Map<string, EventoDeSaida>();
  for (const e of eventos) {
    if (!ehSaida(e) || cardPorFunil.has(e.from_pipeline_id!)) continue;
    const atual = saidaPorFunil.get(e.from_pipeline_id!);
    if (!atual || depois(e.occurred_at, e.id, atual.occurred_at, atual.id)) saidaPorFunil.set(e.from_pipeline_id!, e);
  }
  for (const [funil, saida] of saidaPorFunil) etapaPorFunil.set(funil, saida.from_stage_id);

  const situacoes: SituacaoNoFunil[] = [];
  for (const etapaId of etapaPorFunil.values()) {
    const etapa = etapaId ? etapaPorId.get(etapaId) : undefined;
    const situacao = lerSituacaoDoCliente(etapa?.situacao_do_cliente);
    if (!etapa || !situacao) continue;
    situacoes.push({ situacao, funil: etapa.pipeline?.name ?? '', etapa: etapa.name });
  }

  return situacoes.sort(
    (a, b) =>
      SITUACOES_DO_CLIENTE.indexOf(a.situacao) - SITUACOES_DO_CLIENTE.indexOf(b.situacao) ||
      a.funil.localeCompare(b.funil),
  );
}
