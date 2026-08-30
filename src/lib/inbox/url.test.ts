import { describe, expect, it } from "vitest";

import { urlDoInbox } from "./url";

describe("urlDoInbox", () => {
  it("sem nada → /inbox, nunca /inbox?", () => {
    expect(urlDoInbox({})).toBe("/inbox");
    expect(urlDoInbox({ c: null, etapa: null, de: null })).toBe("/inbox");
    expect(urlDoInbox({ c: "", de: "" })).toBe("/inbox");
  });

  it("as combinações de verdade", () => {
    expect(urlDoInbox({ c: "cv1" })).toBe("/inbox?c=cv1");
    expect(urlDoInbox({ c: "cv1", de: "funil" })).toBe("/inbox?c=cv1&de=funil");
    expect(urlDoInbox({ etapa: "s1", de: "funil" })).toBe(
      "/inbox?etapa=s1&de=funil",
    );
    expect(urlDoInbox({ de: "funil" })).toBe("/inbox?de=funil");
  });

  it("⚠️ c VENCE etapa — os dois juntos não têm leitor (pina a decisão)", () => {
    expect(urlDoInbox({ c: "cv1", etapa: "s1", de: "funil" })).toBe(
      "/inbox?c=cv1&de=funil",
    );
  });

  it("valores passam por encodeURIComponent", () => {
    expect(urlDoInbox({ c: "a&b" })).toBe("/inbox?c=a%26b");
  });
});
