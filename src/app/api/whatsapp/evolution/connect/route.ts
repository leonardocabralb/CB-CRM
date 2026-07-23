import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/whatsapp/encryption';
import { provisionEvolutionInstance } from '@/lib/whatsapp/transport/evolution-provision';

/**
 * POST /api/whatsapp/evolution/connect
 *
 * Provisions the account's Evolution instance: creates/adopts it, wires the
 * webhook back to this CRM, stores the connection on whatsapp_config
 * (provider='evolution', encrypted instance key), and returns the QR to
 * pair a WhatsApp number. Safe to call repeatedly — it re-adopts and
 * refreshes the QR.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      );
    }

    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return NextResponse.json(
        { error: 'EVOLUTION_WEBHOOK_SECRET is not set on the server.' },
        { status: 500 }
      );
    }

    // Evolution posts inbound events here. Prefer the canonical site URL;
    // fall back to the request origin (dev). Must be reachable by Evolution.
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ||
      new URL(request.url).origin;
    const webhookUrl = `${origin}/api/whatsapp/evolution/webhook`;

    let result;
    try {
      result = await provisionEvolutionInstance({
        accountId,
        webhook: { url: webhookUrl, secret: webhookSecret },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution error';
      console.error('[evolution/connect] provisioning failed:', message);
      return NextResponse.json(
        { error: `Evolution error: ${message}` },
        { status: 502 }
      );
    }

    // Persist the connection (one row per account — UNIQUE(account_id)).
    const row = {
      provider: 'evolution' as const,
      base_url: result.baseUrl,
      instance_name: result.instanceName,
      api_key: encrypt(result.instanceApiKey),
      instance_state: result.state,
      status: result.state === 'open' ? ('connected' as const) : ('disconnected' as const),
      connected_at: result.state === 'open' ? new Date().toISOString() : null,
      last_connected_at: result.state === 'open' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('whatsapp_config')
        .update(row)
        .eq('account_id', accountId);
      if (error) {
        console.error('[evolution/connect] update failed:', error);
        return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
      }
    } else {
      const { error } = await supabase
        .from('whatsapp_config')
        .insert({ account_id: accountId, user_id: user.id, ...row });
      if (error) {
        console.error('[evolution/connect] insert failed:', error);
        return NextResponse.json({ error: 'Failed to save connection' }, { status: 500 });
      }
    }

    return NextResponse.json({
      instance_name: result.instanceName,
      state: result.state,
      connected: result.state === 'open',
      qr: result.qrBase64 ?? null,
      pairing_code: result.pairingCode ?? null,
    });
  } catch (error) {
    console.error('[evolution/connect] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
