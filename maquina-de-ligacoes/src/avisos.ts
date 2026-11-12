/**
 * Os avisos da máquina ao CRM (docs/PLANO-ligar-pelo-crm.md, §8.13): um POST
 * com o segredo no cabeçalho, um de cada vez e na ordem. O CRM fica fora uns
 * segundos a cada deploy: o aviso que falha (rede, 5xx, 408, 429) é tentado
 * de novo com espera crescente, até TETO_DE_IDADE_MS. Recusa definitiva (os
 * outros 4xx, ex. segredo errado) vai ao log e sai da fila.
 *
 * Repetir um aviso não estraga nada: o CRM grava cada informação uma vez só.
 * Do `sinal` só vale o último: um novo substitui o que ainda está na fila.
 */
import type { Aviso } from './tipos.js'

export const TETO_DE_IDADE_MS = 30 * 60_000
const ESPERAS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
const TEMPO_DE_RESPOSTA_MS = 10_000

export interface OpcoesDosAvisos {
  url: string | null
  segredo: string
  computador: string
  registrar: (linha: string) => void
  enviar?: typeof fetch
  agora?: () => number
  esperar?: (ms: number) => Promise<void>
}

interface NaFila {
  aviso: Aviso
  em: string
  criadoEm: number
}

export function criarAvisos(opcoes: OpcoesDosAvisos) {
  const enviar = opcoes.enviar ?? fetch
  const agora = opcoes.agora ?? Date.now
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((pronto) => setTimeout(pronto, ms)))
  const fila: NaFila[] = []
  let drenando: Promise<void> | null = null

  async function tentar(item: NaFila): Promise<'entregue' | 'desistir' | 'de_novo'> {
    try {
      const resposta = await enviar(`${opcoes.url}/api/cb/ligacoes/eventos`, {
        method: 'POST',
        headers: { authorization: `Bearer ${opcoes.segredo}`, 'content-type': 'application/json' },
        body: JSON.stringify({ computador: opcoes.computador, em: item.em, ...item.aviso }),
        signal: AbortSignal.timeout(TEMPO_DE_RESPOSTA_MS),
      })
      if (resposta.ok) return 'entregue'
      if (resposta.status >= 400 && resposta.status < 500 && resposta.status !== 408 && resposta.status !== 429) {
        opcoes.registrar(`aviso ${item.aviso.tipo} recusado pelo CRM (${resposta.status}): sai da fila`)
        return 'desistir'
      }
      return 'de_novo'
    } catch {
      return 'de_novo'
    }
  }

  async function drenar(): Promise<void> {
    let tentativas = 0
    while (fila.length > 0) {
      const item = fila[0]
      if (agora() - item.criadoEm > TETO_DE_IDADE_MS) {
        opcoes.registrar(`aviso ${item.aviso.tipo} sem entrega há mais de 30 min: sai da fila`)
        fila.shift()
        tentativas = 0
        continue
      }
      const desfecho = await tentar(item)
      if (desfecho === 'de_novo') {
        await esperar(ESPERAS_MS[Math.min(tentativas, ESPERAS_MS.length - 1)])
        tentativas += 1
        continue
      }
      fila.shift()
      tentativas = 0
    }
  }

  function avisar(aviso: Aviso): void {
    const item: NaFila = { aviso, em: new Date(agora()).toISOString(), criadoEm: agora() }
    if (!opcoes.url) {
      opcoes.registrar(`aviso (sem CRM): ${JSON.stringify(aviso)}`)
      return
    }
    if (aviso.tipo === 'sinal') {
      // O primeiro da fila pode estar no meio de um envio: só os de trás saem.
      for (let i = fila.length - 1; i >= 1; i--) if (fila[i].aviso.tipo === 'sinal') fila.splice(i, 1)
    }
    fila.push(item)
    if (!drenando) {
      drenando = drenar().finally(() => {
        drenando = null
      })
    }
  }

  return {
    avisar,
    /** Para os testes: espera a fila esvaziar. */
    ocioso: () => drenando ?? Promise.resolve(),
    pendentes: () => fila.length,
  }
}
