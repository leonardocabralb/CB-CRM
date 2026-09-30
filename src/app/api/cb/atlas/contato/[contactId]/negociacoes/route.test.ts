import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// GET /api/cb/atlas/contato/[contactId]/negociacoes (Fase 3): a tabela de
// códigos, os dois baldes (por usuário e POR CONTA), o vínculo pelo
// ambiente e pelo escritório, e `read_negotiations` desligada SEM marcar a
// conexão. Tudo fictício: nenhuma chamada real ao Atlas nem ao Supabase.
// ============================================================

const FICHA = "00000000-0000-4000-8000-0000000000c1";
const CLIENTE = "00000000-0000-4000-8000-000000000011";

const h = vi.hoisted(() => ({
  conta: "conta-1",
  usuario: "u1",
  chave: { ok: true, chave: "sk_teste_0000000000000000000000000000", tenantId: "t1" } as Record<string, unknown>,
  vinculo: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
  filtros: [] as [string, string, unknown][],
  conferencias: [] as (string | null)[],
  pedidosAoAtlas: [] as string[],
  atlas: null as (() => Promise<unknown>) | null,
  logs: [] as string[],
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: vi.fn(async () => ({ accountId: h.conta, userId: h.usuario })),
  toErrorResponse: (e: { status?: number }) => ({ body: { error: "erro" }, status: e.status ?? 500 }),
}));

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      const q = {
        select: () => q,
        eq: (coluna: string, valor: unknown) => (h.filtros.push([tabela, `eq:${coluna}`, valor]), q),
        is: (coluna: string, valor: unknown) => (h.filtros.push([tabela, `is:${coluna}`, valor]), q),
        maybeSingle: async () => h.vinculo,
      };
      return q;
    },
  }),
}));

vi.mock("@/lib/atlas/conexao", () => ({
  lerChaveDoAtlas: vi.fn(async () => h.chave),
  registrarConferencia: vi.fn(async (_admin: unknown, _conta: string, codigo: string | null) => {
    h.conferencias.push(codigo);
  }),
}));

vi.mock("@/lib/atlas/cliente", async (original) => {
  const real = await original<typeof import("@/lib/atlas/cliente")>();
  return {
    ...real,
    criarClienteAtlas: () => ({
      negociacoes: async (id: string) => {
        h.pedidosAoAtlas.push(id);
        return h.atlas!();
      },
    }),
  };
});

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

import { AtlasError } from "@/lib/atlas/cliente";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

import { GET } from "./route";

type Resposta = { status: number; body: Record<string, unknown> };
const pedir = async (contactId: string = FICHA) =>
  (await GET(new Request("http://localhost/x"), { params: Promise.resolve({ contactId }) })) as unknown as Resposta;

const NEGOCIACAO = { truncated: false, totals: { banks: 1, contracts: 0, proposals: 0 }, banks: [{ id: "b1", bank_name: "Banco Exemplo", original_debt: 10, updated_debt: 12, contracts: [], proposals: [] }] };

beforeEach(() => {
  __resetRateLimitForTests();
  h.conta = "conta-1";
  h.usuario = "u1";
  h.chave = { ok: true, chave: "sk_teste_0000000000000000000000000000", tenantId: "t1" };
  h.vinculo = { data: { atlas_client_id: CLIENTE, atlas_tenant_id: "t1" }, error: null };
  h.filtros = [];
  h.conferencias = [];
  h.pedidosAoAtlas = [];
  h.atlas = async () => NEGOCIACAO;
  h.logs = [];
  vi.spyOn(console, "info").mockImplementation((m: string) => void h.logs.push(String(m)));
  vi.spyOn(console, "warn").mockImplementation((m: string) => void h.logs.push(String(m)));
  vi.spyOn(console, "error").mockImplementation((m: string) => void h.logs.push(String(m)));
});

describe("GET /api/cb/atlas/contato/[contactId]/negociacoes", () => {
  it("sucesso: lê o vínculo DESTE ambiente e da conta, pede ao Atlas UMA vez e limpa só os códigos da chave", async () => {
    const r = await pedir();
    expect(r).toEqual({ status: 200, body: NEGOCIACAO });
    expect(h.pedidosAoAtlas).toEqual([CLIENTE]);
    expect(h.filtros).toEqual(
      expect.arrayContaining([
        ["cb_atlas_clientes", "eq:account_id", "conta-1"],
        ["cb_atlas_clientes", "eq:contact_id", FICHA],
        // a cerca de ambiente (nulo = o Atlas de verdade)
        ["cb_atlas_clientes", "is:api_url", null],
      ]),
    );
    expect(h.conferencias).toEqual([null]);
  });

  it("o log leva só contagens — nunca valor nem nome de banco", async () => {
    await pedir();
    const log = h.logs.join("\n");
    expect(log).toContain("1 bancos, 0 contratos, 0 propostas");
    expect(log).not.toContain("Banco Exemplo");
    expect(log).not.toContain("12");
  });

  it("sem vínculo, ou vínculo de OUTRO escritório: 404 `sem_vinculo`, sem chamar o Atlas", async () => {
    h.vinculo = { data: null, error: null };
    expect(await pedir()).toEqual({ status: 404, body: { error: "sem_vinculo" } });
    h.vinculo = { data: { atlas_client_id: CLIENTE, atlas_tenant_id: "outro" }, error: null };
    expect(await pedir()).toEqual({ status: 404, body: { error: "sem_vinculo" } });
    expect(await pedir("nao-e-uuid")).toEqual({ status: 404, body: { error: "sem_vinculo" } });
    expect(h.pedidosAoAtlas).toEqual([]);
  });

  it("erro do banco no vínculo é 500 (nunca 'sem vínculo')", async () => {
    h.vinculo = { data: null, error: { message: "timeout" } };
    expect(await pedir()).toEqual({ status: 500, body: { error: "db_error" } });
  });

  it("sem conexão (ou de outro ambiente): 409 `nao_conectado`; chave ilegível 409 sem marcar; banco 500", async () => {
    h.chave = { ok: false, codigo: "nao_conectado" };
    expect(await pedir()).toEqual({ status: 409, body: { error: "nao_conectado" } });
    h.chave = { ok: false, codigo: "outro_ambiente" };
    expect(await pedir()).toEqual({ status: 409, body: { error: "nao_conectado" } });
    h.chave = { ok: false, codigo: "chave_ilegivel" };
    expect(await pedir()).toEqual({ status: 409, body: { error: "chave_ilegivel" } });
    h.chave = { ok: false, codigo: "db_error" };
    expect(await pedir()).toEqual({ status: 500, body: { error: "db_error" } });
    expect(h.conferencias).toEqual([]);
    expect(h.pedidosAoAtlas).toEqual([]);
  });

  it("CRÍTICO: `read_negotiations` desligada é 403 SEM marcar a conexão (a permissão é opcional)", async () => {
    h.atlas = async () => {
      throw new AtlasError("sem_permissao", "x", 403, "read_negotiations");
    };
    expect(await pedir()).toEqual({ status: 403, body: { error: "sem_permissao", permissao: "read_negotiations" } });
    expect(h.conferencias).toEqual([]);
  });

  it("`sem_permissao` de `read_client` (obrigatória) marca a conexão", async () => {
    h.atlas = async () => {
      throw new AtlasError("sem_permissao", "x", 403, "read_client");
    };
    expect(await pedir()).toEqual({ status: 403, body: { error: "sem_permissao", permissao: "read_client" } });
    expect(h.conferencias).toEqual(["sem_permissao"]);
  });

  it("a tabela de códigos do Atlas", async () => {
    const casos: [AtlasError, number, Record<string, unknown>, (string | null)[]][] = [
      [new AtlasError("nao_encontrado", "x", 404), 404, { error: "nao_encontrado" }, []],
      [new AtlasError("limite", "x", 429, null, { esperaSegundos: 17 }), 429, { error: "limite", retryAfter: 17 }, []],
      [new AtlasError("limite", "x", 429), 429, { error: "limite", retryAfter: null }, []],
      [new AtlasError("fora_do_ar", "x", 503), 502, { error: "indisponivel" }, []],
      [new AtlasError("rede", "x"), 502, { error: "indisponivel" }, []],
      [new AtlasError("resposta_inesperada", "x", 200), 502, { error: "indisponivel" }, []],
      // Sem estado próprio: antes da promoção a API nem conecta (409 `nao_conectado`).
      [new AtlasError("acao_desconhecida", "x", 400), 502, { error: "indisponivel" }, []],
      [new AtlasError("atlas_error", "Unknown Action", 400), 502, { error: "indisponivel" }, []],
      [new AtlasError("chave_invalida", "x", 403), 409, { error: "chave_invalida" }, ["chave_invalida"]],
      [new AtlasError("api_fora_do_plano", "x", 403), 409, { error: "api_fora_do_plano" }, ["api_fora_do_plano"]],
    ];
    for (const [erro, status, body, conferencias] of casos) {
      __resetRateLimitForTests();
      h.conferencias = [];
      h.atlas = async () => {
        throw erro;
      };
      expect(await pedir(), erro.codigo).toEqual({ status, body });
      expect(h.conferencias, erro.codigo).toEqual(conferencias);
    }
  });

  it("o `not_found` (lixeira) nunca mexe no vínculo: a rota nem escreve no banco", async () => {
    h.atlas = async () => {
      throw new AtlasError("nao_encontrado", "x", 404);
    };
    await pedir();
    // O dublê não tem update/delete/insert: qualquer escrita estouraria em 500.
    expect(h.conferencias).toEqual([]);
  });

  it("erro que não é do Atlas (bug) é 500, nunca `{}`", async () => {
    h.atlas = async () => {
      throw new Error("inesperado");
    };
    expect(await pedir()).toEqual({ status: 500, body: { error: "db_error" } });
  });

  it("o balde por USUÁRIO: 20 por minuto, somando as contas (só ele explica o 429)", async () => {
    // O mesmo login em DUAS contas, 10 em cada: nenhuma conta chega aos 20 do
    // balde dela — o 21º só pode ser recusado pelo balde do usuário.
    for (let i = 0; i < 20; i++) {
      h.conta = i % 2 === 0 ? "conta-1" : "conta-2";
      expect((await pedir()).status).toBe(200);
    }
    h.conta = "conta-1";
    expect((await pedir()).status).toBe(429);
    expect(h.pedidosAoAtlas).toHaveLength(20);
    // Outro usuário na mesma conta segue lendo (a conta-1 está em 10).
    h.usuario = "u2";
    expect((await pedir()).status).toBe(200);
  });

  it("o balde POR CONTA: a equipe inteira divide os 20 por minuto; outra conta não é afetada", async () => {
    for (let i = 0; i < 20; i++) {
      h.usuario = `u${i}`;
      expect((await pedir()).status).toBe(200);
    }
    h.usuario = "u-novo";
    expect((await pedir()).status).toBe(429);
    expect(h.pedidosAoAtlas).toHaveLength(20);
    h.conta = "conta-2";
    expect((await pedir()).status).toBe(200);
  });
});
