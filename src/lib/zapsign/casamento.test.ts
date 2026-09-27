import { describe, expect, it } from "vitest";

import { chavesDosSignatarios, decidirNivel, ehUuid, motivoSemContato } from "./casamento";
import type { SignatarioDoZapSign } from "./leitura";

const sig = (p: Partial<SignatarioDoZapSign>): SignatarioDoZapSign => ({
  token: "s",
  status: "signed",
  nome: "",
  email: null,
  telefone: null,
  cpf: null,
  assinadoEm: null,
  ...p,
});

describe("ehUuid", () => {
  it("só a forma de um id de negócio", () => {
    expect(ehUuid("3f2a91c0-1234-4abc-9def-0123456789ab")).toBe(true);
    expect(ehUuid("id-suaaplicacao-e32213ds-243")).toBe(false);
    expect(ehUuid("")).toBe(false);
    expect(ehUuid(null)).toBe(false);
  });
});

describe("chavesDosSignatarios", () => {
  it("o telefone vira a grafia CANÔNICA — as duas grafias do nono dígito são a mesma chave", () => {
    const com9 = chavesDosSignatarios([sig({ telefone: "+5583980000016" })], []);
    const sem9 = chavesDosSignatarios([sig({ telefone: "+558380000016" })], []);
    expect(com9[0].telefone).toBe("5583980000016");
    expect(sem9[0].telefone).toBe(com9[0].telefone);
  });

  it("brasileiro sem DDI ganha o 55 (a régua das telas); sem DDD é recusado", () => {
    expect(chavesDosSignatarios([sig({ telefone: "(83) 98000-0016" })], [])[0].telefone).toBe("5583980000016");
    expect(chavesDosSignatarios([sig({ telefone: "98000-0016" })], [])[0].telefone).toBeNull();
  });

  it("CRÍTICO: o número de uma CONEXÃO da conta não casa, em qualquer grafia", () => {
    const chaves = chavesDosSignatarios([sig({ telefone: "+5583980000016" })], ["558380000016"]);
    expect(chaves[0].telefone).toBeNull();
  });

  it("e-mail e CPF passam como vieram lidos", () => {
    const [c] = chavesDosSignatarios([sig({ token: "t", email: "a@b.com", cpf: "52998224725" })], []);
    expect(c).toEqual({ token: "t", telefone: null, email: "a@b.com", cpf: "52998224725" });
  });
});

describe("decidirNivel", () => {
  it("um contato (mesmo achado por dois signatários) é casado", () => {
    expect(
      decidirNivel([
        { contactId: "c1", signatarioToken: "s1" },
        { contactId: "c1", signatarioToken: "s2" },
      ]),
    ).toEqual({ tipo: "casado", contactId: "c1", signatarioToken: "s1" });
  });

  it("CRÍTICO: dois contatos DIFERENTES é ambíguo — ninguém é escolhido", () => {
    expect(
      decidirNivel([
        { contactId: "cliente", signatarioToken: "s1" },
        { contactId: "advogado", signatarioToken: "s2" },
      ]),
    ).toEqual({ tipo: "ambiguo", contatos: 2 });
  });

  it("nada achado segue para o próximo nível", () => {
    expect(decidirNivel([])).toEqual({ tipo: "nenhum" });
  });
});

describe("motivoSemContato", () => {
  it("diz o que foi tentado, e que nenhum contato foi criado", () => {
    expect(motivoSemContato(["telefone", "email"], null)).toContain("telefone, e-mail");
    expect(motivoSemContato(["telefone"], null)).toContain("nenhum contato foi criado");
    expect(motivoSemContato([], null)).toContain("não trouxeram");
    expect(motivoSemContato(["telefone"], { por: "telefone", contatos: 2 })).toContain("2 contatos diferentes");
  });
});
