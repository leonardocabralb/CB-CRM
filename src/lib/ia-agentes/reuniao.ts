// ============================================================
// A REUNIÃO que o agente marca (F5 dos agentes — D7 + D28 do
// docs/PLANO-agentes-de-ia.md). PURO, testado: a janela dos horários livres,
// a amostra oferecida e como cada horário aparece (para o modelo e para
// gente), o corpo do `POST /invitees` — com o telefone na pergunta do
// formulário que o nosso webhook lê — e a leitura da recusa do Calendly. O
// I/O mora em `agenda.ts`.
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

import type { PerguntaDoTipoDeEvento } from '@/lib/calendly/cliente'
import { casaComAPerguntaConfigurada, rotuloDeTelefone } from '@/lib/calendly/payload'
import { FUSO_DO_ESCRITORIO } from '@/lib/contacts/campo-data'
import { isValidE164 } from '@/lib/whatsapp/phone-utils'

import type { OpcaoDeAcao } from './acoes'

/** Prazo da leitura dos horários no turno e no Playground: estourou = "não há horários agora". */
export const PRAZO_DOS_HORARIOS_MS = 4_000
/** Quantos horários o pedido oferece, no total (uma AMOSTRA espalhada pelos dias, `opcoesDeHorario`). */
export const TETO_DE_HORARIOS = 15
/** Quantos horários de um mesmo dia, no máximo. */
export const HORARIOS_POR_DIA = 3
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
  /**
   * A reunião FUTURA que o cliente já tem (a mesma leitura do bloco "reuniao"
   * da F3: o próximo `invitee.created` sem `invitee.canceled`). Com ela,
   * nenhum horário é oferecido: o pedido diz quando é e manda o link de
   * remarcar DELA (`remarcar`), ou transferir sem ele. Ausente/nulo = nenhuma.
   */
  reuniaoMarcada?: ReuniaoJaMarcada | null
}

/** A reunião que o cliente já tem: o início (ISO) e o link de remarcar (`agendamento_remarcar`), se houver. */
export interface ReuniaoJaMarcada {
  inicio: string
  remarcar: string | null
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
 * "segunda às 15h" do cliente com a linha certa. `null` = ISO ilegível. Só
 * no PEDIDO (`OpcaoDeAcao.textoNoPedido`): o que gente lê — o registro do
 * turno, o Playground, a anotação — é `dataHoraDaReuniao`.
 */
export function textoDoHorario(iso: string, fuso: string = FUSO_DO_ESCRITORIO): string | null {
  const p = partes(iso, fuso, { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }, 'en-GB')
  return p ? `${p('weekday')} ${p('day')}/${p('month')} ${p('hour')}:${p('minute')}` : null
}

/**
 * A data e a hora da reunião para GENTE ler — o `nome` da opção (o registro
 * do turno, o Playground) e a anotação: "28/09/2026 15:15" no fuso do
 * escritório, sem dia da semana (em inglês ele apareceria na tela em
 * português).
 */
export function dataHoraDaReuniao(iso: string, fuso: string = FUSO_DO_ESCRITORIO): string {
  const p = partes(iso, fuso, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'pt-BR')
  return p ? `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}` : iso
}

/** O dia (`YYYY-MM-DD`) do instante no fuso dado. */
function diaNoFuso(ms: number, fuso: string): string {
  const p = partes(new Date(ms).toISOString(), fuso, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-GB')
  return p ? `${p('year')}-${p('month')}-${p('day')}` : ''
}

/**
 * Os horários de UM dia (em ordem) que entram na amostra, na ordem de
 * prioridade: o primeiro, o último e o do meio — espalhados pelo dia, nunca
 * três seguidos da manhã.
 */
function escolhidosDoDia(instantes: readonly number[]): number[] {
  const n = instantes.length
  if (n <= 2) return [...instantes]
  return [instantes[0], instantes[n - 1], instantes[Math.round((n - 1) / 2)]].slice(0, HORARIOS_POR_DIA)
}

/**
 * Os horários livres → as opções numeradas do pedido: uma AMOSTRA espalhada
 * pelos dias da janela, até `HORARIOS_POR_DIA` por dia e `TETO_DE_HORARIOS`
 * no total, em ordem e sem repetição. O RODÍZIO cobre todos os dias antes de
 * dar o 2º horário a qualquer um (o 1º de cada dia, depois o último, depois o
 * do meio): os 12 mais próximos eram, na prática, a manhã de amanhã — e o
 * cliente que pede quinta ouvia "não há horário". O pedido diz ao modelo que
 * é uma amostra (`pedido.ts`).
 *
 * `id` = o instante em ISO (UTC, `toISOString`) — é ele que vai no
 * `start_time` do `POST /invitees`; `nome` = `dataHoraDaReuniao` (o que gente
 * lê); `textoNoPedido` = `textoDoHorario` (o que o modelo lê, com o dia da
 * semana em inglês). ISO ilegível fica de fora.
 */
export function opcoesDeHorario(inicios: readonly string[], fuso: string = FUSO_DO_ESCRITORIO): OpcaoDeAcao[] {
  const instantes = [
    ...new Set(
      inicios
        .map((i) => Date.parse(i))
        .filter((ms) => Number.isFinite(ms)),
    ),
  ].sort((a, b) => a - b)
  const porDia = new Map<string, number[]>()
  for (const ms of instantes) {
    const dia = diaNoFuso(ms, fuso)
    const lista = porDia.get(dia)
    if (lista) lista.push(ms)
    else porDia.set(dia, [ms])
  }
  const dias = [...porDia.values()].map(escolhidosDoDia)
  const escolhidos: number[] = []
  for (let rodada = 0; rodada < HORARIOS_POR_DIA && escolhidos.length < TETO_DE_HORARIOS; rodada++) {
    for (const dia of dias) {
      if (escolhidos.length >= TETO_DE_HORARIOS) break
      if (dia[rodada] !== undefined) escolhidos.push(dia[rodada])
    }
  }
  const opcoes: OpcaoDeAcao[] = []
  for (const ms of escolhidos.sort((a, b) => a - b)) {
    const id = new Date(ms).toISOString()
    const textoNoPedido = textoDoHorario(id, fuso)
    if (textoNoPedido) opcoes.push({ id, nome: dataHoraDaReuniao(id, fuso), textoNoPedido })
  }
  return opcoes
}

/** Uma resposta do formulário no `POST /invitees` — a forma da Scheduling API (doc do Calendly, 26/09/2026). */
export interface RespostaDoFormulario {
  /** O texto EXATO da pergunta (a API casa por ele, com caixa). */
  question: string
  answer: string
  position: number
}

/** Tipos de pergunta que aceitam um telefone como resposta (os de seleção, não). */
const PERGUNTA_DE_TEXTO = new Set(['string', 'text', 'phone_number'])

/**
 * As respostas do formulário do tipo de evento que levam o TELEFONE do
 * cliente (E.164 com `+`). ⚠️ É por elas que o NOSSO webhook acha a ficha
 * (`telefoneDoAgendamento`, `payload.ts`): o Calendly não tem campo de
 * telefone, e o `text_reminder_number` só vale quando o tipo de evento pede
 * lembrete por SMS — sem elas, a reunião marcada pela IA terminaria
 * `sem_telefone` (card parado, lembretes desarmados, advogado sem aviso).
 *
 * Entre as perguntas ATIVAS de texto, respondidas:
 *  - toda de tipo `phone_number` (a mais forte: o campo de telefone do
 *    formulário — medido em 26/09/2026, "Telefone (Whatsapp)", obrigatória);
 *  - a que o operador configurou no cartão (`pergunta_telefone`), pela MESMA
 *    régua do webhook (`casaComAPerguntaConfigurada`);
 *  - sem nenhuma das duas, a PRIMEIRA cujo rótulo fala de telefone (a
 *    heurística do webhook, `rotuloDeTelefone`).
 * Nenhuma outra: não se inventa resposta. ⚠️ Pergunta OBRIGATÓRIA que não é
 * de telefone fica sem resposta, e o Calendly RECUSA o `POST /invitees`: a
 * reunião não é marcada e o turno transfere para gente — o lado seguro.
 * Sem telefone, nenhuma. Em ordem de posição.
 */
export function respostasDoTelefone(
  perguntas: readonly PerguntaDoTipoDeEvento[],
  telefone: string | null,
  perguntaConfigurada?: string | null,
): RespostaDoFormulario[] {
  if (!telefone) return []
  const candidatas = perguntas.filter((p) => p.ativa && p.tipo !== null && PERGUNTA_DE_TEXTO.has(p.tipo))
  const escolhidas = candidatas.filter(
    (p) => p.tipo === 'phone_number' || casaComAPerguntaConfigurada(p.nome, perguntaConfigurada),
  )
  if (escolhidas.length === 0) {
    const pelaHeuristica = candidatas.find((p) => rotuloDeTelefone(p.nome))
    if (pelaHeuristica) escolhidas.push(pelaHeuristica)
  }
  return [...new Map(escolhidas.map((p) => [p.nome, p])).values()]
    .sort((a, b) => a.posicao - b.posicao)
    .map((p) => ({ question: p.nome, answer: telefone, position: p.posicao }))
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
  /** As perguntas do formulário do tipo de evento, lidas na hora (`TipoDeEvento.perguntas`). */
  perguntas?: readonly PerguntaDoTipoDeEvento[]
  /** O rótulo da pergunta de telefone configurado no cartão do Calendly (`pergunta_telefone`). */
  perguntaTelefone?: string | null
  fuso?: string
}

/**
 * O corpo do `POST /invitees` (a forma da documentação do Calendly; ainda
 * NÃO medida — ajustar AQUI). O telefone da ficha, em E.164 com `+` e só
 * quando ele tem a forma de um, vai no lembrete por SMS E como resposta da
 * pergunta de telefone do formulário (`respostasDoTelefone` — é por ela que o
 * webhook acha o cliente); o local, só o `kind`.
 */
/** O telefone da ficha em E.164 com `+`, ou nulo quando ele não tem a forma de um. */
export function telefoneE164(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? '').replace(/\D/g, '')
  return digitos && isValidE164(digitos) ? `+${digitos}` : null
}

export function corpoDoConvidado(d: DadosDoConvidado): Record<string, unknown> {
  const telefone = telefoneE164(d.telefone)
  const respostas = respostasDoTelefone(d.perguntas ?? [], telefone, d.perguntaTelefone)
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
    ...(respostas.length > 0 ? { questions_and_answers: respostas } : {}),
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
