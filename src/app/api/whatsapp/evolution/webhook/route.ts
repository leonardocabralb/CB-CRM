import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

import { normalizeUpsert, type EvolutionUpsert } from '@/lib/whatsapp/transport/evolution-inbound';
import { persistInboundMessage } from '@/lib/whatsapp/inbound-store';

// Inbound processing fans out to flows / automations / AI, so give the
// after() block headroom beyond the platform default.
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * Evolution does NOT sign its webhooks, so authenticity rests on a shared
 * secret we set in the instance's webhook `headers` (Authorization:
 * Bearer <EVOLUTION_WEBHOOK_SECRET>). Constant-time compare; the echoed
 * `apikey`/`server_url` in the body are attacker-controllable and are NOT
 * trusted. Fail-closed when the secret isn't configured.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return false;
  const presented = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Baileys ACK ints/enums → our messages.status ladder (CHECK-constrained).
function ackToStatus(status: unknown): 'sent' | 'delivered' | 'read' | null {
  const s = String(status).toUpperCase();
  if (s === 'SERVER_ACK' || s === '2') return 'sent';
  if (s === 'DELIVERY_ACK' || s === '3') return 'delivered';
  if (s === 'READ' || s === 'PLAYED' || s === '4' || s === '5') return 'read';
  return null;
}

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: unknown;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: EvolutionWebhookBody;
  try {
    body = (await request.json()) as EvolutionWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Config event names are UPPERCASE_SNAKE_CASE but the emitted `event`
  // field is lowercase dot-notation — match case-insensitively.
  const event = (body.event ?? '').toLowerCase().replace(/_/g, '.');
  const instance = body.instance;
  if (!instance) return NextResponse.json({ ok: true });

  // Route to the owning account by instance name (the inbound key).
  const { data: config } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id, user_id, provider, instance_name')
    .eq('instance_name', instance)
    .eq('provider', 'evolution')
    .maybeSingle();

  if (!config) {
    // Unknown/foreign instance — ack so Evolution doesn't retry forever.
    return NextResponse.json({ ok: true });
  }

  if (event === 'messages.upsert') {
    const items: EvolutionUpsert[] = Array.isArray(body.data)
      ? (body.data as EvolutionUpsert[])
      : [body.data as EvolutionUpsert];
    after(async () => {
      for (const item of items) {
        const normalized = normalizeUpsert(item, config.account_id, config.user_id);
        if (!normalized) continue;
        try {
          await persistInboundMessage(supabaseAdmin(), normalized);
        } catch (err) {
          console.error('[evolution/webhook] persist failed:', err);
        }
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (event === 'messages.update') {
    const d = (body.data ?? {}) as { keyId?: string; status?: unknown };
    const status = ackToStatus(d.status);
    if (d.keyId && status) {
      after(async () => {
        // Only touches our own outbound rows (message_id === keyId).
        const { error } = await supabaseAdmin()
          .from('messages')
          .update({ status })
          .eq('message_id', d.keyId)
          .eq('sender_type', 'agent');
        if (error) console.error('[evolution/webhook] status update failed:', error);
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (event === 'connection.update') {
    const d = (body.data ?? {}) as { state?: string };
    const raw = d.state;
    const state = raw === 'open' || raw === 'connecting' ? raw : 'close';
    after(async () => {
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({
          instance_state: state,
          status: state === 'open' ? 'connected' : 'disconnected',
          ...(state === 'open' ? { last_connected_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('instance_name', instance);
    });
    return NextResponse.json({ ok: true });
  }

  // Any other event (qrcode.updated, send.message echo, …) — just ack.
  return NextResponse.json({ ok: true });
}
