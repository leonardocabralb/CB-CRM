import type { SupabaseClient } from "@supabase/supabase-js";

import { RESULTADOS_REPROCESSAVEIS } from "./log";

/**
 * O CADEADO de um agendamento: quem está rodando esta linha agora.
 *
 * ⚠️⚠️ Processar um agendamento MANDA MENSAGEM e mexe no card. Conferir o
 * estado e só então processar é leitura-então-escrita: dois cliques (duas
 * abas, dois administradores), ou um clique enquanto o `after()` do webhook
 * ainda roda, passam os dois pela conferência e disparam a automação duas
 * vezes. A guarda por IDADE da linha que existiu antes disto não serializa
 * nada — e não podia: em produção não há corte de duração de rota, então a
 * idade não diz se o processamento anterior terminou (achado do Codex nos
 * PRs #133 e #134).
 *
 * Quem consegue ESCREVER `processando_desde` é o dono. É o mesmo cadeado
 * `UPDATE…RETURNING` da transcrição de áudio (943), e vale pela mesma razão
 * dela: no deploy `start-first` existem dois processos Node vivos, e só o
 * banco os serializa.
 *
 * ⚠️ Toda saída do processamento tem de LIBERAR o cadeado. `gravarResultado`
 * faz isso ao carimbar o resultado; um caminho novo que esqueça deixa o
 * agendamento travado até o recolhimento.
 */

/**
 * Depois disto, um claim é considerado abandonado e pode ser tomado.
 *
 * Existe porque processo morto no meio (deploy, container reciclado) deixaria
 * a linha travada para sempre. Dez minutos é o mesmo prazo do cadeado da
 * transcrição — folgado o bastante para um processamento real (que leva
 * segundos) e curto o bastante para o operador não ficar sem o botão.
 */
export const RECOLHER_CLAIM_MS = 10 * 60 * 1000;

/** Puro: claims mais antigos que este instante estão abandonados. */
export function corteDoClaim(agoraMs: number): string {
  return new Date(agoraMs - RECOLHER_CLAIM_MS).toISOString();
}

/** Puro: por que o cadeado foi recusado, a partir do estado REAL da linha. */
export type MotivoDaRecusa = "not_found" | "ja_processado" | "ainda_processando";

export function motivoDaRecusa(
  linha: { resultado?: unknown; processando_desde?: unknown } | null,
  agoraMs: number,
): MotivoDaRecusa {
  if (!linha) return "not_found";
  const emCurso =
    typeof linha.processando_desde === "string" && new Date(linha.processando_desde).getTime() > agoraMs - RECOLHER_CLAIM_MS;
  // A ordem importa: uma linha reprocessável que está EM CURSO tem de dizer
  // isso, e não "já processado" — são conselhos diferentes para o operador
  // (esperar × não insistir).
  if (emCurso) return "ainda_processando";
  if (!(RESULTADOS_REPROCESSAVEIS as readonly string[]).includes(String(linha.resultado))) return "ja_processado";
  // Reprocessável, sem claim vivo, e ainda assim o UPDATE não pegou: outra
  // requisição ganhou a corrida entre o nosso claim e esta leitura.
  return "ainda_processando";
}

export interface Reivindicacao {
  /** A linha reivindicada (o `RETURNING` do cadeado), ou null se não pegou. */
  linha: Record<string, unknown> | null;
  /** A consulta em si falhou — "não sei", nunca "não peguei". */
  erro: string | null;
}

/**
 * Reivindica o evento para processamento. Só pega linha REPROCESSÁVEL cujo
 * cadeado esteja livre (ou abandonado). Devolve a linha inteira: é dela que
 * o agendamento é remontado, e reler depois abriria de novo a janela que o
 * cadeado fecha.
 */
export async function reivindicarEvento(
  admin: SupabaseClient,
  args: { id: string; accountId: string; agoraMs?: number },
): Promise<Reivindicacao> {
  const agoraMs = args.agoraMs ?? Date.now();
  const { data, error } = await admin
    .from("cb_calendly_eventos")
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

/**
 * Solta o cadeado sem mexer no resultado. Só para o caminho de EXCEÇÃO em
 * que nada foi decidido — o caminho normal libera junto com o resultado,
 * em `gravarResultado`.
 */
export async function liberarClaim(admin: SupabaseClient, id: string): Promise<void> {
  const { error } = await admin.from("cb_calendly_eventos").update({ processando_desde: null }).eq("id", id);
  if (error) console.error("[calendly] não foi possível soltar o cadeado do evento:", error.message);
}
