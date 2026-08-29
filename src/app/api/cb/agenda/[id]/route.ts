import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { validarReuniao } from '@/lib/agenda/validar';
import { isAccountRole, canWriteNotes } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';

/**
 * Editar, mover e apagar reunião (migration 945).
 *
 * O PATCH é o que o arrastar-e-soltar do calendário chama: mover uma reunião é
 * um PATCH com `starts_at` e `ends_at` novos.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ver a nota em `../route.ts`. */
const SOBREPOSICAO = '23P01';

/** Colunas que o PATCH aceita. Nada fora desta lista chega ao banco. */
const CAMPOS_EDITAVEIS = [
  'titulo',
  'descricao',
  'local',
  'tipo',
  'status',
  'starts_at',
  'ends_at',
  'channel_id',
] as const;

async function contexto() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { erro: 'Unauthorized' as const, status: 401 };

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle();

  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return { erro: 'Seu perfil não está ligado a uma conta.' as const, status: 403 };
  }

  const papel = isAccountRole(profile?.account_role)
    ? profile.account_role
    : 'viewer';
  if (!canWriteNotes(papel)) {
    return { erro: 'Seu perfil não pode alterar reuniões.' as const, status: 403 };
  }

  return { user, accountId };
}

const UUID_OK = (v: unknown): v is string =>
  typeof v === 'string' && UUID.test(v);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Reunião inválida.' }, { status: 400 });
  }

  const ctx = await contexto();
  if ('erro' in ctx) {
    return NextResponse.json({ error: ctx.erro }, { status: ctx.status });
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  }

  const admin = supabaseAdmin();

  // A reunião tem de ser desta conta. A consulta escopada é o que substitui a
  // RLS, que o service-role ignora.
  const { data: atual } = await admin
    .from('cb_meetings')
    .select('id, starts_at, ends_at, contact_id')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle();

  if (!atual) {
    return NextResponse.json({ error: 'Reunião não encontrada.' }, { status: 404 });
  }

  // ------------------------------------------------------------
  // ⚠️ O PAR DE DATAS É COMPLETADO A PARTIR DA LINHA ATUAL.
  //
  // O arrastar-e-soltar manda as duas, mas um PATCH que mandasse só
  // `starts_at` deixaria a validação sem com o que comparar — e passaria, indo
  // gravar uma reunião que termina antes de começar. Completar aqui é o que
  // permite a validação ser a mesma da criação.
  // ------------------------------------------------------------
  const mexeuEmData =
    corpo.starts_at !== undefined || corpo.ends_at !== undefined;

  const paraValidar = mexeuEmData
    ? {
        ...corpo,
        starts_at: corpo.starts_at ?? atual.starts_at,
        ends_at: corpo.ends_at ?? atual.ends_at,
      }
    : corpo;

  const erro = validarReuniao(paraValidar, { parcial: true });
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  const mudancas: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // ------------------------------------------------------------
  // Troca de responsável.
  //
  // ⚠️ `owner_nome` é RECARIMBADO junto, nunca deixado para trás. As duas
  // colunas contam a mesma coisa: sem isto a reunião passaria a pertencer a
  // uma pessoa e a exibir o nome de outra — e o nome é o que sobrevive quando
  // o membro sai da conta e o id vira nulo.
  //
  // ⚠️ Conferido contra a conta, como no POST: `auth.users` é global, então a
  // FK sozinha não impede pôr uma reunião na agenda de alguém de outro
  // escritório.
  // ------------------------------------------------------------
  if (UUID_OK(corpo.owner_user_id)) {
    const { data: dono } = await admin
      .from('profiles')
      .select('user_id, full_name, email')
      .eq('user_id', corpo.owner_user_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!dono) {
      return NextResponse.json(
        { error: 'O responsável escolhido não faz parte desta conta.' },
        { status: 400 },
      );
    }

    mudancas.owner_user_id = dono.user_id;
    mudancas.owner_nome =
      (dono.full_name as string | null) ??
      (dono.email as string | null) ??
      'Alguém';
  }

  // ------------------------------------------------------------
  // Troca (ou remoção) do cliente vinculado.
  //
  // ⚠️ `contact_id` NÃO entra em `CAMPOS_EDITAVEIS` porque precisa de duas
  // coisas que a cópia genérica não faz: conferir o contato contra a conta e
  // recarimbar `contato_nome`. Sem este bloco a rota aceitava o campo, ignorava
  // em silêncio e devolvia 200 — a tela mostrava sucesso e o vínculo não
  // mudava. Foi assim que vincular cliente numa reunião existente não
  // funcionava, sem erro em lugar nenhum.
  //
  // ⚠️ `null` explícito significa DESVINCULAR; ausente significa "não mexer".
  // Colapsar os dois faria toda edição de título apagar o cliente.
  // ------------------------------------------------------------
  if (corpo.contact_id !== undefined) {
    if (corpo.contact_id === null) {
      mudancas.contact_id = null;
      mudancas.contato_nome = null;
    } else if (UUID_OK(corpo.contact_id)) {
      const { data: contato } = await admin
        .from('contacts')
        .select('id, name, phone')
        .eq('id', corpo.contact_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (!contato) {
        return NextResponse.json(
          { error: 'Cliente não encontrado nesta conta.' },
          { status: 400 },
        );
      }

      mudancas.contact_id = contato.id;
      mudancas.contato_nome =
        (contato.name as string | null) ?? (contato.phone as string);
    } else {
      return NextResponse.json({ error: 'Cliente inválido.' }, { status: 400 });
    }
  }

  for (const campo of CAMPOS_EDITAVEIS) {
    if (corpo[campo] === undefined) continue;

    const valor = corpo[campo];
    if (campo === 'descricao' || campo === 'local') {
      mudancas[campo] =
        typeof valor === 'string' && valor.trim() ? valor.trim() : null;
    } else if (campo === 'channel_id') {
      mudancas[campo] =
        typeof valor === 'string' && UUID.test(valor) ? valor : null;
    } else if (campo === 'titulo') {
      mudancas[campo] = (valor as string).trim();
    } else {
      mudancas[campo] = valor;
    }
  }

  const { data: atualizada, error: erroUpdate } = await admin
    .from('cb_meetings')
    .update(mudancas)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select()
    .single();

  if (erroUpdate) {
    if (erroUpdate.code === SOBREPOSICAO) {
      return NextResponse.json(
        {
          error:
            'Já existe uma reunião nesse horário para este responsável. Escolha outro horário.',
          conflito: true,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: erroUpdate.message }, { status: 500 });
  }

  return NextResponse.json({ meeting: atualizada });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'Reunião inválida.' }, { status: 400 });
  }

  const ctx = await contexto();
  if ('erro' in ctx) {
    return NextResponse.json({ error: ctx.erro }, { status: ctx.status });
  }

  const admin = supabaseAdmin();

  // ⚠️ `select()` no delete para saber se algo saiu. Sem ele, apagar reunião de
  // outra conta volta "0 linhas" com status 200, e a tela some com o item da
  // lista como se tivesse funcionado.
  const { data: apagada, error } = await admin
    .from('cb_meetings')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!apagada) {
    return NextResponse.json({ error: 'Reunião não encontrada.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
