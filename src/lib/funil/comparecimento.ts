import type { ReuniaoDoResumo } from "@/lib/reunioes/resumo";

import { contagem, taxa, type DeltaDeContagem, type DeltaDeTaxa } from "./coorte";
import { marcaDaReuniaoQueVale } from "./degraus";
import type { Intervalo } from "./periodo";

/**
 * O COMPARECIMENTO no Desempenho do funil (Fase 4 de
 * `docs/PLANO-reagendamento.md`; D4/D5 do operador, 09/10/2026): compareceram
 * (com e sem proposta), no-show, reagendaram e a taxa de comparecimento, pelo
 * período escolhido e contra o anterior.
 *
 * - ⚠️ Conta pela DATA DA REUNIÃO nos DOIS modos do Desempenho: reunião é
 *   evento, não coorte. A seção diz isso.
 * - ⚠️ A reunião conta no funil em que o card estava NO INÍCIO dela
 *   (`ReuniaoDoResumo.funil`, resolvido no servidor), nunca no de hoje.
 * - ⚠️ Comparecimento = compareceram ÷ (compareceram + no-show). Reagendadas
 *   e sem resultado ficam FORA da taxa e aparecem à parte; sem denominador a
 *   taxa é `null` ("—"), nunca 0%.
 *
 * Puro.
 */

export interface ContagemDeReunioes {
  /** As reuniões do funil que começaram no período, com e sem resultado. */
  reunioes: number;
  /** Com proposta + sem proposta. */
  compareceram: number;
  comProposta: number;
  noShow: number;
  reagendaram: number;
  semResultado: number;
  /** compareceram ÷ (compareceram + no-show); nulo sem denominador. */
  comparecimento: number | null;
}

export interface ComparacaoDeReunioes {
  compareceram: DeltaDeContagem;
  noShow: DeltaDeContagem;
  reagendaram: DeltaDeContagem;
  comparecimento: DeltaDeTaxa;
}

/** `[desde, ate)`, a régua do período do Desempenho (`periodo.ts`). */
function noIntervalo(iso: string, intervalo: Intervalo): boolean {
  const v = Date.parse(iso);
  if (Number.isNaN(v)) return false;
  if (intervalo.desde && v < intervalo.desde.getTime()) return false;
  if (intervalo.ate && v >= intervalo.ate.getTime()) return false;
  return true;
}

export function contarReunioes(linhas: readonly ReuniaoDoResumo[], funil: string, intervalo: Intervalo): ContagemDeReunioes {
  const c = { reunioes: 0, comProposta: 0, semProposta: 0, noShow: 0, reagendaram: 0, semResultado: 0 };
  for (const r of linhas) {
    if (r.funil !== funil || !noIntervalo(r.inicio, intervalo)) continue;
    c.reunioes += 1;
    switch (r.resultado) {
      case "proposta":
        c.comProposta += 1;
        break;
      case "sem_proposta":
        c.semProposta += 1;
        break;
      case "no_show":
        c.noShow += 1;
        break;
      case "reagendar":
        c.reagendaram += 1;
        break;
      case null:
        c.semResultado += 1;
        break;
    }
  }
  const compareceram = c.comProposta + c.semProposta;
  const base = compareceram + c.noShow;
  return {
    reunioes: c.reunioes,
    compareceram,
    comProposta: c.comProposta,
    noShow: c.noShow,
    reagendaram: c.reagendaram,
    semResultado: c.semResultado,
    comparecimento: base > 0 ? compareceram / base : null,
  };
}

/**
 * As reuniões do período que não entram em funil NENHUM: sem card no início,
 * ou card sem passo na trilha até lá. A seção diz quantas, quando há.
 */
export function reunioesForaDeFunil(linhas: readonly ReuniaoDoResumo[], intervalo: Intervalo): number {
  return linhas.filter((r) => r.funil === null && noIntervalo(r.inicio, intervalo)).length;
}

/** Atual × anterior, com as MESMAS variações dos outros cartões (`coorte.ts`). `anterior` nulo (Total) dá deltas nulos. */
export function compararReunioes(atual: ContagemDeReunioes, anterior: ContagemDeReunioes | null): ComparacaoDeReunioes {
  return {
    compareceram: contagem(atual.compareceram, anterior?.compareceram ?? null),
    noShow: contagem(atual.noShow, anterior?.noShow ?? null),
    reagendaram: contagem(atual.reagendaram, anterior?.reagendaram ?? null),
    comparecimento: taxa(atual.comparecimento, anterior ? anterior.comparecimento : null),
  };
}

/**
 * O funil mede comparecimento? Só com etapa marcada "Compareceu", "Faltou" ou
 * "Reagendar" (a marca que VALE: da proposta em diante ela é ignorada,
 * `marcaDaReuniaoQueVale`). Nos outros, zeros teriam cara de medida.
 * "Qualificada" não é comparecimento.
 */
export function funilMedeComparecimento(
  etapas: readonly { degrau?: string | null; desfecho_da_reuniao?: string | null }[],
): boolean {
  return etapas.some((e) => {
    const marca = marcaDaReuniaoQueVale(e.degrau ?? null, e.desfecho_da_reuniao ?? null);
    return marca === "compareceu" || marca === "faltou" || marca === "reagendar";
  });
}
