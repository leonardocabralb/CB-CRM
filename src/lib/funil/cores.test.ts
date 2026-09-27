import { describe, expect, it } from "vitest";

import { COR_DO_DEGRAU, corDaTransicao, gradeDoFunil, TINTA_DO_DEGRAU } from "./cores";
import { classificarEtapas, DEGRAUS } from "./degraus";
import { transicoesDoHistorico } from "./saude";

// ⚠️ O Tailwind só gera classe que está ESCRITA no fonte: estes testes cobram
// a forma literal (uma cor montada não existiria no CSS e o elemento sairia
// sem cor, sem erro nenhum) e que as linhas da Saúde não repitam cor.
describe("cores do funil", () => {
  it("todo degrau tem tinta e cor de linha, nas três classes literais", () => {
    for (const d of DEGRAUS) {
      expect(TINTA_DO_DEGRAU[d]).toMatch(/^border-[a-z]+-500\/40 bg-[a-z]+-500\/10$/);
      const cor = COR_DO_DEGRAU[d];
      const matiz = /^stroke-([a-z]+)-500$/.exec(cor.traco)?.[1];
      expect(matiz, d).toBeTruthy();
      expect(cor.ponto).toBe(`fill-${matiz}-500`);
      expect(cor.bloco).toBe(`bg-${matiz}-500`);
      expect(TINTA_DO_DEGRAU[d]).toContain(`border-${matiz}-500/40`);
    }
  });

  it("degraus diferentes, cores diferentes", () => {
    const matizes = DEGRAUS.map((d) => COR_DO_DEGRAU[d].traco);
    expect(new Set(matizes).size).toBe(DEGRAUS.length);
  });

  it("com os seis degraus mapeados, nenhuma linha da Saúde repete cor — a de contrato → pasta não é a da global", () => {
    const completo = classificarEtapas(DEGRAUS.map((d, i) => ({ id: d, name: d, position: i, degrau: d })));
    const linhas = transicoesDoHistorico(completo);
    expect(linhas.map((l) => `${l.de}→${l.para}${l.global ? " (global)" : ""}`)).toEqual([
      "lead→mql",
      "mql→reuniao",
      "reuniao→proposta",
      "proposta→contrato",
      "contrato→pasta",
      "lead→contrato (global)",
    ]);
    const cores = linhas.map((l) => corDaTransicao(l).traco);
    expect(new Set(cores).size).toBe(cores.length);
  });

  it("sem a pasta, as cores de sempre: cada linha a do degrau de partida, a global a do contrato", () => {
    expect(corDaTransicao({ de: "lead", para: "mql", global: false })).toBe(COR_DO_DEGRAU.lead);
    expect(corDaTransicao({ de: "proposta", para: "contrato", global: false })).toBe(COR_DO_DEGRAU.proposta);
    expect(corDaTransicao({ de: "lead", para: "contrato", global: true })).toBe(COR_DO_DEGRAU.contrato);
  });
});

describe("gradeDoFunil — uma forma literal por quantidade de cartões", () => {
  it("n cartões = n colunas de cartão e n − 1 de seta", () => {
    for (let n = 1; n <= DEGRAUS.length; n++) {
      const grade = gradeDoFunil(n);
      expect(grade.startsWith("lg:grid-cols-[")).toBe(true);
      expect(grade.match(/minmax\(0,1fr\)/g)).toHaveLength(n);
      expect(grade.match(/_auto_/g) ?? []).toHaveLength(n - 1);
    }
  });

  it("fora da faixa, grampeia (nunca devolve classe vazia)", () => {
    expect(gradeDoFunil(0)).toBe(gradeDoFunil(1));
    expect(gradeDoFunil(9)).toBe(gradeDoFunil(6));
  });
});
