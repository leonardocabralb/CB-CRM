import { describe, it, expect } from "vitest";
import {
  ESPERA_PELO_RECIBO_MS,
  FOLGA_DO_CLIENTE_MS,
  RECIBOS_CONFIAVEIS_DESDE_MS,
  entregasNaoConfirmadas,
} from "./entrega-nao-confirmada";
import type { Message } from "@/types";

type M = Parameters<typeof entregasNaoConfirmadas>[0][number];

// "evo" é uma conexão Evolution; "meta", uma conexão oficial da Meta.
const OPCOES = { emGrupo: false, canaisEvolution: new Set(["evo"]) };

const nossa = (id: string, created_at: string, status: Message["status"], extra: Partial<M> = {}): M => ({
  id,
  sender_type: "agent",
  from_device: false,
  status,
  created_at,
  deleted_at: null,
  delete_requested_at: null,
  channel_id: "evo",
  ...extra,
});

// A mensagem do cliente chega gravada com `status = 'delivered'` — de
// propósito aqui, porque é assim no banco.
const doCliente = (id: string, created_at: string): M => ({
  id,
  sender_type: "customer",
  from_device: false,
  status: "delivered",
  created_at,
  deleted_at: null,
  delete_requested_at: null,
  channel_id: "evo",
});

const ms = (iso: string) => Date.parse(iso);
const ids = (s: Set<string>) => [...s].sort();

describe("entregasNaoConfirmadas — os casos reais (horários do banco)", () => {
  it("23/09: o link da reunião ficou em ✓, a seguinte foi lida, o cliente escreveu depois", () => {
    const fio = [
      doCliente("c1", "2026-09-23T10:58:02Z"),
      nossa("celular", "2026-09-23T11:02:36Z", "read", { from_device: true }),
      nossa("link", "2026-09-23T13:28:31.586Z", "sent"),
      nossa("seguinte", "2026-09-23T13:28:49.416Z", "read"),
      doCliente("c2", "2026-09-23T13:34:52Z"),
    ];
    // Às 10:29:31 BRT, um minuto depois do envio, com a seguinte já lida.
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-23T13:29:32Z"), OPCOES))).toEqual(["link"]);
  });

  it("21/09: o link do Asaas entre duas mensagens lidas (o cliente respondeu 'Não veio')", () => {
    const fio = [
      nossa("antes", "2026-09-21T16:42:58.600Z", "read"),
      nossa("link", "2026-09-21T16:43:13.022Z", "sent"),
      nossa("depois", "2026-09-21T16:43:16.971Z", "read"),
    ];
    // A seguinte saiu 4 s depois: sem margem entre as duas, só o minuto
    // de espera pelo PRÓPRIO recibo.
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-21T16:44:14Z"), OPCOES))).toEqual(["link"]);
  });

  it("17/09: o link do ZapSign, reenviado pelo celular 30 minutos depois e lido", () => {
    const fio = [
      nossa("link", "2026-09-17T15:25:52.223Z", "sent"),
      nossa("reenvio-pelo-celular", "2026-09-17T15:55:42Z", "read", { from_device: true }),
    ];
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-17T16:00:00Z"), OPCOES))).toEqual(["link"]);
  });
});

describe("entregasNaoConfirmadas — o que NÃO pode ficar vermelho", () => {
  const depois = "2026-09-23T13:30:00Z";
  const agora = ms("2026-09-23T14:00:00Z");

  it("sem evidência não acusa: mensagem única, cliente calado", () => {
    const fio = [nossa("unica", "2026-09-23T13:00:00Z", "sent")];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("espera um minuto pelo próprio recibo antes de acusar", () => {
    expect(ESPERA_PELO_RECIBO_MS).toBe(60_000);
    const fio = [
      nossa("a", "2026-09-23T13:00:00Z", "sent"),
      nossa("b", "2026-09-23T13:00:05Z", "delivered"),
    ];
    expect(entregasNaoConfirmadas(fio, ms("2026-09-23T13:00:59Z"), OPCOES).size).toBe(0);
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-23T13:01:00Z"), OPCOES))).toEqual(["a"]);
  });

  it("mensagem do celular pareado fica de fora (o CRM perde recibo dela às vezes)", () => {
    const fio = [
      nossa("do-celular", "2026-09-23T13:00:00Z", "sent", { from_device: true }),
      nossa("confirmada", depois, "read"),
    ];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("antes de 11/09 não acusa (recibo perdido era rotina; a Meta ainda sem webhook)", () => {
    expect(RECIBOS_CONFIAVEIS_DESDE_MS).toBe(Date.parse("2026-09-11T00:00:00Z"));
    const fio = [
      nossa("dez-de-setembro", "2026-09-10T16:35:09Z", "sent"),
      nossa("antiga", "2026-09-10T23:59:59Z", "sent"),
      nossa("nova", "2026-09-11T00:00:00Z", "sent"),
      nossa("confirmada", "2026-09-11T00:05:00Z", "read"),
    ];
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-11T01:00:00Z"), OPCOES))).toEqual(["nova"]);
  });

  it("a mensagem do cliente (gravada como 'delivered') não conta como nossa confirmada", () => {
    const fio = [
      nossa("sem-recibo", "2026-09-23T13:00:00Z", "sent"),
      doCliente("resposta-junto", "2026-09-23T13:00:30Z"),
    ];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("o cliente só prova que estava no ar depois da folga de um minuto", () => {
    expect(FOLGA_DO_CLIENTE_MS).toBe(60_000);
    const noLimite = [nossa("x", "2026-09-23T13:00:00Z", "sent"), doCliente("c", "2026-09-23T13:01:00Z")];
    const depoisDaFolga = [nossa("x", "2026-09-23T13:00:00Z", "sent"), doCliente("c", "2026-09-23T13:01:01Z")];
    expect(entregasNaoConfirmadas(noLimite, agora, OPCOES).size).toBe(0);
    expect(ids(entregasNaoConfirmadas(depoisDaFolga, agora, OPCOES))).toEqual(["x"]);
  });

  it("confirmação ANTERIOR não é evidência", () => {
    const fio = [
      nossa("confirmada-antes", "2026-09-23T12:59:00Z", "read"),
      doCliente("c", "2026-09-23T12:59:30Z"),
      nossa("ultima", "2026-09-23T13:00:00Z", "sent"),
    ];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("só 'sent' é candidata: 'failed' já é vermelha pelo status, e as demais saíram", () => {
    const fio = [
      nossa("falhou", "2026-09-23T13:00:00Z", "failed"),
      nossa("enviando", "2026-09-23T13:00:01Z", "sending"),
      nossa("entregue", "2026-09-23T13:00:02Z", "delivered"),
      nossa("confirmada", depois, "read"),
    ];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("apagada ou com exclusão pedida fica de fora", () => {
    const fio = [
      nossa("apagada", "2026-09-23T13:00:00Z", "sent", { deleted_at: "2026-09-23T13:10:00Z" }),
      nossa("pedida", "2026-09-23T13:00:01Z", "sent", { delete_requested_at: "2026-09-23T13:10:00Z" }),
      nossa("confirmada", depois, "read"),
    ];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("grupo nunca acusa", () => {
    const fio = [nossa("g", "2026-09-23T13:00:00Z", "sent"), nossa("confirmada", depois, "read")];
    expect(entregasNaoConfirmadas(fio, agora, { ...OPCOES, emGrupo: true }).size).toBe(0);
  });

  it("mensagem da Meta não é candidata (o que ela gravou antes da escada não prova nada; alargar pede medir)", () => {
    const fio = [
      nossa("pela-meta", "2026-09-23T13:00:00Z", "sent", { channel_id: "meta" }),
      nossa("confirmada", depois, "read", { channel_id: "meta" }),
      doCliente("c", "2026-09-23T13:40:00Z"),
    ];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("mensagem sem carimbo de conexão não é candidata (não dá para saber o transporte)", () => {
    const fio = [nossa("sem-canal", "2026-09-23T13:00:00Z", "sent", { channel_id: null }), nossa("confirmada", depois, "read")];
    expect(entregasNaoConfirmadas(fio, agora, OPCOES).size).toBe(0);
  });

  it("canais ainda carregando (lista vazia) não acusam nada", () => {
    const fio = [nossa("x", "2026-09-23T13:00:00Z", "sent"), nossa("confirmada", depois, "read")];
    expect(entregasNaoConfirmadas(fio, agora, { ...OPCOES, canaisEvolution: new Set<string>() }).size).toBe(0);
  });
});

describe("entregasNaoConfirmadas — o que também vale", () => {
  it("a mensagem da automação (sender_type 'bot') também acusa", () => {
    const fio = [
      nossa("robo", "2026-09-23T13:00:00Z", "sent", { sender_type: "bot" }),
      nossa("confirmada", "2026-09-23T13:05:00Z", "delivered"),
    ];
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-23T14:00:00Z"), OPCOES))).toEqual(["robo"]);
  });

  it("confirmação vinda da Meta vale como evidência (numa conversa com os dois números)", () => {
    const fio = [
      nossa("evolution", "2026-09-23T13:00:00Z", "sent"),
      nossa("meta", "2026-09-23T13:02:00Z", "delivered", { channel_id: "meta" }),
    ];
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-23T14:00:00Z"), OPCOES))).toEqual(["evolution"]);
  });

  it("confirmação vinda do celular pareado vale como evidência (o aparelho do cliente recebeu)", () => {
    const fio = [
      nossa("crm", "2026-09-23T13:00:00Z", "sent"),
      nossa("celular", "2026-09-23T13:02:00Z", "delivered", { from_device: true }),
    ];
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-23T14:00:00Z"), OPCOES))).toEqual(["crm"]);
  });

  it("não depende da ordem do array", () => {
    const fio = [
      nossa("confirmada", "2026-09-23T13:05:00Z", "read"),
      nossa("sem-recibo", "2026-09-23T13:00:00Z", "sent"),
    ];
    expect(ids(entregasNaoConfirmadas(fio, ms("2026-09-23T14:00:00Z"), OPCOES))).toEqual(["sem-recibo"]);
  });

  it("data ilegível é ignorada, não vira evidência", () => {
    const fio = [nossa("x", "2026-09-23T13:00:00Z", "sent"), nossa("lixo", "não é data", "read")];
    expect(entregasNaoConfirmadas(fio, ms("2026-09-23T14:00:00Z"), OPCOES).size).toBe(0);
  });
});
