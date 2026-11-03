import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

import { falhaDaResposta } from "@/lib/inbox/falha-do-envio";

// getCurrentAccount resolves the caller's account context. The
// regression this file guards (issue #294): account loading must NOT
// depend on a PostgREST embedded FK join (`accounts!inner`), because a
// stale schema cache makes that embed fail hard and blanks the whole
// context. It must instead read the profile and then the account with
// two plain point queries.

// ------------------------------------------------------------
// Chainable Supabase query-builder mock. Each `.from(table)` hands back
// a thenable builder pre-loaded with the result queued for that table,
// so we can assert which tables were queried and with what filters.
// ------------------------------------------------------------
interface BuilderCall {
  table: string;
  columns?: string;
  eqArgs: [string, unknown][];
}

function makeClient(opts: {
  user: { id: string } | null;
  userErr?: unknown;
  byTable: Record<string, { data: unknown; error: unknown }>;
}) {
  const calls: BuilderCall[] = [];

  const from = (table: string) => {
    const call: BuilderCall = { table, eqArgs: [] };
    calls.push(call);
    const builder = {
      select(columns: string) {
        call.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        call.eqArgs.push([col, val]);
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(
          opts.byTable[table] ?? { data: null, error: null },
        );
      },
    };
    return builder;
  };

  return {
    calls,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user: opts.user },
            error: opts.userErr ?? null,
          }),
      },
      from,
    },
  };
}

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { getCurrentAccount, toErrorResponse, UnauthorizedError, ForbiddenError } =
  await import("./account");

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves context via a plain accounts lookup, not an embedded join", async () => {
    const { client, calls } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "owner" },
          error: null,
        },
        accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });

    // Two queries: profiles by user_id, then accounts by id. Neither
    // selects an embedded relationship — the regression guard.
    expect(calls.map((c) => c.table)).toEqual(["profiles", "accounts"]);
    expect(calls[0].columns).not.toMatch(/accounts!/);
    expect(calls[0].eqArgs).toEqual([["user_id", "user-1"]]);
    expect(calls[1].columns).not.toMatch(/accounts!/);
    expect(calls[1].eqArgs).toEqual([["id", "acct-1"]]);
  });

  it("throws UnauthorizedError when there is no session", async () => {
    const { client } = makeClient({ user: null, byTable: {} });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("maps a profiles query error to 'Could not load account context'", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Could not load account context",
    );
  });

  it("maps an accounts query error to 'Could not load account context'", async () => {
    // The exact #294 shape if the embed were still in play, but now on
    // the decoupled accounts lookup: profile resolves, account read errors.
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "admin" },
          error: null,
        },
        accounts: { data: null, error: { code: "PGRST200" } },
      },
    });
    createClient.mockReturnValue(client);
    const err = await getCurrentAccount().catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe("Could not load account context");
  });

  it("rejects a profile not linked to an account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: null, account_role: null }, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects an account_id that resolves to no readable account", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: {
          data: { account_id: "acct-1", account_role: "viewer" },
          error: null,
        },
        accounts: { data: null, error: null },
      },
    });
    createClient.mockReturnValue(client);
    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });
});

// O login que não responde (o 500 dele com o banco no teto de conexões, ou
// a rede) não é "não está logado": uma nova tentativa antes de recusar. E,
// persistindo, a recusa é o MESMO 401 de antes — a bolha de envio o lê como
// "barrado, tente de novo"; um 5xx viraria "pode ter saído".
describe("getCurrentAccount — o login que não respondeu", () => {
  const PERFIL = {
    profiles: { data: { account_id: "acct-1", account_role: "agent" }, error: null },
    accounts: { data: { id: "acct-1", name: "Acme" }, error: null },
  };

  function clienteComRespostas(...respostas: Array<{ user: { id: string } | null; error: unknown }>) {
    const { client } = makeClient({ user: null, byTable: PERFIL });
    const getUser = vi.fn();
    for (const r of respostas) {
      getUser.mockResolvedValueOnce({ data: { user: r.user }, error: r.error });
    }
    client.auth.getUser = getUser;
    createClient.mockReturnValue(client);
    return getUser;
  }

  it("tenta de novo e segue com a segunda resposta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUser = clienteComRespostas(
      { user: null, error: new AuthRetryableFetchError("Internal Server Error", 500) },
      { user: { id: "user-1" }, error: null },
    );

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({ userId: "user-1", accountId: "acct-1", role: "agent" });
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("persistindo, recusa com o 401 de sempre (nunca 5xx) depois de UMA nova tentativa", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUser = clienteComRespostas(
      { user: null, error: new AuthRetryableFetchError("Internal Server Error", 500) },
      { user: null, error: new AuthRetryableFetchError("fetch failed", 0) },
    );

    const err = await getCurrentAccount().catch((e) => e);
    const resposta = toErrorResponse(err);

    expect(err).toBeInstanceOf(UnauthorizedError);
    expect(resposta.status).toBe(401);
    expect(getUser).toHaveBeenCalledTimes(2);
    // O contrato que o 401 preserva na bolha de envio: "barrado, tente de
    // novo". Um 5xx viraria "pode ter saído", sem botão de reenviar.
    expect(falhaDaResposta(resposta.status, await resposta.json())).toMatchObject({
      motivo: "barrado",
      podeTentarDeNovo: true,
    });
    expect(falhaDaResposta(503, {})).toMatchObject({ motivo: "incerto", podeTentarDeNovo: false });
  });

  it("a recusa definitiva do login não se repete", async () => {
    const getUser = clienteComRespostas({
      user: null,
      error: new AuthApiError("Session from session_id claim in JWT does not exist", 403, "session_not_found"),
    });

    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("sem sessão não se repete", async () => {
    const getUser = clienteComRespostas({ user: null, error: new AuthSessionMissingError() });

    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});
