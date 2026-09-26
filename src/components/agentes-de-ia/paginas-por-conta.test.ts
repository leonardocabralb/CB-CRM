import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// As telas de agentes guardam dado DA CONTA (agentes, custos, cotação,
// conversa do Playground). Trocar de conta sem recarregar muda o perfil no
// lugar: sem a `key` com a conta, a tela ficava com o dado da anterior — e
// salvar a cotação a gravaria na nova (Codex, #295).
const raiz = join(__dirname, '..', '..', '..')
const ler = (c: string) => readFileSync(join(raiz, c), 'utf8')

describe('agentes de IA — as telas remontam ao trocar de conta', () => {
  it('a lista e o Uso', () => {
    expect(ler('src/app/(dashboard)/agents/page.tsx')).toContain("key={accountId ?? 'sem-conta'}")
  })
  it('o detalhe do agente', () => {
    expect(ler('src/app/(dashboard)/agents/[id]/page.tsx')).toContain("key={`${accountId ?? 'sem-conta'}:${id}`}")
  })
  it('o assistente anterior', () => {
    expect(ler('src/app/(dashboard)/agents/legado/page.tsx')).toContain("key={accountId ?? 'sem-conta'}")
  })
})

describe('apagar a chave — o aviso conta os Playgrounds desligados (Codex, #295)', () => {
  const painel = ler('src/components/settings/integracoes-panel.tsx')
  it('o assistente desligado entra', () => {
    expect(painel).toContain("!u.indisponivel || u.indisponivel === 'conversa_desligada'")
  })
  it('todo agente do provedor entra, ligado ou não', () => {
    expect(painel).toContain("...cartao.agentesDeIa.map((a) => t('agenteDeIaNaConfirmacao'")
    expect(painel).not.toContain('agentesDeIa.filter((a) => a.ativo)')
  })
})
