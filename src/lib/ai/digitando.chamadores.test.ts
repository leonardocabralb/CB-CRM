import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// "Digitando…" (#527, Fase 9 do plano do merge do upstream): quem passa o
// `wamid` da mensagem RECEBIDA. Só o webhook da Meta — a Evolution não tem o
// recurso, e o id dela nem existe do lado da Meta. Sem a linha no webhook, o
// indicador nunca sai, sem erro nenhum (`mostrarDigitando` pula sem id).
// ============================================================

const SRC = path.join(__dirname, '../..')
const semComentarios = (f: string) =>
  f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('quem passa o wamid ao "digitando…"', () => {
  it('o webhook da Meta passa `inboundMessageId: message.id` à resposta automática', () => {
    const rota = semComentarios(fs.readFileSync(path.join(SRC, 'app/api/whatsapp/webhook/route.ts'), 'utf8'))
    expect(rota).toMatch(/dispatchInboundToAiReply\(\{[^}]*inboundMessageId: message\.id,[^}]*\}\)/)
  })

  it('a resposta automática chama `mostrarDigitando` com o id recebido', () => {
    const auto = semComentarios(fs.readFileSync(path.join(SRC, 'lib/ai/auto-reply.ts'), 'utf8'))
    expect(auto).toMatch(/mostrarDigitando\(db, \{[^}]*inboundMessageId: args\.inboundMessageId,[^}]*\}\)/)
  })
})
