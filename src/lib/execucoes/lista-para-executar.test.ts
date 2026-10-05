import { describe, expect, it } from 'vitest'

import { ABA_GERAL } from '@/lib/automations/areas'

import {
  contagemDasAbas,
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

describe('separarParaExecutar — área e favoritas (1079)', () => {
  const AREA_B = 'area-b'
  const AREA_T = 'area-t'
  const ids = new Set([AREA_B, AREA_T])
  const autos = [
    automacao('Boas-vindas'),
    automacao('Cobrança', { area_id: AREA_B }),
    automacao('Contrato', { area_id: AREA_B, is_active: false }),
    automacao('Rescisão', { area_id: AREA_T }),
    // Área apagada com a tela aberta (ou não lida): conta como "Geral".
    automacao('Órfã', { area_id: 'area-apagada' }),
  ]
  const robos = [robo('Triagem'), robo('Menu', 'draft')]

  it('sem aba ("Todas"), tudo aparece como antes, robôs incluídos', () => {
    const l = separarParaExecutar(autos, robos, '', { aba: null, idsDasAreas: ids })
    expect(l.automacoes.map((a) => a.name)).toEqual(['Boas-vindas', 'Cobrança', 'Rescisão', 'Órfã'])
    expect(l.robos.map((r) => r.name)).toEqual(['Triagem'])
    expect(nomesDasDesligadas(l)).toEqual(['Contrato', 'Menu'])
  })

  it('com uma aba, só as automações dela — e nenhum robô, nem desligado', () => {
    const l = separarParaExecutar(autos, robos, '', { aba: AREA_B, idsDasAreas: ids })
    expect(l.automacoes.map((a) => a.name)).toEqual(['Cobrança'])
    expect(l.robos).toEqual([])
    expect(nomesDasDesligadas(l)).toEqual(['Contrato'])
  })

  it('"Geral" pega as sem área e as de área que não está na lista', () => {
    const l = separarParaExecutar(autos, robos, '', { aba: ABA_GERAL, idsDasAreas: ids })
    expect(l.automacoes.map((a) => a.name)).toEqual(['Boas-vindas', 'Órfã'])
  })

  it('a favorita LIGADA sobe para o topo; a desligada fica em "Desligadas"', () => {
    const favoritas = new Set(['a-Rescisão', 'a-Contrato'])
    const l = separarParaExecutar(autos, [], '', { favoritas })
    expect(l.favoritas.map((a) => a.name)).toEqual(['Rescisão'])
    expect(l.automacoes.map((a) => a.name)).not.toContain('Rescisão')
    expect(nomesDasDesligadas(l)).toEqual(['Contrato'])
  })

  it('favoritas sem leitura (null) não sobem ninguém', () => {
    const l = separarParaExecutar(autos, [], '', { favoritas: null })
    expect(l.favoritas).toEqual([])
  })

  it('a favorita respeita a aba e a busca', () => {
    const favoritas = new Set(['a-Rescisão', 'a-Cobrança'])
    const naAba = separarParaExecutar(autos, [], '', { aba: AREA_B, idsDasAreas: ids, favoritas })
    expect(naAba.favoritas.map((a) => a.name)).toEqual(['Cobrança'])
    const naBusca = separarParaExecutar(autos, [], 'rescisao', { favoritas })
    expect(naBusca.favoritas.map((a) => a.name)).toEqual(['Rescisão'])
  })

  it('só uma favorita na lista NÃO é lista vazia', () => {
    const l = separarParaExecutar([automacao('A')], [], '', { favoritas: new Set(['a-A']) })
    expect(listaVazia(l)).toBe(false)
  })
})

describe('contagemDasAbas', () => {
  const areas = [
    { id: 'area-b', nome: 'B', posicao: 0 },
    { id: 'area-t', nome: 'T', posicao: 1 },
  ]

  it('conta o que cada aba mostraria com a busca de agora; "Todas" soma os robôs', () => {
    const { contagem, total } = contagemDasAbas(
      [
        automacao('Cobrança', { area_id: 'area-b' }),
        automacao('Contrato', { area_id: 'area-b', is_active: false }),
        automacao('Contrato T', { area_id: 'area-t' }),
        automacao('Boas-vindas'),
        automacao('Régua', { trigger_type: 'asaas_cobranca_vencida' }),
      ],
      [robo('Contratos'), robo('Triagem')],
      'contrato',
      areas,
    )
    expect(contagem.get('area-b')).toBe(1)
    expect(contagem.get('area-t')).toBe(1)
    expect(contagem.get(ABA_GERAL)).toBe(0)
    expect(total).toBe(3)
  })
})
