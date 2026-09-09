import { describe, expect, it } from "vitest";

import { formatarDuracao, tempoMmSs, textoDaTranscricao } from "./texto";

describe("textoDaTranscricao", () => {
  it("junta frases seguidas do mesmo orador num parágrafo", () => {
    expect(
      textoDaTranscricao([
        { orador: "Leonardo", texto: "Bom dia.", inicioSeg: 0, fimSeg: 1 },
        { orador: "Leonardo", texto: "Tudo bem?", inicioSeg: 1, fimSeg: 2 },
        { orador: "Marcelo", texto: "Tudo.", inicioSeg: 2, fimSeg: 3 },
        { orador: "Leonardo", texto: "Vamos lá.", inicioSeg: 3, fimSeg: 4 },
      ]),
    ).toBe("Leonardo: Bom dia. Tudo bem?\n\nMarcelo: Tudo.\n\nLeonardo: Vamos lá.");
  });

  it("orador vazio não ganha dois-pontos", () => {
    expect(textoDaTranscricao([{ orador: "", texto: "Olá.", inicioSeg: 0, fimSeg: 1 }])).toBe("Olá.");
    expect(textoDaTranscricao([])).toBe("");
  });
});

describe("tempoMmSs", () => {
  it.each([
    [0, "0:00"],
    [65.9, "1:05"],
    [3723, "1:02:03"],
    [-4, "0:00"],
  ])("%s → %s", (seg, esperado) => {
    expect(tempoMmSs(seg)).toBe(esperado);
  });
});

describe("formatarDuracao", () => {
  it.each([
    [null, "—"],
    [20, "< 1min"],
    [2700, "45min"],
    [3600, "1h"],
    [4320, "1h 12min"],
  ])("%s → %s", (seg, esperado) => {
    expect(formatarDuracao(seg)).toBe(esperado);
  });
});
