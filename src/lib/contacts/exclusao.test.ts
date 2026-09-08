import { describe, expect, it } from "vitest";

import { lerExclusao, podeLimparSelecao, selecaoRestante } from "./exclusao";

// ============================================================
// Três rodadas do Codex moram nestes testes:
//   #137 — 0 linhas com `error: null` não é sucesso;
//   #138 — 0 linhas tem dois significados (recusa × já sumiu);
//   #139 — o motivo é MEDIDO no banco, nunca inferido do papel em cache
//          (um admin rebaixado com a página aberta ainda "sabe" que pode).
// ============================================================

const base = { houveErro: false };

describe("lerExclusao", () => {
  it("tudo saiu", () => {
    expect(lerExclusao({ ...base, pedidos: 3, apagados: 3, aindaExistem: 0 })).toBe("apagado");
  });

  it("CRÍTICO: zero linhas SEM erro nunca é sucesso", () => {
    expect(lerExclusao({ ...base, pedidos: 1, apagados: 0, aindaExistem: 1 })).not.toBe("apagado");
    expect(lerExclusao({ ...base, pedidos: 1, apagados: 0, aindaExistem: 0 })).not.toBe("apagado");
  });

  it("CRÍTICO: o que não saiu e AINDA ESTÁ LÁ foi recusado pela policy", () => {
    expect(lerExclusao({ ...base, pedidos: 1, apagados: 0, aindaExistem: 1 })).toBe("recusado");
  });

  it("CRÍTICO: o que não saiu e não existe mais SUMIU — outro cliente apagou", () => {
    expect(lerExclusao({ ...base, pedidos: 1, apagados: 0, aindaExistem: 0 })).toBe("sumiu");
  });

  it("⚠️ o veredito não olha papel nenhum: os mesmos números dão a mesma resposta", () => {
    // Era aqui que a versão anterior errava — ela perguntava à tela se o
    // usuário podia apagar, e a tela pode estar com o papel velho em memória.
    const recusado = { ...base, pedidos: 2, apagados: 0, aindaExistem: 2 };
    expect(lerExclusao(recusado)).toBe("recusado");
    expect(lerExclusao({ ...recusado })).toBe("recusado");
  });

  it("parte saiu = parcial, existindo resto ou não", () => {
    expect(lerExclusao({ ...base, pedidos: 12, apagados: 5, aindaExistem: 7 })).toBe("parcial");
    expect(lerExclusao({ ...base, pedidos: 12, apagados: 5, aindaExistem: 0 })).toBe("parcial");
  });

  it("erro de consulta vence tudo", () => {
    expect(lerExclusao({ pedidos: 3, apagados: 0, aindaExistem: 3, houveErro: true })).toBe("falhou");
  });

  it("⚠️ conferência que não pôde ser feita é `falhou`, não um palpite", () => {
    expect(lerExclusao({ ...base, pedidos: 1, apagados: 0, aindaExistem: null })).toBe("falhou");
    // …mas se TUDO saiu, não há o que conferir.
    expect(lerExclusao({ ...base, pedidos: 2, apagados: 2, aindaExistem: null })).toBe("apagado");
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
  it("CRÍTICO: tira os que saíram E os que já não existiam — sobra o recusado", () => {
    // Sem tirar o ausente, ele ficava marcado numa linha que não aparece, e
    // toda nova tentativa repetia "sumiu".
    expect([...selecaoRestante(["a", "b", "c"], ["a", "b"])]).toEqual(["c"]);
  });

  it("recusa total não mexe na seleção", () => {
    expect([...selecaoRestante(["a", "b"], [])]).toEqual(["a", "b"]);
  });

  it("tudo resolvido esvazia", () => {
    expect([...selecaoRestante(["a", "b"], ["a", "b"])]).toEqual([]);
  });
});
