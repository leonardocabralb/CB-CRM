import { beforeEach, describe, expect, it, vi } from "vitest";

// ------------------------------------------------------------
// O nó "Transferir para atendente" dentro do motor do robô, com o "Atribuir
// a" (2.7): a conversa vira "pendente" SEMPRE; recebe o responsável só quando
// o escolhido ainda é membro da conta do robô. Mesma forma de harness do
// `engine-mover-card.test.ts`: o motor de verdade contra um banco falso, com
// a conferência do membro trocada por um espião (a regra dela tem teste
// próprio, `atribuir-no-handoff.test.ts`).
// ------------------------------------------------------------

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(),
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}));

const atribuicao = vi.fn();
vi.mock("./atribuir-no-handoff", async (importOriginal) => {
  const real = await importOriginal<typeof import("./atribuir-no-handoff")>();
  return { ...real, atribuicaoDoHandoff: (...a: unknown[]) => atribuicao(...a) };
});

let eventos: { tipo: string; node: string | null; payload: Record<string, unknown> }[];
let runsAtivos: Record<string, unknown>[];
let nos: Record<string, unknown>[];
let fimDoRun: Record<string, unknown>[];
let conversas: Record<string, unknown>[];

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
      if (table === "conversations") conversas.push(p);
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

const MEMBRO = "582aad06-4836-4865-b850-0466fff8bc7d";

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

function nosCom(handoffConfig: Record<string, unknown>) {
  return [
    {
      id: "n1",
      flow_id: "robo-prev",
      node_key: "nome",
      node_type: "collect_input",
      config: { prompt_text: "Seu nome?", var_key: "nome", next_node_key: "closer" },
    },
    { id: "n2", flow_id: "robo-prev", node_key: "closer", node_type: "handoff", config: handoffConfig },
  ];
}

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
  conversas = [];
  runsAtivos = [{ ...RUN }];
  atribuicao.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("nó handoff — Atribuir a", () => {
  it("em branco (o robô do previdenciário, A7): pendente SEM responsável, sem consultar membros", async () => {
    nos = nosCom({ note: "qualificado" });
    await responder();

    expect(atribuicao).not.toHaveBeenCalled();
    expect(conversas).toHaveLength(1);
    expect(conversas[0]).toMatchObject({ status: "pending" });
    expect(conversas[0]).not.toHaveProperty("assigned_agent_id");
    const ev = eventos.find((e) => e.tipo === "handoff");
    expect(ev?.payload).toEqual({ note: "qualificado", assigned_to: null });
    expect(fimDoRun.at(-1)).toMatchObject({ status: "handed_off" });
  });

  it("membro da conta: atribui pela CONTA DO RUN", async () => {
    nos = nosCom({ assign_to: MEMBRO });
    atribuicao.mockResolvedValue({ userId: MEMBRO });
    await responder();

    expect(atribuicao).toHaveBeenCalledWith(expect.anything(), "acc", MEMBRO);
    expect(conversas[0]).toMatchObject({ status: "pending", assigned_agent_id: MEMBRO });
    expect(eventos.find((e) => e.tipo === "handoff")?.payload).toMatchObject({ assigned_to: MEMBRO });
  });

  it("CRÍTICO: quem saiu da conta NÃO recebe a conversa; ela fica pendente e o evento diz por quê", async () => {
    nos = nosCom({ assign_to: MEMBRO });
    atribuicao.mockResolvedValue({ userId: null, motivo: "nao_membro" });
    await responder();

    expect(conversas[0]).toMatchObject({ status: "pending" });
    expect(conversas[0]).not.toHaveProperty("assigned_agent_id");
    expect(eventos.find((e) => e.tipo === "handoff")?.payload).toMatchObject({
      assigned_to: null,
      assign_requested: MEMBRO,
      assign_skipped: "nao_membro",
    });
    expect(fimDoRun.at(-1)).toMatchObject({ status: "handed_off" });
  });

  it("leitura que falha: não atribui (a conversa cai na fila sem responsável)", async () => {
    nos = nosCom({ assign_to: MEMBRO });
    atribuicao.mockResolvedValue({ userId: null, motivo: "leitura_falhou" });
    await responder();

    expect(conversas[0]).not.toHaveProperty("assigned_agent_id");
    expect(eventos.find((e) => e.tipo === "handoff")?.payload).toMatchObject({
      assign_skipped: "leitura_falhou",
    });
  });
});
