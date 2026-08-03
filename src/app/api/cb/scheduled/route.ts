import { NextResponse } from 'next/server';

import { custoDaAssinatura } from '@/lib/assinatura/assinatura';
import { nomeParaAssinar } from '@/lib/assinatura/resolver';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { lerAnexo, podeTerLegenda, tetoDaLegenda } from '@/lib/scheduled/midia';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';

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
 * 4. (932) O anexo e a citação precisam ser conferidos contra a CONTA e a
 *    CONVERSA. O bucket é público para leitura e a coluna da citação não tem
 *    FK: sem esta rota, um POST poderia agendar o arquivo de outro escritório
 *    ou citar uma mensagem de outra conversa.
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
      media_url?: unknown;
      media_path?: unknown;
      media_kind?: unknown;
      media_filename?: unknown;
      reply_to_message_id?: unknown;
    };

    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : '';
    const texto = typeof body.body === 'string' ? body.body.trim() : '';
    const quando =
      typeof body.scheduled_for === 'string' ? body.scheduled_for : '';

    // Anexo (932). A validação de forma e de POSSE mora no módulo puro; aqui
    // só se devolve o recado que ele escreveu, que já está em português.
    const lido = lerAnexo(body, ctx.accountId);
    if (lido.erro) {
      return NextResponse.json({ error: lido.erro }, { status: 400 });
    }
    const anexo = lido.anexo;

    if (!conversationId || !quando) {
      return NextResponse.json(
        { error: 'conversation_id e scheduled_for são obrigatórios.' },
        { status: 400 },
      );
    }
    // ⚠️ Texto deixou de ser obrigatório — mas só quando há anexo. Foto sem
    // legenda é legítima, e áudio NUNCA tem legenda. É o mesmo afrouxamento
    // que o CHECK da 932 fez no banco, e as duas pontas têm de concordar:
    // aqui o operador ouve o motivo, lá é a última barreira.
    if (!texto && !anexo) {
      return NextResponse.json(
        { error: 'Escreva a mensagem ou anexe um arquivo.' },
        { status: 400 },
      );
    }

    if (anexo && !podeTerLegenda(anexo.kind) && texto) {
      // ⚠️ Áudio com texto é RECUSADO, não silenciosamente aparado. O envio de
      // nota de voz não tem campo de legenda: o texto ficaria gravado no CRM,
      // visível para a equipe, e não chegaria ao cliente.
      return NextResponse.json(
        { error: 'Áudio não leva legenda — grave o recado ou mande o texto separado.' },
        { status: 400 },
      );
    }

    // ⚠️ O teto do texto DEPENDE de haver anexo, e o da legenda desconta a
    // assinatura. Sem o desconto, uma legenda de 1020 passa aqui e a Meta
    // recusa no envio — que numa agendada acontece de madrugada, sem ninguém
    // na tela para reescrever (923 + 932).
    //
    // ⚠️ E isto NÃO é garantia: a assinatura pode ser LIGADA depois, ou quem
    // agendou pode sair da conta (aí quem assina passa a ser o nome do
    // escritório, que pode ser mais longo). Por isso `send-message.ts`
    // revalida no envio e o disparador traduz o recado.
    if (anexo) {
      const teto = tetoDaLegenda(
        custoDaAssinatura(
          await nomeParaAssinar(ctx.supabase, ctx.accountId, ctx.userId),
        ),
      );
      if (texto.length > teto) {
        return NextResponse.json(
          { error: `A legenda passa de ${teto} caracteres.` },
          { status: 400 },
        );
      }
    } else if (texto.length > MAX_TEXTO) {
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

    // ⚠️ CITAÇÃO (932): confere posse AQUI porque a coluna não tem FK. O
    // filtro por `conversation_id` é o que impede alguém de citar, chutando
    // UUID, uma mensagem de outra conversa — a mesma checagem que
    // `send-message.ts` faz no envio, adiantada para o momento em que dá para
    // avisar.
    let citadaId: string | null = null;
    if (typeof body.reply_to_message_id === 'string' && body.reply_to_message_id) {
      const { data: citada } = await ctx.supabase
        .from('messages')
        .select('id, deleted_at')
        .eq('id', body.reply_to_message_id)
        .eq('conversation_id', conversationId)
        .maybeSingle();

      if (!citada) {
        return NextResponse.json(
          { error: 'A mensagem citada não é desta conversa.' },
          { status: 400 },
        );
      }
      // Citar uma mensagem JÁ apagada é recusado agora, e não engolido para
      // virar aviso amanhã: o operador está na tela e pode escolher outra. O
      // disparador continua tratando o caso de ela ser apagada DEPOIS — que é
      // o caso que só o tempo cria.
      if ((citada as { deleted_at?: string | null }).deleted_at) {
        return NextResponse.json(
          { error: 'A mensagem citada foi apagada.' },
          { status: 409 },
        );
      }
      citadaId = (citada as { id: string }).id;
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
        // 932. `media_url` nulo é o caso comum (texto puro) e o CHECK de forma
        // exige que os três andem juntos.
        // ⚠️ A URL é DERIVADA do caminho já conferido, nunca aceita do
        // cliente. Aceitando-a crua, a conferência de posse olhava o
        // `media_path` e o envio usava a `media_url` — dois campos sem nada
        // amarrando um ao outro, e o CRM entregaria ao cliente o conteúdo de
        // qualquer endereço da internet.
        media_url: anexo
          ? supabaseAdmin()
              .storage.from(CHAT_MEDIA_BUCKET)
              .getPublicUrl(anexo.path).data.publicUrl
          : null,
        media_path: anexo?.path ?? null,
        media_kind: anexo?.kind ?? null,
        media_filename: anexo?.filename ?? null,
        reply_to_message_id: citadaId,
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
