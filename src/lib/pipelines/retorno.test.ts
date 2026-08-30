import { describe, expect, it } from "vitest";

import { desserializarRetorno } from "./retorno";

describe("desserializarRetorno — registro de sessionStorage é entrada não confiável", () => {
  it("nulo / vazio / JSON inválido → null, nunca exceção", () => {
    expect(desserializarRetorno(null)).toBeNull();
    expect(desserializarRetorno("")).toBeNull();
    expect(desserializarRetorno("{")).toBeNull();
    expect(desserializarRetorno("[1,2]")).toBeNull();
    expect(desserializarRetorno('"texto"')).toBeNull();
  });

  it("pipelineId ausente, vazio ou não-string → null (sem funil não há o que restaurar)", () => {
    expect(desserializarRetorno('{"scrollLeft":10}')).toBeNull();
    expect(desserializarRetorno('{"pipelineId":""}')).toBeNull();
    expect(desserializarRetorno('{"pipelineId":42}')).toBeNull();
  });

  it("rolagem inválida (string, NaN, negativa, ausente) vira 0 — restaura o funil e abre no topo", () => {
    expect(desserializarRetorno('{"pipelineId":"p1","scrollLeft":"x"}')).toEqual({
      pipelineId: "p1",
      scrollLeft: 0,
      scrollTop: 0,
    });
    expect(
      desserializarRetorno('{"pipelineId":"p1","scrollLeft":-5,"scrollTop":null}'),
    ).toEqual({ pipelineId: "p1", scrollLeft: 0, scrollTop: 0 });
  });

  it("ida-e-volta preserva", () => {
    const registro = { pipelineId: "p1", scrollLeft: 320, scrollTop: 1024 };
    expect(desserializarRetorno(JSON.stringify(registro))).toEqual(registro);
  });
});
