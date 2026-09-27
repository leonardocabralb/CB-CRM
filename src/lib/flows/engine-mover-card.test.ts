import { beforeEach, describe, expect, it, vi } from "vitest";

// ------------------------------------------------------------
// O nó "Mover card de etapa" dentro do motor do robô (1053): o que o nó fez
// vai para o registro do run, e o robô SEGUE em todos os casos — movido,
// recusado pela trava de origem, e até quando a escrita FALHA (decisão: o
// card é bastidor; encerrar largaria o lead no meio da pré-qualificação).
//
// Mesma forma de harness do `engine-ficha.test.ts`: o motor de verdade contra
// um banco falso, com `moverCardDoNo` trocado por um espião (a regra dele tem
// teste próprio, `mover-card.test.ts`).
// ------------------------------------------------------------

const sendText = vi.fn();

vi.mock("./meta-send", () => ({
  engineSendText: (...a: unknown[]) => sendText(...a),
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}));

const mover = vi.fn();
vi.mock("./mover-card", async (importOriginal) => {
  const real = await importOriginal<typeof import("./mover-card")>();
  return { ...real, moverCardDoNo: (...a: unknown[]) => mover(...a) };
});

let eventos: { tipo: string; node: string | null; payload: Record<string, unknown> }[];
let runsAtivos: Record<string, unknown>[];
let nos: Record<string, unknown>[];
let fimDoRun: Record<string, unknown>[];

vi.mock("./admin-client", () => ({ supabaseAdmin: () => makeDb() }));

function makeDb() {
  let table = "";
  let mode: "select" | "insert" | "update" = "select";
  let payload: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (p: Record<string, unknown>) => {
      mode = "insert";
      payload = p;
      if (table === "flow_run_events") {
        eventos.push({
          tipo: String(p.event_type),
          node: (p.node_key as string | null) ?? null,
          payload: (p.payload ?? {}) as Record<string, unknown>,
        });
      }
      return b;
    },
    update: (p: Record<string, unknown>) => {
      mode = "update";
      if (table === "flow_runs" && p.status) fimDoRun.push(p);
      return b;
    },
    eq: () => b,
    is: () => b,
    in: () => b,
    filter: () => b,
    order: () => b,
    limit: () =>
      Promise.resolve({
        data: table === "flow_runs" && mode === "select" ? runsAtivos : [],
        error: null,
      }),
    maybeSingle: () => {
      if (table === "flow_runs" && mode === "insert") {
        return Promise.resolve({ data: { ...payload, id: "r-novo", vars: {}, reprompt_count: 0 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then: (resolve: (v: unknown) => void) => {
      if (table === "flow_nodes") return resolve({ data: nos, error: null });
      return resolve({ data: [], error: null, count: 0 });
    },
  };
  return {
    from: (t: string) => {
      table = t;
      mode = "select";
      return b;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

const RUN = {
  id: "r1",
  flow_id: "robo-prev",
  account_id: "acc",
  user_id: "autor",
  contact_id: "ct",
  conversation_id: "conv",
  status: "active",
  channel_id: "ch",
  vars: {},
  reprompt_count: 0,
  current_node_key: "nome",
};

const NOS = [
  {
    id: "n1",
    flow_id: "robo-prev",
    node_key: "nome",
    node_type: "collect_input",
    config: { prompt_text: "Seu nome?", var_key: "nome", next_node_key: "mover" },
  },
  {
    id: "n2",
    flow_id: "robo-prev",
    node_key: "mover",
    node_type: "move_deal_stage",
    config: {
      pipeline_id: "funil-prev",
      stage_id: "etapa-mql",
      origem_stage_ids: ["etapa-pre"],
      next_node_key: "obrigado",
    },
  },
  {
    id: "n3",
    flow_id: "robo-prev",
    node_key: "obrigado",
    node_type: "send_message",
    config: { text: "Obrigado!", next_node_key: "fim" },
  },
  { id: "n4", flow_id: "robo-prev", node_key: "fim", node_type: "end", config: {} },
];

async function responder() {
  const { dispatchInboundToFlows } = await import("./engine");
  return dispatchInboundToFlows({
    accountId: "acc",
    userId: "u1",
    contactId: "ct",
    conversationId: "conv",
    message: { kind: "text", text: "Maria", meta_message_id: `wamid.${Math.random()}` },
    isFirstInboundMessage: false,
  });
}

beforeEach(() => {
  eventos = [];
  fimDoRun = [];
  runsAtivos = [{ ...RUN }];
  nos = NOS;
  sendText.mockReset();
  mover.mockReset();
  sendText.mockResolvedValue({ whatsapp_message_id: "wamid.t" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("nó move_deal_stage no robô", () => {
  it("move o card com os dados do RUN e segue o robô", async () => {
    mover.mockResolvedValue({ resultado: "movido", dealId: "deal-1", statusGravado: "open" });
    await responder();

    expect(mover).toHaveBeenCalledWith(
      expect.anything(),
      {
        accountId: "acc",
        userId: "autor",
        flowId: "robo-prev",
        contactId: "ct",
        conversationId: "conv",
        channelId: "ch",
      },
      expect.objectContaining({ stage_id: "etapa-mql", origem_stage_ids: ["etapa-pre"] }),
    );
    const registro = eventos.find((e) => e.node === "mover" && e.payload.deal === "moved");
    expect(registro?.payload).toMatchObject({ deal_id: "deal-1" });
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
    expect(fimDoRun.at(-1)).toMatchObject({ status: "completed" });
  });

  it("TRAVA DE ORIGEM: não moveu, o MOTIVO fica no registro e o robô segue", async () => {
    mover.mockResolvedValue({ resultado: "fora_da_origem", dealId: "deal-1", etapaAtual: "etapa-bancario" });
    await responder();

    const registro = eventos.find((e) => e.node === "mover" && e.payload.deal === "not_moved");
    expect(registro?.payload.reason).toMatch(/outside the allowed origin/);
    expect(eventos.some((e) => e.tipo === "error")).toBe(false);
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
    expect(fimDoRun.at(-1)).toMatchObject({ status: "completed" });
  });

  it("sem card: o criado vai ao registro e o robô segue", async () => {
    mover.mockResolvedValue({ resultado: "criado", dealId: "novo" });
    await responder();
    expect(eventos.some((e) => e.node === "mover" && e.payload.deal === "created")).toBe(true);
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
  });

  it("CRÍTICO: falha da RPC NÃO trava nem encerra o robô — registra `move_deal_failed` e SEGUE", async () => {
    mover.mockRejectedValue(new Error("move refused: o negocio deixou de estar open durante a automacao"));
    await responder();

    const erro = eventos.find((e) => e.tipo === "error" && e.node === "mover");
    expect(erro?.payload).toMatchObject({ reason: "move_deal_failed" });
    expect(String(erro?.payload.detail)).toMatch(/deixou de estar open/);
    // O robô seguiu até o fim, sem `failed`.
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
    expect(fimDoRun.some((u) => u.status === "failed")).toBe(false);
    expect(fimDoRun.at(-1)).toMatchObject({ status: "completed" });
  });
});
