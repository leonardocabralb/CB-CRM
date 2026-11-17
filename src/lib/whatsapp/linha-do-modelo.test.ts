import { describe, expect, it } from 'vitest'

import { escolherLinhaDoModelo, type LinhaDoModelo } from './linha-do-modelo'

const linha = (
  id: string,
  channel_id: string | null,
  meta_template_id: string | null = null,
): LinhaDoModelo => ({ id, channel_id, meta_template_id })

describe('escolherLinhaDoModelo', () => {
  it('sem linha, nenhuma', () => {
    expect(escolherLinhaDoModelo([], 'canal-1')).toBeNull()
  })

  it('a do canal vence a global, mesmo a global vinculada', () => {
    const escolhida = escolherLinhaDoModelo(
      [linha('global', null, 'meta-1'), linha('do-canal', 'canal-1')],
      'canal-1',
    )
    expect(escolhida?.id).toBe('do-canal')
  })

  it('entre duas do mesmo lado, a vinculada à Meta; empate fica com a primeira', () => {
    expect(
      escolherLinhaDoModelo(
        [linha('rascunho', null), linha('vinculada', null, 'meta-1')],
        'canal-1',
      )?.id,
    ).toBe('vinculada')
    expect(
      escolherLinhaDoModelo([linha('antiga', null), linha('nova', null)], 'canal-1')?.id,
    ).toBe('antiga')
  })

  it('a de OUTRO canal nunca serve', () => {
    expect(escolherLinhaDoModelo([linha('outro', 'canal-2', 'meta-9')], 'canal-1')).toBeNull()
  })

  it('sem canal (ensaio, conta sem conexão nova), só a global', () => {
    expect(
      escolherLinhaDoModelo([linha('do-canal', 'canal-1'), linha('global', null)], null)?.id,
    ).toBe('global')
  })
})
