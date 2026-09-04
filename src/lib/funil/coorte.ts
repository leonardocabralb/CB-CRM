import { localDayKey } from "@/lib/dashboard/date-utils";

import { type Classificacao, type Degrau, DEGRAUS, indiceDoDegrau } from "./degraus";
import { dentroDoIntervalo, diasDoIntervalo, type Intervalo } from "./periodo";
import type { FatosDoNegocio } from "./trajetoria";

/**
 * A COORTE de um período e tudo o que o painel de Desempenho mostra sobre
 * ela. Regra 2 do plano: a coorte são os negócios cuja ENTRADA no funil
 * caiu no período; tudo o mais se conta sobre ela ATÉ HOJE — "dos 35 que
 * entraram em setembro, 21 chegaram a MQL", inclusive se chegaram em outubro.
 *
 * ⚠️ As linhas da RPC são um SUPERCONJUNTO (negócio criado no intervalo OU
 * com qualquer evento no intervalo). O recorte de verdade é `coorteDoPeriodo`
 * — nunca some as linhas cruas como se fossem a coorte.
 *
 * ⚠️ Negócio transferido para outro funil está aqui como qualquer outro
 * (regra 6, decisão do operador em 2026-09-03): `fatosDoNegocio` já
 * resolveu a última etapa dele neste funil.
 */

export interface ContagemDoDegrau {
  degrau: Degrau;
  /** negócios da coorte que alcançaram este degrau ou um posterior (regra 3). */
  alcancaram: number;
  /** o funil tem ao menos uma etapa neste degrau. Sem etapa = card tracejado. */
  comEtapa: boolean;
  /** alcançaram ÷ o degrau mapeado anterior (o primeiro: ÷ entradas); nulo sem etapa ou sem denominador. */
  taxaDoAnterior: number | null;
}

export interface Transicao {
  de: Degrau;
  para: Degrau;
  numerador: number;
  denominador: number;
  /** fração 0..1; nulo quando o denominador é zero. */
  taxa: number | null;
}

export interface PerdaPorEtapa {
  etapaId: string;
  nome: string;
  n: number;
}

export interface EntradasNoDia {
  /** AAAA-MM-DD local */
  dia: string;
  n: number;
}

export interface ResumoDoPeriodo {
  entradas: number;
  porDegrau: ContagemDoDegrau[];
  /** entre degraus MAPEADOS consecutivos — degrau sem etapa é pulado. */
  transicoes: Transicao[];
  /** lead → contrato; nulo se um dos dois não tem etapa. */
  global: Transicao | null;
  /** uma linha por etapa de perda, na ordem do funil, inclusive com zero. */
  perdasPorEtapa: PerdaPorEtapa[];
  perdidos: number;
  semAvanco: number;
  emAndamento: number;
  /** em andamento por degrau ATUAL (o "pipeline ativo" da referência = proposta). */
  emAndamentoPorDegrau: Partial<Record<Degrau, number>>;
  /**
   * Entrou no funil e hoje está numa etapa SEM degrau (estacionado). É balde
   * da coorte como os outros — sem ele, os totais não fechavam com as
   * entradas (achado do Codex no PR #119). A situação particiona a coorte:
   * fechado + perdido + sem avanço + em andamento + fora do funil = entradas.
   */
  foraDoFunil: number;
  /** alcançaram contrato (regra 3), mesmo que tenham voltado depois. */
  fechados: number;
  valorFechado: number;
  ticketMedio: number | null;
  /** densa quando o intervalo tem `desde`; esparsa (só dias com lead) no Total. */
  entradasPorDia: EntradasNoDia[];
}

export function coorteDoPeriodo(
  fatos: readonly FatosDoNegocio[],
  intervalo: Intervalo,
): FatosDoNegocio[] {
  return fatos.filter((f) => f.entradaEm !== null && dentroDoIntervalo(f.entradaEm, intervalo));
}

function transicao(de: Degrau, para: Degrau, alcancaram: number[]): Transicao {
  const numerador = alcancaram[indiceDoDegrau(para)];
  const denominador = alcancaram[indiceDoDegrau(de)];
  return { de, para, numerador, denominador, taxa: denominador > 0 ? numerador / denominador : null };
}

export function resumoDoPeriodo(
  fatos: readonly FatosDoNegocio[],
  classificacao: Classificacao,
  intervalo: Intervalo,
  agora: Date,
): ResumoDoPeriodo {
  const coorte = coorteDoPeriodo(fatos, intervalo);
  const entradas = coorte.length;

  const alcancaram = DEGRAUS.map(
    (_, k) => coorte.filter((f) => f.degrauMaximo !== null && f.degrauMaximo >= k).length,
  );
  const comEtapa = DEGRAUS.map((d) => classificacao.porClasse[d].length > 0);

  let denominadorAnterior = entradas;
  const porDegrau: ContagemDoDegrau[] = DEGRAUS.map((degrau, k) => {
    if (!comEtapa[k]) {
      return { degrau, alcancaram: alcancaram[k], comEtapa: false, taxaDoAnterior: null };
    }
    const taxaDoAnterior = denominadorAnterior > 0 ? alcancaram[k] / denominadorAnterior : null;
    denominadorAnterior = alcancaram[k];
    return { degrau, alcancaram: alcancaram[k], comEtapa: true, taxaDoAnterior };
  });

  const mapeados = DEGRAUS.filter((_, k) => comEtapa[k]);
  const transicoes = mapeados.slice(1).map((para, i) => transicao(mapeados[i], para, alcancaram));
  const global =
    comEtapa[indiceDoDegrau("lead")] && comEtapa[indiceDoDegrau("contrato")]
      ? transicao("lead", "contrato", alcancaram)
      : null;

  const perdasPorEtapa: PerdaPorEtapa[] = classificacao.porClasse.perda.map((etapa) => ({
    etapaId: etapa.id,
    nome: etapa.name,
    n: coorte.filter((f) => f.situacao === "perdido" && f.etapaAtual === etapa.id).length,
  }));

  const emAndamentoPorDegrau: Partial<Record<Degrau, number>> = {};
  for (const f of coorte) {
    if (f.situacao !== "andamento" || !f.classeAtual || f.classeAtual === "perda") continue;
    emAndamentoPorDegrau[f.classeAtual] = (emAndamentoPorDegrau[f.classeAtual] ?? 0) + 1;
  }

  const fechadosDaCoorte = coorte.filter((f) => f.alcancouContrato);
  const fechados = fechadosDaCoorte.length;
  const valorFechado = fechadosDaCoorte.reduce((soma, f) => soma + f.linha.value, 0);

  return {
    entradas,
    porDegrau,
    transicoes,
    global,
    perdasPorEtapa,
    perdidos: coorte.filter((f) => f.situacao === "perdido").length,
    semAvanco: coorte.filter((f) => f.situacao === "sem_avanco").length,
    emAndamento: coorte.filter((f) => f.situacao === "andamento").length,
    emAndamentoPorDegrau,
    foraDoFunil: coorte.filter((f) => f.situacao === "fora_do_funil").length,
    fechados,
    valorFechado,
    ticketMedio: fechados > 0 ? valorFechado / fechados : null,
    entradasPorDia: entradasPorDia(coorte, intervalo, agora),
  };
}

function entradasPorDia(
  coorte: readonly FatosDoNegocio[],
  intervalo: Intervalo,
  agora: Date,
): EntradasNoDia[] {
  const contagem = new Map<string, number>();
  for (const f of coorte) {
    if (!f.entradaEm) continue;
    const dia = localDayKey(f.entradaEm);
    contagem.set(dia, (contagem.get(dia) ?? 0) + 1);
  }
  const dias = intervalo.desde ? diasDoIntervalo(intervalo, agora) : [...contagem.keys()].sort();
  return dias.map((dia) => ({ dia, n: contagem.get(dia) ?? 0 }));
}

export interface DeltaDeContagem {
  atual: number;
  anterior: number | null;
  /** fração: 0.2 = +20%; nulo sem período anterior ou com anterior zero. */
  variacao: number | null;
}

export interface DeltaDeTaxa {
  atual: number | null;
  anterior: number | null;
  /** diferença em PONTOS PERCENTUAIS; nulo quando falta um dos lados. */
  pp: number | null;
}

export interface Comparacao {
  entradas: DeltaDeContagem;
  fechados: DeltaDeContagem;
  perdidos: DeltaDeContagem;
  global: DeltaDeTaxa | null;
  transicoes: (Pick<Transicao, "de" | "para"> & DeltaDeTaxa)[];
}

function contagem(atual: number, anterior: number | null): DeltaDeContagem {
  return {
    atual,
    anterior,
    variacao: anterior !== null && anterior > 0 ? (atual - anterior) / anterior : null,
  };
}

function taxa(atual: number | null, anterior: number | null): DeltaDeTaxa {
  return {
    atual,
    anterior,
    pp: atual !== null && anterior !== null ? (atual - anterior) * 100 : null,
  };
}

/** Atual × anterior. `anterior` nulo (Total) devolve deltas nulos. */
export function comparar(atual: ResumoDoPeriodo, anterior: ResumoDoPeriodo | null): Comparacao {
  return {
    entradas: contagem(atual.entradas, anterior?.entradas ?? null),
    fechados: contagem(atual.fechados, anterior?.fechados ?? null),
    perdidos: contagem(atual.perdidos, anterior?.perdidos ?? null),
    global: atual.global
      ? taxa(atual.global.taxa, anterior?.global?.taxa ?? null)
      : null,
    transicoes: atual.transicoes.map((t) => {
      const par = anterior?.transicoes.find((a) => a.de === t.de && a.para === t.para);
      return { de: t.de, para: t.para, ...taxa(t.taxa, par?.taxa ?? null) };
    }),
  };
}
