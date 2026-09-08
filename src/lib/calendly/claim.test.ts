import { describe, expect, it } from "vitest";

import { corteDoClaim, motivoDaRecusa, RECOLHER_CLAIM_MS } from "./claim";

const AGORA = new Date("2026-09-08T12:00:00Z").getTime();
const haMinutos = (m: number) => new Date(AGORA - m * 60_000).toISOString();

describe("corteDoClaim", () => {
  it("é o instante a partir do qual um cadeado está abandonado", () => {
    expect(corteDoClaim(AGORA)).toBe(new Date(AGORA - RECOLHER_CLAIM_MS).toISOString());
  });

  it("dez minutos: folgado para um processamento real, curto para o operador", () => {
    expect(RECOLHER_CLAIM_MS).toBe(10 * 60 * 1000);
  });
});

describe("motivoDaRecusa", () => {
  it("linha que não existe", () => {
    expect(motivoDaRecusa(null, AGORA)).toBe("not_found");
  });

  it("resultado que já rodou", () => {
    for (const resultado of ["disparado", "em_espera", "falhou", "sem_telefone"]) {
      expect(motivoDaRecusa({ resultado, processando_desde: null }, AGORA)).toBe("ja_processado");
    }
  });

  it("⚠️ cadeado VIVO vence o resultado — os conselhos são diferentes", () => {
    // Uma linha `disparado` com cadeado fresco está sendo processada AGORA;
    // dizer "já processado" mandaria o operador desistir, quando o certo é
    // esperar. E uma reprocessável em curso não pode convidar a insistir.
    expect(motivoDaRecusa({ resultado: "disparado", processando_desde: haMinutos(1) }, AGORA)).toBe("ainda_processando");
    expect(motivoDaRecusa({ resultado: "sem_contato", processando_desde: haMinutos(1) }, AGORA)).toBe("ainda_processando");
  });

  it("cadeado ABANDONADO não conta: o motivo volta a ser o resultado", () => {
    expect(motivoDaRecusa({ resultado: "disparado", processando_desde: haMinutos(11) }, AGORA)).toBe("ja_processado");
  });

  it("reprocessável, sem cadeado, e o UPDATE não pegou = outro ganhou a corrida", () => {
    expect(motivoDaRecusa({ resultado: "sem_contato", processando_desde: null }, AGORA)).toBe("ainda_processando");
  });

  it("data ilegível não conta como cadeado vivo — travaria o botão para sempre", () => {
    expect(motivoDaRecusa({ resultado: "sem_contato", processando_desde: "não é data" }, AGORA)).toBe("ainda_processando");
    expect(motivoDaRecusa({ resultado: "disparado", processando_desde: "não é data" }, AGORA)).toBe("ja_processado");
  });
});
