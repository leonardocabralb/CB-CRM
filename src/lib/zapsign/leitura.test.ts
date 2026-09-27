import { describe, expect, it } from "vitest";

import {
  assinadoEm,
  contagemDeAssinaturas,
  cpfDoSignatario,
  documentoCompleto,
  lerAviso,
  lerDocumento,
  lerRespostas,
  telefoneDoSignatario,
} from "./leitura";

// A forma do aviso é a do exemplo `doc_signed` da doc do ZapSign.
const AVISO = {
  event_type: "doc_signed",
  external_id: "",
  token: "cce11abf-abcd-abcd-a657-25b55f185f16",
  name: "Contrato de honorários.pdf",
  status: "pending",
  signers: [],
  signer_who_signed: { token: "b14f141f-abcd-abcd-8dfa-0bdac0ec806a", name: "Fulano Silva" },
  answers: [
    { variable: "NOME COMPLETO", value: "Fulano Silva" },
    { variable: "CPF", value: "123.456.789-09" },
    { variable: "sem valor", value: "" },
  ],
};

describe("lerAviso", () => {
  it("lê evento, documento, quem assinou e as respostas", () => {
    const a = lerAviso(AVISO);
    expect(a).toEqual({
      eventType: "doc_signed",
      docToken: "cce11abf-abcd-abcd-a657-25b55f185f16",
      signerToken: "b14f141f-abcd-abcd-8dfa-0bdac0ec806a",
      signatarioNome: "Fulano Silva",
      documentoNome: "Contrato de honorários.pdf",
      respostas: [
        { variavel: "NOME COMPLETO", valor: "Fulano Silva" },
        { variavel: "CPF", valor: "123.456.789-09" },
      ],
    });
  });

  it("sem quem assinou, o signer_token é '' (a chave do UNIQUE é NOT NULL)", () => {
    expect(lerAviso({ ...AVISO, signer_who_signed: undefined })?.signerToken).toBe("");
  });

  it("recusa corpo sem evento, sem documento ou com token que não serve de caminho", () => {
    expect(lerAviso(null)).toBeNull();
    expect(lerAviso({ token: AVISO.token })).toBeNull();
    expect(lerAviso({ event_type: "doc_signed" })).toBeNull();
    expect(lerAviso({ event_type: "doc_signed", token: "../../user/company" })).toBeNull();
  });
});

describe("lerDocumento", () => {
  const DOC = {
    token: "965ea3fa-938a-4b7d-84ed-7d7598b17231",
    name: "Contrato",
    status: "signed",
    external_id: "",
    deleted: false,
    signers: [
      {
        token: "s1",
        status: "signed",
        name: "João da Silva",
        email: " Joao@Exemplo.com ",
        phone_country: "55",
        phone_number: "83980000016",
        signed_at: "2026-09-27T12:00:00Z",
        cpf: "529.982.247-25",
      },
      { token: "s2", status: "signed", name: "Advogada", email: "", phone_country: "", phone_number: "", signed_at: "2026-09-27T13:30:00Z" },
      { status: "signed", name: "sem token" },
    ],
  };

  it("lê o documento e os signatários, e marca respostas ausentes como null", () => {
    const d = lerDocumento(DOC)!;
    expect(d.token).toBe(DOC.token);
    expect(d.externalId).toBeNull();
    expect(d.respostas).toBeNull();
    expect(d.signatarios).toHaveLength(2);
    expect(d.signatarios[0]).toMatchObject({ email: "joao@exemplo.com", telefone: "+5583980000016", cpf: "52998224725" });
    expect(d.signatarios[1]).toMatchObject({ email: null, telefone: null, cpf: null });
  });

  it("documento completo é só o status do DOCUMENTO", () => {
    expect(documentoCompleto({ status: "signed" })).toBe(true);
    expect(documentoCompleto({ status: "pending" })).toBe(false);
    expect(documentoCompleto({ status: null })).toBe(false);
  });

  it("a assinatura que completou é a mais recente", () => {
    expect(assinadoEm(lerDocumento(DOC)!)).toBe("2026-09-27T13:30:00Z");
    expect(assinadoEm({ signatarios: [] })).toBeNull();
  });

  it("conta quem já assinou", () => {
    const d = lerDocumento({ ...DOC, signers: [{ token: "a", status: "signed" }, { token: "b", status: "new" }] })!;
    expect(contagemDeAssinaturas(d)).toEqual({ assinaram: 1, total: 2 });
  });

  it("lê as respostas quando o documento as traz", () => {
    expect(lerDocumento({ ...DOC, answers: [{ variable: "X", value: "y" }] })?.respostas).toEqual([{ variavel: "X", valor: "y" }]);
  });

  it("recusa o que não tem a forma de documento", () => {
    expect(lerDocumento("x")).toBeNull();
    expect(lerDocumento({ name: "sem token" })).toBeNull();
  });
});

describe("pedaços", () => {
  it("telefone: com país vira +país, sem país vai como veio, vazio é nulo", () => {
    expect(telefoneDoSignatario("55", "1155551111")).toBe("+551155551111");
    expect(telefoneDoSignatario("", "(83) 98000-0016")).toBe("(83) 98000-0016");
    expect(telefoneDoSignatario("55", "")).toBeNull();
  });

  it("CPF: só 11 dígitos, sem repetição", () => {
    expect(cpfDoSignatario("529.982.247-25")).toBe("52998224725");
    expect(cpfDoSignatario("00000000000")).toBeNull();
    expect(cpfDoSignatario("12.345.678/0001-95")).toBeNull();
    expect(cpfDoSignatario(undefined)).toBeNull();
  });

  it("respostas: teto de tamanho, número vira texto, sem valor fica de fora", () => {
    const r = lerRespostas([{ variable: "N", value: 42 }, { variable: "L", value: "x".repeat(900) }, { value: "sem rótulo" }]);
    expect(r[0]).toEqual({ variavel: "N", valor: "42" });
    expect(r[1].valor).toHaveLength(500);
    expect(r).toHaveLength(2);
  });
});
