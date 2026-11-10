import type { ConversationNote } from '@/types';

// ============================================================
// Lixeira de anotações (1132) — as regras puras
//
// Decisões do operador (10/11/2026): apagar MARCA a anotação (`apagada_em`),
// e ela fica na lixeira da aba Notas por 90 dias; vê a lixeira quem vê as
// anotações; restaura quem podia apagar (o autor ou admin/dono); o aviso de
// anotação apagada diz isso, com o texto completo, quem apagou e quando.
// ============================================================

/** O prazo da lixeira (o mesmo da Lixeira de contatos, decisão do operador). */
export const DIAS_NA_LIXEIRA_DE_ANOTACOES = 90;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * A anotação está na lixeira? Ausente conta como VIVA: a linha do app antigo
 * (ou de antes da 1132) não tem a coluna, e nenhuma delas foi marcada.
 */
export function estaApagada(nota: Pick<ConversationNote, 'apagada_em'>): boolean {
  return typeof nota.apagada_em === 'string' && nota.apagada_em !== '';
}

/**
 * Quem pode apagar E restaurar: o AUTOR ou admin/dono — a régua da policy de
 * DELETE da 918, repetida pela rota. Anotação sem autor (automação, agente de
 * IA, autor que saiu) só o admin.
 */
export function podeMexerNaNota(
  nota: Pick<ConversationNote, 'author_user_id'>,
  usuarioId: string | null | undefined,
  administra: boolean
): boolean {
  if (administra) return true;
  return !!usuarioId && nota.author_user_id === usuarioId;
}

/** O instante antes do qual a apagada vence (sai de vez). */
export function limiteDoVencimento(agora: number): string {
  return new Date(agora - DIAS_NA_LIXEIRA_DE_ANOTACOES * DIA_MS).toISOString();
}

/**
 * Quantos dias faltam para a apagada sair de vez (nunca negativo). `null`
 * quando a data não se lê — a tela cala o prazo, nunca inventa um.
 */
export function diasParaVencer(apagadaEm: string, agora: number): number | null {
  const t = Date.parse(apagadaEm);
  if (Number.isNaN(t)) return null;
  const restante = t + DIAS_NA_LIXEIRA_DE_ANOTACOES * DIA_MS - agora;
  return Math.max(0, Math.ceil(restante / DIA_MS));
}

/**
 * A ordem da lixeira: pela data em que a anotação foi ESCRITA (pedido do
 * operador), a mais recente em cima — a mesma ordem da aba Notas, para a
 * pessoa achar a apagada onde ela estava. Desempate pelo id, estável.
 */
export function naOrdemDaLixeira<T extends Pick<ConversationNote, 'id' | 'created_at'>>(
  apagadas: readonly T[]
): T[] {
  return [...apagadas].sort((a, b) => {
    const dif = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (dif !== 0 && !Number.isNaN(dif)) return dif;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
