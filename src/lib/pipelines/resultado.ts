import type { DealStatus, PipelineStage } from "@/types";

/**
 * Espelho CLIENT-SIDE do gatilho `cb_deals_aplica_resultado` (migration 950).
 *
 * Quem carimba o status de verdade é o BANCO, para qualquer escritor. Este
 * espelho existe só para o estado otimista das telas: depois de mover um
 * negócio para uma etapa marcada, o selo Ganho/Perdido tem de aparecer na
 * hora — sem ele, a tela mostraria "Aberto" até o próximo refetch, e o
 * operador acharia que a regra não funcionou.
 *
 * ⚠️ A regra daqui NÃO pode divergir da do gatilho: etapa 'ganho' → 'won',
 * 'perdido' → 'lost', neutra → NÃO MEXE (devolve null = "mantenha o que
 * está"). Sair de etapa marcada não reabre — decisão do operador
 * (2026-08-29): fechou → transferiu para outro funil → continua ganho.
 */
export function statusPorResultado(
  resultado: string | null | undefined,
): DealStatus | null {
  if (resultado === "ganho") return "won";
  if (resultado === "perdido") return "lost";
  return null;
}

/** O status que uma mudança PARA `stageId` produz, ou null para "mantém". */
export function statusAoEntrarNaEtapa(
  stages: Pick<PipelineStage, "id" | "resultado">[],
  stageId: string,
): DealStatus | null {
  return statusPorResultado(stages.find((s) => s.id === stageId)?.resultado);
}
