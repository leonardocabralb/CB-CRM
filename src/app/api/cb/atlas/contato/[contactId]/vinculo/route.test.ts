import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// PUT /api/cb/atlas/contato/[contactId]/vinculo: SÓ administradores
// (decisão do operador, 30/09/2026) — o vínculo manda no passo "Criar
// cliente" e no card. O código da regra vira status, e o corpo leva sempre
// o código (a aba o traduz). A regra em si: `src/lib/atlas/vinculo.test.ts`.
// ============================================================

const h = vi.hoisted(() => ({
  papel: "admin" as string,
  chamadas: [] as { acao: string; entrada: Record<string, unknown> }[],
  resultado: { ok: true, jaEstava: false } as Record<string, unknown>,
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (min !== "admin") throw new Error(`papel mínimo inesperado: ${min}`);
    if (h.papel !== "admin") throw Object.assign(new Error("forbidden"), { status: 403 });
    return { accountId: "conta-1", userId: "u1" };
  }),
  toErrorResponse: (e: { status?: number }) => ({ body: { error: "forbidden" }, status: e.status ?? 500 }),
}));
vi.mock("@/lib/automations/admin-client", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/lib/atlas/vinculo", () => ({
  ligarVinculo: vi.fn(async (_a: unknown, entrada: Record<string, unknown>) => (h.chamadas.push({ acao: "ligar", entrada }), h.resultado)),
  desligarVinculo: vi.fn(async (_a: unknown, entrada: Record<string, unknown>) => (h.chamadas.push({ acao: "desligar", entrada }), h.resultado)),
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

import { ERROS_DO_VINCULO } from "@/lib/atlas/do-contato";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

import { PUT } from "./route";

const FICHA = "0b7b6a2e-3c3f-4a3e-9d6c-2f1e0a9b8c7d";
type Resposta = { status: number; body: Record<string, unknown> };
const pedir = async (corpo: unknown, contactId = FICHA) =>
  (await PUT({ json: async () => corpo } as unknown as Request, { params: Promise.resolve({ contactId }) })) as unknown as Resposta;

beforeEach(() => {
  __resetRateLimitForTests();
  h.papel = "admin";
  h.chamadas = [];
  h.resultado = { ok: true, jaEstava: false };
});

describe("PUT /api/cb/atlas/contato/[contactId]/vinculo", () => {
  it("ligar: a conta e o usuário da SESSÃO, o link como veio (a regra tira o id)", async () => {
    expect(await pedir({ acao: "ligar", link: "https://app.example.com/#/clients/x" })).toEqual({ status: 200, body: { ok: true, jaEstava: false } });
    expect(h.chamadas).toEqual([{ acao: "ligar", entrada: { accountId: "conta-1", contactId: FICHA, userId: "u1", link: "https://app.example.com/#/clients/x" } }]);
  });

  it("desligar", async () => {
    expect((await pedir({ acao: "desligar" })).status).toBe(200);
    expect(h.chamadas).toEqual([{ acao: "desligar", entrada: { accountId: "conta-1", contactId: FICHA, userId: "u1" } }]);
  });

  it("⚠️ só admin: o agente é recusado sem tocar em nada", async () => {
    h.papel = "agent";
    expect((await pedir({ acao: "ligar", link: "x" })).status).toBe(403);
    expect(h.chamadas).toHaveLength(0);
  });

  it("ação desconhecida: 400; contato que não é uuid: 404 — sem tocar em nada", async () => {
    expect((await pedir({ acao: "apagar" })).status).toBe(400);
    expect((await pedir(null)).status).toBe(400);
    expect((await pedir({ acao: "ligar", link: "x" }, "nao-e-uuid")).status).toBe(404);
    expect(h.chamadas).toHaveLength(0);
  });

  it("cada código vira o status certo, com o código no corpo", async () => {
    const esperado: Record<string, number> = {
      link_invalido: 400,
      contato_nao_encontrado: 404,
      nao_encontrado: 404,
      sem_vinculo: 404,
      ja_vinculado: 409,
      ligado_a_outra_ficha: 409,
      outro_escritorio: 409,
      nao_conectado: 409,
      sem_permissao: 409,
      limite: 429,
      indisponivel: 502,
      db_error: 500,
    };
    for (const codigo of ERROS_DO_VINCULO) {
      __resetRateLimitForTests();
      h.resultado = { ok: false, codigo };
      const r = await pedir({ acao: "ligar", link: "x" });
      expect(r.body).toEqual({ error: codigo });
      if (codigo in esperado) expect(r.status, codigo).toBe(esperado[codigo]);
      else expect(r.status, codigo).toBeGreaterThanOrEqual(400);
    }
  });
});
