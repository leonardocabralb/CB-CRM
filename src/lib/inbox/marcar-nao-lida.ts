import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// "Marcar como não lida", de dentro da conversa (pedido do operador,
// 13/10/2026): a conversa volta a mostrar a bolinha na lista, para alguém
// voltar nela depois.
//
// A não lida é UMA por conversa (`conversations.unread_count`), a da caixa
// compartilhada: marcar vale para a equipe inteira, como o zero que abrir a
// conversa grava hoje.
// ============================================================

/**
 * Grava a conversa como não lida. Devolve `true` quando ela FICOU não lida —
 * inclusive quando já estava (o cliente escreveu no meio).
 *
 * - Só sobe de 0 (ou nulo) para 1: um contador de verdade (o cliente mandou
 *   três mensagens) não vira 1.
 * - ⚠️ Zero linhas com `error: null` tem DUAS causas, e a resposta se MEDE,
 *   nunca se infere: a conversa já era não lida (a cerca do 0 não casou) ou a
 *   RLS barrou a escrita (Visualizador: a policy exige `agent`). Relê a linha
 *   e responde pelo que o banco tem.
 */
export async function marcarComoNaoLida(
  db: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('conversations')
    .update({ unread_count: 1 })
    .eq('id', conversationId)
    .or('unread_count.is.null,unread_count.eq.0')
    .select('id');
  if (error) {
    console.error('[marcar-nao-lida] gravar falhou:', error.message);
    return false;
  }
  if (data && data.length > 0) return true;

  const { data: linha, error: erroDaLeitura } = await db
    .from('conversations')
    .select('unread_count')
    .eq('id', conversationId)
    .maybeSingle();
  if (erroDaLeitura || !linha) return false;
  return ((linha.unread_count as number | null) ?? 0) > 0;
}
