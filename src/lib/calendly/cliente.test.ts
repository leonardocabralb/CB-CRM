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
      { uri: "https://api.calendly.com/event_types/A", nome: "Reunião com Advogado - Kommo", ativo: true, schedulingUrl: null, duracao: 30, local: null, perguntas: [] },
      { uri: "https://api.calendly.com/event_types/B", nome: "Antigo", ativo: false, schedulingUrl: null, duracao: null, local: null, perguntas: [] },
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

// ------------------------------------------------------------
// F5 dos agentes de IA: horários livres, o tipo de evento lido na hora e o
// agendamento em nome do cliente (`POST /invitees`). Sem rede: dublê.
// ------------------------------------------------------------
describe("criarClienteCalendly — a agenda do agente (F5)", () => {
  const TIPO = "https://api.calendly.com/event_types/T1";

  it("horariosLivres: a janela na consulta, só o que está `available`", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url));
      expect(u.origin + u.pathname).toBe("https://api.calendly.com/event_type_available_times");
      expect(u.searchParams.get("event_type")).toBe(TIPO);
      expect(u.searchParams.get("start_time")).toBe("2026-09-26T13:00:00.000Z");
      expect(u.searchParams.get("end_time")).toBe("2026-10-03T12:59:00.000Z");
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      expect(String(url)).not.toContain(TOKEN);
      return resposta(200, {
        collection: [
          { start_time: "2026-09-28T18:15:00Z", status: "available", invitees_remaining: 1 },
          { start_time: "2026-09-28T18:45:00Z", status: "unavailable", invitees_remaining: 0 },
          { start_time: "2026-09-28T19:15:00Z" },
          { status: "available" },
          { start_time: "2026-09-29T13:00:00Z", status: "available", invitees_remaining: 1 },
        ],
      });
    });
    const livres = await criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).horariosLivres({
      tipoDeEvento: TIPO,
      inicio: "2026-09-26T13:00:00.000Z",
      fim: "2026-10-03T12:59:00.000Z",
    });
    expect(livres).toEqual(["2026-09-28T18:15:00Z", "2026-09-29T13:00:00Z"]);
  });

  it("horariosLivres: o prazo aborta o pedido e vira `rede`", async () => {
    const fetchFn = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, rejeitar) => {
          init?.signal?.addEventListener("abort", () => rejeitar(new Error("The operation was aborted due to timeout")));
        }),
    );
    const inicio = Date.now();
    await expect(
      criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).horariosLivres(
        { tipoDeEvento: TIPO, inicio: "a", fim: "b" },
        { prazoMs: 30 },
      ),
    ).rejects.toMatchObject({ codigo: "rede", status: null });
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });

  it("tipoDeEvento: ativo e o `kind` do PRIMEIRO local; URI de fora não é pedida", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(TIPO);
      return resposta(200, {
        resource: {
          uri: TIPO,
          name: "Reunião",
          active: true,
          duration: 30,
          locations: [{ kind: "google_conference" }, { kind: "physical", location: "Rua X" }],
        },
      });
    });
    const cliente = criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch);
    expect(await cliente.tipoDeEvento(TIPO)).toMatchObject({ uri: TIPO, ativo: true, duracao: 30, local: "google_conference" });
    await expect(cliente.tipoDeEvento("https://evil.com/event_types/T1")).rejects.toMatchObject({ codigo: "calendly_error" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("tipoDeEvento: as perguntas do formulário (`custom_questions`) — a forma MEDIDA, e a de fora ignorada", async () => {
    const fetchFn = vi.fn(async () =>
      resposta(200, {
        resource: {
          uri: TIPO,
          name: "Reunião",
          active: true,
          custom_questions: [
            // A forma medida em produção (26/09/2026).
            { name: "Telefone (Whatsapp)", type: "phone_number", required: true, position: 0, enabled: true },
            { name: "Assunto", type: "text", required: false, position: 1, enabled: false },
            // Sem posição: a da lista; sem nome, fora.
            { name: "Empresa", type: "string" },
            { type: "string", position: 3 },
            "lixo",
          ],
        },
      }),
    );
    const tipo = await criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).tipoDeEvento(TIPO);
    expect(tipo.perguntas).toEqual([
      { nome: "Telefone (Whatsapp)", tipo: "phone_number", obrigatoria: true, posicao: 0, ativa: true },
      { nome: "Assunto", tipo: "text", obrigatoria: false, posicao: 1, ativa: false },
      { nome: "Empresa", tipo: "string", obrigatoria: false, posicao: 2, ativa: true },
    ]);
  });

  it("criarConvidado: POST /invitees com o corpo como veio; 201 devolve a URI", async () => {
    const corpo = { event_type: TIPO, start_time: "2026-09-28T18:15:00.000Z", invitee: { name: "Maria", email: "m@x.com", timezone: "America/Sao_Paulo" } };
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.calendly.com/invitees");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual(corpo);
      return resposta(201, { resource: { uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1" } });
    });
    const r = await criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).criarConvidado(corpo);
    expect(r).toEqual({ uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1" });
  });

  it("criarConvidado: a recusa carrega o STATUS (é ele que separa horário tomado de outra recusa)", async () => {
    const fetchFn = vi.fn(async () => resposta(409, { title: "Conflict", message: "The selected time is no longer available" }));
    await expect(criarClienteCalendly(TOKEN, fetchFn as unknown as typeof fetch).criarConvidado({})).rejects.toMatchObject({
      codigo: "calendly_error",
      status: 409,
    });
  });
});
