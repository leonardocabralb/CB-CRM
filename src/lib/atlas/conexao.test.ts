import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("cifrado:")) throw new Error("ilegível");
    return s.slice("cifrado:".length);
  },
}));

import { criarBanco, type Banco } from "../zapsign/duble.test-helper";

import { AtlasError, type ClienteAtlas, type IdentidadeNoAtlas } from "./cliente";
import { conectarAtlas, desconectarAtlas, lerChaveDoAtlas, registrarConferencia } from "./conexao";

// Chave de TESTE — nenhuma chave real do Atlas.
const CHAVE = "sk_teste_0000000000000000000000000000";
const CONTA = "conta-1";

let banco: Banco;
let identidade: IdentidadeNoAtlas | AtlasError;

function fabrica(): ClienteAtlas {
  return {
    whoami: async () => {
      if (identidade instanceof AtlasError) throw identidade;
      return identidade;
    },
    buscar: async () => ({ clientes: [], truncado: false }),
    ler: async () => null,
    criar: async () => ({ id: "x", status: null, appUrl: null }),
    atualizar: async () => ({ id: "x", status: null, appUrl: null }),
  };
}

const TODAS = { read_client: true, create_client: true, update_client: true, list_clients: false };

beforeEach(() => {
  banco = criarBanco();
  identidade = { tenantId: "t1", escritorio: "Escritório Exemplo", plano: "elite", permissoes: { ...TODAS }, appBaseUrl: null };
});

describe("conectarAtlas", () => {
  it("chave recusada pelo Atlas: nada é gravado", async () => {
    identidade = new AtlasError("chave_invalida", "403", 403);
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica })).toEqual({ ok: false, codigo: "chave_invalida" });
    expect(banco.tabelas.cb_atlas_config ?? []).toHaveLength(0);
  });

  it("permissão que o passo usa desligada no Atlas: recusa dizendo quais", async () => {
    identidade = { ...(identidade as IdentidadeNoAtlas), permissoes: { create_client: true, update_client: true, read_client: false } };
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica })).toEqual({
      ok: false,
      codigo: "permissoes_faltando",
      faltando: ["read_client"],
    });
    expect(banco.tabelas.cb_atlas_config ?? []).toHaveLength(0);
  });

  it("grava CIFRADO, com o escritório e o tenant do whoami", async () => {
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica })).toEqual({ ok: true, escritorio: "Escritório Exemplo" });
    const [c] = banco.tabelas.cb_atlas_config;
    expect(c.api_key).toBe(`cifrado:${CHAVE}`);
    expect(c.atlas_tenant_id).toBe("t1");
    expect(c.status).toBe("conectado");
  });

  it("chave de OUTRO escritório do Atlas não herda os vínculos de outro", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, atlas_tenant_id: "t-antigo", atlas_client_id: "c1", contact_id: "k1" }];
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica })).toEqual({ ok: false, codigo: "outro_escritorio" });
    banco.tabelas.cb_atlas_clientes[0].atlas_tenant_id = "t1";
    expect((await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica })).ok).toBe(true);
  });

  it("falha do banco é db_error, nunca conectado", async () => {
    banco.falhar.add("cb_atlas_config:upsert");
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica })).toEqual({ ok: false, codigo: "db_error" });
  });
});

describe("lerChaveDoAtlas / desconectar / conferência", () => {
  it("sem linha = não conectado; leitura que falha = db_error (nunca 'desconectado'); cifra estragada = ilegível", async () => {
    expect(await lerChaveDoAtlas(banco.cliente, CONTA)).toEqual({ ok: false, codigo: "nao_conectado" });
    banco.falhar.add("cb_atlas_config:select");
    expect(await lerChaveDoAtlas(banco.cliente, CONTA)).toEqual({ ok: false, codigo: "db_error" });
    banco.falhar.clear();
    banco.tabelas.cb_atlas_config = [{ account_id: CONTA, api_key: "estragada", atlas_tenant_id: "t1" }];
    expect(await lerChaveDoAtlas(banco.cliente, CONTA)).toEqual({ ok: false, codigo: "chave_ilegivel" });
    banco.tabelas.cb_atlas_config = [{ account_id: CONTA, api_key: `cifrado:${CHAVE}`, atlas_tenant_id: "t1" }];
    expect(await lerChaveDoAtlas(banco.cliente, CONTA)).toEqual({ ok: true, chave: CHAVE, tenantId: "t1" });
  });

  it("desconectar apaga a conexão e MANTÉM os vínculos", async () => {
    await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica });
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, atlas_tenant_id: "t1", atlas_client_id: "c1", contact_id: "k1" }];
    expect(await desconectarAtlas(banco.cliente, CONTA)).toEqual({ ok: true });
    expect(banco.tabelas.cb_atlas_config).toHaveLength(0);
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
  });

  it("chave recusada marca erro; sucesso limpa só o erro da chave", async () => {
    await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica });
    await registrarConferencia(banco.cliente, CONTA, "chave_invalida");
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "chave_invalida" });
    await registrarConferencia(banco.cliente, CONTA, null);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado", last_error: null });
    // Outros códigos (limite, validação) não são problema da CHAVE.
    await registrarConferencia(banco.cliente, CONTA, "limite");
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado" });
  });
});

// ⚠️ O preview grava no banco da PRODUÇÃO (CLAUDE.md 8b): apontado para o
// staging do Atlas, ele não pode trocar, apagar nem usar a conexão de verdade.
describe("ambiente do Atlas (a instância de teste × a conexão de verdade)", () => {
  const STAGING = "https://staging.example.com/functions/v1/client-webhook";
  const DE_VERDADE = { account_id: CONTA, api_key: `cifrado:${CHAVE}`, api_url: null, atlas_tenant_id: "t1", status: "conectado", last_error: null };

  it("CRÍTICO: a instância de teste NÃO conecta por cima da conexão de verdade (nem chama o Atlas)", async () => {
    banco.tabelas.cb_atlas_config = [{ ...DE_VERDADE }];
    let chamou = false;
    const espiao = () => ({ ...fabrica(), whoami: async () => ((chamou = true), identidade as IdentidadeNoAtlas) });
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", "sk_outra_000000000000000000000", { cliente: espiao, ambiente: STAGING })).toEqual({
      ok: false,
      codigo: "outro_ambiente",
    });
    expect(chamou).toBe(false);
    expect(banco.tabelas.cb_atlas_config).toEqual([expect.objectContaining({ api_key: `cifrado:${CHAVE}`, api_url: null })]);
  });

  it("sem conexão, a instância de teste conecta e marca o ambiente; a de verdade substitui a de teste esquecida", async () => {
    expect((await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: STAGING })).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_config[0].api_url).toBe(STAGING);
    expect((await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null })).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_config[0].api_url).toBeNull();
  });

  it("CRÍTICO: a instância de teste não DESCONECTA a de verdade; a de verdade apaga qualquer uma", async () => {
    banco.tabelas.cb_atlas_config = [{ ...DE_VERDADE }];
    expect(await desconectarAtlas(banco.cliente, CONTA, STAGING)).toEqual({ ok: false, codigo: "outro_ambiente" });
    expect(banco.tabelas.cb_atlas_config).toHaveLength(1);
    banco.tabelas.cb_atlas_config[0].api_url = STAGING;
    expect(await desconectarAtlas(banco.cliente, CONTA, null)).toEqual({ ok: true });
    expect(banco.tabelas.cb_atlas_config).toHaveLength(0);
  });

  it("a chave de um ambiente nunca é lida para o outro", async () => {
    banco.tabelas.cb_atlas_config = [{ ...DE_VERDADE }];
    expect(await lerChaveDoAtlas(banco.cliente, CONTA, STAGING)).toEqual({ ok: false, codigo: "outro_ambiente" });
    expect((await lerChaveDoAtlas(banco.cliente, CONTA, null)).ok).toBe(true);
    banco.tabelas.cb_atlas_config[0].api_url = STAGING;
    expect(await lerChaveDoAtlas(banco.cliente, CONTA, null)).toEqual({ ok: false, codigo: "outro_ambiente" });
  });

  it("o staging recusando uma chave não marca em erro a conexão de verdade", async () => {
    banco.tabelas.cb_atlas_config = [{ ...DE_VERDADE }];
    await registrarConferencia(banco.cliente, CONTA, "chave_invalida", STAGING);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado", last_error: null });
    await registrarConferencia(banco.cliente, CONTA, "chave_invalida", null);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "chave_invalida" });
  });
});
