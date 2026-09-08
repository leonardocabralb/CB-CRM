import { describe, expect, it } from "vitest";

import { lerExclusao, podeLimparSelecao } from "./exclusao";

// ============================================================
// A armadilha: RLS que barra DELETE devolve 0 linhas com `error: null`.
// Depois da 981 (apagar contato é de admin), qualquer aba aberta antes do
// deploy cai nesse caso — e a tela dizia "excluído" sobre um contato
// intacto (achado do Codex no PR #137).
// ============================================================

describe("lerExclusao", () => {
  it("tudo saiu", () => {
    expect(lerExclusao({ pedidos: 3, apagados: 3, houveErro: false })).toBe("apagado");
  });

  it("CRÍTICO: zero linhas SEM erro é recusa, nunca sucesso", () => {
    expect(lerExclusao({ pedidos: 1, apagados: 0, houveErro: false })).toBe("recusado");
    expect(lerExclusao({ pedidos: 12, apagados: 0, houveErro: false })).toBe("recusado");
  });

  it("parte saiu = parcial, não sucesso", () => {
    expect(lerExclusao({ pedidos: 12, apagados: 5, houveErro: false })).toBe("parcial");
  });

  it("erro de consulta vence tudo — inclusive um rowcount zerado", () => {
    expect(lerExclusao({ pedidos: 3, apagados: 0, houveErro: true })).toBe("falhou");
  });
});

describe("podeLimparSelecao", () => {
  it("só limpa quando tudo saiu — senão esconde o que ficou", () => {
    expect(podeLimparSelecao("apagado")).toBe(true);
    for (const r of ["recusado", "parcial", "falhou"] as const) {
      expect(podeLimparSelecao(r)).toBe(false);
    }
  });
});
