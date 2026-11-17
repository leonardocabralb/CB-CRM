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
const sendInteractiveList = vi.fn();
const sendText = vi.fn();

vi.mock("./meta-send", () => ({
  engineSendText: (...a: unknown[]) => sendText(...a),
  engineSendMedia: vi.fn(),
  engineSendInteractiveButtons: (...a: unknown[]) => sendInteractiveButtons(...a),
  engineSendInteractiveList: (...a: unknown[]) => sendInteractiveList(...a),
}));

/** Estado observável do banco após o dispatch. */
interface Estado {
  runs: Record<string, Record<string, unknown>>;
  eventos: { tipo: string; payload: Record<string, unknown> }[];
  runInserido: Record<string, unknown> | null;
}

let estado: Estado;
let flowsNoBanco: Record<string, unknown>[];
let nosNoBanco: Record<string, unknown>[];
/** O run que `loadActiveRunForContact` enxerga. Vazio = nenhum em curso. */
let runsAtivos: Record<string, unknown>[];
/** A leitura de `flow_nodes` falha (erro passageiro do banco). */
let erroNosNos: boolean;

vi.mock("./admin-client", () => ({
  supabaseAdmin: () => makeDb(),
}));

function makeDb() {
  let table = "";
  let mode: "select" | "insert" | "update" = "select";
  let payload: Record<string, unknown> = {};
  // Os filtros de um UPDATE em `flow_runs`, aplicados como o banco: a linha
  // só muda (e só volta no `.select()`) se casar com TODOS. É o que deixa a
  // cerca da re-pergunta (porte #683) e a do avanço serem exercitadas.
  let filtros: [string, unknown][] = [];

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
      filtros = [];
      return builder;
    },
    eq: (k: string, v: unknown) => {
      if (mode === "update") filtros.push([k, v]);
      return builder;
    },
    is: (k: string, v: unknown) => {
      if (mode === "update") filtros.push([k, v]);
      return builder;
    },
    order: () => builder,
    limit: () => {
      if (table === "flow_runs" && mode === "select") {
        // Uma CÓPIA por leitura, como o banco: cada requisição tem a sua.
        return Promise.resolve({ data: runsAtivos.map((r) => ({ ...r })), error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    maybeSingle: () => {
      if (table === "flows" && mode === "select") {
        return Promise.resolve({ data: flowsNoBanco[0] ?? null, error: null });
      }
      if (table === "flow_runs" && mode === "insert") {
        estado.runInserido = payload;
        estado.runs["r1"] = { reprompt_count: 0, vars: {}, ...payload, id: "r1" };
        return Promise.resolve({ data: { ...payload, id: "r1" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    single: () => builder.maybeSingle as never,
    then: (resolve: (v: unknown) => void) => {
      if (table === "flow_runs" && mode === "update") {
        const linha = { ...(runsAtivos[0] ?? {}), ...(estado.runs["r1"] ?? {}) };
        const casa = filtros.every(([k, v]) =>
          v === null ? linha[k] === null || linha[k] === undefined : linha[k] === v,
        );
        if (!casa) return resolve({ data: [], error: null });
        estado.runs["r1"] = { ...(estado.runs["r1"] ?? {}), ...payload };
        return resolve({ data: [{ id: "r1" }], error: null });
      }
      if (table === "flows" && mode === "select") {
        return resolve({ data: flowsNoBanco, error: null });
      }
      if (table === "flow_nodes" && mode === "select") {
        if (erroNosNos) return resolve({ data: null, error: { message: "banco fora" } });
        return resolve({ data: nosNoBanco, error: null });
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
  nosNoBanco = NODES;
  runsAtivos = [];
  erroNosNos = false;
  sendInteractiveButtons.mockReset();
  sendInteractiveList.mockReset();
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

// ============================================================
// REGRESSÃO DO MERGE (upstream 2026-08-26) — toque em botão E canal, juntos.
//
// O upstream (#490) fez o toque num botão poder INICIAR um flow por
// palavra-chave: antes, `findEntryFlow` recusava tudo que não fosse texto
// digitado. A correção deles é um laço com `return flow`; a nossa base tem um
// PREDICADO booleano, porque o casamento de canal precisa decidir antes.
// Traduzir uma coisa na outra foi resolução à mão, não composição.
//
// Os casos acima cobrem canal com texto digitado; os do `dispatch.test.ts`
// cobrem toque sem canal. O que nenhum dos dois cobre — e é onde a tradução
// erraria — é o cruzamento.
// ============================================================
describe("regressão de merge: toque em botão respeita o canal", () => {
  const TOQUE = {
    ...INPUT,
    message: {
      kind: "interactive_reply" as const,
      reply_id: "btn_oi",
      reply_title: "oi",
      meta_message_id: "wamid.tap",
    },
  };

  it("um toque INICIA o flow do canal certo", async () => {
    // Metade deles (#490) + metade nossa (canal), na mesma decisão.
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "w" });
    flowsNoBanco = [{ ...FLOW_BASE, id: "f-socio", channel_id: "ch-socio" }];
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...TOQUE, channelId: "ch-socio" });

    expect(estado.runInserido?.flow_id).toBe("f-socio");
  });

  it("o MESMO toque não inicia o flow de outro canal", async () => {
    // Se a tradução tivesse perdido o `casaCanal`, este caso passaria a
    // iniciar o flow do sócio para quem escreveu no comercial — e ninguém
    // notaria até existir o segundo número.
    flowsNoBanco = [{ ...FLOW_BASE, id: "f-socio", channel_id: "ch-socio" }];
    const { dispatchInboundToFlows } = await import("./engine");

    const r = await dispatchInboundToFlows({ ...TOQUE, channelId: "ch-comercial" });

    expect(r.consumed).toBe(false);
    expect(estado.runInserido).toBeNull();
  });

  it("o toque casa pelo reply_id, e ainda assim respeita o canal", async () => {
    // `entryTriggerTexts` oferece rótulo E id. O recorte de canal tem que
    // valer para os dois — não só para o rótulo.
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "w" });
    flowsNoBanco = [
      {
        ...FLOW_BASE,
        id: "f-por-id",
        channel_id: "ch-socio",
        trigger_config: { keywords: ["btn_oi"], match_type: "contains" },
      },
    ];
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      ...TOQUE,
      message: { ...TOQUE.message, reply_title: "Sim, quero" },
      channelId: "ch-socio",
    });

    expect(estado.runInserido?.flow_id).toBe("f-por-id");
  });
});

describe("nó de LISTA: o mesmo canal dos botões (Fase 4)", () => {
  // A lista não passava o canal: um fluxo preso ao número X mandava a lista
  // pelo canal atual da conversa. Achado da auditoria do merge #259.
  const lista = (channel_id?: string) => [
    NODES[0],
    {
      id: "n1",
      flow_id: "f1",
      node_key: "menu",
      node_type: "send_list",
      config: {
        text: "Escolha",
        button_label: "Ver",
        ...(channel_id ? { channel_id } : {}),
        sections: [{ rows: [{ reply_id: "a", title: "A", next_node_key: "end" }] }],
      },
    },
    NODES[2],
  ];

  it("usa o canal do RUN quando o nó não fixa nenhum", async () => {
    nosNoBanco = lista();
    sendInteractiveList.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(sendInteractiveList).toHaveBeenCalledWith(
      expect.objectContaining({ preferredChannelId: "ch-comercial" }),
    );
  });

  it("o canal FIXADO no nó vence o do run", async () => {
    nosNoBanco = lista("ch-oficial");
    sendInteractiveList.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(sendInteractiveList).toHaveBeenCalledWith(
      expect.objectContaining({ preferredChannelId: "ch-oficial" }),
    );
  });

  it("lista que falha também encerra o run como failed", async () => {
    nosNoBanco = lista();
    sendInteractiveList.mockRejectedValue(new Error("título da linha passou de 24"));
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(estado.runs["r1"]?.status).toBe("failed");
    expect(estado.runs["r1"]?.end_reason).toBe("send_interactive_failed");
  });
});

describe("os dois nós interativos passam pela interpolação (Fase 4)", () => {
  // As montagens (`camposDosBotoes`/`camposDaLista`) têm teste puro em
  // engine.test.ts; este prova que os ENVIOS as usam. Num run novo não há
  // variável nenhuma, então "{{vars.name}}" tem de sair vazio, não literal.
  it("botões", async () => {
    nosNoBanco = [
      NODES[0],
      {
        ...NODES[1],
        config: {
          text: "Oi {{vars.name}}",
          buttons: [{ reply_id: "a", title: "A {{vars.name}}", next_node_key: "end" }],
        },
      },
      NODES[2],
    ];
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(sendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: "Oi ", buttons: [{ id: "a", title: "A " }] }),
    );
  });

  it("lista", async () => {
    nosNoBanco = [
      NODES[0],
      {
        id: "n1",
        flow_id: "f1",
        node_key: "menu",
        node_type: "send_list",
        config: {
          text: "Oi {{vars.name}}",
          button_label: "Ver",
          sections: [{ rows: [{ reply_id: "a", title: "A", next_node_key: "end" }] }],
        },
      },
      NODES[2],
    ];
    sendInteractiveList.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(sendInteractiveList).toHaveBeenCalledWith(expect.objectContaining({ bodyText: "Oi " }));
  });
});

describe("collect_input → nó interativo: a variável capturada chega ao envio (Fase 4)", () => {
  // O coração do #553: sem estes, trocar `run.vars` por `{}` no envio deixava
  // a suíte verde (os outros testes rodam num run NOVO, sem variável).
  const pergunta = {
    id: "n1",
    flow_id: "f1",
    node_key: "nome",
    node_type: "collect_input",
    config: { prompt_text: "Qual seu nome?", var_key: "name", next_node_key: "menu" },
  };
  const botoes = {
    id: "n2",
    flow_id: "f1",
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "Oi {{vars.name}}",
      buttons: [{ reply_id: "a", title: "Sou {{vars.name}}", next_node_key: "end" }],
    },
  };
  const lista = {
    id: "n2",
    flow_id: "f1",
    node_key: "menu",
    node_type: "send_list",
    config: {
      text: "{{vars.name}}, escolha",
      button_label: "Ver",
      sections: [{ title: "Para {{vars.name}}", rows: [{ reply_id: "a", title: "A", next_node_key: "end" }] }],
    },
  };
  const fim = { id: "n3", flow_id: "f1", node_key: "end", node_type: "end", config: {} };
  const runNaPergunta = (extra: Record<string, unknown> = {}) => ({
    id: "r1",
    flow_id: "f1",
    account_id: "acct",
    user_id: "u1",
    contact_id: "c1",
    conversation_id: "conv1",
    status: "active",
    current_node_key: "nome",
    vars: {},
    reprompt_count: 0,
    channel_id: "ch-oficial",
    ...extra,
  });
  const resposta = (texto: string) => ({
    ...INPUT,
    message: { kind: "text" as const, text: texto, meta_message_id: "wamid.2" },
    isFirstInboundMessage: false,
  });

  it("botões: o nome capturado sai no corpo e no título, pelo canal do run", async () => {
    nosNoBanco = [NODES[0], pergunta, botoes, fim];
    runsAtivos = [runNaPergunta()];
    sendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows(resposta("  Ana  "));

    expect(sendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: "Oi Ana",
        buttons: [{ id: "a", title: "Sou Ana" }],
        preferredChannelId: "ch-oficial",
      }),
    );
  });

  it("lista: o nome capturado sai no corpo e no título da seção", async () => {
    nosNoBanco = [NODES[0], pergunta, lista, fim];
    runsAtivos = [runNaPergunta()];
    sendInteractiveList.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows(resposta("Ana"));

    const args = sendInteractiveList.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.bodyText).toBe("Ana, escolha");
    expect((args.sections as { title?: string }[])[0].title).toBe("Para Ana");
  });

  it("a re-pergunta da lista sai interpolada com as variáveis do run", async () => {
    nosNoBanco = [NODES[0], lista, fim];
    runsAtivos = [runNaPergunta({ current_node_key: "menu", vars: { name: "Ana" } })];
    sendInteractiveList.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    // Texto solto num nó de lista não casa: vira re-pergunta.
    await dispatchInboundToFlows(resposta("hã?"));

    expect(sendInteractiveList).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: "Ana, escolha", preferredChannelId: "ch-oficial" }),
    );
  });

  it("⚠️ contrato NOSSO: a re-pergunta que falha ENCERRA o run (o original o mantém vivo)", async () => {
    nosNoBanco = [NODES[0], botoes, fim];
    runsAtivos = [runNaPergunta({ current_node_key: "menu", vars: { name: "Ana" } })];
    sendInteractiveButtons.mockRejectedValue(new Error("Meta 5xx"));
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows(resposta("hã?"));

    expect(estado.runs["r1"]?.status).toBe("failed");
    expect(estado.runs["r1"]?.end_reason).toBe("reprompt_interactive_failed");
    expect(estado.eventos.some((e) => e.payload.reason === "reprompt_interactive_failed")).toBe(true);
  });
});

describe("collect_input: a pergunta sai pelo canal do run (revisão da Fase 4)", () => {
  const nos = (channel_id?: string) => [
    { ...NODES[0], config: { next_node_key: "nome" } },
    {
      id: "n1",
      flow_id: "f1",
      node_key: "nome",
      node_type: "collect_input",
      config: {
        prompt_text: "Qual seu nome?",
        var_key: "name",
        next_node_key: "end",
        ...(channel_id ? { channel_id } : {}),
      },
    },
    NODES[2],
  ];

  it("a PERGUNTA usa o canal do run, não o da conversa", async () => {
    nosNoBanco = nos();
    sendText.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Qual seu nome?", preferredChannelId: "ch-comercial" }),
    );
  });

  it("o canal fixado no nó vence o do run", async () => {
    nosNoBanco = nos("ch-oficial");
    sendText.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({ ...INPUT, channelId: "ch-comercial" });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ preferredChannelId: "ch-oficial" }),
    );
  });

  it("a RE-PERGUNTA também (resposta vazia depois de aparar)", async () => {
    nosNoBanco = nos();
    runsAtivos = [
      {
        id: "r1",
        flow_id: "f1",
        account_id: "acct",
        user_id: "u1",
        contact_id: "c1",
        conversation_id: "conv1",
        status: "active",
        current_node_key: "nome",
        vars: {},
        reprompt_count: 0,
        channel_id: "ch-oficial",
      },
    ];
    sendText.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    await dispatchInboundToFlows({
      ...INPUT,
      message: { kind: "text" as const, text: "   ", meta_message_id: "wamid.3" },
      isFirstInboundMessage: false,
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Qual seu nome?", preferredChannelId: "ch-oficial" }),
    );
  });
});

// ============================================================
// Porte #683 (17/11/2026): a leitura dos nós que falha é "não sei", e a
// re-pergunta tem cerca.
// ============================================================

describe("leitura dos nós que FALHA = não sei (porte #683)", () => {
  const runNoMenu = () => ({
    id: "r1",
    flow_id: "f1",
    account_id: "acct",
    user_id: "u1",
    contact_id: "c1",
    conversation_id: "conv1",
    status: "active",
    current_node_key: "menu",
    vars: {},
    reprompt_count: 0,
    channel_id: "ch-oficial",
  });
  const resposta = {
    ...INPUT,
    message: { kind: "text" as const, text: "oi de novo", meta_message_id: "wamid.9" },
    isFirstInboundMessage: false,
  };

  it("⚠️ a run ATIVA não termina: a mensagem fica com o robô e a próxima tenta de novo", async () => {
    runsAtivos = [runNoMenu()];
    erroNosNos = true;
    const { dispatchInboundToFlows } = await import("./engine");

    const r = await dispatchInboundToFlows(resposta);

    expect(r).toEqual({ consumed: true, flow_run_id: "r1", outcome: "run_error" });
    // Nada foi gravado na run (antes: `failed` + `current_node_not_found`).
    expect(estado.runs["r1"]).toBeUndefined();
    expect(estado.eventos.some((e) => e.payload.reason === "nodes_load_failed")).toBe(true);
    expect(sendInteractiveButtons).not.toHaveBeenCalled();
  });

  it("robô novo não nasce às cegas: a mensagem segue como se não houvesse robô", async () => {
    erroNosNos = true;
    const { dispatchInboundToFlows } = await import("./engine");

    const r = await dispatchInboundToFlows(INPUT);

    expect(r).toEqual({ consumed: false, outcome: "no_match" });
    expect(estado.runInserido).toBeNull();
  });

  it("startFlowForContact diz que não leu, em vez de \"robô sem nós\"", async () => {
    erroNosNos = true;
    const { startFlowForContact } = await import("./engine");

    const r = await startFlowForContact({
      accountId: "acct",
      userId: "u1",
      contactId: "c1",
      conversationId: "conv1",
      flowId: "f1",
    });

    expect(r).toEqual({ ok: false, detail: "falha ao ler os nós do robô" });
    expect(estado.runInserido).toBeNull();
  });
});

describe("re-pergunta com cerca: duas respostas juntas (porte #683)", () => {
  const lista = {
    id: "n2",
    flow_id: "f1",
    node_key: "menu",
    node_type: "send_list",
    config: {
      text: "Escolha",
      button_label: "Ver",
      sections: [{ title: "", rows: [{ reply_id: "a", title: "A", next_node_key: "end" }] }],
    },
  };
  const runNoMenu = (reprompt_count: number) => ({
    id: "r1",
    flow_id: "f1",
    account_id: "acct",
    user_id: "u1",
    contact_id: "c1",
    conversation_id: "conv1",
    status: "active",
    current_node_key: "menu",
    vars: {},
    reprompt_count,
    channel_id: "ch-oficial",
  });
  const resposta = (texto: string, id: string) => ({
    ...INPUT,
    message: { kind: "text" as const, text: texto, meta_message_id: id },
    isFirstInboundMessage: false,
  });

  it("⚠️ só UMA re-pergunta sai; a outra resposta fica com o robô sem mandar nada", async () => {
    nosNoBanco = [NODES[0], lista, NODES[2]];
    runsAtivos = [runNoMenu(0)];
    sendInteractiveList.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    const [a, b] = await Promise.all([
      dispatchInboundToFlows(resposta("hã?", "wamid.a")),
      dispatchInboundToFlows(resposta("hein?", "wamid.b")),
    ]);

    expect(sendInteractiveList).toHaveBeenCalledTimes(1);
    expect([a.outcome, b.outcome].sort()).toEqual(["duplicate_inbound_ignored", "fallback_fired"]);
    expect(a.consumed && b.consumed).toBe(true);
    expect(estado.runs["r1"]?.reprompt_count).toBe(1);
    expect(estado.eventos.filter((e) => e.payload.reason === "lost_race_during_fallback")).toHaveLength(1);
  });

  it("⚠️ a política que esgota encerra UMA vez, no mesmo UPDATE da cerca", async () => {
    // Padrão: 2 re-perguntas; a 3ª resposta fora do esperado passa à equipe.
    nosNoBanco = [NODES[0], lista, NODES[2]];
    runsAtivos = [runNoMenu(2)];
    const { dispatchInboundToFlows } = await import("./engine");

    const [a, b] = await Promise.all([
      dispatchInboundToFlows(resposta("hã?", "wamid.a")),
      dispatchInboundToFlows(resposta("hein?", "wamid.b")),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual(["duplicate_inbound_ignored", "handed_off"]);
    expect(estado.runs["r1"]?.status).toBe("handed_off");
    expect(estado.runs["r1"]?.end_reason).toBe("fallback_exhausted");
    expect(estado.eventos.filter((e) => e.tipo === "handoff")).toHaveLength(1);
    expect(sendInteractiveList).not.toHaveBeenCalled();
  });

  it("o robô que já andou (outro nó) não re-pergunta o nó velho", async () => {
    nosNoBanco = [NODES[0], lista, NODES[2]];
    runsAtivos = [runNoMenu(0)];
    // A run foi lida no "menu", mas antes da cerca outra resposta a levou
    // adiante: o UPDATE condicional não casa.
    estado.runs["r1"] = { current_node_key: "end" };
    sendInteractiveList.mockResolvedValue({ whatsapp_message_id: "wamid.out" });
    const { dispatchInboundToFlows } = await import("./engine");

    const r = await dispatchInboundToFlows(resposta("hã?", "wamid.c"));

    expect(r.outcome).toBe("duplicate_inbound_ignored");
    expect(sendInteractiveList).not.toHaveBeenCalled();
  });
});
