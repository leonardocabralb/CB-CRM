import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// 1139: quem recebe o aviso da transferência (`avisar_ao_transferir`) é
// conferido contra a CONTA no salvar e no rascunho do Playground (a mesma
// `conferirReferencias`): a lista é um array sem FK gravado em service role,
// e sem a conferência um id de outra conta receberia o aviso — com o nome de
// um cliente que não é dele.
// ============================================================

/** Os perfis da conta, como o banco os devolveria. */
let perfis: { user_id: string; account_id: string }[] = []
let falhaNaLeitura = false
const consultas: { tabela: string; filtros: Array<[string, string, unknown]> }[] = []

vi.mock('@/lib/ia-chaves/repo', () => ({ lerEstado: vi.fn(async () => []) }))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      const consulta = { tabela, filtros: [] as Array<[string, string, unknown]> }
      consultas.push(consulta)
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: (c: string, v: unknown) => {
          consulta.filtros.push(['eq', c, v])
          return cadeia
        },
        in: (c: string, v: unknown) => {
          consulta.filtros.push(['in', c, v])
          return cadeia
        },
        then: (ok: (r: unknown) => unknown) => {
          if (falhaNaLeitura) return Promise.resolve({ data: null, error: { message: 'fora do ar' } }).then(ok)
          const conta = consulta.filtros.find(([, c]) => c === 'account_id')?.[2]
          const ids = (consulta.filtros.find(([m, c]) => m === 'in' && c === 'user_id')?.[2] ?? []) as string[]
          const data = perfis.filter((p) => p.account_id === conta && ids.includes(p.user_id))
          return Promise.resolve({ data, error: null }).then(ok)
        },
      }
      return cadeia
    },
  }),
}))

import { lerLinhaDoAgente } from './agente'
import { conferirRascunho, ErroDoAgente } from './repo'

const CONTA = 'conta-1'
const ANA = '11111111-1111-4111-8111-111111111111'
const BIA = '22222222-2222-4222-8222-222222222222'
const SALVO = lerLinhaDoAgente({ id: 'ag-1', account_id: CONTA, provedor: 'gemini', modelo: 'm' })!

beforeEach(() => {
  perfis = [
    { user_id: ANA, account_id: CONTA },
    { user_id: BIA, account_id: 'outra-conta' },
  ]
  falhaNaLeitura = false
  consultas.length = 0
})

async function codigoDe(promessa: Promise<unknown>): Promise<string | null> {
  try {
    await promessa
    return null
  } catch (err) {
    return err instanceof ErroDoAgente ? err.codigo : String(err)
  }
}

describe('conferirReferencias — avisar_ao_transferir (1139)', () => {
  it('membros desta conta passam', async () => {
    expect(await codigoDe(conferirRascunho(CONTA, SALVO, { avisarAoTransferir: [ANA] }))).toBeNull()
    const leitura = consultas.find((c) => c.tabela === 'profiles')
    expect(leitura?.filtros).toContainEqual(['eq', 'account_id', CONTA])
  })

  it('id de OUTRA conta recusa com membro_de_outra_conta', async () => {
    expect(await codigoDe(conferirRascunho(CONTA, SALVO, { avisarAoTransferir: [ANA, BIA] }))).toBe(
      'membro_de_outra_conta',
    )
  })

  it('lista vazia nem lê os membros', async () => {
    expect(await codigoDe(conferirRascunho(CONTA, SALVO, { avisarAoTransferir: [] }))).toBeNull()
    expect(consultas.some((c) => c.tabela === 'profiles')).toBe(false)
  })

  it('leitura que falha é `banco` (500), nunca "de outra conta"', async () => {
    falhaNaLeitura = true
    expect(await codigoDe(conferirRascunho(CONTA, SALVO, { avisarAoTransferir: [ANA] }))).toBe('banco')
  })
})
