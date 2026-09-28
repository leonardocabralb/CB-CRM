// ============================================================
// O link que ABRE um anexo — com uma exceção: a página .html (1060).
//
// A 1060 passou a guardar .html no bucket `chat-media` (decisão do operador:
// os 6 documentos que o celular do escritório mandou e o CRM perdeu em 14
// dias eram todos páginas .html). Aberta direto do armazenamento, a página
// rodaria no navegador — com o que tivesse dentro — a partir do endereço do
// NOSSO Storage. Por isso o .html é oferecido para BAIXAR: o parâmetro
// `download` do Storage manda o arquivo como anexo, e quem o abre é o
// computador de quem baixou, fora do CRM.
//
// Puro: lido pela bolha e pela aba Arquivos.
// ============================================================

/** O anexo é uma página HTML? Pelo tipo, ou pela extensão quando o tipo falta. */
export function ehPaginaHtml(mime: string | null | undefined, nome: string | null | undefined): boolean {
  const tipo = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (tipo === 'text/html' || tipo === 'application/xhtml+xml') return true;
  return /\.x?html?$/i.test((nome ?? '').trim());
}

/**
 * O `href` do anexo. Igual à URL, menos para .html guardado no Storage do
 * Supabase (`/storage/v1/object/public/`), que ganha `download=<nome>`.
 * URL de outro lugar (o proxy da Meta, por exemplo) não é tocada: o parâmetro
 * só significa algo para o Storage.
 */
export function urlParaAbrirAnexo(
  url: string,
  mime: string | null | undefined,
  nome: string | null | undefined,
): string {
  if (!ehPaginaHtml(mime, nome) || !url.includes('/storage/v1/object/public/')) return url;
  if (/[?&]download(=|&|$)/.test(url)) return url;
  const arquivo = (nome ?? '').trim() || 'pagina.html';
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(arquivo)}`;
}
