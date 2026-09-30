import fs from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("cifrado:")) throw new Error("ilegível");
    return s.slice("cifrado:".length);
  },
}));

import { MAX_DESCRICAO } from "@/lib/tasks/validar";

import { criarBanco, type Banco } from "../zapsign/duble.test-helper";

import {
  MOTIVO_NA_LIXEIRA,
  MOTIVO_SEM_VINCULO,
  atualizarClienteNoAtlas,
  atualizarOnboardingNoAtlas,
  criarTarefaNoAtlas,
  enviarTranscricaoAoAtlas,
  montarAtualizacao,
  motivoDaAcao,
  type EntradaDaTarefa,
  type EntradaDaTranscricao,
  type EntradaDoAtualizar,
  type EntradaDoOnboarding,
} from "./acoes";
import { AtlasError, type AcoesNoAtlas, type ClienteAtlas, type ClienteDoAtlas } from "./cliente";
import { bytesUtf8 } from "./passos-do-atlas";

// ============================================================
// O nó "Atlas" (30/09/2026): as quatro ações novas. O cliente é o do
// VÍNCULO (ambiente e escritório); sem ele, só a tarefa segue; a permissão
// OPCIONAL desligada não põe a conexão em erro; o `not_found` é a lixeira;
// o motivo nunca carrega texto do Atlas; nunca `null` no `update_client`.
// Dados fictícios.
// ============================================================

const CHAVE = "sk_teste_0000000000000000000000000000";
const CONTA = "conta-1";
const FICHA = "ficha-1";
const LOG = "00000000-0000-4000-8000-00000000a001";
const PASSO = "00000000-0000-4000-8000-00000000b001";
const IDEM = `${LOG}:${PASSO}`;
/** Um marcador que a resposta do Atlas traz e o motivo NUNCA pode repetir. */
const DO_ATLAS = "TEXTO-DO-ATLAS-com-dado-de-cliente";

let banco: Banco;
let noAtlas: Map<string, ClienteDoAtlas>;
let falha: AtlasError | null;
let chamadas: { metodo: string; args: unknown[] }[];
let respostaDoAtualizar: { id: string; appUrl: string | null; situacaoAnterior?: string | null };

function fabrica(): Pick<ClienteAtlas, "ler"> & AcoesNoAtlas {
  const registrar = (metodo: string, ...args: unknown[]) => {
    chamadas.push({ metodo, args });
    if (falha) throw falha;
  };
  return {
    ler: async (id: string) => (registrar("ler", id), noAtlas.get(id) ?? null),
    atualizarCliente: async (id, dados, idem) => (registrar("atualizarCliente", id, dados, idem), respostaDoAtualizar),
    criarTarefa: async (dados, idem) => (registrar("criarTarefa", dados, idem), { taskId: "tarefa-1" }),
    enviarTranscricao: async (dados, idem) => (registrar("enviarTranscricao", dados, idem), { transcriptId: "tr-1" }),
    atualizarItemDoOnboarding: async (dados, idem) => (registrar("atualizarItemDoOnboarding", dados, idem), { status: "done" }),
  };
}
const opcoes = { cliente: fabrica };

const VINCULO = { id: "v1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "c9", situacao: "ativo", origem: "criada", excluido_no_atlas_em: null };

beforeEach(() => {
  banco = criarBanco({
    cb_atlas_config: [{ account_id: CONTA, api_url: null, api_key: `cifrado:${CHAVE}`, atlas_tenant_id: "t1", status: "conectado", last_error: null }],
    cb_atlas_clientes: [{ ...VINCULO }],
    cb_reunioes_transcritas: [],
  });
  noAtlas = new Map([["c9", { id: "c9", status: "rescindido", appUrl: null }]]);
  falha = null;
  chamadas = [];
  respostaDoAtualizar = { id: "c9", appUrl: "https://app.example.com/#/clients/c9", situacaoAnterior: "rescindido" };
});

const conexao = () => banco.tabelas.cb_atlas_config[0];
const vinculo = () => banco.tabelas.cb_atlas_clientes[0];
const erroDe = async (p: Promise<unknown>) => (await p.catch((x: unknown) => x)) as Error;

// ------------------------------------------------------------
// O que as quatro repartem
// ------------------------------------------------------------

describe("conexão, vínculo e falhas (todas as ações)", () => {
  const tarefa = (): EntradaDaTarefa => ({
    accountId: CONTA,
    contactId: FICHA,
    chaveDeIdempotencia: IDEM,
    titulo: "Preparar a pasta",
    descricao: "",
    prioridade: "normal",
    prazoEmDias: 0,
    nomeDaAutomacao: "Contrato fechado",
    agora: new Date("2026-09-30T15:00:00.000Z"),
  });
  const onboarding = (): EntradaDoOnboarding => ({ accountId: CONTA, contactId: FICHA, chaveDeIdempotencia: IDEM, item: "Comprovante", situacao: "done", observacao: "" });

  it("sem conexão, de outro ambiente ou com a chave ilegível: falha sem chamar o Atlas (a ilegível marca a conexão)", async () => {
    banco.tabelas.cb_atlas_config = [];
    await expect(criarTarefaNoAtlas(banco.cliente, tarefa(), opcoes)).rejects.toThrow("o Atlas não está conectado");
    banco.tabelas.cb_atlas_config = [{ account_id: CONTA, api_url: "https://staging.example.com/x", api_key: `cifrado:${CHAVE}`, atlas_tenant_id: "t1" }];
    await expect(criarTarefaNoAtlas(banco.cliente, tarefa(), opcoes)).rejects.toThrow("é de outro ambiente do Atlas");
    banco.tabelas.cb_atlas_config = [{ account_id: CONTA, api_url: null, api_key: "estragada", atlas_tenant_id: "t1", status: "conectado" }];
    await expect(criarTarefaNoAtlas(banco.cliente, tarefa(), opcoes)).rejects.toThrow("não pôde ser lida");
    expect(conexao()).toMatchObject({ status: "erro", last_error: "chave_ilegivel" });
    expect(chamadas).toHaveLength(0);
  });

  it("sem vínculo (ou vínculo de OUTRO escritório, ou de outro ambiente): atualizar, transcrição e onboarding FALHAM sem chamar o Atlas", async () => {
    for (const linha of [null, { ...VINCULO, atlas_tenant_id: "t-antigo" }, { ...VINCULO, api_url: "https://staging.example.com/x" }]) {
      banco.tabelas.cb_atlas_clientes = linha ? [linha] : [];
      await expect(atualizarOnboardingNoAtlas(banco.cliente, onboarding(), opcoes)).rejects.toThrow(MOTIVO_SEM_VINCULO);
    }
    expect(chamadas).toHaveLength(0);
    // O vínculo de outro escritório fica.
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
    expect(MOTIVO_SEM_VINCULO).toContain("peça a um admin para vincular");
  });

  it("erro na leitura do vínculo NUNCA vira 'sem vínculo'", async () => {
    banco.falhar.add("cb_atlas_clientes:select");
    await expect(atualizarOnboardingNoAtlas(banco.cliente, onboarding(), opcoes)).rejects.toThrow("não foi possível ler o vínculo com o Atlas no CRM");
  });

  it("o SUCESSO de uma ação com cliente tira SÓ a marca da lixeira (a API só escreve em cliente fora dela), e a tarefa volta a sair", async () => {
    const MARCA = "2026-09-29T10:00:00.000Z";
    const marcado = () => (banco.tabelas.cb_atlas_clientes = [{ ...VINCULO, excluido_no_atlas_em: MARCA }]);
    const tarefaSai = async () => {
      chamadas = [];
      await criarTarefaNoAtlas(banco.cliente, tarefa(), opcoes);
      expect(chamadas.map((c) => c.metodo)).toEqual(["criarTarefa"]);
    };
    // "Atualizar cliente" SEM situação (com situação, a escrita do vínculo já a tirava).
    marcado();
    await atualizarClienteNoAtlas(banco.cliente, { accountId: CONTA, contactId: FICHA, chaveDeIdempotencia: IDEM, fontes: { situacao: null, tipoDeContrato: "fixo" } }, opcoes);
    expect(vinculo()).toEqual({ ...VINCULO, excluido_no_atlas_em: null, updated_at: expect.any(String) });
    await tarefaSai();
    // "Atualizar onboarding".
    marcado();
    await atualizarOnboardingNoAtlas(banco.cliente, onboarding(), opcoes);
    expect(vinculo()).toEqual({ ...VINCULO, excluido_no_atlas_em: null, updated_at: expect.any(String) });
    await tarefaSai();
    // "Enviar transcrição".
    marcado();
    banco.tabelas.cb_reunioes_transcritas = [
      { id: "r1", account_id: CONTA, contact_id: FICHA, origem: "manual", titulo: "Reunião", realizada_em: "2026-09-30T13:00:00.000Z", status: "pronta", texto: "t", notas: null, vinculo_origem: "manual" },
    ];
    await enviarTranscricaoAoAtlas(
      banco.cliente,
      { accountId: CONTA, contactId: FICHA, chaveDeIdempotencia: IDEM, idadeMaximaHoras: 72, notasDoOperador: "", incluirNotasDaReuniao: false, aceitarVinculoPorEmail: false, agora: new Date("2026-09-30T18:00:00.000Z") },
      opcoes,
    );
    expect(vinculo()).toEqual({ ...VINCULO, excluido_no_atlas_em: null, updated_at: expect.any(String) });
    await tarefaSai();
    // A FALHA não tira: o `not_found` mantém (e o de outra razão também).
    marcado();
    falha = new AtlasError("validacao", "400", 400);
    await expect(atualizarOnboardingNoAtlas(banco.cliente, onboarding(), opcoes)).rejects.toThrow("o Atlas recusou os dados");
    expect(vinculo().excluido_no_atlas_em).toBe(MARCA);
  });

  it("CRÍTICO: permissão OPCIONAL desligada: o motivo nomeia a permissão e a conexão NÃO vai a erro — também sem `permission` na resposta", async () => {
    for (const permissao of ["create_task", null]) {
      falha = new AtlasError("sem_permissao", `create_task → 403 permission_denied: ${DO_ATLAS}`, 403, permissao);
      const e = await erroDe(criarTarefaNoAtlas(banco.cliente, tarefa(), opcoes));
      // O rótulo da tela do Atlas ainda não foi conferido: a descrição e o nome técnico, nunca um rótulo inventado.
      expect(e.message).toBe("Atlas: a permissão de criar tarefas (create_task) está desligada no Atlas; ligue-a lá e rode de novo");
      expect(conexao()).toMatchObject({ status: "conectado", last_error: null });
    }
    falha = new AtlasError("sem_permissao", "403", 403, "update_onboarding");
    await expect(atualizarOnboardingNoAtlas(banco.cliente, onboarding(), opcoes)).rejects.toThrow("a permissão de atualizar o onboarding (update_onboarding) está desligada");
    expect(conexao()).toMatchObject({ status: "conectado" });
  });

  it("`update_client` desligada MARCA a conexão (é obrigatória desde a conexão)", async () => {
    falha = new AtlasError("sem_permissao", "403", 403, "update_client");
    await expect(
      atualizarClienteNoAtlas(banco.cliente, { accountId: CONTA, contactId: FICHA, chaveDeIdempotencia: IDEM, fontes: { situacao: null, tipoDeContrato: "fixo" } }, opcoes),
    ).rejects.toThrow('"Atualizar Clientes" (update_client)');
    expect(conexao()).toMatchObject({ status: "erro", last_error: "sem_permissao" });
  });

  it("CRÍTICO: o motivo NUNCA carrega texto da resposta do Atlas; chave recusada marca a conexão", async () => {
    falha = new AtlasError("chave_invalida", `create_task → 403 invalid_api_key: ${DO_ATLAS}`, 403);
    const e = await erroDe(criarTarefaNoAtlas(banco.cliente, tarefa(), opcoes));
    expect(e.message).toBe("Atlas: a chave do Atlas foi recusada — reconecte em Configurações → Integrações");
    expect(conexao()).toMatchObject({ status: "erro", last_error: "chave_invalida" });
    for (const codigo of ["validacao", "limite", "idempotencia", "acao_desconhecida", "fora_do_ar", "rede", "resposta_inesperada", "ambiguo", "sem_admin", "atlas_error"] as const) {
      const m = motivoDaAcao(new AtlasError(codigo, DO_ATLAS, 400, DO_ATLAS, { codigoDoAtlas: "x", campos: ["title"] }), "atlas_criar_tarefa");
      expect(m, codigo).not.toContain(DO_ATLAS);
    }
  });

  it("a frase da idempotência depende do `code` do Atlas (código, não texto)", () => {
    const m = (codigoDoAtlas: string) => motivoDaAcao(new AtlasError("idempotencia", "x", 409, null, { codigoDoAtlas }), "atlas_criar_tarefa");
    expect(m("idempotency_in_progress")).toContain("ainda está processando");
    expect(m("idempotency_outcome_unknown")).toContain("não sabe se o pedido anterior entrou");
    expect(m("idempotency_conflict")).toContain("com outros dados");
    expect(m("idempotency_key_invalid")).toContain("erro do CRM");
  });

  it("tempo esgotado diz O QUE conferir no Atlas, por ação", () => {
    const e = new AtlasError("rede", "timeout");
    expect(motivoDaAcao(e, "atlas_atualizar_cliente")).toContain("se o cliente foi atualizado");
    expect(motivoDaAcao(e, "atlas_criar_tarefa")).toContain("se a tarefa foi criada");
    expect(motivoDaAcao(e, "atlas_enviar_transcricao")).toContain("se a transcrição chegou ao Diagnóstico");
    expect(motivoDaAcao(e, "atlas_atualizar_onboarding")).toContain("se o item foi atualizado");
  });

  it("a Idempotency-Key é `<logId>:<stepId>:<ação>`, entre 8 e 128 caracteres", async () => {
    await criarTarefaNoAtlas(banco.cliente, tarefa(), opcoes);
    await atualizarOnboardingNoAtlas(banco.cliente, onboarding(), opcoes);
    const chaves = chamadas.map((c) => c.args.at(-1) as string);
    expect(chaves).toEqual([`${IDEM}:tarefa`, `${IDEM}:onboarding`]);
    for (const k of [...chaves, `${IDEM}:atualizar`, `${IDEM}:transcricao`]) {
      expect(k.length).toBeGreaterThanOrEqual(8);
      expect(k.length).toBeLessThanOrEqual(128);
    }
  });
});

// ------------------------------------------------------------
// Ação 2 — Atualizar cliente
// ------------------------------------------------------------

describe("atualizarClienteNoAtlas", () => {
  const entrada = (fontes: EntradaDoAtualizar["fontes"]): EntradaDoAtualizar => ({ accountId: CONTA, contactId: FICHA, chaveDeIdempotencia: IDEM, fontes });
  const corpo = () => chamadas.find((c) => c.metodo === "atualizarCliente")?.args[1] as Record<string, unknown>;

  it("CRÍTICO: nunca manda nulo nem vazio — o que está vazio na ficha fica FORA do corpo (null apagaria o campo no Atlas)", async () => {
    const r = await atualizarClienteNoAtlas(
      banco.cliente,
      entrada({
        situacao: null,
        tipoDeContrato: "mensal",
        valorDoCard: 0,
        primeiroContato: null,
        proposta: "  ",
        fechamento: "2026-09-30T02:10:00.000Z",
        linkDaConversa: null,
        telefone: "12345",
        email: "nao tem",
        documento: "",
      }),
      opcoes,
    );
    expect(corpo()).toEqual({ contractType: "mensal", closingDate: "2026-09-29" });
    expect(Object.values(corpo())).not.toContain(null);
    expect(chamadas.map((c) => c.metodo)).toEqual(["atualizarCliente"]);
    expect(r).toBe(
      "cliente atualizado no Atlas: tipo de contrato, data de fechamento; vazios na ficha, não alterados: valor do card, data do primeiro contato, data da proposta, link da conversa, telefone, e-mail, documento",
    );
  });

  it("CRÍTICO: card com valor 0 (o padrão do banco) ou sem card NÃO põe `contractValue` (apagaria o valor lá); com valor, vai", async () => {
    expect(montarAtualizacao({ situacao: null, tipoDeContrato: null, valorDoCard: 0 }).dados).toEqual({});
    expect(montarAtualizacao({ situacao: null, tipoDeContrato: null, valorDoCard: null }).dados).toEqual({});
    expect(montarAtualizacao({ situacao: null, tipoDeContrato: null, valorDoCard: 3500.5 }).dados).toEqual({ contractValue: 3500.5 });
  });

  it("todos os campos, no formato do Atlas", () => {
    const { dados } = montarAtualizacao({
      situacao: "finalizado",
      tipoDeContrato: "fixo",
      valorDoCard: 5000,
      primeiroContato: "2026-09-01T12:00:00.000Z",
      proposta: "2026-09-10T13:30:00.000Z",
      fechamento: "2026-09-29T15:00:00.000Z",
      linkDaConversa: "https://crm.example.com/inbox?c=conv-1",
      telefone: "+55 (11) 98765-4321",
      email: " cliente@example.com ",
      documento: "123.456.789-09",
    });
    expect(dados).toEqual({
      status: "finalizado",
      contractType: "fixo",
      contractValue: 5000,
      firstContactDate: "2026-09-01",
      proposalDate: "2026-09-10",
      closingDate: "2026-09-29",
      chatLink: "https://crm.example.com/inbox?c=conv-1",
      phone: "5511987654321",
      email: "cliente@example.com",
      docId: "12345678909",
    });
    expect(montarAtualizacao({ situacao: null, tipoDeContrato: null, documento: "12.345.678/0001-95" }).dados).toEqual({ docId: "12345678000195" });
  });

  it("data PREENCHIDA ilegível e documento que não é CPF nem CNPJ FALHAM sem chamar o Atlas", async () => {
    await expect(atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: null, tipoDeContrato: null, proposta: "semana que vem" }), opcoes)).rejects.toThrow(
      "a data da proposta na ficha não é uma data válida",
    );
    await expect(atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: null, tipoDeContrato: null, documento: "123" }), opcoes)).rejects.toThrow(
      "não é CPF (11 dígitos) nem CNPJ (14 dígitos)",
    );
    expect(chamadas).toHaveLength(0);
  });

  it("tudo o que foi escolhido está vazio na ficha: CONCLUI sem chamar o Atlas (ele recusaria o pedido sem campo)", async () => {
    const r = await atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: null, tipoDeContrato: null, telefone: null, email: "" }), opcoes);
    expect(r).toBe("nada a atualizar no Atlas: os campos escolhidos estão vazios na ficha (telefone, e-mail)");
    expect(chamadas).toHaveLength(0);
  });

  it("CRÍTICO: a situação escrita vai ao VÍNCULO (a leitura a vê igual e não gera o evento do gatilho)", async () => {
    const r = await atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: "finalizado", tipoDeContrato: null }), opcoes);
    expect(vinculo()).toMatchObject({
      situacao: "finalizado",
      situacao_lida_em: expect.any(String),
      crm_escreveu_em: expect.any(String),
      excluido_no_atlas_em: null,
      app_url: "https://app.example.com/#/clients/c9",
    });
    expect(r).toBe("cliente atualizado no Atlas: situação (rescindido → finalizado)");
    expect(conexao()).toMatchObject({ conferido_em: expect.any(String) });
  });

  it("sem situação no corpo, o vínculo não é tocado", async () => {
    await atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: null, tipoDeContrato: "fixo" }), opcoes);
    expect(vinculo()).toEqual(VINCULO);
  });

  it("a situação anterior só aparece no detalhe quando é uma das NOSSAS", async () => {
    respostaDoAtualizar = { id: "c9", appUrl: null, situacaoAnterior: `<b>${DO_ATLAS}</b>` };
    const r = await atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: "inativo", tipoDeContrato: null }), opcoes);
    expect(r).toBe("cliente atualizado no Atlas: situação (inativo)");
  });

  it("a escrita do vínculo que falha DEPOIS do Atlas falha o passo dizendo o que já foi escrito", async () => {
    banco.falhar.add("cb_atlas_clientes:update");
    await expect(atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: "finalizado", tipoDeContrato: null }), opcoes)).rejects.toThrow(
      "a situação foi gravada no Atlas, mas o vínculo não foi atualizado no CRM",
    );
  });

  it("CRÍTICO: ativo/importado RELÊ o cliente e PARA no suspenso (a trava do 'Criar cliente'); sem ele, segue", async () => {
    noAtlas.set("c9", { id: "c9", status: "suspenso", appUrl: null });
    await expect(atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: "ativo", tipoDeContrato: null }), opcoes)).rejects.toThrow(
      "no Atlas está suspenso",
    );
    expect(chamadas.map((c) => c.metodo)).toEqual(["ler"]);
    noAtlas.set("c9", { id: "c9", status: "rescindido", appUrl: null });
    await atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: "importado", tipoDeContrato: null }), opcoes);
    expect(chamadas.map((c) => c.metodo)).toEqual(["ler", "ler", "atualizarCliente"]);
    // Situação que NÃO reabre não gasta a leitura.
    chamadas = [];
    await atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: "rescindido", tipoDeContrato: null }), opcoes);
    expect(chamadas.map((c) => c.metodo)).toEqual(["atualizarCliente"]);
  });

  it("CRÍTICO: `not_found` do Atlas = LIXEIRA: marca o vínculo (sem apagá-lo) e falha", async () => {
    falha = new AtlasError("nao_encontrado", "update_client → 404 not_found", 404);
    await expect(atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: null, tipoDeContrato: "fixo" }), opcoes)).rejects.toThrow(MOTIVO_NA_LIXEIRA);
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
    expect(vinculo().excluido_no_atlas_em).toEqual(expect.any(String));
    // Na releitura do ativo, também.
    banco.tabelas.cb_atlas_clientes = [{ ...VINCULO }];
    falha = null;
    noAtlas.clear();
    await expect(atualizarClienteNoAtlas(banco.cliente, entrada({ situacao: "ativo", tipoDeContrato: null }), opcoes)).rejects.toThrow(MOTIVO_NA_LIXEIRA);
    expect(vinculo().excluido_no_atlas_em).toEqual(expect.any(String));
  });
});

// ------------------------------------------------------------
// Ação 3 — Criar tarefa
// ------------------------------------------------------------

describe("criarTarefaNoAtlas", () => {
  const entrada = (parcial: Partial<EntradaDaTarefa> = {}): EntradaDaTarefa => ({
    accountId: CONTA,
    contactId: FICHA,
    chaveDeIdempotencia: IDEM,
    titulo: "Preparar a pasta de Cliente Exemplo",
    descricao: "Conferir os documentos",
    prioridade: "urgent",
    prazoEmDias: 2,
    nomeDaAutomacao: "Contrato fechado",
    agora: new Date("2026-09-30T15:00:00.000Z"),
    ...parcial,
  });
  const dados = () => chamadas.find((c) => c.metodo === "criarTarefa")?.args[0] as Record<string, unknown>;

  it("com vínculo: pede a tarefa com o cliente, e o detalhe não afirma o que a API não prova", async () => {
    const r = await criarTarefaNoAtlas(banco.cliente, entrada(), opcoes);
    expect(dados()).toEqual({ title: "Preparar a pasta de Cliente Exemplo", description: "Conferir os documentos", priority: "urgent", dueDate: "2026-10-02", clientId: "c9" });
    expect(r).toBe("tarefa criada no Atlas (pedida com o cliente ligado à ficha)");
  });

  it("DECISÃO: sem vínculo, a tarefa nasce SEM cliente, e o detalhe diz", async () => {
    banco.tabelas.cb_atlas_clientes = [];
    const r = await criarTarefaNoAtlas(banco.cliente, entrada(), opcoes);
    expect(dados()).not.toHaveProperty("clientId");
    expect(r).toBe("tarefa criada no Atlas sem cliente: a ficha não está ligada ao Atlas");
  });

  it("vínculo marcado na LIXEIRA: falha sem enviar (a tarefa ficaria presa ao cadastro excluído)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ ...VINCULO, excluido_no_atlas_em: "2026-09-29T10:00:00.000Z" }];
    await expect(criarTarefaNoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("está na lixeira do Atlas (a tarefa ficaria presa a ele)");
    expect(chamadas).toHaveLength(0);
  });

  it("prazo pelo DIA do escritório: às 22h de Brasília (01h UTC do dia seguinte) ainda é hoje; nulo = sem prazo", async () => {
    await criarTarefaNoAtlas(banco.cliente, entrada({ prazoEmDias: 0, agora: new Date("2026-10-01T01:00:00.000Z") }), opcoes);
    expect(dados().dueDate).toBe("2026-09-30");
    chamadas = [];
    await criarTarefaNoAtlas(banco.cliente, entrada({ prazoEmDias: null }), opcoes);
    expect(dados()).not.toHaveProperty("dueDate");
  });

  it("descrição vazia leva a frase com o nome da automação e do app (sem ela, o Atlas grava o inglês); título vazio falha", async () => {
    await criarTarefaNoAtlas(banco.cliente, entrada({ descricao: "   " }), opcoes);
    expect(dados().description).toMatch(/^Aberta pela automação "Contrato fechado" no .+/);
    await expect(criarTarefaNoAtlas(banco.cliente, entrada({ titulo: "  " }), opcoes)).rejects.toThrow("o título da tarefa ficou vazio");
  });

  it("a descrição de RESERVA também passa pelo teto (o nome da automação não tem limite)", async () => {
    await criarTarefaNoAtlas(banco.cliente, entrada({ descricao: "", nomeDaAutomacao: "n".repeat(5000) }), opcoes);
    expect(String(dados().description).length).toBeLessThanOrEqual(MAX_DESCRICAO);
    expect(String(dados().description).endsWith("…")).toBe(true);
  });

  it("título acima de 200 é cortado com reticência", async () => {
    await criarTarefaNoAtlas(banco.cliente, entrada({ titulo: "t".repeat(300) }), opcoes);
    expect(String(dados().title)).toHaveLength(200);
    expect(String(dados().title).endsWith("…")).toBe(true);
  });

  it("escritório sem admin ativo no Atlas: o motivo diz", async () => {
    falha = new AtlasError("sem_admin", "422", 422, null, { codigoDoAtlas: "no_active_admin" });
    await expect(criarTarefaNoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("não tem administrador ativo");
    expect(conexao()).toMatchObject({ status: "conectado" });
  });
});

// ------------------------------------------------------------
// Ação 4 — Enviar transcrição
// ------------------------------------------------------------

describe("enviarTranscricaoAoAtlas", () => {
  const AGORA = new Date("2026-09-30T18:00:00.000Z");
  const reuniao = (parcial: Record<string, unknown> = {}) => ({
    id: "r1",
    account_id: CONTA,
    contact_id: FICHA,
    origem: "tldv",
    titulo: "Reunião de diagnóstico",
    realizada_em: "2026-09-30T13:00:00.000Z",
    status: "pronta",
    texto: "Transcrição da reunião",
    notas: "Resumo do tl;dv",
    vinculo_origem: "manual",
    ...parcial,
  });
  const entrada = (parcial: Partial<EntradaDaTranscricao> = {}): EntradaDaTranscricao => ({
    accountId: CONTA,
    contactId: FICHA,
    chaveDeIdempotencia: IDEM,
    idadeMaximaHoras: 72,
    notasDoOperador: "Contrato fechado hoje",
    incluirNotasDaReuniao: true,
    aceitarVinculoPorEmail: false,
    agora: AGORA,
    ...parcial,
  });
  const enviado = () => chamadas.find((c) => c.metodo === "enviarTranscricao")?.args[0] as { clientId: string; transcript: string; notes: string };

  it("manda a MAIS RECENTE da janela, com as notas: cabeçalho (data no fuso do escritório), as do passo e as da reunião", async () => {
    banco.tabelas.cb_reunioes_transcritas = [
      reuniao({ id: "velha", realizada_em: "2026-09-29T13:00:00.000Z", texto: "outra reunião" }),
      reuniao(),
      reuniao({ id: "de-outra-ficha", contact_id: "ficha-2", realizada_em: "2026-09-30T17:00:00.000Z" }),
    ];
    const r = await enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes);
    const e = enviado();
    expect(e.clientId).toBe("c9");
    expect(e.transcript).toBe("Transcrição da reunião");
    expect(e.notes).toMatch(/^Reunião "Reunião de diagnóstico" de 30\/09\/2026 10:00 \(tl;dv\), enviada pelo .+\n\nContrato fechado hoje\n\nResumo do tl;dv$/);
    expect(chamadas.find((c) => c.metodo === "enviarTranscricao")?.args[1]).toBe(`${IDEM}:transcricao`);
    expect(r).toBe('transcrição da reunião "Reunião de diagnóstico" de 30/09 enviada ao Atlas (aguarda análise no Diagnóstico)');
    // O TEXTO da transcrição nunca vai ao detalhe.
    expect(r).not.toContain("Transcrição da reunião");
  });

  it("CRÍTICO: transcrição com data FUTURA (colada à mão) não passa na frente da reunião que aconteceu", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao(), reuniao({ id: "futura", realizada_em: "2026-10-05T13:00:00.000Z", texto: "reunião que ainda não aconteceu" })];
    await enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes);
    expect(enviado().transcript).toBe("Transcrição da reunião");
  });

  it("notas da reunião: só com `true`", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao()];
    await enviarTranscricaoAoAtlas(banco.cliente, entrada({ incluirNotasDaReuniao: false, notasDoOperador: "" }), opcoes);
    expect(enviado().notes).not.toContain("Resumo do tl;dv");
  });

  it("CRÍTICO: a mais recente PENDENTE falha sem mandar a anterior (seria outra reunião)", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao({ id: "pronta-velha", realizada_em: "2026-09-29T13:00:00.000Z" }), reuniao({ status: "pendente", texto: null })];
    await expect(enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("a transcrição da reunião de 30/09/2026 10:00 ainda não ficou pronta no tl;dv");
    expect(chamadas).toHaveLength(0);
  });

  it("sem transcrição, fora da janela, ou erro de leitura: falha com motivo (erro nunca vira 'não há')", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao({ status: "sem_transcricao", texto: null })];
    await expect(enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("ficou sem transcrição; cole a transcrição na aba Reuniões");
    banco.tabelas.cb_reunioes_transcritas = [reuniao({ realizada_em: "2026-09-20T13:00:00.000Z" })];
    await expect(enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("não há transcrição de reunião deste cliente nas últimas 72 h");
    banco.falhar.add("cb_reunioes_transcritas:select");
    await expect(enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("não foi possível ler as transcrições no CRM");
    expect(chamadas).toHaveLength(0);
  });

  it("CRÍTICO: reunião ligada pelo E-MAIL do convidado (casamento fraco) só vai com a caixa marcada, e o detalhe diz", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao({ vinculo_origem: "email" })];
    const e = await erroDe(enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes));
    expect(e.message).toContain("foi ligada a esta ficha pelo e-mail do convidado");
    expect(chamadas).toHaveLength(0);
    // ⚠️ O caminho que o motivo manda seguir EXISTE: não há botão "confirmar"
    // (o PATCH grava `manual` só ao vincular de novo). Cada botão citado entre
    // aspas é um texto da tela, nos dicionários.
    expect(e.message).not.toMatch(/confirme o vínculo/);
    const pt = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../messages/pt-BR.json"), "utf8"));
    const textosDaTela = [
      pt.Transcricoes.desvincular,
      pt.Transcricoes.doTldv,
      pt.Settings.integracoes.tldv.vincular,
      pt.Automations.builder.atlas.aceitarEmailLabel,
    ];
    const citados = [...e.message.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(citados.filter((c) => !textosDaTela.includes(c))).toEqual([]);
    expect(citados).toHaveLength(textosDaTela.length);
    const r = await enviarTranscricaoAoAtlas(banco.cliente, entrada({ aceitarVinculoPorEmail: true }), opcoes);
    expect(r).toContain("ligada à ficha pelo e-mail do convidado");
    // A colada à mão é da ficha.
    chamadas = [];
    banco.tabelas.cb_reunioes_transcritas = [reuniao({ origem: "manual", vinculo_origem: null })];
    await enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes);
    expect(enviado().notes).toContain("(colada à mão)");
  });

  it("transcrição acima de 300 KB falha SEM cortar e sem chamar", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao({ texto: "é".repeat(150_001) })];
    await expect(enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("passa do teto do Atlas (300 KB)");
    expect(chamadas).toHaveLength(0);
  });

  it("notas acima de 50 KB: corta SÓ a parte da reunião, sem partir caractere", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao({ notas: "ã".repeat(40_000) })];
    await enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes);
    const notas = enviado().notes;
    expect(bytesUtf8(notas)).toBeLessThanOrEqual(50_000);
    expect(notas).toContain("Contrato fechado hoje");
    expect(notas.endsWith(" […]")).toBe(true);
    // As do passo sozinhas acima do teto: falha.
    await expect(enviarTranscricaoAoAtlas(banco.cliente, entrada({ notasDoOperador: "x".repeat(50_001) }), opcoes)).rejects.toThrow("as notas do passo passam do teto");
  });

  it("o `not_found` do Atlas no envio é a lixeira: marca o vínculo, sem apagá-lo", async () => {
    banco.tabelas.cb_reunioes_transcritas = [reuniao()];
    falha = new AtlasError("nao_encontrado", "404 not_found", 404);
    await expect(enviarTranscricaoAoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow(MOTIVO_NA_LIXEIRA);
    expect(vinculo().excluido_no_atlas_em).toEqual(expect.any(String));
  });
});

// ------------------------------------------------------------
// Ação 5 — Atualizar onboarding
// ------------------------------------------------------------

describe("atualizarOnboardingNoAtlas", () => {
  const entrada = (parcial: Partial<EntradaDoOnboarding> = {}): EntradaDoOnboarding => ({
    accountId: CONTA,
    contactId: FICHA,
    chaveDeIdempotencia: IDEM,
    item: " Comprovante de residência ",
    situacao: "done",
    observacao: "",
    ...parcial,
  });
  const dados = () => chamadas.find((c) => c.metodo === "atualizarItemDoOnboarding")?.args[0] as Record<string, unknown>;

  it("pelo texto do item, aparado; observação vazia fica FORA (null apagaria a de lá)", async () => {
    const r = await atualizarOnboardingNoAtlas(banco.cliente, entrada(), opcoes);
    expect(dados()).toEqual({ clientId: "c9", text: "Comprovante de residência", status: "done" });
    expect(r).toBe('item "Comprovante de residência" do onboarding atualizado no Atlas: marcado como feito');
  });

  it("observação acima de 2000 unidades UTF-16 é cortada sem partir emoji", async () => {
    await atualizarOnboardingNoAtlas(banco.cliente, entrada({ situacao: null, observacao: `${"a".repeat(1998)}😀b` }), opcoes);
    const obs = String(dados().observation);
    expect(obs.length).toBeLessThanOrEqual(2000);
    expect(dados()).not.toHaveProperty("status");
  });

  it("sem situação e com a observação vazia: CONCLUI sem chamar", async () => {
    const r = await atualizarOnboardingNoAtlas(banco.cliente, entrada({ situacao: null, observacao: "  " }), opcoes);
    expect(r).toContain("nada a atualizar no onboarding");
    expect(chamadas).toHaveLength(0);
  });

  it("CRÍTICO: item que não existe NÃO marca a lixeira; o `not_found` do cliente, sim", async () => {
    falha = new AtlasError("item_nao_encontrado", "404", 404);
    await expect(atualizarOnboardingNoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow(
      'o checklist de onboarding deste cliente no Atlas não tem o item "Comprovante de residência"',
    );
    expect(vinculo().excluido_no_atlas_em).toBeNull();
    falha = new AtlasError("nao_encontrado", "404", 404);
    await expect(atualizarOnboardingNoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow(MOTIVO_NA_LIXEIRA);
    expect(vinculo().excluido_no_atlas_em).toEqual(expect.any(String));
  });

  it("dois itens com o mesmo texto: o motivo manda renomear lá", async () => {
    falha = new AtlasError("ambiguo", "422", 422, null, { codigoDoAtlas: "ambiguous" });
    await expect(atualizarOnboardingNoAtlas(banco.cliente, entrada(), opcoes)).rejects.toThrow("há mais de um item com esse texto");
  });
});
