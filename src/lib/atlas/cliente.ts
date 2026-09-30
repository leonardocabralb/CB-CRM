/**
 * Cliente da API pública do Atlas Gestor — um endpoint só (`client-webhook`),
 * com a ação no corpo (`{ action, data }`) e a chave do ESCRITÓRIO no
 * cabeçalho `x-api-key`. Plano: docs/PLANO-integracao-atlas.md.
 *
 * - A chave vai no cabeçalho, nunca na URL; toda mensagem de erro passa por
 *   `semSegredo()` antes de virar log ou `Error.message`.
 * - Erro vira CÓDIGO nosso (`chave_invalida`, `sem_permissao`, …) a partir do
 *   `code` que o Atlas manda; a tela e o passo da automação traduzem.
 * - Redirecionamento não é seguido (`manual`): o cabeçalho com a chave não
 *   sai para outro host. O endereço é FIXO (`urlDaApiDoAtlas`), nunca vindo
 *   de fora.
 * - Leitura ignora `Idempotency-Key`; escrita (criar, atualizar) a manda
 *   ESTÁVEL por passo de execução: repetir a mesma chamada devolve a mesma
 *   resposta em vez de criar outro cliente.
 */

import { urlDaApiDoAtlas } from "./enderecos";

const TIMEOUT_MS = 15_000;

export type CodigoDoErroAtlas =
  | "chave_invalida"
  | "api_fora_do_plano"
  | "sem_permissao"
  | "validacao"
  | "nao_encontrado"
  | "limite"
  | "limite_do_plano"
  | "idempotencia"
  | "acao_desconhecida"
  | "fora_do_ar"
  | "rede"
  | "atlas_error";

export class AtlasError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroAtlas,
    mensagem: string,
    /** O status HTTP (nulo = nem houve resposta: rede, tempo esgotado). */
    public readonly status: number | null = null,
    /** Com `sem_permissao`: qual permissão do Atlas está desligada. */
    public readonly permissao: string | null = null,
  ) {
    super(mensagem);
    this.name = "AtlasError";
  }
}

/**
 * Puro: o `code` do Atlas (e, sem ele, o status HTTP) → o nosso código.
 * Os códigos do Atlas são os do contrato pedido (`missing_api_key`,
 * `invalid_api_key`, `api_not_in_plan`, `permission_denied`, …); código que
 * ainda não conhecemos cai pelo status.
 */
export function codigoDoErro(status: number, codigoDoAtlas: string | null): CodigoDoErroAtlas {
  switch (codigoDoAtlas) {
    case "missing_api_key":
    case "invalid_api_key":
      return "chave_invalida";
    case "api_not_in_plan":
      return "api_fora_do_plano";
    case "permission_denied":
      return "sem_permissao";
    case "validation_error":
      return "validacao";
    case "not_found":
      return "nao_encontrado";
    case "rate_limited":
      return "limite";
    case "plan_client_limit":
      return "limite_do_plano";
    case "idempotency_conflict":
    case "idempotency_in_progress":
    case "idempotency_outcome_unknown":
    case "idempotency_key_invalid":
      return "idempotencia";
    case "unknown_action":
      return "acao_desconhecida";
    case "service_unavailable":
      return "fora_do_ar";
  }
  if (status === 401 || status === 403) return "chave_invalida";
  if (status === 404) return "nao_encontrado";
  if (status === 429) return "limite";
  if (status >= 500) return "fora_do_ar";
  return "atlas_error";
}

export const MARCA_DE_SEGREDO = "«chave»";

/** Tira a chave do texto antes de ele virar log. */
export function semSegredo(texto: string, ...segredos: (string | null | undefined)[]): string {
  let saida = texto;
  for (const s of segredos) {
    if (s && s.length >= 8) saida = saida.replaceAll(s, MARCA_DE_SEGREDO);
  }
  return saida;
}

/** Quem a chave é, pelo `whoami`. */
export interface IdentidadeNoAtlas {
  tenantId: string;
  escritorio: string | null;
  plano: string | null;
  /** O mapa de permissões ligadas no escritório (`create_client: true`, …). */
  permissoes: Record<string, boolean>;
  appBaseUrl: string | null;
}

/** Um cliente do Atlas, só o que o CRM usa. */
export interface ClienteDoAtlas {
  id: string;
  status: string | null;
  appUrl: string | null;
}

/** Os dados de `create_client`/`update_client`, nos nomes do Atlas. */
export interface DadosDoClienteNoAtlas {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  state?: string | null;
  contractType?: string | null;
  contractValue?: number | null;
  firstContactDate?: string | null;
  proposalDate?: string | null;
  closingDate?: string | null;
  chatLink?: string | null;
  notes?: string | null;
  status?: string | null;
}

export interface CriteriosDeBusca {
  phone?: string | null;
  email?: string | null;
  /** Ids de conversa (e da ficha) do CRM que podem estar no `chatLink`. */
  chatLinkIds?: string[];
}

export interface ClienteAtlas {
  whoami(): Promise<IdentidadeNoAtlas>;
  /** Todos os que casam (teto do Atlas); `truncado` = havia mais. */
  buscar(criterios: CriteriosDeBusca): Promise<{ clientes: ClienteDoAtlas[]; truncado: boolean }>;
  /** 404 = `null` (cliente apagado no Atlas). */
  ler(id: string): Promise<ClienteDoAtlas | null>;
  criar(dados: DadosDoClienteNoAtlas, chaveDeIdempotencia: string): Promise<ClienteDoAtlas>;
  atualizar(id: string, dados: DadosDoClienteNoAtlas, chaveDeIdempotencia: string): Promise<ClienteDoAtlas>;
}

type Fetch = typeof fetch;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Um cliente como o Atlas o devolve (`get_client`, `find_clients`, `list_clients`). */
export function lerCliente(v: unknown): ClienteDoAtlas | null {
  if (!ehObjeto(v) || typeof v.id !== "string" || v.id === "") return null;
  return { id: v.id, status: textoOuNulo(v.status), appUrl: textoOuNulo(v.app_url) ?? textoOuNulo(v.appUrl) };
}

export function lerIdentidade(v: unknown): IdentidadeNoAtlas {
  const tenant = ehObjeto(v) && ehObjeto(v.tenant) ? v.tenant : null;
  if (!tenant || typeof tenant.id !== "string" || tenant.id === "") {
    throw new AtlasError("atlas_error", "whoami → resposta sem `tenant.id`");
  }
  const permissoes: Record<string, boolean> = {};
  if (ehObjeto(v) && ehObjeto(v.permissions)) {
    for (const [k, valor] of Object.entries(v.permissions)) permissoes[k] = valor === true;
  }
  return {
    tenantId: tenant.id,
    escritorio: textoOuNulo(tenant.name),
    plano: ehObjeto(v) ? textoOuNulo(v.plan) : null,
    permissoes,
    appBaseUrl: ehObjeto(v) ? textoOuNulo(v.appBaseUrl) : null,
  };
}

function lerErro(texto: string): { codigo: string | null; mensagem: string; permissao: string | null } {
  try {
    const j: unknown = JSON.parse(texto);
    if (ehObjeto(j)) {
      return {
        codigo: typeof j.code === "string" ? j.code : null,
        mensagem: typeof j.error === "string" ? j.error : texto.slice(0, 300),
        permissao: typeof j.permission === "string" ? j.permission : null,
      };
    }
  } catch {
    /* não é JSON: vai o texto */
  }
  return { codigo: null, mensagem: texto.slice(0, 300), permissao: null };
}

export function criarClienteAtlas(chave: string, fetchFn: Fetch = fetch, url: string = urlDaApiDoAtlas()): ClienteAtlas {
  const limpar = (texto: string) => semSegredo(texto, chave);

  async function pedir(action: string, data: Record<string, unknown>, chaveDeIdempotencia?: string): Promise<unknown> {
    let resposta: Response;
    try {
      resposta = await fetchFn(url, {
        method: "POST",
        headers: {
          "x-api-key": chave,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(chaveDeIdempotencia ? { "Idempotency-Key": chaveDeIdempotencia } : {}),
        },
        body: JSON.stringify({ action, data }),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new AtlasError("rede", limpar(`${action} → ${e instanceof Error ? e.message : String(e)}`));
    }
    const texto = await resposta.text().catch(() => "");
    if (!resposta.ok) {
      const erro = lerErro(texto);
      throw new AtlasError(
        codigoDoErro(resposta.status, erro.codigo),
        limpar(`${action} → ${resposta.status}${erro.codigo ? ` ${erro.codigo}` : ""}: ${erro.mensagem || `HTTP ${resposta.status}`}`),
        resposta.status,
        erro.permissao,
      );
    }
    if (!texto) return null;
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      throw new AtlasError("atlas_error", `${action} → resposta que não é JSON`, resposta.status);
    }
  }

  function clienteDaResposta(action: string, corpo: unknown): ClienteDoAtlas {
    // `create_client` devolve `clientId` (+ `appUrl`); o `update_client`, o
    // cliente ou o id pedido. Lê as duas formas.
    if (ehObjeto(corpo)) {
      const dentro = lerCliente(corpo.client);
      if (dentro) return dentro;
      const id = textoOuNulo(corpo.clientId) ?? textoOuNulo(corpo.id);
      if (id) return { id, status: textoOuNulo(corpo.status), appUrl: textoOuNulo(corpo.appUrl) ?? textoOuNulo(corpo.app_url) };
    }
    throw new AtlasError("atlas_error", `${action} → resposta sem o id do cliente`);
  }

  return {
    async whoami() {
      return lerIdentidade(await pedir("whoami", {}));
    },

    async buscar(criterios) {
      const data: Record<string, unknown> = {};
      if (criterios.phone) data.phone = criterios.phone;
      if (criterios.email) data.email = criterios.email;
      if (criterios.chatLinkIds && criterios.chatLinkIds.length > 0) data.chatLinkIds = criterios.chatLinkIds.slice(0, 10);
      const corpo = await pedir("find_clients", data);
      if (!ehObjeto(corpo) || !Array.isArray(corpo.clients)) {
        throw new AtlasError("atlas_error", "find_clients → resposta sem `clients`");
      }
      return {
        clientes: corpo.clients.map(lerCliente).filter((c): c is ClienteDoAtlas => c !== null),
        truncado: corpo.truncated === true,
      };
    },

    async ler(id) {
      try {
        const corpo = await pedir("get_client", { id });
        return lerCliente(ehObjeto(corpo) ? corpo.client : null) ?? null;
      } catch (e) {
        if (e instanceof AtlasError && e.codigo === "nao_encontrado") return null;
        throw e;
      }
    },

    async criar(dados, chaveDeIdempotencia) {
      return clienteDaResposta("create_client", await pedir("create_client", { ...dados }, chaveDeIdempotencia));
    },

    async atualizar(id, dados, chaveDeIdempotencia) {
      const corpo = await pedir("update_client", { id, ...dados }, chaveDeIdempotencia);
      const lido = ehObjeto(corpo) ? lerCliente(corpo.client) : null;
      if (lido) return lido;
      return {
        id,
        status: typeof dados.status === "string" ? dados.status : null,
        appUrl: ehObjeto(corpo) ? (textoOuNulo(corpo.appUrl) ?? textoOuNulo(corpo.app_url)) : null,
      };
    },
  };
}
