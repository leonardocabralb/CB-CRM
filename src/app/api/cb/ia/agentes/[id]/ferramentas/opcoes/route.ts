import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { lerCatalogoDeFerramentas } from '@/lib/ia-agentes/ferramentas'
import { obterAgente } from '@/lib/ia-agentes/repo'
import { respostaDoErro } from '@/lib/ia-agentes/resposta'

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/cb/ia/agentes/[id]/ferramentas/opcoes  (admin, D14)
 *
 * O que a conta tem para as FERRAMENTAS do agente (F4, D28), com o que o
 * SERVIDOR decide — a tela só mostra:
 * `{ etapas: [{ id, nome, funil, resultado }], etiquetas: [{ id, nome }],
 *    campos: [{ id, nome, vigiado }], membros: [{ userId, nome }],
 *    automacoes: [{ id, nome, foraDaD5 }] }`.
 * `resultado` ganho/perdido e `vigiado` (campo de data de um lembrete ligado)
 * não podem ser liberados; `foraDaD5` é o código do passo que tira a
 * automação da D5 (`send_to_number`, `send_webhook`, `status_de_resultado`,
 * `etapa_de_resultado`, `run_flow`, `campo_vigiado`), nulo = pode. A régua do
 * Asaas não aparece (só roda pela varredura). Leitura que falha = 500, nunca
 * um catálogo pela metade.
 */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const naoEncontrado = () =>
      NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    if (!UUID.test(id)) return naoEncontrado()
    const agente = await obterAgente(ctx.accountId, id)
    if (!agente || agente.arquivadoEm) return naoEncontrado()

    try {
      return NextResponse.json(await lerCatalogoDeFerramentas(supabaseAdmin(), ctx.accountId))
    } catch (err) {
      console.error('[cb/ia/agentes/ferramentas] leitura falhou:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
