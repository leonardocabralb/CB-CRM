// ============================================================
// O agente está no HORÁRIO dele agora? (D12). PURO, testado.
//
// ⚠️ No fuso do escritório (`FUSO_DO_ESCRITORIO`, o MESMO do `dataEHora` do
// pedido — a hora que o modelo lê e o portão concordam), nunca
// `Date.getDay()`/`getHours()`: o servidor roda em UTC.
// Janela `[inicio, fim)` no mesmo dia; não atravessa a meia-noite nem sabe de
// feriado (fora da primeira versão). Nulo = sempre.
// ============================================================

import type { Horario } from './agente'
import { FUSO_DO_ESCRITORIO } from './pedido'

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

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
