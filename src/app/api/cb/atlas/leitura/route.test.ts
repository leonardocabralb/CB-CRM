import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// "Ler situações agora" (cartão Atlas): só admin, só a conta de quem clicou,
// com um balde POR CONTA (a cota do Atlas é do escritório) — fora do
// `rate-limit.ts`, que é do upstream. Depois da leitura, o disparo das
// mudanças de situação (Fase 4, 1073) no MESMO prazo.
// ============================================================

const h = vi.hoisted(() => ({
  papel: "admin" as string,
  conta: "conta-1",
  usuario: "u1",
  chamadas: [] as { accountId: string; opcoes: Record<string, unknown> }[],
  resultado: { ok: true, contagem: { clientes: 3 } } as Record<string, unknown>,
  disparos: [] as { accountId: string; opcoes: Record<string, unknown> }[],
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: vi.fn(async (min: string) => {
    if (min !== "admin") throw new Error(`papel mínimo inesperado: ${min}`);
    if (h.papel !== "admin") throw Object.assign(new Error("forbidden"), { status: 403 });
    return { accountId: h.conta, userId: h.usuario };
  }),
  toErrorResponse: (e: { status?: number }) => ({ body: { error: "forbidden" }, status: e.status ?? 500 }),
}));
vi.mock("@/lib/automations/admin-client", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/lib/atlas/situacoes", () => ({
  sincronizarSituacoes: vi.fn(async (_admin: unknown, accountId: string, opcoes: Record<string, unknown>) => {
    h.chamadas.push({ accountId, opcoes });
    return h.resultado;
  }),
}));
vi.mock("@/lib/atlas/mudancas", () => ({
  dispararMudancas: vi.fn(async (_admin: unknown, accountId: string, opcoes: Record<string, unknown>) => {
    h.disparos.push({ accountId, opcoes });
    return { ok: true, contagem: { reivindicadas: 1, recolhidas: 0, devolvidas: 0, porResultado: { disparado: 1 } } };
  }),
}));
vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

import { __resetRateLimitForTests } from "@/lib/rate-limit";

import { POST } from "./route";

const pedido = (corpo: unknown = {}) => ({ json: async () => corpo }) as unknown as Request;
type Resposta = { status: number; body: Record<string, unknown> };

beforeEach(() => {
  __resetRateLimitForTests();
  h.papel = "admin";
  h.conta = "conta-1";
  h.usuario = "u1";
  h.chamadas = [];
  h.disparos = [];
  h.resultado = { ok: true, contagem: { clientes: 3 } };
});

describe("POST /api/cb/atlas/leitura", () => {
  it("roda a leitura SÓ da conta de quem clicou, com prazo curto; `completa` recomeça a listagem", async () => {
    const antes = Date.now();
    const r = (await POST(pedido({ completa: true }))) as unknown as Resposta;
    const disparo = { reivindicadas: 1, recolhidas: 0, devolvidas: 0, porResultado: { disparado: 1 } };
    expect(r).toEqual({ status: 200, body: { ok: true, contagem: { clientes: 3 }, disparo } });
    expect(h.chamadas).toHaveLength(1);
    expect(h.chamadas[0].accountId).toBe("conta-1");
    expect(h.chamadas[0].opcoes.forcarCompleta).toBe(true);
    const prazo = h.chamadas[0].opcoes.prazoMs as number;
    expect(prazo - antes).toBeGreaterThan(30_000);
    expect(prazo - antes).toBeLessThanOrEqual(60_000);
    await POST(pedido({ completa: "sim" }));
    expect(h.chamadas[1].opcoes.forcarCompleta).toBe(false);
  });

  it("Fase 4: depois da leitura, dispara as mudanças da MESMA conta no MESMO prazo; sem conexão, não", async () => {
    await POST(pedido());
    expect(h.disparos).toHaveLength(1);
    expect(h.disparos[0].accountId).toBe("conta-1");
    expect(h.disparos[0].opcoes.prazoMs).toBe(h.chamadas[0].opcoes.prazoMs);
    // A leitura que falhou (em curso, Atlas fora) não impede o disparo do que já está na fila.
    h.resultado = { ok: false, codigo: "em_curso" };
    await POST(pedido());
    expect(h.disparos).toHaveLength(2);
    __resetRateLimitForTests();
    h.resultado = { ok: false, codigo: "nao_conectado" };
    await POST(pedido());
    expect(h.disparos).toHaveLength(2);
  });

  it("não-admin é recusado sem ler nada", async () => {
    h.papel = "agent";
    const r = (await POST(pedido())) as unknown as Resposta;
    expect(r.status).toBe(403);
    expect(h.chamadas).toHaveLength(0);
  });

  it("o balde é POR CONTA: dois admins da mesma conta dividem os 2 por minuto", async () => {
    expect(((await POST(pedido())) as unknown as Resposta).status).toBe(200);
    h.usuario = "u2";
    expect(((await POST(pedido())) as unknown as Resposta).status).toBe(200);
    h.usuario = "u3";
    expect(((await POST(pedido())) as unknown as Resposta).status).toBe(429);
    expect(h.chamadas).toHaveLength(2);
    // Outra conta não é afetada.
    h.conta = "conta-2";
    expect(((await POST(pedido())) as unknown as Resposta).status).toBe(200);
  });

  it("os códigos viram status: em curso e sem conexão 409, limite do Atlas 429, banco 500, Atlas 502", async () => {
    const casos: [string, number][] = [
      ["em_curso", 409],
      ["nao_conectado", 409],
      ["limite", 429],
      ["db_error", 500],
      ["fora_do_ar", 502],
      ["sem_permissao_listar", 502],
    ];
    for (const [codigo, status] of casos) {
      __resetRateLimitForTests();
      h.resultado = { ok: false, codigo };
      expect((await POST(pedido())) as unknown as Resposta).toEqual({ status, body: { error: codigo } });
    }
  });
});
