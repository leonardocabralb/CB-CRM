import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { novoPedidoDeSalto, seletorDoAlvo } from "./salto-no-fio";

describe("novoPedidoDeSalto", () => {
  it("o primeiro pedido nasce em n=1, carimbado com a conversa", () => {
    expect(
      novoPedidoDeSalto(null, "conv-1", { tipo: "mensagem", id: "m1" }),
    ).toEqual({ tipo: "mensagem", id: "m1", conversationId: "conv-1", n: 1 });
  });

  it("⚠️ o MESMO alvo pedido de novo ganha outro n — senão o segundo clique não rola", () => {
    const primeiro = novoPedidoDeSalto(null, "c", { tipo: "nota", id: "n1" });
    const segundo = novoPedidoDeSalto(primeiro, "c", { tipo: "nota", id: "n1" });
    expect(segundo.n).toBe(2);
    expect(segundo).not.toBe(primeiro);
  });
});

describe("seletorDoAlvo", () => {
  it("mensagem e nota usam âncoras diferentes", () => {
    expect(seletorDoAlvo({ tipo: "mensagem", id: "abc" })).toBe(
      '[data-message-id="abc"]',
    );
    expect(seletorDoAlvo({ tipo: "nota", id: "abc" })).toBe(
      '[data-nota-id="abc"]',
    );
  });

  it("⚠️ os dois atributos existem no fio de verdade (pino contra renomear só um lado)", () => {
    const fio = readFileSync(
      join(__dirname, "../../components/inbox/message-thread.tsx"),
      "utf8",
    );
    expect(fio).toContain("data-message-id={");
    expect(fio).toContain("data-nota-id={");
  });
});
