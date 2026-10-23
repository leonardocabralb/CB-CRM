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

/** Locale e fuso: os do NAVEGADOR (`undefined`) na tela; os testes os fixam. */
export interface OndeSeLe {
  locale?: string;
  timeZone?: string;
}

/**
 * A hora da EDIÇÃO, VISÍVEL ao lado da marca "editada" (decisão do operador,
 * 23/10/2026: a A4 é a marca COM a hora, e no celular não há `title`). Só a
 * hora quando a edição foi no mesmo dia — no fuso de quem lê — em que a
 * anotação foi escrita (esse dia já está ao lado); noutro dia, dia e mês;
 * noutro ano (ou sem a data de criação), também o ano. `null` = instante
 * ilegível.
 */
export function quandoFoiEditada(
  editadaEm: string,
  criadaEm: string | null | undefined,
  { locale, timeZone }: OndeSeLe = {}
): string | null {
  const editada = new Date(editadaEm);
  if (Number.isNaN(editada.getTime())) return null;
  const criada = criadaEm ? new Date(criadaEm) : null;
  // O dia no fuso de quem lê, pelas PARTES (nunca pelo texto formatado).
  const dia = (d: Date) => {
    const partes = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(d);
    const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
    return { ano: parte('year'), dia: `${parte('year')}-${parte('month')}-${parte('day')}` };
  };
  const daEdicao = dia(editada);
  const daCriacao = criada && !Number.isNaN(criada.getTime()) ? dia(criada) : null;
  const hora = { hour: '2-digit', minute: '2-digit', timeZone } as const;
  if (daCriacao?.dia === daEdicao.dia) return editada.toLocaleTimeString(locale, hora);
  return editada.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    ...(daCriacao?.ano === daEdicao.ano ? {} : { year: 'numeric' }),
    ...hora,
  });
}
