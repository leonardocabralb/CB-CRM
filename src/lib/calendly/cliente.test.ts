import { describe, expect, it, vi } from "vitest";

import { CalendlyError, codigoDoErro, criarClienteCalendly, doCalendly, MARCA_DE_TOKEN, semSegredo } from "./cliente";

const TOKEN = "eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0In0";

function resposta(status: number, corpo: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("codigoDoErro / semSegredo / doCalendly", () => {
  it("mapeia os status do Calendly", () => {
    expect(codigoDoErro(401)).toBe("token_invalido");
    expect(codigoDoErro(403)).toBe("sem_permissao");
    expect(codigoDoErro(404)).toBe("nao_encontrado");
    expect(codigoDoErro(429)).toBe("limite");
    expect(codigoDoErro(500)).toBe("calendly_error");
  });

  it("o token nunca sobrevive numa mensagem", () => {
    expect(semSegredo(`Invalid token ${TOKEN} provided`, TOKEN)).toBe(`Invalid token ${MARCA_DE_TOKEN} provided`);
    expect(semSegredo("curto", "abc")).toBe("curto");
  });

  it("só api.calendly.com", () => {
    expect(doCalendly("https://api.calendly.com/users/me")).toBe(true);
    expect(doCalendly("https://api.calendly.com.evil.com/x")).toBe(false);
    expect(doCalendly("http://api.calendly.com/x")).toBe(false);
    expect(doCalendly("nada")).toBe(false);
  });
});

describe("criarClienteCalendly", () => {
  it("usuarioAtual: Bearer no cabeçalho e os campos que a conexão guarda", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.calendly.com/users/me");
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(String(url)).not.toContain(TOKEN);
      return resposta(200, {
        resource: {
          uri: "https://api.calendly.com/users/U1",
          name: "Leonardo",
          email: "l@cb.com",
          scheduling_url: "https://calendly.com/cb",
          timezone: "America/Sao_Paulo",
          current_organization: "https://api.calendly.com/organizations/O1",
        },
      });
    });
    const u = await criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).usuarioAtual();
    expect(u).toEqual({
      uri: "https://api.calendly.com/users/U1",
      nome: "Leonardo",
      email: "l@cb.com",
      organizationUri: "https://api.calendly.com/organizations/O1",
      schedulingUrl: "https://calendly.com/cb",
      timezone: "America/Sao_Paulo",
    });
  });

  it("401 vira token_invalido com a mensagem limpa do token", async () => {
    const fetchFn = vi.fn(async () => resposta(401, { title: "Unauthenticated", message: `bad ${TOKEN}` }));
    const cliente = criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch);
    await expect(cliente.usuarioAtual()).rejects.toMatchObject({ codigo: "token_invalido" });
    try {
      await cliente.usuarioAtual();
    } catch (e) {
      expect((e as CalendlyError).message).not.toContain(TOKEN);
      expect((e as CalendlyError).message).toContain(MARCA_DE_TOKEN);
    }
  });

  it("rede caída vira `rede`, sem estourar", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).usuarioAtual()).rejects.toMatchObject({
      codigo: "rede",
    });
  });

  it("tiposDeEvento pagina por next_page_token e lê os campos", async () => {
    const chamadas: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      chamadas.push(String(url));
      const u = new URL(String(url));
      if (!u.searchParams.get("page_token")) {
        return resposta(200, {
          collection: [
            { uri: "https://api.calendly.com/event_types/A", name: "Reunião com Advogado - Kommo", active: true, duration: 30 },
          ],
          pagination: { next_page_token: "p2" },
        });
      }
      return resposta(200, {
        collection: [{ uri: "https://api.calendly.com/event_types/B", name: "Antigo", active: false }],
        pagination: { next_page_token: null },
      });
    });
    const tipos = await criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).tiposDeEvento({
      organization: "https://api.calendly.com/organizations/O1",
    });
    expect(tipos).toEqual([
      { uri: "https://api.calendly.com/event_types/A", nome: "Reunião com Advogado - Kommo", ativo: true, schedulingUrl: null, duracao: 30 },
      { uri: "https://api.calendly.com/event_types/B", nome: "Antigo", ativo: false, schedulingUrl: null, duracao: null },
    ]);
    expect(chamadas[0]).toContain("organization=https%3A%2F%2Fapi.calendly.com%2Forganizations%2FO1");
    expect(chamadas[1]).toContain("page_token=p2");
  });

  it("criarAssinatura manda o corpo da doc e devolve a assinatura", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const corpo = JSON.parse(String(init?.body));
      expect(init?.method).toBe("POST");
      expect(corpo).toEqual({
        url: "https://crm.exemplo.com/api/cb/calendly/webhook/tok",
        events: ["invitee.created"],
        organization: "https://api.calendly.com/organizations/O1",
        scope: "organization",
        signing_key: "chave",
      });
      return resposta(201, {
        resource: {
          uri: "https://api.calendly.com/webhook_subscriptions/W1",
          callback_url: corpo.url,
          state: "active",
          events: ["invitee.created"],
          scope: "organization",
          retry_started_at: null,
        },
      });
    });
    const a = await criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).criarAssinatura({
      url: "https://crm.exemplo.com/api/cb/calendly/webhook/tok",
      events: ["invitee.created"],
      organization: "https://api.calendly.com/organizations/O1",
      scope: "organization",
      signingKey: "chave",
    });
    expect(a).toEqual({
      uri: "https://api.calendly.com/webhook_subscriptions/W1",
      callbackUrl: "https://crm.exemplo.com/api/cb/calendly/webhook/tok",
      estado: "active",
      eventos: ["invitee.created"],
      escopo: "organization",
      retryStartedAt: null,
    });
  });

  it("assinatura(uri) lê o estado ao vivo — é o que diz se o Calendly a desativou", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.calendly.com/webhook_subscriptions/W1");
      return resposta(200, {
        resource: { uri: "https://api.calendly.com/webhook_subscriptions/W1", callback_url: "https://x/y", state: "disabled", events: ["invitee.created"], scope: "organization", retry_started_at: "2026-09-06T10:00:00Z" },
      });
    });
    const a = await criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).assinatura("https://api.calendly.com/webhook_subscriptions/W1");
    expect(a.estado).toBe("disabled");
    expect(a.retryStartedAt).toBe("2026-09-06T10:00:00Z");
  });

  it("apagarAssinatura só segue URI do Calendly (o token iria junto)", async () => {
    const fetchFn = vi.fn(async () => resposta(204, null));
    const cliente = criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch);
    await cliente.apagarAssinatura("https://api.calendly.com/webhook_subscriptions/W1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(cliente.apagarAssinatura("https://evil.com/webhook_subscriptions/W1")).rejects.toMatchObject({
      codigo: "calendly_error",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
