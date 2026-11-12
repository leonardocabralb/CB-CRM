// ============================================================
// O TIPO da anotação (1141, `cb_conversation_notes.tipo`).
//
// `acao_da_ia` = o que o agente de IA FEZ sem faixa própria na trilha
// (preencheu campo, criou tarefa, executou automação, marcou reunião). O fio
// a desenha como faixa cinza, no molde das linhas da trilha
// (`AcaoDaIaLine`), e a aba Notas e a ficha de /contatos não a listam: é
// registro do que aconteceu, não conversa da equipe (pedido do operador,
// 12/11/2026). Continua anotação de propósito — some com a conversa e vai à
// Lixeira como as outras (o valor do campo é dado da cliente).
//
// ⚠️ A lista vive também no SQL (CHECK `cb_conversation_notes_tipo_ck`):
// pino `supabase/migrations/acoes-da-ia-na-trilha-1141.test.ts`.
// ============================================================

export const TIPOS_DA_NOTA = ['anotacao', 'acao_da_ia'] as const

export type TipoDaNota = (typeof TIPOS_DA_NOTA)[number]

/** A anotação é o registro de uma ação da IA (faixa cinza no fio, fora das listas). */
export function ehAcaoDaIa(nota: { tipo?: string | null }): boolean {
  return nota.tipo === 'acao_da_ia'
}
