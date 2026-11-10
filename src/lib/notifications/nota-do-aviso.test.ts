import { describe, expect, it } from "vitest";

import {
  idsDasNotasDosAvisos,
  notaDoAviso,
  type LinhaDaNotaDoAviso,
} from "./nota-do-aviso";

const viva: LinhaDaNotaDoAviso = {
  id: "n1",
  texto: "Liguei para o cliente",
  apagada_em: null,
  apagada_por_nome: null,
};
const apagada: LinhaDaNotaDoAviso = {
  id: "n2",
  texto: "@Fulana Souza Ligar para o banco amanhã. Texto longo que o aviso cortou…",
  apagada_em: "2026-10-28T17:18:31Z",
  apagada_por_nome: "Beltrana Lima",
};
const linhas = new Map([
  [viva.id, viva],
  [apagada.id, apagada],
]);

const aviso = (note_id: string | null, type = "note_mention", body = "corpo do aviso") => ({
  type: type as "note_mention",
  note_id,
  body,
});

describe("a anotação do aviso (1132)", () => {
  it("só os avisos de menção e resposta COM `note_id` (1114) entram na leitura, sem repetir", () => {
    expect(
      idsDasNotasDosAvisos([
        aviso("n2"),
        aviso("n1", "note_reply"),
        aviso("n2"),
        aviso(null),
        aviso("t1", "task_assigned"),
      ]),
    ).toEqual(["n1", "n2"]);
  });

  it("viva: nada muda", () => {
    expect(notaDoAviso(aviso("n1"), linhas)).toEqual({ estado: "viva" });
  });

  it("marcada (1132): apagada, com o texto INTEIRO da linha, quem apagou e quando", () => {
    expect(notaDoAviso(aviso("n2"), linhas)).toEqual({
      estado: "apagada",
      texto: apagada.texto,
      apagadaPor: "Beltrana Lima",
      apagadaEm: "2026-10-28T17:18:31Z",
    });
  });

  it("só de anexos: o resumo que o aviso guardou, no lugar do texto vazio", () => {
    const soAudio = new Map([["n3", { ...apagada, id: "n3", texto: "" }]]);
    expect(notaDoAviso(aviso("n3", "note_mention", "@Ana · 🎤 Áudio"), soAudio)).toMatchObject({
      texto: "@Ana · 🎤 Áudio",
    });
  });

  it("a linha não existe mais (apagada antes da lixeira, vencida): apagada, com o texto do aviso e sem autoria", () => {
    expect(notaDoAviso(aviso("sumiu", "note_mention", "o que o aviso guardou"), linhas)).toEqual({
      estado: "apagada",
      texto: "o que o aviso guardou",
      apagadaPor: null,
      apagadaEm: null,
    });
  });

  it("leitura que não respondeu ou falhou (`null`) NUNCA vira \"apagada\"", () => {
    expect(notaDoAviso(aviso("n2"), null)).toBeNull();
  });

  it("aviso sem anotação (de tarefa, ou anterior à 1114) não tem o que dizer", () => {
    expect(notaDoAviso(aviso(null), linhas)).toBeNull();
    expect(notaDoAviso(aviso("n2", "task_assigned"), linhas)).toBeNull();
  });
});
