import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("cifrado:")) throw new Error("ilegível");
    return s.slice("cifrado:".length);
  },
}));

import { criarBanco, type Banco } from "../zapsign/duble.test-helper";

import { AtlasError, type ClienteAtlas, type ClienteDoAtlas } from "./cliente";
import { desligarVinculo, idDoLink, ligarVinculo } from "./vinculo";

// ============================================================
// O vínculo feito por GENTE na aba Atlas (Fase 2, PR B): o id sai do link
// colado, o que se grava sai da RESPOSTA do Atlas, os conflitos são
// conferidos antes de gastar a cota, e desvincular grava a recusa. Dados
// fictícios (ids inventados, domínios example.com).
// ============================================================

const CHAVE = "sk_teste_0000000000000000000000000000";
const CONTA = "conta-1";
const FICHA = "ficha-1";
const USUARIO = "admin-1";
const CLIENTE = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const OUTRO = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const APP = `https://app.example.com/#/clients/${CLIENTE}`;
const STAGING = "https://staging.example.com/functions/v1/client-webhook";

let banco: Banco;
let noAtlas: Map<string, ClienteDoAtlas>;
let falha: AtlasError | null;
let lidos: string[];

function fabrica(): ClienteAtlas {
  const nao = async () => {
    throw new Error("não usado");
  };
  return {
    whoami: nao,
    listar: nao,
    buscar: nao,
    criar: nao,
    atualizar: nao,
    negociacoes: nao,
    ler: async (id: string) => {
      lidos.push(id);
      if (falha) throw falha;
      return noAtlas.get(id) ?? null;
    },
  };
}

const unicos = {
  cb_atlas_clientes: [
    { colunas: ["account_id", "api_url", "atlas_client_id"] },
    { colunas: ["account_id", "api_url", "contact_id"], onde: (l: Record<string, unknown>) => l.contact_id != null },
  ],
  cb_atlas_recusas: [{ colunas: ["account_id", "api_url", "contact_id", "atlas_client_id"] }],
};

const ligar = (link: unknown = APP, ambiente: string | null = null) =>
  ligarVinculo(banco.cliente, { accountId: CONTA, contactId: FICHA, userId: USUARIO, link }, { cliente: fabrica, ambiente });
const desligar = (ambiente: string | null = null) => desligarVinculo(banco.cliente, { accountId: CONTA, contactId: FICHA, userId: USUARIO }, { ambiente });

beforeEach(() => {
  banco = criarBanco(
    {
      cb_atlas_config: [{ account_id: CONTA, api_url: null, api_key: `cifrado:${CHAVE}`, atlas_tenant_id: "t1", status: "conectado", last_error: null }],
      contacts: [
        { id: FICHA, account_id: CONTA },
        { id: "ficha-2", account_id: CONTA },
      ],
    },
    { unicos },
  );
  noAtlas = new Map([[CLIENTE, { id: CLIENTE, status: "rescindido", appUrl: APP, situacaoDesde: "2026-08-12T13:00:00.000Z" }]]);
  falha = null;
  lidos = [];
});

describe("idDoLink", () => {
  it("aceita o link da ficha, com ?tab= ou sem, de qualquer host, e o uuid solto — em minúsculas", () => {
    expect(idDoLink(APP)).toBe(CLIENTE);
    expect(idDoLink(`${APP}?tab=proposals`)).toBe(CLIENTE);
    expect(idDoLink(`  https://outro.example.org/#/clients/${CLIENTE.toUpperCase()}  `)).toBe(CLIENTE);
    expect(idDoLink(CLIENTE)).toBe(CLIENTE);
  });

  it("recusa o resto: sem o #/clients/, com lixo depois, com espaço, outro tipo", () => {
    for (const ruim of [
      "",
      "https://app.example.com/",
      `https://app.example.com/clients/${CLIENTE}`,
      `${APP}/extra`,
      `${APP} ?tab=x`,
      `javascript:alert(1)#/clients/${CLIENTE} x`,
      `${CLIENTE}0`,
      "1b4e28ba-2fa1-11d2-883f",
      null,
      42,
    ]) {
      expect(idDoLink(ruim), String(ruim)).toBeNull();
    }
  });
});

describe("ligarVinculo", () => {
  it("liga como MANUAL, com o que o Atlas respondeu (nunca o texto colado), e apaga a recusa do par", async () => {
    banco.tabelas.cb_atlas_recusas = [
      { id: "r1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: CLIENTE },
      { id: "r-outra", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: OUTRO },
    ];
    expect(await ligar(`https://colado.example.net/#/clients/${CLIENTE}?tab=history`)).toEqual({ ok: true, jaEstava: false });
    expect(lidos).toEqual([CLIENTE]);
    expect(banco.tabelas.cb_atlas_clientes).toEqual([
      expect.objectContaining({
        account_id: CONTA,
        api_url: null,
        contact_id: FICHA,
        atlas_client_id: CLIENTE,
        atlas_tenant_id: "t1",
        origem: "manual",
        casou_por: null,
        vinculado_por: USUARIO,
        situacao: "rescindido",
        situacao_desde: "2026-08-12T13:00:00.000Z",
        app_url: APP,
        excluido_no_atlas_em: null,
        situacao_lida_em: expect.any(String),
      }),
    ]);
    expect(banco.tabelas.cb_atlas_recusas.map((r) => r.id)).toEqual(["r-outra"]);
  });

  it("app_url que não é https ou não traz o id NÃO é gravado", async () => {
    noAtlas.set(CLIENTE, { id: CLIENTE, status: "ativo", appUrl: "javascript:alert(1)" });
    await ligar();
    expect(banco.tabelas.cb_atlas_clientes[0].app_url).toBeNull();
  });

  it("link inválido: 400 sem ler nada nem chamar o Atlas", async () => {
    expect(await ligar("não é link")).toEqual({ ok: false, codigo: "link_invalido" });
    expect(lidos).toEqual([]);
  });

  it("ficha de outra conta: não encontrada, sem chamar o Atlas", async () => {
    banco.tabelas.contacts = [{ id: FICHA, account_id: "conta-2" }];
    expect(await ligar()).toEqual({ ok: false, codigo: "contato_nao_encontrado" });
    expect(lidos).toEqual([]);
  });

  it("sem conexão, ou conexão de outro ambiente: o código da conexão, sem chamar o Atlas", async () => {
    banco.tabelas.cb_atlas_config = [];
    expect(await ligar()).toEqual({ ok: false, codigo: "nao_conectado" });
    banco.tabelas.cb_atlas_config = [{ account_id: CONTA, api_url: null, api_key: `cifrado:${CHAVE}`, atlas_tenant_id: "t1" }];
    expect(await ligar(APP, STAGING)).toEqual({ ok: false, codigo: "outro_ambiente" });
    expect(lidos).toEqual([]);
  });

  it("a ficha JÁ ligada ao mesmo cliente: idempotente (200), sem gastar a cota do Atlas", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: CLIENTE, atlas_tenant_id: "t1", origem: "automatica" }];
    expect(await ligar()).toEqual({ ok: true, jaEstava: true });
    expect(lidos).toEqual([]);
    expect(banco.tabelas.cb_atlas_clientes[0].origem).toBe("automatica");
  });

  it("a ficha ligada a OUTRO cliente: ja_vinculado (desvincule antes)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: OUTRO, atlas_tenant_id: "t1", origem: "manual" }];
    expect(await ligar()).toEqual({ ok: false, codigo: "ja_vinculado" });
    expect(lidos).toEqual([]);
  });

  it("a ficha ligada a um cliente do escritório ANTERIOR (invisível na tela): outro_escritorio", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: OUTRO, atlas_tenant_id: "t-antigo", origem: "criada" }];
    expect(await ligar()).toEqual({ ok: false, codigo: "outro_escritorio" });
  });

  it("o cliente já ligado a OUTRA ficha: ligado_a_outra_ficha, nada muda", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v2", account_id: CONTA, api_url: null, contact_id: "ficha-2", atlas_client_id: CLIENTE, atlas_tenant_id: "t1", origem: "criada" }];
    expect(await ligar()).toEqual({ ok: false, codigo: "ligado_a_outra_ficha" });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
    expect(banco.tabelas.cb_atlas_clientes[0].contact_id).toBe("ficha-2");
  });

  it("a linha ÓRFÃ do cliente (a ficha antiga foi apagada) é ADOTADA como manual", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "orfa", account_id: CONTA, api_url: null, contact_id: null, atlas_client_id: CLIENTE, atlas_tenant_id: "t1", origem: "criada", crm_escreveu_em: "2026-07-01T00:00:00.000Z" }];
    expect(await ligar()).toEqual({ ok: true, jaEstava: false });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([
      expect.objectContaining({ id: "orfa", contact_id: FICHA, origem: "manual", vinculado_por: USUARIO, situacao: "rescindido", crm_escreveu_em: "2026-07-01T00:00:00.000Z" }),
    ]);
  });

  it("⚠️ AMBIENTE: o vínculo do staging não conflita com o da produção, e a linha nova grava o ambiente", async () => {
    banco.tabelas.cb_atlas_config[0].api_url = STAGING;
    banco.tabelas.cb_atlas_clientes = [{ id: "v-prod", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: OUTRO, atlas_tenant_id: "t1", origem: "criada" }];
    expect(await ligar(APP, STAGING)).toEqual({ ok: true, jaEstava: false });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([
      expect.objectContaining({ id: "v-prod", api_url: null, atlas_client_id: OUTRO }),
      expect.objectContaining({ api_url: STAGING, atlas_client_id: CLIENTE, contact_id: FICHA, origem: "manual" }),
    ]);
  });

  it("o Atlas não acha (inexistente, de outro escritório ou na lixeira): nao_encontrado, nada gravado", async () => {
    noAtlas.clear();
    expect(await ligar()).toEqual({ ok: false, codigo: "nao_encontrado" });
    expect(banco.tabelas.cb_atlas_clientes ?? []).toHaveLength(0);
  });

  it("⚠️ sem a permissão Consultar (obrigatória): marca a conexão em erro; limite e queda não marcam", async () => {
    falha = new AtlasError("sem_permissao", "get_client → 403", 403, "read_client");
    expect(await ligar()).toEqual({ ok: false, codigo: "sem_permissao" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "sem_permissao" });

    banco.tabelas.cb_atlas_config[0] = { ...banco.tabelas.cb_atlas_config[0], status: "conectado", last_error: null };
    falha = new AtlasError("limite", "get_client → 429", 429);
    expect(await ligar()).toEqual({ ok: false, codigo: "limite" });
    falha = new AtlasError("fora_do_ar", "get_client → 503", 503);
    expect(await ligar()).toEqual({ ok: false, codigo: "indisponivel" });
    falha = new AtlasError("rede", "get_client → timeout");
    expect(await ligar()).toEqual({ ok: false, codigo: "indisponivel" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado", last_error: null });
    expect(banco.tabelas.cb_atlas_clientes ?? []).toHaveLength(0);
  });

  it("23505 na escrita (a leitura ligou o MESMO par um instante antes): relê e responde 200", async () => {
    const original = banco.cliente.from.bind(banco.cliente);
    let primeira = true;
    (banco.cliente as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t === "cb_atlas_clientes" && primeira) {
        const insert = q.insert;
        q.insert = (v: unknown) => {
          primeira = false;
          banco.tabelas.cb_atlas_clientes.push({ id: "auto", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: CLIENTE, atlas_tenant_id: "t1", origem: "automatica" });
          return insert(v);
        };
      }
      return q;
    };
    expect(await ligar()).toEqual({ ok: true, jaEstava: true });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ id: "auto", origem: "automatica" })]);
  });

  it("erro de banco é db_error, nunca 'não encontrado'", async () => {
    banco.falhar.add("cb_atlas_clientes:select");
    expect(await ligar()).toEqual({ ok: false, codigo: "db_error" });
    expect(lidos).toEqual([]);
  });
});

describe("ligarVinculo no vínculo marcado NA LIXEIRA (o \"Conferir no Atlas\" da aba)", () => {
  const naLixeira = () => ({
    id: "v1",
    account_id: CONTA,
    api_url: null,
    contact_id: FICHA,
    atlas_client_id: CLIENTE,
    atlas_tenant_id: "t1",
    origem: "automatica",
    situacao: "ativo",
    situacao_desde: null,
    excluido_no_atlas_em: "2026-09-29T03:10:00.000Z",
  });

  it("⚠️ restaurado no Atlas: relê o cliente e tira SÓ a marca (a situação fica para a leitura, que decide o evento)", async () => {
    banco.tabelas.cb_atlas_clientes = [naLixeira()];
    expect(await ligar(CLIENTE)).toEqual({ ok: true, jaEstava: true });
    expect(lidos).toEqual([CLIENTE]);
    expect(banco.tabelas.cb_atlas_clientes).toEqual([
      expect.objectContaining({ id: "v1", excluido_no_atlas_em: null, origem: "automatica", situacao: "ativo", situacao_desde: null }),
    ]);
  });

  it("ainda na lixeira (o not_found do Atlas): ainda_na_lixeira, a marca FICA como estava", async () => {
    banco.tabelas.cb_atlas_clientes = [naLixeira()];
    noAtlas.clear();
    expect(await ligar(CLIENTE)).toEqual({ ok: false, codigo: "ainda_na_lixeira" });
    expect(banco.tabelas.cb_atlas_clientes[0].excluido_no_atlas_em).toBe("2026-09-29T03:10:00.000Z");
  });

  it("falha do Atlas: o código dele, a marca fica", async () => {
    banco.tabelas.cb_atlas_clientes = [naLixeira()];
    falha = new AtlasError("limite", "get_client → 429", 429);
    expect(await ligar(CLIENTE)).toEqual({ ok: false, codigo: "limite" });
    expect(banco.tabelas.cb_atlas_clientes[0].excluido_no_atlas_em).not.toBeNull();
  });

  it("desvinculado enquanto o Atlas respondia: sem_vinculo (nada volta a existir)", async () => {
    banco.tabelas.cb_atlas_clientes = [naLixeira()];
    const original = banco.cliente.from.bind(banco.cliente);
    (banco.cliente as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = original(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t === "cb_atlas_clientes") {
        const update = q.update;
        q.update = (v: unknown) => {
          banco.tabelas.cb_atlas_clientes = [];
          return update(v);
        };
      }
      return q;
    };
    expect(await ligar(CLIENTE)).toEqual({ ok: false, codigo: "sem_vinculo" });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([]);
  });
});

describe("desligarVinculo", () => {
  beforeEach(() => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: CLIENTE, atlas_tenant_id: "t1", origem: "automatica" }];
  });

  it("apaga o vínculo e grava a RECUSA do par (a leitura e o passo não religam)", async () => {
    expect(await desligar()).toEqual({ ok: true, jaEstava: false });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([]);
    expect(banco.tabelas.cb_atlas_recusas).toEqual([
      expect.objectContaining({ account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: CLIENTE, recusado_por: USUARIO }),
    ]);
  });

  it("a recusa que já existia (23505) não impede", async () => {
    banco.tabelas.cb_atlas_recusas = [{ id: "r1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: CLIENTE }];
    expect(await desligar()).toEqual({ ok: true, jaEstava: false });
    expect(banco.tabelas.cb_atlas_recusas).toHaveLength(1);
    expect(banco.tabelas.cb_atlas_clientes).toEqual([]);
  });

  it("⚠️ a recusa vem ANTES: se ela falha, o vínculo FICA (nunca sem vínculo e sem recusa)", async () => {
    banco.falhar.add("cb_atlas_recusas:insert");
    expect(await desligar()).toEqual({ ok: false, codigo: "db_error" });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
  });

  it("sem vínculo (ou só de outro escritório, invisível): sem_vinculo", async () => {
    banco.tabelas.cb_atlas_clientes[0].atlas_tenant_id = "t-antigo";
    expect(await desligar()).toEqual({ ok: false, codigo: "sem_vinculo" });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
    expect(banco.tabelas.cb_atlas_recusas ?? []).toHaveLength(0);
  });

  it("⚠️ AMBIENTE: a instância do staging não desliga o vínculo da produção", async () => {
    banco.tabelas.cb_atlas_config[0].api_url = STAGING;
    expect(await desligar(STAGING)).toEqual({ ok: false, codigo: "sem_vinculo" });
    expect(await desligar(null)).toEqual({ ok: false, codigo: "nao_conectado" });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
  });
});
