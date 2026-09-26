import { describe, expect, it } from 'vitest'

import {
  camposVigiados,
  lerAcoes,
  lerRegistrosDasAcoes,
  linkInventado,
  motivoDoPasso,
  motivoForaDaD5,
  registroDaRecusa,
  resolverAcoes,
  urlsDoTexto,
  type OpcoesDeAcao,
  type PassoDaAutomacao,
  type ReguaDaD5,
} from './acoes'

// ============================================================
// As AÇÕES junto com a resposta (F4, D28). O que estes testes seguram:
//  - o marcador NUNCA chega ao cliente (nem o malformado, nem o aberto);
//  - DEFAULT-DENY: só executa o que o servidor listou — tipo não liberado e
//    número fora da lista são recusados, e o id sai da opção, nunca do texto;
//  - a trava de link inventado compara URL INTEIRA;
//  - a régua da D5 atravessa `run_automation` com trava de ciclo.
// ============================================================

const OPCOES: OpcoesDeAcao = {
  mover_etapa: [
    { id: 'etapa-a', nome: 'Bancário · Proposta' },
    { id: 'etapa-b', nome: 'Bancário · Documentos' },
  ],
  etiquetar: [{ id: 'tag-vip', nome: 'VIP' }],
  preencher_campo: [{ id: 'campo-divida', nome: 'Tamanho da dívida' }],
  criar_tarefa: [{ id: 'membro-ana', nome: 'Ana' }],
  executar_automacao: [{ id: 'auto-1', nome: 'Boas-vindas' }],
}

describe('lerAcoes', () => {
  it('lê os marcadores do fim e devolve o texto LIMPO', () => {
    const r = lerAcoes('Pronto, já anotei!\n\n[[MOVER:2]]\n[[ETIQUETAR:1]]\n[[CAMPO:1=R$ 150 mil]]\n[[TAREFA:1=Ligar para a cliente]]')
    expect(r.texto).toBe('Pronto, já anotei!')
    expect(r.pedidas).toEqual([
      { tipo: 'mover_etapa', n: 2 },
      { tipo: 'etiquetar', n: 1 },
      { tipo: 'preencher_campo', n: 1, valor: 'R$ 150 mil' },
      { tipo: 'criar_tarefa', n: 1, valor: 'Ligar para a cliente' },
    ])
    expect(r.recusadas).toEqual([])
  })

  it('tolera espaço e caixa, como `lerPassagem`', () => {
    const r = lerAcoes('Ok [[ mover : 1 ]] e [[automacao:1]] [[ Tirar:3 ]]')
    expect(r.pedidas).toEqual([
      { tipo: 'mover_etapa', n: 1 },
      { tipo: 'executar_automacao', n: 1 },
      { tipo: 'tirar_etiqueta', n: 3 },
    ])
    expect(r.texto).toBe('Ok e')
  })

  it('⚠️ o marcador NUNCA fica no texto: malformado, desconhecido, PASSAR, HANDOFF e o aberto no fim', () => {
    const r = lerAcoes('Oi!\n[[MOVER:dois]]\n[[FOO:1]]\n[[PASSAR:1]]\n[[HANDOFF]]\n[[qualquer coisa\nem duas linhas]]\n[[CAMPO:1=cortad')
    expect(r.texto).toBe('Oi!')
    expect(r.texto).not.toContain('[[')
    expect(r.pedidas).toEqual([])
    // Só o marcador de AÇÃO com forma errada vira recusa.
    expect(r.recusadas).toEqual([{ tipo: 'mover_etapa', n: null, motivo: 'malformada' }])
  })

  it('valor vazio, longo demais ou número zero: malformada', () => {
    const longo = 'x'.repeat(501)
    const r = lerAcoes(`a [[CAMPO:1=]] [[CAMPO:1=${longo}]] [[TAREFA:1=   ]] [[MOVER:0]] [[TAREFA:1=${'y'.repeat(201)}]]`)
    expect(r.pedidas).toEqual([])
    expect(r.recusadas.map((x) => [x.tipo, x.motivo])).toEqual([
      ['preencher_campo', 'malformada'],
      ['preencher_campo', 'malformada'],
      ['criar_tarefa', 'malformada'],
      ['mover_etapa', 'malformada'],
      ['criar_tarefa', 'malformada'],
    ])
  })

  it('valor em várias linhas vira uma linha; `=` e `]` no valor ficam', () => {
    const r = lerAcoes('ok [[CAMPO:1=  a=b ]\n c ]]')
    expect(r.pedidas).toEqual([{ tipo: 'preencher_campo', n: 1, valor: 'a=b ] c' }])
  })

  it('teto de 10 ações por resposta: o que passa é recusado (`teto`)', () => {
    const r = lerAcoes(`ok ${Array.from({ length: 12 }, () => '[[ETIQUETAR:1]]').join(' ')}`)
    expect(r.pedidas).toHaveLength(10)
    expect(r.recusadas).toEqual([
      { tipo: 'etiquetar', n: 1, motivo: 'teto' },
      { tipo: 'etiquetar', n: 1, motivo: 'teto' },
    ])
  })

  it('texto só com marcadores fica vazio (o turno transfere)', () => {
    expect(lerAcoes('[[MOVER:1]]\n[[ETIQUETAR:1]]').texto).toBe('')
  })

  it('texto sem marcador passa intacto (menos as pontas)', () => {
    expect(lerAcoes('  Olá!\n\nComo posso ajudar?  ').texto).toBe('Olá!\n\nComo posso ajudar?')
  })
})

describe('resolverAcoes — default-deny', () => {
  it('número → id da OPÇÃO do servidor, com o nome', () => {
    const { aceitas, recusadas } = resolverAcoes(
      [
        { tipo: 'mover_etapa', n: 2 },
        { tipo: 'criar_tarefa', n: 1, valor: 'Ligar' },
      ],
      OPCOES,
    )
    expect(aceitas).toEqual([
      { tipo: 'mover_etapa', id: 'etapa-b', nome: 'Bancário · Documentos' },
      { tipo: 'criar_tarefa', id: 'membro-ana', nome: 'Ana', valor: 'Ligar' },
    ])
    expect(recusadas).toEqual([])
  })

  it('número fora da lista: recusada — nunca a opção "mais perto"', () => {
    const r = resolverAcoes([{ tipo: 'mover_etapa', n: 3 }], OPCOES)
    expect(r.aceitas).toEqual([])
    expect(r.recusadas).toEqual([{ tipo: 'mover_etapa', n: 3, motivo: 'fora_da_lista' }])
  })

  it('tipo não liberado (ou sem item): recusada', () => {
    const r = resolverAcoes(
      [
        { tipo: 'tirar_etiqueta', n: 1 },
        { tipo: 'etiquetar', n: 1 },
      ],
      { ...OPCOES, etiquetar: [] },
    )
    expect(r.aceitas).toEqual([])
    expect(r.recusadas.map((x) => x.motivo)).toEqual(['nao_liberada', 'nao_liberada'])
  })

  it('sem opções: tudo recusado', () => {
    expect(resolverAcoes([{ tipo: 'executar_automacao', n: 1 }], {}).aceitas).toEqual([])
  })

  it('repetidas colapsam; o mesmo campo fica com o ÚLTIMO valor; tarefas de títulos diferentes ficam', () => {
    const { aceitas } = resolverAcoes(
      [
        { tipo: 'etiquetar', n: 1 },
        { tipo: 'preencher_campo', n: 1, valor: '100' },
        { tipo: 'etiquetar', n: 1 },
        { tipo: 'preencher_campo', n: 1, valor: '150' },
        { tipo: 'criar_tarefa', n: 1, valor: 'A' },
        { tipo: 'criar_tarefa', n: 1, valor: 'A' },
        { tipo: 'criar_tarefa', n: 1, valor: 'B' },
      ],
      OPCOES,
    )
    expect(aceitas).toEqual([
      { tipo: 'etiquetar', id: 'tag-vip', nome: 'VIP' },
      { tipo: 'preencher_campo', id: 'campo-divida', nome: 'Tamanho da dívida', valor: '150' },
      { tipo: 'criar_tarefa', id: 'membro-ana', nome: 'Ana', valor: 'A' },
      { tipo: 'criar_tarefa', id: 'membro-ana', nome: 'Ana', valor: 'B' },
    ])
  })
})

describe('a trava de link inventado', () => {
  const PEDIDO = 'Instructions...\n- installment 1/3 — payment link: https://www.asaas.com/i/123.\nReschedule: https://calendly.com/r/abc'

  it('as URLs do texto, sem a pontuação e a formatação que encostam', () => {
    expect(urlsDoTexto('Pague em https://www.asaas.com/i/123. Ou *https://x.com/a*, ok?')).toEqual([
      'https://www.asaas.com/i/123',
      'https://x.com/a',
    ])
    expect(urlsDoTexto('sem link')).toEqual([])
  })

  it('link que veio do pedido (bloco, instruções) ou da conversa: passa', () => {
    expect(linkInventado('Segue: https://www.asaas.com/i/123', [PEDIDO])).toBe(false)
    expect(linkInventado('Remarque: https://calendly.com/r/abc.', [PEDIDO])).toBe(false)
    expect(linkInventado('É este? https://site.com/x', [PEDIDO, 'cliente: vi em https://site.com/x'])).toBe(false)
  })

  it('link que não veio de lugar nenhum: inventado', () => {
    expect(linkInventado('Pague aqui: https://www.asaas.com/i/999', [PEDIDO])).toBe(true)
  })

  it('⚠️ link CORTADO de um verdadeiro também é inventado (a comparação é por URL inteira)', () => {
    expect(linkInventado('https://www.asaas.com/i/12', [PEDIDO])).toBe(true)
  })

  it('sem link, nada a conferir', () => {
    expect(linkInventado('Olá!', [])).toBe(false)
  })
})

describe('a régua da D5 nas automações', () => {
  const REGUA: ReguaDaD5 = { etapasDeResultado: new Set(['etapa-ganho']), camposVigiados: new Set(['campo-data']) }
  const passo = (tipo: string, config: Record<string, unknown> = {}): PassoDaAutomacao => ({ tipo, config })

  it('cada passo fora da D5 tem o seu código', () => {
    expect(motivoDoPasso(passo('send_to_number'), REGUA)).toBe('send_to_number')
    expect(motivoDoPasso(passo('send_webhook'), REGUA)).toBe('send_webhook')
    expect(motivoDoPasso(passo('run_flow'), REGUA)).toBe('run_flow')
    expect(motivoDoPasso(passo('set_deal_status', { status: 'won' }), REGUA)).toBe('status_de_resultado')
    expect(motivoDoPasso(passo('set_deal_status', { status: 'lost' }), REGUA)).toBe('status_de_resultado')
    expect(motivoDoPasso(passo('move_deal_stage', { stage_id: 'etapa-ganho' }), REGUA)).toBe('etapa_de_resultado')
    expect(motivoDoPasso(passo('create_deal', { stage_id: 'etapa-ganho' }), REGUA)).toBe('etapa_de_resultado')
    expect(motivoDoPasso(passo('update_contact_field', { field: 'custom:campo-data' }), REGUA)).toBe('campo_vigiado')
  })

  it('o que fica dentro da D5 passa', () => {
    expect(motivoDoPasso(passo('send_message'), REGUA)).toBeNull()
    expect(motivoDoPasso(passo('set_deal_status', { status: 'open' }), REGUA)).toBeNull()
    expect(motivoDoPasso(passo('move_deal_stage', { stage_id: 'etapa-neutra' }), REGUA)).toBeNull()
    expect(motivoDoPasso(passo('update_contact_field', { field: 'custom:outro' }), REGUA)).toBeNull()
    expect(motivoDoPasso(passo('update_contact_field', { field: 'email' }), REGUA)).toBeNull()
    expect(motivoDoPasso(passo('add_tag'), REGUA)).toBeNull()
  })

  it('atravessa `run_automation`, com trava de ciclo', () => {
    const passos = new Map<string, PassoDaAutomacao[]>([
      ['a', [passo('add_tag'), passo('run_automation', { automation_id: 'b' })]],
      ['b', [passo('run_automation', { automation_id: 'a' }), passo('run_automation', { automation_id: 'c' })]],
      ['c', [passo('send_webhook')]],
      ['limpa', [passo('run_automation', { automation_id: 'limpa' }), passo('send_message')]],
    ])
    expect(motivoForaDaD5('a', passos, REGUA)).toBe('send_webhook')
    expect(motivoForaDaD5('limpa', passos, REGUA)).toBeNull()
    // Automação fora do mapa (outra conta, apagada) não é percorrida.
    expect(motivoForaDaD5('sumida', passos, REGUA)).toBeNull()
  })
})

describe('camposVigiados', () => {
  it('só lembrete LIGADO por campo (fonte ausente ou "campo")', () => {
    const vigiados = camposVigiados([
      { trigger_type: 'date_field_offset', is_active: true, trigger_config: { custom_field_id: 'c1' } },
      { trigger_type: 'date_field_offset', is_active: true, trigger_config: { fonte: 'campo', custom_field_id: 'c2' } },
      { trigger_type: 'date_field_offset', is_active: false, trigger_config: { custom_field_id: 'c3' } },
      { trigger_type: 'date_field_offset', is_active: true, trigger_config: { fonte: 'reuniao', custom_field_id: 'c4' } },
      { trigger_type: 'tag_added', is_active: true, trigger_config: { custom_field_id: 'c5' } },
      { trigger_type: 'date_field_offset', is_active: true, trigger_config: null },
    ])
    expect([...vigiados].sort()).toEqual(['c1', 'c2'])
  })
})

describe('o registro das ações do turno', () => {
  it('a recusa vira linha sem id, com o número pedido', () => {
    expect(registroDaRecusa({ tipo: 'mover_etapa', n: 7, motivo: 'fora_da_lista' })).toEqual({
      tipo: 'mover_etapa',
      alvo: { id: null, nome: '#7' },
      ok: false,
      erro: 'fora_da_lista',
    })
  })

  it('lê o que está guardado — parse, nunca `as`', () => {
    expect(lerRegistrosDasAcoes(null)).toBeNull()
    expect(lerRegistrosDasAcoes({})).toBeNull()
    expect(
      lerRegistrosDasAcoes([
        { tipo: 'etiquetar', alvo: { id: 't1', nome: 'VIP' }, ok: true },
        { tipo: 'mover_etapa', alvo: { id: null, nome: '#3' }, ok: false, erro: 'fora_da_lista' },
        { tipo: 'x' },
        'lixo',
      ]),
    ).toEqual([
      { tipo: 'etiquetar', alvo: { id: 't1', nome: 'VIP' }, ok: true },
      { tipo: 'mover_etapa', alvo: { id: null, nome: '#3' }, ok: false, erro: 'fora_da_lista' },
    ])
  })
})
