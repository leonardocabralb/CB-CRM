import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("cifrado:")) throw new Error("ilegível");
    return s.slice("cifrado:".length);
  },
}));

import { criarBanco, type Banco } from "../zapsign/duble.test-helper";

import { AtlasError, lerPaginaDaListagem, type ClienteAtlas, type ClienteDoAtlas, type CriteriosDeBusca, type FiltroDaListagem, type PaginaDaListagem } from "./cliente";
import { PAGINAS_POR_CICLO, RECOLHER_LEITURA_MS } from "./leitura";
import { rodarCicloDoAtlas, sincronizarSituacoes, type OpcoesDaLeitura } from "./situacoes";

// ============================================================
// A leitura periódica das situações do Atlas (Fase 2): cadeado com cerca de
// posse, os dois passos com cursor próprio, o vínculo automático, a lixeira,
// os erros por código e o AMBIENTE em toda linha. Dados fictícios; o banco é
// o dublê em memória (a forma SUPOSTA do PostgREST — os filtros novos se
// medem contra o real).
// ============================================================

const CHAVE = "sk_teste_0000000000000000000000000000";
const CONTA = "conta-1";
const TENANT = "t1";
const STAGING = "https://staging.example.com/functions/v1/client-webhook";
const AGORA = new Date("2026-09-30T15:00:00.000Z");

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CONV_1 = uuid(901);
const CONV_3 = uuid(903);

/** Um cliente como o `list_clients` o devolve (com dado pessoal fictício que NÃO pode ir ao banco). */
function bruto(id: string, p: Record<string, unknown> = {}) {
  return {
    id,
    name: `Cliente ${id}`,
    doc_id: "00000000000",
    email: `${id}@example.com`,
    phone: null,
    status: "ativo",
    chat_link: null,
    status_changed_at: "2026-06-01T12:00:00+00:00",
    app_url: `https://app.example.com/#/clients/${id}`,
    ...p,
  };
}
const pagina = (clientes: unknown[], nextCursor: string | null = null): PaginaDaListagem =>
  lerPaginaDaListagem({ success: true, clients: clientes, hasMore: nextCursor !== null, nextCursor });

let banco: Banco;
let pedidos: FiltroDaListagem[];
let lidos: string[];
let listar: (f: FiltroDaListagem, n: number) => PaginaDaListagem | Promise<PaginaDaListagem>;
let ler: (id: string) => ClienteDoAtlas | null;
let buscas: CriteriosDeBusca[];
let buscar: (c: CriteriosDeBusca) => { clientes: ClienteDoAtlas[]; truncado: boolean };
let pausas: number;
/** O `find_clients` que confirma o vínculo pelo link: acha só estes clientes. */
const acha = (...ids: string[]) => () => ({ clientes: ids.map((id) => ({ id, status: "ativo", appUrl: null, casouPor: ["chat_link"] })), truncado: false });

function fabrica(): ClienteAtlas {
  return {
    whoami: async () => {
      throw new Error("não usado");
    },
    buscar: async (c) => {
      buscas.push(c);
      return buscar(c);
    },
    criar: async () => {
      throw new Error("não usado");
    },
    atualizar: async () => {
      throw new Error("não usado");
    },
    listar: async (f) => {
      pedidos.push(f);
      return listar(f, pedidos.length);
    },
    ler: async (id) => {
      lidos.push(id);
      return ler(id);
    },
  };
}

const config = (p: Record<string, unknown> = {}) => ({
  account_id: CONTA,
  api_key: `cifrado:${CHAVE}`,
  api_url: null,
  atlas_tenant_id: TENANT,
  status: "conectado",
  last_error: null,
  sincronizando_desde: null,
  last_sync_attempt_at: null,
  last_sync_at: null,
  situacoes_lidas_ate: null,
  mudancas_desde: null,
  mudancas_cursor: null,
  mudancas_iniciada_em: null,
  listagem_completa_em: null,
  listagem_iniciada_em: null,
  listagem_cursor: null,
  sync_erro: null,
  ...p,
});
const vinculo = (id: string, atlasId: string, p: Record<string, unknown> = {}) => ({
  id,
  account_id: CONTA,
  api_url: null,
  atlas_tenant_id: TENANT,
  atlas_client_id: atlasId,
  contact_id: `ficha-${id}`,
  origem: "criada",
  situacao: "ativo",
  situacao_desde: "2026-06-01T12:00:00.000Z",
  situacao_lida_em: "2026-09-29T12:00:00.000Z",
  app_url: null,
  created_at: "2026-07-01T12:00:00.000Z",
  excluido_no_atlas_em: null,
  visto_na_listagem_em: null,
  ...p,
});
/** Já leu antes: só as mudanças rodam (a listagem de hoje já foi feita). */
const jaLido = { situacoes_lidas_ate: "2026-09-30T14:40:00.000Z", listagem_completa_em: "2026-09-30T07:00:00.000Z", listagem_iniciada_em: "2026-09-30T07:00:00.000Z" };

const rodar = (o: Partial<OpcoesDaLeitura> = {}) =>
  sincronizarSituacoes(banco.cliente, CONTA, { prazoMs: Date.now() + 45_000, cliente: fabrica, ambiente: null, pausa: async () => void pausas++, ...o });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  banco = criarBanco(
    {
      cb_atlas_config: [config()],
      cb_atlas_clientes: [],
      cb_atlas_recusas: [],
      conversations: [
        { id: CONV_1, account_id: CONTA, contact_id: "ficha-link" },
        { id: CONV_3, account_id: CONTA, contact_id: "ficha-recente" },
      ],
      contacts: [
        { id: "ficha-link", account_id: CONTA, telefone_canonico: "5511900000001" },
        { id: "ficha-tel", account_id: CONTA, telefone_canonico: "5511987654321" },
        { id: "ficha-recente", account_id: CONTA, telefone_canonico: null },
        // A ficha do número do escritório (a outra conexão o grava como cliente — CLAUDE.md 8b).
        { id: "ficha-escritorio", account_id: CONTA, telefone_canonico: "5511955556666" },
      ],
      cb_channels: [{ id: "canal-1", account_id: CONTA, display_phone: "+55 11 95555-6666" }],
    },
    { unicos: { cb_atlas_clientes: [{ colunas: ["account_id", "api_url", "atlas_client_id"] }, { colunas: ["account_id", "api_url", "contact_id"], onde: (l) => l.contact_id != null }] } },
  );
  pedidos = [];
  lidos = [];
  buscas = [];
  buscar = () => {
    throw new Error("find_clients não esperado neste teste");
  };
  pausas = 0;
  listar = () => pagina([]);
  ler = () => null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a primeira leitura: a listagem completa", () => {
  it("lê todas as páginas, grava a mudança, liga pelo link e pelo telefone, e abre as mudanças a partir de quando começou", async () => {
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "a-vinc")];
    listar = (_f, n) =>
      n === 1
        ? pagina(
            [
              bruto("a-vinc", { status: "rescindido", status_changed_at: "2026-09-20T10:00:00+00:00" }),
              bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` }),
            ],
            "p2",
          )
        : pagina([
            bruto("a-tel", { phone: "11 98765-4321" }),
            // Mudou há 1 min: nem vínculo agora (o passo "Criar cliente" pode estar gravando o dele).
            bruto("a-recente", { chat_link: `https://crm.example.com/inbox?c=${CONV_3}`, status_changed_at: "2026-09-30T14:59:00+00:00" }),
            // O número do escritório: nunca liga.
            bruto("a-escritorio", { phone: "(11) 95555-6666" }),
          ]);

    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { paginas: 2, clientes: 5, vinculadosPeloLink: 1, vinculadosPeloTelefone: 1, listagemCompleta: true } });

    expect(pedidos).toEqual([
      { cursor: null, limit: 100 },
      { cursor: "p2", limit: 100 },
    ]);
    expect(pausas).toBe(1);

    const inicio = AGORA.toISOString();
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({
      sincronizando_desde: null,
      last_sync_attempt_at: inicio,
      last_sync_at: inicio,
      listagem_iniciada_em: inicio,
      listagem_completa_em: inicio,
      listagem_cursor: null,
      situacoes_lidas_ate: inicio,
      sync_erro: null,
    });

    const porAtlas = Object.fromEntries(banco.tabelas.cb_atlas_clientes.map((v) => [v.atlas_client_id, v]));
    expect(porAtlas["a-vinc"]).toMatchObject({ situacao: "rescindido", situacao_desde: "2026-09-20T10:00:00.000Z", visto_na_listagem_em: inicio, origem: "criada" });
    expect(porAtlas["a-link"]).toMatchObject({
      api_url: null,
      atlas_tenant_id: TENANT,
      contact_id: "ficha-link",
      origem: "automatica",
      casou_por: "chat_link",
      situacao: "ativo",
      situacao_desde: "2026-06-01T12:00:00.000Z",
      app_url: "https://app.example.com/#/clients/a-link",
      visto_na_listagem_em: inicio,
    });
    expect(porAtlas["a-tel"]).toMatchObject({ contact_id: "ficha-tel", origem: "automatica", casou_por: "telefone" });
    expect(porAtlas["a-recente"]).toBeUndefined();
    expect(porAtlas["a-escritorio"]).toBeUndefined();
    expect(banco.tabelas.cb_atlas_clientes.find((v) => v.contact_id === "ficha-escritorio")).toBeUndefined();
    // A listagem inteira no ciclo prova a unicidade sozinha: nenhuma confirmação no Atlas.
    expect(buscas).toHaveLength(0);
    // ⚠️ Nenhum dado pessoal do Atlas chega ao banco.
    const tudo = JSON.stringify(banco.tabelas.cb_atlas_clientes);
    for (const dado of ["Cliente a-", "@example.com", "00000000000", "inbox?c="]) expect(tudo).not.toContain(dado);
  });

  it("a listagem que não cabe no ciclo continua do cursor, e só a que COMEÇA e termina no mesmo ciclo liga pelo telefone", async () => {
    listar = (f) => (f.cursor ? pagina([bruto("a-tel", { phone: "11 98765-4321" })]) : pagina([bruto("a-0")], "p2"));
    // O prazo acaba depois da primeira página.
    const r1 = await rodar({ pausa: async () => void vi.setSystemTime(new Date(Date.now() + 60_000)) });
    expect(r1).toMatchObject({ ok: true, contagem: { paginas: 1, interrompida: true, listagemCompleta: false } });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ listagem_cursor: "p2", listagem_iniciada_em: AGORA.toISOString(), listagem_completa_em: null });

    vi.setSystemTime(new Date(AGORA.getTime() + 15 * 60_000));
    const r2 = await rodar();
    expect(r2).toMatchObject({ ok: true, contagem: { listagemCompleta: true, vinculadosPeloTelefone: 0 } });
    expect(pedidos.at(-1)).toEqual({ cursor: "p2", limit: 100 });
    // Terminada, vale o instante em que ela COMEÇOU (no ciclo anterior).
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ listagem_completa_em: AGORA.toISOString(), situacoes_lidas_ate: AGORA.toISOString() });
  });
});

describe("o cadeado", () => {
  it("preso por um ciclo vivo: em_curso, sem chamar o Atlas; preso há mais que o recolhimento: é tomado", async () => {
    banco.tabelas.cb_atlas_config[0].sincronizando_desde = new Date(AGORA.getTime() - 60_000).toISOString();
    expect(await rodar()).toEqual({ ok: false, codigo: "em_curso" });
    expect(pedidos).toHaveLength(0);
    banco.tabelas.cb_atlas_config[0].sincronizando_desde = new Date(AGORA.getTime() - RECOLHER_LEITURA_MS - 1000).toISOString();
    expect((await rodar()).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_config[0].sincronizando_desde).toBeNull();
  });

  it("CRÍTICO: a cerca de posse — reconectar no meio (zera o cadeado) para o ciclo, e nada mais é gravado", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "a1")];
    listar = () => {
      // A reconexão zera o estado da leitura (P1-1).
      Object.assign(banco.tabelas.cb_atlas_config[0], { sincronizando_desde: null, situacoes_lidas_ate: null });
      return pagina([bruto("a1", { status: "rescindido", status_changed_at: "2026-09-20T10:00:00+00:00" })], "p2");
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "cadeado_perdido" });
    // O cursor da página não foi gravado por cima do estado zerado, nem o fechamento.
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ mudancas_cursor: null, situacoes_lidas_ate: null, last_sync_at: null, sync_erro: null });
    // Nem o vínculo: a página que chegou depois da reconexão não é gravada.
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ situacao: "ativo", situacao_lida_em: "2026-09-29T12:00:00.000Z" });
  });

  it("CRÍTICO: a chave VELHA recusada depois da reconexão não põe a conexão NOVA em erro", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    listar = () => {
      // O admin colou a chave nova (mesmo escritório): o upsert zera a leitura e deixa "conectado".
      Object.assign(banco.tabelas.cb_atlas_config[0], { api_key: "cifrado:sk_nova", sincronizando_desde: null, situacoes_lidas_ate: null });
      throw new AtlasError("chave_invalida", "list_clients → 403", 403);
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "cadeado_perdido" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado", last_error: null, sync_erro: null });
  });

  it("CRÍTICO: a reconexão com OUTRO escritório no meio do vínculo automático: nada é gravado com o escritório antigo", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    listar = () => pagina([bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    buscar = () => {
      // Enquanto a confirmação viaja: "Apagar os N vínculos do escritório anterior e conectar".
      Object.assign(banco.tabelas.cb_atlas_config[0], { atlas_tenant_id: "t2", sincronizando_desde: null, situacoes_lidas_ate: null });
      return acha("a-link")();
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "cadeado_perdido" });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(0);
  });

  it("CRÍTICO: reconexão com OUTRO escritório ENTRE a prova de posse e o INSERT: o vínculo gravado com o escritório velho é desfeito", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    listar = () => pagina([bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    buscar = acha("a-link");
    const de = banco.cliente.from.bind(banco.cliente);
    (banco.cliente as unknown as { from: (t: string) => Record<string, unknown> }).from = (t: string) => {
      const b = de(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (t === "cb_atlas_clientes") {
        const inserir = b.insert;
        b.insert = (v: unknown) => {
          // O admin confirma "Apagar os vínculos do escritório anterior e conectar" bem aqui.
          Object.assign(banco.tabelas.cb_atlas_config[0], { atlas_tenant_id: "t2", sincronizando_desde: null, situacoes_lidas_ate: null });
          return inserir(v);
        };
      }
      return b;
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "cadeado_perdido" });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(0);
  });
});

describe("o passo das mudanças", () => {
  it("statusChangedSince = última leitura − 5 min; terminada, a leitura avança para o início DESTE ciclo", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    expect((await rodar()).ok).toBe(true);
    expect(pedidos).toEqual([{ statusChangedSince: "2026-09-30T14:35:00.000Z", cursor: null, limit: 100 }]);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ situacoes_lidas_ate: AGORA.toISOString(), mudancas_desde: null, mudancas_cursor: null });
  });

  it("CRÍTICO (P1-2): mudança em massa maior que o teto de páginas continua do cursor PRÓPRIO, sem reler as mesmas páginas", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    listar = (_f, n) => pagina([bruto(`a${n}`)], `c${n}`);
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { paginas: PAGINAS_POR_CICLO, interrompida: true, mudancasCompletas: false } });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({
      situacoes_lidas_ate: jaLido.situacoes_lidas_ate,
      mudancas_desde: "2026-09-30T14:35:00.000Z",
      mudancas_cursor: `c${PAGINAS_POR_CICLO}`,
      mudancas_iniciada_em: AGORA.toISOString(),
    });

    // O ciclo seguinte retoma do cursor, com o MESMO statusChangedSince.
    vi.setSystemTime(new Date(AGORA.getTime() + 15 * 60_000));
    pedidos = [];
    listar = () => pagina([]);
    expect((await rodar()).ok).toBe(true);
    expect(pedidos).toEqual([{ statusChangedSince: "2026-09-30T14:35:00.000Z", cursor: `c${PAGINAS_POR_CICLO}`, limit: 100 }]);
    // Terminada, a leitura vale até quando a VARREDURA começou (o ciclo anterior).
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({
      situacoes_lidas_ate: AGORA.toISOString(),
      mudancas_desde: null,
      mudancas_cursor: null,
      mudancas_iniciada_em: null,
    });
  });

  it("CRÍTICO: o cliente pulado por ser RECENTE numa varredura de vários ciclos é relido na seguinte", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "a1")];
    const rescindido = bruto("a1", { status: "rescindido", status_changed_at: "2026-09-30T14:59:00+00:00" });
    // Ciclo 1 (15:00): a1 mudou há 1 min, e a mudança em massa não cabe no ciclo.
    listar = (_f, n) => (n === 1 ? pagina([rescindido], "c1") : pagina([bruto(`f${n}`)], `c${n}`));
    expect(await rodar()).toMatchObject({ ok: true, contagem: { porTipo: { recente: 1 }, mudancasCompletas: false } });
    // Ciclo 2 (15:15): a varredura termina.
    vi.setSystemTime(new Date(AGORA.getTime() + 15 * 60_000));
    listar = () => pagina([]);
    expect(await rodar()).toMatchObject({ ok: true, contagem: { mudancasCompletas: true } });
    // Ciclo 3 (15:30): a nova varredura recua a partir do início da anterior e acha a1.
    vi.setSystemTime(new Date(AGORA.getTime() + 30 * 60_000));
    pedidos = [];
    listar = (f) => pagina(Date.parse(f.statusChangedSince!) <= Date.parse("2026-09-30T14:59:00.000Z") ? [rescindido] : []);
    expect((await rodar()).ok).toBe(true);
    expect(pedidos[0]).toMatchObject({ statusChangedSince: "2026-09-30T14:55:00.000Z" });
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ situacao: "rescindido" });
  });

  it("o cliente repetido pelo cursor é decidido uma vez só", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "a1")];
    listar = (_f, n) =>
      n === 1 ? pagina([bruto("a1", { status: "rescindido", status_changed_at: "2026-09-20T10:00:00+00:00" })], "p2") : pagina([bruto("a1", { status: "rescindido", status_changed_at: "2026-09-20T10:00:00+00:00" })]);
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { clientes: 1, gravados: 1 } });
  });

  it("CRÍTICO: a cerca de recência — o que o passo 'Criar cliente' gravou depois de a página ser pedida não é desfeito", async () => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "a1", { situacao: "rescindido" })];
    listar = () => {
      const p = pagina([bruto("a1", { status: "rescindido", status_changed_at: "2026-09-25T10:00:00+00:00" })]);
      // O passo reativa e grava ENQUANTO a página viaja.
      Object.assign(banco.tabelas.cb_atlas_clientes[0], { situacao: "ativo", situacao_lida_em: new Date(AGORA.getTime() + 1000).toISOString() });
      return p;
    };
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { superados: 1, gravados: 0 } });
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ situacao: "ativo" });
  });
});

describe("os erros: o cursor nunca avança, e cada um grava o seu", () => {
  beforeEach(() => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
  });

  it("429 (limite): para a conta sem avançar e SEM marcar a conexão", async () => {
    listar = () => {
      throw new AtlasError("limite", "list_clients → 429", 429);
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "limite" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({
      situacoes_lidas_ate: jaLido.situacoes_lidas_ate,
      mudancas_cursor: null,
      sync_erro: "limite",
      sincronizando_desde: null,
      last_sync_at: null,
      status: "conectado",
      last_error: null,
    });
  });

  it("'Listar clientes' desligada: sem_permissao_listar, e NUNCA marca a conexão (a permissão é opcional)", async () => {
    listar = () => {
      throw new AtlasError("sem_permissao", "403", 403, "list_clients");
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "sem_permissao_listar" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ sync_erro: "sem_permissao_listar", status: "conectado", last_error: null });
  });

  it("chave recusada e plano sem API marcam a conexão", async () => {
    listar = () => {
      throw new AtlasError("chave_invalida", "403", 403);
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "chave_invalida" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ sync_erro: "chave_invalida", status: "erro", last_error: "chave_invalida" });
  });

  it("CRÍTICO: API ANTIGA (sem status_changed_at): api_antiga, sem gravar NADA da página", async () => {
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "a1")];
    const antigo = bruto("a1", { status: "rescindido" });
    delete (antigo as Record<string, unknown>).status_changed_at;
    listar = () => pagina([bruto("a0", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` }), antigo]);
    expect(await rodar()).toMatchObject({ ok: false, codigo: "api_antiga" });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ id: "v1", situacao: "ativo" })]);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ sync_erro: "api_antiga", situacoes_lidas_ate: jaLido.situacoes_lidas_ate });
  });

  it("fora do ar no meio: o cursor das páginas já lidas fica, e o vínculo automático espera um ciclo sem falha", async () => {
    listar = (_f, n) => {
      if (n === 1) return pagina([bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })], "p2");
      throw new AtlasError("fora_do_ar", "503", 503);
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "fora_do_ar", contagem: { vinculadosPeloLink: 0 } });
    expect(buscas).toHaveLength(0);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ mudancas_cursor: "p2", sync_erro: "fora_do_ar" });
  });

  it("sucesso limpa o erro da CHAVE (nunca o sem_permissao) e o erro da leitura", async () => {
    Object.assign(banco.tabelas.cb_atlas_config[0], { status: "erro", last_error: "chave_invalida", sync_erro: "chave_invalida" });
    expect((await rodar()).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "conectado", last_error: null, sync_erro: null });
    Object.assign(banco.tabelas.cb_atlas_config[0], { status: "erro", last_error: "sem_permissao" });
    expect((await rodar()).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "sem_permissao" });
  });

  it("o prazo é o do relógio REAL: vencido, nenhuma chamada — e a leitura não se afirma feita nem apaga o erro anterior", async () => {
    Object.assign(banco.tabelas.cb_atlas_config[0], { sync_erro: "limite" });
    const r = await rodar({ prazoMs: Date.now() - 1 });
    expect(r).toMatchObject({ ok: true, contagem: { paginas: 0, interrompida: true } });
    expect(pedidos).toHaveLength(0);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ last_sync_at: null, sync_erro: "limite", sincronizando_desde: null });
  });
});

describe("o vínculo automático", () => {
  beforeEach(() => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
  });

  it("ficha já ligada (neste ambiente) e par recusado por gente não religam", async () => {
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "outro-cliente", { contact_id: "ficha-link" })];
    banco.tabelas.conversations.push({ id: uuid(904), account_id: CONTA, contact_id: "ficha-recusada" });
    banco.tabelas.cb_atlas_recusas = [{ id: "r1", account_id: CONTA, api_url: null, contact_id: "ficha-recusada", atlas_client_id: "a-recusado" }];
    listar = () =>
      pagina([
        bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` }),
        bruto("a-recusado", { chat_link: `https://crm.example.com/inbox?c=${uuid(904)}` }),
      ]);
    expect(await rodar()).toMatchObject({ ok: true, contagem: { vinculadosPeloLink: 0 } });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
  });

  it("dois clientes do Atlas apontando para a MESMA ficha: nenhum liga (ambíguo)", async () => {
    listar = () =>
      pagina([bruto("a1", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` }), bruto("a2", { chat_link: `https://x.example.com/?c=${CONV_1}` })]);
    expect(await rodar()).toMatchObject({ ok: true, contagem: { vinculadosPeloLink: 0, ambiguos: 2 } });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(0);
  });

  it("CRÍTICO: fora da listagem inteira, o par do link só liga com a confirmação do Atlas (o ex-cliente com dois cadastros)", async () => {
    // Só o cadastro VELHO mudou: a página das mudanças o traz sozinho.
    listar = () => pagina([bruto("a-velho", { status: "inativo", status_changed_at: "2026-09-30T14:50:00+00:00", chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    buscar = acha("a-velho", "a-novo");
    expect(await rodar()).toMatchObject({ ok: true, contagem: { vinculadosPeloLink: 0, ambiguos: 1 } });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(0);
    // A busca é pela ficha e pelas conversas dela (o Atlas casa qualquer link que as contenha).
    expect(buscas).toEqual([{ chatLinkIds: ["ficha-link", CONV_1] }]);

    // Só ele no escritório: liga.
    vi.setSystemTime(new Date(AGORA.getTime() + 15 * 60_000));
    buscar = acha("a-velho");
    expect(await rodar()).toMatchObject({ ok: true, contagem: { vinculadosPeloLink: 1 } });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ atlas_client_id: "a-velho", contact_id: "ficha-link", origem: "automatica", casou_por: "chat_link" })]);
  });

  it("a ficha com conversas demais para uma busca (o Atlas aceita 10 ids) não liga fora da listagem inteira", async () => {
    for (let i = 0; i < 9; i++) banco.tabelas.conversations.push({ id: uuid(950 + i), account_id: CONTA, contact_id: "ficha-link" });
    listar = () => pagina([bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    expect(await rodar()).toMatchObject({ ok: true, contagem: { vinculadosPeloLink: 0 } });
    expect(buscas).toHaveLength(0);
  });

  it("'Consultar clientes' desligada na confirmação: marca a conexão (a permissão é obrigatória)", async () => {
    listar = () => pagina([bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    buscar = () => {
      throw new AtlasError("sem_permissao", "403", 403, "read_client");
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "sem_permissao" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "sem_permissao", sync_erro: "sem_permissao" });
  });

  it("na listagem inteira, o cliente RECENTE com o mesmo link também disputa a ficha", async () => {
    banco.tabelas.cb_atlas_config[0] = config();
    listar = () =>
      pagina([
        bruto("a-velho", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` }),
        bruto("a-novo", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}`, status_changed_at: "2026-09-30T14:59:30+00:00" }),
      ]);
    expect(await rodar()).toMatchObject({ ok: true, contagem: { listagemCompleta: true, vinculadosPeloLink: 0, ambiguos: 2 } });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(0);
  });

  it("23505 (outro processo ligou antes) conta como conflito e segue", async () => {
    // O mesmo cliente do Atlas já está numa linha ÓRFÃ deste ambiente (a ficha foi apagada) de OUTRO escritório — invisível à leitura.
    banco.tabelas.cb_atlas_clientes = [vinculo("orfa", "a-link", { contact_id: null, atlas_tenant_id: "t-antigo" })];
    listar = () => pagina([bruto("a-link", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    buscar = acha("a-link");
    expect(await rodar()).toMatchObject({ ok: true, contagem: { conflitos: 1, vinculadosPeloLink: 0 } });
  });

  it("sem os números das conexões, o vínculo pelo telefone não roda neste ciclo", async () => {
    banco.tabelas.cb_atlas_config[0] = config();
    banco.falhar.add("cb_channels:select");
    listar = () => pagina([bruto("a-tel", { phone: "11 98765-4321" })]);
    expect(await rodar()).toMatchObject({ ok: true, contagem: { vinculadosPeloTelefone: 0, listagemCompleta: true } });
  });

  it("telefone de dois cadastros no Atlas não liga nenhum", async () => {
    banco.tabelas.cb_atlas_config[0] = config();
    listar = () => pagina([bruto("a1", { phone: "11 98765-4321" }), bruto("a2", { phone: "+55 (11) 98765-4321" })]);
    expect(await rodar()).toMatchObject({ ok: true, contagem: { vinculadosPeloTelefone: 0 } });
  });
});

describe("a lixeira (depois de uma listagem completa)", () => {
  beforeEach(() => {
    banco.tabelas.cb_atlas_config[0] = config(jaLido);
  });

  it("o não visto é relido: not_found MARCA (nunca apaga); o que existe é gravado e dado por visto; o visto nem é relido", async () => {
    banco.tabelas.cb_atlas_clientes = [
      vinculo("sumido", "a-sumido"),
      vinculo("existe", "a-existe"),
      vinculo("visto", "a-visto", { visto_na_listagem_em: jaLido.listagem_completa_em }),
      vinculo("novo", "a-novo", { created_at: "2026-09-30T08:00:00.000Z" }),
    ];
    ler = (id) => (id === "a-existe" ? { id, status: "finalizado", appUrl: null, situacaoDesde: "2026-09-10T00:00:00.000Z" } : null);
    const r = await rodar();
    expect(r).toMatchObject({ ok: true, contagem: { conferidosNaLixeira: 2, naLixeira: 1 } });
    expect(lidos.sort()).toEqual(["a-existe", "a-sumido"]);
    const por = Object.fromEntries(banco.tabelas.cb_atlas_clientes.map((v) => [v.id, v]));
    expect(por.sumido).toMatchObject({ excluido_no_atlas_em: AGORA.toISOString(), contact_id: "ficha-sumido" });
    expect(por.existe).toMatchObject({ situacao: "finalizado", excluido_no_atlas_em: null, visto_na_listagem_em: jaLido.listagem_completa_em });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(4);
  });

  it("o cliente restaurado que volta na página sai da lixeira", async () => {
    banco.tabelas.cb_atlas_clientes = [vinculo("v1", "a1", { excluido_no_atlas_em: "2026-09-29T00:00:00.000Z", visto_na_listagem_em: jaLido.listagem_completa_em })];
    listar = () => pagina([bruto("a1")]);
    expect((await rodar()).ok).toBe(true);
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ excluido_no_atlas_em: null });
  });

  it("'Consultar clientes' desligada na conferência: essa permissão é OBRIGATÓRIA — marca a conexão", async () => {
    banco.tabelas.cb_atlas_clientes = [vinculo("sumido", "a-sumido")];
    ler = () => {
      throw new AtlasError("sem_permissao", "403", 403, "read_client");
    };
    expect(await rodar()).toMatchObject({ ok: false, codigo: "sem_permissao" });
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "sem_permissao", sync_erro: "sem_permissao" });
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ excluido_no_atlas_em: null });
  });
});

describe("AMBIENTE: a leitura do staging (preview) nunca toca a produção", () => {
  it("CRÍTICO: a instância de teste lê só a conexão, os vínculos e as recusas DELA", async () => {
    banco.tabelas.cb_atlas_config[0] = config({ ...jaLido, api_url: STAGING });
    // O mesmo cliente (ids copiados no staging) ligado a uma ficha REAL na produção.
    banco.tabelas.cb_atlas_clientes = [vinculo("prod", "a1", { api_url: null, contact_id: "ficha-real" })];
    // A recusa da PRODUÇÃO para o mesmo par não vale no staging.
    banco.tabelas.cb_atlas_recusas = [{ id: "r-prod", account_id: CONTA, api_url: null, contact_id: "ficha-link", atlas_client_id: "a1" }];
    listar = () => pagina([bruto("a1", { status: "rescindido", status_changed_at: "2026-09-20T10:00:00+00:00", chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    buscar = acha("a1");
    expect((await rodar({ ambiente: STAGING })).ok).toBe(true);
    const [prod, teste] = banco.tabelas.cb_atlas_clientes;
    expect(prod).toMatchObject({ id: "prod", api_url: null, situacao: "ativo", contact_id: "ficha-real" });
    expect(teste).toMatchObject({ api_url: STAGING, atlas_client_id: "a1", contact_id: "ficha-link", origem: "automatica" });
  });

  it("a recusa do PRÓPRIO ambiente barra o vínculo", async () => {
    banco.tabelas.cb_atlas_config[0] = config({ ...jaLido, api_url: STAGING });
    banco.tabelas.cb_atlas_recusas = [{ id: "r-teste", account_id: CONTA, api_url: STAGING, contact_id: "ficha-link", atlas_client_id: "a1" }];
    listar = () => pagina([bruto("a1", { chat_link: `https://crm.example.com/inbox?c=${CONV_1}` })]);
    buscar = acha("a1");
    expect(await rodar({ ambiente: STAGING })).toMatchObject({ ok: true, contagem: { vinculadosPeloLink: 0 } });
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(0);
  });

  it("a conexão de OUTRO ambiente: sai calado, sem chamar o Atlas nem escrever", async () => {
    banco.tabelas.cb_atlas_config[0] = config({ api_url: STAGING });
    expect(await rodar({ ambiente: null })).toEqual({ ok: false, codigo: "nao_conectado" });
    expect(pedidos).toHaveLength(0);
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ sincronizando_desde: null, last_sync_attempt_at: null });
  });

  it("chave que não decifra: a leitura para SEM escrever (antes do cadeado não há cerca contra a reconexão)", async () => {
    banco.tabelas.cb_atlas_config[0] = config({ api_key: "estragada" });
    const antes = { ...banco.tabelas.cb_atlas_config[0] };
    expect(await rodar()).toEqual({ ok: false, codigo: "chave_ilegivel" });
    expect(pedidos).toHaveLength(0);
    expect(banco.tabelas.cb_atlas_config[0]).toEqual(antes);
  });
});

describe("rodarCicloDoAtlas", () => {
  it("roda as contas DESTE ambiente e nunca lança", async () => {
    banco.tabelas.cb_atlas_config = [config(jaLido), config({ ...jaLido, account_id: "conta-staging", api_url: STAGING })];
    await rodarCicloDoAtlas({ admin: banco.cliente, cliente: fabrica, pausa: async () => {} });
    expect(pedidos).toHaveLength(1);
    expect(banco.tabelas.cb_atlas_config[1]).toMatchObject({ last_sync_attempt_at: null });

    const quebrado = { from: () => { throw new Error("banco fora"); } } as unknown as Banco["cliente"];
    await expect(rodarCicloDoAtlas({ admin: quebrado })).resolves.toBeUndefined();
  });
});
