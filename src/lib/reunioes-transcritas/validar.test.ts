import { describe, expect, it } from "vitest";

import { MAX_TEXTO, validarTranscricaoManual } from "./validar";

const base = {
  contact_id: "0e6a18c1-1111-4222-8333-444444444444",
  titulo: "  Reunião de alinhamento ",
  realizada_em: "2026-09-08T14:00:00-03:00",
  texto: "Leonardo: Bom dia.\r\nMarcelo: Bom dia.",
};

describe("validarTranscricaoManual", () => {
  it("limpa e normaliza: título aparado, data em ISO UTC, quebras de linha unificadas", () => {
    const v = validarTranscricaoManual({ ...base, duracao_seg: "1800", url: " https://tldv.io/app/meetings/x " });
    expect(v).toEqual({
      ok: true,
      dados: {
        contact_id: base.contact_id,
        titulo: "Reunião de alinhamento",
        realizada_em: "2026-09-08T17:00:00.000Z",
        texto: "Leonardo: Bom dia.\nMarcelo: Bom dia.",
        duracao_seg: 1800,
        url: "https://tldv.io/app/meetings/x",
      },
    });
  });

  it("duração e link são opcionais (vazio = nulo)", () => {
    const v = validarTranscricaoManual({ ...base, duracao_seg: "", url: "" });
    expect(v.ok && v.dados.duracao_seg).toBeNull();
    expect(v.ok && v.dados.url).toBeNull();
  });

  it.each([
    ["contato", { ...base, contact_id: "x" }],
    ["titulo", { ...base, titulo: " " }],
    ["titulo", { ...base, titulo: "a".repeat(201) }],
    ["data", { ...base, realizada_em: "ontem" }],
    ["texto", { ...base, texto: "" }],
    ["texto", { ...base, texto: "x".repeat(MAX_TEXTO + 1) }],
    ["duracao", { ...base, duracao_seg: -1 }],
    ["duracao", { ...base, duracao_seg: "muito" }],
    ["url", { ...base, url: "javascript:alert(1)" }],
  ])("recusa %s", (campo, corpo) => {
    expect(validarTranscricaoManual(corpo)).toEqual({ ok: false, erro: campo });
  });

  it("corpo que não é objeto cai no primeiro campo", () => {
    expect(validarTranscricaoManual(null)).toEqual({ ok: false, erro: "contato" });
  });
});
