import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// "Digitando…" (#527, Fase 9 do plano do merge do upstream): quem chega com o
// `wamid` da mensagem RECEBIDA até `mostrarDigitando`. Só mensagem que entrou
// pelo webhook da Meta tem `wamid.` — a Evolution não tem o recurso, e o id
// dela nem existe do lado da Meta. Sem a corrente inteira, o indicador nunca
// sai, sem erro nenhum (`mostrarDigitando` pula sem id).
//
// Desde a F2 dos agentes de IA (docs/PLANO-agentes-de-ia.md, 5.7) quem o
// chama é o TURNO (`ia-agentes/turno.ts`), depois da espera da rajada — a
// resposta automática antiga (`ai/auto-reply.ts`, que o chamava na
// ingestão) foi apagada (E2). A corrente agora tem três elos, e os três são
// cobrados aqui: o webhook passa o id da LINHA gravada, o turno relê o
// `message_id` dela, e o turno o entrega a `mostrarDigitando` com o canal da
// resposta.
// ============================================================

const SRC = path.join(__dirname, '../..')
const semComentarios = (f: string) =>
  f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('quem passa o wamid ao "digitando…"', () => {
  it('o webhook da Meta entrega ao agente o id da LINHA que guarda o wamid', () => {
    const rota = semComentarios(fs.readFileSync(path.join(SRC, 'app/api/whatsapp/webhook/route.ts'), 'utf8'))
    // A linha é gravada com `message_id: message.id` (o wamid)…
    expect(rota).toMatch(/message_id: message\.id,/)
    // …e é o id DELA que vai para a entrada do agente.
    expect(rota).toMatch(/aoChegarMensagemDoCliente\(\{[^}]*mensagemId: insertedRows\[0\]\.id,[^}]*\}\)/)
  })

  it('o turno relê o `message_id` da mensagem-gatilho e chama `mostrarDigitando` com ele', () => {
    const turno = semComentarios(fs.readFileSync(path.join(SRC, 'lib/ia-agentes/turno.ts'), 'utf8'))
    expect(turno).toMatch(/\.select\('id, message_id,[^']*'\)/)
    // ...e com o canal da ENTRADA (o mesmo `preferredChannelId` da resposta):
    // `channelId: null` cairia no canal da conversa e poderia marcar a
    // mensagem num número enquanto a resposta sai por outro (revisão da
    // Fase 9, medido por mutante).
    expect(turno).toMatch(
      /mostrarDigitando\(db, \{\s*accountId: turno\.account_id,\s*conversationId: turno\.conversation_id,\s*channelId: turno\.canal_id,\s*inboundMessageId: gatilho\.message_id,\s*\}\)/,
    )
    expect(turno).toMatch(/preferredChannelId: turno\.canal_id,/)
  })
})
