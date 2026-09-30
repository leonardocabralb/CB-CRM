import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarBanco, type Banco } from "@/lib/zapsign/duble.test-helper";

// ============================================================
// GET /api/cb/atlas/contato/[contactId]: qualquer membro, só banco, com as
// cercas de conta, AMBIENTE e escritório; erro de leitura é 500, nunca
// "sem vínculo". Dados fictícios.
// ============================================================

const h = vi.hoisted(() => ({ banco: null as unknown as Banco, conta: "conta-1", ambiente: null as string | null }));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: vi.fn(async () => ({ accountId: h.conta, userId: "u1", role: "viewer" })),
  toErrorResponse: () => ({ body: { error: "x" }, status: 500 }),
}));
vi.mock("@/lib/automations/admin-client", () => ({ supabaseAdmin: () => h.banco.cliente }));
vi.mock("@/lib/atlas/enderecos", async (original) => ({
  ...(await original<typeof import("@/lib/atlas/enderecos")>()),
  ambienteDoAtlas: () => h.ambiente,
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

import { __resetRateLimitForTests } from "@/lib/rate-limit";

import { GET } from "./route";

const FICHA = "0b7b6a2e-3c3f-4a3e-9d6c-2f1e0a9b8c7d";
const CLIENTE = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const STAGING = "https://staging.example.com/functions/v1/client-webhook";
type Resposta = { status: number; body: Record<string, unknown> };
const pedir = async (contactId = FICHA) => (await GET(new Request("http://x"), { params: Promise.resolve({ contactId }) })) as unknown as Resposta;

beforeEach(() => {
  __resetRateLimitForTests();
  h.conta = "conta-1";
  h.ambiente = null;
  h.banco = criarBanco({
    cb_atlas_config: [{ account_id: "conta-1", api_url: null, api_key: "segredo", atlas_tenant_id: "t1", last_sync_at: null, situacoes_lidas_ate: null, sync_erro: null }],
    cb_atlas_clientes: [
      { account_id: "conta-1", api_url: null, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: CLIENTE, app_url: `https://app.example.com/#/clients/${CLIENTE}`, situacao: "rescindido", situacao_desde: null, situacao_lida_em: new Date().toISOString(), origem: "manual", casou_por: null, excluido_no_atlas_em: null },
    ],
  });
});

describe("GET /api/cb/atlas/contato/[contactId]", () => {
  it("qualquer membro lê o vínculo da ficha (nunca a chave)", async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ conectado: true, erroDaLeitura: null, vinculo: { atlasClientId: CLIENTE, situacao: "rescindido", origem: "manual", velha: false } });
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });

  it("id que não é uuid: 404 sem ler nada", async () => {
    h.banco.falhar.add("cb_atlas_config:select");
    expect((await pedir("nao-e-uuid")).status).toBe(404);
  });

  it("sem conexão: conectado false (a aba some)", async () => {
    h.banco.tabelas.cb_atlas_config = [];
    expect((await pedir()).body).toEqual({ conectado: false, vinculo: null, erroDaLeitura: null });
  });

  it("⚠️ AMBIENTE: a instância do staging não vê a conexão nem o vínculo da produção", async () => {
    h.ambiente = STAGING;
    expect((await pedir()).body).toEqual({ conectado: false, vinculo: null, erroDaLeitura: null });
    h.banco.tabelas.cb_atlas_config[0].api_url = STAGING;
    expect((await pedir()).body).toEqual({ conectado: true, vinculo: null, erroDaLeitura: null });
  });

  it("⚠️ ESCRITÓRIO e CONTA: o vínculo de outro escritório e o de outra conta não aparecem", async () => {
    h.banco.tabelas.cb_atlas_clientes[0].atlas_tenant_id = "t-antigo";
    expect((await pedir()).body.vinculo).toBeNull();
    h.banco.tabelas.cb_atlas_clientes[0].atlas_tenant_id = "t1";
    h.banco.tabelas.cb_atlas_clientes[0].account_id = "conta-2";
    expect((await pedir()).body.vinculo).toBeNull();
  });

  it("⚠️ LIMITE: o fio e o painel leem juntos a cada troca — 31 leituras seguidas passam (o `execucao`, 30/min, cortava na 31ª)", async () => {
    for (let i = 0; i < 31; i++) expect((await pedir()).status).toBe(200);
  });

  it("o balde é por usuário, com teto: a 121ª leitura no minuto é 429", async () => {
    for (let i = 0; i < 120; i++) expect((await pedir()).status).toBe(200);
    expect((await pedir()).status).toBe(429);
  });

  it("erro de leitura é 500 — nunca 'sem vínculo' nem 'desconectado'", async () => {
    h.banco.falhar.add("cb_atlas_clientes:select");
    expect(await pedir()).toEqual({ status: 500, body: { error: "db_error" } });
    h.banco.falhar.clear();
    h.banco.falhar.add("cb_atlas_config:select");
    expect(await pedir()).toEqual({ status: 500, body: { error: "db_error" } });
  });
});
