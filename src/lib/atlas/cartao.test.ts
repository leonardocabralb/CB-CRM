import { describe, expect, it } from "vitest";

import { cartaoDoAtlas, contagemVazia, type ConfigDoAtlas } from "./cartao";
import { CASOU_POR, ORIGENS_DO_VINCULO } from "./leitura";

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

  it("a leitura das situações: a última, o erro DELA e se está velha (calculado aqui, não na tela)", () => {
    const agora = new Date("2026-09-30T15:00:00.000Z");
    expect(cartaoDoAtlas(linha(), null, agora).leitura).toEqual({ ultimaEm: null, erro: null, completaEm: null, velha: true });
    expect(cartaoDoAtlas(linha({ last_sync_at: "2026-09-30T14:50:00.000Z", listagem_completa_em: "2026-09-30T06:00:00.000Z" }), null, agora).leitura).toEqual({
      ultimaEm: "2026-09-30T14:50:00.000Z",
      erro: null,
      completaEm: "2026-09-30T06:00:00.000Z",
      velha: false,
    });
    // O erro da LEITURA não derruba a conexão (a permissão Listar é opcional).
    const comErro = cartaoDoAtlas(linha({ last_sync_at: "2026-09-30T14:50:00.000Z", sync_erro: "sem_permissao_listar" }), null, agora);
    expect(comErro).toMatchObject({ estado: "conectado", erro: null, leitura: { erro: "sem_permissao_listar", velha: true } });
  });

  it("o selo de teste vem do ambiente da instância; a conexão de outro ambiente não mostra leitura", () => {
    expect(cartaoDoAtlas(null, STAGING)).toMatchObject({ ambienteDeTeste: true, leitura: null });
    expect(cartaoDoAtlas(linha(), null).ambienteDeTeste).toBe(false);
    expect(cartaoDoAtlas(linha(), STAGING)).toMatchObject({ erro: "outro_ambiente", leitura: null });
    expect(JSON.stringify(cartaoDoAtlas(linha({ api_url: STAGING }), STAGING))).not.toContain(STAGING);
  });

  it("a contagem vazia tem toda origem e todo casamento", () => {
    const c = contagemVazia();
    expect(Object.keys(c.porOrigem)).toEqual([...ORIGENS_DO_VINCULO]);
    expect(Object.keys(c.porCasamento)).toEqual([...CASOU_POR]);
  });
});
