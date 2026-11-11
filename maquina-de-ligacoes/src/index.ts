/**
 * Orquestrador do computador de ligações (docs/PLANO-ligar-pelo-crm.md,
 * §8.13). O `iniciar.sh` sobe a tela, o áudio e o Chrome; aqui o processo se
 * liga ao Chrome pelo controle de depuração, abre a ponte de áudio, serve a
 * API interna e lê a tela em laço.
 *
 * Um caminho só de recuperação: se o Chrome, uma aba ou a API caem, ou a aba
 * do WhatsApp para de responder, este processo sai com erro e a Docker
 * reinicia o contêiner.
 */
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { criarAvisos } from './avisos.js'
import { lerConfig } from './config.js'
import { comecarGravacao, enviarGravacoes } from './gravacao.js'
import { Maquina } from './ligacao.js'
import { abrirPonte, servirPonte } from './ponte.js'
import { PORTA_DA_API, criarServidor } from './servidor.js'
import { whatsappDaPagina } from './whatsapp.js'

const CONTROLE_DO_CHROME = 'http://127.0.0.1:9222'
const ENDERECO_DO_WHATSAPP = 'https://web.whatsapp.com/'
const INTERVALO_DA_TELA_MS = 700
const INTERVALO_DO_SINAL_MS = 60_000
const INTERVALO_DO_REENVIO_MS = 5 * 60_000

function registrar(linha: string): void {
  console.log(`${new Date().toISOString()} ${linha}`)
}

function sair(motivo: string): never {
  console.error(`${new Date().toISOString()} ${motivo}: saindo para a Docker reiniciar o contêiner`)
  process.exit(1)
}

async function ligarAoChrome() {
  const limite = Date.now() + 60_000
  for (;;) {
    try {
      return await chromium.connectOverCDP(CONTROLE_DO_CHROME)
    } catch (erro) {
      if (Date.now() > limite) throw erro
      await new Promise((pronto) => setTimeout(pronto, 1_000))
    }
  }
}

/**
 * A aba que o `iniciar.sh` abriu no WhatsApp. ⚠️ Nunca abrir uma SEGUNDA aba
 * do WhatsApp no mesmo perfil (uma delas cairia no "Usar aqui"): espera a
 * aba inicial chegar lá e, se não chegar, leva a primeira aba até lá.
 */
async function abaDoWhatsapp(contexto: BrowserContext): Promise<Page> {
  const limite = Date.now() + 30_000
  while (Date.now() < limite) {
    const aba = contexto.pages().find((p) => p.url().startsWith(ENDERECO_DO_WHATSAPP))
    if (aba) return aba
    await new Promise((pronto) => setTimeout(pronto, 500))
  }
  const primeira = contexto.pages()[0] ?? (await contexto.newPage())
  await primeira.goto(ENDERECO_DO_WHATSAPP)
  return primeira
}

const config = lerConfig(process.env)
const avisos = criarAvisos({ url: config.urlDoCrm, segredo: config.segredo, computador: config.computador, registrar })

const chrome = await ligarAoChrome()
chrome.on('disconnected', () => sair('o Chrome fechou'))
const contexto = chrome.contexts()[0]
const whatsappAba = await abaDoWhatsapp(contexto)
whatsappAba.on('crash', () => sair('a aba do WhatsApp travou'))
whatsappAba.on('close', () => sair('a aba do WhatsApp fechou'))

let emCurso: string | null = null
let enviando = false
async function enviarOQueSobrou(): Promise<void> {
  if (enviando) return
  enviando = true
  try {
    await enviarGravacoes({ url: config.urlDoCrm, segredo: config.segredo, registrar, emCurso })
  } finally {
    enviando = false
  }
}

let aoMudarARede: (estado: string) => void = () => {}
await servirPonte()
const ponte = await abrirPonte(contexto, (estado) => aoMudarARede(estado), registrar, sair)
await whatsappAba.bringToFront()

const maquina = new Maquina({
  whatsapp: whatsappDaPagina(whatsappAba),
  ponte,
  gravador: {
    comecar: async (ligacao) => {
      emCurso = ligacao
      return comecarGravacao(ligacao, registrar)
    },
  },
  avisar: (aviso) => {
    registrar(`aviso: ${aviso.tipo}${'ligacao' in aviso && aviso.ligacao ? ` ${aviso.ligacao}` : ''}`)
    avisos.avisar(aviso)
  },
  aoEncerrar: (ligacao) => {
    if (emCurso === ligacao) emCurso = null
    void enviarOQueSobrou()
  },
  sair,
  agora: Date.now,
  esperar: (ms) => new Promise<void>((pronto) => setTimeout(pronto, ms)),
  registrar,
})
maquina.definirVersaoDoChrome(chrome.version())
aoMudarARede = (estado) => {
  registrar(`ponte: ${estado}`)
  maquina.aoMudarARede(estado)
}

const servidor = criarServidor(config.segredo, maquina, registrar)
servidor.on('error', (erro) => sair(`a API caiu: ${erro.message}`))
servidor.listen(PORTA_DA_API, '0.0.0.0')

// A tela é lida em laço, um tique de cada vez (o próximo só depois do anterior).
async function laco(): Promise<void> {
  try {
    await maquina.tique()
  } catch (erro) {
    registrar(`tique: ${erro instanceof Error ? erro.message.split('\n')[0] : String(erro)}`)
  }
  setTimeout(laco, INTERVALO_DA_TELA_MS)
}
void laco()

const sinal = () => {
  const { whatsapp, ligacao, chrome: versao } = maquina.estado()
  avisos.avisar({ tipo: 'sinal', whatsapp, ligacao: ligacao?.id ?? null, chrome: versao })
}
setTimeout(sinal, 5_000)
setInterval(sinal, INTERVALO_DO_SINAL_MS)
setInterval(() => void enviarOQueSobrou(), INTERVALO_DO_REENVIO_MS)
void enviarOQueSobrou()

registrar(`pronto: Chrome ${chrome.version()}, API na ${PORTA_DA_API}, avisos ${config.urlDoCrm ? 'para o CRM' : 'só no log'}`)
