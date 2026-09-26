import { describe, expect, it } from 'vitest'

import { isValidE164, sanitizePhoneForMeta } from './phone-utils'
import {
  alvoDeEnvio,
  alvoDoRobo,
  FRASE_SO_NUMERO_OFICIAL,
  modeloExigeTelefone,
} from './alvo-de-envio'

// ============================================================
// A matriz do destino de envio (Fase 11.3): transporte × identidade.
// Telefone válido vale em qualquer transporte; o BSUID, SÓ na API oficial
// da Meta; o `wa_parent_user_id` e o LID nunca são alvo.
// ============================================================

const BSUID = 'BR.13491208655302741918'
const PAI = 'BR.ENT.11815799212886844830'
const META = { kind: 'meta' }
const EVOLUTION = { kind: 'evolution' }
const INSTAGRAM = { kind: 'instagram' }

describe('alvoDeEnvio — a matriz', () => {
  const casos: Array<{
    nome: string
    contato: { phone?: string | null; wa_user_id?: string | null; wa_parent_user_id?: string | null } | null
    canal: { kind: string }
    esperado: ReturnType<typeof alvoDeEnvio>
  }> = [
    { nome: 'Meta + telefone', contato: { phone: '+55 83 98888-7777' }, canal: META, esperado: { ok: true, alvo: '5583988887777', ehTelefone: true } },
    { nome: 'Evolution + telefone', contato: { phone: '+55 83 98888-7777' }, canal: EVOLUTION, esperado: { ok: true, alvo: '5583988887777', ehTelefone: true } },
    { nome: 'Meta + só BSUID', contato: { phone: null, wa_user_id: BSUID }, canal: META, esperado: { ok: true, alvo: BSUID, ehTelefone: false } },
    { nome: 'Evolution + só BSUID', contato: { phone: null, wa_user_id: BSUID }, canal: EVOLUTION, esperado: { ok: false, motivo: 'so_numero_oficial' } },
    { nome: 'Instagram + só BSUID', contato: { phone: null, wa_user_id: BSUID }, canal: INSTAGRAM, esperado: { ok: false, motivo: 'so_numero_oficial' } },
    { nome: 'Meta + telefone E BSUID: o telefone vence', contato: { phone: '5583988887777', wa_user_id: BSUID }, canal: META, esperado: { ok: true, alvo: '5583988887777', ehTelefone: true } },
    { nome: 'Evolution + telefone E BSUID: o telefone', contato: { phone: '5583988887777', wa_user_id: BSUID }, canal: EVOLUTION, esperado: { ok: true, alvo: '5583988887777', ehTelefone: true } },
    { nome: 'Meta + telefone inválido + BSUID: cai no BSUID', contato: { phone: '123', wa_user_id: BSUID }, canal: META, esperado: { ok: true, alvo: BSUID, ehTelefone: false } },
    { nome: 'Evolution + telefone inválido + BSUID: recusa', contato: { phone: '123', wa_user_id: BSUID }, canal: EVOLUTION, esperado: { ok: false, motivo: 'so_numero_oficial' } },
    { nome: 'Meta + telefone inválido, sem BSUID', contato: { phone: '123' }, canal: META, esperado: { ok: false, motivo: 'sem_alvo' } },
    { nome: 'Evolution + telefone inválido, sem BSUID', contato: { phone: '123' }, canal: EVOLUTION, esperado: { ok: false, motivo: 'sem_alvo' } },
    { nome: 'Meta + nada', contato: { phone: null, wa_user_id: null }, canal: META, esperado: { ok: false, motivo: 'sem_alvo' } },
    { nome: 'contato nulo', contato: null, canal: META, esperado: { ok: false, motivo: 'sem_alvo' } },
    { nome: 'o PAI (portfólio) nunca é alvo', contato: { phone: null, wa_user_id: null, wa_parent_user_id: PAI }, canal: META, esperado: { ok: false, motivo: 'sem_alvo' } },
    { nome: 'wa_user_id sem forma de BSUID não é alvo', contato: { phone: null, wa_user_id: 'lixo' }, canal: META, esperado: { ok: false, motivo: 'sem_alvo' } },
    { nome: 'LID no lugar do BSUID não é aceito', contato: { phone: null, wa_user_id: '123456789012345@lid' }, canal: META, esperado: { ok: false, motivo: 'sem_alvo' } },
    // ⚠️ LID no lugar do TELEFONE não é assunto desta função: o telefone é
    // decidido pela régua `isValidE164(sanitizePhoneForMeta(...))` (a da
    // varredura do Asaas, provada igual logo abaixo), e a trava do LID mora na
    // ENTRADA — o LID jamais vira `contacts.phone` (1010).
  ]

  for (const c of casos) {
    it(c.nome, () => {
      expect(alvoDeEnvio(c.contato, c.canal)).toEqual(c.esperado)
    })
  }

  it('"tem telefone" é EXATAMENTE `isValidE164(sanitizePhoneForMeta(...))` — a régua do Asaas', () => {
    // A varredura da régua confere o telefone com esse predicado ANTES de
    // gravar a trava do marco; o remetente das automações (pela Evolution)
    // decide com `alvoDeEnvio`. Se os dois discordarem, telefone que passa lá
    // e é recusado aqui grava a trava e termina `falhou` sem nova chance.
    const amostras = [
      '+55 83 98888-7777',
      '5583988887777',
      '558388887777',
      '083988887777',
      '0055839888877',
      '123',
      '',
      '120363025246125888@g.us',
      '120363025246125888',
      '5583988887777@s.whatsapp.net',
      '123456789012345@lid',
      '+1 (555) 123-4567',
      '99999999999999999',
      'abc',
    ]
    for (const tel of amostras) {
      const r = alvoDeEnvio({ phone: tel }, EVOLUTION)
      expect({ tel, ok: r.ok }).toEqual({ tel, ok: isValidE164(sanitizePhoneForMeta(tel)) })
    }
  })
})

describe('alvoDoRobo — a recusa no idioma do motor', () => {
  it('devolve o alvo quando há', () => {
    expect(alvoDoRobo({ phone: null, wa_user_id: BSUID }, META)).toEqual({ alvo: BSUID, ehTelefone: false })
  })

  it('BSUID fora da Meta: diz que só o número oficial alcança', () => {
    expect(() => alvoDoRobo({ phone: null, wa_user_id: BSUID }, EVOLUTION)).toThrow(
      /only an official Meta number can reach it/,
    )
  })

  it('sem telefone nem BSUID: a ficha do Instagram', () => {
    expect(() => alvoDoRobo({ phone: null, wa_user_id: null }, META)).toThrow(/Instagram-only contact/)
  })

  it('telefone inválido: o motivo de sempre', () => {
    expect(() => alvoDoRobo({ phone: '123' }, META)).toThrow(/contact phone invalid: 123/)
  })
})

describe('FRASE_SO_NUMERO_OFICIAL', () => {
  it('é português e diz o que fazer', () => {
    expect(FRASE_SO_NUMERO_OFICIAL).toMatch(/número oficial/)
    expect(FRASE_SO_NUMERO_OFICIAL).toMatch(/Troque o canal/)
  })
})

describe('modeloExigeTelefone — o código de acesso só vai a telefone', () => {
  it('autenticação, na grafia local e na da Meta', () => {
    expect(modeloExigeTelefone({ category: 'Authentication' })).toBe(true)
    expect(modeloExigeTelefone({ category: 'AUTHENTICATION' })).toBe(true)
  })

  it('utilitário e marketing não', () => {
    expect(modeloExigeTelefone({ category: 'Utility' })).toBe(false)
    expect(modeloExigeTelefone({ category: 'MARKETING' })).toBe(false)
  })

  it('sem linha local (categoria desconhecida) não recusa: a Meta decide', () => {
    expect(modeloExigeTelefone(null)).toBe(false)
    expect(modeloExigeTelefone(undefined)).toBe(false)
    expect(modeloExigeTelefone({ category: null })).toBe(false)
  })
})
