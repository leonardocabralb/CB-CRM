/**
 * Dinheiro — fonte única do formato de valor de negócio.
 *
 * ⚠️ FIXADO EM REAL (pt-BR / BRL) por decisão do operador em 2026-08-30.
 * O upstream trata moeda como configurável (`accounts.default_currency`,
 * migration 021, e `deals.currency` por negócio); no CB Advogados só existe
 * uma moeda, então os dois seletores foram REMOVIDOS da interface e a
 * formatação ignora as duas colunas. Elas continuam no banco, intocadas —
 * apagá-las custaria migration e não devolve nada.
 *
 * Consequência prática: negócio antigo gravado com `currency = 'USD'` (o
 * padrão que vinha do upstream) passa a ser LIDO como real. É o desejado —
 * ninguém aqui fecha contrato em dólar, e o número gravado sempre foi
 * pensado em reais.
 *
 * ⚠️ O separador entre `R$` e o número é NBSP (U+00A0), não espaço comum —
 * é o que o ICU produz em pt-BR, e é bom que seja: evita `R$` órfão no fim
 * da linha num card estreito. Quem for comparar essa saída com string
 * literal (teste, busca, snapshot) precisa escrever ` `.
 */

/**
 * ISO-4217 gravado em negócio novo. Continua exportado porque
 * `deals.currency` é NOT NULL e segue sendo preenchido na escrita — só não é
 * mais lido na exibição.
 */
export const DEFAULT_CURRENCY = 'BRL';

/**
 * As instâncias são criadas UMA vez no módulo, não por chamada.
 * `Intl.NumberFormat` é caro de construir e o Kanban formata um valor por
 * card — com centenas de cards em tela, construir por chamada aparece no
 * perfil.
 */
const FORMATO = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FORMATO_CURTO = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  // ⚠️ `minimumFractionDigits: 0` é OBRIGATÓRIO aqui, não enfeite. Sem ele o
  // mínimo é herdado da moeda (2 casas do real), fica maior que o máximo
  // pedido, e cada versão do V8 resolve esse conflito de um jeito: o CI
  // (Node 20) devolvia `R$ 900,0` onde a máquina de desenvolvimento
  // (Node 24) devolvia `R$ 900`. Medido nas duas. Declarado, as duas
  // concordam.
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * Valor de negócio por extenso: `R$ 40.000,00`.
 *
 * Sempre com centavos e com ponto de milhar. Total por construção — `null`,
 * `undefined` e `NaN` viram `R$ 0,00` em vez de quebrar o render.
 */
export function formatCurrency(value: number | null | undefined): string {
  return FORMATO.format(Number(value) || 0);
}

/**
 * Valor compacto para espaço apertado (centro do donut, linha de legenda):
 * `R$ 128,5 mil`, `R$ 2,5 mi`, `R$ 900`.
 *
 * Os sufixos vêm do próprio ICU em pt-BR — escrevê-los à mão daria "128.5k"
 * no meio de uma tela em português.
 */
export function formatCurrencyShort(value: number | null | undefined): string {
  return FORMATO_CURTO.format(Number(value) || 0);
}

/**
 * Número compacto SEM moeda: 1_234 → "1.2k", 1_200_000 → "1.2M", 900 → "900".
 *
 * ⚠️ Não é dinheiro e não segue o formato acima de propósito: o único
 * consumidor é a contagem de TOKENS de IA (`ai-usage.tsx`), onde "1.2k" é a
 * notação da própria indústria e aparece ao lado de nomes de modelo em
 * inglês. Trocar para "1,2 mil" ali seria localizar um número técnico.
 */
export function formatCompactNumber(value: number): string {
  const v = Number(value || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toFixed(0);
}
