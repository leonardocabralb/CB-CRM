import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resumoDoPeriodo } from "./coorte";
import { custosDoResumo } from "./custos";
import { classificarEtapas, desqualificacaoQueVale, type EtapaMinima } from "./degraus";
import { CARTOES_DE_CUSTO, cartoesDeCustoNaTela, funilMedeDesqualificacao, lerPainel } from "./painel";
import type { Intervalo } from "./periodo";
import { periodoSemAtividade, resumoPorPeriodo } from "./por-periodo";
import { fatosDoNegocio, type LinhaDeTrajetoria, type PassoDoTrajeto } from "./trajetoria";

/**
 * O CUSTO POR DESQUALIFICADO (1091; pedido do operador, 13/10/2026):
 *
 *  - a etapa de desqualificação é uma etapa de PERDA marcada em Gerenciar
 *    funil — "Perdido" e "Não Respondeu" são perda e não são
 *    desqualificação;
 *  - conta CARDS que entraram numa etapa marcada (o mesmo card duas vezes é
 *    um só), pelas transições, como o resto do funil;
 *  - custo = investimento ÷ desqualificados, nos dois modos.
 *
 * Funil fictício no molde do comercial.
 */
const FUNIL = "funil-comercial";
const OUTRO = "funil-juridico";
const etapa = (id: string, position: number, degrau: string | null, desqualificacao = false): EtapaMinima => ({
  id,
  name: id,
  position,
  degrau,
  desqualificacao,
});
const ETAPAS = [
  etapa("lead", 0, "lead"),
  etapa("desqualificado", 1, "perda", true),
  etapa("qualificado", 2, "mql"),
  etapa("reuniao", 3, "reuniao"),
  etapa("contrato", 4, "contrato"),
  etapa("nao-respondeu", 5, "perda"),
  etapa("perdido", 6, "perda"),
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

describe("a marca só vale na perda", () => {
  it("desqualificacaoQueVale: perda marcada, e mais nada", () => {
    expect(desqualificacaoQueVale("perda", true)).toBe(true);
    expect(desqualificacaoQueVale("perda", false)).toBe(false);
    expect(desqualificacaoQueVale("perda", undefined)).toBe(false);
    expect(desqualificacaoQueVale("mql", true)).toBe(false);
    expect(desqualificacaoQueVale(null, true)).toBe(false);
  });

  it("só a etapa marcada entra: Perdido e Não Respondeu são perda, não desqualificação", () => {
    expect([...C.etapasDeDesqualificacao]).toEqual(["desqualificado"]);
  });

  it("funil sem marca não separa a desqualificação (etapa sem o campo também)", () => {
    const semMarca = classificarEtapas([etapa("lead", 0, "lead"), { id: "x", name: "x", position: 1, degrau: "perda" }]);
    expect(semMarca.etapasDeDesqualificacao.size).toBe(0);
    expect(funilMedeDesqualificacao(semMarca)).toBe(false);
    expect(funilMedeDesqualificacao(C)).toBe(true);
  });
});

describe("entradasEmDesqualificacao: as entradas do card NESTE funil", () => {
  it("a semente da 912 CONTA (desqualificar é estado de perda, como lê o perdidoDesde)", () => {
    const [semente] = fatosDe([
      negocio("ana", [{ ...p("desqualificado", "2026-09-10T10:00:00-03:00"), tipo: "deal_created", origem: "retroativo" }]),
    ]);
    expect(semente.entradasEmDesqualificacao).toHaveLength(1);
    expect(semente.situacao).toBe("perdido");
  });

  it("a entrada na desqualificação de OUTRO funil não conta neste", () => {
    const [f] = fatosDe([
      negocio(
        "bia",
        [p("lead", "2026-10-01T10:00:00-03:00"), p("qualificado", "2026-10-02T10:00:00-03:00"), p("desqualificado", "2026-10-05T10:00:00-03:00", OUTRO)],
        OUTRO,
      ),
    ]);
    expect(f.entradasEmDesqualificacao).toEqual([]);
  });
});

describe("no resumo: CARDS desqualificados, nos dois modos", () => {
  const linhas = [
    // desqualificado em outubro, duas vezes (voltou e saiu de novo): UM card
    negocio("caio", [
      p("lead", "2026-10-01T10:00:00-03:00"),
      p("desqualificado", "2026-10-02T10:00:00-03:00"),
      p("qualificado", "2026-10-04T10:00:00-03:00"),
      p("desqualificado", "2026-10-06T10:00:00-03:00"),
    ]),
    // lead de setembro desqualificado em outubro
    negocio("davi", [p("lead", "2026-09-20T10:00:00-03:00"), p("desqualificado", "2026-10-03T10:00:00-03:00")]),
    // perdido em outubro (perda sem a marca): não é desqualificado
    negocio("eva", [p("lead", "2026-10-02T10:00:00-03:00"), p("perdido", "2026-10-08T10:00:00-03:00")]),
    // qualificado, segue no funil
    negocio("fabi", [p("lead", "2026-10-03T10:00:00-03:00"), p("qualificado", "2026-10-04T10:00:00-03:00")]),
  ];
  const fatos = fatosDe(linhas);

  it("por período: quem ENTROU numa etapa de desqualificação no período, uma vez por card", () => {
    expect(resumoPorPeriodo(fatos, C, OUTUBRO, AGORA).desqualificados).toBe(2);
    expect(resumoPorPeriodo(fatos, C, SETEMBRO, AGORA).desqualificados).toBe(0);
  });

  it("na coorte: os leads que entraram no período e foram desqualificados", () => {
    expect(resumoDoPeriodo(fatos, C, OUTUBRO, AGORA).desqualificados).toBe(1);
    expect(resumoDoPeriodo(fatos, C, SETEMBRO, AGORA).desqualificados).toBe(1);
  });

  it("desqualificação de lead antigo é atividade do período", () => {
    const soDavi = fatosDe([linhas[1]]);
    expect(periodoSemAtividade(resumoPorPeriodo(soDavi, C, OUTUBRO, AGORA))).toBe(false);
  });

  it("custo = investimento ÷ desqualificados; sem desqualificado, nulo", () => {
    expect(custosDoResumo(900, resumoPorPeriodo(fatos, C, OUTUBRO, AGORA)).desqualificado).toBe(450);
    expect(custosDoResumo(900, resumoPorPeriodo(fatos, C, SETEMBRO, AGORA)).desqualificado).toBeNull();
  });
});

describe("o cartão", () => {
  it("fica ao lado do custo por qualificado", () => {
    const i = CARTOES_DE_CUSTO.indexOf("desqualificado");
    expect(CARTOES_DE_CUSTO[i - 1]).toBe("mql");
  });

  it("aparece só no funil que marca a desqualificação, e some quando o operador o esconde", () => {
    expect(cartoesDeCustoNaTela(C, lerPainel(null))).toContain("desqualificado");
    const semMarca = classificarEtapas(ETAPAS.map((e) => ({ ...e, desqualificacao: false })));
    expect(cartoesDeCustoNaTela(semMarca, lerPainel(null))).not.toContain("desqualificado");
    expect(cartoesDeCustoNaTela(C, lerPainel({ custos_ocultos: ["desqualificado"] }))).not.toContain("desqualificado");
  });
});

describe("a migration e o código concordam", () => {
  const sql = readFileSync("supabase/migrations/1091_cb_etapa_de_desqualificacao.sql", "utf-8");

  it("o CHECK prende a marca à perda, e com IS NOT DISTINCT FROM (com `=`, degrau nulo passaria)", () => {
    expect(sql).toMatch(/CHECK \(NOT desqualificacao OR degrau IS NOT DISTINCT FROM 'perda'\)/);
  });

  it("a coluna nasce NOT NULL DEFAULT false (etapa nova nasce desmarcada)", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS desqualificacao boolean NOT NULL DEFAULT false/);
  });
});
