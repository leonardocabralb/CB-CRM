import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { evolutionConnectionState } from '@/lib/whatsapp/transport/evolution-provision';

/**
 * GET /api/whatsapp/evolution/state
 *
 * Polls the account's Evolution instance connection state and mirrors it
 * onto whatsapp_config. The connect page calls this on an interval while a
 * QR is on screen; once `state === 'open'` the number is paired. Returns a
 * fresh QR while still pairing so the UI can refresh it as it rotates.
 */
export async function GET() {
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
      return NextResponse.json({ error: 'No account.' }, { status: 403 });
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('instance_name, provider')
      .eq('account_id', accountId)
      .maybeSingle();

    if (!config || config.provider !== 'evolution' || !config.instance_name) {
      return NextResponse.json(
        { connected: false, state: 'close', reason: 'not_configured' },
        { status: 200 }
      );
    }

    let state: 'open' | 'connecting' | 'close';
    let qr: string | undefined;
    try {
      const res = await evolutionConnectionState(config.instance_name);
      state = res.state;
      qr = res.qrBase64;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution error';
      console.error('[evolution/state] failed:', message);
      return NextResponse.json(
        { connected: false, state: 'close', reason: 'evolution_error', message },
        { status: 200 }
      );
    }

    // Mirror the live state onto the row.
    await supabase
      .from('whatsapp_config')
      .update({
        instance_state: state,
        status: state === 'open' ? 'connected' : 'disconnected',
        ...(state === 'open' ? { last_connected_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId);

    return NextResponse.json({
      connected: state === 'open',
      state,
      qr: qr ?? null,
    });
  } catch (error) {
    console.error('[evolution/state] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
