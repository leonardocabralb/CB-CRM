import { describe, it, expect } from 'vitest'
import { precisaDeAnalise, THROTTLE_MS } from './worker'

// A regra de candidatura já produziu o bug mais caro da revisão da 941:
// linha `failed` que nunca teve sucesso (janela_fim NULL) era lida como
// "tem mensagem nova" e furava o teto de tentativas — retentativa PAGA a
// cada ciclo, para sempre, ocupando as vagas do lote. Estes testes fixam
// as regras de quem entra no lote.

const AGORA = Date.parse('2026-08-26T15:00:00Z')
const conversa = (lastMessageAt: string | null) => ({
  id: 'c1',
  account_id: 'a1',
  channel_id: 'ch1',
  last_message_at: lastMessageAt,
})
const insight = (o: {
  status: string
  janela_fim?: string | null
  analisado_em?: string | null
  tentativas?: number
}) => ({
  id: 'i1',
  conversation_id: 'c1',
  status: o.status,
  janela_fim: o.janela_fim ?? null,
  analisado_em: o.analisado_em ?? null,
  tentativas: o.tentativas ?? 0,
})

describe('precisaDeAnalise', () => {
  it('conversa sem insight é candidata', () => {
    expect(precisaDeAnalise(conversa('2026-08-26T14:00:00Z'), undefined, AGORA)).toBe(true)
  })

  it('running nunca é candidata (outro worker está nela)', () => {
    expect(
      precisaDeAnalise(conversa('2026-08-26T14:00:00Z'), insight({ status: 'running' }), AGORA),
    ).toBe(false)
  })

  it('failed que NUNCA teve sucesso PARA no teto de tentativas', () => {
    // O bug: janela_fim NULL era lido como "tem mensagem nova" e o teto
    // nunca era avaliado.
    expect(
      precisaDeAnalise(
        conversa('2026-08-26T14:00:00Z'),
        insight({ status: 'failed', janela_fim: null, tentativas: 3 }),
        AGORA,
      ),
    ).toBe(false)
  })

  it('failed abaixo do teto retenta', () => {
    expect(
      precisaDeAnalise(
        conversa('2026-08-26T14:00:00Z'),
        insight({ status: 'failed', janela_fim: null, tentativas: 2 }),
        AGORA,
      ),
    ).toBe(true)
  })

  it('failed acima do teto volta SÓ com mensagem nova DE VERDADE', () => {
    const comSucessoAntigo = insight({
      status: 'failed',
      janela_fim: '2026-08-26T10:00:00Z',
      tentativas: 9,
    })
    expect(precisaDeAnalise(conversa('2026-08-26T14:00:00Z'), comSucessoAntigo, AGORA)).toBe(
      true,
    )
    expect(precisaDeAnalise(conversa('2026-08-26T09:00:00Z'), comSucessoAntigo, AGORA)).toBe(
      false,
    )
  })

  it('done sem mensagem nova não é candidata', () => {
    expect(
      precisaDeAnalise(
        conversa('2026-08-26T09:00:00Z'),
        insight({
          status: 'done',
          janela_fim: '2026-08-26T10:00:00Z',
          analisado_em: '2026-08-26T10:00:00Z',
        }),
        AGORA,
      ),
    ).toBe(false)
  })

  it('done com mensagem nova respeita o throttle', () => {
    const base = {
      status: 'done',
      janela_fim: '2026-08-26T14:00:00Z',
    }
    const recemAnalisada = insight({
      ...base,
      analisado_em: new Date(AGORA - THROTTLE_MS / 2).toISOString(),
    })
    const analisadaHaTempo = insight({
      ...base,
      analisado_em: new Date(AGORA - THROTTLE_MS - 60_000).toISOString(),
    })
    const conversaComNovidade = conversa('2026-08-26T14:59:00Z')
    expect(precisaDeAnalise(conversaComNovidade, recemAnalisada, AGORA)).toBe(false)
    expect(precisaDeAnalise(conversaComNovidade, analisadaHaTempo, AGORA)).toBe(true)
  })
})
