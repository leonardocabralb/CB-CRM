// ============================================================
// O selo do documento na bolha do fio: a extensão em letras ("PDF", "XLSX")
// e a família que escolhe a cor.
//
// Existe porque o documento se perdia no meio das mensagens (pedido do
// operador, 01/10/2026): sem miniatura, a bolha era um ícone cinza e um nome
// sobre fundo cinza, igual a um texto qualquer. O selo colorido é a convenção
// que o próprio WhatsApp usa — PDF vermelho, planilha verde, Word azul.
//
// Puro e sem dependência de tela; a cor de cada família mora no componente
// (classe do Tailwind é LITERAL, nunca montada).
// ============================================================

import { extensionForMime } from "./filename";

export type FamiliaDeDocumento =
  | "pdf"
  | "planilha"
  | "texto"
  | "apresentacao"
  | "compactado"
  | "outro";

const FAMILIA_POR_EXTENSAO: Record<string, FamiliaDeDocumento> = {
  pdf: "pdf",
  xls: "planilha",
  xlsx: "planilha",
  xlsm: "planilha",
  csv: "planilha",
  ods: "planilha",
  doc: "texto",
  docx: "texto",
  odt: "texto",
  rtf: "texto",
  txt: "texto",
  ppt: "apresentacao",
  pptx: "apresentacao",
  odp: "apresentacao",
  zip: "compactado",
  rar: "compactado",
  "7z": "compactado",
  gz: "compactado",
  tar: "compactado",
};

/** Extensão que cabe no selo: letras e números, até 4. */
const EXTENSAO_DO_NOME = /\.([a-z0-9]{1,4})$/i;

export interface TipoDeDocumento {
  /** Em maiúsculas, para o selo; vazio quando nada a revela. */
  rotulo: string;
  familia: FamiliaDeDocumento;
}

/**
 * O tipo pelo NOME do arquivo e, sem extensão nele, pelo MIME gravado.
 *
 * O nome vem primeiro porque é o que o operador lê ao lado do selo: um
 * `contrato.pdf` gravado como `application/octet-stream` diz PDF nos dois
 * lugares. Extensão longa demais para o selo (`.backup`) não vira rótulo.
 *
 * ⚠️ `.bin` não é tipo: é a extensão que `mediaFilename` SINTETIZA quando
 * nada revela o tipo (`whatsapp-document-<carimbo>.bin`, documento sem nome
 * declarado e sem nome no endereço). Lida como extensão, o selo diria "BIN"
 * onde o certo é o ícone genérico (Codex, PR #371).
 */
export function tipoDoDocumento(
  nome: string | null | undefined,
  mime: string | null | undefined,
): TipoDeDocumento {
  const doNome = nome?.trim().match(EXTENSAO_DO_NOME)?.[1]?.toLowerCase();
  const doMime = extensionForMime(mime);
  const extensao =
    doNome && doNome !== "bin" ? doNome : doMime === "bin" ? "" : doMime;
  return {
    rotulo: extensao.toUpperCase(),
    familia: FAMILIA_POR_EXTENSAO[extensao] ?? "outro",
  };
}
