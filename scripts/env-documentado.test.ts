// ============================================================
// Toda variável de ambiente que o app LÊ está escrita no
// `.env.local.example`?
//
// Existe porque três não estavam, e o modo de falha é o pior possível
// para quem instala o sistema pela primeira vez: `EVOLUTION_BASE_URL`,
// `EVOLUTION_GLOBAL_API_KEY` e `EVOLUTION_WEBHOOK_SECRET` são lidas pelo
// transporte que a produção realmente usa, e o arquivo que deveria
// ensinar a preenchê-las não as mencionava. Quem copiasse o exemplo e
// preenchesse TUDO ainda terminava com o WhatsApp sem conectar, sem uma
// linha dizendo o que faltava.
//
// É a mesma ideia do `i18n-chaves-usadas.mjs`: o portão existe porque a
// lembrança não bastou. Variável nova sem documentação reprova aqui, no
// mesmo `verificar` que roda lint e typecheck.
//
// ⚠️ Só varre `src/`. O `mcp-server/` é subprojeto com `package.json`,
// `.env.example` e doc próprios (`docs/mcp.md`), e as variáveis dele
// (`WACRM_*`) não pertencem a este arquivo.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = process.cwd()
const FONTE = join(RAIZ, 'src')
const EXEMPLO = join(RAIZ, '.env.local.example')

/**
 * Lidas pelo build ou pelo runtime do Next, nunca definidas pelo
 * operador — documentá-las só encheria o arquivo de ruído.
 */
const DO_FRAMEWORK = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL_URL'])

function arquivosDeCodigo(dir: string, saida: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) {
      arquivosDeCodigo(caminho, saida)
    } else if (/\.(ts|tsx|mts|cts)$/.test(nome)) {
      saida.push(caminho)
    }
  }
  return saida
}

function lidasPeloCodigo(): Map<string, string[]> {
  const achadas = new Map<string, string[]>()
  for (const arquivo of arquivosDeCodigo(FONTE)) {
    const texto = readFileSync(arquivo, 'utf8')
    for (const m of texto.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      const nome = m[1]
      if (DO_FRAMEWORK.has(nome)) continue
      const onde = achadas.get(nome) ?? []
      onde.push(arquivo.slice(RAIZ.length + 1))
      achadas.set(nome, onde)
    }
  }
  return achadas
}

/** Nomes escritos como `NOME=` no exemplo, comentados ou não. */
function documentadas(): Set<string> {
  const texto = readFileSync(EXEMPLO, 'utf8')
  return new Set(
    [...texto.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  )
}

describe('.env.local.example', () => {
  it('documenta toda variável que src/ lê', () => {
    const usadas = lidasPeloCodigo()
    const escritas = documentadas()

    const faltando = [...usadas.keys()]
      .filter((nome) => !escritas.has(nome))
      .sort()
      .map((nome) => `${nome} (lida em ${usadas.get(nome)!.join(', ')})`)

    expect(
      faltando,
      'Estas variáveis são lidas pelo código e não aparecem no .env.local.example. ' +
        'Acrescente cada uma com o que é, onde obter e o que quebra sem ela — ' +
        'quem instala o sistema só tem esse arquivo para saber o que preencher.',
    ).toEqual([])
  })

  it('varre uma quantidade plausível de arquivos', () => {
    // Cobertura, não só ausência de falta: se a varredura parar de achar
    // arquivo (mudança de extensão, pasta movida), o teste acima passaria
    // vazio e o portão viraria decoração.
    expect(arquivosDeCodigo(FONTE).length).toBeGreaterThan(300)
    expect(lidasPeloCodigo().size).toBeGreaterThan(10)
  })
})
