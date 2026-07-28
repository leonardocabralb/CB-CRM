// ============================================================
// Como um canal APARECE na tela. Funções puras, sem React — é o que dá
// para cobrir com teste neste projeto (o vitest roda em `environment:
// "node"`, sem testing-library, então componente não renderiza em teste).
//
// A regra que estas funções carregam, e que vale mais que o texto: o
// escopo VAZIO/ausente significa "todos os canais", nunca "nenhum". É a
// mesma semântica de `automations.channel_ids` no engine
// (`channelInScope`) e de `flows.channel_id` no `findEntryFlow`. Se a tela
// disser "nenhum canal" onde o motor lê "todos", o operador desativa uma
// automação achando que ela está parada.
// ============================================================

import type { CbChannel } from './repo';

/**
 * Telefone do canal em forma legível. A Meta (`display_phone_number`) já
 * entrega formatado; só os dígitos crus da Evolution (`ownerJid`) passam
 * pela formatação brasileira.
 */
export function formatChannelPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/\D/.test(raw)) return raw;
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(raw);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${raw}`;
}

/** O canal, ou `null` quando o id não é (mais) da conta. */
export function findChannel(
  channels: CbChannel[],
  id: string | null | undefined,
): CbChannel | null {
  if (!id) return null;
  return channels.find((c) => c.id === id) ?? null;
}

/**
 * Rótulo de UM canal a partir do id. Devolve `null` quando o id não
 * resolve — canal apagado, ou lista ainda carregando. Quem chama decide o
 * texto do fallback (não damos "Desconhecido" aqui porque durante o
 * carregamento isso pisca na tela).
 */
export function channelLabel(
  channels: CbChannel[],
  id: string | null | undefined,
): string | null {
  return findChannel(channels, id)?.label ?? null;
}

/** Como o escopo de canal de uma automação/flow deve ser resumido. */
export type ScopeSummary =
  /** Sem restrição — dispara/entra por qualquer número. */
  | { kind: 'all' }
  /** Exatamente um canal, já resolvido. */
  | { kind: 'one'; label: string }
  /** Vários canais. `labels` traz só os que resolveram. */
  | { kind: 'many'; count: number; labels: string[] }
  /**
   * Há escopo, mas NENHUM id resolve para um canal da conta. Acontece
   * enquanto a lista carrega e (raro) se um canal sumiu sem passar pelo
   * trigger da 903. Quem chama trata como "carregando", não como erro.
   */
  | { kind: 'unresolved'; count: number };

/**
 * Resume `channel_ids` (automações) ou um `channel_id` só (flows) para
 * exibição. Aceita os dois formatos porque as duas telas mostram a mesma
 * ideia — "onde isto vale" — e não vale duplicar a regra do vazio.
 */
export function summarizeScope(
  channels: CbChannel[],
  scope: string[] | string | null | undefined,
): ScopeSummary {
  const ids = scope == null ? [] : Array.isArray(scope) ? scope : [scope];
  if (ids.length === 0) return { kind: 'all' };

  const labels = ids
    .map((id) => channelLabel(channels, id))
    .filter((l): l is string => l !== null);

  if (labels.length === 0) return { kind: 'unresolved', count: ids.length };
  if (labels.length === 1) return { kind: 'one', label: labels[0] };
  return { kind: 'many', count: labels.length, labels };
}

/**
 * Canais elegíveis para uma operação que exige a API oficial (broadcast,
 * templates). Um canal Evolution não tem WABA, então oferecê-lo aqui só
 * produziria um erro alguns cliques depois.
 */
export function metaChannels(channels: CbChannel[]): CbChannel[] {
  return channels.filter((c) => c.kind === 'meta');
}

/**
 * Canal pré-selecionado num seletor de canal de saída: o padrão da conta
 * se ele estiver entre os elegíveis, senão o primeiro conectado, senão o
 * primeiro da lista. Devolve `null` só quando não há candidato.
 */
export function preferredChannel(elegiveis: CbChannel[]): CbChannel | null {
  if (elegiveis.length === 0) return null;
  return (
    elegiveis.find((c) => c.is_default) ??
    elegiveis.find((c) => c.status === 'connected') ??
    elegiveis[0]
  );
}

/**
 * Quais conexões colocam clientes NESTE funil (migration 908).
 *
 * Existe para a tela de Funis conseguir avisar antes de apagar: sem isto,
 * apagar o funil zera `default_pipeline_id` via ON DELETE SET NULL e o
 * roteamento para em SILÊNCIO — o sintoma ("parou de entrar gente no funil")
 * aparece dias depois, longe da causa.
 */
export function channelsUsingPipeline(
  channels: CbChannel[],
  pipelineId: string | null | undefined,
): CbChannel[] {
  if (!pipelineId) return [];
  return channels.filter((c) => c.default_pipeline_id === pipelineId);
}

/**
 * Quais conexões usam ESTA etapa como entrada.
 *
 * A guarda de apagar etapa hoje é a contagem de negócios — e a etapa
 * recém-configurada como entrada tem exatamente ZERO negócios. Ou seja: o
 * caso perigoso é justamente o que passa pela guarda existente.
 */
export function channelsUsingStage(
  channels: CbChannel[],
  stageId: string | null | undefined,
): CbChannel[] {
  if (!stageId) return [];
  return channels.filter((c) => c.default_stage_id === stageId);
}

/** Cor do pontinho de status, igual à do painel de Conexões. */
export const CHANNEL_STATUS_DOT: Record<CbChannel['status'], string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  disconnected: 'bg-muted-foreground',
};
