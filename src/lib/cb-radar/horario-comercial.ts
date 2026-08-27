// ============================================================
// Tempo ÚTIL entre dois instantes — a régua justa do Radar.
//
// Mensagem do cliente às 23h respondida às 8h30 não é "9 horas sem
// resposta". Sem esta régua a nota pune atendimento normal e a equipe —
// com razão — para de confiar no número. Usada nas métricas do worker e
// na exibição de pendência do painel (é pura de propósito: roda nos dois).
//
// O expediente é uma CONSTANTE por enquanto (seg–sex, 08h–19h). Virar
// configuração por conta é evolução conhecida; o valor mora aqui para a
// mudança ser um diff de um arquivo.
//
// ⚠️ Fuso fixo -03:00, sem biblioteca de timezone: o Brasil não tem
// horário de verão desde 2019, então America/Sao_Paulo é um offset
// constante para qualquer data que o Radar analise (janela de 7 dias,
// nunca datas históricas). Se o horário de verão voltar um dia, este
// arquivo é o único a mudar.
// ============================================================

/** Exportado para quem mais precisa converter instante → relógio de
 *  parede de São Paulo (o carimbo das linhas do transcrito, na rubrica).
 *  Fora deste arquivo, use `horaSp` — não o offset cru. */
export const OFFSET_SP_MS = -3 * 3_600_000
/** Exportadas para a legenda do painel imprimir o expediente REAL — o
 *  backlog prevê expediente configurável, e um "08h–19h" digitado no
 *  dicionário mentiria na primeira conta que o mudasse. */
export const ABRE_HORA = 8
export const FECHA_HORA = 19
const DIA_MS = 24 * 3_600_000

/** "26/08 14:32" — o instante no relógio de parede de São Paulo. */
export function horaSp(d: Date): string {
  const w = new Date(d.getTime() + OFFSET_SP_MS)
  const dd = String(w.getUTCDate()).padStart(2, '0')
  const mm = String(w.getUTCMonth() + 1).padStart(2, '0')
  const hh = String(w.getUTCHours()).padStart(2, '0')
  const mi = String(w.getUTCMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}:${mi}`
}

/**
 * Segundos de expediente entre dois instantes. Zero quando `fim` não é
 * depois de `inicio` — o que também engole intervalo negativo vindo de
 * relógio dessincronizado (webhook carimba a hora do WhatsApp na entrada
 * e o Postgres carimba `now()` na saída).
 */
export function segundosUteisEntre(inicio: Date, fim: Date): number {
  let inicioMs = inicio.getTime() + OFFSET_SP_MS
  const fimMs = fim.getTime() + OFFSET_SP_MS
  if (!Number.isFinite(inicioMs) || !Number.isFinite(fimMs) || fimMs <= inicioMs) {
    return 0
  }
  // O laço abaixo anda um dia por volta. O Radar só mede dentro da janela
  // de 7 dias, mas esta função roda no navegador por linha por render —
  // um carimbo corrompido (epoch, por exemplo) custaria ~20 mil voltas
  // por chamada e travaria a aba. Um ano de teto preserva qualquer uso
  // legítimo e limita o pior caso.
  const TETO_MS = 366 * DIA_MS
  if (fimMs - inicioMs > TETO_MS) inicioMs = fimMs - TETO_MS

  let total = 0
  // Cursor na meia-noite (relógio de parede) do dia do início.
  const primeiro = new Date(inicioMs)
  let dia = Date.UTC(
    primeiro.getUTCFullYear(),
    primeiro.getUTCMonth(),
    primeiro.getUTCDate(),
  )

  while (dia < fimMs) {
    const diaSemana = new Date(dia).getUTCDay() // 0=dom … 6=sáb
    if (diaSemana >= 1 && diaSemana <= 5) {
      const abre = dia + ABRE_HORA * 3_600_000
      const fecha = dia + FECHA_HORA * 3_600_000
      const de = Math.max(abre, inicioMs)
      const ate = Math.min(fecha, fimMs)
      if (ate > de) total += ate - de
    }
    dia += DIA_MS
  }

  return Math.round(total / 1000)
}

/**
 * "2h", "45min", "3d 2h" — duração útil legível para o painel. Recebe
 * segundos (de `segundosUteisEntre`); um dia útil aqui tem 11 horas
 * (08h–19h), então "1d" significa "um expediente inteiro".
 */
export function formatarDuracaoUtil(segundos: number): string {
  if (segundos < 60) return '<1min'
  const DIA_UTIL_SEG = (FECHA_HORA - ABRE_HORA) * 3600
  const dias = Math.floor(segundos / DIA_UTIL_SEG)
  const resto = segundos % DIA_UTIL_SEG
  const horas = Math.floor(resto / 3600)
  const minutos = Math.floor((resto % 3600) / 60)
  if (dias > 0) return horas > 0 ? `${dias}d ${horas}h` : `${dias}d`
  if (horas > 0) return minutos > 0 ? `${horas}h ${minutos}min` : `${horas}h`
  return `${minutos}min`
}
