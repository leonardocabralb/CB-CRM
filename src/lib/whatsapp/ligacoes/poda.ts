// ============================================================
// A poda das gravações de ligação (4d; decisão do operador, §8.10 de
// `docs/PLANO-ligar-pelo-crm.md`): 180 dias depois da ligação saem o ÁUDIO
// (do Storage) e o DIÁLOGO (do banco); fica SÓ o resumo, que segue na faixa
// e no contexto do agente de IA. Um passo do laço lento
// (`rodarManutencaoDoCiclo`), sob o prazo comum.
//
// ⚠️ O arquivo sai ANTES da marca: com o Storage fora, a linha fica sem a
// marca e volta no ciclo seguinte (o `remove` de objeto que já não existe
// passa). Erro do Storage PARA o ciclo — costuma ser ele inteiro fora.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { ARQUIVOS_DA_GRAVACAO, BUCKET_DAS_GRAVACOES, caminhoDaGravacao, sincronizarFaixa } from './pelo-crm';

export const DIAS_DA_GRAVACAO = 180;
const LOTE = 25;

/** Nunca lança. `prazo` é um instante (ms). */
export async function podarGravacoesDeLigacao(db: SupabaseClient, prazo: number): Promise<void> {
  try {
    const limite = new Date(Date.now() - DIAS_DA_GRAVACAO * 86_400_000).toISOString();
    while (Date.now() < prazo) {
      const { data, error } = await db
        .from('cb_ligacoes')
        .select('id, account_id')
        .eq('pelo_crm', true)
        .is('gravacao_expirada_em', null)
        .lt('criada_em', limite)
        // Toda ATENDIDA pode ter arquivo: os lados chegam mesmo quando o
        // estéreo não chega (e só ele carimba `gravacao_recebida_em`).
        .not('atendida_pelo_crm_em', 'is', null)
        .order('criada_em', { ascending: true })
        .limit(LOTE);
      if (error) {
        console.error('[ligacoes] poda: leitura falhou:', error.message);
        return;
      }
      const linhas = (data ?? []) as { id: string; account_id: string }[];
      for (const l of linhas) {
        if (Date.now() >= prazo) return;
        const { error: erroDoStorage } = await db.storage
          .from(BUCKET_DAS_GRAVACOES)
          .remove(ARQUIVOS_DA_GRAVACAO.map((a) => caminhoDaGravacao(l.account_id, l.id, a)));
        if (erroDoStorage) {
          console.error('[ligacoes] poda: o Storage recusou:', erroDoStorage.message);
          return;
        }
        const { error: erroDaMarca } = await db
          .from('cb_ligacoes')
          .update({ transcricao: null, transcricao_desde: null, gravacao_expirada_em: new Date().toISOString() })
          .eq('id', l.id)
          .is('gravacao_expirada_em', null);
        if (erroDaMarca) {
          console.error('[ligacoes] poda: a marca não gravou:', l.id, erroDaMarca.message);
          return;
        }
        await sincronizarFaixa(db, l.id);
      }
      if (linhas.length < LOTE) return;
    }
  } catch (err) {
    console.error('[ligacoes] poda parou:', err instanceof Error ? err.message : String(err));
  }
}
