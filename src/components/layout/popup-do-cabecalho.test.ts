import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { ABRE_PARA_BAIXO } from "./popup-do-cabecalho";

// ============================================================
// Popup do CABEÇALHO abre sempre para baixo, com a altura pela tela
// (relato do operador, 02/10/2026: no app do iPhone o menu da conta e o das
// conexões abriam para cima, cortados). Ver `popup-do-cabecalho.ts`.
//
// Inventário: todo popup que o cabeçalho desenha — o dele e os dos
// indicadores que ele monta. Popup novo ali reprova até levar as travas.
// ============================================================

const SRC = path.join(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

const DO_CABECALHO = [
  "components/layout/header.tsx",
  "components/channels/channel-health-indicator.tsx",
  "components/scheduled/scheduler-health-indicator.tsx",
  "components/layout/mode-toggle.tsx",
];

/** Cada abertura de `<PopoverContent`/`<DropdownMenuContent` até o `>` que a fecha. */
function aberturas(fonte: string): string[] {
  return [...fonte.matchAll(/<(PopoverContent|DropdownMenuContent)\b[\s\S]*?\n\s*>/g)].map((m) => m[0]);
}

describe("popup do cabeçalho", () => {
  it("o lado nunca inverte (e não cai para o eixo de lado)", () => {
    expect(ABRE_PARA_BAIXO.side).toBe("none");
    expect(ABRE_PARA_BAIXO.fallbackAxisSide).toBe("none");
  });

  it("o cabeçalho monta exatamente os componentes do inventário", () => {
    const header = ler("components/layout/header.tsx");
    const montados = [...header.matchAll(/<([A-Z][A-Za-z]+Indicator|ModeToggle)\b/g)].map((m) => m[1]).sort();
    expect(montados).toEqual(["ChannelHealthIndicator", "ModeToggle", "SchedulerHealthIndicator"]);
  });

  it("todo popup do cabeçalho leva as duas travas", () => {
    let total = 0;
    for (const arquivo of DO_CABECALHO) {
      for (const abertura of aberturas(ler(arquivo))) {
        total += 1;
        expect(abertura, arquivo).toMatch(/collisionAvoidance=\{ABRE_PARA_BAIXO\}/);
        // A altura pela TELA, nunca pela `--available-height` do base-ui (a
        // mesma medição torta que fazia o lado inverter).
        expect(abertura, arquivo).toContain("max-h-[calc(var(--altura-visivel,100dvh)-5rem)]");
      }
    }
    // Menu da conta, conexões e agendador.
    expect(total).toBe(3);
  });

  it("os primitivos repassam o collisionAvoidance (vieram do upstream: um merge cru o perde)", () => {
    for (const arquivo of ["components/ui/dropdown-menu.tsx", "components/ui/popover.tsx"]) {
      const fonte = ler(arquivo);
      expect(fonte, arquivo).toMatch(/"align" \| "alignOffset" \| "side" \| "sideOffset" \| "collisionAvoidance"/);
      expect(fonte, arquivo).toMatch(/collisionAvoidance=\{collisionAvoidance\}/);
    }
  });
});
