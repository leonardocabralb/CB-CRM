import { describe, expect, it } from "vitest";

import { BOM_UTF8, neutralizarFormula, nomeDeArquivoSeguro, paraCsv } from "./csv";

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

describe("fórmula não vira fórmula na planilha", () => {
  it("neutraliza o que o Excel avaliaria", () => {
    // O nome do contato vem do push name do WhatsApp; o campo, do n8n.
    expect(neutralizarFormula('=HYPERLINK("https://evil.test","Clique")')).toBe(
      '\'=HYPERLINK("https://evil.test","Clique")',
    );
    expect(neutralizarFormula("+1+1")).toBe("'+1+1"); // soma, não número
    expect(neutralizarFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizarFormula("\tcmd")).toBe("'\tcmd");
  });

  it("número negativo continua número — senão o Excel para de somar a coluna", () => {
    expect(neutralizarFormula("-1.234,56")).toBe("-1.234,56");
    expect(neutralizarFormula("-42")).toBe("-42");
  });

  it("texto comum passa intacto", () => {
    expect(neutralizarFormula("Maria de Souza")).toBe("Maria de Souza");
    expect(neutralizarFormula("")).toBe("");
  });

  it("paraCsv aplica a neutralização dentro das aspas", () => {
    const csv = paraCsv([["=1+1"]]);
    expect(csv).toContain('"\'=1+1"');
  });
});
