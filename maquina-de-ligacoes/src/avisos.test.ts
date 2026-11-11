import { describe, expect, it } from 'vitest'
import { TETO_DE_IDADE_MS, criarAvisos } from './avisos.js'

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres'

function montar(respostas: (number | 'rede')[] = []) {
  let agora = 1_000_000
  const enviados: { url: string; corpo: Record<string, unknown>; autorizacao: string }[] = []
  const registros: string[] = []
  const fila = [...respostas]
  const avisos = criarAvisos({
    url: 'http://crm.exemplo.test',
    segredo: SEGREDO,
    computador: 'teste',
    registrar: (linha) => registros.push(linha),
    agora: () => agora,
    esperar: async (ms) => {
      agora += ms
    },
    enviar: async (url, init) => {
      enviados.push({
        url: String(url),
        corpo: JSON.parse(String(init?.body)),
        autorizacao: new Headers(init?.headers).get('authorization') ?? '',
      })
      const proxima = fila.shift() ?? 200
      if (proxima === 'rede') throw new Error('rede fora')
      return new Response(null, { status: proxima })
    },
  })
  return { avisos, enviados, registros, avancar: (ms: number) => (agora += ms) }
}

describe('avisos ao CRM', () => {
  it('sem CRM, só no log', async () => {
    const registros: string[] = []
    const avisos = criarAvisos({ url: null, segredo: SEGREDO, computador: 'teste', registrar: (l) => registros.push(l) })
    avisos.avisar({ tipo: 'chamando', ligacao: 'lig-1' })
    await avisos.ocioso()
    expect(registros).toHaveLength(1)
    expect(avisos.pendentes()).toBe(0)
  })

  it('na ordem, com o segredo e o nome da máquina', async () => {
    const m = montar()
    m.avisos.avisar({ tipo: 'chamando', ligacao: 'lig-1' })
    m.avisos.avisar({ tipo: 'atendida', ligacao: 'lig-1', atendida_em: '2026-11-10T20:00:00.000Z' })
    await m.avisos.ocioso()
    expect(m.enviados.map((e) => e.corpo.tipo)).toEqual(['chamando', 'atendida'])
    expect(m.enviados[0].url).toBe('http://crm.exemplo.test/api/cb/ligacoes/eventos')
    expect(m.enviados[0].autorizacao).toBe(`Bearer ${SEGREDO}`)
    expect(m.enviados[0].corpo).toMatchObject({ computador: 'teste', ligacao: 'lig-1' })
    expect(typeof m.enviados[0].corpo.em).toBe('string')
  })

  it('rede fora e 5xx: tenta de novo até entregar', async () => {
    const m = montar(['rede', 503, 200])
    m.avisos.avisar({ tipo: 'chamando', ligacao: 'lig-1' })
    await m.avisos.ocioso()
    expect(m.enviados).toHaveLength(3)
    expect(m.avisos.pendentes()).toBe(0)
  })

  it('recusa definitiva (4xx) sai da fila com log; 429 tenta de novo', async () => {
    const m = montar([401, 429, 200])
    m.avisos.avisar({ tipo: 'chamando', ligacao: 'lig-1' })
    m.avisos.avisar({ tipo: 'chamando', ligacao: 'lig-2' })
    await m.avisos.ocioso()
    expect(m.enviados.map((e) => e.corpo.ligacao)).toEqual(['lig-1', 'lig-2', 'lig-2'])
    expect(m.registros.some((r) => r.includes('401'))).toBe(true)
  })

  it('do sinal só vale o último', async () => {
    const m = montar()
    const sinal = (ligacao: string | null) => ({ tipo: 'sinal' as const, whatsapp: 'conectado' as const, ligacao, chrome: '157' })
    m.avisos.avisar(sinal(null))
    m.avisos.avisar(sinal('lig-1'))
    m.avisos.avisar(sinal('lig-2'))
    await m.avisos.ocioso()
    expect(m.enviados.map((e) => e.corpo.ligacao)).toEqual([null, 'lig-2'])
  })

  it('desiste do aviso que passou de 30 min sem entrega', async () => {
    const m = montar(Array(1_000).fill(503))
    m.avisos.avisar({ tipo: 'chamando', ligacao: 'lig-1' })
    await m.avisos.ocioso()
    expect(m.avisos.pendentes()).toBe(0)
    expect(m.registros.some((r) => r.includes('30 min'))).toBe(true)
    expect(m.enviados.length).toBeGreaterThan(TETO_DE_IDADE_MS / 30_000 - 5)
  })
})
