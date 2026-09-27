import { describe, expect, it } from 'vitest'

import { triggerMatches } from '@/lib/automations/engine'
import type { Automation } from '@/types'

import {
  automacoesAlcancaveis,
  automacoesDaEtapa,
  automacoesDaEtiqueta,
  camposVigiados,
  formatoDoCampo,
  gatilhosDaCascata,
  lerAcoes,
  lerRegistrosDasAcoes,
  linkInventado,
  linksInventados,
  motivoDaEtapa,
  motivoDaEtiqueta,
  motivoDoPasso,
  motivoForaDaD5,
  registroDaRecusa,
  resolverAcoes,
  reuniaoNaoMarcada,
  urlsDoTexto,
  valorDoCampo,
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
//  - a régua da D5 atravessa `run_automation` E a cascata (etapa, etiqueta),
//    com trava de ciclo; o "Aguardar" só conta na automação executada;
//  - o valor do campo cabe no formato (data, número, lista, e-mail).
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

  it('⚠️ marcador de ação com colchete SIMPLES, acento ou outra caixa também é lido — e sai do texto', () => {
    const r = lerAcoes('Feito!\n[MOVER:1]\n[[AUTOMAÇÃO:1]]\n[[Mover: 2]]\n[ Etiquetar : 1 ]\n[CAMPO:1=R$ 10]')
    expect(r.texto).toBe('Feito!')
    expect(r.pedidas).toEqual([
      { tipo: 'mover_etapa', n: 1 },
      { tipo: 'executar_automacao', n: 1 },
      { tipo: 'mover_etapa', n: 2 },
      { tipo: 'etiquetar', n: 1 },
      { tipo: 'preencher_campo', n: 1, valor: 'R$ 10' },
    ])
  })

  it('colchete simples que NÃO é marcador de ação fica no texto', () => {
    const r = lerAcoes('Veja [Obs: o prazo é sexta] e [1] ok')
    expect(r.texto).toBe('Veja [Obs: o prazo é sexta] e [1] ok')
    expect(r.pedidas).toEqual([])
  })

  it('`]` a mais no fim do marcador não sobra (`[[MOVER:1]]]`)', () => {
    const r = lerAcoes('Pronto [[MOVER:1]]] e [[ETIQUETAR:1]]]]')
    expect(r.texto).toBe('Pronto e')
    expect(r.pedidas).toEqual([
      { tipo: 'mover_etapa', n: 1 },
      { tipo: 'etiquetar', n: 1 },
    ])
  })

  it('as crases (e o bloco de código) que envolviam só o marcador saem', () => {
    expect(lerAcoes('Feito `[[MOVER:1]]` agora').texto).toBe('Feito agora')
    expect(lerAcoes('Feito\n```\n[[MOVER:1]]\n[[ETIQUETAR:1]]\n```').texto).toBe('Feito')
    // Crase com texto dentro fica.
    expect(lerAcoes('Use `codigo` [[MOVER:1]]').texto).toBe('Use `codigo`')
  })

  it('⚠️ um `[[` aberto ANTES de um marcador válido não engole o texto até ele', () => {
    const r = lerAcoes('Olá [[ tudo bem? Seu pedido está pronto.\n[[MOVER:1]]')
    expect(r.texto).toBe('Olá tudo bem? Seu pedido está pronto.')
    expect(r.pedidas).toEqual([{ tipo: 'mover_etapa', n: 1 }])
  })

  it('só o `[[` aberto no FIM é cortado (resposta cortada), e o `[NOME:` de ação aberto no fim também', () => {
    expect(lerAcoes('Ok! [[MOVER:1]]\n[[ETIQ').texto).toBe('Ok!')
    expect(lerAcoes('Ok!\n[CAMPO:1=cortad').texto).toBe('Ok!')
    expect(lerAcoes('Ok! [Obs: sem fim').texto).toBe('Ok! [Obs: sem fim')
  })

  it('⚠️ o sentinela escrito de outro jeito (`[[ handoff ]]`, `[[Handoff]]`, `[HANDOFF]`) = transferir', () => {
    for (const t of ['Um momento [[ handoff ]]', '[[Handoff]]', 'Vou chamar alguém. [HANDOFF]', '[[HANDOFF]] [[MOVER:1]]']) {
      const r = lerAcoes(t)
      expect(r.transferir, t).toBe(true)
      expect(r.texto).not.toMatch(/handoff/i)
    }
    expect(lerAcoes('Ok! [[MOVER:1]]').transferir).toBe(false)
  })

  it('`[PASSAR:n]` com colchete simples não é passagem (`lerPassagem`): sai do texto e TRANSFERE', () => {
    const r = lerAcoes('Vou te passar. [PASSAR:1]')
    expect(r.texto).toBe('Vou te passar.')
    expect(r.transferir).toBe(true)
    // O `[[PASSAR:n]]` de verdade só sai do texto: quem decide é `lerPassagem`.
    expect(lerAcoes('[[PASSAR:1]]').transferir).toBe(false)
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

  it('⚠️ aspas curvas e angulares não viram parte da URL', () => {
    expect(urlsDoTexto('O link é “https://x.com/a” e ‘https://x.com/b’ e «https://x.com/c».')).toEqual([
      'https://x.com/a',
      'https://x.com/b',
      'https://x.com/c',
    ])
  })

  it('⚠️ `www.` sem esquema também é link (e não o `www.` de um e-mail)', () => {
    expect(urlsDoTexto('Acesse www.site.com/pagar, ou escreva para joao@www.site.com')).toEqual(['www.site.com/pagar'])
    expect(linkInventado('Acesse www.golpe.com/boleto', [PEDIDO])).toBe(true)
    // O mesmo endereço do pedido, sem o esquema: não é inventado.
    expect(linkInventado('Acesse www.asaas.com/i/123!', [PEDIDO])).toBe(false)
  })

  it('`linksInventados` devolve os links como escritos, sem repetir', () => {
    expect(
      linksInventados('Veja “https://a.com/x” e https://www.asaas.com/i/123 e https://a.com/x.', [PEDIDO]),
    ).toEqual(['https://a.com/x'])
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
  const REGUA: ReguaDaD5 = {
    etapasDeResultado: new Set(['etapa-ganho']),
    camposVigiados: new Set(['campo-data']),
    cascata: { deEtapa: [], deEtiqueta: [] },
  }
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

  it('⚠️ "Aguardar" na automação EXECUTADA (ou na que ela aciona) tira da D5 — na cascata, não', () => {
    const regua: ReguaDaD5 = {
      ...REGUA,
      cascata: { deEtapa: [{ id: 'da-etapa', etapas: ['etapa-x'] }], deEtiqueta: [] },
    }
    const passos = new Map<string, PassoDaAutomacao[]>([
      ['espera', [passo('send_message'), passo('wait', { amount: 1 })]],
      ['aciona-espera', [passo('run_automation', { automation_id: 'espera' })]],
      ['move', [passo('move_deal_stage', { stage_id: 'etapa-x' })]],
      // A sequência da etapa tem "Aguardar": é da ETAPA, como quando gente move o card.
      ['da-etapa', [passo('send_message'), passo('wait', { amount: 1 })]],
    ])
    expect(motivoForaDaD5('espera', passos, regua)).toBe('aguardar')
    expect(motivoForaDaD5('aciona-espera', passos, regua)).toBe('aguardar')
    expect(motivoForaDaD5('move', passos, regua)).toBeNull()
    expect(motivoDaEtapa('etapa-x', passos, regua)).toBeNull()
  })

  describe('a CASCATA', () => {
    const regua: ReguaDaD5 = {
      ...REGUA,
      cascata: {
        deEtapa: [
          { id: 'na-proposta', etapas: ['etapa-proposta'] },
          { id: 'em-qualquer', etapas: [] },
        ],
        deEtiqueta: [
          { id: 'da-vip', etiqueta: 'tag-vip' },
          { id: 'da-quente', etiqueta: 'tag-quente' },
        ],
      },
    }

    it('a etapa: as automações que a entrada nela dispara (lista vazia = qualquer etapa)', () => {
      const passos = new Map<string, PassoDaAutomacao[]>([
        ['na-proposta', [passo('send_webhook')]],
        ['em-qualquer', [passo('send_message')]],
      ])
      expect(motivoDaEtapa('etapa-proposta', passos, regua)).toBe('send_webhook')
      expect(motivoDaEtapa('etapa-docs', passos, regua)).toBeNull()
      const qualquerFora = new Map([...passos, ['em-qualquer', [passo('send_to_number')]]])
      expect(motivoDaEtapa('etapa-docs', qualquerFora, regua)).toBe('send_to_number')
    })

    it('a etiqueta: as automações de `tag_added` DAQUELA etiqueta', () => {
      const passos = new Map<string, PassoDaAutomacao[]>([
        ['da-vip', [passo('set_deal_status', { status: 'won' })]],
        ['da-quente', [passo('send_message')]],
      ])
      expect(motivoDaEtiqueta('tag-vip', passos, regua)).toBe('status_de_resultado')
      expect(motivoDaEtiqueta('tag-quente', passos, regua)).toBeNull()
      expect(motivoDaEtiqueta('tag-sem-automacao', passos, regua)).toBeNull()
    })

    it('atravessa: etapa → etiqueta → run_automation → passo fora da D5, com ciclo no meio', () => {
      const passos = new Map<string, PassoDaAutomacao[]>([
        ['na-proposta', [passo('add_tag', { tag_id: 'tag-quente' })]],
        // A etiqueta move o card de volta para a proposta (ciclo) e aciona outra.
        [
          'da-quente',
          [passo('move_deal_stage', { stage_id: 'etapa-proposta' }), passo('run_automation', { automation_id: 'final' })],
        ],
        ['final', [passo('send_webhook')]],
      ])
      expect(motivoDaEtapa('etapa-proposta', passos, regua)).toBe('send_webhook')
      // A automação que a IA executa e que etiqueta: a cascata dela conta.
      const comEtiqueta = new Map([...passos, ['executa', [passo('add_tag', { tag_id: 'tag-quente' })]]])
      expect(motivoForaDaD5('executa', comEtiqueta, regua)).toBe('send_webhook')
      expect(automacoesAlcancaveis({ etapas: ['etapa-proposta'] }, passos, regua.cascata)).toEqual(
        new Set(['na-proposta', 'em-qualquer', 'da-quente', 'final']),
      )
    })

    it('`automacoesAlcancaveis` para onde falta ler (o leitor camada por camada)', () => {
      // Sem os passos de "na-proposta", a régua só conhece as sementes.
      expect(automacoesAlcancaveis({ etapas: ['etapa-proposta'], automacoes: ['x'] }, new Map(), regua.cascata)).toEqual(
        new Set(['x', 'na-proposta', 'em-qualquer']),
      )
    })
  })
})

describe('gatilhosDaCascata — a mesma leitura de `triggerMatches`', () => {
  const automacao = (id: string, trigger_type: string, trigger_config: unknown, is_active = true) =>
    ({ id, trigger_type, trigger_config, is_active }) as unknown as Automation & { trigger_config: unknown }

  const AUTOMACOES = [
    automacao('etapa-a', 'deal_stage_changed', { stage_ids: ['e1'] }),
    automacao('etapa-qualquer', 'deal_stage_changed', { stage_ids: [] }),
    automacao('etapa-sem-config', 'deal_stage_changed', {}),
    automacao('etapa-desligada', 'deal_stage_changed', { stage_ids: ['e1'] }, false),
    automacao('tag-vip', 'tag_added', { tag_id: 't1' }),
    automacao('tag-sem-config', 'tag_added', {}),
    automacao('mensagem', 'new_message_received', {}),
  ]

  it('concorda com o motor, etapa por etapa e etiqueta por etiqueta (só as ligadas)', () => {
    const cascata = gatilhosDaCascata(AUTOMACOES)
    for (const etapa of ['e1', 'e2']) {
      const motor = AUTOMACOES.filter(
        (a) => a.is_active && a.trigger_type === 'deal_stage_changed' && triggerMatches(a, { to_stage_id: etapa }),
      ).map((a) => a.id)
      expect(automacoesDaEtapa(etapa, cascata), etapa).toEqual(motor)
    }
    for (const etiqueta of ['t1', 't2']) {
      const motor = AUTOMACOES.filter(
        (a) => a.is_active && a.trigger_type === 'tag_added' && triggerMatches(a, { tag_id: etiqueta }),
      ).map((a) => a.id)
      expect(automacoesDaEtiqueta(etiqueta, cascata), etiqueta).toEqual(motor)
    }
    // Etiqueta sem `tag_id` o motor NUNCA dispara.
    expect(cascata.deEtiqueta.map((a) => a.id)).toEqual(['tag-vip'])
  })
})

describe('o formato do valor de um campo', () => {
  it('pela linha: o espelho do e-mail vence o tipo; data, número, lista, texto', () => {
    expect(formatoDoCampo({ field_type: 'text', espelho: 'contacts.email' })).toEqual({ tipo: 'email' })
    expect(formatoDoCampo({ field_type: 'datetime' })).toEqual({ tipo: 'data' })
    expect(formatoDoCampo({ field_type: 'number' })).toEqual({ tipo: 'numero' })
    expect(formatoDoCampo({ field_type: 'select', field_options: { opcoes: ['A', ' ', 'B', 3] } })).toEqual({
      tipo: 'lista',
      opcoes: ['A', 'B'],
    })
    expect(formatoDoCampo({ field_type: 'select', field_options: null })).toEqual({ tipo: 'lista', opcoes: [] })
    expect(formatoDoCampo({ field_type: 'text' })).toEqual({ tipo: 'texto' })
    expect(formatoDoCampo({ field_type: null })).toEqual({ tipo: 'texto' })
  })

  it('data: com fuso, o instante canônico; sem fuso, o dia (e a hora) no fuso do escritório', () => {
    expect(valorDoCampo('2026-10-01T14:00:00-03:00', { tipo: 'data' })).toBe('2026-10-01T17:00:00.000Z')
    expect(valorDoCampo('2026-10-01', { tipo: 'data' })).toBe('2026-10-01T03:00:00.000Z')
    expect(valorDoCampo('2026-10-01 14:30', { tipo: 'data' })).toBe('2026-10-01T17:30:00.000Z')
    expect(valorDoCampo('2026-10-01T14:30', { tipo: 'data' })).toBe('2026-10-01T17:30:00.000Z')
  })

  it('⚠️ data ilegível, dia que não existe ou hora fora do relógio: inválida', () => {
    for (const v of ['amanhã', '01/10/2026', '2026-09-31', '2026-02-29', '2026-10-01 25:00', '2026-13-01']) {
      expect(valorDoCampo(v, { tipo: 'data' }), v).toBeNull()
    }
  })

  it('número: só dígitos com ponto decimal', () => {
    expect(valorDoCampo(' 150000.50 ', { tipo: 'numero' })).toBe('150000.50')
    expect(valorDoCampo('-3', { tipo: 'numero' })).toBe('-3')
    for (const v of ['R$ 1.500', '1.500,00', '1,5', '150 mil', '1e3', '.5']) {
      expect(valorDoCampo(v, { tipo: 'numero' }), v).toBeNull()
    }
  })

  it('lista: uma das opções, sem caixa nem espaço nas pontas — grava a grafia da OPÇÃO', () => {
    const lista = { tipo: 'lista' as const, opcoes: ['Bancário', 'Trabalhista'] }
    expect(valorDoCampo('  bancário ', lista)).toBe('Bancário')
    expect(valorDoCampo('TRABALHISTA', lista)).toBe('Trabalhista')
    expect(valorDoCampo('Previdenciário', lista)).toBeNull()
    expect(valorDoCampo('bancario', lista)).toBeNull()
  })

  it('e-mail: a forma de um e-mail', () => {
    expect(valorDoCampo(' ana@x.com ', { tipo: 'email' })).toBe('ana@x.com')
    expect(valorDoCampo('ana arroba x', { tipo: 'email' })).toBeNull()
    expect(valorDoCampo('ana@x', { tipo: 'email' })).toBeNull()
  })

  it('texto: como veio (aparado); vazio nunca', () => {
    expect(valorDoCampo('  R$ 150 mil ', { tipo: 'texto' })).toBe('R$ 150 mil')
    expect(valorDoCampo('   ', { tipo: 'texto' })).toBeNull()
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
        { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' },
        { tipo: 'etiquetar', alvo: { id: 't2', nome: 'X' }, ok: false, erro: 'cascata_fora_da_d5', detalhe: 'send_webhook' },
        { tipo: 'x' },
        'lixo',
      ]),
    ).toEqual([
      { tipo: 'etiquetar', alvo: { id: 't1', nome: 'VIP' }, ok: true },
      { tipo: 'mover_etapa', alvo: { id: null, nome: '#3' }, ok: false, erro: 'fora_da_lista' },
      { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' },
      { tipo: 'etiquetar', alvo: { id: 't2', nome: 'X' }, ok: false, erro: 'cascata_fora_da_d5', detalhe: 'send_webhook' },
    ])
  })

  it('o `erro` de um registro ANTIGO (o motivo cru) passa como está — a tela o trata como genérico', () => {
    expect(
      lerRegistrosDasAcoes([
        { tipo: 'executar_automacao', alvo: { id: 'a', nome: 'A' }, ok: false, erro: 'automacao_fora_da_d5:send_webhook' },
        { tipo: 'etiquetar', alvo: { id: 't', nome: 'T' }, ok: true, detalhe: 7 },
      ]),
    ).toEqual([
      { tipo: 'executar_automacao', alvo: { id: 'a', nome: 'A' }, ok: false, erro: 'automacao_fora_da_d5:send_webhook' },
      { tipo: 'etiquetar', alvo: { id: 't', nome: 'T' }, ok: true },
    ])
  })
})

// ------------------------------------------------------------
// MARCAR REUNIÃO (F5): o marcador, uma por resposta, e "pedida e não marcada"
// ------------------------------------------------------------

describe('marcar reunião (F5)', () => {
  const OPCOES: OpcoesDeAcao = {
    marcar_reuniao: [
      { id: '2026-09-28T18:15:00.000Z', nome: 'Mon 28/09 15:15' },
      { id: '2026-09-29T13:00:00.000Z', nome: 'Tue 29/09 10:00' },
    ],
  }

  it.each(['[[REUNIAO:2]]', '[[REUNIÃO:2]]', '[[ reuniao : 2 ]]', '[REUNIÃO:2]', '[[Reunião:2]]'])(
    '⚠️ o marcador é lido em qualquer forma e NUNCA chega ao cliente: %s',
    (marcador) => {
      const r = lerAcoes(`Marquei para terça às 10h!\n${marcador}`)
      expect(r.texto).toBe('Marquei para terça às 10h!')
      expect(r.pedidas).toEqual([{ tipo: 'marcar_reuniao', n: 2 }])
    },
  )

  it('o marcador aberto no fim (resposta cortada) também sai', () => {
    expect(lerAcoes('Marquei! [[REUNIÃO:').texto).toBe('Marquei!')
    expect(lerAcoes('Marquei! [REUNIAO:1').texto).toBe('Marquei!')
  })

  it('número → o horário (ISO) que o SERVIDOR leu, com o texto exibido', () => {
    expect(resolverAcoes([{ tipo: 'marcar_reuniao', n: 2 }], OPCOES).aceitas).toEqual([
      { tipo: 'marcar_reuniao', id: '2026-09-29T13:00:00.000Z', nome: 'Tue 29/09 10:00' },
    ])
  })

  it('⚠️ default-deny: horário FORA da lista é recusado; sem horários oferecidos, `nao_liberada`', () => {
    expect(resolverAcoes([{ tipo: 'marcar_reuniao', n: 3 }], OPCOES)).toEqual({
      aceitas: [],
      recusadas: [{ tipo: 'marcar_reuniao', n: 3, motivo: 'fora_da_lista' }],
    })
    expect(resolverAcoes([{ tipo: 'marcar_reuniao', n: 1 }], {}).recusadas).toEqual([
      { tipo: 'marcar_reuniao', n: 1, motivo: 'nao_liberada' },
    ])
  })

  it('UMA reunião por resposta: o mesmo horário colapsa; um SEGUNDO horário é recusado (`teto`)', () => {
    const r = resolverAcoes(
      [
        { tipo: 'marcar_reuniao', n: 1 },
        { tipo: 'marcar_reuniao', n: 1 },
        { tipo: 'marcar_reuniao', n: 2 },
      ],
      OPCOES,
    )
    expect(r.aceitas).toEqual([{ tipo: 'marcar_reuniao', id: '2026-09-28T18:15:00.000Z', nome: 'Mon 28/09 15:15' }])
    expect(r.recusadas).toEqual([{ tipo: 'marcar_reuniao', n: 2, motivo: 'teto' }])
  })

  it('reuniaoNaoMarcada: pedida e nenhuma deu certo = o código; marcada ou não pedida = null', () => {
    const ok = { tipo: 'marcar_reuniao', alvo: { id: 'h', nome: 'x' }, ok: true }
    const falhou = { tipo: 'marcar_reuniao', alvo: { id: 'h', nome: 'x' }, ok: false, erro: 'sem_email' as const }
    const outra = { tipo: 'etiquetar', alvo: { id: 't', nome: 'VIP' }, ok: false, erro: 'falhou' as const }
    expect(reuniaoNaoMarcada(null)).toBeNull()
    expect(reuniaoNaoMarcada([outra])).toBeNull()
    expect(reuniaoNaoMarcada([falhou, outra])).toBe('sem_email')
    expect(reuniaoNaoMarcada([ok, { ...registroDaRecusa({ tipo: 'marcar_reuniao', n: 2, motivo: 'teto' }) }])).toBeNull()
    expect(reuniaoNaoMarcada([registroDaRecusa({ tipo: 'marcar_reuniao', n: 9, motivo: 'fora_da_lista' })])).toBe('fora_da_lista')
  })
})
