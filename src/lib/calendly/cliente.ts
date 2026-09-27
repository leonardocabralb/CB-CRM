/**
 * Cliente da API v2 do Calendly — só o que a integração usa: quem é o dono
 * do token, os tipos de evento (para o select do gatilho), as assinaturas
 * de webhook (criar, listar, apagar) e, para o agente de IA que marca
 * reunião (F5 dos agentes), os horários livres de um tipo de evento
 * (`GET /event_type_available_times`) e o agendamento em nome do cliente
 * (`POST /invitees`, a Scheduling API).
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
    /** O status HTTP da resposta (nulo = nem houve resposta: rede, tempo, URL recusada). */
    public readonly status: number | null = null,
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
  /** O `kind` do PRIMEIRO local do tipo de evento (`google_conference`, `physical`…); nulo = sem local. */
  local: string | null;
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
  /** Um tipo de evento pelo URI (`GET /event_types/{uuid}`) — ativo e local, lidos na hora. */
  tipoDeEvento(uri: string, opcoes?: OpcoesDoPedido): Promise<TipoDeEvento>;
  /**
   * Os horários LIVRES de um tipo de evento (`GET /event_type_available_times`):
   * os `start_time` (ISO, UTC) com `status = 'available'`. A janela é de no
   * máximo 7 dias (medido em 26/09/2026).
   */
  horariosLivres(args: { tipoDeEvento: string; inicio: string; fim: string }, opcoes?: OpcoesDoPedido): Promise<string[]>;
  /**
   * Marca uma reunião em nome do convidado (`POST /invitees`, a Scheduling
   * API). O corpo é montado por quem chama (`corpoDoConvidado`, um ponto só).
   * Devolve a URI do convidado criado (nula quando a resposta não a traz).
   */
  criarConvidado(corpo: Record<string, unknown>, opcoes?: OpcoesDoPedido): Promise<{ uri: string | null }>;
}

export interface OpcoesDoPedido {
  /** Prazo do pedido, em ms (padrão: 15 s). Estourado = `CalendlyError('rede')`. */
  prazoMs?: number;
}

type Fetch = typeof fetch;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Um tipo de evento da API (a linha da lista ou o `resource` do GET por URI). */
function lerTipoDeEvento(l: unknown): TipoDeEvento | null {
  if (!ehObjeto(l) || typeof l.uri !== "string") return null;
  const primeiro = Array.isArray(l.locations) ? l.locations.find(ehObjeto) : undefined;
  return {
    uri: l.uri,
    nome: typeof l.name === "string" ? l.name : l.uri,
    ativo: l.active !== false,
    schedulingUrl: textoOuNulo(l.scheduling_url),
    duracao: typeof l.duration === "number" ? l.duration : null,
    local: primeiro ? textoOuNulo(primeiro.kind) : null,
  };
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
  async function pedir(
    url: string,
    init: RequestInit = {},
    opcoes: OpcoesDoPedido = {},
  ): Promise<Record<string, unknown> | null> {
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
        signal: AbortSignal.timeout(opcoes.prazoMs ?? TIMEOUT_MS),
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
      throw new CalendlyError(
        codigoDoErro(resposta.status),
        semSegredo(`${resposta.status}: ${mensagem}`, token),
        resposta.status,
      );
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
      return linhas.map(lerTipoDeEvento).filter((t): t is TipoDeEvento => t !== null);
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

    async tipoDeEvento(uri, opcoes) {
      const corpo = await pedir(uri, {}, opcoes);
      const lido = corpo ? lerTipoDeEvento(corpo.resource) : null;
      if (!lido) throw new CalendlyError("calendly_error", "tipo de evento sem `resource.uri` na resposta");
      return lido;
    },

    async horariosLivres(args, opcoes) {
      const u = new URL(`${ORIGEM_CALENDLY}/event_type_available_times`);
      u.searchParams.set("event_type", args.tipoDeEvento);
      u.searchParams.set("start_time", args.inicio);
      u.searchParams.set("end_time", args.fim);
      const corpo = await pedir(u.toString(), {}, opcoes);
      const linhas = corpo && Array.isArray(corpo.collection) ? corpo.collection : [];
      const livres: string[] = [];
      for (const l of linhas) {
        if (!ehObjeto(l) || typeof l.start_time !== "string") continue;
        // Só o que o Calendly diz que está LIVRE: o status ausente não é livre.
        if (l.status !== "available") continue;
        livres.push(l.start_time);
      }
      return livres;
    },

    async criarConvidado(corpoDoPedido, opcoes) {
      const corpo = await pedir(
        `${ORIGEM_CALENDLY}/invitees`,
        { method: "POST", body: JSON.stringify(corpoDoPedido) },
        opcoes,
      );
      const r = corpo && ehObjeto(corpo.resource) ? corpo.resource : null;
      return { uri: r && typeof r.uri === "string" ? r.uri : null };
    },
  };
}
