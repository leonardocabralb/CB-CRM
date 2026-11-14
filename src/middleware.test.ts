import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import ts from "typescript";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — whose verified token getClaims() resolves to (a
//                      refreshed session ⇒ user, or null for the logged-out path).
// `mockErro`         — the error getClaims() returns when there is no user
//                      (null = no session at all).
// `mockLanca`        — what getClaims() throws (an error that is not the
//                      library's own), or null.
// `refreshedCookies` — cookies Supabase writes via setAll() during getClaims(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let mockErro: unknown = null;
let mockLanca: unknown = null;
let chamadasAoGetUser = 0;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getClaims() (through getSession()), which rotates
      // the refresh token and pushes the new cookies through setAll()
      // before resolving.
      getClaims: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        if (mockLanca) throw mockLanca;
        return mockUser
          ? { data: { claims: { sub: mockUser.id } }, error: null }
          : { data: null, error: mockErro };
      },
      // A conferência por pedido não pergunta ao serviço de login: contar
      // as chamadas prova que o middleware não voltou ao getUser().
      getUser: async () => {
        chamadasAoGetUser += 1;
        return { data: { user: mockUser }, error: null };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  mockErro = null;
  mockLanca = null;
  chamadasAoGetUser = 0;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login"),
    );

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getClaims() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/dashboard"),
    );

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe("middleware — every dashboard route requires a session", () => {
  // Read the route group rather than hard-coding a list, so a new page added
  // under src/app/(dashboard)/ fails here until it is added to
  // protectedPaths. /flows, /agents and /notifications were missed that way
  // and rendered a broken page to signed-out visitors instead of redirecting.
  const dashboardRoutes = readdirSync(join(__dirname, "app", "(dashboard)"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);

  it("finds the dashboard route group", () => {
    expect(dashboardRoutes).toContain("/dashboard");
  });

  it.each(dashboardRoutes)("redirects a signed-out visitor from %s to /login", async (route) => {
    mockUser = null;

    const res = await middleware(new NextRequest(`https://app.test${route}`));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });
});

describe("middleware — a sessão é conferida sem perguntar ao login", () => {
  it("não chama getUser() em nenhum caminho", async () => {
    mockUser = { id: "user-1" };
    await middleware(new NextRequest("https://app.test/dashboard"));
    await middleware(new NextRequest("https://app.test/login"));
    await middleware(new NextRequest("https://app.test/api/whatsapp/send"));
    mockUser = null;
    await middleware(new NextRequest("https://app.test/inbox"));

    expect(chamadasAoGetUser).toBe(0);
  });

  it.each(["/signup", "/forgot-password"])(
    "leva quem está logado de %s ao /dashboard",
    async (rota) => {
      mockUser = { id: "user-1" };

      const res = await middleware(new NextRequest(`https://app.test${rota}`));

      expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    },
  );

  it("deixa a API passar para quem está logado", async () => {
    mockUser = { id: "user-1" };

    const res = await middleware(new NextRequest("https://app.test/api/whatsapp/send"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("recusa a API de quem não tem sessão com o 401 de sempre", async () => {
    const res = await middleware(new NextRequest("https://app.test/api/whatsapp/send"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("deixa o webhook passar sem sessão", async () => {
    const res = await middleware(new NextRequest("https://app.test/api/whatsapp/webhook"));

    expect(res.status).toBe(200);
  });

  it("leva ao login quando a renovação do token é RECUSADA (sessão morta)", async () => {
    mockErro = new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found");
    refreshedCookies = [{ ...ROTATED, value: "" }];

    const res = await middleware(new NextRequest("https://app.test/inbox"));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("");
  });
});

describe("middleware — o login que não respondeu não é 'saiu'", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  const LOGIN_FORA_DO_AR = () => new AuthRetryableFetchError("Internal Server Error", 500);

  it.each(["/dashboard", "/inbox", "/settings", "/agendadas"])(
    "abre %s sem mandar ao login",
    async (rota) => {
      mockErro = LOGIN_FORA_DO_AR();

      const res = await middleware(new NextRequest(`https://app.test${rota}`));

      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("também quando a rede caiu (status 0)", async () => {
    mockErro = new AuthRetryableFetchError("fetch failed", 0);

    const res = await middleware(new NextRequest("https://app.test/inbox"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("não leva ao /dashboard quem está no /login (não sabemos se está logado)", async () => {
    mockErro = LOGIN_FORA_DO_AR();

    const res = await middleware(new NextRequest("https://app.test/login"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("a API segue até a rota, que confere o login sozinha", async () => {
    // As chaves públicas vencem no cache a cada 10 min: se o login falhar
    // nesse instante, um 401 aqui recusaria TODO envio, mesmo com a rota
    // capaz de conferir a sessão pelo getUser().
    mockErro = LOGIN_FORA_DO_AR();

    const res = await middleware(new NextRequest("https://app.test/api/whatsapp/send"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("um erro que não é da biblioteca abre a TELA, mas a API recusa", async () => {
    // ⚠️ Um cookie FORJADO (qualquer texto no lugar do token) faz o
    // getClaims() lançar: medido com a biblioteca real, `decodeJWT` estoura um
    // SyntaxError sem ida à rede. A tela abre (lê sob a RLS); a API, não.
    mockLanca = new SyntaxError("Unexpected token in JSON");
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});

    const tela = await middleware(new NextRequest("https://app.test/inbox"));
    const api = await middleware(new NextRequest("https://app.test/api/whatsapp/send"));

    expect(tela.headers.get("location")).toBeNull();
    expect(api.status).toBe(401);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe("middleware — todo handler de /api/whatsapp confere o login sozinho", () => {
  // Com o login FORA DO AR, o middleware deixa a API seguir até a rota. Isso
  // só é seguro porque cada HANDLER confere o login por conta própria — um
  // `PUT` novo num arquivo cujo `GET` confere não está coberto pelo `GET`.
  // Handler novo aqui sem essa conferência reprova: ou ele chama
  // `requireRole`/`getCurrentAccount`/`auth.getUser()`, ou é webhook (fica
  // fora do middleware), ou só responde 410 (rota aposentada).
  const raiz = join(__dirname, "app", "api", "whatsapp");
  const rotas = (readdirSync(raiz, { recursive: true }) as string[])
    .filter((caminho) => caminho.endsWith("route.ts"))
    .filter((caminho) => !caminho.includes("webhook"));
  const VERBOS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  const CONFERE = /requireRole\(|getCurrentAccount\(|auth\.getUser\(/;

  /**
   * Cada handler exportado (`export async function POST`, `export const GET = …`)
   * e se ele confere o login — no próprio corpo ou por uma função DO ARQUIVO
   * que ele chama (`resolverAlvo` → `requireRole`), seguida de chamada em chamada.
   */
  function handlers(caminho: string, fonte: string): Array<{ verbo: string; confere: boolean; corpo: string }> {
    const arquivo = ts.createSourceFile(caminho, fonte, ts.ScriptTarget.Latest, true);
    const exportado = (no: ts.Node) =>
      ts.canHaveModifiers(no) &&
      (ts.getModifiers(no) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    // Todas as funções de topo do arquivo (declaradas ou em `const`), pelo nome.
    const funcoes = new Map<string, string>();
    const handlers: Array<{ verbo: string; corpo: string }> = [];
    for (const no of arquivo.statements) {
      if (ts.isFunctionDeclaration(no) && no.name) {
        funcoes.set(no.name.text, no.getText(arquivo));
        if (VERBOS.has(no.name.text) && exportado(no)) {
          handlers.push({ verbo: no.name.text, corpo: no.getText(arquivo) });
        }
      }
      if (ts.isVariableStatement(no)) {
        for (const d of no.declarationList.declarations) {
          if (!ts.isIdentifier(d.name) || !d.initializer) continue;
          funcoes.set(d.name.text, d.getText(arquivo));
          if (VERBOS.has(d.name.text) && exportado(no)) {
            handlers.push({ verbo: d.name.text, corpo: d.getText(arquivo) });
          }
        }
      }
    }
    // Quem confere: o corpo com a chamada, ou que chama quem confere.
    const conferem = new Set([...funcoes].filter(([, corpo]) => CONFERE.test(corpo)).map(([n]) => n));
    for (let mudou = true; mudou; ) {
      mudou = false;
      for (const [nome, corpo] of funcoes) {
        if (conferem.has(nome)) continue;
        if ([...conferem].some((c) => new RegExp(`\\b${c}\\(`).test(corpo))) {
          conferem.add(nome);
          mudou = true;
        }
      }
    }
    return handlers.map((h) => ({
      ...h,
      confere:
        CONFERE.test(h.corpo) ||
        [...conferem].some((c) => c !== h.verbo && new RegExp(`\\b${c}\\(`).test(h.corpo)),
    }));
  }

  const casos = rotas.flatMap((caminho) => {
    const fonte = readFileSync(join(raiz, caminho), "utf8");
    return handlers(caminho, fonte).map((h) => ({ nome: `${caminho} ${h.verbo}`, ...h }));
  });

  it("acha os handlers", () => {
    expect(rotas.length).toBeGreaterThan(5);
    expect(casos.length).toBeGreaterThanOrEqual(rotas.length);
  });

  it("um handler NOVO sem conferência reprova, mesmo com o vizinho conferindo", () => {
    const fonte = [
      "export async function GET() { await requireRole('agent'); return ok() }",
      "export async function PUT() { return ok() }",
      "async function alvo() { await requireRole('agent') }",
      "export async function DELETE() { await alvo(); return ok() }",
    ].join("\n");
    const achados = Object.fromEntries(handlers("x.ts", fonte).map((h) => [h.verbo, h.confere]));
    expect(achados).toEqual({ GET: true, PUT: false, DELETE: true });
  });

  it.each(casos)("$nome", ({ confere, corpo }) => {
    const soAposentado = corpo.includes("status: 410") && !/supabase|createClient/i.test(corpo);

    expect(confere || soAposentado).toBe(true);
  });
});
