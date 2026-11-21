// ============================================================
// PDF de UMA imagem, numa página A4 com margem — o "Baixar em PDF" do
// visualizador de mídia (`media-viewer.tsx`).
//
// Por que montar à mão, sem biblioteca: uma página com uma foto é o PDF mais
// simples que existe — cinco objetos e a tabela de posições. O JPEG entra
// INTEIRO, sem decodificar (o filtro `DCTDecode` do PDF é o próprio JPEG),
// então não há o que uma biblioteca faria a mais aqui, e ela custaria peso no
// navegador e uma dependência para manter.
//
// Puro (sem DOM): quem gira, reduz e reencoda a imagem é
// `baixar-em-pdf.ts`, no navegador.
// ============================================================

/** A4 em pontos (1/72 pol.), retrato. */
export const A4 = { largura: 595.28, altura: 841.89 } as const;

/** 1 cm de margem em cada lado. */
export const MARGEM = 28.35;

export interface CabecalhoJpeg {
  largura: number;
  altura: number;
  /** 1 = tons de cinza, 3 = colorido (YCbCr/RGB). */
  componentes: 1 | 3;
}

/**
 * Lê largura, altura e número de cores do marcador SOF do JPEG.
 *
 * Lê do ARQUIVO, e não confia em quem chamou, por dois motivos: o
 * `canvas.toBlob` cai para PNG quando não sabe gerar o tipo pedido (e PNG
 * embrulhado como JPEG dá um PDF que abre em branco), e o espaço de cor
 * declarado no PDF tem de bater com o número de componentes do arquivo.
 * Lança com mensagem própria quando não é um JPEG que o PDF descreve.
 */
export function lerCabecalhoJpeg(bytes: Uint8Array): CabecalhoJpeg {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Não é um arquivo JPEG.");
  }
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("JPEG malformado.");
    const marcador = bytes[i + 1];
    // Bytes 0xFF de preenchimento entre segmentos são permitidos.
    if (marcador === 0xff) {
      i += 1;
      continue;
    }
    // Marcadores sem segmento (RSTn, TEM): só os dois bytes.
    if ((marcador >= 0xd0 && marcador <= 0xd7) || marcador === 0x01) {
      i += 2;
      continue;
    }
    if (marcador === 0xd9 || marcador === 0xda) break; // fim / início dos dados
    const tamanho = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15, menos DHT (C4), JPG (C8) e DAC (CC), que não são quadro.
    const ehQuadro =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      marcador !== 0xc4 &&
      marcador !== 0xc8 &&
      marcador !== 0xcc;
    if (ehQuadro) {
      if (i + 9 >= bytes.length) break;
      const altura = (bytes[i + 5] << 8) | bytes[i + 6];
      const largura = (bytes[i + 7] << 8) | bytes[i + 8];
      const componentes = bytes[i + 9];
      if (largura === 0 || altura === 0) {
        throw new Error("JPEG sem dimensões.");
      }
      if (componentes !== 1 && componentes !== 3) {
        // 4 = CMYK, que exige a decodificação invertida da Adobe. O canvas
        // nunca gera; um arquivo assim veio de outro lugar.
        throw new Error(`JPEG com ${componentes} componentes de cor não é suportado.`);
      }
      return { largura, altura, componentes };
    }
    if (tamanho < 2) throw new Error("JPEG malformado.");
    i += 2 + tamanho;
  }
  throw new Error("JPEG sem cabeçalho de quadro.");
}

export interface LayoutDaPagina {
  pagina: { largura: number; altura: number };
  /** Retângulo da imagem, em pontos, a partir do canto INFERIOR esquerdo. */
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/**
 * A4 deitado para imagem deitada, em pé para o resto; a imagem cabe inteira
 * dentro da margem, sem distorcer, e fica centralizada.
 */
export function layoutDaPagina(larguraPx: number, alturaPx: number): LayoutDaPagina {
  const deitada = larguraPx > alturaPx;
  const pagina = deitada
    ? { largura: A4.altura, altura: A4.largura }
    : { largura: A4.largura, altura: A4.altura };
  const escala = Math.min(
    (pagina.largura - 2 * MARGEM) / larguraPx,
    (pagina.altura - 2 * MARGEM) / alturaPx,
  );
  const largura = larguraPx * escala;
  const altura = alturaPx * escala;
  return {
    pagina,
    x: (pagina.largura - largura) / 2,
    y: (pagina.altura - altura) / 2,
    largura,
    altura,
  };
}

/** Número de PDF: até 2 casas, sem zero sobrando. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Monta o PDF (uma página) com o JPEG dado. */
export function pdfDeImagem(jpeg: Uint8Array): Uint8Array<ArrayBuffer> {
  const { largura, altura, componentes } = lerCabecalhoJpeg(jpeg);
  const layout = layoutDaPagina(largura, altura);
  const conteudo =
    `q ${num(layout.largura)} 0 0 ${num(layout.altura)} ` +
    `${num(layout.x)} ${num(layout.y)} cm /Im0 Do Q`;

  const texto = new TextEncoder();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  const escrever = (p: Uint8Array | string) => {
    const bytes = typeof p === "string" ? texto.encode(p) : p;
    partes.push(bytes);
    tamanho += bytes.length;
  };

  // Cabeçalho + a linha de comentário com bytes acima de 127, que avisa a
  // quem transfere o arquivo que ele é binário.
  escrever("%PDF-1.4\n");
  escrever(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const posicoes: number[] = [];
  const objeto = (corpo: (string | Uint8Array)[]) => {
    posicoes.push(tamanho);
    escrever(`${posicoes.length} 0 obj\n`);
    for (const p of corpo) escrever(p);
    escrever("\nendobj\n");
  };

  objeto(["<< /Type /Catalog /Pages 2 0 R >>"]);
  objeto(["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  objeto([
    `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${num(layout.pagina.largura)} ${num(layout.pagina.altura)}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  ]);
  objeto([
    `<< /Type /XObject /Subtype /Image /Width ${largura} /Height ${altura} ` +
      `/ColorSpace /${componentes === 1 ? "DeviceGray" : "DeviceRGB"} ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    "\nendstream",
  ]);
  objeto([`<< /Length ${conteudo.length} >>\nstream\n${conteudo}\nendstream`]);

  // Tabela de posições: cada linha tem EXATAMENTE 20 bytes (o leitor pula
  // por conta, não por linha).
  const inicioDaTabela = tamanho;
  escrever(`xref\n0 ${posicoes.length + 1}\n0000000000 65535 f \n`);
  for (const p of posicoes) escrever(`${String(p).padStart(10, "0")} 00000 n \n`);
  escrever(
    `trailer\n<< /Size ${posicoes.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${inicioDaTabela}\n%%EOF\n`,
  );

  const saida = new Uint8Array(tamanho);
  let k = 0;
  for (const p of partes) {
    saida.set(p, k);
    k += p.length;
  }
  return saida;
}

/** Troca a extensão de imagem do nome por `.pdf` (ou acrescenta). */
export function nomeEmPdf(nome: string): string {
  const base = nome.trim().replace(/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i, "");
  return `${base || "imagem"}.pdf`;
}
