import { describe, expect, it } from "vitest";

import { interpolarVars, variaveisDoCaso } from "./previa-da-regua";
import { TEXTO_DA_COBRANCA, TEXTO_DO_LEMBRETE } from "./textos-da-regua";

// terça-feira, 10/11/2026, 10:00 em Brasília
const agora = new Date("2026-11-10T13:00:00Z");
const opcoes = { escritorio: "Escritório Exemplo", agora };

describe("prévia por caso", () => {
  it("uma parcela: o link sozinho, sem lista", () => {
    const v = variaveisDoCaso("cobranca", "uma", opcoes);
    const texto = interpolarVars(TEXTO_DA_COBRANCA, v);
    expect(texto).toContain("Olá, Marcos! Aqui é do Escritório Exemplo.");
    expect(texto).toContain("a parcela 4 de 12");
    expect(texto).toContain("venceu ontem");
    expect(texto).toContain("https://www.asaas.com/i/exemplo-a");
    expect(texto).not.toContain("•");
  });

  it("várias parcelas: a frase soma e cada parcela tem o seu link", () => {
    const texto = interpolarVars(TEXTO_DA_COBRANCA, variaveisDoCaso("cobranca", "varias", opcoes));
    expect(texto).toContain("duas parcelas estão em aberto");
    expect(texto.match(/•/g)).toHaveLength(2);
    expect(texto).toContain("https://www.asaas.com/i/exemplo-b");
  });

  it("empresa: só \"Olá!\" e a cobrança avulsa sem a descrição interna", () => {
    const texto = interpolarVars(TEXTO_DA_COBRANCA, variaveisDoCaso("cobranca", "empresa", opcoes));
    expect(texto.startsWith("Olá! Aqui é do")).toBe(true);
    expect(texto).toContain("a cobrança, de");
    expect(texto).not.toContain("anotação interna");
  });

  it("o lembrete fala do que vence hoje", () => {
    const texto = interpolarVars(TEXTO_DO_LEMBRETE, variaveisDoCaso("lembrete", "uma", opcoes));
    expect(texto).toContain("vence hoje");
    const varias = interpolarVars(TEXTO_DO_LEMBRETE, variaveisDoCaso("lembrete", "varias", opcoes));
    expect(varias).toContain("duas parcelas vencem hoje");
  });

  it("interpolarVars troca só os {{vars.*}}", () => {
    expect(interpolarVars("{{vars.saudacao}} {{contact.name}} {{vars.inexistente}}.", { saudacao: "Olá!" })).toBe("Olá! {{contact.name}} .");
  });
});
