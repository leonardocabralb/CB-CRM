import { describe, expect, it } from "vitest";

import type { SituacaoNoFunil } from "@/lib/pipelines/situacao-do-cliente";

import type { VinculoNaTela } from "./do-contato";
import { SITUACOES_NA_FAIXA } from "./leitura";
import { GRAVIDADE, juntarSituacoes, situacaoDoAtlasNaFaixa } from "./situacao-na-faixa";

// ============================================================
// A faixa junta o funil (1070) e o Atlas (Fase 2): cada fonte cala sozinha,
// cada linha diz de onde veio, e o Atlas "ativo" não apaga o funil.
// ============================================================

const RESCINDIDO_FUNIL: SituacaoNoFunil = { situacao: "rescindido", funil: "Bancário - Jurídico", etapa: "Cliente Rescindido" };
const FINALIZADO_FUNIL: SituacaoNoFunil = { situacao: "finalizado", funil: "Trabalhista - Jurídico", etapa: "Encerrado" };

const atlas = (parcial: Partial<VinculoNaTela> = {}): VinculoNaTela => ({
  atlasClientId: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
  appUrl: null,
  situacao: "rescindido",
  situacaoDesde: "2026-08-12T13:00:00.000Z",
  origem: "automatica",
  casouPor: "chat_link",
  excluidoEm: null,
  lidaEm: "2026-09-30T14:45:00.000Z",
  velha: false,
  ...parcial,
});

describe("juntarSituacoes", () => {
  it("as duas fontes nulas (não sei): null — a faixa cala", () => {
    expect(juntarSituacoes(null, null)).toBeNull();
  });

  it("cada fonte cala SOZINHA: funil falhou, o Atlas vale; Atlas sem vínculo, o funil vale", () => {
    expect(juntarSituacoes(null, atlas())).toEqual([
      { fonte: "atlas", situacao: "rescindido", desde: "2026-08-12T13:00:00.000Z", lidaEm: "2026-09-30T14:45:00.000Z", velha: false },
    ]);
    expect(juntarSituacoes([RESCINDIDO_FUNIL], null)).toEqual([{ fonte: "funil", ...RESCINDIDO_FUNIL }]);
  });

  it("⚠️ o Atlas ATIVO não apaga a linha do funil (decisão do operador)", () => {
    expect(juntarSituacoes([RESCINDIDO_FUNIL], atlas({ situacao: "ativo" }))).toEqual([{ fonte: "funil", ...RESCINDIDO_FUNIL }]);
    expect(juntarSituacoes([], atlas({ situacao: "em_negociacao" }))).toEqual([]);
    expect(juntarSituacoes([], atlas({ situacao: "importado" }))).toEqual([]);
  });

  it("vínculo na LIXEIRA do Atlas não acende a faixa", () => {
    expect(juntarSituacoes([], atlas({ excluidoEm: "2026-09-29T10:00:00.000Z" }))).toEqual([]);
  });

  it("situação sem diferença de maiúsculas; desconhecida não acende", () => {
    expect(juntarSituacoes(null, atlas({ situacao: "Suspenso" }))?.[0]).toMatchObject({ fonte: "atlas", situacao: "suspenso" });
    expect(juntarSituacoes(null, atlas({ situacao: "arquivado" }))).toEqual([]);
    expect(juntarSituacoes(null, atlas({ situacao: null }))).toEqual([]);
  });

  it("gravidade entre as fontes: rescindido, suspenso, inativo, finalizado; no empate, o Atlas antes", () => {
    expect(juntarSituacoes([FINALIZADO_FUNIL], atlas({ situacao: "inativo" }))?.map((s) => `${s.fonte}:${s.situacao}`)).toEqual([
      "atlas:inativo",
      "funil:finalizado",
    ]);
    expect(juntarSituacoes([FINALIZADO_FUNIL, RESCINDIDO_FUNIL], atlas({ situacao: "suspenso" }))?.map((s) => `${s.fonte}:${s.situacao}`)).toEqual([
      "funil:rescindido",
      "atlas:suspenso",
      "funil:finalizado",
    ]);
    expect(juntarSituacoes([RESCINDIDO_FUNIL], atlas())?.map((s) => s.fonte)).toEqual(["atlas", "funil"]);
  });

  it("a leitura velha e a data desconhecida viajam na linha do Atlas", () => {
    expect(juntarSituacoes(null, atlas({ situacaoDesde: null, velha: true }))?.[0]).toMatchObject({ desde: null, velha: true });
  });

  it("a ordem de gravidade cobre exatamente as situações que acendem a faixa", () => {
    expect([...GRAVIDADE].sort()).toEqual([...SITUACOES_NA_FAIXA].sort());
    for (const s of SITUACOES_NA_FAIXA) expect(situacaoDoAtlasNaFaixa(s)).toBe(s);
  });
});
