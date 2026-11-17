import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { checkWebhookUrl } from './endpoints'
import { conferirUrlDoEndereco, type MotivoDaUrlRecusada } from './url-do-endereco'

// NOSSO (porte do #681): os casos nossos da régua da URL moram aqui, e não no
// `endpoints.test.ts` do original — dentro do teste dele virariam conflito
// add/add no próximo merge (`docs/MERGE-UPSTREAM.md`, §3.4).

describe('conferirUrlDoEndereco — o código que a rota de sessão devolve', () => {
  it('https sem credencial passa, normalizada como na v1', () => {
    expect(conferirUrlDoEndereco('  https://exemplo.invalid/aviso  ')).toEqual({
      ok: true,
      url: 'https://exemplo.invalid/aviso',
    })
  })

  it('URL que não é https (ou nem é URL) é `url_invalida`', () => {
    for (const ruim of ['http://exemplo.invalid/aviso', 'não é url', 123, null, undefined]) {
      expect(conferirUrlDoEndereco(ruim)).toEqual({ ok: false, motivo: 'url_invalida' })
    }
  })

  it('https com usuário, senha ou os dois é `url_com_credencial` — `user:` com senha vazia também', () => {
    for (const comCredencial of [
      'https://usuario:senha@exemplo.invalid/aviso',
      'https://usuario@exemplo.invalid/aviso',
      'https://usuario:@exemplo.invalid/aviso',
      'https://:senha@exemplo.invalid/aviso',
    ]) {
      expect(conferirUrlDoEndereco(comCredencial)).toEqual({
        ok: false,
        motivo: 'url_com_credencial',
      })
    }
  })

  it('a ordem é a do original: `http://` com credencial cai no "precisa ser https"', () => {
    const url = 'http://usuario:senha@exemplo.invalid/aviso'
    expect(conferirUrlDoEndereco(url)).toEqual({ ok: false, motivo: 'url_invalida' })
    expect(checkWebhookUrl(url)).toEqual({
      ok: false,
      message: "'url' must be a valid https:// URL",
    })
  })

  it('o `@` sem usuário some na normalização; `@` e `user=` fora do host não são credencial', () => {
    expect(conferirUrlDoEndereco('https://@exemplo.invalid/aviso')).toEqual({
      ok: true,
      url: 'https://exemplo.invalid/aviso',
    })
    expect(conferirUrlDoEndereco('https://exemplo.invalid/a@b?user=x&pass=y').ok).toBe(true)
  })

  it('⚠️ é o próprio Node que recusa a URL com credencial: toda entrega falharia', () => {
    // A razão de recusar no CADASTRO, e não deixar a entrega descobrir: a falha
    // se repetiria a cada aviso até desligar o endpoint.
    expect(
      () => new Request('https://usuario:senha@exemplo.invalid/aviso', { method: 'POST' })
    ).toThrow(/credentials/)
  })
})

describe('cada código tem ramo na tela e frase nos dois dicionários', () => {
  // Sem o ramo, a tela cai em "Não foi possível criar" sem nada acusar: o
  // portão de i18n só confere que a chave existe.
  const motivos = new Set<MotivoDaUrlRecusada>()
  for (const entrada of [123, 'https://usuario:senha@exemplo.invalid/aviso']) {
    const r = conferirUrlDoEndereco(entrada)
    if (!r.ok) motivos.add(r.motivo)
  }
  const chaveDoMotivo = (m: string) => m.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase())

  const RAIZ = process.cwd()
  const tela = readFileSync(join(RAIZ, 'src/components/settings/webhooks-panel.tsx'), 'utf8')
  const dicionarios = ['en', 'pt-BR'].map((d) => ({
    d,
    webhooks: JSON.parse(readFileSync(join(RAIZ, 'messages', `${d}.json`), 'utf8')).Settings
      .webhooks as Record<string, unknown>,
  }))

  it('os dois códigos existem', () => {
    expect([...motivos].sort()).toEqual(['url_com_credencial', 'url_invalida'])
  })

  for (const motivo of ['url_invalida', 'url_com_credencial'] as const) {
    it(`${motivo} → t("${chaveDoMotivo(motivo)}")`, () => {
      const chave = chaveDoMotivo(motivo)
      expect(tela).toContain(`corpo.error === "${motivo}"`)
      expect(tela).toContain(`t("${chave}")`)
      for (const { d, webhooks } of dicionarios) {
        expect(typeof webhooks[chave], `${d}.json: Settings.webhooks.${chave}`).toBe('string')
        expect((webhooks[chave] as string).length, `${d}.json vazio`).toBeGreaterThan(0)
      }
    })
  }
})
