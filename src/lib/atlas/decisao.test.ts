import { describe, expect, it } from "vitest";

import { decidir, estaEncerrado } from "./decisao";

const c = (status: string | null, id = "c1") => ({ id, status, appUrl: null });

describe("decidir", () => {
  it("nada achado: criar", () => {
    expect(decidir([])).toEqual({ acao: "criar" });
  });

  it("um encerrado no Atlas (rescindido, finalizado, inativo, suspenso): REATIVAR o mesmo cadastro (D3)", () => {
    for (const s of ["rescindido", "finalizado", "inativo", "suspenso", "Rescindido"]) {
      expect(decidir([c(s)]).acao).toBe("reativar");
    }
  });

  it("um em curso (ativo, importado, situação que o Atlas criar depois): só vincular — o Atlas manda no contrato", () => {
    for (const s of ["ativo", "importado", "em_negociacao", null]) {
      expect(decidir([c(s)]).acao).toBe("vincular");
    }
  });

  it("mais de um, ou lista cortada pelo teto do Atlas: AMBÍGUO, nunca palpite", () => {
    expect(decidir([c("ativo", "a"), c("rescindido", "b")])).toEqual({ acao: "ambiguo", quantos: 2 });
    expect(decidir([c("ativo")], true)).toEqual({ acao: "ambiguo", quantos: 1 });
    expect(decidir([], true)).toEqual({ acao: "ambiguo", quantos: 0 });
  });

  it("estaEncerrado ignora espaço e caixa", () => {
    expect(estaEncerrado(" FINALIZADO ")).toBe(true);
    expect(estaEncerrado("ativo")).toBe(false);
    expect(estaEncerrado(null)).toBe(false);
  });
});
