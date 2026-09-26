// ============================================================
// Como terminou a ligação: atendida no celular do escritório ou perdida.
//
// A regra saiu da medição de 25/09/2026 no log da Evolution: nas 2 ligações
// atendidas chegou um `accept` vindo do PRÓPRIO aparelho do escritório, no
// mesmo segundo em que a chamada parou de tocar; nas 3 que ninguém atendeu,
// nenhum `accept`. Então:
//
//   - houve `accept`                         → atendida;
//   - acabou de tocar (terminate/timeout/
//     reject) sem `accept`, e já passou a
//     FOLGA desde que o CRM gravou o fim     → perdida;
//   - qualquer outra coisa                    → ainda não dá para dizer.
//
// ⚠️ A folga não é enfeite. O `terminate` e o `accept` da ligação atendida
// saem no MESMO segundo, mas em POSTs separados, e cada POST roda no seu
// `after()` — a ordem de chegada não é garantida. Concluir "perdida" no
// instante do `terminate` pintaria de vermelho uma ligação que o advogado
// atendeu.
//
// Puro, sem I/O.
// ============================================================

export type DesfechoDaLigacao = 'atendida' | 'perdida';

/** Quanto esperar, depois de gravado o fim, antes de concluir "perdida". */
export const FOLGA_DO_DESFECHO_MS = 10_000;

export interface EstadoDaLigacao {
  atendida_em: string | null;
  encerrada_em: string | null;
  /** Relógio do CRM: quando o aviso de fim foi gravado. */
  encerramento_gravado_em: string | null;
}

export function desfechoDaLigacao(
  estado: EstadoDaLigacao,
  agoraMs: number,
): DesfechoDaLigacao | null {
  if (estado.atendida_em) return 'atendida';
  if (!estado.encerrada_em) return null;
  const gravado = Date.parse(estado.encerramento_gravado_em ?? '');
  if (Number.isFinite(gravado) && agoraMs - gravado < FOLGA_DO_DESFECHO_MS) return null;
  return 'perdida';
}

/**
 * Quantos segundos tocou (do `offer` ao fim). `null` quando falta uma das
 * pontas ou o relógio andou para trás — melhor não dizer do que dizer errado.
 */
export function segundosTocando(inicio: string | null, fim: string | null): number | null {
  const a = Date.parse(inicio ?? '');
  const b = Date.parse(fim ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}
