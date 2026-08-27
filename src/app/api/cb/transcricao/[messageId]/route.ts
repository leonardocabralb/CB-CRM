// ============================================================
// POST /api/cb/transcricao/[messageId] — o botão "Transcrever" da bolha.
//
// A rota é fina de propósito: posse pela RLS do usuário, dois rate limits
// (pessoal + conta, porque N agentes sob o limite pessoal ainda estouram
// a mesma chave BYO) e a função única `transcreverAudio`, que carrega
// todas as guardas e o cadeado. O worker do Radar chama a MESMA função.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { transcreverAudio } from '@/lib/transcricao/transcrever';

export const maxDuration = 60;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const pessoal = checkRateLimit(
      `cb:transcricao:${ctx.userId}`,
      RATE_LIMITS.transcricao,
    );
    if (!pessoal.success) return rateLimitResponse(pessoal);
    const daConta = checkRateLimit(
      `cb:transcricaoConta:${ctx.accountId}`,
      RATE_LIMITS.transcricaoConta,
    );
    if (!daConta.success) return rateLimitResponse(daConta);

    const { messageId } = await params;

    // Posse pela RLS do pedido: se o cliente do usuário não enxerga a
    // mensagem, ela não é da conta dele e acaba aqui — o service-role só
    // entra depois.
    const { data: msg } = await ctx.supabase
      .from('messages')
      .select('id')
      .eq('id', messageId)
      .maybeSingle();
    if (!msg) {
      return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
    }

    const resultado = await transcreverAudio(admin(), {
      accountId: ctx.accountId,
      messageId,
    });
    return NextResponse.json(resultado);
  } catch (error) {
    return toErrorResponse(error);
  }
}
