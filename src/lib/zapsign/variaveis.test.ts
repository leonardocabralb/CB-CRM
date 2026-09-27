import { describe, expect, it } from "vitest";

import {
  pareceDocumentoPessoal,
  respostasGuardadas,
  slugDaResposta,
  variaveisDasRespostas,
  variaveisDoDocumento,
  VARIAVEIS_DO_DOCUMENTO,
} from "./variaveis";

describe("respostas do formulário", () => {
  it("vira zapsign_resposta_<slug>, sem acento e em minúsculas", () => {
    expect(slugDaResposta("Endereço completo")).toBe("endereco_completo");
    expect(variaveisDasRespostas([{ variavel: "Endereço completo", valor: "Rua A, 1" }])).toEqual({
      zapsign_resposta_endereco_completo: "Rua A, 1",
    });
  });

  it("CRÍTICO: documento pessoal nunca vira variável — pelo rótulo", () => {
    for (const rotulo of ["CPF", "cpf do contratante", "RG", "Número do RG", "CNPJ", "CNH", "Documento", "Órgão emissor", "PIS"]) {
      expect(pareceDocumentoPessoal(rotulo, "qualquer coisa")).toBe(true);
    }
  });

  it("CRÍTICO: documento pessoal nunca vira variável — pela forma do valor", () => {
    expect(pareceDocumentoPessoal("Identificação", "529.982.247-25")).toBe(true);
    expect(pareceDocumentoPessoal("Número", "52998224725")).toBe(true);
    expect(pareceDocumentoPessoal("Empresa", "12.345.678/0001-95")).toBe(true);
  });

  it("telefone de 11 dígitos tem forma de CPF, mas o rótulo decide", () => {
    expect(pareceDocumentoPessoal("Telefone", "83980000016")).toBe(false);
    expect(pareceDocumentoPessoal("WhatsApp", "83980000016")).toBe(false);
  });

  it("o que não é documento passa; a primeira de rótulo repetido vence", () => {
    const v = variaveisDasRespostas([
      { variavel: "Nome", valor: "Ana" },
      { variavel: "CPF", valor: "52998224725" },
      { variavel: "nome", valor: "Outra" },
    ]);
    expect(v).toEqual({ zapsign_resposta_nome: "Ana" });
  });

  it("as guardadas voltam só as de resposta", () => {
    expect(respostasGuardadas({ zapsign_resposta_nome: "Ana", zapsign_documento_nome: "C", x: 1 })).toEqual({
      zapsign_resposta_nome: "Ana",
    });
    expect(respostasGuardadas(null)).toEqual({});
    expect(respostasGuardadas(["x"])).toEqual({});
  });
});

describe("variaveisDoDocumento", () => {
  const signatario = {
    token: "s1",
    status: "signed",
    nome: "João da Silva",
    email: "joao@exemplo.com",
    telefone: "+5583980000016",
    cpf: "52998224725",
    assinadoEm: "2026-09-27T15:00:00Z",
  };

  it("entrega os nomes fixos, com telefone legível e data no fuso do escritório", () => {
    const v = variaveisDoDocumento({ token: "d1", nome: "Contrato" }, signatario, "2026-09-27T15:00:00Z", {});
    expect(Object.keys(v).sort()).toEqual([...VARIAVEIS_DO_DOCUMENTO].sort());
    expect(v.zapsign_signatario_telefone).toBe("(83) 98000-0016");
    expect(v.zapsign_assinado_em).toBe("27/09/2026 às 12:00h");
    expect(v.zapsign_documento_nome).toBe("Contrato");
  });

  it("CRÍTICO: o CPF do signatário não aparece em valor nenhum", () => {
    const v = variaveisDoDocumento({ token: "d1", nome: "Contrato" }, signatario, null, {});
    expect(Object.values(v).join(" ")).not.toContain("52998224725");
  });

  it("sem signatário, as variáveis dele saem vazias (nunca undefined no texto)", () => {
    const v = variaveisDoDocumento({ token: "d1", nome: null }, null, null, { zapsign_resposta_a: "b" });
    expect(v.zapsign_signatario_nome).toBe("");
    expect(v.zapsign_documento_nome).toBe("");
    expect(v.zapsign_resposta_a).toBe("b");
  });
});
