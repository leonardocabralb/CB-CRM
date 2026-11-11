import { describe, expect, it } from 'vitest'
import {
  ESPERA_DA_PONTE_MS,
  ESPERA_DO_DESLIGAR_MS,
  FOLGA_DO_FIM_MS,
  Maquina,
  QUEDA_DA_PONTE_MS,
  TELA_SEM_RESPOSTA_MS,
  TETO_DA_LIGACAO_MS,
  TETO_DESDE_O_PEDIDO_MS,
  chaveDoNumero,
  mesmoNumero,
  type Dependencias,
} from './ligacao.js'
import type { Aviso, EstadoDoWhatsapp, FaseDaChamada, PedidoDeLigacao } from './tipos.js'

// Números e nomes fictícios: nada de dado real no repositório.
const PEDIDO: PedidoDeLigacao = {
  ligacao: 'lig-1',
  numero: '5511987654321',
  oferta: 'v=0 oferta',
  ice: [{ urls: 'stun:stun.exemplo.test:3478' }],
}

const descarregar = () => new Promise<void>((pronto) => setImmediate(pronto))

/** Uma máquina com a tela, a ponte, o gravador e o relógio falsos. */
function montar() {
  let agora = 1_000_000
  const esperas: { ate: number; pronto: () => void }[] = []
  const tela: { estado: EstadoDoWhatsapp; chamada: FaseDaChamada } = { estado: 'conectado', chamada: { fase: 'nenhuma' } }
  const feito = { discar: [] as string[], cliquesEmAceitar: 0, desligar: 0, conectar: 0, encerrarPonte: 0, sair: [] as string[] }
  const gravacoes = { comecadas: [] as string[], paradas: 0 }
  const avisos: Aviso[] = []
  const encerradas: string[] = []
  const registros: string[] = []
  const controle = {
    discarResulta: 'discou' as 'discou' | 'sem_whatsapp',
    /** Segura o discar até `soltarDiscar()` (para o desligar no meio). */
    segurarDiscar: false,
    soltarDiscar: () => {},
    /** Segura o fim da gravação até `soltarGravacao()` (para a linha ocupada na limpeza). */
    segurarGravacao: false,
    soltarGravacao: () => {},
    ponteRecusa: false,
    /** O desligar na tela não tira a chamada (para o fim forçado). */
    telaTeimosa: false,
    /** Quantos desligar seguidos lançam erro (o clique que não pega). */
    desligarFalha: 0,
    /** A leitura da tela lança erro (a aba travada). */
    telaTravada: false,
    /** Segura a próxima leitura da tela até `soltarRetrato()` (o atender lendo a tela). */
    segurarRetrato: false,
    soltarRetrato: () => {},
    /** O discar clica (a chamada sai) e DEPOIS lança (o quadro demorou). */
    discarLanca: false,
  }

  const d: Dependencias = {
    whatsapp: {
      retrato: async () => {
        if (controle.telaTravada) throw new Error('a leitura da tela: sem resposta em 5 s')
        if (controle.segurarRetrato) {
          controle.segurarRetrato = false
          await new Promise<void>((pronto) => (controle.soltarRetrato = pronto))
        }
        return { estado: tela.estado, chamada: tela.chamada }
      },
      discar: async (numero) => {
        feito.discar.push(numero)
        if (controle.segurarDiscar) await new Promise<void>((pronto) => (controle.soltarDiscar = pronto))
        if (controle.discarResulta === 'discou') tela.chamada = { fase: 'chamando' }
        if (controle.discarLanca) throw new Error('o quadro da chamada não apareceu em 10 s')
        return controle.discarResulta
      },
      aceitar: async (quem) => {
        if (tela.chamada.fase !== 'tocando') return 'nada_tocando'
        if (tela.chamada.quem !== quem) return 'outra_chamada'
        feito.cliquesEmAceitar += 1
        tela.chamada = { fase: 'em_curso' }
        return 'aceitou'
      },
      desligar: async () => {
        feito.desligar += 1
        if (controle.desligarFalha > 0) {
          controle.desligarFalha -= 1
          throw new Error('o botão Desligar ainda não existe')
        }
        // Como a tela de verdade: só há "Desligar" na chamada feita ou em curso.
        const temDesligar = tela.chamada.fase === 'chamando' || tela.chamada.fase === 'em_curso'
        if (temDesligar && !controle.telaTeimosa) tela.chamada = { fase: 'nenhuma' }
      },
      qr: async () => 'data:image/png;base64,QR',
    },
    ponte: {
      conectar: async () => {
        if (controle.ponteRecusa) throw new Error('oferta ruim')
        feito.conectar += 1
        return 'v=0 resposta'
      },
      encerrar: async () => {
        feito.encerrarPonte += 1
      },
    },
    gravador: {
      comecar: async (ligacao) => {
        gravacoes.comecadas.push(ligacao)
        return {
          parar: async () => {
            if (controle.segurarGravacao) await new Promise<void>((pronto) => (controle.soltarGravacao = pronto))
            gravacoes.paradas += 1
          },
        }
      },
    },
    avisar: (aviso) => avisos.push(aviso),
    aoEncerrar: (ligacao) => encerradas.push(ligacao),
    sair: (motivo) => feito.sair.push(motivo),
    agora: () => agora,
    esperar: (ms) => new Promise<void>((pronto) => esperas.push({ ate: agora + ms, pronto })),
    registrar: (linha) => registros.push(linha),
  }

  /** Anda o relógio, soltando cada espera vencida na ordem. */
  async function passar(ms: number) {
    const alvo = agora + ms
    for (;;) {
      await descarregar()
      const vencidas = esperas.filter((e) => e.ate <= alvo).sort((a, b) => a.ate - b.ate)
      if (vencidas.length === 0) break
      const proxima = vencidas[0]
      esperas.splice(esperas.indexOf(proxima), 1)
      agora = Math.max(agora, proxima.ate)
      proxima.pronto()
    }
    agora = alvo
    await descarregar()
  }

  const maquina = new Maquina(d)
  const fins = () => avisos.filter((a): a is Extract<Aviso, { tipo: 'encerrada' }> => a.tipo === 'encerrada')
  return { maquina, tela, feito, gravacoes, avisos, encerradas, registros, controle, passar, fins }
}

type Montada = ReturnType<typeof montar>

/** Liga e deixa a chamada tocando no cliente (rede da ponte ligada). */
async function ligarAteChamar(m: Montada) {
  await m.maquina.tique()
  const resultado = await m.maquina.ligar(PEDIDO)
  expect(resultado).toEqual({ ok: true, resposta: 'v=0 resposta' })
  m.maquina.aoMudarARede('connected')
  await m.passar(200)
  expect(m.feito.discar).toEqual([PEDIDO.numero])
}

/** Liga, o cliente atende e a ligação fica em curso. */
async function ligarAteAtender(m: Montada) {
  await ligarAteChamar(m)
  m.tela.chamada = { fase: 'em_curso' }
  await m.maquina.tique()
}

/** A tela fica sem chamada pela folga e o `tique` fecha a ligação. */
async function telaSemChamada(m: Montada) {
  m.tela.chamada = { fase: 'nenhuma' }
  await m.maquina.tique()
  await m.passar(FOLGA_DO_FIM_MS)
  await m.maquina.tique()
}

describe('ligação feita', () => {
  it('só aceita o pedido com o WhatsApp conectado', async () => {
    const m = montar()
    expect(await m.maquina.ligar(PEDIDO)).toEqual({ ok: false, recusa: 'whatsapp_desconectado' })
    m.tela.estado = 'qr'
    await m.maquina.tique()
    expect(await m.maquina.ligar(PEDIDO)).toEqual({ ok: false, recusa: 'whatsapp_desconectado' })
  })

  it('não disca antes de a ponte do atendente ligar', async () => {
    const m = montar()
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    await m.passar(ESPERA_DA_PONTE_MS - 500)
    expect(m.feito.discar).toEqual([])
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    expect(m.feito.discar).toEqual([PEDIDO.numero])
  })

  it('a ponte que não liga em 10 s encerra sem discar (o cliente nunca fala com o vazio)', async () => {
    const m = montar()
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    await m.passar(ESPERA_DA_PONTE_MS + 200)
    expect(m.feito.discar).toEqual([])
    expect(m.fins()).toEqual([
      { tipo: 'encerrada', ligacao: 'lig-1', motivo: 'ponte_caiu', atendida_em: null, duracao_seg: null },
    ])
    expect(m.maquina.estado().ligacao).toBeNull()
  })

  it('do chamando ao fim: avisos, gravação e a duração até a tela largar a chamada', async () => {
    const m = montar()
    await ligarAteChamar(m)
    expect(m.avisos.map((a) => a.tipo)).toEqual(['chamando'])
    m.tela.chamada = { fase: 'em_curso' }
    await m.maquina.tique()
    expect(m.avisos.map((a) => a.tipo)).toEqual(['chamando', 'atendida'])
    expect(m.gravacoes.comecadas).toEqual(['lig-1'])
    await m.passar(65_000)
    await telaSemChamada(m)
    const [fim] = m.fins()
    expect(fim.motivo).toBe('cliente_desligou')
    expect(fim.duracao_seg).toBe(65)
    expect(m.gravacoes.paradas).toBe(1)
    expect(m.feito.encerrarPonte).toBe(1)
    expect(m.encerradas).toEqual(['lig-1'])
  })

  it('a tela que pisca sem a chamada por menos que a folga não encerra', async () => {
    const m = montar()
    await ligarAteAtender(m)
    m.tela.chamada = { fase: 'nenhuma' }
    await m.maquina.tique()
    await m.passar(FOLGA_DO_FIM_MS - 500)
    m.tela.chamada = { fase: 'em_curso' }
    await m.maquina.tique()
    await m.passar(1_000)
    await m.maquina.tique()
    expect(m.fins()).toEqual([])
  })

  it('sem resposta e ocupado', async () => {
    const naoAtendida = montar()
    await ligarAteChamar(naoAtendida)
    await telaSemChamada(naoAtendida)
    expect(naoAtendida.fins()[0].motivo).toBe('nao_atendida')
    expect(naoAtendida.gravacoes.comecadas).toEqual([])

    const ocupado = montar()
    await ligarAteChamar(ocupado)
    ocupado.tela.chamada = { fase: 'encerrada', aviso: 'Ocupado' }
    await ocupado.maquina.tique()
    await ocupado.passar(FOLGA_DO_FIM_MS)
    await ocupado.maquina.tique()
    expect(ocupado.fins()[0].motivo).toBe('ocupado')
  })

  it('número sem WhatsApp', async () => {
    const m = montar()
    m.controle.discarResulta = 'sem_whatsapp'
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    expect(m.fins()[0].motivo).toBe('sem_whatsapp')
  })

  it('uma ligação por vez', async () => {
    const m = montar()
    await ligarAteChamar(m)
    expect(await m.maquina.ligar({ ...PEDIDO, ligacao: 'lig-2' })).toEqual({ ok: false, recusa: 'ocupada' })
    expect(await m.maquina.atender({ ...PEDIDO, ligacao: 'lig-2' })).toEqual({ ok: false, recusa: 'ocupada' })
  })

  it('a linha segue ocupada enquanto a gravação e a ponte da anterior fecham', async () => {
    const m = montar()
    m.controle.segurarGravacao = true
    await ligarAteAtender(m)
    m.tela.chamada = { fase: 'nenhuma' }
    await m.maquina.tique()
    await m.passar(FOLGA_DO_FIM_MS)
    const fechando = m.maquina.tique()
    await m.passar(0)
    expect(m.maquina.estado().ligacao?.fase).toBe('encerrando')
    expect(await m.maquina.ligar({ ...PEDIDO, ligacao: 'lig-2' })).toEqual({ ok: false, recusa: 'ocupada' })
    expect(m.fins()).toEqual([])
    m.controle.soltarGravacao()
    await fechando
    expect(m.fins()[0].motivo).toBe('cliente_desligou')
    expect(m.maquina.estado().ligacao).toBeNull()
  })

  it('oferta recusada pela ponte devolve a linha', async () => {
    const m = montar()
    m.controle.ponteRecusa = true
    await m.maquina.tique()
    expect(await m.maquina.ligar(PEDIDO)).toEqual({ ok: false, recusa: 'oferta_invalida' })
    expect(m.maquina.estado().ligacao).toBeNull()
  })
})

describe('desligar', () => {
  it('pelo atendente: desliga na tela e o fim leva o motivo', async () => {
    const m = montar()
    await ligarAteAtender(m)
    expect(await m.maquina.desligar('outra')).toEqual({ ok: false, recusa: 'nao_encontrada' })
    expect(await m.maquina.desligar('lig-1')).toEqual({ ok: true })
    expect(m.feito.desligar).toBe(1)
    await m.maquina.tique()
    await m.passar(FOLGA_DO_FIM_MS)
    await m.maquina.tique()
    expect(m.fins()[0].motivo).toBe('atendente_desligou')
  })

  it('antes de discar: encerra e não disca', async () => {
    const m = montar()
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    await m.maquina.desligar('lig-1')
    m.maquina.aoMudarARede('connected')
    await m.passar(1_000)
    expect(m.feito.discar).toEqual([])
    expect(m.fins()[0].motivo).toBe('atendente_desligou')
  })

  it('no meio da discagem: a chamada que saiu é desligada, e o "chamando" não vai depois do fim', async () => {
    const m = montar()
    m.controle.segurarDiscar = true
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    expect(m.feito.discar).toEqual([PEDIDO.numero])
    await m.maquina.desligar('lig-1')
    m.controle.soltarDiscar()
    await m.passar(0)
    expect(m.feito.desligar).toBe(1)
    expect(m.tela.chamada).toEqual({ fase: 'nenhuma' })
    expect(m.avisos.map((a) => a.tipo)).toEqual(['encerrada'])
  })

  it('desligada no meio da discagem, a linha só fica livre quando a discagem acaba (ela segue mexendo na tela)', async () => {
    const m = montar()
    m.controle.segurarDiscar = true
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    await m.maquina.desligar('lig-1')
    expect(m.fins()[0].motivo).toBe('atendente_desligou')
    expect(m.maquina.estado().ligacao).toBeNull()
    const outra = { ...PEDIDO, ligacao: 'lig-2' }
    expect(await m.maquina.ligar(outra)).toEqual({ ok: false, recusa: 'ocupada' })
    expect(await m.maquina.atender(outra)).toEqual({ ok: false, recusa: 'ocupada' })
    m.controle.soltarDiscar()
    await m.passar(0)
    // A chamada que a discagem pôs na tela caiu ANTES de a linha ficar livre.
    expect(m.feito.desligar).toBe(1)
    expect(m.tela.chamada).toEqual({ fase: 'nenhuma' })
    expect(await m.maquina.ligar(outra)).toEqual({ ok: true, resposta: 'v=0 resposta' })
  })

  it('desligada na espera da rede, a linha fica livre na volta seguinte da espera (e nada é discado)', async () => {
    const m = montar()
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    await m.maquina.desligar('lig-1')
    const outra = { ...PEDIDO, ligacao: 'lig-2' }
    expect(await m.maquina.ligar(outra)).toEqual({ ok: false, recusa: 'ocupada' })
    await m.passar(200)
    expect(await m.maquina.ligar(outra)).toEqual({ ok: true, resposta: 'v=0 resposta' })
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    // Só a 2ª discou: o `seguir` da 1ª viu o cancelamento e não chegou ao passo.
    expect(m.feito.discar).toEqual([PEDIDO.numero])
    expect(m.maquina.estado().ligacao?.id).toBe('lig-2')
  })

  it('aos 30 minutos do atendimento', async () => {
    const m = montar()
    await ligarAteAtender(m)
    await m.passar(TETO_DA_LIGACAO_MS - 1_000)
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(0)
    await m.passar(1_000)
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(1)
    await telaSemChamada(m)
    expect(m.fins()[0].motivo).toBe('teto_30min')
  })

  it('o teto também conta desde o pedido (se a tela nunca mostrar o atendimento)', async () => {
    const m = montar()
    await ligarAteChamar(m)
    await m.passar(TETO_DESDE_O_PEDIDO_MS)
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(1)
  })

  it('com a ponte caída por 15 s, e não antes', async () => {
    const m = montar()
    await ligarAteAtender(m)
    m.maquina.aoMudarARede('disconnected')
    await m.passar(QUEDA_DA_PONTE_MS - 1_000)
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(0)
    m.maquina.aoMudarARede('connected')
    await m.passar(5_000)
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(0)

    m.maquina.aoMudarARede('failed')
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(1)
    await telaSemChamada(m)
    expect(m.fins()[0].motivo).toBe('ponte_caiu')
  })

  it('o clique que não pega é tentado de novo a cada volta', async () => {
    const m = montar()
    await ligarAteAtender(m)
    m.controle.desligarFalha = 2
    await m.maquina.desligar('lig-1')
    expect(m.tela.chamada).toEqual({ fase: 'em_curso' })
    await m.maquina.tique()
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(3)
    expect(m.tela.chamada).toEqual({ fase: 'nenhuma' })
  })

  it('a tela que não larga a chamada: fim forçado, e a chamada sem dono segue sendo desligada', async () => {
    const m = montar()
    m.controle.telaTeimosa = true
    await ligarAteAtender(m)
    await m.maquina.desligar('lig-1')
    await m.passar(ESPERA_DO_DESLIGAR_MS)
    await m.maquina.tique()
    expect(m.fins()[0].motivo).toBe('atendente_desligou')
    expect(m.registros.some((r) => r.includes('fim forçado'))).toBe(true)
    const antes = m.feito.desligar
    await m.maquina.tique()
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(antes + 2)
    m.controle.telaTeimosa = false
    await m.maquina.tique()
    expect(m.tela.chamada).toEqual({ fase: 'nenhuma' })
  })
})

describe('chamada sem dono na tela', () => {
  it('feita ou em curso sem ligação aqui é desligada; a recebida tocando, nunca', async () => {
    const m = montar()
    m.tela.chamada = { fase: 'tocando', quem: 'Cliente Fictício' }
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(0)
    m.tela.chamada = { fase: 'em_curso' }
    await m.maquina.tique()
    expect(m.feito.desligar).toBe(1)
    expect(m.registros.filter((r) => r.includes('sem ligação em curso'))).toHaveLength(1)
  })

  it('a discagem que falha DEPOIS do clique (o quadro demorou) desliga o que saiu', async () => {
    const m = montar()
    m.controle.discarLanca = true
    await m.maquina.tique()
    await m.maquina.ligar(PEDIDO)
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    expect(m.feito.desligar).toBe(1)
    expect(m.tela.chamada).toEqual({ fase: 'nenhuma' })
    expect(m.fins()[0].motivo).toBe('falhou')
  })
})

describe('ligação recebida', () => {
  it('nada tocando, ou outra pessoa tocando', async () => {
    const m = montar()
    await m.maquina.tique()
    expect(await m.maquina.atender(PEDIDO)).toEqual({ ok: false, recusa: 'nada_tocando' })
    m.tela.chamada = { fase: 'tocando', quem: '+55 21 91234-5678' }
    expect(await m.maquina.atender(PEDIDO)).toEqual({ ok: false, recusa: 'outra_chamada' })
    expect(m.maquina.estado().ligacao).toBeNull()
  })

  it('atende depois de a ponte ligar, grava e termina', async () => {
    const m = montar()
    await m.maquina.tique()
    m.tela.chamada = { fase: 'tocando', quem: '+55 11 98765-4321' }
    expect(await m.maquina.atender(PEDIDO)).toEqual({ ok: true, resposta: 'v=0 resposta' })
    expect(m.feito.cliquesEmAceitar).toBe(0)
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    expect(m.feito.cliquesEmAceitar).toBe(1)
    await m.maquina.tique()
    expect(m.avisos.map((a) => a.tipo)).toEqual(['atendida'])
    expect(m.gravacoes.comecadas).toEqual(['lig-1'])
    await telaSemChamada(m)
    expect(m.fins()[0].motivo).toBe('cliente_desligou')
  })

  it('o cliente desiste enquanto a ponte liga', async () => {
    const m = montar()
    await m.maquina.tique()
    m.tela.chamada = { fase: 'tocando', quem: 'Cliente Fictício' }
    await m.maquina.atender(PEDIDO)
    m.tela.chamada = { fase: 'nenhuma' }
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    expect(m.fins()[0].motivo).toBe('cliente_desligou')
  })

  it('desligada enquanto o atender lê a tela: a leitura que volta não apaga nada, e a linha só fica livre depois dela', async () => {
    const m = montar()
    await m.maquina.tique()
    m.tela.chamada = { fase: 'nenhuma' }
    m.controle.segurarRetrato = true
    const atendendo = m.maquina.atender(PEDIDO)
    await m.passar(0)
    await m.maquina.desligar('lig-1')
    expect(m.fins()[0].motivo).toBe('atendente_desligou')
    const outra = { ...PEDIDO, ligacao: 'lig-2' }
    expect(await m.maquina.ligar(outra)).toEqual({ ok: false, recusa: 'ocupada' })
    m.controle.soltarRetrato()
    expect(await atendendo).toEqual({ ok: false, recusa: 'nao_encontrada' })
    expect(await m.maquina.ligar(outra)).toEqual({ ok: true, resposta: 'v=0 resposta' })
    expect(m.maquina.estado().ligacao?.id).toBe('lig-2')
  })

  it('OUTRA pessoa passou a tocar enquanto a ponte ligava: não aceita', async () => {
    const m = montar()
    await m.maquina.tique()
    m.tela.chamada = { fase: 'tocando', quem: 'Cliente Fictício' }
    await m.maquina.atender(PEDIDO)
    m.tela.chamada = { fase: 'tocando', quem: 'Outra Pessoa Fictícia' }
    m.maquina.aoMudarARede('connected')
    await m.passar(200)
    expect(m.feito.cliquesEmAceitar).toBe(0)
    expect(m.fins()[0].motivo).toBe('cliente_desligou')
    expect(m.tela.chamada).toEqual({ fase: 'tocando', quem: 'Outra Pessoa Fictícia' })
  })
})

describe('a aba travada', () => {
  it('a tela sem resposta por 60 s de RELÓGIO, o processo sai (contar leituras dava ~8 min)', async () => {
    const m = montar()
    m.controle.telaTravada = true
    for (let i = 0; i < 100; i++) await m.maquina.tique()
    await m.passar(TELA_SEM_RESPOSTA_MS - 1)
    await m.maquina.tique()
    expect(m.feito.sair).toEqual([])
    await m.passar(1)
    await m.maquina.tique()
    expect(m.feito.sair).toHaveLength(1)
  })

  it('uma leitura boa no meio zera a conta', async () => {
    const m = montar()
    m.controle.telaTravada = true
    await m.maquina.tique()
    await m.passar(TELA_SEM_RESPOSTA_MS - 1)
    m.controle.telaTravada = false
    await m.maquina.tique()
    m.controle.telaTravada = true
    await m.passar(1)
    await m.maquina.tique()
    expect(m.feito.sair).toEqual([])
  })
})

describe('o número na tela', () => {
  it('chave: DDI, DDD e os 8 últimos (as duas grafias do nono dígito juntas)', () => {
    expect(chaveDoNumero('5511987654321')).toBe('551187654321')
    expect(chaveDoNumero('551187654321')).toBe('551187654321')
    expect(chaveDoNumero('11987654321')).toBe('551187654321')
    expect(chaveDoNumero('447700900123')).toBe('447700900123')
  })

  it('mesmoNumero: DDD diferente com os mesmos 8 últimos NÃO casa; nome não dá para conferir', () => {
    expect(mesmoNumero('+55 11 98765-4321', '5511987654321')).toBe(true)
    expect(mesmoNumero('+55 11 8765-4321', '5511987654321')).toBe(true)
    expect(mesmoNumero('+55 21 98765-4321', '5511987654321')).toBe(false)
    expect(mesmoNumero('+55 21 91234-5678', '5511987654321')).toBe(false)
    expect(mesmoNumero('Cliente Fictício', '5511987654321')).toBe(true)
  })
})

describe('estado e QR', () => {
  it('o QR só sai com a tela de QR', async () => {
    const m = montar()
    await m.maquina.tique()
    expect(await m.maquina.qr()).toBeNull()
    m.tela.estado = 'qr'
    await m.maquina.tique()
    expect(await m.maquina.qr()).toBe('data:image/png;base64,QR')
  })

  it('o estado mostra a ligação em curso', async () => {
    const m = montar()
    await ligarAteAtender(m)
    const { ligacao } = m.maquina.estado()
    expect(ligacao?.id).toBe('lig-1')
    expect(ligacao?.direcao).toBe('feita')
    expect(ligacao?.fase).toBe('em_ligacao')
    expect(ligacao?.atendida_em).not.toBeNull()
  })
})
