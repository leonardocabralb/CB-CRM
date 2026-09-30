/**
 * Puro: o gatilho "Situação mudou no Atlas" (1073, Fase 4 de
 * docs/PLANO-integracao-atlas.md) — o que casa, qual card, as variáveis e o
 * resultado gravado na fila. O I/O (enfileirar e disparar) mora em
 * `mudancas.ts`; aqui não entra nada de servidor (o construtor e o catálogo
 * de variáveis importam este arquivo).
 */

import { formatarParaMensagem, FUSO_DO_ESCRITORIO } from "@/lib/contacts/campo-data";
import type { AtlasSituacaoTriggerConfig, DealStatus, SituacaoDoAtlas } from "@/types";

import { appUrlSegura, situacaoComparavel } from "./leitura";

export { GATILHO_DO_ATLAS } from "@/lib/automations/so-pelo-disparador";

/** As situações que o gatilho oferece (contrato §8). `em_negociacao` vale `ativo` e não é oferecida. */
export const SITUACOES_DO_GATILHO = ["ativo", "importado", "finalizado", "rescindido", "inativo", "suspenso"] as const satisfies readonly SituacaoDoAtlas[];

/** O construtor semeia estas (o que se vê é o que se salva). */
export const SITUACOES_PADRAO_DO_GATILHO: SituacaoDoAtlas[] = ["rescindido", "finalizado"];

/** Espelho do CHECK `cb_atlas_mudancas_estado_ck` (pino `atlas-1073.test.ts`). */
export const ESTADOS_DA_MUDANCA = ["pendente", "processando", "feito"] as const;

/**
 * Os estados de quem AINDA está na fila (sem resultado): todos menos
 * `feito`. O cartão os traduz pela chave montada
 * `Settings.integracoes.atlas.mudanca.estado.<e>` (teste em `gatilho.test.ts`).
 */
export const ESTADOS_NA_FILA: readonly string[] = ESTADOS_DA_MUDANCA.filter((e) => e !== "feito");

/**
 * Espelho do CHECK `cb_atlas_mudancas_resultado_ck` (pino `atlas-1073.test.ts`).
 * Sem `antiga` nem "suspeita de ficha velha": o operador recusou essas travas
 * (30/09/2026) — a única trava é o card fora do funil (`sem_card`).
 */
export const RESULTADOS_DA_MUDANCA = ["disparado", "em_espera", "falhou", "sem_automacao", "sem_card", "card_ambiguo", "superada"] as const;

export type ResultadoDaMudanca = (typeof RESULTADOS_DA_MUDANCA)[number];

/** As `{{vars.*}}` que a mudança entrega (sem dado pessoal: só situação, data e link). */
export const VARIAVEIS_DA_MUDANCA = ["atlas_situacao", "atlas_situacao_anterior", "atlas_situacao_em", "atlas_link"] as const;

/** Id de funil (`pipelines.id`, uuid). */
const ID_DE_FUNIL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehIdDeFunil(v: unknown): v is string {
  return typeof v === "string" && ID_DE_FUNIL.test(v.trim());
}

/**
 * A config gravada, lida com desconfiança (JSONB): só textos não vazios.
 * ⚠️ Funil só com id válido: um texto qualquer ia para o `.in("pipeline_id")`
 * da busca dos cards, que é UMA consulta para todas as automações que casam —
 * o Postgres recusaria o uuid e derrubaria também as automações certas
 * (achado do Codex no #362; a ativação também recusa, em `validate.ts`).
 */
export function lerConfigDoGatilho(cfg: unknown): { situacoes: string[]; pipelineIds: string[] } {
  const c = (cfg ?? {}) as Partial<Record<keyof AtlasSituacaoTriggerConfig, unknown>>;
  const textos = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
  return { situacoes: textos(c.situacoes).map((s) => s.toLowerCase()), pipelineIds: textos(c.pipeline_ids).filter(ehIdDeFunil) };
}

/** A automação escuta esta situação NOVA? (`em_negociacao` casa com `ativo`) */
export function casaSituacao(cfg: unknown, nova: string): boolean {
  const alvo = situacaoComparavel(nova);
  return alvo !== "" && lerConfigDoGatilho(cfg).situacoes.includes(alvo);
}

export interface CardDoContato {
  id: string;
  pipeline_id: string;
  status: DealStatus | null;
}

export type EscolhaDoCard = { tipo: "um"; card: CardDoContato } | { tipo: "nenhum" } | { tipo: "varios"; quantos: number };

/**
 * O card do evento para UMA automação: o único card do contato (em qualquer
 * status — o do Jurídico pode estar ganho, e a RPC move ganho quando o status
 * esperado é `won`) num dos funis dela. Nenhum = o ex-cliente cujo card está
 * noutro funil: NUNCA é arrastado (`sem_card`). Mais de um = `card_ambiguo`.
 */
export function cardDoEvento(cards: readonly CardDoContato[], pipelineIds: readonly string[]): EscolhaDoCard {
  const dosFunis = cards.filter((c) => pipelineIds.includes(c.pipeline_id));
  if (dosFunis.length === 0) return { tipo: "nenhum" };
  if (dosFunis.length > 1) return { tipo: "varios", quantos: dosFunis.length };
  return { tipo: "um", card: dosFunis[0] };
}

/** As `{{vars.atlas_*}}` da mudança. A data vai no formato de mensagem, no fuso do escritório. */
export function variaveisDaMudanca(
  m: { anterior: string; nova: string; desde: string | null; appUrl: string | null; atlasClientId: string },
  fuso: string = FUSO_DO_ESCRITORIO,
): Record<(typeof VARIAVEIS_DA_MUDANCA)[number], string> {
  return {
    atlas_situacao: situacaoComparavel(m.nova),
    atlas_situacao_anterior: situacaoComparavel(m.anterior),
    atlas_situacao_em: formatarParaMensagem(m.desde, fuso),
    atlas_link: appUrlSegura(m.appUrl, m.atlasClientId) ?? "",
  };
}

/** O que aconteceu com UMA automação que casou a situação. */
export type SaidaDaAutomacao =
  | { nome: string; tipo: "sem_card" }
  | { nome: string; tipo: "card_ambiguo"; quantos: number }
  | { nome: string; tipo: "disparo"; executadas: number; foraDoEscopo: number; comFalha: number; emEspera: number; erro?: string };

export type DesfechoDaMudanca = { resultado: ResultadoDaMudanca; detalhe: string } | { resultado: null; detalhe: string };

function linha(s: SaidaDaAutomacao): string {
  switch (s.tipo) {
    case "sem_card":
      return `${s.nome}: o cliente não tem card nos funis desta automação — nada foi movido`;
    case "card_ambiguo":
      return `${s.nome}: o cliente tem ${s.quantos} cards nos funis desta automação — nada foi movido`;
    case "disparo":
      if (s.erro && s.executadas === 0) return `${s.nome}: o disparo não aconteceu (${s.erro})`;
      if (s.erro) return `${s.nome}: o disparo não terminou (${s.erro})`;
      if (s.executadas === 0) return `${s.nome}: fora do escopo (conexão) para este cliente`;
      if (s.comFalha > 0) return `${s.nome}: terminou com erro — veja o histórico da automação`;
      if (s.emEspera > 0) return `${s.nome}: parou num "Aguardar"; o resto sai pelo agendador`;
      return `${s.nome}: executada`;
  }
}

/**
 * O resultado gravado na fila, pelo que o motor DISSE que fez em cada
 * automação. `resultado: null` = NADA rodou e todo disparo foi recusado antes
 * da primeira automação (erro de banco na conferência): repetir é seguro, e
 * quem chama devolve a mudança a `pendente` (com teto de tentativas). Se
 * alguma automação rodou, nunca volta (CLAUDE.md 8e: envio que pode ter
 * saído não se repete). Prioridade: falhou → em espera → disparado; sem
 * nenhuma execução, o card (ambíguo, sem card) ou "sem automação".
 */
export function resultadoDaMudanca(saidas: readonly SaidaDaAutomacao[]): DesfechoDaMudanca {
  const detalhe = saidas.map(linha).join("\n");
  if (saidas.length === 0) return { resultado: "sem_automacao", detalhe: "nenhuma automação ativa escuta esta situação" };
  const disparos = saidas.filter((s): s is Extract<SaidaDaAutomacao, { tipo: "disparo" }> => s.tipo === "disparo");
  const executadas = disparos.reduce((n, s) => n + s.executadas, 0);
  if (executadas === 0) {
    // Nada rodou em automação nenhuma: repetir é seguro (o sem card dá sem card de novo).
    if (disparos.some((s) => s.erro)) return { resultado: null, detalhe };
    if (saidas.some((s) => s.tipo === "card_ambiguo")) return { resultado: "card_ambiguo", detalhe };
    if (saidas.some((s) => s.tipo === "sem_card")) return { resultado: "sem_card", detalhe };
    return { resultado: "sem_automacao", detalhe };
  }
  if (disparos.some((s) => s.comFalha > 0 || !!s.erro)) return { resultado: "falhou", detalhe };
  if (disparos.some((s) => s.emEspera > 0)) return { resultado: "em_espera", detalhe };
  return { resultado: "disparado", detalhe };
}
