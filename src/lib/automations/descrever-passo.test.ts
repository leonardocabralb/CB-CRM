import { readFileSync } from 'node:fs'
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

// ------------------------------------------------------------
// A trava contra MISSING_MESSAGE.
// ------------------------------------------------------------

const TIPOS_DE_PASSO = [
  'send_message', 'send_buttons', 'send_list', 'send_template', 'add_tag',
  'remove_tag', 'assign_conversation', 'update_contact_field', 'create_deal',
  'move_deal_stage', 'set_deal_status', 'run_automation', 'stop_automation',
  'run_flow', 'stop_flow', 'set_ai', 'send_media', 'wait', 'condition',
  'send_webhook', 'close_conversation',
] as const

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
  ['wait', { unit: 'minutes' }],
  ['wait', { unit: 'hours' }],
  ['wait', { unit: 'days' }],
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
