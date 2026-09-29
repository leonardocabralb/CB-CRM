// ============================================================
// GET /api/automations/previa?contato=<id> — os valores das variáveis de um
// cliente, para a PRÉVIA do construtor (seletor de variáveis, 29/09/2026).
// Admin+.
//
// Só LEITURA, pelas MESMAS funções do envio (`valoresParaPrevia`, no motor):
// a prévia não tem cópia das regras de formatação, então não diverge do que
// sai para o cliente.
//
// ⚠️ Admin, e não "qualquer membro": a leitura é em service role e passaria
// por cima do escopo de conversas de um perfil de acesso; editar automação já
// é de admin (a automação é da CONTA).
// ⚠️ O contato é conferido pela CONTA antes de tudo: o motor recorta cada
// leitura pela conta, mas um id alheio voltaria "tudo vazio" com cara de
// certo. Falha de leitura é 500, nunca `{}`.
// ⚠️ Nada é registrado — nem em log de erro: o valor de um campo pode ser a
// senha do gov.br.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { valoresParaPrevia } from '@/lib/automations/engine';
import { CODIGOS_DO_CLIENTE } from '@/lib/automations/variaveis/catalogo';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limite = checkRateLimit(`automations:previa:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limite.success) return rateLimitResponse(limite);

    const contatoId = new URL(request.url).searchParams.get('contato') ?? '';
    if (!UUID.test(contatoId)) {
      return NextResponse.json({ error: 'contato_invalido' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
      .from('contacts')
      .select('id')
      .eq('id', contatoId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error('[automations/previa] conferir o contato:', error.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    // Quantos cards o cliente tem: nos gatilhos que trazem o card do evento,
    // com mais de um a prévia de `{{deal.*}}` pode ser de OUTRO card, e a tela
    // avisa. Falha de leitura é 500, como o resto.
    const { count: negocios, error: erroDosNegocios } = await supabaseAdmin()
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contatoId);
    if (erroDosNegocios) {
      console.error('[automations/previa] contar os cards:', erroDosNegocios.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    let valores: Awaited<ReturnType<typeof valoresParaPrevia>>;
    try {
      // Modo estrito: leitura que falha LANÇA — a prévia nunca diz "vazio"
      // sobre um campo que ela não conseguiu ler.
      valores = await valoresParaPrevia({
        accountId: ctx.accountId,
        contactId: contatoId,
        codigos: CODIGOS_DO_CLIENTE,
      });
    } catch (err) {
      // Só a mensagem do banco — nunca um valor de campo.
      console.error('[automations/previa] leitura:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return NextResponse.json(
      { valores, negocios: negocios ?? 0 },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
