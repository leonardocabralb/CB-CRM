// ============================================================
// /api/cb/channels/[id]
//
//   PATCH  — renomear o canal.
//   DELETE — remover o canal (e sua instância no servidor Evolution).
//
// Ambos admin+. O canal PADRÃO não pode ser excluído aqui (é o espelho de
// whatsapp_config que o código herdado lê) — promova outro canal primeiro,
// via POST /api/cb/channels/[id]/default.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  getChannelWithSecrets,
  CB_CHANNEL_SAFE_COLUMNS,
} from '@/lib/cb-channels/repo';
import { deleteChannelInstance } from '@/lib/cb-channels/evolution-admin';
import { setDefaultChannel } from '@/lib/cb-channels/set-default';

const MAX_LABEL_LEN = 60;

/** String vazia e `null` viram `null` (= "sem funil"); resto passa como veio. */
function asUuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:channelUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      label?: unknown;
      default_pipeline_id?: unknown;
      default_stage_id?: unknown;
      groups_enabled?: unknown;
      radar_enabled?: unknown;
    } | null;
    const label = typeof body?.label === 'string' ? body.label.trim() : '';

    if (!label) {
      return NextResponse.json({ error: 'O nome do canal não pode ficar vazio.' }, { status: 400 });
    }
    if (label.length > MAX_LABEL_LEN) {
      return NextResponse.json(
        { error: `O nome do canal deve ter no máximo ${MAX_LABEL_LEN} caracteres.` },
        { status: 400 },
      );
    }

    // Funil padrão. Só entra no UPDATE quando a chave veio no corpo — assim
    // um PATCH que só renomeia (o comportamento antigo, e o que outras telas
    // fazem) não apaga o roteamento sem querer.
    const patch: Record<string, unknown> = { label };
    if ('default_pipeline_id' in (body ?? {})) {
      const pipelineId = asUuidOrNull(body?.default_pipeline_id);
      const stageId = asUuidOrNull(body?.default_stage_id);

      if (pipelineId) {
        // ⚠️ O `.eq('account_id')` do UPDATE protege QUAL LINHA muda, não o
        // VALOR do campo. A FK composta da 908 barraria um funil de outra
        // conta no banco, mas com um 23503 cru; aqui o erro é legível.
        const { data: funil, error: funilErr } = await ctx.supabase
          .from('pipelines')
          .select('id')
          .eq('id', pipelineId)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (funilErr) {
          console.error('[cb/channels PATCH] leitura do funil falhou:', funilErr.message);
          return NextResponse.json({ error: 'Falha ao atualizar o canal.' }, { status: 500 });
        }
        if (!funil) {
          return NextResponse.json({ error: 'Funil não encontrado nesta conta.' }, { status: 400 });
        }

        if (stageId) {
          const { data: etapa, error: etapaErr } = await ctx.supabase
            .from('pipeline_stages')
            .select('id')
            .eq('id', stageId)
            .eq('pipeline_id', pipelineId)
            .maybeSingle();
          // "Não consegui ler" ≠ "não pertence ao funil". Sem esta distinção
          // uma queda momentânea do PostgREST acusa erro de configuração do
          // operador, e ele vai mexer no que estava certo.
          if (etapaErr) {
            console.error('[cb/channels PATCH] leitura da etapa falhou:', etapaErr.message);
            return NextResponse.json({ error: 'Falha ao atualizar o canal.' }, { status: 500 });
          }
          if (!etapa) {
            return NextResponse.json(
              { error: 'A etapa escolhida não pertence a esse funil.' },
              { status: 400 },
            );
          }
        }
      }

      patch.default_pipeline_id = pipelineId;
      // Sem funil não há etapa. Zerar junto é obrigatório: a FK composta
      // (default_stage_id, default_pipeline_id) rejeitaria o par órfão.
      patch.default_stage_id = pipelineId ? stageId : null;
    }

    // Grupos de WhatsApp neste número (906). Mesma disciplina do funil: só
    // entra no UPDATE quando a chave veio no corpo, senão um PATCH que apenas
    // renomeia desligaria os grupos sem querer.
    //
    // ⚠️ LIGAR NÃO BASTA. A instância que já está conectada só passa a receber
    // os eventos de grupo depois que o webhook é reaplicado — o que acontece
    // pelo botão "Ressincronizar" do painel de conexões. Sem isso, mensagem de
    // grupo chega mas aviso de entrada/saída não.
    if ('groups_enabled' in (body ?? {})) {
      patch.groups_enabled = body?.groups_enabled === true;
    }

    // Radar de Atendimento neste número (941). Mesma disciplina: a chave
    // presente é o que autoriza mexer. `=== true` fecha o padrão em
    // DESLIGADO — este interruptor manda conversa de cliente para um
    // provedor de IA, e ligar tem de ser um ato, nunca um efeito.
    if ('radar_enabled' in (body ?? {})) {
      patch.radar_enabled = body?.radar_enabled === true;
    }

    const { data, error } = await ctx.supabase
      .from('cb_channels')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(CB_CHANNEL_SAFE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[cb/channels PATCH] erro:', error.message);
      return NextResponse.json({ error: 'Falha ao atualizar o canal.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ channel: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:channelDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const channel = await getChannelWithSecrets(ctx.supabase, ctx.accountId, id);
    if (!channel) {
      return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 });
    }

    // ---- Mensagens agendadas nesta conexão (925) ----
    //
    // ⚠️ TEM de vir ANTES de qualquer passo destrutivo. A FK
    // `cb_scheduled_messages_canal_fkey` é RESTRICT, então o DELETE lá
    // embaixo estouraria de qualquer forma — mas àquela altura a instância
    // da Evolution já foi destruída e o canal padrão já foi promovido. O
    // operador ficaria com a conta remexida e um erro de banco cru na tela.
    //
    // Só a FILA barra. Enviadas e falhadas são acervo, e são apagadas junto
    // com a conexão logo abaixo — a mensagem em si continua em `messages`.
    const { count: naFila, error: filaErr } = await ctx.supabase
      .from('cb_scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel_id', id)
      .eq('account_id', ctx.accountId)
      .in('status', ['pending', 'sending']);

    if (filaErr) {
      console.error('[cb/channels DELETE] contagem de agendadas falhou:', filaErr.message);
      return NextResponse.json({ error: 'Falha ao remover o canal.' }, { status: 500 });
    }
    if ((naFila ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Há ${naFila} mensagem(ns) agendada(s) para sair por esta conexão. Envie ou cancele essas mensagens antes de removê-la.`,
          code: 'scheduled_pending',
        },
        { status: 409 },
      );
    }

    /** Espelho whatsapp_config ficou para trás na promoção do sucessor. */
    let mirrorWarning: string | null = null;

    // ---- Canal PADRÃO: precisa de sucessor NOMEADO ----
    //
    // Antes daqui saía um 400 seco e a UI nem mostrava o botão, então numa
    // conta de uma conexão só (todas, hoje) excluir era simplesmente
    // impossível. Mas promover outro canal em silêncio é pior: `whatsapp_config`
    // é o espelho que broadcast, modelos, proxy de mídia e a API v1 leem, e o
    // operador que clicou em "excluir Bancário" veria o escritório começar a
    // disparar pelo Trabalhista sem nunca ter pedido isso.
    //
    // Então o sucessor vem no corpo, escolhido na tela.
    if (channel.is_default) {
      const body = (await request.json().catch(() => null)) as {
        promote_to?: unknown;
      } | null;
      const promoteTo =
        typeof body?.promote_to === 'string' && body.promote_to.trim()
          ? body.promote_to.trim()
          : null;

      const { data: outros, error: outrosErr } = await ctx.supabase
        .from('cb_channels')
        .select('id')
        .eq('account_id', ctx.accountId)
        .neq('id', id);

      if (outrosErr) {
        console.error('[cb/channels DELETE] contagem falhou:', outrosErr.message);
        return NextResponse.json({ error: 'Falha ao remover o canal.' }, { status: 500 });
      }

      // Única conexão da conta. Apagar aqui deixaria o CRM mudo, e na prática
      // quem clica nisso está tentando CONSERTAR, não desligar o WhatsApp.
      if ((outros ?? []).length === 0) {
        return NextResponse.json(
          {
            error:
              'Esta é a única conexão da conta. Apagá-la deixaria o CRM sem WhatsApp. Use "Reparear" para reconectar o número.',
            code: 'last_channel',
          },
          { status: 409 },
        );
      }

      if (!promoteTo) {
        return NextResponse.json(
          {
            error: 'Escolha qual conexão passa a ser a padrão antes de remover esta.',
            code: 'needs_successor',
          },
          { status: 400 },
        );
      }
      if (!(outros ?? []).some((c) => c.id === promoteTo)) {
        return NextResponse.json(
          { error: 'A conexão escolhida para virar padrão não existe nesta conta.' },
          { status: 400 },
        );
      }

      // Promove ANTES de apagar. Se falhar, nada é removido — a conta fica
      // exatamente como estava, e o operador lê o motivo.
      const promocao = await setDefaultChannel(
        ctx.supabase,
        ctx.accountId,
        ctx.userId,
        promoteTo,
      );
      if (!promocao.ok) {
        return NextResponse.json({ error: promocao.message }, { status: 400 });
      }
      // ⚠️ `ok: true` com aviso é SUCESSO PARCIAL: o flag `is_default` trocou
      // mas o espelho `whatsapp_config` não. Engolir isto aqui é pior que na
      // rota de promoção, porque logo abaixo a credencial do canal antigo é
      // destruída — o espelho ficaria apontando para uma conexão que não
      // existe mais, e disparos/modelos/API sairiam por ela.
      mirrorWarning = promocao.mirrorWarning;
    }

    // Remove a instância no servidor ANTES de apagar a linha (depois
    // perderíamos as credenciais). Erros são engolidos na função.
    if (channel.kind === 'evolution' && channel.instance_name) {
      await deleteChannelInstance(channel.instance_name);
    }

    // Solta o pino ANTES de apagar. A FK é ON DELETE SET NULL, então depois do
    // delete a conversa fica com channel_id=NULL e channel_pinned=true — um
    // estado morto: followConversationChannel só move conversa com
    // channel_pinned=false, então ela nunca mais seria apontada para nenhum
    // canal. Depois do delete também não daria para encontrá-las (o
    // channel_id já teria virado NULL). Best-effort: não bloqueia a remoção.
    const { error: unpinError } = await ctx.supabase
      .from('conversations')
      .update({ channel_pinned: false })
      .eq('channel_id', id)
      .eq('account_id', ctx.accountId);
    if (unpinError) {
      console.warn(
        '[cb/channels DELETE] falha ao soltar o pino das conversas:',
        unpinError.message,
      );
    }

    // Acervo de agendadas desta conexão. A FK é RESTRICT — a fila já foi
    // barrada lá em cima, e o que sobrou (enviadas/falhadas) é registro de
    // fila, não a mensagem: essa continua em `messages`. Apagar aqui, de
    // forma explícita, é o que permite RESTRICT ser a garantia forte para a
    // fila sem tornar a conexão indelével para sempre.
    const { error: acervoErr } = await ctx.supabase
      .from('cb_scheduled_messages')
      .delete()
      .eq('channel_id', id)
      .eq('account_id', ctx.accountId)
      // ⚠️ SÓ o acervo. Sem este filtro, uma agendada criada entre a
      // contagem lá em cima e este delete — janela real, porque no meio
      // acontecem a destruição da instância Evolution e a promoção do canal
      // padrão — seria apagada em silêncio. Com ele, a FK RESTRICT estoura e
      // a corrida aparece, que é exatamente para isso que ela foi escolhida.
      .in('status', ['sent', 'failed']);
    if (acervoErr) {
      console.error('[cb/channels DELETE] acervo de agendadas:', acervoErr.message);
      return NextResponse.json({ error: 'Falha ao remover o canal.' }, { status: 500 });
    }

    const { error } = await ctx.supabase
      .from('cb_channels')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[cb/channels DELETE] erro:', error.message);
      return NextResponse.json({ error: 'Falha ao remover o canal.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, warning: mirrorWarning });
  } catch (err) {
    return toErrorResponse(err);
  }
}
