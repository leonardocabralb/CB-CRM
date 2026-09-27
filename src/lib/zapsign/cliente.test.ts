import { describe, expect, it } from "vitest";

import { codigoDoErro, criarClienteZapSign, semSegredo, ZapSignError } from "./cliente";

// Token de TESTE — nenhum token real do ZapSign é usado nesta suíte.
const TOKEN = "token-de-teste-0000-1111";

interface Pedido {
  url: string;
  init: RequestInit;
}

function fetchFalso(respostas: { status: number; corpo?: unknown; texto?: string }[]) {
  const pedidos: Pedido[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    const r = respostas.shift() ?? { status: 500, texto: "sem resposta preparada" };
    const texto = r.texto ?? (r.corpo === undefined ? "" : JSON.stringify(r.corpo));
    return new Response(texto, { status: r.status });
  }) as unknown as typeof fetch;
  return { fn, pedidos };
}

describe("codigoDoErro", () => {
  it("mapeia os status do ZapSign", () => {
    expect(codigoDoErro(401)).toBe("token_invalido");
    expect(codigoDoErro(403)).toBe("token_invalido");
    expect(codigoDoErro(402)).toBe("sem_plano");
    expect(codigoDoErro(404)).toBe("nao_encontrado");
    expect(codigoDoErro(429)).toBe("limite");
    expect(codigoDoErro(500)).toBe("zapsign_error");
  });
});

describe("semSegredo", () => {
  it("tira cada segredo; segredo curto demais não é trocado (evita apagar texto comum)", () => {
    expect(semSegredo(`erro com ${TOKEN} e sec-12345678`, TOKEN, "sec-12345678")).toBe("erro com «segredo» e «segredo»");
    expect(semSegredo("abc", "ab")).toBe("abc");
  });
});

describe("criarClienteZapSign", () => {
  it("token no cabeçalho Bearer, nunca na URL; só o host do ZapSign", async () => {
    const { fn, pedidos } = fetchFalso([{ status: 200, corpo: { count: 1, next: null, results: [{ token: "m1", name: "Contrato", active: true }] } }]);
    const pagina = await criarClienteZapSign(TOKEN, fn).modelos(1);
    expect(pagina).toEqual({
      modelos: [{ token: "m1", nome: "Contrato", ativo: true, tipo: null, criadoEm: null }],
      temMais: false,
      total: 1,
    });
    expect(pedidos[0].url).toBe("https://api.zapsign.com.br/api/v1/templates/?page=1");
    expect(pedidos[0].url).not.toContain(TOKEN);
    expect((pedidos[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(pedidos[0].init.redirect).toBe("manual");
  });

  it("a página seguinte é pelo NÚMERO, nunca pelo `next` da resposta", async () => {
    const { fn, pedidos } = fetchFalso([{ status: 200, corpo: { next: "http://evil.example/?page=2", results: [] } }]);
    const pagina = await criarClienteZapSign(TOKEN, fn).modelos(2);
    expect(pagina.temMais).toBe(true);
    expect(pedidos[0].url).toBe("https://api.zapsign.com.br/api/v1/templates/?page=2");
  });

  it("402 vira sem_plano, com o pedido na mensagem e o token apagado", async () => {
    const { fn } = fetchFalso([{ status: 402, corpo: { detail: `Plano de API necessário (${TOKEN})` } }]);
    const erro = await criarClienteZapSign(TOKEN, fn)
      .modelos(1)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ZapSignError);
    expect((erro as ZapSignError).codigo).toBe("sem_plano");
    expect((erro as ZapSignError).message).toContain("GET /templates/ → 402");
    expect((erro as ZapSignError).message).not.toContain(TOKEN);
  });

  it("falha de rede vira `rede`", async () => {
    const fn = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    const erro = await criarClienteZapSign(TOKEN, fn)
      .documento("doc-1234-5678")
      .catch((e: unknown) => e);
    expect((erro as ZapSignError).codigo).toBe("rede");
  });

  it("plano: 404 é `null` (plano não encontrado), o resto lança", async () => {
    const { fn } = fetchFalso([{ status: 404, texto: "Not found" }, { status: 200, corpo: { name: "API", status: "paid" } }]);
    const cliente = criarClienteZapSign(TOKEN, fn);
    expect(await cliente.plano()).toBeNull();
    expect(await cliente.plano()).toEqual({ nome: "API", status: "paid" });
  });

  it("criar webhook manda o cabeçalho de autenticação no corpo e devolve o id; o segredo não vaza no erro", async () => {
    const segredo = "segredo-do-webhook-123456";
    const { fn, pedidos } = fetchFalso([{ status: 200, corpo: { id: "w-1" } }, { status: 400, corpo: { detail: `inválido: ${segredo}` } }]);
    const cliente = criarClienteZapSign(TOKEN, fn, [segredo]);
    const args = { url: "https://crm.exemplo.com/api/cb/zapsign/webhook/abc", tipo: "doc_signed", cabecalho: { nome: "Authorization", valor: `Bearer ${segredo}` } };
    expect(await cliente.criarWebhook(args)).toEqual({ id: "w-1" });
    expect(JSON.parse(String(pedidos[0].init.body))).toEqual({
      url: args.url,
      type: "doc_signed",
      headers: [{ name: "Authorization", value: `Bearer ${segredo}` }],
    });
    const erro = await cliente.criarWebhook(args).catch((e: unknown) => e);
    expect((erro as Error).message).not.toContain(segredo);
  });

  it("apagar webhook aceita 200 com texto cru", async () => {
    const { fn, pedidos } = fetchFalso([{ status: 200, texto: "Webhook deletado com sucesso" }]);
    await criarClienteZapSign(TOKEN, fn).apagarWebhook("w-1");
    expect(pedidos[0].init.method).toBe("DELETE");
    expect(pedidos[0].url).toBe("https://api.zapsign.com.br/api/v1/user/company/webhook/delete/");
    expect(JSON.parse(String(pedidos[0].init.body))).toEqual({ id: "w-1" });
  });
});
