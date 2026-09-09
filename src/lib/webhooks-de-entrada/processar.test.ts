import { describe, expect, it } from "vitest";

import { triggerMatches } from "@/lib/automations/engine";
import type { Automation } from "@/types";

import { escutamEsteWebhook, resultadoDoDisparo } from "./processar";

// ------------------------------------------------------------
// O pré-filtro é uma CÓPIA PURA da regra do motor, e a cópia existe para
// não materializar um lead numa conta que não configurou automação
// nenhuma. Divergir dela faria o pré-filtro barrar acionamento que o motor
// teria aceitado — ou o contrário, criando ficha para ninguém.
//
// Por isso a comparação abaixo importa o `triggerMatches` DE VERDADE.
// ------------------------------------------------------------

const auto = (trigger_config: Record<string, unknown>) =>
  ({
    id: "a1",
    trigger_type: "webhook_received",
    trigger_config,
  }) as unknown as Automation;

describe("triggerMatches — webhook_received", () => {
  it("config vazia dispara para qualquer webhook — inclusive sem id no contexto", () => {
    expect(triggerMatches(auto({}), { webhook_id: "w1" })).toBe(true);
    expect(triggerMatches(auto({ webhook_id: "" }), {})).toBe(true);
    expect(triggerMatches(auto({}), undefined)).toBe(true);
  });

  it("com id, só aquele webhook", () => {
    const a = auto({ webhook_id: "w1" });
    expect(triggerMatches(a, { webhook_id: "w1" })).toBe(true);
    expect(triggerMatches(a, { webhook_id: "w2" })).toBe(false);
  });

  it("com id e disparo sem webhook no contexto, falha FECHADO", () => {
    expect(triggerMatches(auto({ webhook_id: "w1" }), {})).toBe(false);
  });
});

describe("escutamEsteWebhook espelha o motor", () => {
  const CONFIGS = [{}, { webhook_id: "" }, { webhook_id: "w1" }, { webhook_id: "w2" }];

  it.each(["w1", "w2", "w3"])("mesma resposta do triggerMatches para %s", (id) => {
    for (const cfg of CONFIGS) {
      const doMotor = triggerMatches(auto(cfg), { webhook_id: id });
      const daCopia = escutamEsteWebhook([{ trigger_config: cfg }], id);
      expect(daCopia).toBe(doMotor);
    }
  });

  it("lista vazia não escuta nada", () => {
    expect(escutamEsteWebhook([], "w1")).toBe(false);
  });

  it("basta UMA automação escutando", () => {
    expect(
      escutamEsteWebhook(
        [{ trigger_config: { webhook_id: "w9" } }, { trigger_config: {} }],
        "w1"
      )
    ).toBe(true);
  });

  it("trigger_config nulo é tratado como vazio (= qualquer webhook)", () => {
    expect(escutamEsteWebhook([{ trigger_config: null }], "w1")).toBe(true);
  });
});

describe("resultadoDoDisparo", () => {
  const zero = { executadas: 0, foraDoEscopo: 0, comFalha: 0, emEspera: 0 };

  it("erro no disparo vira falhou", () => {
    const r = resultadoDoDisparo({ ...zero, erro: "boom" }, null);
    expect(r.resultado).toBe("falhou");
    expect(r.detalhe).toContain("boom");
  });

  it("ninguém executou vira sem_automacao", () => {
    expect(resultadoDoDisparo(zero, "c1").resultado).toBe("sem_automacao");
  });

  it("barrado por escopo diz que a automação EXISTE", () => {
    // O operador precisa saber que a regra está lá e não rodou por escopo —
    // "nenhuma automação escuta" o mandaria criar uma segunda.
    const r = resultadoDoDisparo({ ...zero, foraDoEscopo: 2 }, "c1");
    expect(r.resultado).toBe("sem_automacao");
    expect(r.detalhe).toContain("fora do escopo");
  });

  it("falha vence espera", () => {
    const r = resultadoDoDisparo(
      { executadas: 2, foraDoEscopo: 0, comFalha: 1, emEspera: 1 },
      "c1"
    );
    expect(r.resultado).toBe("falhou");
  });

  it("espera sem falha vira em_espera, e o texto avisa que a linha não muda depois", () => {
    const r = resultadoDoDisparo(
      { executadas: 1, foraDoEscopo: 0, comFalha: 0, emEspera: 1 },
      "c1"
    );
    expect(r.resultado).toBe("em_espera");
    expect(r.detalhe).toContain("não é atualizada");
  });

  it("tudo certo vira disparado, carregando o contato", () => {
    const r = resultadoDoDisparo({ ...zero, executadas: 3 }, "c1");
    expect(r.resultado).toBe("disparado");
    expect(r.contactId).toBe("c1");
  });
});
