import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { ABRE_PARA_BAIXO } from "./popup-do-cabecalho";

// ============================================================
// Popup do CABEÇALHO abre sempre para baixo, com piso na altura (relato do
// operador, 02/10/2026: no app do iPhone o menu da conta e o das conexões
// abriam para cima, cortados). Ver `popup-do-cabecalho.ts`.
//
// Inventário pelos IMPORTS, nunca por nome (Codex, PR #375): parte do
// `header.tsx` e segue todo componente que ele importa — e os que esses
// importam —, menos os primitivos de `components/ui/`. Um popup novo em
// qualquer filho do cabeçalho entra na conta e reprova sem as travas.
// ============================================================

const SRC = path.join(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");

/** Os módulos de componente que `rel` importa (`@/components/…` fora de `ui/`, e relativos). */
function componentesImportados(rel: string): string[] {
  const saida: string[] = [];
  for (const m of ler(rel).matchAll(/from\s+["']([^"']+)["']/g)) {
    const alvo = m[1];
    let base: string | null = null;
    if (alvo.startsWith("@/components/") && !alvo.startsWith("@/components/ui/")) {
      base = alvo.slice("@/".length);
    } else if (alvo.startsWith(".")) {
      base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), alvo));
    }
    if (!base || base.startsWith("components/ui/")) continue;
    for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      if (fs.existsSync(path.join(SRC, base + ext))) {
        saida.push(base + ext);
        break;
      }
    }
  }
  return saida;
}

/** O cabeçalho e todo componente alcançável pelos imports dele. */
function doCabecalho(): string[] {
  const vistos = new Set<string>();
  const fila = ["components/layout/header.tsx"];
  while (fila.length > 0) {
    const atual = fila.shift()!;
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    fila.push(...componentesImportados(atual));
  }
  return [...vistos];
}

/** Quantas vezes `trecho` aparece no fonte. */
const contar = (fonte: string, trecho: RegExp) => (fonte.match(trecho) ?? []).length;

describe("popup do cabeçalho", () => {
  it("o lado nunca inverte (e não cai para o eixo de lado)", () => {
    expect(ABRE_PARA_BAIXO.side).toBe("none");
    expect(ABRE_PARA_BAIXO.fallbackAxisSide).toBe("none");
  });

  it("o inventário segue os imports (e alcança os indicadores)", () => {
    const modulos = doCabecalho();
    expect(modulos).toContain("components/channels/channel-health-indicator.tsx");
    expect(modulos).toContain("components/scheduled/scheduler-health-indicator.tsx");
    expect(modulos.some((m) => m.startsWith("components/ui/"))).toBe(false);
  });

  it("todo popup do cabeçalho leva as duas travas", () => {
    const comPopup: string[] = [];
    let total = 0;
    for (const arquivo of doCabecalho()) {
      const fonte = ler(arquivo);
      // Por CONTAGEM, em qualquer formatação (Codex, PR #375: o casamento da
      // abertura de várias linhas não enxergava um popup escrito numa só).
      const popups = contar(fonte, /<(PopoverContent|DropdownMenuContent)\b/g);
      if (popups === 0) continue;
      comPopup.push(arquivo);
      total += popups;
      expect(contar(fonte, /collisionAvoidance=\{ABRE_PARA_BAIXO\}/g), arquivo).toBe(popups);
      // A altura pelo espaço que o base-ui mede abaixo do gatilho (desconta a
      // faixa do "Ver como" — Codex, PR #375), com PISO: a mesma medição
      // torta que fazia o lado inverter encolheria o menu até sumir.
      expect(contar(fonte, /max-h-\[max\(var\(--available-height\),16rem\)\]/g), arquivo).toBe(popups);
    }
    // Menu da conta, conexões e agendador. Mudou? Conferir o popup novo e
    // atualizar a conta — é a prova de que a varredura o enxergou.
    expect(comPopup.sort()).toEqual([
      "components/channels/channel-health-indicator.tsx",
      "components/layout/header.tsx",
      "components/scheduled/scheduler-health-indicator.tsx",
    ]);
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
