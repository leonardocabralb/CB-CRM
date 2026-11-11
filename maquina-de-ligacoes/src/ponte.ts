/**
 * A ponte de áudio entre o navegador do atendente e o WhatsApp da máquina
 * (o Teste B do plano, agora comandado pelo orquestrador). A página-ponte é
 * servida só no loopback do contêiner e roda numa aba do mesmo Chrome do
 * WhatsApp: é ela que enxerga os dispositivos de áudio virtuais.
 */
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { BrowserContext } from 'playwright-core'
import type { Ponte } from './ligacao.js'
import type { ServidorIce } from './tipos.js'

/** A política do Chrome libera o microfone só para esta origem (politica.json). */
export const ENDERECO_DA_PONTE = 'http://127.0.0.1:8090/ponte.html'
const ARQUIVO_DA_PONTE = new URL('../ponte.html', import.meta.url)

interface JanelaDaPonte {
  conectar(oferta: string, ice: ServidorIce[]): Promise<string>
  encerrar(): void
}

/** Serve a página-ponte só no loopback do contêiner. */
export async function servirPonte(): Promise<void> {
  const pagina = await readFile(ARQUIVO_DA_PONTE)
  const servidor = createServer((pedido, resposta) => {
    if (pedido.method === 'GET' && pedido.url === '/ponte.html') {
      resposta.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      resposta.end(pagina)
      return
    }
    // O Chrome pede o ícone sozinho: sem isto, um 404 por abertura no log.
    if (pedido.url === '/favicon.ico') {
      resposta.writeHead(204)
      resposta.end()
      return
    }
    resposta.writeHead(404)
    resposta.end()
  })
  await new Promise<void>((pronto) => servidor.listen(8090, '127.0.0.1', pronto))
}

/** Montar a ponte (microfone virtual + candidatos de rede) leva ~4 s; sem resposta nisso, a oferta é recusada. */
const PRAZO_DA_PONTE_MS = 15_000

function comPrazo<T>(promessa: Promise<T>, ms: number, oQue: string): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<never>((_, recusar) => {
    relogio = setTimeout(() => recusar(new Error(`${oQue}: sem resposta em ${ms / 1000} s`)), ms)
  })
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(relogio))
}

/**
 * Abre a aba da ponte; `avisar` recebe cada mudança da conexão do atendente,
 * `registrar` os erros da página, e `sair` é chamado se a aba travar ou
 * fechar (o contêiner reinicia).
 */
export async function abrirPonte(
  contexto: BrowserContext,
  avisar: (estado: string) => void,
  registrar: (linha: string) => void,
  sair: (motivo: string) => void,
): Promise<Ponte> {
  const pagina = await contexto.newPage()
  await pagina.exposeFunction('avisarDaPonte', (estado: unknown) => avisar(String(estado)))
  pagina.on('console', (msg) => {
    if (msg.type() === 'error') registrar(`ponte: ${msg.text().slice(0, 200)}`)
  })
  await pagina.goto(ENDERECO_DA_PONTE)
  pagina.on('crash', () => sair('a aba da ponte travou'))
  pagina.on('close', () => sair('a aba da ponte fechou'))
  return {
    conectar: (oferta, ice) =>
      comPrazo(
        pagina.evaluate(
          ([o, i]) => (window as unknown as JanelaDaPonte).conectar(o, i),
          [oferta, ice] as [string, ServidorIce[]],
        ),
        PRAZO_DA_PONTE_MS,
        'a ponte',
      ),
    encerrar: () =>
      comPrazo(
        pagina.evaluate(() => (window as unknown as JanelaDaPonte).encerrar()),
        PRAZO_DA_PONTE_MS,
        'fechar a ponte',
      ),
  }
}
