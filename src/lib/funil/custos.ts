import {
  type CampanhaMapeada,
  custos,
  diasDoPeriodo,
  gastoDoPeriodo,
  type GastoDoDia,
} from "@/lib/meta-ads/atribuicao";

import type { ResumoDoPeriodo } from "./coorte";
import type { Degrau } from "./degraus";
import type { CartaoDeCusto } from "./painel";
import type { CoorteMensal } from "./saude";

/**
 * Os CUSTOS de um período (Fase 6 do plano do previdenciário, 6.1 e 6.4):
 * investimento em anúncios ÷ cada contagem do resumo. Puro — a MESMA conta no
 * Desempenho (o período escolhido) e na Saúde (mês a mês); uma cópia em cada
 * tela divergiria na primeira mudança.
 *
 * Os divisores, e por que cada um:
 *  - `lead`      = investimento ÷ ENTRADAS (o custo por lead de sempre);
 *  - `mql`, `reuniao`, `proposta`, `pasta` = ÷ quem alcançou o degrau, no
 *    modo escolhido (a contagem do cartão do funil);
 *  - `contrato`  = ÷ `fechados`, quem ALCANÇOU contrato (≥ contrato: pasta
 *    inclusive) — o "custo por contrato ASSINADO" da C1, o que se compara ao
 *    "CAC 100–250" do mentor. Remapear uma etapa de contrato para pasta NÃO o
 *    muda, e mover um card para "Contrato sem pasta" também não;
 *  - `cac`       = ÷ `fechadosAgora`, o contrato EM PÉ (o CAC de sempre). O
 *    distrato e o "Contrato sem pasta" o mudam; remapear para pasta, não
 *    (pasta é fechamento — `ehFechamento`);
 *  - `perdidos`  = custo por lead × os ENTRANTES do período já perdidos
 *    (`perdidosDosEntrantes`, nunca `perdidos` — ver a regra do "custo dos
 *    perdidos").
 *
 * Sem denominador = `null` (a tela escreve "—"), nunca zero nem infinito.
 */
export type CustosDoPeriodo = Record<CartaoDeCusto, number | null>;

function dividir(investimento: number, n: number): number | null {
  return n > 0 ? investimento / n : null;
}

export function custosDoResumo(investimento: number, resumo: ResumoDoPeriodo): CustosDoPeriodo {
  const base = custos(investimento, resumo.entradas, resumo.fechadosAgora, resumo.perdidosDosEntrantes);
  const porDegrau = (d: Degrau) =>
    dividir(investimento, resumo.porDegrau.find((x) => x.degrau === d)?.alcancaram ?? 0);
  return {
    investimento,
    lead: base.custoPorLead,
    mql: porDegrau("mql"),
    reuniao: porDegrau("reuniao"),
    proposta: porDegrau("proposta"),
    contrato: dividir(investimento, resumo.fechados),
    cac: base.cac,
    pasta: porDegrau("pasta"),
    perdidos: base.custoDosPerdidos,
  };
}

export interface CustosDoMes {
  /** AAAA-MM, a mesma chave da coorte do mês */
  chave: string;
  custos: CustosDoPeriodo;
}

/**
 * Os custos de CADA mês da Saúde: o gasto do mês nas campanhas deste funil
 * sobre o resumo do mês (no modo escolhido — a coorte já vem montada). A
 * janela do gasto é a do mês, em dias LOCAIS, como a do Desempenho.
 */
export function custosMensais(
  coortes: readonly CoorteMensal[],
  gastos: readonly GastoDoDia[],
  campanhas: readonly CampanhaMapeada[],
  pipelineId: string,
  agora: Date,
): CustosDoMes[] {
  return coortes.map((c) => {
    const investimento = gastoDoPeriodo(
      gastos,
      campanhas,
      pipelineId,
      diasDoPeriodo({ desde: c.desde, ate: c.ate }, agora),
    ).total;
    return { chave: c.chave, custos: custosDoResumo(investimento, c.resumo) };
  });
}
