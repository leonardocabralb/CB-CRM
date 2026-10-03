import { describe, expect, it } from 'vitest'

import en from '../../../messages/en.json'
import ptBR from '../../../messages/pt-BR.json'
import { CHAVES_DO_MOTOR, ehAvisoDeTentativa, lerTextoDoMotor } from './texto-do-motor'

// ============================================================
// Os textos do motor, em português, no "Já rodou" (decisão do operador,
// 29/09/2026). Os casos são os medidos em produção naquele dia.
// ============================================================

describe('lerTextoDoMotor', () => {
  it('o que só confirma o que o ✓ já diz some (vira ruído numa lista de 13 passos)', () => {
    for (const t of [
      'sent (3EB05E5CB9845CC3335E71)',
      'template sent (wamid.x)',
      'image enviado (abc)',
      'waiting 30 seconds',
      'waiting 15 minutes (para se o cliente responder)',
      'tag "Cliente" added and tag_added dispatched',
      'custom field updated',
      'name updated',
      'email updated',
      'deal created',
      'negócio marcado won',
      'conversation closed',
    ]) {
      expect(lerTextoDoMotor(t), t).toEqual([])
    }
  })

  it('traduz os que dizem algo novo', () => {
    expect(lerTextoDoMotor('tag "Cliente" already present')).toEqual([{ chave: 'etiquetaJaEstava', valores: {} }])
    expect(lerTextoDoMotor('deal already existed')).toEqual([{ chave: 'cardJaExistia', valores: {} }])
    expect(lerTextoDoMotor('negócio movido para "Comercial › Contrato"')).toEqual([
      { chave: 'cardMovido', valores: { etapa: '"Comercial › Contrato"' } },
    ])
    expect(lerTextoDoMotor('tarefa criada ("Enviar contrato")')).toEqual([
      { chave: 'tarefaCriada', valores: { tarefa: '"Enviar contrato"' } },
    ])
    expect(lerTextoDoMotor('sent to 5583999990000 (3EB0)')).toEqual([
      { chave: 'enviadaPara', valores: { numero: '5583999990000' } },
    ])
    expect(lerTextoDoMotor('custom:x not updated: empty value')).toEqual([{ chave: 'campoVazio', valores: {} }])
    expect(lerTextoDoMotor('field custom:x not writable from automations')).toEqual([
      { chave: 'campoNaoGravavel', valores: {} },
    ])
    expect(lerTextoDoMotor('send_webhook: destination not allowed')).toEqual([
      { chave: 'webhookBloqueado', valores: {} },
    ])
    expect(lerTextoDoMotor('Error: Connection Closed')).toEqual([{ chave: 'conexaoCaiu', valores: {} }])
    expect(lerTextoDoMotor('number 5511900000000 is not on WhatsApp')).toEqual([
      { chave: 'semWhatsApp', valores: { numero: '5511900000000' } },
    ])
  })

  it('a condição diz o ramo, e a nota (já em português) vem junto', () => {
    expect(lerTextoDoMotor('branch=no')).toEqual([{ chave: 'ramoNao', valores: {} }])
    expect(lerTextoDoMotor('branch=yes (hora no escritório: dom 18:57)')).toEqual([
      { chave: 'ramoSim', valores: {} },
      { texto: 'hora no escritório: dom 18:57' },
    ])
  })

  it('o status do webhook vira o que ele quer dizer', () => {
    expect(lerTextoDoMotor('webhook returned 404')).toEqual([{ chave: 'webhookNaoEncontrado', valores: { status: 404 } }])
    expect(lerTextoDoMotor('webhook returned 403')).toEqual([{ chave: 'webhookRecusou', valores: { status: 403 } }])
    expect(lerTextoDoMotor('webhook returned 502')).toEqual([{ chave: 'webhookErroNoDestino', valores: { status: 502 } }])
    expect(lerTextoDoMotor('webhook returned 422')).toEqual([{ chave: 'webhookStatus', valores: { status: 422 } }])
    expect(lerTextoDoMotor('webhook 200')).toEqual([{ chave: 'webhookOk', valores: { status: 200 } }])
  })

  it('a retentativa: a base traduzida e o sufixo à parte', () => {
    const t = 'Error: Connection Closed — tentativa 1 de 3; nova tentativa em 30s'
    expect(ehAvisoDeTentativa(t)).toBe(true)
    expect(lerTextoDoMotor(t)).toEqual([
      { chave: 'conexaoCaiu', valores: {} },
      { chave: 'tentativa', valores: { n: 1, de: 3, segundos: 30 } },
    ])
    expect(lerTextoDoMotor('recusado pela Evolution — desisti depois de 3 tentativas')).toEqual([
      { texto: 'recusado pela Evolution' },
      { chave: 'desistiu', valores: { n: 3 } },
    ])
    expect(lerTextoDoMotor('x — não reenfileirada: a execução já foi interrompida')).toEqual([
      { texto: 'x' },
      { chave: 'naoRepetiu', valores: {} },
    ])
    expect(ehAvisoDeTentativa('x — desisti depois de 3 tentativas')).toBe(false)
  })

  it('texto desconhecido NUNCA some: volta como está', () => {
    expect(lerTextoDoMotor('dentro do horário (seg 09:45); segue')).toEqual([
      { texto: 'dentro do horário (seg 09:45); segue' },
    ])
    expect(lerTextoDoMotor('algo novo do motor')).toEqual([{ texto: 'algo novo do motor' }])
    expect(lerTextoDoMotor('')).toEqual([])
    expect(lerTextoDoMotor(null)).toEqual([])
  })
})

describe('as frases nos dois dicionários (chave montada)', () => {
  type Arvore = Record<string, unknown>
  const motor = (m: unknown) => ((m as { Inbox: { execucoes: Arvore } }).Inbox.execucoes.motor ?? {}) as Arvore
  for (const [idioma, dic] of [
    ['pt-BR', ptBR],
    ['en', en],
  ] as const) {
    it(`${idioma}: toda chave que a leitura devolve existe`, () => {
      for (const chave of CHAVES_DO_MOTOR) {
        expect(typeof motor(dic)[chave], `${idioma} Inbox.execucoes.motor.${chave}`).toBe('string')
      }
    })
    it(`${idioma}: nenhuma frase órfã`, () => {
      const conhecidas = new Set<string>(CHAVES_DO_MOTOR)
      for (const chave of Object.keys(motor(dic))) {
        expect(conhecidas.has(chave), `${idioma} motor.${chave} sem uso`).toBe(true)
      }
    })
  }

  it('CHAVES_DO_MOTOR cobre tudo que a tabela produz', () => {
    const amostras = [
      'sent to 1 (x)',
      'tag a already present',
      'no agent resolved',
      'agent a is suspended — conversation left unassigned',
      'a not updated: empty value',
      'field a not writable from automations',
      'name not updated: the value is not a name',
      'deal already existed',
      'negócio movido para a',
      'branch=yes',
      'branch=no',
      'webhook 200',
      'webhook returned 404',
      'webhook returned 401',
      'webhook returned 500',
      'webhook returned 418',
      'send_webhook: destination not allowed',
      'tarefa criada (a)',
      'Connection Closed',
      'number 1 is not on WhatsApp',
      'a — tentativa 1 de 3; nova tentativa em 30s',
      'a — desisti depois de 3 tentativas',
      'a — não reenfileirada: a execução já foi interrompida',
    ]
    const produzidas = new Set(
      amostras.flatMap((t) => lerTextoDoMotor(t)).flatMap((p) => ('chave' in p ? [p.chave] : [])),
    )
    expect([...produzidas].sort()).toEqual([...CHAVES_DO_MOTOR].sort())
  })
})
