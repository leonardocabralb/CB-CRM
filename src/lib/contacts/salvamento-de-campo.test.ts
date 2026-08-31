import { describe, expect, it } from "vitest";

import { TIPO_DATA } from "@/lib/contacts/campo-data";
import {
  gravaAoEscolher,
  gravaAoSair,
  valorMudou,
} from "./salvamento-de-campo";

describe("gravaAoSair", () => {
  it("texto, número e data confirmam ao SAIR do campo", () => {
    for (const tipo of ["text", "number", TIPO_DATA, "qualquer-coisa-nova"]) {
      expect(gravaAoSair(tipo), tipo).toBe(true);
      expect(gravaAoEscolher(tipo), tipo).toBe(false);
    }
  });

  it("CRÍTICO: `select` confirma na ESCOLHA — não há blur útil", () => {
    // O popover fecha no clique; esperar o blur deixaria a escolha sem gravar
    // até o operador ir mexer em outro lugar da tela.
    expect(gravaAoSair("select")).toBe(false);
    expect(gravaAoEscolher("select")).toBe(true);
  });

  it("tipo desconhecido cai no blur, que é o comportamento seguro", () => {
    // Um `field_type` novo (a coluna é texto livre) nunca deve gravar por
    // tecla — no pior caso ele exige um clique fora, que é recuperável.
    expect(gravaAoSair("")).toBe(true);
  });
});

describe("valorMudou", () => {
  it("igual é igual", () => {
    expect(valorMudou("300", "300")).toBe(false);
    expect(valorMudou("", "")).toBe(false);
  });

  it("CRÍTICO: só o espaço em volta NÃO conta como mudança", () => {
    // `salvarValoresDoContato` grava `v.trim()`: entrar e sair de um campo
    // que a automação preencheu com espaços gravaria uma versão "limpa" que
    // ninguém pediu, e a ficha registraria uma edição que não houve.
    expect(valorMudou(" 300 ", "300")).toBe(false);
    expect(valorMudou("300", "  300")).toBe(false);
    expect(valorMudou("  ", "")).toBe(false);
  });

  it("mudança de verdade conta", () => {
    expect(valorMudou("300", "400")).toBe(true);
    expect(valorMudou("", "novo")).toBe(true);
  });

  it("esvaziar conta — é o gesto de APAGAR o valor", () => {
    // `""` no upsert compartilhado vira DELETE da linha; se isto devolvesse
    // `false`, limpar um campo nunca gravaria e o valor velho voltaria no
    // próximo carregamento.
    expect(valorMudou("300", "")).toBe(true);
    expect(valorMudou("300", "   ")).toBe(true);
  });

  it("espaço no MEIO é mudança (não é aparado)", () => {
    expect(valorMudou("Rua A", "Rua  A")).toBe(true);
  });
});
