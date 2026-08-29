import { describe, expect, it } from "vitest";

import { statusAoEntrarNaEtapa, statusPorResultado } from "./resultado";

/**
 * ⚠️ Paridade com o gatilho `cb_deals_aplica_resultado` (950), MEDIDO em
 * produção em 2026-08-29 num DO-block revertido:
 *   entrou em etapa 'ganho'  → status 'won'
 *   saiu para etapa neutra   → status FICOU 'won' (não reabre)
 *   reabrir explícito        → 'open' (o gatilho não interfere)
 * Se este teste quebrar, ou o espelho divergiu do gatilho, ou alguém mudou o
 * gatilho sem mudar aqui — os dois são o mesmo bug: a tela mostrando um selo
 * e o banco gravando outro.
 */
describe("statusPorResultado — espelho do gatilho da 950", () => {
  it("ganho → won, perdido → lost", () => {
    expect(statusPorResultado("ganho")).toBe("won");
    expect(statusPorResultado("perdido")).toBe("lost");
  });

  it("etapa neutra → null (MANTÉM o status; sair de marcada não reabre)", () => {
    expect(statusPorResultado(null)).toBeNull();
    expect(statusPorResultado(undefined)).toBeNull();
    expect(statusPorResultado("")).toBeNull();
  });

  it("valor desconhecido não vira status (o CHECK do banco impede, mas o espelho não pode inventar)", () => {
    expect(statusPorResultado("qualquer")).toBeNull();
  });
});

describe("statusAoEntrarNaEtapa", () => {
  const stages = [
    { id: "a", resultado: "ganho" },
    { id: "b", resultado: null },
    { id: "c", resultado: "perdido" },
  ];

  it("resolve pela etapa de destino", () => {
    expect(statusAoEntrarNaEtapa(stages, "a")).toBe("won");
    expect(statusAoEntrarNaEtapa(stages, "b")).toBeNull();
    expect(statusAoEntrarNaEtapa(stages, "c")).toBe("lost");
  });

  it("etapa não carregada → null (nunca chutar selo sem dado)", () => {
    expect(statusAoEntrarNaEtapa(stages, "inexistente")).toBeNull();
  });
});
