import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { STUN_PADRAO, TETO_DO_CORPO, criarServidor, lerPedido, type Comandos } from './servidor.js'
import type { PedidoDeLigacao, Resultado } from './tipos.js'

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres'
const PEDIDO = { ligacao: 'lig-1', numero: '5511987654321', oferta: 'v=0 oferta' }

function comandosFalsos(resultado: Resultado = { ok: true, resposta: 'v=0 resposta' }) {
  const pedidos: { rota: string; pedido: PedidoDeLigacao | string }[] = []
  const comandos: Comandos = {
    estado: () => ({ whatsapp: 'conectado', ligacao: null, chrome: '157.0.0.0' }),
    qr: async () => null,
    ligar: async (pedido) => (pedidos.push({ rota: 'ligar', pedido }), resultado),
    atender: async (pedido) => (pedidos.push({ rota: 'atender', pedido }), resultado),
    desligar: async (ligacao) => (pedidos.push({ rota: 'desligar', pedido: ligacao }), { ok: true }),
  }
  return { comandos, pedidos }
}

const abertos: { close(): void }[] = []
afterEach(() => abertos.splice(0).forEach((s) => s.close()))

async function subir(comandos: Comandos) {
  const servidor = criarServidor(SEGREDO, comandos, () => {})
  abertos.push(servidor)
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto))
  const { port } = servidor.address() as AddressInfo
  return (caminho: string, init: RequestInit & { segredo?: string | null } = {}) =>
    fetch(`http://127.0.0.1:${port}${caminho}`, {
      ...init,
      headers: {
        ...(init.segredo === null ? {} : { authorization: `Bearer ${init.segredo ?? SEGREDO}` }),
        'content-type': 'application/json',
      },
    })
}

describe('a API interna', () => {
  it('sem o segredo, ou com outro, é 401', async () => {
    const pedir = await subir(comandosFalsos().comandos)
    expect((await pedir('/estado', { segredo: null })).status).toBe(401)
    expect((await pedir('/estado', { segredo: 'outro-segredo-qualquer-com-32-caracteres!' })).status).toBe(401)
    expect((await pedir('/estado')).status).toBe(200)
  })

  it('estado e QR', async () => {
    const { comandos } = comandosFalsos()
    const pedir = await subir(comandos)
    expect(await (await pedir('/estado')).json()).toEqual({ whatsapp: 'conectado', ligacao: null, chrome: '157.0.0.0' })
    expect((await pedir('/qr')).status).toBe(404)
    comandos.qr = async () => 'data:image/png;base64,QR'
    expect(await (await pedir('/qr')).json()).toEqual({ qr: 'data:image/png;base64,QR' })
  })

  it('ligar: confere o pedido e devolve a resposta WebRTC', async () => {
    const { comandos, pedidos } = comandosFalsos()
    const pedir = await subir(comandos)
    const resposta = await pedir('/ligar', { method: 'POST', body: JSON.stringify(PEDIDO) })
    expect(resposta.status).toBe(200)
    expect(await resposta.json()).toEqual({ resposta: 'v=0 resposta' })
    expect(pedidos).toEqual([{ rota: 'ligar', pedido: { ...PEDIDO, ice: STUN_PADRAO } }])
  })

  it('as recusas viram status', async () => {
    const pedir = await subir(comandosFalsos({ ok: false, recusa: 'ocupada' }).comandos)
    const ocupada = await pedir('/atender', { method: 'POST', body: JSON.stringify(PEDIDO) })
    expect(ocupada.status).toBe(409)
    expect(await ocupada.json()).toEqual({ erro: 'ocupada' })

    const desconectado = await subir(comandosFalsos({ ok: false, recusa: 'whatsapp_desconectado' }).comandos)
    expect((await desconectado('/ligar', { method: 'POST', body: JSON.stringify(PEDIDO) })).status).toBe(503)
  })

  it('pedido ruim, JSON ruim, corpo grande e rota desconhecida', async () => {
    const { comandos, pedidos } = comandosFalsos()
    const pedir = await subir(comandos)
    expect((await pedir('/ligar', { method: 'POST', body: JSON.stringify({ ...PEDIDO, numero: '12ab' }) })).status).toBe(400)
    expect((await pedir('/ligar', { method: 'POST', body: '{nao é json' })).status).toBe(400)
    expect((await pedir('/ligar', { method: 'POST', body: 'x'.repeat(TETO_DO_CORPO + 1) })).status).toBe(413)
    expect((await pedir('/desligar', { method: 'POST', body: JSON.stringify({ ligacao: '../x' }) })).status).toBe(400)
    expect((await pedir('/apagar', { method: 'POST', body: '{}' })).status).toBe(404)
    expect((await pedir('/ligar')).status).toBe(404)
    expect(pedidos).toEqual([])
  })

  it('desligar', async () => {
    const { comandos, pedidos } = comandosFalsos()
    const pedir = await subir(comandos)
    expect((await pedir('/desligar', { method: 'POST', body: JSON.stringify({ ligacao: 'lig-1' }) })).status).toBe(200)
    expect(pedidos).toEqual([{ rota: 'desligar', pedido: 'lig-1' }])
  })
})

describe('lerPedido', () => {
  it('confere cada campo', () => {
    expect(lerPedido(PEDIDO)).toEqual({ ...PEDIDO, ice: STUN_PADRAO })
    expect(lerPedido({ ...PEDIDO, ligacao: 'lig/1' })).toBeNull()
    expect(lerPedido({ ...PEDIDO, numero: '123' })).toBeNull()
    expect(lerPedido({ ...PEDIDO, oferta: 'qualquer coisa' })).toBeNull()
    expect(lerPedido(null)).toBeNull()
  })

  it('servidores ICE: só stun/turn, com no máximo 5; vazio vira o STUN padrão', () => {
    const turn = { urls: ['turn:turn.exemplo.test:3478'], username: 'u', credential: 'c' }
    expect(lerPedido({ ...PEDIDO, ice: [turn] })?.ice).toEqual([turn])
    expect(lerPedido({ ...PEDIDO, ice: [] })?.ice).toEqual(STUN_PADRAO)
    expect(lerPedido({ ...PEDIDO, ice: [{ urls: 'https://exemplo.test' }] })).toBeNull()
    expect(lerPedido({ ...PEDIDO, ice: Array(6).fill({ urls: 'stun:a.test' }) })).toBeNull()
  })
})
