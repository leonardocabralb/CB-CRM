import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import { triggerMatches } from "@/lib/automations/engine";
import { soRodaPeloDisparador } from "@/lib/automations/so-pelo-disparador";
import { GATILHOS_SEM_DISPARO, TRIGGER_META } from "@/lib/automations/trigger-meta";
import type { Automation } from "@/types";

import {
  cardDoEvento,
  casaSituacao,
  GATILHO_DO_ATLAS,
  lerConfigDoGatilho,
  resultadoDaMudanca,
  ESTADOS_NA_FILA,
  RESULTADOS_DA_MUDANCA,
  SITUACOES_DO_GATILHO,
  VARIAVEIS_DA_MUDANCA,
  variaveisDaMudanca,
  type SaidaDaAutomacao,
} from "./gatilho";

// ============================================================
// O gatilho "Situação mudou no Atlas" (1073, Fase 4). Gêmeo do pino do
// ZapSign: TEM call site (a leitura periódica), então é oferecido no
// construtor e NÃO está em `GATILHOS_SEM_DISPARO` (a grade do funil desenha a
// chegada do "Mover card"). E, como a régua do Asaas, SÓ roda pelo
// disparador: `triggerMatches` casa só com o `automation_id` carimbado, e
// toda porta manual o recusa. Dados fictícios.
// ============================================================

const RAIZ = path.join(__dirname, "../../..");
const ler = (arquivo: string) => fs.readFileSync(path.join(RAIZ, arquivo), "utf8");

function automacao(id: string, cfg: Record<string, unknown> = { situacoes: ["rescindido"], pipeline_ids: ["00000000-0000-4000-8000-0000000000f1"] }): Automation {
  return { id, trigger_type: GATILHO_DO_ATLAS, trigger_config: cfg } as unknown as Automation;
}

describe("gatilho atlas_situacao_mudou", () => {
  it("existe no catálogo de rótulos", () => {
    expect(TRIGGER_META[GATILHO_DO_ATLAS]).toBeDefined();
  });

  it("CRÍTICO: é oferecido no construtor e não está entre os que nunca disparam", () => {
    const fonte = ler("src/components/automations/automation-builder.tsx");
    const bloco = fonte.match(/const TRIGGER_OPTIONS[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    expect(bloco).toContain(`"${GATILHO_DO_ATLAS}"`);
    expect(GATILHOS_SEM_DISPARO.has(GATILHO_DO_ATLAS)).toBe(false);
  });

  it("CRÍTICO: casa SÓ com a automação carimbada no contexto — sem carimbo, falha fechado", () => {
    expect(triggerMatches(automacao("a1"), { automation_id: "a1" })).toBe(true);
    expect(triggerMatches(automacao("a2"), { automation_id: "a1" })).toBe(false);
    expect(triggerMatches(automacao("a1"), {})).toBe(false);
    expect(triggerMatches(automacao("a1"), undefined)).toBe(false);
  });

  it("só roda pelo disparador, como a régua do Asaas", () => {
    expect(soRodaPeloDisparador(GATILHO_DO_ATLAS)).toBe(true);
    expect(soRodaPeloDisparador("asaas_cobranca_vencida")).toBe(true);
    expect(soRodaPeloDisparador("manual")).toBe(false);
    expect(soRodaPeloDisparador(null)).toBe(false);
  });

  it("CRÍTICO: toda porta que recusa a régua recusa o Atlas (a mesma função)", () => {
    // O botão "Executar automação", o agente de IA, `run_automation`, a rota
    // manual, as rotas que zeram o recorte de etapa e o construtor.
    const portas: [string, RegExp][] = [
      ["src/lib/automations/engine.ts", /if \(soRodaPeloDisparador\(alvo\.trigger_type\)\)/],
      ["src/lib/automations/engine.ts", /if \(soRodaPeloDisparador\(automation\.trigger_type\)\) \{\s*return ctx\?\.automation_id === automation\.id/],
      ["src/app/api/automations/engine/route.ts", /soRodaPeloDisparador\(body\.trigger_type\)/],
      ["src/lib/execucoes/lista-para-executar.ts", /soRodaPeloDisparador\(a\.trigger_type\)/],
      ["src/lib/ia-agentes/ferramentas.ts", /filter\(\(a\) => !soRodaPeloDisparador\(a\.trigger_type\)\)/],
      ["src/lib/ia-agentes/ferramentas.ts", /!soRodaPeloDisparador\(l\.trigger_type\)/],
      ["src/app/api/automations/route.ts", /stage_ids: soRodaPeloDisparador\(effectiveTriggerType\)/],
      ["src/app/api/automations/[id]/route.ts", /if \(soRodaPeloDisparador\(\(update\.trigger_type/],
      ["src/components/automations/automation-builder.tsx", /stage_ids: soRodaPeloDisparador\(tVal\) \? \[\] : s\.stage_ids/],
      ["src/components/automations/automation-builder.tsx", /type !== "deal_stage_changed" && !soRodaPeloDisparador\(type\)/],
      ["src/components/automations/automation-builder.tsx", /!soRodaPeloDisparador\(a\.trigger_type\) \|\| a\.id === value/],
    ];
    for (const [arquivo, forma] of portas) expect(ler(arquivo), arquivo).toMatch(forma);
  });
});

describe("casaSituacao e a config", () => {
  it("casa pela situação NOVA, com em_negociacao valendo ativo e sem diferença de caixa", () => {
    const cfg = { situacoes: ["rescindido", "ativo"], pipeline_ids: ["00000000-0000-4000-8000-0000000000f1"] };
    expect(casaSituacao(cfg, "rescindido")).toBe(true);
    expect(casaSituacao(cfg, "Rescindido")).toBe(true);
    expect(casaSituacao(cfg, "em_negociacao")).toBe(true);
    expect(casaSituacao(cfg, "finalizado")).toBe(false);
    expect(casaSituacao(cfg, "")).toBe(false);
  });

  it("config de JSONB lida com desconfiança", () => {
    expect(lerConfigDoGatilho(null)).toEqual({ situacoes: [], pipelineIds: [] });
    expect(lerConfigDoGatilho({ situacoes: "rescindido", pipeline_ids: [1, "", " 00000000-0000-4000-8000-0000000000f1 "] })).toEqual({ situacoes: [], pipelineIds: ["00000000-0000-4000-8000-0000000000f1"] });
    // Id malformado sai: ia para o `.in("pipeline_id")` da busca dos cards de TODAS as automações.
    expect(lerConfigDoGatilho({ situacoes: ["rescindido"], pipeline_ids: ["x", "00000000-0000-4000-8000-0000000000f1"] }).pipelineIds).toEqual(["00000000-0000-4000-8000-0000000000f1"]);
    expect(casaSituacao({ situacoes: "rescindido" }, "rescindido")).toBe(false);
  });
});

describe("cardDoEvento", () => {
  const cards = [
    { id: "d-com", pipeline_id: "comercial", status: "open" as const },
    { id: "d-jur", pipeline_id: "juridico", status: "won" as const },
  ];

  it("o ÚNICO card nos funis da automação, em qualquer status (o ganho do Jurídico também)", () => {
    expect(cardDoEvento(cards, ["juridico"])).toEqual({ tipo: "um", card: cards[1] });
  });

  it("sem card no funil: nenhum (o ex-cliente cujo card está noutro funil nunca é arrastado)", () => {
    expect(cardDoEvento([cards[0]], ["juridico"])).toEqual({ tipo: "nenhum" });
    expect(cardDoEvento(cards, [])).toEqual({ tipo: "nenhum" });
  });

  it("mais de um nos funis: ambíguo", () => {
    expect(cardDoEvento(cards, ["juridico", "comercial"])).toEqual({ tipo: "varios", quantos: 2 });
  });
});

describe("variaveisDaMudanca", () => {
  it("situações comparáveis, data no formato de mensagem e o link só https do cliente", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const v = variaveisDaMudanca({ anterior: "em_negociacao", nova: "rescindido", desde: "2026-09-30T13:15:00.000Z", appUrl: `https://app.example.com/#/clients/${id}`, atlasClientId: id });
    expect(v).toEqual({
      atlas_situacao: "rescindido",
      atlas_situacao_anterior: "ativo",
      atlas_situacao_em: "30/09/2026 às 10:15h",
      atlas_link: `https://app.example.com/#/clients/${id}`,
    });
    expect(Object.keys(v).sort()).toEqual([...VARIAVEIS_DA_MUDANCA].sort());
    expect(variaveisDaMudanca({ anterior: "ativo", nova: "rescindido", desde: null, appUrl: "http://app.example.com/x", atlasClientId: id }).atlas_link).toBe("");
  });
});

describe("resultadoDaMudanca", () => {
  const disparo = (p: Partial<Extract<SaidaDaAutomacao, { tipo: "disparo" }>> = {}): SaidaDaAutomacao => ({
    nome: "A",
    tipo: "disparo",
    executadas: 1,
    foraDoEscopo: 0,
    comFalha: 0,
    emEspera: 0,
    ...p,
  });

  it("prioridade quando algo rodou: falhou → em espera → disparado", () => {
    expect(resultadoDaMudanca([disparo()]).resultado).toBe("disparado");
    expect(resultadoDaMudanca([disparo(), disparo({ emEspera: 1 })]).resultado).toBe("em_espera");
    expect(resultadoDaMudanca([disparo({ emEspera: 1 }), disparo({ comFalha: 1 })]).resultado).toBe("falhou");
    // Um rodou e o outro foi recusado: NUNCA volta à fila (o que rodou repetiria).
    expect(resultadoDaMudanca([disparo(), disparo({ executadas: 0, erro: "banco" })]).resultado).toBe("falhou");
  });

  it("CRÍTICO: nada rodou e um disparo foi recusado antes da primeira automação: `null` (volta à fila)", () => {
    expect(resultadoDaMudanca([disparo({ executadas: 0, erro: "contact ownership check failed" })]).resultado).toBeNull();
    expect(resultadoDaMudanca([{ nome: "B", tipo: "sem_card" }, disparo({ executadas: 0, erro: "x" })]).resultado).toBeNull();
  });

  it("nenhuma rodou por causa do card: ambíguo, sem card; fora do escopo: sem automação", () => {
    expect(resultadoDaMudanca([{ nome: "A", tipo: "sem_card" }]).resultado).toBe("sem_card");
    expect(resultadoDaMudanca([{ nome: "A", tipo: "sem_card" }, { nome: "B", tipo: "card_ambiguo", quantos: 2 }]).resultado).toBe("card_ambiguo");
    expect(resultadoDaMudanca([disparo({ executadas: 0, foraDoEscopo: 1 })]).resultado).toBe("sem_automacao");
    expect(resultadoDaMudanca([]).resultado).toBe("sem_automacao");
  });

  it("o detalhe tem uma linha por automação, com o nome", () => {
    const d = resultadoDaMudanca([{ nome: "Rescindido → Jurídico", tipo: "sem_card" }, { ...disparo(), nome: "Avisar equipe" }]).detalhe;
    expect(d.split("\n")).toHaveLength(2);
    expect(d).toContain("Rescindido → Jurídico:");
    expect(d).toContain("Avisar equipe: executada");
  });

  it("sem as travas que o operador recusou", () => {
    expect(RESULTADOS_DA_MUDANCA).not.toContain("antiga");
    expect(RESULTADOS_DA_MUDANCA).not.toContain("suspeita_ficha_velha");
  });
});

// Chave MONTADA (`Automations.builder.atlasGatilho.situacao.<s>` e
// `Settings.integracoes.atlas.mudanca.resultado.<r>`): o portão de i18n do CI
// só a CONTA. As listas saem das constantes do código.
describe.each([
  ["pt-BR", ptBR],
  ["en", en],
])("dicionário %s", (_idioma, dic) => {
  const d = dic as unknown as {
    Automations: { builder: { atlasGatilho: { situacao: Record<string, unknown> }; triggers: Record<string, { label?: unknown; hint?: unknown }> } };
    Settings: { integracoes: { atlas: { mudanca: { resultado: Record<string, unknown>; estado: Record<string, unknown> } } } };
  };
  it("toda situação oferecida tem nome", () => {
    expect(SITUACOES_DO_GATILHO.filter((s) => typeof d.Automations.builder.atlasGatilho.situacao[s] !== "string")).toEqual([]);
    expect(Object.keys(d.Automations.builder.atlasGatilho.situacao).sort()).toEqual([...SITUACOES_DO_GATILHO].sort());
  });
  it("todo resultado e todo estado da fila têm texto no cartão", () => {
    expect(RESULTADOS_DA_MUDANCA.filter((r) => typeof d.Settings.integracoes.atlas.mudanca.resultado[r] !== "string")).toEqual([]);
    expect(Object.keys(d.Settings.integracoes.atlas.mudanca.resultado).sort()).toEqual([...RESULTADOS_DA_MUDANCA].sort());
    expect(ESTADOS_NA_FILA.filter((e) => typeof d.Settings.integracoes.atlas.mudanca.estado[e] !== "string")).toEqual([]);
    expect(Object.keys(d.Settings.integracoes.atlas.mudanca.estado).sort()).toEqual([...ESTADOS_NA_FILA].sort());
  });
  it("o gatilho tem rótulo e dica", () => {
    expect(typeof d.Automations.builder.triggers[GATILHO_DO_ATLAS]?.label).toBe("string");
    expect(typeof d.Automations.builder.triggers[GATILHO_DO_ATLAS]?.hint).toBe("string");
  });
});
