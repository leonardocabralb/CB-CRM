import { describe, expect, it } from "vitest";

import { codigoDoErro, criarClienteTldv, doTldv, MARCA_DE_CHAVE, semSegredo, TldvError } from "./cliente";

const CHAVE = "tldv_chave_de_teste_1234567890";

function fetchFalso(respostas: Record<string, { status: number; corpo: unknown }>, chamadas: { url: string; headers: Record<string, string> }[] = []) {
  return async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada);
    chamadas.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const caminho = new URL(url).pathname + new URL(url).search;
    const achada = Object.entries(respostas).find(([prefixo]) => caminho.startsWith(prefixo));
    const r = achada?.[1] ?? { status: 404, corpo: { name: "NotFoundError", message: "Meeting not found" } };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  };
}

describe("cliente do tl;dv", () => {
  it("manda a chave no cabeçalho x-api-key, nunca na URL, e pagina com from/to/page/limit", async () => {
    const chamadas: { url: string; headers: Record<string, string> }[] = [];
    const cliente = criarClienteTldv(
      CHAVE,
      fetchFalso({ "/v1alpha1/meetings": { status: 200, corpo: { page: 1, pages: 1, total: 1, pageSize: 100, results: [reuniaoCrua()] } } }, chamadas),
    );
    const r = await cliente.listarReunioes({ de: new Date("2026-09-01T00:00:00Z"), ate: new Date("2026-09-09T00:00:00Z"), pagina: 2, porPagina: 500 });
    expect(r.reunioes).toHaveLength(1);
    expect(r.reunioes[0].id).toBe("653663ac7c8dbd00130f11d9");
    const u = new URL(chamadas[0].url);
    expect(u.origin).toBe("https://pasta.tldv.io");
    expect(u.searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(u.searchParams.get("to")).toBe("2026-09-09T00:00:00.000Z");
    expect(u.searchParams.get("page")).toBe("2");
    expect(u.searchParams.get("limit")).toBe("100");
    expect(chamadas[0].headers["x-api-key"]).toBe(CHAVE);
    expect(chamadas[0].url).not.toContain(CHAVE);
  });

  it("transcrição ainda não pronta (404) e lista vazia são `null`, não erro", async () => {
    const cliente = criarClienteTldv(CHAVE, fetchFalso({ "/v1alpha1/meetings/vazia/transcript": { status: 200, corpo: { id: "t", meetingId: "vazia", data: [] } } }));
    expect(await cliente.transcricao("semtranscricao")).toBeNull();
    expect(await cliente.transcricao("vazia")).toBeNull();
  });

  it("transcrição pronta vem como frases", async () => {
    const cliente = criarClienteTldv(
      CHAVE,
      fetchFalso({
        "/v1alpha1/meetings/m1/transcript": {
          status: 200,
          corpo: { id: "t", meetingId: "m1", data: [{ speaker: "A", text: "Oi", startTime: 0, endTime: 1 }] },
        },
      }),
    );
    expect(await cliente.transcricao("m1")).toEqual([{ orador: "A", texto: "Oi", inicioSeg: 0, fimSeg: 1 }]);
  });

  it("notas: 403 (plano) e 404 viram null; 200 vem lido", async () => {
    const cliente = criarClienteTldv(
      CHAVE,
      fetchFalso({
        "/v1alpha1/meetings/sem/notes": { status: 403, corpo: { name: "ForbiddenError", message: "no" } },
        "/v1alpha1/meetings/com/notes": { status: 200, corpo: { structuredNotes: [], markdownContent: "# ok", topics: [] } },
      }),
    );
    expect(await cliente.notas("sem")).toBeNull();
    expect(await cliente.notas("com")).toEqual({ markdown: "# ok", topicos: [] });
  });

  it("401 vira `chave_invalida` e a mensagem do tl;dv não carrega a chave", async () => {
    const cliente = criarClienteTldv(
      CHAVE,
      fetchFalso({ "/v1alpha1/meetings": { status: 401, corpo: { name: "UnauthorizedError", message: `Invalid api key ${CHAVE}` } } }),
    );
    const erro = await cliente.listarReunioes({}).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(TldvError);
    expect((erro as TldvError).codigo).toBe("chave_invalida");
    expect((erro as TldvError).message).not.toContain(CHAVE);
    expect((erro as TldvError).message).toContain(MARCA_DE_CHAVE);
  });

  it("rede fora vira `rede`", async () => {
    const cliente = criarClienteTldv(CHAVE, async () => {
      throw new Error(`fetch failed for ${CHAVE}`);
    });
    const erro = await cliente.reuniao("m1").catch((e: unknown) => e);
    expect((erro as TldvError).codigo).toBe("rede");
    expect((erro as TldvError).message).not.toContain(CHAVE);
  });
});

describe("ajudantes", () => {
  it("codigoDoErro mapeia os status que importam", () => {
    expect(codigoDoErro(401)).toBe("chave_invalida");
    expect(codigoDoErro(403)).toBe("sem_permissao");
    expect(codigoDoErro(404)).toBe("nao_encontrado");
    expect(codigoDoErro(429)).toBe("limite");
    expect(codigoDoErro(500)).toBe("tldv_error");
  });

  it("doTldv aceita só pasta.tldv.io", () => {
    expect(doTldv("https://pasta.tldv.io/v1alpha1/meetings")).toBe(true);
    expect(doTldv("https://pasta.tldv.io.evil.com/x")).toBe(false);
    expect(doTldv("nada")).toBe(false);
  });

  it("semSegredo troca a chave pela marca; chave curta demais fica como está", () => {
    expect(semSegredo(`erro ${CHAVE} aqui`, CHAVE)).toBe(`erro ${MARCA_DE_CHAVE} aqui`);
    expect(semSegredo("erro abc aqui", "abc")).toBe("erro abc aqui");
  });
});

function reuniaoCrua() {
  return {
    id: "653663ac7c8dbd00130f11d9",
    name: "Reunião",
    happenedAt: "2026-09-08T14:00:00.000Z",
    url: "https://tldv.io/app/meetings/653663ac7c8dbd00130f11d9",
    duration: 600,
    organizer: { name: "L", email: "l@x.com" },
    invitees: [],
    template: "t",
    extraProperties: {},
  };
}
