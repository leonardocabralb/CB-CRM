import type { Degrau } from "./degraus";

/**
 * As CORES do funil de eficiência — tinta do cartão no Desempenho, linha e
 * legenda na Saúde — e a grade dos cartões. Saíram dos componentes para o
 * teste (1054): com a pasta, um degrau novo tem de ganhar cor, e a linha que
 * chega nela não pode repetir a da global.
 *
 * ⚠️ Toda classe aqui é LITERAL, nunca montada (`bg-${cor}-500` não é gerada:
 * o Tailwind varre o fonte atrás de strings e não executa código). E a cor
 * da linha são TRÊS classes (`traco`/`ponto`/`bloco`), nunca uma derivada
 * com `replace("stroke-", "fill-")` — medido: `.fill-sky-500` não existia no
 * CSS compilado e o ponto da linha caía no preto padrão do SVG. Há teste
 * cobrando a forma.
 */

/**
 * Fundo e borda tingidos com a cor do degrau (a referência do operador,
 * 05/09). Os matizes são os das linhas da Saúde.
 */
export const TINTA_DO_DEGRAU: Record<Degrau, string> = {
  lead: "border-sky-500/40 bg-sky-500/10",
  mql: "border-violet-500/40 bg-violet-500/10",
  reuniao: "border-pink-500/40 bg-pink-500/10",
  proposta: "border-amber-500/40 bg-amber-500/10",
  contrato: "border-emerald-500/40 bg-emerald-500/10",
  pasta: "border-lime-500/40 bg-lime-500/10",
};

export interface CorDaLinha {
  traco: string;
  ponto: string;
  bloco: string;
}

export const COR_DO_DEGRAU: Record<Degrau, CorDaLinha> = {
  lead: { traco: "stroke-sky-500", ponto: "fill-sky-500", bloco: "bg-sky-500" },
  mql: { traco: "stroke-violet-500", ponto: "fill-violet-500", bloco: "bg-violet-500" },
  reuniao: { traco: "stroke-pink-500", ponto: "fill-pink-500", bloco: "bg-pink-500" },
  proposta: { traco: "stroke-amber-500", ponto: "fill-amber-500", bloco: "bg-amber-500" },
  contrato: { traco: "stroke-emerald-500", ponto: "fill-emerald-500", bloco: "bg-emerald-500" },
  pasta: { traco: "stroke-lime-500", ponto: "fill-lime-500", bloco: "bg-lime-500" },
};

/**
 * A cor de uma linha da Saúde: a do degrau de PARTIDA — a global (lead →
 * contrato) tem a do contrato, como sempre teve. ⚠️ A linha que CHEGA na
 * pasta (contrato → pasta) toma a cor da pasta: pela regra do degrau de
 * partida ela sairia verde-esmeralda, igual à global, e as duas linhas
 * ficariam indistinguíveis no gráfico e na legenda.
 */
export function corDaTransicao(transicao: { de: Degrau; para: Degrau; global: boolean }): CorDaLinha {
  if (transicao.global) return COR_DO_DEGRAU.contrato;
  if (transicao.para === "pasta") return COR_DO_DEGRAU.pasta;
  return COR_DO_DEGRAU[transicao.de];
}

/**
 * A grade dos cartões do funil no `lg`: cartão · seta · cartão · …, com a
 * seta no tamanho do ícone. Uma forma por QUANTIDADE de cartões, porque o
 * número muda com o funil (degrau que não se aplica some; a pasta é
 * opcional) — e a classe tem de estar escrita inteira no fonte.
 */
const GRADE_DO_FUNIL: Record<number, string> = {
  1: "lg:grid-cols-[minmax(0,1fr)]",
  2: "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
  3: "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]",
  4: "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]",
  5: "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]",
  6: "lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]",
};

export function gradeDoFunil(cartoes: number): string {
  return GRADE_DO_FUNIL[Math.min(Math.max(cartoes, 1), 6)];
}
