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
//
// E o proxy da Meta (`/api/whatsapp/media/<id>`, a reserva do anexo que o
// espelho no bucket não guardou): desde o porte do #678 ele manda como
// DOWNLOAD tudo o que não é imagem, áudio ou vídeo comum, e sem o nome o
// arquivo baixaria como `<id>.pdf`. Por isso o link leva `nome=<nome>`, que o
// proxy põe no `Content-Disposition` (`proxy-response-headers.ts`).
// ============================================================

import { isProxiedMediaUrl } from './blob-cache';
import { semSurrogatoSolto } from './filename';

/** O anexo é uma página HTML? Pelo tipo, ou pela extensão quando o tipo falta. */
export function ehPaginaHtml(mime: string | null | undefined, nome: string | null | undefined): boolean {
  const tipo = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (tipo === 'text/html' || tipo === 'application/xhtml+xml') return true;
  return /\.x?html?$/i.test((nome ?? '').trim());
}

/**
 * O `href` do anexo. Igual à URL, menos em dois casos: o .html guardado no
 * Storage do Supabase (`/storage/v1/object/public/`) ganha `download=<nome>`;
 * a URL do proxy da Meta ganha `nome=<nome>` (qualquer tipo — é o proxy que
 * decide o que abre e o que baixa). URL de outro lugar não é tocada.
 *
 * ⚠️ Roda no RENDER (bolha e aba Arquivos): o nome passa por
 * `semSurrogatoSolto` antes de `encodeURIComponent`, que LANÇA com meio emoji
 * — e derrubaria a conversa inteira por causa de um nome de arquivo.
 */
export function urlParaAbrirAnexo(
  url: string,
  mime: string | null | undefined,
  nome: string | null | undefined,
): string {
  if (isProxiedMediaUrl(url)) {
    const arquivo = (nome ?? '').trim();
    if (!arquivo || /[?&]nome=/.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}nome=${encodeURIComponent(semSurrogatoSolto(arquivo))}`;
  }
  if (!ehPaginaHtml(mime, nome) || !url.includes('/storage/v1/object/public/')) return url;
  if (/[?&]download(=|&|$)/.test(url)) return url;
  const arquivo = (nome ?? '').trim() || 'pagina.html';
  return `${url}${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(semSurrogatoSolto(arquivo))}`;
}
