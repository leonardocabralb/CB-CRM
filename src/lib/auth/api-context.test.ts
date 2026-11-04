import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateApiKey } from "@/lib/api-keys/keys";
import type { ApiKeyRow } from "@/lib/api-keys/store";
import { ApiError } from "@/lib/api/v1/respond";
import { __resetRateLimitForTests, RATE_LIMITS } from "@/lib/rate-limit";

// Mock the service-role client factory — requireApiKey only stashes
// the returned client in the context; tests never call through it.
vi.mock("@/lib/api/v1/cliente-da-api", () => ({
  clienteDaApi: () => ({ __isMockClienteDaApi: true }),
}));

// Mock the store so we control which row a hash resolves to.
const findActiveKeyByHash = vi.fn<(hash: string) => Promise<ApiKeyRow | null>>();
const touchLastUsed = vi.fn();
const funcionarioAtivoNaConta =
  vi.fn<(userId: string, accountId: string) => Promise<boolean>>();
vi.mock("@/lib/api-keys/store", () => ({
  findActiveKeyByHash: (hash: string) => findActiveKeyByHash(hash),
  touchLastUsed: (id: string) => touchLastUsed(id),
  funcionarioAtivoNaConta: (userId: string, accountId: string) =>
    funcionarioAtivoNaConta(userId, accountId),
}));

// Import AFTER the mocks are registered.
const { requireApiKey } = await import("./api-context");

const KEY = generateApiKey().plaintext;

function reqWith(authHeader?: string): Request {
  return new Request("https://crm.example.com/api/v1/me", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function row(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: "key-1",
    account_id: "acct-1",
    created_by: "user-1",
    name: "Test key",
    scopes: ["messages:send"],
    expires_at: null,
    revoked_at: null,
    membro_user_id: null,
    funis: null,
    ...overrides,
  };
}

beforeEach(() => {
  __resetRateLimitForTests();
  findActiveKeyByHash.mockReset();
  touchLastUsed.mockReset();
  funcionarioAtivoNaConta.mockReset();
});

afterEach(() => {
  __resetRateLimitForTests();
});

async function expectApiError(p: Promise<unknown>, code: string, status: number) {
  await expect(p).rejects.toBeInstanceOf(ApiError);
  await p.catch((e: unknown) => {
    const err = e as ApiError;
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
  });
}

describe("requireApiKey", () => {
  it("401s when no Authorization header is present", async () => {
    await expectApiError(requireApiKey(reqWith()), "unauthorized", 401);
    expect(findActiveKeyByHash).not.toHaveBeenCalled();
  });

  it("401s on a token that doesn't look like a wacrm key", async () => {
    await expectApiError(
      requireApiKey(reqWith("Bearer some-invite-token")),
      "unauthorized",
      401,
    );
    expect(findActiveKeyByHash).not.toHaveBeenCalled();
  });

  it("401s when the key is unknown / revoked / expired (store returns null)", async () => {
    findActiveKeyByHash.mockResolvedValue(null);
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "unauthorized",
      401,
    );
  });

  // NOSSO: a leitura da chave que FALHA (o banco) não é chave inválida. Com
  // 401, o integrador concluía "revogada" e trocava a chave ou desligava a
  // integração por um soluço que passa sozinho.
  it("500s — never 401 — when the key lookup itself fails", async () => {
    findActiveKeyByHash.mockRejectedValue(new Error("API key lookup failed"));
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "internal",
      500,
    );
    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  it("returns a context for a valid key with no scope required", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`));
    expect(ctx.authType).toBe("api_key");
    expect(ctx.accountId).toBe("acct-1");
    expect(ctx.keyId).toBe("key-1");
    expect(ctx.scopes).toEqual(["messages:send"]);
    expect(touchLastUsed).toHaveBeenCalledWith("key-1");
    // O cliente PRÓPRIO da API (marca a origem `api`), não o admin compartilhado.
    expect(ctx.supabase).toEqual({ __isMockClienteDaApi: true });
  });

  it("accepts a bare key without the 'Bearer ' prefix", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(KEY));
    expect(ctx.accountId).toBe("acct-1");
  });

  it("403s when the key lacks the required scope", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ scopes: ["contacts:read"] }));
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send"),
      "forbidden",
      403,
    );
  });

  it("passes when the key has the required scope", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ scopes: ["messages:send"] }));
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send");
    expect(ctx.accountId).toBe("acct-1");
  });

  it("429s once the per-key budget is exhausted", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    // Burn the whole window.
    for (let i = 0; i < RATE_LIMITS.publicApi.limit; i++) {
      await requireApiKey(reqWith(`Bearer ${KEY}`));
    }
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`)),
      "rate_limited",
      429,
    );
  });
});

// NOSSO (1121): a chave do FUNCIONÁRIO e o recorte por funil.
describe("requireApiKey — chave do funcionário (1121)", () => {
  it("a chave da CONTA (sem funcionário) não consulta o perfil: nada muda para o n8n", async () => {
    findActiveKeyByHash.mockResolvedValue(row());
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`));
    expect(funcionarioAtivoNaConta).not.toHaveBeenCalled();
    expect(ctx.membroUserId).toBeNull();
    expect(ctx.funis).toBeNull();
  });

  it("funcionário ativo na conta da chave: passa, com o id dele no contexto", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ membro_user_id: "func-1" }));
    funcionarioAtivoNaConta.mockResolvedValue(true);
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`));
    // Conferido NA CONTA DA CHAVE (a remoção move o perfil para outra conta).
    expect(funcionarioAtivoNaConta).toHaveBeenCalledWith("func-1", "acct-1");
    expect(ctx.membroUserId).toBe("func-1");
  });

  it("funcionário suspenso ou fora da conta: 401, como uma chave revogada", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ membro_user_id: "func-1" }));
    funcionarioAtivoNaConta.mockResolvedValue(false);
    await expectApiError(requireApiKey(reqWith(`Bearer ${KEY}`)), "unauthorized", 401);
    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  it("a leitura do perfil que FALHA é 500, nunca 401 nem chave aberta", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ membro_user_id: "func-1" }));
    funcionarioAtivoNaConta.mockRejectedValue(new Error("API key member lookup failed"));
    await expectApiError(requireApiKey(reqWith(`Bearer ${KEY}`)), "internal", 500);
  });

  it("chave do funcionário só LÊ: rota de escrita é 403 mesmo com o escopo gravado", async () => {
    // A 2ª defesa: as rotas de gestão recusam o escopo, mas uma corrida de
    // dois PATCHs (ou SQL à mão) pode gravá-lo.
    findActiveKeyByHash.mockResolvedValue(
      row({ membro_user_id: "func-1", scopes: ["messages:send", "contacts:read"] }),
    );
    funcionarioAtivoNaConta.mockResolvedValue(true);
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send"),
      "forbidden",
      403,
    );
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`), "contacts:read");
    expect(ctx.membroUserId).toBe("func-1");
  });

  it("chave da conta com escopo de escrita continua escrevendo (n8n, Make)", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ scopes: ["messages:send"] }));
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`), "messages:send");
    expect(ctx.accountId).toBe("acct-1");
  });

  it("chave recortada por funil numa rota que NÃO declara o recorte: 403 restricted_key", async () => {
    findActiveKeyByHash.mockResolvedValue(
      row({ funis: ["pipe-1"], scopes: ["contacts:read", "contacts:write"] }),
    );
    // Mesmo com o escopo: a rota que não sabe recortar leria a conta inteira.
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`), "contacts:write"),
      "restricted_key",
      403,
    );
    expect(touchLastUsed).not.toHaveBeenCalled();
  });

  it("chave recortada numa rota que declara o recorte: passa, com os funis no contexto", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ funis: ["pipe-1"], scopes: ["contacts:read"] }));
    const ctx = await requireApiKey(reqWith(`Bearer ${KEY}`), "contacts:read", {
      aceitaRecorte: true,
    });
    expect(ctx.funis).toEqual(["pipe-1"]);
  });

  it("lista de funis VAZIA FECHA (403), nunca vira a conta inteira", async () => {
    findActiveKeyByHash.mockResolvedValue(row({ funis: [] }));
    await expectApiError(
      requireApiKey(reqWith(`Bearer ${KEY}`), undefined, { aceitaRecorte: true }),
      "restricted_key",
      403,
    );
  });
});
