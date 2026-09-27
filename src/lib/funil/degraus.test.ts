import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CLASSES,
  DEGRAUS,
  DEGRAUS_OPCIONAIS,
  INDICE_DO_CONTRATO,
  classificarEtapas,
  degrauAntesDoContrato,
  ehClasse,
  ehDegrau,
  ehFechamento,
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
  it("a ordem é fixa: lead → mql → reuniao → proposta → contrato → pasta", () => {
    expect([...DEGRAUS]).toEqual(["lead", "mql", "reuniao", "proposta", "contrato", "pasta"]);
    expect(indiceDoDegrau("lead")).toBe(0);
    expect(indiceDoDegrau("contrato")).toBe(4);
    expect(indiceDoDegrau("pasta")).toBe(5);
    expect(INDICE_DO_CONTRATO).toBe(4);
  });

  it("a pasta (1054) é o único degrau opcional", () => {
    expect([...DEGRAUS_OPCIONAIS]).toEqual(["pasta"]);
  });

  it("contrato e pasta são FECHAMENTO; o resto não", () => {
    expect(ehFechamento("contrato")).toBe(true);
    expect(ehFechamento("pasta")).toBe(true);
    for (const c of ["lead", "mql", "reuniao", "proposta", "perda"] as const) {
      expect(ehFechamento(c)).toBe(false);
    }
    expect(ehFechamento(null)).toBe(false);
  });

  it("perda é classe, não degrau", () => {
    expect(ehDegrau("perda")).toBe(false);
    expect(ehClasse("perda")).toBe(true);
    expect(ehClasse("ganho")).toBe(false);
    expect(ehClasse(null)).toBe(false);
    expect(CLASSES).toHaveLength(7);
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

  it("a pasta sem etapa NÃO é faltando (é opcional); com etapa, entra na classe dela", () => {
    expect(classificarEtapas(BANCARIO).faltando).not.toContain("pasta");
    const c = classificarEtapas([...BANCARIO, etapa("pasta", 12, "pasta")]);
    expect(c.porClasse.pasta.map((e) => e.id)).toEqual(["pasta"]);
    expect(c.classeDaEtapa.get("pasta")).toBe("pasta");
  });

  it("ordena por posição mesmo recebendo fora de ordem", () => {
    const c = classificarEtapas([etapa("b", 5, "lead"), etapa("a", 1, "lead")]);
    expect(c.porClasse.lead.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("degrauAntesDoContrato (o 'pipeline ativo' do balde em andamento)", () => {
  it("é o último degrau mapeado ANTES do contrato — nunca o contrato, nem a pasta", () => {
    expect(degrauAntesDoContrato(classificarEtapas(BANCARIO))).toBe("proposta");
    // com a pasta mapeada, "o penúltimo da lista" seria o contrato — errado
    expect(degrauAntesDoContrato(classificarEtapas([...BANCARIO, etapa("pasta", 12, "pasta")]))).toBe("proposta");
    // funil sem proposta nem reunião (o Trabalhista sem reunião, por exemplo)
    expect(
      degrauAntesDoContrato(
        classificarEtapas([etapa("l", 0, "lead"), etapa("m", 1, "mql"), etapa("c", 2, "contrato")]),
      ),
    ).toBe("mql");
    expect(degrauAntesDoContrato(classificarEtapas([etapa("c", 0, "contrato")]))).toBeNull();
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
