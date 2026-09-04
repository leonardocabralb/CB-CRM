import { describe, expect, it } from "vitest";

import { intervaloDoPreset } from "@/lib/funil/periodo";

import { custos, diasDoPeriodo, gastoDoPeriodo } from "./atribuicao";
import { cartaoDoMetaAds } from "./cartao";
import { codigoDoErro, criarClienteMeta, doGraph, MARCA_DE_TOKEN, MetaAdsError, normalizarAdAccountId, semSegredo } from "./cliente";
import { DIAS_DA_PRIMEIRA_SYNC, DIAS_DE_REPROCESSO, janelaDeSync } from "./janela-de-sync";

describe("janelaDeSync", () => {
  it("3 dias inclusivos (hoje, ontem, anteontem) — a Meta reprocessa o gasto por 48h", () => {
    const j = janelaDeSync(new Date("2026-09-04T15:00:00Z"), false);
    expect(j).toEqual({ since: "2026-09-02", until: "2026-09-04", dias: DIAS_DE_REPROCESSO });
  });

  it("primeira sincronização traz 90 dias, atravessando a virada de mês", () => {
    const j = janelaDeSync(new Date("2026-09-04T03:00:00Z"), true);
    expect(j.dias).toBe(DIAS_DA_PRIMEIRA_SYNC);
    expect(j.until).toBe("2026-09-04");
    expect(j.since).toBe("2026-06-07");
  });
});

describe("o token não sobrevive à mensagem de erro", () => {
  const TOKEN = "EAABsegredoDoEscritorio123";

  it("a frase da Meta ecoa o token, e semSegredo o troca pelo marcador", () => {
    // Medido em 04/09/2026 contra a API real, com um token inválido.
    const daMeta = `Malformed access token ${TOKEN}`;
    expect(semSegredo(daMeta, TOKEN)).toBe(`Malformed access token ${MARCA_DE_TOKEN}`);
    expect(semSegredo(daMeta, TOKEN)).not.toContain(TOKEN);
  });

  it("limpa access_token= de URL (a paginação da Meta devolve o cursor com ele)", () => {
    const url = "https://graph.facebook.com/v21.0/act_1/campaigns?after=X&access_token=OUTRO_SEGREDO&limit=200";
    const limpo = semSegredo(url, TOKEN);
    expect(limpo).not.toContain("OUTRO_SEGREDO");
    expect(limpo).toContain("after=X");
  });

  it("token curto demais não é procurado — trocaria pedaços da frase", () => {
    expect(semSegredo("erro no token abc", "abc")).toBe("erro no token abc");
  });

  it("o erro que sai do cliente já vem sem o token", async () => {
    const fetchFalso = (async () =>
      new Response(JSON.stringify({ error: { code: 190, message: `Malformed access token ${TOKEN}` } }), {
        status: 400,
      })) as unknown as typeof fetch;
    const cliente = criarClienteMeta(TOKEN, fetchFalso);
    await expect(cliente.conta("act_1")).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof MetaAdsError && e.codigo === "token_invalido" && !e.message.includes(TOKEN),
    );
  });
});

describe("a paginação não leva o token para fora do Graph", () => {
  it("reconhece só a origem do Graph", () => {
    expect(doGraph("https://graph.facebook.com/v21.0/act_1/campaigns")).toBe(true);
    expect(doGraph("https://graph.facebook.com.evil.test/v21.0/x")).toBe(false);
    expect(doGraph("http://graph.facebook.com/v21.0/x")).toBe(false);
    expect(doGraph("nao é url")).toBe(false);
  });

  it("cursor apontando para outro host é recusado ANTES do pedido", async () => {
    const pedidos: string[] = [];
    const fetchFalso = (async (url: string) => {
      pedidos.push(url);
      return new Response(
        JSON.stringify({ data: [], paging: { next: "https://evil.test/roubar?x=1" } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await expect(criarClienteMeta("EAABsegredo123", fetchFalso).campanhas("act_1")).rejects.toBeInstanceOf(
      MetaAdsError,
    );
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toContain("graph.facebook.com");
  });
});

describe("cliente — códigos e id da conta", () => {
  it("normaliza o id da conta de anúncios", () => {
    expect(normalizarAdAccountId(" act_123 ")).toBe("act_123");
    expect(normalizarAdAccountId("123")).toBe("act_123");
    expect(normalizarAdAccountId("act_x")).toBeNull();
    expect(normalizarAdAccountId("")).toBeNull();
  });

  it("mapeia os erros do Graph para códigos nossos", () => {
    expect(codigoDoErro(400, { code: 190, type: "OAuthException" })).toBe("token_invalido");
    expect(codigoDoErro(400, { code: 200 })).toBe("sem_permissao");
    expect(codigoDoErro(400, { code: 10 })).toBe("sem_permissao");
    expect(codigoDoErro(400, { code: 100, message: "Unsupported get request. Object with ID 'act_1' does not exist" })).toBe("conta_nao_encontrada");
    expect(codigoDoErro(400, { code: 4 })).toBe("limite");
    expect(codigoDoErro(500, { code: 1 })).toBe("meta_error");
    expect(codigoDoErro(500, null)).toBe("meta_error");
  });

  it("pagina por paging.next e manda o token no header, nunca na URL", async () => {
    const urls: string[] = [];
    const respostas = [
      { data: [{ id: "c1", name: "Campanha 1", status: "ACTIVE" }], paging: { next: "https://graph.facebook.com/next?after=x" } },
      { data: [{ id: "c2", name: "Campanha 2", status: "PAUSED" }] },
    ];
    const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
      const corpo = respostas.shift();
      return new Response(JSON.stringify(corpo), { status: 200 });
    }) as typeof fetch;
    const cliente = criarClienteMeta("tok", fetchFalso);
    const campanhas = await cliente.campanhas("act_1");
    expect(campanhas.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(urls[0]).toContain("/act_1/campaigns?fields=id,name,status");
    expect(urls.every((u) => !u.includes("access_token"))).toBe(true);
  });

  it("erro da Meta vira MetaAdsError com código; a mensagem crua fica no Error", async () => {
    const fetchFalso = (async () =>
      new Response(JSON.stringify({ error: { code: 190, type: "OAuthException", message: "Invalid OAuth access token" } }), { status: 401 })) as typeof fetch;
    const cliente = criarClienteMeta("tok", fetchFalso);
    await expect(cliente.conta("act_1")).rejects.toMatchObject({ codigo: "token_invalido", message: "Invalid OAuth access token" });
    await expect(cliente.conta("act_1")).rejects.toBeInstanceOf(MetaAdsError);
  });

  it("gastos: uma linha por campanha e dia, com o gasto numérico", async () => {
    const fetchFalso = (async (url: string | URL | Request) => {
      expect(String(url)).toContain("time_increment=1");
      return new Response(
        JSON.stringify({ data: [{ campaign_id: "c1", spend: "12.50", date_start: "2026-09-03", date_stop: "2026-09-03" }, { campaign_id: "c1", spend: "abc", date_start: "2026-09-04" }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const gastos = await criarClienteMeta("tok", fetchFalso).gastos("act_1", "2026-09-02", "2026-09-04");
    expect(gastos).toEqual([{ campaignId: "c1", dia: "2026-09-03", gasto: 12.5 }]);
  });
});

describe("atribuição do gasto ao funil", () => {
  const campanhas = [
    { campaign_id: "c1", nome: "Bancário 1", pipeline_id: "banc" },
    { campaign_id: "c2", nome: "Bancário 2", pipeline_id: "banc" },
    { campaign_id: "c3", nome: "Trabalhista", pipeline_id: "trab" },
    { campaign_id: "c4", nome: "Sem funil", pipeline_id: null },
  ];
  const gastos = [
    { campaign_id: "c1", dia: "2026-09-01", gasto: 100 },
    { campaign_id: "c1", dia: "2026-09-03", gasto: 50 },
    { campaign_id: "c2", dia: "2026-09-02", gasto: 300 },
    { campaign_id: "c3", dia: "2026-09-02", gasto: 999 },
    { campaign_id: "c4", dia: "2026-09-02", gasto: 40 },
    { campaign_id: "c1", dia: "2026-08-31", gasto: 1000 }, // fora do período
    { campaign_id: "c9", dia: "2026-09-02", gasto: 5 }, // campanha desconhecida
  ];

  it("soma só as campanhas do funil no período e aponta o que está sem funil", () => {
    const g = gastoDoPeriodo(gastos, campanhas, "banc", { desde: "2026-09-01", ate: "2026-09-04" });
    expect(g.total).toBe(450);
    expect(g.porCampanha).toEqual([
      { campaignId: "c2", nome: "Bancário 2", gasto: 300 },
      { campaignId: "c1", nome: "Bancário 1", gasto: 150 },
    ]);
    expect(g.semFunil).toEqual({ total: 40, campanhas: 1 });
  });

  it("período aberto (Total) soma tudo", () => {
    expect(gastoDoPeriodo(gastos, campanhas, "banc", { desde: null, ate: null }).total).toBe(1450);
  });

  it("dias do período saem do intervalo do painel, em chaves locais e com fim exclusivo", () => {
    const agora = new Date(2026, 8, 4, 15);
    expect(diasDoPeriodo(intervaloDoPreset("mes_passado", agora), agora)).toEqual({ desde: "2026-08-01", ate: "2026-09-01" });
    expect(diasDoPeriodo(intervaloDoPreset("este_mes", agora), agora)).toEqual({ desde: "2026-09-01", ate: "2026-09-05" });
    expect(diasDoPeriodo({ desde: null, ate: null }, agora)).toEqual({ desde: null, ate: null });
  });

  it("custos: por lead, CAC e o custo dos perdidos; sem denominador vira nulo", () => {
    expect(custos(900, 9, 2, 3)).toEqual({ custoPorLead: 100, cac: 450, custoDosPerdidos: 300 });
    expect(custos(900, 0, 0, 0)).toEqual({ custoPorLead: null, cac: null, custoDosPerdidos: null });
    expect(custos(0, 4, 0, 1)).toEqual({ custoPorLead: 0, cac: null, custoDosPerdidos: 0 });
  });
});

describe("cartão do Meta Ads", () => {
  it("sem config = não conectado; com config = conectado e contagens", () => {
    expect(cartaoDoMetaAds(null, []).estado).toBe("nao_conectado");
    const c = cartaoDoMetaAds(
      { ad_account_id: "act_1", nome_da_conta: "CB", moeda: "BRL", status: "conectado", last_sync_at: "2026-09-04T10:00:00Z", last_error: null },
      [
        { id: "a", campaign_id: "c1", nome: "x", status_meta: "ACTIVE", pipeline_id: "p", last_seen_at: "" },
        { id: "b", campaign_id: "c2", nome: "y", status_meta: "PAUSED", pipeline_id: null, last_seen_at: "" },
      ],
    );
    expect(c).toMatchObject({ estado: "conectado", campanhas: 2, ativas: 1, semFunil: 1, ultimaSync: "2026-09-04T10:00:00Z", erro: null });
    expect(c.conta).toEqual({ id: "act_1", nome: "CB", moeda: "BRL" });
  });

  it("status erro carrega o código do último erro", () => {
    const c = cartaoDoMetaAds(
      { ad_account_id: "act_1", nome_da_conta: null, moeda: null, status: "erro", last_sync_at: null, last_error: "token_invalido" },
      [],
    );
    expect(c.estado).toBe("erro");
    expect(c.erro).toBe("token_invalido");
    expect(c.conta?.nome).toBe("act_1");
  });
});
