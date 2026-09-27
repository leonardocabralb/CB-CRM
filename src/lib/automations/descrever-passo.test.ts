import { readFileSync } from 'node:fs'
import type { AutomationStepType } from '@/types'
import { describe, expect, it } from 'vitest'

import { descreverPasso } from './descrever-passo'

// ------------------------------------------------------------
// O resumo do cartão da grade do funil.
//
// O modo de falha aqui não é "texto feio": é a tela mostrar
// `Pipelines.automacoes.resumo.send_x` cru para o operador, porque o fallback
// do next-intl é por ARQUIVO e não por chave. O último bloco deste arquivo é
// o que impede isso — ele lê os dicionários de verdade.
// ------------------------------------------------------------

const NOMES = {
  tags: { 't1': 'DESQUALIFICADO' },
  etapas: { 'e1': 'Proposta Realizada' },
  fluxos: { 'f1': 'Trabalhista - Atendimento Inicial' },
  automacoes: { 'a1': 'Boas-vindas' },
}

const passo = (step_type: string, step_config: Record<string, unknown> = {}) => ({
  step_type,
  step_config,
})

describe('descreverPasso — troca id por nome', () => {
  it('tag vira o nome da tag', () => {
    const r = descreverPasso(passo('add_tag', { tag_id: 't1' }), NOMES)
    expect(r).toEqual({ chave: 'add_tag', valores: { alvo: 'DESQUALIFICADO' }, alvoSumiu: false })
  })

  it('robô, automação e etapa também', () => {
    expect(descreverPasso(passo('run_flow', { flow_id: 'f1' }), NOMES).valores.alvo).toBe(
      'Trabalhista - Atendimento Inicial',
    )
    expect(
      descreverPasso(passo('run_automation', { automation_id: 'a1' }), NOMES).valores.alvo,
    ).toBe('Boas-vindas')
    expect(
      descreverPasso(passo('move_deal_stage', { stage_id: 'e1' }), NOMES).valores.alvo,
    ).toBe('Proposta Realizada')
  })

  it('CRÍTICO: id que não existe mais é SINALIZADO, não impresso', () => {
    // Imprimir o UUID faria o operador achar que aquilo é o nome da tag.
    const r = descreverPasso(passo('add_tag', { tag_id: 'sumiu-daqui' }), NOMES)
    expect(r.alvoSumiu).toBe(true)
    expect(r.valores.alvo).toBe('')
    expect(String(r.valores.alvo)).not.toContain('sumiu-daqui')
  })

  it('config sem o id nem estoura nem mente', () => {
    const r = descreverPasso(passo('add_tag', {}), NOMES)
    expect(r.alvoSumiu).toBe(true)
  })

  it('sem mapa de nomes, sinaliza em vez de quebrar', () => {
    expect(descreverPasso(passo('add_tag', { tag_id: 't1' })).alvoSumiu).toBe(true)
  })
})

describe('descreverPasso — variantes que viram chaves diferentes', () => {
  it('CRÍTICO: ligar e desligar a IA são chaves OPOSTAS', () => {
    // São ações contrárias. Uma frase só, parametrizada, faria as duas
    // ficarem parecidas no meio de um quadro cheio.
    expect(descreverPasso(passo('set_ai', { enabled: true })).chave).toBe('set_ai_on')
    expect(descreverPasso(passo('set_ai', { enabled: false })).chave).toBe('set_ai_off')
  })

  it('status do negócio vira uma chave por status', () => {
    expect(descreverPasso(passo('set_deal_status', { status: 'won' })).chave).toBe(
      'set_deal_status_won',
    )
    expect(descreverPasso(passo('set_deal_status', { status: 'lost' })).chave).toBe(
      'set_deal_status_lost',
    )
    // Sem status gravado, "aberto" é o padrão do próprio tipo.
    expect(descreverPasso(passo('set_deal_status', {})).chave).toBe('set_deal_status_open')
  })

  it('mídia vira uma chave por tipo de arquivo', () => {
    expect(descreverPasso(passo('send_media', { kind: 'audio' })).chave).toBe('send_media_audio')
    expect(descreverPasso(passo('send_media', {})).chave).toBe('send_media_image')
  })

  it('espera leva a unidade na chave e o número no valor', () => {
    const r = descreverPasso(passo('wait', { amount: 24, unit: 'hours' }))
    expect(r).toEqual({ chave: 'wait_hours', valores: { quantidade: 24 }, alvoSumiu: false })
  })

  it('espera que para na resposta do cliente tem chave PRÓPRIA', () => {
    const r = descreverPasso(passo('wait', { amount: 30, unit: 'hours', parar_se_responder: true }))
    expect(r.chave).toBe('wait_hours_ou_resposta')
  })

  it('só o booleano true liga a variante — como o motor', () => {
    // `"true"` e `1` são truthy; o motor os ignora, e a grade dizer "ou até o
    // cliente responder" sobre uma espera que NÃO para seria a tela mentindo.
    for (const valor of ['true', 1, {}, null]) {
      const r = descreverPasso(passo('wait', { amount: 1, unit: 'days', parar_se_responder: valor }))
      expect(r.chave).toBe('wait_days')
    }
  })

  it('espera pelo HORÁRIO mostra a janela, nunca o amount/unit que ficou gravado (B6a)', () => {
    const r = descreverPasso(passo('wait', { modo: 'horario', janela: '08:00-21:00', amount: 1, unit: 'hours' }))
    expect(r).toEqual({ chave: 'wait_horario', valores: { inicio: '08:00', fim: '21:00' }, alvoSumiu: false })
    expect(
      descreverPasso(passo('wait', { modo: 'horario', janela: '08:00-21:00', somente_seg_a_sex: true, parar_se_responder: true })).chave,
    ).toBe('wait_horario_seg_a_sex_ou_resposta')
    // O dia inteiro vai até 24:00; janela ilegível sai "—" (a ativação a recusa).
    expect(descreverPasso(passo('wait', { modo: 'horario', janela: '00:00-24:00' })).valores).toEqual({ inicio: '00:00', fim: '24:00' })
    expect(descreverPasso(passo('wait', { modo: 'horario', janela: '' })).valores).toEqual({ inicio: '—', fim: '—' })
    // Só `true` liga o "segunda a sexta", como o motor.
    expect(descreverPasso(passo('wait', { modo: 'horario', janela: '08:00-21:00', somente_seg_a_sex: 'true' })).chave).toBe('wait_horario')
    // O modo "tempo" é o de sempre.
    expect(descreverPasso(passo('wait', { modo: 'tempo', amount: 2, unit: 'hours' })).chave).toBe('wait_hours')
  })
})

describe('descreverPasso — "Alterar campo do contato"', () => {
  it('campo personalizado pelo NOME, nunca "custom:<id>"', () => {
    const r = descreverPasso(passo('update_contact_field', { field: 'custom:cf1', value: 'x' }), {
      campos: { cf1: 'Motivo da desqualificação' },
    })
    expect(r).toEqual({
      chave: 'update_contact_field',
      valores: { alvo: 'Motivo da desqualificação' },
      alvoSumiu: false,
    })
  })

  it('campo que o catálogo não conhece = alvoSumiu, sem o id', () => {
    const r = descreverPasso(passo('update_contact_field', { field: 'custom:sumiu' }), { campos: {} })
    expect(r).toEqual({ chave: 'update_contact_field', valores: { alvo: '' }, alvoSumiu: true })
  })

  it('campo fixo tem chave própria, sem alvo cru em inglês', () => {
    expect(descreverPasso(passo('update_contact_field', { field: 'email' }))).toEqual({
      chave: 'update_contact_field_email',
      valores: {},
      alvoSumiu: false,
    })
  })
})

describe('descreverPasso — condição por campo personalizado (2.10)', () => {
  const CAMPOS = { cf1: 'Motivo da desqualificação' }

  it('diz QUAL campo e o valor — sem UUID', () => {
    const r = descreverPasso(
      passo('condition', { subject: 'custom_field', operand: 'cf1', operator: 'equals', value: 'Não respondeu' }),
      { campos: CAMPOS },
    )
    expect(r).toEqual({
      chave: 'condition_campo_equals',
      valores: { alvo: 'Motivo da desqualificação', valor: 'Não respondeu' },
      alvoSumiu: false,
    })
  })

  it('operador ausente = "é"; vazio/preenchido não levam valor', () => {
    expect(descreverPasso(passo('condition', { subject: 'custom_field', operand: 'cf1', value: 'a' }), { campos: CAMPOS }).chave).toBe(
      'condition_campo_equals',
    )
    expect(
      descreverPasso(passo('condition', { subject: 'custom_field', operand: 'cf1', operator: 'empty' }), { campos: CAMPOS }).valores,
    ).toEqual({ alvo: 'Motivo da desqualificação' })
  })

  it('campo que o catálogo não conhece = alvoSumiu (a tela escreve "(apagado)"), nunca o id', () => {
    const r = descreverPasso(passo('condition', { subject: 'custom_field', operand: 'sumiu', operator: 'not_empty' }), {
      campos: CAMPOS,
    })
    expect(r.alvoSumiu).toBe(true)
    expect(r.valores.alvo).toBe('')
  })

  it('as outras condições (e operador desconhecido) continuam "Verificar uma condição"', () => {
    expect(descreverPasso(passo('condition', { subject: 'deal_stage', operand: 'e1' })).chave).toBe('condition')
    expect(
      descreverPasso(passo('condition', { subject: 'custom_field', operand: 'cf1', operator: 'starts_with' })).chave,
    ).toBe('condition')
  })
})

describe('descreverPasso — texto', () => {
  it('mensagem longa é cortada com reticência', () => {
    const r = descreverPasso(passo('send_message', { text: 'a'.repeat(200) }))
    expect(String(r.valores.alvo)).toHaveLength(40)
    expect(String(r.valores.alvo).endsWith('…')).toBe(true)
  })

  it('só a PRIMEIRA linha entra — o cartão tem uma linha', () => {
    const r = descreverPasso(passo('send_message', { text: 'Olá!\nSegunda linha' }))
    expect(r.valores.alvo).toBe('Olá!')
  })

  it('texto ausente não vira "undefined" na tela', () => {
    expect(descreverPasso(passo('send_message', {})).valores.alvo).toBe('')
  })
})

describe('send_to_number (977)', () => {
  it('mostra o número legível, com o 55 que o motor acrescenta', () => {
    expect(descreverPasso(passo('send_to_number', { phone: '(83) 98000-0016' })).valores.alvo).toBe('(83) 98000-0016')
    expect(descreverPasso(passo('send_to_number', { phone: '5583980000016' })).valores.alvo).toBe('(83) 98000-0016')
  })

  it('telefone ausente não vira "undefined"', () => {
    expect(descreverPasso(passo('send_to_number', {})).valores.alvo).toBe('')
  })

  it('telefone que a régua recusa aparece como foi escrito, nunca formatado', () => {
    // Formatado pelos dígitos crus, "98000-0016" viraria "+980000016" — o
    // destino errado que a régua existe para impedir, escrito no cartão.
    expect(descreverPasso(passo('send_to_number', { phone: ' 98000-0016 ' })).valores.alvo).toBe('98000-0016')
    expect(descreverPasso(passo('send_to_number', { phone: '123456789012345@lid' })).valores.alvo).toBe('123456789012345@lid')
  })
})

// ------------------------------------------------------------
// A trava contra MISSING_MESSAGE.
// ------------------------------------------------------------

// ⚠️ Um `Record` sobre o TIPO, não uma lista digitada: tipo de passo novo
// sem entrada aqui não compila — a lista à mão deixava um tipo novo passar
// verde com o cartão mostrando a chave crua (mapa da F2 dos agentes de IA).
const TODOS_OS_TIPOS: Record<AutomationStepType, true> = {
  send_message: true, send_buttons: true, send_list: true, send_template: true, add_tag: true,
  remove_tag: true, assign_conversation: true, update_contact_field: true, create_deal: true,
  move_deal_stage: true, set_deal_status: true, run_automation: true, stop_automation: true,
  run_flow: true, stop_flow: true, set_ai: true, send_media: true,
  wait: true, condition: true, send_webhook: true, close_conversation: true,
  send_to_number: true, create_task: true,
}
const TIPOS_DE_PASSO = Object.keys(TODOS_OS_TIPOS) as AutomationStepType[]

// Configs que exercitam TODAS as variantes de chave, não só o caminho padrão.
const VARIANTES: Array<[string, Record<string, unknown>]> = [
  ['set_deal_status', { status: 'won' }],
  ['set_deal_status', { status: 'lost' }],
  ['set_deal_status', { status: 'open' }],
  ['set_ai', { enabled: true }],
  ['set_ai', { enabled: false }],
  ['send_media', { kind: 'image' }],
  ['send_media', { kind: 'video' }],
  ['send_media', { kind: 'document' }],
  ['send_media', { kind: 'audio' }],
  ['wait', { unit: 'seconds' }],
  ['wait', { unit: 'minutes' }],
  ['wait', { unit: 'hours' }],
  ['wait', { unit: 'days' }],
  // "Parar se o cliente responder" troca a CHAVE, não só o texto: sem estas
  // quatro linhas o cartão da grade mostraria
  // `Pipelines.automacoes.resumo.wait_hours_ou_resposta`, cru.
  ['wait', { unit: 'seconds', parar_se_responder: true }],
  ['wait', { unit: 'minutes', parar_se_responder: true }],
  ['wait', { unit: 'hours', parar_se_responder: true }],
  ['wait', { unit: 'days', parar_se_responder: true }],
  // "Aguardar até estar dentro do horário" (B6a): quatro chaves próprias.
  ['wait', { modo: 'horario', janela: '08:00-21:00' }],
  ['wait', { modo: 'horario', janela: '08:00-21:00', somente_seg_a_sex: true }],
  ['wait', { modo: 'horario', janela: '08:00-21:00', parar_se_responder: true }],
  ['wait', { modo: 'horario', janela: '08:00-21:00', somente_seg_a_sex: true, parar_se_responder: true }],
  // Condição por CAMPO PERSONALIZADO (2.10): uma chave por operador.
  ['condition', { subject: 'custom_field', operand: 'cf1', operator: 'equals', value: 'x' }],
  ['condition', { subject: 'custom_field', operand: 'cf1', operator: 'contains', value: 'x' }],
  ['condition', { subject: 'custom_field', operand: 'cf1', operator: 'empty' }],
  ['condition', { subject: 'custom_field', operand: 'cf1', operator: 'not_empty' }],
  // "Alterar campo do contato": os três campos fixos têm frase própria.
  ['update_contact_field', { field: 'name' }],
  ['update_contact_field', { field: 'email' }],
  ['update_contact_field', { field: 'company' }],
]

function resumoDoDicionario(arquivo: string): Record<string, string> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'))
  return bruto.Pipelines.automacoes.resumo
}

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const resumo = resumoDoDicionario(arquivo)

  it('CRÍTICO: todo tipo de passo tem chave de resumo', () => {
    // Sem isto, adicionar um passo novo ao motor sem tocar no dicionário
    // coloca o caminho da chave, cru, dentro do cartão do funil. Já
    // aconteceu neste projeto com outras telas.
    const semChave = TIPOS_DE_PASSO.map((t) => descreverPasso(passo(t)).chave).filter(
      (c) => !(c in resumo),
    )
    expect(semChave).toEqual([])
  })

  it('CRÍTICO: toda VARIANTE de chave também existe', () => {
    const semChave = VARIANTES.map(([t, cfg]) => descreverPasso(passo(t, cfg)).chave).filter(
      (c) => !(c in resumo),
    )
    expect(semChave).toEqual([])
  })

  it('não sobra chave órfã no dicionário', () => {
    // Chave que ninguém usa é texto que envelhece sem ninguém notar.
    const usadas = new Set([
      ...TIPOS_DE_PASSO.map((t) => descreverPasso(passo(t)).chave),
      ...VARIANTES.map(([t, cfg]) => descreverPasso(passo(t, cfg)).chave),
    ])
    expect(Object.keys(resumo).filter((k) => !usadas.has(k))).toEqual([])
  })
})
