import { describe, expect, it } from "vitest";

import { AtlasError, MARCA_DE_SEGREDO, codigoDoErro, criarClienteAtlas, lerIdentidade } from "./cliente";
import { API_DO_ATLAS, urlDaApiDoAtlas } from "./enderecos";

// Chave de TESTE — nenhuma chave real do Atlas.
const CHAVE = "sk_teste_0000000000000000000000000000";
const URL_TESTE = "https://atlas.example.com/functions/v1/client-webhook";

interface Pedido {
  url: string;
  init: RequestInit;
  corpo: { action: string; data: Record<string, unknown> };
}

function fetchFalso(resposta: { status: number; corpo: unknown } | Error) {
  const pedidos: Pedido[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init, corpo: JSON.parse(String(init.body)) });
    if (resposta instanceof Error) throw resposta;
    return new Response(typeof resposta.corpo === "string" ? resposta.corpo : JSON.stringify(resposta.corpo), { status: resposta.status });
  }) as unknown as typeof fetch;
  return { fn, pedidos };
}

describe("o pedido", () => {
  it("a chave vai no cabeçalho x-api-key, nunca na URL; redirecionamento não é seguido", async () => {
    const f = fetchFalso({ status: 200, corpo: { success: true, tenant: { id: "t1", name: "Escritório Exemplo" }, permissions: {} } });
    await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).whoami();
    const [p] = f.pedidos;
    expect(p.url).toBe(URL_TESTE);
    expect(p.url).not.toContain(CHAVE);
    expect((p.init.headers as Record<string, string>)["x-api-key"]).toBe(CHAVE);
    expect(p.init.redirect).toBe("manual");
    expect(p.corpo).toEqual({ action: "whoami", data: {} });
  });

  it("Idempotency-Key só nas escritas", async () => {
    const f = fetchFalso({ status: 200, corpo: { success: true, clientId: "novo-1", appUrl: "https://app.example.com/#/clients/novo-1" } });
    const atlas = criarClienteAtlas(CHAVE, f.fn, URL_TESTE);
    const criado = await atlas.criar({ name: "Cliente Exemplo" }, "log-1:passo-1:criar");
    expect(criado).toEqual({ id: "novo-1", status: null, appUrl: "https://app.example.com/#/clients/novo-1" });
    expect((f.pedidos[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("log-1:passo-1:criar");

    const g = fetchFalso({ status: 200, corpo: { success: true, clients: [], truncated: false } });
    await criarClienteAtlas(CHAVE, g.fn, URL_TESTE).buscar({ phone: "5511987654321", chatLinkIds: ["a", "b"] });
    expect((g.pedidos[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
    expect(g.pedidos[0].corpo).toEqual({ action: "find_clients", data: { phone: "5511987654321", chatLinkIds: ["a", "b"] } });
  });
});

describe("os erros", () => {
  it("o code do Atlas vira o nosso código; a permissão desligada vem nomeada", async () => {
    const f = fetchFalso({ status: 403, corpo: { error: "Permission denied: read_client is disabled", code: "permission_denied", permission: "read_client" } });
    const e = await criarClienteAtlas(CHAVE, f.fn, URL_TESTE)
      .buscar({ phone: "5511987654321" })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AtlasError);
    expect((e as AtlasError).codigo).toBe("sem_permissao");
    expect((e as AtlasError).permissao).toBe("read_client");
  });

  it("sem code, cai pelo status", () => {
    expect(codigoDoErro(401, null)).toBe("chave_invalida");
    expect(codigoDoErro(404, null)).toBe("nao_encontrado");
    expect(codigoDoErro(429, null)).toBe("limite");
    expect(codigoDoErro(503, null)).toBe("fora_do_ar");
    expect(codigoDoErro(400, null)).toBe("atlas_error");
    expect(codigoDoErro(400, "unknown_action")).toBe("acao_desconhecida");
    expect(codigoDoErro(403, "api_not_in_plan")).toBe("api_fora_do_plano");
  });

  it("a chave nunca aparece na mensagem, nem quando o Atlas a ecoa", async () => {
    const f = fetchFalso({ status: 403, corpo: { error: `Invalid API Key ${CHAVE}`, code: "invalid_api_key" } });
    const e = (await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).whoami().catch((x: unknown) => x)) as AtlasError;
    expect(e.codigo).toBe("chave_invalida");
    expect(e.message).not.toContain(CHAVE);
    expect(e.message).toContain(MARCA_DE_SEGREDO);
  });

  it("rede vira 'rede'", async () => {
    const f = fetchFalso(new Error(`connect ECONNREFUSED com ${CHAVE}`));
    const e = (await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).whoami().catch((x: unknown) => x)) as AtlasError;
    expect(e.codigo).toBe("rede");
    expect(e.message).not.toContain(CHAVE);
  });

  it("get_client com 404 é 'não existe' (null), não erro", async () => {
    const f = fetchFalso({ status: 404, corpo: { error: "Client not found", code: "not_found" } });
    expect(await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).ler("00000000-0000-4000-8000-000000000001")).toBeNull();
  });
});

describe("leitura das respostas", () => {
  it("whoami sem tenant é erro, não identidade vazia", () => {
    expect(() => lerIdentidade({ success: true })).toThrow(AtlasError);
    expect(lerIdentidade({ tenant: { id: "t1", name: "Escritório Exemplo" }, plan: "elite", permissions: { read_client: true, create_client: "sim" } })).toEqual({
      tenantId: "t1",
      escritorio: "Escritório Exemplo",
      plano: "elite",
      permissoes: { read_client: true, create_client: false },
      appBaseUrl: null,
    });
  });

  it("find_clients: cada cliente com id, status e app_url; truncated vem junto", async () => {
    const f = fetchFalso({
      status: 200,
      corpo: { success: true, truncated: true, clients: [{ id: "c1", status: "rescindido", app_url: "https://app.example.com/#/clients/c1" }, { semId: true }] },
    });
    expect(await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).buscar({ email: "cliente@example.com" })).toEqual({
      clientes: [{ id: "c1", status: "rescindido", appUrl: "https://app.example.com/#/clients/c1" }],
      truncado: true,
    });
  });
});

describe("o endereço", () => {
  it("padrão é o do produto; ATLAS_API_URL só troca por https", () => {
    expect(urlDaApiDoAtlas(undefined)).toBe(API_DO_ATLAS);
    expect(urlDaApiDoAtlas("  ")).toBe(API_DO_ATLAS);
    expect(urlDaApiDoAtlas("http://atlas.example.com/x")).toBe(API_DO_ATLAS);
    expect(urlDaApiDoAtlas("isto não é url")).toBe(API_DO_ATLAS);
    expect(urlDaApiDoAtlas(URL_TESTE)).toBe(URL_TESTE);
  });
});
