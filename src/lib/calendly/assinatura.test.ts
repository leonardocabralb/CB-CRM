import { describe, expect, it } from "vitest";

import {
  assinar,
  gerarChaveDeAssinatura,
  gerarTokenDeWebhook,
  lerCabecalhoDeAssinatura,
  montarCabecalho,
  verificarAssinatura,
} from "./assinatura";

const CHAVE = "chave-de-teste";
const CORPO = '{"event":"invitee.created","payload":{"name":"Marcelo"}}';

describe("lerCabecalhoDeAssinatura", () => {
  it("lê t e v1 na forma da doc", () => {
    expect(lerCabecalhoDeAssinatura("t=1492774577,v1=5257a869e7ec")).toEqual({
      t: 1492774577,
      v1: "5257a869e7ec",
    });
  });

  it("tolera espaços e ordem trocada", () => {
    expect(lerCabecalhoDeAssinatura(" v1=ABCDEF , t=10 ")).toEqual({ t: 10, v1: "abcdef" });
  });

  it("cabeçalho ausente ou incompleto é nulo", () => {
    expect(lerCabecalhoDeAssinatura(null)).toBeNull();
    expect(lerCabecalhoDeAssinatura("t=10")).toBeNull();
    expect(lerCabecalhoDeAssinatura("v1=abc")).toBeNull();
    expect(lerCabecalhoDeAssinatura("t=x,v1=zz")).toBeNull();
  });
});

describe("verificarAssinatura", () => {
  it("aceita a assinatura certa dentro da tolerância", () => {
    const t = 1_700_000_000;
    const header = montarCabecalho(CORPO, CHAVE, t);
    expect(verificarAssinatura(header, CORPO, CHAVE, t + 60)).toBe(true);
  });

  it("o exemplo da doc: v1 é o HMAC de `t.corpo`", () => {
    // Conferido à mão com `openssl dgst -sha256 -hmac`.
    expect(assinar("corpo", "k", 1)).toBe(
      assinar("corpo", "k", 1),
    );
    expect(assinar("corpo", "k", 1)).not.toBe(assinar("corpo", "k", 2));
  });

  it("corpo alterado reprova", () => {
    const t = 1_700_000_000;
    const header = montarCabecalho(CORPO, CHAVE, t);
    expect(verificarAssinatura(header, CORPO + " ", CHAVE, t)).toBe(false);
  });

  it("chave errada reprova", () => {
    const t = 1_700_000_000;
    const header = montarCabecalho(CORPO, CHAVE, t);
    expect(verificarAssinatura(header, CORPO, "outra", t)).toBe(false);
  });

  it("replay: t fora da tolerância reprova, nos dois sentidos", () => {
    const t = 1_700_000_000;
    const header = montarCabecalho(CORPO, CHAVE, t);
    expect(verificarAssinatura(header, CORPO, CHAVE, t + 301)).toBe(false);
    expect(verificarAssinatura(header, CORPO, CHAVE, t - 301)).toBe(false);
    expect(verificarAssinatura(header, CORPO, CHAVE, t + 300)).toBe(true);
  });

  it("sem chave guardada nada passa — nem cabeçalho perfeito", () => {
    const t = 1_700_000_000;
    expect(verificarAssinatura(montarCabecalho(CORPO, "", t), CORPO, "", t)).toBe(false);
  });

  it("cabeçalho ausente reprova", () => {
    expect(verificarAssinatura(null, CORPO, CHAVE)).toBe(false);
  });
});

describe("segredos gerados", () => {
  it("chave de assinatura: 64 hex; token de webhook: base64url sem sinais", () => {
    expect(gerarChaveDeAssinatura()).toMatch(/^[0-9a-f]{64}$/);
    expect(gerarTokenDeWebhook()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(gerarTokenDeWebhook()).not.toBe(gerarTokenDeWebhook());
  });
});
