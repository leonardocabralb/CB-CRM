import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  casaComAEtapa,
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
import type { Conversation, PipelineStage, Profile, Tag } from "@/types";

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
        canalIds: ["c1"],
        responsavelId: "u1",
        etiquetaIds: ["t1", "t2"],
        modoDeEtiqueta: "todas",
        empresa: "ACME",
        funilIds: ["p1", "p2"],
        etapaIds: ["e1", SEM_ETAPA],
        favoritas: true,
        naoLidas: true,
      }),
    ).toEqual({
      tipo: "grupos",
      // A aba não faz parte da visão — o "closed" gravado é ignorado.
      status: "ativas",
      canalIds: ["c1"],
      responsavelId: "u1",
      etiquetaIds: ["t1", "t2"],
      modoDeEtiqueta: "todas",
      empresa: "ACME",
      funilIds: ["p1", "p2"],
      etapaIds: ["e1", SEM_ETAPA],
      favoritas: true,
      naoLidas: true,
      emAtraso: false,
      inadimplentes: false,
    });
  });

  it("CRÍTICO: valor fora da união cai no padrão, nunca vaza para aplicarFiltros", () => {
    const f = lerFiltroSalvo({ tipo: "coisa", status: "arquivada", modoDeEtiqueta: 1 });
    expect(f.tipo).toBe("todas");
    expect(f.status).toBe("ativas");
    expect(f.modoDeEtiqueta).toBe("qualquer");
  });

  it("⚠️ a ABA não faz parte da visão: qualquer `status` gravado é ignorado", () => {
    // Um `as FiltrosDoInbox` entregaria "todos" a `aplicarFiltros`, que não o
    // conhece mais — e a lista responderia de um jeito que ninguém escolheu.
    // E o "closed" gravado até 03/09 também cai: aplicar o chip na aba
    // Encerradas jogava o operador de volta para Abertas.
    for (const gravado of ["todos", "open", "pending", "closed", "ativas"]) {
      expect(lerFiltroSalvo({ status: gravado }).status).toBe("ativas");
    }
  });

  it("CRÍTICO: booleano só é `true` quando é o booleano true", () => {
    // `"false"`, `1` e `"sim"` são todos truthy em JS — um `!!` aqui ligaria
    // o filtro de favoritas a partir de lixo gravado.
    expect(lerFiltroSalvo({ favoritas: "false" }).favoritas).toBe(false);
    expect(lerFiltroSalvo({ naoLidas: 1 }).naoLidas).toBe(false);
    expect(lerFiltroSalvo({ favoritas: true }).favoritas).toBe(true);
  });

  it("string vazia vira null — id vazio não casa com nada", () => {
    const f = lerFiltroSalvo({ canalId: "", etapaId: "   ", funilId: "", empresa: "" });
    expect(f.canalIds).toEqual([]);
    expect(f.etapaIds).toEqual([]);
    expect(f.funilIds).toEqual([]);
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
      canalIds: ["c1"],
      funilIds: ["p1", "p2"],
      etapaIds: ["e1", SEM_ETAPA],
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
      "canalIds",
      "emAtraso",
      "empresa",
      "etapaIds",
      "etiquetaIds",
      "favoritas",
      "funilIds",
      "inadimplentes",
      "modoDeEtiqueta",
      "naoLidas",
      "responsavelId",
      "tipo",
    ]);
  });

  it("grava só o formato NOVO de funil e etapa — o antigo é só lido", () => {
    const gravado = escreverFiltroSalvo({
      ...FILTROS_VAZIOS,
      funilIds: ["p1"],
      etapaIds: ["e1"],
    });
    expect(gravado).toMatchObject({ funilIds: ["p1"], etapaIds: ["e1"] });
    expect("funilId" in gravado).toBe(false);
    expect("etapaId" in gravado).toBe(false);
  });

  it("não grava a aba: `status` não vai para o banco", () => {
    expect("status" in escreverFiltroSalvo({ ...FILTROS_VAZIOS, status: "closed" })).toBe(false);
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
    expect(mesmoFiltro(FILTROS_VAZIOS, { ...FILTROS_VAZIOS, canalIds: ["c1"] })).toBe(
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
      { ...FILTROS_VAZIOS, canalIds: ["c1"], etapaIds: ["e1"], etiquetaIds: ["t1"] },
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
        canalIds: ["sumiu"],
        funilIds: ["sumiu"],
        etapaIds: ["sumiu"],
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
        canalIds: ["c1"],
        etapaIds: ["e1"],
        etiquetaIds: ["t1"],
        responsavelId: "u1",
        funilIds: ["p1"],
      },
      catVazio,
    );
    expect(p.length).toBeGreaterThan(0);
    expect(p.some((x) => x.orfao)).toBe(false);
    // E com o catálogo CARREGADO os mesmos ids mortos voltam a ser órfãos —
    // a guarda não desligou a detecção.
    const morto = descreverFiltro(
      { ...FILTROS_VAZIOS, canalIds: ["sumiu"] },
      CAT,
    );
    expect(morto[0].orfao).toBe(true);
  });

  it("os sentinelas não são órfãos", () => {
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, etapaIds: [SEM_ETAPA], responsavelId: SEM_RESPONSAVEL },
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
    expect(descreverFiltro({ ...FILTROS_VAZIOS, etapaIds: ["e1"] }, dois)[0].rotulo).toEqual(
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
      canalIds: ["c1"],
      responsavelId: "u1",
      funilIds: ["p1"],
      etapaIds: ["e1"],
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
      canalIds: ["c1"],
      responsavelId: "u1",
      funilIds: ["p1"],
      etapaIds: ["e1"],
      etiquetaIds: ["t1", "t2"],
    };
    expect(limparOrfaos(f, CAT)).toEqual(f);
  });

  it("CRÍTICO: id morto é descartado — senão o filtro devolve zero sem erro", () => {
    const f = {
      ...FILTROS_VAZIOS,
      canalIds: ["morto"],
      responsavelId: "morto",
      funilIds: ["morto"],
      etapaIds: ["morto"],
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
      canalIds: ["c1"],
      responsavelId: "u1",
      funilIds: ["p1"],
      etapaIds: ["e1"],
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
    const f = { ...FILTROS_VAZIOS, etapaIds: [SEM_ETAPA], responsavelId: SEM_RESPONSAVEL };
    expect(limparOrfaos(f, CAT)).toEqual(f);
    // E ao lado de uma etapa morta, só a morta sai.
    expect(
      limparOrfaos({ ...FILTROS_VAZIOS, etapaIds: [SEM_ETAPA, "morta", "e1"] }, CAT).etapaIds,
    ).toEqual([SEM_ETAPA, "e1"]);
  });

  it("empresa sobrevive mesmo sem conversa daquela empresa agora", () => {
    const f = { ...FILTROS_VAZIOS, empresa: "Empresa Sem Conversa Hoje" };
    expect(limparOrfaos(f, CAT)).toEqual(f);
  });

  it("não muda o objeto de entrada", () => {
    const f = { ...FILTROS_VAZIOS, canalIds: ["morto"] };
    limparOrfaos(f, CAT);
    expect(f.canalIds).toEqual(["morto"]);
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
  // A aba não é recorte salvo: não conta, não é descrita, não vai ao banco.
  status: null,
  canalIds: { canalIds: ["c1"] },
  responsavelId: { responsavelId: "u1" },
  etiquetaIds: { etiquetaIds: ["t1"] },
  // Só muda como as etiquetas já escolhidas se combinam — `contarFiltrosAtivos`
  // também o ignora, de propósito.
  modoDeEtiqueta: null,
  empresa: { empresa: "ACME" },
  funilIds: { funilIds: ["p1"] },
  etapaIds: { etapaIds: ["e1"] },
  favoritas: { favoritas: true },
  naoLidas: { naoLidas: true },
  emAtraso: { emAtraso: true },
  inadimplentes: { inadimplentes: true },
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

  it("a etapa vai DENTRO do pedaço do funil dela — ela refina só aquele funil", () => {
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, funilIds: ["p1"], etapaIds: ["e1"] },
      DOIS,
    );
    expect(p.map((x) => [x.chave, x.rotulo])).toEqual([
      ["funil:p1", { fonte: "dado", texto: "Comercial (Reunião marcada)" }],
    ]);
  });

  it("vários funis: um pedaço por funil, cada um com as etapas DELE", () => {
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, funilIds: ["p1", "p2"], etapaIds: ["e1"] },
      DOIS,
    );
    // "Comercial · Jurídico · Reunião marcada" faria a reunião parecer valer
    // para os dois funis — e o Jurídico recorta inteiro.
    expect(p.map((x) => x.rotulo)).toEqual([
      { fonte: "dado", texto: "Comercial (Reunião marcada)" },
      { fonte: "dado", texto: "Jurídico" },
    ]);
  });

  it("'Sem negócio' vem primeiro, como no painel, e soma com os funis", () => {
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, funilIds: ["p2"], etapaIds: [SEM_ETAPA] },
      DOIS,
    );
    expect(p.map((x) => x.rotulo)).toEqual([
      { fonte: "i18n", chave: "stageNone" },
      { fonte: "dado", texto: "Jurídico" },
    ]);
    // Tirar o "Sem negócio" não mexe no funil.
    expect(p[0].limpar).toEqual({ etapaIds: [] });
  });

  it("⚠️ etapa SOLTA numa conta de dois níveis (visão antiga) é descrita no funil DERIVADO — como o painel a mostra", () => {
    const p = descreverFiltro({ ...FILTROS_VAZIOS, etapaIds: ["e2"] }, DOIS);
    expect(p.map((x) => [x.chave, x.rotulo])).toEqual([
      ["funil:p2", { fonte: "dado", texto: "Jurídico (Triagem)" }],
    ]);
    // Tirar esse pedaço é tirar a etapa — o funil derivado sai sozinho.
    expect(p[0].limpar).toEqual({ funilIds: [], etapaIds: [] });
  });

  it("tirar o funil tira as etapas DELE junto, e as dos outros ficam", () => {
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, funilIds: ["p1", "p2"], etapaIds: ["e1", "e2"] },
      DOIS,
    );
    expect(p[0].limpar).toEqual({ funilIds: ["p2"], etapaIds: ["e2"] });
    expect(p[1].limpar).toEqual({ funilIds: ["p1"], etapaIds: ["e1"] });
  });

  it("com UM funil só, a etapa volta a ser descrita sozinha e sem prefixo", () => {
    expect(descreverFiltro({ ...FILTROS_VAZIOS, etapaIds: ["e1"] }, CAT)[0].rotulo).toEqual({
      fonte: "dado",
      texto: "Reunião marcada",
    });
  });

  it("funil sem nome conhecido não engole as etapas: elas seguem com o nome delas", () => {
    const semNomes: CatalogosDoFiltro = { ...DOIS, funis: new Map([["p2", "Jurídico"]]) };
    const p = descreverFiltro(
      { ...FILTROS_VAZIOS, funilIds: ["p1"], etapaIds: ["e1"] },
      semNomes,
    );
    expect(p.map((x) => x.rotulo)).toEqual([
      { fonte: "i18n", chave: "labelPipeline" },
      { fonte: "dado", texto: "Reunião marcada" },
    ]);
  });

  it("CRÍTICO: funil apagado leva as etapas DELE junto na limpeza — as dos outros funis ficam", () => {
    // Catálogo com uma etapa "viva" que aponta para o funil apagado: dado
    // velho de catálogo, não recorte aplicável.
    const comVelha: CatalogosDoFiltro = {
      ...DOIS,
      etapas: [...DOIS.etapas, etapa("ev", "morto", "Velha")],
    };
    const f = { ...FILTROS_VAZIOS, funilIds: ["morto", "p2"], etapaIds: ["ev", "e2"] };
    expect(limparOrfaos(f, comVelha)).toEqual({
      ...FILTROS_VAZIOS,
      funilIds: ["p2"],
      etapaIds: ["e2"],
    });
  });

  it("CRÍTICO: visão ANTIGA com funil apagado — a etapa dele morreu junto (cascata) e o recorte some", () => {
    const f = lerFiltroSalvo({ funilId: "morto", etapaId: "etapa-do-morto" });
    expect(limparOrfaos(f, DOIS)).toEqual(FILTROS_VAZIOS);
  });
});

// ============================================================
// ⚠️ As visões salvas ANTIGAS (um funil e uma etapa, até 29/09/2026).
//
// Estão no banco de cada membro — as "Bancário"/"Trabalhista" foram copiadas
// aos 12 — e nenhuma migration as converte: `lerFiltroSalvo` traduz na
// leitura, e o recorte tem de responder EXATAMENTE como respondia.
// ============================================================

describe("visões salvas ANTIGAS (funilId/etapaId) continuam recortando igual", () => {
  // e1 e e3 são do p1; e2 do p2. ct1 em e1; ct2 em e2 e e3; ct9 sem negócio.
  const etapaPorContato = new Map([
    ["ct1", new Set(["e1"])],
    ["ct2", new Set(["e2", "e3"])],
  ]);
  const funilPorEtapa = new Map([
    ["e1", "p1"],
    ["e2", "p2"],
    ["e3", "p1"],
  ]);
  const quemCasa = (bruto: unknown) =>
    ["ct1", "ct2", "ct9"].filter((id) =>
      casaComAEtapa(
        { id: "c", contact_id: id } as Conversation,
        lerFiltroSalvo(bruto),
        etapaPorContato,
        funilPorEtapa,
      ),
    );

  it("o JSON antigo vira lista de um, sem perder nada", () => {
    expect(lerFiltroSalvo({ funilId: "p1", etapaId: "e1" })).toEqual({
      ...FILTROS_VAZIOS,
      funilIds: ["p1"],
      etapaIds: ["e1"],
    });
    expect(lerFiltroSalvo({ etapaId: SEM_ETAPA }).etapaIds).toEqual([SEM_ETAPA]);
    // Sem o campo, sem recorte — como antes.
    expect(lerFiltroSalvo({ funilId: null, etapaId: null })).toEqual(FILTROS_VAZIOS);
  });

  it("só a etapa: quem tem negócio nela", () => {
    expect(quemCasa({ funilId: null, etapaId: "e1" })).toEqual(["ct1"]);
  });

  it("só o funil: quem tem negócio em QUALQUER etapa dele", () => {
    expect(quemCasa({ funilId: "p1", etapaId: null })).toEqual(["ct1", "ct2"]);
    expect(quemCasa({ funilId: "p2" })).toEqual(["ct2"]);
  });

  it("funil com etapa dele: só a etapa (ela refina o funil)", () => {
    expect(quemCasa({ funilId: "p1", etapaId: "e3" })).toEqual(["ct2"]);
  });

  it("'Sem negócio': só quem não tem negócio nenhum", () => {
    expect(quemCasa({ funilId: null, etapaId: SEM_ETAPA })).toEqual(["ct9"]);
  });

  it("nenhum dos dois: não recorta", () => {
    expect(quemCasa({ funilId: null, etapaId: null })).toEqual(["ct1", "ct2", "ct9"]);
  });
});

describe("funilIds/etapaIds — vários funis e etapas num filtro (29/09)", () => {
  it("a lista nova vence o valor antigo quando os dois vêm; lixo vira sem recorte", () => {
    expect(lerFiltroSalvo({ funilId: "p9", funilIds: ["p1", "p2"] }).funilIds).toEqual([
      "p1",
      "p2",
    ]);
    expect(lerFiltroSalvo({ etapaId: "e9", etapaIds: ["e1"] }).etapaIds).toEqual(["e1"]);
    // Lista vazia ou de lixo cai para o antigo, que é o que há de legível.
    expect(lerFiltroSalvo({ etapaId: "e9", etapaIds: [] }).etapaIds).toEqual(["e9"]);
    for (const lixo of ["p1", 42, { a: 1 }, [null, 3, ""], true]) {
      expect(lerFiltroSalvo({ funilIds: lixo, etapaIds: lixo })).toEqual(FILTROS_VAZIOS);
    }
    // Sem repetição, aparado.
    expect(lerFiltroSalvo({ etapaIds: ["e1", " e1 ", "e2"] }).etapaIds).toEqual(["e1", "e2"]);
  });

  it("mesmoFiltro compara funis e etapas como CONJUNTO", () => {
    const a = { ...FILTROS_VAZIOS, funilIds: ["p1", "p2"], etapaIds: ["e1", SEM_ETAPA] };
    expect(
      mesmoFiltro(a, { ...a, funilIds: ["p2", "p1"], etapaIds: [SEM_ETAPA, "e1"] }),
    ).toBe(true);
    expect(mesmoFiltro(a, { ...a, funilIds: ["p1"] })).toBe(false);
    expect(mesmoFiltro(a, { ...a, etapaIds: ["e1"] })).toBe(false);
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

describe("canalIds — várias conexões num filtro (03/09)", () => {
  const cat = {
    canais: [
      { id: "c1", label: "Comercial" },
      { id: "c2", label: "Jurídico" },
    ],
    responsaveis: [],
    etapas: [],
    funis: new Map(),
    etiquetas: [],
  } as unknown as Parameters<typeof descreverFiltro>[1];

  it("lê o formato antigo (canalId) e o novo (canalIds), sem repetição nem lixo", () => {
    expect(lerFiltroSalvo({ canalId: "c1" }).canalIds).toEqual(["c1"]);
    expect(lerFiltroSalvo({ canalIds: ["c1", "c2", "c1", "", 3] }).canalIds).toEqual(["c1", "c2"]);
    expect(lerFiltroSalvo({ canalIds: "c1" }).canalIds).toEqual([]);
    // o novo vence o antigo quando os dois vêm
    expect(lerFiltroSalvo({ canalId: "c9", canalIds: ["c1"] }).canalIds).toEqual(["c1"]);
  });

  it("mesmoFiltro ignora a ordem das conexões", () => {
    expect(
      mesmoFiltro(
        { ...FILTROS_VAZIOS, canalIds: ["c1", "c2"] },
        { ...FILTROS_VAZIOS, canalIds: ["c2", "c1"] },
      ),
    ).toBe(true);
    expect(
      mesmoFiltro({ ...FILTROS_VAZIOS, canalIds: ["c1"] }, { ...FILTROS_VAZIOS, canalIds: ["c1", "c2"] }),
    ).toBe(false);
  });

  it("descreve várias conexões num pedaço só, com ' ou '", () => {
    const p = descreverFiltro({ ...FILTROS_VAZIOS, canalIds: ["c1", "c2"] }, cat);
    expect(p).toHaveLength(1);
    expect(p[0].rotulo).toEqual({ fonte: "dado", texto: "Comercial ou Jurídico" });
    expect(p[0].limpar).toEqual({ canalIds: [] });
  });

  it("limparOrfaos tira só o id morto e mantém os vivos", () => {
    expect(limparOrfaos({ ...FILTROS_VAZIOS, canalIds: ["c1", "morto", "c2"] }, cat).canalIds).toEqual([
      "c1",
      "c2",
    ]);
    // catálogo vazio não prova nada: nada é descartado
    expect(
      limparOrfaos({ ...FILTROS_VAZIOS, canalIds: ["morto"] }, { ...cat, canais: [] }).canalIds,
    ).toEqual(["morto"]);
  });
});

// ============================================================
// A ABA não faz parte da visão (03/09, segunda rodada): o chip aceso na aba
// Abertas continua aceso em Encerradas, e nada é gravado sobre ela.
// ============================================================
describe("a aba fica fora da visão salva", () => {
  it("mesmoFiltro ignora `status`", () => {
    const a = { ...FILTROS_VAZIOS, canalIds: ["c1"] };
    expect(mesmoFiltro(a, { ...a, status: "closed" })).toBe(true);
  });

  it("descreverFiltro não descreve a aba", () => {
    expect(descreverFiltro({ ...FILTROS_VAZIOS, status: "closed" }, CAT)).toEqual([]);
  });
});
