import { beforeEach, describe, expect, it, vi } from "vitest";

// ------------------------------------------------------------
// O robô de ponta a ponta (26/09/2026): a resposta vai para a FICHA, a
// gravação que falha NÃO segura o cliente no meio do robô, e o "Enviar mídia"
// manda o arquivo do acervo — áudio como nota de voz, sem legenda.
//
// Mesma forma de harness do `engine-channel.test.ts`: o motor de verdade
// contra um banco falso, com os envios e as duas peças de I/O novas trocadas
// por espiões (as regras delas têm teste próprio).
// ------------------------------------------------------------

const sendText = vi.fn();
const sendMedia = vi.fn();
const sendButtons = vi.fn();

vi.mock("./meta-send", () => ({
  engineSendText: (...a: unknown[]) => sendText(...a),
  engineSendMedia: (...a: unknown[]) => sendMedia(...a),
  engineSendInteractiveButtons: (...a: unknown[]) => sendButtons(...a),
  engineSendInteractiveList: vi.fn(),
}));

const gravar = vi.fn();
vi.mock("./resposta-na-ficha", async (importOriginal) => {
  const real = await importOriginal<typeof import("./resposta-na-ficha")>();
  return { ...real, gravarRespostaNaFicha: (...a: unknown[]) => gravar(...a) };
});

const preparar = vi.fn();
vi.mock("./midia-do-no", async (importOriginal) => {
  const real = await importOriginal<typeof import("./midia-do-no")>();
  return { ...real, prepararMidiaDoNo: (...a: unknown[]) => preparar(...a) };
});

let eventos: { tipo: string; payload: Record<string, unknown> }[];
let runsAtivos: Record<string, unknown>[];
let nos: Record<string, unknown>[];
let flows: Record<string, unknown>[];

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
        eventos.push({ tipo: String(p.event_type), payload: (p.payload ?? {}) as Record<string, unknown> });
      }
      return b;
    },
    update: () => {
      mode = "update";
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
      if (table === "flows") return Promise.resolve({ data: flows[0] ?? null, error: null });
      if (table === "flow_runs" && mode === "insert") {
        return Promise.resolve({ data: { ...payload, id: "r-novo", vars: {}, reprompt_count: 0 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    then: (resolve: (v: unknown) => void) => {
      if (table === "flows" && mode === "select") return resolve({ data: flows, error: null });
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

const RUN_BASE = {
  id: "r1",
  flow_id: "f1",
  account_id: "acc",
  user_id: "u1",
  contact_id: "ct",
  conversation_id: "conv",
  status: "active",
  channel_id: "ch",
  vars: { area: "trabalho" },
  reprompt_count: 0,
};

const FIM = { id: "n9", flow_id: "f1", node_key: "fim", node_type: "end", config: {} };
const OBRIGADO = {
  id: "n8",
  flow_id: "f1",
  node_key: "obrigado",
  node_type: "send_message",
  config: { text: "Obrigado!", next_node_key: "fim" },
};

beforeEach(() => {
  eventos = [];
  runsAtivos = [];
  flows = [];
  nos = [];
  for (const f of [sendText, sendMedia, sendButtons, gravar, preparar]) f.mockReset();
  sendText.mockResolvedValue({ whatsapp_message_id: "wamid.t" });
  sendMedia.mockResolvedValue({ whatsapp_message_id: "wamid.m" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Coletar resposta → ficha", () => {
  const COLETAR = {
    id: "n1",
    flow_id: "f1",
    node_key: "nome",
    node_type: "collect_input",
    config: { prompt_text: "Seu nome?", var_key: "nome", next_node_key: "obrigado", salvar_em: "name" },
  };

  it("grava a resposta no NOME e segue o robô", async () => {
    runsAtivos = [{ ...RUN_BASE, current_node_key: "nome" }];
    nos = [COLETAR, OBRIGADO, FIM];
    gravar.mockResolvedValue({ gravou: true, detalhe: "name saved" });
    const { dispatchInboundToFlows } = await import("./engine");

    const r = await dispatchInboundToFlows({
      accountId: "acc",
      userId: "u1",
      contactId: "ct",
      conversationId: "conv",
      message: { kind: "text", text: "  Joana da Silva ", meta_message_id: "wamid.in" },
      isFirstInboundMessage: false,
    });

    expect(r.consumed).toBe(true);
    expect(gravar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: "acc",
        contactId: "ct",
        destino: { tipo: "nome" },
        valor: "Joana da Silva",
      }),
    );
    // O evento guarda o DESTINO, nunca o texto do cliente.
    const salvo = eventos.find((e) => e.payload.saved_to === "name");
    expect(salvo).toBeTruthy();
    expect(JSON.stringify(eventos)).not.toContain("Joana");
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
  });

  it("CRÍTICO: gravação que falha NÃO prende o cliente — registra e segue", async () => {
    runsAtivos = [{ ...RUN_BASE, current_node_key: "nome" }];
    nos = [COLETAR, OBRIGADO, FIM];
    gravar.mockRejectedValue(new Error("name update failed: timeout"));
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      accountId: "acc",
      userId: "u1",
      contactId: "ct",
      conversationId: "conv",
      message: { kind: "text", text: "Joana", meta_message_id: "wamid.in2" },
      isFirstInboundMessage: false,
    });

    expect(eventos.some((e) => e.tipo === "error" && e.payload.reason === "save_answer_failed")).toBe(true);
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
  });

  it("nó sem `salvar_em` (todo robô antigo) não grava nada", async () => {
    runsAtivos = [{ ...RUN_BASE, current_node_key: "nome" }];
    nos = [{ ...COLETAR, config: { ...COLETAR.config, salvar_em: undefined } }, OBRIGADO, FIM];
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      accountId: "acc",
      userId: "u1",
      contactId: "ct",
      conversationId: "conv",
      message: { kind: "text", text: "Joana", meta_message_id: "wamid.in3" },
      isFirstInboundMessage: false,
    });

    expect(gravar).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalled();
  });
});

describe("Enviar botões → ficha", () => {
  it("grava o TÍTULO da opção tocada, com as variáveis do run", async () => {
    runsAtivos = [{ ...RUN_BASE, current_node_key: "encostado" }];
    nos = [
      {
        id: "n1",
        flow_id: "f1",
        node_key: "encostado",
        node_type: "send_buttons",
        config: {
          text: "Ficou encostado?",
          salvar_em: "custom:f-prev",
          buttons: [
            { reply_id: "sim", title: "Sim ({{vars.area}})", next_node_key: "obrigado" },
            { reply_id: "nao", title: "Não", next_node_key: "fim" },
          ],
        },
      },
      OBRIGADO,
      FIM,
    ];
    gravar.mockResolvedValue({ gravou: true, detalhe: "field saved" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      accountId: "acc",
      userId: "u1",
      contactId: "ct",
      conversationId: "conv",
      message: { kind: "interactive_reply", reply_id: "sim", reply_title: "qualquer", meta_message_id: "wamid.b" },
      isFirstInboundMessage: false,
    });

    expect(gravar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destino: { tipo: "campo", campoId: "f-prev" },
        valor: "Sim (trabalho)",
      }),
    );
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
  });
});

describe("Enviar lista → ficha", () => {
  it("grava o TÍTULO da linha tocada", async () => {
    runsAtivos = [{ ...RUN_BASE, current_node_key: "sequela" }];
    nos = [
      {
        id: "n1",
        flow_id: "f1",
        node_key: "sequela",
        node_type: "send_list",
        config: {
          text: "Ficou com sequela?",
          button_label: "Ver opções",
          salvar_em: "custom:f-sequela",
          sections: [
            {
              rows: [
                { reply_id: "limitacao", title: "Estou com limitação", next_node_key: "obrigado" },
                { reply_id: "nenhuma", title: "Não tive sequelas", next_node_key: "fim" },
              ],
            },
          ],
        },
      },
      OBRIGADO,
      FIM,
    ];
    gravar.mockResolvedValue({ gravou: true, detalhe: "field saved" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      accountId: "acc",
      userId: "u1",
      contactId: "ct",
      conversationId: "conv",
      message: {
        kind: "interactive_reply",
        reply_id: "limitacao",
        reply_title: "o transporte pode devolver outra coisa",
        meta_message_id: "wamid.l",
      },
      isFirstInboundMessage: false,
    });

    expect(gravar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        destino: { tipo: "campo", campoId: "f-sequela" },
        valor: "Estou com limitação",
      }),
    );
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ text: "Obrigado!" }));
  });
});

describe("Enviar mídia do acervo", () => {
  it("áudio sai como nota de voz: kind audio, a CÓPIA e SEM legenda", async () => {
    flows = [
      {
        id: "f1",
        account_id: "acc",
        user_id: "u1",
        name: "Pré",
        status: "active",
        trigger_type: "keyword",
        trigger_config: { keywords: ["auxilio"] },
        entry_node_id: "audio",
        fallback_policy: {},
        channel_id: null,
      },
    ];
    nos = [
      {
        id: "n1",
        flow_id: "f1",
        node_key: "audio",
        node_type: "send_media",
        config: {
          media_type: "audio",
          acervo_id: "item-1",
          media_url: "https://storage/acervo/boas-vindas.ogg",
          caption: "não deveria sair",
          next_node_key: "fim",
        },
      },
      FIM,
    ];
    preparar.mockResolvedValue({
      tipo: "audio",
      link: "https://storage/account-acc/123-boas-vindas.ogg",
      filename: "boas-vindas.ogg",
      copia: "account-acc/123-boas-vindas.ogg",
    });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      accountId: "acc",
      userId: "u1",
      contactId: "ct",
      conversationId: "conv",
      message: { kind: "text", text: "auxilio", meta_message_id: "wamid.k" },
      isFirstInboundMessage: false,
      channelId: "ch",
    });

    expect(preparar).toHaveBeenCalledWith(expect.anything(), "acc", expect.objectContaining({ acervo_id: "item-1" }));
    expect(sendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "audio",
        link: "https://storage/account-acc/123-boas-vindas.ogg",
        caption: undefined,
        preferredChannelId: "ch",
      }),
    );
  });

  it("item apagado do acervo: o run falha VISÍVEL, sem enviar nada", async () => {
    flows = [
      {
        id: "f1",
        account_id: "acc",
        user_id: "u1",
        name: "Pré",
        status: "active",
        trigger_type: "keyword",
        trigger_config: { keywords: ["auxilio"] },
        entry_node_id: "audio",
        fallback_policy: {},
        channel_id: null,
      },
    ];
    nos = [
      {
        id: "n1",
        flow_id: "f1",
        node_key: "audio",
        node_type: "send_media",
        config: { media_type: "audio", acervo_id: "item-apagado", media_url: "", next_node_key: "fim" },
      },
      FIM,
    ];
    preparar.mockRejectedValue(new Error("the media library item was deleted — pick another file in the robot"));
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      accountId: "acc",
      userId: "u1",
      contactId: "ct",
      conversationId: "conv",
      message: { kind: "text", text: "auxilio", meta_message_id: "wamid.k2" },
      isFirstInboundMessage: false,
    });

    expect(sendMedia).not.toHaveBeenCalled();
    expect(
      eventos.some((e) => e.tipo === "error" && e.payload.reason === "send_media_failed"),
    ).toBe(true);
  });
});
