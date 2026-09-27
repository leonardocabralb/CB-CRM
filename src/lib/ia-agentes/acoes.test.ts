import { describe, expect, it } from 'vitest'

import {
  afirmaReuniaoMarcada,
  automacoesAlcancaveis,
  equipePrometida,
  camposVigiados,
  formatoDoCampo,
  lerAcoes,
  lerRegistrosDasAcoes,
  linkInventado,
  linksInventados,
  mesmoValorDoCampo,
  motivoDoPasso,
  nomeComOrigem,
  nomeDoConvidado,
  motivoForaDaD5,
  registroDaRecusa,
  resolverAcoes,
  reuniaoNaoMarcada,
  reuniaoPrometida,
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
//  - a trava da reunião prometida: o texto que afirma a reunião sem o
//    marcador (com horários oferecidos) é retido — e só ele;
//  - a régua da D5 atravessa `run_automation`, com trava de ciclo, e SÓ ele:
//    a cascata (automações da etapa e da etiqueta) não conta desde 27/09/2026;
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

  it.each(['[[TRANSFERIR]]', '[[ transferir ]]', '[[Transferir]]', '[TRANSFERIR]', '[ Transferir ]', '[[TRANSFERÍR]]', '[[TRANSFERIR: equipe]]'])(
    '⚠️ "responda e passe": %s é lido, SAI do texto e não é ação nem sentinela',
    (marcador) => {
      const r = lerAcoes(`Um especialista vai analisar o seu caso e te retorna por aqui.\n${marcador}`)
      expect(r.texto).toBe('Um especialista vai analisar o seu caso e te retorna por aqui.')
      expect(r.transferirDepois).toBe(true)
      expect(r.transferir).toBe(false)
      expect(r.pedidas).toEqual([])
      expect(r.recusadas).toEqual([])
    },
  )

  it('sem o marcador, `transferirDepois` é falso; "[Transferir o caso]" é texto; só o marcador deixa o texto vazio', () => {
    expect(lerAcoes('Olá! [[MOVER:1]]').transferirDepois).toBe(false)
    expect(lerAcoes('Veja [Transferir o caso] depois').texto).toBe('Veja [Transferir o caso] depois')
    expect(lerAcoes('Veja [Transferir o caso] depois').transferirDepois).toBe(false)
    const so = lerAcoes('[[TRANSFERIR]]')
    expect(so).toMatchObject({ texto: '', transferirDepois: true })
    // Com o sentinela junto, os dois ficam marcados — quem decide a precedência é o turno.
    expect(lerAcoes('Um momento [[HANDOFF]] [[TRANSFERIR]]')).toMatchObject({ transferir: true, transferirDepois: true })
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

describe('a EQUIPE PROMETIDA sem o [[TRANSFERIR]] (27/09)', () => {
  it('⚠️ as frases MEDIDAS (o modelo prometeu uma pessoa sem o marcador) disparam', () => {
    for (const t of [
      'Vou pedir para um de nossos especialistas analisar o seu caso e entrar em contato com você por aqui em breve.',
      'Obrigado pelas informações! Vou pedir para um especialista analisar o seu caso e te retornar por aqui.',
    ]) {
      expect(equipePrometida(t), t).toBe(true)
    }
  })

  it('as outras formas da promessa, em português e em inglês', () => {
    for (const t of [
      'Vou passar você para a nossa equipe.',
      'Vou encaminhar o seu caso para um advogado.',
      'Vou transferir o seu atendimento.',
      'Vou transferir você para um atendente.',
      'Vou chamar uma advogada para falar com você.',
      'Um especialista vai analisar o seu caso e te chamar por aqui.',
      'Nossa equipe vai entrar em contato em breve.',
      'Um de nossos advogados irá te retornar ainda hoje.',
      'Nossa equipe entrará em contato por aqui.',
      'A specialist will get back to you shortly.',
      'Our team will reach out to you here.',
      "I'll pass you to one of our lawyers.",
      'I will transfer you to our team now.',
    ]) {
      expect(equipePrometida(t), t).toBe(true)
    }
  })

  it('⚠️ a PASSAGEM explícita para a equipe dispara mesmo falando de reunião (Codex, #321); a análise NA reunião, não', () => {
    for (const t of [
      'Vou passar você para nossa equipe para remarcar sua reunião.',
      'Vou transferir o seu atendimento para um atendente, que vai remarcar a reunião.',
      'Vou chamar um advogado para confirmar a sua reunião.',
      "I'll pass you to our team to reschedule your meeting.",
    ]) {
      expect(equipePrometida(t), t).toBe(true)
    }
    for (const t of [
      'Na reunião de diagnóstico o advogado analisa as dívidas.',
      'Um especialista vai analisar o seu caso na reunião.',
      'Vou pedir para um especialista analisar o seu caso na reunião.',
    ]) {
      expect(equipePrometida(t), t).toBe(false)
    }
  })

  it('"quando" com o verbo no passado é fato (a mesma régua da reunião prometida); no futuro, condição', () => {
    expect(equipePrometida('Quando você mandou os documentos, nossa equipe vai analisar e te retornar por aqui.')).toBe(true)
    expect(equipePrometida('Quando você mandar os documentos, nossa equipe vai analisar e te retornar por aqui.')).toBe(false)
  })

  it('⚠️ quieta: negação, pergunta, condição, e a análise NA REUNIÃO (o caminho de quem qualificou)', () => {
    for (const t of [
      'Não vou pedir para um especialista agora: primeiro preciso de mais informações.',
      'Quer que eu chame um especialista?',
      'Quer que eu peça para um especialista entrar em contato?',
      'Posso pedir para um especialista te ligar?',
      'Se preferir, vou pedir para um especialista te ligar.',
      'Um especialista vai analisar o seu caso na reunião.',
      'Na reunião de diagnóstico o advogado analisa as dívidas e explica os caminhos.',
      'Na reunião, um de nossos advogados vai analisar suas dívidas e te orientar.',
      'A specialist will review your case in the meeting.',
      'Nossa equipe atende de segunda a sexta, das 9h às 18h.',
      'Obrigado! Qual é o valor aproximado da dívida?',
    ]) {
      expect(equipePrometida(t), t).toBe(false)
    }
  })
})

describe('a trava da REUNIÃO PROMETIDA (F5, 27/09)', () => {
  // Os textos MEDIDOS no Playground (2 de 6 gerações): a confirmação sem o marcador.
  const MEDIDOS = [
    'Perfeito! Sua reunião está confirmada para terça-feira, 29/09, às 15:15. A confirmação chega por e-mail.',
    'Pronto, sua reunião está agendada para terça 29/09 às 15:15!',
  ]

  it('⚠️ os textos medidos AFIRMAM a reunião', () => {
    for (const t of MEDIDOS) expect(afirmaReuniaoMarcada(t), t).toBe(true)
  })

  it('outras formas de afirmar: particípio + reunião ou horário/data, em português e em inglês', () => {
    for (const t of [
      'Tudo certo! Já deixei sua reunião marcada para amanhã às 10h.',
      'Reunião remarcada para quinta, 01/10, às 14:00.',
      'Agendado para terça às 15h30 ✅',
      'Sua reunião acabou de ser marcada para terça às 15:15.',
      'Sua reunião está confirmada para terça às 15:15, tudo bem?',
      'Your meeting is booked for Tuesday at 3:15 pm.',
      "Great, you're scheduled for Tuesday 29/09 at 15:15!",
      'Your meeting has been rescheduled to Thursday at 10:00.',
    ]) {
      expect(afirmaReuniaoMarcada(t), t).toBe(true)
    }
  })

  it('⚠️ a forma FINITA também afirma (Codex, #321): "marquei", "agendamos", "já está marcada", "ficou agendado", "I booked", "you\'re all set"', () => {
    for (const t of [
      'Pronto, marquei sua reunião para terça às 15:15.',
      'Agendei para terça, 29/09, às 15:15.',
      'Remarquei sua reunião para quinta às 10h.',
      'Reagendei para quinta às 10:00.',
      'Confirmei sua reunião de terça às 15:15.',
      'Reservei o horário das 15:15 de terça para você.',
      'Marcamos sua reunião para terça às 15:15!',
      'Agendamos para terça às 15:15.',
      'Remarcamos para quinta às 10h.',
      'Reagendamos para quinta às 10:00.',
      'Confirmamos sua reunião para terça às 15:15.',
      'Reservamos terça às 15:15 para você.',
      'Sua reunião já está marcada para terça às 15:15.',
      'Ficou agendado para terça às 15:15.',
      'Ficou marcada para terça às 15:15.',
      'I booked your meeting for Tuesday at 3:15 pm.',
      "I've scheduled you for Tuesday at 15:15.",
      'We booked Tuesday at 15:15 for you.',
      'I confirmed your meeting for Tuesday at 15:15.',
      'I rescheduled it to Thursday at 10:00.',
      "You're booked for Tuesday at 15:15.",
      "You're all set for Tuesday at 15:15!",
    ]) {
      expect(afirmaReuniaoMarcada(t), t).toBe(true)
    }
  })

  it('⚠️ "quando" com o verbo no PASSADO é fato, não condição (Codex, #321): a confirmação falsa dispara', () => {
    for (const t of [
      'Quando você confirmou o horário, marquei sua reunião para terça às 15:15.',
      'Depois que você escolheu o horário, agendei sua reunião para terça às 15:15.',
      'Assim que você me passou o e-mail, sua reunião ficou marcada para terça às 15:15.',
      'When you confirmed the time, I booked your meeting for Tuesday at 15:15.',
      'Once you chose Tuesday, I scheduled your meeting for 15:15.',
    ]) {
      expect(afirmaReuniaoMarcada(t), t).toBe(true)
    }
    // LIMITE ACEITO (Codex, #321): basta a forma e a âncora na mesma frase — erra
    // para o lado seguro (a resposta é retida e vai para gente).
    expect(afirmaReuniaoMarcada('Seu e-mail está confirmado para agendarmos sua reunião às 15:15.')).toBe(true)
    // O mesmo "quando" no futuro/presente continua condição: quieta.
    for (const t of [
      'Quando você confirmar o horário, sua reunião fica marcada para terça às 15:15.',
      'Quando você escolher, a reunião fica agendada para terça às 15:15.',
      'Quando o seu e-mail chegar, sua reunião fica confirmada para terça às 15:15.',
      'When you confirm the time, your meeting is booked for Tuesday at 15:15.',
      'Se você confirmou o e-mail, a reunião está marcada para terça às 15:15.',
    ]) {
      expect(afirmaReuniaoMarcada(t), t).toBe(false)
    }
  })

  it('⚠️ a forma finita NÃO afirma no futuro, na oferta, na pergunta, na condição ou na negação', () => {
    for (const t of [
      'Vou marcar para terça às 15:15.',
      'Vou marcar sua reunião para terça às 15:15 agora mesmo.',
      'Posso agendar para terça às 15:15?',
      'Quer que eu marque para terça às 15:15?',
      'Marcamos para terça às 15:15?',
      'Se preferir, marcamos para terça às 15:15.',
      'Assim que você me passar o e-mail, agendamos para terça às 15:15.',
      'Ainda não marquei: terça às 15:15 continua livre.',
      "I haven't booked it yet — Tuesday at 15:15 is still free.",
      "Once you confirm, you'll be all set for Tuesday at 15:15.",
      'I can book Tuesday at 15:15 if you like.',
    ]) {
      expect(afirmaReuniaoMarcada(t), t).toBe(false)
    }
  })

  it('⚠️ não afirma: pergunta, oferta, "podemos agendar", futuro, negação, condição, horário tomado, e-mail confirmado', () => {
    for (const t of [
      'Quer que eu marque para terça às 15:15?',
      'Temos horários na terça às 15:15 e na quarta às 10:00, podemos agendar',
      'Temos estes horários livres: terça às 15:15 ou quarta às 10:00. Qual fica melhor?',
      'Posso deixar agendado para terça às 15:15?',
      'Assim que você me passar o e-mail, deixo sua reunião agendada para terça às 15:15.',
      'Se preferir, a reunião pode ser marcada para terça às 15:15.',
      'A reunião será confirmada por e-mail.',
      'Sua reunião ainda não está marcada: escolha um dos horários.',
      'Para ser confirmada, a reunião precisa do seu e-mail.',
      'O horário das 15:15 já foi marcado por outra pessoa. Temos às 16:00.',
      'Seu e-mail foi confirmado! Agora é só escolher um dos horários.',
      'O pagamento da parcela 1/3 foi confirmado.',
      'The meeting will be scheduled once you confirm the time.',
      "Your meeting isn't booked yet — which time works for you, 15:15 or 16:00?",
      'Tuesday at 15:15 is confirmed?',
    ]) {
      expect(afirmaReuniaoMarcada(t), t).toBe(false)
    }
  })

  const HORARIO = [{ tipo: 'marcar_reuniao' as const }]

  it('retém quando houve horários oferecidos, o texto afirma e NENHUMA reunião foi aceita', () => {
    expect(reuniaoPrometida({ texto: MEDIDOS[0], horariosOferecidos: 5, aceitas: [] })).toBe(true)
    // Outra ação aceita (etiqueta, campo) não é a reunião.
    expect(reuniaoPrometida({ texto: MEDIDOS[1], horariosOferecidos: 5, aceitas: [{ tipo: 'etiquetar' }] })).toBe(true)
  })

  it('⚠️ COM o marcador (a reunião aceita): não dispara', () => {
    expect(reuniaoPrometida({ texto: MEDIDOS[0], horariosOferecidos: 5, aceitas: HORARIO })).toBe(false)
  })

  it('sem horários oferecidos neste turno (reunião desligada, leitura que falhou, cliente que JÁ tem reunião): não se aplica', () => {
    expect(reuniaoPrometida({ texto: 'Sua reunião está confirmada para terça às 15:15.', horariosOferecidos: 0, aceitas: [] })).toBe(false)
  })

  it('texto que não afirma: não dispara', () => {
    expect(reuniaoPrometida({ texto: 'Quer que eu marque para terça às 15:15?', horariosOferecidos: 5, aceitas: [] })).toBe(false)
  })
})

describe('a régua da D5 nas automações', () => {
  const REGUA: ReguaDaD5 = {
    etapasDeResultado: new Set(['etapa-ganho']),
    camposVigiados: new Set(['campo-data']),
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

  it('⚠️ "Aguardar" na automação EXECUTADA (ou na que ela aciona) tira da D5', () => {
    const passos = new Map<string, PassoDaAutomacao[]>([
      ['espera', [passo('send_message'), passo('wait', { amount: 1 })]],
      ['aciona-espera', [passo('run_automation', { automation_id: 'espera' })]],
    ])
    expect(motivoForaDaD5('espera', passos, REGUA)).toBe('aguardar')
    expect(motivoForaDaD5('aciona-espera', passos, REGUA)).toBe('aguardar')
  })

  it('⚠️ D5 só para o que o agente faz (27/09/2026): "Mover card" e "Adicionar etiqueta" NÃO puxam as automações da etapa ou da etiqueta', () => {
    // Mesmo que existam automações de etapa/etiqueta com webhook, outro número
    // ou "Aguardar": a régua não as conhece — elas rodam como quando gente
    // move o card ou etiqueta.
    const passos = new Map<string, PassoDaAutomacao[]>([
      ['move-e-etiqueta', [passo('move_deal_stage', { stage_id: 'etapa-x' }), passo('add_tag', { tag_id: 'tag-quente' })]],
      ['da-etapa-x', [passo('send_webhook'), passo('wait', { amount: 1 })]],
      ['da-tag-quente', [passo('send_to_number')]],
    ])
    expect(motivoForaDaD5('move-e-etiqueta', passos, REGUA)).toBeNull()
    expect(automacoesAlcancaveis(['move-e-etiqueta'], passos)).toEqual(new Set(['move-e-etiqueta']))
  })

  it('`automacoesAlcancaveis` segue só o `run_automation` (o leitor camada por camada)', () => {
    const passos = new Map<string, PassoDaAutomacao[]>([
      ['a', [passo('run_automation', { automation_id: 'b' }), passo('add_tag', { tag_id: 't' })]],
      ['b', [passo('run_automation', { automation_id: 'a' })]],
    ])
    expect(automacoesAlcancaveis(['a'], passos)).toEqual(new Set(['a', 'b']))
    // Sem os passos, a régua só conhece as raízes.
    expect(automacoesAlcancaveis(['x', 'y'], new Map())).toEqual(new Set(['x', 'y']))
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

  it('o MESMO valor já gravado (a ação repetida): aparado e sem caixa; a data pelo instante', () => {
    expect(mesmoValorDoCampo(' R$ 150 MIL ', 'R$ 150 mil', { tipo: 'texto' })).toBe(true)
    expect(mesmoValorDoCampo('Ana@X.com', 'ana@x.com', { tipo: 'email' })).toBe(true)
    expect(mesmoValorDoCampo('Bancário', 'Bancário', { tipo: 'lista', opcoes: ['Bancário'] })).toBe(true)
    // A mesma hora em outra forma (outro escritor gravou com offset): é a mesma.
    expect(mesmoValorDoCampo('2026-10-01T14:00:00-03:00', '2026-10-01T17:00:00.000Z', { tipo: 'data' })).toBe(true)
    expect(mesmoValorDoCampo('2026-10-01T17:00:00.000Z', '2026-10-02T17:00:00.000Z', { tipo: 'data' })).toBe(false)
    expect(mesmoValorDoCampo('R$ 150 mil', 'R$ 200 mil', { tipo: 'texto' })).toBe(false)
    // Sem valor gravado (ou vazio, ou não texto): não é o mesmo — grava.
    expect(mesmoValorDoCampo(undefined, 'x', { tipo: 'texto' })).toBe(false)
    expect(mesmoValorDoCampo('  ', 'x', { tipo: 'texto' })).toBe(false)
    expect(mesmoValorDoCampo(5, '5', { tipo: 'numero' })).toBe(false)
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

  it('o NOME completo, opcional, no marcador (`[[REUNIAO:n=Nome]]`): lido, e o texto sai limpo; vazio = sem nome, nunca recusa', () => {
    const r = lerAcoes('Marquei!\n[[REUNIAO:2= Maria   Aparecida\nSouza ]]')
    expect(r.texto).toBe('Marquei!')
    expect(r.pedidas).toEqual([{ tipo: 'marcar_reuniao', n: 2, valor: 'Maria Aparecida Souza' }])
    expect(r.recusadas).toEqual([])
    expect(lerAcoes('Ok [REUNIÃO:1=Ana Souza]').pedidas).toEqual([{ tipo: 'marcar_reuniao', n: 1, valor: 'Ana Souza' }])
    expect(lerAcoes('Ok [[REUNIAO:1=]]').pedidas).toEqual([{ tipo: 'marcar_reuniao', n: 1 }])
  })

  it('o nome vai com a reunião ACEITA só quando tem a forma de um nome — senão cai, e a reunião continua aceita', () => {
    const origem = { mensagensDoCliente: ['Sou a Maria Aparecida Souza'] }
    const r = (valor: string | undefined) =>
      resolverAcoes([{ tipo: 'marcar_reuniao', n: 1, ...(valor === undefined ? {} : { valor }) }], OPCOES, origem)
    expect(r('Maria Aparecida Souza')).toEqual({
      aceitas: [{ tipo: 'marcar_reuniao', id: '2026-09-28T18:15:00.000Z', nome: 'Mon 28/09 15:15', valor: 'Maria Aparecida Souza' }],
      recusadas: [],
    })
    for (const ruim of ['x', '12345', 'a'.repeat(121), '  ']) {
      expect(r(ruim), ruim).toEqual({
        aceitas: [{ tipo: 'marcar_reuniao', id: '2026-09-28T18:15:00.000Z', nome: 'Mon 28/09 15:15' }],
        recusadas: [],
      })
    }
    expect(nomeDoConvidado('  João  da   Silva ')).toBe('João da Silva')
    expect(nomeDoConvidado('Jo')).toBe('Jo')
    expect(nomeDoConvidado(null)).toBeNull()
  })

  it('⚠️ o nome só vai com ORIGEM (Codex, #321): o que o CLIENTE escreveu, ou o nome da ficha — senão cai, marcado `nomeSemOrigem`', () => {
    const H = { tipo: 'marcar_reuniao' as const, id: '2026-09-28T18:15:00.000Z', nome: 'Mon 28/09 15:15' }
    const cliente = ['oi, quero agendar', 'meu nome é joão PEREIRA da silva', 'Pode ser segunda']
    const r = (valor: string, nomeDaFicha: string | null = null, mensagens = cliente) =>
      resolverAcoes([{ tipo: 'marcar_reuniao', n: 1, valor }], OPCOES, { mensagensDoCliente: mensagens, nomeDaFicha }).aceitas
    // Digitado pelo cliente (caixa, acento e conectivo não importam).
    expect(r('João Pereira da Silva')).toEqual([{ ...H, valor: 'João Pereira da Silva' }])
    expect(r('Joao Pereira Silva')).toEqual([{ ...H, valor: 'Joao Pereira Silva' }])
    // Inventado pelo modelo (a equipe, um título): cai.
    expect(r('Dr. Silva')).toEqual([{ ...H, nomeSemOrigem: true }])
    // O primeiro nome na conversa e o sobrenome completado: cai.
    expect(r('João Pereira Santos')).toEqual([{ ...H, nomeSemOrigem: true }])
    // O nome atual da ficha também serve.
    expect(r('Ana Clara Souza', 'ana clara souza')).toEqual([{ ...H, valor: 'Ana Clara Souza' }])
    // Sem a origem (quem chama não passou a conversa): nenhum nome passa.
    expect(resolverAcoes([{ tipo: 'marcar_reuniao', n: 1, valor: 'João Pereira da Silva' }], OPCOES).aceitas).toEqual([
      { ...H, nomeSemOrigem: true },
    ])
    expect(nomeComOrigem('João da Silva', { mensagensDoCliente: ['JOÃO DA SILVA'] })).toBe(true)
    expect(nomeComOrigem('de da', { mensagensDoCliente: ['de da'] })).toBe(false)
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
