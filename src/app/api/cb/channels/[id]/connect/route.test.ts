import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/cb/channels/[id]/connect — o corpo `{ reaplicarWebhook }`.
// O diálogo do QR reaplica o webhook só na PRIMEIRA consulta de cada
// abertura (antes eram 12 `webhook/set` por minuto); a tela aberta antes do
// deploy não manda corpo e mantém o comportamento antigo (reaplica sempre).
// ============================================================

const estado = vi.hoisted(() => ({
  updates: [] as { tabela: string; linha: Record<string, unknown> }[],
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'conta-1',
    userId: 'u1',
    supabase: {
      from(tabela: string) {
        const b = {
          update(linha: Record<string, unknown>) {
            estado.updates.push({ tabela, linha });
            return b;
          },
          eq: () => b,
          select: () => b,
          single: () => Promise.resolve({ data: { id: 'canal-1' }, error: null }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
        return b;
      },
    },
  }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'interno' }), { status: 500 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => null,
}));

vi.mock('@/lib/cb-channels/repo', () => ({
  getChannelWithSecrets: async () => ({
    id: 'canal-1',
    kind: 'evolution',
    instance_name: 'inst-a',
    status: 'connecting',
    display_phone: null,
    is_default: false,
  }),
  CB_CHANNEL_SAFE_COLUMNS: 'id',
}));

vi.mock('@/lib/cb-channels/evolution-admin', () => ({
  channelConnectionState: vi.fn(async () => ({ state: 'connecting', qrBase64: 'data:qr' })),
  reaplicarWebhook: vi.fn(async () => {}),
}));

import { reaplicarWebhook } from '@/lib/cb-channels/evolution-admin';
import { POST } from './route';

const params = { params: Promise.resolve({ id: 'canal-1' }) };

function pedido(body?: string) {
  return new Request('http://localhost/api/cb/channels/canal-1/connect', {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }),
  });
}

beforeEach(() => {
  estado.updates.length = 0;
  vi.clearAllMocks();
});

describe('POST /connect — reaplicarWebhook', () => {
  it.each([
    ['sem corpo (tela aberta antes do deploy)', undefined],
    ['corpo inválido', '{não é json'],
    ['corpo sem a chave', '{}'],
    ['valor que não é booleano', '{"reaplicarWebhook":"false"}'],
    ['true', '{"reaplicarWebhook":true}'],
  ])('%s → reaplica', async (_caso, body) => {
    const res = await POST(pedido(body), params);
    expect(res.status).toBe(200);
    expect(reaplicarWebhook).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ connected: false, qr: 'data:qr' });
  });

  it('false → NÃO reaplica, e a consulta segue igual', async () => {
    const res = await POST(pedido('{"reaplicarWebhook":false}'), params);
    expect(res.status).toBe(200);
    expect(reaplicarWebhook).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ connected: false, qr: 'data:qr', webhookError: null });
  });
});
