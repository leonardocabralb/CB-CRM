import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// Integrações — o painel é da CONTA à vista. Trocar de conta com a tela
// montada deixava os cartões da anterior, e "Apagar chave" (a rota resolve a
// conta da sessão) apagaria a chave da conta NOVA com a confirmação mostrando
// a velha (Codex, #294). E a confirmação só lista o que roda hoje.
const fonte = readFileSync(join(__dirname, 'integracoes-panel.tsx'), 'utf8')

describe('integracoes-panel — conta à vista', () => {
  it('o conteúdo remonta quando a conta muda', () => {
    expect(fonte).toMatch(/<Conteudo\s+key=\{accountId\b/)
  })

  it('a confirmação de apagar lista os módulos que rodam hoje, e o assistente desligado (o Playground dele roda)', () => {
    expect(fonte).toMatch(/\.filter\(\(u\)\s*=>\s*!u\.indisponivel\s*\|\|\s*u\.indisponivel\s*===\s*'conversa_desligada'\)/)
    expect(fonte).not.toMatch(/u\.indisponivel\s*!==\s*'sem_chave'/)
  })
})
