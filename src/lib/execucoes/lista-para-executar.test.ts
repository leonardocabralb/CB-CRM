import { describe, expect, it } from 'vitest'

import {
  listaVazia,
  separarParaExecutar,
  type AutomacaoParaExecutar,
  type RoboParaExecutar,
} from './lista-para-executar'

function automacao(
  name: string,
  extra: Partial<AutomacaoParaExecutar> = {},
): AutomacaoParaExecutar {
  return {
    id: `a-${name}`,
    name,
    description: null,
    channel_ids: null,
    trigger_type: 'manual',
    is_active: true,
    ...extra,
  }
}

function robo(
  name: string,
  status: RoboParaExecutar['status'] = 'active',
): RoboParaExecutar {
  return { id: `r-${name}`, name, channel_id: null, status }
}

const nomesDasDesligadas = (l: ReturnType<typeof separarParaExecutar>) =>
  l.desligadas.map((d) => (d.tipo === 'automacao' ? d.automacao.name : d.robo.name))

describe('separarParaExecutar', () => {
  it('ligadas e ativos vão para cima; o resto para "Desligadas"', () => {
    const l = separarParaExecutar(
      [automacao('Boas-vindas'), automacao('Contrato fechado', { is_active: false })],
      [robo('Triagem'), robo('Menu antigo', 'draft')],
      '',
    )
    expect(l.automacoes.map((a) => a.name)).toEqual(['Boas-vindas'])
    expect(l.robos.map((r) => r.name)).toEqual(['Triagem'])
    expect(nomesDasDesligadas(l)).toEqual(['Contrato fechado', 'Menu antigo'])
  })

  it('só o booleano true liga: null vira desligada', () => {
    const l = separarParaExecutar([automacao('Sem flag', { is_active: null })], [], '')
    expect(l.automacoes).toEqual([])
    expect(nomesDasDesligadas(l)).toEqual(['Sem flag'])
  })

  it('rascunho e arquivado são desligados, com o status preservado', () => {
    const l = separarParaExecutar([], [robo('R1', 'draft'), robo('R2', 'archived')], '')
    expect(l.robos).toEqual([])
    expect(
      l.desligadas.map((d) => (d.tipo === 'robo' ? d.robo.status : null)),
    ).toEqual(['draft', 'archived'])
  })

  it('automações desligadas vêm antes dos robôs desligados, na ordem recebida', () => {
    const l = separarParaExecutar(
      [automacao('B', { is_active: false }), automacao('A', { is_active: false })],
      [robo('Z', 'draft')],
      '',
    )
    expect(nomesDasDesligadas(l)).toEqual(['B', 'A', 'Z'])
  })

  it('a régua do Asaas fica de fora, ligada ou não', () => {
    const l = separarParaExecutar(
      [
        automacao('Cobrança 5 dias', { trigger_type: 'asaas_cobranca_vencida' }),
        automacao('Vence hoje', {
          trigger_type: 'asaas_cobranca_vence_hoje',
          is_active: false,
        }),
      ],
      [],
      '',
    )
    expect(listaVazia(l)).toBe(true)
  })

  it('a "Situação mudou no Atlas" (1073) fica de fora, ligada ou não: só roda pela leitura do Atlas', () => {
    const l = separarParaExecutar(
      [
        automacao('Rescindido no Atlas', { trigger_type: 'atlas_situacao_mudou' }),
        automacao('Ativo no Atlas', { trigger_type: 'atlas_situacao_mudou', is_active: false }),
      ],
      [],
      '',
    )
    expect(listaVazia(l)).toBe(true)
  })

  it('a busca vale para os dois grupos, sem acento e aparada', () => {
    const l = separarParaExecutar(
      [
        automacao('Cobrança manual'),
        automacao('Contrato fechado', { is_active: false }),
        automacao('Contrato — lembrete'),
      ],
      [robo('Contratos', 'archived'), robo('Triagem')],
      '  CONTRATO ',
    )
    expect(l.automacoes.map((a) => a.name)).toEqual(['Contrato — lembrete'])
    expect(l.robos).toEqual([])
    expect(nomesDasDesligadas(l)).toEqual(['Contrato fechado', 'Contratos'])

    const semAcento = separarParaExecutar([automacao('Cobrança manual')], [], 'cobranca')
    expect(semAcento.automacoes).toHaveLength(1)
  })

  it('a busca que só acha desligada NÃO deixa a lista vazia', () => {
    const l = separarParaExecutar(
      [automacao('Boas-vindas'), automacao('Contrato fechado', { is_active: false })],
      [],
      'contrato',
    )
    expect(listaVazia(l)).toBe(false)
    expect(l.automacoes).toEqual([])
  })

  it('nada em nenhum grupo = vazia', () => {
    expect(listaVazia(separarParaExecutar([], [], ''))).toBe(true)
    expect(
      listaVazia(separarParaExecutar([automacao('A')], [robo('B', 'draft')], 'xyz')),
    ).toBe(true)
  })
})
