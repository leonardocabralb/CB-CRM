import { readFileSync } from "node:fs";
import { join } from "node:path";

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
import { conectarAtlas, conferirConexao, desconectarAtlas, ESTADO_DA_LEITURA_ZERADO, lerChaveDoAtlas, registrarConferencia } from "./conexao";

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
    listar: async () => ({ clientes: [], nextCursor: null, hasMore: false }),
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

  it("chave de OUTRO escritório do Atlas não herda os vínculos de outro (e diz quantos são)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, atlas_tenant_id: "t-antigo", atlas_client_id: "c1", contact_id: "k1" }];
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null })).toEqual({
      ok: false,
      codigo: "outro_escritorio",
      vinculosAnteriores: 1,
    });
    banco.tabelas.cb_atlas_clientes[0].atlas_tenant_id = "t1";
    expect((await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null })).ok).toBe(true);
  });

  it("outro_escritorio olha só os vínculos do MESMO ambiente: os de teste do staging não barram a produção", async () => {
    const STAGING = "https://staging.example.com/functions/v1/client-webhook";
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, api_url: STAGING, atlas_tenant_id: "t-teste", atlas_client_id: "c1", contact_id: "k1" }];
    expect((await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null })).ok).toBe(true);
    // E a instância de teste enxerga os DELA.
    banco.tabelas.cb_atlas_config = [];
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: STAGING })).toMatchObject({ codigo: "outro_escritorio" });
  });

  it("apagarVinculosAnteriores (confirmado no cartão): apaga SÓ os do escritório anterior deste ambiente e conecta", async () => {
    const STAGING = "https://staging.example.com/functions/v1/client-webhook";
    banco.tabelas.cb_atlas_clientes = [
      { id: "antigo", account_id: CONTA, api_url: null, atlas_tenant_id: "t-antigo", atlas_client_id: "c1", contact_id: "k1" },
      { id: "deste", account_id: CONTA, api_url: null, atlas_tenant_id: "t1", atlas_client_id: "c2", contact_id: "k2" },
      { id: "teste", account_id: CONTA, api_url: STAGING, atlas_tenant_id: "t-antigo", atlas_client_id: "c3", contact_id: "k3" },
      { id: "outra-conta", account_id: "conta-2", api_url: null, atlas_tenant_id: "t-antigo", atlas_client_id: "c4", contact_id: "k4" },
    ];
    expect((await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null, apagarVinculosAnteriores: true })).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_clientes.map((v) => v.id)).toEqual(["deste", "teste", "outra-conta"]);
  });

  it("CRÍTICO: a conexão nova que NÃO grava não apaga os vínculos do escritório anterior (apagar é o último passo)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "antigo", account_id: CONTA, api_url: null, atlas_tenant_id: "t-antigo", atlas_client_id: "c1", contact_id: "k1" }];
    banco.falhar.add("cb_atlas_config:upsert");
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null, apagarVinculosAnteriores: true })).toEqual({
      ok: false,
      codigo: "db_error",
    });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
  });

  it("apagar os vínculos anteriores que FALHA responde db_error (a conexão nova já vale, e o admin repete)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "antigo", account_id: CONTA, api_url: null, atlas_tenant_id: "t-antigo", atlas_client_id: "c1", contact_id: "k1" }];
    banco.falhar.add("cb_atlas_clientes:delete");
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null, apagarVinculosAnteriores: true })).toEqual({
      ok: false,
      codigo: "db_error",
    });
    expect(banco.tabelas.cb_atlas_config).toHaveLength(1);
  });

  it("registrarConferencia com a cerca da leitura: o cadeado trocado (reconexão) não deixa o erro da chave velha marcar a conexão nova", async () => {
    await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null });
    banco.tabelas.cb_atlas_config[0].sincronizando_desde = "2026-09-30T12:00:00.000Z";
    await registrarConferencia(banco.cliente, CONTA, "chave_invalida", null, { sincronizandoDesde: "2026-09-30T11:00:00.000Z" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado", last_error: null });
    await registrarConferencia(banco.cliente, CONTA, "chave_invalida", null, { sincronizandoDesde: "2026-09-30T12:00:00.000Z" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "chave_invalida" });
  });

  it("CRÍTICO: apagar só depois de a chave provar quem é (chave recusada não apaga nada)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "antigo", account_id: CONTA, atlas_tenant_id: "t-antigo", atlas_client_id: "c1", contact_id: "k1" }];
    identidade = new AtlasError("chave_invalida", "403", 403);
    await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null, apagarVinculosAnteriores: true });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
  });

  it("CRÍTICO: reconectar ZERA o estado da leitura (um cursor herdado de outro ambiente pularia clientes em silêncio)", async () => {
    banco.tabelas.cb_atlas_config = [
      {
        account_id: CONTA,
        api_key: "cifrado:velha",
        api_url: null,
        atlas_tenant_id: "t1",
        sincronizando_desde: "2026-09-30T10:00:00.000Z",
        last_sync_attempt_at: "2026-09-30T10:00:00.000Z",
        last_sync_at: "2026-09-30T09:00:00.000Z",
        situacoes_lidas_ate: "2026-09-30T09:00:00.000Z",
        mudancas_desde: "2026-09-30T08:55:00.000Z",
        mudancas_cursor: "cursor-velho",
        mudancas_iniciada_em: "2026-09-30T08:59:00.000Z",
        listagem_completa_em: "2026-09-30T03:00:00.000Z",
        listagem_iniciada_em: "2026-09-30T03:00:00.000Z",
        listagem_cursor: "outro-cursor",
        sync_erro: "limite",
      },
    ];
    expect((await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null })).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ api_key: `cifrado:${CHAVE}`, ...ESTADO_DA_LEITURA_ZERADO });
    // Colhido da 1072: toda coluna NOVA do estado da leitura em `cb_atlas_config` é zerada.
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/1072_cb_atlas_leitura_e_vinculo.sql"), "utf8");
    const bloco = sql.slice(sql.indexOf("ALTER TABLE cb_atlas_config"), sql.indexOf(";", sql.indexOf("ALTER TABLE cb_atlas_config")));
    const colunas = [...bloco.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(colunas).toContain("mudancas_iniciada_em");
    expect(Object.keys(ESTADO_DA_LEITURA_ZERADO).sort()).toEqual(colunas.sort());
  });

  it("a contagem dos vínculos alheios que falha é db_error, nunca 'nenhum'", async () => {
    banco.falhar.add("cb_atlas_clientes:select");
    expect(await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null })).toEqual({ ok: false, codigo: "db_error" });
    expect(banco.tabelas.cb_atlas_config ?? []).toHaveLength(0);
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
    // Outros códigos (limite, validação) não são problema da CONEXÃO.
    await registrarConferencia(banco.cliente, CONTA, "limite");
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado" });
    // Permissão desligada no Atlas depois de conectar: o cartão tem de dizer.
    await registrarConferencia(banco.cliente, CONTA, "sem_permissao");
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "sem_permissao" });
    // Nenhum sucesso de passo prova as TRÊS permissões: o aviso fica até "Conferir de novo".
    await registrarConferencia(banco.cliente, CONTA, null);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "sem_permissao" });
  });

  it("Conferir de novo: refaz o whoami com a chave guardada — permissão religada limpa o aviso; ainda desligada, mantém e diz qual", async () => {
    await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica });
    await registrarConferencia(banco.cliente, CONTA, "sem_permissao");
    identidade = { ...(identidade as IdentidadeNoAtlas), permissoes: { ...TODAS, create_client: false } };
    expect(await conferirConexao(banco.cliente, CONTA, { cliente: fabrica, ambiente: null })).toEqual({
      ok: false,
      codigo: "permissoes_faltando",
      faltando: ["create_client"],
    });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "sem_permissao" });
    identidade = { ...(identidade as IdentidadeNoAtlas), permissoes: { ...TODAS } };
    expect(await conferirConexao(banco.cliente, CONTA, { cliente: fabrica, ambiente: null })).toEqual({ ok: true, escritorio: "Escritório Exemplo" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado", last_error: null });
    // Chave recusada ao conferir: vai a erro com o motivo.
    identidade = new AtlasError("chave_invalida", "403", 403);
    expect(await conferirConexao(banco.cliente, CONTA, { cliente: fabrica, ambiente: null })).toEqual({ ok: false, codigo: "chave_invalida" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "chave_invalida" });
  });

  it("Conferir de novo sem conexão, ou de outro ambiente: não chama o Atlas", async () => {
    expect(await conferirConexao(banco.cliente, CONTA, { cliente: fabrica, ambiente: null })).toEqual({ ok: false, codigo: "nao_conectado" });
    await conectarAtlas(banco.cliente, CONTA, "u1", CHAVE, { cliente: fabrica, ambiente: null });
    expect(await conferirConexao(banco.cliente, CONTA, { cliente: fabrica, ambiente: "https://staging.example.com/x" })).toEqual({
      ok: false,
      codigo: "outro_ambiente",
    });
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
