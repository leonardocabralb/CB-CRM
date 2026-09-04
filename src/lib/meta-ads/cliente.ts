/**
 * Cliente da Marketing API da Meta — SÓ leitura (`ads_read`): a conta de
 * anúncios, as campanhas e o gasto por dia e por campanha.
 *
 * - Token no header `Authorization: Bearer`, nunca em `?access_token=`
 *   (vazaria em log de proxy — a mesma regra da chave do Gemini).
 * - Erro da Meta vira CÓDIGO (`token_invalido`, `sem_permissao`, …) para a
 *   tela traduzir; a mensagem crua da Meta fica no `Error.message`, para o
 *   log do servidor, e não é devolvida ao navegador.
 * - Paginação por `paging.next`, com teto — a Meta devolve o cursor pronto.
 */

export const META_ADS_API_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${META_ADS_API_VERSION}`;
const TIMEOUT_MS = 20_000;
const MAX_PAGINAS = 20;

export type CodigoDoErroMeta =
  | "token_invalido"
  | "sem_permissao"
  | "conta_nao_encontrada"
  | "limite"
  | "rede"
  | "meta_error";

export class MetaAdsError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroMeta,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "MetaAdsError";
  }
}

interface ErroDaMeta {
  code?: number;
  error_subcode?: number;
  type?: string;
  message?: string;
}

/** Puro: o código de erro do Graph (`error.code`) → o nosso. */
export function codigoDoErro(status: number, erro: ErroDaMeta | null): CodigoDoErroMeta {
  const code = erro?.code ?? 0;
  if (code === 190 || erro?.type === "OAuthException" && status === 401) return "token_invalido";
  if (code === 10 || (code >= 200 && code <= 299) || code === 294) return "sem_permissao";
  if (code === 100 && /does not exist|unsupported get request|cannot be loaded/i.test(erro?.message ?? "")) {
    return "conta_nao_encontrada";
  }
  if (code === 803) return "conta_nao_encontrada";
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) return "limite";
  return "meta_error";
}

/** "act_123", "123", " act_123 " → "act_123"; qualquer outra coisa → null. */
export function normalizarAdAccountId(texto: string): string | null {
  const limpo = texto.trim();
  if (/^act_\d+$/.test(limpo)) return limpo;
  if (/^\d+$/.test(limpo)) return `act_${limpo}`;
  return null;
}

export interface ContaDeAnuncios {
  id: string;
  nome: string;
  moeda: string;
}

export interface CampanhaDaMeta {
  id: string;
  nome: string;
  status: string;
}

export interface GastoDiario {
  campaignId: string;
  /** AAAA-MM-DD, no fuso da conta de anúncios (como a Meta devolve). */
  dia: string;
  gasto: number;
}

export interface ClienteMeta {
  conta(adAccountId: string): Promise<ContaDeAnuncios>;
  campanhas(adAccountId: string): Promise<CampanhaDaMeta[]>;
  gastos(adAccountId: string, since: string, until: string): Promise<GastoDiario[]>;
}

type Fetch = typeof fetch;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function criarClienteMeta(token: string, fetchFn: Fetch = fetch): ClienteMeta {
  async function pedir(url: string): Promise<Record<string, unknown>> {
    let resposta: Response;
    try {
      resposta = await fetchFn(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new MetaAdsError("rede", e instanceof Error ? e.message : String(e));
    }
    const corpo: unknown = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const erro = ehObjeto(corpo) && ehObjeto(corpo.error) ? (corpo.error as ErroDaMeta) : null;
      throw new MetaAdsError(codigoDoErro(resposta.status, erro), erro?.message ?? `HTTP ${resposta.status}`);
    }
    if (!ehObjeto(corpo)) throw new MetaAdsError("meta_error", "resposta sem corpo JSON");
    return corpo;
  }

  /** Junta `data` de todas as páginas (`paging.next` vem pronto da Meta). */
  async function paginar(url: string): Promise<unknown[]> {
    const tudo: unknown[] = [];
    let proxima: string | null = url;
    for (let pagina = 0; proxima && pagina < MAX_PAGINAS; pagina++) {
      const corpo: Record<string, unknown> = await pedir(proxima);
      if (Array.isArray(corpo.data)) tudo.push(...corpo.data);
      const paging = ehObjeto(corpo.paging) ? corpo.paging : null;
      proxima = paging && typeof paging.next === "string" ? paging.next : null;
    }
    return tudo;
  }

  return {
    async conta(adAccountId) {
      const c = await pedir(`${BASE}/${adAccountId}?fields=name,currency,account_id`);
      return {
        id: adAccountId,
        nome: typeof c.name === "string" ? c.name : adAccountId,
        moeda: typeof c.currency === "string" ? c.currency : "BRL",
      };
    },

    async campanhas(adAccountId) {
      const linhas = await paginar(`${BASE}/${adAccountId}/campaigns?fields=id,name,status&limit=200`);
      const campanhas: CampanhaDaMeta[] = [];
      for (const l of linhas) {
        if (!ehObjeto(l) || typeof l.id !== "string") continue;
        campanhas.push({
          id: l.id,
          nome: typeof l.name === "string" ? l.name : l.id,
          status: typeof l.status === "string" ? l.status : "",
        });
      }
      return campanhas;
    },

    async gastos(adAccountId, since, until) {
      const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
      const linhas = await paginar(
        `${BASE}/${adAccountId}/insights?level=campaign&fields=campaign_id,spend&time_increment=1&time_range=${timeRange}&limit=500`,
      );
      const gastos: GastoDiario[] = [];
      for (const l of linhas) {
        if (!ehObjeto(l) || typeof l.campaign_id !== "string" || typeof l.date_start !== "string") continue;
        const gasto = Number(l.spend);
        if (!Number.isFinite(gasto)) continue;
        gastos.push({ campaignId: l.campaign_id, dia: l.date_start, gasto });
      }
      return gastos;
    },
  };
}
