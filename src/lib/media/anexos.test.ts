import { describe, it, expect } from "vitest";
import type { ContentType, Message, SenderType } from "@/types";
import {
  coletarAnexos,
  contarPorTipo,
  filtrarPorTipo,
  previaDaTranscricao,
} from "./anexos";

const BUCKET = "https://x.supabase.co/storage/v1/object/public/chat-media";

function msg(
  id: string,
  content_type: ContentType,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversation_id: "conv-1",
    sender_type: (overrides.sender_type ?? "customer") as SenderType,
    content_type,
    status: "delivered",
    created_at: "2026-08-04T10:00:00.000Z",
    ...overrides,
  };
}

describe("coletarAnexos", () => {
  it("junta imagem e vídeo em 'midia', separa documento e áudio", () => {
    const anexos = coletarAnexos([
      msg("i1", "image", { media_url: `${BUCKET}/a/1-foto.jpg` }),
      msg("v1", "video", { media_url: `${BUCKET}/a/2-video.mp4` }),
      msg("d1", "document", { media_url: `${BUCKET}/a/3-contrato.pdf` }),
      msg("a1", "audio", { media_url: `${BUCKET}/a/4-nota.ogg` }),
    ]);

    const porId = Object.fromEntries(anexos.map((a) => [a.messageId, a.tipo]));
    expect(porId).toEqual({
      i1: "midia",
      v1: "midia",
      d1: "documento",
      a1: "audio",
    });
  });

  it("descarta texto, localização, template, interativa e aviso de sistema", () => {
    const anexos = coletarAnexos([
      msg("t1", "text", { content_text: "oi" }),
      msg("l1", "location"),
      msg("tp1", "template", { content_text: "modelo" }),
      msg("in1", "interactive"),
      msg("s1", "system", { content_text: "Fulano entrou" }),
    ]);
    expect(anexos).toEqual([]);
  });

  it("devolve do mais RECENTE para o mais antigo — ao contrário do fio", () => {
    // O fio entrega ordenado por created_at ascendente; a aba responde "o que
    // ele mandou?", que começa pelo último.
    const anexos = coletarAnexos([
      msg("primeiro", "document", { media_url: `${BUCKET}/a/1-a.pdf` }),
      msg("meio", "document", { media_url: `${BUCKET}/a/2-b.pdf` }),
      msg("ultimo", "document", { media_url: `${BUCKET}/a/3-c.pdf` }),
    ]);
    expect(anexos.map((a) => a.messageId)).toEqual([
      "ultimo",
      "meio",
      "primeiro",
    ]);
  });

  it("não reordena por data — inverte a ordem que o fio deu", () => {
    // Três documentos no MESMO minuto é o caso real (o cliente manda em rajada).
    // Ordenar por `created_at` aqui deixaria o desempate ao acaso do sort.
    const mesmoInstante = "2026-08-04T12:45:00.000Z";
    const anexos = coletarAnexos([
      msg("a", "document", {
        media_url: `${BUCKET}/a/1-a.pdf`,
        created_at: mesmoInstante,
      }),
      msg("b", "document", {
        media_url: `${BUCKET}/a/2-b.pdf`,
        created_at: mesmoInstante,
      }),
      msg("c", "document", {
        media_url: `${BUCKET}/a/3-c.pdf`,
        created_at: mesmoInstante,
      }),
    ]);
    expect(anexos.map((a) => a.messageId)).toEqual(["c", "b", "a"]);
  });

  it("pula mensagem sem media_url — anexo de grupo ainda não baixado", () => {
    const anexos = coletarAnexos([
      msg("pendente", "document", { media_state: "pending" }),
      msg("ok", "document", { media_url: `${BUCKET}/a/1-ok.pdf` }),
    ]);
    expect(anexos.map((a) => a.messageId)).toEqual(["ok"]);
  });

  it("⚠️ pula mensagem APAGADA — o arquivo segue no bucket", () => {
    // O fio mostra "Esta mensagem foi apagada". Listar o anexo aqui
    // ressuscitaria, numa aba nova, o que alguém pediu para sumir.
    const anexos = coletarAnexos([
      msg("apagada", "document", {
        media_url: `${BUCKET}/a/1-sigiloso.pdf`,
        deleted_at: "2026-08-04T11:00:00.000Z",
      }),
      msg("viva", "document", { media_url: `${BUCKET}/a/2-ok.pdf` }),
    ]);
    expect(anexos.map((a) => a.messageId)).toEqual(["viva"]);
  });

  it("prefere media_filename e cai no caminho do bucket quando ele é nulo", () => {
    const anexos = coletarAnexos([
      msg("novo", "document", {
        media_url: `${BUCKET}/a/1756000000000-MAR_O_2024.pdf`,
        media_filename: "MARÇO 2024.pdf",
      }),
      msg("antigo", "document", {
        media_url: `${BUCKET}/a/1756000000000-ABRIL_2024.pdf`,
      }),
    ]);
    const porId = Object.fromEntries(anexos.map((a) => [a.messageId, a.nome]));
    expect(porId.novo).toBe("MARÇO 2024.pdf");
    expect(porId.antigo).toBe("ABRIL_2024.pdf");
  });

  it("nunca devolve nome vazio — sintetiza quando não há nada", () => {
    const [anexo] = coletarAnexos([
      msg("sem-nome", "image", {
        media_url: "/api/whatsapp/media/99",
        media_type: "image/jpeg",
      }),
    ]);
    expect(anexo.nome).not.toBe("");
    expect(anexo.nome).toMatch(/\.jpg$/);
  });

  it("suprime a legenda quando ela é só o nome repetido", () => {
    // O caminho da Meta gravava o filename NO content_text; sem a guarda a
    // aba mostraria o mesmo texto duas vezes.
    const [anexo] = coletarAnexos([
      msg("meta-antiga", "document", {
        media_url: `${BUCKET}/a/1756000000000-laudo.pdf`,
        content_text: "laudo.pdf",
      }),
    ]);
    expect(anexo.nome).toBe("laudo.pdf");
    expect(anexo.legenda).toBeUndefined();
  });

  it("mantém a legenda quando ela diz algo além do nome", () => {
    const [anexo] = coletarAnexos([
      msg("com-legenda", "document", {
        media_url: `${BUCKET}/a/1756000000000-laudo.pdf`,
        media_filename: "laudo.pdf",
        content_text: "segue o laudo que você pediu",
      }),
    ]);
    expect(anexo.legenda).toBe("segue o laudo que você pediu");
  });

  it("marca quem mandou", () => {
    const anexos = coletarAnexos([
      msg("dele", "document", {
        media_url: `${BUCKET}/a/1-a.pdf`,
        sender_type: "customer",
      }),
      msg("nosso", "document", {
        media_url: `${BUCKET}/a/2-b.pdf`,
        sender_type: "agent",
      }),
    ]);
    const porId = Object.fromEntries(
      anexos.map((a) => [a.messageId, a.doCliente]),
    );
    expect(porId).toEqual({ dele: true, nosso: false });
  });

  it("aguenta conversa sem anexo nenhum", () => {
    expect(coletarAnexos([])).toEqual([]);
    expect(coletarAnexos([msg("t", "text", { content_text: "oi" })])).toEqual(
      [],
    );
  });
});

describe("previaDaTranscricao", () => {
  it("só usa transcrição PRONTA", () => {
    // `falhou`/`recusada` não têm texto; `transcrevendo` teria um pela metade.
    for (const status of [
      "transcrevendo",
      "falhou",
      "recusada",
      null,
    ] as const) {
      expect(
        previaDaTranscricao(
          msg("a", "audio", {
            transcricao: "bom dia doutor",
            transcricao_status: status,
          }),
        ),
      ).toBeUndefined();
    }
    expect(
      previaDaTranscricao(
        msg("a", "audio", {
          transcricao: "bom dia doutor",
          transcricao_status: "pronta",
        }),
      ),
    ).toBe("bom dia doutor");
  });

  it("colapsa quebras de linha — a lista é de uma linha só", () => {
    expect(
      previaDaTranscricao(
        msg("a", "audio", {
          transcricao: "bom dia\n\ndoutor,   tudo bem?",
          transcricao_status: "pronta",
        }),
      ),
    ).toBe("bom dia doutor, tudo bem?");
  });

  it("corta com reticência quando passa do teto", () => {
    const previa = previaDaTranscricao(
      msg("a", "audio", {
        transcricao: "palavra ".repeat(40),
        transcricao_status: "pronta",
      }),
    );
    expect(previa).toMatch(/…$/);
    expect(previa!.length).toBeLessThanOrEqual(91);
  });

  it("trata transcrição vazia ou só espaço como ausente", () => {
    expect(
      previaDaTranscricao(
        msg("a", "audio", { transcricao: "   ", transcricao_status: "pronta" }),
      ),
    ).toBeUndefined();
  });
});

describe("coletarAnexos + transcrição", () => {
  it("⚠️ só o ÁUDIO ganha a prévia — documento tem nome de verdade", () => {
    const anexos = coletarAnexos([
      msg("aud", "audio", {
        // O que o WhatsApp entrega como nome de nota de voz: o id do objeto.
        media_url: `${BUCKET}/a/3A0B20C39A96D7D3761A.oga`,
        transcricao: "preciso do contrato",
        transcricao_status: "pronta",
      }),
      msg("doc", "document", {
        media_url: `${BUCKET}/a/1756000000000-contrato.pdf`,
        transcricao: "não deveria aparecer",
        transcricao_status: "pronta",
      }),
    ]);
    const porId = Object.fromEntries(
      anexos.map((a) => [a.messageId, a.transcricao]),
    );
    expect(porId.aud).toBe("preciso do contrato");
    expect(porId.doc).toBeUndefined();
  });

  it("áudio sem transcrição fica sem prévia — a tela usa rótulo genérico", () => {
    const [anexo] = coletarAnexos([
      msg("aud", "audio", {
        media_url: `${BUCKET}/a/3A0B20C39A96D7D3761A.oga`,
      }),
    ]);
    expect(anexo.transcricao).toBeUndefined();
    // O `nome` continua sendo o do arquivo — ele serve ao download, não à
    // lista. É a tela que decide não mostrá-lo.
    expect(anexo.nome).toBe("3A0B20C39A96D7D3761A.oga");
  });
});

describe("contarPorTipo", () => {
  it("conta as três prateleiras, inclusive as vazias", () => {
    const anexos = coletarAnexos([
      msg("i1", "image", { media_url: `${BUCKET}/a/1-a.jpg` }),
      msg("i2", "image", { media_url: `${BUCKET}/a/2-b.jpg` }),
      msg("v1", "video", { media_url: `${BUCKET}/a/3-c.mp4` }),
      msg("d1", "document", { media_url: `${BUCKET}/a/4-d.pdf` }),
    ]);
    expect(contarPorTipo(anexos)).toEqual({
      midia: 3,
      documento: 1,
      audio: 0,
    });
  });

  it("devolve zeros para conversa sem anexo", () => {
    expect(contarPorTipo([])).toEqual({ midia: 0, documento: 0, audio: 0 });
  });
});

describe("filtrarPorTipo", () => {
  it("preserva a ordem do acervo", () => {
    const anexos = coletarAnexos([
      msg("d1", "document", { media_url: `${BUCKET}/a/1-a.pdf` }),
      msg("i1", "image", { media_url: `${BUCKET}/a/2-b.jpg` }),
      msg("d2", "document", { media_url: `${BUCKET}/a/3-c.pdf` }),
    ]);
    // Acervo vem invertido: d2, i1, d1 → só documentos: d2, d1.
    expect(filtrarPorTipo(anexos, "documento").map((a) => a.messageId)).toEqual([
      "d2",
      "d1",
    ]);
  });
});
