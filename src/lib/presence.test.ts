import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  OFFLINE_AFTER_MS,
  derivePresence,
  formatLastSeen,
  summarize,
} from "./presence";

// Fixed reference clock so every case is deterministic.
const NOW = new Date("2026-06-22T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("derivePresence", () => {
  it("returns the stored status for a fresh heartbeat", () => {
    expect(derivePresence("online", ago(1_000), NOW)).toBe("online");
    expect(derivePresence("away", ago(1_000), NOW)).toBe("away");
  });

  it("reads as offline when the heartbeat is stale", () => {
    expect(derivePresence("online", ago(OFFLINE_AFTER_MS + 1_000), NOW)).toBe(
      "offline",
    );
    // Stored 'away' goes stale to offline too (tab was closed while idle).
    expect(derivePresence("away", ago(OFFLINE_AFTER_MS + 1_000), NOW)).toBe(
      "offline",
    );
  });

  it("treats a missing row or timestamp as offline", () => {
    expect(derivePresence(undefined, null, NOW)).toBe("offline");
    expect(derivePresence("online", null, NOW)).toBe("offline");
    expect(derivePresence("online", "not-a-date", NOW)).toBe("offline");
  });

  it("stays online exactly at the threshold and flips just past it", () => {
    expect(derivePresence("online", ago(OFFLINE_AFTER_MS), NOW)).toBe("online");
    expect(derivePresence("online", ago(OFFLINE_AFTER_MS + 1), NOW)).toBe(
      "offline",
    );
  });
});

describe("formatLastSeen", () => {
  // O idioma é parâmetro: o do app (LOCALE_DAS_DATAS.code), nunca o do
  // navegador. Até a Fase 10 as frases eram inglês fixo no código.
  it("describes recent activity coarsely, in the app language", () => {
    expect(formatLastSeen(ago(10_000), NOW, "pt-BR")).toBe("agora");
    expect(formatLastSeen(ago(60_000), NOW, "pt-BR")).toBe("há 1 minuto");
    expect(formatLastSeen(ago(5 * 60_000), NOW, "pt-BR")).toBe("há 5 minutos");
    expect(formatLastSeen(ago(5 * 60_000), NOW, "en-US")).toBe("5 minutes ago");
  });

  it("rolls up into hours and days", () => {
    expect(formatLastSeen(ago(60 * 60_000), NOW, "pt-BR")).toBe("há 1 hora");
    expect(formatLastSeen(ago(2 * 60 * 60_000), NOW, "pt-BR")).toBe("há 2 horas");
    expect(formatLastSeen(ago(24 * 60 * 60_000), NOW, "pt-BR")).toBe("ontem");
    expect(formatLastSeen(ago(3 * 24 * 60 * 60_000), NOW, "pt-BR")).toBe("há 3 dias");
    expect(formatLastSeen(ago(2 * 60 * 60_000), NOW, "en-US")).toBe("2 hours ago");
  });

  it("returns null on missing/invalid input (the caller picks the words)", () => {
    expect(formatLastSeen(null, NOW, "pt-BR")).toBeNull();
    expect(formatLastSeen("nonsense", NOW, "pt-BR")).toBeNull();
  });

  it("never reads the browser language", () => {
    const fonte = readFileSync(join(__dirname, "presence.ts"), "utf8");
    expect(fonte).toMatch(/RelativeTimeFormat\(idioma,/);
  });
});

describe("summarize", () => {
  it("counts each status", () => {
    expect(
      summarize(["online", "online", "online", "away", "offline"]),
    ).toEqual({ online: 3, away: 1, offline: 1 });
  });

  it("returns zeroes for an empty roster", () => {
    expect(summarize([])).toEqual({ online: 0, away: 0, offline: 0 });
  });
});
