import type { SupabaseClient } from '@supabase/supabase-js';

import { limiteDoVencimento } from './lixeira';

// ============================================================
// O vencimento da lixeira de anotações (1132): a apagada há mais de 90 dias
// sai de VEZ (decisão do operador, 10/11/2026 — o prazo da Lixeira de
// contatos).
//
// Roda no ciclo de manutenção das agendadas (`manutencao-do-ciclo.ts`),
// ANTES da drenagem da fila de arquivos: o DELETE de verdade aciona o
// gatilho da 1102, que põe os anexos da anotação na fila, e a drenagem do
// MESMO ciclo os leva (ela confere de novo se alguém ainda os cita).
//
// ⚠️ Em lotes de `ANOTACOES_POR_CICLO`, pelas mais antigas: um acúmulo (o
// agendador parado por dias) não vira um DELETE enorme segurando a tabela
// que a caixa de entrada lê; o resto sai nos ciclos seguintes, 15 min depois.
// ⚠️ O DELETE repete a cerca (`apagada_em` antes do limite): a anotação
// RESTAURADA entre a leitura e o DELETE não pode sumir.
// NUNCA lança: devolve quantas saíram (0 na falha, com o log).
// ============================================================

export const ANOTACOES_POR_CICLO = 200;

export async function vencerLixeiraDeAnotacoes(
  admin: SupabaseClient,
  agora: number = Date.now()
): Promise<{ excluidas: number; erro: string | null }> {
  try {
    const limite = limiteDoVencimento(agora);
    const { data, error } = await admin
      .from('cb_conversation_notes')
      .select('id')
      .not('apagada_em', 'is', null)
      .lt('apagada_em', limite)
      .order('apagada_em', { ascending: true })
      .limit(ANOTACOES_POR_CICLO);
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((l) => (l as { id: string }).id);
    if (ids.length === 0) return { excluidas: 0, erro: null };

    const { count, error: erroApagar } = await admin
      .from('cb_conversation_notes')
      .delete({ count: 'exact' })
      .in('id', ids)
      .not('apagada_em', 'is', null)
      .lt('apagada_em', limite);
    if (erroApagar) throw new Error(erroApagar.message);
    const excluidas = count ?? 0;
    if (excluidas > 0) {
      console.info(
        `[agendadas] lixeira de anotações: ${excluidas} anotação(ões) vencida(s) excluída(s) de vez.`
      );
    }
    return { excluidas, erro: null };
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err);
    console.error('[agendadas] lixeira de anotações: o vencimento falhou:', erro);
    return { excluidas: 0, erro };
  }
}
