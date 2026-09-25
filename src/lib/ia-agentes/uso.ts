// ============================================================
// O uso da IA, somado (docs/PLANO-agentes-de-ia.md, 5.8). PURO, testado.
//
// A entrada são as linhas da RPC `cb_ia_uso` (1043: uma por dia, modo,
// agente, provedor e modelo — a soma é feita no BANCO, porque ler linha a
// linha esbarrava no corte de 1000 do PostgREST). Aqui só se reagrupa e se
// estima o custo.
//
// ⚠️ Produção (`agente`) e teste do Playground (`agente_teste`, D13) ficam
// SEPARADOS. Radar e transcrição são custo da CONTA (D15), sem agente.
// ⚠️ Custo parcial é dito, nunca escondido: `semPreco` lista os modelos que a
// tabela não conhece, e o total em R$ soma só o que tem preço.
// ============================================================

import { custoEmDolar, emReais } from './precos'

export interface LinhaDeUso {
  dia: string
  modo: string
  iaAgenteId: string | null
  iaAgenteNome: string | null
  provedor: string
  modelo: string
  chamadas: number
  tokensEntrada: number
  tokensSaida: number
  tokensTotal: number
}

export interface Soma {
  chamadas: number
  tokensEntrada: number
  tokensSaida: number
  tokensTotal: number
  /** US$ do que tem preço; `null` quando NADA do grupo tem preço. */
  dolar: number | null
  /** R$ pela cotação de hoje; `null` sem cotação ou sem preço. */
  reais: number | null
}

export interface UsoDoAgente {
  iaAgenteId: string | null
  nome: string | null
  producao: Soma
  teste: Soma
}

export interface ResumoDoUso {
  total: Soma
  porModo: Record<string, Soma>
  porAgente: UsoDoAgente[]
  porDia: { dia: string; soma: Soma }[]
  /** "provedor/modelo" sem preço na tabela, com uso no período. */
  semPreco: string[]
}

function vazia(): Soma {
  return { chamadas: 0, tokensEntrada: 0, tokensSaida: 0, tokensTotal: 0, dolar: null, reais: null }
}

function somar(s: Soma, l: LinhaDeUso, dolar: number | null): void {
  s.chamadas += l.chamadas
  s.tokensEntrada += l.tokensEntrada
  s.tokensSaida += l.tokensSaida
  s.tokensTotal += l.tokensTotal
  if (dolar !== null) s.dolar = (s.dolar ?? 0) + dolar
}

function comReais(s: Soma, cotacao: number | null): Soma {
  return { ...s, reais: emReais(s.dolar, cotacao) }
}

export function resumirUso(linhas: LinhaDeUso[], cotacao: number | null): ResumoDoUso {
  const total = vazia()
  const porModo = new Map<string, Soma>()
  const porAgente = new Map<string, UsoDoAgente>()
  const porDia = new Map<string, Soma>()
  const semPreco = new Set<string>()

  for (const l of linhas) {
    const dolar = custoEmDolar({
      provedor: l.provedor,
      modelo: l.modelo,
      dia: l.dia,
      tokensEntrada: l.tokensEntrada,
      tokensSaida: l.tokensSaida,
      tokensTotal: l.tokensTotal,
    })
    if (dolar === null && l.tokensTotal > 0) semPreco.add(`${l.provedor}/${l.modelo}`)

    somar(total, l, dolar)

    if (!porModo.has(l.modo)) porModo.set(l.modo, vazia())
    somar(porModo.get(l.modo)!, l, dolar)

    if (!porDia.has(l.dia)) porDia.set(l.dia, vazia())
    somar(porDia.get(l.dia)!, l, dolar)

    if (l.modo === 'agente' || l.modo === 'agente_teste') {
      const chave = l.iaAgenteId ?? '—'
      if (!porAgente.has(chave)) {
        porAgente.set(chave, {
          iaAgenteId: l.iaAgenteId,
          nome: l.iaAgenteNome,
          producao: vazia(),
          teste: vazia(),
        })
      }
      const a = porAgente.get(chave)!
      if (!a.nome && l.iaAgenteNome) a.nome = l.iaAgenteNome
      somar(l.modo === 'agente' ? a.producao : a.teste, l, dolar)
    }
  }

  return {
    total: comReais(total, cotacao),
    porModo: Object.fromEntries([...porModo].map(([m, s]) => [m, comReais(s, cotacao)])),
    porAgente: [...porAgente.values()].map((a) => ({
      ...a,
      producao: comReais(a.producao, cotacao),
      teste: comReais(a.teste, cotacao),
    })),
    porDia: [...porDia]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([dia, s]) => ({ dia, soma: comReais(s, cotacao) })),
    semPreco: [...semPreco].sort(),
  }
}

/** Linha crua da RPC → `LinhaDeUso`; forma estranha é descartada. */
export function lerLinhaDeUso(r: Record<string, unknown>): LinhaDeUso | null {
  if (typeof r.dia !== 'string' || typeof r.modo !== 'string') return null
  if (typeof r.provedor !== 'string' || typeof r.modelo !== 'string') return null
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0)
  return {
    dia: r.dia,
    modo: r.modo,
    iaAgenteId: typeof r.ia_agente_id === 'string' ? r.ia_agente_id : null,
    iaAgenteNome: typeof r.ia_agente_nome === 'string' ? r.ia_agente_nome : null,
    provedor: r.provedor,
    modelo: r.modelo,
    chamadas: n(r.chamadas),
    tokensEntrada: n(r.tokens_entrada),
    tokensSaida: n(r.tokens_saida),
    tokensTotal: n(r.tokens_total),
  }
}
