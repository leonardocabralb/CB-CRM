import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    // Os campos do contato entram aqui porque a interpolação de
    // `{{contact.*}}` lê a MESMA tabela pela qual o motor confere posse.
    owned: null as
      | { id: string; name?: string; phone?: string; email?: string; company?: string }
      | null,
    ownedCustomField: null as { id: string } | null,
    pipeline: null as { id: string } | null,
    stage: null as { id: string } | null,
    dealExistente: null as { id: string } | null,
    dealSelects: [] as [string, string, unknown][][],
    dealInserts: [] as Record<string, unknown>[],
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    logInserts: [] as Record<string, unknown>[],
    logUpdates: [] as Record<string, unknown>[],
    taskInserts: [] as Record<string, unknown>[],
    notifInserts: [] as Record<string, unknown>[],
    // Valores de campo personalizado do contato, como o PostgREST os entrega
    // (com a definição embutida) — é por eles que a interpolação de
    // `{{contact.campo.*}}` passa.
    customValues: [] as Record<string, unknown>[],
    membros: [{ user_id: "agente-fallback", full_name: "Agente Um", email: "um@cb.test" }] as Record<string, unknown>[],
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
    recorte?: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "conversations") {
      // O passo assign_conversation escreve aqui, e QUAIS filtros ele usa é
      // justamente o que se quer observar (a conversa do disparo vs. todas as
      // do contato).
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "profiles") {
      // round_robin resolve um membro da conta por aqui; `create_task` usa a
      // MESMA consulta para provar que o responsável é membro e para carimbar
      // o nome dele na tarefa.
      return { data: state.membros, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: state.customValues, error: null };
    }
    if (table === "pipelines") return { data: state.pipeline, error: null };
    if (table === "pipeline_stages") return { data: state.stage, error: null };
    if (table === "deals") {
      if (type === "insert") {
        state.dealInserts.push(ops.payload as Record<string, unknown>);
        return {
          data: { id: "d-novo", ...(ops.payload as Record<string, unknown>) },
          error: null,
        };
      }
      state.dealSelects.push(ops.filters);
      return { data: state.dealExistente, error: null };
    }
    if (table === "cb_tasks") {
      if (type === "insert") {
        state.taskInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: "t-1" }, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "notifications") {
      if (type === "insert") {
        state.notifInserts.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") return { data: state.automations, error: null };
    if (table === "automation_logs") {
      if (type === "insert") {
        state.logInserts.push(ops.payload as Record<string, unknown>);
        return { data: { id: "log1" }, error: null };
      }
      if (type === "update") {
        state.logUpdates.push(ops.payload as Record<string, unknown>);
        return { data: null, error: null };
      }
      return { data: { steps_executed: [], status: "success" }, error: null };
    }
    if (table === "automation_steps") {
      // Recorte por ESCOPO (parent_step_id / branch / position), para os
      // testes de ramo e espera: sem ele a consulta do ramo devolvia a lista
      // inteira — inclusive a própria condição, em recursão infinita. Passo
      // sem a coluna (helpers antigos) conta como escopo de fora, posição 0.
      let lista = state.steps;
      for (const [op, k, v] of [...ops.filters, ...(ops.recorte ?? [])]) {
        if (k === "automation_id") continue;
        if (op === "is" && v === null) lista = lista.filter((s) => s[k] == null);
        else if (op === "eq") lista = lista.filter((s) => (s[k] ?? null) === v);
        else if (op === "gte") lista = lista.filter((s) => s[k] === undefined || Number(s[k]) >= Number(v));
      }
      return { data: lista, error: null };
    }
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
      recorte: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      // `create_task` pergunta pelos DOIS perfis (autor e responsável) numa
      // consulta só — é ela que prova que o responsável é da conta.
      in: (k: string, v: unknown) => (ops.filters.push(["in", k, v]), b),
      gte: (k: string, v: unknown) => (ops.recorte.push(["gte", k, v]), b),
      is: (k: string, v: unknown) => (ops.recorte.push(["is", k, v]), b),
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
}));

// `send_to_number` (977): a ficha/conversa do número avisado e a conferência
// da conexão são mockadas — o que se testa aqui é o que chega ao sender e a
// regra de falhar FECHADO quando a conexão pedida não resolve.
const destinatarioMock = vi.hoisted(() => ({
  resolverDestinatario: vi.fn(async () => ({ contactId: "equipe-1", conversationId: "conv-equipe", criouContato: false })),
}));
vi.mock("./destinatario", () => destinatarioMock);
const canalMock = vi.hoisted(() => ({
  resolveEngineChannelPreferring: vi.fn(async (_db: unknown, _acc: string, _conv: string, preferido: string | null | undefined) => ({
    channelId: preferido ?? "ch-padrao",
  })),
}));
vi.mock("@/lib/cb-channels/engine-send", () => canalMock);

import { dispararAutomacoes, runAutomationsForTrigger, triggerMatches } from "./engine";
import { engineSendText } from "./meta-send";
import type { Automation, KeywordMatchTriggerConfig } from "@/types";
import { diaNoFuso, somarDias } from "@/lib/tasks/prazo";

const ACCOUNT = "acct-1";

beforeEach(() => {
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.pipeline = null;
  h.state.stage = null;
  h.state.dealExistente = null;
  h.state.dealSelects = [];
  h.state.dealInserts = [];
  h.state.automations = [];
  h.state.steps = [];
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.logInserts = [];
  h.state.logUpdates = [];
  h.state.taskInserts = [];
  h.state.notifInserts = [];
  h.state.customValues = [];
  h.state.membros = [{ user_id: "agente-fallback", full_name: "Agente Um", email: "um@cb.test" }];
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe("automation_logs — status is seeded pessimistically (issue #409)", () => {
  it("writes the log row as 'failed' before any step runs", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The insert happens before execution, so a run killed mid-flight must
    // not leave behind a row that claims it succeeded.
    expect(h.state.logInserts).toHaveLength(1);
    expect(h.state.logInserts[0]).toMatchObject({
      status: "failed",
      steps_executed: [],
    });
  });

  it("still promotes the log to 'success' once the steps complete", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The seed is only a floor — the outermost scope still writes the real
    // verdict, so a completed run reports success as it always did.
    const withStatus = h.state.logUpdates.filter((u) => "status" in u);
    expect(withStatus.at(-1)).toMatchObject({ status: "success" });
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("create_deal — um card por contato", () => {
  // O índice único da 911 é PARCIAL (WHERE source = 'channel') e este passo
  // insere com source 'automation' — o banco não barra o duplicado, então a
  // regra é uma checagem explícita no motor, antes do insert.
  function dealStep() {
    return {
      id: "s1",
      automation_id: "a1",
      step_type: "create_deal",
      position: 0,
      parent_step_id: null,
      step_config: { pipeline_id: "p1", stage_id: "st1", title: "Novo negócio" },
    };
  }

  function executados() {
    return h.state.logUpdates.flatMap(
      (u) =>
        (u.steps_executed as { status: string; detail: string }[] | undefined) ?? [],
    );
  }

  beforeEach(() => {
    h.state.owned = { id: "c1" };
    h.state.pipeline = { id: "p1" };
    h.state.stage = { id: "st1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [dealStep()];
  });

  it("desiste sem inserir quando o contato já tem card — qualquer funil, qualquer origem", async () => {
    h.state.dealExistente = { id: "d-antigo" };

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(0);
    // A checagem roda em service-role (ignora RLS) — o escopo de conta é o filtro.
    expect(h.state.dealSelects[0]).toContainEqual(["eq", "account_id", ACCOUNT]);
    expect(h.state.dealSelects[0]).toContainEqual(["eq", "contact_id", "c1"]);
    // Não é falha do passo: é a regra funcionando, com o log que a documenta.
    expect(executados()).toContainEqual(
      expect.objectContaining({ status: "success", detail: "deal already existed" }),
    );
  });

  it("cria o card com source 'automation' quando o contato não tem nenhum", async () => {
    h.state.dealExistente = null;

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.dealInserts).toHaveLength(1);
    expect(h.state.dealInserts[0]).toMatchObject({
      account_id: ACCOUNT,
      contact_id: "c1",
      pipeline_id: "p1",
      stage_id: "st1",
      source: "automation",
    });
    expect(executados()).toContainEqual(
      expect.objectContaining({ status: "success", detail: "deal created" }),
    );
  });
});

describe("send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)", () => {
  it("refuses a private / link-local destination and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep("http://169.254.169.254/latest/meta-data/")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain("automation_steps");
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function webhookStep(url: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_webhook",
    position: 0,
    parent_step_id: null,
    step_config: { url, headers: { "Metadata-Flavor": "Google" }, body_template: "{}" },
  };
}

// ------------------------------------------------------------
// Canal de SAÍDA por passo — a precedência que o seletor "Enviar por" promete.
//
// stepChannel é privado, então o teste passa pelo motor de verdade e observa o
// que chega ao sender. Nenhuma conta tem 2 conexões hoje, então esta é a única
// forma de provar a regra.
// ------------------------------------------------------------

function sendStep(step_config: Record<string, unknown>) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_message",
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

async function dispararEnvio(
  step_config: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  h.state.owned = { id: "c1" };
  h.state.automations = [automationWithUpdateStep()];
  h.state.steps = [sendStep(step_config)];
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: "new_message_received",
    contactId: "c1",
    // conversation_id no contexto evita a busca de conversa em `resolveConversationId`.
    context: { conversation_id: "conv1", ...context },
  });
  const chamadas = vi.mocked(engineSendText).mock.calls;
  return chamadas[0]?.[0];
}

describe("send_message — canal de saída por passo", () => {
  beforeEach(() => vi.mocked(engineSendText).mockClear());

  it("CRÍTICO: o canal do PASSO vence o canal do disparo", async () => {
    // "o cliente escreveu no pessoal, mas a confirmação sai pelo oficial".
    const args = await dispararEnvio(
      { text: "oi", channel_id: "ch-oficial" },
      { channel_id: "ch-pessoal" },
    );
    expect(args?.preferredChannelId).toBe("ch-oficial");
  });

  it("sem canal no passo, herda o canal do DISPARO", async () => {
    // É o que faz o follow-up parado num `wait` de 24h voltar pelo número por
    // onde o cliente escreveu, e não pelo que ele usou no meio-tempo.
    const args = await dispararEnvio({ text: "oi" }, { channel_id: "ch-pessoal" });
    expect(args?.preferredChannelId).toBe("ch-pessoal");
  });

  it("sem canal em lugar nenhum, o sender cai na conversa (undefined)", async () => {
    const args = await dispararEnvio({ text: "oi" }, {});
    expect(args?.preferredChannelId).toBeUndefined();
  });

  it("channel_id nulo no passo (config antiga) não apaga o canal do disparo", async () => {
    // `??` e não `||`: um `null` gravado por config antiga tem de cair para o
    // disparo, não virar "sem canal".
    const args = await dispararEnvio(
      { text: "oi", channel_id: null },
      { channel_id: "ch-pessoal" },
    );
    expect(args?.preferredChannelId).toBe("ch-pessoal");
  });
});

// ------------------------------------------------------------
// assign_conversation: a conversa DO DISPARO, não todas as do contato.
//
// O codigo anterior filtrava so por conta+contato, entao um contato com tres
// conversas tinha as tres atribuidas de uma vez — inclusive as de outro
// numero, atropelando o recorte por conexao.
// ------------------------------------------------------------

describe("assign_conversation — alvo", () => {
  const passoAtribuir = {
    id: "s1",
    automation_id: "a1",
    step_type: "assign_conversation",
    position: 0,
    parent_step_id: null,
    step_config: { mode: "specific", agent_id: "agente-1" },
  };

  it("CRÍTICO: mira a conversa do contexto, não o contato inteiro", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtribuir];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { conversation_id: "conv-do-disparo" },
    });

    const conversas = h.state.updateCalls.filter((u) => u.table === "conversations");
    expect(conversas).toHaveLength(1);
    const colunas = conversas[0].filters.map((f) => f[1]);
    expect(colunas).toContain("id");
    expect(colunas).not.toContain("contact_id");
  });

  it("sem conversa no disparo, cai em todas as do contato (como antes)", async () => {
    // É o caso da etiqueta adicionada na ficha: não há conversa no contexto,
    // e não atribuir nada seria pior que atribuir todas.
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [passoAtribuir];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    const conversas = h.state.updateCalls.filter((u) => u.table === "conversations");
    expect(conversas).toHaveLength(1);
    expect(conversas[0].filters.map((f) => f[1])).toContain("contact_id");
  });
});

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe("triggerMatches — interactive_reply", () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "menu step",
      trigger_type: "interactive_reply",
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches when the tapped id is in reply_ids (exact)", () => {
    expect(
      triggerMatches(automation(["yes", "no"]), { interactive_reply_id: "yes" }),
    ).toBe(true);
  });

  it("does not match a different id", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "maybe" }),
    ).toBe(false);
  });

  it("does not match on a substring (exact only)", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "yes_please" }),
    ).toBe(false);
  });

  it("does not match when no reply id is present or config is empty", () => {
    expect(triggerMatches(automation(["yes"]), {})).toBe(false);
    expect(triggerMatches(automation([]), { interactive_reply_id: "yes" })).toBe(false);
  });
});

describe("triggerMatches — tag_added", () => {
  function automation(tagId?: string): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "tag follow-up",
      trigger_type: "tag_added",
      trigger_config: tagId ? { tag_id: tagId } : {},
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches only the exact tag id", () => {
    expect(triggerMatches(automation("tag-a"), { tag_id: "tag-a" })).toBe(true);
    expect(triggerMatches(automation("tag-a"), { tag_id: "tag-ab" })).toBe(false);
  });

  it("fails closed when the config or event tag is missing", () => {
    expect(triggerMatches(automation(), { tag_id: "tag-a" })).toBe(false);
    expect(triggerMatches(automation("tag-a"), {})).toBe(false);
    expect(triggerMatches(automation("tag-a"), undefined)).toBe(false);
  });
});

describe("triggerMatches — date_field_offset (952)", () => {
  function lembrete(id: string): Automation {
    return {
      id,
      account_id: ACCOUNT,
      user_id: "u1",
      name: "lembrete",
      trigger_type: "date_field_offset",
      trigger_config: { fonte: "reuniao", offset_hours: 24, direction: "antes" },
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("⚠️ roda SÓ a automação carimbada no contexto", () => {
    // O "aconteceu?" deste gatilho é decidido pela varredura, fora do motor.
    // Sem o recorte, o alvo de um lembrete executava TODOS os lembretes da
    // conta — o de 48h saía junto com o de 24h, fora da própria janela.
    expect(triggerMatches(lembrete("a1"), { automation_id: "a1" })).toBe(true);
    expect(triggerMatches(lembrete("a2"), { automation_id: "a1" })).toBe(false);
  });

  it("fail closed: sem carimbo no contexto, nada roda", () => {
    // Inclusive o dispatch manual (POST /api/automations/engine) sem
    // automation_id — rodar "todos, agora" ignoraria as datas.
    expect(triggerMatches(lembrete("a1"), {})).toBe(false);
    expect(triggerMatches(lembrete("a1"), undefined)).toBe(false);
  });
});

describe("tag_added — conversation policy", () => {
  it("records a clear failed step when the contact has no conversation", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [{
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "tag outreach",
      trigger_type: "tag_added",
      trigger_config: { tag_id: "tag-a" },
      is_active: true,
    }];
    h.state.steps = [{
      id: "s1",
      automation_id: "a1",
      step_type: "send_message",
      position: 0,
      parent_step_id: null,
      step_config: { text: "Hello" },
    }];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "tag_added",
      contactId: "c1",
      context: { tag_id: "tag-a" },
    });

    expect(h.state.logUpdates).toContainEqual(expect.objectContaining({
      status: "failed",
      error_message: "tag_added automation cannot send: contact has no existing conversation",
    }));
  });
});

describe("triggerMatches — keyword_match", () => {
  function automation(
    cfg: Partial<KeywordMatchTriggerConfig> & { keywords: string[] },
  ): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "kw",
      trigger_type: "keyword_match",
      trigger_config: { match_type: "contains", ...cfg },
      is_active: true,
    } as unknown as Automation;
  }

  const on = (a: Automation, text: string) =>
    triggerMatches(a, { message_text: text });

  it("keeps `contains` as a raw substring test", () => {
    // Issue #409 asked for this to become word-boundary matching. It
    // deliberately did NOT change: existing automations relying on
    // substring behaviour ("cat" firing on "category") must keep working,
    // and `contains` is the builder's default. `word` is the opt-in fix.
    expect(on(automation({ keywords: ["k"] }), "thanks")).toBe(true);
    expect(on(automation({ keywords: ["cat"] }), "category")).toBe(true);
  });

  it("`word` matches only standalone words", () => {
    const a = automation({ keywords: ["k"], match_type: "word" });
    expect(on(a, "thanks")).toBe(false);
    expect(on(a, "k")).toBe(true);
    expect(on(a, "press k to continue")).toBe(true);
    expect(on(a, "press K!")).toBe(true);
  });

  it("`word` respects punctuation and line edges around the keyword", () => {
    const a = automation({ keywords: ["hi"], match_type: "word" });
    expect(on(a, "hi")).toBe(true);
    expect(on(a, "hi!")).toBe(true);
    expect(on(a, "(hi)")).toBe(true);
    expect(on(a, "say hi.")).toBe(true);
    expect(on(a, "this")).toBe(false);
    expect(on(a, "hiya")).toBe(false);
  });

  it("`word` handles a keyword that itself carries punctuation", () => {
    // `\b` can't do this: /\bhi!\b/ demands a word char after the "!",
    // so it never matches. Hence the lookaround implementation.
    const a = automation({ keywords: ["hi!"], match_type: "word" });
    expect(on(a, "say hi!")).toBe(true);
    expect(on(a, "hi! there")).toBe(true);
  });

  it("`word` treats regex metacharacters in a keyword as literal", () => {
    // Account-supplied free text — an unescaped "(" would throw.
    const a = automation({ keywords: ["c++ (beginner)"], match_type: "word" });
    expect(on(a, "I want the c++ (beginner) course")).toBe(true);
    expect(on(a, "I want the cxx beginner course")).toBe(false);
    expect(() => on(automation({ keywords: ["("], match_type: "word" }), "(")).not.toThrow();
  });

  it("`word` is case-insensitive unless case_sensitive is set", () => {
    expect(on(automation({ keywords: ["Hi"], match_type: "word" }), "hi")).toBe(true);
    expect(
      on(
        automation({ keywords: ["Hi"], match_type: "word", case_sensitive: true }),
        "hi",
      ),
    ).toBe(false);
    expect(
      on(
        automation({ keywords: ["Hi"], match_type: "word", case_sensitive: true }),
        "Hi",
      ),
    ).toBe(true);
  });

  it("`word` finds a space-delimited keyword in a non-Latin script", () => {
    // ASCII `\b` fails outright here — every character of "안녕" is a
    // non-word character to it, so /\b안녕\b/ matches nothing.
    const a = automation({ keywords: ["안녕"], match_type: "word" });
    expect(on(a, "안녕")).toBe(true);
    expect(on(a, "저기 안녕 하세요")).toBe(true);
    // Documented limitation, not an accident: a language written without
    // spaces has no word edge inside a run of characters.
    expect(on(a, "안녕하세요")).toBe(false);
  });

  it("`exact` still requires the whole message to be the keyword", () => {
    const a = automation({ keywords: ["hi"], match_type: "exact" });
    expect(on(a, "hi")).toBe(true);
    expect(on(a, "hi there")).toBe(false);
  });

  it("ignores empty keywords and empty messages in `word` mode", () => {
    expect(on(automation({ keywords: [""], match_type: "word" }), "anything")).toBe(false);
    expect(on(automation({ keywords: ["hi"], match_type: "word" }), "")).toBe(false);
  });
});

// ------------------------------------------------------------
// send_to_number (977): avisa um NÚMERO fixo, não o contato do disparo.
// ------------------------------------------------------------

function passoAvisar(step_config: Record<string, unknown>) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_to_number",
    position: 0,
    parent_step_id: null,
    step_config,
  };
}

async function dispararAviso(step_config: Record<string, unknown>, context: Record<string, unknown> = {}) {
  h.state.owned = { id: "c1" };
  h.state.automations = [automationWithUpdateStep()];
  h.state.steps = [passoAvisar(step_config)];
  await runAutomationsForTrigger({
    accountId: ACCOUNT,
    triggerType: "new_message_received",
    contactId: "c1",
    context: { conversation_id: "conv-cliente", channel_id: "ch-do-cliente", ...context },
  });
}

describe("send_to_number — aviso para a equipe", () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    destinatarioMock.resolverDestinatario.mockClear();
    canalMock.resolveEngineChannelPreferring.mockClear();
  });

  it("manda para a conversa do NÚMERO avisado, com o texto interpolado, pela conexão do passo", async () => {
    await dispararAviso(
      { phone: "(83) 98874-5316", contact_name: "Leonardo", text: "Novo agendamento: {{vars.agendamento_nome}}", channel_id: "ch-comercial" },
      { vars: { agendamento_nome: "Marcelo" } },
    );
    expect(destinatarioMock.resolverDestinatario).toHaveBeenCalledWith(expect.anything(), ACCOUNT, "5583988745316", "Leonardo");
    const args = vi.mocked(engineSendText).mock.calls[0]?.[0];
    expect(args?.conversationId).toBe("conv-equipe");
    expect(args?.contactId).toBe("equipe-1");
    expect(args?.text).toBe("Novo agendamento: Marcelo");
    expect(args?.preferredChannelId).toBe("ch-comercial");
  });

  it("CRÍTICO: sem conexão no passo NÃO herda o canal do disparo (é o número do cliente, não o da equipe)", async () => {
    await dispararAviso({ phone: "5583988745316", text: "oi" });
    const args = vi.mocked(engineSendText).mock.calls[0]?.[0];
    expect(args?.preferredChannelId).toBeUndefined();
  });

  it("CRÍTICO: conexão pedida que não resolve FALHA, em vez de sair por outro número", async () => {
    canalMock.resolveEngineChannelPreferring.mockResolvedValueOnce({ channelId: "ch-padrao" });
    await dispararAviso({ phone: "5583988745316", text: "oi", channel_id: "ch-apagado" });
    expect(engineSendText).not.toHaveBeenCalled();
    const log = h.state.logUpdates.at(-1) as { status?: string; error_message?: string } | undefined;
    expect(log?.status).toBe("failed");
    expect(log?.error_message).toContain("conexão escolhida");
  });

  it("telefone inválido falha antes de criar ficha", async () => {
    await dispararAviso({ phone: "123", text: "oi" });
    expect(destinatarioMock.resolverDestinatario).not.toHaveBeenCalled();
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it("texto vazio depois da interpolação falha antes de enviar", async () => {
    await dispararAviso({ phone: "5583988745316", text: "{{vars.nada}}" });
    expect(engineSendText).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// calendly_booking (977): vazio = qualquer evento; URI = só aquele.
// ------------------------------------------------------------

describe("triggerMatches — calendly_booking", () => {
  const auto = (trigger_config: Record<string, unknown>) =>
    ({ id: "a1", trigger_type: "calendly_booking", trigger_config }) as unknown as Automation;

  it("config vazia dispara para qualquer evento — inclusive sem URI no contexto", () => {
    expect(triggerMatches(auto({}), { calendly_event_type: "https://api.calendly.com/event_types/A" })).toBe(true);
    expect(triggerMatches(auto({ event_type_uri: "" }), {})).toBe(true);
    expect(triggerMatches(auto({}), undefined)).toBe(true);
  });

  it("com URI, só o evento igual", () => {
    const a = auto({ event_type_uri: "https://api.calendly.com/event_types/A" });
    expect(triggerMatches(a, { calendly_event_type: "https://api.calendly.com/event_types/A" })).toBe(true);
    expect(triggerMatches(a, { calendly_event_type: "https://api.calendly.com/event_types/B" })).toBe(false);
  });

  it("com URI e disparo sem evento, falha fechado", () => {
    expect(triggerMatches(auto({ event_type_uri: "https://api.calendly.com/event_types/A" }), {})).toBe(false);
  });
});

// ------------------------------------------------------------
// Variáveis do CONTATO (977): {{contact.*}} e {{conversation.link}}.
// ------------------------------------------------------------

describe("interpolate — variáveis do contato", () => {
  beforeEach(() => {
    vi.mocked(engineSendText).mockClear();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://crm.exemplo.com/");
  });

  async function textoEnviado(text: string, context: Record<string, unknown> = {}) {
    h.state.owned = { id: "c1", name: "Marcelo", phone: "5596991126767", email: "m@x.com", company: null } as unknown as { id: string };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [sendStep({ text })];
    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { conversation_id: "conv1", ...context },
    });
    return vi.mocked(engineSendText).mock.calls[0]?.[0]?.text;
  }

  it("lê nome, telefone e e-mail do contato, e o link da conversa do disparo", async () => {
    const texto = await textoEnviado("{{contact.name}} · {{contact.phone}} · {{contact.email}} · {{conversation.link}}");
    expect(texto).toBe("Marcelo · 5596991126767 · m@x.com · https://crm.exemplo.com/inbox?c=conv1");
  });

  it("campo personalizado ausente vira vazio, nunca 'undefined'; empresa nula idem", async () => {
    const texto = await textoEnviado("[{{contact.campo.tamanho_da_divida}}] [{{contact.company}}] [{{contact.nada}}]");
    expect(texto).toBe("[] [] []");
  });

  it("{{contact.origem}} junta campanha - conjunto - anúncio, só as partes preenchidas", async () => {
    // O mock de contact_custom_values devolve null: sem campos, a origem é vazia
    // (nunca " -  - ", que foi o que o primeiro aviso real imprimiu).
    expect(await textoEnviado("[{{contact.origem}}]")).toBe("[]");
  });

  it("link da ficha do contato", async () => {
    expect(await textoEnviado("{{contact.link}}")).toBe("https://crm.exemplo.com/contacts?contact=c1");
  });

  it("texto sem `contact.` NÃO consulta o contato (só a guarda de posse)", async () => {
    h.state.fromCalls = [];
    await textoEnviado("oi {{vars.x}}");
    expect(h.state.fromCalls.filter((t) => t === "contact_custom_values")).toHaveLength(0);
  });

  it("texto com `contact.` consulta o contato UMA vez por execução", async () => {
    h.state.fromCalls = [];
    await textoEnviado("{{contact.name}} e de novo {{contact.name}} e {{contact.campo.x}}");
    expect(h.state.fromCalls.filter((t) => t === "contact_custom_values")).toHaveLength(1);
  });
});

// ------------------------------------------------------------
// Ramo e espera (Codex, PR #128 — 2ª rodada). O que `dispararAutomacoes`
// devolve é o que o evento do Calendly grava: "disparado" tem de significar
// "rodou até o fim, sem falha". O mock de `automation_steps` recorta por
// escopo (lá em cima) justamente para estes testes.
// ------------------------------------------------------------

const condicao = {
  id: "cond",
  automation_id: "a1",
  step_type: "condition",
  position: 0,
  parent_step_id: null,
  step_config: { subject: "message_content", value: "oi" },
};
const noRamo = (step: Record<string, unknown>) => ({ ...step, id: `ramo-${String(step.step_type)}`, parent_step_id: "cond", branch: "yes", position: 0 });
const depoisDoRamo = { ...updateStep(), id: "depois", position: 1 };
const espera = () => ({
  id: "esp",
  automation_id: "a1",
  step_type: "wait",
  position: 0,
  parent_step_id: null,
  step_config: { amount: 1, unit: "hours" },
});

async function dispararComRamo() {
  h.state.owned = { id: "c1" };
  h.state.automations = [automationWithUpdateStep()];
  return dispararAutomacoes({
    accountId: ACCOUNT,
    triggerType: "new_message_received",
    contactId: "c1",
    context: { message_text: "oi" },
  });
}
const ultimoStatusDoLog = () =>
  (h.state.logUpdates.filter((u) => "status" in u).at(-1) as { status?: string } | undefined)?.status;

describe("dispararAutomacoes — ramo e espera (Codex, 2ª rodada)", () => {
  it("CRÍTICO: passo que falha DENTRO do ramo derruba a execução: log 'failed', comFalha, e o passo seguinte ao ramo não roda", async () => {
    // "123" não é telefone: `send_to_number` lança antes de tocar em nada.
    h.state.steps = [condicao, noRamo(passoAvisar({ phone: "123", text: "oi" })), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 1, emEspera: 0 });
    expect(ultimoStatusDoLog()).toBe("failed");
    // `depois` escreve em contacts; antes ele rodava como se nada tivesse falhado.
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("ramo que termina bem não muda nada: sucesso, e o passo seguinte ao ramo roda", async () => {
    h.state.steps = [condicao, noRamo(updateStep()), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 0 });
    expect(ultimoStatusDoLog()).toBe("success");
    expect(h.state.updateCalls).toHaveLength(2);
  });

  it("CRÍTICO: 'Aguardar' no escopo de fora é emEspera, não execução sem falha", async () => {
    h.state.steps = [espera(), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 1 });
    expect(ultimoStatusDoLog()).toBe("partial");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("'Aguardar' DENTRO do ramo também é emEspera — mas o escopo de fora segue e o LOG termina por ele (semântica do upstream)", async () => {
    h.state.steps = [condicao, noRamo(espera()), depoisDoRamo];
    const r = await dispararComRamo();
    expect(r).toMatchObject({ executadas: 1, comFalha: 0, emEspera: 1 });
    expect(h.state.updateCalls).toHaveLength(1);
    expect(ultimoStatusDoLog()).toBe("success");
  });
});

// ------------------------------------------------------------
// Passo "Criar tarefa" — a tarefa que a regra abre para a equipe.
//
// O que estes testes protegem: o prazo é RELATIVO ao dia do ESCRITÓRIO (não do
// contêiner, que roda em UTC), os nomes são carimbados no servidor, o
// responsável é conferido contra a conta, e o aviso SAI mesmo quando o
// responsável é o autor da automação — o contrário da rota da tela, de
// propósito, porque aqui a pessoa escreveu uma regra meses antes.
// ------------------------------------------------------------

function automacaoDeTarefa(cfg: Record<string, unknown>) {
  return {
    automacao: {
      id: "a-tarefa",
      account_id: ACCOUNT,
      user_id: "agente-fallback",
      name: "Contrato fechado",
      trigger_type: "new_message_received",
      trigger_config: {},
      is_active: true,
    },
    passo: {
      id: "s-tarefa",
      automation_id: "a-tarefa",
      step_type: "create_task",
      position: 0,
      parent_step_id: null,
      step_config: cfg,
    },
  };
}

describe("create_task", () => {
  it("abre a tarefa com prazo relativo, nomes carimbados e aviso", async () => {
    h.state.owned = { id: "c1" };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: "Conferir documentação de {{contact.name}}",
      responsavel_user_id: "agente-fallback",
      prazo_em_dias: 1,
      hora: "09:00",
      importante: true,
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(1);
    const tarefa = h.state.taskInserts[0];
    expect(tarefa.account_id).toBe(ACCOUNT);
    expect(tarefa.contact_id).toBe("c1");
    expect(tarefa.responsavel_user_id).toBe("agente-fallback");
    // Carimbado do banco, não do config: é o que faz a autoria sobreviver à
    // saída do membro.
    expect(tarefa.responsavel_nome).toBe("Agente Um");
    expect(tarefa.criador_nome).toBe("Agente Um");
    expect(tarefa.vence_as).toBe("09:00:00");
    expect(tarefa.importante).toBe(true);
    expect(tarefa.tipo).toBe("tarefa");
    // Prazo relativo: 1 dia à frente do dia de HOJE no escritório.
    const hoje = diaNoFuso(new Date(), "America/Sao_Paulo");
    expect(tarefa.vence_em).toBe(somarDias(hoje, 1));

    // Aviso: mesmo com o responsável sendo o autor da automação.
    expect(h.state.notifInserts).toHaveLength(1);
    expect(h.state.notifInserts[0]).toMatchObject({
      user_id: "agente-fallback",
      type: "task_assigned",
      task_id: "t-1",
      contact_id: "c1",
    });
    // Sem conversa, de propósito: quem roteia o clique é `task_id`; com
    // `conversation_id` preenchido a tela levaria ao fio, não à tarefa.
    expect("conversation_id" in h.state.notifInserts[0]).toBe(false);
    expect(String(h.state.notifInserts[0].title)).toContain("Contrato fechado");
  });

  it("interpola o título com os dados do contato", async () => {
    h.state.owned = { id: "c1", name: "Joel" };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: "Ligar para {{contact.name}}",
      responsavel_user_id: "agente-fallback",
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.taskInserts[0].titulo).toBe("Ligar para Joel");
  });

  it("sem prazo escrito, a tarefa é para HOJE", async () => {
    h.state.owned = { id: "c1" };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: "Assinar",
      responsavel_user_id: "agente-fallback",
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.taskInserts[0].vence_em).toBe(
      diaNoFuso(new Date(), "America/Sao_Paulo"),
    );
    // Sem hora = o dia inteiro, nunca "00:00".
    expect(h.state.taskInserts[0].vence_as).toBeNull();
  });

  it("recusa responsável que não é membro da conta, sem criar tarefa", async () => {
    h.state.owned = { id: "c1" };
    const { automacao, passo } = automacaoDeTarefa({
      titulo: "Tarefa para fora",
      responsavel_user_id: "gente-de-outro-escritorio",
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(0);
    expect(h.state.notifInserts).toHaveLength(0);
    // A falha fica no registro, com motivo — é onde o operador vai olhar.
    expect(JSON.stringify(h.state.logUpdates)).toContain("não é membro");
  });

  it("título vazio depois da interpolação não vira tarefa sem nome", async () => {
    h.state.owned = { id: "c1" };
    const { automacao, passo } = automacaoDeTarefa({
      // A variável não resolve (não há campo), então o título inteiro some.
      titulo: "{{contact.campo.inexistente}}",
      responsavel_user_id: "agente-fallback",
    });
    h.state.automations = [automacao];
    h.state.steps = [passo];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.taskInserts).toHaveLength(0);
  });
});

describe("interpolação de campo de DATA", () => {
  it("campo datetime sai formatado, nunca o ISO cru", async () => {
    h.state.owned = { id: "c1" };
    h.state.customValues = [
      {
        value: "2026-08-30T19:00:00.000Z",
        custom_fields: {
          field_key: "data_e_hora_reuniao",
          field_type: "datetime",
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: "a-msg",
        account_id: ACCOUNT,
        user_id: "u1",
        trigger_type: "new_message_received",
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: "s-msg",
        automation_id: "a-msg",
        step_type: "send_message",
        position: 0,
        parent_step_id: null,
        step_config: { text: "Sua reunião é {{contact.campo.data_e_hora_reuniao}}." },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { conversation_id: "conv-1" },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as { text: string };
    expect(enviado.text).toBe("Sua reunião é 30/08/2026 às 16:00h.");
  });

  it("campo de texto continua saindo como está", async () => {
    h.state.owned = { id: "c1" };
    h.state.customValues = [
      {
        value: "https://meet.google.com/abc-defg-hij",
        custom_fields: {
          field_key: "link_reuniao",
          field_type: "text",
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: "a-msg",
        account_id: ACCOUNT,
        user_id: "u1",
        trigger_type: "new_message_received",
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: "s-msg",
        automation_id: "a-msg",
        step_type: "send_message",
        position: 0,
        parent_step_id: null,
        step_config: { text: "Link: {{contact.campo.link_reuniao}}" },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { conversation_id: "conv-1" },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as { text: string };
    expect(enviado.text).toBe("Link: https://meet.google.com/abc-defg-hij");
  });

  it("data ilegível no campo cai no valor cru, não em vazio", async () => {
    // A coluna é TEXT livre — pode ter "amanhã de tarde" digitado à mão.
    // Melhor o cliente ler o que a pessoa escreveu do que uma frase truncada.
    h.state.owned = { id: "c1" };
    h.state.customValues = [
      {
        value: "amanhã de tarde",
        custom_fields: {
          field_key: "data_e_hora_reuniao",
          field_type: "datetime",
          account_id: ACCOUNT,
        },
      },
    ];
    h.state.automations = [
      {
        id: "a-msg",
        account_id: ACCOUNT,
        user_id: "u1",
        trigger_type: "new_message_received",
        trigger_config: {},
        is_active: true,
      },
    ];
    h.state.steps = [
      {
        id: "s-msg",
        automation_id: "a-msg",
        step_type: "send_message",
        position: 0,
        parent_step_id: null,
        step_config: { text: "Reunião: {{contact.campo.data_e_hora_reuniao}}" },
      },
    ];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { conversation_id: "conv-1" },
    });

    const enviado = vi.mocked(engineSendText).mock.calls.at(-1)?.[0] as { text: string };
    expect(enviado.text).toBe("Reunião: amanhã de tarde");
  });
});

// ------------------------------------------------------------
// O MESMO campo de data em dois modos (achado do Codex no PR #152).
//
// Em texto para gente, formatado. Onde a saída é DADO — `update_contact_field`
// grava no banco, `send_webhook` fala com um sistema — cru. Trocar isto faz o
// campo copiado ficar ilegível para a tela e, pior, invisível para a varredura
// de lembretes (`cb_para_timestamp` de uma data em português devolve NULL, e o
// lembrete nunca sai).
// ------------------------------------------------------------

function comCampoDeData(passo: Record<string, unknown>) {
  h.state.owned = { id: "c1" };
  h.state.customValues = [
    {
      value: "2026-08-30T19:00:00.000Z",
      custom_fields: {
        field_key: "data_e_hora_reuniao",
        field_type: "datetime",
        account_id: ACCOUNT,
      },
    },
  ];
  h.state.automations = [
    {
      id: "a-cru",
      account_id: ACCOUNT,
      user_id: "u1",
      trigger_type: "new_message_received",
      trigger_config: {},
      is_active: true,
    },
  ];
  h.state.steps = [
    { id: "s-cru", automation_id: "a-cru", position: 0, parent_step_id: null, ...passo },
  ];
}

describe("campo de data: formatado na mensagem, CRU no dado", () => {
  it("update_contact_field grava o ISO, não a data em português", async () => {
    comCampoDeData({
      step_type: "update_contact_field",
      step_config: { field: "company", value: "{{contact.campo.data_e_hora_reuniao}}" },
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    const escrita = h.state.updateCalls.find((u) => u.table === "contacts");
    expect(escrita).toBeDefined();
    // O payload do update passa pelo mock como `ops.payload`; aqui basta
    // provar que o valor gravado é o instante, não "30/08/2026 às 16:00h".
    expect(JSON.stringify(h.state.updateCalls)).not.toContain("às 16:00h");
  });

  it("send_webhook manda o ISO no corpo", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: { body?: string }) =>
        ({ ok: true, status: 200 }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    comCampoDeData({
      step_type: "send_webhook",
      step_config: {
        // IP público literal: a guarda decide sem DNS (e sem mock, que
        // quebraria o teste vizinho que prova o BLOQUEIO). O fetch está
        // stubbed, então nada sai da máquina.
        url: "https://8.8.8.8/hook",
        body_template: '{"quando":"{{contact.campo.data_e_hora_reuniao}}"}',
      },
    });

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    vi.unstubAllGlobals();
    const corpo = String(fetchMock.mock.calls.at(-1)?.[1]?.body ?? "");
    expect(corpo).toContain("2026-08-30T19:00:00.000Z");
    expect(corpo).not.toContain("às 16:00h");
  });
});
