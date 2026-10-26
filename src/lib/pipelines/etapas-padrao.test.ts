import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import { etapasPadrao } from "./etapas-padrao";

// ============================================================
// O funil novo nascia com "New Lead → Won" gravado no banco numa instalação
// em português. Os nomes saem do dicionário do idioma (os DOIS, lidos aqui), e
// a tela de Funis não pode voltar ao literal.
// ============================================================

const RAIZ = join(__dirname, "..", "..", "..");
const dicionario = (arq: string) =>
  JSON.parse(readFileSync(join(RAIZ, "messages", arq), "utf8")) as Record<string, unknown>;

function tradutor(arq: string, locale: string) {
  const t = createTranslator({ locale, messages: dicionario(arq), namespace: "Pipelines.page" });
  return (c: string, v?: Record<string, string>) =>
    t(c as Parameters<typeof t>[0], v as Parameters<typeof t>[1]);
}

describe("etapasPadrao — os nomes do funil novo vêm do dicionário", () => {
  it("em português, as cinco etapas em português", () => {
    expect(etapasPadrao(tradutor("pt-BR.json", "pt-BR")).map((e) => e.name)).toEqual([
      "Novo lead",
      "Qualificado",
      "Proposta enviada",
      "Negociação",
      "Ganho",
    ]);
  });

  it("em inglês, os nomes de sempre", () => {
    expect(etapasPadrao(tradutor("en.json", "en")).map((e) => e.name)).toEqual([
      "New Lead",
      "Qualified",
      "Proposal Sent",
      "Negotiation",
      "Won",
    ]);
  });

  it("cor e posição não mudam com o idioma", () => {
    const pt = etapasPadrao(tradutor("pt-BR.json", "pt-BR"));
    const en = etapasPadrao(tradutor("en.json", "en"));
    expect(pt.map(({ color, position }) => ({ color, position }))).toEqual(
      en.map(({ color, position }) => ({ color, position })),
    );
    expect(pt.map((e) => e.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("o texto do diálogo cita a primeira e a última etapa do idioma", () => {
    for (const [arq, locale] of [
      ["pt-BR.json", "pt-BR"],
      ["en.json", "en"],
    ] as const) {
      const t = tradutor(arq, locale);
      const etapas = etapasPadrao(t);
      const texto = t("defaultStagesDesc", {
        primeira: etapas[0].name,
        ultima: etapas[etapas.length - 1].name,
      });
      expect(texto).toContain(`${etapas[0].name} → ${etapas[etapas.length - 1].name}`);
    }
  });

  it("o funil semeado na conta sem funis também tem nome traduzido", () => {
    expect(tradutor("pt-BR.json", "pt-BR")("funilPadrao")).toBe("Funil de vendas");
    expect(tradutor("en.json", "en")("funilPadrao")).toBe("Sales Pipeline");
  });
});

// A página é um componente do React (sem teste de comportamento aqui): o
// literal em inglês só volta lendo o fonte.
describe("pino: a tela de Funis cria as etapas pelo dicionário", () => {
  const fonte = readFileSync(join(RAIZ, "src/app/(dashboard)/pipelines/page.tsx"), "utf8");

  it("as duas criações (Criar funil e o funil semeado) passam por etapasPadrao(t)", () => {
    expect(fonte.match(/etapasPadrao\(t\)\.map/g)?.length).toBe(2);
    expect(fonte).not.toMatch(/SPEC_DEFAULT_STAGES/);
  });

  it("nenhum nome de etapa ou de funil em inglês gravado como literal", () => {
    for (const nome of ["New Lead", "Qualified", "Proposal Sent", "Negotiation", "Sales Pipeline"]) {
      expect(fonte).not.toContain(`"${nome}"`);
    }
    expect(fonte).not.toMatch(/name:\s*"Won"/);
  });

  it("o diálogo recebe a primeira e a última etapa (o texto não as fixa)", () => {
    expect(fonte).toMatch(/t\("defaultStagesDesc",\s*\{/);
  });
});
