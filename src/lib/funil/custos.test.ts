import { describe, expect, it } from "vitest";

import { resumoDoPeriodo, type ResumoDoPeriodo } from "./coorte";
import { custosDoResumo, custosMensais } from "./custos";
import { classificarEtapas, type EtapaMinima } from "./degraus";
import type { Intervalo } from "./periodo";
import { MODOS_DE_CONTAGEM, resumoNoModo } from "./por-periodo";
import { coortesMensais } from "./saude";
import { fatosDoNegocio, type LinhaDeTrajetoria, type PassoDoTrajeto } from "./trajetoria";

const FUNIL = "trabalhista-comercial";
const AGORA = new Date("2026-09-20T12:00:00-03:00");
const SETEMBRO: Intervalo = { desde: new Date("2026-09-01T00:00:00-03:00"), ate: new Date("2026-10-01T00:00:00-03:00") };
const TOTAL: Intervalo = { desde: null, ate: null };

const etapa = (id: string, position: number, degrau: string | null): EtapaMinima => ({ id, name: id, position, degrau });
const p = (etapaId: string, em: string, tipo = "stage_changed"): PassoDoTrajeto => ({
  etapa: etapaId,
  funil: FUNIL,
  em,
  origem: "usuario",
  tipo,
});

function negocio(id: string, trajeto: PassoDoTrajeto[], valor = 5000): LinhaDeTrajetoria {
  return {
    deal_id: id,
    contact_id: null,
    conversation_id: null,
    conversa_do_contato: null,
    title: id,
    value: valor,
    status: "open",
    pipeline_id: FUNIL,
    stage_id: trajeto[trajeto.length - 1].etapa ?? "",
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

/**
 * O Trabalhista - Comercial de produção, com "Protocolado" nas DUAS formas:
 * como hoje (contrato) e como a configuração do operador depois da 1054
 * (pasta). Sem reunião (é o funil que marca "não se aplica").
 */
function trabalhista(protocolado: "contrato" | "pasta") {
  return classificarEtapas([
    etapa("entrada", 0, "lead"),
    etapa("qualificado", 5, "mql"),
    etapa("link", 6, "proposta"),
    etapa("assinado", 7, "contrato"),
    etapa("protocolado", 8, protocolado),
    etapa("nao-respondeu", 9, "perda"),
    etapa("perdido", 11, "perda"),
  ]);
}

const LINHAS: LinhaDeTrajetoria[] = [
  // o caminho completo até o protocolo
  negocio("t1", [
    p("entrada", "2026-09-01T10:00:00-03:00", "deal_created"),
    p("qualificado", "2026-09-02T10:00:00-03:00"),
    p("link", "2026-09-03T10:00:00-03:00"),
    p("assinado", "2026-09-04T10:00:00-03:00"),
    p("protocolado", "2026-09-15T10:00:00-03:00"),
  ]),
  // pulou do lead para a assinatura e protocolou
  negocio("t2", [
    p("entrada", "2026-09-02T10:00:00-03:00", "deal_created"),
    p("assinado", "2026-09-05T10:00:00-03:00"),
    p("protocolado", "2026-09-16T10:00:00-03:00"),
  ]),
  // assinado, ainda sem protocolo (contrato em pé)
  negocio("t3", [
    p("entrada", "2026-09-03T10:00:00-03:00", "deal_created"),
    p("qualificado", "2026-09-04T10:00:00-03:00"),
    p("link", "2026-09-05T10:00:00-03:00"),
    p("assinado", "2026-09-06T10:00:00-03:00"),
  ]),
  // distrato: assinou e foi perdido
  negocio("t4", [
    p("entrada", "2026-09-03T11:00:00-03:00", "deal_created"),
    p("link", "2026-09-04T11:00:00-03:00"),
    p("assinado", "2026-09-06T11:00:00-03:00"),
    p("perdido", "2026-09-10T11:00:00-03:00"),
  ]),
  // em andamento e sem resposta
  negocio("t5", [p("entrada", "2026-09-04T10:00:00-03:00", "deal_created"), p("qualificado", "2026-09-05T10:00:00-03:00")]),
  negocio("t6", [p("entrada", "2026-09-05T10:00:00-03:00", "deal_created"), p("nao-respondeu", "2026-09-07T10:00:00-03:00")]),
  // entrou em AGOSTO, assinou em agosto e protocolou em SETEMBRO
  negocio("t7", [
    p("entrada", "2026-08-10T10:00:00-03:00", "deal_created"),
    p("assinado", "2026-08-20T10:00:00-03:00"),
    p("protocolado", "2026-09-10T10:00:00-03:00"),
  ]),
];

const INVESTIMENTO = 1200;

function resumoCom(protocolado: "contrato" | "pasta", modo: (typeof MODOS_DE_CONTAGEM)[number], intervalo: Intervalo) {
  const c = trabalhista(protocolado);
  const fatos = LINHAS.map((l) => fatosDoNegocio(l, FUNIL, c));
  return resumoNoModo(modo, fatos, c, intervalo, AGORA);
}

describe("⚠️ pino da 1054: remapear 'Protocolado' de contrato para pasta NÃO muda o CAC do Trabalhista", () => {
  for (const modo of MODOS_DE_CONTAGEM) {
    for (const [nome, intervalo] of [
      ["setembro", SETEMBRO],
      ["total", TOTAL],
    ] as const) {
      it(`${modo} · ${nome}: CAC, custo por contrato assinado, contratos e dinheiro idênticos`, () => {
        const antes = resumoCom("contrato", modo, intervalo);
        const depois = resumoCom("pasta", modo, intervalo);
        const ca = custosDoResumo(INVESTIMENTO, antes);
        const cd = custosDoResumo(INVESTIMENTO, depois);

        expect(cd.cac).toBe(ca.cac);
        expect(cd.contrato).toBe(ca.contrato);
        expect(cd.lead).toBe(ca.lead);
        expect(cd.mql).toBe(ca.mql);
        expect(cd.proposta).toBe(ca.proposta);
        expect(cd.perdidos).toBe(ca.perdidos);

        expect(depois.fechados).toBe(antes.fechados);
        expect(depois.fechadosAgora).toBe(antes.fechadosAgora);
        expect(depois.valorFechado).toBe(antes.valorFechado);
        expect(depois.ticketMedio).toBe(antes.ticketMedio);
        expect(depois.global).toEqual(antes.global);
        // e os degraus de antes da pasta não se mexem
        const ateContrato = (r: ResumoDoPeriodo) => r.porDegrau.slice(0, 5).map((d) => [d.degrau, d.alcancaram, d.taxaDoAnterior]);
        expect(ateContrato(depois)).toEqual(ateContrato(antes));
      });
    }
  }

  it("o que muda é SÓ a pasta aparecer: 'processo protocolado' ganha contagem e custo", () => {
    const antes = resumoCom("contrato", "periodo", SETEMBRO);
    const depois = resumoCom("pasta", "periodo", SETEMBRO);
    const pastaAntes = antes.porDegrau.find((d) => d.degrau === "pasta");
    const pastaDepois = depois.porDegrau.find((d) => d.degrau === "pasta");
    expect(pastaAntes).toMatchObject({ comEtapa: false, alcancaram: 0 });
    // t1, t2 e t7 (este, de agosto, protocolou em setembro)
    expect(pastaDepois).toMatchObject({ comEtapa: true, alcancaram: 3 });
    expect(custosDoResumo(INVESTIMENTO, antes).pasta).toBeNull();
    expect(custosDoResumo(INVESTIMENTO, depois).pasta).toBe(INVESTIMENTO / 3);
    expect(depois.transicoes.at(-1)).toMatchObject({ de: "contrato", para: "pasta" });
  });

  it("os números do pino são os esperados (senão o pino compararia zeros com zeros)", () => {
    const r = resumoCom("pasta", "entrada", SETEMBRO);
    expect(r.entradas).toBe(6);
    expect(r.fechados).toBe(4); // t1, t2, t3, t4 (o distrato alcançou)
    expect(r.fechadosAgora).toBe(3); // t1, t2 (pasta) e t3 (contrato)
    expect(custosDoResumo(INVESTIMENTO, r).cac).toBe(INVESTIMENTO / 3);
    expect(custosDoResumo(INVESTIMENTO, r).contrato).toBe(INVESTIMENTO / 4);
  });
});

describe("'Contrato sem pasta' muda o CAC (em pé) e NÃO o custo por contrato assinado", () => {
  const PREV = classificarEtapas([
    etapa("novo", 0, "lead"),
    etapa("mql", 2, "mql"),
    etapa("assinatura", 3, "proposta"),
    etapa("assinado", 4, "contrato"),
    etapa("docs", 5, "contrato"),
    etapa("pasta", 6, "pasta"),
    etapa("sem-pasta", 12, "perda"),
  ]);
  const caminho = (id: string, fim: PassoDoTrajeto[]) =>
    negocio(id, [
      p("novo", "2026-09-01T10:00:00-03:00", "deal_created"),
      p("mql", "2026-09-01T11:00:00-03:00"),
      p("assinatura", "2026-09-02T10:00:00-03:00"),
      p("assinado", "2026-09-03T10:00:00-03:00"),
      ...fim,
    ]);
  const comum = [
    caminho("a", [p("pasta", "2026-09-10T10:00:00-03:00")]),
    caminho("b", [p("docs", "2026-09-05T10:00:00-03:00")]),
  ];
  const custosDe = (linhas: LinhaDeTrajetoria[]) => {
    const fatos = linhas.map((l) => fatosDoNegocio(l, FUNIL, PREV));
    return custosDoResumo(INVESTIMENTO, resumoDoPeriodo(fatos, PREV, SETEMBRO, AGORA));
  };

  it("o card que sai da documentação para 'Contrato sem pasta'", () => {
    const antes = custosDe([...comum, caminho("c", [p("docs", "2026-09-05T11:00:00-03:00")])]);
    const depois = custosDe([
      ...comum,
      caminho("c", [p("docs", "2026-09-05T11:00:00-03:00"), p("sem-pasta", "2026-09-18T10:00:00-03:00")]),
    ]);
    expect(antes.cac).toBe(INVESTIMENTO / 3);
    expect(depois.cac).toBe(INVESTIMENTO / 2);
    expect(depois.contrato).toBe(antes.contrato);
    expect(depois.contrato).toBe(INVESTIMENTO / 3);
    expect(depois.pasta).toBe(INVESTIMENTO / 1);
  });
});

describe("custosDoResumo — sem denominador é nulo, nunca zero nem infinito", () => {
  it("período vazio", () => {
    const c = trabalhista("pasta");
    const vazio = resumoDoPeriodo([], c, SETEMBRO, AGORA);
    const custos = custosDoResumo(500, vazio);
    expect(custos.investimento).toBe(500);
    for (const k of ["lead", "mql", "reuniao", "proposta", "contrato", "cac", "pasta", "perdidos"] as const) {
      expect(custos[k]).toBeNull();
    }
  });

  it("custo dos perdidos multiplica os ENTRANTES já perdidos (a regra de sempre)", () => {
    const r = resumoCom("pasta", "periodo", SETEMBRO);
    const custos = custosDoResumo(INVESTIMENTO, r);
    expect(custos.perdidos).toBe((INVESTIMENTO / r.entradas) * r.perdidosDosEntrantes);
  });
});

describe("custosMensais (Saúde, 6.4) — o gasto do MÊS sobre as contagens do mês", () => {
  const c = trabalhista("pasta");
  const fatos = LINHAS.map((l) => fatosDoNegocio(l, FUNIL, c));
  const meses = coortesMensais(fatos, c, 2, AGORA, "periodo");
  const campanhas = [
    { campaign_id: "c1", nome: "Trabalhista", pipeline_id: FUNIL },
    { campaign_id: "c2", nome: "Outro funil", pipeline_id: "outro" },
  ];
  const gastos = [
    { campaign_id: "c1", dia: "2026-08-15", gasto: 300 },
    { campaign_id: "c1", dia: "2026-09-02", gasto: 400 },
    { campaign_id: "c1", dia: "2026-09-19", gasto: 200 },
    { campaign_id: "c2", dia: "2026-09-05", gasto: 999 },
  ];
  const custos = custosMensais(meses, gastos, campanhas, FUNIL, AGORA);

  it("um item por mês, na ordem da Saúde, com o investimento só das campanhas DESTE funil", () => {
    expect(custos.map((m) => m.chave)).toEqual(["2026-08", "2026-09"]);
    expect(custos.map((m) => m.custos.investimento)).toEqual([300, 600]);
  });

  it("cada mês divide pelas contagens DELE", () => {
    const [agosto, setembro] = custos;
    expect(agosto.custos.lead).toBe(300 / meses[0].resumo.entradas);
    expect(setembro.custos.lead).toBe(600 / meses[1].resumo.entradas);
    expect(setembro.custos.pasta).toBe(600 / 3);
    // agosto: t7 assinou em agosto (e protocolou em setembro) — o contrato
    // é do mês da assinatura, a pasta, do mês do protocolo
    expect(agosto.custos.contrato).toBe(300 / 1);
    expect(agosto.custos.pasta).toBeNull();
  });
});
