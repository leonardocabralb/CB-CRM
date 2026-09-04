/**
 * CSV para o operador abrir no Excel/Numbers em pt-BR: separador `;` e BOM
 * UTF-8 — sem os dois, o Excel em português abre tudo numa coluna só e
 * troca os acentos. Todo campo vai entre aspas (RFC 4180), quebra de linha
 * CRLF.
 *
 * ⚠️ A página de broadcast tem um `toCsv` privado com `,` (arquivo do
 * upstream). Não foi unificado de propósito: duas cópias de quinze linhas
 * custam menos que um conflito de merge naquele arquivo.
 */

export const BOM_UTF8 = "\uFEFF";

export function paraCsv(linhas: readonly (readonly string[])[], separador = ";"): string {
  const escapar = (valor: string) => `"${valor.replace(/"/g, '""')}"`;
  return BOM_UTF8 + linhas.map((linha) => linha.map(escapar).join(separador)).join("\r\n") + "\r\n";
}

/** Nome de arquivo sem acento, espaço ou caractere que o sistema recuse. */
export function nomeDeArquivoSeguro(texto: string): string {
  const base = texto
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "arquivo";
}

/** Dispara o download no navegador. Não roda no servidor. */
export function baixarArquivo(nome: string, conteudo: string, tipo = "text/csv;charset=utf-8;"): void {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
