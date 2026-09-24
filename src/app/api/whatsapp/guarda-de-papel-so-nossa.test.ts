import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// As DUAS rotas de WhatsApp que só o nosso fork guarda por papel.
//
// No merge de 2026-08-26 as 5 rotas que nós e o original cobríamos ficaram
// com o `requireRole` dele (`guarda-de-papel.test.ts`), e estas duas
// seguiram com o nosso `barrarPorPapel`: o original NÃO tem guarda de papel
// nelas (só o 403 de "perfil sem conta"). Sem teste nenhum, um "fica o
// deles" num merge devolvia a um `viewer` — que existe para ser
// somente-leitura — o poder de reconfigurar a conexão com a Meta ou de
// editar e apagar modelo. Achado da auditoria do merge #259 (23/09/2026):
// as guardas sobreviveram àquele merge, mas nada as prendia.
//
// O teste lê o FONTE, e cobra a ORDEM: a guarda vem antes de ler o corpo e
// antes de qualquer chamada à Meta, porque o efeito colateral lá fora
// acontece antes de qualquer gravação — a RLS nunca entraria no caminho.
// ============================================================

const RAIZ = path.join(__dirname)

// O POST de `config/route.ts` saiu da lista na Fase 7 do plano do merge do
// upstream (24/09/2026): foi APOSENTADO (410), e o teste do fim do arquivo
// cobra que continue assim.
const ROTAS = [
  { arquivo: 'config/route.ts', handlers: ['DELETE'] },
  { arquivo: 'templates/[id]/route.ts', handlers: ['PATCH', 'DELETE'] },
] as const

/** O corpo do handler exportado, até o próximo `export` de nível de módulo. */
function corpoDoHandler(fonte: string, nome: string): string {
  const inicio = fonte.indexOf(`export async function ${nome}(`)
  expect(inicio, `${nome} não encontrado`).toBeGreaterThan(-1)
  const fim = fonte.indexOf('\nexport ', inicio + 1)
  return fonte.slice(inicio, fim === -1 ? undefined : fim)
}

/** Os nomes que a rota importa de quem fala com a Meta. */
function chamadasExternas(fonte: string): string[] {
  const nomes: string[] = []
  for (const m of fonte.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/lib\/whatsapp\/(meta-api|template-header-handle|waba-pairing)'/g)) {
    for (const n of m[1].split(',')) {
      const nome = n.replace(/\btype\b/, '').split(/\s+as\s+/).pop()!.trim()
      if (nome) nomes.push(nome)
    }
  }
  return nomes
}

describe.each(ROTAS)('$arquivo: a guarda de papel é NOSSA e vem primeiro', ({ arquivo, handlers }) => {
  const fonte = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8')
  const externas = chamadasExternas(fonte)

  it('importa o barrarPorPapel e fala com a Meta (o teste não passa por não achar nada)', () => {
    expect(fonte).toContain("import { barrarPorPapel } from '@/lib/auth/barrar-por-papel'")
    expect(externas.length).toBeGreaterThan(0)
  })

  it.each(handlers)('%s exige admin antes do corpo e antes da Meta', (handler) => {
    const corpo = corpoDoHandler(fonte, handler)
    const guarda = corpo.search(/barrarPorPapel\([^,]+, 'admin'\);\s*\n\s*if \(barrado\) return barrado;/)
    expect(guarda, `${handler} sem a guarda de admin`).toBeGreaterThan(-1)

    const leCorpo = corpo.indexOf('request.json()')
    if (leCorpo !== -1) expect(guarda).toBeLessThan(leCorpo)

    for (const nome of externas) {
      const chamada = corpo.search(new RegExp(`\\b${nome}\\(`))
      if (chamada !== -1) expect(guarda, `${nome} antes da guarda em ${handler}`).toBeLessThan(chamada)
    }

    // E antes de qualquer ESCRITA: o DELETE de `whatsapp/config` não fala com
    // a Meta nem lê corpo — o efeito dele é apagar a conexão e marcar o canal
    // padrão, e é isso que a guarda protege (revisão da correção do #259).
    const escritas = /\.(delete|update|insert|upsert)\(|\b(flagDefaultMetaChannelRemoved|syncDefaultMetaChannelFromConfig)\(/g
    for (const m of corpo.matchAll(escritas)) {
      expect(guarda, `escrita "${m[0]}" antes da guarda em ${handler}`).toBeLessThan(m.index!)
    }
  })
})

// ============================================================
// O POST de `whatsapp/config` está APOSENTADO (Fase 7 do plano do merge do
// upstream, 24/09/2026): respondia 500 a toda chamada desde 27/07 e, se
// consertado, gravaria a credencial da Meta por cima do espelho de uma conta
// Evolution sem criar conexão. Quem conecta número oficial é
// POST /api/cb/channels. Um merge que traga o POST do original de volta — cru,
// sem a nossa guarda de papel — reprova aqui.
// ============================================================

describe('config/route.ts: o POST legado está aposentado', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'config/route.ts'), 'utf8')
  const corpo = corpoDoHandler(fonte, 'POST')

  it('responde 410 e aponta para Conexões', () => {
    expect(corpo).toMatch(/status:\s*410/)
    expect(corpo).toContain('/api/cb/channels')
  })

  it('não lê corpo, não fala com a Meta e não grava nada', () => {
    expect(corpo).not.toContain('request.json()')
    for (const nome of chamadasExternas(fonte)) {
      expect(corpo, `${nome} no POST aposentado`).not.toMatch(new RegExp(`\\b${nome}\\(`))
    }
    expect(corpo).not.toMatch(/\.(delete|update|insert|upsert)\(/)
    expect(corpo).not.toMatch(/\bsupabase\b/)
  })
})
