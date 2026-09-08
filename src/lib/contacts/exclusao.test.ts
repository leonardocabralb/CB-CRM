import { describe, expect, it } from "vitest";

import { lerExclusao, podeLimparSelecao, selecaoRestante } from "./exclusao";

// ============================================================
// A armadilha: RLS que barra DELETE devolve 0 linhas com `error: null`.
// Depois da 981 (apagar contato é de admin), qualquer aba aberta antes do
// deploy cai nesse caso — e a tela dizia "excluído" sobre um contato
// intacto (Codex, PR #137).
//
// E zero linhas tem DOIS significados: policy recusou, ou a linha já não
// existia. O rowcount não separa os dois; `podeApagar` separa (Codex, #138).
// ============================================================

const ADMIN = { podeApagar: true };
const ATENDENTE = { podeApagar: false };

describe("lerExclusao", () => {
  it("tudo saiu", () => {
    expect(lerExclusao({ pedidos: 3, apagados: 3, houveErro: false, ...ADMIN })).toBe("apagado");
  });

  it("CRÍTICO: zero linhas SEM erro nunca é sucesso", () => {
    expect(lerExclusao({ pedidos: 1, apagados: 0, houveErro: false, ...ATENDENTE })).not.toBe("apagado");
    expect(lerExclusao({ pedidos: 12, apagados: 0, houveErro: false, ...ADMIN })).not.toBe("apagado");
  });

  it("CRÍTICO: quem NÃO pode apagar e não apagou nada foi recusado pela policy", () => {
    expect(lerExclusao({ pedidos: 1, apagados: 0, houveErro: false, ...ATENDENTE })).toBe("recusado");
  });

  it("⚠️ quem PODE apagar e não apagou nada perdeu a corrida — a linha já sumiu", () => {
    // Dizer "seu perfil não tem permissão" a um admin seria afirmar o que
    // não houve: outro cliente apagou o contato depois que a lista carregou.
    expect(lerExclusao({ pedidos: 1, apagados: 0, houveErro: false, ...ADMIN })).toBe("sumiu");
  });

  it("parte saiu = parcial, para os dois papéis", () => {
    expect(lerExclusao({ pedidos: 12, apagados: 5, houveErro: false, ...ADMIN })).toBe("parcial");
    expect(lerExclusao({ pedidos: 12, apagados: 5, houveErro: false, ...ATENDENTE })).toBe("parcial");
  });

  it("erro de consulta vence tudo — inclusive um rowcount zerado", () => {
    expect(lerExclusao({ pedidos: 3, apagados: 0, houveErro: true, ...ATENDENTE })).toBe("falhou");
  });
});

describe("podeLimparSelecao", () => {
  it("só limpa quando tudo saiu — senão esconde o que ficou", () => {
    expect(podeLimparSelecao("apagado")).toBe(true);
    for (const r of ["recusado", "sumiu", "parcial", "falhou"] as const) {
      expect(podeLimparSelecao(r)).toBe(false);
    }
  });
});

describe("selecaoRestante", () => {
  it("tira os que saíram e mantém o resto", () => {
    expect([...selecaoRestante(["a", "b", "c"], ["b"])]).toEqual(["a", "c"]);
  });

  it("recusa total não mexe na seleção", () => {
    expect([...selecaoRestante(["a", "b"], [])]).toEqual(["a", "b"]);
  });

  it("tudo apagado esvazia", () => {
    expect([...selecaoRestante(["a", "b"], ["a", "b"])]).toEqual([]);
  });
});
