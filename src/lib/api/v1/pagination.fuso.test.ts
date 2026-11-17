import { describe, expect, it } from 'vitest'

import { decodeCursor, encodeCursor, parseListParams } from './pagination'

// NOSSO (porte do #681): os casos nossos do cursor moram aqui, e não no
// `pagination.test.ts` do original — dentro do teste dele virariam conflito
// add/add no próximo merge (`docs/MERGE-UPSTREAM.md`, §3.4). A regra está em
// `.claude/rules/api-v1.md` ("O cursor só passa com data ISO COM fuso").

const ID = '11111111-1111-4111-8111-111111111111'
const cursorDe = (ts: string) => Buffer.from(`${ts}|${ID}`, 'utf8').toString('base64url')
const pedido = (cursor: string) => new Request(`https://x.test/api/v1/contacts?cursor=${cursor}`)

describe('cursor da API v1 — a régua estrita', () => {
  it('o texto com parêntese, que o `Date.parse` do V8 lê como data, não passa', () => {
    // Era o que deixava sintaxe do PostgREST chegar ao `.or()` do
    // `keysetFilter`; o cursor recusado vira "sem cursor" (a 1ª página).
    const forjado = cursorDe('2020-01-01 (,id.not.is.null)')
    expect(decodeCursor(forjado)).toBeNull()
    expect(parseListParams(pedido(forjado)).cursor).toBeNull()
  })

  it('o cursor que o próprio CRM emite passa: a data do PostgREST para `timestamptz`', () => {
    for (const created_at of [
      '2026-11-17T12:34:56.123456+00:00',
      '2026-11-17T12:34:56+00:00',
      '2026-11-17T12:34:56.1+00:00',
    ]) {
      expect(decodeCursor(encodeCursor({ created_at, id: ID }))).toEqual({
        createdAt: created_at,
        id: ID,
      })
    }
  })

  it('⚠️ data SEM fuso é recusada: lista paginada nova sobre coluna sem fuso perderia o próprio cursor', () => {
    // As nove tabelas paginadas têm `created_at timestamptz`, e o PostgREST
    // sempre manda o fuso. Este pino deixa a escolha escrita: quem relaxar a
    // régua, ou paginar uma coluna sem fuso (o n8n repetiria a 1ª página sem
    // erro), vê aqui por quê.
    expect(decodeCursor(cursorDe('2026-11-17T12:34:56.123456'))).toBeNull()
  })
})
