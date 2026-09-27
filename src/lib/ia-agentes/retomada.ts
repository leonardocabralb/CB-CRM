// ============================================================
// A RETOMADA do agente de IA (pedido do operador, 27/09/2026; 1056). PURO,
// testado.
//
// O agente fez uma pergunta e o cliente não respondeu: mensagens de retomada
// numa cadência contada da ÚLTIMA mensagem do agente sem resposta (a
// "âncora" — a resposta de um turno normal), padrão 15 min, 1 h, 3 h, 6 h,
// 12 h e 48 h. A tentativa k (0-based) vence em
// `max(ancora + cadencia[k], enviada(k-1) + (cadencia[k] - cadencia[k-1]))`
// — a cadência E o ESPAÇAMENTO dela a partir de quando a anterior SAIU —, e
// nunca antes de `enviada(k-1) + 30 min` (a rede de segurança). Só dentro da
// janela do dia (padrão 08:00–21:00, no fuso do escritório; com `horario` no
// agente, a interseção), nunca a menos de 30 min de um instante de LEMBRETE da
// reunião, e nunca a partir de 90 min antes da reunião (aí a série PARA).
//
// ⚠️⚠️ O espaçamento é o que impede a PRESSÃO (decisão do operador,
// 27/09/2026): contada só da âncora, a tentativa empurrada pela janela
// deixava as seguintes todas atrasadas, e depois de uma noite fora da janela
// saíam cinco mensagens entre 08:00 e 10:00. Com o espaçamento, a tentativa
// adiada empurra as seguintes (âncora 20:50 → 08:00, 08:45, 10:45, 13:45,
// 19:45 e âncora + 48 h; pino no teste).
//
// Quem arma, quem roda e quem para está em `turno.ts`; a leitura do banco,
// em `retomada-fatos.ts`. Aqui só as regras.
// ============================================================

import { diaNoFuso, FUSO_PADRAO, paraInstante, partesNoFuso } from '@/lib/agenda/fuso'

import type { Horario } from './agente'

/**
 * O fuso do escritório. ⚠️ É o `FUSO_DO_ESCRITORIO` de `pedido.ts` (o do
 * horário do agente), pelo `FUSO_PADRAO` da agenda: importar de `pedido.ts`
 * fecharia um ciclo (agente → retomada → pedido → agente). Há teste amarrando
 * os dois.
 */
export const FUSO_DA_RETOMADA = FUSO_PADRAO

/** 15 min, 1 h, 3 h, 6 h, 12 h e 48 h (decisão do operador, 27/09/2026). */
export const CADENCIA_PADRAO: readonly number[] = [15, 60, 180, 360, 720, 2880]
export const JANELA_PADRAO = { inicio: '08:00', fim: '21:00' } as const

export const LIMITES_DA_RETOMADA = {
  tentativasMin: 1,
  tentativasMax: 8,
  /** Em minutos: 10 min a 7 dias. */
  minutosMin: 10,
  minutosMax: 7 * 24 * 60,
} as const

/** Entre duas retomadas, no mínimo isto. */
export const INTERVALO_MINIMO_MS = 30 * 60_000
/** Longe de um lembrete da reunião, antes e depois, no mínimo isto. */
export const FOLGA_DO_LEMBRETE_MS = 30 * 60_000
/** A partir disto antes da reunião, a série para. */
export const ANTES_DA_REUNIAO_MS = 90 * 60_000
/** Não manda nos últimos 5 min da janela de 24 h da Meta (a mensagem pode chegar depois dela). */
export const FOLGA_DA_JANELA_META_MS = 5 * 60_000
/** Vencida há até isto = roda agora (os relógios do cron e do banco não são o mesmo). */
export const TOLERANCIA_DO_VENCIMENTO_MS = 60_000

export interface JanelaDaRetomada {
  /** "HH:MM", no fuso do escritório. */
  inicio: string
  fim: string
}

/** `cb_ia_agentes.retomada` (1056). Ausente = desligada. */
export interface ConfigDaRetomada {
  ativa: boolean
  /** Minutos contados da âncora, crescentes. */
  cadencia: number[]
  janela: JanelaDaRetomada
}

export function retomadaPadrao(): ConfigDaRetomada {
  return { ativa: false, cadencia: [...CADENCIA_PADRAO], janela: { ...JANELA_PADRAO } }
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/** A cadência na forma: 1 a 8 inteiros, de 10 min a 7 dias, estritamente crescentes. */
export function cadenciaValida(v: unknown): v is number[] {
  if (!Array.isArray(v)) return false
  if (v.length < LIMITES_DA_RETOMADA.tentativasMin || v.length > LIMITES_DA_RETOMADA.tentativasMax) return false
  for (let i = 0; i < v.length; i++) {
    const n = v[i]
    if (typeof n !== 'number' || !Number.isInteger(n)) return false
    if (n < LIMITES_DA_RETOMADA.minutosMin || n > LIMITES_DA_RETOMADA.minutosMax) return false
    if (i > 0 && n <= (v[i - 1] as number)) return false
  }
  return true
}

function janelaValida(v: unknown): v is JanelaDaRetomada {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const j = v as Record<string, unknown>
  return typeof j.inicio === 'string' && typeof j.fim === 'string' && HORA.test(j.inicio) && HORA.test(j.fim) && j.inicio < j.fim
}

/**
 * Lê o que está GRAVADO — parse, nunca `as`. Só o booleano `true` liga (do
 * JSONB, `"true"` e `1` são truthy; a reserva da 1056 também só aceita o
 * booleano). Cadência ou janela fora da forma caem no padrão, campo a campo:
 * forma estranha nunca lança.
 */
export function lerRetomada(v: unknown): ConfigDaRetomada {
  const padrao = retomadaPadrao()
  if (!v || typeof v !== 'object' || Array.isArray(v)) return padrao
  const r = v as Record<string, unknown>
  return {
    ativa: r.ativa === true,
    cadencia: cadenciaValida(r.cadencia) ? [...r.cadencia] : padrao.cadencia,
    janela: janelaValida(r.janela) ? { inicio: r.janela.inicio, fim: r.janela.fim } : padrao.janela,
  }
}

/**
 * Lê o que a TELA manda no PATCH — estrito: fora da forma = `null` (a rota
 * recusa com `retomada_invalida`). Descartar em silêncio uma cadência que o
 * administrador acabou de digitar mandaria mensagens noutros horários.
 */
export function lerRetomadaDoCorpo(v: unknown): ConfigDaRetomada | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (typeof r.ativa !== 'boolean') return null
  if (!cadenciaValida(r.cadencia)) return null
  if (!janelaValida(r.janela)) return null
  return { ativa: r.ativa, cadencia: [...r.cadencia], janela: { inicio: r.janela.inicio, fim: r.janela.fim } }
}

// ------------------------------------------------------------
// Quando a próxima tentativa sai
// ------------------------------------------------------------

/**
 * O que bloqueia o envio, em milissegundos: os instantes dos LEMBRETES da
 * reunião (as automações `date_field_offset` da conta — LIGADAS OU NÃO —
 * aplicadas ao valor do campo de data na ficha) e os instantes das REUNIÕES
 * (o próprio valor).
 */
export interface Bloqueios {
  lembretes: number[]
  reunioes: number[]
}

export const SEM_BLOQUEIOS: Bloqueios = { lembretes: [], reunioes: [] }

export type MotivoDoFim =
  /** A cadência acabou. */
  | 'cadencia_acabou'
  /** A próxima cairia a menos de 90 min da reunião (ou depois dela). */
  | 'reuniao_proxima'
  /** A janela do dia e o horário do agente não se cruzam. */
  | 'sem_janela'
  /** A próxima cairia com a janela de 24 h da Meta fechada (texto livre não sai). */
  | 'janela_24h'

export type ProximaRetomada = { tipo: 'agendar'; instante: number } | { tipo: 'parar'; motivo: MotivoDoFim }

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** O dia seguinte (`YYYY-MM-DD`), aritmética de calendário. */
function diaSeguinte(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const x = new Date(Date.UTC(a, m - 1, d + 1))
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
}

/**
 * A janela que vale: a do dia (a da retomada) cruzada com o horário do
 * agente (dias e hora). `null` = não se cruzam.
 */
export function janelaEfetiva(
  janela: JanelaDaRetomada,
  horario: Horario | null,
): { dias: readonly number[]; inicio: number; fim: number } | null {
  const inicio = Math.max(minutosDe(janela.inicio), horario ? minutosDe(horario.inicio) : 0)
  const fim = Math.min(minutosDe(janela.fim), horario ? minutosDe(horario.fim) : 24 * 60)
  const dias = horario ? horario.dias : [0, 1, 2, 3, 4, 5, 6]
  if (inicio >= fim || dias.length === 0) return null
  return { dias, inicio, fim }
}

/**
 * O primeiro instante `>= t` dentro da janela (no fuso do escritório,
 * reconstruído pela hora de parede — nunca somando dias em milissegundos).
 * `null` = nenhum nos próximos 8 dias (a janela não tem dia nenhum).
 */
export function dentroDaJanela(
  t: number,
  janela: { dias: readonly number[]; inicio: number; fim: number },
  fuso: string = FUSO_DA_RETOMADA,
): number | null {
  const abertura = `${String(Math.floor(janela.inicio / 60)).padStart(2, '0')}:${String(janela.inicio % 60).padStart(2, '0')}`
  let alvo = t
  for (let i = 0; i < 9; i++) {
    const p = partesNoFuso(new Date(alvo), fuso)
    const minutos = p.hora * 60 + p.minuto
    const dia = diaNoFuso(new Date(alvo), fuso)
    if (janela.dias.includes(p.diaDaSemana)) {
      if (minutos >= janela.inicio && minutos < janela.fim) return alvo
      if (minutos < janela.inicio) return paraInstante(dia, abertura, fuso).getTime()
    }
    alvo = paraInstante(diaSeguinte(dia), abertura, fuso).getTime()
  }
  return null
}

/**
 * Quando sai a tentativa `tentativa` (0-based), ou por que a série para.
 *
 * `ultimaRetomada`: quando a retomada anterior desta série SAIU de fato (nulo
 * na primeira). `fimDaJanelaMeta`: quando fecha a janela de 24 h da Meta na
 * conexão (nulo = a conexão não é oficial, ou nada a conferir).
 *
 * A ordem: o vencimento nominal (âncora + cadência; o espaçamento da cadência
 * depois da anterior; o piso de 30 min depois dela; e nunca antes de agora) →
 * a janela → a reunião (a menos de 90 min,
 * PARA) → os lembretes (a menos de 30 min, empurra para 30 min depois deles e
 * volta à janela) → a janela da Meta. Laço com teto: um lembrete a cada meia
 * hora a noite inteira não prende a conta num laço infinito.
 */
export function proximaRetomada(args: {
  ancora: number
  tentativa: number
  ultimaRetomada: number | null
  agora: number
  config: Pick<ConfigDaRetomada, 'cadencia' | 'janela'>
  horario: Horario | null
  bloqueios: Bloqueios
  fimDaJanelaMeta: number | null
  fuso?: string
}): ProximaRetomada {
  const { config } = args
  if (args.tentativa < 0 || args.tentativa >= config.cadencia.length) return { tipo: 'parar', motivo: 'cadencia_acabou' }
  const janela = janelaEfetiva(config.janela, args.horario)
  if (!janela) return { tipo: 'parar', motivo: 'sem_janela' }

  const k = args.tentativa
  const anterior = args.ultimaRetomada
  let t = Math.max(
    args.ancora + config.cadencia[k] * 60_000,
    // O ESPAÇAMENTO: a anterior adiada (janela, lembrete, cron) empurra esta.
    anterior === null || k === 0 ? Number.NEGATIVE_INFINITY : anterior + (config.cadencia[k] - config.cadencia[k - 1]) * 60_000,
    anterior === null ? Number.NEGATIVE_INFINITY : anterior + INTERVALO_MINIMO_MS,
    args.agora,
  )
  const reunioes = args.bloqueios.reunioes.filter((r) => r > args.agora)
  for (let i = 0; i < 64; i++) {
    const naJanela = dentroDaJanela(t, janela, args.fuso)
    if (naJanela === null) return { tipo: 'parar', motivo: 'sem_janela' }
    t = naJanela
    if (reunioes.some((r) => t >= r - ANTES_DA_REUNIAO_MS)) return { tipo: 'parar', motivo: 'reuniao_proxima' }
    const lembrete = args.bloqueios.lembretes.find((l) => Math.abs(t - l) < FOLGA_DO_LEMBRETE_MS)
    if (lembrete !== undefined) {
      t = lembrete + FOLGA_DO_LEMBRETE_MS
      continue
    }
    if (args.fimDaJanelaMeta !== null && t > args.fimDaJanelaMeta - FOLGA_DA_JANELA_META_MS) {
      return { tipo: 'parar', motivo: 'janela_24h' }
    }
    return { tipo: 'agendar', instante: t }
  }
  return { tipo: 'parar', motivo: 'sem_janela' }
}

// ------------------------------------------------------------
// Quem escreveu depois da âncora
// ------------------------------------------------------------

/** Uma mensagem gravada DEPOIS da âncora (`messages`, a conversa inteira). */
export interface MensagemDepois {
  sender_type: string
  ia_agente_id: string | null
}

export type MotivoDaParada = 'cliente_respondeu' | 'equipe_respondeu' | 'robo_falou'

/**
 * Alguém escreveu depois da âncora? A série para. A MESMA régua da reserva
 * (1056): o cliente (apagada também — ele escreveu), a equipe (`agent`, pelo
 * CRM ou pelo celular pareado), o robô ou uma automação (`bot` sem agente) ou
 * OUTRO agente. As retomadas do próprio agente não param nada. Nulo = ninguém.
 */
export function motivoDaParada(depois: readonly MensagemDepois[], agenteId: string): MotivoDaParada | null {
  if (depois.some((m) => m.sender_type === 'customer')) return 'cliente_respondeu'
  if (depois.some((m) => m.sender_type === 'agent')) return 'equipe_respondeu'
  if (depois.some((m) => m.sender_type === 'bot' && m.ia_agente_id !== agenteId)) return 'robo_falou'
  return null
}

// ------------------------------------------------------------
// Os lembretes da reunião, a partir das automações e da ficha
// ------------------------------------------------------------

/** Uma automação de lembrete da conta que vigia um campo (fonte campo), ligada ou não. */
export interface LembreteDaConta {
  campoId: string
  /**
   * O deslocamento em ms (`deslocamentoEmMs`). Nulo = a config é ilegível
   * (`motivoDeConfigInvalida`): o campo ainda é a data da reunião, mas não há
   * instante de lembrete.
   */
  deslocamentoMs: number | null
  direcao: 'antes' | 'depois'
}

/**
 * Os bloqueios de UM contato: cada lembrete aplicado ao valor do campo que ele
 * vigia (`instante` já canonizado: nulo = o campo vazio ou ilegível, e nada
 * bloqueia). O valor do campo é a REUNIÃO.
 */
export function bloqueiosDoContato(
  lembretes: readonly LembreteDaConta[],
  instanteDoCampo: (campoId: string) => number | null,
): Bloqueios {
  const saida: Bloqueios = { lembretes: [], reunioes: [] }
  for (const l of lembretes) {
    const reuniao = instanteDoCampo(l.campoId)
    if (reuniao === null) continue
    if (!saida.reunioes.includes(reuniao)) saida.reunioes.push(reuniao)
    if (l.deslocamentoMs === null) continue
    saida.lembretes.push(l.direcao === 'depois' ? reuniao + l.deslocamentoMs : reuniao - l.deslocamentoMs)
  }
  return saida
}

// ------------------------------------------------------------
// Textos
// ------------------------------------------------------------

/** "15 minutes", "3 hours", "2 days" — para o MODELO (o pedido é em inglês). */
export function tempoEmIngles(ms: number): string {
  const minutos = Math.max(1, Math.round(ms / 60_000))
  if (minutos < 60) return `${minutos} minute${minutos === 1 ? '' : 's'}`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return `${horas} hour${horas === 1 ? '' : 's'}`
  const dias = Math.floor(horas / 24)
  return `${dias} days`
}

/**
 * Como a tela mostra um intervalo da cadência: minutos, horas (até 72 h) ou
 * dias (múltiplo de 24 h a partir de 3 dias). A tela traduz a unidade.
 */
export function partesDoIntervalo(minutos: number): { valor: number; unidade: 'min' | 'h' | 'd' } {
  if (minutos % 1440 === 0 && minutos >= 3 * 1440) return { valor: minutos / 1440, unidade: 'd' }
  if (minutos % 60 === 0) return { valor: minutos / 60, unidade: 'h' }
  return { valor: minutos, unidade: 'min' }
}
