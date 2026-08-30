import { describe, expect, it } from "vitest";

import { CAMPOS_PADRAO, normalizarCampos } from "./campos-do-card";

describe("normalizarCampos — a migração do registro salvo", () => {
  it("lixo de qualquer forma → padrão", () => {
    expect(normalizarCampos(undefined)).toEqual(CAMPOS_PADRAO);
    expect(normalizarCampos(null)).toEqual(CAMPOS_PADRAO);
    expect(normalizarCampos("lixo")).toEqual(CAMPOS_PADRAO);
    expect(normalizarCampos(42)).toEqual(CAMPOS_PADRAO);
    expect(normalizarCampos([])).toEqual(CAMPOS_PADRAO);
  });

  it("objeto parcial mescla com o padrão", () => {
    expect(normalizarCampos({ valor: false })).toEqual({
      ...CAMPOS_PADRAO,
      valor: false,
    });
  });

  it("⚠️ campo AUSENTE cai no padrão, não em false — é a compatibilidade com registro salvo antes de um campo novo existir", () => {
    const salvoOntem = { valor: false, canal: false };
    const resultado = normalizarCampos(salvoOntem);
    expect(resultado.etiquetas).toBe(CAMPOS_PADRAO.etiquetas);
    expect(resultado.ultimaMensagem).toBe(CAMPOS_PADRAO.ultimaMensagem);
    expect(resultado.naoLidas).toBe(CAMPOS_PADRAO.naoLidas);
  });

  it("tipo errado num campo cai no padrão daquele campo", () => {
    expect(normalizarCampos({ valor: "sim", canal: false })).toEqual({
      ...CAMPOS_PADRAO,
      canal: false,
    });
  });

  it("chave desconhecida é descartada", () => {
    const resultado = normalizarCampos({ inventada: true }) as unknown as Record<
      string,
      unknown
    >;
    expect(resultado.inventada).toBeUndefined();
  });

  it("ida-e-volta por JSON preserva", () => {
    const escolha = { ...CAMPOS_PADRAO, canal: false, ultimaMensagem: false };
    expect(normalizarCampos(JSON.parse(JSON.stringify(escolha)))).toEqual(escolha);
  });

  it("não devolve o próprio CAMPOS_PADRAO por referência (mutação acidental não contamina o padrão)", () => {
    const resultado = normalizarCampos(null);
    expect(resultado).not.toBe(CAMPOS_PADRAO);
  });
});
