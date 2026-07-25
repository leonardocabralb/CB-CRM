import { describe, it, expect, vi, beforeEach } from "vitest";

// ------------------------------------------------------------
// Harness de integração do runner de flows.
//
// Os testes existentes (engine.test.ts) só cobrem helpers puros. Este arquivo
// exercita `dispatchInboundToFlows` de ponta a ponta com um stub de banco,
// para travar dois comportamentos que nenhum teste unitário alcança:
//
//  1. CRÍTICO (Fase A) — quando o sender interativo lança (canal Evolution não
//     tem botões), o run precisa terminar `failed`. Antes ele ficava `active`
//     para sempre, engolindo TODA mensagem seguinte do cliente: sem bot, sem
//     automação, sem IA e sem nenhum evento de erro registrado.
//  2. Fase E2 — o gatilho respeita o canal, e o flow ESPECÍFICO do canal ganha
//     do curinga (senão o curinga, tipicamente mais antigo, engole o
//     específico e o cliente do número do sócio recebe o menu comercial).
// ------------------------------------------------------------

const sendInteractiveButtons = vi.fn();
const sendText = vi.fn();

vi.mock("./meta-send", () => ({
  engineSendText: (...a: unknown[]) => sendText(...a),
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: (...a: unknown[]) => sendInteractiveButtons(...a),
  engineSendInteractiveList: vi.fn(),
}));

/** Estado observável do banco após o dispatch. */
interface Estado {
  runs: Record<string, Record<string, unknown>>;
  eventos: { tipo: string; payload: Record<string, unknown> }[];
  runInserido: Record<string, unknown> | null;
}

let estado: Estado;
let flowsNoBanco: Record<string, unknown>[];

vi.mock("./admin-client", () => ({
  supabaseAdmin: () => makeDb(),
}));

function makeDb() {
  let table = "";
  let mode: "select" | "insert" | "update" = "select";
  let payload: Record<string, unknown> = {};

  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: (p: Record<string, unknown>) => {
      mode = "insert";
      payload = p;
      if (table === "flow_run_events") {
        estado.eventos.push({
          tipo: String(p.event_type),
          payload: (p.payload ?? {}) as Record<string, unknown>,
        });
      }
      return builder;
    },
    update: (p: Record<string, unknown>) => {
      mode = "update";
      payload = p;
      if (table === "flow_runs") {
        estado.runs["r1"] = { ...(estado.runs["r1"] ?? {}), ...p };
      }
      return builder;
    },
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    limit: () => {
      if (table === "flow_runs" && mode === "select") {
        return Promise.resolve({ data: [], error: null }); // sem run ativo
      }
      return Promise.resolve({ data: [], error: null });
    },
    maybeSingle: () => {
      if (table === "flows" && mode === "select") {
        return Promise.resolve({ data: flowsNoBanco[0] ?? null, error: null });
      }
      if (table === "flow_runs" && mode === "insert") {
        estado.runInserido = payload;
        estado.runs["r1"] = { ...payload, id: "r1" };
        return Promise.resolve({ data: { ...payload, id: "r1" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    single: () => builder.maybeSingle as never,
    then: (resolve: (v: unknown) => void) => {
      if (table === "flows" && mode === "select") {
        return resolve({ data: flowsNoBanco, error: null });
      }
      if (table === "flow_nodes" && mode === "select") {
        return resolve({ data: NODES, error: null });
      }
      if (table === "messages" && mode === "select") {
        return resolve({ data: [], error: null });
      }
      return resolve({ data: [], error: null });
    },
  };

  return {
    from: (t: string) => {
      table = t;
      mode = "select";
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

const NODES = [
  {
    id: "n0",
    flow_id: "f1",
    node_key: "start",
    node_type: "start",
    config: { next_node_key: "menu" },
  },
  {
    id: "n1",
    flow_id: "f1",
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "Escolha",
      buttons: [{ reply_id: "a", title: "A", next_node_key: "end" }],
    },
  },
  { id: "n2", flow_id: "f1", node_key: "end", node_type: "end", config: {} },
];

const FLOW_BASE = {
  id: "f1",
  account_id: "acct",
  user_id: "u1",
  name: "Menu",
  status: "active",
  trigger_type: "keyword",
  trigger_config: { keywords: ["oi"], match_type: "contains" },
  entry_node_id: "start",
  fallback_policy: {},
  channel_id: null,
};

const INPUT = {
  accountId: "acct",
  userId: "u1",
  contactId: "c1",
  conversationId: "conv1",
  message: { kind: "text" as const, text: "oi", meta_message_id: "wamid.1" },
  isFirstInboundMessage: true,
};

beforeEach(() => {
  estado = { runs: {}, eventos: [], runInserido: null };
  flowsNoBanco = [{ ...FLOW_BASE }];
  sendInteractiveButtons.mockReset();
  sendText.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("dispatchInboundToFlows — canal do run", () => {
  it("trava o canal de ENTRADA no run", async () => {
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(estado.runInserido?.channel_id).toBe("ch-comercial");
  });

  it("o nó de envio usa o canal do RUN, não o da conversa", async () => {
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(sendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ preferredChannelId: "ch-comercial" }),
    );
  });
});

describe("dispatchInboundToFlows — nó interativo que falha (CRÍTICO)", () => {
  it("termina o run como failed em vez de deixá-lo ativo engolindo mensagens", async () => {
    // É exatamente o que acontece num canal Evolution: o sender lança de
    // propósito porque Baileys não entrega botões.
    sendInteractiveButtons.mockRejectedValue(
      new Error(
        "interactive messages (buttons/lists) are not supported on the Evolution (unofficial) channel",
      ),
    );
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-evolution" });

    expect(estado.runs["r1"]?.status).toBe("failed");
    expect(estado.runs["r1"]?.end_reason).toBe("send_interactive_failed");
  });

  it("registra o motivo do erro no histórico do run", async () => {
    sendInteractiveButtons.mockRejectedValue(new Error("boom da Evolution"));
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-evolution" });

    const erro = estado.eventos.find((e) => e.tipo === "error");
    expect(erro?.payload.reason).toBe("send_interactive_failed");
    expect(String(erro?.payload.detail)).toContain("boom da Evolution");
  });
});

describe("findEntryFlow — prioridade de canal", () => {
  it("o flow ESPECÍFICO do canal ganha do curinga, mesmo sendo mais novo", async () => {
    // Sem esta regra o curinga (criado antes, e a lista vem ordenada por
    // created_at) engoliria o específico: o cliente que escreve para o número
    // do sócio receberia o menu comercial, com a identidade errada.
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "w" });
    flowsNoBanco = [
      { ...FLOW_BASE, id: "f-curinga", channel_id: null },
      { ...FLOW_BASE, id: "f-socio", channel_id: "ch-socio" },
    ];
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-socio" });

    expect(estado.runInserido?.flow_id).toBe("f-socio");
  });

  it("cai no curinga quando nenhum flow é daquele canal", async () => {
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "w" });
    flowsNoBanco = [
      { ...FLOW_BASE, id: "f-curinga", channel_id: null },
      { ...FLOW_BASE, id: "f-outro", channel_id: "ch-outro" },
    ];
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(estado.runInserido?.flow_id).toBe("f-curinga");
  });

  it("flow restrito NÃO dispara em canal alheio", async () => {
    flowsNoBanco = [{ ...FLOW_BASE, id: "f-socio", channel_id: "ch-socio" }];
    const { dispatchInboundToFlows } = await import("./engine");

    const r = await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(r.consumed).toBe(false);
    expect(estado.runInserido).toBeNull();
  });

  it("inbound SEM canal (pré-Fase 3) ainda casa com flow restrito", async () => {
    // O oposto esconderia o flow de todo inbound não carimbado.
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "w" });
    flowsNoBanco = [{ ...FLOW_BASE, id: "f-socio", channel_id: "ch-socio" }];
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: null });

    expect(estado.runInserido?.flow_id).toBe("f-socio");
  });
});
