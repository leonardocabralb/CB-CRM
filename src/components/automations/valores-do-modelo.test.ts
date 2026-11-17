import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ============================================================
// O "Enviar modelo" do construtor com modelo de variáveis NOMEADAS (D3 do
// porte do upstream, 17/11/2026). `ValoresDoModelo` e
// `ValoresGravadosSemModelo` moram dentro de `automation-builder.tsx`, sem
// export: o pino lê o fonte.
// ============================================================

const fonte = readFileSync(
  join(process.cwd(), 'src/components/automations/automation-builder.tsx'),
  'utf8',
)

function trecho(de: string, ate: string): string {
  const inicio = fonte.indexOf(de)
  const fim = fonte.indexOf(ate, inicio + de.length)
  expect(inicio, de).toBeGreaterThan(-1)
  expect(fim, ate).toBeGreaterThan(inicio)
  return fonte.slice(inicio, fim)
}

describe('ValoresDoModelo', () => {
  const corpo = trecho('function ValoresDoModelo(', 'function vazio(')

  it('um campo por variável do corpo, nos DOIS formatos (posição e nome)', () => {
    // `extractTemplateVariables` lê `{{1}}` e `{{nome}}`; uma régua só de
    // posições deixaria o modelo nomeado sem campo, e o envio, sem valor.
    expect(corpo).toContain('const doCorpo = extractTemplateVariables(modelo.body_text ?? "")')
    expect(corpo).toContain('{doCorpo.map((n) => (')
  })

  it('valor e reserva gravam pela MESMA chave do rótulo, a que o motor lê', () => {
    expect(corpo).toContain('t("templates.variavelLabel", { marca: `{{${n}}}` })')
    expect(corpo).toContain('set({ variables: { ...valores, [String(n)]: texto } })')
    expect(corpo).toContain(
      'set({ variaveis_reserva: { ...reservas, [String(n)]: e.target.value } })',
    )
  })
})

describe('ValoresGravadosSemModelo', () => {
  const corpo = trecho('function ValoresGravadosSemModelo(', 'if (linhas.length === 0) return null')

  it('posições antes dos nomes (as duas réguas num comparador só não são transitivas)', () => {
    expect(corpo).toContain('const ehPosicao = (k: string) => /^\\d+$/.test(k)')
    expect(corpo).toContain('if (pa && pb) return Number(a) - Number(b)')
    expect(corpo).toContain('if (pa !== pb) return pa ? -1 : 1')
  })
})
