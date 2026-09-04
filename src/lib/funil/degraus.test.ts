import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CLASSES,
  DEGRAUS,
  classificarEtapas,
  ehClasse,
  ehDegrau,
  indiceDoDegrau,
  sugerirClasse,
  type EtapaMinima,
} from "./degraus";

const etapa = (id: string, position: number, degrau: string | null): EtapaMinima => ({
  id,
  name: id,
  position,
  degrau,
});

// O funil "Bancário - Comercial" de produção com o mapeamento sugerido no plano.
const BANCARIO: EtapaMinima[] = [
  etapa("avulso", 0, "lead"),
  etapa("desq", 1, "perda"),
  etapa("lead", 2, "lead"),
  etapa("mql1", 3, "mql"),
  etapa("reuniao", 4, "reuniao"),
  etapa("mql2", 5, "reuniao"),
  etapa("noshow", 6, "perda"),
  etapa("semprop", 7, "perda"),
  etapa("proposta", 8, "proposta"),
  etapa("contrato", 9, "contrato"),
  etapa("perdido", 10, "perda"),
  etapa("parking", 11, null),
];

describe("degraus — catálogo", () => {
  it("a ordem é fixa: lead → mql → reuniao → proposta → contrato", () => {
    expect([...DEGRAUS]).toEqual(["lead", "mql", "reuniao", "proposta", "contrato"]);
    expect(indiceDoDegrau("lead")).toBe(0);
    expect(indiceDoDegrau("contrato")).toBe(4);
  });

  it("perda é classe, não degrau", () => {
    expect(ehDegrau("perda")).toBe(false);
    expect(ehClasse("perda")).toBe(true);
    expect(ehClasse("ganho")).toBe(false);
    expect(ehClasse(null)).toBe(false);
    expect(CLASSES).toHaveLength(6);
  });
});

describe("classificarEtapas", () => {
  it("várias etapas no mesmo degrau, na ordem de posição", () => {
    const c = classificarEtapas(BANCARIO);
    expect(c.porClasse.lead.map((e) => e.id)).toEqual(["avulso", "lead"]);
    expect(c.porClasse.reuniao.map((e) => e.id)).toEqual(["reuniao", "mql2"]);
    expect(c.porClasse.perda.map((e) => e.id)).toEqual(["desq", "noshow", "semprop", "perdido"]);
    expect(c.configurado).toBe(true);
    expect(c.faltando).toEqual([]);
  });

  it("etapa sem degrau não entra em classe nenhuma, mas continua no catálogo de etapas", () => {
    const c = classificarEtapas(BANCARIO);
    expect(c.classeDaEtapa.has("parking")).toBe(false);
    expect(c.etapas.get("parking")?.name).toBe("parking");
  });

  it("valor desconhecido na coluna é 'sem degrau', nunca erro", () => {
    const c = classificarEtapas([etapa("a", 0, "lead"), etapa("b", 1, "ganho")]);
    expect(c.classeDaEtapa.get("b")).toBeUndefined();
    expect(c.configurado).toBe(true);
  });

  it("configurado exige ao menos uma etapa em lead; faltando lista os degraus sem etapa", () => {
    const c = classificarEtapas([etapa("x", 0, "mql"), etapa("y", 1, "contrato")]);
    expect(c.configurado).toBe(false);
    expect(c.faltando).toEqual(["lead", "reuniao", "proposta"]);
  });

  it("ordena por posição mesmo recebendo fora de ordem", () => {
    const c = classificarEtapas([etapa("b", 5, "lead"), etapa("a", 1, "lead")]);
    expect(c.porClasse.lead.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("sugerirClasse (só para a tela)", () => {
  it("ganho → contrato, perdido → perda, o resto nada", () => {
    expect(sugerirClasse("ganho")).toBe("contrato");
    expect(sugerirClasse("perdido")).toBe("perda");
    expect(sugerirClasse(null)).toBeNull();
    expect(sugerirClasse("")).toBeNull();
  });
});

describe("i18n — as chaves montadas `Pipelines.funil.degraus.<classe>`", () => {
  // O portão estático de i18n não enxerga chave montada (`degraus.${c}`);
  // este teste cobra nos DOIS dicionários, como `editor.test.ts` faz.
  const dicionarios = ["en", "pt-BR"].map((locale) => ({
    locale,
    json: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as {
      Pipelines: { funil: { degraus: Record<string, string> } };
    },
  }));

  for (const { locale, json } of dicionarios) {
    it(`${locale}: toda classe e 'nenhum' têm rótulo`, () => {
      const rotulos = json.Pipelines.funil.degraus;
      for (const classe of [...CLASSES, "nenhum"]) {
        expect(rotulos[classe], `Pipelines.funil.degraus.${classe} em ${locale}`).toBeTypeOf("string");
        expect(rotulos[classe].length).toBeGreaterThan(0);
      }
    });
  }
});
