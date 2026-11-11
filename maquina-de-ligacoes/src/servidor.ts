/**
 * A API interna da máquina (docs/PLANO-ligar-pelo-crm.md, §8.13). Escuta só na
 * rede LigacoesNet (nenhuma porta publicada) e só aceita quem traz o segredo
 * no cabeçalho: na 4a, a bancada; da 4b em diante, o CRM.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { EstadoPublico, PedidoDeLigacao, Recusa, Resultado, ServidorIce } from './tipos.js'

export const PORTA_DA_API = 8080
/** A oferta WebRTC tem uns 5–10 KB; o teto só barra o absurdo. */
export const TETO_DO_CORPO = 256 * 1024
/** Sem servidor ICE do CRM, a máquina descobre o próprio endereço público por este STUN. */
export const STUN_PADRAO: ServidorIce[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export interface Comandos {
  estado(): EstadoPublico
  qr(): Promise<string | null>
  ligar(pedido: PedidoDeLigacao): Promise<Resultado>
  atender(pedido: PedidoDeLigacao): Promise<Resultado>
  desligar(ligacao: string): Promise<Resultado>
}

export const STATUS_DA_RECUSA: Record<Recusa, number> = {
  ocupada: 409,
  nada_tocando: 409,
  outra_chamada: 409,
  nao_encontrada: 404,
  whatsapp_desconectado: 503,
  oferta_invalida: 400,
  falhou: 500,
}

const ID_DA_LIGACAO = /^[A-Za-z0-9-]{1,64}$/
const NUMERO = /^\d{10,15}$/

function lerIce(valor: unknown): ServidorIce[] | null {
  if (valor === undefined) return STUN_PADRAO
  if (!Array.isArray(valor) || valor.length > 5) return null
  const lista: ServidorIce[] = []
  for (const item of valor) {
    if (!item || typeof item !== 'object') return null
    const { urls, username, credential } = item as Record<string, unknown>
    const enderecos = typeof urls === 'string' ? [urls] : urls
    if (!Array.isArray(enderecos) || enderecos.length === 0) return null
    if (!enderecos.every((u) => typeof u === 'string' && /^(stun|turns?):/.test(u))) return null
    if (username !== undefined && typeof username !== 'string') return null
    if (credential !== undefined && typeof credential !== 'string') return null
    lista.push({ urls: enderecos as string[], ...(username ? { username } : {}), ...(credential ? { credential } : {}) })
  }
  return lista.length > 0 ? lista : STUN_PADRAO
}

/** O pedido de ligar ou atender, conferido campo a campo; nulo = 400. */
export function lerPedido(corpo: unknown): PedidoDeLigacao | null {
  if (!corpo || typeof corpo !== 'object') return null
  const { ligacao, numero, oferta, ice } = corpo as Record<string, unknown>
  if (typeof ligacao !== 'string' || !ID_DA_LIGACAO.test(ligacao)) return null
  if (typeof numero !== 'string' || !NUMERO.test(numero)) return null
  if (typeof oferta !== 'string' || !oferta.startsWith('v=0')) return null
  const servidores = lerIce(ice)
  if (!servidores) return null
  return { ligacao, numero, oferta, ice: servidores }
}

function resumo(texto: string): Buffer {
  return createHash('sha256').update(texto).digest()
}

function autorizado(pedido: IncomingMessage, esperado: Buffer): boolean {
  const cabecalho = pedido.headers.authorization ?? ''
  if (!cabecalho.startsWith('Bearer ')) return false
  return timingSafeEqual(resumo(cabecalho.slice('Bearer '.length)), esperado)
}

class CorpoGrande extends Error {}

async function lerCorpo(pedido: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = []
  let tamanho = 0
  for await (const parte of pedido) {
    tamanho += (parte as Buffer).length
    if (tamanho > TETO_DO_CORPO) throw new CorpoGrande()
    partes.push(parte as Buffer)
  }
  return JSON.parse(Buffer.concat(partes).toString('utf8'))
}

function responder(resposta: ServerResponse, status: number, corpo: unknown): void {
  resposta.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  resposta.end(JSON.stringify(corpo))
}

function responderResultado(resposta: ServerResponse, resultado: Resultado): void {
  if (resultado.ok) responder(resposta, 200, resultado.resposta ? { resposta: resultado.resposta } : {})
  else responder(resposta, STATUS_DA_RECUSA[resultado.recusa], { erro: resultado.recusa })
}

export function criarServidor(segredo: string, comandos: Comandos, registrar: (linha: string) => void) {
  const esperado = resumo(segredo)
  return createServer(async (pedido, resposta) => {
    // No log: todo pedido que muda algo e toda recusa (o `GET /estado` de
    // rotina, não). Sem corpo nem número: só o método, o caminho e o status.
    resposta.on('finish', () => {
      if (pedido.method !== 'GET' || resposta.statusCode >= 400) {
        registrar(`API ${pedido.method} ${(pedido.url ?? '').slice(0, 40)} → ${resposta.statusCode}`)
      }
    })
    try {
      if (!autorizado(pedido, esperado)) return responder(resposta, 401, { erro: 'sem_autorizacao' })
      const caminho = new URL(pedido.url ?? '/', 'http://maquina').pathname

      if (pedido.method === 'GET' && caminho === '/estado') return responder(resposta, 200, comandos.estado())
      if (pedido.method === 'GET' && caminho === '/qr') {
        const qr = await comandos.qr()
        return qr ? responder(resposta, 200, { qr }) : responder(resposta, 404, { erro: 'sem_qr' })
      }
      if (pedido.method !== 'POST' || !['/ligar', '/atender', '/desligar'].includes(caminho)) {
        return responder(resposta, 404, { erro: 'rota_desconhecida' })
      }

      let corpo: unknown
      try {
        corpo = await lerCorpo(pedido)
      } catch (erro) {
        if (erro instanceof CorpoGrande) return responder(resposta, 413, { erro: 'corpo_grande' })
        return responder(resposta, 400, { erro: 'json_invalido' })
      }

      if (caminho === '/desligar') {
        const ligacao = (corpo as { ligacao?: unknown } | null)?.ligacao
        if (typeof ligacao !== 'string' || !ID_DA_LIGACAO.test(ligacao)) {
          return responder(resposta, 400, { erro: 'pedido_invalido' })
        }
        return responderResultado(resposta, await comandos.desligar(ligacao))
      }

      const pedidoLido = lerPedido(corpo)
      if (!pedidoLido) return responder(resposta, 400, { erro: 'pedido_invalido' })
      const resultado = caminho === '/ligar' ? await comandos.ligar(pedidoLido) : await comandos.atender(pedidoLido)
      return responderResultado(resposta, resultado)
    } catch (erro) {
      registrar(`API: ${erro instanceof Error ? erro.message : String(erro)}`)
      if (!resposta.headersSent) responder(resposta, 500, { erro: 'falhou' })
    }
  })
}
