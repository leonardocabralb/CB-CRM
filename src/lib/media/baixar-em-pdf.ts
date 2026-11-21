// ============================================================
// "Baixar em PDF" do visualizador de mídia: a imagem vira um PDF A4 NO
// NAVEGADOR de quem clicou, na hora. Nada vai ao servidor, nada é guardado.
//
// A imagem passa por um <canvas> antes de entrar no PDF, sempre, mesmo
// quando já é JPEG. É o canvas que:
//   - aplica o GIRO que o advogado deu no visualizador (a foto do documento
//     chegou deitada e sai em pé);
//   - reduz foto grande demais (`LADO_MAXIMO_PX`);
//   - entrega um JPEG simples, colorido e sem EXIF. O PDF ignora a
//     orientação gravada no EXIF, e embutir o arquivo original faria a foto
//     de celular aparecer deitada no PDF embora em pé na tela;
//   - põe fundo BRANCO no PNG transparente (print, figurinha), que no JPEG
//     viraria preto.
// O resto (montar o PDF) é puro, em `pdf-de-imagem.ts`.
// ============================================================

import { nomeEmPdf, pdfDeImagem } from "./pdf-de-imagem";

/**
 * Lado maior, em pixels: o A4 a 300 dpi. Foto do WhatsApp chega com ~1600 px
 * e passa sem redução; só a "HD" (até 4096 px) e o arquivo enviado como
 * documento encolhem — e continuam legíveis impressos. Também fica abaixo do
 * teto de área do canvas do Safari no iPhone (~16,7 milhões de pixels).
 */
export const LADO_MAXIMO_PX = 3508;

const QUALIDADE_JPEG = 0.85;

/**
 * Baixa a imagem em `src` como PDF.
 *
 * @param giro graus no sentido horário (0, 90, 180 ou 270), o mesmo do
 *   visualizador.
 * Lança em qualquer falha — quem chama avisa. Diferente do "Baixar" comum,
 * não há o recurso de abrir numa aba: aberta, a imagem não seria o PDF pedido.
 */
export async function baixarImagemEmPdf(src: string, nome: string, giro: number): Promise<void> {
  // Busca o binário (como o "Baixar" do visualizador): a imagem do bucket é
  // de outra origem, e desenhá-la direto pelo endereço "suja" o canvas, que
  // então se recusa a exportar. Pelo blob, ela é da página.
  const res = await fetch(src);
  if (!res.ok) throw new Error(`A imagem respondeu ${res.status}.`);
  const urlDaImagem = URL.createObjectURL(await res.blob());

  let jpeg: Uint8Array;
  try {
    const img = new Image();
    img.src = urlDaImagem;
    await img.decode();

    const escala = Math.min(1, LADO_MAXIMO_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const largura = Math.max(1, Math.round(img.naturalWidth * escala));
    const altura = Math.max(1, Math.round(img.naturalHeight * escala));
    const deitada = giro === 90 || giro === 270;

    const canvas = document.createElement("canvas");
    canvas.width = deitada ? altura : largura;
    canvas.height = deitada ? largura : altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("O navegador não ofereceu o canvas.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Gira em torno do centro; positivo é horário no canvas, como no CSS do
    // visualizador.
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((giro * Math.PI) / 180);
    ctx.drawImage(img, -largura / 2, -altura / 2, largura, altura);

    const saida = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALIDADE_JPEG),
    );
    if (!saida) throw new Error("O navegador não gerou o JPEG.");
    jpeg = new Uint8Array(await saida.arrayBuffer());
  } finally {
    URL.revokeObjectURL(urlDaImagem);
  }

  // Clique num <a download> com o blob — a mesma mecânica do "Baixar".
  const urlDoPdf = URL.createObjectURL(
    new Blob([pdfDeImagem(jpeg)], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = urlDoPdf;
  a.download = nomeEmPdf(nome);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revogar no mesmo tique pode cancelar o download no Safari.
  setTimeout(() => URL.revokeObjectURL(urlDoPdf), 60_000);
}
