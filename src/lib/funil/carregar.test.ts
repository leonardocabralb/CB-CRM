import { describe, expect, it, vi } from "vitest";

import { PAGINA, carregarTrajetorias, type ClienteDaRpc, type RespostaDaRpc } from "./carregar";

interface Chamada {
  fn: string;
  args: Record<string, unknown>;
  opts: { count: "exact" };
  coluna: string;
  ascending: boolean;
  de: number;
  ate: number;
}

function clienteFalso(
  paginas: unknown[][],
  count: number | null,
  error: RespostaDaRpc["error"] = null,
): { db: ClienteDaRpc; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const db: ClienteDaRpc = {
    rpc(fn, args, opts) {
      return {
        order(coluna, o) {
          return {
            range(de, ate) {
              chamadas.push({ fn, args, opts, coluna, ascending: o.ascending, de, ate });
              const data = error ? null : (paginas[Math.floor(de / PAGINA)] ?? []);
              return Promise.resolve({ data, error, count });
            },
          };
        },
      };
    },
  };
  return { db, chamadas };
}

const linha = (i: number) => ({
  deal_id: `d${String(i).padStart(5, "0")}`,
  pipeline_id: "f",
  stage_id: "s",
  created_at: "2026-09-01T00:00:00+00:00",
  value: 0,
  trajeto: [],
});
const linhas = (de: number, ate: number) => Array.from({ length: ate - de }, (_, i) => linha(de + i));

describe("carregarTrajetorias — o laço paginado", () => {
  it("pagina por deal_id com count exato e junta as páginas", async () => {
    const { db, chamadas } = clienteFalso([linhas(0, PAGINA), linhas(PAGINA, PAGINA + 5)], PAGINA + 5);
    const desde = new Date("2026-09-01T03:00:00.000Z");
    const resultado = await carregarTrajetorias(db, { pipelineId: "f", desde, ate: null });

    expect(resultado).toHaveLength(PAGINA + 5);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toMatchObject({
      fn: "cb_funil_trajetorias",
      args: { p_pipeline_id: "f", p_desde: "2026-09-01T03:00:00.000Z", p_ate: null },
      opts: { count: "exact" },
      coluna: "deal_id",
      ascending: true,
      de: 0,
      ate: PAGINA - 1,
    });
    expect(chamadas[1]).toMatchObject({ de: PAGINA, ate: 2 * PAGINA - 1 });
  });

  it("Total manda os dois limites nulos", async () => {
    const { db, chamadas } = clienteFalso([linhas(0, 3)], 3);
    await carregarTrajetorias(db, { pipelineId: "f", desde: null, ate: null });
    expect(chamadas[0].args).toEqual({ p_pipeline_id: "f", p_desde: null, p_ate: null });
  });

  it("⚠️ o count promete mais do que veio: devolve null, nunca uma lista parcial", async () => {
    const { db } = clienteFalso([linhas(0, PAGINA), linhas(PAGINA, PAGINA + 5)], 3000);
    expect(await carregarTrajetorias(db, { pipelineId: "f", desde: null, ate: null })).toBeNull();
  });

  it("sem count: página curta é o fim; página cheia sem count é 'não confie'", async () => {
    const curta = clienteFalso([linhas(0, 7)], null);
    expect(await carregarTrajetorias(curta.db, { pipelineId: "f", desde: null, ate: null })).toHaveLength(7);

    const cheia = clienteFalso([linhas(0, PAGINA)], null);
    expect(await carregarTrajetorias(cheia.db, { pipelineId: "f", desde: null, ate: null })).toBeNull();
  });

  it("erro do PostgREST vira null", async () => {
    const { db } = clienteFalso([], null, { message: "boom" });
    expect(await carregarTrajetorias(db, { pipelineId: "f", desde: null, ate: null })).toBeNull();
  });

  it("linha com forma inesperada descarta a carga inteira (com aviso)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = clienteFalso([[linha(0), { deal_id: 42 }]], 2);
    expect(await carregarTrajetorias(db, { pipelineId: "f", desde: null, ate: null })).toBeNull();
    expect(aviso).toHaveBeenCalledOnce();
    aviso.mockRestore();
  });
});
