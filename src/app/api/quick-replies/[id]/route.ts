import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { ehUuid } from '@/lib/tasks/validar'
import {
  resolveQuickReplyPatch,
  type StoredQuickReply,
} from '@/lib/quick-replies/patch'

// Update / delete a single quick reply. Quick replies are account-
// shared, so every mutation is scoped by `account_id` (the service-role
// client bypasses the agent-gated RLS, so both the role check and the
// account scope are enforced here).
//
// Porte do upstream #673: a linha que não existe (ou é de outra conta) é
// 404, nunca `{ ok: true }`. ⚠️ NOSSO: a leitura que falha é 500 — erro de
// banco não é "não encontrado" —, e o UPDATE também confere as linhas
// (`.select('id')`): apagada entre a leitura e a escrita, ela é 404, e não o
// "salvo" de uma escrita que não aconteceu. Com o cliente de serviço não há
// RLS no caminho, então zero linhas aqui só pode ser a linha que sumiu.

function naoEncontrada() {
  return NextResponse.json({ error: 'Quick reply not found' }, { status: 404 })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  // Id que não é UUID não existe — e não chega ao banco, onde o 22P02 viraria
  // um 500 que parece falha nossa.
  if (!ehUuid(id)) return naoEncontrada()

  // A linha gravada decide o tipo: a mudança é conferida MESCLADA a ela
  // (`resolveQuickReplyPatch`), e não só pelo corpo do pedido.
  const { data: stored, error: loadError } = await supabaseAdmin()
    .from('quick_replies')
    .select('kind, content_text, interactive_payload')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
  if (!stored) return naoEncontrada()

  const patch = resolveQuickReplyPatch(body, stored as StoredQuickReply)
  if (!patch.ok) return NextResponse.json({ error: patch.error }, { status: 400 })

  if (Object.keys(patch.update).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const { data: atualizadas, error } = await supabaseAdmin()
    .from('quick_replies')
    .update(patch.update)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!atualizadas || atualizadas.length === 0) return naoEncontrada()
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  if (!ehUuid(id)) return naoEncontrada()

  const { data: apagadas, error } = await supabaseAdmin()
    .from('quick_replies')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!apagadas || apagadas.length === 0) return naoEncontrada()
  return NextResponse.json({ ok: true })
}
