import { describe, expect, it } from "vitest";

import {
  A4,
  MARGEM,
  layoutDaPagina,
  lerCabecalhoJpeg,
  nomeEmPdf,
  pdfDeImagem,
} from "./pdf-de-imagem";

/**
 * JPEG mínimo: SOI, um APP0 (para o leitor ter de PULAR segmento), o quadro
 * com as dimensões e o EOI. O PDF não decodifica a imagem, então o miolo não
 * importa para estes testes — o que importa é o cabeçalho e os bytes
 * chegarem intactos.
 */
function jpeg({
  largura,
  altura,
  componentes = 3,
  quadro = 0xc0,
}: {
  largura: number;
  altura: number;
  componentes?: number;
  quadro?: number;
}): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    // APP0 "JFIF", 16 bytes de segmento.
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // Preenchimento permitido entre segmentos.
    0xff,
    // SOFn: tamanho, precisão, altura, largura, componentes.
    0xff, quadro, 0x00, 0x11, 0x08,
    altura >> 8, altura & 0xff,
    largura >> 8, largura & 0xff,
    componentes,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

const decodificar = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

describe("lerCabecalhoJpeg", () => {
  it("lê largura, altura e cores, pulando os segmentos antes do quadro", () => {
    expect(lerCabecalhoJpeg(jpeg({ largura: 1600, altura: 1200 }))).toEqual({
      largura: 1600,
      altura: 1200,
      componentes: 3,
    });
  });

  it("aceita JPEG progressivo (SOF2) e tons de cinza", () => {
    expect(
      lerCabecalhoJpeg(jpeg({ largura: 10, altura: 20, componentes: 1, quadro: 0xc2 })),
    ).toEqual({ largura: 10, altura: 20, componentes: 1 });
  });

  it("recusa o que não é JPEG — o canvas cai para PNG quando não sabe gerar", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => lerCabecalhoJpeg(png)).toThrow(/não é um arquivo jpeg/i);
  });

  it("recusa CMYK, que o PDF descreveria com as cores trocadas", () => {
    expect(() => lerCabecalhoJpeg(jpeg({ largura: 5, altura: 5, componentes: 4 }))).toThrow(
      /4 componentes/,
    );
  });

  it("recusa JPEG sem quadro", () => {
    expect(() => lerCabecalhoJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow();
  });
});

describe("layoutDaPagina", () => {
  it("foto comprida (print de celular) encosta na margem de cima e de baixo", () => {
    const l = layoutDaPagina(1000, 2000);
    expect(l.pagina).toEqual({ largura: A4.largura, altura: A4.altura });
    expect(l.altura).toBeCloseTo(A4.altura - 2 * MARGEM);
    expect(l.largura / l.altura).toBeCloseTo(1000 / 2000);
    expect(l.x).toBeGreaterThan(MARGEM);
    expect(l.x * 2 + l.largura).toBeCloseTo(A4.largura); // centralizada
  });

  it("foto 3:4 em pé, mais larga que o A4 em proporção, encosta nas laterais", () => {
    const l = layoutDaPagina(1200, 1600);
    expect(l.pagina).toEqual({ largura: A4.largura, altura: A4.altura });
    expect(l.largura).toBeCloseTo(A4.largura - 2 * MARGEM);
    expect(l.largura / l.altura).toBeCloseTo(1200 / 1600);
    expect(l.y * 2 + l.altura).toBeCloseTo(A4.altura);
  });

  it("foto deitada vai em A4 deitado", () => {
    const l = layoutDaPagina(1600, 900);
    expect(l.pagina).toEqual({ largura: A4.altura, altura: A4.largura });
    expect(l.largura).toBeCloseTo(A4.altura - 2 * MARGEM);
    expect(l.y * 2 + l.altura).toBeCloseTo(A4.largura);
  });

  it("imagem pequena é ampliada até a margem, sem distorcer", () => {
    const l = layoutDaPagina(100, 100);
    expect(l.largura).toBeCloseTo(A4.largura - 2 * MARGEM);
    expect(l.altura).toBeCloseTo(l.largura);
  });
});

describe("pdfDeImagem", () => {
  const imagem = jpeg({ largura: 1600, altura: 1200 });
  const pdf = pdfDeImagem(imagem);
  const texto = decodificar(pdf);

  it("abre com o cabeçalho e fecha com %%EOF", () => {
    expect(texto.startsWith("%PDF-1.4\n")).toBe(true);
    expect(texto.endsWith("%%EOF\n")).toBe(true);
  });

  it("a tabela de posições aponta para o começo de cada objeto", () => {
    const inicio = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(texto)?.[1]);
    expect(texto.slice(inicio, inicio + 5)).toBe("xref\n");
    const linhas = texto.slice(inicio).split("\n");
    expect(linhas[1]).toBe("0 6");
    for (let n = 1; n <= 5; n++) {
      const linha = `${linhas[2 + n]}\n`;
      expect(linha).toHaveLength(20); // cada linha tem exatamente 20 bytes
      const posicao = Number(linha.slice(0, 10));
      expect(texto.slice(posicao, posicao + `${n} 0 obj`.length)).toBe(`${n} 0 obj`);
    }
  });

  it("leva o JPEG inteiro, com o /Length certo e o espaço de cor certo", () => {
    expect(texto).toContain(
      `/Width 1600 /Height 1200 /ColorSpace /DeviceRGB /BitsPerComponent 8 ` +
        `/Filter /DCTDecode /Length ${imagem.length} >>\nstream\n`,
    );
    const comeco = texto.indexOf(">>\nstream\n", texto.indexOf("/DCTDecode")) + ">>\nstream\n".length;
    expect(Array.from(pdf.slice(comeco, comeco + imagem.length))).toEqual(Array.from(imagem));
    expect(texto.slice(comeco + imagem.length, comeco + imagem.length + 10)).toBe("\nendstream");

    expect(decodificar(pdfDeImagem(jpeg({ largura: 9, altura: 9, componentes: 1 })))).toContain(
      "/ColorSpace /DeviceGray",
    );
  });

  it("página e desenho batem com o layout (foto deitada = A4 deitado)", () => {
    const l = layoutDaPagina(1600, 1200);
    expect(texto).toContain(`/MediaBox [0 0 ${A4.altura} ${A4.largura}]`);
    const conteudo = /stream\n(q [^\n]+ Q)\nendstream/.exec(texto)?.[1] ?? "";
    const [, w, , , h, x, y] = conteudo.split(" ").map(Number);
    expect(w).toBeCloseTo(l.largura, 1);
    expect(h).toBeCloseTo(l.altura, 1);
    expect(x).toBeCloseTo(l.x, 1);
    expect(y).toBeCloseTo(l.y, 1);
    expect(texto).toContain(`/Length ${conteudo.length} >>\nstream\nq `);
  });

  it("não monta PDF de arquivo que não é JPEG", () => {
    expect(() => pdfDeImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow();
  });
});

describe("nomeEmPdf", () => {
  it.each([
    ["foto.jpg", "foto.pdf"],
    ["RG frente.JPEG", "RG frente.pdf"],
    ["print.png", "print.pdf"],
    ["sticker.webp", "sticker.pdf"],
    ["comprovante", "comprovante.pdf"],
    // Ponto no meio do nome não é extensão de imagem.
    ["contrato v2.1", "contrato v2.1.pdf"],
    ["", "imagem.pdf"],
    ["  .jpg ", "imagem.pdf"],
  ])("%j → %j", (entrada, saida) => {
    expect(nomeEmPdf(entrada)).toBe(saida);
  });
});
