import { describe, expect, it } from "vitest";

import { digitosDoTelefone, formatarTelefone, pareceTelefone } from "./telefone";

describe("digitosDoTelefone", () => {
  it("o lembrete por SMS vem com DDI e entra como veio", () => {
    expect(digitosDoTelefone("+55 96 99112-6767")).toBe("5596991126767");
    expect(digitosDoTelefone("+1 404-555-1234")).toBe("14045551234");
  });

  it("o que o brasileiro digita sem DDI ganha o 55", () => {
    expect(digitosDoTelefone("(96) 99112-6767")).toBe("5596991126767");
    expect(digitosDoTelefone("96 9112-6767")).toBe("559691126767");
    expect(digitosDoTelefone("83988745316")).toBe("5583988745316");
  });

  it("já com 55 e sem `+` não dobra o DDI", () => {
    expect(digitosDoTelefone("5596991126767")).toBe("5596991126767");
    expect(digitosDoTelefone("55 96 99112-6767")).toBe("5596991126767");
  });

  it("prefixo internacional 00 é DDI escrito de outro jeito", () => {
    expect(digitosDoTelefone("0055 96 99112 6767")).toBe("5596991126767");
  });

  it("curto ou longo demais não é telefone", () => {
    expect(digitosDoTelefone("1234567")).toBeNull();
    expect(digitosDoTelefone("1234567890123456")).toBeNull();
    expect(digitosDoTelefone("")).toBeNull();
    expect(digitosDoTelefone(null)).toBeNull();
  });
});

describe("pareceTelefone", () => {
  it("aceita as formas usuais", () => {
    expect(pareceTelefone("(96) 99112-6767")).toBe(true);
    expect(pareceTelefone("+55 96 99112-6767")).toBe(true);
    expect(pareceTelefone("96991126767")).toBe(true);
  });

  it("recusa texto com letras ou poucos dígitos", () => {
    expect(pareceTelefone("Rua 12, nº 340")).toBe(false);
    expect(pareceTelefone("R$ 15.000")).toBe(false);
    expect(pareceTelefone("12345")).toBe(false);
    expect(pareceTelefone("")).toBe(false);
  });
});

describe("formatarTelefone", () => {
  it("brasileiro com 9 dígitos", () => {
    expect(formatarTelefone("5596991126767")).toBe("(96) 99112-6767");
  });

  it("brasileiro com 8 dígitos (fixo)", () => {
    expect(formatarTelefone("558332221111")).toBe("(83) 3222-1111");
  });

  it("estrangeiro sai com `+`", () => {
    expect(formatarTelefone("14045551234")).toBe("+14045551234");
  });

  it("vazio fica vazio", () => {
    expect(formatarTelefone(null)).toBe("");
  });
});
