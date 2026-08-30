// ============================================================
// O ponto de retorno do funil: onde o operador estava quando clicou para a
// conversa, para a volta cair no MESMO lugar.
//
// ⚠️ sessionStorage, não localStorage: o retorno é da JORNADA daquela aba
// (funil → conversa → funil), não uma preferência. Em localStorage, uma aba
// restauraria a rolagem gravada por outra.
//
// Quem grava é o quadro (no clique que navega); quem consome é a montagem
// da página de funis, uma vez só — ler e limpar. As funções engolem
// storage indisponível (navegação privativa) de propósito: sem retorno a
// página só abre no topo, que é o comportamento de sempre.
// ============================================================

export const CHAVE_RETORNO_DO_FUNIL = "wacrm:pipelines:retorno";

export interface RetornoDoFunil {
  pipelineId: string;
  /** Do `.pipeline-scroll` (eixo horizontal do quadro). */
  scrollLeft: number;
  /** Do `<main>` do dashboard (único scroll vertical da página). */
  scrollTop: number;
}

function numeroOuZero(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? valor
    : 0;
}

/** Desserialização defensiva: registro estranho vira `null`, nunca exceção. */
export function desserializarRetorno(cru: string | null): RetornoDoFunil | null {
  if (!cru) return null;
  try {
    const dado: unknown = JSON.parse(cru);
    if (typeof dado !== "object" || dado === null) return null;
    const objeto = dado as Record<string, unknown>;
    if (typeof objeto.pipelineId !== "string" || !objeto.pipelineId) return null;
    return {
      pipelineId: objeto.pipelineId,
      scrollLeft: numeroOuZero(objeto.scrollLeft),
      scrollTop: numeroOuZero(objeto.scrollTop),
    };
  } catch {
    return null;
  }
}

export function gravarRetorno(retorno: RetornoDoFunil): void {
  try {
    sessionStorage.setItem(CHAVE_RETORNO_DO_FUNIL, JSON.stringify(retorno));
  } catch {
    // Storage bloqueado — a volta simplesmente abre no topo.
  }
}

export function lerRetorno(): RetornoDoFunil | null {
  try {
    return desserializarRetorno(sessionStorage.getItem(CHAVE_RETORNO_DO_FUNIL));
  } catch {
    return null;
  }
}

export function limparRetorno(): void {
  try {
    sessionStorage.removeItem(CHAVE_RETORNO_DO_FUNIL);
  } catch {
    // Idempotente por contrato: chamar sem nada gravado (ou sem storage) é ok.
  }
}
