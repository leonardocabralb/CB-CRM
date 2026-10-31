import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import type { AiProvider } from '@/lib/ai/types'
import { modelosDaConta, type ModelosDoProvedor } from '@/lib/ai/modelos-da-chave'
import { PROVEDORES } from '@/lib/ia-chaves/repo'
import { leitoresDaConta, type LeitoresDaConta } from '@/lib/integracoes/montar'
import { ORDEM_DA_LEITURA, ORDEM_DA_TRANSCRICAO } from '@/lib/transcricao/leitores'

/**
 * GET /api/cb/ia/modelos[?atualizar=1]  (admin)
 *
 * Os modelos de TEXTO que a chave da conta oferece em cada provedor — o que
 * o seletor de modelo do agente e do Radar mostra (25/10/2026). Por
 * provedor: `{ ok: true, modelos: [{ id, nome }] }`, ou o motivo
 * (`sem_chave`, ou `falhou` com o CÓDIGO). Os três em paralelo; um que falha
 * não derruba os outros.
 *
 * E `leitores`: quem lê áudio, imagem e PDF NESTA conta (a régua de
 * `escolherLeitor`, sobre as MESMAS leituras de chave) — o quadro "quem lê a
 * mídia" da Configuração do agente. `null` = a leitura de alguma chave
 * falhou (não se sabe; a tela não afirma).
 *
 * Cache de 10 min por conta, provedor e chave (`modelos-da-chave.ts`);
 * `?atualizar=1` lê de novo. ⚠️ NENHUMA chave sai daqui, nem mascarada, e a
 * falha volta como código, nunca a mensagem do provedor (a OpenAI ecoa a
 * chave nela).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    // Listar modelos não gera nada pago: o balde comum das ações de admin.
    const limite = checkRateLimit(`cb:ia-modelos:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const atualizar = new URL(request.url).searchParams.get('atualizar') === '1'
    const lidos = await Promise.all(PROVEDORES.map((p) => modelosDaConta(ctx.accountId, p, { atualizar })))

    const provedores = Object.fromEntries(PROVEDORES.map((p, i) => [p, lidos[i].modelos])) as Record<
      AiProvider,
      ModelosDoProvedor
    >
    const serve = Object.fromEntries(PROVEDORES.map((p, i) => [p, lidos[i].leAMidia === true])) as Record<
      AiProvider,
      boolean
    >
    const leitores: LeitoresDaConta | null = lidos.some((l) => l.leAMidia === null)
      ? null
      : leitoresDaConta(serve, ORDEM_DA_LEITURA, ORDEM_DA_TRANSCRICAO)

    return NextResponse.json({ provedores, leitores })
  } catch (err) {
    return toErrorResponse(err)
  }
}
