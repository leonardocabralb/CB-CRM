import { describe, expect, it } from 'vitest'

import {
  aplicarAlteracao,
  blocoMarcado,
  colunasDaAlteracao,
  ehUriDeTipoDeEvento,
  itensDaAcao,
  lerAcesso,
  lerAlteracao,
  lerFerramentas,
  lerDocumentosPedidos,
  lerEtapaDoAgente,
  lerFrasesAutorizadas,
  lerFrasesAutorizadasDoCorpo,
  lerHorario,
  lerLinhaDoAgente,
  LIMITES,
  normalizarFrase,
  planoDasEtapas,
  TIPOS_DE_ACAO,
  type IaAgente,
} from './agente'

const ID = '11111111-1111-4111-8111-111111111111'

describe('lerAlteracao', () => {
  it('na edição, trocar o provedor exige o modelo junto (Codex, #295)', () => {
    expect(lerAlteracao({ provedor: 'openai' }, false)).toEqual({ ok: false, codigo: 'modelo_vazio' })
    expect(lerAlteracao({ provedor: 'openai', modelo: 'gpt-x' }, false)).toEqual({
      ok: true,
      valor: { provedor: 'openai', modelo: 'gpt-x' },
    })
    expect(lerAlteracao({ modelo: 'gpt-y' }, false)).toEqual({ ok: true, valor: { modelo: 'gpt-y' } })
  })

  it('criação exige nome, provedor e modelo', () => {
    expect(lerAlteracao({ provedor: 'gemini', modelo: 'm' }, true)).toEqual({ ok: false, codigo: 'nome_vazio' })
    expect(lerAlteracao({ nome: 'Triagem', modelo: 'm' }, true)).toEqual({ ok: false, codigo: 'provedor_invalido' })
    expect(lerAlteracao({ nome: 'Triagem', provedor: 'gemini' }, true)).toEqual({ ok: false, codigo: 'modelo_vazio' })
    const r = lerAlteracao({ nome: ' Triagem ', provedor: 'gemini', modelo: ' gemini-3.7-flash ' }, true)
    expect(r).toEqual({ ok: true, valor: { nome: 'Triagem', provedor: 'gemini', modelo: 'gemini-3.7-flash' } })
  })

  it('edição: campo AUSENTE não mexe', () => {
    expect(lerAlteracao({ ativo: true }, false)).toEqual({ ok: true, valor: { ativo: true } })
  })

  it('regras chegam aparadas, sem linha vazia (D23)', () => {
    const r = lerAlteracao({ regras: ['  Nunca prometa resultado. ', '', '   ', 'Não fale de valores.'] }, false)
    expect(r).toEqual({ ok: true, valor: { regras: ['Nunca prometa resultado.', 'Não fale de valores.'] } })
  })

  it('regras demais ou longas demais são recusadas', () => {
    expect(lerAlteracao({ regras: Array.from({ length: 31 }, (_, i) => `r${i}`) }, false)).toEqual({
      ok: false,
      codigo: 'regras_demais',
    })
    expect(lerAlteracao({ regras: ['x'.repeat(501)] }, false)).toEqual({ ok: false, codigo: 'regra_longa' })
  })

  it('só o booleano true liga', () => {
    expect(lerAlteracao({ ativo: 'true' }, false)).toEqual({ ok: true, valor: { ativo: false } })
  })

  it('listas de ids recusam o que não é uuid', () => {
    expect(lerAlteracao({ conexoes: ['x'] }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    expect(lerAlteracao({ conexoes: [ID, ID] }, false)).toEqual({ ok: true, valor: { conexoes: [ID] } })
    expect(lerAlteracao({ conexoes: [] }, false)).toEqual({ ok: true, valor: { conexoes: [] } })
  })

  it('teto e horário validados', () => {
    expect(lerAlteracao({ teto_respostas: 0 }, false)).toEqual({ ok: false, codigo: 'teto_invalido' })
    expect(lerAlteracao({ teto_respostas: 2.5 }, false)).toEqual({ ok: false, codigo: 'teto_invalido' })
    expect(lerAlteracao({ horario: { dias: [1], inicio: '18:00', fim: '08:00' } }, false)).toEqual({
      ok: false,
      codigo: 'horario_invalido',
    })
    expect(lerAlteracao({ horario: null }, false)).toEqual({ ok: true, valor: { horario: null } })
  })

  it('etapas (D24): lista de ids de etapa, sem repetição; o que não é uuid é recusado', () => {
    expect(lerAlteracao({ etapas: [ID, ID] }, false)).toEqual({ ok: true, valor: { etapas: [ID] } })
    expect(lerAlteracao({ etapas: [] }, false)).toEqual({ ok: true, valor: { etapas: [] } })
    expect(lerAlteracao({ etapas: ['lead'] }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    expect(lerAlteracao({ etapas: 'x' }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
  })

  it('transferir_para vazio = fila', () => {
    expect(lerAlteracao({ transferir_para: '' }, false)).toEqual({ ok: true, valor: { transferirPara: null } })
  })
})

describe('lerHorario', () => {
  it('dias ordenados, únicos e dentro de 0–6', () => {
    expect(lerHorario({ dias: [5, 1, 1, 9, 3], inicio: '08:00', fim: '18:00' })).toEqual({
      dias: [1, 3, 5],
      inicio: '08:00',
      fim: '18:00',
    })
  })
  it('forma estranha = nulo (sempre), nunca exceção', () => {
    expect(lerHorario({ dias: [], inicio: '08:00', fim: '18:00' })).toBeNull()
    expect(lerHorario({ dias: [1], inicio: '8h', fim: '18:00' })).toBeNull()
    expect(lerHorario('x')).toBeNull()
  })
})

describe('lerLinhaDoAgente', () => {
  it('provedor desconhecido descarta a linha', () => {
    expect(lerLinhaDoAgente({ id: ID, account_id: ID, provedor: 'x' })).toBeNull()
  })
  it('lê listas e booleanos só pela forma certa', () => {
    const a = lerLinhaDoAgente({
      id: ID,
      account_id: ID,
      provedor: 'gemini',
      ativo: 'true',
      regras: ['a', 1, 'b'],
      conexoes: null,
    })
    expect(a?.ativo).toBe(false)
    expect(a?.regras).toEqual(['a', 'b'])
    expect(a?.conexoes).toEqual([])
  })
})

describe('"Avisar quando passar para a equipe" (1139) — quem recebe o aviso', () => {
  const OUTRO = '22222222-2222-4222-8222-222222222222'

  it('a linha: só uuids; ausente (antes da 1139) ou fora da forma = ninguém escolhido', () => {
    const base = { id: ID, account_id: ID, provedor: 'gemini' }
    expect(lerLinhaDoAgente({ ...base, avisar_ao_transferir: [ID, 'x', 3, OUTRO] })?.avisarAoTransferir).toEqual([ID, OUTRO])
    for (const v of [undefined, null, 'x', {}]) {
      expect(lerLinhaDoAgente({ ...base, avisar_ao_transferir: v })?.avisarAoTransferir, String(v)).toEqual([])
    }
  })

  it('PATCH: a lista inteira, sem repetição, vira a coluna avisar_ao_transferir; vazia vale (volta à régua do dono e admins)', () => {
    const r = lerAlteracao({ avisar_ao_transferir: [ID, OUTRO, ID] }, false)
    expect(r).toEqual({ ok: true, valor: { avisarAoTransferir: [ID, OUTRO] } })
    if (r.ok) expect(colunasDaAlteracao(r.valor)).toEqual({ avisar_ao_transferir: [ID, OUTRO] })
    expect(lerAlteracao({ avisar_ao_transferir: [] }, false)).toEqual({ ok: true, valor: { avisarAoTransferir: [] } })
  })

  it('⚠️ PATCH ESTRITO: id fora da forma ou acima do teto recusa — nunca descarta em silêncio quem foi marcado', () => {
    expect(lerAlteracao({ avisar_ao_transferir: ['ana'] }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    expect(lerAlteracao({ avisar_ao_transferir: ID }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    const demais = Array.from(
      { length: LIMITES.avisarAoTransferir + 1 },
      (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
    )
    expect(lerAlteracao({ avisar_ao_transferir: demais }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    expect(lerAlteracao({ avisar_ao_transferir: demais.slice(1) }, false).ok).toBe(true)
  })
})

describe('"Conduz o fechamento" (1128) — a opção por agente', () => {
  it('a linha: só o booleano true liga; ausente (antes da 1128), "true", 1 e nulo = desligada', () => {
    const base = { id: ID, account_id: ID, provedor: 'gemini' }
    expect(lerLinhaDoAgente({ ...base, conduz_fechamento: true })?.conduzFechamento).toBe(true)
    for (const v of [undefined, false, 'true', 1, null]) {
      expect(lerLinhaDoAgente({ ...base, conduz_fechamento: v })?.conduzFechamento, String(v)).toBe(false)
    }
  })

  it('PATCH: o booleano liga e desliga e vira a coluna conduz_fechamento', () => {
    for (const v of [true, false]) {
      const r = lerAlteracao({ conduz_fechamento: v }, false)
      expect(r).toEqual({ ok: true, valor: { conduzFechamento: v } })
      if (r.ok) expect(colunasDaAlteracao(r.valor)).toEqual({ conduz_fechamento: v })
    }
  })

  it('⚠️ PATCH ESTRITO: qualquer outra forma RECUSA — nunca vira ligada nem desligada em silêncio', () => {
    for (const v of ['true', 1, 0, null, {}, []]) {
      expect(lerAlteracao({ conduz_fechamento: v }, false), JSON.stringify(v)).toEqual({ ok: false, codigo: 'corpo_invalido' })
    }
  })

  it('sem a chave no corpo, a coluna não se toca (e a criação nasce desligada pelo DEFAULT da 1128)', () => {
    const r = lerAlteracao({ instrucoes: 'x' }, false)
    expect(r.ok && r.valor).not.toHaveProperty('conduzFechamento')
    const criacao = lerAlteracao({ nome: 'A', provedor: 'gemini', modelo: 'm' }, true)
    expect(criacao.ok && colunasDaAlteracao(criacao.valor)).not.toHaveProperty('conduz_fechamento')
  })
})

describe('as FRASES AUTORIZADAS (1131) — a lista por agente', () => {
  const base = { id: ID, account_id: ID, provedor: 'gemini' }
  const recusa = { ok: false, codigo: 'corpo_invalido' }

  it('a linha: só a lista de textos não vazios vale (aparados); ausente (antes da 1131) = nenhuma', () => {
    expect(lerLinhaDoAgente({ ...base, frases_autorizadas: [' Frase um. ', 'Frase dois.'] })?.frasesAutorizadas).toEqual([
      'Frase um.',
      'Frase dois.',
    ])
    expect(lerLinhaDoAgente(base)?.frasesAutorizadas).toEqual([])
    expect(lerFrasesAutorizadas([])).toEqual([])
  })

  it('⚠️ qualquer outra forma vira lista VAZIA (a dúvida fecha: as regras de sempre), nunca exceção', () => {
    for (const v of [null, 'Frase.', 7, {}, ['Frase.', 1], ['Frase.', ''], ['Frase.', '   '], [null]]) {
      expect(lerFrasesAutorizadas(v), JSON.stringify(v)).toEqual([])
    }
  })

  it('PATCH: a lista INTEIRA, cada frase numa linha só e aparada; vira a coluna frases_autorizadas', () => {
    const r = lerAlteracao({ frases_autorizadas: ['  A primeira reunião\nnão tem custo.  ', 'Outra   frase.'] }, false)
    expect(r).toEqual({ ok: true, valor: { frasesAutorizadas: ['A primeira reunião não tem custo.', 'Outra frase.'] } })
    if (r.ok) {
      expect(colunasDaAlteracao(r.valor)).toEqual({
        frases_autorizadas: ['A primeira reunião não tem custo.', 'Outra frase.'],
      })
    }
    // Lista vazia vale: tira todas.
    expect(lerAlteracao({ frases_autorizadas: [] }, false)).toEqual({ ok: true, valor: { frasesAutorizadas: [] } })
  })

  it('PATCH: até 10 frases, de 1 a 400 caracteres cada', () => {
    const dez = Array.from({ length: LIMITES.frasesAutorizadas }, (_, i) => `Frase ${i}.`)
    expect(lerAlteracao({ frases_autorizadas: dez }, false)).toEqual({ ok: true, valor: { frasesAutorizadas: dez } })
    expect(lerAlteracao({ frases_autorizadas: [...dez, 'Mais uma.'] }, false)).toEqual(recusa)
    const longa = 'x'.repeat(LIMITES.fraseAutorizada)
    expect(lerAlteracao({ frases_autorizadas: [` ${longa} `] }, false)).toEqual({ ok: true, valor: { frasesAutorizadas: [longa] } })
    expect(lerAlteracao({ frases_autorizadas: [`${longa}x`] }, false)).toEqual(recusa)
    expect(LIMITES.frasesAutorizadas).toBe(10)
    expect(LIMITES.fraseAutorizada).toBe(400)
  })

  it('⚠️ PATCH ESTRITO: vazia, repetida (sem caixa nem espaço) ou fora da forma RECUSA — nunca descarta em silêncio', () => {
    for (const v of [
      [''],
      ['   '],
      ['Sem custo.', 'sem custo.'],
      ['Sem custo.', ' Sem  custo. '],
      ['Sem custo.', 7],
      'Sem custo.',
      null,
      {},
    ]) {
      expect(lerAlteracao({ frases_autorizadas: v }, false), JSON.stringify(v)).toEqual(recusa)
      expect(lerFrasesAutorizadasDoCorpo(v), JSON.stringify(v)).toBeNull()
    }
  })

  it('sem a chave no corpo, a coluna não se toca (e a criação nasce sem frases pelo DEFAULT da 1131)', () => {
    const r = lerAlteracao({ instrucoes: 'x' }, false)
    expect(r.ok && r.valor).not.toHaveProperty('frasesAutorizadas')
    const criacao = lerAlteracao({ nome: 'A', provedor: 'gemini', modelo: 'm' }, true)
    expect(criacao.ok && colunasDaAlteracao(criacao.valor)).not.toHaveProperty('frases_autorizadas')
  })

  it('normalizarFrase: uma linha só, um espaço entre as palavras, sem as pontas', () => {
    expect(normalizarFrase('  A primeira\r\nreunião \t não tem custo.  ')).toBe('A primeira reunião não tem custo.')
    expect(normalizarFrase(' \n ')).toBe('')
  })
})

describe('colunasDaAlteracao', () => {
  it('só as colunas presentes, com o nome do banco', () => {
    expect(colunasDaAlteracao({ tetoRespostas: 5, podePassarPara: [ID] })).toEqual({
      teto_respostas: 5,
      pode_passar_para: [ID],
    })
  })
  it('as etapas NÃO viram coluna do agente (moram em cb_ia_agente_etapas)', () => {
    expect(colunasDaAlteracao({ etapas: [ID], ativo: true })).toEqual({ ativo: true })
  })
})

describe('lerLinhaDoAgente — ativado_em (D27)', () => {
  it('lê o instante em que foi ligado; ausente = nulo', () => {
    const base = { id: ID, account_id: ID, provedor: 'gemini' }
    expect(lerLinhaDoAgente({ ...base, ativado_em: '2026-09-26T10:00:00+00:00' })?.ativadoEm).toBe(
      '2026-09-26T10:00:00+00:00',
    )
    expect(lerLinhaDoAgente(base)?.ativadoEm).toBeNull()
  })
})

describe('lerEtapaDoAgente', () => {
  it('lê a etapa com o funil embutido', () => {
    expect(
      lerEtapaDoAgente({ stage_id: 'e1', ia_agente_id: 'ag', desde: 'd', pipeline_stages: { pipeline_id: 'f1' } }),
    ).toEqual({ stageId: 'e1', pipelineId: 'f1', desde: 'd', iaAgenteId: 'ag' })
  })
  it('sem o funil (etapa sumida no meio) descarta a linha', () => {
    expect(lerEtapaDoAgente({ stage_id: 'e1', ia_agente_id: 'ag', desde: 'd', pipeline_stages: null })).toBeNull()
  })
})

describe('planoDasEtapas — uma etapa tem no máximo UM agente (D24)', () => {
  const donos = new Map([
    ['e1', 'ag-1'],
    ['e2', 'ag-2'],
  ])

  it('as que o agente já tem ficam (mantêm o desde); só as novas entram', () => {
    expect(planoDasEtapas('ag-1', ['e1', 'e3'], donos)).toEqual({ ocupada: null, inserir: ['e3'] })
  })

  it('etapa de OUTRO agente recusa tudo, dizendo de quem é', () => {
    expect(planoDasEtapas('ag-1', ['e3', 'e2'], donos)).toEqual({
      ocupada: { stageId: 'e2', agenteId: 'ag-2' },
      inserir: [],
    })
  })

  it('na criação (sem id ainda), qualquer etapa com dono está ocupada', () => {
    expect(planoDasEtapas('', ['e1'], donos).ocupada).toEqual({ stageId: 'e1', agenteId: 'ag-1' })
  })

  it('lista vazia: nada entra (as antigas saem pelo DELETE)', () => {
    expect(planoDasEtapas('ag-1', [], donos)).toEqual({ ocupada: null, inserir: [] })
  })
})

// ------------------------------------------------------------
// F3 — o que o agente vê e a base dele
// ------------------------------------------------------------

const FECHADO = { ficha: false, campos: [], negocio: false, etiquetas: false, cobrancas: false, reuniao: false }
const CAMPO = '22222222-2222-4222-8222-222222222222'
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`

describe('lerAcesso — fechado por padrão, só o booleano true liga', () => {
  it('ausente, nulo ou forma estranha = nada marcado (só a conversa)', () => {
    expect(lerAcesso(undefined)).toEqual(FECHADO)
    expect(lerAcesso(null)).toEqual(FECHADO)
    expect(lerAcesso('ficha')).toEqual(FECHADO)
    expect(lerAcesso([true])).toEqual(FECHADO)
    expect(lerAcesso({})).toEqual(FECHADO)
  })

  it('"true" e 1 do JSONB NÃO ligam', () => {
    expect(lerAcesso({ ficha: 'true', negocio: 1, cobrancas: true })).toEqual({ ...FECHADO, cobrancas: true })
  })

  it('campos: só uuids, sem repetição, até o teto', () => {
    expect(lerAcesso({ campos: [CAMPO, 'x', 7, CAMPO] }).campos).toEqual([CAMPO])
    const muitos = Array.from({ length: LIMITES.campos + 5 }, (_, i) => uuid(i))
    expect(lerAcesso({ campos: muitos }).campos).toHaveLength(LIMITES.campos)
  })

  it('blocoMarcado: campos = pelo menos um campo escolhido', () => {
    expect(blocoMarcado(FECHADO, 'campos')).toBe(false)
    expect(blocoMarcado({ ...FECHADO, campos: [CAMPO] }, 'campos')).toBe(true)
    expect(blocoMarcado({ ...FECHADO, reuniao: true }, 'reuniao')).toBe(true)
  })

  it('a linha do agente traz o acesso lido; sem a coluna, fechado', () => {
    const base = { id: ID, account_id: ID, provedor: 'gemini' }
    expect(lerLinhaDoAgente(base)?.acesso).toEqual(FECHADO)
    expect(lerLinhaDoAgente({ ...base, acesso: { etiquetas: true, campos: [CAMPO] } })?.acesso).toEqual({
      ...FECHADO,
      etiquetas: true,
      campos: [CAMPO],
    })
  })
})

describe('lerAlteracao — acesso (PATCH)', () => {
  it('objeto inteiro, lido pela régua do acesso; vira a coluna `acesso` com as MESMAS chaves', () => {
    const r = lerAlteracao({ acesso: { ficha: true, campos: [CAMPO, CAMPO], cobrancas: 'true' } }, false)
    expect(r).toEqual({ ok: true, valor: { acesso: { ...FECHADO, ficha: true, campos: [CAMPO] } } })
    if (r.ok) expect(colunasDaAlteracao(r.valor)).toEqual({ acesso: { ...FECHADO, ficha: true, campos: [CAMPO] } })
  })

  it('acesso que não é objeto: recusado', () => {
    expect(lerAlteracao({ acesso: null }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    expect(lerAlteracao({ acesso: ['ficha'] }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
  })

  it('campos fora da forma RECUSA (não descarta em silêncio o que o administrador marcou)', () => {
    expect(lerAlteracao({ acesso: { campos: ['telefone'] } }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    expect(lerAlteracao({ acesso: { campos: CAMPO } }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    const demais = Array.from({ length: LIMITES.campos + 1 }, (_, i) => uuid(i))
    expect(lerAlteracao({ acesso: { campos: demais } }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
  })

  it('acesso ausente não mexe', () => {
    expect(lerAlteracao({ ativo: false }, false)).toEqual({ ok: true, valor: { ativo: false } })
  })
})

describe('lerDocumentosPedidos — o corpo do PUT …/documentos', () => {
  it('lista de uuids, sem repetição; vazia = nenhuma base', () => {
    expect(lerDocumentosPedidos({ documentoIds: [ID, ID] })).toEqual([ID])
    expect(lerDocumentosPedidos({ documentoIds: [] })).toEqual([])
  })

  it('forma errada = null', () => {
    expect(lerDocumentosPedidos(null)).toBeNull()
    expect(lerDocumentosPedidos({})).toBeNull()
    expect(lerDocumentosPedidos({ documentoIds: ['faq'] })).toBeNull()
    expect(lerDocumentosPedidos([ID])).toBeNull()
    expect(lerDocumentosPedidos({ documentoIds: Array.from({ length: LIMITES.documentos + 1 }, (_, i) => uuid(i)) })).toBeNull()
  })
})

describe('lerFerramentas — nada ligado = o agente só conversa (F4, D28)', () => {
  const A = '22222222-2222-4222-8222-222222222222'
  const B = '33333333-3333-4333-8333-333333333333'

  it('os sete tipos, nessa ordem (a reunião da F5 no fim)', () => {
    expect(TIPOS_DE_ACAO).toEqual([
      'mover_etapa',
      'etiquetar',
      'tirar_etiqueta',
      'preencher_campo',
      'criar_tarefa',
      'executar_automacao',
      'marcar_reuniao',
    ])
  })

  it('F5: a reunião guarda UMA URI de tipo de evento do Calendly — só essa forma', () => {
    const URI = 'https://api.calendly.com/event_types/GBGBDCAADAEDCRZ2'
    const OUTRA = 'https://api.calendly.com/event_types/AAAA-1111'
    expect(ehUriDeTipoDeEvento(URI)).toBe(true)
    for (const v of [
      A,
      'http://api.calendly.com/event_types/X',
      'https://api.calendly.com.evil.com/event_types/X',
      'https://api.calendly.com/event_types/X/../users/me',
      'https://api.calendly.com/event_types/X?y=1',
      'https://api.calendly.com/users/X',
      'https://api.calendly.com/event_types/',
      7,
      null,
    ]) {
      expect(ehUriDeTipoDeEvento(v), String(v)).toBe(false)
    }
    // Uuid não serve na reunião; URI não serve nos outros; a segunda URI cai no teto de 1.
    const f = lerFerramentas({
      marcar_reuniao: { tipos_de_evento: [A, URI, URI, OUTRA] },
      etiquetar: { etiquetas: [URI, A] },
    })
    expect(f).toEqual({ marcar_reuniao: { tipos_de_evento: [URI] }, etiquetar: { etiquetas: [A] } })
    expect(itensDaAcao(f, 'marcar_reuniao')).toEqual([URI])
  })

  it('forma estranha = nada ligado, nunca exceção', () => {
    for (const v of [null, undefined, 'x', 1, [], { mover_etapa: 'x' }, { mover_etapa: { etapas: 'x' } }]) {
      expect(lerFerramentas(v)).toEqual({})
    }
  })

  it('cada tipo com a SUA lista; só uuid, sem repetição, até o teto', () => {
    const muitos = Array.from({ length: 60 }, (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`)
    const f = lerFerramentas({
      mover_etapa: { etapas: [A, A, 'lead', 7] },
      etiquetar: { etiquetas: [B] },
      tirar_etiqueta: { etapas: [A] },
      criar_tarefa: { membros: muitos },
      outra_coisa: { ids: [A] },
    })
    expect(f).toEqual({
      mover_etapa: { etapas: [A] },
      etiquetar: { etiquetas: [B] },
      // A lista na chave errada (`etapas` num tipo de etiquetas) = desligado.
      criar_tarefa: { membros: muitos.slice(0, LIMITES.itensPorAcao) },
    })
    expect(itensDaAcao(f, 'mover_etapa')).toEqual([A])
    expect(itensDaAcao(f, 'executar_automacao')).toEqual([])
  })

  it('a linha do banco traz as ferramentas (ausentes = nada ligado)', () => {
    const base = { id: ID, account_id: 'c', provedor: 'gemini' }
    expect(lerLinhaDoAgente(base)?.ferramentas).toEqual({})
    expect(lerLinhaDoAgente({ ...base, ferramentas: { etiquetar: { etiquetas: [A] } } })?.ferramentas).toEqual({
      etiquetar: { etiquetas: [A] },
    })
  })
})

describe('lerAlteracao — ferramentas (PATCH)', () => {
  const A = '22222222-2222-4222-8222-222222222222'

  it('o objeto inteiro vai para a coluna', () => {
    const r = lerAlteracao({ ferramentas: { mover_etapa: { etapas: [A] }, etiquetar: null } }, false)
    expect(r).toEqual({ ok: true, valor: { ferramentas: { mover_etapa: { etapas: [A] } } } })
    if (!r.ok) throw new Error('fixture')
    expect(colunasDaAlteracao(r.valor)).toEqual({ ferramentas: { mover_etapa: { etapas: [A] } } })
  })

  it('fora da forma RECUSA (descartar em silêncio tiraria um item liberado)', () => {
    const recusa = { ok: false, codigo: 'lista_invalida' }
    expect(lerAlteracao({ ferramentas: [] }, false)).toEqual(recusa)
    expect(lerAlteracao({ ferramentas: null }, false)).toEqual(recusa)
    expect(lerAlteracao({ ferramentas: { mover_etapa: [A] } }, false)).toEqual(recusa)
    expect(lerAlteracao({ ferramentas: { mover_etapa: { etapas: ['lead'] } } }, false)).toEqual(recusa)
    expect(lerAlteracao({ ferramentas: { etiquetar: {} } }, false)).toEqual(recusa)
    const demais = Array.from({ length: 51 }, (_, i) => `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`)
    expect(lerAlteracao({ ferramentas: { criar_tarefa: { membros: demais } } }, false)).toEqual(recusa)
  })

  it('F5: a reunião aceita UMA URI de tipo de evento; outra forma ou mais de uma RECUSA', () => {
    const URI = 'https://api.calendly.com/event_types/GBGBDCAADAEDCRZ2'
    const OUTRA = 'https://api.calendly.com/event_types/OUTRO'
    const recusa = { ok: false, codigo: 'lista_invalida' }
    const r = lerAlteracao({ ferramentas: { marcar_reuniao: { tipos_de_evento: [URI, URI] } } }, false)
    expect(r).toEqual({ ok: true, valor: { ferramentas: { marcar_reuniao: { tipos_de_evento: [URI] } } } })
    expect(lerAlteracao({ ferramentas: { marcar_reuniao: { tipos_de_evento: [URI, OUTRA] } } }, false)).toEqual(recusa)
    expect(lerAlteracao({ ferramentas: { marcar_reuniao: { tipos_de_evento: [A] } } }, false)).toEqual(recusa)
    expect(lerAlteracao({ ferramentas: { marcar_reuniao: { tipos_de_evento: URI } } }, false)).toEqual(recusa)
    expect(lerAlteracao({ ferramentas: { marcar_reuniao: { tipo_de_evento: URI } } }, false)).toEqual(recusa)
    // E a URI não entra numa lista de uuids.
    expect(lerAlteracao({ ferramentas: { mover_etapa: { etapas: [URI] } } }, false)).toEqual(recusa)
  })

  it('sem `ferramentas` no corpo, a coluna não se toca', () => {
    const r = lerAlteracao({ nome: 'X' }, false)
    if (!r.ok) throw new Error('fixture')
    expect(colunasDaAlteracao(r.valor)).not.toHaveProperty('ferramentas')
  })
})

describe('aplicarAlteracao — o RASCUNHO do Playground por cima do salvo (DC4, 26/10/2026)', () => {
  const SALVO: IaAgente = {
    id: ID,
    accountId: 'conta-1',
    nome: 'Triagem',
    descricao: 'faz a triagem',
    instrucoes: 'Instrução salva.',
    regras: ['Regra salva.'],
    provedor: 'gemini',
    modelo: 'gemini-x',
    ativo: false,
    conexoes: ['22222222-2222-4222-8222-222222222222'],
    horario: null,
    tetoRespostas: 10,
    podePassarPara: [],
    transferirPara: null,
    avisarAoTransferir: [],
    acesso: { ficha: false, campos: [], negocio: false, etiquetas: false, cobrancas: false, reuniao: false },
    ferramentas: {},
    retomada: { ativa: false, cadencia: [15, 60], janela: { inicio: '08:00', fim: '21:00' } },
    conduzFechamento: false,
    frasesAutorizadas: [],
    ativadoEm: null,
    arquivadoEm: null,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-26T14:32:00Z',
  }

  function rascunho(corpo: Record<string, unknown>) {
    const r = lerAlteracao(corpo, false)
    if (!r.ok) throw new Error(`fixture: ${r.codigo}`)
    return r.valor
  }

  it('campo AUSENTE no rascunho fica como está salvo', () => {
    expect(aplicarAlteracao(SALVO, {})).toEqual(SALVO)
    const r = aplicarAlteracao(SALVO, rascunho({ instrucoes: 'Instrução nova.' }))
    expect(r).toEqual({ ...SALVO, instrucoes: 'Instrução nova.' })
  })

  it('o que muda a resposta entra: instruções, regras, provedor e modelo, passagens, acesso, ferramentas e retomada', () => {
    const OUTRO = '33333333-3333-4333-8333-333333333333'
    const r = aplicarAlteracao(
      SALVO,
      rascunho({
        instrucoes: ' Nova. ',
        regras: ['Uma', ''],
        provedor: 'anthropic',
        modelo: 'claude-haiku-5-5',
        pode_passar_para: [OUTRO],
        acesso: { ficha: true },
        ferramentas: { etiquetar: { etiquetas: [OUTRO] } },
        retomada: { ativa: true, cadencia: [30], janela: { inicio: '09:00', fim: '18:00' } },
      }),
    )
    expect(r).toMatchObject({
      instrucoes: 'Nova.',
      regras: ['Uma'],
      provedor: 'anthropic',
      modelo: 'claude-haiku-5-5',
      podePassarPara: [OUTRO],
      acesso: { ficha: true, campos: [] },
      ferramentas: { etiquetar: { etiquetas: [OUTRO] } },
      retomada: { ativa: true, cadencia: [30] },
    })
  })

  it('⚠️ etapas, `ativo` e conexões NÃO entram: no Playground eles não decidem a resposta', () => {
    const r = aplicarAlteracao(
      SALVO,
      rascunho({ ativo: true, conexoes: [], etapas: ['44444444-4444-4444-8444-444444444444'], instrucoes: 'Nova.' }),
    )
    expect(r.ativo).toBe(false)
    expect(r.conexoes).toEqual(SALVO.conexoes)
    expect(r).not.toHaveProperty('etapas')
    expect(r.instrucoes).toBe('Nova.')
  })

  it('não muda o agente salvo e preserva o que vem a mais (as etapas do detalhe)', () => {
    const comEtapas = { ...SALVO, etapas: [{ stageId: 's1', pipelineId: 'p1', desde: '2026-10-01' }] }
    const r = aplicarAlteracao(comEtapas, rascunho({ modelo: 'outro', etapas: [] }))
    expect(r.etapas).toEqual(comEtapas.etapas)
    expect(r.modelo).toBe('outro')
    expect(comEtapas.modelo).toBe('gemini-x')
  })

  it('⚠️ "Conduz o fechamento" do rascunho ENTRA: muda as regras do sistema do pedido testado', () => {
    expect(aplicarAlteracao(SALVO, rascunho({ conduz_fechamento: true })).conduzFechamento).toBe(true)
    const ligado = { ...SALVO, conduzFechamento: true }
    expect(aplicarAlteracao(ligado, rascunho({ conduz_fechamento: false })).conduzFechamento).toBe(false)
    expect(aplicarAlteracao(ligado, rascunho({ instrucoes: 'x' })).conduzFechamento).toBe(true)
  })

  it('⚠️ as frases autorizadas do rascunho ENTRAM (1131): mudam as regras do sistema do pedido testado', () => {
    const FRASE = 'A primeira reunião com o advogado não tem custo.'
    expect(aplicarAlteracao(SALVO, rascunho({ frases_autorizadas: [FRASE] })).frasesAutorizadas).toEqual([FRASE])
    const comFrase = { ...SALVO, frasesAutorizadas: [FRASE] }
    expect(aplicarAlteracao(comFrase, rascunho({ frases_autorizadas: [] })).frasesAutorizadas).toEqual([])
    expect(aplicarAlteracao(comFrase, rascunho({ instrucoes: 'x' })).frasesAutorizadas).toEqual([FRASE])
  })

  it('o `horario: null` do rascunho (sempre) vale; e o teto e a transferência também entram', () => {
    const salvoComHorario = { ...SALVO, horario: { dias: [1], inicio: '08:00', fim: '18:00' } }
    const r = aplicarAlteracao(salvoComHorario, rascunho({ horario: null, teto_respostas: 3, transferir_para: null }))
    expect(r.horario).toBeNull()
    expect(r.tetoRespostas).toBe(3)
    expect(r.transferirPara).toBeNull()
  })
})
