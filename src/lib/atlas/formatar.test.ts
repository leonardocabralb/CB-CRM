import { describe, expect, it } from "vitest";

import { dadosParaCriar, dadosParaReativar, diaParaAtlas, telefoneParaAtlas, ufDoTelefone, type EntradaDoCliente } from "./formatar";

// ============================================================
// O formato do Atlas é o MESMO que o n8n do escritório mandava (nó
// "Formatar dados", 23/09/2026) — o passo nativo o substitui sem o Atlas
// notar diferença. Números e nomes fictícios.
// ============================================================

function entrada(parcial: Partial<EntradaDoCliente> = {}): EntradaDoCliente {
  return {
    nome: "Cliente Exemplo",
    telefone: "+55 (11) 8765-4321",
    email: "cliente@example.com",
    valor: 5000,
    cardCriadoEm: "2026-05-10T15:00:00.000Z",
    primeiroContato: null,
    proposta: null,
    fechamento: null,
    linkDaConversa: "https://crm.example.com/inbox?c=00000000-0000-4000-8000-000000000001",
    tipoDeContrato: "fixo",
    agora: new Date("2026-09-30T02:30:00.000Z"),
    nomeDoApp: "CRM",
    ...parcial,
  };
}

describe("telefone e estado", () => {
  it("telefone com DDI e o nono dígito, como o telefoneCanonico (a régua do n8n)", () => {
    expect(telefoneParaAtlas("+55 (11) 8765-4321")).toBe("5511987654321");
    expect(telefoneParaAtlas("5511987654321")).toBe("5511987654321");
    expect(telefoneParaAtlas("")).toBeNull();
    expect(telefoneParaAtlas(null)).toBeNull();
  });

  it("estado pela sigla do DDD", () => {
    expect(ufDoTelefone("5511987654321")).toBe("SP");
    expect(ufDoTelefone("558388887777")).toBe("PB");
    expect(ufDoTelefone("5561987654321")).toBe("DF");
    expect(ufDoTelefone("5598987654321")).toBe("MA");
  });

  it("número de fora do Brasil ou DDD inexistente: sem estado (o n8n dava 'SP' a um número dos EUA)", () => {
    expect(ufDoTelefone("14045551234")).toBeNull();
    expect(ufDoTelefone("351912345678")).toBeNull();
    expect(ufDoTelefone("5523987654321")).toBeNull();
    expect(ufDoTelefone(null)).toBeNull();
  });
});

describe("datas no fuso do escritório", () => {
  it("23h30 em Brasília continua no mesmo dia (não é o dia seguinte do UTC)", () => {
    expect(diaParaAtlas("2026-09-30T02:30:00.000Z")).toBe("2026-09-29");
  });

  it("texto que não é instante vira nulo", () => {
    expect(diaParaAtlas("lixo")).toBeNull();
    expect(diaParaAtlas("")).toBeNull();
    expect(diaParaAtlas(null)).toBeNull();
  });
});

describe("dadosParaCriar", () => {
  it("os campos do create_client, com as reservas do n8n", () => {
    expect(dadosParaCriar(entrada())).toEqual({
      name: "Cliente Exemplo",
      email: "cliente@example.com",
      phone: "5511987654321",
      state: "SP",
      contractType: "fixo",
      contractValue: 5000,
      // Sem o campo: o primeiro contato cai na criação do card…
      firstContactDate: "2026-05-10",
      // …a proposta não tem reserva…
      proposalDate: null,
      // …e o fechamento cai em "agora", no fuso do escritório.
      closingDate: "2026-09-29",
      chatLink: "https://crm.example.com/inbox?c=00000000-0000-4000-8000-000000000001",
      notes: "Enviado pelo CRM em 2026-09-30T02:30:00.000Z",
    });
  });

  it("com os campos preenchidos, valem os campos", () => {
    const d = dadosParaCriar(
      entrada({
        primeiroContato: "2026-01-02T12:00:00.000Z",
        proposta: "2026-02-03T12:00:00.000Z",
        fechamento: "2026-03-04T12:00:00.000Z",
      }),
    );
    expect([d.firstContactDate, d.proposalDate, d.closingDate]).toEqual(["2026-01-02", "2026-02-03", "2026-03-04"]);
  });

  it("telefone curto e e-mail que não é e-mail vão nulos (o Atlas recusaria o cadastro inteiro)", () => {
    const d = dadosParaCriar(entrada({ telefone: "12345", email: "nao tem" }));
    expect(d.phone).toBeNull();
    expect(d.state).toBeNull();
    expect(d.email).toBeNull();
  });

  it("vazio vai nulo, nunca ''; sem card, valor 0", () => {
    const d = dadosParaCriar(entrada({ nome: "  ", email: "", telefone: null, linkDaConversa: null, valor: null, cardCriadoEm: null }));
    expect(d.name).toBeNull();
    expect(d.email).toBeNull();
    expect(d.phone).toBeNull();
    expect(d.state).toBeNull();
    expect(d.chatLink).toBeNull();
    expect(d.contractValue).toBe(0);
    expect(d.firstContactDate).toBeNull();
  });

  it("o nome do app na nota vem de quem chama (marca.ts), nunca literal", () => {
    expect(dadosParaCriar(entrada({ nomeDoApp: "Meu CRM" })).notes).toMatch(/^Enviado pelo Meu CRM em /);
  });
});

describe("dadosParaReativar (D3)", () => {
  it("volta a 'ativo' com os dados do NOVO fechamento, sem mexer em nome, telefone, e-mail e nota", () => {
    const d = dadosParaReativar(entrada({ proposta: "2026-08-01T12:00:00.000Z", tipoDeContrato: "mensal" }));
    expect(d).toEqual({
      status: "ativo",
      contractType: "mensal",
      contractValue: 5000,
      closingDate: "2026-09-29",
      proposalDate: "2026-08-01",
      chatLink: "https://crm.example.com/inbox?c=00000000-0000-4000-8000-000000000001",
    });
    expect(d).not.toHaveProperty("name");
    expect(d).not.toHaveProperty("phone");
    expect(d).not.toHaveProperty("notes");
  });

  it("sem proposta nem link, não apaga os que o Atlas já tem", () => {
    const d = dadosParaReativar(entrada({ linkDaConversa: null }));
    expect(d).not.toHaveProperty("proposalDate");
    expect(d).not.toHaveProperty("chatLink");
  });
});
