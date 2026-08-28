// ============================================================
// /api/cb/tasks/[id] — agir sobre uma tarefa (migration 944).
//
//   PATCH  — marcar lida/não lida, concluir/reabrir, importante, editar.
//   DELETE — apagar.
//
// ⚠️ QUEM PODE O QUÊ NÃO SE DECIDE AQUI: a resposta vem de
// `podeNaTarefa` (`src/lib/tasks/permissoes.ts`), que é a MESMA função que a
// tela chama para desabilitar o botão. Duas cópias divergiriam na primeira
// mudança, e o sintoma seria um botão que parece funcionar e não funciona.
//
// ⚠️ A AÇÃO É EXPLÍCITA NO CORPO (`{ acao: '…' }`), e não um punhado de campos
// soltos. Cada ação tem uma permissão diferente — deduzi-la de quais colunas
// vieram preenchidas faria um PATCH com dois campos cair em duas regras ao
// mesmo tempo, e a primeira que passasse valeria.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { podeNaTarefa, type AcaoDeTarefa } from '@/lib/tasks/permissoes';
import {
  ehDataValida,
  ehUuid,
  normalizarDescricao,
  normalizarHora,
  normalizarTitulo,
} from '@/lib/tasks/validar';
import type { Task } from '@/types';

/** O que o corpo pode pedir. Mapeado para a permissão logo abaixo. */
type PedidoDeAcao =
  | 'marcar-lida'
  | 'marcar-nao-lida'
  | 'concluir'
  | 'reabrir'
  | 'importante'
  | 'editar';

/**
 * Da ação pedida para a permissão que a governa.
 *
 * Ler e "desler" são a mesma permissão; concluir e reabrir também — quem pode
 * fechar pode desfazer, senão um clique errado vira estado permanente.
 */
const PERMISSAO: Record<PedidoDeAcao, AcaoDeTarefa> = {
  'marcar-lida': 'marcar-lida',
  'marcar-nao-lida': 'marcar-lida',
  concluir: 'concluir',
  reabrir: 'concluir',
  importante: 'importante',
  editar: 'editar',
};

function ehPedido(v: unknown): v is PedidoDeAcao {
  return typeof v === 'string' && v in PERMISSAO;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const limite = checkRateLimit(
      `cb:taskWrite:${ctx.userId}`,
      RATE_LIMITS.tarefa,
    );
    if (!limite.success) return rateLimitResponse(limite);

    const { id } = await params;
    if (!ehUuid(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      acao?: unknown;
      valor?: unknown;
      titulo?: unknown;
      descricao?: unknown;
      vence_em?: unknown;
      vence_as?: unknown;
      responsavel_user_id?: unknown;
    } | null;
    if (!body || !ehPedido(body.acao)) {
      return NextResponse.json({ error: 'acao is required' }, { status: 400 });
    }
    const acao = body.acao;

    // ⚠️ Lida sob RLS: é o que garante que a tarefa é de uma conta que quem
    // chama enxerga. A escrita lá embaixo roda em service-role e ignoraria isso.
    const { data: tarefa } = await ctx.supabase
      .from('cb_tasks')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle<Task>();

    if (!tarefa) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (
      !podeNaTarefa(PERMISSAO[acao], tarefa, {
        userId: ctx.userId,
        papel: ctx.role,
      })
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const patch: Record<string, unknown> = {};
    // Preenchido só quando a edição troca o responsável — é o único caminho
    // deste arquivo que precisa tocar o sino.
    let avisarNovoResponsavel: string | null = null;

    switch (acao) {
      case 'marcar-lida':
        patch.lida_em = new Date().toISOString();
        break;

      case 'marcar-nao-lida':
        patch.lida_em = null;
        break;

      // ⚠️ As duas colunas andam JUNTAS — o CHECK `cb_tasks_conclusao_coerente`
      // recusa "concluída sem data" e "aberta com data". Mexer numa só aqui
      // seria um 500 na cara do operador ao dar baixa.
      case 'concluir':
        patch.status = 'concluida';
        patch.concluida_em = new Date().toISOString();
        break;

      case 'reabrir':
        patch.status = 'aberta';
        patch.concluida_em = null;
        break;

      case 'importante':
        // O valor vem do corpo: o botão alterna, e mandar o estado desejado
        // (em vez de "inverta") evita que dois cliques rápidos se cancelem.
        patch.importante = body.valor === true;
        break;

      case 'editar': {
        if (body.titulo !== undefined) {
          const titulo = normalizarTitulo(body.titulo);
          if (!titulo) {
            return NextResponse.json(
              { error: 'titulo is required (1–200 chars)' },
              { status: 400 },
            );
          }
          patch.titulo = titulo;
        }

        if (body.descricao !== undefined) {
          const descricao = normalizarDescricao(body.descricao);
          if (descricao === undefined) {
            return NextResponse.json(
              { error: 'descricao is too long' },
              { status: 400 },
            );
          }
          patch.descricao = descricao;
        }

        if (body.vence_em !== undefined) {
          if (!ehDataValida(body.vence_em)) {
            return NextResponse.json(
              { error: 'vence_em must be a real YYYY-MM-DD date' },
              { status: 400 },
            );
          }
          patch.vence_em = body.vence_em;
        }

        if (body.vence_as !== undefined) {
          const vence_as = normalizarHora(body.vence_as);
          if (vence_as === undefined) {
            return NextResponse.json(
              { error: 'vence_as must be HH:MM' },
              { status: 400 },
            );
          }
          patch.vence_as = vence_as;
        }

        // ------------------------------------------------------------
        // Redirecionar a tarefa para outra pessoa
        // ------------------------------------------------------------
        if (body.responsavel_user_id !== undefined) {
          const novo = body.responsavel_user_id;
          if (!ehUuid(novo)) {
            return NextResponse.json(
              { error: 'responsavel_user_id is malformed' },
              { status: 400 },
            );
          }

          if (novo !== tarefa.responsavel_user_id) {
            // Membro desta conta? E, de quebra, o nome para congelar. Sob RLS,
            // então gente de outro escritório nem aparece.
            const { data: perfil } = await ctx.supabase
              .from('profiles')
              .select('user_id, full_name, email')
              .eq('account_id', ctx.accountId)
              .eq('user_id', novo)
              .maybeSingle();

            if (!perfil) {
              return NextResponse.json(
                { error: 'responsavel_user_id is not a member of this account' },
                { status: 400 },
              );
            }

            patch.responsavel_user_id = novo;
            patch.responsavel_nome =
              (perfil.full_name as string | null)?.trim() ||
              (perfil.email as string | null) ||
              null;

            // ⚠️ QUEM ACABA DE RECEBER NÃO LEU. Sem zerar, a tarefa nasce
            // "lida" para a pessoa nova — porque a antiga a tinha aberto — e
            // desaparece da contagem do menu dela, que é o único lugar onde
            // ela ia tropeçar no assunto.
            patch.lida_em = null;

            // Avisar só quem não é quem está mexendo (chamar a si mesmo de
            // volta seria sino do próprio clique).
            if (novo !== ctx.userId) avisarNovoResponsavel = novo;
          }
        }

        if (Object.keys(patch).length === 0) {
          return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
        }
        break;
      }
    }

    const admin = supabaseAdmin();
    const { data: atualizada, error } = await admin
      .from('cb_tasks')
      .update(patch)
      .eq('id', id)
      // Segunda tranca: o service-role ignora RLS, e um id de outra conta que
      // escapasse da leitura acima não pode ser escrito aqui.
      .eq('account_id', ctx.accountId)
      .select('*')
      .single();

    if (error) {
      console.error('[PATCH /api/cb/tasks] update falhou:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mesma política do POST: o aviso não derruba a ação que já aconteceu.
    let avisado = true;
    if (avisarNovoResponsavel) {
      const { data: eu } = await ctx.supabase
        .from('profiles')
        .select('full_name, email')
        .eq('user_id', ctx.userId)
        .maybeSingle();
      const autor =
        (eu?.full_name as string | null)?.trim() ||
        (eu?.email as string | null) ||
        'Alguém da equipe';

      const { error: erroSino } = await admin.from('notifications').insert({
        account_id: ctx.accountId,
        user_id: avisarNovoResponsavel,
        type: 'task_assigned',
        contact_id: tarefa.contact_id,
        task_id: tarefa.id,
        actor_user_id: ctx.userId,
        title: `${autor} encaminhou uma tarefa para você`,
        body: (patch.titulo as string | undefined) ?? tarefa.titulo,
      });
      if (erroSino) {
        console.error('[PATCH /api/cb/tasks] falha ao avisar:', erroSino.message);
        avisado = false;
      }
    }

    return NextResponse.json({ task: atualizada, avisado });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const limite = checkRateLimit(
      `cb:taskWrite:${ctx.userId}`,
      RATE_LIMITS.tarefa,
    );
    if (!limite.success) return rateLimitResponse(limite);

    const { id } = await params;
    if (!ehUuid(id)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: tarefa } = await ctx.supabase
      .from('cb_tasks')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle<Task>();

    if (!tarefa) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    if (
      !podeNaTarefa('apagar', tarefa, { userId: ctx.userId, papel: ctx.role })
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = supabaseAdmin();
    // ⚠️ As tarefas que saíram desta NÃO são apagadas junto: a FK é
    // `ON DELETE SET NULL`, e o título da origem já está congelado em
    // `tarefa_pai_titulo`, então a derivada continua dizendo de onde veio.
    // A notificação, essa sim, some por CASCADE — um aviso que não abre nada
    // seria um beco sem saída no sino.
    const { error } = await admin
      .from('cb_tasks')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[DELETE /api/cb/tasks] falhou:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
