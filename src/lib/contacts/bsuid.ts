import type { SupabaseClient } from "@supabase/supabase-js";
import { ESPERAS_DA_RELEITURA_MS } from "./dedupe";

// ============================================================
// A ficha pelo BSUID da Meta (Fase 11.2): `contacts.wa_user_id`, com o índice
// único `(account_id, wa_user_id)` da 1038 — a chave é POR CONTA (P4).
//
// Casamento EXATO, sem nada de tolerante: o BSUID é um identificador opaco
// com uma grafia só. ⚠️ Ele nunca passa por `findExistingContact` (os 8
// últimos dígitos de um BSUID casariam com o celular de um cliente — e
// `findExistingContact` recusa texto com letra por isso).
//
// Quem grava `wa_user_id`/`wa_username`/`wa_parent_user_id` é só o webhook da
// Meta (pino `bsuid.chamadores.test.ts`).
// ============================================================

/** A ficha achada pelo BSUID. `phone` é NULO na ficha só-BSUID. */
export interface FichaPorBsuid {
  id: string;
  phone: string | null;
  name?: string | null;
  wa_user_id?: string | null;
  wa_parent_user_id?: string | null;
  wa_username?: string | null;
  [key: string]: unknown;
}

/** Distingue "não há ficha com este BSUID" de "não consegui procurar". */
export interface BuscaPorBsuid {
  contato: FichaPorBsuid | null;
  /** `true` = a CONSULTA falhou — "não sei", nunca "não achei". */
  falhou: boolean;
}

/** Uma leitura da ficha pelo BSUID, na conta. */
export async function buscarPorBsuid(
  db: SupabaseClient,
  accountId: string,
  bsuid: string,
): Promise<BuscaPorBsuid> {
  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .eq("wa_user_id", bsuid)
    .maybeSingle();
  if (error) return { contato: null, falhou: true };
  return { contato: (data as FichaPorBsuid | null) ?? null, falhou: false };
}

/**
 * A ficha do BSUID com a leitura REPETIDA quando falha — o gêmeo de
 * `fichaQueVenceu` (mesmas esperas). Serve aos dois momentos em que desistir
 * na primeira leitura perde a decisão "na colisão, a mensagem fica na ficha
 * achada pelo BSUID": a busca inicial que falhou e a releitura depois de um
 * 23505 (o INSERT, ou o preenchimento do BSUID numa ficha achada pelo
 * telefone). "Não achei" com a consulta respondida não é repetido.
 */
export async function fichaQueVenceuPorBsuid(
  db: SupabaseClient,
  accountId: string,
  bsuid: string,
  esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<BuscaPorBsuid> {
  let busca = await buscarPorBsuid(db, accountId, bsuid);
  for (const ms of ESPERAS_DA_RELEITURA_MS) {
    if (!busca.falhou) return busca;
    await esperar(ms);
    busca = await buscarPorBsuid(db, accountId, bsuid);
  }
  return busca;
}
