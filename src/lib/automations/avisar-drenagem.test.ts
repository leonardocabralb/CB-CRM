import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { avisarDrenagemDeFunil } from './avisar-drenagem'
import { EVENTO_EXECUCOES } from '@/lib/execucoes/aviso'

/**
 * ⚠️ O que este arquivo protege: o aviso de drenagem é a ÚNICA ponte entre
 * "o operador mexeu num card" e "a tela sabe que há automação rodando". A rota
 * AGUARDA a drenagem antes de responder, então a resposta é o único instante
 * em que dá para avisar sem adivinhar. Sem o evento, o raio do quadro e da
 * lista só aparecia no recarregamento seguinte — e ficava aceso o expediente
 * inteiro depois de a fila esvaziar (Codex, PR #155).
 */
describe('avisarDrenagemDeFunil', () => {
  let ouvidos: number

  // ⚠️ A suíte roda em `environment: "node"` e o projeto não tem jsdom. Um
  // `EventTarget` no lugar de `window` basta: o que se mede aqui é a decisão
  // de avisar, não a implementação de DOM do navegador.
  beforeEach(() => {
    ouvidos = 0
    const alvo = new EventTarget()
    alvo.addEventListener(EVENTO_EXECUCOES, () => {
      ouvidos += 1
    })
    vi.stubGlobal('window', alvo)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('avisa a tela quando a rota confirma que drenou', async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchFalso)

    avisarDrenagemDeFunil()
    await vi.waitFor(() => expect(ouvidos).toBe(1))

    expect(fetchFalso).toHaveBeenCalledWith(
      '/api/automations/events/drain',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    )
  })

  it('NÃO avisa quando a rota recusa — nada mudou na fila', async () => {
    // 403 do papel, 500 do banco: avisar aqui faria as três telas refazerem a
    // consulta para receber exatamente o que já tinham.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    avisarDrenagemDeFunil()
    await new Promise((r) => setTimeout(r, 10))

    expect(ouvidos).toBe(0)
  })

  it('rede caindo não vira erro na tela nem aviso', async () => {
    // Fire-and-forget de verdade: o movimento do card já está gravado, e o
    // cron é a rede de segurança.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    expect(() => avisarDrenagemDeFunil()).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))

    expect(ouvidos).toBe(0)
  })
})
