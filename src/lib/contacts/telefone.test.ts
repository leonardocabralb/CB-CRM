import { describe, expect, it } from "vitest";

import {
  digitosDoTelefone,
  formatarTelefone,
  pareceTelefone,
  variantesDoNonoDigito,
} from "./telefone";

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

  it("CRÍTICO: número de fora escrito só em dígitos NÃO ganha o 55 (o 9 na 3ª posição é o que separa)", () => {
    // "14045551234" tem 11 dígitos como um celular brasileiro; com o 55 ele
    // iria para outro destinatário, com os dados do agendamento junto.
    expect(digitosDoTelefone("14045551234")).toBe("14045551234");
    expect(digitosDoTelefone("1 404 555 1234")).toBe("14045551234");
    // celular brasileiro: DDD + 9 + 8 dígitos
    expect(digitosDoTelefone("83988745316")).toBe("5583988745316");
    expect(digitosDoTelefone("11 91234-5678")).toBe("5511912345678");
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

describe("variantesDoNonoDigito", () => {
  it("celular gravado COM o 9 ganha a irmã sem ele — a original primeiro", () => {
    expect(variantesDoNonoDigito("5583988745316")).toEqual([
      "5583988745316",
      "558388745316",
    ]);
  });

  it("celular gravado SEM o 9 ganha a irmã com ele", () => {
    expect(variantesDoNonoDigito("558388745316")).toEqual([
      "558388745316",
      "5583988745316",
    ]);
  });

  it("⚠️ fixo não ganha 9: o nono dígito é só de celular (6, 7, 8 ou 9)", () => {
    expect(variantesDoNonoDigito("558333334444")).toEqual(["558333334444"]);
    // 13 dígitos com 9 na 5ª posição mas 3 na 6ª: não é celular com 9 na frente.
    expect(variantesDoNonoDigito("5583933334444")).toEqual(["5583933334444"]);
  });

  it("sem DDI 55, ou de outro país, volta sozinho", () => {
    expect(variantesDoNonoDigito("83988745316")).toEqual(["83988745316"]);
    expect(variantesDoNonoDigito("14045551234")).toEqual(["14045551234"]);
    expect(variantesDoNonoDigito("")).toEqual([""]);
  });
});
