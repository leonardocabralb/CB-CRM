// ------------------------------------------------------------
// A cadeia de encadeamento — a guarda que impede o laço infinito (D13).
//
// O operador recusou teto de profundidade: uma esteira comercial longa é
// legítima, e um teto de 5 a quebraria sem avisar. A guarda é ANTI-CICLO —
// a mesma cadeia não passa duas vezes pelo mesmo lugar. Esteira longa passa;
// X→Y→X para na segunda volta.
//
// A 934 já usava isso para o funil, com chave `deal:<id>|stage:<id>`. A 936
// estende para automação e robô, e as chaves precisam viver num lugar só:
// duas pontas montando a chave de formas diferentes fazem a guarda depender
// de qual delas escreveu, e um laço passa despercebido.
//
// ⚠️ Sem isto, "automação A aciona B, B aciona A" manda mensagem ao cliente
// para sempre — não é hipótese: o laço equivalente no funil foi montado de
// propósito em produção (2026-08-03) e só parou por causa desta guarda.
// ------------------------------------------------------------

/** Chave de uma automação na cadeia. */
export function chaveDeAutomacao(automationId: string): string {
  return `automation:${automationId}`
}

/** Chave de um robô (fluxo) na cadeia. */
export function chaveDeFluxo(flowId: string): string {
  return `flow:${flowId}`
}

export type ResultadoDoEncadeamento =
  | { ok: true; cadeia: string[] }
  | { ok: false; motivo: string }

/**
 * Pode acionar `alvo` a partir de `origem`, e com que cadeia?
 *
 * A cadeia recebida é a do disparo atual; `origem` é quem está acionando
 * agora. Ela entra na cadeia ANTES da conferência, e é isso que faz o
 * autoacionamento (A aciona A) ser barrado já na primeira volta, em vez de
 * depois de uma execução inteira à toa.
 *
 * Cadeia vazia = disparo de gente, de conexão ou do relógio: começo de
 * história, nada a barrar.
 */
export function encadear(
  cadeia: string[],
  origem: string,
  alvo: string,
): ResultadoDoEncadeamento {
  const nova = cadeia.includes(origem) ? [...cadeia] : [...cadeia, origem]
  if (nova.includes(alvo)) {
    return {
      ok: false,
      motivo: `ciclo detectado (${alvo} já visitado neste encadeamento)`,
    }
  }
  return { ok: true, cadeia: [...nova, alvo] }
}

/**
 * Lê a cadeia de dentro do contexto do disparo.
 *
 * Mora em `vars._cadeia` porque o contexto inteiro é gravado como JSONB em
 * `automation_pending_executions.context` — ou seja, a cadeia **atravessa o
 * passo "Aguardar" de graça**. Sem isso, "aguardar 1 minuto e acionar a
 * automação A" driblaria a guarda toda vez, e o laço voltaria pela porta
 * dos fundos com o cliente recebendo uma mensagem por minuto.
 *
 * O filtro por `typeof v === 'string'` não é paranoia de tipo: o valor vem
 * de JSONB, onde qualquer coisa pode ter sido gravada.
 */
export function lerCadeia(vars: Record<string, unknown> | undefined): string[] {
  const bruta = vars?._cadeia
  return Array.isArray(bruta) ? bruta.filter((v): v is string => typeof v === 'string') : []
}
