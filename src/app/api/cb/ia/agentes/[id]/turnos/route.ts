import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { nomeDoContato } from '@/lib/contacts/identidade'
import { lerRetrato } from '@/lib/ia-agentes/acesso'
import { obterAgente } from '@/lib/ia-agentes/repo'
import { respostaDoErro } from '@/lib/ia-agentes/resposta'

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Quantos turnos a sub-aba mostra. */
const TURNOS_NA_TELA = 50

interface LinhaDoTurno {
  id: string
  status: string
  created_at: string
  terminado_em: string | null
  erro: string | null
  conversation_id: string
  contexto: unknown
}

/**
 * GET /api/cb/ia/agentes/[id]/turnos  (admin, D14)
 *
 * Os 50 últimos turnos do agente, mais novos primeiro: `{ turnos: [{ id,
 * status, criadoEm, terminadoEm, erro, conversationId, contato, contexto }] }`.
 * `contexto` é o RETRATO do que o modelo viu (F3, 1052): `{ blocos: [{ bloco,
 * texto }], documentos: [ids] }`; nulo nos turnos anteriores à F3 e nos que
 * não chegaram a montar o pedido.
 * `cb_ia_turnos` é fechada ao navegador — daí a rota, com o cliente de
 * serviço e a conta conferida (o agente e cada consulta).
 */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const naoEncontrado = () =>
      NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    if (!UUID.test(id)) return naoEncontrado()
    if (!(await obterAgente(ctx.accountId, id))) return naoEncontrado()

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('cb_ia_turnos')
      .select('id, status, created_at, terminado_em, erro, conversation_id, contexto')
      .eq('account_id', ctx.accountId)
      .eq('ia_agente_id', id)
      .order('created_at', { ascending: false })
      .limit(TURNOS_NA_TELA)
    if (error) {
      console.error('[cb/ia/agentes/turnos] leitura falhou:', error.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    const turnos = (data ?? []) as LinhaDoTurno[]

    // O contato de cada conversa. Falhar aqui não derruba a lista: a tela
    // mostra o turno sem o nome.
    const contatoDa = new Map<string, string>()
    const conversas = [...new Set(turnos.map((t) => t.conversation_id))]
    if (conversas.length > 0) {
      const { data: linhas, error: erroDosContatos } = await db
        .from('conversations')
        .select('id, contact:contacts(name, phone, wa_username, instagram_username)')
        .eq('account_id', ctx.accountId)
        .in('id', conversas)
      if (erroDosContatos) console.error('[cb/ia/agentes/turnos] contatos:', erroDosContatos.message)
      for (const l of (linhas ?? []) as { id: string; contact: Parameters<typeof nomeDoContato>[0] }[]) {
        const nome = nomeDoContato(l.contact, '')
        if (nome) contatoDa.set(l.id, nome)
      }
    }

    return NextResponse.json({
      turnos: turnos.map((t) => ({
        id: t.id,
        status: t.status,
        criadoEm: t.created_at,
        terminadoEm: t.terminado_em,
        erro: t.erro,
        conversationId: t.conversation_id,
        contato: contatoDa.get(t.conversation_id) ?? null,
        contexto: lerRetrato(t.contexto),
      })),
    })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
