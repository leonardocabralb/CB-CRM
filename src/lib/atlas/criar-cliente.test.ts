import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (s: string) => `cifrado:${s}`,
  decrypt: (s: string) => {
    if (!s.startsWith("cifrado:")) throw new Error("ilegível");
    return s.slice("cifrado:".length);
  },
}));

import { criarBanco, type Banco } from "../zapsign/duble.test-helper";

import { AtlasError, type ClienteAtlas, type ClienteDoAtlas, type CriteriosDeBusca, type DadosDoClienteNoAtlas } from "./cliente";
import { criarOuReativarNoAtlas, detalheDoResultado, type EntradaDoPassoAtlas } from "./criar-cliente";

// ============================================================
// O passo "Criar cliente no Atlas": procura, e cria, REATIVA (D3) ou só
// vincula; nunca duplica, nunca escreve por cima de quem está em curso, e o
// motivo da falha não carrega nada da resposta do Atlas. Dados fictícios.
// ============================================================

const CHAVE = "sk_teste_0000000000000000000000000000";
const CONTA = "conta-1";
const FICHA = "ficha-1";

let banco: Banco;
let noAtlas: Map<string, ClienteDoAtlas>;
let achados: { clientes: ClienteDoAtlas[]; truncado: boolean };
let falha: AtlasError | null;
let chamadas: { metodo: string; args: unknown[] }[];

function fabrica(): ClienteAtlas {
  const registrar = (metodo: string, ...args: unknown[]) => {
    chamadas.push({ metodo, args });
    if (falha) throw falha;
  };
  return {
    whoami: async () => {
      throw new Error("não usado");
    },
    listar: async () => {
      throw new Error("não usado");
    },
    buscar: async (c: CriteriosDeBusca) => (registrar("buscar", c), achados),
    ler: async (id: string) => (registrar("ler", id), noAtlas.get(id) ?? null),
    criar: async (d: DadosDoClienteNoAtlas, idem: string) => (registrar("criar", d, idem), { id: "novo-1", status: "ativo", appUrl: "https://app.example.com/#/clients/novo-1" }),
    atualizar: async (id: string, d: DadosDoClienteNoAtlas, idem: string) => (registrar("atualizar", id, d, idem), { id, status: "ativo", appUrl: null }),
  };
}

function entrada(parcial: Partial<EntradaDoPassoAtlas> = {}): EntradaDoPassoAtlas {
  return {
    accountId: CONTA,
    contactId: FICHA,
    chaveDeIdempotencia: "log-1:passo-1",
    contato: { nome: "Cliente Exemplo", telefone: "5511987654321", email: "cliente@example.com" },
    negocio: { valor: 5000, criadoEm: "2026-05-10T15:00:00.000Z" },
    datas: { primeiroContato: null, proposta: null, fechamento: null },
    linkDaConversa: "https://crm.example.com/inbox?c=conv-1",
    conversaDaExecucao: "conv-1",
    tipoDeContrato: "fixo",
    agora: new Date("2026-09-29T15:00:00.000Z"),
    ...parcial,
  };
}

const rodar = (e: EntradaDoPassoAtlas = entrada()) => criarOuReativarNoAtlas(banco.cliente, e, { cliente: fabrica });

beforeEach(() => {
  banco = criarBanco({
    cb_atlas_config: [{ account_id: CONTA, api_key: `cifrado:${CHAVE}`, atlas_tenant_id: "t1", status: "conectado", last_error: null }],
    conversations: [
      { id: "conv-1", account_id: CONTA, contact_id: FICHA },
      { id: "conv-2", account_id: CONTA, contact_id: FICHA },
      { id: "conv-de-outro", account_id: CONTA, contact_id: "ficha-2" },
    ],
  });
  noAtlas = new Map();
  achados = { clientes: [], truncado: false };
  falha = null;
  chamadas = [];
});

describe("criarOuReativarNoAtlas", () => {
  it("sem conexão: falha com motivo, sem chamar o Atlas", async () => {
    banco.tabelas.cb_atlas_config = [];
    await expect(rodar()).rejects.toThrow("o Atlas não está conectado");
    expect(chamadas).toHaveLength(0);
  });

  it("nada achado: CRIA com chave de idempotência estável e grava o vínculo 'criada'", async () => {
    const r = await rodar();
    expect(r).toEqual({ acao: "criado", atlasClientId: "novo-1" });
    const busca = chamadas.find((c) => c.metodo === "buscar")!.args[0] as CriteriosDeBusca;
    // Procura pela conversa da execução, pelo id da ficha (o link antigo de ficha) e pelas outras conversas DELA.
    expect(busca.chatLinkIds).toEqual(["conv-1", FICHA, "conv-2"]);
    expect(busca.phone).toBe("5511987654321");
    const criar = chamadas.find((c) => c.metodo === "criar")!;
    expect(criar.args[1]).toBe("log-1:passo-1:criar");
    expect((criar.args[0] as DadosDoClienteNoAtlas).chatLink).toBe("https://crm.example.com/inbox?c=conv-1");
    expect(banco.tabelas.cb_atlas_clientes).toEqual([
      expect.objectContaining({ account_id: CONTA, contact_id: FICHA, atlas_client_id: "novo-1", atlas_tenant_id: "t1", origem: "criada", situacao: "ativo" }),
    ]);
    expect(detalheDoResultado(r)).toBe("cliente criado no Atlas");
  });

  it("achado RESCINDIDO: reativa o MESMO cadastro (D3), nunca cria outro", async () => {
    achados = { clientes: [{ id: "antigo-1", status: "rescindido", appUrl: "https://app.example.com/#/clients/antigo-1", casouPor: ["chat_link"] }], truncado: false };
    const r = await rodar();
    expect(r).toEqual({ acao: "reativado", atlasClientId: "antigo-1", situacaoAnterior: "rescindido" });
    expect(chamadas.some((c) => c.metodo === "criar")).toBe(false);
    const atualizar = chamadas.find((c) => c.metodo === "atualizar")!;
    expect(atualizar.args[0]).toBe("antigo-1");
    expect((atualizar.args[1] as DadosDoClienteNoAtlas).status).toBe("ativo");
    expect(atualizar.args[2]).toBe("log-1:passo-1:reativar");
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ origem: "reativada", app_url: "https://app.example.com/#/clients/antigo-1" });
    expect(detalheDoResultado(r)).toBe("cadastro reativado no Atlas (estava rescindido)");
  });

  it("achado ATIVO: só vincula — nada é escrito no Atlas", async () => {
    achados = { clientes: [{ id: "ativo-1", status: "ativo", appUrl: null, casouPor: ["phone"] }], truncado: false };
    expect(await rodar()).toEqual({ acao: "vinculado", atlasClientId: "ativo-1", situacao: "ativo" });
    expect(chamadas.map((c) => c.metodo)).toEqual(["buscar"]);
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ origem: "encontrada" });
  });

  it("mais de um cadastro: para, sem escrever, dizendo o que fazer", async () => {
    achados = {
      clientes: [
        { id: "a", status: "ativo", appUrl: null },
        { id: "b", status: "rescindido", appUrl: null },
      ],
      truncado: false,
    };
    await expect(rodar()).rejects.toThrow("há 2 cadastros no Atlas que podem ser deste cliente");
    expect(chamadas.map((c) => c.metodo)).toEqual(["buscar"]);
    expect(banco.tabelas.cb_atlas_clientes ?? []).toHaveLength(0);
  });

  it("com vínculo: relê o cliente em vez de procurar; encerrado é reativado", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "c9", origem: "encontrada" }];
    noAtlas.set("c9", { id: "c9", status: "finalizado", appUrl: null });
    expect(await rodar()).toEqual({ acao: "reativado", atlasClientId: "c9", situacaoAnterior: "finalizado" });
    expect(chamadas.map((c) => c.metodo)).toEqual(["ler", "atualizar"]);
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
    // A situação é a nova; a ORIGEM é como o vínculo nasceu, e não muda a cada execução.
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ origem: "encontrada", situacao: "ativo" });
  });

  it("rodar de novo com o vínculo desta ficha só atualiza a situação lida, sem trocar a origem", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "c9", origem: "criada" }];
    noAtlas.set("c9", { id: "c9", status: "ativo", appUrl: null });
    expect(await rodar()).toEqual({ acao: "vinculado", atlasClientId: "c9", situacao: "ativo" });
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ origem: "criada", situacao: "ativo" });
  });

  it("CRÍTICO: vínculo com o cliente na LIXEIRA do Atlas: PARA sem apagar o vínculo nem procurar (a busca não vê a lixeira e criaria outro)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "sumido", origem: "criada", excluido_no_atlas_em: null }];
    await expect(rodar()).rejects.toThrow("está na lixeira do Atlas; restaure lá (até 7 dias) ou desvincule na aba Atlas");
    expect(chamadas.map((c) => c.metodo)).toEqual(["ler"]);
    expect(banco.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ id: "v1", atlas_client_id: "sumido", contact_id: FICHA })]);
    const marcadoEm = banco.tabelas.cb_atlas_clientes[0].excluido_no_atlas_em;
    expect(typeof marcadoEm).toBe("string");
    // Rodar de novo mantém o PRIMEIRO instante em que foi visto na lixeira.
    await expect(rodar()).rejects.toThrow("lixeira");
    expect(banco.tabelas.cb_atlas_clientes[0].excluido_no_atlas_em).toBe(marcadoEm);
  });

  it("vínculo de OUTRO escritório: conta como sem vínculo, NÃO é apagado, e o passo procura", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v-antigo", account_id: CONTA, contact_id: FICHA, atlas_tenant_id: "t-antigo", atlas_client_id: "de-la", origem: "criada" }];
    achados = { clientes: [{ id: "ativo-1", status: "ativo", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    await rodar();
    expect(chamadas.map((c) => c.metodo)).toEqual(["buscar"]);
    expect(banco.tabelas.cb_atlas_clientes.map((v) => v.id)).toContain("v-antigo");
  });

  it("CRÍTICO: o único candidato forte foi DESVINCULADO desta ficha à mão: para sem escrever no Atlas", async () => {
    banco.tabelas.cb_atlas_recusas = [{ id: "r1", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_client_id: "antigo-1" }];
    achados = { clientes: [{ id: "antigo-1", status: "rescindido", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    await expect(rodar()).rejects.toThrow("foi desvinculado dela à mão; vincule o certo na aba Atlas");
    expect(chamadas.map((c) => c.metodo)).toEqual(["buscar"]);
    expect(banco.tabelas.cb_atlas_clientes ?? []).toHaveLength(0);
    // A recusa de OUTRA ficha (ou de outro ambiente) não pesa aqui.
    banco.tabelas.cb_atlas_recusas = [
      { id: "r2", account_id: CONTA, api_url: null, contact_id: "ficha-2", atlas_client_id: "antigo-1" },
      { id: "r3", account_id: CONTA, api_url: "https://staging.example.com/x", contact_id: FICHA, atlas_client_id: "antigo-1" },
    ];
    expect(await rodar()).toMatchObject({ acao: "reativado" });
  });

  it("crm_escreveu_em ao CRIAR e ao REATIVAR (nunca ao só vincular); a data da mudança quando o Atlas a manda", async () => {
    await rodar();
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ api_url: null, crm_escreveu_em: expect.any(String) });
    expect(banco.tabelas.cb_atlas_clientes[0]).not.toHaveProperty("situacao_desde");

    banco.tabelas.cb_atlas_clientes = [];
    achados = { clientes: [{ id: "ativo-1", status: "ativo", appUrl: null, casouPor: ["phone"], situacaoDesde: "2026-05-30T14:00:00.000Z" }], truncado: false };
    await rodar();
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ origem: "encontrada", situacao_desde: "2026-05-30T14:00:00.000Z" });
    expect(banco.tabelas.cb_atlas_clientes[0]).not.toHaveProperty("crm_escreveu_em");

    banco.tabelas.cb_atlas_clientes = [];
    achados = { clientes: [{ id: "antigo-1", status: "rescindido", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    await rodar();
    expect(banco.tabelas.cb_atlas_clientes[0]).toMatchObject({ origem: "reativada", crm_escreveu_em: expect.any(String) });
  });

  it("a leitura periódica ligou ESTE MESMO par um instante antes (23505): é o mesmo vínculo, e o passo não falha", async () => {
    const unico = criarBanco(
      {
        cb_atlas_config: banco.tabelas.cb_atlas_config,
        conversations: banco.tabelas.conversations,
        cb_atlas_clientes: [],
      },
      { unicos: { cb_atlas_clientes: [{ colunas: ["account_id", "api_url", "contact_id"], onde: (l) => l.contact_id != null }] } },
    );
    // A corrida: o vínculo automático entra ENTRE a leitura do vínculo e o INSERT do passo.
    const original = unico.cliente.from.bind(unico.cliente);
    let lidas = 0;
    (unico.cliente as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === "cb_atlas_clientes" && ++lidas === 3) {
        unico.tabelas.cb_atlas_clientes.push({ id: "auto", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "ativo-1", origem: "automatica", casou_por: "chat_link" });
      }
      return original(t);
    };
    achados = { clientes: [{ id: "ativo-1", status: "ativo", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    expect(await criarOuReativarNoAtlas(unico.cliente, entrada(), { cliente: fabrica })).toEqual({ acao: "vinculado", atlasClientId: "ativo-1", situacao: "ativo" });
    expect(unico.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ id: "auto", origem: "automatica", situacao: "ativo" })]);
  });

  it("AMBIENTE: a instância de teste não enxerga nem toca o vínculo da produção (e o dela nasce marcado)", async () => {
    const STAGING = "https://staging.example.com/functions/v1/client-webhook";
    vi.stubEnv("ATLAS_API_URL", STAGING);
    try {
      banco.tabelas.cb_atlas_config[0].api_url = STAGING;
      banco.tabelas.cb_atlas_clientes = [{ id: "v-prod", account_id: CONTA, api_url: null, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "c-prod", origem: "criada" }];
      expect(await rodar()).toEqual({ acao: "criado", atlasClientId: "novo-1" });
      expect(chamadas.map((c) => c.metodo)).toEqual(["buscar", "criar"]);
      expect(banco.tabelas.cb_atlas_clientes).toEqual([
        expect.objectContaining({ id: "v-prod", api_url: null, atlas_client_id: "c-prod" }),
        expect.objectContaining({ api_url: STAGING, atlas_client_id: "novo-1", origem: "criada" }),
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("cliente do Atlas já ligado a OUTRA ficha do CRM: não rouba o vínculo", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v2", account_id: CONTA, contact_id: "ficha-2", atlas_tenant_id: "t1", atlas_client_id: "ativo-1", origem: "encontrada" }];
    achados = { clientes: [{ id: "ativo-1", status: "ativo", appUrl: null, casouPor: ["phone"] }], truncado: false };
    expect(await rodar()).toEqual({ acao: "ligado_a_outra_ficha", atlasClientId: "ativo-1", situacao: "ativo" });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ contact_id: "ficha-2" })]);
  });

  it("chave recusada: a conexão vai a erro e o motivo não traz nada da resposta do Atlas", async () => {
    falha = new AtlasError("chave_invalida", "find_clients → 403 invalid_api_key: Invalid API Key com dado de cliente", 403);
    const e = (await rodar().catch((x: unknown) => x)) as Error;
    expect(e.message).toBe("Atlas: a chave do Atlas foi recusada — reconecte em Configurações → Integrações");
    expect(e.message).not.toContain("dado de cliente");
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "chave_invalida" });
  });

  it("permissão desligada: o motivo nomeia a permissão", async () => {
    falha = new AtlasError("sem_permissao", "403", 403, "read_client");
    await expect(rodar()).rejects.toThrow('a permissão "read_client" está desligada no Atlas');
  });

  it("o vínculo que não grava depois de o Atlas ter sido escrito diz o que aconteceu", async () => {
    banco.falhar.add("cb_atlas_clientes:insert");
    await expect(rodar()).rejects.toThrow("o cliente foi criado no Atlas, mas o vínculo não foi gravado no CRM");
    achados = { clientes: [{ id: "antigo-1", status: "rescindido", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    await expect(rodar()).rejects.toThrow("o cliente foi reativado no Atlas, mas o vínculo não foi gravado no CRM");
  });

  it("CRÍTICO: casado só pelo e-mail ou pelo final do telefone — para SEM escrever no Atlas", async () => {
    achados = { clientes: [{ id: "de-outra-pessoa", status: "rescindido", appUrl: null, casouPor: ["email"] }], truncado: false };
    await expect(rodar()).rejects.toThrow("casa com este cliente só pelo e-mail");
    achados = { clientes: [{ id: "de-outra-pessoa", status: "ativo", appUrl: null, casouPor: ["phone_last8"] }], truncado: false };
    await expect(rodar()).rejects.toThrow("só pelo final do telefone");
    achados = { clientes: [{ id: "de-outra-pessoa", status: "ativo", appUrl: null }], truncado: false };
    await expect(rodar()).rejects.toThrow("nada foi alterado no Atlas");
    expect(chamadas.map((c) => c.metodo)).toEqual(["buscar", "buscar", "buscar"]);
    expect(banco.tabelas.cb_atlas_clientes ?? []).toHaveLength(0);
  });

  it("suspenso no Atlas: para (a equipe suspendeu lá), nem pela busca nem pelo vínculo", async () => {
    achados = { clientes: [{ id: "s1", status: "suspenso", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    await expect(rodar()).rejects.toThrow("no Atlas está suspenso");
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "s2", origem: "criada" }];
    noAtlas.set("s2", { id: "s2", status: "suspenso", appUrl: null });
    await expect(rodar()).rejects.toThrow("no Atlas está suspenso");
    expect(chamadas.some((c) => c.metodo === "atualizar")).toBe(false);
  });

  it("inativo no Atlas: REATIVA o mesmo cadastro, como rescindido e finalizado (decisão do operador)", async () => {
    achados = { clientes: [{ id: "i1", status: "inativo", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    expect(await rodar()).toEqual({ acao: "reativado", atlasClientId: "i1", situacaoAnterior: "inativo" });
  });

  it("CRÍTICO: rescindido já ligado a OUTRA ficha — para ANTES de reativar (não grava o contrato desta no cadastro da outra)", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v2", account_id: CONTA, contact_id: "ficha-2", atlas_tenant_id: "t1", atlas_client_id: "antigo-1", origem: "criada" }];
    achados = { clientes: [{ id: "antigo-1", status: "rescindido", appUrl: null, casouPor: ["phone"] }], truncado: false };
    await expect(rodar()).rejects.toThrow("já está ligado a outra ficha do CRM");
    expect(chamadas.map((c) => c.metodo)).toEqual(["buscar"]);
    expect(banco.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ contact_id: "ficha-2" })]);
  });

  it("vínculo ÓRFÃO (a ficha antiga foi apagada): esta ficha o adota, sem linha nova", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v3", account_id: CONTA, contact_id: null, atlas_tenant_id: "t1", atlas_client_id: "antigo-1", origem: "criada" }];
    achados = { clientes: [{ id: "antigo-1", status: "finalizado", appUrl: null, casouPor: ["chat_link"] }], truncado: false };
    expect(await rodar()).toMatchObject({ acao: "reativado", atlasClientId: "antigo-1" });
    expect(banco.tabelas.cb_atlas_clientes).toEqual([expect.objectContaining({ id: "v3", contact_id: FICHA, origem: "reativada" })]);
  });

  it("CRÍTICO: falha ao reler o cliente do vínculo (não é o `not_found` do Atlas) mantém o vínculo", async () => {
    banco.tabelas.cb_atlas_clientes = [{ id: "v1", account_id: CONTA, contact_id: FICHA, atlas_tenant_id: "t1", atlas_client_id: "c9", origem: "criada" }];
    falha = new AtlasError("atlas_error", "get_client → 404 NOT_FOUND", 404);
    await expect(rodar()).rejects.toThrow("Atlas: o Atlas devolveu um erro");
    expect(banco.tabelas.cb_atlas_clientes).toHaveLength(1);
  });

  it("ficha sem nome: não cria (o Atlas recusaria com 'validação' genérica)", async () => {
    await expect(rodar(entrada({ contato: { nome: "  ", telefone: "5511987654321", email: null } }))).rejects.toThrow("não tem nome");
    expect(chamadas.map((c) => c.metodo)).toEqual(["buscar"]);
  });

  it("sem conversa, telefone válido nem e-mail válido: NÃO cria (a busca não o reencontraria, e rodar de novo duplicaria)", async () => {
    await expect(
      rodar(entrada({ contato: { nome: "Cliente Exemplo", telefone: "12345", email: "nao tem" }, linkDaConversa: null, conversaDaExecucao: null })),
    ).rejects.toThrow("não tem conversa, telefone nem e-mail");
    expect(chamadas.some((c) => c.metodo === "criar")).toBe(false);
    // Só o telefone basta.
    await rodar(entrada({ contato: { nome: "Cliente Exemplo", telefone: "5511987654321", email: null }, linkDaConversa: null, conversaDaExecucao: null }));
    expect(chamadas.some((c) => c.metodo === "criar")).toBe(true);
  });

  it("critério que o Atlas recusaria (e-mail sem @, telefone curto) fica fora da busca; o link vai sempre", async () => {
    await rodar(entrada({ contato: { nome: "Cliente Exemplo", telefone: "12345", email: "nao tem" } }));
    const busca = chamadas.find((c) => c.metodo === "buscar")!.args[0] as CriteriosDeBusca;
    expect(busca.phone).toBeNull();
    expect(busca.email).toBeNull();
    expect(busca.chatLinkIds).toEqual(["conv-1", FICHA, "conv-2"]);
    expect((chamadas.find((c) => c.metodo === "criar")!.args[0] as DadosDoClienteNoAtlas).email).toBeNull();
  });

  it("data PREENCHIDA que não é data PARA o passo (a reserva iria ao Atlas como data certa); vazia segue", async () => {
    await expect(rodar(entrada({ datas: { primeiroContato: null, proposta: "semana que vem", fechamento: null } }))).rejects.toThrow(
      "a data da proposta na ficha não é uma data válida",
    );
    expect(chamadas).toHaveLength(0);
    expect(await rodar(entrada({ datas: { primeiroContato: "  ", proposta: null, fechamento: null } }))).toMatchObject({ acao: "criado" });
  });

  it("validação recusada: o motivo nomeia os NOSSOS campos", async () => {
    falha = new AtlasError("validacao", "400", 400, null, { codigoDoAtlas: "validation_error", campos: ["email", "phone"] });
    await expect(rodar()).rejects.toThrow("o Atlas recusou os dados do cliente (validação: email, phone)");
  });

  it("a conversa da execução entra na busca mesmo quando a ficha tem mais de 9 conversas (teto do Atlas: 10 ids)", async () => {
    banco.tabelas.conversations = Array.from({ length: 12 }, (_, i) => ({ id: `antiga-${i}`, account_id: CONTA, contact_id: FICHA }));
    await rodar(entrada({ conversaDaExecucao: "atual" }));
    const busca = chamadas.find((c) => c.metodo === "buscar")!.args[0] as CriteriosDeBusca;
    expect(busca.chatLinkIds).toHaveLength(10);
    expect(busca.chatLinkIds!.slice(0, 2)).toEqual(["atual", FICHA]);
  });

  it("chave que não decifra (ENCRYPTION_KEY trocada): falha E marca a conexão em erro, para o cartão pedir reconexão", async () => {
    banco.tabelas.cb_atlas_config[0].api_key = "estragada";
    await expect(rodar()).rejects.toThrow("não pôde ser lida");
    expect(banco.tabelas.cb_atlas_config[0]).toMatchObject({ status: "erro", last_error: "chave_ilegivel" });
    expect(chamadas).toHaveLength(0);
  });

  it("conexão feita em OUTRO ambiente do Atlas (o staging, no preview): falha sem mandar a chave", async () => {
    banco.tabelas.cb_atlas_config[0].api_url = "https://staging.example.com/functions/v1/client-webhook";
    await expect(rodar()).rejects.toThrow("é de outro ambiente do Atlas");
    expect(chamadas).toHaveLength(0);
  });
});
