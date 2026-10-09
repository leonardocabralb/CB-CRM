import { describe, expect, it } from "vitest";

import { agendamentosDe, comparar, resumoDoPeriodo, taxaDeNoShow } from "./coorte";
import { custosDoResumo } from "./custos";
import { classificarEtapas, type EtapaMinima } from "./degraus";
import { cartoesDeCustoNaTela, lerPainel } from "./painel";
import type { Intervalo } from "./periodo";
import { periodoSemAtividade, resumoPorPeriodo } from "./por-periodo";
import { fatosDoNegocio, type LinhaDeTrajetoria, type PassoDoTrajeto } from "./trajetoria";

/**
 * O NO-SHOW no Desempenho e na Saúde (decisão do operador, 09/10/2026):
 *
 *  - conta pelas TRANSIÇÕES do card, como o resto do funil;
 *  - cada ENTRADA numa etapa marcada "Faltou" é um no-show (quem faltou duas
 *    vezes no mês são dois);
 *  - a taxa é no-shows ÷ agendamentos (quem alcançou o degrau reunião);
 *  - a etapa "Reagendar" é fila de trabalho interna e NÃO entra na conta:
 *    quem faltou e foi depois para Reagendar continua com o no-show; quem
 *    avisou antes e foi direto para lá nunca entrou no No Show.
 *
 * Funil fictício no molde do comercial bancário.
 */
const FUNIL = "funil-comercial";
const OUTRO = "funil-juridico";
const etapa = (id: string, position: number, degrau: string | null, desfecho: EtapaMinima["desfecho_da_reuniao"] = null): EtapaMinima => ({
  id,
  name: id,
  position,
  degrau,
  desfecho_da_reuniao: desfecho,
});
const ETAPAS = [
  etapa("lead", 0, "lead"),
  etapa("agendada", 4, "reuniao"),
  etapa("mql2", 5, "reuniao", "qualificada"),
  etapa("no-show", 6, "reuniao", "faltou"),
  etapa("reagendar", 7, "reuniao", "reagendar"),
  etapa("sem-proposta", 8, "reuniao", "compareceu"),
  // Marca em etapa de proposta em diante NÃO vale (`marcaDaReuniaoQueVale`).
  etapa("proposta", 9, "proposta", "faltou"),
  etapa("perdido", 11, "perda"),
];
const C = classificarEtapas(ETAPAS);

const p = (etapaId: string, em: string, funil = FUNIL): PassoDoTrajeto => ({
  etapa: etapaId,
  funil,
  em,
  origem: "usuario",
  tipo: "stage_changed",
});

function negocio(id: string, trajeto: PassoDoTrajeto[], pipelineId = FUNIL): LinhaDeTrajetoria {
  const ultimo = trajeto[trajeto.length - 1];
  return {
    deal_id: id,
    contact_id: null,
    conversation_id: null,
    conversa_do_contato: null,
    title: id,
    value: 0,
    status: "open",
    pipeline_id: pipelineId,
    stage_id: ultimo.etapa ?? "",
    channel_id: null,
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
  };
}

const fatosDe = (linhas: LinhaDeTrajetoria[]) => linhas.map((l) => fatosDoNegocio(l, FUNIL, C));
const SETEMBRO: Intervalo = { desde: new Date("2026-09-01T00:00:00-03:00"), ate: new Date("2026-10-01T00:00:00-03:00") };
const OUTUBRO: Intervalo = { desde: new Date("2026-10-01T00:00:00-03:00"), ate: new Date("2026-11-01T00:00:00-03:00") };
const AGORA = new Date("2026-10-20T12:00:00-03:00");

describe("as etapas que contam como no-show", () => {
  it("só a marca 'Faltou' que VALE: nem Qualificada, nem Reagendar, nem Compareceu, nem marca em etapa de proposta", () => {
    expect([...C.etapasDeFalta]).toEqual(["no-show"]);
  });

  it("funil sem marca não mede no-show (etapa sem o campo também)", () => {
    expect(classificarEtapas([{ id: "a", name: "a", position: 0, degrau: "lead" }]).etapasDeFalta.size).toBe(0);
  });
});

describe("entradasEmFalta: cada entrada do card numa etapa 'Faltou', NESTE funil", () => {
  it("cada entrada conta; Reagendar depois do No Show não apaga a falta", () => {
    const [f] = fatosDe([
      negocio("joao", [
        p("lead", "2026-10-01T10:00:00-03:00"),
        p("agendada", "2026-10-01T11:00:00-03:00"),
        p("no-show", "2026-10-05T15:00:00-03:00"),
        p("reagendar", "2026-10-08T10:00:00-03:00"),
        p("agendada", "2026-10-10T09:00:00-03:00"),
        p("no-show", "2026-10-15T15:00:00-03:00"),
      ]),
    ]);
    expect(f.entradasEmFalta.map((d) => d.toISOString())).toEqual(["2026-10-05T18:00:00.000Z", "2026-10-15T18:00:00.000Z"]);
  });

  it("quem avisou antes e foi direto para Reagendar não tem no-show", () => {
    const [f] = fatosDe([negocio("ana", [p("lead", "2026-10-01T10:00:00-03:00"), p("agendada", "2026-10-02T10:00:00-03:00"), p("reagendar", "2026-10-03T10:00:00-03:00")])]);
    expect(f.entradasEmFalta).toEqual([]);
  });

  it("a entrada no No Show de OUTRO funil não conta neste (o transferido conta só o que fez aqui)", () => {
    const [f] = fatosDe([
      negocio(
        "bia",
        [p("lead", "2026-10-01T10:00:00-03:00"), p("no-show", "2026-10-02T10:00:00-03:00"), p("no-show", "2026-10-09T10:00:00-03:00", OUTRO)],
        OUTRO,
      ),
    ]);
    expect(f.entradasEmFalta).toHaveLength(1);
  });
});

describe("no resumo: os dois modos, a taxa e a comparação", () => {
  const linhas = [
    // agendou em setembro, faltou em setembro e de novo em outubro
    negocio("joao", [
      p("lead", "2026-09-10T10:00:00-03:00"),
      p("agendada", "2026-09-11T10:00:00-03:00"),
      p("no-show", "2026-09-20T15:00:00-03:00"),
      p("reagendar", "2026-09-22T10:00:00-03:00"),
      p("agendada", "2026-10-02T10:00:00-03:00"),
      p("no-show", "2026-10-05T15:00:00-03:00"),
    ]),
    // entrou e agendou em outubro, compareceu sem proposta
    negocio("ana", [p("lead", "2026-10-01T10:00:00-03:00"), p("agendada", "2026-10-02T10:00:00-03:00"), p("sem-proposta", "2026-10-06T15:00:00-03:00")]),
    // entrou e agendou em outubro, avisou e foi para Reagendar
    negocio("caio", [p("lead", "2026-10-01T10:00:00-03:00"), p("agendada", "2026-10-03T10:00:00-03:00"), p("reagendar", "2026-10-04T10:00:00-03:00")]),
  ];
  const fatos = fatosDe(linhas);

  it("por PERÍODO: as entradas que aconteceram no período, venha o lead de quando vier", () => {
    const outubro = resumoPorPeriodo(fatos, C, OUTUBRO, AGORA);
    // João já tinha alcançado reunião em setembro: o agendamento de outubro é dele de lá.
    expect(agendamentosDe(outubro)).toBe(2);
    expect(outubro.noShows).toBe(1);
    expect(taxaDeNoShow(outubro)).toBe(0.5);
    const setembro = resumoPorPeriodo(fatos, C, SETEMBRO, AGORA);
    expect(setembro.noShows).toBe(1);
    expect(taxaDeNoShow(setembro)).toBe(1);
  });

  it("por MÊS DE ENTRADA: todas as entradas dos leads que entraram no período", () => {
    const setembro = resumoDoPeriodo(fatos, C, SETEMBRO, AGORA);
    expect(setembro.entradas).toBe(1);
    expect(setembro.noShows).toBe(2);
    // Cada entrada conta: dois no-shows de um agendamento passam de 100%.
    expect(taxaDeNoShow(setembro)).toBe(2);
    const outubro = resumoDoPeriodo(fatos, C, OUTUBRO, AGORA);
    expect(outubro.noShows).toBe(0);
    expect(taxaDeNoShow(outubro)).toBe(0);
  });

  it("taxa sem agendamento é NULA ('—'), nunca 0%", () => {
    const vazio = resumoPorPeriodo([], C, OUTUBRO, AGORA);
    expect(vazio.noShows).toBe(0);
    expect(taxaDeNoShow(vazio)).toBeNull();
  });

  it("comparar: agendamentos, no-shows e a taxa, com as variações de sempre", () => {
    const c = comparar(resumoPorPeriodo(fatos, C, OUTUBRO, AGORA), resumoPorPeriodo(fatos, C, SETEMBRO, AGORA));
    expect(c.agendamentos).toEqual({ atual: 2, anterior: 1, variacao: 1 });
    expect(c.noShows).toEqual({ atual: 1, anterior: 1, variacao: 0 });
    expect(c.taxaDeNoShow.pp).toBeCloseTo(-50);
    const semAnterior = comparar(resumoPorPeriodo(fatos, C, OUTUBRO, AGORA), null);
    expect(semAnterior.noShows.variacao).toBeNull();
    expect(semAnterior.taxaDeNoShow.pp).toBeNull();
  });

  it("um no-show no período é atividade: a nota 'Nada aconteceu' não aparece", () => {
    const so = fatosDe([
      negocio("davi", [p("lead", "2026-08-01T10:00:00-03:00"), p("agendada", "2026-08-02T10:00:00-03:00"), p("no-show", "2026-10-05T15:00:00-03:00")]),
    ]);
    const outubro = resumoPorPeriodo(so, C, OUTUBRO, AGORA);
    expect(outubro.noShows).toBe(1);
    expect(periodoSemAtividade(outubro)).toBe(false);
  });
});

describe("o custo por no-show", () => {
  const resumo = resumoPorPeriodo(
    fatosDe([
      negocio("joao", [p("lead", "2026-10-01T10:00:00-03:00"), p("agendada", "2026-10-02T10:00:00-03:00"), p("no-show", "2026-10-05T15:00:00-03:00")]),
      negocio("bia", [p("lead", "2026-10-01T10:00:00-03:00"), p("agendada", "2026-10-02T10:00:00-03:00"), p("no-show", "2026-10-06T15:00:00-03:00")]),
    ]),
    C,
    OUTUBRO,
    AGORA,
  );

  it("investimento ÷ no-shows; sem no-show, nulo", () => {
    expect(custosDoResumo(1000, resumo).no_show).toBe(500);
    expect(custosDoResumo(1000, resumoPorPeriodo([], C, OUTUBRO, AGORA)).no_show).toBeNull();
  });

  it("o cartão só aparece no funil com etapa 'Faltou', e some quando o operador o esconde", () => {
    expect(cartoesDeCustoNaTela(C, lerPainel({}))).toContain("no_show");
    expect(cartoesDeCustoNaTela(C, lerPainel({ custos_ocultos: ["no_show"] }))).not.toContain("no_show");
    const semFalta = classificarEtapas(ETAPAS.map((e) => ({ ...e, desfecho_da_reuniao: null })));
    expect(cartoesDeCustoNaTela(semFalta, lerPainel({}))).not.toContain("no_show");
  });

  it("vem logo depois do custo por reunião", () => {
    const cartoes = cartoesDeCustoNaTela(C, lerPainel({}));
    expect(cartoes.indexOf("no_show")).toBe(cartoes.indexOf("reuniao") + 1);
  });
});
