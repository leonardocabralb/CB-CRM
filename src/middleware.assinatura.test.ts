import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// O middleware com a biblioteca de VERDADE (sem dublê do @supabase/ssr):
// tokens ES256 assinados aqui, com `kid`, como os do projeto. O que isto
// prende, e o dublê do `middleware.test.ts` não alcança:
// - o token válido é conferido SEM `GET /auth/v1/user` (uma atualização da
//   biblioteca que volte a perguntar ao login reprova aqui);
// - as chaves públicas são buscadas UMA vez e ficam em cache;
// - a renovação do token leva o cookie novo no redirecionamento (#288);
// - assinatura de outra chave, renovação recusada e falta de sessão levam ao
//   login, como antes;
// - o login fora do ar (500 na renovação, chaves indisponíveis) não leva.
//
// O cache das chaves é global por PROJETO dentro da biblioteca: cada teste
// usa um projeto próprio, para não depender da ordem.
let projeto = 0;
let cookie = "";
const KID = "chave-de-teste";

let par: CryptoKeyPair;
let outroPar: CryptoKeyPair;
let jwkPublica: JsonWebKey & { kid: string };

const base64url = (dados: string | Uint8Array) => Buffer.from(dados).toString("base64url");

async function assinar(
  payload: Record<string, unknown>,
  { chave = par.privateKey, kid = KID }: { chave?: CryptoKey; kid?: string | null } = {},
) {
  const cabecalho = base64url(
    JSON.stringify({ alg: "ES256", typ: "JWT", ...(kid ? { kid } : {}) }),
  );
  const corpo = base64url(JSON.stringify(payload));
  const assinatura = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    chave,
    new TextEncoder().encode(`${cabecalho}.${corpo}`),
  );
  return `${cabecalho}.${corpo}.${base64url(new Uint8Array(assinatura))}`;
}

const agora = () => Math.floor(Date.now() / 1000);
const USUARIO = { id: "user-1", aud: "authenticated", role: "authenticated" };

async function sessao({
  venceEm = agora() + 3600,
  refreshToken = "refresh-de-teste",
  ...opcoes
}: { venceEm?: number; refreshToken?: string; chave?: CryptoKey; kid?: string | null } = {}) {
  const accessToken = await assinar(
    {
      sub: USUARIO.id,
      aud: "authenticated",
      role: "authenticated",
      session_id: "sessao-1",
      iat: venceEm - 3600,
      exp: venceEm,
    },
    opcoes,
  );
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: venceEm,
    user: USUARIO,
  };
}

async function pedidoComSessao(
  caminho: string,
  opcoes: Parameters<typeof sessao>[0] = {},
) {
  const valor = `base64-${base64url(JSON.stringify(await sessao(opcoes)))}`;
  return new NextRequest(`https://app.test${caminho}`, {
    headers: { cookie: `${cookie}=${valor}` },
  });
}

// --- O "servidor" de login, por fetch --------------------------------------
let pedidos: string[] = [];
let respostaDasChaves: () => Response;
let respostaDaRenovacao: () => Response | Promise<Response>;

beforeAll(async () => {
  par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  outroPar = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  jwkPublica = {
    ...(await crypto.subtle.exportKey("jwk", par.publicKey)),
    kid: KID,
    alg: "ES256",
    use: "sig",
  };
});

beforeEach(() => {
  projeto += 1;
  const ref = `assinatura-${projeto}`;
  cookie = `sb-${ref}-auth-token`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  pedidos = [];
  respostaDasChaves = () => Response.json({ keys: [jwkPublica] });
  respostaDaRenovacao = () => Response.json({ error: "não esperado" }, { status: 418 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      pedidos.push(url.pathname);
      if (url.pathname === "/auth/v1/.well-known/jwks.json") return respostaDasChaves();
      if (url.pathname === "/auth/v1/token") return respostaDaRenovacao();
      if (url.pathname === "/auth/v1/user") return Response.json(USUARIO);
      throw new Error(`pedido inesperado: ${url.pathname}`);
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const { middleware } = await import("./middleware");

const destino = (res: Response) => {
  const local = res.headers.get("location");
  return local ? new URL(local).pathname : null;
};
const buscasDasChaves = () =>
  pedidos.filter((p) => p === "/auth/v1/.well-known/jwks.json").length;

describe("middleware com a biblioteca real", () => {
  it("confere o token válido pela assinatura, sem GET /user, e busca as chaves UMA vez", async () => {
    const primeira = await middleware(await pedidoComSessao("/dashboard"));
    const segunda = await middleware(await pedidoComSessao("/inbox"));
    const api = await middleware(await pedidoComSessao("/api/whatsapp/send"));

    expect(destino(primeira)).toBeNull();
    expect(destino(segunda)).toBeNull();
    expect(api.status).toBe(200);
    expect(buscasDasChaves()).toBe(1);
    expect(pedidos).not.toContain("/auth/v1/user");
  });

  it("leva quem está logado do /login ao /dashboard", async () => {
    const res = await middleware(await pedidoComSessao("/login"));

    expect(destino(res)).toBe("/dashboard");
  });

  it("token vencido e renovado: vai ao /dashboard levando o cookie NOVO (#288)", async () => {
    const nova = await sessao({ refreshToken: "refresh-novo" });
    respostaDaRenovacao = () => Response.json(nova);

    const res = await middleware(await pedidoComSessao("/login", { venceEm: agora() - 60 }));

    expect(destino(res)).toBe("/dashboard");
    expect(pedidos).toContain("/auth/v1/token");
    const gravado = res.cookies.get(cookie)?.value ?? "";
    expect(gravado.startsWith("base64-")).toBe(true);
    expect(Buffer.from(gravado.slice("base64-".length), "base64url").toString()).toContain(
      "refresh-novo",
    );
  });

  it("leva ao login o token assinado por OUTRA chave com o mesmo kid", async () => {
    const res = await middleware(await pedidoComSessao("/inbox", { chave: outroPar.privateKey }));
    const api = await middleware(
      await pedidoComSessao("/api/whatsapp/send", { chave: outroPar.privateKey }),
    );

    expect(destino(res)).toBe("/login");
    expect(api.status).toBe(401);
  });

  it("sem cookie de sessão leva ao login sem nenhum pedido ao login", async () => {
    const res = await middleware(new NextRequest("https://app.test/inbox"));
    const cron = await middleware(new NextRequest("https://app.test/api/cb/scheduled/cron"));

    expect(destino(res)).toBe("/login");
    expect(destino(cron)).toBeNull();
    expect(pedidos).toEqual([]);
  });

  it("token vencido e renovação RECUSADA: login, com o cookie da sessão apagado", async () => {
    respostaDaRenovacao = () =>
      Response.json(
        {
          code: "refresh_token_not_found",
          error_code: "refresh_token_not_found",
          msg: "Invalid Refresh Token: Refresh Token Not Found",
        },
        { status: 400 },
      );

    const res = await middleware(await pedidoComSessao("/inbox", { venceEm: agora() - 60 }));

    expect(destino(res)).toBe("/login");
    expect(pedidos).toContain("/auth/v1/token");
    expect(res.cookies.get(cookie)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("token vencido e login fora do ar (500 na renovação): a tela abre e a API segue até a rota", async () => {
    respostaDaRenovacao = () => Response.json({ msg: "Internal Server Error" }, { status: 500 });
    // A biblioteca repete a renovação com espera crescente por até ~30 s
    // (como já fazia com o getUser): relógio falso para não esperar.
    vi.useFakeTimers();

    const tela = middleware(await pedidoComSessao("/inbox", { venceEm: agora() - 60 }));
    await vi.runAllTimersAsync();
    const api = middleware(await pedidoComSessao("/api/whatsapp/send", { venceEm: agora() - 60 }));
    await vi.runAllTimersAsync();

    expect(destino(await tela)).toBeNull();
    const respostaDaApi = await api;
    expect(respostaDaApi.status).toBe(200);
    expect(destino(respostaDaApi)).toBeNull();
  });

  it("chaves indisponíveis (503) na primeira busca: a tela abre", async () => {
    respostaDasChaves = () => new Response("Service Unavailable", { status: 503 });

    const res = await middleware(await pedidoComSessao("/inbox"));

    expect(destino(res)).toBeNull();
    expect(buscasDasChaves()).toBe(1);
  });

  it("cache das chaves VENCIDO (10 min) com as chaves fora do ar: a tela abre e a API segue até a rota", async () => {
    await middleware(await pedidoComSessao("/inbox"));
    expect(buscasDasChaves()).toBe(1);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    respostaDasChaves = () => new Response("Service Unavailable", { status: 503 });

    const tela = await middleware(await pedidoComSessao("/inbox"));
    const api = await middleware(await pedidoComSessao("/api/whatsapp/send"));

    expect(buscasDasChaves()).toBeGreaterThan(1);
    expect(destino(tela)).toBeNull();
    expect(api.status).toBe(200);
  });

  it("token SEM kid cai no GET /user da biblioteca e continua valendo", async () => {
    // Documenta o desvio: um projeto que volte à chave simétrica (HS256)
    // perde o ganho sem reprovar nada aqui; a medição em produção é que
    // acusa (os `GET /auth/v1/user` do middleware voltam).
    const res = await middleware(await pedidoComSessao("/login", { kid: null }));

    expect(destino(res)).toBe("/dashboard");
    expect(pedidos).toContain("/auth/v1/user");
  });
});
