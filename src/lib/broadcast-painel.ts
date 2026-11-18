// ============================================================
// A tela da campanha (`broadcasts/[id]/page.tsx`) — NOSSO, porte do
// original (#683 e #679), com as regras puras aqui para ter teste.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { BroadcastRecipient, BroadcastStatus } from '@/types';
import { ENTREGA_INCERTA } from '@/lib/broadcast-status';
import {
  PAGINA,
  buscarPorChave,
  type ResultadoPaginado,
} from '@/lib/supabase/paginar';

/**
 * Em quantos minutos a trava da RETOMADA fica velha: o `DELIVERY_LOCK_STALE_MS`
 * de `broadcast-resume.ts`, que importa código de servidor e não pode vir à
 * tela. É o que a faixa "Envio em andamento" promete quando quem enviava era o
 * servidor e a passada caiu. Pino em
 * `supabase/migrations/posse-do-disparo-1147.test.ts`.
 */
export const MINUTOS_DA_TRAVA_DA_RETOMADA = 30;

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

/**
 * NOSSO (1151): a faixa "entrega incerta" só aparece com o envio PARADO
 * (`emAndamento === false`). Com envio rodando, a linha que está saindo fica
 * `uncertain` por um instante (a reserva antes da Meta), e a faixa afirmaria
 * uma incerta que logo vira "enviado"; sem saber (`null`), também não afirma.
 * A etiqueta da linha e o filtro mostram a incerta sempre.
 */
export function mostrarFaixaDasIncertas(incertas: number, emAndamento: boolean | null): boolean {
  return incertas > 0 && emAndamento === false;
}

/**
 * Uma linha do CSV da campanha. A situação sai TRADUZIDA (`situacao`; antes
 * saía o código em inglês) e, na entrega incerta, a coluna do erro leva a
 * frase "pode ter chegado" antes do motivo técnico: no CSV ela não pode
 * parecer uma falha que se reenvia.
 */
export function linhaDoCsv(
  r: Pick<BroadcastRecipient, 'status' | 'sent_at' | 'delivered_at' | 'read_at' | 'error_message'> & {
    contact?: { name?: string | null; phone?: string | null } | null;
  },
  textos: { situacao: (status: string) => string; incerta: string },
): string[] {
  const erro =
    r.status === ENTREGA_INCERTA
      ? [textos.incerta, r.error_message].filter(Boolean).join(' — ')
      : (r.error_message ?? '');
  return [
    r.contact?.name ?? '',
    r.contact?.phone ?? '',
    textos.situacao(r.status),
    r.sent_at ?? '',
    r.delivered_at ?? '',
    r.read_at ?? '',
    erro,
  ];
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
