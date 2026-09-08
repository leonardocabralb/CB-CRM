import { describe, expect, it } from "vitest";

import { VISTA_PADRAO, vistaVigente, vistasPermitidas, VISTAS_DO_FUNIL } from "./vistas";

// ============================================================
// Decisão do operador (08/09/2026): Lista, Desempenho e Saúde são de
// administrador — mostram a conta INTEIRA (conversão, valor fechado, ticket
// médio, investimento em anúncios, CAC). O Kanban continua de todo mundo.
// ============================================================

const ADMIN = { relatorios: true, automacoes: true };
const ATENDENTE = { relatorios: false, automacoes: false };

describe("vistasPermitidas", () => {
  it("administrador vê as cinco", () => {
    expect(vistasPermitidas(ADMIN)).toEqual([...VISTAS_DO_FUNIL]);
  });

  it("CRÍTICO: atendente vê só o Kanban", () => {
    expect(vistasPermitidas(ATENDENTE)).toEqual(["leads"]);
  });

  it("os dois poderes são independentes", () => {
    expect(vistasPermitidas({ relatorios: true, automacoes: false })).toEqual([
      "leads",
      "lista",
      "desempenho",
      "saude",
    ]);
    expect(vistasPermitidas({ relatorios: false, automacoes: true })).toEqual(["leads", "automacoes"]);
  });

  it("a ordem é a da barra, não a do filtro", () => {
    expect(vistasPermitidas(ADMIN)[0]).toBe("leads");
    expect(vistasPermitidas(ADMIN).at(-1)).toBe("automacoes");
  });
});

describe("vistaVigente", () => {
  it("mantém a aba escolhida quando ela é permitida", () => {
    expect(vistaVigente("desempenho", ADMIN)).toBe("desempenho");
  });

  it("⚠️⚠️ aba proibida cai para o Kanban NO RENDER — a lente de simulação troca o papel com a tela montada", () => {
    // Sem isto, quem estava no Desempenho e passa a simular um atendente
    // continuaria vendo o Desempenho da conta inteira até algum efeito
    // rodar. É a armadilha do "efeito passivo" do CLAUDE.md.
    for (const proibida of ["lista", "desempenho", "saude", "automacoes"] as const) {
      expect(vistaVigente(proibida, ATENDENTE)).toBe(VISTA_PADRAO);
    }
  });

  it("o Kanban nunca é recusado", () => {
    expect(vistaVigente("leads", ATENDENTE)).toBe("leads");
  });
});
