// ============================================================
// A cotação do dólar AUTOMÁTICA para o custo da IA em R$ (D21): a PTAX de
// venda do Banco Central (API pública do Olinda, sem chave) mais o IOF do
// cartão. A cotação que o administrador informa, quando existe, vence esta.
//
// ⚠️ Não é a fatura: o banco soma um spread próprio, que muda de banco para
// banco e não tem fonte pública. A tela diz isso, e o campo manual existe para
// quem quiser o número exato.
// ============================================================

import { FUSO_DO_ESCRITORIO } from '@/lib/ia-agentes/pedido'

/** IOF das compras internacionais no cartão em 2026: 3,5% (conferido em 26/09/2026 no blog do Santander e da Wise). */
export const IOF_DO_CARTAO = 0.035

export interface Ptax {
  /** R$ por US$, a de venda. */
  valor: number
  /** Dia do boletim (YYYY-MM-DD, hora de Brasília). */
  dia: string
}

/** A PTAX mais recente de uma resposta do `CotacaoDolarPeriodo`; `null` = forma inesperada. */
export function lerPtax(corpo: unknown): Ptax | null {
  const lista = (corpo as { value?: unknown } | null)?.value
  if (!Array.isArray(lista)) return null
  let melhor: Ptax | null = null
  for (const item of lista) {
    const venda = (item as { cotacaoVenda?: unknown }).cotacaoVenda
    const quando = (item as { dataHoraCotacao?: unknown }).dataHoraCotacao
    if (typeof venda !== 'number' || !(venda > 0) || venda >= 100) continue
    if (typeof quando !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(quando)) continue
    const dia = quando.slice(0, 10)
    if (!melhor || dia >= melhor.dia) melhor = { valor: venda, dia }
  }
  return melhor
}

/** A PTAX com o IOF, em 4 casas (a mesma precisão da cotação manual). */
export function comIof(ptax: number): number {
  return Math.round(ptax * (1 + IOF_DO_CARTAO) * 10000) / 10000
}

/** MM-DD-YYYY no fuso do escritório — o formato que o Olinda pede. */
function diaDoOlinda(d: Date): string {
  const [ano, mes, dia] = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_ESCRITORIO }).format(d).split('-')
  return `${mes}-${dia}-${ano}`
}

/** A URL dos boletins dos últimos 10 dias (cobre feriado emendado com fim de semana). */
export function urlDaPtax(agora: Date): string {
  const inicio = new Date(agora.getTime() - 10 * 86_400_000)
  return (
    'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
    'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)' +
    `?@dataInicial='${diaDoOlinda(inicio)}'&@dataFinalCotacao='${diaDoOlinda(agora)}'` +
    '&$format=json&$select=cotacaoVenda,dataHoraCotacao'
  )
}

const VALIDADE_MS = 6 * 60 * 60_000
const PRAZO_MS = 5_000
let guardada: { ptax: Ptax; em: number } | null = null

/**
 * A PTAX mais recente, com memória de 6 h por processo (a aba Uso não pode
 * pedir ao Banco Central a cada carga). Falhou a busca: a última que deu certo
 * neste processo, senão `null` — a tela diz que não conseguiu, nunca inventa.
 */
export async function buscarPtax(
  agora: Date = new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<Ptax | null> {
  if (guardada && agora.getTime() - guardada.em < VALIDADE_MS) return guardada.ptax
  try {
    const res = await fetchFn(urlDaPtax(agora), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PRAZO_MS),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ptax = lerPtax(await res.json())
    if (!ptax) throw new Error('resposta sem cotação')
    guardada = { ptax, em: agora.getTime() }
    return ptax
  } catch (err) {
    console.error('[ia/cotacao] PTAX do Banco Central indisponível:', err instanceof Error ? err.message : err)
    return guardada?.ptax ?? null
  }
}

/** Só para os testes: esquece a PTAX guardada. */
export function esquecerPtax(): void {
  guardada = null
}
