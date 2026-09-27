import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { triggerMatches } from "@/lib/automations/engine";
import { GATILHOS_SEM_DISPARO, TRIGGER_META } from "@/lib/automations/trigger-meta";
import type { Automation } from "@/types";

import { GATILHO } from "./processar";

// ============================================================
// O gatilho `zapsign_documento_assinado` (1057) TEM call site — o webhook do
// ZapSign — e por isso: é oferecido no construtor, NÃO está em
// `GATILHOS_SEM_DISPARO` (senão a grade do funil esconderia o cartão de
// chegada da automação que move o card para "Contrato assinado"), e casa
// sempre (sem configuração).
// ============================================================

describe("gatilho zapsign_documento_assinado", () => {
  it("existe no catálogo de rótulos e é o que o processamento dispara", () => {
    expect(TRIGGER_META[GATILHO]).toBeDefined();
  });

  it("CRÍTICO: é oferecido no construtor e não está entre os que nunca disparam", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "../../components/automations/automation-builder.tsx"), "utf8");
    const bloco = fonte.match(/const TRIGGER_OPTIONS[^=]*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    expect(bloco).toContain(`"${GATILHO}"`);
    expect(GATILHOS_SEM_DISPARO.has(GATILHO)).toBe(false);
  });

  it("sem configuração, casa com qualquer assinatura completa da conta", () => {
    const automacao = { id: "a1", trigger_type: GATILHO, trigger_config: {} } as unknown as Automation;
    expect(triggerMatches(automacao, { vars: {} })).toBe(true);
  });
});
