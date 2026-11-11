import { describe, expect, it } from 'vitest'
import { lerConfig } from './config.js'

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres'

describe('lerConfig', () => {
  it('lê o ambiente', () => {
    expect(
      lerConfig({
        LIGACOES_SEGREDO: SEGREDO,
        LIGACOES_COMPUTADOR: 'previdenciario',
        LIGACOES_URL_DO_CRM: 'http://crm.exemplo.test:3000/',
      }),
    ).toEqual({ segredo: SEGREDO, computador: 'previdenciario', urlDoCrm: 'http://crm.exemplo.test:3000' })
  })

  it('sem URL do CRM, os avisos ficam só no log', () => {
    expect(lerConfig({ LIGACOES_SEGREDO: SEGREDO, LIGACOES_COMPUTADOR: 'teste' }).urlDoCrm).toBeNull()
  })

  it('recusa segredo curto, nome inválido e URL que não é http', () => {
    expect(() => lerConfig({ LIGACOES_SEGREDO: 'curto', LIGACOES_COMPUTADOR: 'teste' })).toThrow('LIGACOES_SEGREDO')
    expect(() => lerConfig({ LIGACOES_SEGREDO: SEGREDO, LIGACOES_COMPUTADOR: 'Com Espaço' })).toThrow('LIGACOES_COMPUTADOR')
    expect(() =>
      lerConfig({ LIGACOES_SEGREDO: SEGREDO, LIGACOES_COMPUTADOR: 'teste', LIGACOES_URL_DO_CRM: 'ftp://x' }),
    ).toThrow('http')
    expect(() =>
      lerConfig({ LIGACOES_SEGREDO: SEGREDO, LIGACOES_COMPUTADOR: 'teste', LIGACOES_URL_DO_CRM: 'não é url' }),
    ).toThrow('endereço')
  })
})
