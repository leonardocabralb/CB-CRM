import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { canManageMembers, isAccountRole } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';

import { estaApagada, podeMexerNaNota } from './lixeira';

// ============================================================
// Lixeira de anotações (1132): as duas escritas da marca, no servidor
//
// `DELETE /api/cb/notes/[id]` (apagar = MARCAR) e
// `POST /api/cb/notes/[id]/restaurar` (desmarcar) são a mesma mecânica com o
// sinal trocado, e moram juntas para as guardas não divergirem:
//
// - ⚠️ A anotação é lida com o cliente DO USUÁRIO, sob RLS: é o que prova que
//   ela é de uma conta que ele enxerga (o membro SUSPENSO não enxerga — 1067)
//   antes de o service role escrever. O navegador não faz UPDATE nesta tabela
//   (918/920).
// - Quem pode: o AUTOR ou admin/dono (`podeMexerNaNota`) — a régua da policy
//   de DELETE da 918, que valia quando o navegador apagava direto. Restaurar
//   usa a mesma (decisão do operador, 10/11/2026).
// - ⚠️ O UPDATE é CERCADO pelo estado de partida (`apagada_em` nulo para
//   apagar, não nulo para restaurar) e pela conta. Zero linhas se MEDE
//   relendo (raiz, 8b): já está no estado pedido = 200 com a linha (dois
//   cliques, duas abas — idempotente); sumiu = 404 `NOTE_GONE` (venceu, ou a
//   ficha foi para a Lixeira de contatos).
// - Apagar DESAFIXA na mesma escrita: o CHECK da 1132 recusa apagada fixada
//   (ela seguraria o índice "uma fixada por cliente" da 951). Restaurar não
//   refixa — a fixada do cliente pode ser outra agora.
// - Erro ao ler perfil ou anotação = 500, nunca 403/404 (raiz, 8b).
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AcaoDaLixeira = 'apagar' | 'restaurar';

export async function mudarNaLixeira(
  id: string,
  acao: AcaoDaLixeira
): Promise<NextResponse> {
  const rotulo = acao === 'apagar' ? '[DELETE /api/cb/notes]' : '[POST /api/cb/notes/restaurar]';
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

  const { data: profile, error: erroPerfil } = await supabase
    .from('profiles')
    .select('account_id, account_role, full_name, email')
    .eq('user_id', user.id)
    .maybeSingle();
  if (erroPerfil) {
    console.error(`${rotulo} profile:`, erroPerfil.message);
    return NextResponse.json({ error: erroPerfil.message }, { status: 500 });
  }
  const accountId = profile?.account_id as string | undefined;
  const papel = profile?.account_role;
  if (!accountId || !isAccountRole(papel)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Viva ou apagada: as duas pontas leem a linha inteira (a lixeira é lida
  // pela mesma policy de leitura da conta).
  const ler = () =>
    supabase
      .from('cb_conversation_notes')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

  const { data: nota, error: erroNota } = await ler();
  if (erroNota) {
    console.error(`${rotulo} lookup:`, erroNota.message);
    return NextResponse.json({ error: 'Failed to load note' }, { status: 500 });
  }
  if (!nota) {
    return NextResponse.json({ error: 'NOTE_GONE' }, { status: 404 });
  }
  if (!podeMexerNaNota(nota, user.id, canManageMembers(papel))) {
    return NextResponse.json({ error: 'NOT_THE_AUTHOR' }, { status: 403 });
  }
  // Já está como pedido: nada a escrever.
  if (estaApagada(nota) === (acao === 'apagar')) {
    return NextResponse.json({ note: nota });
  }

  const admin = supabaseAdmin();
  const base = admin
    .from('cb_conversation_notes')
    .update(
      acao === 'apagar'
        ? {
            apagada_em: new Date().toISOString(),
            apagada_por: user.id,
            apagada_por_nome: profile?.full_name?.trim() || profile?.email || null,
            fixada_em: null,
          }
        : { apagada_em: null, apagada_por: null, apagada_por_nome: null }
    )
    .eq('id', id)
    .eq('account_id', accountId);
  const { data: escrita, error: erroEscrita } = await (acao === 'apagar'
    ? base.is('apagada_em', null)
    : base.not('apagada_em', 'is', null)
  )
    .select('*')
    .maybeSingle();
  if (erroEscrita) {
    console.error(`${rotulo} update:`, erroEscrita.message);
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 });
  }
  if (escrita) return NextResponse.json({ note: escrita });

  // Zero linhas: alguém mudou entre a leitura e a escrita. Mede.
  const { data: agora, error: erroRelida } = await ler();
  if (erroRelida) {
    console.error(`${rotulo} relendo:`, erroRelida.message);
    return NextResponse.json({ error: 'Failed to load note' }, { status: 500 });
  }
  if (!agora) {
    return NextResponse.json({ error: 'NOTE_GONE' }, { status: 404 });
  }
  if (estaApagada(agora) === (acao === 'apagar')) {
    return NextResponse.json({ note: agora });
  }
  // Mudou e desmudou no meio: devolve o estado atual, sem afirmar sucesso.
  return NextResponse.json({ error: 'NOTE_CHANGED', note: agora }, { status: 409 });
}
