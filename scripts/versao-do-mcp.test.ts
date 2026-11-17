// ============================================================
// A versão que o servidor MCP anuncia é a do pacote?
//
// `mcp-server/src/index.ts` crava a versão numa constante ("kept in sync
// manually"), e o `McpServer` a anuncia ao cliente (Claude, Cursor) no
// aperto de mão. Ela desencontrou: o `package.json` foi a 0.1.1 e o
// `index.ts` ficou na 0.1.0 até o porte do #681 do original (17/11/2026).
// O typecheck e o lint da raiz leem `mcp-server/src`, mas nada no CI testa o
// servidor nem compara versões (é subprojeto, com `package.json` próprio): sem
// este pino, o desencontro só aparece para quem integra.
//
// O par cobrado: o `index.ts`, o `package.json`, o `package-lock.json` (as
// duas marcas da raiz) e o `server.json` (o manifesto do registro MCP, com a
// versão do servidor e a do pacote).
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MCP = join(process.cwd(), 'mcp-server')
const ler = (arquivo: string) => readFileSync(join(MCP, arquivo), 'utf8')

describe('versão do servidor MCP', () => {
  it('a constante do `index.ts` = `package.json` = lockfile = `server.json`', () => {
    const doPacote = JSON.parse(ler('package.json')).version as string
    expect(doPacote).toMatch(/^\d+\.\d+\.\d+$/)

    const constante = ler('src/index.ts').match(
      /^const VERSION = '([^']+)';$/m
    )
    expect(constante, 'não achei `const VERSION = \'…\';` no index.ts').not.toBeNull()

    const lock = JSON.parse(ler('package-lock.json'))
    const servidor = JSON.parse(ler('server.json'))

    expect({
      'src/index.ts': constante![1],
      'package-lock.json': lock.version,
      'package-lock.json (packages[""])': lock.packages[''].version,
      'server.json': servidor.version,
      'server.json (packages)': (servidor.packages as { version: string }[]).map(
        (p) => p.version
      ),
    }).toEqual({
      'src/index.ts': doPacote,
      'package-lock.json': doPacote,
      'package-lock.json (packages[""])': doPacote,
      'server.json': doPacote,
      'server.json (packages)': (servidor.packages as unknown[]).map(() => doPacote),
    })
  })
})
