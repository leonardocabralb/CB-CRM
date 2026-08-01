import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { createClient } from '@/lib/supabase/server'
import { canWriteNotes } from '@/lib/auth/roles'
import { isAccountRole } from '@/lib/auth/roles'

/**
 * Criação de anotação interna (migration 918).
 *
 * ⚠️ POR QUE UMA ROTA, SE A ANTIGA `contact_notes` ERA INSERT DIRETO DO
 * NAVEGADOR. Três motivos, e o primeiro é impeditivo:
 *
 * 1. A menção precisa gravar em `notifications`, que NÃO tem policy de
 *    INSERT — a 027 diz por escrito que aquelas linhas nascem só do trigger
 *    SECURITY DEFINER. Menção vinda do cliente daria 42501. Nota e
 *    notificação têm de sair do mesmo lugar, e esse lugar é o servidor.
 * 2. `autor_nome` é carimbado no momento da escrita e não pode ser escolhido
 *    por quem chama — é isso que faz a autoria sobreviver à saída do membro.
 * 3. Os mencionados precisam ser validados contra a conta. Sem isso, um
 *    cliente malicioso poria qualquer uuid ali e notificaria estranhos.
 *
 * Por isso `cb_conversation_notes` não tem policy de INSERT e o papel
 * `authenticated` teve o INSERT revogado: não existe caminho de escrita fora
 * daqui. Apagar, sim, continua indo direto do navegador — lá a RLS decide
 * sozinha (autor ou admin) e não há o que validar no meio.
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role, full_name, email')
    .eq('user_id', user.id)
    .maybeSingle()

  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 },
    )
  }

  // Anotar é deliberadamente mais permissivo que enviar mensagem: `viewer`
  // pode. Ver `canWriteNotes`.
  const papel = profile?.account_role
  if (!isAccountRole(papel) || !canWriteNotes(papel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { conversation_id, texto } = (body ?? {}) as {
    conversation_id?: unknown
    texto?: unknown
  }

  if (typeof conversation_id !== 'string' || !conversation_id) {
    return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
  }
  if (typeof texto !== 'string' || !texto.trim()) {
    return NextResponse.json({ error: 'texto is required' }, { status: 400 })
  }

  // ⚠️ Lido com o cliente DO USUÁRIO, sob RLS: é o que garante que a conversa
  // é de uma conta que ele enxerga. O insert logo abaixo roda em service-role
  // e ignoraria RLS — sem esta leitura, um `conversation_id` de outra conta
  // passaria pela FK composta (que só confere conversa+conta batendo entre si)
  // e a anotação nasceria no lugar errado.
  const { data: conversa } = await supabase
    .from('conversations')
    .select('id, contact_id, account_id')
    .eq('id', conversation_id)
    .eq('account_id', accountId)
    .maybeSingle()

  if (!conversa) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }

  // Mesma cascata do `memberLabel` e da 912 — `full_name` é NOT NULL mas o
  // trigger de signup grava `COALESCE(..., '')`, então vazio é possível.
  const autorNome = profile?.full_name?.trim() || profile?.email || null

  const admin = supabaseAdmin()
  const { data: nota, error } = await admin
    .from('cb_conversation_notes')
    .insert({
      account_id: accountId,
      conversation_id,
      // Nulo em conversa de grupo — grupo não tem contato.
      contact_id: conversa.contact_id ?? null,
      author_user_id: user.id,
      autor_nome: autorNome,
      texto: texto.trim(),
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ note: nota }, { status: 201 })
}
