import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// ============================================================
// Pino da Fase 11.3: NENHUM ramo Evolution recebe alvo que não seja telefone.
//
// O BSUID (a identidade de quem a Meta manda só com nome de usuário) só vale
// na API oficial. Pela Evolution, `toEvolutionNumber` tiraria as letras e a
// mensagem sairia para o número formado pelos dígitos dele — um desconhecido.
// Três travas, e este arquivo cobra as duas estruturais (a terceira,
// `toEvolutionNumber` lançando com BSUID, é testada no transporte):
//
//   1. `resolveContactSendTarget` (do original, que IGNORA o transporte) só é
//      chamado por `alvo-de-envio.ts`, que o embrulha com a régua do canal.
//      Remetente novo que o chamasse direto mandaria o BSUID à Evolution.
//   2. Todo envio pelo transporte (`.sendText(`/`.sendMedia(`) fora da pasta
//      do transporte mora num arquivo que decide o alvo por
//      `alvoDeEnvio`/`alvoDoRobo`, e manda EXATAMENTE esse alvo.
//
// DEFAULT-DENY: remetente novo reprova até entrar na lista, por decisão
// visível no diff.
// ============================================================

const SRC = path.join(__dirname, '..', '..')

function* fontes(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* fontes(p)
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p
  }
}

const semComentarios = (texto: string) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/')

/** Os remetentes pela Evolution, e o nome do alvo que cada um manda. */
const REMETENTES: Record<string, 'alvo' | 'destinatario'> = {
  'lib/whatsapp/send-message.ts': 'destinatario',
  'lib/flows/meta-send.ts': 'alvo',
  'lib/automations/meta-send.ts': 'alvo',
}

describe('alvo de envio — nenhum ramo Evolution recebe BSUID (Fase 11.3)', () => {
  it('só `alvo-de-envio.ts` chama `resolveContactSendTarget` (o original ignora o transporte)', () => {
    const chamam: string[] = []
    for (const arquivo of fontes(SRC)) {
      const texto = semComentarios(fs.readFileSync(arquivo, 'utf8'))
      if (/\bresolveContactSendTarget\s*\(/.test(texto) && !/export function resolveContactSendTarget/.test(texto)) {
        chamam.push(rel(arquivo))
      }
    }
    expect(chamam).toEqual(['lib/whatsapp/alvo-de-envio.ts'])
  })

  it('todo envio pelo transporte fora da pasta dele está na lista, e a lista é exata', () => {
    const achados = new Set<string>()
    for (const arquivo of fontes(SRC)) {
      const r = rel(arquivo)
      if (r.startsWith('lib/whatsapp/transport/')) continue
      const texto = semComentarios(fs.readFileSync(arquivo, 'utf8'))
      if (/\.send(Text|Media)\(\{/.test(texto)) achados.add(r)
    }
    expect([...achados].sort()).toEqual(Object.keys(REMETENTES).sort())
  })

  for (const [arquivo, nomeDoAlvo] of Object.entries(REMETENTES)) {
    it(`${arquivo}: decide o alvo pelo canal e manda EXATAMENTE ele`, () => {
      const texto = semComentarios(fs.readFileSync(path.join(SRC, arquivo), 'utf8'))
      expect(texto).toMatch(/\balvo(DeEnvio|DoRobo)\(contact, channel\)/)
      const chamadas = [...texto.matchAll(/\.send(Text|Media)\(\{([\s\S]*?)\}\)/g)]
      expect(chamadas.length).toBeGreaterThan(0)
      for (const c of chamadas) {
        expect(c[2]).toMatch(new RegExp(`\\bto: ${nomeDoAlvo}\\b`))
      }
    })
  }

  it('send-message.ts: o destinatário é o JID do grupo ou o alvo decidido — nada mais', () => {
    const texto = semComentarios(
      fs.readFileSync(path.join(SRC, 'lib/whatsapp/send-message.ts'), 'utf8'),
    )
    const atribuicoes = [...texto.matchAll(/\bdestinatario = ([^;]+);/g)].map((m) => m[1].trim())
    expect(atribuicoes.sort()).toEqual(['alvo.alvo', 'grupo!.jid'])
  })
})
