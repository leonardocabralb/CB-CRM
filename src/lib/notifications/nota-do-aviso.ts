import type { Notification } from "@/types";

// ============================================================
// A anotação de um aviso de menção/resposta ainda existe? (1132)
//
// Pedido do operador (10/11/2026), depois de um caso real: a colaboradora
// abriu o aviso de menção, a conversa abriu e a anotação não estava lá — a
// autora a tinha apagado, e nada dizia isso. Agora o aviso diz "Anotação
// apagada", com o texto COMPLETO, quem apagou e quando.
//
// A resposta sai da linha que `notifications.note_id` (1114) aponta:
//   - viva                 → nada muda;
//   - marcada (`apagada_em`, 1132) → "apagada", com o texto INTEIRO da linha
//     e quem apagou;
//   - não existe mais      → "apagada", com o texto que o aviso guardou
//     (`body`, até 280 caracteres): a apagada antes da lixeira existir, a
//     que venceu os 90 dias, ou a ficha que foi para a Lixeira de contatos.
// Leitura que não respondeu = "não sei": o aviso fica como era — nunca
// "apagada" por ignorância (raiz, 8c).
// ============================================================

/** A parte da anotação que o aviso precisa (a leitura é enxuta). */
export interface LinhaDaNotaDoAviso {
  id: string;
  texto: string;
  apagada_em: string | null;
  apagada_por_nome: string | null;
}

/** As colunas da leitura — a forma de `LinhaDaNotaDoAviso`. */
export const COLUNAS_DA_NOTA_DO_AVISO = "id, texto, apagada_em, apagada_por_nome";

export type NotaDoAviso =
  | { estado: "viva" }
  | {
      estado: "apagada";
      /** O texto a mostrar inteiro (o da linha; sem ela, o do aviso). */
      texto: string;
      /** Quem apagou e quando — só com a linha marcada (1132). */
      apagadaPor: string | null;
      apagadaEm: string | null;
    };

/** Os avisos que apontam uma anotação. */
export function ehAvisoDeNota<T extends Pick<Notification, "type" | "note_id">>(
  aviso: T,
): aviso is T & { note_id: string } {
  return (
    (aviso.type === "note_mention" || aviso.type === "note_reply") &&
    typeof aviso.note_id === "string" &&
    aviso.note_id !== ""
  );
}

/** Os ids a ler, sem repetir, em ordem estável (vira a chave da leitura). */
export function idsDasNotasDosAvisos(
  avisos: readonly Pick<Notification, "type" | "note_id">[],
): string[] {
  const ids = new Set<string>();
  for (const a of avisos) if (ehAvisoDeNota(a)) ids.add(a.note_id);
  return [...ids].sort();
}

/**
 * O estado da anotação do aviso. `null` = nada a dizer: não é aviso de
 * anotação (ou é anterior à 1114, sem `note_id`), ou a leitura ainda não
 * respondeu / falhou (`linhas` nulo).
 */
export function notaDoAviso(
  aviso: Pick<Notification, "type" | "note_id" | "body">,
  linhas: ReadonlyMap<string, LinhaDaNotaDoAviso> | null,
): NotaDoAviso | null {
  if (!ehAvisoDeNota(aviso) || !linhas) return null;
  const linha = linhas.get(aviso.note_id);
  if (!linha) {
    return {
      estado: "apagada",
      texto: aviso.body ?? "",
      apagadaPor: null,
      apagadaEm: null,
    };
  }
  if (!linha.apagada_em) return { estado: "viva" };
  return {
    estado: "apagada",
    // Anotação só de anexos (1102) tem o texto vazio: vale o resumo que o
    // aviso guardou ("🎤 Áudio").
    texto: linha.texto?.trim() ? linha.texto : (aviso.body ?? ""),
    apagadaPor: linha.apagada_por_nome?.trim() || null,
    apagadaEm: linha.apagada_em,
  };
}
