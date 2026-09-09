import { describe, expect, it } from "vitest";

import { idDaReuniaoDoLink, lerAvisoDoWebhook, lerNotas, lerReuniao, lerTranscricao } from "./leitura";

/** A forma do exemplo oficial (`GET /v1alpha1/meetings/{id}`, doc do tl;dv). */
function reuniao(extra: Record<string, unknown> = {}) {
  return {
    id: "653663ac7c8dbd00130f11d9",
    name: "Reunião com Advogado - Kommo",
    happenedAt: "2026-09-08T14:00:00.000Z",
    url: "https://tldv.io/app/meetings/653663ac7c8dbd00130f11d9",
    duration: 1800,
    organizer: { name: "Leonardo", email: "Leonardo@Escritorio.example" },
    invitees: [
      { name: "Marcelo", email: "marcelo@example.com" },
      { name: "", email: "" },
    ],
    template: "string",
    extraProperties: { conferenceId: "abc" },
    ...extra,
  };
}

describe("lerReuniao", () => {
  it("lê a forma da doc, normalizando e-mail para minúsculas e descartando convidado vazio", () => {
    const r = lerReuniao(reuniao());
    expect(r).toEqual({
      id: "653663ac7c8dbd00130f11d9",
      nome: "Reunião com Advogado - Kommo",
      realizadaEm: "2026-09-08T14:00:00.000Z",
      url: "https://tldv.io/app/meetings/653663ac7c8dbd00130f11d9",
      duracaoSeg: 1800,
      organizador: { nome: "Leonardo", email: "leonardo@escritorio.example" },
      convidados: [{ nome: "Marcelo", email: "marcelo@example.com" }],
    });
  });

  it("sem id ou sem data não é reunião", () => {
    expect(lerReuniao(reuniao({ id: "" }))).toBeNull();
    expect(lerReuniao(reuniao({ happenedAt: "ontem" }))).toBeNull();
    expect(lerReuniao(null)).toBeNull();
    expect(lerReuniao("x")).toBeNull();
  });

  it("duração torta vira nula; nome vazio ganha rótulo", () => {
    expect(lerReuniao(reuniao({ duration: -5 }))?.duracaoSeg).toBeNull();
    expect(lerReuniao(reuniao({ duration: "1800" }))?.duracaoSeg).toBeNull();
    expect(lerReuniao(reuniao({ name: "  " }))?.nome).toBe("(sem nome)");
  });
});

describe("lerTranscricao", () => {
  it("lê as frases e descarta as vazias", () => {
    const frases = lerTranscricao({
      id: "t1",
      meetingId: "m1",
      data: [
        { speaker: "Leonardo", text: "Bom dia.", startTime: 0, endTime: 1.5 },
        { speaker: "Marcelo", text: "   ", startTime: 2, endTime: 3 },
        { speaker: "Marcelo", text: "Bom dia, doutor.", startTime: 2, endTime: 4 },
      ],
    });
    expect(frases).toEqual([
      { orador: "Leonardo", texto: "Bom dia.", inicioSeg: 0, fimSeg: 1.5 },
      { orador: "Marcelo", texto: "Bom dia, doutor.", inicioSeg: 2, fimSeg: 4 },
    ]);
  });

  it("forma errada é null, e não lista vazia — são respostas diferentes", () => {
    expect(lerTranscricao({ id: "t1" })).toBeNull();
    expect(lerTranscricao({ data: [] })).toEqual([]);
  });
});

describe("lerNotas", () => {
  it("lê markdown e tópicos; sem nada útil é null", () => {
    expect(
      lerNotas({ structuredNotes: [], markdownContent: "# Resumo\n- x", topics: [{ id: "1", order: 0, title: "Dívida", summary: "..." }] }),
    ).toEqual({ markdown: "# Resumo\n- x", topicos: [{ titulo: "Dívida", resumo: "..." }] });
    expect(lerNotas({ structuredNotes: [], markdownContent: "", topics: [] })).toBeNull();
  });
});

describe("idDaReuniaoDoLink", () => {
  it.each([
    ["https://tldv.io/app/meetings/653663ac7c8dbd00130f11d9", "653663ac7c8dbd00130f11d9"],
    ["https://app.tldv.io/meetings/653663AC7C8DBD00130F11D9?tab=notes", "653663ac7c8dbd00130f11d9"],
    ["  653663ac7c8dbd00130f11d9  ", "653663ac7c8dbd00130f11d9"],
  ])("%s → %s", (entrada, esperado) => {
    expect(idDaReuniaoDoLink(entrada)).toBe(esperado);
  });

  it.each(["https://tldv.io/app/meetings/", "https://evil.example/meetings/653663ac7c8dbd00130f11d9x", "653663ac7c8dbd00130f11", "", "javascript:alert(1)"])(
    "recusa %s",
    (entrada) => {
      expect(idDaReuniaoDoLink(entrada)).toBeNull();
    },
  );
});

describe("lerAvisoDoWebhook", () => {
  it("MeetingReady traz a reunião em `data`", () => {
    expect(lerAvisoDoWebhook({ id: "w1", event: "MeetingReady", data: reuniao(), executedAt: "x" })).toEqual({
      evento: "MeetingReady",
      meetingId: "653663ac7c8dbd00130f11d9",
    });
  });

  it("TranscriptReady traz a transcrição, cujo `meetingId` é a reunião", () => {
    expect(
      lerAvisoDoWebhook({ id: "w2", event: "TranscriptReady", data: { id: "aaaaaaaaaaaaaaaaaaaaaaaa", meetingId: "653663ac7c8dbd00130f11d9", data: [] } }),
    ).toEqual({ evento: "TranscriptReady", meetingId: "653663ac7c8dbd00130f11d9" });
  });

  it("evento desconhecido, id fora da forma ou corpo torto: null", () => {
    expect(lerAvisoDoWebhook({ event: "Outro", data: { id: "653663ac7c8dbd00130f11d9" } })).toBeNull();
    expect(lerAvisoDoWebhook({ event: "MeetingReady", data: { id: "../x" } })).toBeNull();
    expect(lerAvisoDoWebhook("MeetingReady")).toBeNull();
  });
});
