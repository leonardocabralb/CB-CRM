import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { validarReuniao } from '@/lib/agenda/validar';
import { isAccountRole, canWriteNotes } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/server';

/**
 * Criação de reunião (migration 945).
 *
 * ⚠️ POR QUE UMA ROTA, SE A TELA PODERIA INSERIR DIRETO
 * Pelo mesmo motivo das anotações (918) e das tarefas (944): há campos que não
 * podem ser escolhidos por quem chama. `autor_nome` e `owner_nome` são
 * carimbados aqui — é o que faz a autoria e o "com quem era" sobreviverem à
 * saída do membro, quando as colunas de id já viraram NULL. E `owner_user_id`
 * precisa ser conferido contra a conta: sem isso um pedido forjado marca
 * reunião na agenda de alguém de outro escritório.
 *
 * Por isso `cb_meetings` não tem policy de INSERT e o `authenticated` teve a
 * escrita revogada — não existe caminho fora daqui.
 */

/** Forma de UUID — o que o Postgres aceita em `uuid`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O código que o Postgres devolve quando a restrição `EXCLUDE` barra a
 * gravação — duas reuniões sobrepostas para o mesmo advogado.
 *
 * ⚠️ Traduzir isto é obrigatório. Sem a tradução o operador recebe
 * "conflicting key value violates exclusion constraint
 * cb_meetings_sem_sobreposicao", que não diz o que fazer. E este caminho é
 * ALCANÇÁVEL pelo uso normal: é exatamente o que acontece quando duas pessoas
 * marcam ao mesmo tempo, que é o motivo de a restrição existir.
 */
const SOBREPOSICAO = '23P01';

export async function POST(request: Request) {
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
    .select('account_id, account_role, full_name, email')
    .eq('user_id', user.id)
    .maybeSingle();

  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return NextResponse.json(
      { error: 'Seu perfil não está ligado a uma conta.' },
      { status: 403 },
    );
  }

  // Viewer não marca reunião — mesmo nível das anotações.
  const papel = isAccountRole(profile?.account_role)
    ? profile.account_role
    : 'viewer';
  if (!canWriteNotes(papel)) {
    return NextResponse.json(
      { error: 'Seu perfil não pode marcar reuniões.' },
      { status: 403 },
    );
  }

  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  }

  const erro = validarReuniao(corpo);
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  // ------------------------------------------------------------
  // O dono da reunião. Sem `owner_user_id` no corpo, é quem está marcando.
  // ------------------------------------------------------------
  const ownerId =
    typeof corpo.owner_user_id === 'string' && UUID.test(corpo.owner_user_id)
      ? corpo.owner_user_id
      : user.id;

  const admin = supabaseAdmin();

  // ⚠️ CONFERIDO CONTRA A CONTA, sempre. A rota roda em service-role e ignora
  // RLS; sem esta consulta, `owner_user_id` de outro escritório entraria — e a
  // FK não pega, porque ela aponta para `auth.users`, que é global.
  const { data: dono } = await admin
    .from('profiles')
    .select('user_id, full_name, email')
    .eq('user_id', ownerId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (!dono) {
    return NextResponse.json(
      { error: 'O responsável escolhido não faz parte desta conta.' },
      { status: 400 },
    );
  }

  // ------------------------------------------------------------
  // O cliente, quando há. `contact_id` nulo é caso normal: reunião interna.
  // ------------------------------------------------------------
  let contactId: string | null = null;
  let contatoNome: string | null = null;

  if (typeof corpo.contact_id === 'string' && UUID.test(corpo.contact_id)) {
    const { data: contato } = await admin
      .from('contacts')
      .select('id, name, phone')
      .eq('id', corpo.contact_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!contato) {
      return NextResponse.json(
        { error: 'Cliente não encontrado nesta conta.' },
        { status: 400 },
      );
    }
    contactId = contato.id as string;
    contatoNome = (contato.name as string | null) ?? (contato.phone as string);
  }

  const autorNome =
    (profile?.full_name as string | null) ??
    (profile?.email as string | null) ??
    'Alguém';

  const { data: criada, error: erroInsert } = await admin
    .from('cb_meetings')
    .insert({
      account_id: accountId,
      owner_user_id: ownerId,
      owner_nome:
        (dono.full_name as string | null) ??
        (dono.email as string | null) ??
        autorNome,
      contact_id: contactId,
      contato_nome: contatoNome,
      conversation_id:
        typeof corpo.conversation_id === 'string' && UUID.test(corpo.conversation_id)
          ? corpo.conversation_id
          : null,
      channel_id:
        typeof corpo.channel_id === 'string' && UUID.test(corpo.channel_id)
          ? corpo.channel_id
          : null,
      titulo: (corpo.titulo as string).trim(),
      descricao:
        typeof corpo.descricao === 'string' && corpo.descricao.trim()
          ? corpo.descricao.trim()
          : null,
      local:
        typeof corpo.local === 'string' && corpo.local.trim()
          ? corpo.local.trim()
          : null,
      tipo: (corpo.tipo as string) ?? 'outra',
      starts_at: corpo.starts_at as string,
      ends_at: corpo.ends_at as string,
      status: (corpo.status as string) ?? 'agendada',
      created_by: user.id,
      autor_nome: autorNome,
    })
    .select()
    .single();

  if (erroInsert) {
    if (erroInsert.code === SOBREPOSICAO) {
      return NextResponse.json(
        {
          error:
            'Já existe uma reunião nesse horário para este responsável. Escolha outro horário.',
          conflito: true,
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: erroInsert.message }, { status: 500 });
  }

  return NextResponse.json({ meeting: criada }, { status: 201 });
}
