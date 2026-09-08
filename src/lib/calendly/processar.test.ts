import { describe, expect, it } from "vitest";

import { escutamEsteEvento } from "./processar";

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
