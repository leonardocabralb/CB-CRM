import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { carregarDadosDaPauta, instanteDoParametro } from '@/lib/reunioes/carregar';
import { montarPauta } from '@/lib/reunioes/montar';

/** A janela mais larga que a tela pede: a semana à vista + os 30 dias da rede de segurança. */
const JANELA_MAXIMA_MS = 120 * 24 * 60 * 60_000;

/**
 * GET /api/cb/reunioes?de=<ISO>&ate=<ISO> — a pauta de reuniões da tela
 * `/reunioes` (plano: `docs/PLANO-pauta-de-reunioes.md`): as reuniões do
 * Calendly e da agenda do CRM que começam na janela (a do Calendly na data da
 * ficha, quando a ficha a remarcou), cada uma com o contato, a
 * conversa, o card, o que o formulário deixou na ficha (dívida, atraso,
 * origem), se foi marcada qualificada, o resultado e se o lead já faltou antes.
 * Mais, por funil, para qual etapa cada botão leva o card.
 *
 * ⚠️ Por ROTA porque `cb_calendly_eventos` é fechada ao navegador (guarda
 * telefone, e-mail e as respostas do formulário): do cliente devolveria vazio
 * com `error: null`, e a tela afirmaria "nenhuma reunião". Daqui sai só o que
 * a tela mostra.
 *
 * Qualquer membro lê; o recorte por funil do perfil é feito na tela (a mesma
 * régua do painel da conversa, `funilNoEscopo`). Toda consulta leva
 * `account_id`. Erro de leitura é 500, nunca lista vazia.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`cb:reunioes:${ctx.userId}`, RATE_LIMITS.pautaDeReunioes);
    if (!limit.success) return rateLimitResponse(limit);

    const url = new URL(request.url);
    const de = instanteDoParametro(url.searchParams.get('de'));
    const ate = instanteDoParametro(url.searchParams.get('ate'));
    if (!de || !ate || ate <= de || ate.getTime() - de.getTime() > JANELA_MAXIMA_MS) {
      return NextResponse.json({ error: 'janela_invalida' }, { status: 400 });
    }

    // A carga (`carregar.ts`) é a mesma do resumo do Desempenho: as duas
    // telas veem as mesmas reuniões, com o mesmo resultado.
    const dados = await carregarDadosDaPauta(supabaseAdmin(), ctx.accountId, { de, ate });
    return NextResponse.json(montarPauta(dados));
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      console.error('[reunioes] leitura falhou:', err.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
