import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/cb/scheduled — agenda uma mensagem de texto (migration 925).
 *
 * ⚠️ POR QUE UMA ROTA, SE APAGAR VAI DIRETO DO NAVEGADOR. Três motivos, o
 * mesmo desenho da anotação (918):
 *
 * 1. `autor_nome` é carimbado por quem grava e não pode ser escolhido por
 *    quem chama — é o que faz "quem agendou" (P4.11) sobreviver à saída do
 *    membro, quando `created_by` já virou NULL.
 * 2. O canal precisa ser RESOLVIDO, não aceito cru. É aqui que a falha
 *    fechada da P4.3 começa: conta sem conexão em `cb_channels` não agenda,
 *    e ouve o motivo, em vez de agendar contra o fallback do
 *    `whatsapp_config` e descobrir isso de madrugada.
 * 3. A hora precisa ser conferida contra o relógio do SERVIDOR. O do
 *    navegador pode estar errado, e uma linha com `scheduled_for` no
 *    passado sai no primeiro ciclo — "agendar" viraria "enviar agora".
 *
 * Por isso `cb_scheduled_messages` não tem policy de INSERT e o papel
 * `authenticated` teve o INSERT revogado: não existe caminho de escrita
 * fora daqui.
 */

/** Mesmo teto do CHECK da 925 e da anotação. */
const MAX_TEXTO = 4000;

/**
 * Teto de quanto tempo à frente se pode agendar.
 *
 * ⚠️ Sem ele, um erro de digitação no ano (2226 em vez de 2026) estaciona uma
 * linha `pending` para sempre — e ela não é inofensiva: a FK do canal é
 * RESTRICT, então aquela linha esquecida torna a conexão impossível de
 * remover. Como a faixa só mostra a fila da conversa ABERTA, ninguém acharia
 * a linha para apagar. Um ano é folgado para follow-up de escritório.
 */
const MAX_DIAS_A_FRENTE = 365;

export async function POST(request: Request) {
  try {
    // `agent`, como enviar: a agendada É uma mensagem ao cliente, só que
    // com hora marcada. `viewer` é somente-leitura.
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(`cb:schedule:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json()) as {
      conversation_id?: unknown;
      body?: unknown;
      scheduled_for?: unknown;
    };

    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : '';
    const texto = typeof body.body === 'string' ? body.body.trim() : '';
    const quando =
      typeof body.scheduled_for === 'string' ? body.scheduled_for : '';

    if (!conversationId || !texto || !quando) {
      return NextResponse.json(
        { error: 'conversation_id, body e scheduled_for são obrigatórios.' },
        { status: 400 },
      );
    }
    if (texto.length > MAX_TEXTO) {
      return NextResponse.json(
        { error: `O texto passa de ${MAX_TEXTO} caracteres.` },
        { status: 400 },
      );
    }

    const data = new Date(quando);
    if (Number.isNaN(data.getTime())) {
      return NextResponse.json(
        { error: 'Data e hora inválidas.' },
        { status: 400 },
      );
    }
    // Relógio do servidor, não o do navegador — ver a nota 3 acima.
    if (data.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'A hora escolhida já passou.' },
        { status: 400 },
      );
    }
    if (data.getTime() > Date.now() + MAX_DIAS_A_FRENTE * 86_400_000) {
      return NextResponse.json(
        { error: `Não dá para agendar com mais de ${MAX_DIAS_A_FRENTE} dias de antecedência.` },
        { status: 400 },
      );
    }

    // Conversa desta conta. A FK composta barraria de qualquer forma, mas o
    // erro dela é 23503 cru; aqui o operador ouve o que aconteceu.
    //
    // ⚠️ O `group:cb_groups(channel_id)` não é enfeite — ver o bloco abaixo.
    const { data: conversa } = await ctx.supabase
      .from('conversations')
      .select('id, channel_id, group_id, group:cb_groups(channel_id)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (!conversa) {
      return NextResponse.json(
        { error: 'Conversa não encontrada.' },
        { status: 404 },
      );
    }

    // ⚠️ CONVERSA DE GRUPO TEM `conversations.channel_id` NULO — SEMPRE.
    // `cb-groups/persist.ts` não grava a coluna; quem sabe por qual número o
    // grupo é visto é `cb_groups.channel_id`. Lendo a coluna da conversa,
    // `resolveChannelForConversation` cairia no canal PADRÃO da conta, e numa
    // conta de dois números a agendada de um grupo do número B sairia
    // carimbada com o número A — que não está naquele grupo. O envio falharia
    // horas depois, sem ninguém na tela, com um erro que não explica nada.
    const linha = conversa as {
      channel_id?: string | null;
      group_id?: string | null;
      group?: { channel_id?: string | null } | null;
    };
    const ehGrupo = !!linha.group_id;
    const canalDaConversa = ehGrupo
      ? (linha.group?.channel_id ?? null)
      : (linha.channel_id ?? null);

    // Grupo sem número conhecido não agenda. Cair no padrão da conta aqui
    // seria justamente o engano descrito acima.
    if (ehGrupo && !canalDaConversa) {
      return NextResponse.json(
        {
          error:
            'Não dá para saber por qual número este grupo é atendido. Ressincronize os grupos em Configurações → Conexões antes de agendar.',
        },
        { status: 409 },
      );
    }

    // ⚠️ FALHA FECHADA (P4.3). `resolveChannelForConversation` devolve
    // `channelId: null` no fallback de transição do `whatsapp_config` — e é
    // justamente esse caso que não pode agendar: sem uma linha em
    // `cb_channels` não há como PROMETER por qual número a mensagem sai
    // daqui a doze horas.
    const canal = await resolveChannelForConversation(
      ctx.supabase,
      ctx.accountId,
      { channel_id: canalDaConversa },
    );
    if (!canal?.channelId) {
      return NextResponse.json(
        {
          error:
            'Esta conta não tem uma conexão de WhatsApp registrada para agendar. Configure a conexão em Configurações → Conexões.',
        },
        { status: 409 },
      );
    }

    // Mesma cascata do `memberLabel` e da 912. `full_name` é NOT NULL no
    // schema, mas vem vazio em conta criada por convite antes do primeiro
    // login.
    const { data: perfil } = await ctx.supabase
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const autorNome =
      (perfil as { full_name?: string | null; email?: string | null } | null)
        ?.full_name?.trim() ||
      (perfil as { email?: string | null } | null)?.email ||
      'Alguém da equipe';

    // Admin: `authenticated` não tem INSERT nesta tabela, de propósito.
    const { data: criada, error } = await supabaseAdmin()
      .from('cb_scheduled_messages')
      .insert({
        account_id: ctx.accountId,
        conversation_id: conversationId,
        channel_id: canal.channelId,
        body: texto,
        scheduled_for: data.toISOString(),
        created_by: ctx.userId,
        autor_nome: autorNome,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[agendadas] insert falhou:', error.message);
      return NextResponse.json(
        { error: 'Não foi possível agendar.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ scheduled: criada });
  } catch (err) {
    return toErrorResponse(err);
  }
}
