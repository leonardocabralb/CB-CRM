import { describe, expect, it } from "vitest";

import { cartaoDoTldv } from "./cartao";

const contagem = { total: 5, prontas: 3, pendentes: 1, semCliente: 2 };

describe("cartaoDoTldv", () => {
  it("sem config: não conectado, contagem preservada", () => {
    expect(cartaoDoTldv(null, contagem)).toEqual({ estado: "nao_conectado", ultimaSync: null, ultimoEvento: null, erro: null, contagem });
  });

  it("conectado: sem erro mesmo que `last_error` tenha sobrado de antes", () => {
    const c = cartaoDoTldv({ status: "conectado", last_sync_at: "2026-09-09T10:00:00Z", last_event_at: null, last_error: "limite" }, contagem);
    expect(c.estado).toBe("conectado");
    expect(c.erro).toBeNull();
    expect(c.ultimaSync).toBe("2026-09-09T10:00:00Z");
  });

  it("erro: o código sai para a tela traduzir", () => {
    const c = cartaoDoTldv({ status: "erro", last_sync_at: null, last_event_at: null, last_error: "chave_invalida" }, contagem);
    expect(c.estado).toBe("erro");
    expect(c.erro).toBe("chave_invalida");
  });
});
