import { describe, expect, it } from "vitest";

import { BOM_UTF8, nomeDeArquivoSeguro, paraCsv } from "./csv";

describe("paraCsv", () => {
  it("BOM + `;` + aspas em todo campo + CRLF", () => {
    const csv = paraCsv([
      ["Nome", "Valor"],
      ['Ana "a" Silva', "1234,56"],
    ]);
    expect(csv.startsWith(BOM_UTF8)).toBe(true);
    expect(csv.slice(1)).toBe('"Nome";"Valor"\r\n"Ana ""a"" Silva";"1234,56"\r\n');
  });

  it("aceita outro separador", () => {
    expect(paraCsv([["a", "b"]], ",").slice(1)).toBe('"a","b"\r\n');
  });
});

describe("nomeDeArquivoSeguro", () => {
  it("tira acento, espaço e pontuação", () => {
    expect(nomeDeArquivoSeguro("Bancário - Comercial")).toBe("bancario-comercial");
    expect(nomeDeArquivoSeguro("  ***  ")).toBe("arquivo");
  });
});
