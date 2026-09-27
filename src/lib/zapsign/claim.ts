import type { SupabaseClient } from "@supabase/supabase-js";

import { RESULTADOS_REPROCESSAVEIS, type CasadoPor, type ResultadoDoEvento } from "./log";

/**
 * O CADEADO de uma entrega do ZapSign: quem está processando esta linha
 * agora. GÊMEO de `src/lib/calendly/claim.ts` e de
 * `src/lib/webhooks-de-entrada/claim.ts`, de propósito NÃO fatorado (um
 * helper genérico receberia tabela e colunas por parâmetro e esconderia as
 * cercas que precisam ser lidas). Mudou a mecânica de um, confira os outros.
 *
 * ⚠️⚠️ Processar uma assinatura MOVE O CARD e pode mandar mensagem. Conferir
 * o estado e só então processar é leitura-então-escrita: o `after()` do
 * webhook e um clique em "Processar de novo" passariam os dois. Quem consegue
 * ESCREVER `processando_desde` (`UPDATE … RETURNING`) é o dono; no deploy
 * `start-first` há dois processos Node vivos, e só o banco os serializa.
 *
 * ⚠️⚠️ Toda escrita pós-claim leva CERCA DE POSSE (o `processando_desde` do
 * próprio claim), e o processamento tem TETO menor que o recolhimento — as
 * duas peças juntas são o que torna seguro recolher por idade.
 *
 * O cadeado é da ENTREGA. O do DISPARO (duas assinaturas do mesmo documento
 * que releem o documento já completo) é outro: `cb_zapsign_documentos.
 * disparo_evento_id`, em `processar.ts`.
 */

/** Depois disto, um claim é considerado abandonado e pode ser tomado. */
export const RECOLHER_CLAIM_MS = 10 * 60 * 1000;

/**
 * Teto de um processamento; passado isto, quem está rodando desiste e grava
 * `falhou`. ⚠️ A margem para `RECOLHER_CLAIM_MS` é o que dá a garantia (há
 * teste cobrando). Desistir não cancela a promessa em voo: quem impede o
 * estrago na linha do evento é a cerca de posse.
 */
export const TETO_DE_PROCESSAMENTO_MS = 4 * 60 * 1000;

export async function comTetoDeProcessamento<T>(
  trabalho: Promise<T>,
  tetoMs: number = TETO_DE_PROCESSAMENTO_MS,
): Promise<{ pronto: true; valor: T } | { pronto: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const relogio = new Promise<{ pronto: false }>((resolve) => {
    timer = setTimeout(() => resolve({ pronto: false }), tetoMs);
  });
  try {
    return await Promise.race([trabalho.then((valor) => ({ pronto: true as const, valor })), relogio]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Puro: claims mais antigos que este instante estão abandonados. */
export function corteDoClaim(agoraMs: number): string {
  return new Date(agoraMs - RECOLHER_CLAIM_MS).toISOString();
}

export type MotivoDaRecusa = "not_found" | "ja_processado" | "ainda_processando";

/** Puro: por que o cadeado foi recusado, a partir do estado REAL da linha. */
export function motivoDaRecusa(
  linha: { resultado?: unknown; processando_desde?: unknown } | null,
  agoraMs: number,
): MotivoDaRecusa {
  if (!linha) return "not_found";
  const emCurso =
    typeof linha.processando_desde === "string" && new Date(linha.processando_desde).getTime() > agoraMs - RECOLHER_CLAIM_MS;
  // Em curso vence o resultado: "espere" e "não insista" são conselhos diferentes.
  if (emCurso) return "ainda_processando";
  if (!(RESULTADOS_REPROCESSAVEIS as readonly string[]).includes(String(linha.resultado))) return "ja_processado";
  return "ainda_processando";
}

export interface Reivindicacao {
  /** A linha reivindicada (o `RETURNING` do cadeado), ou null se não pegou. */
  linha: Record<string, unknown> | null;
  /** A consulta em si falhou — "não sei", nunca "não peguei". */
  erro: string | null;
}

/** Reivindica a entrega. Só pega linha REPROCESSÁVEL com o cadeado livre (ou abandonado). */
export async function reivindicarEvento(
  admin: SupabaseClient,
  args: { id: string; accountId: string; agoraMs?: number },
): Promise<Reivindicacao> {
  const agoraMs = args.agoraMs ?? Date.now();
  const { data, error } = await admin
    .from("cb_zapsign_eventos")
    .update({ processando_desde: new Date(agoraMs).toISOString() })
    .eq("id", args.id)
    .eq("account_id", args.accountId)
    .in("resultado", [...RESULTADOS_REPROCESSAVEIS])
    .or(`processando_desde.is.null,processando_desde.lt.${corteDoClaim(agoraMs)}`)
    .select("*")
    .maybeSingle();
  if (error) return { linha: null, erro: error.message };
  return { linha: (data as Record<string, unknown> | null) ?? null, erro: null };
}

/** Solta o cadeado sem mexer no resultado — só no caminho em que nada foi decidido. */
export async function liberarClaim(admin: SupabaseClient, id: string, claimIso: string): Promise<void> {
  const { error } = await admin
    .from("cb_zapsign_eventos")
    .update({ processando_desde: null })
    .eq("processando_desde", claimIso)
    .eq("id", id);
  if (error) console.error("[zapsign] não foi possível soltar o cadeado do evento:", error.message);
}

export interface ResultadoParaGravar {
  resultado: ResultadoDoEvento;
  detalhe: string | null;
  contactId: string | null;
  dealId?: string | null;
  casadoPor?: CasadoPor | null;
  /** O que foi entregue ao motor (sem CPF). Nulo = não mexe no que já está gravado. */
  variaveis?: Record<string, string> | null;
  documentoNome?: string | null;
}

/**
 * Carimba o resultado e SOLTA o cadeado na mesma escrita. Nunca lança — é o
 * fim de um `after()`. ⚠️ Com CERCA DE POSSE: a escrita só vale se o
 * cadeado ainda for o do SEU claim (`{ gravou: false }` é a cerca agindo).
 * Contato, negócio e variáveis NULOS não apagam o que já está gravado: o
 * fechamento por teto ou por erro chega sem eles.
 */
export async function gravarResultado(
  admin: SupabaseClient,
  eventoId: string,
  r: ResultadoParaGravar,
  claimIso?: string | null,
): Promise<{ gravou: boolean }> {
  const escrita = admin
    .from("cb_zapsign_eventos")
    .update({
      resultado: r.resultado,
      detalhe: r.detalhe ? r.detalhe.slice(0, 1000) : null,
      // `undefined` (o fechamento por teto ou erro) não mexe; `null` apaga.
      ...(r.casadoPor !== undefined ? { casado_por: r.casadoPor } : {}),
      ...(r.contactId ? { contact_id: r.contactId } : {}),
      ...(r.dealId ? { deal_id: r.dealId } : {}),
      ...(r.variaveis ? { variaveis: r.variaveis } : {}),
      ...(r.documentoNome ? { documento_nome: r.documentoNome.slice(0, 300) } : {}),
      processado_em: new Date().toISOString(),
      processando_desde: null,
    })
    .eq("id", eventoId);
  const { data, error } = await (claimIso ? escrita.eq("processando_desde", claimIso) : escrita).select("id");
  if (error) {
    console.error("[zapsign] não foi possível gravar o resultado do evento:", error.message);
    return { gravou: false };
  }
  const gravou = (data?.length ?? 0) > 0;
  if (!gravou && claimIso) {
    console.warn("[zapsign] resultado descartado — o cadeado do evento já é de outro dono:", eventoId);
  }
  return { gravou };
}
