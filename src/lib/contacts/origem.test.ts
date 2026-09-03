import { describe, it, expect } from "vitest";
import { origemDoContato, type PrimeiraMensagem } from "./origem";

const contato = { created_at: "2026-08-31T15:41:00Z" };
const canais = new Map([["c1", "Bancário - Comercial"]]);
const nome = (id: string) => canais.get(id) ?? null;
const msg = (p: Partial<PrimeiraMensagem>): PrimeiraMensagem => ({
  created_at: "2026-08-31T15:42:00Z",
  channel_id: "c1",
  sender_type: "customer",
  ...p,
});

describe("origemDoContato", () => {
  it("sem mensagem: só a data de cadastro", () => {
    expect(origemDoContato(contato, null, nome)).toEqual({
      cadastradoEm: contato.created_at,
      primeiraMensagemEm: null,
      canal: null,
      quemFalouPrimeiro: null,
    });
  });

  it("cliente abriu pela conexão nomeada", () => {
    expect(origemDoContato(contato, msg({}), nome)).toEqual({
      cadastradoEm: contato.created_at,
      primeiraMensagemEm: "2026-08-31T15:42:00Z",
      canal: { id: "c1", nome: "Bancário - Comercial" },
      quemFalouPrimeiro: "cliente",
    });
  });

  it("equipe pelo CRM vs pelo celular pareado", () => {
    expect(
      origemDoContato(contato, msg({ sender_type: "agent" }), nome).quemFalouPrimeiro,
    ).toBe("equipe_crm");
    expect(
      origemDoContato(contato, msg({ sender_type: "agent", from_device: true }), nome)
        .quemFalouPrimeiro,
    ).toBe("equipe_celular");
  });

  it("robô (fluxo, automação, broadcast, IA) é `robo`", () => {
    expect(
      origemDoContato(contato, msg({ sender_type: "bot" }), nome).quemFalouPrimeiro,
    ).toBe("robo");
  });

  it("sem carimbo de canal (anterior ao multi-canal) NÃO inventa canal", () => {
    expect(origemDoContato(contato, msg({ channel_id: null }), nome).canal).toBeNull();
  });

  it("id sem catálogo (conexão apagada, ou catálogo ainda carregando) vem sem nome", () => {
    expect(origemDoContato(contato, msg({ channel_id: "morto" }), nome).canal).toEqual({
      id: "morto",
      nome: null,
    });
  });
});
