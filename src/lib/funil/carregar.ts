import { lerLinha, type LinhaDeTrajetoria } from "./trajetoria";

/**
 * O único I/O do módulo: o laço PAGINADO sobre a RPC `cb_funil_trajetorias`
 * (migration 975).
 *
 * ⚠️ O PostgREST corta em ~1000 linhas SEM AVISAR. É o mesmo laço da lista
 * de conversas (`conversation-list.tsx`, `buscarDeals`), com as três
 * invariantes dele: `order` OBRIGATÓRIO (range sem order é LIMIT/OFFSET
 * sobre ordem indefinida — linha que muda de página some ou duplica),
 * `count: 'exact'` fecha o laço, e `null` é o contrato para "não confie":
 * quem chama esconde a vista em vez de mostrar um número errado.
 */

export const PAGINA = 1000;
const MAX_PAGINAS = 25;

export interface RespostaDaRpc {
  data: unknown[] | null;
  error: { message: string } | null;
  count: number | null;
}

/** O pedaço do cliente Supabase que este laço usa — estrutural, para o teste. */
export interface ClienteDaRpc {
  rpc(
    fn: string,
    args: Record<string, unknown>,
    opts: { count: "exact" },
  ): {
    order(
      coluna: string,
      opts: { ascending: boolean },
    ): { range(de: number, ate: number): PromiseLike<RespostaDaRpc> };
  };
}

export interface ParametrosDeCarga {
  pipelineId: string;
  desde: Date | null;
  ate: Date | null;
}

export async function carregarTrajetorias(
  db: ClienteDaRpc,
  parametros: ParametrosDeCarga,
): Promise<LinhaDeTrajetoria[] | null> {
  const args = {
    p_pipeline_id: parametros.pipelineId,
    p_desde: parametros.desde ? parametros.desde.toISOString() : null,
    p_ate: parametros.ate ? parametros.ate.toISOString() : null,
  };
  const acumulado: LinhaDeTrajetoria[] = [];
  let total: number | null = null;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * PAGINA;
    const { data, error, count } = await db
      .rpc("cb_funil_trajetorias", args, { count: "exact" })
      .order("deal_id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error || !data) return null;

    for (const cru of data) {
      const linha = lerLinha(cru);
      if (!linha) {
        console.warn("[funil] linha da RPC com forma inesperada; carga descartada");
        return null;
      }
      acumulado.push(linha);
    }

    total = count ?? total;
    if (total == null) {
      return data.length < PAGINA ? acumulado : null;
    }
    if (acumulado.length >= total || data.length < PAGINA) {
      return acumulado.length < total ? null : acumulado;
    }
  }
  // 25k+ negócios num funil: admitir que não coube é melhor que recortar errado.
  return null;
}
