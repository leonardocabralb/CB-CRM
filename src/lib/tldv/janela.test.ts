import { describe, expect, it } from "vitest";

import { JANELA_DIAS, JANELA_PRIMEIRA_DIAS, janelaDeSync } from "./janela";

describe("janelaDeSync", () => {
  const agora = new Date("2026-09-09T12:00:00Z");

  it("primeira sincronização: 30 dias", () => {
    const j = janelaDeSync(agora, true);
    expect(j.dias).toBe(JANELA_PRIMEIRA_DIAS);
    expect(j.de.toISOString()).toBe("2026-08-10T12:00:00.000Z");
    expect(j.ate).toBe(agora);
  });

  it("as seguintes: 7 dias, sempre — a transcrição fica pronta depois da reunião", () => {
    const j = janelaDeSync(agora, false);
    expect(j.dias).toBe(JANELA_DIAS);
    expect(j.de.toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });
});
