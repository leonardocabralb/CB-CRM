import { describe, expect, it } from "vitest";

import { classificarEtapas } from "./degraus";
import { COORTE_PEQUENA, coortePequena, coortesMensais, escalaRelativa } from "./saude";
import { fatosDoNegocio, type LinhaDeTrajetoria } from "./trajetoria";

const FUNIL = "f";
// 3 de setembro de 2026, 18h local
const AGORA = new Date(2026, 8, 3, 18);

const CLASSIFICACAO = classificarEtapas([
  { id: "lead", name: "Lead", position: 0, degrau: "lead" },
  { id: "mql", name: "MQL", position: 1, degrau: "mql" },
  { id: "contrato", name: "Contrato", position: 2, degrau: "contrato" },
]);

function negocio(id: string, entradas: [string, Date][]): LinhaDeTrajetoria {
  const [primeiraEtapa, criadoEm] = entradas[0];
  return {
    deal_id: id,
    contact_id: null,
    conversation_id: null,
    conversa_do_contato: null,
    title: id,
    value: 0,
    status: "open",
    pipeline_id: FUNIL,
    stage_id: entradas[entradas.length - 1][0],
    channel_id: null,
    source: "channel",
    assigned_to: null,
    created_at: criadoEm.toISOString(),
    updated_at: null,
    contato_nome: null,
    contato_telefone: null,
    contato_email: null,
    contato_empresa: null,
    contato_avatar: null,
    campos: {},
    trajeto: entradas.map(([etapa, em], i) => ({
      etapa,
      funil: FUNIL,
      em: em.toISOString(),
      origem: "usuario",
      tipo: i === 0 ? "deal_created" : "stage_changed",
    })),
  };
}

const d = (mes0: number, dia: number, hora = 10) => new Date(2026, mes0, dia, hora);

const LINHAS: LinhaDeTrajetoria[] = [
  // julho: 1 lead, virou MQL — coorte PEQUENA
  negocio("jul-1", [["lead", d(6, 10)], ["mql", d(6, 12)]]),
  // agosto: 5 leads, 2 viraram MQL, 1 deles fechou
  negocio("ago-1", [["lead", d(7, 1)], ["mql", d(7, 2)], ["contrato", d(7, 20)]]),
  negocio("ago-2", [["lead", d(7, 3)], ["mql", d(7, 4)]]),
  negocio("ago-3", [["lead", d(7, 5)]]),
  negocio("ago-4", [["lead", d(7, 6)]]),
  negocio("ago-5", [["lead", d(7, 7)]]),
  // setembro: 2 leads parados
  negocio("set-1", [["lead", d(8, 1)]]),
  negocio("set-2", [["lead", d(8, 2)]]),
];
const FATOS = LINHAS.map((l) => fatosDoNegocio(l, FUNIL, CLASSIFICACAO));

describe("coortesMensais", () => {
  const meses = coortesMensais(FATOS, CLASSIFICACAO, 3, AGORA);

  it("uma coorte por mês, do mais antigo ao atual", () => {
    expect(meses.map((m) => m.chave)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(meses.map((m) => m.resumo.entradas)).toEqual([1, 5, 2]);
  });

  it("taxas por mês e a marca de coorte pequena", () => {
    const leadParaMql = meses.map((m) => m.resumo.transicoes[0].taxa);
    expect(leadParaMql).toEqual([1, 0.4, 0]);
    expect(meses.map((m) => m.pequena)).toEqual([true, false, true]);
    expect(meses[1].resumo.fechados).toBe(1);
  });

  it("em aberto = sem avanço + em andamento (a coorte ainda anda)", () => {
    expect(meses.map((m) => m.emAberto)).toEqual([1, 4, 2]);
  });

  it("mês sem coorte fica com zero, não some", () => {
    const seis = coortesMensais(FATOS, CLASSIFICACAO, 6, AGORA);
    expect(seis.map((m) => m.resumo.entradas)).toEqual([0, 0, 0, 1, 5, 2]);
    expect(seis[0].resumo.transicoes[0].taxa).toBeNull();
  });
});

describe("escalaRelativa (cor relativa à linha, D6)", () => {
  it("pior mês → 0, melhor → 1, o resto proporcional; nulo fica nulo", () => {
    const escala = escalaRelativa([0.2, null, 0.6, 0.4]);
    expect(escala(0.2)).toBe(0);
    expect(escala(0.6)).toBe(1);
    expect(escala(0.4)).toBeCloseTo(0.5);
    expect(escala(null)).toBeNull();
  });

  it("linha sem variação: tudo 0.5 (não há melhor nem pior)", () => {
    const escala = escalaRelativa([0.3, 0.3]);
    expect(escala(0.3)).toBe(0.5);
  });

  it("linha toda nula: nada a pintar", () => {
    expect(escalaRelativa([null, null])(null)).toBeNull();
  });

  it("coorte pequena é menor que o piso", () => {
    expect(coortePequena(COORTE_PEQUENA - 1)).toBe(true);
    expect(coortePequena(COORTE_PEQUENA)).toBe(false);
  });
});
