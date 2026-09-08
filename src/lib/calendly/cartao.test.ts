import { describe, expect, it } from "vitest";

import { cartaoDoCalendly, type ConfigDoCalendly, type EventoDoCalendly } from "./cartao";

const config: ConfigDoCalendly = {
  user_name: "Leonardo",
  user_email: "l@cb.com",
  scheduling_url: "https://calendly.com/cb",
  webhook_uri: "https://api.calendly.com/webhook_subscriptions/W1",
  webhook_scope: "organization",
  webhook_state: "active",
  pergunta_telefone: "WhatsApp",
  status: "conectado",
  last_event_at: "2026-09-07T10:00:00Z",
  last_error: null,
};

function evento(resultado: string): EventoDoCalendly {
  return {
    id: crypto.randomUUID(),
    evento: "invitee.created",
    nome: "Marcelo",
    telefone: "5596991126767",
    telefone_origem: "pergunta",
    event_type_nome: "Reunião",
    inicio: "2026-08-26T16:45:00Z",
    contact_id: null,
    resultado,
    detalhe: null,
    recebido_em: "2026-09-07T10:00:00Z",
  };
}

describe("cartaoDoCalendly", () => {
  it("sem config: não conectado, contagem zerada", () => {
    const c = cartaoDoCalendly(null, []);
    expect(c.estado).toBe("nao_conectado");
    expect(c.usuario).toBeNull();
    expect(c.contagem.disparado).toBe(0);
  });

  it("conectado com webhook ativo", () => {
    const c = cartaoDoCalendly(config, [evento("disparado"), evento("disparado"), evento("sem_contato"), evento("lixo")]);
    expect(c.estado).toBe("conectado");
    expect(c.usuario).toEqual({ nome: "Leonardo", email: "l@cb.com", agenda: "https://calendly.com/cb" });
    expect(c.webhook).toEqual({ escopo: "organization", estado: "active" });
    expect(c.perguntaTelefone).toBe("WhatsApp");
    expect(c.contagem).toMatchObject({ disparado: 2, sem_contato: 1 });
    expect(c.erro).toBeNull();
  });

  it("assinatura desativada pelo Calendly é ERRO com motivo próprio — o operador precisa reassinar", () => {
    const c = cartaoDoCalendly({ ...config, webhook_state: "disabled" }, []);
    expect(c.estado).toBe("erro");
    expect(c.erro).toBe("webhook_desativado");
    expect(c.webhook).toEqual({ escopo: "organization", estado: "disabled" });
  });

  it("sem assinatura nenhuma também é erro", () => {
    const c = cartaoDoCalendly({ ...config, webhook_uri: null }, []);
    expect(c.estado).toBe("erro");
    expect(c.webhook).toBeNull();
  });

  it("status erro carrega o código gravado", () => {
    const c = cartaoDoCalendly({ ...config, status: "erro", last_error: "token_invalido" }, []);
    expect(c.estado).toBe("erro");
    expect(c.erro).toBe("token_invalido");
  });
});
