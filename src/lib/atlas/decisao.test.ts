import { describe, expect, it } from "vitest";

import { casouForte, decidir, decidirPelaSituacao, estaEncerrado, estaPausado } from "./decisao";

// `null` = o Atlas não mandou `matched_by` (sem a chave no objeto).
const c = (status: string | null, casouPor: string[] | null = ["chat_link"], id = "c1") => ({ id, status, appUrl: null, ...(casouPor ? { casouPor } : {}) });

describe("decidir", () => {
  it("nada achado: criar", () => {
    expect(decidir([])).toEqual({ acao: "criar" });
  });

  it("um rescindido, finalizado ou inativo, casado forte: REATIVAR o mesmo cadastro (D3)", () => {
    for (const s of ["rescindido", "finalizado", "inativo", "Rescindido", " FINALIZADO ", "Inativo"]) {
      expect(decidir([c(s)]).acao).toBe("reativar");
    }
  });

  it("um suspenso: PARA — a equipe suspendeu no Atlas e decide lá (D2)", () => {
    for (const s of ["suspenso", "Suspenso", " SUSPENSO "]) {
      expect(decidir([c(s)]).acao).toBe("pausado");
    }
  });

  it("um em curso (ativo, importado, situação que o Atlas criar depois): só vincular — o Atlas manda no contrato", () => {
    for (const s of ["ativo", "importado", "em_negociacao", null]) {
      expect(decidir([c(s)]).acao).toBe("vincular");
    }
  });

  it("CRÍTICO: casado só pelo e-mail ou pelo final do telefone NUNCA reativa nem vincula — para", () => {
    for (const por of [["email"], ["phone_last8"], ["email", "phone_last8"], [], null]) {
      expect(decidir([c("rescindido", por)]).acao).toBe("fraco");
      expect(decidir([c("ativo", por)]).acao).toBe("fraco");
    }
  });

  it("um sinal forte basta, mesmo junto de um fraco", () => {
    for (const por of [["chat_link"], ["phone"], ["doc_id"], ["email", "phone"], ["phone_last8", "chat_link"]]) {
      expect(decidir([c("rescindido", por)]).acao).toBe("reativar");
    }
  });

  it("mais de um, ou lista cortada pelo teto do Atlas: AMBÍGUO, nunca palpite", () => {
    expect(decidir([c("ativo", ["chat_link"], "a"), c("rescindido", ["phone"], "b")])).toEqual({ acao: "ambiguo", quantos: 2 });
    expect(decidir([c("ativo")], true)).toEqual({ acao: "ambiguo", quantos: 1 });
    expect(decidir([], true)).toEqual({ acao: "ambiguo", quantos: 0 });
  });
});

describe("pela situação (o cliente do VÍNCULO: já é desta ficha, sem casamento a conferir)", () => {
  it("encerrado reativa, pausado para, o resto vincula", () => {
    expect(decidirPelaSituacao(c("finalizado", null)).acao).toBe("reativar");
    expect(decidirPelaSituacao(c("suspenso", null)).acao).toBe("pausado");
    expect(decidirPelaSituacao(c("ativo", null)).acao).toBe("vincular");
  });

  it("ignora espaço e caixa; nulo não é encerrado nem pausado", () => {
    expect(estaEncerrado(" FINALIZADO ")).toBe(true);
    expect(estaEncerrado("inativo")).toBe(true);
    expect(estaEncerrado("suspenso")).toBe(false);
    expect(estaPausado(" Suspenso")).toBe(true);
    expect(estaPausado("inativo")).toBe(false);
    expect(estaEncerrado(null)).toBe(false);
    expect(estaPausado(null)).toBe(false);
  });

  it("sem matched_by conta como fraco (falha fechada)", () => {
    expect(casouForte(c("ativo", null))).toBe(false);
  });
});
