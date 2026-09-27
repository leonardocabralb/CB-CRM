/**
 * Cliente da API do ZapSign (`https://api.zapsign.com.br/api/v1/`) — só o
 * que a integração usa: listar os modelos (e com isso provar o token), o
 * plano, RELER um documento, e criar/apagar o webhook.
 *
 * - Token no cabeçalho `Authorization: Bearer`, nunca na URL.
 * - Erro vira CÓDIGO (`token_invalido`, `sem_plano`, …) para a tela traduzir;
 *   a mensagem do ZapSign fica no `Error.message` para o log, depois de passar
 *   por `semSegredo()` — o token da API e a credencial do webhook (que vai no
 *   CORPO da criação) não podem aparecer em log.
 * - Só fala com `https://api.zapsign.com.br`. O `next` da paginação dos
 *   modelos NÃO é seguido (a doc o devolve em `http://`): a página seguinte é
 *   montada aqui, pelo número. Redirecionamento não é seguido (`manual`): o
 *   cabeçalho com o token não sai para outro host.
 * - O SANDBOX é outra conta, com outro token e outra URL
 *   (`sandbox.api.zapsign.com.br`) — não é suportado nesta entrega. Sem
 *   sandbox neste banco: o `.env.local` aponta para a produção.
 */

export const ORIGEM_ZAPSIGN = "https://api.zapsign.com.br";
const BASE = `${ORIGEM_ZAPSIGN}/api/v1`;
const TIMEOUT_MS = 15_000;

/** O ZapSign pagina os modelos de 20 em 20. Teto: 200 modelos na tela. */
export const MAX_PAGINAS_DE_MODELOS = 10;

export type CodigoDoErroZapSign = "token_invalido" | "sem_plano" | "nao_encontrado" | "limite" | "rede" | "zapsign_error";

export class ZapSignError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroZapSign,
    mensagem: string,
    /** O status HTTP (nulo = nem houve resposta: rede, tempo esgotado). */
    public readonly status: number | null = null,
  ) {
    super(mensagem);
    this.name = "ZapSignError";
  }
}

/**
 * Puro: o status HTTP do ZapSign → o nosso código. 402 é "sem plano de API":
 * a API de produção exige plano (os webhooks, não), e sem ela o CRM não
 * consegue reler o documento assinado.
 */
export function codigoDoErro(status: number): CodigoDoErroZapSign {
  if (status === 401 || status === 403) return "token_invalido";
  if (status === 402) return "sem_plano";
  if (status === 404) return "nao_encontrado";
  if (status === 429) return "limite";
  return "zapsign_error";
}

export const MARCA_DE_SEGREDO = "«segredo»";

/** Tira do texto cada segredo (token da API, credencial do webhook) antes de ele virar log. */
export function semSegredo(texto: string, ...segredos: (string | null | undefined)[]): string {
  let saida = texto;
  for (const s of segredos) {
    if (s && s.length >= 8) saida = saida.replaceAll(s, MARCA_DE_SEGREDO);
  }
  return saida;
}

export interface ModeloDoZapSign {
  token: string;
  nome: string;
  ativo: boolean;
  /** `docx`, `pdf`… como o ZapSign manda; nulo = ausente. */
  tipo: string | null;
  criadoEm: string | null;
}

export interface PaginaDeModelos {
  modelos: ModeloDoZapSign[];
  /** Há página seguinte (`next` preenchido). */
  temMais: boolean;
  /** `count` da resposta; nulo quando não veio. */
  total: number | null;
}

export interface PlanoDoZapSign {
  nome: string | null;
  /** `paid`, `pending_payment`, `unpaid`, `canceled`… */
  status: string | null;
}

export interface ClienteZapSign {
  /** `GET /templates/?page=N` — uma página (20). */
  modelos(pagina: number): Promise<PaginaDeModelos>;
  /** `GET /info-plan`. 404 ("plano não encontrado") = `null`. */
  plano(): Promise<PlanoDoZapSign | null>;
  /** `GET /docs/{token}/` — o corpo CRU; quem lê é `lerDocumento`. */
  documento(docToken: string): Promise<unknown>;
  /** `POST /user/company/webhook/` → o id do webhook. */
  criarWebhook(args: { url: string; tipo: string; cabecalho: { nome: string; valor: string } }): Promise<{ id: string }>;
  /** `DELETE /user/company/webhook/delete/` com `{ id }`. */
  apagarWebhook(id: string): Promise<void>;
}

type Fetch = typeof fetch;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Um modelo da lista; sem `token` fica de fora. */
export function lerModelo(l: unknown): ModeloDoZapSign | null {
  if (!ehObjeto(l) || typeof l.token !== "string" || l.token.trim() === "") return null;
  return {
    token: l.token,
    nome: typeof l.name === "string" && l.name.trim() !== "" ? l.name : l.token,
    ativo: l.active !== false,
    tipo: textoOuNulo(l.template_type),
    criadoEm: textoOuNulo(l.created_at),
  };
}

/** A mensagem de erro do corpo, na forma que vier (`detail`, `message`, `error` ou texto cru). */
function mensagemDoCorpo(texto: string): string {
  try {
    const j: unknown = JSON.parse(texto);
    if (ehObjeto(j)) {
      for (const k of ["detail", "message", "error"]) {
        if (typeof j[k] === "string") return j[k] as string;
      }
    }
  } catch {
    /* não é JSON: vai o texto */
  }
  return texto.slice(0, 300);
}

/**
 * @param segredosExtras o que mais não pode sair em log além do token — a
 *   credencial do webhook, que vai no CORPO da criação e o ZapSign pode ecoar.
 */
export function criarClienteZapSign(token: string, fetchFn: Fetch = fetch, segredosExtras: string[] = []): ClienteZapSign {
  const limpar = (texto: string) => semSegredo(texto, token, ...segredosExtras);

  async function pedir(metodo: "GET" | "POST" | "DELETE", caminho: string, corpo?: unknown): Promise<unknown> {
    let resposta: Response;
    try {
      resposta = await fetchFn(`${BASE}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new ZapSignError("rede", limpar(`${metodo} ${caminho.split("?")[0]} → ${e instanceof Error ? e.message : String(e)}`));
    }
    const texto = await resposta.text().catch(() => "");
    if (!resposta.ok) {
      // ⚠️ A mensagem começa pelo PEDIDO, SEM a query (a lição do Asaas: sem
      // ela o log não diz qual chamada falhou).
      throw new ZapSignError(
        codigoDoErro(resposta.status),
        limpar(`${metodo} ${caminho.split("?")[0]} → ${resposta.status}: ${mensagemDoCorpo(texto) || `HTTP ${resposta.status}`}`),
        resposta.status,
      );
    }
    if (!texto) return null;
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      // 2xx com texto cru ("Webhook deletado com sucesso"): não há o que ler.
      return null;
    }
  }

  return {
    async modelos(pagina) {
      const n = Number.isInteger(pagina) && pagina >= 1 ? pagina : 1;
      const corpo = await pedir("GET", `/templates/?page=${n}`);
      if (!ehObjeto(corpo) || !Array.isArray(corpo.results)) {
        throw new ZapSignError("zapsign_error", "GET /templates/ → resposta sem `results`");
      }
      return {
        modelos: corpo.results.map(lerModelo).filter((m): m is ModeloDoZapSign => m !== null),
        temMais: typeof corpo.next === "string" && corpo.next !== "",
        total: typeof corpo.count === "number" ? corpo.count : null,
      };
    },

    async plano() {
      try {
        const corpo = await pedir("GET", "/info-plan");
        if (!ehObjeto(corpo)) return { nome: null, status: null };
        return { nome: textoOuNulo(corpo.name), status: textoOuNulo(corpo.status) };
      } catch (e) {
        if (e instanceof ZapSignError && e.codigo === "nao_encontrado") return null;
        throw e;
      }
    },

    async documento(docToken) {
      return pedir("GET", `/docs/${encodeURIComponent(docToken)}/`);
    },

    async criarWebhook(args) {
      const corpo = await pedir("POST", "/user/company/webhook/", {
        url: args.url,
        type: args.tipo,
        headers: [{ name: args.cabecalho.nome, value: args.cabecalho.valor }],
      });
      const id = ehObjeto(corpo) ? corpo.id : null;
      if ((typeof id !== "string" || id === "") && typeof id !== "number") {
        throw new ZapSignError("zapsign_error", "POST /user/company/webhook/ → resposta sem `id`");
      }
      return { id: String(id) };
    },

    async apagarWebhook(id) {
      await pedir("DELETE", "/user/company/webhook/delete/", { id });
    },
  };
}
