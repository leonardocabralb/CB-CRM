import { describe, expect, it } from 'vitest'

import {
  agruparItens,
  catalogoDoTipo,
  itensDoTipo,
  lerAcoesDoTurno,
  lerAcoesSimuladas,
  lerHorariosOferecidos,
  lerOpcoes,
  situacaoDaReuniao,
  TETO_DO_POSTGREST,
} from './ferramentas'
import type { OpcoesDasFerramentas } from './tipos'

const OPCOES: OpcoesDasFerramentas = {
  etapas: [
    { id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: null, foraDaD5: null },
    // Ganho E cascata: o motivo mostrado é o do ganho.
    { id: 'e2', nome: 'Contrato Fechado', funil: 'Comercial', resultado: 'ganho', foraDaD5: 'send_webhook' },
    { id: 'e3', nome: 'Triagem', funil: 'Jurídico', resultado: null, foraDaD5: null },
    { id: 'e4', nome: 'Perdido', funil: 'Comercial', resultado: 'perdido', foraDaD5: null },
    // A cascata: uma automação que dispara ao entrar na etapa manda para outro número.
    { id: 'e5', nome: 'Reunião Agendada', funil: 'Comercial', resultado: null, foraDaD5: 'send_to_number' },
  ],
  etiquetas: [
    { id: 't1', nome: 'VIP', foraDaD5: { etiquetar: null, tirar: null } },
    { id: 't2', nome: 'Contrato', foraDaD5: { etiquetar: 'send_webhook', tirar: null } },
    { id: 't3', nome: '-150k', foraDaD5: { etiquetar: null, tirar: 'status_de_resultado' } },
  ],
  campos: [
    { id: 'c1', nome: 'Tamanho da dívida', vigiado: false, tipo: 'number', opcoes: [] },
    { id: 'c2', nome: 'Data e Hora Reunião', vigiado: true, tipo: 'datetime', opcoes: [] },
    { id: 'c3', nome: 'Área', vigiado: false, tipo: 'select', opcoes: ['Bancário', 'Trabalhista'] },
  ],
  membros: [{ userId: 'u1', nome: 'Ana' }],
  automacoes: [
    { id: 'a1', nome: 'Boas-vindas', foraDaD5: null },
    { id: 'a2', nome: 'Aviso ao advogado', foraDaD5: 'send_to_number' },
    { id: 'a3', nome: 'Recuperação de No Show', foraDaD5: 'aguardar' },
  ],
  calendly: 'conectado',
  tiposDeEvento: [
    { uri: 'https://api.calendly.com/event_types/abc', nome: 'Reunião inicial', duracao: 30 },
    { uri: 'https://api.calendly.com/event_types/def', nome: 'Retorno', duracao: 15 },
  ],
}

describe('lerOpcoes — a resposta de …/ferramentas/opcoes', () => {
  it('a forma do contrato passa inteira', () => {
    expect(lerOpcoes(JSON.parse(JSON.stringify(OPCOES)))).toEqual(OPCOES)
  })

  it('lista ausente = a carga falhou (null), nunca "a conta não tem"', () => {
    expect(lerOpcoes({ ...OPCOES, automacoes: undefined })).toBeNull()
    expect(lerOpcoes(null)).toBeNull()
    expect(lerOpcoes([])).toBeNull()
  })

  it('item com forma estranha sai; o bloqueio só existe com o valor exato', () => {
    const lida = lerOpcoes({
      ...OPCOES,
      etapas: [{ id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: 'ganhou', foraDaD5: '  ' }, { id: 7 }],
      etiquetas: [
        { id: 't1', nome: 'VIP' },
        { id: 't2', nome: 'Y', foraDaD5: { etiquetar: 5, tirar: 'run_flow' } },
      ],
      campos: [{ id: 'c1', nome: 'X', vigiado: 'true', opcoes: ['a', 3] }],
      automacoes: [{ id: 'a1', nome: 'A', foraDaD5: '' }],
    })
    expect(lida?.etapas).toEqual([{ id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: null, foraDaD5: null }])
    // Cascata ausente ou com forma estranha não inventa bloqueio.
    expect(lida?.etiquetas).toEqual([
      { id: 't1', nome: 'VIP', foraDaD5: { etiquetar: null, tirar: null } },
      { id: 't2', nome: 'Y', foraDaD5: { etiquetar: null, tirar: 'run_flow' } },
    ])
    // Tipo ausente = nulo (a tela não mostra rótulo); opção que não é texto sai.
    expect(lida?.campos).toEqual([{ id: 'c1', nome: 'X', vigiado: false, tipo: null, opcoes: ['a'] }])
    expect(lida?.automacoes).toEqual([{ id: 'a1', nome: 'A', foraDaD5: null }])
  })
})

describe('lerOpcoes — o Calendly de "Marcar reunião" (F5)', () => {
  const tipo = { uri: 'https://api.calendly.com/event_types/abc', nome: 'Reunião inicial', duracao: 30 }

  it('desconectado: a lista não vale, mesmo que venha', () => {
    expect(lerOpcoes({ ...OPCOES, calendly: 'desconectado', tiposDeEvento: [tipo] })).toMatchObject({
      calendly: 'desconectado',
      tiposDeEvento: null,
    })
  })

  it('estado ausente (servidor anterior à F5) ou estranho = falhou, nunca desconectado', () => {
    const semCalendly: Record<string, unknown> = { ...OPCOES }
    delete semCalendly.calendly
    delete semCalendly.tiposDeEvento
    expect(lerOpcoes(semCalendly)).toMatchObject({ calendly: 'falhou', tiposDeEvento: null })
    expect(lerOpcoes({ ...OPCOES, calendly: 'ok' })).toMatchObject({ calendly: 'falhou', tiposDeEvento: null })
    expect(lerOpcoes({ ...OPCOES, calendly: 'falhou', tiposDeEvento: [tipo] })).toMatchObject({
      calendly: 'falhou',
      tiposDeEvento: null,
    })
  })

  it('conectado sem a lista legível = falhou (lista vazia afirmaria "não há tipos")', () => {
    expect(lerOpcoes({ ...OPCOES, tiposDeEvento: null })).toMatchObject({ calendly: 'falhou', tiposDeEvento: null })
    expect(lerOpcoes({ ...OPCOES, tiposDeEvento: 'x' })).toMatchObject({ calendly: 'falhou', tiposDeEvento: null })
  })

  it('conectado com a lista vazia é resposta: o Calendly não tem tipo ativo', () => {
    expect(lerOpcoes({ ...OPCOES, tiposDeEvento: [] })).toMatchObject({ calendly: 'conectado', tiposDeEvento: [] })
  })

  it('tipo sem uri sai; duração ilegível vira 0 (a tela omite os minutos)', () => {
    expect(
      lerOpcoes({
        ...OPCOES,
        tiposDeEvento: [{ nome: 'Sem uri', duracao: 30 }, { ...tipo, duracao: '30' }, { ...tipo, duracao: -5 }],
      })?.tiposDeEvento,
    ).toEqual([
      { ...tipo, duracao: 0 },
      { ...tipo, duracao: 0 },
    ])
  })
})

describe('itensDoTipo — a lista de cada tipo de ação', () => {
  it('etapas: agrupadas pelo funil; as de ganho/perdido e as de cascata fora da D5 bloqueadas', () => {
    const itens = itensDoTipo(OPCOES, 'mover_etapa')
    expect(itens.map((i) => [i.id, i.grupo, i.bloqueio])).toEqual([
      ['e1', 'Comercial', null],
      // Ganho vence a cascata.
      ['e2', 'Comercial', { tipo: 'etapa_de_resultado' }],
      ['e3', 'Jurídico', null],
      ['e4', 'Comercial', { tipo: 'etapa_de_resultado' }],
      ['e5', 'Comercial', { tipo: 'cascata', gatilho: 'etapa', codigo: 'send_to_number' }],
    ])
  })

  it('agruparItens junta pelo PRIMEIRO aparecimento do funil, sem repetir o grupo', () => {
    const grupos = agruparItens(itensDoTipo(OPCOES, 'mover_etapa'))
    expect(grupos.map((g) => [g.grupo, g.itens.map((i) => i.id)])).toEqual([
      ['Comercial', ['e1', 'e2', 'e4', 'e5']],
      ['Jurídico', ['e3']],
    ])
  })

  it('etiquetar e tirar etiqueta: o mesmo catálogo, cada lista com a SUA cascata', () => {
    const aplicar = itensDoTipo(OPCOES, 'etiquetar')
    const tirar = itensDoTipo(OPCOES, 'tirar_etiqueta')
    expect(aplicar.map((i) => i.id)).toEqual(tirar.map((i) => i.id))
    expect(aplicar.map((i) => i.bloqueio)).toEqual([
      null,
      { tipo: 'cascata', gatilho: 'etiquetar', codigo: 'send_webhook' },
      null,
    ])
    expect(tirar.map((i) => i.bloqueio)).toEqual([
      null,
      null,
      { tipo: 'cascata', gatilho: 'tirar', codigo: 'status_de_resultado' },
    ])
  })

  it('campo vigiado e automação fora da D5 (ou com "Aguardar") vêm bloqueados, com o código do passo', () => {
    expect(itensDoTipo(OPCOES, 'preencher_campo').map((i) => i.bloqueio)).toEqual([
      null,
      { tipo: 'campo_vigiado' },
      null,
    ])
    expect(itensDoTipo(OPCOES, 'executar_automacao').map((i) => i.bloqueio)).toEqual([
      null,
      { tipo: 'fora_da_d5', codigo: 'send_to_number' },
      { tipo: 'fora_da_d5', codigo: 'aguardar' },
    ])
  })

  it('campos levam o tipo e as opções (a tela mostra ao lado do nome); as outras listas, não', () => {
    expect(itensDoTipo(OPCOES, 'preencher_campo').map((i) => i.campo)).toEqual([
      { tipo: 'number', opcoes: [] },
      { tipo: 'datetime', opcoes: [] },
      { tipo: 'select', opcoes: ['Bancário', 'Trabalhista'] },
    ])
    expect(itensDoTipo(OPCOES, 'etiquetar').every((i) => i.campo === undefined)).toBe(true)
  })

  it('membros: o id é o userId (quem recebe a tarefa)', () => {
    expect(itensDoTipo(OPCOES, 'criar_tarefa')).toEqual([{ id: 'u1', nome: 'Ana', grupo: null, bloqueio: null }])
  })
})

describe('lerAcoesSimuladas — as ações do Playground', () => {
  it('lê aceitas e recusadas', () => {
    const v = {
      aceitas: [{ tipo: 'mover_etapa', nome: 'Proposta' }],
      recusadas: [{ tipo: 'etiquetar', motivo: 'fora_da_lista' }],
    }
    expect(lerAcoesSimuladas(v)).toEqual(v)
  })

  it('o valor (campo, tarefa) vem junto; vazio ou não-texto = sem valor', () => {
    expect(
      lerAcoesSimuladas({
        aceitas: [
          { tipo: 'criar_tarefa', nome: 'Ana', valor: 'Ligar amanhã' },
          { tipo: 'preencher_campo', nome: 'Tamanho da dívida', valor: '  ' },
          { tipo: 'preencher_campo', nome: 'X', valor: 200 },
        ],
        recusadas: [],
      })?.aceitas,
    ).toEqual([
      { tipo: 'criar_tarefa', nome: 'Ana', valor: 'Ligar amanhã' },
      { tipo: 'preencher_campo', nome: 'Tamanho da dívida' },
      { tipo: 'preencher_campo', nome: 'X' },
    ])
  })

  it('forma estranha ou ausente = undefined (nada é mostrado)', () => {
    expect(lerAcoesSimuladas(undefined)).toBeUndefined()
    expect(lerAcoesSimuladas({ aceitas: [] })).toBeUndefined()
    expect(lerAcoesSimuladas('x')).toBeUndefined()
  })
})

describe('lerAcoesDoTurno — cb_ia_turnos.acoes', () => {
  it('lê ok e falha, com o erro e o detalhe só quando há texto', () => {
    expect(
      lerAcoesDoTurno([
        { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' },
        { tipo: 'etiquetar', alvo: { id: null, nome: 'VIP' }, ok: false, erro: 'banco' },
        { tipo: 'criar_tarefa', alvo: { id: 'u1', nome: 'Ana' }, ok: true, erro: '  ', detalhe: '' },
        {
          tipo: 'executar_automacao',
          alvo: { id: 'a1', nome: 'Aviso' },
          ok: false,
          erro: 'automacao_fora_da_d5',
          detalhe: 'send_webhook',
        },
      ]),
    ).toEqual([
      { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' },
      { tipo: 'etiquetar', alvo: { id: null, nome: 'VIP' }, ok: false, erro: 'banco' },
      { tipo: 'criar_tarefa', alvo: { id: 'u1', nome: 'Ana' }, ok: true },
      {
        tipo: 'executar_automacao',
        alvo: { id: 'a1', nome: 'Aviso' },
        ok: false,
        erro: 'automacao_fora_da_d5',
        detalhe: 'send_webhook',
      },
    ])
  })

  it('turno antigo (null) ou forma estranha = null; item estranho sai sem quebrar a lista', () => {
    expect(lerAcoesDoTurno(null)).toBeNull()
    expect(lerAcoesDoTurno({})).toBeNull()
    expect(lerAcoesDoTurno([{ tipo: 'mover_etapa', ok: true }, { tipo: 'x', alvo: { nome: 'y' }, ok: true }])).toEqual([
      { tipo: 'x', alvo: { id: null, nome: 'y' }, ok: true },
    ])
  })
})

describe('lerHorariosOferecidos — os horários do Playground (F5)', () => {
  it('lê o número e o texto, como foram ao modelo', () => {
    const v = [
      { n: 1, texto: 'Mon 28/09 15:15' },
      { n: 2, texto: 'Mon 28/09 15:45' },
    ]
    expect(lerHorariosOferecidos(v)).toEqual(v)
  })

  it('ausente ou nulo (tipo desligado, leitura que falhou) = null; lista vazia é resposta', () => {
    expect(lerHorariosOferecidos(undefined)).toBeNull()
    expect(lerHorariosOferecidos(null)).toBeNull()
    expect(lerHorariosOferecidos({})).toBeNull()
    expect(lerHorariosOferecidos([])).toEqual([])
  })

  it('item estranho sai sem quebrar a lista', () => {
    expect(
      lerHorariosOferecidos([
        { n: '1', texto: 'a' },
        { n: 0, texto: 'b' },
        { n: 1.5, texto: 'c' },
        { n: 2, texto: '  ' },
        { n: 3, texto: 'Tue 29/09 10:00' },
        'x',
      ]),
    ).toEqual([{ n: 3, texto: 'Tue 29/09 10:00' }])
  })
})

describe('situacaoDaReuniao — a seção "Marcar reunião" (F5)', () => {
  const ABC = 'https://api.calendly.com/event_types/abc'
  const DEF = 'https://api.calendly.com/event_types/def'

  it('desconectado e falha de leitura são estados PRÓPRIOS, nunca lista vazia', () => {
    expect(situacaoDaReuniao({ ...OPCOES, calendly: 'desconectado', tiposDeEvento: null }, [ABC])).toEqual({
      fase: 'desconectado',
    })
    expect(situacaoDaReuniao({ ...OPCOES, calendly: 'falhou', tiposDeEvento: null }, [])).toEqual({ fase: 'falhou' })
    // Conectado sem a lista (não deveria chegar aqui: `lerOpcoes` já o lê como falha).
    expect(situacaoDaReuniao({ ...OPCOES, tiposDeEvento: null }, [])).toEqual({ fase: 'falhou' })
  })

  it('conectado sem tipo ativo: a resposta do Calendly, não uma falha', () => {
    expect(situacaoDaReuniao({ ...OPCOES, tiposDeEvento: [] }, [ABC])).toEqual({ fase: 'sem_tipos' })
  })

  it('escolher: o marcado ativo vem escolhido; nada marcado = sem escolha, sem órfão', () => {
    expect(situacaoDaReuniao(OPCOES, [DEF])).toEqual({
      fase: 'escolher',
      tipos: OPCOES.tiposDeEvento,
      escolhido: DEF,
      orfao: false,
    })
    expect(situacaoDaReuniao(OPCOES, [])).toMatchObject({ escolhido: null, orfao: false })
  })

  it('o tipo salvo que saiu dos ativos (desativado, apagado) é ÓRFÃO: sem escolha, e a tela diz por quê', () => {
    expect(situacaoDaReuniao(OPCOES, ['https://api.calendly.com/event_types/velho'])).toMatchObject({
      escolhido: null,
      orfao: true,
    })
    // Entre vários (não deveria haver), vale o primeiro que ainda existe.
    expect(situacaoDaReuniao(OPCOES, ['https://api.calendly.com/event_types/velho', ABC])).toMatchObject({
      escolhido: ABC,
      orfao: false,
    })
  })
})

describe('catalogoDoTipo — o que PROVA que um item marcado sumiu', () => {
  it('as listas da conta: o catálogo inteiro; cortada pelo teto do PostgREST, nenhuma prova', () => {
    expect(catalogoDoTipo(OPCOES, 'etiquetar')).toEqual(new Set(['t1', 't2', 't3']))
    const muitas = Array.from({ length: TETO_DO_POSTGREST }, (_, i) => ({ id: `a${i}`, nome: 'A', foraDaD5: null }))
    expect(catalogoDoTipo({ ...OPCOES, automacoes: muitas }, 'executar_automacao')).toBeNull()
  })

  it('"Marcar reunião": os tipos ATIVOS; desconectado ou sem leitura, nenhuma prova (nada é podado)', () => {
    expect(catalogoDoTipo(OPCOES, 'marcar_reuniao')).toEqual(
      new Set(['https://api.calendly.com/event_types/abc', 'https://api.calendly.com/event_types/def']),
    )
    expect(catalogoDoTipo({ ...OPCOES, calendly: 'desconectado', tiposDeEvento: null }, 'marcar_reuniao')).toBeNull()
    expect(catalogoDoTipo({ ...OPCOES, calendly: 'falhou', tiposDeEvento: null }, 'marcar_reuniao')).toBeNull()
    // Conectado sem tipo ativo É prova: o marcado sumiu.
    expect(catalogoDoTipo({ ...OPCOES, tiposDeEvento: [] }, 'marcar_reuniao')).toEqual(new Set())
  })

  it('itensDoTipo da reunião: os tipos de evento, pela uri; sem Calendly legível, nenhum', () => {
    expect(itensDoTipo(OPCOES, 'marcar_reuniao').map((i) => [i.id, i.nome])).toEqual([
      ['https://api.calendly.com/event_types/abc', 'Reunião inicial'],
      ['https://api.calendly.com/event_types/def', 'Retorno'],
    ])
    expect(itensDoTipo({ ...OPCOES, calendly: 'falhou', tiposDeEvento: null }, 'marcar_reuniao')).toEqual([])
  })
})
