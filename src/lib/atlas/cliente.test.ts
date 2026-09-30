import { describe, expect, it } from "vitest";

import { AtlasError, MARCA_DE_SEGREDO, codigoDoErro, criarClienteAtlas, lerIdentidade } from "./cliente";
import { API_DO_ATLAS, ambienteDoAtlas, urlDaApiDoAtlas } from "./enderecos";

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
    // 404 SEM o `not_found` do Atlas é o gateway (endereço errado, função fora do ar), nunca "apagado".
    expect(codigoDoErro(404, null)).toBe("atlas_error");
    expect(codigoDoErro(404, "NOT_FOUND")).toBe("atlas_error");
    expect(codigoDoErro(404, "not_found")).toBe("nao_encontrado");
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

  it("a chave que atravessa o corte de 300 caracteres também sai (limpa ANTES de cortar)", async () => {
    const f = fetchFalso({ status: 502, corpo: `${"x".repeat(280)}${CHAVE} mais texto` });
    const e = (await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).whoami().catch((x: unknown) => x)) as AtlasError;
    expect(e.codigo).toBe("fora_do_ar");
    expect(e.message).not.toContain(CHAVE.slice(0, 12));
  });

  it("validação: guarda só os NOSSOS nomes de campo recusados", async () => {
    const f = fetchFalso({
      status: 400,
      corpo: { error: "Validation failed", code: "validation_error", fields: { email: "formato inválido", "<script>": "x", phone: "curto" } },
    });
    const e = (await criarClienteAtlas(CHAVE, f.fn, URL_TESTE)
      .criar({ name: "Cliente Exemplo" }, "k")
      .catch((x: unknown) => x)) as AtlasError;
    expect(e.codigo).toBe("validacao");
    expect(e.codigoDoAtlas).toBe("validation_error");
    expect(e.campos).toEqual(["email", "phone"]);
  });

  it("rede vira 'rede'", async () => {
    const f = fetchFalso(new Error(`connect ECONNREFUSED com ${CHAVE}`));
    const e = (await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).whoami().catch((x: unknown) => x)) as AtlasError;
    expect(e.codigo).toBe("rede");
    expect(e.message).not.toContain(CHAVE);
  });

  it("get_client com o `not_found` do Atlas é 'não existe' (null), não erro", async () => {
    const f = fetchFalso({ status: 404, corpo: { error: "Client not found", code: "not_found" } });
    expect(await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).ler("00000000-0000-4000-8000-000000000001")).toBeNull();
  });

  it("CRÍTICO: 404 do gateway (sem o `not_found`) e 200 sem cliente LANÇAM — quem lê null apagaria o vínculo", async () => {
    const gateway = fetchFalso({ status: 404, corpo: { code: "NOT_FOUND", message: "Requested function was not found" } });
    const e1 = (await criarClienteAtlas(CHAVE, gateway.fn, URL_TESTE).ler("c1").catch((x: unknown) => x)) as AtlasError;
    expect(e1).toBeInstanceOf(AtlasError);
    expect(e1.codigo).toBe("atlas_error");
    const vazio = fetchFalso({ status: 200, corpo: { success: true } });
    const e2 = (await criarClienteAtlas(CHAVE, vazio.fn, URL_TESTE).ler("c1").catch((x: unknown) => x)) as AtlasError;
    expect(e2.codigo).toBe("resposta_inesperada");
  });

  it("2xx sem o id do cliente criado é 'resposta_inesperada' (pode ter gravado), nunca 'erro' comum", async () => {
    const f = fetchFalso({ status: 200, corpo: { success: true } });
    const e = (await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).criar({ name: "Cliente Exemplo" }, "k").catch((x: unknown) => x)) as AtlasError;
    expect(e.codigo).toBe("resposta_inesperada");
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

  it("CRÍTICO: um cliente ilegível na lista do find_clients FALHA a busca (descartá-lo mudaria a contagem que decide)", async () => {
    const f = fetchFalso({ status: 200, corpo: { success: true, truncated: false, clients: [{ id: "c1", status: "ativo" }, { semId: true }] } });
    const e = (await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).buscar({ email: "cliente@example.com" }).catch((x: unknown) => x)) as AtlasError;
    expect(e.codigo).toBe("resposta_inesperada");
  });

  it("find_clients: cada cliente com id, status e app_url; truncated vem junto", async () => {
    const f = fetchFalso({
      status: 200,
      corpo: {
        success: true,
        truncated: true,
        clients: [{ id: "c1", status: "rescindido", app_url: "https://app.example.com/#/clients/c1", matched_by: ["phone", 7, "chat_link"] }],
      },
    });
    expect(await criarClienteAtlas(CHAVE, f.fn, URL_TESTE).buscar({ email: "cliente@example.com" })).toEqual({
      clientes: [{ id: "c1", status: "rescindido", appUrl: "https://app.example.com/#/clients/c1", casouPor: ["phone", "chat_link"] }],
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

  it("o ambiente: nulo = o Atlas de verdade (inclusive a variável com o próprio endereço do produto)", () => {
    expect(ambienteDoAtlas(undefined)).toBeNull();
    expect(ambienteDoAtlas("http://atlas.example.com/x")).toBeNull();
    expect(ambienteDoAtlas(API_DO_ATLAS)).toBeNull();
    expect(ambienteDoAtlas(URL_TESTE)).toBe(URL_TESTE);
  });
});
