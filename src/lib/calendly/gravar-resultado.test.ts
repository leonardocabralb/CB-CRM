import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { gravarResultado } from "./processar";

// ============================================================
// CERCA DE POSSE (Codex, PR #135). Um dono recolhido como abandonado pode
// terminar tarde. Sem a cerca, ele sobrescrevia o resultado de quem tinha
// assumido e SOLTAVA o cadeado vivo do outro — abrindo caminho para um
// terceiro entrar enquanto o segundo ainda rodava.
// ============================================================

function bancoDeMentira(cadeadoAtual: string | null) {
  const filtros: [string, unknown][] = [];
  const payloads: Record<string, unknown>[] = [];
  const admin = {
    from: () => {
      const b: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => (payloads.push(p), b),
        eq: (k: string, v: unknown) => (filtros.push([k, v]), b),
        select: async () => {
          const cerca = filtros.find(([k]) => k === "processando_desde");
          // Sem cerca a escrita é incondicional; com cerca, só casa o dono.
          const casa = !cerca || cerca[1] === cadeadoAtual;
          return { data: casa ? [{ id: "evt-1" }] : [], error: null };
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { admin, filtros, payloads };
}

const RESULTADO = { resultado: "disparado" as const, detalhe: "1 automação", contactId: "c1" };
const MEU_CLAIM = "2026-09-08T12:00:00.000Z";

describe("gravarResultado — cerca de posse", () => {
  it("grava e SOLTA o cadeado quando ele ainda é meu", async () => {
    const { admin, filtros, payloads } = bancoDeMentira(MEU_CLAIM);
    await expect(gravarResultado(admin, "evt-1", RESULTADO, MEU_CLAIM)).resolves.toEqual({ gravou: true });
    expect(filtros).toContainEqual(["processando_desde", MEU_CLAIM]);
    expect(payloads[0]).toMatchObject({ resultado: "disparado", processando_desde: null });
  });

  it("CRÍTICO: dono recolhido não sobrescreve quem assumiu, nem solta o cadeado do outro", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { admin } = bancoDeMentira("2026-09-08T12:30:00.000Z"); // outro dono
    await expect(gravarResultado(admin, "evt-1", RESULTADO, MEU_CLAIM)).resolves.toEqual({ gravou: false });
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });

  it("sem cerca a escrita é incondicional — só para quem nunca reivindicou", async () => {
    const { admin, filtros } = bancoDeMentira("de-outro-dono");
    await expect(gravarResultado(admin, "evt-1", RESULTADO)).resolves.toEqual({ gravou: true });
    expect(filtros.find(([k]) => k === "processando_desde")).toBeUndefined();
  });
});
