import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AiError, mensagemSeguraDeAiError } from './types'

describe('mensagemSeguraDeAiError (#30)', () => {
  it('invalid_key NUNCA ecoa a mensagem do provedor — ela embute a chave', () => {
    // A forma real da OpenAI: "Incorrect API key provided: sk-proj-…abcd".
    // E a chave pode ser a GUARDADA (salvar só o modelo revalida com
    // decrypt(existing)), que quem está salvando nem digitou.
    const err = new AiError('Incorrect API key provided: sk-proj-XYZabcd', {
      code: 'invalid_key',
      status: 401,
    })
    const segura = mensagemSeguraDeAiError(err)
    expect(segura).not.toContain('sk-proj')
    expect(segura).toBe('o provedor recusou a chave')
  })

  it('os demais códigos preservam a mensagem — é ela que diz "modelo não encontrado"', () => {
    const err = new AiError('The model `gpt-x` does not exist', {
      code: 'model_not_found',
      status: 404,
    })
    expect(mensagemSeguraDeAiError(err)).toBe('The model `gpt-x` does not exist')
  })
})

describe('nenhuma rota de AI devolve err.message cru (#30, pino estrutural)', () => {
  // O eco foi tirado de /api/ai/test no PR #74 e a revisão achou as TRÊS
  // cópias restantes (config, draft, playground). Este pino impede a quarta:
  // qualquer `error: err.message` novo sob src/app/api/ai reprova aqui.
  it('só test/route.ts contém o padrão, e lá atrás da guarda de chave', () => {
    const raiz = path.resolve(__dirname, '..', '..', 'app', 'api', 'ai')
    const comPadrao: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.ts$/.test(e.name) && !/\.test\./.test(e.name)) {
          const fonte = fs
            .readFileSync(p, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '')
          if (/error:\s*err\.message/.test(fonte)) {
            comPadrao.push(path.relative(raiz, p).split(path.sep).join('/'))
          }
        }
      }
    }
    walk(raiz)
    // test/route.ts é a exceção DELIBERADA: lá o `err.message` só sai
    // quando `ehChave` é falso (em chave inválida devolve só o código,
    // sem mensagem nenhuma) — conferido na revisão. Rota nova com o
    // padrão: use `mensagemSeguraDeAiError` (lib/ai/types.ts).
    expect(comPadrao.sort()).toEqual(['test/route.ts'])
  })
})
