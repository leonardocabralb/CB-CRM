import type { Classificacao } from "./degraus";
import { type ResumoDoPeriodo, resumoDoPeriodo } from "./coorte";
import { type MesDoHistorico, mesesAnteriores } from "./periodo";
import type { FatosDoNegocio } from "./trajetoria";

/**
 * A vista de Saúde: doze COORTES MENSAIS (pelo mês da entrada no funil) e a
 * escala de cor do mapa de calor.
 *
 * Regra 11 do plano: coorte recente ainda está em andamento (a tela marca),
 * e coorte PEQUENA fica apagada — taxa sobre 2 leads é ruído, e a referência
 * pinta 100% e 0% com a mesma confiança.
 *
 * Cor RELATIVA À LINHA (decisão D6): dentro de uma transição, o melhor mês
 * dos doze é verde e o pior é vermelho. Escala absoluta pintaria
 * "Lead → Contrato" de vermelho em todo mês (2–9%) e não informaria nada.
 */

export const COORTE_PEQUENA = 5;

export interface CoorteMensal extends MesDoHistorico {
  resumo: ResumoDoPeriodo;
  /** ainda sem desfecho: sem avanço + em andamento. */
  emAberto: number;
  pequena: boolean;
}

export function coortesMensais(
  fatos: readonly FatosDoNegocio[],
  classificacao: Classificacao,
  meses: number,
  agora: Date,
): CoorteMensal[] {
  return mesesAnteriores(agora, meses).map((mes) => {
    const resumo = resumoDoPeriodo(fatos, classificacao, { desde: mes.desde, ate: mes.ate }, agora);
    return {
      ...mes,
      resumo,
      emAberto: resumo.semAvanco + resumo.emAndamento,
      pequena: coortePequena(resumo.entradas),
    };
  });
}

export function coortePequena(entradas: number): boolean {
  return entradas < COORTE_PEQUENA;
}

/**
 * Normaliza os valores de UMA linha do mapa para 0..1 (pior → melhor).
 * Nulos ficam nulos; linha sem variação (tudo igual) devolve 0.5 — não há
 * "melhor" nem "pior" para pintar.
 */
export function escalaRelativa(
  valores: readonly (number | null)[],
): (v: number | null) => number | null {
  const validos = valores.filter((v): v is number => v !== null);
  if (validos.length === 0) return () => null;
  const min = Math.min(...validos);
  const max = Math.max(...validos);
  return (v) => {
    if (v === null) return null;
    if (max === min) return 0.5;
    return (v - min) / (max - min);
  };
}
