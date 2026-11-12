import { describe, expect, it } from 'vitest'

import type { PerfilDeAcesso } from '@/lib/perfis/tipos'

import {
  corpoDoAvisoDaTransferencia,
  quemAvisarDaTransferencia,
  TETO_DO_CORPO,
  type MembroAvisavel,
} from './aviso-da-transferencia'

// ============================================================
// O aviso quando a IA passa a conversa para a equipe (1139): QUEM recebe
// (D1) e O QUE diz (D2), as duas peças puras. A gravação no banco, com a
// transferência de verdade, está em `turno.test.ts` (describe
// `transferirParaGente`).
// ============================================================

const CANAL_TRAB = 'canal-trabalhista'
const CANAL_BANC = 'canal-bancario'

function perfil(channel_ids: string[]): PerfilDeAcesso {
  return {
    id: `perfil-${channel_ids.join('-') || 'todas'}`,
    account_id: 'conta-1',
    nome: 'Perfil',
    papel_base: 'agent',
    telas: [],
    secoes_config: [],
    channel_ids,
    pipeline_ids: [],
    sistema: false,
  } as unknown as PerfilDeAcesso
}

const MEMBROS: MembroAvisavel[] = [
  { userId: 'dono', papel: 'owner', perfil: null },
  { userId: 'admin', papel: 'admin', perfil: null },
  { userId: 'ana-trab', papel: 'agent', perfil: perfil([CANAL_TRAB]) },
  { userId: 'bia-banc', papel: 'agent', perfil: perfil([CANAL_BANC]) },
  { userId: 'caio-geral', papel: 'agent', perfil: perfil([]) },
]

describe('quemAvisarDaTransferencia — D1 do operador', () => {
  it('os escolhidos no agente, e só eles (fora o responsável)', () => {
    expect(
      quemAvisarDaTransferencia({ escolhidos: ['ana-trab'], responsavel: null, membros: MEMBROS, canalId: CANAL_TRAB }),
    ).toEqual(['ana-trab'])
  })

  it('o responsável pela conversa recebe SEMPRE, junto dos escolhidos, sem repetir', () => {
    expect(
      quemAvisarDaTransferencia({ escolhidos: ['ana-trab'], responsavel: 'bia-banc', membros: MEMBROS, canalId: CANAL_TRAB }),
    ).toEqual(['ana-trab', 'bia-banc'])
    expect(
      quemAvisarDaTransferencia({ escolhidos: ['ana-trab'], responsavel: 'ana-trab', membros: MEMBROS, canalId: CANAL_TRAB }),
    ).toEqual(['ana-trab'])
  })

  it('lista vazia: o dono, os administradores e quem atende o NÚMERO da conversa (a régua dos alarmes de conexão)', () => {
    expect(
      quemAvisarDaTransferencia({ escolhidos: [], responsavel: null, membros: MEMBROS, canalId: CANAL_TRAB }),
    ).toEqual(['dono', 'admin', 'ana-trab', 'caio-geral'])
    expect(
      quemAvisarDaTransferencia({ escolhidos: [], responsavel: null, membros: MEMBROS, canalId: CANAL_BANC }),
    ).toEqual(['dono', 'admin', 'bia-banc', 'caio-geral'])
  })

  it('escolhido que saiu (ou está suspenso, fora da lista de ativos) é ignorado; NINGUÉM ativo = a régua da lista vazia', () => {
    expect(
      quemAvisarDaTransferencia({ escolhidos: ['saiu', 'ana-trab'], responsavel: null, membros: MEMBROS, canalId: CANAL_TRAB }),
    ).toEqual(['ana-trab'])
    // O aviso nunca fica sem ninguém por causa de uma lista velha.
    expect(
      quemAvisarDaTransferencia({ escolhidos: ['saiu'], responsavel: null, membros: MEMBROS, canalId: CANAL_TRAB }),
    ).toEqual(['dono', 'admin', 'ana-trab', 'caio-geral'])
  })

  it('o responsável que não é mais membro ativo não recebe', () => {
    expect(
      quemAvisarDaTransferencia({ escolhidos: ['ana-trab'], responsavel: 'saiu', membros: MEMBROS, canalId: CANAL_TRAB }),
    ).toEqual(['ana-trab'])
  })

  it('conversa sem conexão: só quem não tem recorte de conexão (nunca um número adivinhado)', () => {
    expect(quemAvisarDaTransferencia({ escolhidos: [], responsavel: null, membros: MEMBROS, canalId: null })).toEqual([
      'dono',
      'admin',
      'caio-geral',
    ])
  })
})

describe('corpoDoAvisoDaTransferencia — D2 do operador', () => {
  const MOTIVO = 'Triagem passou a conversa para a equipe: chegou ao limite de respostas nesta conversa.'

  it('o campo preenchido na resposta que passou a conversa ("Pendência da IA: …")', () => {
    expect(corpoDoAvisoDaTransferencia([{ nome: 'Pendência da IA', valor: 'Pediu ligação' }], MOTIVO)).toBe(
      'Pendência da IA: Pediu ligação',
    )
  })

  it('vários campos, um por linha, na ordem em que o agente os escreveu; o mesmo campo vale pelo ÚLTIMO valor', () => {
    expect(
      corpoDoAvisoDaTransferencia(
        [
          { nome: 'Pendência da IA', valor: 'Pediu ligação' },
          { nome: 'Data da saída', valor: '20/10/2026' },
          { nome: 'Pendência da IA', valor: '  Pediu   condição diferente ' },
        ],
        MOTIVO,
      ),
    ).toBe('Data da saída: 20/10/2026\nPendência da IA: Pediu condição diferente')
  })

  it('sem campo (ou só campos vazios): o motivo do sistema', () => {
    expect(corpoDoAvisoDaTransferencia([], MOTIVO)).toBe(MOTIVO)
    expect(corpoDoAvisoDaTransferencia([{ nome: 'Pendência da IA', valor: '   ' }], MOTIVO)).toBe(MOTIVO)
  })

  it(`cortado em ${TETO_DO_CORPO} caracteres, com reticências`, () => {
    const corpo = corpoDoAvisoDaTransferencia([{ nome: 'Pendência da IA', valor: 'x'.repeat(500) }], MOTIVO)
    expect(corpo.length).toBe(TETO_DO_CORPO)
    expect(corpo.endsWith('…')).toBe(true)
  })
})
