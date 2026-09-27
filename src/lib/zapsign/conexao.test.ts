import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("cifrado:")) throw new Error("ilegível");
    return s.slice("cifrado:".length);
  },
}));

import { ZapSignError, type ClienteZapSign } from "./cliente";
import { conectarZapSign, desconectarZapSign, reativarWebhook, urlDoWebhook } from "./conexao";
import { criarBanco, type Banco } from "./duble.test-helper";

// Tokens de TESTE — nenhum token real do ZapSign.
const TOKEN = "token-teste-aaaa-1111";
const OUTRO_TOKEN = "token-teste-bbbb-2222";
const ORIGEM = "https://crm.exemplo.com";
const CONTA = "conta-1";

interface Chamada {
  token: string;
  metodo: string;
  args?: unknown;
}

let chamadas: Chamada[];
let falhaDosModelos: ZapSignError | null;
let falhaDaCriacao: ZapSignError | null;
let falhaDoApagar: ZapSignError | null;
let banco: Banco;

function fabrica(token: string): ClienteZapSign {
  return {
    modelos: async () => {
      chamadas.push({ token, metodo: "modelos" });
      if (falhaDosModelos) throw falhaDosModelos;
      return { modelos: [], temMais: false, total: 0 };
    },
    plano: async () => ({ nome: "API Pro", status: "paid" }),
    documento: async () => null,
    criarWebhook: async (args) => {
      chamadas.push({ token, metodo: "criarWebhook", args });
      if (falhaDaCriacao) throw falhaDaCriacao;
      return { id: `wh-${chamadas.length}` };
    },
    apagarWebhook: async (id) => {
      chamadas.push({ token, metodo: "apagarWebhook", args: id });
      if (falhaDoApagar) throw falhaDoApagar;
    },
  };
}

const publico = { origem: ORIGEM, podeCriarWebhook: true, cliente: fabrica };
const doPreview = { origem: ORIGEM, podeCriarWebhook: false, cliente: fabrica };
const config = () => banco.tabelas.cb_zapsign_config[0];

beforeEach(() => {
  chamadas = [];
  falhaDosModelos = null;
  falhaDaCriacao = null;
  falhaDoApagar = null;
  banco = criarBanco();
});

describe("conectarZapSign", () => {
  it("token inválido e conta sem plano de API são recusados, sem gravar nada", async () => {
    falhaDosModelos = new ZapSignError("token_invalido", "401", 401);
    expect(await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico)).toEqual({ ok: false, codigo: "token_invalido" });
    falhaDosModelos = new ZapSignError("sem_plano", "402", 402);
    expect(await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico)).toEqual({ ok: false, codigo: "sem_plano" });
    expect(banco.tabelas.cb_zapsign_config ?? []).toHaveLength(0);
  });

  it("no host público: cria o webhook doc_signed com a credencial no cabeçalho, e grava tudo cifrado", async () => {
    const r = await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    expect(r).toEqual({ ok: true, plano: "API Pro", webhook: "ativo", webhookErro: null });
    const c = config();
    expect(c.api_token).toBe(`cifrado:${TOKEN}`);
    const segredo = String(c.webhook_secret).replace("cifrado:", "");
    expect(segredo.length).toBeGreaterThanOrEqual(32);
    expect(segredo).not.toBe(TOKEN);
    const criacao = chamadas.find((x) => x.metodo === "criarWebhook")!;
    expect(criacao.args).toEqual({
      url: urlDoWebhook(ORIGEM, String(c.webhook_url_token)),
      tipo: "doc_signed",
      cabecalho: { nome: "Authorization", valor: `Bearer ${segredo}` },
    });
    expect(c).toMatchObject({ webhook_estado: "ativo", status: "conectado", plano: "API Pro" });
  });

  it("CRÍTICO: fora do host público o webhook NÃO é criado (fica ausente, com o motivo)", async () => {
    const r = await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, doPreview);
    expect(r).toMatchObject({ ok: true, webhook: "ausente", webhookErro: "fora_do_host" });
    expect(chamadas.some((x) => x.metodo === "criarWebhook")).toBe(false);
  });

  it("sem origem alcançável: url_inalcancavel", async () => {
    const r = await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, { origem: null, podeCriarWebhook: false, cliente: fabrica });
    expect(r).toMatchObject({ ok: true, webhookErro: "url_inalcancavel" });
  });

  it("reconectar com o MESMO token reaproveita o webhook, o token da URL e a credencial", async () => {
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    const antes = { ...config() };
    chamadas = [];
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    expect(chamadas.filter((x) => x.metodo !== "modelos")).toEqual([]);
    expect(config()).toMatchObject({ webhook_id: antes.webhook_id, webhook_url_token: antes.webhook_url_token, webhook_secret: antes.webhook_secret });
  });

  it("token de OUTRA conta do ZapSign: apaga o webhook antigo com o token ANTIGO e cria outro", async () => {
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    const idAntigo = config().webhook_id;
    chamadas = [];
    await conectarZapSign(banco.cliente, CONTA, "u1", OUTRO_TOKEN, publico);
    expect(chamadas).toContainEqual({ token: TOKEN, metodo: "apagarWebhook", args: idAntigo });
    expect(chamadas.find((x) => x.metodo === "criarWebhook")?.token).toBe(OUTRO_TOKEN);
    expect(config().webhook_id).not.toBe(idAntigo);
  });

  it("token de OUTRA conta trocado fora do host público: credencial nova, webhook ausente", async () => {
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    const antes = { ...config() };
    chamadas = [];
    const r = await conectarZapSign(banco.cliente, CONTA, "u1", OUTRO_TOKEN, doPreview);
    expect(r).toMatchObject({ ok: true, webhook: "ausente", webhookErro: "fora_do_host" });
    expect(chamadas.filter((x) => x.metodo !== "modelos" && x.metodo !== "plano")).toEqual([]);
    // O token da URL fica; a credencial muda — o webhook da conta antiga passa a levar 401.
    expect(config().webhook_url_token).toBe(antes.webhook_url_token);
    expect(config().webhook_secret).not.toBe(antes.webhook_secret);
  });

  it("criação recusada pelo ZapSign: conectado, com o webhook em erro e o motivo", async () => {
    falhaDaCriacao = new ZapSignError("zapsign_error", "400");
    const r = await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    expect(r).toMatchObject({ ok: true, webhook: "erro", webhookErro: "zapsign_error" });
    expect(config()).toMatchObject({ webhook_estado: "erro", last_error: "zapsign_error", webhook_id: null });
  });
});

describe("reativarWebhook", () => {
  it("só no host público", async () => {
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, doPreview);
    expect(await reativarWebhook(banco.cliente, CONTA, doPreview)).toEqual({ ok: false, codigo: "fora_do_host" });
  });

  it("recria com a credencial guardada", async () => {
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, doPreview);
    expect(await reativarWebhook(banco.cliente, CONTA, publico)).toEqual({ ok: true });
    expect(config()).toMatchObject({ webhook_estado: "ativo", last_error: null });
  });

  it("sem conexão: nao_conectado", async () => {
    expect(await reativarWebhook(banco.cliente, CONTA, publico)).toEqual({ ok: false, codigo: "nao_conectado" });
  });
});

describe("desconectarZapSign", () => {
  it("apaga o webhook no ZapSign e a config", async () => {
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    const id = config().webhook_id;
    const r = await desconectarZapSign(banco.cliente, CONTA, { cliente: fabrica });
    expect(r).toEqual({ ok: true, webhookNaoApagado: false });
    expect(chamadas).toContainEqual({ token: TOKEN, metodo: "apagarWebhook", args: id });
    expect(banco.tabelas.cb_zapsign_config).toHaveLength(0);
  });

  it("webhook que já não existe conta como apagado; falha de rede avisa a tela", async () => {
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    falhaDoApagar = new ZapSignError("nao_encontrado", "404", 404);
    expect(await desconectarZapSign(banco.cliente, CONTA, { cliente: fabrica })).toEqual({ ok: true, webhookNaoApagado: false });
    await conectarZapSign(banco.cliente, CONTA, "u1", TOKEN, publico);
    falhaDoApagar = new ZapSignError("rede", "fetch failed");
    expect(await desconectarZapSign(banco.cliente, CONTA, { cliente: fabrica })).toEqual({ ok: true, webhookNaoApagado: true });
  });
});
