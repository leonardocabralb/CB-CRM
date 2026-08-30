import { describe, expect, it } from "vitest";

import { NOME_MAX, rebaixariaOEditor, validarCorpoDePerfil } from "./validar";

describe("validarCorpoDePerfil", () => {
  const valido = {
    nome: "Advogado Trabalhista",
    papel_base: "agent",
    telas: ["inbox", "pipelines"],
    secoes_config: ["quick-replies"],
    channel_ids: ["ee915eb0-06d6-43c1-9a36-027feff273e8"],
    pipeline_ids: [],
  };

  it("aceita o corpo válido e apara o nome", () => {
    const r = validarCorpoDePerfil({ ...valido, nome: "  X  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.perfil.nome).toBe("X");
  });

  it("recusa nome vazio e nome longo demais", () => {
    expect(validarCorpoDePerfil({ ...valido, nome: "  " }).ok).toBe(false);
    expect(
      validarCorpoDePerfil({ ...valido, nome: "x".repeat(NOME_MAX + 1) }).ok,
    ).toBe(false);
  });

  it("⚠️ owner nunca passa como papel_base", () => {
    // Perfil que promovesse a dono seria transferência de posse por caminho
    // lateral — a mesma regra do CHECK da 956, barrada antes do banco.
    expect(validarCorpoDePerfil({ ...valido, papel_base: "owner" }).ok).toBe(false);
  });

  it("tela desconhecida é DESCARTADA, não erro", () => {
    // O catálogo evolui: tela removida do app deixa lixo no banco, e um save
    // que reprova por id morto trancaria a edição do perfil inteiro.
    const r = validarCorpoDePerfil({
      ...valido,
      telas: ["inbox", "tela-que-ja-morreu"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.perfil.telas).toEqual(["inbox"]);
  });

  it("id de escopo malformado REPROVA — canal não vem de catálogo", () => {
    expect(
      validarCorpoDePerfil({ ...valido, channel_ids: ["nao-e-uuid"] }).ok,
    ).toBe(false);
  });

  it("listas ausentes viram vazias (= sem recorte)", () => {
    const r = validarCorpoDePerfil({ nome: "X", papel_base: "viewer" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.perfil.channel_ids).toEqual([]);
      expect(r.perfil.telas).toEqual([]);
    }
  });
});

describe("rebaixariaOEditor", () => {
  it("bloqueia o admin tirando o PRÓPRIO perfil de admin", () => {
    expect(
      rebaixariaOEditor({
        papelDoEditor: "admin",
        perfilDoEditor: "p1",
        perfilAlvo: "p1",
        novoPapel: "agent",
      }),
    ).toBe(true);
  });

  it("não bloqueia perfil alheio nem o dono", () => {
    expect(
      rebaixariaOEditor({
        papelDoEditor: "admin",
        perfilDoEditor: "p1",
        perfilAlvo: "p2",
        novoPapel: "agent",
      }),
    ).toBe(false);
    expect(
      rebaixariaOEditor({
        papelDoEditor: "owner",
        perfilDoEditor: "p1",
        perfilAlvo: "p1",
        novoPapel: "viewer",
      }),
    ).toBe(false);
  });

  it("manter admin no próprio perfil passa", () => {
    expect(
      rebaixariaOEditor({
        papelDoEditor: "admin",
        perfilDoEditor: "p1",
        perfilAlvo: "p1",
        novoPapel: "admin",
      }),
    ).toBe(false);
  });
});
