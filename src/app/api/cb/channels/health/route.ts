// ============================================================
// GET /api/cb/channels/health — saúde das conexões, para o cabeçalho.
//
// Qualquer MEMBRO (viewer+), não só admin: quem mais sofre com o WhatsApp
// caído é o atendente, e ele precisa saber antes de digitar uma resposta que
// não vai sair. Os campos devolvidos são os que ele já vê no painel de
// Conexões (nome, telefone, estado) — nenhum segredo passa por aqui.
//
// A sonda faz chamada externa, então tem cache + single-flight do lado do
// `health.ts` e rate limit aqui: dez abas atualizando juntas não viram dez
// requisições ao servidor Evolution.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { probeChannels } from '@/lib/cb-channels/health';

/** A tela pede a cada 30s; 40/min cobre várias abas e o refetch no foco. */
const HEALTH_LIMIT = { limit: 40, windowMs: 60_000 };

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(`cb:channelHealth:${ctx.userId}`, HEALTH_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    let channels;
    try {
      channels = await probeChannels(ctx.supabase, ctx.accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Janela pré-migration (coluna last_checked_at ausente) ou tabela que
      // ainda não existe: o cabeçalho some, em vez de piscar erro em toda
      // navegação. Mesmo contrato do GET /api/cb/channels.
      if (/cb_channels|last_checked_at|does not exist|42P01|42703/i.test(message)) {
        console.warn('[cb/channels/health] indisponível:', message);
        return NextResponse.json(
          { channels: [], unavailable: true },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }
      throw err;
    }

    return NextResponse.json(
      { channels },
      // Saúde com cache de CDN seria pior que não ter saúde nenhuma.
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
