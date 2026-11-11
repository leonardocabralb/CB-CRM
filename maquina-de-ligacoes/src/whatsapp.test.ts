import { describe, expect, it } from 'vitest'
import { decidir, type Retrato } from './whatsapp.js'

// Retratos ESCRITOS À MÃO, no formato que a tela mostrou em 10/11/2026, com
// nomes fictícios: nunca a tela real copiada (ela tem nomes e mensagens de
// clientes).
const conectado = { conectado: true, qr: false }
const quadro = (texto: string, botoes: Partial<{ aceitar: boolean; desligar: boolean; opcoes: boolean }> = {}) => ({
  texto,
  aceitar: false,
  desligar: false,
  opcoes: false,
  ...botoes,
})

describe('o estado do WhatsApp', () => {
  it('conectado, QR ou carregando', () => {
    expect(decidir({ ...conectado, quadro: null }).estado).toBe('conectado')
    expect(decidir({ conectado: false, qr: true, quadro: null }).estado).toBe('qr')
    expect(decidir({ conectado: false, qr: false, quadro: null }).estado).toBe('carregando')
  })
})

describe('a fase da chamada', () => {
  const fase = (r: Retrato) => decidir(r).chamada

  it('sem quadro, nenhuma', () => {
    expect(fase({ ...conectado, quadro: null })).toEqual({ fase: 'nenhuma' })
  })

  it('a feita: ligando e chamando, até o cronômetro aparecer', () => {
    expect(fase({ ...conectado, quadro: quadro('Ligando… Ligação de voz', { desligar: true }) })).toEqual({ fase: 'chamando' })
    expect(fase({ ...conectado, quadro: quadro('Cliente Fictício Chamando…', { desligar: true }) })).toEqual({ fase: 'chamando' })
  })

  it('um horário no NOME não é o cronômetro (o cronômetro é o fim do texto)', () => {
    expect(fase({ ...conectado, quadro: quadro('Cliente reunião 14:30 Chamando…', { desligar: true }) })).toEqual({
      fase: 'chamando',
    })
    expect(fase({ ...conectado, quadro: quadro('Cliente reunião 14:30 0:07', { desligar: true }) })).toEqual({
      fase: 'em_curso',
    })
  })

  it('em curso: o cronômetro, ou as opções da ligação (o instante em que atende)', () => {
    expect(fase({ ...conectado, quadro: quadro('Cliente Fictício 0:00', { desligar: true }) })).toEqual({ fase: 'em_curso' })
    expect(fase({ ...conectado, quadro: quadro('Cliente Fictício 12:34', { desligar: true }) })).toEqual({ fase: 'em_curso' })
    expect(fase({ ...conectado, quadro: quadro('Cliente Fictício', { desligar: true, opcoes: true }) })).toEqual({
      fase: 'em_curso',
    })
  })

  it('a recebida tocando, com quem liga (sem o rodapé dos botões)', () => {
    expect(
      fase({ ...conectado, quadro: quadro('Cliente Fictício Ligação de voz Recusar Aceitar', { aceitar: true }) }),
    ).toEqual({ fase: 'tocando', quem: 'Cliente Fictício' })
    expect(
      fase({ ...conectado, quadro: quadro('+55 11 98765-4321 Ligação de voz Recusar Aceitar', { aceitar: true }) }),
    ).toEqual({ fase: 'tocando', quem: '+55 11 98765-4321' })
  })

  it('a tela de fim (a recusa também sai como "Não atendida")', () => {
    expect(fase({ ...conectado, quadro: quadro('Ligação encerrada') })).toEqual({ fase: 'encerrada', aviso: 'Ligação encerrada' })
    expect(fase({ ...conectado, quadro: quadro('Não atendida') })).toEqual({ fase: 'encerrada', aviso: 'Não atendida' })
  })
})
