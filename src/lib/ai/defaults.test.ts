import { describe, expect, it } from 'vitest'

import {
  AI_PROVIDER_DEFAULT_MODEL,
  AI_PROVIDER_MODELS,
  modeloRecomendado,
  opcoesDeModelo,
  type ModeloDaChave,
} from './defaults'

// ============================================================
// O modelo padrão e o seletor ligado à chave (25/10/2026).
// ============================================================

const m = (id: string, nome = id): ModeloDaChave => ({ id, nome })

describe('modelo padrão', () => {
  // Escolha do operador: o Haiku 5.5, id oficial SEM sufixo de data.
  it('a Anthropic abre no Haiku 5.5, e a família 5.5 é a recomendada', () => {
    expect(AI_PROVIDER_DEFAULT_MODEL.anthropic).toBe('claude-haiku-5-5')
    expect(AI_PROVIDER_MODELS.anthropic).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  })

  it('o padrão de cada provedor é o PRIMEIRO recomendado (trocar de provedor sem lista cai nele)', () => {
    for (const [provedor, padrao] of Object.entries(AI_PROVIDER_DEFAULT_MODEL)) {
      expect(AI_PROVIDER_MODELS[provedor as keyof typeof AI_PROVIDER_MODELS][0]).toBe(padrao)
    }
  })
})

describe('opcoesDeModelo — os recomendados que a chave tem, no topo', () => {
  it('recomendados na ordem de AI_PROVIDER_MODELS; o resto na ordem do provedor, sem repetir', () => {
    const daChave = [m('claude-opus-5-5', 'Claude Opus 5.5'), m('claude-3-haiku'), m('claude-haiku-5-5', 'Claude Haiku 5.5'), m('claude-3-haiku')]
    const { recomendados, outros } = opcoesDeModelo('anthropic', daChave)
    expect(recomendados.map((x) => x.id)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
    expect(outros.map((x) => x.id)).toEqual(['claude-3-haiku'])
    // O nome é o do provedor.
    expect(recomendados[0].nome).toBe('Claude Haiku 5.5')
  })

  it('recomendado que a chave NÃO tem não é oferecido', () => {
    const { recomendados } = opcoesDeModelo('anthropic', [m('claude-sonnet-5-5')])
    expect(recomendados.map((x) => x.id)).toEqual(['claude-sonnet-5-5'])
  })
})

describe('modeloRecomendado — ao trocar de provedor', () => {
  it('o primeiro recomendado que a chave tem', () => {
    expect(modeloRecomendado('anthropic', [m('claude-3-haiku'), m('claude-sonnet-5-5')])).toBe('claude-sonnet-5-5')
  })

  it('nenhum recomendado na chave: o primeiro da lista dela', () => {
    expect(modeloRecomendado('openai', [m('gpt-9'), m('gpt-8')])).toBe('gpt-9')
  })

  it('sem lista (carregando, falhou) ou lista vazia: o padrão do provedor', () => {
    expect(modeloRecomendado('gemini', null)).toBe(AI_PROVIDER_DEFAULT_MODEL.gemini)
    expect(modeloRecomendado('anthropic', [])).toBe('claude-haiku-5-5')
  })
})
