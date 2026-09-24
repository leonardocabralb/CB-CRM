import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// Fase 10 do plano do merge do upstream: textos que apareciam em INGLÊS
// FIXO na tela e passaram a sair do dicionário. As traduções já existiam
// (vieram do #578 do original, pelo merge #259) e estavam órfãs — ninguém
// as pedia. Um merge que traga a versão crua de um destes arquivos
// devolveria o inglês sem conflito nenhum; este pino reprova.
// ============================================================

const SRC = path.join(__dirname, '..')
const ler = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const PROIBIDOS: Record<string, string[]> = {
  'components/inbox/message-thread.tsx': [
    'Failed to send: ${',
    'Failed to send template: ${',
    'Wait for the message to finish sending',
    'Reaction failed: ${',
    'nomeDoContato(contact, "Customer")',
    ': "network error"',
  ],
  'components/inbox/message-composer.tsx': [
    "AI isn't set up yet",
    "Couldn't draft a reply.",
    "The assistant didn't return a reply.",
    "Couldn't reach the AI assistant.",
    'Recording is too long',
    "Voice recording isn't supported",
    'Microphone access denied',
  ],
  'app/(dashboard)/automations/page.tsx': ['aria-label="active"', 'aria-label="Open menu"'],
  'components/settings/invite-member-dialog.tsx': ['Could not reach the server'],
  'components/contacts/contact-detail-view.tsx': ['Failed to send template: ${', ": 'network error'"],
}

describe('textos portados para o dicionário (Fase 10)', () => {
  for (const [arquivo, textos] of Object.entries(PROIBIDOS)) {
    it(`${arquivo} não volta a ter inglês fixo`, () => {
      const fonte = ler(arquivo)
      expect(textos.filter((t) => fonte.includes(t))).toEqual([])
    })
  }

  it('a lista de automações escreve o gatilho pela chave do construtor, nunca pelo `label` do TRIGGER_META', () => {
    const fonte = ler('app/(dashboard)/automations/page.tsx')
    expect(fonte).toMatch(/useTranslations\("Automations\.builder\.triggers"\)/)
    expect(fonte).toMatch(/tGatilhos\(`\$\{automation\.trigger_type\}\.label`/)
  })
})
