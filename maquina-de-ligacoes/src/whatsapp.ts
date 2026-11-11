/**
 * A tela do WhatsApp Web, lida e comandada pelo controle do Chrome
 * (docs/PLANO-ligar-pelo-crm.md, §8.13).
 *
 * TODOS os seletores e textos de tela moram em SELETORES: quando o WhatsApp
 * mudar a tela, o conserto é aqui. Medidos em 10/11/2026 (Chrome 157,
 * WhatsApp Business):
 * - a tela não tem mais `data-icon`: os seletores são `aria-label` e
 *   `data-testid`, e o `aria-label` está em português (o Chrome abre com
 *   `--lang=pt-BR`; mudar o idioma nas configurações do WhatsApp quebra isto);
 * - a chamada, nos dois sentidos, é um quadro flutuante dentro da própria
 *   página ("Picture-in-picture", `role=application`), nunca outra janela;
 * - discar sem abrir a conversa (abrir manda ao cliente a confirmação de
 *   leitura): aba Ligações → "Ligar para um telefone" → o número → "Ligação de
 *   voz" ao lado da pessoa. Sem WhatsApp: "Nenhum resultado encontrado".
 *
 * ⚠️ NUNCA clicar em "Recusar" (recusa a chamada também nos celulares do
 * escritório) nem em "Ignorar".
 */
import type { Page } from 'playwright-core'
import type { WhatsApp } from './ligacao.js'
import type { EstadoDoWhatsapp, FaseDaChamada } from './tipos.js'

export const SELETORES = {
  /** A barra da esquerda: só existe com a sessão aberta. */
  conectado: 'button[aria-label="Conversas"]',
  /** O QR da tela de parear. */
  qr: 'div[data-ref] canvas, canvas[aria-label]',
  abaLigacoes: 'button[aria-label="Ligações"]',
  /** O botão do discador, na aba Ligações (sem `aria-label`: vai pelo texto). */
  abrirDiscador: 'Ligar para um telefone',
  teclaDoDiscador: '[data-testid=dialer-pad-1]',
  campoDoDiscador: 'div[role=textbox][contenteditable=true]',
  vozNoDiscador: '[data-testid=dialer_contact_call_buttons] button[aria-label="Ligação de voz"]',
  semResultado: '[data-testid=no-search-results]',
  /** O quadro da chamada, feita ou recebida (o rótulo começa assim, mesmo em português). */
  quadro: '[role=application][aria-label^="Picture-in-picture"]',
  aceitar: 'button[aria-label="Aceitar"]',
  desligar: 'button[aria-label="Desligar"]',
  /** Aparece no instante em que a chamada feita é atendida. */
  opcoesDaLigacao: '[aria-label="Opções da ligação"]',
  /** O cronômetro é o fim do texto do quadro ("Fulano 0:05"); no nome, um "14:30" não conta. */
  cronometroNoFim: '\\b\\d{1,2}:\\d{2}$',
  /** O que o quadro da recebida mostra além de quem liga. */
  rodapeDoToque: '\\b(Ligação de voz|Ligação de vídeo|Recusar|Aceitar|Ignorar)\\b',
} as const

/** O que uma consulta à tela devolve: só fatos, sem decisão (a decisão é `decidir`). */
export interface Retrato {
  conectado: boolean
  qr: boolean
  /** O quadro da chamada; nulo = nenhum na tela. */
  quadro: null | { texto: string; aceitar: boolean; desligar: boolean; opcoes: boolean }
}

/** Roda DENTRO da página (o controle do Chrome a serializa): nada de fora entra aqui. */
function lerTela(s: typeof SELETORES): Retrato {
  const quadro = [...document.querySelectorAll<HTMLElement>(s.quadro)].find((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
  return {
    conectado: !!document.querySelector(s.conectado),
    qr: !!document.querySelector(s.qr),
    quadro: quadro
      ? {
          texto: quadro.innerText.replace(/\s+/g, ' ').trim(),
          aceitar: !!quadro.querySelector(s.aceitar),
          desligar: !!quadro.querySelector(s.desligar),
          opcoes: !!quadro.querySelector(s.opcoesDaLigacao),
        }
      : null,
  }
}

/**
 * A decisão a partir do retrato (pura, testada com retratos fictícios):
 * - com "Aceitar" no quadro: a recebida tocando (`quem` = o nome da agenda
 *   do celular do escritório, ou o número);
 * - com "Desligar" e o cronômetro (ou as opções da ligação): em curso;
 * - com "Desligar" e sem cronômetro: a feita chamando ("Ligando…",
 *   "Chamando…") — e o instante que pisca antes da tela de fim;
 * - sem botão: a tela de fim ("Ligação encerrada", "Não atendida"; a recusa
 *   do cliente também sai como "Não atendida").
 */
export function decidir(r: Retrato): { estado: EstadoDoWhatsapp; chamada: FaseDaChamada } {
  const estado: EstadoDoWhatsapp = r.conectado ? 'conectado' : r.qr ? 'qr' : 'carregando'
  const q = r.quadro
  if (!q) return { estado, chamada: { fase: 'nenhuma' } }
  if (q.aceitar) {
    const quem = q.texto.replace(new RegExp(SELETORES.rodapeDoToque, 'g'), ' ').replace(/\s+/g, ' ').trim()
    return { estado, chamada: { fase: 'tocando', quem } }
  }
  if (q.desligar) {
    if (q.opcoes || new RegExp(SELETORES.cronometroNoFim).test(q.texto)) return { estado, chamada: { fase: 'em_curso' } }
    return { estado, chamada: { fase: 'chamando' } }
  }
  return { estado, chamada: { fase: 'encerrada', aviso: q.texto } }
}

const ESPERA_DA_TELA_MS = 10_000
/** Uma leitura da tela que não volta nisso conta como falha (aba travada). */
const PRAZO_DA_LEITURA_MS = 5_000
/** A busca do discador se assenta depois do número inteiro (vale só o resultado dele). */
const ASSENTAR_A_BUSCA_MS = 800

function comPrazo<T>(promessa: Promise<T>, ms: number, oQue: string): Promise<T> {
  let relogio: ReturnType<typeof setTimeout> | undefined
  const prazo = new Promise<never>((_, recusar) => {
    relogio = setTimeout(() => recusar(new Error(`${oQue}: sem resposta em ${ms / 1000} s`)), ms)
  })
  return Promise.race([promessa, prazo]).finally(() => clearTimeout(relogio))
}

export function whatsappDaPagina(pagina: Page): WhatsApp {
  const retrato = async () =>
    decidir(await comPrazo(pagina.evaluate(lerTela, SELETORES), PRAZO_DA_LEITURA_MS, 'a leitura da tela'))
  const noQuadro = (seletor: string) => pagina.locator(`${SELETORES.quadro} ${seletor}`).first()

  return {
    retrato,

    async discar(numero) {
      // A tela de fim da ligação anterior fica ~3 s: espera ela sair.
      for (let i = 0; (await retrato()).chamada.fase === 'encerrada' && i < 20; i++) await pagina.waitForTimeout(300)
      if ((await retrato()).chamada.fase !== 'nenhuma') throw new Error('já há uma chamada na tela')

      if ((await pagina.locator(SELETORES.teclaDoDiscador).count()) === 0) {
        await pagina.locator(SELETORES.abaLigacoes).click({ timeout: ESPERA_DA_TELA_MS })
        await pagina.getByText(SELETORES.abrirDiscador).first().click({ timeout: ESPERA_DA_TELA_MS })
      }
      const campo = pagina.locator(SELETORES.campoDoDiscador).first()
      const voz = pagina.locator(SELETORES.vozNoDiscador).first()
      const semResultado = pagina.locator(SELETORES.semResultado).first()

      // ⚠️ Ligar para a pessoa ERRADA é o pior caso: o resultado da busca
      // anterior tem de sumir antes, e o número entra INTEIRO de uma vez (digitado
      // tecla a tecla, um prefixo dele pode ser o número válido de outra pessoa).
      await campo.click({ timeout: ESPERA_DA_TELA_MS })
      await pagina.keyboard.press('Control+A')
      await pagina.keyboard.press('Backspace')
      await voz.or(semResultado).waitFor({ state: 'hidden', timeout: ESPERA_DA_TELA_MS })
      await pagina.keyboard.insertText(`+${numero}`)
      if ((await campo.innerText()).replace(/\D/g, '') !== numero) throw new Error('o número não entrou inteiro no discador')
      await voz.or(semResultado).waitFor({ timeout: ESPERA_DA_TELA_MS })
      await pagina.waitForTimeout(ASSENTAR_A_BUSCA_MS)
      if (await semResultado.isVisible()) return 'sem_whatsapp'
      if (!(await voz.isVisible())) throw new Error('o discador não mostrou a pessoa')

      await voz.click()
      await noQuadro(SELETORES.desligar).waitFor({ timeout: ESPERA_DA_TELA_MS })
      return 'discou'
    },

    async aceitar(quem) {
      const agora = (await retrato()).chamada
      if (agora.fase !== 'tocando') return 'nada_tocando'
      if (agora.quem !== quem) return 'outra_chamada'
      await noQuadro(SELETORES.aceitar).click({ timeout: ESPERA_DA_TELA_MS })
      // Só volta com o "Desligar" na tela: um desligar logo depois do aceite
      // precisa achar o botão (sem ele, a chamada ficaria muda e sem dono).
      await noQuadro(SELETORES.desligar).waitFor({ timeout: ESPERA_DA_TELA_MS })
      return 'aceitou'
    },

    async desligar() {
      const botao = noQuadro(SELETORES.desligar)
      if ((await botao.count()) > 0) await botao.click({ timeout: ESPERA_DA_TELA_MS })
    },

    async qr() {
      const qr = pagina.locator(SELETORES.qr).first()
      if ((await qr.count()) === 0) return null
      return `data:image/png;base64,${(await qr.screenshot()).toString('base64')}`
    },
  }
}
