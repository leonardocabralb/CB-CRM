import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// "Processar de novo" roda uma automação que MANDA MENSAGEM e mexe no card.
// As guardas aqui existem para que ele nunca repita o que já rodou.
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    linha: null as Record<string, unknown> | null,
    erroBusca: null as { message: string } | null,
    processados: [] as unknown[],
    gravados: [] as unknown[],
    papel: "admin",
  },
}));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: h.state.linha, error: h.state.erroBusca }),
      };
      return b;
    },
  }),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async () => {
    if (h.state.papel !== "admin") throw new Error("forbidden");
    return { accountId: "acc-1", userId: "u-1" };
  },
  toErrorResponse: () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
}));

vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>();
  return { ...real, checkRateLimit: () => ({ success: true, limit: 1, remaining: 1, reset: 0 }) };
});

vi.mock("@/lib/calendly/processar", () => ({
  processarAgendamento: vi.fn(async (_db: unknown, accountId: string, agendamento: unknown, vars: unknown) => {
    h.state.processados.push({ accountId, agendamento, vars });
    return { resultado: "disparado", detalhe: "1 automação", contactId: "c1" };
  }),
  gravarResultado: vi.fn(async (_db: unknown, id: string, r: unknown) => void h.state.gravados.push({ id, r })),
}));

import { POST } from "./route";

const AGORA = "2026-09-08T12:00:00Z";
const linhaBase = (patch: Record<string, unknown> = {}) => ({
  id: "evt-1",
  evento: "invitee.created",
  invitee_uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
  event_type_uri: "https://api.calendly.com/event_types/T1",
  event_type_nome: "Reunião",
  nome: "Joel",
  email: null,
  telefone: "5519982764080",
  telefone_origem: "heuristica",
  inicio: "2026-09-09T19:00:00Z",
  fim: null,
  link: null,
  perguntas: [],
  variaveis: { agendamento_nome: "Joel", agendamento_cancelar: "https://calendly.com/cancelar/x" },
  resultado: "sem_contato",
  recebido_em: "2026-09-08T10:00:00Z",
  ...patch,
});

const chamar = async () => {
  const res = await POST(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id: "evt-1" }),
  });
  return { status: res.status, corpo: await res.json() };
};

beforeEach(() => {
  vi.setSystemTime(new Date(AGORA));
  h.state.linha = linhaBase();
  h.state.erroBusca = null;
  h.state.processados = [];
  h.state.gravados = [];
  h.state.papel = "admin";
});

describe("POST /api/cb/calendly/eventos/[id]/reprocessar", () => {
  it("roda de novo com as VARIÁVEIS gravadas e carimba o resultado", async () => {
    const r = await chamar();
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ ok: true, resultado: "disparado" });
    expect(h.state.processados[0]).toMatchObject({
      accountId: "acc-1",
      // 979: o link de cancelamento não tem coluna; só as vars gravadas o têm.
      vars: { agendamento_cancelar: "https://calendly.com/cancelar/x" },
    });
    expect(h.state.gravados[0]).toMatchObject({ id: "evt-1", r: { resultado: "disparado" } });
  });

  it("CRÍTICO: o que JÁ disparou não repete — mandaria a mesma mensagem outra vez", async () => {
    for (const resultado of ["disparado", "em_espera", "falhou", "sem_telefone"]) {
      h.state.linha = linhaBase({ resultado });
      const r = await chamar();
      expect(r.status, resultado).toBe(409);
      expect(r.corpo.error).toBe("ja_processado");
    }
    expect(h.state.processados).toHaveLength(0);
  });

  it("CRÍTICO: `recebido` recente ainda pode estar rodando no after() — recusa", async () => {
    h.state.linha = linhaBase({ resultado: "recebido", recebido_em: "2026-09-08T11:59:30Z" });
    const r = await chamar();
    expect(r.status).toBe(409);
    expect(r.corpo.error).toBe("ainda_processando");
    expect(h.state.processados).toHaveLength(0);
  });

  it("`recebido` antigo é processamento que morreu no meio — repete", async () => {
    h.state.linha = linhaBase({ resultado: "recebido", recebido_em: "2026-09-08T11:00:00Z" });
    expect((await chamar()).status).toBe(200);
  });

  it("data de chegada ilegível conta como recente — não repetir no escuro", async () => {
    h.state.linha = linhaBase({ resultado: "recebido", recebido_em: "não é data" });
    expect((await chamar()).corpo.error).toBe("ainda_processando");
  });

  it("erro de banco NÃO é 404 — senão o operador conclui que o agendamento sumiu", async () => {
    h.state.linha = null;
    h.state.erroBusca = { message: "timeout" };
    expect((await chamar()).status).toBe(500);

    h.state.erroBusca = null;
    expect((await chamar()).status).toBe(404);
  });

  it("linha sem invitee é recusada antes de chamar o motor", async () => {
    h.state.linha = linhaBase({ invitee_uri: null });
    expect((await chamar()).status).toBe(422);
    expect(h.state.processados).toHaveLength(0);
  });

  it("só admin", async () => {
    h.state.papel = "agent";
    expect((await chamar()).status).toBe(403);
  });
});
