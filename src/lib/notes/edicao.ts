// ============================================================
// A EDIÇÃO da anotação na tela (Fase 3 da 1102) — as regras puras do
// `useEdicaoDeNota` e da caixa (`InternalNoteBox` com `editando`).
// ============================================================

/**
 * O id do aviso "a anotação foi apagada", o MESMO no hook e na caixa: a nota
 * apagada no meio do Salvar acende os dois (a lista a perde e o `PUT` responde
 * `NOTE_GONE`), e o sonner junta avisos de mesmo id num só.
 */
export function idDoAvisoDeApagada(notaId: string): string {
  return `nota-apagada-na-edicao:${notaId}`;
}

/** A edição em curso: a nota (`id`) e a conversa em que ela começou (`de`). */
export interface EdicaoEmCurso {
  de: string;
  id: string;
}

export interface DestinoDaEdicao {
  /** A nota que continua em edição NESTA conversa; `null` = nenhuma. */
  editandoId: string | null;
  /** A edição acabou: quem a guarda a zera (no render). */
  soltar: boolean;
  /** Acabou porque a nota foi APAGADA: o id, para o aviso. */
  apagada: string | null;
}

/**
 * O que fazer com a edição neste render. Ela continua só na conversa em que
 * começou e com a nota NA LISTA. Fora disso acaba — trocar de conversa, a
 * nota apagada, e também a lista vazia por uma busca que FALHOU: sem soltar,
 * a volta (A → B → A) e a recarga boa seguinte REABRIAM a caixa sozinhas, sem
 * o rascunho (que se foi quando ela sumiu). Só a lista RESPONDIDA (`pronta`)
 * diz "apagada": falha não é apagada, e a troca de conversa também não.
 */
export function destinoDaEdicao(
  edicao: EdicaoEmCurso | null,
  conversationId: string | null | undefined,
  notas: readonly { id: string }[],
  pronta: boolean
): DestinoDaEdicao {
  if (!edicao) return { editandoId: null, soltar: false, apagada: null };
  const naConversa = edicao.de === conversationId;
  if (naConversa && notas.some((n) => n.id === edicao.id)) {
    return { editandoId: edicao.id, soltar: false, apagada: null };
  }
  return { editandoId: null, soltar: true, apagada: naConversa && pronta ? edicao.id : null };
}
