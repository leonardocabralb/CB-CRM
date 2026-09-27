import { describe, expect, it } from 'vitest'

import { FUSO_DO_ESCRITORIO } from './pedido'
import {
  bloqueiosDoContato,
  CADENCIA_PADRAO,
  FUSO_DA_RETOMADA,
  janelaEfetiva,
  JANELA_PADRAO,
  lerRetomada,
  lerRetomadaDoCorpo,
  motivoDaParada,
  partesDoIntervalo,
  proximaRetomada,
  SEM_BLOQUEIOS,
  tempoEmIngles,
  type Bloqueios,
  type ConfigDaRetomada,
} from './retomada'

// ============================================================
// A RETOMADA (1056): a regra pura. O fuso é o do escritório (-03:00, sem
// horário de verão): "10:00" aqui é 13:00Z. 28/09/2026 é uma SEGUNDA.
// ============================================================

/** O instante de "dia hh:mm" em Brasília. */
const em = (dia: string, hora: string) => Date.parse(`${dia}T${hora}:00-03:00`)
const MIN = 60_000
const PADRAO: Pick<ConfigDaRetomada, 'cadencia' | 'janela'> = { cadencia: [...CADENCIA_PADRAO], janela: { ...JANELA_PADRAO } }

function proxima(p: {
  ancora: number
  tentativa?: number
  ultimaRetomada?: number | null
  agora?: number
  config?: typeof PADRAO
  horario?: Parameters<typeof proximaRetomada>[0]['horario']
  bloqueios?: Bloqueios
  fimDaJanelaMeta?: number | null
}) {
  return proximaRetomada({
    ancora: p.ancora,
    tentativa: p.tentativa ?? 0,
    ultimaRetomada: p.ultimaRetomada ?? null,
    agora: p.agora ?? p.ancora + MIN,
    config: p.config ?? PADRAO,
    horario: p.horario ?? null,
    bloqueios: p.bloqueios ?? SEM_BLOQUEIOS,
    fimDaJanelaMeta: p.fimDaJanelaMeta ?? null,
  })
}

describe('o fuso', () => {
  it('é o do escritório (o de `pedido.ts`, sem importar dele: o ciclo)', () => {
    expect(FUSO_DA_RETOMADA).toBe(FUSO_DO_ESCRITORIO)
  })
})

describe('lerRetomada — o que está gravado (parse, nunca `as`)', () => {
  it('ausente ou forma estranha: desligada, com a cadência e a janela padrão', () => {
    for (const v of [null, undefined, 'x', [], 3]) {
      expect(lerRetomada(v)).toEqual({ ativa: false, cadencia: [15, 60, 180, 360, 720, 2880], janela: { inicio: '08:00', fim: '21:00' } })
    }
  })

  it('só o booleano `true` liga ("true" e 1 do JSONB, não)', () => {
    expect(lerRetomada({ ativa: true }).ativa).toBe(true)
    expect(lerRetomada({ ativa: 'true' }).ativa).toBe(false)
    expect(lerRetomada({ ativa: 1 }).ativa).toBe(false)
  })

  it('cadência e janela fora da forma caem no padrão, campo a campo', () => {
    const r = lerRetomada({ ativa: true, cadencia: [60, 15], janela: { inicio: '22:00', fim: '08:00' } })
    expect(r.cadencia).toEqual([...CADENCIA_PADRAO])
    expect(r.janela).toEqual({ ...JANELA_PADRAO })
    const boa = lerRetomada({ ativa: true, cadencia: [30, 120], janela: { inicio: '09:00', fim: '18:30' } })
    expect(boa).toEqual({ ativa: true, cadencia: [30, 120], janela: { inicio: '09:00', fim: '18:30' } })
  })
})

describe('lerRetomadaDoCorpo — o PATCH (estrito)', () => {
  const boa = { ativa: true, cadencia: [15, 60], janela: { inicio: '08:00', fim: '21:00' } }

  it('a forma boa passa, copiada', () => {
    expect(lerRetomadaDoCorpo(boa)).toEqual(boa)
  })

  it.each<[string, unknown]>([
    ['sem objeto', null],
    ['ativa em texto', { ...boa, ativa: 'true' }],
    ['cadência vazia', { ...boa, cadencia: [] }],
    ['nove tentativas', { ...boa, cadencia: [10, 20, 30, 40, 50, 60, 70, 80, 90] }],
    ['menos de 10 min', { ...boa, cadencia: [5, 60] }],
    ['mais de 7 dias', { ...boa, cadencia: [15, 10081] }],
    ['não inteiro', { ...boa, cadencia: [15.5] }],
    ['fora de ordem', { ...boa, cadencia: [60, 15] }],
    ['repetido', { ...boa, cadencia: [15, 15] }],
    ['janela invertida', { ...boa, janela: { inicio: '21:00', fim: '08:00' } }],
    ['janela vazia', { ...boa, janela: { inicio: '08:00', fim: '08:00' } }],
    ['24:00', { ...boa, janela: { inicio: '08:00', fim: '24:00' } }],
    ['sem janela', { ativa: true, cadencia: [15] }],
  ])('%s: recusa (null)', (_rotulo, v) => {
    expect(lerRetomadaDoCorpo(v)).toBeNull()
  })

  it('8 tentativas, de 10 min a 7 dias: aceita', () => {
    expect(lerRetomadaDoCorpo({ ...boa, cadencia: [10, 20, 30, 40, 50, 60, 70, 10080] })).not.toBeNull()
  })
})

describe('proximaRetomada — a cadência, da âncora e do espaçamento', () => {
  const ancora = em('2026-09-28', '10:00')

  it('a 1ª tentativa: âncora + 15 min', () => {
    expect(proxima({ ancora })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '10:15') })
  })

  it('sem adiamento, a k-ésima cai em âncora + cadência[k]', () => {
    expect(proxima({ ancora, tentativa: 2, ultimaRetomada: em('2026-09-28', '11:00'), agora: em('2026-09-28', '11:01') })).toEqual({
      tipo: 'agendar',
      instante: em('2026-09-28', '13:00'),
    })
  })

  it('o espaçamento da cadência vale a partir de quando a anterior SAIU', () => {
    // A 1ª saiu atrasada, às 10:50: a 2ª sai 45 min (60 − 15) depois dela.
    expect(proxima({ ancora, tentativa: 1, ultimaRetomada: em('2026-09-28', '10:50'), agora: em('2026-09-28', '10:50') })).toEqual({
      tipo: 'agendar',
      instante: em('2026-09-28', '11:35'),
    })
  })

  it('e nunca antes de 30 min depois da anterior (a rede de segurança, com intervalos próximos)', () => {
    const config = { cadencia: [15, 20], janela: { ...JANELA_PADRAO } }
    expect(proxima({ ancora, tentativa: 1, ultimaRetomada: em('2026-09-28', '10:15'), agora: em('2026-09-28', '10:15'), config })).toEqual({
      tipo: 'agendar',
      instante: em('2026-09-28', '10:45'),
    })
  })

  it('rodando atrasada (o cron caiu): agora, se ainda na janela', () => {
    expect(proxima({ ancora, agora: em('2026-09-28', '11:30') })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '11:30') })
  })

  it('a cadência acabou: para', () => {
    expect(proxima({ ancora, tentativa: 6 })).toEqual({ tipo: 'parar', motivo: 'cadencia_acabou' })
    expect(proxima({ ancora, tentativa: -1 })).toEqual({ tipo: 'parar', motivo: 'cadencia_acabou' })
  })
})

describe('proximaRetomada — a janela do dia (08:00–21:00, no fuso do escritório)', () => {
  it('vencida depois das 21:00: sai às 08:00 do dia seguinte', () => {
    const ancora = em('2026-09-28', '20:50')
    expect(proxima({ ancora })).toEqual({ tipo: 'agendar', instante: em('2026-09-29', '08:00') })
  })

  it('vencida de madrugada: sai às 08:00 do mesmo dia', () => {
    const ancora = em('2026-09-28', '06:00')
    expect(proxima({ ancora })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '08:00') })
  })

  it('20:59 ainda está dentro; 21:00 já não', () => {
    expect(proxima({ ancora: em('2026-09-28', '20:44') })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '20:59') })
    expect(proxima({ ancora: em('2026-09-28', '20:45') })).toEqual({ tipo: 'agendar', instante: em('2026-09-29', '08:00') })
  })

  it('⚠️⚠️ a tentativa adiada empurra as seguintes: o ESPAÇAMENTO da cadência vale a partir de quando a anterior saiu', () => {
    // O exemplo do operador (27/09/2026): sem o espaçamento, a noite fora da
    // janela deixava cinco mensagens entre 08:00 e 10:00 — a pressão que a
    // retomada não pode fazer. Cada tentativa: max(âncora + cadência[k],
    // enviada(k-1) + (cadência[k] - cadência[k-1])), e depois a janela.
    const ancora = em('2026-09-28', '20:50')
    const saidas: number[] = []
    let ultima: number | null = null
    for (let k = 0; k < 6; k++) {
      const r = proxima({ ancora, tentativa: k, ultimaRetomada: ultima, agora: ultima ?? ancora })
      if (r.tipo !== 'agendar') throw new Error(`parou em ${k}`)
      saidas.push(r.instante)
      ultima = r.instante
    }
    expect(saidas).toEqual([
      em('2026-09-29', '08:00'), // 21:05 está fora: a abertura seguinte
      em('2026-09-29', '08:45'), // max(21:50, 08:00 + 45 min)
      em('2026-09-29', '10:45'), // max(23:50, 08:45 + 2 h)
      em('2026-09-29', '13:45'), // 10:45 + 3 h
      em('2026-09-29', '19:45'), // 13:45 + 6 h
      // max(âncora + 48 h = 30/09 20:50, 29/09 19:45 + 36 h = 01/10 07:45) =
      // 01/10 07:45, fora da janela: a abertura, 08:00. (O exemplo do pedido
      // dizia "= âncora + 48 h"; pela fórmula dele, a conta dá 01/10 07:45.)
      em('2026-10-01', '08:00'),
    ])
  })

  it('sem adiamento, o espaçamento não muda nada: a série é a cadência contada da âncora', () => {
    const ancora = em('2026-09-28', '09:00')
    const saidas: number[] = []
    let ultima: number | null = null
    for (let k = 0; k < 5; k++) {
      const r = proxima({ ancora, tentativa: k, ultimaRetomada: ultima, agora: ultima ?? ancora })
      if (r.tipo !== 'agendar') throw new Error(`parou em ${k}`)
      saidas.push(r.instante)
      ultima = r.instante
    }
    expect(saidas).toEqual([
      em('2026-09-28', '09:15'),
      em('2026-09-28', '10:00'),
      em('2026-09-28', '12:00'),
      em('2026-09-28', '15:00'),
      em('2026-09-29', '08:00'), // 21:00 (âncora + 12 h) já está fora: a abertura seguinte
    ])
  })

  it('com o horário do agente, vale a interseção — e os dias dele', () => {
    const horario = { dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' }
    // Sexta 17:50 + 15 min = 18:05 → fora → segunda 09:00.
    expect(proxima({ ancora: em('2026-10-02', '17:50'), horario })).toEqual({ tipo: 'agendar', instante: em('2026-10-05', '09:00') })
    // Segunda 08:10 + 15 = 08:25: dentro da janela da retomada, fora do horário do agente.
    expect(proxima({ ancora: em('2026-09-28', '08:10'), horario })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '09:00') })
  })

  it('janela e horário que não se cruzam: para', () => {
    const config = { cadencia: [15], janela: { inicio: '08:00', fim: '10:00' } }
    const horario = { dias: [1, 2, 3, 4, 5], inicio: '12:00', fim: '18:00' }
    expect(proxima({ ancora: em('2026-09-28', '09:00'), config, horario })).toEqual({ tipo: 'parar', motivo: 'sem_janela' })
    expect(janelaEfetiva(config.janela, horario)).toBeNull()
  })

  it('sem horário: todos os dias, na janela da retomada', () => {
    expect(janelaEfetiva(JANELA_PADRAO, null)).toEqual({ dias: [0, 1, 2, 3, 4, 5, 6], inicio: 480, fim: 1260 })
    // Domingo também.
    expect(proxima({ ancora: em('2026-09-27', '10:00') })).toEqual({ tipo: 'agendar', instante: em('2026-09-27', '10:15') })
  })
})

describe('proximaRetomada — os lembretes da reunião e a reunião', () => {
  const ancora = em('2026-09-28', '10:00')

  it('a menos de 30 min de um lembrete: empurra para 30 min depois dele', () => {
    const bloqueios = { lembretes: [em('2026-09-28', '10:30')], reunioes: [em('2026-09-28', '18:00')] }
    expect(proxima({ ancora, bloqueios })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '11:00') })
  })

  it('também DEPOIS do lembrete (ele acabou de sair)', () => {
    const bloqueios = { lembretes: [em('2026-09-28', '10:00')], reunioes: [em('2026-09-28', '18:00')] }
    expect(proxima({ ancora, bloqueios })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '10:30') })
  })

  it('a exatos 30 min do lembrete já não bloqueia', () => {
    const bloqueios = { lembretes: [em('2026-09-28', '10:45')], reunioes: [] }
    expect(proxima({ ancora, bloqueios })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '10:15') })
  })

  it('lembretes seguidos: empurra de um para o outro', () => {
    const bloqueios = { lembretes: [em('2026-09-28', '10:20'), em('2026-09-28', '11:00')], reunioes: [] }
    // 10:15 → 10:50 (perto das 11:00) → 11:30.
    expect(proxima({ ancora, bloqueios })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '11:30') })
  })

  it('o empurrão que passa das 21:00 vai para a manhã seguinte', () => {
    const bloqueios = { lembretes: [em('2026-09-28', '20:45')], reunioes: [] }
    expect(proxima({ ancora: em('2026-09-28', '20:15'), bloqueios })).toEqual({ tipo: 'agendar', instante: em('2026-09-29', '08:00') })
  })

  it('a partir de 90 min antes da reunião, a série PARA', () => {
    const bloqueios = { lembretes: [], reunioes: [em('2026-09-28', '11:40')] }
    expect(proxima({ ancora, bloqueios })).toEqual({ tipo: 'parar', motivo: 'reuniao_proxima' })
    // 91 min antes: ainda sai.
    const longe = { lembretes: [], reunioes: [em('2026-09-28', '11:46')] }
    expect(proxima({ ancora, bloqueios: longe })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '10:15') })
  })

  it('e para quando a tentativa cairia DEPOIS de uma reunião futura', () => {
    const bloqueios = { lembretes: [], reunioes: [em('2026-09-28', '15:00')] }
    // 48 h depois: a reunião do meio já teria acontecido.
    expect(proxima({ ancora, tentativa: 5, bloqueios })).toEqual({ tipo: 'parar', motivo: 'reuniao_proxima' })
  })

  it('reunião que já passou não bloqueia nada', () => {
    const bloqueios = { lembretes: [], reunioes: [em('2026-09-28', '09:00')] }
    expect(proxima({ ancora, bloqueios })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '10:15') })
  })
})

describe('proximaRetomada — a janela de 24 h da Meta', () => {
  const ancora = em('2026-09-28', '10:00')

  it('fecha antes do vencimento (com 5 min de folga): para', () => {
    expect(proxima({ ancora, fimDaJanelaMeta: em('2026-09-28', '10:19') })).toEqual({ tipo: 'parar', motivo: 'janela_24h' })
  })

  it('aberta depois do vencimento: sai', () => {
    expect(proxima({ ancora, fimDaJanelaMeta: em('2026-09-28', '10:21') })).toEqual({ tipo: 'agendar', instante: em('2026-09-28', '10:15') })
  })

  it('nula (conexão por QR Code): nada a conferir', () => {
    expect(proxima({ ancora, tentativa: 5, fimDaJanelaMeta: null }).tipo).toBe('agendar')
  })
})

describe('motivoDaParada — quem escreveu depois da âncora', () => {
  const AG = 'ag-1'
  it('ninguém, ou só as retomadas do próprio agente: segue', () => {
    expect(motivoDaParada([], AG)).toBeNull()
    expect(motivoDaParada([{ sender_type: 'bot', ia_agente_id: AG }], AG)).toBeNull()
  })

  it.each<[string, { sender_type: string; ia_agente_id: string | null }, string]>([
    ['o cliente', { sender_type: 'customer', ia_agente_id: null }, 'cliente_respondeu'],
    ['a equipe (CRM ou celular pareado)', { sender_type: 'agent', ia_agente_id: null }, 'equipe_respondeu'],
    ['o robô ou uma automação', { sender_type: 'bot', ia_agente_id: null }, 'robo_falou'],
    ['outro agente', { sender_type: 'bot', ia_agente_id: 'ag-2' }, 'robo_falou'],
  ])('%s: para', (_rotulo, m, motivo) => {
    expect(motivoDaParada([{ sender_type: 'bot', ia_agente_id: AG }, m], AG)).toBe(motivo)
  })

  it('o cliente vence os outros motivos', () => {
    expect(
      motivoDaParada(
        [
          { sender_type: 'bot', ia_agente_id: null },
          { sender_type: 'agent', ia_agente_id: null },
          { sender_type: 'customer', ia_agente_id: null },
        ],
        AG,
      ),
    ).toBe('cliente_respondeu')
  })
})

describe('bloqueiosDoContato — os lembretes da conta (ligados ou não) aplicados à ficha', () => {
  const reuniao = em('2026-09-29', '15:00')

  it('"antes" subtrai, "depois" soma; a reunião é o valor do campo, uma vez', () => {
    const b = bloqueiosDoContato(
      [
        { campoId: 'data', deslocamentoMs: 24 * 60 * MIN, direcao: 'antes' },
        { campoId: 'data', deslocamentoMs: 10 * MIN, direcao: 'antes' },
        { campoId: 'data', deslocamentoMs: 60 * MIN, direcao: 'depois' },
      ],
      (campo) => (campo === 'data' ? reuniao : null),
    )
    expect(b.reunioes).toEqual([reuniao])
    expect(b.lembretes).toEqual([em('2026-09-28', '15:00'), em('2026-09-29', '14:50'), em('2026-09-29', '16:00')])
  })

  it('deslocamento ilegível: o campo ainda é a reunião (a parada dos 90 min), sem instante de lembrete', () => {
    const b = bloqueiosDoContato([{ campoId: 'data', deslocamentoMs: null, direcao: 'antes' }], () => reuniao)
    expect(b).toEqual({ lembretes: [], reunioes: [reuniao] })
  })

  it('campo vazio ou ilegível na ficha: nada bloqueia', () => {
    expect(bloqueiosDoContato([{ campoId: 'data', deslocamentoMs: MIN, direcao: 'antes' }], () => null)).toEqual({ lembretes: [], reunioes: [] })
  })
})

describe('textos', () => {
  it('tempoEmIngles: o tempo sem resposta, para o modelo', () => {
    expect(tempoEmIngles(MIN)).toBe('1 minute')
    expect(tempoEmIngles(15 * MIN)).toBe('15 minutes')
    expect(tempoEmIngles(60 * MIN)).toBe('1 hour')
    expect(tempoEmIngles(180 * MIN)).toBe('3 hours')
    expect(tempoEmIngles(47 * 60 * MIN)).toBe('47 hours')
    expect(tempoEmIngles(2880 * MIN)).toBe('2 days')
  })

  it('partesDoIntervalo: min, h (até 72 h) e dias', () => {
    expect(partesDoIntervalo(15)).toEqual({ valor: 15, unidade: 'min' })
    expect(partesDoIntervalo(90)).toEqual({ valor: 90, unidade: 'min' })
    expect(partesDoIntervalo(60)).toEqual({ valor: 1, unidade: 'h' })
    expect(partesDoIntervalo(2880)).toEqual({ valor: 48, unidade: 'h' })
    expect(partesDoIntervalo(4320)).toEqual({ valor: 3, unidade: 'd' })
    expect(partesDoIntervalo(10080)).toEqual({ valor: 7, unidade: 'd' })
  })
})
