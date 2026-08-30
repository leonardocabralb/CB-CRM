// ============================================================
// O ponto de retorno do funil: onde o operador estava quando clicou para a
// conversa, para a volta cair no MESMO lugar.
//
// ⚠️ sessionStorage, não localStorage: o retorno é da JORNADA daquela aba
// (funil → conversa → funil), não uma preferência. Em localStorage, uma aba
// restauraria a rolagem gravada por outra.
//
// ⚠️ O registro NÃO é apagado ao ser consumido — ele EXPIRA (10 min). A
// primeira versão limpava no consumo, e a revisão do PR #71 achou os três
// buracos disso: apagar antes dos rAF perdia a restauração se o quadro
// desmontasse na janela; ir e voltar duas vezes (Back do navegador + faixa)
// teleportava para `list[0]`; e um funil restaurado SEM etapas nunca
// consumia o registro. Com prazo, a jornada inteira reusa o mesmo registro
// e a visita desavisada de amanhã não é sequestrada por ele.
// ============================================================

export const CHAVE_RETORNO_DO_FUNIL = "wacrm:pipelines:retorno";

/** Vida útil do registro. Curta de propósito: é uma jornada, não um estado. */
export const VALIDADE_DO_RETORNO_MS = 10 * 60_000;

export interface RetornoDoFunil {
  pipelineId: string;
  /** Do `.pipeline-scroll` (eixo horizontal do quadro). */
  scrollLeft: number;
  /** Do `<main>` do dashboard (único scroll vertical da página). */
  scrollTop: number;
  /** Quando foi gravado (epoch ms) — o que faz o registro expirar. */
  em: number;
}

function numeroOuZero(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? valor
    : 0;
}

/**
 * Desserialização defensiva: registro estranho ou VENCIDO vira `null`, nunca
 * exceção. `agora` entra por parâmetro para o módulo continuar puro/testável.
 */
export function desserializarRetorno(
  cru: string | null,
  agora: number,
): RetornoDoFunil | null {
  if (!cru) return null;
  try {
    const dado: unknown = JSON.parse(cru);
    if (typeof dado !== "object" || dado === null) return null;
    const objeto = dado as Record<string, unknown>;
    if (typeof objeto.pipelineId !== "string" || !objeto.pipelineId) return null;
    if (typeof objeto.em !== "number" || !Number.isFinite(objeto.em)) return null;
    if (agora - objeto.em > VALIDADE_DO_RETORNO_MS) return null;
    return {
      pipelineId: objeto.pipelineId,
      scrollLeft: numeroOuZero(objeto.scrollLeft),
      scrollTop: numeroOuZero(objeto.scrollTop),
      em: objeto.em,
    };
  } catch {
    return null;
  }
}

export function gravarRetorno(
  retorno: Omit<RetornoDoFunil, "em">,
): void {
  try {
    sessionStorage.setItem(
      CHAVE_RETORNO_DO_FUNIL,
      JSON.stringify({ ...retorno, em: Date.now() }),
    );
  } catch {
    // Storage bloqueado — a volta simplesmente abre no topo.
  }
}

export function lerRetorno(): RetornoDoFunil | null {
  try {
    return desserializarRetorno(
      sessionStorage.getItem(CHAVE_RETORNO_DO_FUNIL),
      Date.now(),
    );
  } catch {
    return null;
  }
}
