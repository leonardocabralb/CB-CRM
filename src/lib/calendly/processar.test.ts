import { describe, expect, it } from "vitest";

import { escutamEsteEvento, resultadoDoDisparo } from "./processar";

const A = "https://api.calendly.com/event_types/A";
const B = "https://api.calendly.com/event_types/B";

describe("escutamEsteEvento", () => {
  it("config vazia escuta qualquer evento; URI escuta só a igual", () => {
    const lista = [
      { trigger_type: "calendly_booking", trigger_config: {}, is_active: true },
      { trigger_type: "calendly_booking", trigger_config: { event_type_uri: A }, is_active: true },
      { trigger_type: "calendly_booking", trigger_config: { event_type_uri: B }, is_active: true },
    ];
    expect(escutamEsteEvento(lista, A)).toBe(2);
    expect(escutamEsteEvento(lista, B)).toBe(2);
    expect(escutamEsteEvento(lista, "outro")).toBe(1);
  });

  it("evento sem URI só casa com a config vazia (fail closed, como o motor)", () => {
    const lista = [{ trigger_type: "calendly_booking", trigger_config: { event_type_uri: A }, is_active: true }];
    expect(escutamEsteEvento(lista, null)).toBe(0);
  });

  it("inativa e de outro tipo não contam", () => {
    const lista = [
      { trigger_type: "calendly_booking", trigger_config: {}, is_active: false },
      { trigger_type: "keyword_match", trigger_config: {}, is_active: true },
    ];
    expect(escutamEsteEvento(lista, A)).toBe(0);
  });
});

describe("resultadoDoDisparo (o que o motor DISSE que fez)", () => {
  it("só é 'disparado' quando alguma automação rodou sem falha", () => {
    expect(resultadoDoDisparo({ executadas: 1, foraDoEscopo: 0, comFalha: 0 }, "c1")).toMatchObject({ resultado: "disparado", contactId: "c1" });
  });

  it("escopo de conexão/etapa barrando tudo NÃO é 'disparado'", () => {
    const r = resultadoDoDisparo({ executadas: 0, foraDoEscopo: 1, comFalha: 0 }, "c1");
    expect(r.resultado).toBe("sem_automacao");
    expect(r.detalhe).toContain("fora do escopo");
  });

  it("passo que falhou vira 'falhou' com o número de automações", () => {
    const r = resultadoDoDisparo({ executadas: 2, foraDoEscopo: 0, comFalha: 1 }, "c1");
    expect(r.resultado).toBe("falhou");
    expect(r.detalhe).toContain("1 de 2");
  });

  it("disparo que não aconteceu (contato de outra conta, banco) vira 'falhou' com o motivo", () => {
    const r = resultadoDoDisparo({ executadas: 0, foraDoEscopo: 0, comFalha: 0, erro: "contact not in account" }, null);
    expect(r.resultado).toBe("falhou");
    expect(r.detalhe).toContain("contact not in account");
  });
});
