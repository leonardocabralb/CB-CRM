import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  criarRecontagem,
  ESPERA_DA_RECONTAGEM_MS,
  ESPERA_MAXIMA_DA_RECONTAGEM_MS,
} from './recontagem-do-sino'

// O selo do sino descia sozinho (porte do #682 do original): o DELETE do
// tempo real chega a todo conectado e o UPDATE vem sem a linha de antes. A
// régua agora é RECONTAR no banco; aqui, a rajada e a ordem das respostas.

/** Uma contagem que só responde quando o teste manda. */
function contagemManual() {
  const pedidas: Array<(n: number | null) => void> = []
  const contar = vi.fn(
    () =>
      new Promise<number | null>((resolve) => {
        pedidas.push(resolve)
      }),
  )
  return { contar, pedidas }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('criarRecontagem', () => {
  it('agora() conta e aplica', async () => {
    const aplicar = vi.fn()
    const r = criarRecontagem(async () => 7, aplicar)
    r.agora()
    await vi.runAllTimersAsync()
    expect(aplicar).toHaveBeenCalledWith(7)
  })

  it('uma rajada de eventos vira UMA contagem, depois da espera', async () => {
    const contar = vi.fn(async () => 3)
    const aplicar = vi.fn()
    const r = criarRecontagem(contar, aplicar)
    for (let i = 0; i < 30; i++) r.pedir()
    await vi.advanceTimersByTimeAsync(ESPERA_DA_RECONTAGEM_MS - 1)
    expect(contar).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await vi.runAllTimersAsync()
    expect(contar).toHaveBeenCalledTimes(1)
    expect(aplicar).toHaveBeenCalledWith(3)
  })

  it('rajada que não para: a contagem sai no teto da espera, não é adiada para sempre', async () => {
    const contar = vi.fn(async () => 1)
    const r = criarRecontagem(contar, vi.fn())
    for (let t = 0; t < ESPERA_MAXIMA_DA_RECONTAGEM_MS; t += 400) {
      r.pedir()
      await vi.advanceTimersByTimeAsync(400)
    }
    expect(contar).toHaveBeenCalledTimes(1)
  })

  it('banco lento: a resposta que chega vale mesmo com uma contagem mais nova ainda no ar', async () => {
    const { contar, pedidas } = contagemManual()
    const aplicar = vi.fn()
    const r = criarRecontagem(contar, aplicar)
    r.agora()
    r.agora() // a mais nova, ainda sem resposta
    pedidas[0](9)
    await vi.runAllTimersAsync()
    expect(aplicar.mock.calls).toEqual([[9]])
    pedidas[1](4)
    await vi.runAllTimersAsync()
    expect(aplicar.mock.calls).toEqual([[9], [4]])
  })

  it('a resposta atrasada de uma contagem ANTERIOR não sobrescreve a última', async () => {
    const { contar, pedidas } = contagemManual()
    const aplicar = vi.fn()
    const r = criarRecontagem(contar, aplicar)
    r.agora() // 1ª: lenta
    r.agora() // 2ª: a que vale
    pedidas[1](4)
    await vi.runAllTimersAsync()
    pedidas[0](9)
    await vi.runAllTimersAsync()
    expect(aplicar.mock.calls).toEqual([[4]])
  })

  it('contagem que falha (null ou lançada) deixa o selo como estava — nunca zero', async () => {
    const aplicar = vi.fn()
    const falhaNula = criarRecontagem(async () => null, aplicar)
    falhaNula.agora()
    const lancou = criarRecontagem(async () => {
      throw new Error('rede')
    }, aplicar)
    lancou.agora()
    await vi.runAllTimersAsync()
    expect(aplicar).not.toHaveBeenCalled()
  })

  it('parar() cancela o pedido pendente e ignora a resposta que ainda está no ar', async () => {
    const { contar, pedidas } = contagemManual()
    const aplicar = vi.fn()
    const r = criarRecontagem(contar, aplicar)
    r.agora()
    r.pedir()
    r.parar()
    pedidas[0](5)
    await vi.runAllTimersAsync()
    expect(contar).toHaveBeenCalledTimes(1) // o pedido pendente não contou
    expect(aplicar).not.toHaveBeenCalled()
    r.agora()
    r.pedir()
    await vi.runAllTimersAsync()
    expect(contar).toHaveBeenCalledTimes(1)
  })

  it('agora() cobre o pedido que estava esperando', async () => {
    const contar = vi.fn(async () => 2)
    const r = criarRecontagem(contar, vi.fn())
    r.pedir()
    r.agora()
    await vi.runAllTimersAsync()
    expect(contar).toHaveBeenCalledTimes(1)
  })
})

describe('useUnreadNotifications — o selo reconta, nunca soma nem desconta', () => {
  const fonte = readFileSync(
    join(__dirname, '../../hooks/use-unread-notifications.ts'),
    'utf8',
  )

  it('todo evento do tempo real pede a recontagem, e a (re)inscrição também', () => {
    expect(fonte).toContain('criarRecontagem(')
    expect(fonte).toContain('() => recontagem.pedir()')
    expect(fonte).toMatch(/status === "SUBSCRIBED"\) recontagem\.pedir\(\)/)
  })

  it('não há delta: o DELETE de outra conta e o UPDATE de aviso já lido descontavam', () => {
    expect(fonte).not.toMatch(/n\s*[+-]\s*1/)
    expect(fonte).not.toContain('eventType')
  })

  it('tópico novo a cada inscrição (o canal que ainda está saindo deixaria o selo surdo)', () => {
    expect(fonte).toContain('`notifications-unread-count:${++geracaoDoCanal}`')
  })
})
