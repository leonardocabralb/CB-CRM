import { describe, expect, it } from "vitest";
import { INTERVALO_DO_SOM_MS, podeTocarDeNovo, tocarSomDoAviso } from "./som-do-aviso";

const AGORA = Date.parse("2026-10-20T15:00:00Z");

describe("podeTocarDeNovo — um toque a cada 10 s, somadas as abas", () => {
  it("nunca tocou (ou carimbo ilegível) toca", () => {
    expect(podeTocarDeNovo(null, AGORA)).toBe(true);
    expect(podeTocarDeNovo(Number("lixo"), AGORA)).toBe(true);
  });

  it("dentro do intervalo não toca; no limite, toca", () => {
    expect(podeTocarDeNovo(AGORA - 1_000, AGORA)).toBe(false);
    expect(podeTocarDeNovo(AGORA - INTERVALO_DO_SOM_MS + 1, AGORA)).toBe(false);
    expect(podeTocarDeNovo(AGORA - INTERVALO_DO_SOM_MS, AGORA)).toBe(true);
  });

  it("carimbo no futuro (relógio que voltou) não cala o som para sempre", () => {
    expect(podeTocarDeNovo(AGORA + 60_000, AGORA)).toBe(true);
  });
});

describe("tocarSomDoAviso", () => {
  it("sem Web Audio devolve false: o pop-up sai sem `silent` e o sistema decide", () => {
    expect(tocarSomDoAviso()).toBe(false);
  });
});
