import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import { ErroDeUpload, mensagemDoUpload } from './erro-de-upload'

const RAIZ = join(__dirname, '..', '..', '..')
const dicionario = (arq: string) =>
  JSON.parse(readFileSync(join(RAIZ, 'messages', arq), 'utf8')) as Record<string, unknown>

describe('mensagemDoUpload', () => {
  const t = createTranslator({ locale: 'pt-BR', messages: dicionario('pt-BR.json'), namespace: 'Upload' })
  const tr = (c: string) => t(c as Parameters<typeof t>[0])

  it('traduz as duas falhas de antes do upload', () => {
    expect(mensagemDoUpload(new ErroDeUpload('semSessao', 'Not signed in.'), tr, 'x')).toBe(
      'Sua sessão expirou. Entre de novo para enviar o arquivo.',
    )
    expect(mensagemDoUpload(new ErroDeUpload('semConta', 'Could not resolve your account.'), tr, 'x')).toBe(
      'Não foi possível identificar a sua conta.',
    )
  })

  it('o resto passa como estava: a mensagem do erro, senão o texto de queda', () => {
    expect(mensagemDoUpload(new Error('The object exceeded the maximum allowed size'), tr, 'x')).toBe(
      'The object exceeded the maximum allowed size',
    )
    expect(mensagemDoUpload('boom', tr, 'Falha no envio')).toBe('Falha no envio')
  })

  it('as duas chaves existem nos dois dicionários', () => {
    for (const arq of ['en.json', 'pt-BR.json']) {
      const upload = (dicionario(arq) as { Upload?: Record<string, string> }).Upload
      expect(upload?.semSessao, arq).toBeTruthy()
      expect(upload?.semConta, arq).toBeTruthy()
    }
  })

  it('`uploadAccountMedia` lança as duas como `ErroDeUpload`, nunca `Error` cru', () => {
    const fonte = readFileSync(join(__dirname, 'upload-media.ts'), 'utf8')
    expect(fonte).toContain('new ErroDeUpload("semSessao"')
    expect(fonte).toContain('new ErroDeUpload("semConta"')
    expect(fonte).not.toContain('new Error("Not signed in.")')
    expect(fonte).not.toContain('new Error("Could not resolve your account.")')
  })
})
