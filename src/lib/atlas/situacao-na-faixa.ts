/**
 * Puro: a faixa "Cliente rescindido / finalizado / suspenso / inativo" junta
 * DUAS fontes — a marca da etapa do funil (1070, `situacao-do-cliente.ts`) e
 * a situação lida no Atlas (Fase 2) —, e cada linha diz de onde veio.
 *
 * - ⚠️ **Cada fonte cala sozinha.** `null` numa fonte é "não sei" (carga,
 *   falha); a outra continua valendo. As duas nulas = `null` (a faixa cala).
 *   Nunca juntar as leituras no mesmo `Promise.all`: a falha de uma calaria
 *   a outra.
 * - A linha do Atlas só existe com vínculo, FORA da lixeira, e com a
 *   situação em `SITUACOES_NA_FAIXA` (decisão do operador, 30/09/2026:
 *   rescindido, finalizado, suspenso e inativo). `em_negociacao` vale
 *   `ativo` (não acende).
 * - ⚠️ **O Atlas "ativo" NÃO apaga a linha do funil** (decisão do operador):
 *   as duas fontes aparecem, e quem alinha o card é a Fase 4.
 * - A ordem é por GRAVIDADE (rescindido, suspenso, inativo, finalizado); no
 *   empate, o Atlas antes do funil, e os funis pelo nome. A primeira dá a
 *   cor e o título.
 * - O recorte pelo perfil vale só para as linhas do funil (feito no hook da
 *   1070, no render); a do Atlas aparece a todos que veem a conversa.
 */

import type { SituacaoNoFunil } from "@/lib/pipelines/situacao-do-cliente";

import type { VinculoNaTela } from "./do-contato";
import { SITUACOES_NA_FAIXA, situacaoComparavel } from "./leitura";

export type SituacaoDaFaixa = (typeof SITUACOES_NA_FAIXA)[number];

/** A ordem de gravidade — a primeira da lista dá a cor e o título da faixa. */
export const GRAVIDADE: readonly SituacaoDaFaixa[] = ["rescindido", "suspenso", "inativo", "finalizado"];

export type SituacaoNaFaixa =
  | ({ fonte: "funil" } & SituacaoNoFunil)
  | {
      fonte: "atlas";
      situacao: SituacaoDaFaixa;
      /** Quando mudou no Atlas; nula = a data é desconhecida (a linha sai sem ela). */
      desde: string | null;
      lidaEm: string | null;
      /** A leitura está velha: a faixa acrescenta "situação lida no Atlas em …". */
      velha: boolean;
    };

/** A situação do Atlas que acende a faixa, ou `null`. */
export function situacaoDoAtlasNaFaixa(situacao: string | null | undefined): SituacaoDaFaixa | null {
  const s = situacaoComparavel(situacao);
  return (SITUACOES_NA_FAIXA as readonly string[]).includes(s) ? (s as SituacaoDaFaixa) : null;
}

export function juntarSituacoes(funil: SituacaoNoFunil[] | null, atlas: VinculoNaTela | null): SituacaoNaFaixa[] | null {
  if (funil === null && atlas === null) return null;
  const linhas: SituacaoNaFaixa[] = (funil ?? []).map((s) => ({ fonte: "funil" as const, ...s }));
  const doAtlas = atlas && atlas.excluidoEm === null ? situacaoDoAtlasNaFaixa(atlas.situacao) : null;
  if (atlas && doAtlas) {
    linhas.push({ fonte: "atlas", situacao: doAtlas, desde: atlas.situacaoDesde, lidaEm: atlas.lidaEm, velha: atlas.velha });
  }
  return linhas.sort(
    (a, b) =>
      GRAVIDADE.indexOf(a.situacao) - GRAVIDADE.indexOf(b.situacao) ||
      (a.fonte === b.fonte ? 0 : a.fonte === "atlas" ? -1 : 1) ||
      (a.fonte === "funil" && b.fonte === "funil" ? a.funil.localeCompare(b.funil) : 0),
  );
}
