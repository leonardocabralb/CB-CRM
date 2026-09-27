import { describe, expect, it } from "vitest";

import { cartaoDoZapSign, type ConfigDoZapSign } from "./cartao";

const base: ConfigDoZapSign = {
  plano: "API",
  webhook_estado: "ativo",
  status: "conectado",
  last_error: null,
  last_event_at: null,
  conectado_em: "2026-09-27T12:00:00Z",
  conferido_em: null,
};

describe("cartaoDoZapSign", () => {
  it("sem config = não conectado", () => {
    expect(cartaoDoZapSign(null, []).estado).toBe("nao_conectado");
  });

  it("conectado com o webhook ativo", () => {
    expect(cartaoDoZapSign(base, [])).toMatchObject({ estado: "conectado", webhook: "ativo", erro: null, plano: "API" });
  });

  it("CRÍTICO: webhook que não está ativo é ERRO no chip — nenhuma assinatura chega", () => {
    expect(cartaoDoZapSign({ ...base, webhook_estado: "ausente", last_error: "fora_do_host" }, [])).toMatchObject({
      estado: "erro",
      webhook: "ausente",
      erro: "fora_do_host",
    });
    expect(cartaoDoZapSign({ ...base, webhook_estado: "ausente" }, []).erro).toBe("webhook_ausente");
    expect(cartaoDoZapSign({ ...base, status: "erro", last_error: "token_invalido" }, []).erro).toBe("token_invalido");
  });

  it("conta os resultados da página", () => {
    const c = cartaoDoZapSign(base, [{ resultado: "disparado" }, { resultado: "sem_contato" }, { resultado: "sem_contato" }, { resultado: "estranho" }]);
    expect(c.contagem).toMatchObject({ disparado: 1, sem_contato: 2, incompleto: 0 });
  });
});
