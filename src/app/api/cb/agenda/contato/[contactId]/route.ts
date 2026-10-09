import { NextResponse } from 'next/server';

import { avisoDeNoShow, type EntradaNaEtapa } from '@/lib/agenda/aviso-de-no-show';
import { montarReunioesExternas, type LinhaDaKommo, type LinhaDoCalendly } from '@/lib/agenda/reunioes-externas';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { marcoValeParaAReuniao, type LinhaDoMarco } from '@/lib/reunioes/pauta';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cb/agenda/contato/[contactId] — as reuniões do cliente que não
 * moram na agenda do CRM: os agendamentos do Calendly e a última reunião da
 * Kommo. `{ reunioes: ReuniaoExterna[], aviso: AvisoDeNoShow | null }`, as
 * reuniões do mais recente para o mais antigo; o aviso de possível no-show
 * (`aviso-de-no-show.ts`) é o que a faixa da conversa mostra.
 *
 * ⚠️ Por ROTA porque `cb_calendly_eventos` e `cb_reunioes_da_kommo` são
 * fechadas ao navegador: do cliente devolveriam vazio com `error: null`, e a
 * aba afirmaria "nenhuma reunião". Daqui sai só data, evento, link e
 * situação — nunca telefone, e-mail ou as respostas do formulário, que a
 * tabela do Calendly também guarda.
 *
 * Qualquer membro lê (é a mesma aba que mostra a agenda). Contato de outra
 * conta não acha nada: toda consulta leva `account_id`. Erro de leitura é
 * 500, nunca lista vazia.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`cb:agenda:contato:${ctx.userId}`, RATE_LIMITS.reunioesDoContato);
    if (!limit.success) return rateLimitResponse(limit);

    const { contactId } = await params;
    if (!UUID.test(contactId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const admin = supabaseAdmin();
    const [agendamentos, kommo] = await Promise.all([
      admin
        .from('cb_calendly_eventos')
        .select(
          'id, invitee_uri, event_type_uri, event_type_nome, inicio, fim, link, recebido_em, situacao:variaveis->>agendamento_situacao',
        )
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .eq('evento', 'invitee.created'),
      admin
        .from('cb_reunioes_da_kommo')
        .select('id, reuniao_em, link, marcou_onde')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId),
    ]);
    if (agendamentos.error) throw new Error(`calendly: ${agendamentos.error.message}`);
    if (kommo.error) throw new Error(`kommo: ${kommo.error.message}`);

    const linhas = (agendamentos.data ?? []) as LinhaDoCalendly[];

    // O cancelamento é outra linha do MESMO convite (`evento` difere). Pelo
    // convite, e não pelo contato: o cancelamento que falhou antes de achar o
    // contato fica sem `contact_id`, e o convite continua cancelado.
    let cancelados = new Set<string>();
    if (linhas.length > 0) {
      const { data, error } = await admin
        .from('cb_calendly_eventos')
        .select('invitee_uri')
        .eq('account_id', ctx.accountId)
        .eq('evento', 'invitee.canceled')
        .in(
          'invitee_uri',
          linhas.map((l) => l.invitee_uri),
        );
      if (error) throw new Error(`cancelamentos: ${error.message}`);
      cancelados = new Set((data ?? []).map((l) => l.invitee_uri as string));
    }

    const reunioes = montarReunioesExternas(linhas, cancelados, (kommo.data ?? []) as LinhaDaKommo[]);

    // O aviso de possível no-show (Fase 2): a agenda do CRM, as entradas do
    // card em etapas (a trilha, com a Kommo inclusive) e o valor dos cards.
    // `status_changed` fica de fora: ele repete a etapa em que o card JÁ
    // estava, não é entrada.
    const [agenda, trilha, comValor] = await Promise.all([
      admin
        .from('cb_meetings')
        .select('id, starts_at, ends_at, status, created_at')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId),
      admin
        .from('cb_lead_events')
        .select('occurred_at, to_stage_id, to_stage_label')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .in('event_type', ['stage_changed', 'deal_created', 'pipeline_changed'])
        .not('to_stage_id', 'is', null),
      admin
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contactId)
        .gt('value', 0),
    ]);
    if (agenda.error) throw new Error(`agenda: ${agenda.error.message}`);
    if (trilha.error) throw new Error(`trilha: ${trilha.error.message}`);
    if (comValor.error) throw new Error(`valor: ${comValor.error.message}`);

    const entradasCruas = (trilha.data ?? []) as { occurred_at: string; to_stage_id: string; to_stage_label: string | null }[];
    // O degrau e a marcação de HOJE de cada etapa. `pipeline_stages` não tem
    // `account_id`: a cerca é pelo funil (`!inner`, senão a linha voltaria
    // com o embutido nulo em vez de sumir) — a mesma forma, sem apelido, de
    // `/api/cb/execucoes` e das ferramentas dos agentes de IA.
    const idsDasEtapas = [...new Set(entradasCruas.map((e) => e.to_stage_id))];
    const etapas = new Map<string, { degrau: string | null; desfecho: EntradaNaEtapa['desfecho'] }>();
    if (idsDasEtapas.length > 0) {
      const { data, error } = await admin
        .from('pipeline_stages')
        .select('id, degrau, desfecho_da_reuniao, pipelines!inner(account_id)')
        .in('id', idsDasEtapas)
        .eq('pipelines.account_id', ctx.accountId);
      if (error) throw new Error(`etapas: ${error.message}`);
      for (const e of (data ?? []) as { id: string; degrau: string | null; desfecho_da_reuniao: string | null }[]) {
        const d = e.desfecho_da_reuniao;
        etapas.set(e.id, {
          degrau: e.degrau,
          desfecho: d === 'compareceu' || d === 'faltou' || d === 'reagendar' ? d : null,
        });
      }
    }

    // O "Reagendar" da pauta (1081): a reunião que terminou nele não conta
    // como reunião anterior (D2 de `docs/PLANO-reagendamento.md`). Só o
    // Calendly e a agenda do CRM têm marco; a Kommo, nunca. O marco vale para
    // a reunião pela MESMA régua da pauta (`marcoValeParaAReuniao`): o
    // Reagendar gravado para um horário não resolve o horário novo.
    const linhasDaAgenda = (agenda.data ?? []) as { id: string; starts_at: string; ends_at: string; status: string; created_at: string }[];
    // Quando cada agendamento do Calendly chegou: fecha a janela da entrada em
    // "Reagendar" da reunião anterior (`avisoDeNoShow`).
    const recebidoEm = new Map(linhas.map((l) => [l.id, l.recebido_em]));
    const idsDasReunioes = [...reunioes.filter((r) => r.origem === 'calendly').map((r) => r.id), ...linhasDaAgenda.map((m) => m.id)];
    let reagendamentos: Pick<LinhaDoMarco, 'origem' | 'reuniao_id' | 'resultado' | 'registrado_em' | 'inicio'>[] = [];
    if (idsDasReunioes.length > 0) {
      const { data, error } = await admin
        .from('cb_reunioes_marcos')
        .select('origem, reuniao_id, resultado, registrado_em, inicio')
        .eq('account_id', ctx.accountId)
        .eq('marco', 'resultado')
        .eq('resultado', 'reagendar')
        .in('reuniao_id', idsDasReunioes);
      if (error) throw new Error(`marcos: ${error.message}`);
      reagendamentos = (data ?? []) as typeof reagendamentos;
    }
    const reagendada = (origem: LinhaDoMarco['origem'], id: string, inicio: string) =>
      reagendamentos.some((m) => m.origem === origem && m.reuniao_id === id && marcoValeParaAReuniao(m, inicio));

    const aviso = avisoDeNoShow({
      reunioes: [
        ...reunioes.map((r) => ({
          inicio: r.inicio,
          fim: r.fim,
          desmarcada: r.desmarcada !== null,
          desfecho: null,
          reagendada: r.origem === 'calendly' && reagendada('calendly', r.id, r.inicio),
          agendadaEm: r.origem === 'calendly' ? (recebidoEm.get(r.id) ?? null) : null,
        })),
        ...linhasDaAgenda.map((m) => ({
          inicio: m.starts_at,
          fim: m.ends_at,
          desmarcada: m.status === 'cancelada',
          desfecho: m.status === 'falta' ? ('faltou' as const) : m.status === 'realizada' ? ('compareceu' as const) : null,
          reagendada: reagendada('agenda', m.id, m.starts_at),
          agendadaEm: m.created_at,
        })),
      ],
      entradas: entradasCruas.map((e) => ({
        em: e.occurred_at,
        etapa: e.to_stage_label,
        degrau: etapas.get(e.to_stage_id)?.degrau ?? null,
        desfecho: etapas.get(e.to_stage_id)?.desfecho ?? null,
      })),
      temValorNoCard: (comValor.count ?? 0) > 0,
      agora: new Date(),
    });

    return NextResponse.json({ reunioes, aviso });
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      console.error('[agenda/contato] leitura falhou:', err.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
