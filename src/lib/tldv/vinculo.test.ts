import { describe, expect, it } from "vitest";

import { contatoParaVincular, emailsDeFora, normalizarEmail } from "./vinculo";

const reuniao = {
  organizador: { nome: "Leonardo", email: "leonardo@escritorio.example" },
  convidados: [
    { nome: "Isa", email: "ISA@escritorio.example" },
    { nome: "Marcelo", email: "Marcelo@Example.com" },
    { nome: "Marcelo de novo", email: "marcelo@example.com" },
    { nome: "sem e-mail", email: "" },
  ],
};

describe("emailsDeFora", () => {
  it("tira a equipe (sem distinguir caixa) e repetições; mantém a ordem", () => {
    expect(emailsDeFora(reuniao, ["leonardo@escritorio.example", "isa@escritorio.example"])).toEqual(["marcelo@example.com"]);
  });

  it("organizador que não é da equipe conta como candidato", () => {
    expect(emailsDeFora(reuniao, ["isa@escritorio.example"])).toEqual(["marcelo@example.com", "leonardo@escritorio.example"]);
  });

  it("sem convidados de fora, nada", () => {
    expect(emailsDeFora({ organizador: null, convidados: [] }, [])).toEqual([]);
  });
});

describe("contatoParaVincular", () => {
  it("um contato (mesmo achado por dois e-mails) vincula; dois contatos, não", () => {
    expect(contatoParaVincular([{ id: "c1" }, { id: "c1" }])).toBe("c1");
    expect(contatoParaVincular([{ id: "c1" }, { id: "c2" }])).toBeNull();
    expect(contatoParaVincular([])).toBeNull();
  });
});

describe("normalizarEmail", () => {
  it("apara, minúsculas, exige @", () => {
    expect(normalizarEmail("  Foo@Bar.com ")).toBe("foo@bar.com");
    expect(normalizarEmail("sem-arroba")).toBeNull();
    expect(normalizarEmail(null)).toBeNull();
  });
});
