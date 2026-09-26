import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ai-config — a tela é da CONTA à vista. Na troca de conta com a tela
// montada, uma conta SEM configuração não pode herdar o prompt e as escolhas
// da anterior: o Salvar os gravaria nela (Codex, #294).
const fonte = readFileSync(join(__dirname, 'ai-config.tsx'), 'utf8')

describe('ai-config — conta sem configuração', () => {
  it('zera os campos quando a resposta diz configured: false', () => {
    const ramo = fonte.slice(fonte.indexOf('if (data.configured) {'))
    const senao = ramo.slice(ramo.indexOf('} else {'), ramo.indexOf('} else {') + 700)
    for (const campo of ['setProvider(', 'setModel(', "setSystemPrompt('')", 'setIsActive(false)', "setHandoffAgentId('')"]) {
      expect(senao, campo).toContain(campo)
    }
  })
})
