import { beforeEach, describe, expect, it, vi } from "vitest";

const motor = vi.hoisted(() => ({ dispararAutomacoes: vi.fn() }));
vi.mock("@/lib/automations/engine", () => motor);
vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => s.replace(/^cifrado:/, ""),
}));

import { ZapSignError, type ClienteZapSign } from "./cliente";
import { criarBanco, type Banco } from "./duble.test-helper";
import { processarAssinatura, resultadoDoDisparo } from "./processar";

const CONTA = "conta-1";
const OUTRA = "conta-2";
const DOC = "doc-0001-aaaa-bbbb";
const NEGOCIO = "3f2a91c0-1234-4abc-9def-0123456789ab";
const NEGOCIO_DE_OUTRA = "9b2a91c0-1234-4abc-9def-0123456789ff";

function documento(p: Record<string, unknown> = {}) {
  return {
    token: DOC,
    name: "Contrato de honorários",
    status: "signed",
    external_id: "",
    deleted: false,
    signers: [
      {
        token: "sig-cliente",
        status: "signed",
        name: "Maria Cliente",
        email: "maria@exemplo.com",
        phone_country: "55",
        phone_number: "8380000016", // sem o nono dígito
        cpf: "529.982.247-25",
        signed_at: "2026-09-27T15:00:00Z",
      },
    ],
    ...p,
  };
}

let banco: Banco;
let respostaDoDoc: unknown;
let erroDoDoc: ZapSignError | null;
const cliente = (() =>
  ({
    documento: async () => {
      if (erroDoDoc) throw erroDoDoc;
      return respostaDoDoc;
    },
  }) as unknown as ClienteZapSign) as (t: string) => ClienteZapSign;

function processar(eventoId = "ev-1", respostasDeQueda: Record<string, string> = {}) {
  return processarAssinatura(banco.cliente, CONTA, { eventoId, docToken: DOC, signerToken: "sig-cliente", respostasDeQueda }, { cliente });
}

beforeEach(() => {
  banco = criarBanco({
    cb_zapsign_config: [{ account_id: CONTA, api_token: "cifrado:tok" }],
    automations: [{ id: "a1", account_id: CONTA, trigger_type: "zapsign_documento_assinado", is_active: true }],
    contacts: [
      { id: "c-maria", account_id: CONTA, telefone_canonico: "5583980000016", email: "Maria@Exemplo.com" },
      { id: "c-outra-conta", account_id: OUTRA, telefone_canonico: "5583980000016", email: "maria@exemplo.com" },
      { id: "c-negocio", account_id: CONTA, telefone_canonico: "5511999990000", email: null },
    ],
    deals: [
      { id: NEGOCIO, account_id: CONTA, contact_id: "c-negocio", status: "open" },
      { id: NEGOCIO_DE_OUTRA, account_id: OUTRA, contact_id: "c-outra-conta", status: "open" },
    ],
    cb_channels: [{ account_id: CONTA, display_phone: "5511988887777" }],
    conversations: [{ id: "conv-maria", account_id: CONTA, contact_id: "c-maria", channel_id: "canal-1" }],
  });
  respostaDoDoc = documento();
  erroDoDoc = null;
  motor.dispararAutomacoes.mockReset().mockResolvedValue({ candidatas: 1, foraDoEscopo: 0, executadas: 1, comFalha: 0, emEspera: 0 });
});

describe("processarAssinatura — o documento relido decide", () => {
  it("documento ainda pendente = incompleto, sem disparar nada", async () => {
    respostaDoDoc = documento({ status: "pending", signers: [{ token: "a", status: "signed" }, { token: "b", status: "new" }] });
    const r = await processar();
    expect(r.resultado).toBe("incompleto");
    expect(r.detalhe).toContain("1 de 2");
    expect(motor.dispararAutomacoes).not.toHaveBeenCalled();
  });

  it("documento que não existe mais no ZapSign = ignorado", async () => {
    erroDoDoc = new ZapSignError("nao_encontrado", "404", 404);
    expect((await processar()).resultado).toBe("ignorado");
  });

  it("releitura que falha por rede = recebido (reprocessável), nada rodou", async () => {
    erroDoDoc = new ZapSignError("rede", "fetch failed");
    const r = await processar();
    expect(r.resultado).toBe("recebido");
    expect(motor.dispararAutomacoes).not.toHaveBeenCalled();
  });
});

describe("processarAssinatura — o casamento", () => {
  it("EXATO: external_id = negócio DESTA conta → aquele card, com o status visto", async () => {
    respostaDoDoc = documento({ external_id: NEGOCIO });
    const r = await processar();
    expect(r).toMatchObject({ resultado: "disparado", contactId: "c-negocio", dealId: NEGOCIO, casadoPor: "external_id" });
    const ctx = motor.dispararAutomacoes.mock.calls[0][0];
    expect(ctx).toMatchObject({ contactId: "c-negocio", triggerType: "zapsign_documento_assinado" });
    expect(ctx.context).toMatchObject({ deal_id: NEGOCIO, deal_status_fixado: "open" });
    expect(banco.tabelas.cb_zapsign_documentos[0]).toMatchObject({ deal_id: NEGOCIO, contact_id: "c-negocio", disparo_evento_id: "ev-1" });
  });

  it("CRÍTICO: negócio de OUTRA conta no external_id não casa — cai na cascata", async () => {
    respostaDoDoc = documento({ external_id: NEGOCIO_DE_OUTRA });
    const r = await processar();
    expect(r).toMatchObject({ contactId: "c-maria", casadoPor: "telefone", dealId: null });
    expect(motor.dispararAutomacoes.mock.calls[0][0].context.deal_id).toBeUndefined();
  });

  it("o documento que o CRM registrou com o negócio casa EXATO ('documento')", async () => {
    banco.tabelas.cb_zapsign_documentos = [{ id: "d1", account_id: CONTA, doc_token: DOC, deal_id: NEGOCIO }];
    expect(await processar()).toMatchObject({ casadoPor: "documento", dealId: NEGOCIO, contactId: "c-negocio" });
  });

  it("cascata: o telefone sem o nono dígito acha a ficha com ele; a conversa vai no contexto", async () => {
    const r = await processar();
    expect(r).toMatchObject({ resultado: "disparado", contactId: "c-maria", casadoPor: "telefone" });
    expect(motor.dispararAutomacoes.mock.calls[0][0].context).toMatchObject({ conversation_id: "conv-maria", channel_id: "canal-1" });
  });

  it("sem telefone, o e-mail (sem caixa)", async () => {
    respostaDoDoc = documento({ signers: [{ token: "s", status: "signed", email: "MARIA@exemplo.com" }] });
    expect(await processar()).toMatchObject({ contactId: "c-maria", casadoPor: "email" });
  });

  it("CPF só com o campo `cpf` da conta; os dígitos comparados sem pontuação", async () => {
    respostaDoDoc = documento({ signers: [{ token: "s", status: "signed", cpf: "52998224725" }] });
    expect((await processar("ev-a")).resultado).toBe("sem_contato");
    banco.tabelas.custom_fields = [{ id: "campo-cpf", account_id: CONTA, field_key: "cpf" }];
    banco.tabelas.contact_custom_values = [{ contact_id: "c-negocio", custom_field_id: "campo-cpf", value: "529.982.247-25" }];
    expect(await processar("ev-b")).toMatchObject({ contactId: "c-negocio", casadoPor: "cpf" });
  });

  it("CRÍTICO: dois contatos diferentes no mesmo nível = sem_contato, ninguém escolhido", async () => {
    respostaDoDoc = documento({
      signers: [
        { token: "s1", status: "signed", phone_country: "55", phone_number: "83980000016" },
        { token: "s2", status: "signed", phone_country: "55", phone_number: "11999990000" },
      ],
    });
    const r = await processar();
    expect(r.resultado).toBe("sem_contato");
    expect(r.detalhe).toContain("2 contatos diferentes");
    expect(motor.dispararAutomacoes).not.toHaveBeenCalled();
  });

  it("CRÍTICO: o número de uma CONEXÃO da conta não casa", async () => {
    banco.tabelas.cb_channels = [{ account_id: CONTA, display_phone: "558380000016" }];
    respostaDoDoc = documento({ signers: [{ token: "s", status: "signed", phone_country: "55", phone_number: "83980000016" }] });
    expect((await processar()).resultado).toBe("sem_contato");
  });

  it("CRÍTICO: sem casamento NUNCA cria contato", async () => {
    respostaDoDoc = documento({ signers: [{ token: "s", status: "signed", phone_country: "55", phone_number: "21977776666" }] });
    const antes = banco.tabelas.contacts.length;
    const r = await processar();
    expect(r.resultado).toBe("sem_contato");
    expect(r.detalhe).toContain("nenhum contato foi criado");
    expect(banco.tabelas.contacts).toHaveLength(antes);
  });
});

describe("processarAssinatura — o disparo", () => {
  it("sem automação escutando = sem_automacao, antes de reservar o disparo", async () => {
    banco.tabelas.automations = [];
    const r = await processar();
    expect(r).toMatchObject({ resultado: "sem_automacao", contactId: "c-maria" });
    expect(banco.tabelas.cb_zapsign_documentos[0].disparo_evento_id).toBeUndefined();
  });

  it("CRÍTICO: a segunda assinatura do MESMO documento não dispara de novo", async () => {
    expect((await processar("ev-1")).resultado).toBe("disparado");
    const r = await processar("ev-2");
    expect(r.resultado).toBe("ignorado");
    expect(motor.dispararAutomacoes).toHaveBeenCalledTimes(1);
  });

  it("nenhuma automação rodou (escopo) = o cadeado do disparo volta", async () => {
    motor.dispararAutomacoes.mockResolvedValue({ candidatas: 1, foraDoEscopo: 1, executadas: 0, comFalha: 0, emEspera: 0 });
    expect((await processar("ev-1")).resultado).toBe("sem_automacao");
    expect(banco.tabelas.cb_zapsign_documentos[0].disparo_evento_id).toBeNull();
  });

  it("CRÍTICO: as variáveis não levam o CPF; as respostas de queda entram quando o documento não as traz", async () => {
    const r = await processar("ev-1", { zapsign_resposta_plano: "Mensal" });
    const vars = motor.dispararAutomacoes.mock.calls[0][0].context.vars as Record<string, string>;
    expect(vars.zapsign_resposta_plano).toBe("Mensal");
    expect(vars.zapsign_signatario_nome).toBe("Maria Cliente");
    expect(JSON.stringify(vars)).not.toContain("52998224725");
    expect(r.variaveis).toEqual(vars);
  });
});

describe("resultadoDoDisparo", () => {
  it("falha vence espera; nada rodou é sem_automacao", () => {
    expect(resultadoDoDisparo({ executadas: 2, foraDoEscopo: 0, comFalha: 1, emEspera: 1 }).resultado).toBe("falhou");
    expect(resultadoDoDisparo({ executadas: 1, foraDoEscopo: 0, comFalha: 0, emEspera: 1 }).resultado).toBe("em_espera");
    expect(resultadoDoDisparo({ executadas: 0, foraDoEscopo: 1, comFalha: 0, emEspera: 0 }).resultado).toBe("sem_automacao");
    // Erro sem nada executado: o motor recusou antes da primeira automação — reprocessável.
    expect(resultadoDoDisparo({ executadas: 0, foraDoEscopo: 0, comFalha: 0, emEspera: 0, erro: "x" }).resultado).toBe("recebido");
    expect(resultadoDoDisparo({ executadas: 1, foraDoEscopo: 0, comFalha: 1, emEspera: 0, erro: "x" }).resultado).toBe("falhou");
  });
});
