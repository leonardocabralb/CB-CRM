import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { REGRAS_DO_FECHAMENTO, REGRAS_DO_SISTEMA, regrasDoSistema } from '@/lib/ia-agentes/regras-do-sistema'

// O cartão "Regras do sistema" pede a tradução de cada regra por chave
// MONTADA (`regrasDoSistema.itens.<id>`), que escapa dos portões de i18n do
// CI: regra nova sem rótulo apareceria como o caminho da chave na tela. Com
// "Conduz o fechamento" (1128), a lista é a de `regrasDoSistema` — as duas do
// fechamento também têm rótulo.

/** Todo id que o cartão pode pedir: o das regras de sempre e o das do fechamento. */
const TODOS_OS_IDS = [...new Set([false, true].flatMap((conduzFechamento) => regrasDoSistema({ conduzFechamento }).map((r) => r.id)))]

function ler(arquivo: string): Record<string, unknown> {
  return (JSON.parse(readFileSync(join(process.cwd(), 'messages', arquivo), 'utf8')) as { IaAgentes: Record<string, unknown> })
    .IaAgentes
}

describe.each(['en.json', 'pt-BR.json'])('IaAgentes.regrasDoSistema em %s', (arquivo) => {
  const d = ler(arquivo).regrasDoSistema as { titulo?: unknown; dica?: unknown; itens?: Record<string, unknown> } | undefined

  it('título (com o total) e a explicação', () => {
    expect(typeof d?.titulo).toBe('string')
    expect(String(d?.titulo)).toContain('{total}')
    expect(typeof d?.dica).toBe('string')
  })

  it('⚠️ um rótulo por regra — as de sempre E as do fechamento —, e nenhum a mais', () => {
    const itens = d?.itens ?? {}
    for (const id of TODOS_OS_IDS) expect(typeof itens[id], id).toBe('string')
    expect(Object.keys(itens).sort()).toEqual([...TODOS_OS_IDS].sort())
    expect(TODOS_OS_IDS).toHaveLength(REGRAS_DO_SISTEMA.length + REGRAS_DO_FECHAMENTO.length)
  })

  it('"Conduz o fechamento": a opção, a explicação, os dois avisos e a marca das regras trocadas', () => {
    const campo = ler(arquivo).campo as Record<string, unknown> | undefined
    for (const k of ['conduzFechamento', 'conduzFechamentoDica', 'conduzFechamentoLigando', 'conduzFechamentoDesligando']) {
      expect(typeof campo?.[k], k).toBe('string')
    }
    expect(typeof (d as Record<string, unknown> | undefined)?.dicaFechamento).toBe('string')
    expect(typeof (d as Record<string, unknown> | undefined)?.doFechamento).toBe('string')
  })

  it('o aviso do Playground e a nota da transferência do pedido vazado', () => {
    const tudo = ler(arquivo) as { playground?: Record<string, unknown>; transferencia?: { nota?: Record<string, unknown> } }
    expect(typeof tudo.playground?.pedidoVazado).toBe('string')
    expect(String(tudo.transferencia?.nota?.pedido_vazado)).toContain('{agente}')
  })
})

describe('o cartão na configuração do agente', () => {
  const fonte = readFileSync(join(process.cwd(), 'src/components/agentes-de-ia/configuracao-do-agente.tsx'), 'utf8')

  it('está montado acima das instruções', () => {
    const cartao = fonte.indexOf('<RegrasDoSistema ')
    expect(cartao).toBeGreaterThan(-1)
    expect(cartao).toBeLessThan(fonte.indexOf("t('campo.instrucoes')"))
  })

  it('⚠️ mostra as regras do RASCUNHO (a opção como está na tela), e a opção fica logo abaixo dele', () => {
    expect(fonte).toContain('<RegrasDoSistema conduzFechamento={conduzFechamento} />')
    const opcao = fonte.indexOf("t('campo.conduzFechamento')")
    expect(opcao).toBeGreaterThan(fonte.indexOf('<RegrasDoSistema '))
    expect(opcao).toBeLessThan(fonte.indexOf("t('campo.instrucoes')"))
  })
})
