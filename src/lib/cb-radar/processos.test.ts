import { describe, it, expect } from 'vitest'
import { extrairNumerosDeProcesso } from './processos'

describe('extrairNumerosDeProcesso', () => {
  it('acha o número CNJ no meio da frase', () => {
    expect(
      extrairNumerosDeProcesso(
        'Doutor, meu processo 0012345-89.2024.8.26.0100 teve andamento?',
      ),
    ).toEqual(['0012345-89.2024.8.26.0100'])
  })

  it('acha mais de um e não repete', () => {
    const texto =
      'O 0012345-89.2024.8.26.0100 e o 7654321-01.2023.5.02.0011, sendo que o ' +
      '0012345-89.2024.8.26.0100 é o principal.'
    expect(extrairNumerosDeProcesso(texto)).toEqual([
      '0012345-89.2024.8.26.0100',
      '7654321-01.2023.5.02.0011',
    ])
  })

  it('não confunde telefone, CPF ou data', () => {
    expect(
      extrairNumerosDeProcesso(
        'Meu telefone é (11) 98765-4321, CPF 123.456.789-01, audiência em 12.05.2026.',
      ),
    ).toEqual([])
  })

  it('recusa formato incompleto', () => {
    expect(extrairNumerosDeProcesso('processo 12345-89.2024.8.26')).toEqual([])
  })
})
