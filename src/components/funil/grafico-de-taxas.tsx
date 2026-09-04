"use client";

import { BarChart } from "@/components/tremor/bar-chart";

export interface LinhaDeTaxa {
  transicao: string;
  atual: number | null;
  anterior: number | null;
}

/**
 * Taxas de conversão entre degraus, atual × anterior — barras horizontais
 * (o `layout="vertical"` do recharts é o das barras deitadas). Os valores
 * já chegam em pontos percentuais (0..100). Tremor vendorizado, como o
 * gráfico de tempo de resposta do painel.
 */
export function GraficoDeTaxas({
  linhas,
  rotuloAtual,
  rotuloAnterior,
}: {
  linhas: LinhaDeTaxa[];
  rotuloAtual: string;
  rotuloAnterior: string;
}) {
  // As chaves das séries são os RÓTULOS traduzidos: o Tremor usa a chave
  // como texto da legenda e do tooltip.
  const dados = linhas.map((l) => ({
    transicao: l.transicao,
    [rotuloAtual]: l.atual ?? 0,
    [rotuloAnterior]: l.anterior ?? 0,
  }));

  return (
    <BarChart
      data={dados}
      index="transicao"
      categories={[rotuloAtual, rotuloAnterior]}
      colors={["emerald", "amber"]}
      layout="vertical"
      valueFormatter={(v) => `${v.toFixed(1)}%`}
      minValue={0}
      maxValue={100}
      yAxisWidth={190}
      showLegend
      legendPosition="right"
      className="h-[280px]"
    />
  );
}
