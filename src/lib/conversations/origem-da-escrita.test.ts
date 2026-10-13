import fs from 'node:fs'
import path from 'node:path'
import { PostgrestClient } from '@supabase/postgrest-js'
import { describe, expect, it } from 'vitest'

import {
  CABECALHO_ATOR,
  CABECALHO_REF,
  CABECALHO_VIA,
  marcarOrigem,
  VIAS,
} from './origem-da-escrita'

const ATOR = '11111111-2222-4333-8444-555555555555'
const REF = '66666666-7777-4888-9999-aaaaaaaaaaaa'

/** Cliente do postgrest-js DE VERDADE, com um `fetch` que só anota o pedido. */
function clienteQueAnota() {
  const pedidos: { url: string; metodo: string; cabecalhos: Headers }[] = []
  const fetchFalso: typeof fetch = async (entrada, init) => {
    pedidos.push({
      url: String(entrada),
      metodo: init?.method ?? 'GET',
      cabecalhos: new Headers(init?.headers),
    })
    return new Response(null, { status: 204 })
  }
  const cliente = new PostgrestClient('http://banco.invalido/rest/v1', { fetch: fetchFalso })
  return { cliente, pedidos }
}

describe('marcarOrigem', () => {
  it('os três cabeçalhos SAEM no pedido do postgrest-js de verdade', async () => {
    const { cliente, pedidos } = clienteQueAnota()

    const { error } = await marcarOrigem(
      cliente.from('conversations').update({ status: 'closed' }).eq('id', 'conv-1'),
      { via: 'automacao', ator: ATOR, ref: REF },
    )

    expect(error).toBeNull()
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].metodo).toBe('PATCH')
    expect(pedidos[0].cabecalhos.get(CABECALHO_VIA)).toBe('automacao')
    expect(pedidos[0].cabecalhos.get(CABECALHO_ATOR)).toBe(ATOR)
    expect(pedidos[0].cabecalhos.get(CABECALHO_REF)).toBe(REF)
  })

  it('vale no meio da cadeia: o INSERT com select().single() segue funcionando', async () => {
    const { cliente, pedidos } = clienteQueAnota()

    await marcarOrigem(cliente.from('conversations').insert({ contact_id: 'c' }), {
      via: 'cliente',
    })
      .select('id')
      .maybeSingle()

    expect(pedidos[0].metodo).toBe('POST')
    expect(pedidos[0].cabecalhos.get(CABECALHO_VIA)).toBe('cliente')
    // Sem ator nem ref, os cabeçalhos não vão — nada de string vazia que o
    // banco teria de recusar.
    expect(pedidos[0].cabecalhos.has(CABECALHO_ATOR)).toBe(false)
    expect(pedidos[0].cabecalhos.has(CABECALHO_REF)).toBe(false)
  })

  it('não mexe no cabeçalho que o cliente já manda (o x-cb-origem das rotas v1)', async () => {
    const pedidos: Headers[] = []
    const cliente = new PostgrestClient('http://banco.invalido/rest/v1', {
      headers: { 'x-cb-origem': 'api' },
      fetch: async (_e, init) => {
        pedidos.push(new Headers(init?.headers))
        return new Response(null, { status: 204 })
      },
    })

    await marcarOrigem(cliente.from('conversations').update({ status: 'open' }).eq('id', 'x'), {
      via: 'api',
    })

    expect(pedidos[0].get('x-cb-origem')).toBe('api')
    expect(pedidos[0].get(CABECALHO_VIA)).toBe('api')
  })

  it('dublê sem setHeader passa reto, sem derrubar a escrita', () => {
    const duble = { then: () => undefined }
    expect(marcarOrigem(duble, { via: 'cliente' })).toBe(duble)
  })
})

describe('a lista de origens é a MESMA do gatilho (1083)', () => {
  it('VIAS espelha o IN de cb_quem_mexeu_na_conversa', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '1083_cb_historico_da_conversa.sql'),
      'utf8',
    )
    const trecho = sql.match(/v_texto := v_cabecalhos ->> 'x-cb-via';\s*IF v_texto IN \(([^)]*)\)/)
    expect(trecho, 'a lista do gatilho mudou de forma — reveja o pino').not.toBeNull()
    const doGatilho = [...trecho![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
    expect(doGatilho).toEqual([...VIAS].sort())
  })

  it('os nomes dos cabeçalhos são os que o gatilho lê', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '1083_cb_historico_da_conversa.sql'),
      'utf8',
    )
    for (const nome of [CABECALHO_VIA, CABECALHO_ATOR, CABECALHO_REF]) {
      expect(sql).toContain(`v_cabecalhos ->> '${nome}'`)
    }
  })
})
