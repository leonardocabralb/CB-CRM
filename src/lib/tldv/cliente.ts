/**
 * Cliente da API pública do tl;dv (`https://pasta.tldv.io`, versão
 * `v1alpha1`) — só o que a integração usa: listar reuniões, ler uma reunião,
 * a transcrição e as notas geradas pela IA deles.
 *
 * - A chave vai no cabeçalho `x-api-key` (é o que a doc pede), nunca na URL.
 * - Erro vira CÓDIGO (`chave_invalida`, `sem_permissao`, …) para a tela
 *   traduzir; a mensagem do tl;dv fica no `Error.message` para o log, depois
 *   de passar por `semSegredo()` — a mesma disciplina do Meta Ads e do
 *   Calendly, onde a mensagem do provedor ECOAVA o segredo.
 * - Só fala com `pasta.tldv.io`: `doTldv()` confere antes de cada pedido.
 *   Hoje nenhuma URL vem da resposta, mas a regra é a mesma dos irmãos —
 *   uma URL de outro host levaria a chave junto.
 * - ⚠️ "Ver a reunião no app não garante acesso pela API": a doc diz que a
 *   exportação depende do PLANO de quem ORGANIZOU a reunião (Pro/Business),
 *   e que reunião só compartilhada não sai pela API. Isso chega como 403 e
 *   vira `sem_permissao` — a tela explica.
 */

import { lerNotas, lerReuniao, lerTranscricao, type FraseDaTranscricao, type NotasDoTldv, type ReuniaoDoTldv } from "./leitura";

export const ORIGEM_TLDV = "https://pasta.tldv.io";
const BASE = `${ORIGEM_TLDV}/v1alpha1`;
const TIMEOUT_MS = 20_000;
/** Teto da API por página. */
export const POR_PAGINA_MAX = 100;

export type CodigoDoErroTldv = "chave_invalida" | "sem_permissao" | "nao_encontrado" | "limite" | "rede" | "tldv_error";

export class TldvError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroTldv,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "TldvError";
  }
}

/** A URL é do tl;dv? Todo pedido passa por aqui. */
export function doTldv(url: string): boolean {
  try {
    return new URL(url).origin === ORIGEM_TLDV;
  } catch {
    return false;
  }
}

/** Puro: o status HTTP do tl;dv → o nosso código. */
export function codigoDoErro(status: number): CodigoDoErroTldv {
  if (status === 401) return "chave_invalida";
  if (status === 403) return "sem_permissao";
  if (status === 404) return "nao_encontrado";
  if (status === 429) return "limite";
  return "tldv_error";
}

export const MARCA_DE_CHAVE = "«chave»";

/** Tira a chave de um texto antes de ele virar mensagem de erro (e log). */
export function semSegredo(texto: string, chave: string): string {
  return chave.length >= 8 ? texto.replaceAll(chave, MARCA_DE_CHAVE) : texto;
}

export interface FiltroDeReunioes {
  /** Reuniões a partir deste instante (`from`). */
  de?: Date;
  /** Até este instante (`to`). */
  ate?: Date;
  pagina?: number;
  porPagina?: number;
  /** Busca por nome (`query`). */
  busca?: string;
}

export interface PaginaDeReunioes {
  reunioes: ReuniaoDoTldv[];
  pagina: number;
  paginas: number;
  total: number;
}

export interface ClienteTldv {
  listarReunioes(filtro: FiltroDeReunioes): Promise<PaginaDeReunioes>;
  reuniao(id: string): Promise<ReuniaoDoTldv>;
  /**
   * As frases da transcrição, ou `null` quando ela AINDA não está pronta —
   * a doc diz que o endpoint "só devolve quando completa"; MEDIDO: ele
   * responde 204 sem corpo (a doc sugeria 404 — os dois são "ainda não"), e
   * uma lista vazia é tratada do mesmo jeito: não há o que gravar.
   */
  transcricao(id: string): Promise<FraseDaTranscricao[] | null>;
  /** As notas da IA do tl;dv, ou `null` quando não há (404) ou o plano não dá (403). */
  notas(id: string): Promise<NotasDoTldv | null>;
}

type Fetch = typeof fetch;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function criarClienteTldv(chave: string, fetchFn: Fetch = fetch): ClienteTldv {
  /** Um pedido. `aceitar404` devolve `null` em vez de lançar no 404. */
  async function pedir(url: string, aceitar: number[] = []): Promise<{ status: number; corpo: unknown }> {
    if (!doTldv(url)) throw new TldvError("tldv_error", "URL fora de pasta.tldv.io");
    let resposta: Response;
    try {
      resposta = await fetchFn(url, {
        headers: { "x-api-key": chave, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new TldvError("rede", semSegredo(e instanceof Error ? e.message : String(e), chave));
    }
    // ⚠️ MEDIDO em produção (09/09/2026): transcrição ainda não pronta volta
    // como 204 SEM CORPO — não o 404 que a doc sugere. Sem este ramo o corpo
    // vazio virava "resposta sem data[]" → `tldv_error`, e a reunião recém-
    // gravada ficava marcada como ERRO (e queimava as tentativas) por estar
    // apenas esperando o tl;dv terminar.
    if (resposta.status === 204) return { status: 204, corpo: null };
    const corpo: unknown = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      if (aceitar.includes(resposta.status)) return { status: resposta.status, corpo };
      const mensagem =
        ehObjeto(corpo) && typeof corpo.message === "string"
          ? corpo.message
          : ehObjeto(corpo) && typeof corpo.name === "string"
            ? corpo.name
            : `HTTP ${resposta.status}`;
      throw new TldvError(codigoDoErro(resposta.status), semSegredo(`${resposta.status}: ${mensagem}`, chave));
    }
    return { status: resposta.status, corpo };
  }

  return {
    async listarReunioes(filtro) {
      const u = new URL(`${BASE}/meetings`);
      if (filtro.de) u.searchParams.set("from", filtro.de.toISOString());
      if (filtro.ate) u.searchParams.set("to", filtro.ate.toISOString());
      if (filtro.busca) u.searchParams.set("query", filtro.busca);
      u.searchParams.set("page", String(Math.max(1, filtro.pagina ?? 1)));
      u.searchParams.set("limit", String(Math.min(POR_PAGINA_MAX, Math.max(1, filtro.porPagina ?? POR_PAGINA_MAX))));
      const { corpo } = await pedir(u.toString());
      if (!ehObjeto(corpo) || !Array.isArray(corpo.results)) {
        throw new TldvError("tldv_error", "resposta de /meetings sem `results`");
      }
      const reunioes: ReuniaoDoTldv[] = [];
      for (const r of corpo.results) {
        const lida = lerReuniao(r);
        if (lida) reunioes.push(lida);
      }
      return {
        reunioes,
        pagina: typeof corpo.page === "number" ? corpo.page : 1,
        paginas: typeof corpo.pages === "number" ? corpo.pages : 1,
        total: typeof corpo.total === "number" ? corpo.total : reunioes.length,
      };
    },

    async reuniao(id) {
      const { corpo } = await pedir(`${BASE}/meetings/${encodeURIComponent(id)}`);
      const lida = lerReuniao(corpo);
      if (!lida) throw new TldvError("tldv_error", "resposta de /meetings/{id} sem `id`/`name`/`happenedAt`");
      return lida;
    },

    async transcricao(id) {
      const { status, corpo } = await pedir(`${BASE}/meetings/${encodeURIComponent(id)}/transcript`, [404]);
      if (status === 204 || status === 404) return null;
      const frases = lerTranscricao(corpo);
      if (frases === null) throw new TldvError("tldv_error", "resposta de /transcript sem `data[]`");
      return frases.length > 0 ? frases : null;
    },

    async notas(id) {
      const { status, corpo } = await pedir(`${BASE}/meetings/${encodeURIComponent(id)}/notes`, [403, 404]);
      if (status === 204 || status === 403 || status === 404) return null;
      return lerNotas(corpo);
    },
  };
}
