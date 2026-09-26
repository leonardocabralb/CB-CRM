import { beforeEach, describe, expect, it, vi } from 'vitest'

// ------------------------------------------------------------
// A varredura dos lembretes por data (935) de ponta a ponta, com banco e
// motor falsos.
//
// O caso que motivou (medido em produção): o campo "Data e Hora Reunião" é
// gravado pela automação do Calendly ("…17:30:00.000000Z") e, ~1 s depois,
// pela API v1 ("…17:30:00.000Z"). A trava é UNIQUE (automação, contato,
// VALOR) em TEXTO: o ciclo que lia entre as duas escritas travava a 1ª forma,
// o seguinte lia a 2ª — outra chave — e o cliente recebia o lembrete DUAS
// vezes. O banco falso abaixo compara o valor como TEXTO, igual ao Postgres.
// Duas defesas, cada uma com o seu teste: a leitura das travas já gravadas
// compara pelo INSTANTE (é ela que barra o ciclo seguinte), e o INSERT grava o
// instante canônico (é ele que serializa dois ciclos concorrentes — o teste
// "o INSERT leva o valor canônico" e o pino `trava-do-lembrete.chamadores`).
// ------------------------------------------------------------

const h = vi.hoisted(() => ({
  automacoes: [] as Record<string, unknown>[],
  /** O que a RPC de alvos devolve neste ciclo. */
  alvos: [] as { contact_id: string; valor: string }[],
  /** Os cancelamentos do Calendly que a varredura lê. */
  cancelados: [] as { contact_id: string; inicio: string | null }[],
  /** A tabela `cb_automation_reminders`, com o UNIQUE da 935. */
  travas: [] as Record<string, unknown>[],
  /** Todo INSERT tentado na trava, na ordem. */
  inserts: [] as Record<string, unknown>[],
  rpcs: [] as string[],
  /** A leitura das travas já gravadas devolve erro. */
  falhaNaLeituraDasTravas: false,
  proximoId: 1,
  resultado: {
    candidatas: 1,
    foraDoEscopo: 0,
    executadas: 1,
    comFalha: 0,
    emEspera: 0,
  } as { candidatas: number; foraDoEscopo: number; executadas: number; comFalha: number; emEspera: number; erro?: string },
}))

vi.mock('./admin-client', () => {
  function tabela(nome: string) {
    let tipo: 'select' | 'insert' | 'delete' = 'select'
    let linha: Record<string, unknown> | null = null
    const filtros: [string, unknown][] = []

    const resolver = () => {
      if (nome === 'automations') return { data: h.automacoes, error: null }
      if (nome === 'cb_calendly_eventos') {
        return { data: h.cancelados, error: null, count: h.cancelados.length }
      }
      if (nome === 'cb_automation_reminders' && tipo === 'insert' && linha) {
        const nova = linha
        h.inserts.push(nova)
        // UNIQUE (automation_id, contact_id, valor) — valor é TEXT.
        const colide = h.travas.some(
          (t) =>
            t.automation_id === nova.automation_id &&
            t.contact_id === nova.contact_id &&
            t.valor === nova.valor,
        )
        if (colide) return { data: null, error: { code: '23505', message: 'duplicate key' } }
        const id = `trava-${h.proximoId++}`
        h.travas.push({ ...nova, id })
        return { data: { id }, error: null }
      }
      if (nome === 'cb_automation_reminders' && tipo === 'select') {
        if (h.falhaNaLeituraDasTravas) {
          return { data: null, error: { code: '57014', message: 'timeout' }, count: null }
        }
        const lidas = h.travas.filter((t) => filtros.every(([k, v]) => t[k] === v))
        return { data: lidas, error: null, count: lidas.length }
      }
      if (nome === 'cb_automation_reminders' && tipo === 'delete') {
        h.travas = h.travas.filter((t) => !filtros.every(([k, v]) => t[k] === v))
        return { data: null, error: null }
      }
      return { data: null, error: null }
    }

    const b: Record<string, unknown> = {
      select: () => b,
      eq: (k: string, v: unknown) => {
        filtros.push([k, v])
        return b
      },
      in: () => b,
      range: () => b,
      insert: (l: Record<string, unknown>) => {
        tipo = 'insert'
        linha = l
        return b
      },
      delete: () => {
        tipo = 'delete'
        return b
      },
      maybeSingle: async () => resolver(),
      then: (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(f, r),
    }
    return b
  }

  return {
    supabaseAdmin: () => ({
      from: tabela,
      rpc: async (nome: string) => {
        h.rpcs.push(nome)
        return { data: h.alvos, error: null }
      },
    }),
  }
})

vi.mock('./engine', () => ({
  dispararAutomacoes: vi.fn(async () => h.resultado),
}))

import { chaveDaTrava } from '@/lib/calendly/cancelamento'
import { dispararAutomacoes } from './engine'
import { varrerLembretes } from './varrer-lembretes'

const disparo = vi.mocked(dispararAutomacoes)

const LEMBRETE = {
  id: 'a24',
  account_id: 'conta-1',
  trigger_type: 'date_field_offset',
  is_active: true,
  trigger_config: {
    fonte: 'campo',
    custom_field_id: 'cf-reuniao',
    offset_hours: 24,
    direction: 'antes',
  },
}

const DO_CALENDLY = '2026-09-28T17:30:00.000000Z'
const DA_API = '2026-09-28T17:30:00.000Z'

beforeEach(() => {
  h.automacoes = [LEMBRETE]
  h.alvos = []
  h.cancelados = []
  h.travas = []
  h.inserts = []
  h.rpcs = []
  h.falhaNaLeituraDasTravas = false
  h.proximoId = 1
  h.resultado = { candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 }
  disparo.mockClear()
})

async function ciclo(valor: string) {
  h.alvos = [{ contact_id: 'contato-1', valor }]
  return varrerLembretes()
}

describe('a trava do lembrete é o INSTANTE, não o texto', () => {
  it('CRÍTICO: Calendly (…000000Z) e depois a API (…000Z) do mesmo horário: UM disparo só', async () => {
    const primeiro = await ciclo(DO_CALENDLY)
    expect(primeiro.disparados).toBe(1)

    const segundo = await ciclo(DA_API)
    expect(segundo.disparados).toBe(0)
    expect(segundo.repetidos).toBe(1)

    expect(disparo).toHaveBeenCalledTimes(1)
  })

  it('CRÍTICO: a ordem inversa também (API primeiro, Calendly depois)', async () => {
    expect((await ciclo(DA_API)).disparados).toBe(1)
    const segundo = await ciclo(DO_CALENDLY)
    expect(segundo.disparados).toBe(0)
    expect(segundo.repetidos).toBe(1)
    expect(disparo).toHaveBeenCalledTimes(1)
  })

  it('reagendamento para OUTRO instante dispara de novo', async () => {
    await ciclo(DO_CALENDLY)
    const reagendado = await ciclo('2026-09-29T17:30:00.000000Z')
    expect(reagendado.disparados).toBe(1)
    expect(disparo).toHaveBeenCalledTimes(2)
  })

  it('o INSERT leva o valor canônico, com motivo "disparo"', async () => {
    await ciclo(DO_CALENDLY)
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0]).toMatchObject({
      account_id: 'conta-1',
      automation_id: 'a24',
      contact_id: 'contato-1',
      valor: DA_API,
      motivo: 'disparo',
    })
  })

  it('valor sem fuso entra na trava como veio (não se escolhe fuso em silêncio)', async () => {
    await ciclo('2026-09-28T17:30:00')
    expect(h.inserts[0]?.valor).toBe('2026-09-28T17:30:00')
  })

  it('CRÍTICO: a trava pré-armada pelo cancelamento barra a varredura que lê o outro formato', async () => {
    // Os dois escritores da trava passam por `chaveDaTrava`: o cancelamento
    // pré-armou quando a ficha tinha o texto da API, e a varredura lê o do
    // Calendly (a forma que NÃO é a canônica — é ela que precisa da chave).
    h.travas = [
      {
        id: 'pre',
        automation_id: 'a24',
        contact_id: 'contato-1',
        valor: chaveDaTrava(DA_API),
        motivo: 'cancelamento',
      },
    ]
    const r = await ciclo(DO_CALENDLY)
    expect(r.disparados).toBe(0)
    expect(r.repetidos).toBe(1)
    expect(disparo).not.toHaveBeenCalled()
  })

  it('trava devolvida (o recorte barrou) libera o ciclo seguinte, em qualquer formato', async () => {
    h.resultado = { candidatas: 1, foraDoEscopo: 1, executadas: 0, comFalha: 0, emEspera: 0 }
    const barrado = await ciclo(DO_CALENDLY)
    expect(barrado.devolvidos).toBe(1)
    expect(h.travas).toHaveLength(0)

    h.resultado = { candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 }
    expect((await ciclo(DA_API)).disparados).toBe(1)
    expect(disparo).toHaveBeenCalledTimes(2)
  })

  it('lembrete da AGENDA também trava pelo instante', async () => {
    h.automacoes = [{ ...LEMBRETE, trigger_config: { fonte: 'reuniao', offset_hours: 24, direction: 'antes' } }]
    await ciclo('2026-09-28T17:30:00Z')
    expect(h.rpcs).toEqual(['cb_alvos_de_lembrete_reuniao'])
    expect(h.inserts[0]?.valor).toBe(DA_API)
  })
})

describe('a trava gravada PELO TEXTO, antes desta versão, continua valendo (Codex, PR #305)', () => {
  // A versão anterior gravava o valor como veio do campo. O UNIQUE é de
  // TEXTO: sem a leitura por instante, a trava antiga não barraria a nova e o
  // cliente receberia o lembrete de novo — logo depois do deploy, ou durante
  // ele, com as duas versões vivas.
  const ANTIGA = { id: 'antiga', automation_id: 'a24', contact_id: 'contato-1', motivo: 'disparo' }

  it('CRÍTICO: trava antiga no formato do Calendly e o campo no MESMO formato: não dispara', async () => {
    h.travas = [{ ...ANTIGA, valor: DO_CALENDLY }]
    const r = await ciclo(DO_CALENDLY)
    expect(r.disparados).toBe(0)
    expect(r.repetidos).toBe(1)
    expect(h.inserts).toHaveLength(0)
    expect(disparo).not.toHaveBeenCalled()
  })

  it('CRÍTICO: trava antiga no formato do Calendly e o campo já no da API: não dispara', async () => {
    h.travas = [{ ...ANTIGA, valor: DO_CALENDLY }]
    expect((await ciclo(DA_API)).repetidos).toBe(1)
    expect(disparo).not.toHaveBeenCalled()
  })

  it('trava antiga de OUTRO horário não barra o lembrete do horário novo', async () => {
    h.travas = [{ ...ANTIGA, valor: '2026-09-21T17:30:00.000000Z' }]
    expect((await ciclo(DO_CALENDLY)).disparados).toBe(1)
  })

  it('trava de OUTRA automação não barra esta', async () => {
    h.travas = [{ ...ANTIGA, automation_id: 'outra', valor: DO_CALENDLY }]
    expect((await ciclo(DO_CALENDLY)).disparados).toBe(1)
  })

  it('leitura das travas que falha: falha FECHADA, nada é travado nem enviado', async () => {
    h.falhaNaLeituraDasTravas = true
    const r = await ciclo(DO_CALENDLY)
    expect(r.falhas).toBe(1)
    expect(r.disparados).toBe(0)
    expect(h.inserts).toHaveLength(0)
    expect(disparo).not.toHaveBeenCalled()
  })
})
