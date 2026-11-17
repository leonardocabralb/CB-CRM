// ============================================================
// A tela da campanha (`broadcasts/[id]/page.tsx`) — NOSSO, porte do
// original (#683 e #679), com as regras puras aqui para ter teste.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { BroadcastRecipient, BroadcastStatus } from '@/types';
import {
  PAGINA,
  buscarPorChave,
  type ResultadoPaginado,
} from '@/lib/supabase/paginar';

/**
 * O que a faixa de cima da campanha mostra.
 *
 * - `em_andamento`: um envio está rodando (a posse do assistente ou a trava
 *   da retomada, `cb_disparo_em_andamento`, 1147). Nada de "parou no meio" nem
 *   de Retomar: o Retomar daqui mandava o modelo pago em dobro.
 * - `desconhecido`: não deu para conferir. A tela não afirma "parado" sobre
 *   ignorância, e não oferece o Retomar (recarregar resolve).
 * - `parado`: `sending` com pendentes e NINGUÉM enviando — a aba fechou no
 *   meio. Retomar.
 * - `retentar`: sobrou falha (ou pendente numa campanha já fechada).
 * - `null`: nada pendente nem falho.
 */
export type PainelDaRetomada = 'em_andamento' | 'desconhecido' | 'parado' | 'retentar' | null;

export function painelDaRetomada(args: {
  status: BroadcastStatus;
  pendentes: number;
  falhos: number;
  emAndamento: boolean | null;
}): PainelDaRetomada {
  const { status, pendentes, falhos, emAndamento } = args;
  if (pendentes === 0 && falhos === 0) return null;
  if (emAndamento === true) return 'em_andamento';
  if (emAndamento === null) return 'desconhecido';
  return status === 'sending' && pendentes > 0 ? 'parado' : 'retentar';
}

/** A ordem da tela: os mais novos primeiro (desempate pelo id). */
export function ordenarComoATela<T extends { id: string; created_at: string }>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });
}

/**
 * TODOS os destinatários da campanha, com o contato — por CHAVE (`id`), mil
 * por página, em fila (`buscarPorChave`).
 *
 * ⚠️⚠️ Sem paginar, o PostgREST cortava em 1.000 em silêncio: a tabela, o
 * filtro "Falhou", as contagens do Retomar e o CSV paravam ali, com cara de
 * campanha inteira (#679 do original). `linhas: null` (erro ou acima do teto
 * de 25.000) é o contrato "não confie": a tela mostra o erro, NUNCA a lista
 * parcial. A ordem da tela vem depois, na memória (`ordenarComoATela`).
 */
export async function lerDestinatariosDaCampanha(
  db: SupabaseClient,
  broadcastId: string,
): Promise<ResultadoPaginado<BroadcastRecipient>> {
  const resultado = await buscarPorChave<BroadcastRecipient>((depoisDe) => {
    let consulta = db
      .from('broadcast_recipients')
      .select('*, contact:contacts(*)')
      .eq('broadcast_id', broadcastId)
      .order('id', { ascending: true })
      .limit(PAGINA);
    if (depoisDe) consulta = consulta.gt('id', depoisDe);
    return consulta;
  });
  return resultado.linhas
    ? { ...resultado, linhas: ordenarComoATela(resultado.linhas) }
    : resultado;
}
