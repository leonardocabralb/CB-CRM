import { describe, expect, it } from "vitest";

import {
  montarAchados,
  SEM_ACHADOS,
  semAcento,
  TERMO_MINIMO,
  termoBuscavel,
} from "./busca-em-mensagens";

describe("termoBuscavel", () => {
  it("o piso é o mesmo do banco — 3 caracteres", () => {
    expect(TERMO_MINIMO).toBe(3);
    expect(termoBuscavel("ab")).toBe(false);
    expect(termoBuscavel("abc")).toBe(true);
  });

  it("espaço não conta — senão '  a' iria ao banco à toa", () => {
    expect(termoBuscavel("  a  ")).toBe(false);
    expect(termoBuscavel("   ")).toBe(false);
    expect(termoBuscavel("")).toBe(false);
  });

  it("acento não muda o tamanho", () => {
    expect(termoBuscavel("ação")).toBe(true);
  });
});

describe("semAcento", () => {
  it("tira acento e baixa a caixa, como o `cb_texto_para_busca` do banco", () => {
    expect(semAcento("PETIÇÃO")).toBe("peticao");
    expect(semAcento("Conceição")).toBe("conceicao");
    expect(semAcento("Ação Judicial")).toBe("acao judicial");
  });

  it("texto sem acento passa intacto (menos a caixa)", () => {
    expect(semAcento("Contrato 123")).toBe("contrato 123");
  });

  it("⚠️ preserva o comprimento nas letras do português", () => {
    // O banco recorta o trecho por POSIÇÃO (`strpos` sobre o texto
    // normalizado). Se normalizar mudasse o tamanho, a janela sairia deslocada
    // e o trecho mostrado não conteria o termo.
    for (const s of ["ação", "coração", "Ângela", "üê", "ñ"]) {
      expect(semAcento(s)).toHaveLength(s.length);
    }
  });

  it("emoji e pontuação sobrevivem", () => {
    expect(semAcento("Olá! 👋")).toBe("ola! 👋");
  });
});

describe("montarAchados", () => {
  it("vira um mapa por conversa", () => {
    const m = montarAchados([
      { conversation_id: "c1", trecho: "o contrato foi assinado", quantas: 3 },
      { conversation_id: "c2", trecho: "contrato novo", quantas: 1 },
    ]);
    expect(m.size).toBe(2);
    expect(m.get("c1")).toEqual({
      trecho: "o contrato foi assinado",
      quantas: 3,
    });
  });

  it("⚠️ `quantas` vem de um count() (bigint) e pode chegar como STRING", () => {
    // Chegando como string, a comparação `quantas > 1` que decide se o
    // contador aparece na linha compararia string com número.
    const m = montarAchados([
      { conversation_id: "c1", trecho: "x", quantas: "7" },
    ]);
    expect(m.get("c1")?.quantas).toBe(7);
    expect(typeof m.get("c1")?.quantas).toBe("number");
  });

  it("nulo e lista vazia devolvem mapa vazio, nunca estouram", () => {
    expect(montarAchados(null).size).toBe(0);
    expect(montarAchados([]).size).toBe(0);
  });

  it("trecho nulo vira string vazia — a linha renderiza sem quebrar", () => {
    const m = montarAchados([
      { conversation_id: "c1", trecho: null, quantas: null },
    ]);
    expect(m.get("c1")).toEqual({ trecho: "", quantas: 0 });
  });

  it("linha sem id é descartada em vez de virar chave vazia", () => {
    const m = montarAchados([
      { conversation_id: "", trecho: "x", quantas: 1 },
      { conversation_id: "c1", trecho: "y", quantas: 1 },
    ]);
    expect(m.size).toBe(1);
    expect(m.has("c1")).toBe(true);
  });
});

describe("SEM_ACHADOS", () => {
  it("é vazio e tem identidade estável — os memos dependem disso", () => {
    expect(SEM_ACHADOS.size).toBe(0);
    expect(SEM_ACHADOS).toBe(SEM_ACHADOS);
  });
});
