import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ReuniaoDoResumo } from "@/lib/reunioes/resumo";

import {
  compararReunioes,
  contarReunioes,
  funilMedeComparecimento,
  reunioesForaDeFunil,
} from "./comparecimento";

// Dados fictícios.
const COMERCIAL = "funil-comercial";
const OUTRO = "funil-outro";
const OUTUBRO = { desde: new Date("2026-10-01T03:00:00Z"), ate: new Date("2026-11-01T03:00:00Z") };
const SETEMBRO = { desde: new Date("2026-09-01T03:00:00Z"), ate: OUTUBRO.desde };

function r(inicio: string, resultado: ReuniaoDoResumo["resultado"], funil: string | null = COMERCIAL): ReuniaoDoResumo {
  return { inicio, funil, resultado };
}

describe("contarReunioes", () => {
  const linhas = [
    r("2026-10-02T14:00:00Z", "proposta"),
    r("2026-10-02T15:00:00Z", "sem_proposta"),
    r("2026-10-03T14:00:00Z", "no_show"),
    r("2026-10-03T15:00:00Z", "reagendar"),
    r("2026-10-04T14:00:00Z", null),
    r("2026-10-04T15:00:00Z", "proposta", OUTRO),
    r("2026-10-04T16:00:00Z", "no_show", null),
    r("2026-09-20T14:00:00Z", "no_show"),
  ];

  it("separa os resultados; compareceram = com + sem proposta", () => {
    expect(contarReunioes(linhas, COMERCIAL, OUTUBRO)).toEqual({
      reunioes: 5,
      compareceram: 2,
      comProposta: 1,
      noShow: 1,
      reagendaram: 1,
      semResultado: 1,
      comparecimento: 2 / 3,
    });
  });

  it("⚠️ reagendadas e sem resultado ficam FORA da taxa", () => {
    const so = [r("2026-10-02T14:00:00Z", "sem_proposta"), r("2026-10-03T14:00:00Z", "reagendar"), r("2026-10-04T14:00:00Z", null)];
    expect(contarReunioes(so, COMERCIAL, OUTUBRO).comparecimento).toBe(1);
  });

  it("⚠️ sem denominador a taxa é NULA (\"—\"), nunca 0%", () => {
    const so = [r("2026-10-03T14:00:00Z", "reagendar"), r("2026-10-04T14:00:00Z", null)];
    expect(contarReunioes(so, COMERCIAL, OUTUBRO).comparecimento).toBeNull();
    expect(contarReunioes([], COMERCIAL, OUTUBRO).comparecimento).toBeNull();
    // Só no-show: a taxa existe e é zero (medida, não ausência).
    expect(contarReunioes([r("2026-10-03T14:00:00Z", "no_show")], COMERCIAL, OUTUBRO).comparecimento).toBe(0);
  });

  it("só o funil pedido; a reunião sem funil não entra em nenhum", () => {
    expect(contarReunioes(linhas, OUTRO, OUTUBRO)).toMatchObject({ reunioes: 1, compareceram: 1, comProposta: 1 });
  });

  it("período [desde, ate): a reunião no instante da virada conta só no período que COMEÇA nela", () => {
    const virada = [r("2026-10-01T03:00:00Z", "no_show")];
    expect(contarReunioes(virada, COMERCIAL, OUTUBRO).noShow).toBe(1);
    expect(contarReunioes(virada, COMERCIAL, SETEMBRO).noShow).toBe(0);
  });

  it("intervalo aberto (Total): sem desde nem ate conta tudo", () => {
    expect(contarReunioes(linhas, COMERCIAL, { desde: null, ate: null }).reunioes).toBe(6);
  });
});

describe("reunioesForaDeFunil", () => {
  it("conta as do período sem funil (sem card no dia)", () => {
    const linhas = [r("2026-10-04T16:00:00Z", "no_show", null), r("2026-09-04T16:00:00Z", null, null), r("2026-10-05T16:00:00Z", null)];
    expect(reunioesForaDeFunil(linhas, OUTUBRO)).toBe(1);
  });
});

describe("compararReunioes", () => {
  const atual = contarReunioes(
    [r("2026-10-02T14:00:00Z", "proposta"), r("2026-10-03T14:00:00Z", "sem_proposta"), r("2026-10-04T14:00:00Z", "no_show")],
    COMERCIAL,
    OUTUBRO,
  );
  const anterior = contarReunioes(
    [r("2026-09-02T14:00:00Z", "proposta"), r("2026-09-03T14:00:00Z", "no_show"), r("2026-09-04T14:00:00Z", "no_show")],
    COMERCIAL,
    SETEMBRO,
  );

  it("as MESMAS variações dos outros cartões: contagem em fração, taxa em pontos percentuais", () => {
    const c = compararReunioes(atual, anterior);
    expect(c.compareceram).toEqual({ atual: 2, anterior: 1, variacao: 1 });
    expect(c.noShow).toEqual({ atual: 1, anterior: 2, variacao: -0.5 });
    expect(c.reagendaram).toEqual({ atual: 0, anterior: 0, variacao: null });
    expect(c.comparecimento.atual).toBeCloseTo(2 / 3);
    expect(c.comparecimento.anterior).toBeCloseTo(1 / 3);
    expect(c.comparecimento.pp).toBeCloseTo(100 / 3);
  });

  it("sem período anterior (Total): deltas nulos", () => {
    const c = compararReunioes(atual, null);
    expect(c.compareceram.variacao).toBeNull();
    expect(c.comparecimento.pp).toBeNull();
  });

  it("taxa sem denominador num dos lados: pp nulo, nunca diferença contra zero", () => {
    const vazio = contarReunioes([], COMERCIAL, SETEMBRO);
    expect(compararReunioes(atual, vazio).comparecimento.pp).toBeNull();
  });
});

describe("funilMedeComparecimento", () => {
  it("só com etapa marcada Compareceu, Faltou ou Reagendar", () => {
    expect(funilMedeComparecimento([{ degrau: "reuniao", desfecho_da_reuniao: "faltou" }])).toBe(true);
    expect(funilMedeComparecimento([{ degrau: "reuniao", desfecho_da_reuniao: "compareceu" }])).toBe(true);
    expect(funilMedeComparecimento([{ degrau: "reuniao", desfecho_da_reuniao: "reagendar" }])).toBe(true);
  });

  it("\"Qualificada\" não é comparecimento; funil sem marca não mede", () => {
    expect(funilMedeComparecimento([{ degrau: "reuniao", desfecho_da_reuniao: "qualificada" }])).toBe(false);
    expect(funilMedeComparecimento([{ degrau: "lead", desfecho_da_reuniao: null }, { degrau: "contrato" }])).toBe(false);
    expect(funilMedeComparecimento([])).toBe(false);
  });

  it("⚠️ marca em etapa de proposta em diante não vale (marcaDaReuniaoQueVale)", () => {
    expect(funilMedeComparecimento([{ degrau: "proposta", desfecho_da_reuniao: "compareceu" }])).toBe(false);
  });
});

describe("o pedido das reuniões no Desempenho (pino de fonte)", () => {
  const desempenho = readFileSync(join(process.cwd(), "src/components/funil/desempenho.tsx"), "utf8");

  it("⚠️ a janela do pedido é ESTÁVEL no dia: meias-noites (fimDoIntervalo), nunca o relógio corrido", () => {
    // `agora` muda a cada render: na chave do hook, o Desempenho pediria as
    // reuniões sem parar.
    expect(desempenho).toContain("const fimDaCarga = fimDoIntervalo(intervalo, agora);");
    expect(desempenho).toMatch(/de: \(anterior\?\.desde \?\? intervalo\.desde\)\?\.toISOString\(\) \?\? null,\s*ate: fimDaCarga\?\.toISOString\(\) \?\? null,/);
    expect(desempenho).not.toMatch(/agora\.toISOString\(\)|Date\.now\(\)/);
  });

  it("só busca no funil que mede comparecimento, com as etapas DESTE funil", () => {
    expect(desempenho).toContain("const medeComparecimento = etapasCarregadas && funilMedeComparecimento(stages);");
  });

  it("a nota \"Nada aconteceu\" não afirma com reunião no período nem com as reuniões carregando", () => {
    expect(desempenho).toContain("{vazio && (!porPeriodo || reunioesNoPeriodo === 0) && (");
  });
});
