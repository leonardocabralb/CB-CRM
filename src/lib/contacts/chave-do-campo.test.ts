import { describe, expect, it } from "vitest";

import { gerarChaveDeCampo } from "./chave-do-campo";

/**
 * ⚠️ Teste de PARIDADE com o SQL `cb_chave_de_campo` (migration 948).
 *
 * Os pares abaixo foram MEDIDOS no Postgres de produção em 2026-08-29
 * (`SELECT cb_chave_de_campo(...)`) — não são o que o TS "deveria" dar, são
 * o que o banco DEU. Se este teste quebrar, ou a regra TS divergiu do SQL,
 * ou alguém mudou o SQL sem mudar aqui: os dois erros são o mesmo bug, a
 * tela sugerindo uma chave e o gatilho gravando outra.
 */
describe("gerarChaveDeCampo — paridade com cb_chave_de_campo", () => {
  const medidosNoBanco: Array<[string, string]> = [
    ["Data da Proposta", "data_da_proposta"],
    ["Data de Fechamento do Contrato", "data_de_fechamento_do_contrato"],
    ["Data do Primeiro Contato", "data_do_primeiro_contato"],
    ["Origem da dívida", "origem_da_divida"],
    ["E-mail (secundário)", "e_mail_secundario"],
    ["  espaços  ", "espacos"],
    ["AÇÃO Judicial nº 42", "acao_judicial_n_42"],
  ];

  it.each(medidosNoBanco)("%s → %s", (nome, esperado) => {
    expect(gerarChaveDeCampo(nome)).toBe(esperado);
  });

  it("degrada para 'campo' quando não sobra nada", () => {
    expect(gerarChaveDeCampo("***")).toBe("campo");
    expect(gerarChaveDeCampo("")).toBe("campo");
    expect(gerarChaveDeCampo(null)).toBe("campo");
    expect(gerarChaveDeCampo(undefined)).toBe("campo");
  });

  it("corta em 60 sem deixar `_` na borda", () => {
    const longo = ("Campo ".repeat(20)).trim(); // "Campo Campo ..." > 60
    const chave = gerarChaveDeCampo(longo);
    expect(chave.length).toBeLessThanOrEqual(60);
    expect(chave.startsWith("_")).toBe(false);
    expect(chave.endsWith("_")).toBe(false);
  });
});
