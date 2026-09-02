import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  contarFiltrosAtivos,
  FILTROS_VAZIOS,
  SEM_ETAPA,
  SEM_RESPONSAVEL,
  type FiltrosDoInbox,
} from "./filtros";
import {
  descreverFiltro,
  escreverFiltroSalvo,
  lerFiltroSalvo,
  limparOrfaos,
  mesmoFiltro,
  type CatalogosDoFiltro,
} from "./filtros-salvos";
import type { PipelineStage, Profile, Tag } from "@/types";

// ------------------------------------------------------------
// Filtros salvos (967).
//
// Os dois modos de falha que estes testes existem para impedir:
//  1. um filtro gravado devolver ZERO conversas sem erro nenhum (id morto);
//  2. a chave de i18n aparecer crua na tela (o fallback do next-intl é por
//     ARQUIVO, não por chave) — é o último bloco.
// ------------------------------------------------------------

const etapa = (id: string, pipeline_id: string, name: string): PipelineStage => ({
  id,
  pipeline_id,
  name,
  position: 0,
  color: "#fff",
  created_at: "",
} as PipelineStage);

const perfil = (user_id: string, full_name: string, email = "x@y.z"): Profile =>
  ({ id: user_id, user_id, full_name, email }) as Profile;

const etiqueta = (id: string, name: string, color = "#abc"): Tag =>
  ({ id, name, color, user_id: "u", created_at: "" }) as Tag;

const CAT: CatalogosDoFiltro = {
  canais: [
    { id: "c1", label: "Comercial · Bancário" },
    { id: "c2", label: "Jurídico" },
  ],
  responsaveis: [perfil("u1", "Ana Lima"), perfil("u2", "")],
  etapas: [etapa("e1", "p1", "Reunião marcada")],
  funis: new Map([["p1", "Comercial"]]),
  etiquetas: [etiqueta("t1", "Urgente"), etiqueta("t2", "VIP")],
};

// ============================================================
// lerFiltroSalvo — o parse defensivo
// ============================================================

describe("lerFiltroSalvo", () => {
  it("objeto vazio vira FILTROS_VAZIOS, não undefined solto", () => {
    expect(lerFiltroSalvo({})).toEqual(FILTROS_VAZIOS);
  });

  it("o que não é objeto também", () => {
    for (const lixo of [null, undefined, 42, "x", [], true]) {
      expect(lerFiltroSalvo(lixo)).toEqual(FILTROS_VAZIOS);
    }
  });

  it("lê o que conhece", () => {
    expect(
      lerFiltroSalvo({
        tipo: "grupos",
        status: "closed",
        canalId: "c1",
        responsavelId: "u1",
        etiquetaIds: ["t1", "t2"],
        modoDeEtiqueta: "todas",
        empresa: "ACME",
        funilId: "p1",
        etapaId: "e1",
        favoritas: true,
        naoLidas: true,
      }),
    ).toEqual({
      tipo: "grupos",
      status: "closed",
      canalId: "c1",
      responsavelId: "u1",
      etiquetaIds: ["t1", "t2"],
      modoDeEtiqueta: "todas",
      empresa: "ACME",
      funilId: "p1",
      etapaId: "e1",
      favoritas: true,
      naoLidas: true,
    });
  });

  it("CRÍTICO: valor fora da união cai no padrão, nunca vaza para aplicarFiltros", () => {
    const f = lerFiltroSalvo({ tipo: "coisa", status: "arquivada", modoDeEtiqueta: 1 });
    expect(f.tipo).toBe("todas");
    expect(f.status).toBe("ativas");
    expect(f.modoDeEtiqueta).toBe("qualquer");
  });

  it("⚠️ filtro gravado ANTES das duas abas: todos/open/pending caem em 'ativas', closed sobrevive", () => {
    // Um `as FiltrosDoInbox` entregaria "todos" a `aplicarFiltros`, que não o
    // conhece mais — e a lista responderia de um jeito que ninguém escolheu.
    for (const legado of ["todos", "open", "pending"]) {
      expect(lerFiltroSalvo({ status: legado }).status).toBe("ativas");
    }
    expect(lerFiltroSalvo({ status: "closed" }).status).toBe("closed");
  });

  it("CRÍTICO: booleano só é `true` quando é o booleano true", () => {
    // `"false"`, `1` e `"sim"` são todos truthy em JS — um `!!` aqui ligaria
    // o filtro de favoritas a partir de lixo gravado.
    expect(lerFiltroSalvo({ favoritas: "false" }).favoritas).toBe(false);
    expect(lerFiltroSalvo({ naoLidas: 1 }).naoLidas).toBe(false);
    expect(lerFiltroSalvo({ favoritas: true }).favoritas).toBe(true);
  });

  it("string vazia vira null — id vazio não casa com nada", () => {
    const f = lerFiltroSalvo({ canalId: "", etapaId: "   ", empresa: "" });
    expect(f.canalId).toBeNull();
    expect(f.etapaId).toBeNull();
    expect(f.empresa).toBeNull();
  });

  it("etiquetaIds: descarta não-string, apara e remove duplicata", () => {
    expect(
      lerFiltroSalvo({ etiquetaIds: ["t1", 2, null, " t1 ", "t2", ""] }).etiquetaIds,
    ).toEqual(["t1", "t2"]);
  });

  it("chave desconhecida é ignorada (não vaza para o estado da tela)", () => {
    const f = lerFiltroSalvo({ tipo: "diretas", inventada: "x" });
    expect(f).toEqual({ ...FILTROS_VAZIOS, tipo: "diretas" });
    expect("inventada" in f).toBe(false);
  });

  it("ida e volta preserva o recorte", () => {
    const original = {
      ...FILTROS_VAZIOS,
      canalId: "c1",
      etapaId: "e1",
      etiquetaIds: ["t1"],
      naoLidas: true,
    };
    expect(lerFiltroSalvo(escreverFiltroSalvo(original))).toEqual(original);
  });
});

describe("escreverFiltroSalvo", () => {
  it("grava só as chaves do recorte — campo de UI não vaza para o banco", () => {
    const comLixo = { ...FILTROS_VAZIOS, painelAberto: true } as never;
    expect(Object.keys(escreverFiltroSalvo(comLixo)).sort()).toEqual([
      "canalId",
      "empresa",
      "etapaId",
      "etiquetaIds",
      "favoritas",
      "funilId",
      "modoDeEtiqueta",
      "naoLidas",
      "responsavelId",
      "status",
      "tipo",
    ]);
  });
});

// ============================================================
// mesmoFiltro
// ============================================================

describe("mesmoFiltro", () => {
  it("igual é igual", () => {
    expect(mesmoFiltro(FILTROS_VAZIOS, { ...FILTROS_VAZIOS })).toBe(true);
  });

  it("qualquer campo diferente separa", () => {
    expect(mesmoFiltro(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, naoLidas: true })).toBe(
      false,
    );
    expect(mesmoFiltro(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, canalId: "c1" })).toBe(
      false,
    );
  });

  it("CRÍTICO: etiquetas comparam como CONJUNTO — a ordem do clique não conta", () => {
    const a = { ...FILTROS_VAZIOS, etiquetaIds: ["t1", "t2"] };
    const b = { ...FILTROS_VAZIOS, etiquetaIds: ["t2", "t1"] };
    expect(mesmoFiltro(a, b)).toBe(true);
  });

  it("com UMA etiqueta o modo não separa (recorta igual)", () => {
    const a = { ...FILTROS_VAZIOS, etiquetaIds: ["t1"], modoDeEtiqueta: "todas" as const };
    const b = { ...FILTROS_VAZIOS, etiquetaIds: ["t1"], modoDeEtiqueta: "qualquer" as const };
    expect(mesmoFiltro(a, b)).toBe(true);
  });

  it("com DUAS etiquetas o modo separa (recorta diferente)", () => {
    const a = {
      ...FILTROS_VAZIOS,
      etiquetaIds: ["t1", "t2"],
      modoDeEtiqueta: "todas" as const,
    };
    const b = {
      ...FILTROS_VAZIOS,
      etiquetaIds: ["t1", "t2"],
      modoDeEtiqueta: "qualquer" as const,
    };
    expect(mesmoFiltro(a, b)).toBe(false);
  });
});

// ============================================================
// descreverFiltro
// ============================================================

describe("descreverFiltro", () => {
  it("recorte vazio não descreve nada", () => {
    expect(descreverFiltro(FILTROS_VAZIOS, CAT)).toEqual([]);
  });

  it("troca id por nome", () => {
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, canalId: "c1", etapaId: "e1", etiquetaIds: ["t1"] },
      CAT,
    );
    // A ordem é a MESMA das pastilhas do painel: canal → etiqueta → etapa.
    expect(p.map((x) => x.rotulo)).toEqual([
      { fonte: "dado", texto: "Comercial · Bancário" },
      { fonte: "dado", texto: "Urgente" },
      { fonte: "dado", texto: "Reunião marcada" },
    ]);
    expect(p.every((x) => !x.orfao)).toBe(true);
  });

  it("CRÍTICO: id que não existe mais é SINALIZADO, e o UUID nunca é impresso", () => {
    const p = descreverFiltro(
      {
        ...FILTROS_VAZIOS,
        canalId: "sumiu",
        etapaId: "sumiu",
        etiquetaIds: ["sumiu"],
        responsavelId: "sumiu",
      },
      CAT,
    );
    expect(p.every((x) => x.orfao)).toBe(true);
    // Rótulo genérico do campo, jamais o id — o operador leria o UUID como se
    // fosse o nome.
    for (const pedaco of p) {
      expect(pedaco.rotulo.fonte).toBe("i18n");
      expect(JSON.stringify(pedaco.rotulo)).not.toContain("sumiu");
    }
  });

  it("CRÍTICO (M4): catálogo VAZIO não marca órfão — a mesma guarda do limparOrfaos", () => {
    // Lista vazia pode ser "ainda não carregou" ou "a busca falhou" — o menu
    // escrevia "(apagado)" sobre etiqueta/etapa/canal VIVOS enquanto os
    // catálogos chegavam. Rótulo genérico sim; marca de referência morta não.
    const catVazio: CatalogosDoFiltro = {
      canais: [],
      etiquetas: [],
      responsaveis: [],
      etapas: [],
      funis: new Map(),
    };
    const p = descreverFiltro(
      {
        ...FILTROS_VAZIOS,
        canalId: "c1",
        etapaId: "e1",
        etiquetaIds: ["t1"],
        responsavelId: "u1",
        funilId: "p1",
      },
      catVazio,
    );
    expect(p.length).toBeGreaterThan(0);
    expect(p.some((x) => x.orfao)).toBe(false);
    // E com o catálogo CARREGADO os mesmos ids mortos voltam a ser órfãos —
    // a guarda não desligou a detecção.
    const morto = descreverFiltro(
      { ...FILTROS_VAZIOS, canalId: "sumiu" },
      CAT,
    );
    expect(morto[0].orfao).toBe(true);
  });

  it("os sentinelas não são órfãos", () => {
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, etapaId: SEM_ETAPA, responsavelId: SEM_RESPONSAVEL },
      CAT,
    );
    expect(p.map((x) => x.rotulo)).toEqual([
      { fonte: "i18n", chave: "assigneeNone" },
      { fonte: "i18n", chave: "stageNone" },
    ]);
    expect(p.some((x) => x.orfao)).toBe(false);
  });

  it("responsável com full_name vazio cai no email, e sem email no rótulo genérico", () => {
    const semNome = descreverFiltro({ ...FILTROS_VAZIOS, responsavelId: "u2" }, CAT);
    expect(semNome[0].rotulo).toEqual({ fonte: "dado", texto: "x@y.z" });

    const catSemNada: CatalogosDoFiltro = {
      ...CAT,
      responsaveis: [perfil("u3", "", "")],
    };
    const nada = descreverFiltro({ ...FILTROS_VAZIOS, responsavelId: "u3" }, catSemNada);
    expect(nada[0].rotulo).toEqual({ fonte: "i18n", chave: "assigneeUnnamed" });
    // Achou o perfil — o rótulo é genérico por falta de nome, não por órfão.
    expect(nada[0].orfao).toBe(false);
  });

  it("com 2+ funis a etapa ganha o nome do funil na frente", () => {
    const dois: CatalogosDoFiltro = {
      ...CAT,
      funis: new Map([
        ["p1", "Comercial"],
        ["p2", "Jurídico"],
      ]),
    };
    expect(descreverFiltro({ ...FILTROS_VAZIOS, etapaId: "e1" }, dois)[0].rotulo).toEqual(
      { fonte: "dado", texto: "Comercial · Reunião marcada" },
    );
  });

  it("uma pastilha POR etiqueta, cada uma com a própria cor e o próprio limpar", () => {
    const p = descreverFiltro({ ...FILTROS_VAZIOS, etiquetaIds: ["t1", "t2"] }, CAT);
    expect(p).toHaveLength(2);
    expect(p[0].cor).toBe("#abc");
    // Remover a primeira preserva a segunda.
    expect(p[0].limpar).toEqual({ etiquetaIds: ["t2"] });
    expect(p[1].limpar).toEqual({ etiquetaIds: ["t1"] });
  });

  it("empresa NÃO é marcada como órfã — não é referência a linha nenhuma", () => {
    const p = descreverFiltro({ ...FILTROS_VAZIOS, empresa: "ACME" }, CAT);
    expect(p[0].rotulo).toEqual({ fonte: "dado", texto: "ACME" });
    expect(p[0].orfao).toBeUndefined();
  });

  it("`limpar` de cada pedaço realmente apaga aquele pedaço", () => {
    const cheio: FiltrosDoInbox = {
      ...FILTROS_VAZIOS,
      tipo: "grupos",
      status: "closed",
      canalId: "c1",
      responsavelId: "u1",
      funilId: "p1",
      etapaId: "e1",
      empresa: "ACME",
      etiquetaIds: ["t1"],
      naoLidas: true,
      favoritas: true,
    };
    let atual: FiltrosDoInbox = cheio;
    for (const pedaco of descreverFiltro(cheio, CAT)) {
      atual = { ...atual, ...pedaco.limpar };
    }
    expect(atual).toEqual(FILTROS_VAZIOS);
  });
});

// ============================================================
// limparOrfaos
// ============================================================

describe("limparOrfaos", () => {
  it("recorte todo vivo passa intacto", () => {
    const f = {
      ...FILTROS_VAZIOS,
      canalId: "c1",
      responsavelId: "u1",
      etapaId: "e1",
      etiquetaIds: ["t1", "t2"],
    };
    expect(limparOrfaos(f, CAT)).toEqual(f);
  });

  it("CRÍTICO: id morto é descartado — senão o filtro devolve zero sem erro", () => {
    const f = {
      ...FILTROS_VAZIOS,
      canalId: "morto",
      responsavelId: "morto",
      etapaId: "morto",
      etiquetaIds: ["t1", "morto"],
    };
    expect(limparOrfaos(f, CAT)).toEqual({
      ...FILTROS_VAZIOS,
      etiquetaIds: ["t1"],
    });
  });

  it("CRÍTICO: catálogo VAZIO não limpa nada — pode ser rede caída, não exclusão", () => {
    const f = {
      ...FILTROS_VAZIOS,
      canalId: "c1",
      responsavelId: "u1",
      etapaId: "e1",
      etiquetaIds: ["t1"],
    };
    const vazio: CatalogosDoFiltro = {
      canais: [],
      responsaveis: [],
      etapas: [],
      funis: new Map(),
      etiquetas: [],
    };
    expect(limparOrfaos(f, vazio)).toEqual(f);
  });

  it("os sentinelas sobrevivem — não são ids", () => {
    const f = { ...FILTROS_VAZIOS, etapaId: SEM_ETAPA, responsavelId: SEM_RESPONSAVEL };
    expect(limparOrfaos(f, CAT)).toEqual(f);
  });

  it("empresa sobrevive mesmo sem conversa daquela empresa agora", () => {
    const f = { ...FILTROS_VAZIOS, empresa: "Empresa Sem Conversa Hoje" };
    expect(limparOrfaos(f, CAT)).toEqual(f);
  });

  it("não muda o objeto de entrada", () => {
    const f = { ...FILTROS_VAZIOS, canalId: "morto" };
    limparOrfaos(f, CAT);
    expect(f.canalId).toBe("morto");
  });
});

// ============================================================
// ⚠️ O ELO COM `contarFiltrosAtivos` — o que impede um campo novo de
// `FiltrosDoInbox` nascer invisível aqui.
//
// As pastilhas do painel continuam sendo montadas dentro de
// `inbox-filters.tsx` (código do dia a dia, recém-mexido pelo PR #73 — não
// vale reescrevê-lo por causa do menu). O preço disso é o risco de as duas
// descrições divergirem, e este bloco é o pagamento: `AMOSTRAS` é um
// `Record<keyof FiltrosDoInbox, …>`, então **o compilador** cobra uma entrada
// para todo campo novo, e o teste cobra que aquele campo apareça na descrição.
// ============================================================

/** `null` = não recorta sozinho (é o caso de `modoDeEtiqueta`). */
const AMOSTRAS: Record<keyof FiltrosDoInbox, Partial<FiltrosDoInbox> | null> = {
  tipo: { tipo: "grupos" },
  status: { status: "closed" },
  canalId: { canalId: "c1" },
  responsavelId: { responsavelId: "u1" },
  etiquetaIds: { etiquetaIds: ["t1"] },
  // Só muda como as etiquetas já escolhidas se combinam — `contarFiltrosAtivos`
  // também o ignora, de propósito.
  modoDeEtiqueta: null,
  empresa: { empresa: "ACME" },
  funilId: { funilId: "p1" },
  etapaId: { etapaId: "e1" },
  favoritas: { favoritas: true },
  naoLidas: { naoLidas: true },
};

describe("todo recorte que o painel CONTA, a descrição DESCREVE", () => {
  for (const [campo, amostra] of Object.entries(AMOSTRAS)) {
    if (!amostra) continue;
    it(`${campo}`, () => {
      const f = { ...FILTROS_VAZIOS, ...amostra };
      // O distintivo do botão conta este recorte...
      expect(contarFiltrosAtivos(f)).toBe(1);
      // ...então a descrição não pode ficar muda sobre ele.
      const pedacos = descreverFiltro(f, CAT);
      expect(pedacos.length).toBeGreaterThanOrEqual(1);
      // E ele tem de saber se desfazer.
      let desfeito = f;
      for (const pedaco of pedacos) desfeito = { ...desfeito, ...pedaco.limpar };
      expect(desfeito).toEqual(FILTROS_VAZIOS);
      // E sobreviver à ida e volta pelo banco.
      expect(lerFiltroSalvo(escreverFiltroSalvo(f))).toEqual(f);
    });
  }
});

describe("funil (dois níveis)", () => {
  const DOIS: CatalogosDoFiltro = {
    ...CAT,
    etapas: [etapa("e1", "p1", "Reunião marcada"), etapa("e2", "p2", "Triagem")],
    funis: new Map([
      ["p1", "Comercial"],
      ["p2", "Jurídico"],
    ]),
  };

  it("funil e etapa viram DUAS pastilhas, e a etapa perde o prefixo", () => {
    const p = descreverFiltro({ ...FILTROS_VAZIOS, funilId: "p1", etapaId: "e1" }, DOIS);
    expect(p.map((x) => [x.chave, x.rotulo])).toEqual([
      ["funil", { fonte: "dado", texto: "Comercial" }],
      // Sem "Comercial · " na frente: o funil já tem pastilha própria, e
      // repetir estourava os 320px da coluna.
      ["etapa", { fonte: "dado", texto: "Reunião marcada" }],
    ]);
  });

  it("tirar o funil tira a etapa junto", () => {
    const p = descreverFiltro({ ...FILTROS_VAZIOS, funilId: "p1", etapaId: "e1" }, DOIS);
    expect(p[0].limpar).toEqual({ funilId: null, etapaId: null });
  });

  it("com UM funil só, a etapa volta a ser descrita sem prefixo", () => {
    expect(descreverFiltro({ ...FILTROS_VAZIOS, etapaId: "e1" }, CAT)[0].rotulo).toEqual({
      fonte: "dado",
      texto: "Reunião marcada",
    });
  });

  it("CRÍTICO: funil apagado leva a etapa junto na limpeza", () => {
    const f = { ...FILTROS_VAZIOS, funilId: "morto", etapaId: "e1" };
    expect(limparOrfaos(f, DOIS)).toEqual(FILTROS_VAZIOS);
  });
});

// ============================================================
// ⚠️ O bloco que impede a chave crua na tela.
//
// O fallback do next-intl é por ARQUIVO: `pt-BR.json` existe, então uma chave
// faltando NÃO cai para o inglês — ela vira `MISSING_MESSAGE` e o operador lê
// `Inbox.conversationList.deletedRef` dentro do menu.
// ============================================================

const CHAVES_USADAS = [
  "typeDirect",
  "typeGroups",
  "filterClosed",
  "filterUnread",
  "favorites",
  "channelFilter",
  "assigneeNone",
  "assigneeUnnamed",
  "stageNone",
  "labelStage",
  "labelPipeline",
  "tags",
  "deletedRef",
] as const;

describe("os rótulos existem nos DOIS dicionários", () => {
  for (const arquivo of ["en", "pt-BR"]) {
    it(`${arquivo}.json tem todas as chaves de ChaveDeRotulo`, () => {
      const dic = JSON.parse(
        readFileSync(`messages/${arquivo}.json`, "utf8"),
      ) as Record<string, Record<string, Record<string, string>>>;
      const ns = dic.Inbox?.conversationList ?? {};
      for (const chave of CHAVES_USADAS) {
        expect(typeof ns[chave], `${arquivo} → Inbox.conversationList.${chave}`).toBe(
          "string",
        );
      }
    });
  }
});
