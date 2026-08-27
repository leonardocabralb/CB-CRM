import { describe, it, expect } from 'vitest'
import {
  ordenarPorSeveridade,
  pontuacaoDeSeveridade,
  resumirCartoes,
  type InsightParaOrdenacao,
} from './ordenacao'

const AGORA = new Date('2026-08-26T15:00:00-03:00')
const haHoras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000)

function insight(o: Partial<InsightParaOrdenacao> = {}): InsightParaOrdenacao {
  return {
    urgencia: 'nenhuma',
    insatisfacao: false,
    pedidosAbertos: 0,
    aguardandoSegUteis: null,
    nota: null,
    estado: 'aberto',
    ultimaAtividade: haHoras(1),
    ...o,
  }
}

describe('pontuacaoDeSeveridade', () => {
  it('urgência alta ANTIGA ganha de conversa recente sem nada', () => {
    const urgenteAntiga = insight({ urgencia: 'alta', ultimaAtividade: haHoras(96) })
    const recenteVazia = insight({ ultimaAtividade: haHoras(2) })
    expect(pontuacaoDeSeveridade(urgenteAntiga, AGORA)).toBeGreaterThan(
      pontuacaoDeSeveridade(recenteVazia, AGORA),
    )
  })

  it('últimas 72h dão bônus sem virar critério de corte', () => {
    const dentro = insight({ urgencia: 'baixa', ultimaAtividade: haHoras(10) })
    const fora = insight({ urgencia: 'baixa', ultimaAtividade: haHoras(100) })
    expect(pontuacaoDeSeveridade(dentro, AGORA)).toBe(
      pontuacaoDeSeveridade(fora, AGORA) + 15,
    )
  })

  it('pendência abaixo do limiar de 30min não pontua', () => {
    const curta = insight({ aguardandoSegUteis: 10 * 60 })
    const acima = insight({ aguardandoSegUteis: 45 * 60 })
    expect(pontuacaoDeSeveridade(curta, AGORA)).toBe(
      pontuacaoDeSeveridade(insight(), AGORA),
    )
    expect(pontuacaoDeSeveridade(acima, AGORA)).toBeGreaterThan(
      pontuacaoDeSeveridade(curta, AGORA),
    )
  })
})

describe('ordenarPorSeveridade', () => {
  it('aberto sempre acima de tratado/descartado, mesmo mais leve', () => {
    const tratadoGrave = insight({ urgencia: 'alta', estado: 'tratado' })
    const abertoLeve = insight({ urgencia: 'nenhuma' })
    const ordem = ordenarPorSeveridade(
      [tratadoGrave, abertoLeve],
      (x) => x,
      AGORA,
    )
    expect(ordem[0]).toBe(abertoLeve)
  })

  it('empate de severidade decide pela atividade mais recente', () => {
    const velho = insight({ ultimaAtividade: haHoras(50) })
    const novo = insight({ ultimaAtividade: haHoras(5) })
    const ordem = ordenarPorSeveridade([velho, novo], (x) => x, AGORA)
    expect(ordem[0]).toBe(novo)
  })
})

describe('resumirCartoes', () => {
  it('cartões contam só abertos; nota média conta todos', () => {
    const r = resumirCartoes([
      insight({ urgencia: 'alta', nota: 4 }),
      insight({ urgencia: 'media', estado: 'tratado', nota: 8 }),
      insight({ insatisfacao: true, nota: 6 }),
      insight({ aguardandoSegUteis: 2 * 3600 }),
      insight({ aguardandoSegUteis: 5 * 60 }), // abaixo do limiar
    ])
    expect(r.urgencias).toBe(1)
    expect(r.insatisfacoes).toBe(1)
    expect(r.pendencias).toBe(1)
    expect(r.notaMedia).toBe(6)
  })

  it('sem nota nenhuma, média é null (não zero)', () => {
    expect(resumirCartoes([insight()]).notaMedia).toBeNull()
  })

  it('fora da janela conta SÓ como pendência — sinais e nota são congelados', () => {
    // Cliente esquecido além da janela fica no painel pela pendência,
    // mas a urgência/insatisfação/nota dele vêm de análise velha e não
    // podem inflar cartões rotulados "7 dias".
    const r = resumirCartoes([
      insight({
        urgencia: 'alta',
        insatisfacao: true,
        nota: 2,
        aguardandoSegUteis: 30 * 3600,
        foraDaJanela: true,
      }),
      insight({ nota: 8 }),
    ])
    expect(r.urgencias).toBe(0)
    expect(r.insatisfacoes).toBe(0)
    expect(r.pendencias).toBe(1)
    expect(r.notaMedia).toBe(8)
  })
})
