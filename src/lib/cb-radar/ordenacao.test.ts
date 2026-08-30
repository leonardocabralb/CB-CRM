import { describe, it, expect } from 'vitest'
import {
  LIMIAR_ALARME_MS,
  ordenarPorSeveridade,
  pontuacaoDeSeveridade,
  resumirCartoes,
  temGatilho,
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
    aguardandoMsCorridos: null,
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

  it('espera abaixo de 24h corridas não pontua; acima, sim', () => {
    // A régua do score é a CORRIDA, a mesma do alarme — com a útil, toda
    // conversa do dia pontuava aqui e a espera deixava de ordenar nada.
    const curta = insight({ aguardandoMsCorridos: 20 * 3_600_000 })
    const acima = insight({ aguardandoMsCorridos: 30 * 3_600_000 })
    expect(pontuacaoDeSeveridade(curta, AGORA)).toBe(
      pontuacaoDeSeveridade(insight(), AGORA),
    )
    expect(pontuacaoDeSeveridade(acima, AGORA)).toBeGreaterThan(
      pontuacaoDeSeveridade(curta, AGORA),
    )
  })

  it('espera mais longa pontua mais (24h < 48h < 72h)', () => {
    const p = (h: number) =>
      pontuacaoDeSeveridade(insight({ aguardandoMsCorridos: h * 3_600_000 }), AGORA)
    expect(p(24)).toBeLessThan(p(48))
    expect(p(48)).toBeLessThan(p(72))
  })
})

describe('temGatilho — a regra de entrada no painel', () => {
  it('conversa saudável NÃO vira cartão, mesmo analisada e com nota alta', () => {
    // O caso que motivou a mudança: em produção, 7 dos 8 cartões abertos
    // eram conversas nota 9–10 sem nada a tratar.
    expect(temGatilho(insight({ nota: 10 }))).toBe(false)
    expect(temGatilho(insight({ nota: 4 }))).toBe(false)
  })

  it('os quatro gatilhos acionáveis abrem cartão', () => {
    expect(temGatilho(insight({ insatisfacao: true }))).toBe(true)
    expect(temGatilho(insight({ pedidosAbertos: 1 }))).toBe(true)
    expect(temGatilho(insight({ urgencia: 'media' }))).toBe(true)
    expect(temGatilho(insight({ urgencia: 'alta' }))).toBe(true)
    expect(
      temGatilho(insight({ aguardandoMsCorridos: LIMIAR_ALARME_MS })),
    ).toBe(true)
  })

  it('espera de 23h ainda não abre cartão; 24h abre', () => {
    expect(temGatilho(insight({ aguardandoMsCorridos: 23 * 3_600_000 }))).toBe(false)
    expect(temGatilho(insight({ aguardandoMsCorridos: 24 * 3_600_000 }))).toBe(true)
  })

  it('a espera some quando a equipe responde — o cartão sai junto', () => {
    // `aguardandoMsCorridos` nulo é como a tela representa "já respondido",
    // conferido ao vivo antes de o worker reanalisar. Se este teste cair,
    // o cartão volta a ficar na tela contando espera de cliente atendido.
    const esperando = insight({ aguardandoMsCorridos: 30 * 3_600_000 })
    expect(temGatilho(esperando)).toBe(true)
    expect(temGatilho({ ...esperando, aguardandoMsCorridos: null })).toBe(false)
  })

  it('urgência baixa e menção a processo sozinhas NÃO abrem cartão', () => {
    // Num escritório bancário quase toda conversa cita processo: como
    // gatilho viraria ruído universal. `mencaoProcesso` nem entra no tipo
    // de ordenação — este teste documenta que a omissão é deliberada.
    expect(temGatilho(insight({ urgencia: 'baixa' }))).toBe(false)
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
      insight({ aguardandoMsCorridos: 30 * 3_600_000 }),
      insight({ aguardandoMsCorridos: 2 * 3_600_000 }), // abaixo do alarme
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
        aguardandoMsCorridos: 30 * 3_600_000,
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
