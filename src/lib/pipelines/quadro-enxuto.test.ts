import { describe, expect, it } from "vitest";

import {
  CARDS_POR_COLUNA,
  DEAL_SELECT_ENXUTO,
  IDS_POR_PEDIDO,
  emFatias,
  idsDesenhados,
  limiteDaColuna,
  moverNoQuadro,
  semConteudo,
  type NegocioEnxuto,
} from "./quadro-enxuto";

/**
 * O quadro do funil em duas camadas: a lista ENXUTA de todos os cards decide
 * coluna, contador e soma; o conteúdo COMPLETO só vem dos desenhados.
 *
 * O que estes casos protegem é a COERÊNCIA entre as duas: o que o quadro
 * desenha tem de ser exatamente o que se pede ao banco. Divergindo, um card
 * desenhado fica "carregando" para sempre, ou se baixa card que ninguém vê.
 */

const negocio = (id: string, etapa: string, extra: Partial<NegocioEnxuto> = {}): NegocioEnxuto => ({
  id,
  stage_id: etapa,
  title: `card ${id}`,
  value: 0,
  status: "open",
  created_at: "2026-09-21T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z",
  ...extra,
});

const coluna = (etapa: string, n: number) =>
  Array.from({ length: n }, (_, i) => negocio(`${etapa}${i}`, etapa));

describe("a lista enxuta", () => {
  it("traz só o que o quadro, o contador, a soma e os indicadores leem", () => {
    const colunas = DEAL_SELECT_ENXUTO.split(",").map((c) => c.trim());
    expect(colunas).toEqual([
      "id",
      "stage_id",
      "title",
      "value",
      "status",
      "created_at",
      "updated_at",
    ]);
    // Nenhum embed: é a camada leve, de TODOS os cards.
    expect(DEAL_SELECT_ENXUTO).not.toMatch(/[(:]/);
  });
});

describe("idsDesenhados", () => {
  it("desenha até o teto de cada coluna, na ordem das etapas e da lista", () => {
    const negocios = [...coluna("a", 150), ...coluna("b", 3)];
    const ids = idsDesenhados(negocios, ["b", "a"], {}, null);
    expect(ids).toHaveLength(3 + CARDS_POR_COLUNA);
    expect(ids.slice(0, 3)).toEqual(["b0", "b1", "b2"]);
    expect(ids[3]).toBe("a0");
    expect(ids.at(-1)).toBe(`a${CARDS_POR_COLUNA - 1}`);
  });

  it("respeita o teto que o operador revelou naquela coluna", () => {
    const ids = idsDesenhados(coluna("a", 350), ["a"], { a: 300 }, null);
    expect(ids).toHaveLength(300);
    expect(ids.at(-1)).toBe("a299");
  });

  it("inclui o card recém-solto que cairia fora do teto — a mesma regra do render", () => {
    const ids = idsDesenhados(coluna("a", 300), ["a"], {}, "a250");
    expect(ids[0]).toBe("a250");
    expect(ids).toHaveLength(CARDS_POR_COLUNA + 1);
  });

  it("não desenha card de etapa que não está no quadro", () => {
    const negocios = [negocio("x", "etapa-apagada"), negocio("y", "a")];
    expect(idsDesenhados(negocios, ["a"], {}, null)).toEqual(["y"]);
  });
});

describe("semConteudo", () => {
  it("devolve os desenhados que ainda não têm conteúdo, na ordem", () => {
    const detalhes = new Map([["a1", {}]]);
    expect(semConteudo(["a0", "a1", "a2"], detalhes)).toEqual(["a0", "a2"]);
  });
});

describe("limiteDaColuna", () => {
  it("cai no teto inicial quando a coluna nunca foi expandida", () => {
    expect(limiteDaColuna({}, "a")).toBe(CARDS_POR_COLUNA);
    expect(limiteDaColuna({ a: 200 }, "a")).toBe(200);
  });
});

describe("emFatias", () => {
  it("corta em fatias do tamanho pedido, sem perder nem repetir", () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    const fatias = emFatias(ids, IDS_POR_PEDIDO);
    expect(fatias.map((f) => f.length)).toEqual([100, 100, 50]);
    expect(fatias.flat()).toEqual(ids);
    expect(emFatias([], IDS_POR_PEDIDO)).toEqual([]);
  });
});

describe("moverNoQuadro", () => {
  it("muda a coluna nas DUAS camadas, com o carimbo da etapa de resultado", () => {
    const negocios = [negocio("d1", "a"), negocio("d2", "a")];
    const detalhes = new Map([
      ["d1", { id: "d1", stage_id: "a", status: "open" as const, title: "cheio" }],
    ]);
    const depois = moverNoQuadro(negocios, detalhes, "d1", "b", "won");

    expect(depois.negocios.find((n) => n.id === "d1")).toMatchObject({ stage_id: "b", status: "won" });
    expect(depois.detalhes.get("d1")).toMatchObject({ stage_id: "b", status: "won", title: "cheio" });
    // O vizinho e as camadas originais ficam intocados (estado imutável).
    expect(depois.negocios.find((n) => n.id === "d2")).toBe(negocios[1]);
    expect(negocios[0].stage_id).toBe("a");
    expect(detalhes.get("d1")?.stage_id).toBe("a");
  });

  it("sem carimbo, o status fica como estava", () => {
    const depois = moverNoQuadro([negocio("d1", "a", { status: "lost" })], new Map(), "d1", "b", null);
    expect(depois.negocios[0]).toMatchObject({ stage_id: "b", status: "lost" });
  });

  it("card sem conteúdo baixado muda só na lista enxuta", () => {
    const depois = moverNoQuadro([negocio("d1", "a")], new Map(), "d1", "b", null);
    expect(depois.negocios[0].stage_id).toBe("b");
    expect(depois.detalhes.size).toBe(0);
  });
});
