import { describe, expect, it } from "vitest";
import {
  validateAsaasReguaForActivation,
  validateChannelScopeForActivation,
  validateStepsForActivation,
  validateTriggerForActivation,
} from "./validate";

describe("validateStepsForActivation", () => {
  it("rejects empty or missing step lists", () => {
    expect(validateStepsForActivation([])).toEqual([
      { path: "steps", message: "active automations need at least one step" },
    ]);
    expect(
      validateStepsForActivation(undefined as unknown as never[]),
    ).toEqual([
      { path: "steps", message: "active automations need at least one step" },
    ]);
  });

  it("passes a fully-populated step set", () => {
    const issues = validateStepsForActivation([
      { step_type: "send_message", step_config: { text: "hi" } },
      {
        step_type: "wait",
        step_config: { amount: 5, unit: "minutes" },
      },
      { step_type: "add_tag", step_config: { tag_id: "tag-uuid" } },
      { step_type: "close_conversation", step_config: {} },
    ]);
    expect(issues).toEqual([]);
  });

  it("flags every required field that is missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "send_message", step_config: { text: "  " } },
      { step_type: "send_template", step_config: {} },
      { step_type: "add_tag", step_config: { tag_id: "" } },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].text",
      "steps[1].template_name",
      "steps[2].tag_id",
    ]);
  });

  it("checks wait amount and unit boundaries", () => {
    const issues = validateStepsForActivation([
      { step_type: "wait", step_config: { amount: 0, unit: "minutes" } },
      // `seconds` passou a ser unidade VÁLIDA (as pausas curtas das automações
      // do escritório); o inválido de verdade aqui é uma unidade que o motor
      // não sabe converter — `waitMs` cairia no fallback de minutos e a espera
      // de "2 semanas" duraria 2 minutos.
      { step_type: "wait", step_config: { amount: 5, unit: "weeks" } },
      { step_type: "wait", step_config: { amount: -1, unit: "hours" } },
      {
        step_type: "wait",
        step_config: { amount: Number.POSITIVE_INFINITY, unit: "days" },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].amount",
      "steps[1].unit",
      "steps[2].amount",
      "steps[3].amount",
    ]);
  });

  it("wait: parar_se_responder só aceita booleano", () => {
    // O motor liga a opção apenas com `true` estrito. Um "true" gravado seria
    // caixa que parece marcada para quem lê o JSON e que o motor ignora.
    const issues = validateStepsForActivation([
      { step_type: "wait", step_config: { amount: 1, unit: "hours", parar_se_responder: true } },
      { step_type: "wait", step_config: { amount: 1, unit: "hours", parar_se_responder: false } },
      { step_type: "wait", step_config: { amount: 1, unit: "hours" } },
      { step_type: "wait", step_config: { amount: 1, unit: "hours", parar_se_responder: "true" } },
      { step_type: "wait", step_config: { amount: 1, unit: "hours", parar_se_responder: 1 } },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[3].parar_se_responder",
      "steps[4].parar_se_responder",
    ]);
  });

  it("wait no modo horário (B6a): a janela tem de ser legível; amount/unit não contam", () => {
    const horario = (config: Record<string, unknown>) => ({
      step_type: "wait",
      step_config: { modo: "horario", ...config },
    });
    const issues = validateStepsForActivation([
      horario({ janela: "08:00-21:00" }),
      // amount/unit gravados (voltar para "por um tempo" os devolve) e inválidos: ignorados.
      horario({ janela: "08:00-21:00", amount: 0, unit: "weeks" }),
      horario({ janela: "00:00-24:00", somente_seg_a_sex: true }),
      horario({ janela: "09:00-09:00" }),
      horario({ janela: "" }),
      horario({}),
      horario({ janela: "amanhã" }),
      horario({ janela: "08:00-21:00", somente_seg_a_sex: "true" }),
      { step_type: "wait", step_config: { modo: "Horario", amount: 1, unit: "hours" } },
      { step_type: "wait", step_config: { modo: "tempo", amount: 1, unit: "hours" } },
      // No modo tempo o "segunda a sexta" não vale, mas o tipo continua conferido.
      { step_type: "wait", step_config: { amount: 1, unit: "hours", somente_seg_a_sex: 1 } },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[3].janela",
      "steps[4].janela",
      "steps[5].janela",
      "steps[6].janela",
      "steps[7].somente_seg_a_sex",
      "steps[8].modo",
      "steps[10].somente_seg_a_sex",
    ]);
  });

  it("validates webhook URLs", () => {
    const good = validateStepsForActivation([
      {
        step_type: "send_webhook",
        step_config: { url: "https://hooks.example.com/in" },
      },
    ]);
    expect(good).toEqual([]);

    const noUrl = validateStepsForActivation([
      { step_type: "send_webhook", step_config: {} },
    ]);
    expect(noUrl.map((i) => i.message)).toContain("webhook URL is required");

    const wrongProtocol = validateStepsForActivation([
      {
        step_type: "send_webhook",
        step_config: { url: "ftp://files.example.com" },
      },
    ]);
    expect(wrongProtocol.map((i) => i.message)).toContain(
      "webhook URL must use http or https",
    );

    const garbage = validateStepsForActivation([
      { step_type: "send_webhook", step_config: { url: "not a url" } },
    ]);
    expect(garbage.map((i) => i.message)).toContain(
      "webhook URL is not a valid URL",
    );
  });

  it("validates assign_conversation only when mode is 'specific'", () => {
    const roundRobinNoAgent = validateStepsForActivation([
      {
        step_type: "assign_conversation",
        step_config: { mode: "round_robin" },
      },
    ]);
    expect(roundRobinNoAgent).toEqual([]);

    const specificMissingAgent = validateStepsForActivation([
      { step_type: "assign_conversation", step_config: { mode: "specific" } },
    ]);
    expect(specificMissingAgent.map((i) => i.path)).toEqual([
      "steps[0].agent_id",
    ]);
  });

  it("flags create_deal when required fields are missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "create_deal", step_config: {} },
    ]);
    expect(issues.map((i) => i.path).sort()).toEqual([
      "steps[0].pipeline_id",
      "steps[0].stage_id",
      "steps[0].title",
    ]);
  });

  it("validates send_buttons / send_list interactive payloads", () => {
    const good = validateStepsForActivation([
      {
        step_type: "send_buttons",
        step_config: {
          kind: "buttons",
          body: "Pick one",
          buttons: [{ id: "yes", title: "Yes" }],
        },
      },
    ]);
    expect(good).toEqual([]);

    const tooMany = validateStepsForActivation([
      {
        step_type: "send_buttons",
        step_config: {
          kind: "buttons",
          body: "Pick one",
          buttons: [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
            { id: "c", title: "C" },
            { id: "d", title: "D" },
          ],
        },
      },
    ]);
    expect(tooMany.map((i) => i.path)).toEqual(["steps[0].interactive"]);
  });

  it("flags update_contact_field when field or value is missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "update_contact_field", step_config: { field: "name" } },
      {
        step_type: "update_contact_field",
        step_config: { field: "", value: "x" },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].value",
      "steps[1].field",
    ]);
  });

  it("recursively walks condition branches with stable dot-paths", () => {
    const issues = validateStepsForActivation([
      {
        step_type: "condition",
        step_config: { subject: "tag", operand: "vip" },
        branches: {
          yes: [{ step_type: "add_tag", step_config: { tag_id: "" } }],
          no: [
            {
              step_type: "send_message",
              step_config: { text: "" },
            },
          ],
        },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].yes.steps[0].tag_id",
      "steps[0].no.steps[0].text",
    ]);
  });

  it("reports an issue for unknown step types", () => {
    const issues = validateStepsForActivation([
      { step_type: "do_a_barrel_roll", step_config: {} },
    ]);
    expect(issues).toEqual([
      { path: "steps[0]", message: "unknown step type: do_a_barrel_roll" },
    ]);
  });

  it("flags condition subject/operand independently", () => {
    const issues = validateStepsForActivation([
      { step_type: "condition", step_config: {} },
    ]);
    expect(issues.map((i) => i.path).sort()).toEqual([
      "steps[0].operand",
      "steps[0].subject",
    ]);
  });

  it("hora do dia: a janela tem de ser lida pelo motor (senão o ramo morre em silêncio)", () => {
    const cond = (step_config: Record<string, unknown>) =>
      validateStepsForActivation([{ step_type: "condition", step_config }]).map((i) => i.path);
    expect(cond({ subject: "time_of_day", operand: "08:00-21:00" })).toEqual([]);
    expect(cond({ subject: "time_of_day", operand: "18:00-09:00" })).toEqual([]);
    // O que o upstream aceitava continua passando.
    expect(cond({ subject: "time_of_day", operand: "9-18" })).toEqual([]);
    for (const operand of ["09:00-09:00", "25:00-09:00", "09:00-", "uma-etiqueta"]) {
      expect(cond({ subject: "time_of_day", operand })).toEqual(["steps[0].operand"]);
    }
    expect(cond({ subject: "time_of_day", operand: "" })).toEqual(["steps[0].operand"]);
  });

  it("hora do dia: somente_seg_a_sex só aceita booleano", () => {
    const cond = (somente_seg_a_sex: unknown) =>
      validateStepsForActivation([
        { step_type: "condition", step_config: { subject: "time_of_day", operand: "08:00-21:00", somente_seg_a_sex } },
      ]).map((i) => i.path);
    expect(cond(true)).toEqual([]);
    expect(cond(false)).toEqual([]);
    expect(cond(undefined)).toEqual([]);
    expect(cond("true")).toEqual(["steps[0].somente_seg_a_sex"]);
    expect(cond(1)).toEqual(["steps[0].somente_seg_a_sex"]);
  });
});

describe("validateTriggerForActivation", () => {
  it("gatilho de etapa: parar_ao_sair só aceita booleano", () => {
    // O motor prende a automação à etapa apenas com `true` estrito — um
    // "true" gravado seria opção que parece ligada e não age, e a sequência
    // de No Show seguiria cobrando quem já reagendou.
    const etapa = ["etapa-1"];
    for (const valor of [true, false, undefined]) {
      expect(
        validateTriggerForActivation("deal_stage_changed", {
          stage_ids: etapa,
          parar_ao_sair: valor,
        }),
      ).toEqual([]);
    }
    for (const valor of ["true", 1, null]) {
      expect(
        validateTriggerForActivation("deal_stage_changed", {
          stage_ids: etapa,
          parar_ao_sair: valor,
        }).map((i) => i.path),
      ).toEqual(["trigger.parar_ao_sair"]);
    }
  });

  it("accepts a valid keyword_match config", () => {
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["hello", "hi"],
        match_type: "exact",
      }),
    ).toEqual([]);
  });

  it("rejects keyword_match with empty keyword array", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: [],
      match_type: "exact",
    });
    expect(issues.map((i) => i.path)).toContain("trigger.keywords");
  });

  it("rejects keyword_match with whitespace-only entries", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: ["hi", "   "],
      match_type: "contains",
    });
    expect(issues.map((i) => i.message)).toContain(
      "keywords cannot be empty strings",
    );
  });

  it("rejects keyword_match with an unknown match_type", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: ["hi"],
      match_type: "fuzzy",
    });
    expect(issues.map((i) => i.path)).toContain("trigger.match_type");
  });

  it("accepts keyword_match with a missing match_type (defaults to contains)", () => {
    expect(
      validateTriggerForActivation("keyword_match", { keywords: ["hi"] }),
    ).toEqual([]);
  });

  it("accepts the word match_type (issue #409)", () => {
    // Activation validation has to stay in step with the engine and the
    // builder's dropdown — an automation the UI can save must not be
    // rejected on activation.
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["hi"],
        match_type: "word",
      }),
    ).toEqual([]);
  });

  it("requires schedule on time_based triggers", () => {
    expect(validateTriggerForActivation("time_based", {})).toEqual([
      { path: "trigger.schedule", message: "schedule is required" },
    ]);
    expect(
      validateTriggerForActivation("time_based", { schedule: "0 9 * * *" }),
    ).toEqual([]);
  });

  it("requires tag_id on tag_added triggers", () => {
    expect(validateTriggerForActivation("tag_added", {})).toEqual([
      { path: "trigger.tag_id", message: "tag is required" },
    ]);
    expect(
      validateTriggerForActivation("tag_added", { tag_id: "tag-uuid" }),
    ).toEqual([]);
  });

  it("requires reply_ids on interactive_reply triggers", () => {
    expect(validateTriggerForActivation("interactive_reply", {})).toEqual([
      { path: "trigger.reply_ids", message: "at least one reply id is required" },
    ]);
    expect(
      validateTriggerForActivation("interactive_reply", { reply_ids: ["yes", "no"] }),
    ).toEqual([]);
    const empties = validateTriggerForActivation("interactive_reply", {
      reply_ids: ["yes", "  "],
    });
    expect(empties.map((i) => i.message)).toContain(
      "reply ids cannot be empty strings",
    );
  });

  it("does not flag unknown trigger types (handled elsewhere)", () => {
    expect(validateTriggerForActivation("some_future_trigger", {})).toEqual([]);
  });
});

describe("send_to_number / calendly_booking (977)", () => {
  it("exige telefone (pela régua das telas) e texto", () => {
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone: "(83) 98000-0016", text: "oi" } }]),
    ).toEqual([]);
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone: "123", text: "oi" } }]),
    ).toEqual([{ path: "steps[0].phone", message: "phone is too short (missing the area code?)" }]);
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { text: "oi" } }]),
    ).toEqual([{ path: "steps[0].phone", message: "phone is required" }]);
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone: "+1 404 555 1234", text: "oi" } }]),
    ).toEqual([]);
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone: "5583980000016", text: " " } }]),
    ).toEqual([{ path: "steps[0].text", message: "message text is required" }]);
  });

  it("o número sem DDD e o id do WhatsApp colado são recusados na ATIVAÇÃO, não no envio", () => {
    // Pela régua dos sistemas (`digitosDoTelefone`, até a Fase 3-III) passavam:
    // "98000-0016" virava +98, e o LID virava telefone (os 15 dígitos dele como
    // destino do aviso). O JID de pessoa caía no número certo por acaso, e é
    // recusado junto — texto com letra não é número digitado.
    for (const [phone, motivo] of [
      ["98000-0016", "phone is too short (missing the area code?)"],
      ["123456789012345@lid", "phone is not a valid number (Brazilian: with the area code; other countries: with + and the country code)"],
      ["5583980000016@s.whatsapp.net", "phone is not a valid number (Brazilian: with the area code; other countries: with + and the country code)"],
      ["083 98000-0016", "phone is not a valid number (Brazilian: with the area code; other countries: with + and the country code)"],
    ]) {
      expect(
        validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone, text: "oi" } }]),
      ).toEqual([{ path: "steps[0].phone", message: motivo }]);
    }
  });

  it("gatilho: vazio é 'qualquer evento'; só lixo é recusado", () => {
    expect(validateTriggerForActivation("calendly_booking", {})).toEqual([]);
    expect(validateTriggerForActivation("calendly_booking", { event_type_uri: "https://api.calendly.com/event_types/A" })).toEqual([]);
    expect(validateTriggerForActivation("calendly_booking", { event_type_uri: 12 })).toEqual([
      { path: "trigger.event_type_uri", message: "event type must be a string" },
    ]);
  });
});

// ============================================================
// A régua do Asaas (998): o marco obrigatório na cobrança, a hora na faixa
// 08:00–17:00, e as duas regras a MAIS dos passos — sem "Aguardar" e toda
// mensagem com a conexão escolhida (D19).
// ============================================================

describe('régua do Asaas — o gatilho', () => {
  it('a cobrança exige o marco (1..365); o lembrete não tem marco', () => {
    expect(validateTriggerForActivation('asaas_cobranca_vencida', {})).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vencida', { dias_de_atraso: 0 })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vencida', { dias_de_atraso: 366 })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vencida', { dias_de_atraso: 5 })).toEqual([])
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', {})).toEqual([])
  })

  it('a hora fica entre 08:00 e 17:00, e "só dia útil" é booleano', () => {
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { hora_envio: '07:30' })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { hora_envio: '17:00' })).toEqual([])
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { hora_envio: '9h' })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { somente_dias_uteis: 'false' })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { somente_dias_uteis: false })).toEqual([])
  })
})

describe('régua do Asaas — os passos', () => {
  const msg = (channel_id?: string) => ({ step_type: 'send_message', step_config: channel_id ? { text: 'x', channel_id } : { text: 'x' } })

  it('toda mensagem precisa da conexão escolhida, em qualquer escopo', () => {
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg('c1')])).toEqual([])
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg()])).toHaveLength(1)
    expect(
      validateAsaasReguaForActivation('asaas_cobranca_vence_hoje', [
        { step_type: 'condition', step_config: { subject: 'tag_presence', operand: 't' }, branches: { yes: [msg()], no: [msg('c1')] } },
      ]),
    ).toHaveLength(1)
  })

  it('"Aguardar" é recusado em qualquer escopo — cada marco é uma automação própria', () => {
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg('c1'), { step_type: 'wait', step_config: { amount: 1, unit: 'minutes' } }])).toHaveLength(1)
  })

  it('inclusive o "até estar dentro do horário" (B6a): também retoma sem reconfirmar o pagamento', () => {
    const horario = { step_type: 'wait', step_config: { modo: 'horario', janela: '08:00-18:00' } }
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [horario, msg('c1')]).map((i) => i.path)).toEqual(['steps[0].step_type'])
    expect(
      validateAsaasReguaForActivation('asaas_cobranca_vence_hoje', [
        { step_type: 'condition', step_config: {}, branches: { yes: [horario, msg('c1')] } },
      ]).map((i) => i.path),
    ).toEqual(['steps[0].yes.steps[0].step_type'])
  })

  it('"Acionar automação" e "Iniciar robô" são recusados em qualquer escopo — a entrega pela filha não conta como envio e a filha pode esperar (revisão da 4ª rodada do PR #206)', () => {
    const acionar = { step_type: 'run_automation', step_config: { automation_id: 'filha' } }
    const robo = { step_type: 'run_flow', step_config: { flow_id: 'f' } }
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg('c1'), acionar]).map((i) => i.path)).toEqual(['steps[1].step_type'])
    expect(validateAsaasReguaForActivation('asaas_cobranca_vence_hoje', [msg('c1'), robo]).map((i) => i.path)).toEqual(['steps[1].step_type'])
    expect(
      validateAsaasReguaForActivation('asaas_cobranca_vencida', [
        { step_type: 'condition', step_config: {}, branches: { yes: [msg('c1')], no: [acionar, robo] } },
      ]).map((i) => i.path),
    ).toEqual(['steps[0].no.steps[0].step_type', 'steps[0].no.steps[1].step_type'])
    // parar continua permitido: não entrega nada ao contato
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg('c1'), { step_type: 'stop_automation', step_config: { automation_id: 'x' } }, { step_type: 'stop_flow', step_config: {} }])).toEqual([])
    expect(validateAsaasReguaForActivation('keyword_match', [msg(), acionar, robo])).toEqual([])
  })

  it('modelo, botões e lista são recusados em qualquer escopo — só saem pela Meta, que a varredura não sonda e o motor não cerca (revisão da 4ª rodada do PR #206)', () => {
    const modelo = { step_type: 'send_template', step_config: { template_name: 'cobranca', language: 'pt_BR', channel_id: 'meta-2' } }
    const botoes = { step_type: 'send_buttons', step_config: { body: 'x', buttons: [{ id: 'a', title: 'A' }] } }
    const lista = { step_type: 'send_list', step_config: { body: 'x', button: 'ver', sections: [] } }
    // o cenário medido: o modelo fixado num número oficial, dentro do ramo — ativava
    expect(
      validateAsaasReguaForActivation('asaas_cobranca_vencida', [
        msg('c1'),
        { step_type: 'condition', step_config: {}, branches: { yes: [modelo] } },
      ]).map((i) => i.path),
    ).toEqual(['steps[1].yes.steps[0].step_type'])
    expect(validateAsaasReguaForActivation('asaas_cobranca_vence_hoje', [msg('c1'), botoes, lista]).map((i) => i.path)).toEqual(['steps[1].step_type', 'steps[2].step_type'])
    expect(validateAsaasReguaForActivation('keyword_match', [msg(), modelo, botoes, lista])).toEqual([])
  })

  it('outros gatilhos não são tocados', () => {
    expect(validateAsaasReguaForActivation('keyword_match', [msg(), { step_type: 'wait', step_config: { amount: 1, unit: 'days' } }])).toEqual([])
  })
})

describe('régua do Asaas — uma conexão só para todos os envios (revisão adversarial, PR #206)', () => {
  const envio = (channel_id?: string) => ({ step_type: 'send_message', step_config: channel_id ? { text: 'x', channel_id } : { text: 'x' } })

  it('dois envios pela mesma conexão passam; por conexões diferentes, o segundo é recusado — inclusive dentro de um ramo', () => {
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [envio('c1'), envio('c1')])).toEqual([])
    const fora = validateAsaasReguaForActivation('asaas_cobranca_vencida', [envio('c1'), envio('c2')])
    expect(fora).toHaveLength(1)
    expect(fora[0].path).toBe('steps[1].channel_id')
    const noRamo = validateAsaasReguaForActivation('asaas_cobranca_vence_hoje', [
      { step_type: 'condition', step_config: {}, branches: { yes: [envio('c2')], no: [] } },
      envio('c1'),
    ])
    expect(noRamo.map((i) => i.path)).toEqual(['steps[1].channel_id'])
  })

  it('send_media entra na mesma regra: precisa da conexão, e da MESMA', () => {
    const midia = (channel_id?: string) => ({ step_type: 'send_media', step_config: channel_id ? { media_url: 'u', channel_id } : { media_url: 'u' } })
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [envio('c1'), midia()])).toHaveLength(1)
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [envio('c1'), midia('c3')])).toHaveLength(1)
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [envio('c1'), midia('c1')])).toEqual([])
  })
})

describe('régua do Asaas — precisa de um passo de mensagem de texto (Codex, 3ª rodada do PR #206)', () => {
  it('só send_media, ou nenhum envio, não ativa; com um send_message ativa', () => {
    const midia = { step_type: 'send_media', step_config: { media_url: 'u', channel_id: 'c1' } }
    const texto = { step_type: 'send_message', step_config: { text: 'x', channel_id: 'c1' } }
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [midia]).map((i) => i.path)).toEqual(['steps'])
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [{ step_type: 'add_tag', step_config: { tag_id: 't' } }]).map((i) => i.path)).toEqual(['steps'])
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [midia, texto])).toEqual([])
    expect(validateAsaasReguaForActivation('asaas_cobranca_vence_hoje', [{ step_type: 'condition', step_config: {}, branches: { yes: [texto], no: [] } }])).toEqual([])
  })
})

// Fase 2 do plano do previdenciário (26/09/2026).
describe('previdenciário — Fase 2 (modelo, tarefa, janela)', () => {
  const paths = (steps: { step_type: string; step_config: Record<string, unknown> }[]) =>
    validateStepsForActivation(steps).map((i) => i.path)

  it('send_template: valores por POSIÇÃO; chave que não é posição é recusada', () => {
    expect(
      paths([
        {
          step_type: 'send_template',
          step_config: {
            template_name: 'x',
            variables: { '1': '{{contact.name}}', '2': 'AA' },
            variaveis_reserva: { '1': 'cliente' },
            button_params: { '0': 'abc' },
            header_media_url: 'https://cdn.test/a.png',
          },
        },
      ])
    ).toEqual([])
    expect(
      paths([{ step_type: 'send_template', step_config: { template_name: 'x', variables: { nome: 'a' } } }])
    ).toEqual(['steps[0].variables'])
    expect(
      paths([{ step_type: 'send_template', step_config: { template_name: 'x', variables: { '1': 5 } } }])
    ).toEqual(['steps[0].variables.1'])
  })

  it('send_template: arquivo do cabeçalho tem de ser endereço http(s)', () => {
    expect(
      paths([{ step_type: 'send_template', step_config: { template_name: 'x', header_media_url: 'javascript:alert(1)' } }])
    ).toEqual(['steps[0].header_media_url'])
  })

  it('create_task: a pessoa é obrigatória em TODO modo — nos dinâmicos, como RESERVA', () => {
    // Sem reserva, o caso comum (ninguém atribuído — nenhum card da conta tem
    // responsável) falharia de madrugada e pararia as mensagens seguintes.
    expect(paths([{ step_type: 'create_task', step_config: { titulo: 'T', responsavel_user_id: '' } }])).toEqual([
      'steps[0].responsavel_user_id',
    ])
    expect(
      paths([{ step_type: 'create_task', step_config: { titulo: 'T', responsavel_modo: 'conversa', responsavel_user_id: '' } }])
    ).toEqual(['steps[0].responsavel_user_id'])
    expect(
      paths([{ step_type: 'create_task', step_config: { titulo: 'T', responsavel_modo: 'card' } }])
    ).toEqual(['steps[0].responsavel_user_id'])
    expect(
      paths([{ step_type: 'create_task', step_config: { titulo: 'T', responsavel_modo: 'card', responsavel_user_id: 'u' } }])
    ).toEqual([])
    expect(
      paths([{ step_type: 'create_task', step_config: { titulo: 'T', responsavel_modo: 'rodizio', responsavel_user_id: 'u' } }])
    ).toEqual(['steps[0].responsavel_modo'])
  })

  it('send_template: posição acima do teto e botão fora de 0–9 são recusados', () => {
    expect(
      paths([{ step_type: 'send_template', step_config: { template_name: 'x', variables: { '999999': 'a' } } }])
    ).toEqual(['steps[0].variables'])
    expect(
      paths([{ step_type: 'send_template', step_config: { template_name: 'x', variaveis_reserva: { '50': 'a' } } }])
    ).toEqual([])
    expect(
      paths([{ step_type: 'send_template', step_config: { template_name: 'x', button_params: { '10': 'a' } } }])
    ).toEqual(['steps[0].button_params'])
  })

  it('condição da janela de 24h dispensa o operando; as outras continuam exigindo', () => {
    expect(paths([{ step_type: 'condition', step_config: { subject: 'meta_window_open', operand: '' } }])).toEqual([])
    expect(paths([{ step_type: 'condition', step_config: { subject: 'tag_presence', operand: '' } }])).toEqual([
      'steps[0].operand',
    ])
  })
})

describe('condição da janela × conexão fixa das mensagens do Sim (Fase 2.8)', () => {
  const CANAIS = [
    { id: 'oficial', label: 'API - Meta', kind: 'meta' as const },
    { id: 'oficial-2', label: 'Meta 2', kind: 'meta' as const },
    { id: 'qr', label: 'QR Comercial', kind: 'evolution' as const },
  ]
  const janela = (operand: string, yes: { step_type: string; step_config: Record<string, unknown> }[]) => ({
    step_type: 'condition',
    step_config: { subject: 'meta_window_open', operand },
    branches: { yes, no: [] },
  })
  const texto = (channel_id?: string) => ({
    step_type: 'send_message',
    step_config: channel_id ? { text: 'oi', channel_id } : { text: 'oi' },
  })

  it('em branco com o texto do Sim FIXO no oficial: recusa, nomeando o número', () => {
    const issues = validateChannelScopeForActivation([janela('', [texto('oficial')])], null, CANAIS)
    expect(issues.map((i) => i.path)).toEqual(['steps[0].operand'])
    expect(issues[0].message).toContain('"API - Meta"')
    expect(issues[0].message).toContain('do número do disparo')
  })

  it('o mesmo número nos dois lados: passa', () => {
    expect(validateChannelScopeForActivation([janela('oficial', [texto('oficial')])], null, CANAIS)).toEqual([])
  })

  it('os dois HERDAM o disparo: passa (é o caso comum)', () => {
    expect(validateChannelScopeForActivation([janela('', [texto()])], null, CANAIS)).toEqual([])
  })

  it('texto fixo num QR Code, ou numa conexão apagada: não há janela a errar', () => {
    expect(validateChannelScopeForActivation([janela('', [texto('qr')])], null, CANAIS)).toEqual([])
    expect(validateChannelScopeForActivation([janela('', [texto('apagada')])], null, CANAIS)).toEqual([])
  })

  it('operando noutro oficial, ou o Sim dividido entre dois: recusa', () => {
    expect(
      validateChannelScopeForActivation([janela('oficial-2', [texto('oficial')])], null, CANAIS)[0].message
    ).toContain('de "Meta 2"')
    expect(
      validateChannelScopeForActivation([janela('oficial', [texto('oficial'), texto('oficial-2')])], null, CANAIS)[0]
        .message
    ).toContain('números diferentes')
  })

  it('olha DENTRO de uma condição comum no Sim; o ramo Não não conta', () => {
    const aninhada = {
      step_type: 'condition',
      step_config: { subject: 'tag_presence', operand: 't' },
      branches: { yes: [texto('oficial')], no: [] },
    }
    expect(validateChannelScopeForActivation([janela('', [aninhada])], null, CANAIS)).toHaveLength(1)
    const soNoNao = {
      step_type: 'condition',
      step_config: { subject: 'meta_window_open', operand: '' },
      branches: { yes: [], no: [texto('oficial')] },
    }
    expect(validateChannelScopeForActivation([soNoNao], null, CANAIS)).toEqual([])
  })
})
