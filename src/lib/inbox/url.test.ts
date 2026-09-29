import { describe, expect, it } from "vitest";

import { ehOrigemDoInbox, urlDoInbox } from "./url";

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

  it("a pauta de reuniões também tem faixa de volta: `de=reunioes` sobrevive", () => {
    expect(urlDoInbox({ c: "cv1", de: "reunioes" })).toBe(
      "/inbox?c=cv1&de=reunioes",
    );
    expect(urlDoInbox({ de: "reunioes" })).toBe("/inbox?de=reunioes");
  });

  it("⚠️ c VENCE etapa — os dois juntos não têm leitor (pina a decisão)", () => {
    expect(urlDoInbox({ c: "cv1", etapa: "s1", de: "funil" })).toBe(
      "/inbox?c=cv1&de=funil",
    );
  });

  it("valores passam por encodeURIComponent", () => {
    expect(urlDoInbox({ c: "a&b" })).toBe("/inbox?c=a%26b");
  });

  it("⚠️ `de` só sai com os valores que têm leitor — lixo de link colado não gruda nos replaces", () => {
    expect(urlDoInbox({ c: "cv1", de: "whatsapp" })).toBe("/inbox?c=cv1");
    expect(urlDoInbox({ de: "qualquer" })).toBe("/inbox");
    // Parecido não é igual: a comparação é exata.
    expect(urlDoInbox({ c: "cv1", de: "Reunioes" })).toBe("/inbox?c=cv1");
    expect(urlDoInbox({ de: "reunioes&x=1" })).toBe("/inbox");
  });
});

describe("ehOrigemDoInbox", () => {
  it("só os dois valores com leitor", () => {
    expect(ehOrigemDoInbox("funil")).toBe(true);
    expect(ehOrigemDoInbox("reunioes")).toBe(true);
    expect(ehOrigemDoInbox("qualquer")).toBe(false);
    expect(ehOrigemDoInbox("")).toBe(false);
    expect(ehOrigemDoInbox(null)).toBe(false);
    expect(ehOrigemDoInbox(undefined)).toBe(false);
  });
});
