// ============================================================
// POSSE do envio do disparo (migration 1147) — NOSSO, porte do original
// #683 (`broadcast-delivery-lease.ts`), com o TOKEN.
//
// O assistente de disparo envia do navegador de quem disparou, em lotes de
// 10. Sem dizer isso ao banco, a tela da campanha via `sending` + pendentes,
// anunciava "parou no meio" e oferecia o Retomar; a retomada achava a trava
// dela livre e mandava pelo servidor os mesmos pendentes que o assistente
// ainda ia mandar — o modelo PAGO em dobro, sem como recolher.
//
// Regras, e por quê:
//  - O PRAZO é o relógio do BANCO (`now()` dentro das funções da 1147): o do
//    navegador pode estar errado por minutos.
//  - O assistente toma a posse logo depois de criar a campanha e a RENOVA
//    antes de cada lote (e depois de cada espera do 429); a ROTA do lote a
//    renova antes do 1º envio e a cada minuto do lote (`api/whatsapp/
//    broadcast`), porque um lote lento no servidor, ou um pedido que chega
//    atrasado, passaria do prazo. Posse perdida = PARA e NUNCA reenvia: quem
//    assumiu manda os pendentes.
//  - O TOKEN (gerado no navegador) é o que identifica o dono. Tomar e renovar
//    com o mesmo token são REPETÍVEIS: o pedido que gravou e cuja resposta se
//    perdeu, repetido, continua valendo. O original compara o próprio prazo,
//    e a repetição virava "outro envio assumiu" — falso, e a campanha parava.
//  - A retomada (`claimBroadcastDelivery`) só assume com a posse vencida e a
//    APAGA na mesma escrita: a aba que acordar depois perde a renovação.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Quanto vale a posse: o `INTERVAL '5 minutes'` da 1147 (pino em
 * `supabase/migrations/posse-do-disparo-1147.test.ts`). Também é o que a tela
 * promete ("o Retomar aparece em até N minutos" depois que a aba some).
 */
export const PRAZO_DA_POSSE_MS = 5 * 60 * 1000;

/**
 * As esperas entre as tentativas de tomar/renovar: ~1 min no total. Repetir é
 * seguro (o token torna o pedido repetível), e com poucas tentativas uma queda
 * curta de rede parava a campanha inteira — o Retomar só aparece depois do
 * prazo, e só para quem abre a página.
 */
const ESPERAS_ENTRE_TENTATIVAS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** Tentativas por chamada, a primeira incluída. */
export const TENTATIVAS_DA_POSSE = ESPERAS_ENTRE_TENTATIVAS_MS.length + 1;

export type ResultadoDaPosse =
  /** A posse é deste token até `prazo` (relógio do banco). */
  | { situacao: 'mantida'; prazo: string }
  /** Outro envio tem (ou assumiu) a posse — ou quem chama não é admin. */
  | { situacao: 'perdida' }
  /** Não deu para saber: as tentativas falharam. Nada se envia sem posse. */
  | { situacao: 'erro'; mensagem: string };

type Esperar = (ms: number) => Promise<unknown>;

const esperarDeVerdade: Esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function chamarPosse(
  db: SupabaseClient,
  funcao: 'cb_tomar_posse_do_disparo' | 'cb_renovar_posse_do_disparo',
  broadcastId: string,
  token: string,
  esperar: Esperar,
): Promise<ResultadoDaPosse> {
  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= TENTATIVAS_DA_POSSE; tentativa++) {
    try {
      const { data, error } = await db.rpc(funcao, {
        p_broadcast_id: broadcastId,
        p_token: token,
      });
      if (!error) {
        return typeof data === 'string' && data
          ? { situacao: 'mantida', prazo: data }
          : { situacao: 'perdida' };
      }
      ultimoErro = error.message;
    } catch (err) {
      ultimoErro = err instanceof Error ? err.message : String(err);
    }
    if (tentativa < TENTATIVAS_DA_POSSE) {
      await esperar(ESPERAS_ENTRE_TENTATIVAS_MS[tentativa - 1]);
    }
  }
  return { situacao: 'erro', mensagem: ultimoErro };
}

/** O assistente toma a posse da campanha que acabou de criar. */
export function tomarPosseDoDisparo(
  db: SupabaseClient,
  broadcastId: string,
  token: string,
  esperar: Esperar = esperarDeVerdade,
): Promise<ResultadoDaPosse> {
  return chamarPosse(db, 'cb_tomar_posse_do_disparo', broadcastId, token, esperar);
}

/** Antes de cada lote: a posse ainda é deste token? */
export function renovarPosseDoDisparo(
  db: SupabaseClient,
  broadcastId: string,
  token: string,
  esperar: Esperar = esperarDeVerdade,
): Promise<ResultadoDaPosse> {
  return chamarPosse(db, 'cb_renovar_posse_do_disparo', broadcastId, token, esperar);
}

/**
 * A tela da campanha: há envio em andamento (posse do assistente no prazo, ou
 * trava da retomada recente)? `null` = não sei (a leitura falhou ou a campanha
 * não é visível) — a tela não afirma "parou no meio" sobre ignorância.
 */
export async function disparoEmAndamento(
  db: SupabaseClient,
  broadcastId: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await db.rpc('cb_disparo_em_andamento', {
      p_broadcast_id: broadcastId,
    });
    if (error) {
      console.error('[broadcast-posse] não conferiu o envio em andamento:', error.message);
      return null;
    }
    return typeof data === 'boolean' ? data : null;
  } catch (err) {
    console.error('[broadcast-posse] não conferiu o envio em andamento:', err);
    return null;
  }
}
