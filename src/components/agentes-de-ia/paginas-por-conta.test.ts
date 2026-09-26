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

describe('Codex, #309 — o recorte da conta ativa e as leituras que envelhecem', () => {
  it('"Onde atua" lê só os funis da conta ATIVA (a RLS devolve os de toda conta de que a pessoa é membro)', () => {
    const fonte = ler('src/components/agentes-de-ia/onde-atua.tsx')
    expect(fonte).toContain(".eq('account_id', accountId)")
    expect(fonte).toContain(".in(\n                'pipeline_id',")
  })
  it('a faixa de IA pergunta de novo quando uma tela move o card (o aviso das execuções)', () => {
    expect(ler('src/components/inbox/ai-thread-banner.tsx')).toContain('window.addEventListener(EVENTO_EXECUCOES, aoMudar)')
  })
  it('o nome do agente na bolha vence (renomear com a página aberta)', () => {
    expect(ler('src/components/agentes-de-ia/nomes-dos-agentes.ts')).toContain('Date.now() - buscadoEm > VALIDADE_MS')
  })
})

describe('F3 — os catálogos da conta ativa e a prova de que sumiu (Codex, #312)', () => {
  it('"Acesso" lê só os campos da conta ATIVA e só descarta com a lista COMPLETA', () => {
    const fonte = ler('src/components/agentes-de-ia/acesso-do-agente.tsx')
    expect(fonte).toContain(".eq('account_id', accountId)")
    expect(fonte).toContain("carga.fase === 'pronto' && carga.completo ? new Set(")
  })
  it('"Base" só descarta documento ausente com a lista COMPLETA', () => {
    expect(ler('src/components/agentes-de-ia/base-do-agente.tsx')).toContain(
      'const documentoIds = completa ? marcados.filter((id) => existentes.has(id)) : marcados;',
    )
  })
})
