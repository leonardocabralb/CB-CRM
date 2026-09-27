import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarBanco, type Banco } from "@/lib/zapsign/duble.test-helper";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

// A rota pública do webhook do ZapSign (1057), com o dublê do Supabase: a
// ORDEM das respostas (404 → 401 → 200), a reentrega descartada pelo UNIQUE,
// o evento que não é `doc_signed`, o corpo ilegível e o processamento em
// after(). Credenciais de TESTE — nenhum token real do ZapSign.

let banco: Banco;
const processados: unknown[] = [];

vi.mock("@/lib/automations/admin-client", () => ({ supabaseAdmin: () => banco.cliente }));
vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => s.replace(/^cifrado:/, ""),
}));
vi.mock("@/lib/zapsign/processar", () => ({
  processarAssinatura: async (...args: unknown[]) => {
    processados.push(args);
    return { resultado: "disparado", detalhe: "1 automação(ões) executada(s)", contactId: "c1", casadoPor: "telefone" };
  },
}));
vi.mock("next/server", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, after: (fn: () => Promise<void>) => fn() };
});

const { POST } = await import("./route");

const CONTA = "conta-1";
const TOKEN_DA_URL = "url_0123456789abcdefghijklmnop";
const SEGREDO = "segredo_0123456789abcdefghijklmnopqrstuvwxyz";

function chamar(corpo: unknown, cabecalhos: Record<string, string> = {}, token = TOKEN_DA_URL) {
  const pedido = new Request(`https://crm.exemplo.com/api/cb/zapsign/webhook/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
  return POST(pedido, { params: Promise.resolve({ token }) });
}
const AUTH = { authorization: `Bearer ${SEGREDO}` };
const entrega = (signer = "sig-1", evento = "doc_signed") => ({
  event_type: evento,
  token: "doc-0001-aaaa-bbbb",
  name: "Contrato",
  status: "pending",
  signer_who_signed: { token: signer, name: "Maria" },
  answers: [
    { variable: "Nome completo", value: "Maria Cliente" },
    { variable: "CPF", value: "529.982.247-25" },
  ],
});

beforeEach(() => {
  __resetRateLimitForTests();
  processados.length = 0;
  banco = criarBanco({
    cb_zapsign_config: [{ account_id: CONTA, webhook_url_token: TOKEN_DA_URL, webhook_secret: `cifrado:${SEGREDO}`, webhook_estado: "ausente" }],
    cb_zapsign_eventos: [],
  });
});

describe("POST /api/cb/zapsign/webhook/[token]", () => {
  it("URL malformada ou desconhecida é 404; cabeçalho ausente ou errado é 401 — e nada é gravado", async () => {
    expect((await chamar(entrega(), AUTH, "curto")).status).toBe(404);
    expect((await chamar(entrega(), AUTH, "url_desconhecida_000000000000")).status).toBe(404);
    expect((await chamar(entrega())).status).toBe(401);
    expect((await chamar(entrega(), { authorization: "Bearer errado" })).status).toBe(401);
    expect((await chamar(entrega(), { authorization: SEGREDO })).status).toBe(401);
    expect(banco.tabelas.cb_zapsign_eventos).toEqual([]);
    expect(processados).toEqual([]);
  });

  it("entrega válida: 200, a linha gravada com as respostas SEM CPF, a prova de vida e o processamento", async () => {
    const res = await chamar(entrega(), AUTH);
    expect(res.status).toBe(200);
    const [linha] = banco.tabelas.cb_zapsign_eventos;
    expect(linha).toMatchObject({ account_id: CONTA, doc_token: "doc-0001-aaaa-bbbb", event_type: "doc_signed", signer_token: "sig-1" });
    expect(linha.variaveis).toEqual({ zapsign_resposta_nome_completo: "Maria Cliente" });
    expect(banco.tabelas.cb_zapsign_config[0].webhook_estado).toBe("ativo");
    expect(processados).toHaveLength(1);
    // O resultado foi gravado (o after() corre depois da resposta) e o cadeado solto.
    await new Promise((r) => setTimeout(r, 0));
    expect(banco.tabelas.cb_zapsign_eventos[0]).toMatchObject({ resultado: "disparado", processando_desde: null, contact_id: "c1" });
  });

  it("CRÍTICO: a reentrega da MESMA assinatura é descartada e não processa de novo", async () => {
    await chamar(entrega(), AUTH);
    const res = await chamar(entrega(), AUTH);
    expect(await res.json()).toEqual({ ok: true, duplicado: true });
    expect(banco.tabelas.cb_zapsign_eventos).toHaveLength(1);
    expect(processados).toHaveLength(1);
  });

  it("a assinatura de OUTRO signatário do mesmo documento é outra entrega", async () => {
    await chamar(entrega("sig-1"), AUTH);
    await chamar(entrega("sig-2"), AUTH);
    expect(banco.tabelas.cb_zapsign_eventos).toHaveLength(2);
  });

  it("outro evento e corpo ilegível respondem 200 sem gravar", async () => {
    expect((await chamar(entrega("sig-1", "doc_created"), AUTH)).status).toBe(200);
    expect((await chamar("{não é json", AUTH)).status).toBe(200);
    expect(banco.tabelas.cb_zapsign_eventos).toEqual([]);
  });

  it("falha do banco ao gravar é 500 (o ZapSign repete a entrega)", async () => {
    banco.falhar.add("cb_zapsign_eventos:upsert");
    expect((await chamar(entrega(), AUTH)).status).toBe(500);
    expect(processados).toEqual([]);
  });
});
