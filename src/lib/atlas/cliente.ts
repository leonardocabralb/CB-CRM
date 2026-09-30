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
import { telefoneForte, uuidsDoLink } from "./leitura";
import { lerNegociacoes, type NegociacoesDoAtlas } from "./negociacoes";

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
  /** Resposta 2xx sem o que se esperava (corpo que não é JSON, sem o id): pode ter gravado. */
  | "resposta_inesperada"
  | "atlas_error";

export class AtlasError extends Error {
  constructor(
    public readonly codigo: CodigoDoErroAtlas,
    mensagem: string,
    /** O status HTTP (nulo = nem houve resposta: rede, tempo esgotado). */
    public readonly status: number | null = null,
    /** Com `sem_permissao`: qual permissão do Atlas está desligada. */
    public readonly permissao: string | null = null,
    detalhe: { codigoDoAtlas?: string | null; campos?: string[]; apiAntiga?: boolean; esperaSegundos?: number | null } = {},
  ) {
    super(mensagem);
    this.name = "AtlasError";
    this.codigoDoAtlas = detalhe.codigoDoAtlas ?? null;
    this.campos = detalhe.campos ?? [];
    this.apiAntiga = detalhe.apiAntiga === true;
    this.esperaSegundos = detalhe.esperaSegundos ?? null;
  }

  /** O `code` cru do Atlas (nunca vai à tela). */
  public readonly codigoDoAtlas: string | null;
  /** Com `validacao`: os NOSSOS campos que o Atlas recusou (só os nomes). */
  public readonly campos: string[];
  /**
   * Com `resposta_inesperada`: a API do Atlas ainda é a ANTIGA (a listagem
   * veio sem `status_changed_at` — a produção antes da promoção, contrato
   * §13). Ela pode ignorar o filtro e devolver todos: nada da página é gravado.
   */
  public readonly apiAntiga: boolean;
  /**
   * Com `limite` (429): quantos segundos o Atlas pediu para esperar — do
   * `retry_after_seconds` do corpo ou, sem ele, do cabeçalho `Retry-After`
   * (contrato §7). Nulo = o Atlas não disse.
   */
  public readonly esperaSegundos: number | null;
}

/** Segundos de espera legíveis (número positivo, ou texto só de dígitos); qualquer outra coisa é "não disse". */
function segundosOuNulo(v: unknown): number | null {
  const n = typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
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
  // ⚠️ 404 SEM o `not_found` do Atlas não é "cliente apagado": é o gateway
  // (função fora do ar, endereço errado). Tratá-lo como ausência apagaria o
  // vínculo e recriaria o cliente (CLAUDE.md 8b: erro de leitura ≠ não encontrado).
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
  /**
   * Quando a situação mudou no Atlas (`status_changed_at`, ISO), `null` =
   * o Atlas não sabe. AUSENTE (`undefined`) = a chave nem veio: a API
   * antiga, que não a conhece.
   */
  situacaoDesde?: string | null;
  /**
   * Só no `find_clients`: POR QUE casou (`chat_link`, `phone`, `phone_last8`,
   * `email`, `doc_id`). Ausente = o Atlas não disse (o passo não age sozinho).
   */
  casouPor?: string[];
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

/**
 * Um cliente da LISTAGEM (`list_clients`), já reduzido ao que o CRM guarda e
 * usa: o id, a situação, a data, o `app_url` e dois SINAIS para o vínculo
 * automático, que ficam só em memória — os uuids do link da conversa e o
 * telefone canônico. ⚠️ Nome, CPF, e-mail e o texto do link NUNCA saem do
 * parser (`lerPaginaDaListagem`).
 */
export interface ClienteListado {
  id: string;
  status: string | null;
  situacaoDesde: string | null;
  appUrl: string | null;
  sinais: { uuidsDoLink: string[]; telefoneCanonico: string | null };
}

export interface PaginaDaListagem {
  clientes: ClienteListado[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FiltroDaListagem {
  /** ISO com fuso, inclusivo: só quem MUDOU de situação desde então (data desconhecida fica fora). */
  statusChangedSince?: string | null;
  cursor?: string | null;
  limit: number;
}

export interface ClienteAtlas {
  whoami(): Promise<IdentidadeNoAtlas>;
  /** Uma página do `list_clients` (permissão `list_clients`, opcional no escritório). */
  listar(filtro: FiltroDaListagem): Promise<PaginaDaListagem>;
  /** Todos os que casam (teto do Atlas); `truncado` = havia mais. */
  buscar(criterios: CriteriosDeBusca): Promise<{ clientes: ClienteDoAtlas[]; truncado: boolean }>;
  /** `not_found` DO ATLAS = `null` (cliente apagado lá); qualquer outra falha lança. */
  ler(id: string): Promise<ClienteDoAtlas | null>;
  /**
   * Bancos, contratos, propostas e acordos do cliente (`get_client_negotiations`,
   * permissão `read_negotiations`, OPCIONAL no escritório), já pela allowlist
   * de `negociacoes.ts`. O `not_found` (lixeira, outro escritório) LANÇA
   * `nao_encontrado` — quem lê não apaga o vínculo por isso.
   */
  negociacoes(clientId: string): Promise<NegociacoesDoAtlas>;
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

/** Um instante ISO legível, normalizado; qualquer outra coisa é "não se sabe". */
function instanteOuNulo(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Um cliente como o Atlas o devolve (`get_client`, `find_clients`, `list_clients`). */
export function lerCliente(v: unknown): ClienteDoAtlas | null {
  if (!ehObjeto(v) || typeof v.id !== "string" || v.id === "") return null;
  const cliente: ClienteDoAtlas = { id: v.id, status: textoOuNulo(v.status), appUrl: textoOuNulo(v.app_url) ?? textoOuNulo(v.appUrl) };
  if ("status_changed_at" in v) cliente.situacaoDesde = instanteOuNulo(v.status_changed_at);
  if (Array.isArray(v.matched_by)) cliente.casouPor = v.matched_by.filter((m): m is string => typeof m === "string");
  return cliente;
}

/**
 * Uma página do `list_clients`, reduzida a `ClienteListado`. LANÇA
 * `resposta_inesperada`:
 * - sem a lista, ou com um cliente ilegível (descartá-lo esconderia uma
 *   mudança — como no `find_clients`);
 * - com `hasMore` e sem `nextCursor` (o ciclo releria a mesma página);
 * - ⚠️ com um cliente SEM a chave `status_changed_at`: é a API ANTIGA
 *   (`apiAntiga`), que ignora o `statusChangedSince` e devolveria todos como
 *   se tivessem mudado. Nada da página é gravado.
 */
export function lerPaginaDaListagem(corpo: unknown): PaginaDaListagem {
  if (!ehObjeto(corpo) || !Array.isArray(corpo.clients)) {
    throw new AtlasError("resposta_inesperada", "list_clients → resposta sem `clients`");
  }
  const clientes: ClienteListado[] = [];
  for (const bruto of corpo.clients) {
    const lido = lerCliente(bruto);
    if (!lido || !ehObjeto(bruto)) throw new AtlasError("resposta_inesperada", "list_clients → cliente ilegível na lista");
    if (lido.situacaoDesde === undefined) {
      throw new AtlasError("resposta_inesperada", "list_clients → cliente sem `status_changed_at` (API antiga)", null, null, { apiAntiga: true });
    }
    clientes.push({
      id: lido.id,
      status: lido.status,
      situacaoDesde: lido.situacaoDesde,
      appUrl: lido.appUrl,
      sinais: { uuidsDoLink: uuidsDoLink(bruto.chat_link), telefoneCanonico: telefoneForte(bruto.phone) },
    });
  }
  const hasMore = corpo.hasMore === true;
  const nextCursor = textoOuNulo(corpo.nextCursor);
  if (hasMore && !nextCursor) throw new AtlasError("resposta_inesperada", "list_clients → `hasMore` sem `nextCursor`");
  return { clientes, nextCursor: hasMore ? nextCursor : null, hasMore };
}

/** Os nomes de campo que o CRM MANDA — só estes vão ao motivo da falha de validação. */
const CAMPOS_ENVIADOS = new Set([
  "id",
  "name",
  "email",
  "phone",
  "state",
  "contractType",
  "contractValue",
  "firstContactDate",
  "proposalDate",
  "closingDate",
  "chatLink",
  "notes",
  "status",
  "chatLinkIds",
  "clientId",
  "statusChangedSince",
  "cursor",
  "limit",
]);

function camposRecusados(v: unknown): string[] {
  const nomes = Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x : ehObjeto(x) && typeof x.field === "string" ? x.field : null))
    : ehObjeto(v)
      ? Object.keys(v)
      : [];
  return [...new Set(nomes.filter((n): n is string => n !== null && CAMPOS_ENVIADOS.has(n)))];
}

export function lerIdentidade(v: unknown): IdentidadeNoAtlas {
  const tenant = ehObjeto(v) && ehObjeto(v.tenant) ? v.tenant : null;
  if (!tenant || typeof tenant.id !== "string" || tenant.id === "") {
    throw new AtlasError("resposta_inesperada", "whoami → resposta sem `tenant.id`");
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

/** ⚠️ Recebe o texto JÁ sem a chave: o corte de 300 viria antes e deixaria um pedaço dela. */
function lerErro(texto: string): { codigo: string | null; mensagem: string; permissao: string | null; campos: string[]; esperaSegundos: number | null } {
  try {
    const j: unknown = JSON.parse(texto);
    if (ehObjeto(j)) {
      return {
        codigo: typeof j.code === "string" ? j.code : null,
        mensagem: typeof j.error === "string" ? j.error : texto.slice(0, 300),
        permissao: typeof j.permission === "string" ? j.permission : null,
        campos: camposRecusados(j.fields),
        esperaSegundos: segundosOuNulo(j.retry_after_seconds),
      };
    }
  } catch {
    /* não é JSON: vai o texto */
  }
  return { codigo: null, mensagem: texto.slice(0, 300), permissao: null, campos: [], esperaSegundos: null };
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
    // Sem a chave ANTES de qualquer corte: um eco dela na fronteira escaparia.
    const texto = limpar(await resposta.text().catch(() => ""));
    if (!resposta.ok) {
      const erro = lerErro(texto);
      throw new AtlasError(
        codigoDoErro(resposta.status, erro.codigo),
        limpar(`${action} → ${resposta.status}${erro.codigo ? ` ${erro.codigo}` : ""}: ${erro.mensagem || `HTTP ${resposta.status}`}`),
        resposta.status,
        erro.permissao,
        {
          codigoDoAtlas: erro.codigo,
          campos: erro.campos,
          esperaSegundos: erro.esperaSegundos ?? segundosOuNulo(resposta.headers.get("retry-after")),
        },
      );
    }
    if (!texto) return null;
    try {
      return JSON.parse(texto) as unknown;
    } catch {
      throw new AtlasError("resposta_inesperada", `${action} → resposta que não é JSON`, resposta.status);
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
    throw new AtlasError("resposta_inesperada", `${action} → resposta sem o id do cliente`);
  }

  return {
    async whoami() {
      return lerIdentidade(await pedir("whoami", {}));
    },

    async listar(filtro) {
      const data: Record<string, unknown> = { limit: filtro.limit };
      if (filtro.statusChangedSince) data.statusChangedSince = filtro.statusChangedSince;
      if (filtro.cursor) data.cursor = filtro.cursor;
      return lerPaginaDaListagem(await pedir("list_clients", data));
    },

    async buscar(criterios) {
      const data: Record<string, unknown> = {};
      if (criterios.phone) data.phone = criterios.phone;
      if (criterios.email) data.email = criterios.email;
      if (criterios.chatLinkIds && criterios.chatLinkIds.length > 0) data.chatLinkIds = criterios.chatLinkIds.slice(0, 10);
      const corpo = await pedir("find_clients", data);
      if (!ehObjeto(corpo) || !Array.isArray(corpo.clients)) {
        throw new AtlasError("resposta_inesperada", "find_clients → resposta sem `clients`");
      }
      const clientes = corpo.clients.map(lerCliente);
      // ⚠️ Descartar o ilegível mudaria a CONTAGEM que decide: dois viram um
      // (reativa quem pode ser outro), um vira zero (cria duplicado).
      if (clientes.some((c) => c === null)) throw new AtlasError("resposta_inesperada", "find_clients → cliente ilegível na lista");
      return { clientes: clientes as ClienteDoAtlas[], truncado: corpo.truncated === true };
    },

    async ler(id) {
      let corpo: unknown;
      try {
        corpo = await pedir("get_client", { id });
      } catch (e) {
        // Só o `not_found` DO ATLAS é "apagado"; 404 sem ele já virou outro código.
        if (e instanceof AtlasError && e.codigo === "nao_encontrado") return null;
        throw e;
      }
      const lido = lerCliente(ehObjeto(corpo) ? corpo.client : null);
      // 200 sem cliente legível NÃO é "apagado": quem lê isso apagaria o vínculo.
      if (!lido) throw new AtlasError("resposta_inesperada", "get_client → resposta sem o cliente");
      return lido;
    },

    async negociacoes(clientId) {
      const lidas = lerNegociacoes(await pedir("get_client_negotiations", { clientId }));
      // 2xx sem a lista legível não é "sem negociação": a tela diria que o
      // cliente não tem dívida nenhuma.
      if (!lidas) throw new AtlasError("resposta_inesperada", "get_client_negotiations → resposta sem `banks` legível");
      return lidas;
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
