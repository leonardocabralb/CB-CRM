import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// A rota do Asaas CARREGA a leitura das situações do Atlas (Fase 2), num
// `after()` — sem rota nova no laço lento (que exigiria `docker stack
// deploy`). O que se cobra aqui:
// - o LUGAR: logo depois das duas saídas da autenticação, antes de qualquer
//   outro `return` (a leitura das contas do Asaas que falha não cala o Atlas);
// - a FORMA: callback (o ciclo só começa depois da resposta), nunca a
//   promessa já começada;
// - sem o segredo, nada roda.
// ============================================================

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  afters: [] as unknown[],
  contas: { data: [] as unknown[], error: null as { message: string } | null },
  atlas: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: (tarefa: unknown) => {
    h.ordem.push("after");
    h.afters.push(tarefa);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));
vi.mock("@/lib/atlas/situacoes", () => ({ rodarCicloDoAtlas: h.atlas }));
vi.mock("@/lib/asaas/sincronizar", () => ({ sincronizarAsaas: vi.fn() }));
vi.mock("@/lib/asaas/varrer-regua", () => ({ varrerRegua: vi.fn() }));
vi.mock("@/lib/asaas/webhook", () => ({ origemPublica: () => "https://crm.example.com" }));
vi.mock("@/lib/asaas/webhook-asaas", () => ({ cuidarDoWebhook: vi.fn() }));
vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => {
    h.ordem.push("admin");
    const cadeia = {
      select: () => cadeia,
      order: () => cadeia,
      range: async () => h.contas,
    };
    return { from: () => cadeia };
  },
}));

import { GET } from "./route";

const SEGREDO = "segredo-do-cron";
const pedido = (segredo: string | null = SEGREDO) => ({ headers: { get: () => segredo } }) as unknown as Request;

beforeEach(() => {
  vi.stubEnv("AUTOMATION_CRON_SECRET", SEGREDO);
  h.ordem = [];
  h.afters = [];
  h.contas = { data: [], error: null };
  h.atlas.mockReset();
  h.atlas.mockImplementation(async () => {
    h.ordem.push("atlas");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron do Asaas: a leitura do Atlas no after()", () => {
  it("é agendada como CALLBACK, antes do resto do ciclo — e só começa quando o after roda", async () => {
    const r = (await GET(pedido())) as unknown as { status: number };
    expect(r.status).toBe(200);
    expect(h.ordem).toEqual(["after", "admin"]);
    expect(h.afters).toHaveLength(1);
    expect(typeof h.afters[0]).toBe("function");
    // Ainda não começou: a forma de callback espera a resposta sair.
    expect(h.atlas).not.toHaveBeenCalled();
    await (h.afters[0] as () => Promise<void>)();
    expect(h.atlas).toHaveBeenCalledTimes(1);
  });

  it("a leitura das contas do Asaas que FALHA (o outro `return`) não cala o Atlas", async () => {
    h.contas = { data: [], error: { message: "banco fora" } };
    const r = (await GET(pedido())) as unknown as { status: number };
    expect(r.status).toBe(500);
    expect(h.afters).toHaveLength(1);
  });

  it("sem o segredo certo, nada roda — nem o Atlas", async () => {
    const r = (await GET(pedido("errado"))) as unknown as { status: number };
    expect(r.status).toBe(401);
    expect(h.afters).toEqual([]);
    vi.stubEnv("AUTOMATION_CRON_SECRET", "");
    expect(((await GET(pedido())) as unknown as { status: number }).status).toBe(503);
    expect(h.afters).toEqual([]);
  });
});

describe("o LUGAR do Atlas no fonte", () => {
  const fonte = fs
    .readFileSync(path.join(__dirname, "route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("só as duas saídas da autenticação vêm antes de `after(() => rodarCicloDoAtlas())`, e antes de `supabaseAdmin()`", () => {
    const atlas = fonte.indexOf("after(() => rodarCicloDoAtlas())");
    expect(atlas).toBeGreaterThan(-1);
    const antes = fonte.slice(0, atlas);
    expect(antes.match(/\breturn\b/g) ?? []).toHaveLength(2);
    expect(antes).toContain('"cron not configured"');
    expect(antes).toContain('"Unauthorized"');
    expect(antes).not.toContain("supabaseAdmin()");
  });

  it("nunca a promessa já começada (`after(rodarCicloDoAtlas())`)", () => {
    expect(fonte).not.toMatch(/after\(\s*rodarCicloDoAtlas\(\)\s*\)/);
  });
});
