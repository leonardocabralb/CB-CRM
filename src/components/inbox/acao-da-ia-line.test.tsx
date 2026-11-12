import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ehAcaoDaIa } from '@/lib/notes/acao-da-ia'
import type { ConversationNote } from '@/types'

import { AcaoDaIaLine } from './acao-da-ia-line'

const NOTA: ConversationNote = {
  id: 'nota-1',
  account_id: 'conta-1',
  conversation_id: 'conv-1',
  contact_id: 'contato-1',
  author_user_id: null,
  autor_nome: 'IA · Atendimento',
  texto: 'Atendimento preencheu Pendência da IA: confirmar a data da saída',
  mencionados: [],
  fixada_em: null,
  resposta_de: null,
  anexos: [],
  editada_em: null,
  tipo: 'acao_da_ia',
  created_at: '2026-11-12T15:08:00.000Z',
}

describe('AcaoDaIaLine (1141)', () => {
  it('a ação da IA é uma faixa: o texto e a hora, sem nenhum botão (responder, fixar, editar, apagar)', () => {
    const html = renderToStaticMarkup(<AcaoDaIaLine nota={NOTA} />)
    expect(html).toContain('Atendimento preencheu Pendência da IA: confirmar a data da saída')
    expect(html).toMatch(/ · \d{2}:\d{2}</)
    expect(html).not.toContain('<button')
  })
})

describe('ehAcaoDaIa', () => {
  it('só o tipo `acao_da_ia`; ausente (linha anterior à 1141) é anotação', () => {
    expect(ehAcaoDaIa(NOTA)).toBe(true)
    expect(ehAcaoDaIa({ ...NOTA, tipo: 'anotacao' })).toBe(false)
    expect(ehAcaoDaIa({ ...NOTA, tipo: undefined })).toBe(false)
  })
})
