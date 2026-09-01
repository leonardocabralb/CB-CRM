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
  // qualquer leitura de `.message` de um erro sob src/app/api/ai reprova aqui.
  //
  // ⚠️ O padrão é a LEITURA (`err.message`, `error.message`, `e.message`),
  // não a forma `error: err.message`: a primeira versão só casava a forma
  // literal e deixava passar `const message = err instanceof AiError ?
  // err.message : …` interpolado num `warning` (knowledge, [id], reindex) e
  // o template `Embeddings key: ${err.message}` do config — quatro caminhos
  // por onde uma chave de embeddings revogada ecoava até a tela (achado do
  // Codex no PR #93). Linhas de `console.*` ficam de fora: log de servidor
  // não vai para o cliente.
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
            .replace(/^.*\bconsole\.\w+\(.*$/gm, '')
          if (/\b(?:err|error|e)\.message\b/.test(fonte)) {
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
