import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TIPOS_DE_ACAO } from './agente'
import {
  avisoDaTarefa,
  MOTIVOS_DE_TRANSFERENCIA,
  textosDaAcao,
  textosDaPassagem,
  textosDaTransferencia,
} from './textos-do-servidor'

// As chaves da anotação de transferência são MONTADAS (`nota.<motivo>`), e o
// portão de i18n do CI não alcança chave montada: este teste cobra os dois
// dicionários, e a montagem de verdade no idioma da instalação.

const raiz = join(__dirname, '../../..')
function dicionario(nome: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(raiz, 'messages', nome), 'utf8'))
}
function pegar(d: Record<string, unknown>, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), d)
}

describe('textos da transferência do agente', () => {
  for (const arquivo of ['en.json', 'pt-BR.json']) {
    it(`${arquivo}: autor e uma nota por motivo`, () => {
      const d = dicionario(arquivo)
      expect(typeof pegar(d, 'IaAgentes.transferencia.autor')).toBe('string')
      for (const m of MOTIVOS_DE_TRANSFERENCIA) {
        expect(typeof pegar(d, `IaAgentes.transferencia.nota.${m}`), m).toBe('string')
      }
      expect(typeof pegar(d, 'IaAgentes.transferencia.passagem')).toBe('string')
      // As AÇÕES (F4): uma anotação por tipo, e o aviso da tarefa.
      for (const tipo of TIPOS_DE_ACAO) {
        expect(typeof pegar(d, `IaAgentes.transferencia.acoes.${tipo}`), tipo).toBe('string')
      }
      expect(typeof pegar(d, 'IaAgentes.transferencia.acoes.avisoDaTarefa')).toBe('string')
    })
  }

  it('monta o autor e o texto com o nome do agente', async () => {
    const { autor, texto } = await textosDaTransferencia('Triagem', 'sentinela')
    expect(autor).toContain('Triagem')
    expect(texto).toContain('Triagem')
  })

  it('o link inventado (F4) é um motivo de transferência', async () => {
    expect(MOTIVOS_DE_TRANSFERENCIA).toContain('link_inventado')
    const { texto } = await textosDaTransferencia('Triagem', 'link_inventado')
    expect(texto).toContain('Triagem')
  })

  it('a anotação de cada ação (F4) diz o agente, o alvo e o valor', async () => {
    const mover = await textosDaAcao('Triagem', 'mover_etapa', 'Bancário · Proposta')
    expect(mover.autor).toContain('Triagem')
    expect(mover.texto).toContain('Bancário · Proposta')
    const campo = await textosDaAcao('Triagem', 'preencher_campo', 'Tamanho da dívida', 'R$ 150 mil')
    expect(campo.texto).toContain('R$ 150 mil')
    const tarefa = await textosDaAcao('Triagem', 'criar_tarefa', 'Ana', 'Ligar {amanhã}')
    expect(tarefa.texto).toContain('Ligar {amanhã}')
    expect(tarefa.texto).toContain('Ana')
    expect(await avisoDaTarefa('Triagem')).toContain('Triagem')
  })

  it('a passagem (D25): autor da triagem e o nome do destino no texto', async () => {
    const { autor, texto } = await textosDaPassagem('Triagem', 'Cobrança')
    expect(autor).toContain('Triagem')
    expect(texto).toContain('Triagem')
    expect(texto).toContain('Cobrança')
  })
})
