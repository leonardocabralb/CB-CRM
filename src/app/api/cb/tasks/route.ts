// ============================================================
// POST /api/cb/tasks — criar tarefa sobre um cliente (migration 944).
//
// ⚠️ POR QUE UMA ROTA, E NÃO INSERT DIRETO DO NAVEGADOR. Três razões, e a
// primeira é impeditiva — as mesmas que puseram a anotação interna aqui (918):
//
// 1. A tarefa AVISA o destinatário, e `notifications` não tem policy de INSERT
//    desde a 027. Do cliente, daria 42501.
// 2. `criador_nome` e `responsavel_nome` são carimbados no servidor. Vindos do
//    cliente, seriam texto que o cliente escolhe — e é justamente o carimbo
//    que faz a autoria sobreviver à saída do membro.
// 3. O destinatário precisa ser validado contra a conta. Sem isso, um POST
//    fora da tela encaminha tarefa para gente de outro escritório.
//
// ⚠️ SEM TRAVA DE PAPEL, de propósito: qualquer membro cria, `viewer`
// inclusive. Decisão do operador, com o mesmo precedente da anotação interna
// (`canWriteNotes`) — coordenação entre colegas não é escrita no cliente, e um
// viewer que enxerga o trabalho e não pode pedir nada a ninguém é metade de uma
// pessoa no sistema.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  ehDataValida,
  ehUuid,
  normalizarDescricao,
  normalizarHora,
  normalizarTitulo,
} from '@/lib/tasks/validar';

/** O que a rota precisa saber da tarefa de origem (resposta ou desdobramento). */
interface TarefaPai {
  id: string;
  contact_id: string;
  titulo: string;
  /** Nulo quando quem pediu a tarefa saiu do escritório — ver PARENT_CREATOR_GONE. */
  criador_user_id: string | null;
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const limite = checkRateLimit(
      `cb:taskWrite:${ctx.userId}`,
      RATE_LIMITS.tarefa,
    );
    if (!limite.success) return rateLimitResponse(limite);

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown;
      responsavel_user_id?: unknown;
      titulo?: unknown;
      descricao?: unknown;
      vence_em?: unknown;
      vence_as?: unknown;
      importante?: unknown;
      tarefa_pai_id?: unknown;
      tipo?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const titulo = normalizarTitulo(body.titulo);
    if (!titulo) {
      return NextResponse.json(
        { error: 'titulo is required (1–200 chars)' },
        { status: 400 },
      );
    }

    const descricao = normalizarDescricao(body.descricao);
    if (descricao === undefined) {
      return NextResponse.json({ error: 'descricao is too long' }, { status: 400 });
    }

    if (!ehDataValida(body.vence_em)) {
      return NextResponse.json(
        { error: 'vence_em must be a real YYYY-MM-DD date' },
        { status: 400 },
      );
    }
    const vence_em = body.vence_em;

    // ⚠️ `undefined` aqui é "malformado", não "sem hora" — ver `normalizarHora`.
    // Colapsar os dois faria uma hora digitada errado virar tarefa sem hora.
    const vence_as = normalizarHora(body.vence_as);
    if (vence_as === undefined) {
      return NextResponse.json(
        { error: 'vence_as must be HH:MM' },
        { status: 400 },
      );
    }

    const tipo = body.tipo === 'resposta' ? 'resposta' : 'tarefa';
    const paiId = body.tarefa_pai_id;
    if (paiId !== undefined && paiId !== null && !ehUuid(paiId)) {
      return NextResponse.json({ error: 'tarefa_pai_id is malformed' }, { status: 400 });
    }
    if (tipo === 'resposta' && !ehUuid(paiId)) {
      return NextResponse.json(
        { error: 'tarefa_pai_id is required for a reply' },
        { status: 400 },
      );
    }

    // ------------------------------------------------------------
    // A tarefa de origem, quando há
    //
    // ⚠️ Lida com o cliente DO USUÁRIO, sob RLS — o insert lá embaixo roda em
    // service-role e ignoraria a conta. O `.eq('account_id')` é a segunda
    // tranca, no mesmo molde da rota de anotações.
    // ------------------------------------------------------------
    let pai: TarefaPai | null = null;

    if (ehUuid(paiId)) {
      const { data } = await ctx.supabase
        .from('cb_tasks')
        .select('id, contact_id, titulo, criador_user_id')
        .eq('id', paiId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!data) {
        return NextResponse.json({ error: 'Parent task not found' }, { status: 404 });
      }
      pai = data as TarefaPai;
    }

    // ------------------------------------------------------------
    // De quem é a tarefa, e sobre quem ela fala
    // ------------------------------------------------------------
    // ⚠️ A RESPOSTA VOLTA PARA QUEM PEDIU, e o servidor decide isso — não o
    // corpo do pedido. É a regra que o operador descreveu ("a pessoa que criou
    // a tarefa para ele vai receber uma tarefa de resposta"); deixá-la na tela
    // permitiria uma "resposta" endereçada a um terceiro, que ninguém
    // reconheceria como resposta a nada.
    let responsavelId: unknown = body.responsavel_user_id;
    if (tipo === 'resposta') {
      if (!pai?.criador_user_id) {
        // Caso real, não erro do chamador: quem pediu a tarefa saiu do
        // escritório e a coluna virou NULL (ON DELETE SET NULL). Não há para
        // onde responder. Quem chama traduz este código.
        return NextResponse.json(
          { error: 'PARENT_CREATOR_GONE' },
          { status: 409 },
        );
      }
      responsavelId = pai.criador_user_id;
    }
    if (!ehUuid(responsavelId)) {
      return NextResponse.json(
        { error: 'responsavel_user_id is required' },
        { status: 400 },
      );
    }

    // ⚠️ A CADEIA INTEIRA FALA DO MESMO CLIENTE. Com pai, o contato é herdado e
    // o do corpo é ignorado: uma resposta ou um desdobramento apontando para
    // outro cliente seria um card órfão no meio de uma conversa que não é a
    // dele — e nada na tela denunciaria.
    const contactId = pai ? pai.contact_id : body.contact_id;
    if (!ehUuid(contactId)) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    // O contato é desta conta? Sob RLS, então nem a existência de cliente de
    // outro escritório vaza. Sem esta leitura, a FK composta aceitaria o par
    // (contato, conta) só se ele batesse — mas o erro chegaria como 500.
    if (!pai) {
      const { data: contato } = await ctx.supabase
        .from('contacts')
        .select('id')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!contato) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
    }

    // ------------------------------------------------------------
    // Os dois nomes, numa consulta só
    //
    // Ela faz duas coisas ao mesmo tempo: prova que o destinatário é membro
    // desta conta (motivo nº 3 de a rota existir) e traz os nomes que vão ser
    // congelados nas colunas.
    // ------------------------------------------------------------
    const { data: perfis, error: erroPerfis } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .eq('account_id', ctx.accountId)
      .in('user_id', [ctx.userId, responsavelId]);

    if (erroPerfis) {
      console.error('[POST /api/cb/tasks] falha ao ler perfis:', erroPerfis.message);
      return NextResponse.json({ error: 'Could not load members' }, { status: 500 });
    }

    // Mesma cascata do `memberLabel` e da 912: `full_name` é NOT NULL mas o
    // trigger de signup grava `COALESCE(..., '')`, então vazio é possível.
    const nomeDe = (id: string): string | null => {
      const p = (perfis ?? []).find((x) => x.user_id === id);
      const nome = (p?.full_name as string | null)?.trim();
      return nome || (p?.email as string | null) || null;
    };

    const responsavelEhMembro = (perfis ?? []).some(
      (p) => p.user_id === responsavelId,
    );
    if (!responsavelEhMembro) {
      return NextResponse.json(
        { error: 'responsavel_user_id is not a member of this account' },
        { status: 400 },
      );
    }

    // ------------------------------------------------------------
    // Grava
    // ------------------------------------------------------------
    const admin = supabaseAdmin();
    const { data: tarefa, error } = await admin
      .from('cb_tasks')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        criador_user_id: ctx.userId,
        responsavel_user_id: responsavelId,
        criador_nome: nomeDe(ctx.userId),
        responsavel_nome: nomeDe(responsavelId as string),
        titulo,
        descricao,
        vence_em,
        vence_as,
        importante: body.importante === true,
        tarefa_pai_id: pai?.id ?? null,
        // Congelado: a origem é ON DELETE SET NULL, então sem isto apagar a
        // primeira tarefa apagaria a informação de que houve origem.
        tarefa_pai_titulo: pai?.titulo ?? null,
        tipo,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[POST /api/cb/tasks] insert falhou:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ------------------------------------------------------------
    // Avisa — depois da tarefa, e sem derrubá-la se falhar
    // ------------------------------------------------------------
    // A tarefa é o ato; o sino é aviso sobre ele. Perder o aviso é chato;
    // perder a tarefa que a pessoa acabou de escrever é inaceitável. Mesma
    // política da menção (919), inclusive no motivo: o `type` novo depende
    // desta migration ter sido aplicada, que é o tipo de coisa que falta num
    // ambiente e não em outro.
    //
    // ⚠️ Tarefa para si mesmo não avisa: ninguém quer sino do que acabou de
    // escrever. Mesma regra que tira o autor da lista de mencionados.
    let avisado = true;
    if (responsavelId !== ctx.userId) {
      const autor = nomeDe(ctx.userId) ?? 'Alguém da equipe';
      const { error: erroSino } = await admin.from('notifications').insert({
        account_id: ctx.accountId,
        user_id: responsavelId,
        type: tipo === 'resposta' ? 'task_reply' : 'task_assigned',
        // ⚠️ `conversation_id` fica NULO de propósito. A página de
        // notificações navega para o inbox quando essa coluna existe — e o
        // destino desta linha é a tarefa, não o fio. Quem roteia é `task_id`.
        contact_id: contactId,
        task_id: tarefa.id,
        actor_user_id: ctx.userId,
        // Texto CRU, sem dicionário: `title`/`body` são colunas TEXT gravadas
        // no idioma de quem escreveu, igual ao trigger da 027 e à menção.
        title:
          tipo === 'resposta'
            ? `${autor} respondeu sua tarefa`
            : `${autor} encaminhou uma tarefa para você`,
        body: titulo,
      });
      if (erroSino) {
        console.error('[POST /api/cb/tasks] falha ao avisar:', erroSino.message);
        avisado = false;
      }
    }

    // 201 mesmo com o aviso falho — a tarefa existe, e é ela que importa. Mas
    // `avisado` vai junto para a tela poder dizer "criei, só não consegui
    // avisar", em vez de deixar quem delegou supondo que o colega foi chamado.
    return NextResponse.json({ task: tarefa, avisado }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
