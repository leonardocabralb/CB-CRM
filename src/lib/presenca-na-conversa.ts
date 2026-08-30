// ============================================================
// Presença por conversa — derivação pura, sem I/O (irmã de lib/presence).
//
// A tabela `cb_conversa_aberta` (956) guarda a ÚLTIMA conversa aberta por
// membro e o `visto_em` da última batida. "Está vendo AGORA" é derivado
// aqui, nunca gravado: aba fechada não escreve nada (a mesma filosofia da
// 024 — write de unload não é confiável), então o corte é por staleness,
// com o MESMO limiar do resto da presença (`OFFLINE_AFTER_MS`). Um limiar
// próprio faria a bolinha do roster e o avatar da conversa discordarem
// sobre a mesma pessoa.
//
// `agora` entra por parâmetro (epoch ms) — determinístico e testável.
// ============================================================

import { OFFLINE_AFTER_MS } from '@/lib/presence';

/** Linha crua de `cb_conversa_aberta`, como chega do select/realtime. */
export interface ConversaAbertaRow {
  user_id: string;
  conversation_id: string | null;
  visto_em: string;
}

/**
 * Quem está com ESTA conversa aberta agora — além de mim.
 *
 * Regras, todas com motivo:
 *   - só a MESMA conversa (null = fora de conversa, nunca casa);
 *   - eu fico de fora (ver o próprio avatar "também está aqui" é ruído);
 *   - batida velha (> OFFLINE_AFTER_MS) = saiu — aba fechada não avisa;
 *   - `visto_em` ilegível = fora, sem estourar;
 *   - ordem estável por user_id: avatar não pode trocar de lugar a cada
 *     batida de heartbeat.
 */
export function quemVeAConversa(
  rows: ConversaAbertaRow[],
  conversationId: string | null,
  meuUserId: string | null | undefined,
  agora: number,
): string[] {
  if (!conversationId) return [];

  const vistos = new Set<string>();
  for (const row of rows) {
    if (row.conversation_id !== conversationId) continue;
    if (meuUserId && row.user_id === meuUserId) continue;
    const batida = new Date(row.visto_em).getTime();
    if (Number.isNaN(batida)) continue;
    if (agora - batida > OFFLINE_AFTER_MS) continue;
    vistos.add(row.user_id);
  }

  return [...vistos].sort();
}
