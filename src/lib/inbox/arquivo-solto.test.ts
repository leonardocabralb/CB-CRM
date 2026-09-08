import { describe, expect, it } from "vitest";

import {
  ACEITE_DO_SELETOR,
  colagemEhAnexo,
  escolherArquivo,
  nomeParaColagem,
  tipoDoArquivo,
} from "./arquivo-solto";

const arquivo = (nome: string, mime: string, bytes = 10): File =>
  new File([new Uint8Array(bytes)], nome, { type: mime });

describe("tipoDoArquivo", () => {
  it("encaixa nos três seletores do compositor", () => {
    expect(tipoDoArquivo("image/png")).toBe("image");
    expect(tipoDoArquivo("video/mp4")).toBe("video");
    expect(tipoDoArquivo("application/pdf")).toBe("document");
    expect(
      tipoDoArquivo("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("document");
  });

  it("⚠️ ignora parâmetros e caixa do MIME — colagem traz `image/png; charset=binary`", () => {
    expect(tipoDoArquivo("image/PNG")).toBe("image");
    expect(tipoDoArquivo("image/png; charset=binary")).toBe("image");
    expect(tipoDoArquivo("  image/jpeg ")).toBe("image");
  });

  it("o que o seletor recusa não entra pela porta de trás", () => {
    // Sem isto, o arquivo subiria e só o WhatsApp o recusaria — depois de
    // ocupar o bucket e com a falha longe da causa.
    expect(tipoDoArquivo("image/heic")).toBeNull();
    expect(tipoDoArquivo("application/x-msdownload")).toBeNull();
    expect(tipoDoArquivo("")).toBeNull();
    expect(tipoDoArquivo(null)).toBeNull();
  });

  it("o `accept` dos seletores sai da MESMA lista", () => {
    for (const mime of ACEITE_DO_SELETOR.document.split(",")) {
      expect(tipoDoArquivo(mime)).toBe("document");
    }
    expect(ACEITE_DO_SELETOR.image).toContain("image/png");
  });
});

describe("escolherArquivo", () => {
  it("um arquivo aceito passa", () => {
    const r = escolherArquivo([arquivo("contrato.pdf", "application/pdf")]);
    expect(r).toMatchObject({ ok: true, recebido: { tipo: "document", ignorados: 0 } });
  });

  it("vários: o primeiro aceito vence e o resto é contado para o aviso", () => {
    const r = escolherArquivo([
      arquivo("a.pdf", "application/pdf"),
      arquivo("b.png", "image/png"),
      arquivo("c.pdf", "application/pdf"),
    ]);
    expect(r.ok && r.recebido.arquivo.name).toBe("a.pdf");
    expect(r.ok && r.recebido.ignorados).toBe(2);
  });

  it("distingue 'não veio arquivo' de 'veio e não serve' — são avisos diferentes", () => {
    expect(escolherArquivo([])).toEqual({ ok: false, motivo: "sem_arquivo" });
    expect(escolherArquivo([arquivo("x.heic", "image/heic")])).toEqual({
      ok: false,
      motivo: "tipo_recusado",
    });
  });
});

describe("colagemEhAnexo", () => {
  it("CRÍTICO: colagem com TEXTO junto não vira upload", () => {
    // Word e Google Docs mandam texto e imagem no mesmo evento. Roubar a
    // colagem ali perderia o texto que a pessoa queria colar.
    expect(colagemEhAnexo({ temArquivo: true, texto: "Prezado cliente," })).toBe(false);
  });

  it("print da tela (só imagem) vira anexo", () => {
    expect(colagemEhAnexo({ temArquivo: true, texto: "" })).toBe(true);
    expect(colagemEhAnexo({ temArquivo: true, texto: "   \n " })).toBe(true);
  });

  it("colar texto puro segue sendo colar texto", () => {
    expect(colagemEhAnexo({ temArquivo: false, texto: "oi" })).toBe(false);
    expect(colagemEhAnexo({ temArquivo: false, texto: "" })).toBe(false);
  });
});

describe("nomeParaColagem", () => {
  const AGORA = new Date("2026-09-08T16:30:45Z");

  it("nome de verdade é preservado", () => {
    expect(nomeParaColagem("contrato-final.pdf", "application/pdf", AGORA)).toBe("contrato-final.pdf");
  });

  it("⚠️ o placeholder do Chrome vira nome com carimbo — dois prints não podem ter o mesmo nome", () => {
    expect(nomeParaColagem("image.png", "image/png", AGORA)).toBe("imagem-20260908-163045.png");
  });

  it("sem nome nenhum também ganha carimbo, com a extensão do MIME", () => {
    expect(nomeParaColagem("", "image/jpeg", AGORA)).toBe("imagem-20260908-163045.jpeg");
    expect(nomeParaColagem("   ", "image/webp", AGORA)).toBe("imagem-20260908-163045.webp");
  });
});
