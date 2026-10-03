import { lerLinha, type LinhaDeTrajetoria } from "./trajetoria";

/**
 * O único I/O do módulo: a RPC `cb_funil_trajetorias_por_chave` (migration
 * 1078), paginada por CHAVE e pedida em quatro faixas de `deal_id` em paralelo.
 *
 * ⚠️⚠️ Por que não o OFFSET de antes (`cb_funil_trajetorias`, 975, com
 * `order` + `range` + `count`): a função não é embutida pelo planejador, então
 * CADA página recalculava o funil inteiro para devolver mil linhas — medido na
 * produção em 03/10/2026, ~550 ms por página e a Saúde do Trabalhista em
 * ~2,35 s (quatro páginas em fila). Por chave, o recorte entra antes do cálculo
 * caro e cada página só calcula as suas linhas.
 *
 * As invariantes do laço:
 * - **A faixa é `(apos, ate]` de `deal_id`**, e a página seguinte começa no
 *   último `deal_id` recebido. Faixas DISJUNTAS podem ir juntas: ao contrário
 *   do OFFSET pedido em paralelo (ver `src/lib/supabase/paginar.ts`), a chave
 *   não anda quando o banco muda, e nenhuma linha que já existia some.
 * - **`restantes` fecha o laço** (quantos a faixa ainda tinha a partir desta
 *   página, contado no banco antes do `LIMIT`). Página mais curta que
 *   `restantes` continua pela chave — vale também para o teto de linhas do
 *   PostgREST, que corta SEM AVISAR: com chave, cortar não pula linha.
 * - **`null` é "não confie"**: erro, linha com forma inesperada, `restantes`
 *   ilegível ou teto de páginas. Quem chama esconde a vista em vez de mostrar
 *   um número errado. Nunca lista parcial.
 */

export const PAGINA = 1000;
/** Por faixa: 4 × 25 × 1000 = 100 mil negócios. Acima disso, `null`. */
const MAX_PAGINAS_POR_FAIXA = 25;

/**
 * As quatro faixas de `deal_id` (`(apos, ate]`, nulo = sem limite daquele
 * lado). O id é UUID aleatório: o primeiro dígito divide o funil em quatro
 * partes do mesmo tamanho. O Postgres compara `uuid` byte a byte — a mesma
 * ordem do texto em hexadecimal minúsculo.
 */
export const FAIXAS: readonly { apos: string | null; ate: string | null }[] = [
  { apos: null, ate: "3fffffff-ffff-ffff-ffff-ffffffffffff" },
  { apos: "3fffffff-ffff-ffff-ffff-ffffffffffff", ate: "7fffffff-ffff-ffff-ffff-ffffffffffff" },
  { apos: "7fffffff-ffff-ffff-ffff-ffffffffffff", ate: "bfffffff-ffff-ffff-ffff-ffffffffffff" },
  { apos: "bfffffff-ffff-ffff-ffff-ffffffffffff", ate: null },
];

export interface RespostaDaRpc {
  data: unknown[] | null;
  error: { message: string } | null;
}

/** O pedaço do cliente Supabase que este laço usa — estrutural, para o teste. */
export interface ClienteDaRpc {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): {
    order(coluna: string, opts: { ascending: boolean }): PromiseLike<RespostaDaRpc>;
  };
}

export interface ParametrosDeCarga {
  pipelineId: string;
  desde: Date | null;
  ate: Date | null;
}

/** `restantes` da primeira linha da página: inteiro positivo, ou `null`. */
function lerRestantes(cru: unknown): number | null {
  if (typeof cru !== "object" || cru === null) return null;
  const valor = (cru as { restantes?: unknown }).restantes;
  return typeof valor === "number" && Number.isInteger(valor) && valor > 0 ? valor : null;
}

async function carregarFaixa(
  db: ClienteDaRpc,
  args: Record<string, unknown>,
  faixa: { apos: string | null; ate: string | null },
): Promise<LinhaDeTrajetoria[] | null> {
  const acumulado: LinhaDeTrajetoria[] = [];
  let apos = faixa.apos;
  for (let pagina = 0; pagina < MAX_PAGINAS_POR_FAIXA; pagina++) {
    const { data, error } = await db
      .rpc("cb_funil_trajetorias_por_chave", {
        ...args,
        p_chave_apos: apos,
        p_chave_ate: faixa.ate,
        p_limite: PAGINA,
      })
      .order("deal_id", { ascending: true });
    if (error || !data) return null;
    // Vazia: a faixa não tinha ninguém, ou o que restava foi apagado entre
    // uma página e outra — nos dois casos, o que veio é a faixa inteira.
    if (data.length === 0) return acumulado;

    for (const cru of data) {
      const linha = lerLinha(cru);
      if (!linha) {
        console.warn("[funil] linha da RPC com forma inesperada; carga descartada");
        return null;
      }
      acumulado.push(linha);
    }
    const restantes = lerRestantes(data[0]);
    if (restantes === null) {
      console.warn("[funil] página da RPC sem `restantes`; carga descartada");
      return null;
    }
    if (data.length >= restantes) return acumulado;
    apos = acumulado[acumulado.length - 1].deal_id;
  }
  // Não coube no teto: admitir é melhor que recortar errado.
  return null;
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
  const faixas = await Promise.all(FAIXAS.map((faixa) => carregarFaixa(db, args, faixa)));
  if (faixas.some((linhas) => linhas === null)) return null;
  // As faixas vêm em ordem e cada uma ordenada: o todo sai por `deal_id`.
  return faixas.flatMap((linhas) => linhas ?? []);
}
