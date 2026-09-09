import { describe, expect, it } from "vitest";

import {
  achatarPayload,
  MAX_TAMANHO_DO_VALOR,
  MAX_VARIAVEIS,
  nomeDeVariavel,
  PROFUNDIDADE_MAXIMA,
  valorDoCampo,
} from "./achatar";

describe("nomeDeVariavel", () => {
  it("tira acento mantendo a letra", () => {
    expect(nomeDeVariavel("telefone_do_usuário")).toBe("telefone_do_usuario");
    expect(nomeDeVariavel("Endereço")).toBe("Endereco");
  });

  it("troca o que o motor não casa por sublinhado", () => {
    // O regex do motor é [\w.]; hífen, espaço e ponto no nome não casam.
    expect(nomeDeVariavel("nome-completo")).toBe("nome_completo");
    expect(nomeDeVariavel("data da compra")).toBe("data_da_compra");
    expect(nomeDeVariavel("pedido.total")).toBe("pedido_total");
  });

  it("colapsa sublinhado repetido e apara as pontas", () => {
    expect(nomeDeVariavel("--nome--")).toBe("nome");
    expect(nomeDeVariavel("a   b")).toBe("a_b");
  });

  it("preserva maiúsculas — o operador copia o nome da tela", () => {
    expect(nomeDeVariavel("firstName")).toBe("firstName");
  });

  it("devolve vazio quando não sobra nada utilizável", () => {
    expect(nomeDeVariavel("!!!")).toBe("");
    expect(nomeDeVariavel("___")).toBe("");
  });
});

describe("achatarPayload", () => {
  it("achata objeto simples", () => {
    expect(achatarPayload({ nome: "Ana", idade: 30, vip: true })).toEqual({
      nome: "Ana",
      idade: "30",
      vip: "true",
    });
  });

  it("aninhado vira pai_filho — o motor lê UM nível só", () => {
    expect(achatarPayload({ contato: { nome: "Ana", tel: "83999" } })).toEqual({
      contato_nome: "Ana",
      contato_tel: "83999",
    });
  });

  it("lista vira índice", () => {
    expect(achatarPayload({ tags: ["a", "b"] })).toEqual({
      tags_0: "a",
      tags_1: "b",
    });
  });

  it("null entra vazio — 'veio vazio' e 'não veio' são diagnósticos diferentes", () => {
    expect(achatarPayload({ email: null })).toEqual({ email: "" });
  });

  it("a primeira chave vence a colisão de saneamento", () => {
    expect(achatarPayload({ "nome-completo": "A", nome_completo: "B" })).toEqual(
      { nome_completo: "A" }
    );
  });

  it("chave que sanitiza para vazio é descartada", () => {
    expect(achatarPayload({ "!!!": "x", ok: "y" })).toEqual({ ok: "y" });
  });

  it("⚠️ payload NÃO alcança as chaves reservadas do motor", () => {
    // `_cadeia` é a guarda anti-ciclo da 936; `_tag_chain_depth`, o teto de
    // encadeamento de tag. Sobrescrevê-las furaria as duas.
    const r = achatarPayload({
      _cadeia: "invadido",
      _tag_chain_depth: "99",
      __cadeia: "invadido2",
    });
    expect(r._cadeia).toBeUndefined();
    expect(r._tag_chain_depth).toBeUndefined();
    expect(r).toEqual({ cadeia: "invadido", tag_chain_depth: "99" });
  });

  it("⚠️ chave herdada do Object.prototype não é engolida", () => {
    // Com `saida = {}`, `saida["constructor"]` já é uma função — não é
    // nullish — e o `??=` NÃO atribuía: a chave sumia do payload achatado E
    // da lista do log, que é justamente a tela que explica variável vazia.
    const r = achatarPayload({
      constructor: "abc",
      toString: "x",
      valueOf: "y",
      hasOwnProperty: "z",
      telefone: "5583999",
    });
    expect(r.constructor).toBe("abc");
    expect(r.toString).toBe("x");
    expect(r.valueOf).toBe("y");
    expect(r.hasOwnProperty).toBe("z");
    expect(r.telefone).toBe("5583999");
  });

  it("valorDoCampo não devolve função para nome do protótipo", () => {
    const vars = achatarPayload({ telefone: "5583999" });
    expect(valorDoCampo(vars, "constructor")).toBeNull();
    expect(valorDoCampo(vars, "toString")).toBeNull();
  });

  it("nenhuma chave produzida começa com sublinhado", () => {
    const r = achatarPayload({ _a: "1", "  _b": "2", c: { _d: "3" } });
    for (const k of Object.keys(r)) expect(k.startsWith("_")).toBe(false);
  });

  it("para na profundidade máxima", () => {
    let fundo: unknown = "valor";
    for (let i = 0; i < PROFUNDIDADE_MAXIMA + 2; i++) fundo = { n: fundo };
    const r = achatarPayload(fundo);
    expect(Object.keys(r).length).toBeLessThanOrEqual(1);
  });

  it("corta valor gigante", () => {
    const r = achatarPayload({ blob: "x".repeat(MAX_TAMANHO_DO_VALOR + 50) });
    expect(r.blob.length).toBe(MAX_TAMANHO_DO_VALOR);
  });

  it("respeita o teto de variáveis", () => {
    const grande: Record<string, string> = {};
    for (let i = 0; i < MAX_VARIAVEIS + 40; i++) grande[`c${i}`] = "v";
    expect(Object.keys(achatarPayload(grande)).length).toBeLessThanOrEqual(
      MAX_VARIAVEIS
    );
  });

  it("aguenta payload que não é objeto sem estourar", () => {
    expect(achatarPayload(null)).toEqual({});
    expect(achatarPayload("texto")).toEqual({});
    expect(achatarPayload(42)).toEqual({});
    expect(achatarPayload([{ a: 1 }])).toEqual({ "0_a": "1" });
  });
});

describe("valorDoCampo", () => {
  const vars = { telefone: "5583999", Nome: "Ana", vazio: "" };

  it("acha pelo nome exato", () => {
    expect(valorDoCampo(vars, "telefone")).toBe("5583999");
  });

  it("acha ignorando maiúscula — o operador digita esse nome à mão", () => {
    expect(valorDoCampo(vars, "NOME")).toBe("Ana");
    expect(valorDoCampo(vars, "nome")).toBe("Ana");
  });

  it("saneia o que o operador digitou antes de procurar", () => {
    expect(valorDoCampo(vars, "telefone ")).toBe("5583999");
    expect(valorDoCampo({ nome_completo: "Ana" }, "nome-completo")).toBe("Ana");
  });

  it("valor vazio conta como ausente para quem consome", () => {
    expect(valorDoCampo(vars, "vazio")).toBeNull();
  });

  it("⚠️ sem campo configurado NÃO adivinha", () => {
    // Adivinhar aqui seria pegar o telefone errado e mandar a mensagem do
    // lead para outra pessoa.
    expect(valorDoCampo(vars, null)).toBeNull();
    expect(valorDoCampo(vars, "")).toBeNull();
    expect(valorDoCampo(vars, "   ")).toBeNull();
  });

  it("campo que não existe no payload devolve nulo", () => {
    expect(valorDoCampo(vars, "inexistente")).toBeNull();
  });
});
