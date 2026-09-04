/**
 * Formatação dos números do painel de Desempenho — pt-BR fixo, como
 * `src/lib/currency.ts` (o app serve um locale só). Puro, para o teste.
 */

const percentual = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const inteiroComSinal = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

const umaCasaComSinal = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** 0.6 → "60,0%"; nulo → "—". */
export function formatarPercentual(fracao: number | null): string {
  return fracao === null ? "—" : percentual.format(fracao);
}

/** Variação de contagem, em %: 0.07 → "+7%"; -0.5 → "-50%"; nulo → null. */
export function formatarVariacao(variacao: number | null): string | null {
  return variacao === null ? null : `${inteiroComSinal.format(variacao * 100)}%`;
}

/** Diferença de taxa, em pontos percentuais: 20 → "+20,0 pp"; nulo → null. */
export function formatarPp(pp: number | null): string | null {
  return pp === null ? null : `${umaCasaComSinal.format(pp)} pp`;
}

/** -1, 0 ou 1 — o que decide a seta e a cor do delta. */
export function sinalDe(n: number | null): number {
  if (n === null || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

/** "2026-09-01" → "01/09" (rótulo do eixo do gráfico de entradas). */
export function rotuloCurtoDoDia(chave: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
  return m ? `${m[3]}/${m[2]}` : chave;
}

/** Uma fração 0..1 vira 0..100 com uma casa, para o eixo do gráfico de taxas. */
export function paraPontosPercentuais(fracao: number | null): number | null {
  return fracao === null ? null : Math.round(fracao * 1000) / 10;
}
