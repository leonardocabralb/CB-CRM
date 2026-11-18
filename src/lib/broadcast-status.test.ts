import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import ptBR from "../../messages/pt-BR.json";
import {
  ENTREGA_INCERTA,
  broadcastStatusConfig,
  getBroadcastStatus,
  getRecipientStatus,
  recipientStatusConfig,
} from "./broadcast-status";

describe("getBroadcastStatus", () => {
  it("returns the matching config for known statuses", () => {
    expect(getBroadcastStatus("sending")).toBe(broadcastStatusConfig.sending);
    expect(getBroadcastStatus("sent")).toBe(broadcastStatusConfig.sent);
    expect(getBroadcastStatus("failed")).toBe(broadcastStatusConfig.failed);
  });

  it("flags `sending` as a live/pulsing state", () => {
    expect(getBroadcastStatus("sending").pulse).toBe(true);
    expect(getBroadcastStatus("sent").pulse).toBeFalsy();
  });

  it("falls back to draft on an unknown status string", () => {
    expect(getBroadcastStatus("not-a-real-status")).toBe(
      broadcastStatusConfig.draft,
    );
    expect(getBroadcastStatus("")).toBe(broadcastStatusConfig.draft);
  });

  it("each variant has the dark-theme class triple", () => {
    // Accept both fixed-shade Tailwind names (bg-red-500/10) and
    // token-backed names without a shade number (bg-primary/10) since
    // the brand-accent statuses now ride the active color theme.
    for (const v of Object.values(broadcastStatusConfig)) {
      expect(v.classes).toMatch(/bg-[a-z]+(-\d+)?\/10/);
      expect(v.classes).toMatch(/text-[a-z]+(-\d+)?/);
      expect(v.classes).toMatch(/border-[a-z]+(-\d+)?\/20/);
    }
  });
});

describe("getRecipientStatus", () => {
  it("returns the matching config for known statuses", () => {
    expect(getRecipientStatus("delivered")).toBe(
      recipientStatusConfig.delivered,
    );
    expect(getRecipientStatus("read")).toBe(recipientStatusConfig.read);
  });

  it("falls back to pending on an unknown status string", () => {
    expect(getRecipientStatus("???")).toBe(recipientStatusConfig.pending);
  });

  // A tela traduz o rótulo por chave MONTADA (`tStatus(label)`), que escapa
  // dos portões de i18n: sem isto, um estado novo sairia como a chave crua.
  it("todo rótulo de situação (e de destinatário) existe nos DOIS dicionários", () => {
    const rotulos = [
      ...Object.values(broadcastStatusConfig),
      ...Object.values(recipientStatusConfig),
    ].map((v) => v.label);
    for (const dicionario of [ptBR, en]) {
      const status = dicionario.Broadcasts.status as Record<string, string>;
      for (const rotulo of rotulos) {
        expect(status[rotulo], `Broadcasts.status.${rotulo}`).toBeTruthy();
      }
    }
  });

  it("NOSSO (1151): a entrega incerta tem etiqueta própria, legível nos dois temas", () => {
    expect(ENTREGA_INCERTA).toBe("uncertain");
    expect(getRecipientStatus(ENTREGA_INCERTA)).toBe(recipientStatusConfig.uncertain);
    // `amber-700` passa nos dois modos; `amber-500` dá 2,08 no claro (`ui.md`).
    expect(recipientStatusConfig.uncertain.classes).toContain("text-amber-700");
    expect(ptBR.Broadcasts.status.uncertain).toBe("Entrega incerta");
  });
});
