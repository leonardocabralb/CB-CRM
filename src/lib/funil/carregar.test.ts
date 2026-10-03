import { describe, expect, it, vi } from "vitest";

import { FAIXAS, PAGINA, carregarTrajetorias, type ClienteDaRpc } from "./carregar";

interface Chamada {
  fn: string;
  args: Record<string, unknown>;
  coluna: string;
  ascending: boolean;
}

/**
 * Um servidor falso com o contrato da 1078: a faixa `(p_chave_apos,
 * p_chave_ate]`, os `p_limite` primeiros por `deal_id` e `restantes` contado
 * antes do limite. `teto` imita o corte de linhas do PostgREST (abaixo do
 * `p_limite`, sem avisar). Os ids são texto hexadecimal minúsculo: a ordem de
 * texto é a do `uuid` no Postgres.
 */
function servidorFalso(
  linhas: Record<string, unknown>[],
  opcoes: { teto?: number; erroNaFaixa?: string | null; semRestantes?: boolean } = {},
): { db: ClienteDaRpc; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const ordenadas = [...linhas].sort((a, b) => String(a.deal_id).localeCompare(String(b.deal_id)));
  const db: ClienteDaRpc = {
    rpc(fn, args) {
      return {
        order(coluna, o) {
          chamadas.push({ fn, args, coluna, ascending: o.ascending });
          const apos = args.p_chave_apos as string | null;
          const ate = args.p_chave_ate as string | null;
          if (opcoes.erroNaFaixa !== undefined && ate === opcoes.erroNaFaixa) {
            return Promise.resolve({ data: null, error: { message: "boom" } });
          }
          const faixa = ordenadas.filter(
            (l) => (apos === null || String(l.deal_id) > apos) && (ate === null || String(l.deal_id) <= ate),
          );
          const limite = Math.min(args.p_limite as number, opcoes.teto ?? Infinity);
          const pagina = faixa
            .slice(0, limite)
            .map((l) => (opcoes.semRestantes ? l : { ...l, restantes: faixa.length }));
          return Promise.resolve({ data: pagina, error: null });
        },
      };
    },
  };
  return { db, chamadas };
}

/** `n` negócios espalhados pelas 16 primeiras letras do id (as 4 faixas). */
function negocios(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    deal_id: `${(i % 16).toString(16)}${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`,
    pipeline_id: "f",
    stage_id: "s",
    created_at: "2026-09-01T00:00:00+00:00",
    value: 0,
    trajeto: [],
  }));
}

const PEDIDO = { pipelineId: "f", desde: null, ate: null };

describe("carregarTrajetorias — por chave, em quatro faixas", () => {
  it("pede as quatro faixas com a chave, junta tudo e devolve por deal_id", async () => {
    const dados = negocios(4 * PAGINA + 37);
    const { db, chamadas } = servidorFalso(dados);
    const desde = new Date("2026-09-01T03:00:00.000Z");

    const resultado = await carregarTrajetorias(db, { pipelineId: "f", desde, ate: null });

    expect(resultado).toHaveLength(dados.length);
    const ids = resultado!.map((l) => l.deal_id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(dados.length);
    // Cada faixa tem ~1.009: duas páginas cada.
    expect(chamadas).toHaveLength(8);
    expect(chamadas[0]).toMatchObject({
      fn: "cb_funil_trajetorias_por_chave",
      args: {
        p_pipeline_id: "f",
        p_desde: "2026-09-01T03:00:00.000Z",
        p_ate: null,
        p_chave_apos: FAIXAS[0].apos,
        p_chave_ate: FAIXAS[0].ate,
        p_limite: PAGINA,
      },
      coluna: "deal_id",
      ascending: true,
    });
  });

  it("a página seguinte começa no último deal_id recebido da MESMA faixa", async () => {
    const { db, chamadas } = servidorFalso(negocios(4 * PAGINA + 37));
    await carregarTrajetorias(db, PEDIDO);
    const daPrimeira = chamadas.filter((c) => c.args.p_chave_ate === FAIXAS[0].ate);
    expect(daPrimeira).toHaveLength(2);
    expect(daPrimeira[0].args.p_chave_apos).toBeNull();
    expect(String(daPrimeira[1].args.p_chave_apos)).toMatch(/^[0-3]/);
  });

  it("⚠️ página cortada pelo teto do PostgREST continua pela chave — nenhuma linha some", async () => {
    const dados = negocios(900);
    const { db } = servidorFalso(dados, { teto: 40 });
    const resultado = await carregarTrajetorias(db, PEDIDO);
    expect(resultado).toHaveLength(900);
  });

  it("funil sem negócio é lista VAZIA, não 'não confie'", async () => {
    const { db, chamadas } = servidorFalso([]);
    expect(await carregarTrajetorias(db, PEDIDO)).toEqual([]);
    expect(chamadas).toHaveLength(4);
  });

  it("erro em UMA faixa derruba a carga inteira (null, nunca três quartos do funil)", async () => {
    const { db } = servidorFalso(negocios(100), { erroNaFaixa: FAIXAS[2].ate });
    expect(await carregarTrajetorias(db, PEDIDO)).toBeNull();
  });

  it("página sem `restantes` é 'não confie' (com aviso)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = servidorFalso(negocios(10), { semRestantes: true });
    expect(await carregarTrajetorias(db, PEDIDO)).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("linha com forma inesperada descarta a carga inteira (com aviso)", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db } = servidorFalso([...negocios(3), { deal_id: "0zz", restantes: 1 }]);
    expect(await carregarTrajetorias(db, PEDIDO)).toBeNull();
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("estourar o teto de páginas é 'não confie', nunca meia faixa", async () => {
    // Teto de 1 linha por página: a faixa de 30 negócios pediria 30 páginas.
    const tudoNaPrimeiraFaixa = Array.from({ length: 30 }, (_, i) => ({
      ...negocios(1)[0],
      deal_id: `0${String(i).padStart(7, "0")}-0000-4000-8000-000000000000`,
    }));
    const { db } = servidorFalso(tudoNaPrimeiraFaixa, { teto: 1 });
    expect(await carregarTrajetorias(db, PEDIDO)).toBeNull();
  });

  it("as faixas cobrem o espaço inteiro de ids, sem sobreposição", () => {
    expect(FAIXAS[0].apos).toBeNull();
    expect(FAIXAS.at(-1)?.ate).toBeNull();
    for (let i = 1; i < FAIXAS.length; i++) expect(FAIXAS[i].apos).toBe(FAIXAS[i - 1].ate);
  });
});
