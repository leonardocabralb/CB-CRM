import { describe, expect, it } from "vitest";

import { comparar, coorteDoPeriodo, resumoDoPeriodo } from "./coorte";
import { classificarEtapas, type EtapaMinima } from "./degraus";
import { intervaloDoPreset, periodoAnterior } from "./periodo";
import { fatosDoNegocio, type LinhaDeTrajetoria, type PassoDoTrajeto } from "./trajetoria";

const FUNIL = "funil-comercial";
const OUTRO = "funil-juridico";
// quinta, 3 de setembro de 2026, 18h local
const AGORA = new Date(2026, 8, 3, 18, 0, 0);

const etapa = (id: string, position: number, degrau: string | null): EtapaMinima => ({
  id,
  name: `Etapa ${id}`,
  position,
  degrau,
});

const ETAPAS: EtapaMinima[] = [
  etapa("avulso", 0, "lead"),
  etapa("desq", 1, "perda"),
  etapa("mql1", 3, "mql"),
  etapa("reuniao", 4, "reuniao"),
  etapa("noshow", 6, "perda"),
  etapa("proposta", 8, "proposta"),
  etapa("contrato", 9, "contrato"),
  etapa("parking", 11, null),
];
const CLASSIFICACAO = classificarEtapas(ETAPAS);

const passo = (etapaId: string, em: string, funil = FUNIL, tipo = "stage_changed"): PassoDoTrajeto => ({
  etapa: etapaId,
  funil,
  em,
  origem: "usuario",
  tipo,
});

// instantes LOCAIS, para o dia da entrada bater com o fuso da máquina
const em = (dia: number, hora: number, mes0 = 8) => new Date(2026, mes0, dia, hora).toISOString();

function negocio(
  id: string,
  stageId: string,
  trajeto: PassoDoTrajeto[],
  sobre: Partial<LinhaDeTrajetoria> = {},
): LinhaDeTrajetoria {
  return {
    deal_id: id,
    contact_id: null,
    conversation_id: null,
    conversa_do_contato: null,
    title: id,
    value: 0,
    status: "open",
    pipeline_id: FUNIL,
    stage_id: stageId,
    channel_id: null,
    source: "channel",
    assigned_to: null,
    created_at: trajeto[0]?.em ?? em(1, 9),
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
  // A: lead só (sem avanço) — dia 1
  negocio("A", "avulso", [passo("avulso", em(1, 9), FUNIL, "deal_created")]),
  // B: lead → mql — dia 1
  negocio("B", "mql1", [passo("avulso", em(1, 10), FUNIL, "deal_created"), passo("mql1", em(2, 10))]),
  // C: lead → mql → reunião → proposta → contrato (24.000) — dia 1
  negocio(
    "C",
    "contrato",
    [
      passo("avulso", em(1, 11), FUNIL, "deal_created"),
      passo("mql1", em(1, 12)),
      passo("reuniao", em(2, 12)),
      passo("proposta", em(3, 9)),
      passo("contrato", em(3, 12)),
    ],
    { value: 24000 },
  ),
  // D: lead → proposta (pulou mql e reunião; em aberto na proposta) — dia 2
  negocio("D", "proposta", [passo("avulso", em(2, 9), FUNIL, "deal_created"), passo("proposta", em(3, 10))]),
  // E: lead → mql → no show (perdido) — dia 2
  negocio("E", "noshow", [
    passo("avulso", em(2, 10), FUNIL, "deal_created"),
    passo("mql1", em(2, 11)),
    passo("noshow", em(3, 11)),
  ]),
  // F: lead → desqualificado (perdido) — dia 2
  negocio("F", "desq", [passo("avulso", em(2, 11), FUNIL, "deal_created"), passo("desq", em(2, 12))]),
  // G: nascido no estacionamento, nunca movido — FORA da coorte
  negocio("G", "parking", [passo("parking", em(2, 12), FUNIL, "deal_created")]),
  // H: lead → mql → reunião → contrato (18.000) → TRANSFERIDO para o jurídico — dia 3
  negocio(
    "H",
    "cliente-ativo",
    [
      passo("avulso", em(3, 8), FUNIL, "deal_created"),
      passo("mql1", em(3, 9)),
      passo("reuniao", em(3, 10)),
      passo("contrato", em(3, 11)),
      passo("cliente-ativo", em(3, 12), OUTRO, "pipeline_changed"),
    ],
    { value: 18000, pipeline_id: OUTRO },
  ),
  // I: entrou em AGOSTO (fora do período de setembro), lead → mql
  negocio("I", "mql1", [passo("avulso", em(30, 9, 7), FUNIL, "deal_created"), passo("mql1", em(31, 9, 7))]),
  // J: lead → mql → lead (voltou; em andamento) — dia 3
  negocio("J", "avulso", [
    passo("avulso", em(3, 9), FUNIL, "deal_created"),
    passo("mql1", em(3, 10)),
    passo("avulso", em(3, 11)),
  ]),
];

const FATOS = LINHAS.map((l) => fatosDoNegocio(l, FUNIL, CLASSIFICACAO));
const SETEMBRO = intervaloDoPreset("este_mes", AGORA);

describe("coorteDoPeriodo (regra 2)", () => {
  it("é quem ENTROU no período — nem o estacionado, nem o de agosto", () => {
    expect(coorteDoPeriodo(FATOS, SETEMBRO).map((f) => f.linha.deal_id)).toEqual([
      "A", "B", "C", "D", "E", "F", "H", "J",
    ]);
  });

  it("Total pega todo mundo que entrou, em qualquer mês", () => {
    expect(coorteDoPeriodo(FATOS, { desde: null, ate: null })).toHaveLength(9);
  });
});

describe("resumoDoPeriodo — o funil de eficiência de setembro", () => {
  const r = resumoDoPeriodo(FATOS, CLASSIFICACAO, SETEMBRO, AGORA);

  it("entradas e alcance monotônico por degrau (regra 3)", () => {
    expect(r.entradas).toBe(8);
    expect(r.porDegrau.map((d) => [d.degrau, d.alcancaram])).toEqual([
      ["lead", 8],
      ["mql", 6],
      ["reuniao", 3],
      ["proposta", 3],
      ["contrato", 2],
    ]);
  });

  it("taxa do degrau anterior: a primeira é sobre as entradas", () => {
    expect(r.porDegrau.map((d) => d.taxaDoAnterior)).toEqual([1, 0.75, 0.5, 1, 2 / 3]);
    expect(r.porDegrau.every((d) => d.comEtapa)).toBe(true);
  });

  it("transições encadeadas e a global", () => {
    expect(r.transicoes.map((t) => [t.de, t.para, t.taxa])).toEqual([
      ["lead", "mql", 0.75],
      ["mql", "reuniao", 0.5],
      ["reuniao", "proposta", 1],
      ["proposta", "contrato", 2 / 3],
    ]);
    expect(r.global).toEqual({ de: "lead", para: "contrato", numerador: 2, denominador: 8, taxa: 0.25 });
  });

  it("negativos: um card por etapa de perda (com zero), sem avanço e em andamento", () => {
    expect(r.perdasPorEtapa).toEqual([
      { etapaId: "desq", nome: "Etapa desq", n: 1 },
      { etapaId: "noshow", nome: "Etapa noshow", n: 1 },
    ]);
    expect(r.perdidos).toBe(2);
    expect(r.semAvanco).toBe(1); // A
    expect(r.emAndamento).toBe(3); // B (mql), D (proposta), J (voltou para lead)
    expect(r.emAndamentoPorDegrau).toEqual({ mql: 1, proposta: 1, lead: 1 });
  });

  it("fechados contam o transferido para o jurídico (regra 6), com o valor", () => {
    expect(r.fechados).toBe(2);
    expect(r.valorFechado).toBe(42000);
    expect(r.ticketMedio).toBe(21000);
  });

  it("fechados + perdidos + sem avanço + em andamento = coorte", () => {
    // C e H estão em contrato (situação 'fechado'); os demais se repartem.
    const fechadosAgora = coorteDoPeriodo(FATOS, SETEMBRO).filter((f) => f.situacao === "fechado").length;
    expect(fechadosAgora + r.perdidos + r.semAvanco + r.emAndamento).toBe(r.entradas);
  });

  it("entradas por dia, densas do dia 1 até hoje", () => {
    expect(r.entradasPorDia).toEqual([
      { dia: "2026-09-01", n: 3 },
      { dia: "2026-09-02", n: 3 },
      { dia: "2026-09-03", n: 2 },
    ]);
  });

  it("período sem ninguém devolve zeros, taxas nulas e dias zerados", () => {
    const vazio = resumoDoPeriodo(FATOS, CLASSIFICACAO, intervaloDoPreset("ano_passado", AGORA), AGORA);
    expect(vazio.entradas).toBe(0);
    expect(vazio.porDegrau.every((d) => d.taxaDoAnterior === null)).toBe(true);
    expect(vazio.global?.taxa).toBeNull();
    expect(vazio.ticketMedio).toBeNull();
    expect(vazio.entradasPorDia).toHaveLength(365);
    expect(vazio.entradasPorDia.every((d) => d.n === 0)).toBe(true);
  });

  it("Total: entradas por dia esparsas (só dias com lead), em ordem", () => {
    const total = resumoDoPeriodo(FATOS, CLASSIFICACAO, { desde: null, ate: null }, AGORA);
    expect(total.entradasPorDia.map((d) => d.dia)).toEqual([
      "2026-08-30",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });
});

describe("degrau SEM etapa correspondente", () => {
  const semProposta = classificarEtapas(ETAPAS.filter((e) => e.id !== "proposta"));
  const fatos = LINHAS.map((l) => fatosDoNegocio(l, FUNIL, semProposta));
  const r = resumoDoPeriodo(fatos, semProposta, SETEMBRO, AGORA);

  it("o card sai tracejado e a cadeia pula o degrau (reunião → contrato)", () => {
    const proposta = r.porDegrau.find((d) => d.degrau === "proposta");
    expect(proposta?.comEtapa).toBe(false);
    expect(proposta?.taxaDoAnterior).toBeNull();
    expect(r.transicoes.map((t) => `${t.de}→${t.para}`)).toEqual([
      "lead→mql",
      "mql→reuniao",
      "reuniao→contrato",
    ]);
    // D entrou na etapa "proposta", que agora não tem degrau: fica de fora do alcance
    expect(r.porDegrau.find((d) => d.degrau === "contrato")?.taxaDoAnterior).toBe(2 / 2);
  });
});

describe("comparar — atual × anterior", () => {
  it("variação em fração para contagens e pp para taxas", () => {
    const atual = resumoDoPeriodo(FATOS, CLASSIFICACAO, SETEMBRO, AGORA);
    const anterior = resumoDoPeriodo(FATOS, CLASSIFICACAO, periodoAnterior(SETEMBRO, AGORA)!, AGORA);
    expect(anterior.entradas).toBe(1); // I, em 30/08
    const c = comparar(atual, anterior);
    expect(c.entradas).toEqual({ atual: 8, anterior: 1, variacao: 7 });
    expect(c.fechados).toEqual({ atual: 2, anterior: 0, variacao: null });
    expect(c.global).toEqual({ atual: 0.25, anterior: 0, pp: 25 });
    expect(c.transicoes[0]).toEqual({ de: "lead", para: "mql", atual: 0.75, anterior: 1, pp: -25 });
  });

  it("sem período anterior (Total) os deltas ficam nulos", () => {
    const atual = resumoDoPeriodo(FATOS, CLASSIFICACAO, { desde: null, ate: null }, AGORA);
    const c = comparar(atual, null);
    expect(c.entradas.variacao).toBeNull();
    expect(c.global?.pp).toBeNull();
    expect(c.transicoes.every((t) => t.pp === null)).toBe(true);
  });
});
