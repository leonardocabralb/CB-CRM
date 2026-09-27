import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { tiposDeEventoParaATela } from '@/lib/ia-agentes/agenda'
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
 *    campos: [{ id, nome, vigiado, tipo, opcoes }], membros: [{ userId, nome }],
 *    automacoes: [{ id, nome, foraDaD5 }] }`.
 * `resultado` ganho/perdido e `vigiado` (campo de data de um lembrete ligado)
 * não podem ser liberados. `foraDaD5` é o código do passo que tira da D5
 * (`send_to_number`, `send_webhook`, `status_de_resultado`,
 * `etapa_de_resultado`, `run_flow`, `campo_vigiado`, e — só na automação que
 * a IA executa — `aguardar`), nulo = pode: na automação e nas que ela
 * aciona por `run_automation`. Etapa e etiqueta não têm `foraDaD5`: as
 * automações que a entrada na etapa ou a etiqueta disparam não são
 * conferidas (a D5 vale só para o que o agente faz, 27/09/2026). `tipo` é o
 * `field_type` (`email` no campo que
 * espelha o e-mail) e `opcoes`, as do `select`. A régua do Asaas não aparece
 * (só roda pela varredura). Leitura que falha = 500, nunca um catálogo pela
 * metade.
 *
 * F5: `calendly: 'conectado' | 'desconectado' | 'falhou'` e
 * `tiposDeEvento: [{ uri, nome, duracao }] | null` — os tipos de evento
 * ATIVOS do Calendly conectado, para o "Marcar reunião"; `null` quando não
 * está conectado ou a leitura falhou (o `calendly` diz qual). A leitura do
 * Calendly nunca derruba o catálogo: ela falha para `'falhou'` — e tem PRAZO
 * total de 8 s (`PRAZO_DOS_TIPOS_NA_TELA_MS`): o Calendly lento vira
 * `'falhou'` sem segurar o resto da tela.
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
      const db = supabaseAdmin()
      const [catalogo, calendly] = await Promise.all([
        lerCatalogoDeFerramentas(db, ctx.accountId),
        tiposDeEventoParaATela(db, ctx.accountId),
      ])
      return NextResponse.json({ ...catalogo, ...calendly })
    } catch (err) {
      console.error('[cb/ia/agentes/ferramentas] leitura falhou:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
