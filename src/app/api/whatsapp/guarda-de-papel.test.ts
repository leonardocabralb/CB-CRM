import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// REGRESSÃO DO MERGE (upstream 2026-08-26) — a guarda de papel das rotas
// de WhatsApp.
//
// POR QUE ESTE ARQUIVO EXISTE
// Nós e o upstream corrigimos a MESMA falha de forma diferente: um convidado
// `viewer` — que existe justamente para ser somente-leitura — conseguia
// enviar mensagem para cliente, reagir, disparar campanha e mexer nos
// modelos. Eles reescreveram as rotas para `requireRole` (#448); nós tínhamos
// criado o `barrarPorPapel` (commit 75daeb9).
//
// No merge, as 5 rotas que ambos cobriam ficaram com a forma DELES, e as 2
// que só nós cobríamos seguiram com a nossa. Isso é exatamente o tipo de
// resolução que a próxima pessoa desfaz sem perceber — o código compila,
// os testes de envio passam, e a única diferença é que o `viewer` volta a
// mandar mensagem para o cliente.
//
// ⚠️ POR QUE A RLS NÃO BASTA, e por que o teste olha a ORDEM
// O efeito colateral que importa (a chamada à Meta ou à Evolution) acontece
// ANTES de qualquer gravação. Quando o banco recusa, a mensagem JÁ SAIU para
// o cliente — e mensagem de WhatsApp não se recolhe. Por isso cada caso aqui
// verifica duas coisas: que a rota recusou, e que recusou sem ter chamado
// nada externo.
//
// Este arquivo cobre as 4 rotas que não tinham teste NENHUM até aqui.
// (`send` já é coberta por route.test.ts, no mesmo diretório.)
// ============================================================

/** Erro que o `requireRole` real lança quando o papel não alcança o mínimo. */
class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

const requireRole = vi.fn()
const toErrorResponse = vi.fn<(erro: unknown) => unknown>(() => ({
  status: 403,
  body: { error: 'Forbidden' },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: (papel: string) => requireRole(papel),
  toErrorResponse: (erro: unknown) => toErrorResponse(erro),
  ForbiddenError,
  UnauthorizedError: class UnauthorizedError extends Error {},
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

// Tudo que fala com o mundo externo. Se qualquer um destes for chamado num
// teste de `viewer`, a guarda falhou — mesmo que a rota devolva 403 depois.
const sendTemplateMessage = vi.fn()
const sendReactionMessage = vi.fn()
const submitMessageTemplate = vi.fn()
const listMessageTemplates = vi.fn()

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: (a: unknown) => sendTemplateMessage(a),
  sendReactionMessage: (a: unknown) => sendReactionMessage(a),
  submitMessageTemplate: (a: unknown) => submitMessageTemplate(a),
  listMessageTemplates: (a: unknown) => listMessageTemplates(a),
  uploadResumableMedia: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))

// Limites de taxa não podem ser o motivo de um 403 — deixe sempre passar,
// senão um teste verde não prova nada sobre papel.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => ({ status: 429 }),
  RATE_LIMITS: { send: {}, react: {}, broadcast: {}, templates: {} },
}))

vi.mock('@/lib/cb-channels/resolve-meta', () => ({
  resolveMetaChannel: vi.fn(async () => ({
    channelId: 'canal-1',
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
    wabaId: 'waba-1',
  })),
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannel: vi.fn(),
  evolutionTransportFor: vi.fn(),
}))

// ⚠️ A rota templates/sync NÃO passa pelo meta-api mockado acima: ela chama
// `fetch(graph.facebook.com)` DIRETO. Com o mock de resolve-meta devolvendo
// um canal, o teste seguia até um fetch REAL — e passava só enquanto a
// internet respondia rápido. Medido em 2026-08-31: a rede da máquina caiu e
// o caso 'templates/sync' estourou os 5s de timeout, três vezes seguidas,
// sem nenhuma mudança no código. Teste de guarda não prova nada sobre a
// Meta; aqui fora não existe rede.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('sem rede no teste — fetch real bloqueado')
    }),
  )
})

function pedido(body: Record<string, unknown>) {
  return new Request('http://localhost/api/whatsapp/x', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllGlobals()
})

/**
 * As 4 rotas, com o papel que cada uma exige e um corpo mínimo.
 *
 * Os níveis não são decoração: `agent` é quem fala com cliente, `admin` é
 * quem mexe em configuração da conta. Trocar um pelo outro num merge é
 * silencioso — daí a asserção sobre o ARGUMENTO, não só sobre o 403.
 */
const ROTAS = [
  {
    nome: 'broadcast',
    modulo: () => import('./broadcast/route'),
    // 'agent' até a Fase 2 dos perfis (2026-08-30): disparo em massa virou
    // exclusivo do admin, por decisão do operador — um clique atinge
    // centenas de clientes. Se um merge do upstream devolver 'agent' à
    // rota, este teste acusa.
    papel: 'admin',
    corpo: {
      recipients: [{ phone: '+5511999998888', params: [] }],
      template_name: 'oi',
      template_language: 'pt_BR',
    },
  },
  {
    nome: 'react',
    modulo: () => import('./react/route'),
    papel: 'agent',
    corpo: { message_id: 'msg-1', emoji: '👍' },
  },
  {
    nome: 'templates/submit',
    modulo: () => import('./templates/submit/route'),
    papel: 'admin',
    corpo: {
      name: 'oi',
      category: 'UTILITY',
      language: 'pt_BR',
      body_text: 'olá',
    },
  },
  {
    nome: 'templates/sync',
    modulo: () => import('./templates/sync/route'),
    papel: 'admin',
    corpo: {},
  },
] as const

describe('rotas de WhatsApp — a guarda de papel sobreviveu ao merge', () => {
  it.each(ROTAS)('$nome exige o papel "$papel"', async (rota) => {
    requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })

    const { POST } = await rota.modulo()
    await POST(pedido({ ...rota.corpo })).catch(() => {
      // A rota pode falhar adiante por falta de outros mocks — irrelevante
      // aqui. O que este caso trava é COM QUE NÍVEL a guarda foi chamada.
    })

    expect(requireRole).toHaveBeenCalledWith(rota.papel)
  })

  it.each(ROTAS)(
    '$nome recusa um viewer SEM chamar a Meta',
    async (rota) => {
      requireRole.mockRejectedValue(new ForbiddenError())

      const { POST } = await rota.modulo()
      await POST(pedido({ ...rota.corpo })).catch(() => {})

      // A guarda é a primeira coisa da rota: nada externo pode ter corrido.
      // É esta asserção — e não o status — que prova que o cliente não
      // recebeu nada. A RLS chegaria tarde demais.
      expect(sendTemplateMessage).not.toHaveBeenCalled()
      expect(sendReactionMessage).not.toHaveBeenCalled()
      expect(submitMessageTemplate).not.toHaveBeenCalled()
      expect(listMessageTemplates).not.toHaveBeenCalled()
      // E o erro do papel foi traduzido em resposta, não vazou como 500.
      expect(toErrorResponse).toHaveBeenCalled()
    }
  )
})
