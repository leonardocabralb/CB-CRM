// ============================================================
// A REUNIÃO que o agente marca (F5 dos agentes — D7 + D28 do
// docs/PLANO-agentes-de-ia.md). PURO, testado: a janela dos horários livres,
// como cada horário aparece para o modelo, o corpo do `POST /invitees` e a
// leitura da recusa do Calendly. O I/O mora em `agenda.ts`.
//
// ⚠️ As datas saem de `formatToParts` no FUSO DO ESCRITÓRIO, nunca de
// `toLocaleString` (a forma muda entre majors do Node — o PR #66) nem do fuso
// do servidor (o contêiner roda em UTC: toda reunião da tarde sairia três
// horas adiantada, sem erro nenhum). A regra de `campo-data.ts`.
//
// ⚠️ O corpo do `POST /invitees` é o da DOCUMENTAÇÃO do Calendly e ainda não
// foi medido (a leitura de horários foi, em 26/09/2026). Ele é montado SÓ em
// `corpoDoConvidado`, para a medição ajustar num ponto.
// ============================================================

import { FUSO_DO_ESCRITORIO } from '@/lib/contacts/campo-data'
import { isValidE164 } from '@/lib/whatsapp/phone-utils'

import type { OpcaoDeAcao } from './acoes'

/** Prazo da leitura dos horários no turno e no Playground: estourou = "não há horários agora". */
export const PRAZO_DOS_HORARIOS_MS = 4_000
/** Quantos horários o pedido oferece (os mais próximos). */
export const TETO_DE_HORARIOS = 12
/** O primeiro horário oferecido começa daqui a pelo menos 1 h. */
export const ANTECEDENCIA_DOS_HORARIOS_MS = 60 * 60_000
/**
 * A janela lida: 7 dias a partir do início. O Calendly recusa janela maior
 * que 7 dias (medido em 26/09/2026); 1 min a menos não deixa o arredondamento
 * dele decidir.
 */
export const JANELA_DOS_HORARIOS_MS = 7 * 24 * 60 * 60_000 - 60_000

/** O que o turno sabe da agenda ANTES de gerar, para o pedido (`pedido.ts`). */
export interface AgendaNoPedido {
  /**
   * `true` = os horários foram lidos (a lista, possivelmente vazia — nenhum
   * livre nos 7 dias —, vem em `OpcoesDeAcao.marcar_reuniao`). `false` = a
   * leitura falhou ou estourou o prazo: o pedido diz que não há horários agora.
   */
  lida: boolean
  /** O e-mail do cliente está no CRM (a ficha ou o último agendamento): o Calendly o exige. */
  temEmail: boolean
}

/** A janela dos horários livres: de agora + 1 h até 7 dias depois, em ISO (UTC). */
export function janelaDosHorarios(agora: Date): { inicio: string; fim: string } {
  const inicio = agora.getTime() + ANTECEDENCIA_DOS_HORARIOS_MS
  return { inicio: new Date(inicio).toISOString(), fim: new Date(inicio + JANELA_DOS_HORARIOS_MS).toISOString() }
}

function partes(iso: string, fuso: string, opcoes: Intl.DateTimeFormatOptions, locale: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const lista = new Intl.DateTimeFormat(locale, { timeZone: fuso, hourCycle: 'h23', ...opcoes }).formatToParts(d)
  return (tipo: Intl.DateTimeFormatPartTypes) => lista.find((p) => p.type === tipo)?.value ?? ''
}

/**
 * O horário como o MODELO o lê: "Mon 28/09 15:15", no fuso do escritório. O
 * dia da semana em inglês, como o resto do pedido — é o que o deixa casar
 * "segunda às 15h" do cliente com a linha certa. `null` = ISO ilegível.
 */
export function textoDoHorario(iso: string, fuso: string = FUSO_DO_ESCRITORIO): string | null {
  const p = partes(iso, fuso, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }, 'en-GB')
  return p ? `${p('weekday')} ${p('day')}/${p('month')} ${p('hour')}:${p('minute')}` : null
}

/** A data e a hora da reunião para a ANOTAÇÃO da equipe: "28/09/2026 15:15" no fuso do escritório. */
export function dataHoraDaReuniao(iso: string, fuso: string = FUSO_DO_ESCRITORIO): string {
  const p = partes(iso, fuso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'pt-BR')
  return p ? `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}` : iso
}

/**
 * Os horários livres → as opções numeradas do pedido: os mais PRÓXIMOS, sem
 * repetição, em ordem, até `TETO_DE_HORARIOS`. `id` = o instante em ISO
 * (UTC, `toISOString`) — é ele que vai no `start_time` do `POST /invitees`;
 * `nome` = `textoDoHorario`. ISO ilegível fica de fora.
 */
export function opcoesDeHorario(inicios: readonly string[], fuso: string = FUSO_DO_ESCRITORIO): OpcaoDeAcao[] {
  const instantes = [
    ...new Set(
      inicios
        .map((i) => Date.parse(i))
        .filter((ms) => Number.isFinite(ms)),
    ),
  ].sort((a, b) => a - b)
  const opcoes: OpcaoDeAcao[] = []
  for (const ms of instantes) {
    if (opcoes.length >= TETO_DE_HORARIOS) break
    const id = new Date(ms).toISOString()
    const nome = textoDoHorario(id, fuso)
    if (nome) opcoes.push({ id, nome })
  }
  return opcoes
}

/** O que o `POST /invitees` precisa, lido na hora de marcar. */
export interface DadosDoConvidado {
  /** A URI do tipo de evento (`https://api.calendly.com/event_types/<id>`). */
  tipoDeEvento: string
  /** O `start_time` escolhido (o `id` da opção). */
  inicio: string
  nome: string
  email: string
  /** O telefone da ficha como gravado (só dígitos, E.164 sem `+`); nulo = sem telefone. */
  telefone: string | null
  /** O `kind` do primeiro local do tipo de evento; nulo = sem local. */
  local: string | null
  fuso?: string
}

/**
 * O corpo do `POST /invitees` (a forma da documentação do Calendly; ainda
 * NÃO medida — ajustar AQUI). O lembrete por SMS leva o telefone da ficha em
 * E.164 com `+`, só quando ele tem a forma de um; o local, só o `kind`.
 */
export function corpoDoConvidado(d: DadosDoConvidado): Record<string, unknown> {
  const digitos = (d.telefone ?? '').replace(/\D/g, '')
  const telefone = digitos && isValidE164(digitos) ? `+${digitos}` : null
  return {
    event_type: d.tipoDeEvento,
    start_time: d.inicio,
    invitee: {
      name: d.nome,
      email: d.email,
      timezone: d.fuso ?? FUSO_DO_ESCRITORIO,
      ...(telefone ? { text_reminder_number: telefone } : {}),
    },
    ...(d.local ? { location: { kind: d.local } } : {}),
  }
}

/**
 * O que a recusa do Calendly (4xx) quer dizer: o horário já não está livre
 * (409, ou a mensagem fala do horário/disponibilidade) ou outra recusa. A
 * forma exata da resposta de horário tomado ainda não foi medida — o 409 e
 * as palavras abaixo são a leitura conservadora, num ponto só.
 */
export function recusaDoHorario(status: number | null, mensagem: string): 'horario_indisponivel' | 'recusado' {
  if (status === 409) return 'horario_indisponivel'
  if (status !== null && status >= 400 && status < 500 && /no longer available|not available|unavailable|already (?:been )?(?:booked|taken|scheduled)|time slot|slot/i.test(mensagem)) {
    return 'horario_indisponivel'
  }
  return 'recusado'
}
