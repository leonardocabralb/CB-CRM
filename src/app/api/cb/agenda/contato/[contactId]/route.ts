import { NextResponse } from 'next/server';

import { montarReunioesExternas, type LinhaDaKommo, type LinhaDoCalendly } from '@/lib/agenda/reunioes-externas';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cb/agenda/contato/[contactId] — as reuniões do cliente que não
 * moram na agenda do CRM: os agendamentos do Calendly e a última reunião da
 * Kommo. `{ reunioes: ReuniaoExterna[] }`, do mais recente para o mais antigo.
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

    return NextResponse.json({
      reunioes: montarReunioesExternas(linhas, cancelados, (kommo.data ?? []) as LinhaDaKommo[]),
    });
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      console.error('[agenda/contato] leitura falhou:', err.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
