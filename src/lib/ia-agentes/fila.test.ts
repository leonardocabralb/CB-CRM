import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A FILA de turnos (`fila.ts`). A ingestão NÃO espera o agente: enfileira
// pela RPC (a rajada decidida no banco) e agenda o disparo em `after()`,
// fora do caminho dela. Nenhuma das duas lança — a ingestão não pode cair
// por causa do agente.
// ============================================================

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: vi.fn(),
}))

import { after } from 'next/server'

import { agendarDisparo, enfileirarTurno, ESPERA_DA_RAJADA_MS } from './fila'

type Resposta = { data: unknown; error: { message: string } | null }

function dbCom(resposta: Resposta) {
  const rpc = vi.fn(async () => resposta)
  return { db: { rpc } as never, rpc }
}

const ARGS = {
  accountId: 'conta-1',
  conversationId: 'conv-1',
  canalId: 'canal-1',
  iaAgenteId: 'ag-1',
  mensagemId: 'msg-1',
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(after).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('enfileirarTurno', () => {
  it('chama a RPC da 1044 com a espera da rajada e devolve o pendente', async () => {
    const { db, rpc } = dbCom({ data: [{ id: 'turno-1', executar_apos: '2026-09-26T12:00:08Z' }], error: null })
    const turno = await enfileirarTurno(db, ARGS)
    expect(rpc).toHaveBeenCalledWith('cb_ia_enfileirar_turno', {
      p_account_id: 'conta-1',
      p_conversation_id: 'conv-1',
      p_canal_id: 'canal-1',
      p_ia_agente_id: 'ag-1',
      p_mensagem_id: 'msg-1',
      p_espera_ms: ESPERA_DA_RAJADA_MS,
    })
    expect(turno).toEqual({ id: 'turno-1', executarApos: '2026-09-26T12:00:08Z' })
  })

  it('aceita a linha solta (não só a lista do RETURNS TABLE)', async () => {
    const { db } = dbCom({ data: { id: 'turno-1', executar_apos: '2026-09-26T12:00:08Z' }, error: null })
    expect(await enfileirarTurno(db, ARGS)).toEqual({ id: 'turno-1', executarApos: '2026-09-26T12:00:08Z' })
  })

  it('erro da RPC: null, sem lançar', async () => {
    const { db } = dbCom({ data: null, error: { message: 'lock timeout' } })
    await expect(enfileirarTurno(db, ARGS)).resolves.toBeNull()
  })

  it.each([[[]], [[{ id: 1, executar_apos: 'x' }]], [[{ id: 'turno-1' }]], [null]])(
    'forma estranha (%j): null',
    async (data) => {
      const { db } = dbCom({ data, error: null })
      await expect(enfileirarTurno(db, ARGS)).resolves.toBeNull()
    },
  )
})

describe('agendarDisparo', () => {
  function callbackAgendado(): () => Promise<void> {
    expect(after).toHaveBeenCalledTimes(1)
    return vi.mocked(after).mock.calls[0][0] as () => Promise<void>
  }

  it('não executa na hora: agenda em `after()` e roda depois do `executar_apos`', async () => {
    vi.useFakeTimers()
    const executar = vi.fn(async () => {})
    agendarDisparo({ id: 'turno-1', executarApos: new Date(Date.now() + 8_000).toISOString() }, executar)
    expect(executar).not.toHaveBeenCalled()

    const rodando = callbackAgendado()()
    // Nunca ANTES do `executar_apos` (a reivindicação recusaria o turno ainda
    // na rajada); depois dele, só a folga entre os dois relógios.
    await vi.advanceTimersByTimeAsync(7_900)
    expect(executar).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    await rodando
    expect(executar).toHaveBeenCalledWith('turno-1')
  })

  it('`executar_apos` no passado: roda logo (só a folga)', async () => {
    vi.useFakeTimers()
    const executar = vi.fn(async () => {})
    agendarDisparo({ id: 'turno-1', executarApos: new Date(Date.now() - 60_000).toISOString() }, executar)
    const rodando = callbackAgendado()()
    await vi.advanceTimersByTimeAsync(5_000)
    await rodando
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('`executar_apos` ilegível: espera a rajada inteira', async () => {
    vi.useFakeTimers()
    const executar = vi.fn(async () => {})
    agendarDisparo({ id: 'turno-1', executarApos: 'não é data' }, executar)
    const rodando = callbackAgendado()()
    await vi.advanceTimersByTimeAsync(ESPERA_DA_RAJADA_MS - 100)
    expect(executar).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    await rodando
    expect(executar).toHaveBeenCalledTimes(1)
  })

  it('fora de pedido (`after` lança): não lança nem executa — a rede do cron roda o turno', () => {
    vi.mocked(after).mockImplementation(() => {
      throw new Error('`after` was called outside a request scope')
    })
    const executar = vi.fn(async () => {})
    expect(() => agendarDisparo({ id: 'turno-1', executarApos: new Date().toISOString() }, executar)).not.toThrow()
    expect(executar).not.toHaveBeenCalled()
  })
})
