// ============================================================
// "em 2 dias" / "há 3 horas" — relativo nos DOIS sentidos, puro.
//
// O `formatRelative` de `trigger-meta.ts` só olha para trás ("5 min atrás")
// e lê `Date.now()` por dentro, o que o torna intestável. Aqui a espera de
// automação aponta para o FUTURO (`run_at`), então a direção importa e o
// `agora` entra por parâmetro — mesmo racional do `lib/presence`.
//
// Locale: `undefined`, como manda o CLAUDE.md — fixar 'en-US' faria a data
// sair em inglês com o app em português.
// ============================================================

/**
 * Formata um instante relativo a `agora` (epoch ms), em qualquer direção.
 * Além de ~30 dias, cai para a data absoluta — "em 47 dias" não ajuda
 * ninguém a decidir nada.
 */
export function relativoAoInstante(iso: string, agora: number): string {
  const alvo = new Date(iso).getTime()
  if (Number.isNaN(alvo)) return iso

  const diffSeg = Math.round((alvo - agora) / 1000)
  const abs = Math.abs(diffSeg)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (abs < 60) return rtf.format(diffSeg, 'second')
  if (abs < 3600) return rtf.format(Math.trunc(diffSeg / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.trunc(diffSeg / 3600), 'hour')
  if (abs < 2_592_000) return rtf.format(Math.trunc(diffSeg / 86_400), 'day')
  return new Date(iso).toLocaleDateString()
}
