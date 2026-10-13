import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// A conversa que o WEBHOOK DE ENTRADA cria nasce ENCERRADA (pedido do
// operador, 21/09/2026, para o lead do Typebot). A que já existia não é
// tocada: o passo "Encerrar conversa" fecharia TODAS as conversas do
// contato, inclusive a que o SDR está atendendo agora.
// ============================================================

const busca = vi.hoisted(() => ({
  findExistingContact: vi.fn(),
  fichaQueVenceu: vi.fn(),
  isUniqueViolation: () => false,
}))
vi.mock('@/lib/contacts/dedupe', () => busca)

import { conversaDoContato, resolverDestinatario } from './destinatario'

let conversasExistentes: { id: string }[] = []
let insercoes: { tabela: string; payload: Record<string, unknown> }[] = []
let cabecalhos: [string, string][] = []

const db = {
  from(tabela: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      insert: (payload: Record<string, unknown>) => {
        insercoes.push({ tabela, payload })
        return b
      },
      setHeader: (nome: string, valor: string) => {
        cabecalhos.push([nome, valor])
        return b
      },
      maybeSingle: async () => ({ data: { owner_user_id: 'dono-1' }, error: null }),
      single: async () => ({ data: { id: tabela === 'contacts' ? 'contato-novo' : 'conversa-nova' }, error: null }),
      then: (f: (v: unknown) => unknown) =>
        Promise.resolve({ data: tabela === 'conversations' ? conversasExistentes : [], error: null }).then(f),
    }
    return b
  },
} as unknown as SupabaseClient

beforeEach(() => {
  conversasExistentes = []
  insercoes = []
  cabecalhos = []
  busca.findExistingContact.mockReset().mockResolvedValue({ contato: null, falhou: false })
})

const WEBHOOK = { via: 'webhook' } as const
const AGENDAMENTO = { via: 'agendamento' } as const
const MOTOR = { via: 'automacao', ref: 'automacao-1' } as const

const conversaInserida = () => insercoes.find((i) => i.tabela === 'conversations')?.payload

describe('resolverDestinatario — a situação da conversa que nasce', () => {
  it('CRÍTICO: com conversaNovaEncerrada, a conversa nova nasce ENCERRADA', async () => {
    const r = await resolverDestinatario(db, 'conta-1', '5585999998888', 'Maria', { conversaNovaEncerrada: true, origem: WEBHOOK })

    expect(r).toEqual({ contactId: 'contato-novo', conversationId: 'conversa-nova', criouContato: true })
    expect(conversaInserida()).toMatchObject({ account_id: 'conta-1', user_id: 'dono-1', status: 'closed' })
  })

  it('sem a opção (Calendly, aviso à equipe), a conversa nova nasce como sempre', async () => {
    await resolverDestinatario(db, 'conta-1', '5585999998888', 'Maria', { origem: AGENDAMENTO })

    expect(conversaInserida()).toBeDefined()
    expect(conversaInserida()).not.toHaveProperty('status')
  })

  it('CRÍTICO: conversa que já existia NÃO é tocada, nem com a opção', async () => {
    busca.findExistingContact.mockResolvedValue({ contato: { id: 'contato-velho' }, falhou: false })
    conversasExistentes = [{ id: 'conversa-ativa' }]

    const r = await resolverDestinatario(db, 'conta-1', '5585999998888', 'Maria', { conversaNovaEncerrada: true, origem: WEBHOOK })

    expect(r).toEqual({ contactId: 'contato-velho', conversationId: 'conversa-ativa', criouContato: false })
    expect(insercoes).toEqual([])
  })
})

describe('conversaDoContato — a ficha que já existe (o agendamento do Calendly)', () => {
  it('CRÍTICO: ficha sem conversa ganha uma ABERTA, com o dono da conta', async () => {
    const id = await conversaDoContato(db, 'conta-1', 'contato-da-api', { origem: AGENDAMENTO })

    expect(id).toBe('conversa-nova')
    expect(conversaInserida()).toEqual({ account_id: 'conta-1', user_id: 'dono-1', contact_id: 'contato-da-api' })
  })

  it('conversa que já existe é devolvida, e nada é inserido', async () => {
    conversasExistentes = [{ id: 'conversa-ativa' }]

    expect(await conversaDoContato(db, 'conta-1', 'contato-da-api', { origem: AGENDAMENTO })).toBe('conversa-ativa')
    expect(insercoes).toEqual([])
  })
})

describe('conversaDoContato — o passo de envio do motor (27/09/2026)', () => {
  it('CRÍTICO: com conversaNovaEncerrada, a ficha sem conversa ganha uma ENCERRADA, com o dono da conta', async () => {
    const id = await conversaDoContato(db, 'conta-1', 'lead-da-api', { conversaNovaEncerrada: true, origem: MOTOR })

    expect(id).toBe('conversa-nova')
    expect(conversaInserida()).toEqual({
      account_id: 'conta-1',
      user_id: 'dono-1',
      contact_id: 'lead-da-api',
      status: 'closed',
    })
  })

  it('CRÍTICO: conversa que já existe NÃO é tocada, nem com a opção', async () => {
    conversasExistentes = [{ id: 'conversa-ativa' }]

    expect(await conversaDoContato(db, 'conta-1', 'lead-da-api', { conversaNovaEncerrada: true, origem: MOTOR })).toBe('conversa-ativa')
    expect(insercoes).toEqual([])
  })
})

describe('a origem da conversa criada vai para a trilha (1083)', () => {
  it('a criação leva o x-cb-via (e o x-cb-ref da automação) do chamador', async () => {
    await conversaDoContato(db, 'conta-1', 'lead-da-api', { conversaNovaEncerrada: true, origem: MOTOR })

    expect(cabecalhos).toEqual([
      ['x-cb-via', 'automacao'],
      ['x-cb-ref', 'automacao-1'],
    ])
  })

  it('conversa que já existia não manda cabeçalho nenhum (nada foi escrito)', async () => {
    conversasExistentes = [{ id: 'conversa-ativa' }]

    await resolverDestinatario(db, 'conta-1', '5585999998888', 'Maria', { origem: WEBHOOK })

    expect(cabecalhos).toEqual([])
  })
})
