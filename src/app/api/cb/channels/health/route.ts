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
//
// ⚠️ A service role entra só para ler o estado dos alarmes do sino (1122), que
// o botão das conexões mostra (E1) e que é fechado ao navegador: a leitura é
// cercada pela conta da sessão (`ctx.accountId`), e a sonda em si continua
// com o cliente da pessoa.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { probeChannels } from '@/lib/cb-channels/health';

/** A tela pede a cada 30s; 40/min cobre várias abas e o refetch no foco. */
const HEALTH_LIMIT = { limit: 40, windowMs: 60_000 };

/**
 * ⚠️ Sem a service role no contêiner (o deploy sem o `crm.env`), o cliente
 * LANÇA ao nascer: a sonda segue sem os episódios, porque a trava do
 * compositor depende dela (`canal-na-conversa.md`).
 */
function clienteDosAlarmes(): SupabaseClient | null {
  try {
    return supabaseAdmin();
  } catch (err) {
    console.warn(
      '[cb/channels/health] sem a service role, sem os episódios do sino:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(`cb:channelHealth:${ctx.userId}`, HEALTH_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    let channels;
    try {
      channels = await probeChannels(ctx.supabase, ctx.accountId, clienteDosAlarmes());
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
