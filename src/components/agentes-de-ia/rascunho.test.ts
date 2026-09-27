import { describe, expect, it } from 'vitest'

import {
  acessoMudou,
  acessoParaSalvar,
  alteracoesDoRascunho,
  ferramentasDoRascunho,
  ferramentasMudaram,
  ferramentasParaSalvar,
  lerTeto,
  listaDaFerramenta,
  rascunhoDasFerramentas,
  type Rascunho,
} from './rascunho'
import { TIPOS_DE_ACAO, type AcessoDoAgente, type FerramentasDoAgente, type IaAgente } from './tipos'

const SALVO: IaAgente = {
  id: 'a1',
  accountId: 'c1',
  nome: 'Triagem',
  descricao: 'Recebe o lead',
  instrucoes: 'Você é a triagem.',
  regras: ['Nunca prometa prazo.', 'Sempre peça o nome.'],
  provedor: 'gemini',
  modelo: 'gemini-3.7-flash',
  ativo: false,
  conexoes: ['x', 'y'],
  horario: { dias: [1, 2, 3], inicio: '08:00', fim: '18:00' },
  tetoRespostas: 10,
  podePassarPara: ['b', 'c'],
  transferirPara: 'membro-que-saiu',
  ativadoEm: '2026-09-25T00:00:00Z',
  etapas: [
    { stageId: 'e1', pipelineId: 'f1', desde: '2026-09-25T00:00:00Z' },
    { stageId: 'e2', pipelineId: 'f1', desde: '2026-09-25T00:00:00Z' },
  ],
  arquivadoEm: null,
  acesso: { ficha: true, campos: ['c1', 'c2'], negocio: false, etiquetas: false, cobrancas: true, reuniao: false },
  ferramentas: { mover_etapa: { etapas: ['e1', 'e2'] }, etiquetar: { etiquetas: ['t1'] } },
  retomada: { ativa: true, cadencia: [15, 60, 180], janela: { inicio: '08:00', fim: '21:00' } },
  createdAt: '2026-09-25T00:00:00Z',
  updatedAt: '2026-09-25T00:00:00Z',
}

function rascunhoDe(a: IaAgente): Rascunho {
  return {
    nome: a.nome,
    descricao: a.descricao,
    instrucoes: a.instrucoes,
    regras: [...a.regras],
    provedor: a.provedor,
    modelo: a.modelo,
    ativo: a.ativo,
    conexoes: [...a.conexoes],
    horario: a.horario ? { ...a.horario, dias: [...a.horario.dias] } : null,
    tetoRespostas: a.tetoRespostas,
    transferirPara: a.transferirPara,
    podePassarPara: [...a.podePassarPara],
    etapas: a.etapas.map((e) => e.stageId),
  }
}

describe('alteracoesDoRascunho — o Salvar manda só o que mudou', () => {
  it('nada mudou = corpo vazio (e o Playground não avisa)', () => {
    expect(alteracoesDoRascunho(SALVO, rascunhoDe(SALVO))).toEqual({})
  })

  it('mudar as instruções NÃO reenvia o membro da transferência que saiu da equipe (revisão da F1b)', () => {
    const r = { ...rascunhoDe(SALVO), instrucoes: 'Você é a triagem do escritório.' }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ instrucoes: 'Você é a triagem do escritório.' })
  })

  it('espaço nas pontas e regra em branco não contam como mudança (a rota apara e descarta)', () => {
    const r = { ...rascunhoDe(SALVO), nome: ' Triagem ', regras: ['Nunca prometa prazo. ', '', ' Sempre peça o nome.'] }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({})
  })

  it('a ORDEM das regras conta (elas vão numeradas ao modelo)', () => {
    const r = { ...rascunhoDe(SALVO), regras: ['Sempre peça o nome.', 'Nunca prometa prazo.'] }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ regras: ['Sempre peça o nome.', 'Nunca prometa prazo.'] })
  })

  it('a ordem das conexões e dos agentes de passagem NÃO conta (são conjuntos)', () => {
    const r = { ...rascunhoDe(SALVO), conexoes: ['y', 'x'], podePassarPara: ['c', 'b'] }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({})
  })

  it('horário: os dias em outra ordem são o mesmo horário; trocar a hora é mudança', () => {
    const mesmo = { ...rascunhoDe(SALVO), horario: { dias: [3, 1, 2], inicio: '08:00', fim: '18:00' } }
    expect(alteracoesDoRascunho(SALVO, mesmo)).toEqual({})
    const outro = { ...rascunhoDe(SALVO), horario: { dias: [1, 2, 3], inicio: '09:00', fim: '18:00' } }
    expect(alteracoesDoRascunho(SALVO, outro)).toEqual({ horario: outro.horario })
    expect(alteracoesDoRascunho(SALVO, { ...rascunhoDe(SALVO), horario: null })).toEqual({ horario: null })
  })

  it('escolher a fila (nulo) no lugar de quem saiu é mudança, e vai com o nome da rota', () => {
    const r = { ...rascunhoDe(SALVO), transferirPara: null }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ transferir_para: null })
  })

  it('etapas (D24): conjunto — a ordem não conta; marcar ou desmarcar manda a lista INTEIRA', () => {
    expect(alteracoesDoRascunho(SALVO, { ...rascunhoDe(SALVO), etapas: ['e2', 'e1'] })).toEqual({})
    expect(alteracoesDoRascunho(SALVO, { ...rascunhoDe(SALVO), etapas: ['e1'] })).toEqual({ etapas: ['e1'] })
    expect(alteracoesDoRascunho(SALVO, { ...rascunhoDe(SALVO), etapas: ['e1', 'e2', 'e3'] })).toEqual({
      etapas: ['e1', 'e2', 'e3'],
    })
  })

  it('teto e ativo com os nomes da rota', () => {
    const r = { ...rascunhoDe(SALVO), tetoRespostas: 5, ativo: true }
    expect(alteracoesDoRascunho(SALVO, r)).toEqual({ teto_respostas: 5, ativo: true })
  })
})

describe('lerTeto — o campo não se corrige a cada tecla', () => {
  it('aceita inteiro dentro dos limites', () => {
    expect(lerTeto('15', 1, 100)).toBe(15)
    expect(lerTeto(' 1 ', 1, 100)).toBe(1)
  })
  it('vazio, fração, negativo e fora dos limites = null (o Salvar trava e o campo avisa)', () => {
    for (const t of ['', '0', '101', '1.5', '-3', 'abc']) expect(lerTeto(t, 1, 100), t).toBeNull()
  })
})

describe('acessoMudou — o Salvar do Acesso (F3) e o aviso do Playground', () => {
  const salvo: AcessoDoAgente = SALVO.acesso

  it('o mesmo acesso, com os campos em outra ordem, não mudou (são conjunto)', () => {
    expect(acessoMudou(salvo, { ...salvo, campos: ['c2', 'c1'] })).toBe(false)
  })

  it('cada caixa conta, e marcar ou desmarcar um campo também', () => {
    expect(acessoMudou(salvo, { ...salvo, reuniao: true })).toBe(true)
    expect(acessoMudou(salvo, { ...salvo, ficha: false })).toBe(true)
    expect(acessoMudou(salvo, { ...salvo, campos: ['c1'] })).toBe(true)
    expect(acessoMudou(salvo, { ...salvo, campos: ['c1', 'c2', 'c3'] })).toBe(true)
  })
})

describe('acessoParaSalvar — o campo apagado do catálogo sai no Salvar', () => {
  const r: AcessoDoAgente = { ...SALVO.acesso, campos: ['c1', 'apagado', 'c2'] }

  it('com o catálogo carregado, só os que existem vão', () => {
    expect(acessoParaSalvar(r, new Set(['c1', 'c2', 'c9'])).campos).toEqual(['c1', 'c2'])
  })

  it('catálogo NÃO carregado (null) = vai como está (nunca apagar marcação por falta de rede)', () => {
    expect(acessoParaSalvar(r, null)).toEqual(r)
  })

  it('as caixas não mudam', () => {
    expect(acessoParaSalvar(r, new Set())).toEqual({ ...r, campos: [] })
  })
})

describe('ferramentas (F4) — o rascunho da sub-aba Ferramentas', () => {
  const salvo: FerramentasDoAgente = {
    mover_etapa: { etapas: ['e1', 'e2'] },
    etiquetar: { etiquetas: ['t1'] },
    criar_tarefa: { membros: [] },
  }

  it('cada tipo lê a SUA lista, com o nome de chave do servidor; ausente = desligado (null)', () => {
    const f: FerramentasDoAgente = {
      mover_etapa: { etapas: ['e'] },
      etiquetar: { etiquetas: ['a'] },
      tirar_etiqueta: { etiquetas: ['b'] },
      preencher_campo: { campos: ['c'] },
      criar_tarefa: { membros: ['m'] },
      executar_automacao: { automacoes: ['x'] },
      marcar_reuniao: { tipos_de_evento: ['https://api.calendly.com/event_types/r'] },
    }
    expect(TIPOS_DE_ACAO.map((tipo) => listaDaFerramenta(f, tipo))).toEqual([
      ['e'],
      ['a'],
      ['b'],
      ['c'],
      ['m'],
      ['x'],
      ['https://api.calendly.com/event_types/r'],
    ])
    for (const tipo of TIPOS_DE_ACAO) expect(listaDaFerramenta({}, tipo), tipo).toBeNull()
  })

  it('ida e volta: o rascunho do salvo devolve o salvo, e sem mudança nada está por salvar', () => {
    const r = rascunhoDasFerramentas(salvo)
    expect(r.ligadas).toEqual(['mover_etapa', 'etiquetar', 'criar_tarefa'])
    expect(ferramentasDoRascunho(r)).toEqual(salvo)
    expect(ferramentasMudaram(salvo, ferramentasDoRascunho(r))).toBe(false)
  })

  it('desligar e religar antes de salvar NÃO perde as marcações; desligado, a lista não vai', () => {
    const r = rascunhoDasFerramentas(salvo)
    const desligado = { ...r, ligadas: r.ligadas.filter((x) => x !== 'mover_etapa') }
    expect(ferramentasDoRascunho(desligado).mover_etapa).toBeUndefined()
    expect(ferramentasMudaram(salvo, ferramentasDoRascunho(desligado))).toBe(true)
    const religado = { ...desligado, ligadas: [...desligado.ligadas, 'mover_etapa' as const] }
    expect(ferramentasDoRascunho(religado).mover_etapa).toEqual({ etapas: ['e1', 'e2'] })
    expect(ferramentasMudaram(salvo, ferramentasDoRascunho(religado))).toBe(false)
  })

  it('a lista é conjunto (a ordem não conta); marcar ou desmarcar conta', () => {
    expect(ferramentasMudaram(salvo, { ...salvo, mover_etapa: { etapas: ['e2', 'e1'] } })).toBe(false)
    expect(ferramentasMudaram(salvo, { ...salvo, mover_etapa: { etapas: ['e1'] } })).toBe(true)
    expect(ferramentasMudaram(salvo, { ...salvo, etiquetar: { etiquetas: ['t1', 't2'] } })).toBe(true)
  })

  it('ligado com a lista VAZIA é diferente de desligado (é o que vai ao servidor)', () => {
    expect(ferramentasMudaram({}, { tirar_etiqueta: { etiquetas: [] } })).toBe(true)
    expect(ferramentasMudaram(salvo, { mover_etapa: salvo.mover_etapa, etiquetar: salvo.etiquetar })).toBe(true)
  })

  it('etiquetar e tirar etiqueta são listas SEPARADAS', () => {
    const r = rascunhoDasFerramentas({ etiquetar: { etiquetas: ['t1'] }, tirar_etiqueta: { etiquetas: ['t2'] } })
    expect(r.listas.etiquetar).toEqual(['t1'])
    expect(r.listas.tirar_etiqueta).toEqual(['t2'])
  })
})

describe('ferramentasParaSalvar (F4) — o item apagado da conta sai no Salvar', () => {
  const f: FerramentasDoAgente = {
    mover_etapa: { etapas: ['e1', 'apagada'] },
    etiquetar: { etiquetas: ['t1', 'apagada'] },
    criar_tarefa: { membros: [] },
  }

  it('com o catálogo carregado, só o que existe vai; tipo ligado com a lista vazia continua ligado', () => {
    const saida = ferramentasParaSalvar(f, {
      mover_etapa: new Set(['e1']),
      etiquetar: new Set(['t1']),
      criar_tarefa: new Set(['m1']),
    })
    expect(saida).toEqual({ mover_etapa: { etapas: ['e1'] }, etiquetar: { etiquetas: ['t1'] }, criar_tarefa: { membros: [] } })
  })

  it('catálogo NÃO carregado (ausente) ou cortado pelo teto (null) = a lista vai como está', () => {
    expect(ferramentasParaSalvar(f, {})).toEqual(f)
    expect(ferramentasParaSalvar(f, { mover_etapa: null, etiquetar: new Set(['t1']) })).toEqual({
      ...f,
      etiquetar: { etiquetas: ['t1'] },
    })
  })

  it('tipo desligado não vira ligado', () => {
    expect(ferramentasParaSalvar({}, { executar_automacao: new Set(['x']) })).toEqual({})
  })
})

describe('"Marcar reunião" (F5) — UM tipo de evento, com o nome de chave do servidor', () => {
  const URI = 'https://api.calendly.com/event_types/abc'
  const VELHO = 'https://api.calendly.com/event_types/velho'

  it('ida e volta pelo rascunho, e trocar o tipo de evento conta como mudança', () => {
    const salvo: FerramentasDoAgente = { marcar_reuniao: { tipos_de_evento: [URI] } }
    const r = rascunhoDasFerramentas(salvo)
    expect(r.listas.marcar_reuniao).toEqual([URI])
    expect(ferramentasDoRascunho(r)).toEqual(salvo)
    expect(ferramentasMudaram(salvo, { marcar_reuniao: { tipos_de_evento: [VELHO] } })).toBe(true)
  })

  it('o tipo de evento que saiu dos ativos sai no Salvar; sem Calendly legível (null), fica', () => {
    const f: FerramentasDoAgente = { marcar_reuniao: { tipos_de_evento: [VELHO] } }
    expect(ferramentasParaSalvar(f, { marcar_reuniao: new Set([URI]) })).toEqual({
      marcar_reuniao: { tipos_de_evento: [] },
    })
    expect(ferramentasParaSalvar(f, { marcar_reuniao: null })).toEqual(f)
  })
})
