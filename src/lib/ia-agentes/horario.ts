// ============================================================
// O agente está no HORÁRIO dele agora? (D12). PURO, testado.
//
// ⚠️ No fuso do escritório (`FUSO_DO_ESCRITORIO`, o MESMO do `dataEHora` do
// pedido — a hora que o modelo lê e o portão concordam), nunca
// `Date.getDay()`/`getHours()`: o servidor roda em UTC. A constante vem de
// `campo-data` (o mesmo valor da de `pedido.ts`, amarrado no teste): a aba
// Turnos importa este módulo, e por `pedido.ts` levaria o pedido inteiro ao
// navegador.
// Janela `[inicio, fim)` no mesmo dia; não atravessa a meia-noite nem sabe de
// feriado (fora da primeira versão). Nulo = sempre.
//
// FORA DO HORÁRIO NÃO É "NUNCA" (25/10/2026): a mensagem que chega fora do
// horário fica na fila e o turno é REAGENDADO para a próxima abertura
// (`proximaAbertura`); na hora, todas as conferências rodam de novo
// (`turno.ts`). As esperas que contam do gatilho (a leitura das mídias, o
// áudio que ainda baixa) contam, num turno desses, a partir da abertura de
// hoje (`aberturaDeHoje`) — senão o gatilho da madrugada chegaria à abertura
// com o prazo vencido e a foto da noite nunca seria lida.
// ============================================================

import { diaNoFuso, paraInstante } from '@/lib/agenda/fuso'
import { FUSO_DO_ESCRITORIO } from '@/lib/contacts/campo-data'

import type { Horario } from './agente'
import { dentroDaJanela } from './retomada'

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * O `erro` do turno REAGENDADO para a abertura do horário (o status continua
 * `aguardando`). A aba Turnos o reconhece e diz "aguardando o horário do
 * agente · abre <quando>" (`turnos-do-agente.tsx`); numa tela antiga, o texto
 * cru ainda se lê. O próximo desfecho do turno (a resposta, outro
 * reagendamento) o sobrescreve.
 */
export const ERRO_DA_ESPERA_DO_HORARIO = 'fora do horário do agente: responde quando o horário abrir'

export function dentroDoHorario(horario: Horario | null, agora: Date, fuso: string = FUSO_DO_ESCRITORIO): boolean {
  if (!horario) return true
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  const dia = DIAS[valor('weekday')]
  const minutos = Number(valor('hour')) * 60 + Number(valor('minute'))
  if (dia === undefined || !Number.isFinite(minutos)) return false
  if (!horario.dias.includes(dia)) return false
  return minutos >= minutosDe(horario.inicio) && minutos < minutosDe(horario.fim)
}

/**
 * A PRÓXIMA abertura do horário do agente, em ms: o primeiro instante a
 * partir de `agora` em que `dentroDoHorario` é verdade — fora do horário, o
 * `inicio` de hoje (se ainda não passou e hoje é dia dele) ou o do próximo dia
 * dele. É o cálculo da janela da retomada (`dentroDaJanela`, reconstruído pela
 * hora de parede no fuso do escritório, nunca somando dias em ms), com a
 * janela = o horário. Dentro do horário, devolve `agora`. Nulo = sem horário
 * (sempre aberto) — nada a esperar.
 */
export function proximaAbertura(horario: Horario | null, agora: Date, fuso: string = FUSO_DO_ESCRITORIO): number | null {
  if (!horario) return null
  return dentroDaJanela(
    agora.getTime(),
    { dias: horario.dias, inicio: minutosDe(horario.inicio), fim: minutosDe(horario.fim) },
    fuso,
  )
}

/**
 * Quando o horário de HOJE abriu, em ms — só com o agente dentro do horário
 * agora; nulo sem horário (sempre aberto) ou fora dele. É a referência das
 * esperas que contam do gatilho num turno que esperou a abertura: o gatilho
 * da madrugada conta como chegado na abertura.
 */
export function aberturaDeHoje(horario: Horario | null, agora: Date, fuso: string = FUSO_DO_ESCRITORIO): number | null {
  if (!horario || !dentroDoHorario(horario, agora, fuso)) return null
  const instante = paraInstante(diaNoFuso(agora, fuso), horario.inicio, fuso).getTime()
  return Number.isFinite(instante) ? instante : null
}
