import { describe, it, expect } from "vitest";
import {
  matchReplyId,
  matchesKeywordTrigger,
  isAutoAdvancing,
  isSuspending,
  isTerminal,
  evaluateConditionPredicate,
  camposDosBotoes,
  camposDaLista,
} from "./engine";

describe("matchReplyId", () => {
  it("returns null for nodes without options", () => {
    expect(
      matchReplyId({ node_type: "start", config: { next_node_key: "x" } }, "y"),
    ).toBeNull();
    expect(
      matchReplyId({ node_type: "send_message", config: {} }, "y"),
    ).toBeNull();
    expect(matchReplyId({ node_type: "end", config: {} }, "y")).toBeNull();
  });

  it("matches the buttons array on a send_buttons node", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick one",
        buttons: [
          { reply_id: "yes", title: "Yes", next_node_key: "confirmed" },
          { reply_id: "no", title: "No", next_node_key: "declined" },
        ],
      },
    };
    expect(matchReplyId(node, "yes")).toBe("confirmed");
    expect(matchReplyId(node, "no")).toBe("declined");
  });

  it("returns null when no button reply_id matches", () => {
    const node = {
      node_type: "send_buttons",
      config: {
        text: "Pick",
        buttons: [
          { reply_id: "a", title: "A", next_node_key: "to_a" },
          { reply_id: "b", title: "B", next_node_key: "to_b" },
        ],
      },
    };
    expect(matchReplyId(node, "c")).toBeNull();
    expect(matchReplyId(node, "")).toBeNull();
  });

  it("searches across all sections in a send_list node", () => {
    const node = {
      node_type: "send_list",
      config: {
        text: "Pick an order",
        button_label: "View",
        sections: [
          {
            title: "Recent",
            rows: [
              { reply_id: "o1", title: "Order 1", next_node_key: "ord_1" },
            ],
          },
          {
            title: "Older",
            rows: [
              { reply_id: "o2", title: "Order 2", next_node_key: "ord_2" },
              { reply_id: "o3", title: "Order 3", next_node_key: "ord_3" },
            ],
          },
        ],
      },
    };
    expect(matchReplyId(node, "o1")).toBe("ord_1");
    expect(matchReplyId(node, "o2")).toBe("ord_2");
    expect(matchReplyId(node, "o3")).toBe("ord_3");
    expect(matchReplyId(node, "o99")).toBeNull();
  });

  it("returns null when send_list has no sections / empty sections", () => {
    expect(
      matchReplyId(
        { node_type: "send_list", config: { text: "x", sections: [] } },
        "x",
      ),
    ).toBeNull();
    expect(
      matchReplyId(
        {
          node_type: "send_list",
          config: { text: "x", sections: [{ rows: [] }] },
        },
        "x",
      ),
    ).toBeNull();
  });
});

describe("matchesKeywordTrigger", () => {
  it("returns false for empty text", () => {
    expect(matchesKeywordTrigger("", { keywords: ["hi"] })).toBe(false);
  });

  it("returns false when keywords array is empty", () => {
    expect(matchesKeywordTrigger("anything", { keywords: [] })).toBe(false);
  });

  it("default match_type='contains' does case-insensitive substring", () => {
    const cfg = { keywords: ["support"] };
    expect(matchesKeywordTrigger("I need SUPPORT please", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Support is great", cfg)).toBe(true);
    expect(matchesKeywordTrigger("Help me", cfg)).toBe(false);
  });

  it("match_type='exact' compares the whole string case-insensitively", () => {
    const cfg = { keywords: ["help"], match_type: "exact" as const };
    expect(matchesKeywordTrigger("help", cfg)).toBe(true);
    expect(matchesKeywordTrigger("HELP", cfg)).toBe(true);
    expect(matchesKeywordTrigger("help me", cfg)).toBe(false);
  });

  it("case_sensitive=true preserves case", () => {
    const cfg = {
      keywords: ["Support"],
      case_sensitive: true,
    };
    expect(matchesKeywordTrigger("I need Support", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need support", cfg)).toBe(false);
  });

  it("matches any one of multiple keywords", () => {
    const cfg = { keywords: ["help", "support", "issue"] };
    expect(matchesKeywordTrigger("I have an issue", cfg)).toBe(true);
    expect(matchesKeywordTrigger("I need Help!", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nothing to see here", cfg)).toBe(false);
  });

  it("skips empty strings in the keywords array", () => {
    const cfg = { keywords: ["", "support", ""] };
    expect(matchesKeywordTrigger("support center", cfg)).toBe(true);
    expect(matchesKeywordTrigger("nope", cfg)).toBe(false);
  });
});

describe("node classification helpers", () => {
  it("isAutoAdvancing covers start + send_message + send_media + condition + set_tag", () => {
    expect(isAutoAdvancing("start")).toBe(true);
    expect(isAutoAdvancing("send_message")).toBe(true);
    expect(isAutoAdvancing("send_media")).toBe(true);
    expect(isAutoAdvancing("condition")).toBe(true);
    expect(isAutoAdvancing("set_tag")).toBe(true);
    expect(isAutoAdvancing("send_buttons")).toBe(false);
    expect(isAutoAdvancing("send_list")).toBe(false);
    expect(isAutoAdvancing("collect_input")).toBe(false);
    expect(isAutoAdvancing("handoff")).toBe(false);
    expect(isAutoAdvancing("end")).toBe(false);
  });

  it("isSuspending covers the input-requiring nodes", () => {
    expect(isSuspending("send_buttons")).toBe(true);
    expect(isSuspending("send_list")).toBe(true);
    expect(isSuspending("collect_input")).toBe(true);
    expect(isSuspending("start")).toBe(false);
    expect(isSuspending("send_message")).toBe(false);
    expect(isSuspending("condition")).toBe(false);
    expect(isSuspending("set_tag")).toBe(false);
    expect(isSuspending("handoff")).toBe(false);
    expect(isSuspending("end")).toBe(false);
  });

  it("isTerminal covers handoff + end", () => {
    expect(isTerminal("handoff")).toBe(true);
    expect(isTerminal("end")).toBe(true);
    expect(isTerminal("start")).toBe(false);
    expect(isTerminal("send_buttons")).toBe(false);
    expect(isTerminal("condition")).toBe(false);
  });

  it("the three classifications are mutually exclusive for known node types", () => {
    const types = [
      "start",
      "send_message",
      "send_buttons",
      "send_list",
      "send_media",
      "collect_input",
      "condition",
      "set_tag",
      "handoff",
      "end",
    ];
    for (const t of types) {
      const flags = [isAutoAdvancing(t), isSuspending(t), isTerminal(t)];
      // Exactly one of the three should be true for every known node.
      expect(flags.filter(Boolean).length).toBe(1);
    }
  });
});

describe("evaluateConditionPredicate", () => {
  it("present: true when subject has a value", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "alice@example.com",
        configValue: undefined,
      }),
    ).toBe(true);
  });

  it("present: false when subject is undefined or empty", () => {
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(false);
    expect(
      evaluateConditionPredicate({
        operator: "present",
        subjectValue: "",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("absent: inverse of present", () => {
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: undefined,
        configValue: undefined,
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "absent",
        subjectValue: "x",
        configValue: undefined,
      }),
    ).toBe(false);
  });

  it("equals: exact string comparison; case-sensitive", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "VIP",
        configValue: "VIP",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: "vip",
        configValue: "VIP",
      }),
    ).toBe(false);
  });

  it("equals: undefined subject never matches (even against empty)", () => {
    expect(
      evaluateConditionPredicate({
        operator: "equals",
        subjectValue: undefined,
        configValue: "",
      }),
    ).toBe(false);
  });

  it("contains: substring match", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@example.com",
        configValue: "@example.com",
      }),
    ).toBe(true);
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: "support@other.com",
        configValue: "@example.com",
      }),
    ).toBe(false);
  });

  it("contains: undefined subject never matches", () => {
    expect(
      evaluateConditionPredicate({
        operator: "contains",
        subjectValue: undefined,
        configValue: "anything",
      }),
    ).toBe(false);
  });
});

// ============================================================
// {{vars}} nos nós interativos (upstream #553, Fase 4 do plano do merge do
// upstream). Até aqui os dois nós mandavam o texto CRU: depois de um
// collect_input, o cliente recebia "Oi {{vars.name}}" literal.
// ============================================================

describe("camposDosBotoes", () => {
  const cfg = {
    text: "Oi {{vars.name}}, escolha:",
    header_text: "Caso {{vars.caso}}",
    footer_text: "Equipe {{vars.area}}",
    buttons: [
      { reply_id: "sim_{{vars.name}}", title: "Sim, {{vars.name}}", next_node_key: "a" },
      { reply_id: "nao", title: "Não", next_node_key: "b" },
    ],
  };
  const vars = { name: "Ana", caso: "123", area: "Bancário" };

  it("interpola todo texto visível", () => {
    const c = camposDosBotoes(cfg, vars);
    expect(c.bodyText).toBe("Oi Ana, escolha:");
    expect(c.headerText).toBe("Caso 123");
    expect(c.footerText).toBe("Equipe Bancário");
    expect(c.buttons.map((b) => b.title)).toEqual(["Sim, Ana", "Não"]);
  });

  it("⚠️ o reply_id NUNCA é interpolado: é a chave que matchReplyId compara", () => {
    const c = camposDosBotoes(cfg, vars);
    expect(c.buttons.map((b) => b.id)).toEqual(["sim_{{vars.name}}", "nao"]);
  });

  it("campo opcional ausente continua ausente (não vira \"\")", () => {
    const c = camposDosBotoes({ text: "x", buttons: [] }, vars);
    expect(c.headerText).toBeUndefined();
    expect(c.footerText).toBeUndefined();
  });

  it("variável que não existe vira vazio, como no send_message", () => {
    expect(camposDosBotoes({ text: "Oi {{vars.nada}}!", buttons: [] }, {}).bodyText).toBe("Oi !");
  });

  it("não corta título que a interpolação alongou — quem recusa é o meta-api, com o motivo", () => {
    const longo = camposDosBotoes(
      { text: "x", buttons: [{ reply_id: "a", title: "{{vars.name}}", next_node_key: "z" }] },
      { name: "Um nome bem maior que vinte letras" },
    );
    expect(longo.buttons[0].title).toBe("Um nome bem maior que vinte letras");
  });
});

describe("camposDaLista", () => {
  const cfg = {
    text: "{{vars.name}}, qual área?",
    button_label: "Ver {{vars.qtd}} opções",
    header_text: "Caso {{vars.caso}}",
    footer_text: "Equipe {{vars.area}}",
    sections: [
      {
        title: "Para {{vars.name}}",
        rows: [
          { reply_id: "r_{{vars.name}}", title: "Área {{vars.area}}", description: "Com {{vars.name}}", next_node_key: "a" },
          { reply_id: "r2", title: "Outra", next_node_key: "b" },
        ],
      },
      { rows: [{ reply_id: "r3", title: "Sem seção", next_node_key: "c" }] },
    ],
  };
  const vars = { name: "Ana", qtd: 3, area: "Trabalhista", caso: "77" };

  it("interpola corpo, rótulo, cabeçalho, rodapé, título de seção, título e descrição de linha", () => {
    const c = camposDaLista(cfg, vars);
    expect(c.bodyText).toBe("Ana, qual área?");
    expect(c.buttonLabel).toBe("Ver 3 opções");
    expect(c.headerText).toBe("Caso 77");
    expect(c.footerText).toBe("Equipe Trabalhista");
    expect(c.sections[0].title).toBe("Para Ana");
    expect(c.sections[0].rows[0]).toEqual({ id: "r_{{vars.name}}", title: "Área Trabalhista", description: "Com Ana" });
  });

  it("opcional ausente (ou nulo, como vem do JSONB) continua ausente", () => {
    const c = camposDaLista({ ...cfg, header_text: undefined, footer_text: null } as never, vars);
    expect(c.headerText).toBeUndefined();
    expect(c.footerText).toBeUndefined();
  });

  it("o reply_id da linha fica intacto, e descrição/título de seção ausentes continuam ausentes", () => {
    const c = camposDaLista(cfg, vars);
    expect(c.sections[0].rows[1].description).toBeUndefined();
    expect(c.sections[1].title).toBeUndefined();
    expect(c.sections.flatMap((sec) => sec.rows.map((r) => r.id))).toEqual(["r_{{vars.name}}", "r2", "r3"]);
  });
});
