import type { SupabaseClient } from "@supabase/supabase-js";

import { RESULTADOS_REPROCESSAVEIS } from "./log";

// ⚠️ GÊMEO de `src/lib/calendly/claim.ts` — mesma mecânica, outra tabela.
// Não foi fatorado num módulo só de propósito: o cadeado é curto, e um
// helper genérico teria de receber tabela, coluna e lista de resultados
// por parâmetro, trocando três linhas de duplicação por uma indireção que
// esconderia justamente as cercas que precisam ser lidas. Quem mudar a
// mecânica de um confere o outro.

/**
 * O CADEADO de um acionamento: quem está rodando esta linha agora.
 *
 * ⚠️⚠️ Processar um acionamento MANDA MENSAGEM e mexe no card. Conferir o
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
 * ⚠️⚠️ E toda escrita pós-claim leva CERCA DE POSSE: o UPDATE exige o
 * `processando_desde` do PRÓPRIO claim. Sem ela, um dono recolhido como
 * abandonado (abaixo) continuava com direito de escrita — terminava tarde,
 * sobrescrevia o resultado de quem assumiu, e ainda SOLTAVA o cadeado vivo
 * do outro, abrindo caminho para um terceiro entrar enquanto o segundo
 * ainda rodava (achado do Codex no PR #135; é a mesma cerca do worker do
 * Radar, `running_desde`).
 *
 * ⚠️ Toda saída do processamento tem de LIBERAR o cadeado. `gravarResultado`
 * faz isso ao carimbar o resultado; um caminho novo que esqueça deixa o
 * acionamento travado até o recolhimento.
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

/**
 * Teto de um processamento. Passado isto, quem está rodando DESISTE e grava
 * `falhou`.
 *
 * ⚠️ Ele existe para dar sentido ao recolhimento acima. Sem teto, "10 min
 * sem notícias" não prova que o dono morreu — em produção não há corte de
 * duração de rota (o `maxDuration` é decorativo; ver CLAUDE.md), então um
 * processamento pendurado numa chamada de rede podia seguir vivo enquanto
 * outro clique tomava o cadeado e disparava a MESMA automação em paralelo
 * (achado do Codex no PR #135). Com o teto, quem passa dele já desistiu e
 * já gravou `falhou` — que não é reprocessável.
 *
 * ⚠️ A margem para `RECOLHER_CLAIM_MS` é o que dá a garantia, e há teste
 * cobrando que ela exista. Encostar os dois valores devolve a janela.
 *
 * ⚠️ Desistir NÃO cancela o trabalho: uma promessa em JS não se aborta, e
 * o que estava em voo segue até terminar. O que impede o estrago é a CERCA
 * DE POSSE — as escritas do desistente não casam mais com o cadeado.
 */
export const TETO_DE_PROCESSAMENTO_MS = 4 * 60 * 1000;

/** Estourou o teto? Devolve o que a promessa deu, ou `null` no tempo esgotado. */
export async function comTetoDeProcessamento<T>(
  trabalho: Promise<T>,
  tetoMs: number = TETO_DE_PROCESSAMENTO_MS,
): Promise<{ pronto: true; valor: T } | { pronto: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const relogio = new Promise<{ pronto: false }>((resolve) => {
    timer = setTimeout(() => resolve({ pronto: false }), tetoMs);
  });
  try {
    const r = await Promise.race([trabalho.then((valor) => ({ pronto: true as const, valor })), relogio]);
    return r;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
 * o acionamento é remontado, e reler depois abriria de novo a janela que o
 * cadeado fecha.
 */
export async function reivindicarAcionamento(
  admin: SupabaseClient,
  args: { id: string; accountId: string; webhookId: string; agoraMs?: number },
): Promise<Reivindicacao> {
  const agoraMs = args.agoraMs ?? Date.now();
  const { data, error } = await admin
    .from("cb_webhook_eventos")
    .update({ processando_desde: new Date(agoraMs).toISOString() })
    .eq("id", args.id)
    .eq("account_id", args.accountId)
    // ⚠️ `webhook_id` também, e não só o `id`: a rota recebe o par
    // (webhook, evento) da URL, e sem esta cerca um admin montando a
    // chamada à mão processaria o evento do webhook B com o MAPEAMENTO e o
    // escopo de automação do webhook A — o telefone lido pelo nome de campo
    // errado, e as regras de A rodando sobre o payload de B. É o mesmo
    // argumento da FK composta da 982: "existe uma linha com esse id" não é
    // "é desta".
    .eq("webhook_id", args.webhookId)
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
export async function liberarClaim(admin: SupabaseClient, id: string, claimIso: string): Promise<void> {
  const { error } = await admin
    .from("cb_webhook_eventos")
    .update({ processando_desde: null })
    // ⚠️ Cerca de posse: soltar sem ela derrubaria o cadeado de quem
    // assumiu depois de este dono ser recolhido.
    .eq("processando_desde", claimIso)
    .eq("id", id);
  if (error) console.error("[calendly] não foi possível soltar o cadeado do evento:", error.message);
}
