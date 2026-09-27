import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { REGRAS_DO_SISTEMA } from '@/lib/ia-agentes/regras-do-sistema'

// O cartão "Regras do sistema" pede a tradução de cada regra por chave
// MONTADA (`regrasDoSistema.itens.<id>`), que escapa dos portões de i18n do
// CI: regra nova sem rótulo apareceria como o caminho da chave na tela.

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

  it('⚠️ um rótulo por regra, e nenhum a mais', () => {
    const itens = d?.itens ?? {}
    for (const r of REGRAS_DO_SISTEMA) expect(typeof itens[r.id], r.id).toBe('string')
    expect(Object.keys(itens).sort()).toEqual(REGRAS_DO_SISTEMA.map((r) => r.id).sort())
  })

  it('o aviso do Playground e a nota da transferência do pedido vazado', () => {
    const tudo = ler(arquivo) as { playground?: Record<string, unknown>; transferencia?: { nota?: Record<string, unknown> } }
    expect(typeof tudo.playground?.pedidoVazado).toBe('string')
    expect(String(tudo.transferencia?.nota?.pedido_vazado)).toContain('{agente}')
  })
})

describe('o cartão na configuração do agente', () => {
  it('está montado acima das instruções', () => {
    const fonte = readFileSync(join(process.cwd(), 'src/components/agentes-de-ia/configuracao-do-agente.tsx'), 'utf8')
    const cartao = fonte.indexOf('<RegrasDoSistema />')
    expect(cartao).toBeGreaterThan(-1)
    expect(cartao).toBeLessThan(fonte.indexOf("t('campo.instrucoes')"))
  })
})
