/**
 * A máquina de estados da ligação (docs/PLANO-ligar-pelo-crm.md, §8.13).
 *
 * - UMA ligação por vez (um Chrome por número; a VPS dá conta de uma, D8). A
 *   linha só fica livre DEPOIS da limpeza da anterior (gravação e ponte) e
 *   do passo dela que ainda mexe na tela (discar, aceitar).
 * - Nunca disca nem atende antes de a ponte do atendente ligar: o cliente
 *   nunca fala com o vazio.
 * - Desliga sozinha aos 30 min (D13) e quando a ponte fica caída por 15 s.
 * - ⚠️ Chamada nenhuma fica na tela sem dono: chamada feita ou em curso na
 *   tela sem ligação em curso aqui (o desligar que falhou, o fim forçado, o
 *   passo cancelado no meio) é desligada de novo a cada volta do `tique`.
 *   Só a máquina põe chamada nesses dois estados nesta tela; a recebida
 *   tocando (`tocando`) nunca é tocada.
 * - O que a tela mostra manda: `tique()` lê a tela e anda a ligação.
 *
 * As peças de fora (a tela do WhatsApp, a ponte, o gravador, os avisos e o
 * relógio) chegam por `Dependencias`: os testes as trocam por falsas.
 */
import type {
  Aviso,
  EstadoDoWhatsapp,
  EstadoPublico,
  FaseDaChamada,
  MotivoDoFim,
  PedidoDeLigacao,
  Resultado,
  ServidorIce,
} from './tipos.js'

export const TETO_DA_LIGACAO_MS = 30 * 60_000
/** Teto contado desde o PEDIDO: se a tela de "em curso" mudar e o atendimento nunca for visto, ainda há teto. */
export const TETO_DESDE_O_PEDIDO_MS = TETO_DA_LIGACAO_MS + 2 * 60_000
export const QUEDA_DA_PONTE_MS = 15_000
/** Até a rede do atendente ligar; sem ela, não disca nem atende. */
export const ESPERA_DA_PONTE_MS = 10_000
/** A tela sem chamada por esse tempo = acabou (a tela pisca entre um estado e outro). */
export const FOLGA_DO_FIM_MS = 1_500
/** Desligamos e a tela não largou a chamada: o fim é forçado (e o `tique` segue desligando). */
export const ESPERA_DO_DESLIGAR_MS = 5_000
/**
 * A tela sem responder por esse tempo de RELÓGIO = aba travada: o contêiner
 * reinicia. Conta o tempo, não as leituras: cada leitura que falha leva o
 * prazo inteiro dela (5 s) antes do erro.
 */
export const TELA_SEM_RESPOSTA_MS = 60_000

export interface WhatsApp {
  retrato(): Promise<{ estado: EstadoDoWhatsapp; chamada: FaseDaChamada }>
  /** Disca pelo discador (sem abrir a conversa) e espera a chamada aparecer na tela. */
  discar(numero: string): Promise<'discou' | 'sem_whatsapp'>
  /**
   * Aceita a chamada que toca SE ainda for de `quem` (a tela é relida logo
   * antes do clique) e espera a tela mostrar o "Desligar".
   */
  aceitar(quem: string): Promise<'aceitou' | 'nada_tocando' | 'outra_chamada'>
  desligar(): Promise<void>
  qr(): Promise<string | null>
}

export interface Ponte {
  conectar(oferta: string, ice: ServidorIce[]): Promise<string>
  encerrar(): Promise<void>
}

export interface Gravador {
  comecar(ligacao: string): Promise<{ parar(): Promise<void> }>
}

export interface Dependencias {
  whatsapp: WhatsApp
  ponte: Ponte
  gravador: Gravador
  avisar(aviso: Aviso): void
  /** Chamado depois do fim, com a gravação já fechada (é a hora de enviá-la). */
  aoEncerrar(ligacao: string): void
  /** A aba não responde: o processo sai e a Docker reinicia o contêiner. */
  sair(motivo: string): void
  agora(): number
  esperar(ms: number): Promise<void>
  registrar(linha: string): void
}

interface Atual {
  id: string
  direcao: 'feita' | 'recebida'
  numero: string
  /** `encerrando`: a limpeza ainda roda; a linha continua ocupada. */
  fase: 'preparando' | 'chamando' | 'em_ligacao' | 'encerrando'
  desde: number
  atendidaEm: number | null
  /** Quem pediu o fim, quando fomos nós (o atendente, o teto, a ponte). */
  desligandoPor: MotivoDoFim | null
  desligandoEm: number | null
}

const REDE_LIGADA = new Set(['connected', 'completed'])

/**
 * A chave de um número para comparar o que a tela mostra com o pedido: DDI,
 * DDD e os 8 últimos dígitos (as duas grafias do nono dígito do Brasil caem
 * na mesma chave). Número de fora do Brasil compara inteiro.
 */
export function chaveDoNumero(digitos: string): string {
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return `55${digitos.slice(2, 4)}${digitos.slice(-8)}`
  }
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos.slice(0, 2)}${digitos.slice(-8)}`
  return digitos
}

/** A tela mostra o mesmo número do pedido? Nome na tela (sem dígitos) não dá para conferir. */
export function mesmoNumero(naTela: string, numero: string): boolean {
  const digitos = naTela.replace(/\D/g, '')
  if (digitos.length < 8) return true
  return chaveDoNumero(digitos) === chaveDoNumero(numero)
}

function motivoSemAtender(atual: Atual, chamada: FaseDaChamada): MotivoDoFim {
  if (atual.direcao === 'recebida') return 'cliente_desligou'
  if (chamada.fase === 'encerrada' && /ocupad/i.test(chamada.aviso)) return 'ocupado'
  return 'nao_atendida'
}

/** Erro curto, só a 1ª linha: o do Playwright pode trazer pedaços da tela (nome de cliente). */
function mensagem(erro: unknown): string {
  const texto = erro instanceof Error ? erro.message : String(erro)
  return texto.split('\n')[0].slice(0, 160)
}

export class Maquina {
  private atual: Atual | null = null
  private estadoDoWhatsapp: EstadoDoWhatsapp = 'carregando'
  private rede = 'new'
  private redeCaiuEm: number | null = null
  private semChamadaDesde: number | null = null
  private gravacao: { parar(): Promise<void> } | null = null
  private versaoDoChrome = ''
  private telaSemRespostaDesde: number | null = null
  /** Um passo (discar, aceitar) ainda mexe na tela: a linha segue ocupada, mesmo sem ligação. */
  private passoNaTela = false
  private orfaAvisada = false

  constructor(private readonly d: Dependencias) {}

  definirVersaoDoChrome(versao: string): void {
    this.versaoDoChrome = versao
  }

  estado(): EstadoPublico {
    const a = this.atual
    const iso = (ms: number) => new Date(ms).toISOString()
    return {
      whatsapp: this.estadoDoWhatsapp,
      ligacao: a
        ? {
            id: a.id,
            direcao: a.direcao,
            fase: a.fase,
            desde: iso(a.desde),
            atendida_em: a.atendidaEm === null ? null : iso(a.atendidaEm),
          }
        : null,
      chrome: this.versaoDoChrome,
    }
  }

  async qr(): Promise<string | null> {
    return this.estadoDoWhatsapp === 'qr' ? this.d.whatsapp.qr() : null
  }

  async ligar(pedido: PedidoDeLigacao): Promise<Resultado> {
    if (this.atual || this.passoNaTela) return { ok: false, recusa: 'ocupada' }
    if (this.estadoDoWhatsapp !== 'conectado') return { ok: false, recusa: 'whatsapp_desconectado' }
    const atual = this.nova(pedido, 'feita')
    const resposta = await this.conectarPonte(atual, pedido)
    if (resposta === null) return { ok: false, recusa: 'oferta_invalida' }
    void this.seguir(atual, async () => {
      const discou = await this.d.whatsapp.discar(pedido.numero)
      if (discou === 'sem_whatsapp') {
        await this.encerrar(atual, 'sem_whatsapp')
        return false
      }
      // Desligada no meio do discar: nada de "chamando" (o CRM o receberia
      // DEPOIS do "encerrada"); o `seguir` desliga a chamada que saiu.
      if (this.atual === atual && !atual.desligandoPor) {
        atual.fase = 'chamando'
        this.d.avisar({ tipo: 'chamando', ligacao: atual.id })
      }
      return true
    })
    return { ok: true, resposta }
  }

  async atender(pedido: PedidoDeLigacao): Promise<Resultado> {
    if (this.atual || this.passoNaTela) return { ok: false, recusa: 'ocupada' }
    if (this.estadoDoWhatsapp !== 'conectado') return { ok: false, recusa: 'whatsapp_desconectado' }
    const atual = this.nova(pedido, 'recebida')
    let chamada: FaseDaChamada
    try {
      chamada = (await this.d.whatsapp.retrato()).chamada
    } catch (erro) {
      this.d.registrar(`atender: a tela não respondeu: ${mensagem(erro)}`)
      this.atual = null
      return { ok: false, recusa: 'falhou' }
    }
    if (chamada.fase !== 'tocando') {
      this.atual = null
      return { ok: false, recusa: 'nada_tocando' }
    }
    if (!mesmoNumero(chamada.quem, pedido.numero)) {
      this.atual = null
      return { ok: false, recusa: 'outra_chamada' }
    }
    const quem = chamada.quem
    const resposta = await this.conectarPonte(atual, pedido)
    if (resposta === null) return { ok: false, recusa: 'oferta_invalida' }
    void this.seguir(atual, async () => {
      // A ponte leva uns segundos: o cliente pode ter desistido e OUTRA pessoa
      // estar tocando. O `aceitar` relê a tela e só aceita o mesmo `quem`.
      if ((await this.d.whatsapp.aceitar(quem)) !== 'aceitou') {
        await this.encerrar(atual, 'cliente_desligou')
        return false
      }
      // Aceita: falta a tela mostrar a chamada em curso (o `tique` vê).
      if (this.atual === atual && !atual.desligandoPor) atual.fase = 'chamando'
      return true
    })
    return { ok: true, resposta }
  }

  async desligar(ligacao: string): Promise<Resultado> {
    const atual = this.atual
    if (!atual || atual.id !== ligacao) return { ok: false, recusa: 'nao_encontrada' }
    await this.desligarPorNos(atual, 'atendente_desligou')
    return { ok: true }
  }

  /** O estado da rede da ponte (o `connectionState` do lado da máquina). */
  aoMudarARede(estado: string): void {
    this.rede = estado
    if (REDE_LIGADA.has(estado)) this.redeCaiuEm = null
    else if (estado === 'disconnected') this.redeCaiuEm ??= this.d.agora()
    else if (estado === 'failed' || estado === 'closed') this.redeCaiuEm = this.d.agora() - QUEDA_DA_PONTE_MS
  }

  /** Lê a tela e anda a ligação. Roda em laço, um de cada vez (nunca dois ao mesmo tempo). */
  async tique(): Promise<void> {
    const inicio = this.d.agora()
    let retrato: { estado: EstadoDoWhatsapp; chamada: FaseDaChamada }
    try {
      retrato = await this.d.whatsapp.retrato()
      this.telaSemRespostaDesde = null
    } catch (erro) {
      // Sem a tela não há como desligar nada: a ligação em curso fica sem o
      // teto e sem a queda da ponte até o reinício, que a derruba junto.
      this.telaSemRespostaDesde ??= inicio
      this.d.registrar(`a tela não respondeu: ${mensagem(erro)}`)
      if (this.d.agora() - this.telaSemRespostaDesde >= TELA_SEM_RESPOSTA_MS) {
        this.d.sair(`a aba do WhatsApp não responde há ${TELA_SEM_RESPOSTA_MS / 1000} s`)
      }
      return
    }
    this.estadoDoWhatsapp = retrato.estado
    const { chamada } = retrato
    const comChamadaNossa = chamada.fase === 'chamando' || chamada.fase === 'em_curso'
    const atual = this.atual

    if (!atual) {
      if (comChamadaNossa) {
        if (!this.orfaAvisada) this.d.registrar('chamada na tela sem ligação em curso: desligando')
        this.orfaAvisada = true
        await this.tentarDesligar()
      } else {
        this.orfaAvisada = false
      }
      return
    }
    if (atual.fase === 'preparando' || atual.fase === 'encerrando') return

    const agora = this.d.agora()
    const semChamada = chamada.fase === 'nenhuma' || chamada.fase === 'encerrada'
    if (!semChamada) this.semChamadaDesde = null
    else this.semChamadaDesde ??= agora
    const acabou = semChamada && agora - (this.semChamadaDesde ?? agora) >= FOLGA_DO_FIM_MS

    if (atual.fase === 'chamando') {
      if (chamada.fase === 'em_curso' && !atual.desligandoPor) return this.atendeu(atual)
      if (acabou) return this.encerrar(atual, atual.desligandoPor ?? motivoSemAtender(atual, chamada))
    } else if (acabou) {
      return this.encerrar(atual, atual.desligandoPor ?? 'cliente_desligou')
    }

    if (atual.desligandoPor) {
      // O clique pode não ter pegado (o botão ainda não existia, a tela
      // travou): tenta de novo a cada volta.
      if (!semChamada) await this.tentarDesligar()
      if (agora - (atual.desligandoEm ?? agora) >= ESPERA_DO_DESLIGAR_MS) {
        this.d.registrar(`a tela não largou a chamada em ${ESPERA_DO_DESLIGAR_MS / 1000} s: fim forçado`)
        return this.encerrar(atual, atual.desligandoPor)
      }
      return
    }
    const passouDoTeto =
      (atual.atendidaEm !== null && agora - atual.atendidaEm >= TETO_DA_LIGACAO_MS) ||
      agora - atual.desde >= TETO_DESDE_O_PEDIDO_MS
    if (passouDoTeto) return this.desligarPorNos(atual, 'teto_30min')
    if (this.redeCaiuEm !== null && agora - this.redeCaiuEm >= QUEDA_DA_PONTE_MS) {
      return this.desligarPorNos(atual, 'ponte_caiu')
    }
  }

  private nova(pedido: PedidoDeLigacao, direcao: Atual['direcao']): Atual {
    const atual: Atual = {
      id: pedido.ligacao,
      direcao,
      numero: pedido.numero,
      fase: 'preparando',
      desde: this.d.agora(),
      atendidaEm: null,
      desligandoPor: null,
      desligandoEm: null,
    }
    this.atual = atual
    this.rede = 'new'
    this.redeCaiuEm = null
    this.semChamadaDesde = null
    return atual
  }

  /** A resposta WebRTC, ou nulo se a ponte recusou a oferta (a linha volta a ficar livre). */
  private async conectarPonte(atual: Atual, pedido: PedidoDeLigacao): Promise<string | null> {
    try {
      return await this.d.ponte.conectar(pedido.oferta, pedido.ice)
    } catch (erro) {
      this.d.registrar(`a ponte recusou a oferta: ${mensagem(erro)}`)
      if (this.atual === atual) this.atual = null
      return null
    }
  }

  /**
   * Espera a rede do atendente ligar e dá o passo (discar ou aceitar; ele diz
   * se pôs uma chamada na tela). Se a ligação acabou ou foi desligada no meio
   * do passo, ou o passo falhou, desliga na tela o que o passo fez: chamada
   * nenhuma fica sem dono.
   */
  private async seguir(atual: Atual, passo: () => Promise<boolean>): Promise<void> {
    const cancelada = () => this.atual !== atual || atual.desligandoPor !== null
    let naTela = false
    try {
      const limite = this.d.agora() + ESPERA_DA_PONTE_MS
      while (!REDE_LIGADA.has(this.rede)) {
        if (cancelada()) return
        if (this.d.agora() >= limite) return this.encerrar(atual, 'ponte_caiu')
        await this.d.esperar(200)
      }
      if (cancelada()) return
      // Desligar no meio encerra a ligação, mas NÃO para o passo (o
      // Playwright segue clicando): a linha só fica livre quando ele e a
      // limpeza acabam. Senão a ligação seguinte mexeria na mesma tela, e o
      // desligar daqui derrubaria a chamada DELA.
      naTela = true
      this.passoNaTela = true
      const comChamada = await passo()
      if (comChamada && cancelada()) await this.tentarDesligar()
    } catch (erro) {
      this.d.registrar(`a ${atual.direcao === 'feita' ? 'discagem' : 'aceitação'} falhou: ${mensagem(erro)}`)
      await this.tentarDesligar()
      if (this.atual === atual) await this.encerrar(atual, 'falhou')
    } finally {
      // Só quem marcou desmarca: um `seguir` cancelado na espera da rede não
      // pode soltar a linha de um passo de outra ligação.
      if (naTela) this.passoNaTela = false
    }
  }

  private async atendeu(atual: Atual): Promise<void> {
    atual.fase = 'em_ligacao'
    atual.atendidaEm = this.d.agora()
    this.d.avisar({ tipo: 'atendida', ligacao: atual.id, atendida_em: new Date(atual.atendidaEm).toISOString() })
    try {
      this.gravacao = await this.d.gravador.comecar(atual.id)
    } catch (erro) {
      this.d.registrar(`a gravação não começou: ${mensagem(erro)}`)
    }
  }

  private async tentarDesligar(): Promise<void> {
    try {
      await this.d.whatsapp.desligar()
    } catch (erro) {
      this.d.registrar(`o desligar falhou na tela: ${mensagem(erro)}`)
    }
  }

  private async desligarPorNos(atual: Atual, motivo: MotivoDoFim): Promise<void> {
    if (atual.desligandoPor || atual.fase === 'encerrando') return
    atual.desligandoPor = motivo
    atual.desligandoEm = this.d.agora()
    // Ainda sem chamada na tela: o `seguir` vê o cancelamento e não disca.
    if (atual.fase === 'preparando') return this.encerrar(atual, motivo)
    await this.tentarDesligar()
  }

  private async encerrar(atual: Atual, motivo: MotivoDoFim): Promise<void> {
    if (this.atual !== atual || atual.fase === 'encerrando') return
    // A hora real do fim: quando a tela largou a chamada (sem a folga).
    const fim = this.semChamadaDesde ?? this.d.agora()
    // A linha continua OCUPADA até a limpeza acabar: uma ligação nova não
    // pode nascer com o ffmpeg e a ponte da anterior ainda fechando.
    atual.fase = 'encerrando'
    const gravacao = this.gravacao
    this.gravacao = null
    try {
      await gravacao?.parar()
    } catch (erro) {
      this.d.registrar(`a gravação não fechou: ${mensagem(erro)}`)
    }
    try {
      await this.d.ponte.encerrar()
    } catch (erro) {
      this.d.registrar(`a ponte não fechou: ${mensagem(erro)}`)
    }
    this.atual = null
    this.redeCaiuEm = null
    this.semChamadaDesde = null
    const atendidaEm = atual.atendidaEm
    this.d.avisar({
      tipo: 'encerrada',
      ligacao: atual.id,
      motivo,
      atendida_em: atendidaEm === null ? null : new Date(atendidaEm).toISOString(),
      duracao_seg: atendidaEm === null ? null : Math.max(0, Math.round((fim - atendidaEm) / 1000)),
    })
    this.d.aoEncerrar(atual.id)
  }
}
