import { describe, expect, it } from "vitest";

import { cartaoDoAtlas, type ConfigDoAtlas } from "./cartao";

const STAGING = "https://staging.example.com/functions/v1/client-webhook";
const linha = (parcial: Partial<ConfigDoAtlas> = {}): ConfigDoAtlas => ({
  api_url: null,
  escritorio: "Escritório Exemplo",
  status: "conectado",
  last_error: null,
  conectado_em: "2026-09-29T15:00:00.000Z",
  conferido_em: null,
  ...parcial,
});

describe("cartaoDoAtlas", () => {
  it("sem linha: não conectado", () => {
    expect(cartaoDoAtlas(null, null).estado).toBe("nao_conectado");
  });

  it("conectado no MESMO ambiente; erro da chave aparece com o código", () => {
    expect(cartaoDoAtlas(linha(), null)).toMatchObject({ estado: "conectado", erro: null, escritorio: "Escritório Exemplo" });
    expect(cartaoDoAtlas(linha({ api_url: STAGING }), STAGING).estado).toBe("conectado");
    expect(cartaoDoAtlas(linha({ status: "erro", last_error: "chave_invalida" }), null)).toMatchObject({ estado: "erro", erro: "chave_invalida" });
  });

  it("conexão de OUTRO ambiente aparece em erro — o passo não a usa", () => {
    expect(cartaoDoAtlas(linha(), STAGING)).toMatchObject({ estado: "erro", erro: "outro_ambiente" });
    expect(cartaoDoAtlas(linha({ api_url: STAGING }), null)).toMatchObject({ estado: "erro", erro: "outro_ambiente" });
  });
});
