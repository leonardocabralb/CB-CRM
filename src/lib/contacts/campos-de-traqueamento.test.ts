import { describe, expect, it } from "vitest";

import {
  CAMPOS_DE_TRAQUEAMENTO,
  camposFaltantes,
} from "./campos-de-traqueamento";
import { gerarChaveDeCampo } from "./chave-do-campo";
import type { CustomField } from "@/types";

function campo(parcial: Partial<CustomField>): CustomField {
  return {
    id: "x",
    user_id: "u",
    account_id: "a",
    field_name: "Campo",
    field_type: "text",
    field_key: "campo",
    categoria: "geral",
    created_at: "2026-01-01",
    ...parcial,
  };
}

describe("campos-de-traqueamento", () => {
  it("toda chave do catálogo é estável sob o gerador (948)", () => {
    // O gatilho do banco NORMALIZA a chave no insert. Se alguma chave do
    // catálogo não fosse ponto-fixo do gerador, o seed criaria o campo com
    // uma chave diferente da que o código procura — e `camposFaltantes`
    // ofereceria o seed para sempre.
    for (const c of CAMPOS_DE_TRAQUEAMENTO) {
      expect(gerarChaveDeCampo(c.key)).toBe(c.key);
    }
  });

  it("faltantes: compara pela chave, em QUALQUER categoria", () => {
    // `utm_source` já existe como campo GERAL → não pode ser semeado de
    // novo (a chave é única por conta; estouraria 23505).
    const existentes = [campo({ field_key: "utm_source", categoria: "geral" })];
    const faltam = camposFaltantes(existentes);
    expect(faltam.map((f) => f.key)).not.toContain("utm_source");
    expect(faltam).toHaveLength(CAMPOS_DE_TRAQUEAMENTO.length - 1);
  });

  it("faltantes: catálogo completo quando a conta não tem nada", () => {
    expect(camposFaltantes([])).toHaveLength(CAMPOS_DE_TRAQUEAMENTO.length);
  });

});
