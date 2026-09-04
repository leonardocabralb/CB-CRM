import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { classificarEtapas, type EtapaMinima } from "./degraus";
import {
  COLUNAS_FIXAS,
  COLUNAS_PADRAO,
  COLUNAS_SEMPRE,
  FILTROS_VAZIOS,
  ORDENACAO_PADRAO,
  alternarOrdenacao,
  colunaDoCampo,
  filtrarLinhas,
  linhasDoCsv,
  linhasDoFunil,
  noPeriodo,
  normalizarColunas,
  ordenarLinhas,
  valorParaCsv,
  type ContextoDoCsv,
} from "./lista";
import { PRESETS, intervaloDoPreset } from "./periodo";
import { fatosDoNegocio, type LinhaDeTrajetoria, type PassoDoTrajeto, type Situacao } from "./trajetoria";

const FUNIL = "f";
const OUTRO = "g";
const AGORA = new Date(2026, 8, 3, 18);

const etapa = (id: string, position: number, degrau: string | null): EtapaMinima => ({
  id,
  name: `Etapa ${id}`,
  position,
  degrau,
});
const ETAPAS = [
  etapa("lead", 0, "lead"),
  etapa("mql", 1, "mql"),
  etapa("perda", 2, "perda"),
  etapa("contrato", 3, "contrato"),
];
const CLASSIFICACAO = classificarEtapas(ETAPAS);
const POSICAO = new Map(ETAPAS.map((e) => [e.id, e.position]));

const passo = (etapaId: string, em: string, funil = FUNIL, tipo = "stage_changed"): PassoDoTrajeto => ({
  etapa: etapaId,
  funil,
  em,
  origem: "usuario",
  tipo,
});
const em = (dia: number, hora = 10, mes0 = 8) => new Date(2026, mes0, dia, hora).toISOString();

function negocio(id: string, stageId: string, trajeto: PassoDoTrajeto[], sobre: Partial<LinhaDeTrajetoria> = {}): LinhaDeTrajetoria {
  return {
    deal_id: id,
    contact_id: `c-${id}`,
    conversation_id: null,
    conversa_do_contato: `conv-${id}`,
    title: `Negócio ${id}`,
    value: 0,
    status: "open",
    pipeline_id: FUNIL,
    stage_id: stageId,
    channel_id: "canal-1",
    source: "channel",
    assigned_to: null,
    created_at: trajeto[0].em,
    updated_at: null,
    contato_nome: null,
    contato_telefone: null,
    contato_email: null,
    contato_empresa: null,
    contato_avatar: null,
    campos: {},
    trajeto,
    ...sobre,
  };
}

const LINHAS: LinhaDeTrajetoria[] = [
  negocio("a", "lead", [passo("lead", em(1), FUNIL, "deal_created")], {
    contato_nome: "José Antônio",
    contato_telefone: "+55 11 99999-0001",
    contato_email: "jose@x.com",
  }),
  negocio("b", "mql", [passo("lead", em(2), FUNIL, "deal_created"), passo("mql", em(3, 9))], {
    contato_nome: "Ana Souza",
    contato_telefone: "5511988880002",
    value: 18000,
    campos: { utm_source: "meta" },
  }),
  negocio("c", "perda", [passo("lead", em(3), FUNIL, "deal_created"), passo("perda", em(3, 11))], {
    contato_nome: "Carlos",
    value: 500,
  }),
  // d: transferido para outro funil — fica FORA da lista
  negocio("d", "x", [passo("lead", em(3, 12), FUNIL, "deal_created"), passo("x", em(3, 13), OUTRO, "pipeline_changed")], {
    pipeline_id: OUTRO,
    contato_nome: "Dora",
  }),
  // e: criado em agosto
  negocio("e", "contrato", [passo("lead", em(20, 10, 7), FUNIL, "deal_created"), passo("contrato", em(25, 10, 7))], {
    contato_nome: "Eduardo",
    value: 24000,
  }),
];
const FATOS = LINHAS.map((l) => fatosDoNegocio(l, FUNIL, CLASSIFICACAO));
const NO_FUNIL = linhasDoFunil(FATOS);

describe("colunas", () => {
  it("normalizar: lixo vira o padrão; as obrigatórias voltam sempre; ordem fixa", () => {
    expect(normalizarColunas("nada")).toEqual(COLUNAS_PADRAO);
    expect(normalizarColunas(["valor", "campo:utm_source", "data", 42, "inexistente"])).toEqual([
      "numero",
      "data",
      "nome",
      "etapa",
      "valor",
      "campo:utm_source",
    ]);
    for (const c of COLUNAS_SEMPRE) expect(COLUNAS_PADRAO).toContain(c);
  });

  it("alternar: mesma coluna inverte; coluna nova nasce na direção natural", () => {
    expect(alternarOrdenacao(ORDENACAO_PADRAO, "naEtapaDesde")).toEqual({ coluna: "naEtapaDesde", direcao: "asc" });
    expect(alternarOrdenacao(ORDENACAO_PADRAO, "nome")).toEqual({ coluna: "nome", direcao: "asc" });
    expect(alternarOrdenacao(ORDENACAO_PADRAO, "valor")).toEqual({ coluna: "valor", direcao: "desc" });
  });
});

describe("recorte", () => {
  it("a lista mostra só quem está NESTE funil (o transferido fica com o painel)", () => {
    expect(NO_FUNIL.map((f) => f.linha.deal_id)).toEqual(["a", "b", "c", "e"]);
  });

  it("período pela CRIAÇÃO (D3): setembro deixa agosto de fora", () => {
    const set = noPeriodo(NO_FUNIL, intervaloDoPreset("este_mes", AGORA));
    expect(set.map((f) => f.linha.deal_id)).toEqual(["a", "b", "c"]);
    expect(noPeriodo(NO_FUNIL, { desde: null, ate: null })).toHaveLength(4);
  });

  it("busca sem acento por nome, por título, por e-mail e por dígitos do telefone", () => {
    const ids = (busca: string) => filtrarLinhas(NO_FUNIL, { ...FILTROS_VAZIOS, busca }).map((f) => f.linha.deal_id);
    expect(ids("jose antonio")).toEqual(["a"]);
    expect(ids("ANTÔNIO")).toEqual(["a"]);
    expect(ids("negócio c")).toEqual(["c"]);
    expect(ids("jose@")).toEqual(["a"]);
    expect(ids("99999")).toEqual(["a"]);
    expect(ids("(11) 98888")).toEqual(["b"]);
    expect(ids("zz")).toEqual([]);
    expect(ids("  ")).toHaveLength(4);
  });

  it("etapa e situação são E lógico com a busca", () => {
    expect(filtrarLinhas(NO_FUNIL, { ...FILTROS_VAZIOS, etapaId: "mql" }).map((f) => f.linha.deal_id)).toEqual(["b"]);
    expect(filtrarLinhas(NO_FUNIL, { ...FILTROS_VAZIOS, situacao: "perdido" }).map((f) => f.linha.deal_id)).toEqual(["c"]);
    expect(filtrarLinhas(NO_FUNIL, { busca: "ana", etapaId: "lead", situacao: "todas" })).toEqual([]);
  });
});

describe("ordenação", () => {
  it("padrão: na etapa desde, mais recente primeiro", () => {
    expect(ordenarLinhas(NO_FUNIL, ORDENACAO_PADRAO, POSICAO).map((f) => f.linha.deal_id)).toEqual(["c", "b", "a", "e"]);
  });

  it("por nome (sem caixa/acento), por valor e por etapa (posição)", () => {
    expect(ordenarLinhas(NO_FUNIL, { coluna: "nome", direcao: "asc" }, POSICAO).map((f) => f.linha.deal_id)).toEqual(["b", "c", "e", "a"]);
    expect(ordenarLinhas(NO_FUNIL, { coluna: "valor", direcao: "desc" }, POSICAO).map((f) => f.linha.deal_id)).toEqual(["e", "b", "c", "a"]);
    expect(ordenarLinhas(NO_FUNIL, { coluna: "etapa", direcao: "asc" }, POSICAO).map((f) => f.linha.deal_id)).toEqual(["a", "b", "c", "e"]);
  });

  it("nulos vão para o fim em qualquer direção (entrada no funil de quem nunca entrou)", () => {
    const semEntrada = fatosDoNegocio(
      negocio("z", "fora", [passo("fora", em(1, 8), FUNIL, "deal_created")], { contato_nome: "Zé" }),
      FUNIL,
      CLASSIFICACAO,
    );
    const lista = [...NO_FUNIL, semEntrada];
    expect(ordenarLinhas(lista, { coluna: "entrada", direcao: "asc" }, POSICAO).at(-1)?.linha.deal_id).toBe("z");
    expect(ordenarLinhas(lista, { coluna: "entrada", direcao: "desc" }, POSICAO).at(-1)?.linha.deal_id).toBe("z");
  });

  it("não muda a lista original", () => {
    const antes = NO_FUNIL.map((f) => f.linha.deal_id);
    ordenarLinhas(NO_FUNIL, { coluna: "valor", direcao: "desc" }, POSICAO);
    expect(NO_FUNIL.map((f) => f.linha.deal_id)).toEqual(antes);
  });
});

describe("CSV", () => {
  const ctx: ContextoDoCsv = {
    rotulos: Object.fromEntries(COLUNAS_FIXAS.map((c) => [c, c.toUpperCase()])) as Record<(typeof COLUNAS_FIXAS)[number], string>,
    rotuloDoCampo: (k) => `campo ${k}`,
    nomeDaEtapa: (id) => (id ? `Etapa ${id}` : "—"),
    nomeDoCanal: (id) => (id === "canal-1" ? "Comercial" : ""),
    nomeDoResponsavel: () => "",
    rotuloDaSituacao: (s) => s,
    formatarData: (d) => d.toISOString().slice(0, 10),
    formatarValor: valorParaCsv,
  };

  it("cabeçalho + linhas nas colunas visíveis, na ordem da tela", () => {
    const linhas = linhasDoCsv(NO_FUNIL.slice(0, 2), ["numero", "nome", "valor", colunaDoCampo("utm_source"), "conexao"], ctx);
    expect(linhas).toEqual([
      ["NUMERO", "NOME", "VALOR", "campo utm_source", "CONEXAO"],
      ["1", "José Antônio", "0,00", "", "Comercial"],
      ["2", "Ana Souza", "18000,00", "meta", "Comercial"],
    ]);
  });

  it("valor com vírgula decimal, sem R$ nem milhar", () => {
    expect(valorParaCsv(1234.5)).toBe("1234,50");
  });
});

describe("i18n — chaves montadas da lista nos dois dicionários", () => {
  const dicionarios = ["en", "pt-BR"].map((locale) => ({
    locale,
    funil: (JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
      Pipelines: { funil: Record<string, Record<string, unknown>> };
    }).Pipelines.funil,
  }));
  const SITUACOES: Situacao[] = ["fora_do_funil", "sem_avanco", "andamento", "fechado", "perdido"];

  for (const { locale, funil } of dicionarios) {
    it(`${locale}: colunas fixas, situações e presets de período têm rótulo`, () => {
      const colunas = (funil.lista as { colunas: Record<string, string> }).colunas;
      for (const c of COLUNAS_FIXAS) expect(colunas[c], `lista.colunas.${c}`).toBeTypeOf("string");
      const situacao = funil.situacao as Record<string, string>;
      for (const s of SITUACOES) expect(situacao[s], `situacao.${s}`).toBeTypeOf("string");
      const periodo = funil.periodo as Record<string, string>;
      for (const p of PRESETS) expect(periodo[p], `periodo.${p}`).toBeTypeOf("string");
    });
  }
});
