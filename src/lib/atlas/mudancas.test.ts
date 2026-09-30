import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DispatchInput, ResultadoDoDisparo } from "@/lib/automations/engine";

import { criarBanco, type Banco } from "../zapsign/duble.test-helper";

import { dispararMudancas, JANELA_MINIMA_DO_DISPARO_MS, MUDANCAS_POR_VEZ, RECOLHER_MUDANCA_MS, TETO_DE_TENTATIVAS, ultimasMudancasDoCartao } from "./mudancas";

// ============================================================
// O disparo do gatilho "Situação mudou no Atlas" (1073): a reivindicação
// própria, a releitura do vínculo, UMA leitura de cards e conversa ANTES de
// disparar (P1-4), a volta à fila só quando nada rodou (CLAUDE.md 8e), o
// recolhimento que nunca repete, o card fora do funil e o AMBIENTE em toda
// consulta. Dados fictícios; o banco é o dublê em memória (a forma SUPOSTA
// do PostgREST).
// ============================================================

const CONTA = "conta-1";
const TENANT = "t1";
const STAGING = "https://staging.example.com/functions/v1/client-webhook";
const AGORA = new Date("2026-09-30T15:00:00.000Z");
const DESDE = "2026-09-30T14:00:00.000Z";
const JURIDICO = "00000000-0000-4000-8000-00000000a001";
const COMERCIAL = "00000000-0000-4000-8000-00000000a002";

let banco: Banco;
let disparos: DispatchInput[];
let resposta: (input: DispatchInput) => ResultadoDoDisparo;

const disparar = async (input: DispatchInput) => {
  disparos.push(input);
  return resposta(input);
};
const rodou = (p: Partial<ResultadoDoDisparo> = {}): ResultadoDoDisparo => ({ candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0, ...p });

const mudanca = (p: Record<string, unknown> = {}) => ({
  id: "m1",
  account_id: CONTA,
  api_url: null,
  atlas_client_id: "a1",
  situacao_anterior: "ativo",
  situacao_nova: "rescindido",
  situacao_desde: DESDE,
  estado: "pendente",
  resultado: null,
  detalhe: null,
  processando_desde: null,
  tentativas: 0,
  created_at: "2026-09-30T14:50:00.000Z",
  processado_em: null,
  ...p,
});
const vinculo = (p: Record<string, unknown> = {}) => ({
  id: "v1",
  account_id: CONTA,
  api_url: null,
  atlas_tenant_id: TENANT,
  atlas_client_id: "a1",
  contact_id: "ficha-1",
  situacao: "rescindido",
  situacao_desde: DESDE,
  app_url: "https://app.example.com/#/clients/a1",
  ...p,
});
const automacao = (id: string, cfg: Record<string, unknown>, p: Record<string, unknown> = {}) => ({
  id,
  account_id: CONTA,
  name: `Automação ${id}`,
  trigger_type: "atlas_situacao_mudou",
  trigger_config: cfg,
  is_active: true,
  ...p,
});

const rodar = (o: { ambiente?: string | null; prazoMs?: number } = {}) =>
  dispararMudancas(banco.cliente, CONTA, { prazoMs: o.prazoMs ?? Date.now() + 30_000, ambiente: o.ambiente === undefined ? null : o.ambiente, disparar });
const fila = () => banco.tabelas.cb_atlas_mudancas;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  banco = criarBanco({
    cb_atlas_config: [{ account_id: CONTA, api_url: null, atlas_tenant_id: TENANT }],
    cb_atlas_mudancas: [mudanca()],
    cb_atlas_clientes: [vinculo()],
    automations: [automacao("aut-jur", { situacoes: ["rescindido"], pipeline_ids: [JURIDICO] })],
    deals: [{ id: "card-jur", account_id: CONTA, contact_id: "ficha-1", pipeline_id: JURIDICO, status: "won" }],
    conversations: [{ id: "conv-1", account_id: CONTA, contact_id: "ficha-1", channel_id: "canal-1" }],
  });
  disparos = [];
  resposta = () => rodou();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dispararMudancas — o caminho feliz", () => {
  it("dispara SÓ a automação que casa, com o card do funil dela, a conversa e as variáveis; grava disparado", async () => {
    banco.tabelas.automations.push(automacao("aut-ativo", { situacoes: ["ativo"], pipeline_ids: [JURIDICO] }));
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { reivindicadas: 1, porResultado: { disparado: 1 } } });
    expect(disparos).toHaveLength(1);
    expect(disparos[0]).toMatchObject({
      accountId: CONTA,
      triggerType: "atlas_situacao_mudou",
      contactId: "ficha-1",
      context: {
        automation_id: "aut-jur",
        deal_id: "card-jur",
        // O status VISTO: a RPC confere e move também o card ganho.
        deal_status_fixado: "won",
        conversation_id: "conv-1",
        channel_id: "canal-1",
        vars: { atlas_situacao: "rescindido", atlas_situacao_anterior: "ativo", atlas_link: "https://app.example.com/#/clients/a1" },
      },
    });
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "disparado", tentativas: 1 });
    expect(fila()[0].detalhe).toContain("Automação aut-jur: executada");
  });

  it("ex-cliente que voltou pelo Comercial: com os DOIS funis marcados, o card do Comercial é o do evento", async () => {
    banco.tabelas.deals = [{ id: "card-com", account_id: CONTA, contact_id: "ficha-1", pipeline_id: COMERCIAL, status: "open" }];
    banco.tabelas.cb_atlas_clientes[0].situacao = "ativo";
    fila()[0] = mudanca({ situacao_anterior: "rescindido", situacao_nova: "ativo" });
    banco.tabelas.automations = [automacao("aut-volta", { situacoes: ["ativo"], pipeline_ids: [JURIDICO, COMERCIAL] })];
    await rodar();
    expect(disparos[0].context).toMatchObject({ automation_id: "aut-volta", deal_id: "card-com", deal_status_fixado: "open" });
  });

  it("sem conversa: dispara assim mesmo (o card se move), sem conversation_id", async () => {
    banco.tabelas.conversations = [];
    await rodar();
    expect(disparos[0].context).toMatchObject({ conversation_id: undefined, channel_id: null });
  });
});

describe("a trava do card (decisão do operador): o card fora do funil não é mexido", () => {
  it("CRÍTICO: sem card no funil da automação: sem_card, e o motor nem é chamado", async () => {
    banco.tabelas.deals = [{ id: "card-com", account_id: CONTA, contact_id: "ficha-1", pipeline_id: COMERCIAL, status: "open" }];
    await rodar();
    expect(disparos).toHaveLength(0);
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "sem_card" });
  });

  it("mais de um card nos funis: card_ambiguo", async () => {
    banco.tabelas.deals.push({ id: "card-jur-2", account_id: CONTA, contact_id: "ficha-1", pipeline_id: JURIDICO, status: "open" });
    await rodar();
    expect(disparos).toHaveLength(0);
    expect(fila()[0]).toMatchObject({ resultado: "card_ambiguo" });
  });

  it("nenhuma automação escuta a situação: sem_automacao", async () => {
    banco.tabelas.automations = [automacao("aut-fin", { situacoes: ["finalizado"], pipeline_ids: [JURIDICO] })];
    await rodar();
    expect(fila()[0]).toMatchObject({ resultado: "sem_automacao" });
  });

  it("automação desligada não conta", async () => {
    banco.tabelas.automations[0].is_active = false;
    await rodar();
    expect(disparos).toHaveLength(0);
    expect(fila()[0]).toMatchObject({ resultado: "sem_automacao" });
  });
});

describe("a releitura do vínculo", () => {
  it("vínculo sumiu, ficha apagada, ou de OUTRO escritório: superada", async () => {
    for (const mexer of [
      () => (banco.tabelas.cb_atlas_clientes = []),
      () => (banco.tabelas.cb_atlas_clientes[0].contact_id = null),
      () => (banco.tabelas.cb_atlas_clientes[0].atlas_tenant_id = "outro-escritorio"),
    ]) {
      fila()[0] = mudanca();
      banco.tabelas.cb_atlas_clientes = [vinculo()];
      mexer();
      await rodar();
      expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "superada" });
    }
    expect(disparos).toHaveLength(0);
  });

  it("a situação mudou DE NOVO depois (data guardada mais nova): superada", async () => {
    banco.tabelas.cb_atlas_clientes[0].situacao_desde = "2026-09-30T14:30:00.000Z";
    banco.tabelas.cb_atlas_clientes[0].situacao = "ativo";
    await rodar();
    expect(fila()[0]).toMatchObject({ resultado: "superada" });
  });

  it("mesma data e outra situação no vínculo: superada", async () => {
    banco.tabelas.cb_atlas_clientes[0].situacao = "finalizado";
    await rodar();
    expect(fila()[0]).toMatchObject({ resultado: "superada" });
  });

  it("CRÍTICO (P1-5): a escrita do vínculo ainda não chegou — volta à fila SEM gastar tentativa", async () => {
    banco.tabelas.cb_atlas_clientes[0] = vinculo({ situacao: "ativo", situacao_desde: "2026-06-01T12:00:00.000Z" });
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { devolvidas: 1 } });
    // `processando_desde` fica como a última tentativa: o rodízio da seleção (a fila não trava).
    expect(fila()[0]).toMatchObject({ estado: "pendente", processando_desde: AGORA.toISOString(), tentativas: 0, resultado: null });
    expect(disparos).toHaveLength(0);
  });

  it("CRÍTICO (P1-5): a espera não tem relógio — dias depois, com o vínculo ainda na situação ANTERIOR, segue na fila", async () => {
    // O Atlas ficou dias sem leitura (chave trocada, 429, fora do ar): uma
    // trava de idade marcaria `superada`, a linha `feito` ocuparia a chave e
    // a página relida não a enfileiraria de novo — a mudança se perderia.
    banco.tabelas.cb_atlas_clientes[0] = vinculo({ situacao: "ativo", situacao_desde: null });
    fila()[0] = mudanca({ created_at: new Date(AGORA.getTime() - 5 * 24 * 60 * 60_000).toISOString() });
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "pendente", tentativas: 0, resultado: null });
    // `em_negociacao` vale `ativo`: ainda é a situação anterior.
    banco.tabelas.cb_atlas_clientes[0].situacao = "em_negociacao";
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "pendente", tentativas: 0, resultado: null });
    // A escrita chega: dispara.
    Object.assign(banco.tabelas.cb_atlas_clientes[0], { situacao: "rescindido", situacao_desde: DESDE });
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "disparado" });
    expect(disparos).toHaveLength(1);
  });

  it("o vínculo regravado com OUTRA situação sem a data desta mudança (mudança sem data, o passo): superada na hora", async () => {
    for (const v of [
      { situacao: "rescindido", situacao_desde: null },
      { situacao: "finalizado", situacao_desde: null },
      { situacao: "finalizado", situacao_desde: "2026-06-01T12:00:00.000Z" },
    ]) {
      fila()[0] = mudanca();
      banco.tabelas.cb_atlas_clientes[0] = vinculo(v);
      await rodar();
      expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "superada", tentativas: 1 });
    }
    expect(disparos).toHaveLength(0);
  });
});

describe("nunca repetir o que pode ter rodado (CLAUDE.md 8e)", () => {
  it("CRÍTICO (P1-4): a leitura dos cards falha ANTES de disparar — volta à fila, gastando tentativa; no teto, falhou", async () => {
    banco.falhar.add("deals:select");
    await rodar();
    expect(disparos).toHaveLength(0);
    expect(fila()[0]).toMatchObject({ estado: "pendente", tentativas: 1 });
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "pendente", tentativas: 2 });
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "falhou", tentativas: TETO_DE_TENTATIVAS });
    expect(disparos).toHaveLength(0);
  });

  it("a leitura da conversa falha: volta à fila (nunca dispara sem saber a conversa)", async () => {
    banco.falhar.add("conversations:select");
    await rodar();
    expect(disparos).toHaveLength(0);
    expect(fila()[0]).toMatchObject({ estado: "pendente", tentativas: 1 });
  });

  it("CRÍTICO: cards e conversa são lidos UMA vez, antes de qualquer disparo, com a união dos funis", async () => {
    banco.tabelas.automations.push(automacao("aut-com", { situacoes: ["rescindido"], pipeline_ids: [COMERCIAL] }));
    let leiturasDeCards = 0;
    const original = banco.cliente.from.bind(banco.cliente);
    (banco.cliente as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "deals") {
        leiturasDeCards++;
        // O primeiro disparo já aconteceu quando uma segunda leitura chegasse.
        if (disparos.length > 0) throw new Error("leitura de cards depois de um disparo");
      }
      return original(t);
    };
    await rodar();
    expect(leiturasDeCards).toBe(1);
    // A do Comercial não tem card lá: sem_card; a do Jurídico rodou → disparado.
    expect(disparos).toHaveLength(1);
    expect(fila()[0]).toMatchObject({ resultado: "disparado" });
  });

  it("uma rodou e a outra foi recusada antes de rodar: falhou, NUNCA volta à fila", async () => {
    banco.tabelas.automations.push(automacao("aut-2", { situacoes: ["rescindido"], pipeline_ids: [JURIDICO] }));
    resposta = (i) => (i.context?.automation_id === "aut-2" ? rodou({ executadas: 0, erro: "contact ownership check failed" }) : rodou());
    await rodar();
    expect(disparos).toHaveLength(2);
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "falhou" });
  });

  it("NADA rodou e o motor recusou antes da primeira automação: volta à fila (repetir é seguro)", async () => {
    resposta = () => rodou({ executadas: 0, erro: "automations fetch failed" });
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "pendente", tentativas: 1, resultado: null });
  });

  it("o disparo que estoura depois de começar: falhou, nunca volta", async () => {
    resposta = () => {
      throw new Error("estourou");
    };
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "falhou" });
  });

  it("CRÍTICO: processando há mais que o recolhimento vira falhou (pode ter rodado) — nunca volta à fila", async () => {
    fila()[0] = mudanca({ estado: "processando", processando_desde: new Date(AGORA.getTime() - RECOLHER_MUDANCA_MS - 1000).toISOString(), tentativas: 1 });
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { recolhidas: 1, reivindicadas: 0 } });
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "falhou" });
    expect(disparos).toHaveLength(0);
  });

  it("processando há pouco (outro processo): não é tocada", async () => {
    fila()[0] = mudanca({ estado: "processando", processando_desde: new Date(AGORA.getTime() - 60_000).toISOString(), tentativas: 1 });
    await rodar();
    expect(fila()[0]).toMatchObject({ estado: "processando", resultado: null });
    expect(disparos).toHaveLength(0);
  });

  it("a reivindicação é cercada pelo estado E pelas tentativas: quem mexeu na linha no meio ganha", async () => {
    // Outro processo tentou a mudança entre a leitura da fila e o UPDATE da reivindicação.
    const original = banco.cliente.from.bind(banco.cliente);
    (banco.cliente as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as { update: (v: Record<string, unknown>) => unknown };
      if (t === "cb_atlas_mudancas") {
        const atualizar = q.update.bind(q);
        q.update = (v) => {
          if (v.estado === "processando") fila()[0].tentativas = 1;
          return atualizar(v);
        };
      }
      return q;
    };
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { reivindicadas: 0 } });
    expect(disparos).toHaveLength(0);
    expect(fila()[0]).toMatchObject({ estado: "pendente", tentativas: 1 });
  });
});

describe("prazo, conexão e AMBIENTE", () => {
  it("o prazo da leitura já gasto (listagem longa): o disparo tem a janela PRÓPRIA e reivindica assim mesmo", async () => {
    await rodar({ prazoMs: Date.now() - 1 });
    expect(fila()[0]).toMatchObject({ estado: "feito", resultado: "disparado" });
  });

  it("…e a janela própria também acaba: nenhuma mudança nova é reivindicada depois dela", async () => {
    banco.tabelas.cb_atlas_mudancas = [mudanca(), mudanca({ id: "m2", situacao_desde: "2026-09-30T14:10:00.000Z", atlas_client_id: "a2" })];
    resposta = () => {
      vi.setSystemTime(new Date(Date.now() + JANELA_MINIMA_DO_DISPARO_MS + 1));
      return rodou();
    };
    await rodar({ prazoMs: Date.now() - 1 });
    expect(fila().find((m) => m.id === "m1")).toMatchObject({ resultado: "disparado" });
    expect(fila().find((m) => m.id === "m2")).toMatchObject({ estado: "pendente", tentativas: 0 });
  });

  it("CRÍTICO: a fila não trava — com 20 esperando o vínculo (já tentadas), a NUNCA tentada é a reivindicada", async () => {
    // As 20 esperando a escrita do vínculo têm `processando_desde` (a última
    // tentativa) e são as MAIS VELHAS; a nova vem depois, pelo `created_at`.
    const esperando = Array.from({ length: MUDANCAS_POR_VEZ }, (_, i) =>
      mudanca({
        id: `esperando-${i}`,
        atlas_client_id: `a-esperando-${i}`,
        processando_desde: new Date(AGORA.getTime() - (i + 1) * 60_000).toISOString(),
        created_at: new Date(AGORA.getTime() - 60 * 60_000 + i).toISOString(),
      }),
    );
    banco.tabelas.cb_atlas_mudancas = [...esperando, mudanca({ id: "nova", created_at: AGORA.toISOString() })];
    banco.tabelas.cb_atlas_clientes.push(
      ...esperando.map((m, i) => vinculo({ id: `v-esperando-${i}`, atlas_client_id: m.atlas_client_id, contact_id: `ficha-e${i}`, situacao: "ativo", situacao_desde: null })),
    );
    await rodar();
    expect(fila().find((m) => m.id === "nova")).toMatchObject({ estado: "feito", resultado: "disparado" });
    expect(disparos).toHaveLength(1);
  });

  it("sem conexão neste ambiente: nao_conectado, sem tocar a fila", async () => {
    banco.tabelas.cb_atlas_config = [];
    expect(await rodar()).toEqual({ ok: false, codigo: "nao_conectado" });
    expect(fila()[0]).toMatchObject({ estado: "pendente" });
  });

  it("CRÍTICO: a instância de teste só dispara as mudanças DELA, pelo vínculo DELA", async () => {
    banco.tabelas.cb_atlas_config = [
      { account_id: CONTA, api_url: null, atlas_tenant_id: TENANT },
      { account_id: CONTA, api_url: STAGING, atlas_tenant_id: TENANT },
    ];
    banco.tabelas.cb_atlas_mudancas = [mudanca(), mudanca({ id: "m-stg", api_url: STAGING })];
    banco.tabelas.cb_atlas_clientes = [vinculo(), vinculo({ id: "v-stg", api_url: STAGING, contact_id: "ficha-teste" })];
    banco.tabelas.deals.push({ id: "card-teste", account_id: CONTA, contact_id: "ficha-teste", pipeline_id: JURIDICO, status: "open" });
    await rodar({ ambiente: STAGING });
    expect(disparos).toHaveLength(1);
    expect(disparos[0]).toMatchObject({ contactId: "ficha-teste", context: { deal_id: "card-teste" } });
    expect(fila().find((m) => m.id === "m1")).toMatchObject({ estado: "pendente" });
    expect(fila().find((m) => m.id === "m-stg")).toMatchObject({ resultado: "disparado" });
  });

  it("erro ao ler a fila: db_error, sem disparar", async () => {
    banco.falhar.add("cb_atlas_mudancas:select");
    expect(await rodar()).toMatchObject({ ok: false, codigo: "db_error" });
    expect(disparos).toHaveLength(0);
  });
});

describe("ultimasMudancasDoCartao — o histórico do cartão", () => {
  it("só as mudanças da CONEXÃO atual: trocado o escritório, as do anterior não aparecem (a fila não guarda o escritório)", async () => {
    banco.tabelas.cb_atlas_mudancas = [
      mudanca({ id: "velha", atlas_client_id: "a-velho", created_at: "2026-09-30T10:00:00.000Z", estado: "feito", resultado: "disparado" }),
      mudanca({ id: "nova", created_at: "2026-09-30T14:50:00.000Z" }),
    ];
    banco.tabelas.cb_atlas_clientes = [vinculo()];
    banco.tabelas.contacts = [{ id: "ficha-1", account_id: CONTA, name: "Cliente Fictício", phone: null }];
    const r = await ultimasMudancasDoCartao(banco.cliente, CONTA, null, TENANT, "2026-09-30T12:00:00.000Z");
    expect(r === "db_error" ? r : r.map((m) => m.id)).toEqual(["nova"]);
    // Sem a data da conexão (linha antiga), não recorta.
    const todas = await ultimasMudancasDoCartao(banco.cliente, CONTA, null, TENANT, null);
    expect(todas === "db_error" ? todas : todas.map((m) => m.id)).toEqual(["nova", "velha"]);
  });

  it("do AMBIENTE da instância: a linha do staging não aparece no cartão da produção", async () => {
    banco.tabelas.cb_atlas_mudancas = [mudanca({ id: "do-staging", api_url: STAGING }), mudanca({ id: "da-producao" })];
    banco.tabelas.cb_atlas_clientes = [vinculo()];
    banco.tabelas.contacts = [{ id: "ficha-1", account_id: CONTA, name: "Cliente Fictício", phone: null }];
    const r = await ultimasMudancasDoCartao(banco.cliente, CONTA, null, TENANT, null);
    expect(r === "db_error" ? r : r.map((m) => m.id)).toEqual(["da-producao"]);
  });
});
