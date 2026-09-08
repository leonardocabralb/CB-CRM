import { describe, expect, it } from "vitest";

import {
  ACEITE_DO_SELETOR,
  arquivoParaEnviar,
  colagemEhAnexo,
  escolherArquivos,
  MAX_ANEXOS,
  mimeNormalizado,
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

describe("escolherArquivos", () => {
  it("todos os aceitos passam, na ordem em que vieram", () => {
    const r = escolherArquivos([
      arquivo("a.pdf", "application/pdf"),
      arquivo("b.png", "image/png"),
    ]);
    expect(r.aceitos.map((f) => f.name)).toEqual(["a.pdf", "b.png"]);
    expect(r).toMatchObject({ recusados: 0, excedentes: 0 });
  });

  it("CRÍTICO: cada descarte tem seu próprio número — engolir em silêncio faz o operador achar que mandou", () => {
    const r = escolherArquivos([
      arquivo("ok.pdf", "application/pdf"),
      arquivo("x.heic", "image/heic"),
      arquivo("y.exe", "application/x-msdownload"),
    ]);
    expect(r.aceitos).toHaveLength(1);
    expect(r.recusados).toBe(2);
    expect(r.excedentes).toBe(0);
  });

  it("⚠️ o teto vale para o TOTAL da fila, não para cada soltura", () => {
    const dez = Array.from({ length: 10 }, (_, i) => arquivo(`f${i}.pdf`, "application/pdf"));
    expect(escolherArquivos(dez).aceitos).toHaveLength(MAX_ANEXOS);
    // Com 8 já anexados, sobram 2 vagas.
    const comFila = escolherArquivos(dez, 8);
    expect(comFila.aceitos).toHaveLength(2);
    expect(comFila.excedentes).toBe(8);
    // Fila cheia não aceita mais nenhum.
    expect(escolherArquivos(dez, MAX_ANEXOS).aceitos).toHaveLength(0);
  });

  it("nada aceito e nada recusado quando não veio arquivo", () => {
    expect(escolherArquivos([])).toEqual({ aceitos: [], recusados: 0, excedentes: 0 });
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

describe("mimeNormalizado / arquivoParaEnviar", () => {
  const AGORA = new Date("2026-09-08T16:30:45Z");

  it("tira parâmetros e caixa", () => {
    expect(mimeNormalizado("image/PNG; charset=binary")).toBe("image/png");
    expect(mimeNormalizado(" application/pdf ")).toBe("application/pdf");
    expect(mimeNormalizado(null)).toBe("");
  });

  it("⚠️⚠️ CRÍTICO: o MIME que vai para o Storage é o LIMPO", () => {
    // O bucket `chat-media` tem lista EXATA (023): `image/png; charset=binary`
    // é recusado no upload mesmo depois de o tipo ter sido aceito aqui. Sem
    // esta normalização, a colagem falhava justamente no caso que o código
    // dizia suportar (Codex, PR #141).
    const colado = new File([new Uint8Array(4)], "image.png", { type: "image/png; charset=binary" });
    const pronto = arquivoParaEnviar(colado, AGORA);
    expect(pronto.type).toBe("image/png");
    expect(pronto.name).toBe("imagem-20260908-163045.png");
  });

  it("arquivo já correto não é recriado — copiar bytes à toa", () => {
    const ok = new File([new Uint8Array(4)], "contrato.pdf", { type: "application/pdf" });
    expect(arquivoParaEnviar(ok, AGORA)).toBe(ok);
  });

  it("só o nome errado (MIME já limpo) recria com o MIME intacto", () => {
    const print = new File([new Uint8Array(4)], "image.png", { type: "image/png" });
    const pronto = arquivoParaEnviar(print, AGORA);
    expect(pronto).not.toBe(print);
    expect(pronto.type).toBe("image/png");
    expect(pronto.name).toBe("imagem-20260908-163045.png");
  });

  it("a extensão do nome sai do MIME LIMPO, nunca do cru", () => {
    const colado = new File([new Uint8Array(4)], "", { type: "image/webp; charset=binary" });
    expect(arquivoParaEnviar(colado, AGORA).name).toBe("imagem-20260908-163045.webp");
  });
});
