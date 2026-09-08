/**
 * Cliente da API v2 do Calendly — só o que a integração usa: quem é o dono
 * do token, os tipos de evento (para o select do gatilho) e as assinaturas
 * de webhook (criar, listar, apagar).
 *
 * - Token no header `Authorization: Bearer`, nunca na URL.
 * - Erro vira CÓDIGO (`token_invalido`, `sem_permissao`, …) para a tela
 *   traduzir; a mensagem do Calendly fica no `Error.message` para o log,
 *   depois de passar por `semSegredo()` — a mesma disciplina do Meta Ads,
 *   onde a mensagem do provedor ECOAVA o token.
 * - Só fala com `https://api.calendly.com`: as URIs que o Calendly devolve
 *   (assinatura, evento) são reenviadas como caminho, e uma URI de outro
 *   host levaria o token junto. `doCalendly()` confere antes de cada pedido.
 */

export const ORIGEM_CALENDLY = "https://api.calendly.com";
const TIMEOUT_MS = 15_000;
const MAX_PAGINAS = 20;

export type CodigoDoErroCalendly =
  | "token_invalido"
  | "sem_permissao"
  | "nao_encontrado"
  | "limite"
  | "rede"
  | "calendly_error";

export class CalendlyError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroCalendly,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "CalendlyError";
  }
}

/** A URL é do Calendly? Toda URI reenviada passa por aqui. */
export function doCalendly(url: string): boolean {
  try {
    return new URL(url).origin === ORIGEM_CALENDLY;
  } catch {
    return false;
  }
}

/** Puro: o status HTTP do Calendly → o nosso código. */
export function codigoDoErro(status: number): CodigoDoErroCalendly {
  if (status === 401) return "token_invalido";
  if (status === 403) return "sem_permissao";
  if (status === 404) return "nao_encontrado";
  if (status === 429) return "limite";
  return "calendly_error";
}

export const MARCA_DE_TOKEN = "«token»";

/** Tira o token de um texto antes de ele virar mensagem de erro (e log). */
export function semSegredo(texto: string, token: string): string {
  return token.length >= 8 ? texto.replaceAll(token, MARCA_DE_TOKEN) : texto;
}

export interface UsuarioDoCalendly {
  uri: string;
  nome: string;
  email: string;
  organizationUri: string;
  schedulingUrl: string | null;
  timezone: string | null;
}

export interface TipoDeEvento {
  uri: string;
  nome: string;
  ativo: boolean;
  schedulingUrl: string | null;
  duracao: number | null;
}

export type EscopoDaAssinatura = "organization" | "user";

export interface AssinaturaDeWebhook {
  uri: string;
  callbackUrl: string;
  estado: "active" | "disabled";
  eventos: string[];
  escopo: EscopoDaAssinatura;
  retryStartedAt: string | null;
}

export interface ClienteCalendly {
  usuarioAtual(): Promise<UsuarioDoCalendly>;
  tiposDeEvento(filtro: { organization?: string; user?: string }): Promise<TipoDeEvento[]>;
  assinaturas(filtro: { organization: string; scope: EscopoDaAssinatura; user?: string }): Promise<AssinaturaDeWebhook[]>;
  /** Uma assinatura pelo URI (`GET /webhook_subscriptions/{uuid}`) — o estado ao vivo. */
  assinatura(uri: string): Promise<AssinaturaDeWebhook>;
  criarAssinatura(args: {
    url: string;
    events: string[];
    organization: string;
    scope: EscopoDaAssinatura;
    user?: string;
    signingKey: string;
  }): Promise<AssinaturaDeWebhook>;
  apagarAssinatura(uri: string): Promise<void>;
}

type Fetch = typeof fetch;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function lerAssinatura(r: unknown): AssinaturaDeWebhook | null {
  if (!ehObjeto(r) || typeof r.uri !== "string") return null;
  return {
    uri: r.uri,
    callbackUrl: typeof r.callback_url === "string" ? r.callback_url : "",
    estado: r.state === "disabled" ? "disabled" : "active",
    eventos: Array.isArray(r.events) ? r.events.filter((e): e is string => typeof e === "string") : [],
    escopo: r.scope === "user" ? "user" : "organization",
    retryStartedAt: textoOuNulo(r.retry_started_at),
  };
}

export function criarClienteCalendly(token: string, fetchFn: Fetch = fetch): ClienteCalendly {
  async function pedir(url: string, init: RequestInit = {}): Promise<Record<string, unknown> | null> {
    if (!doCalendly(url)) throw new CalendlyError("calendly_error", "URL fora de api.calendly.com");
    let resposta: Response;
    try {
      resposta = await fetchFn(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new CalendlyError("rede", semSegredo(e instanceof Error ? e.message : String(e), token));
    }
    if (resposta.status === 204) return null;
    const corpo: unknown = await resposta.json().catch(() => null);
    if (!resposta.ok) {
      const mensagem =
        ehObjeto(corpo) && typeof corpo.message === "string"
          ? corpo.message
          : ehObjeto(corpo) && typeof corpo.title === "string"
            ? corpo.title
            : `HTTP ${resposta.status}`;
      throw new CalendlyError(codigoDoErro(resposta.status), semSegredo(`${resposta.status}: ${mensagem}`, token));
    }
    if (!ehObjeto(corpo)) throw new CalendlyError("calendly_error", "resposta sem corpo JSON");
    return corpo;
  }

  /** Junta `collection` de todas as páginas (`pagination.next_page_token`). */
  async function paginar(url: string): Promise<unknown[]> {
    const tudo: unknown[] = [];
    let proxima: string | null = url;
    for (let pagina = 0; proxima && pagina < MAX_PAGINAS; pagina++) {
      const corpo: Record<string, unknown> | null = await pedir(proxima);
      if (!corpo) break;
      if (Array.isArray(corpo.collection)) tudo.push(...corpo.collection);
      const paging = ehObjeto(corpo.pagination) ? corpo.pagination : null;
      const tokenDaPagina = paging && typeof paging.next_page_token === "string" ? paging.next_page_token : null;
      if (tokenDaPagina) {
        const u = new URL(url);
        u.searchParams.set("page_token", tokenDaPagina);
        proxima = u.toString();
      } else {
        proxima = null;
      }
    }
    if (proxima) throw new CalendlyError("calendly_error", `paginação passou de ${MAX_PAGINAS} páginas`);
    return tudo;
  }

  return {
    async usuarioAtual() {
      const corpo = await pedir(`${ORIGEM_CALENDLY}/users/me`);
      const r = corpo && ehObjeto(corpo.resource) ? corpo.resource : null;
      if (!r || typeof r.uri !== "string" || typeof r.current_organization !== "string") {
        throw new CalendlyError("calendly_error", "resposta de /users/me sem uri/organização");
      }
      return {
        uri: r.uri,
        nome: typeof r.name === "string" ? r.name : "",
        email: typeof r.email === "string" ? r.email : "",
        organizationUri: r.current_organization,
        schedulingUrl: textoOuNulo(r.scheduling_url),
        timezone: textoOuNulo(r.timezone),
      };
    },

    async tiposDeEvento(filtro) {
      const u = new URL(`${ORIGEM_CALENDLY}/event_types`);
      if (filtro.organization) u.searchParams.set("organization", filtro.organization);
      if (filtro.user) u.searchParams.set("user", filtro.user);
      u.searchParams.set("count", "100");
      const linhas = await paginar(u.toString());
      const tipos: TipoDeEvento[] = [];
      for (const l of linhas) {
        if (!ehObjeto(l) || typeof l.uri !== "string") continue;
        tipos.push({
          uri: l.uri,
          nome: typeof l.name === "string" ? l.name : l.uri,
          ativo: l.active !== false,
          schedulingUrl: textoOuNulo(l.scheduling_url),
          duracao: typeof l.duration === "number" ? l.duration : null,
        });
      }
      return tipos;
    },

    async assinaturas(filtro) {
      const u = new URL(`${ORIGEM_CALENDLY}/webhook_subscriptions`);
      u.searchParams.set("organization", filtro.organization);
      u.searchParams.set("scope", filtro.scope);
      if (filtro.user) u.searchParams.set("user", filtro.user);
      u.searchParams.set("count", "100");
      const linhas = await paginar(u.toString());
      return linhas.map(lerAssinatura).filter((a): a is AssinaturaDeWebhook => a !== null);
    },

    async assinatura(uri) {
      const corpo = await pedir(uri);
      const lida = corpo ? lerAssinatura(corpo.resource) : null;
      if (!lida) throw new CalendlyError("calendly_error", "assinatura sem `resource.uri` na resposta");
      return lida;
    },

    async criarAssinatura(args) {
      const corpo = await pedir(`${ORIGEM_CALENDLY}/webhook_subscriptions`, {
        method: "POST",
        body: JSON.stringify({
          url: args.url,
          events: args.events,
          organization: args.organization,
          scope: args.scope,
          ...(args.user ? { user: args.user } : {}),
          signing_key: args.signingKey,
        }),
      });
      const criada = corpo ? lerAssinatura(corpo.resource) : null;
      if (!criada) throw new CalendlyError("calendly_error", "assinatura criada sem `resource.uri` na resposta");
      return criada;
    },

    async apagarAssinatura(uri) {
      await pedir(uri, { method: "DELETE" });
    },
  };
}
