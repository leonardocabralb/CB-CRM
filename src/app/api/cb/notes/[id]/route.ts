import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { createClient } from '@/lib/supabase/server';
import { canWriteNotes, isAccountRole } from '@/lib/auth/roles';

/**
 * Fixar/desafixar uma anotação no topo da ficha do cliente (migration 951).
 *
 * ⚠️ É uma ROTA porque fixar é UPDATE, e a 918/920 revogaram UPDATE de
 * `authenticated` (nota não é editável pelo navegador — um `.update()` do
 * cliente voltaria "0 linhas" com cara de sucesso). A régua de quem pode é a
 * MESMA de quem anota (`canWriteNotes`): fixar é curadoria da ficha, não
 * edição de conteúdo.
 *
 * ⚠️ "Uma por cliente" é garantido pelo ÍNDICE PARCIAL da 951, não por esta
 * rota: limpar a antiga e carimbar a nova são dois UPDATEs, e entre eles cabe
 * outra requisição — quando isso acontecer, o segundo carimbo leva 23505 e
 * volta como "alguém fixou junto", nunca como duas fixadas.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Invalid note id' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle();
  const accountId = profile?.account_id as string | undefined;
  const papel = profile?.account_role;
  if (!accountId || !isAccountRole(papel) || !canWriteNotes(papel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { fixada } = (body ?? {}) as { fixada?: unknown };
  if (typeof fixada !== 'boolean') {
    return NextResponse.json(
      { error: "'fixada' must be a boolean" },
      { status: 400 }
    );
  }

  // Lida com o cliente DO USUÁRIO, sob RLS — é o que prova que a nota é de
  // uma conta que ele enxerga, antes de o service-role escrever.
  const { data: nota, error: notaErr } = await supabase
    .from('cb_conversation_notes')
    .select('id, contact_id')
    .eq('id', id)
    .maybeSingle();
  if (notaErr) {
    // Erro de banco não vira "não encontrado" (regra do projeto).
    console.error('[PATCH /api/cb/notes] lookup:', notaErr.message);
    return NextResponse.json({ error: 'Failed to load note' }, { status: 500 });
  }
  if (!nota) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }
  // Nota de GRUPO não fixa: a fixação é "uma por CLIENTE", e grupo não tem
  // contato (o índice parcial da 951 nem a cobre).
  if (!nota.contact_id) {
    return NextResponse.json(
      { error: 'GROUP_NOTE_NOT_PINNABLE' },
      { status: 409 }
    );
  }

  const admin = supabaseAdmin();

  if (fixada) {
    // Desafixa a anterior do MESMO cliente antes de carimbar a nova.
    const { error: erroLimpa } = await admin
      .from('cb_conversation_notes')
      .update({ fixada_em: null })
      .eq('account_id', accountId)
      .eq('contact_id', nota.contact_id)
      .not('fixada_em', 'is', null);
    if (erroLimpa) {
      console.error('[PATCH /api/cb/notes] unpin previous:', erroLimpa.message);
      return NextResponse.json(
        { error: 'Failed to pin note' },
        { status: 500 }
      );
    }
  }

  const { data: atual, error: erroFixa } = await admin
    .from('cb_conversation_notes')
    .update({ fixada_em: fixada ? new Date().toISOString() : null })
    .eq('id', id)
    .select('*')
    .single();
  if (erroFixa) {
    // 23505 = o índice parcial desempatou uma corrida de duas fixações.
    const corrida = (erroFixa as { code?: string }).code === '23505';
    if (!corrida) {
      console.error('[PATCH /api/cb/notes] pin:', erroFixa.message);
    }
    return NextResponse.json(
      { error: corrida ? 'PINNED_BY_SOMEONE_ELSE' : 'Failed to pin note' },
      { status: corrida ? 409 : 500 }
    );
  }

  return NextResponse.json({ note: atual });
}
