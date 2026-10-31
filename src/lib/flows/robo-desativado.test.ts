import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// Robô PAUSADO não segue respondendo quem estava no meio dele (adaptado do
// #674 do original). Desativar o robô só barrava a ENTRADA (`findEntryFlow`
// lê só os ativos): o cliente que já estava numa pergunta continuava
// recebendo a seguinte. O motor de verdade contra um banco falso que aplica
// os filtros `eq` — a cerca do encerramento (id + `status = 'active'`) é o que
// impede de encerrar a run errada.
// ============================================================

type Linha = Record<string, unknown>;

const h = vi.hoisted(() => ({
  tabelas: {} as Record<string, Record<string, unknown>[]>,
  updates: [] as { tabela: string; payload: Record<string, unknown>; filtros: [string, unknown][] }[],
  inserts: [] as { tabela: string; linha: Record<string, unknown> }[],
  erroAoLerRobo: false,
  erroAoEncerrar: false,
  /** Encena outro caminho encerrando a run ENTRE a leitura e o UPDATE. */
  corridaNoEncerramento: false,
}));

vi.mock("./admin-client", () => {
  function builder(tabela: string) {
    const e = {
      op: "select",
      payload: null as Linha | null,
      filtros: [] as [string, unknown][],
      contagem: false,
      limite: undefined as number | undefined,
    };
    const casam = () =>
      (h.tabelas[tabela] ??= []).filter((l) => e.filtros.every(([k, v]) => l[k] === v));
    const executar = (unico: boolean) => {
      if (e.op === "update") {
        h.updates.push({ tabela, payload: e.payload as Linha, filtros: [...e.filtros] });
        if (tabela === "flow_runs" && (e.payload as Linha).status === "stopped_by_agent") {
          if (h.erroAoEncerrar) return { data: null, error: { message: "banco fora" } };
          if (h.corridaNoEncerramento) for (const l of h.tabelas.flow_runs) l.status = "completed";
        }
        const alvo = casam();
        for (const l of alvo) Object.assign(l, e.payload);
        return { data: alvo.map((l) => ({ id: l.id })), error: null };
      }
      if (e.op === "insert") {
        const linha = { id: tabela === "flow_runs" ? "r-novo" : `ev-${h.inserts.length}`, vars: {}, reprompt_count: 0, ...(e.payload as Linha) };
        h.inserts.push({ tabela, linha });
        (h.tabelas[tabela] ??= []).push(linha);
        return { data: unico ? { ...linha } : [{ ...linha }], error: null };
      }
      if (tabela === "flows" && unico && h.erroAoLerRobo) {
        return { data: null, error: { message: "timeout" } };
      }
      if (e.contagem) return { data: null, error: null, count: 0 };
      const lista = e.limite === undefined ? casam() : casam().slice(0, e.limite);
      if (unico) return { data: lista[0] ? { ...lista[0] } : null, error: null };
      return { data: lista.map((l) => ({ ...l })), error: null };
    };
    const b: Record<string, unknown> = {
      select: (_c?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) e.contagem = true;
        return b;
      },
      update: (p: Linha) => ((e.op = "update"), (e.payload = p), b),
      insert: (p: Linha) => ((e.op = "insert"), (e.payload = p), b),
      eq: (k: string, v: unknown) => (e.filtros.push([k, v]), b),
      is: () => b,
      in: () => b,
      filter: () => b,
      order: () => b,
      limit: (n: number) => ((e.limite = n), b),
      maybeSingle: async () => executar(true),
      single: async () => executar(true),
      then: (ok: (v: unknown) => unknown, erro?: (x: unknown) => unknown) =>
        Promise.resolve(executar(false)).then(ok, erro),
    };
    return b;
  }
  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
  };
});

const envio = vi.hoisted(() => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "wamid.out" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.out" })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: "wamid.out" })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: "wamid.out" })),
}));
vi.mock("./meta-send", () => envio);

import { dispatchInboundToFlows } from "./engine";
import { MOTIVO_ROBO_DESATIVADO } from "./parar-run";

const robo = (id: string, status: string, over: Linha = {}): Linha => ({
  id,
  account_id: "acct",
  user_id: "u1",
  name: id,
  status,
  trigger_type: "manual",
  trigger_config: {},
  entry_node_id: "pergunta",
  fallback_policy: {},
  channel_id: null,
  created_at: "2026-10-01T00:00:00.000Z",
  ...over,
});

const RUN = {
  id: "r1",
  flow_id: "robo-pausado",
  account_id: "acct",
  user_id: "u1",
  contact_id: "c1",
  conversation_id: "conv1",
  status: "active",
  current_node_key: "pergunta",
  channel_id: "ch",
  vars: {},
  reprompt_count: 0,
  started_at: "2026-10-25T10:00:00.000Z",
  last_advanced_at: "2026-10-25T10:00:00.000Z",
};

const NOS_DO_PAUSADO = [
  {
    id: "n1",
    flow_id: "robo-pausado",
    node_key: "pergunta",
    node_type: "collect_input",
    config: { prompt_text: "Seu nome?", var_key: "nome", next_node_key: "segunda" },
  },
  { id: "n2", flow_id: "robo-pausado", node_key: "segunda", node_type: "send_message", config: { text: "Obrigado, {{vars.nome}}!", next_node_key: "fim" } },
  { id: "n3", flow_id: "robo-pausado", node_key: "fim", node_type: "end", config: {} },
];

function responder(texto = "Maria") {
  return dispatchInboundToFlows({
    accountId: "acct",
    userId: "u1",
    contactId: "c1",
    conversationId: "conv1",
    message: { kind: "text", text: texto, meta_message_id: `wamid.${Math.random()}` },
    isFirstInboundMessage: false,
  });
}

const encerramentos = () =>
  h.updates.filter((u) => u.tabela === "flow_runs" && u.payload.status === "stopped_by_agent");

beforeEach(() => {
  h.tabelas = {
    flow_runs: [{ ...RUN }],
    flows: [robo("robo-pausado", "draft")],
    flow_nodes: NOS_DO_PAUSADO.map((n) => ({ ...n })),
    flow_run_events: [],
  };
  h.updates = [];
  h.inserts = [];
  h.erroAoLerRobo = false;
  h.erroAoEncerrar = false;
  h.corridaNoEncerramento = false;
  for (const f of Object.values(envio)) f.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("robô que não está ativo, com o cliente no meio dele", () => {
  for (const status of ["draft", "archived"]) {
    it(`${status}: encerra a run (parada pela equipe, motivo próprio) e o robô NÃO responde`, async () => {
      h.tabelas.flows = [robo("robo-pausado", status)];

      const r = await responder();

      expect(encerramentos()).toHaveLength(1);
      expect(encerramentos()[0].payload).toMatchObject({
        status: "stopped_by_agent",
        end_reason: MOTIVO_ROBO_DESATIVADO,
        ended_at: expect.any(String),
      });
      // A cerca: AQUELA run, e só se ela ainda estiver ativa.
      expect(encerramentos()[0].filtros).toEqual([
        ["id", "r1"],
        ["status", "active"],
      ]);
      // A pergunta seguinte não saiu, e a resposta não foi gravada na run.
      for (const f of Object.values(envio)) expect(f).not.toHaveBeenCalled();
      expect(h.tabelas.flow_run_events.some((e) => e.event_type === "reply_received")).toBe(false);
      // Segue como se não houvesse run: a mensagem vai às automações e à IA.
      expect(r).toEqual({ consumed: false, outcome: "no_match" });
    });
  }

  it("segue como se não houvesse run: outro robô ATIVO cujo gatilho casa começa", async () => {
    h.tabelas.flows = [
      robo("robo-pausado", "draft"),
      robo("robo-vivo", "active", { trigger_type: "keyword", trigger_config: { keywords: ["maria"] }, entry_node_id: "oi" }),
    ];
    h.tabelas.flow_nodes.push(
      { id: "v1", flow_id: "robo-vivo", node_key: "oi", node_type: "send_message", config: { text: "Oi!", next_node_key: "tchau" } },
      { id: "v2", flow_id: "robo-vivo", node_key: "tchau", node_type: "end", config: {} },
    );

    const r = await responder("Maria");

    expect(encerramentos()).toHaveLength(1);
    const novas = h.inserts.filter((i) => i.tabela === "flow_runs");
    expect(novas).toHaveLength(1);
    // Nasceu do robô vivo e correu até o fim dele (o nó `end`).
    expect(novas[0].linha).toMatchObject({ flow_id: "robo-vivo", status: "completed" });
    expect(envio.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Oi!" }));
    expect(r.consumed).toBe(true);
  });

  it("robô ATIVO: a resposta segue para a run, como sempre", async () => {
    h.tabelas.flows = [robo("robo-pausado", "active")];

    const r = await responder("Maria");

    expect(encerramentos()).toEqual([]);
    expect(h.tabelas.flow_run_events.some((e) => e.event_type === "reply_received")).toBe(true);
    expect(envio.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado, Maria!" }));
    expect(r.consumed).toBe(true);
  });

  it('leitura do robô que FALHA é "não sei": a run segue como antes (nunca encerra às cegas)', async () => {
    h.erroAoLerRobo = true;

    const r = await responder("Maria");

    expect(encerramentos()).toEqual([]);
    expect(envio.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado, Maria!" }));
    expect(r.consumed).toBe(true);
  });

  it("encerramento que FALHA: o robô pausado não responde e nenhuma run nova começa por cima", async () => {
    h.erroAoEncerrar = true;
    h.tabelas.flows = [
      robo("robo-pausado", "draft"),
      robo("robo-vivo", "active", { trigger_type: "keyword", trigger_config: { keywords: ["maria"] }, entry_node_id: "oi" }),
    ];

    const r = await responder("Maria");

    expect(h.inserts.filter((i) => i.tabela === "flow_runs")).toEqual([]);
    for (const f of Object.values(envio)) expect(f).not.toHaveBeenCalled();
    expect(r).toEqual({ consumed: false, outcome: "no_match" });
  });

  it("a run que terminou por outro caminho no meio-tempo não é sobrescrita (a cerca), e a mensagem segue", async () => {
    h.corridaNoEncerramento = true;

    const r = await responder();

    // O UPDATE cercado por `status = 'active'` não casou: o desfecho do outro
    // caminho fica, e nada é dito ao cliente.
    expect(encerramentos()).toHaveLength(1);
    expect(h.tabelas.flow_runs[0]).toMatchObject({ status: "completed" });
    expect(h.tabelas.flow_runs[0].end_reason).toBeUndefined();
    for (const f of Object.values(envio)) expect(f).not.toHaveBeenCalled();
    expect(r).toEqual({ consumed: false, outcome: "no_match" });
  });
});
