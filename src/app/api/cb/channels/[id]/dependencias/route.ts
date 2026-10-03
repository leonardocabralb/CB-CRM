// ============================================================
// GET /api/cb/channels/[id]/dependencias — o que depende desta conexão.
//
// A tela de remover mostra a lista ANTES do clique (03/10/2026): automações,
// robôs, agentes de IA, filtros salvos, execuções em andamento, conversas e
// agendadas. A classificação é de `src/lib/cb-channels/dependencias.ts`.
//
// Admin, como o DELETE. Lê em SERVICE ROLE, sempre cercado pela conta: os
// filtros salvos são de CADA membro (pela sessão, a RLS mostraria só os do
// admin) e a fila das automações é service-role only — pela sessão, as duas
// voltariam zero com cara de certo.
//
// ⚠️ Leitura que falha é 500, nunca uma lista menor: "nada depende" sobre uma
// leitura que falhou levaria o operador a remover achando que nada quebra.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  automacoesQueDependem,
  ordemDaLista,
  robosQueDependem,
  type DependenciasDaConexao,
} from '@/lib/cb-channels/dependencias';
import { lerFiltroSalvo } from '@/lib/inbox/filtros-salvos';
import { buscarPaginado, type RespostaDaPagina } from '@/lib/supabase/paginar';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids por `.in()`: a URL tem teto, e uma conta grande passaria dele. */
const FATIA = 100;

class LeituraFalhou extends Error {}

function fatias<T>(lista: T[]): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += FATIA) saida.push(lista.slice(i, i + FATIA));
  return saida;
}

/** A coleção inteira (o PostgREST corta em mil sem avisar), ou lança. */
async function todas<T>(
  oQue: string,
  pagina: (de: number, ate: number) => PromiseLike<RespostaDaPagina<T>>,
): Promise<T[]> {
  const r = await buscarPaginado(pagina);
  if (!r.linhas) throw new LeituraFalhou(`${oQue}: ${r.erro?.message ?? r.motivo}`);
  return r.linhas;
}

/** A contagem de uma consulta `head`, ou lança. */
function contagem(oQue: string, r: { count: number | null; error: { message: string } | null }): number {
  if (r.error) throw new LeituraFalhou(`${oQue}: ${r.error.message}`);
  return r.count ?? 0;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'invalid_channel' }, { status: 400 });
    }
    const conta = ctx.accountId;
    const db = supabaseAdmin();

    // A conexão é DESTA conta? Sem isto, o id de outra conta viraria um
    // oráculo das contagens dela.
    const { data: canal, error: canalErr } = await db
      .from('cb_channels')
      .select('id')
      .eq('id', id)
      .eq('account_id', conta)
      .maybeSingle();
    if (canalErr) throw new LeituraFalhou(`conexão: ${canalErr.message}`);
    if (!canal) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const automacoes = await todas<{
      id: string;
      name: string | null;
      is_active: boolean | null;
      channel_ids: string[] | null;
    }>('automações', (de, ate) =>
      db
        .from('automations')
        .select('id, name, is_active, channel_ids', { count: 'exact' })
        .eq('account_id', conta)
        .order('id')
        .range(de, ate),
    );
    const passos: { automation_id: string; step_config: unknown }[] = [];
    for (const ids of fatias(automacoes.map((a) => a.id))) {
      passos.push(
        ...(await todas<{ automation_id: string; step_config: unknown }>('passos', (de, ate) =>
          db
            .from('automation_steps')
            .select('automation_id, step_config', { count: 'exact' })
            .in('automation_id', ids)
            .order('id')
            .range(de, ate),
        )),
      );
    }

    const robos = await todas<{
      id: string;
      name: string | null;
      status: string | null;
      channel_id: string | null;
    }>('robôs', (de, ate) =>
      db
        .from('flows')
        .select('id, name, status, channel_id', { count: 'exact' })
        .eq('account_id', conta)
        .order('id')
        .range(de, ate),
    );
    const nos: { flow_id: string; config: unknown }[] = [];
    for (const ids of fatias(robos.map((r) => r.id))) {
      nos.push(
        ...(await todas<{ flow_id: string; config: unknown }>('nós dos robôs', (de, ate) =>
          db
            .from('flow_nodes')
            .select('flow_id, config', { count: 'exact' })
            .in('flow_id', ids)
            .order('id')
            .range(de, ate),
        )),
      );
    }

    const agentes = await todas<{ id: string; nome: string | null; ativo: boolean | null }>(
      'agentes de IA',
      (de, ate) =>
        db
          .from('cb_ia_agentes')
          .select('id, nome, ativo', { count: 'exact' })
          .eq('account_id', conta)
          .is('arquivado_em', null)
          .contains('conexoes', [id])
          .order('id')
          .range(de, ate),
    );

    // Os filtros salvos pela MESMA leitura da caixa de entrada
    // (`lerFiltroSalvo`): ela aceita o formato antigo (`canalId`, uma conexão
    // só) além de `canalIds` — contar só a lista esqueceria os antigos.
    const filtrosSalvos = await todas<{ filtros: unknown }>('filtros salvos', (de, ate) =>
      db
        .from('cb_inbox_saved_filters')
        .select('filtros', { count: 'exact' })
        .eq('account_id', conta)
        .order('id')
        .range(de, ate),
    );

    const [esperas, conversas, fixadas, agendadas, modelos, grupos] = await Promise.all([
      db
        .from('automation_pending_executions')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', conta)
        .eq('status', 'pending')
        .eq('context->>channel_id', id),
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', conta)
        .eq('channel_id', id),
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', conta)
        .eq('channel_id', id)
        .eq('channel_pinned', true),
      db
        .from('cb_scheduled_messages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', conta)
        .eq('channel_id', id)
        .in('status', ['pending', 'sending']),
      db
        .from('message_templates')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', conta)
        .eq('channel_id', id),
      db
        .from('cb_groups')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', conta)
        .eq('channel_id', id),
    ]);

    const resposta: DependenciasDaConexao = {
      ...automacoesQueDependem(id, automacoes, passos),
      ...robosQueDependem(id, robos, nos),
      agentes: agentes
        .map((a) => ({ id: a.id, nome: a.nome ?? '', ativo: a.ativo === true }))
        .sort(ordemDaLista),
      filtrosSalvos: filtrosSalvos.filter((f) => lerFiltroSalvo(f.filtros).canalIds.includes(id)).length,
      esperas: contagem('execuções em andamento', esperas),
      conversas: contagem('conversas', conversas),
      conversasFixadas: contagem('conversas fixadas', fixadas),
      agendadasNaFila: contagem('agendadas', agendadas),
      modelos: contagem('modelos', modelos),
      grupos: contagem('grupos', grupos),
    };
    return NextResponse.json(resposta);
  } catch (err) {
    if (err instanceof LeituraFalhou) {
      console.error('[cb/channels dependencias] leitura falhou:', err.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
