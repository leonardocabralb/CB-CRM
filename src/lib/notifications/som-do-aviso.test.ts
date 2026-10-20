import { afterEach, describe, expect, it, vi } from "vitest";
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

// ============================================================
// true só com o áudio JÁ rodando (Codex, PR #425): devolver true antes deixava
// o pop-up com `silent` e sem som nenhum quando o navegador recusava o áudio.
// Navegador de mentira; o módulo é recarregado a cada caso (o contexto é dele).
// ============================================================

type Estado = "running" | "suspended";

function navegador(opts: { estado?: Estado; ativa?: boolean; construtorLanca?: boolean }) {
  const criados: { state: Estado; resume: ReturnType<typeof vi.fn> }[] = [];
  class AudioContextFalso {
    state: Estado = opts.estado ?? "running";
    currentTime = 0;
    destination = {};
    resume = vi.fn(() => Promise.resolve());
    constructor() {
      if (opts.construtorLanca) throw new Error("sem saída de áudio");
      criados.push(this);
    }
    createOscillator() {
      return { type: "", frequency: { value: 0 }, connect: (n: unknown) => n, start() {}, stop() {} };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: (n: unknown) => n,
      };
    }
  }
  const armazenado = new Map<string, string>();
  vi.stubGlobal("window", {
    AudioContext: AudioContextFalso,
    localStorage: {
      getItem: (k: string) => armazenado.get(k) ?? null,
      setItem: (k: string, v: string) => void armazenado.set(k, v),
    },
  });
  vi.stubGlobal("navigator", { userActivation: { hasBeenActive: opts.ativa ?? true } });
  return { criados, armazenado };
}

async function moduloNovo() {
  vi.resetModules();
  return import("./som-do-aviso");
}

describe("tocarSomDoAviso — só cala o pop-up com o áudio rodando", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aba com clique e áudio rodando: true, e o toque carimba o intervalo", async () => {
    const { armazenado } = navegador({ estado: "running" });
    const { tocarSomDoAviso: tocar } = await moduloNovo();
    expect(tocar()).toBe(true);
    expect(armazenado.has("cb-som-do-aviso")).toBe(true);
  });

  it("áudio que o navegador deixou suspenso: false (o sistema decide) e pede o resume para o próximo", async () => {
    const { criados, armazenado } = navegador({ estado: "suspended" });
    const { tocarSomDoAviso: tocar } = await moduloNovo();
    expect(tocar()).toBe(false);
    expect(criados[0].resume).toHaveBeenCalledTimes(1);
    expect(armazenado.has("cb-som-do-aviso")).toBe(false);
  });

  it("aba sem clique: false e nem cria o contexto", async () => {
    const { criados } = navegador({ ativa: false });
    const { tocarSomDoAviso: tocar } = await moduloNovo();
    expect(tocar()).toBe(false);
    expect(criados).toHaveLength(0);
  });

  it("construtor que lança não derruba quem chama: false", async () => {
    navegador({ construtorLanca: true });
    const { tocarSomDoAviso: tocar } = await moduloNovo();
    expect(() => tocar()).not.toThrow();
    expect(tocar()).toBe(false);
  });

  it("dentro do intervalo de outro toque: true sem tocar de novo (o som já cobriu)", async () => {
    const { armazenado } = navegador({ estado: "running" });
    armazenado.set("cb-som-do-aviso", String(Date.now()));
    const antes = armazenado.get("cb-som-do-aviso");
    const { tocarSomDoAviso: tocar } = await moduloNovo();
    expect(tocar()).toBe(true);
    expect(armazenado.get("cb-som-do-aviso")).toBe(antes);
  });
});
