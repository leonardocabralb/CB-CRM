import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/cb/channels/[id]/restart — o logout que não pegou
// (`SessaoAindaDePe`, `LogoutNaoPegou`) vira 502 com a frase, sem o prefixo, e
// NADA é gravado: o repareamento parou antes do connect, a sessão segue de pé.
// A falha DEPOIS do logout (`FalhaDepoisDoLogout`) grava 'connecting' e
// responde 200 sem QR: o número já caiu, e o diálogo pede o QR de novo.
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
          maybeSingle: () => Promise.resolve({ data: { id: 'canal-1' }, error: null }),
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
  RATE_LIMITS: { adminAction: { limit: 10, windowMs: 60_000 } },
}));

vi.mock('@/lib/cb-channels/repo', () => ({
  getChannelWithSecrets: async () => ({
    id: 'canal-1',
    kind: 'evolution',
    instance_name: 'inst-a',
    status: 'connected',
    is_default: true,
  }),
  CB_CHANNEL_SAFE_COLUMNS: 'id',
}));

vi.mock('@/lib/cb-channels/evolution-admin', async (original) => {
  const real = await original<typeof import('@/lib/cb-channels/evolution-admin')>();
  return {
    SessaoAindaDePe: real.SessaoAindaDePe,
    LogoutNaoPegou: real.LogoutNaoPegou,
    FalhaDepoisDoLogout: real.FalhaDepoisDoLogout,
    repairChannelPairing: vi.fn(),
  };
});

import {
  FalhaDepoisDoLogout,
  LogoutNaoPegou,
  repairChannelPairing,
  SessaoAindaDePe,
} from '@/lib/cb-channels/evolution-admin';
import { POST } from './route';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reparar = repairChannelPairing as any;
const params = { params: Promise.resolve({ id: 'canal-1' }) };
const pedido = () => new Request('http://localhost/api/cb/channels/canal-1/restart', { method: 'POST' });

beforeEach(() => {
  estado.updates.length = 0;
  vi.clearAllMocks();
});

describe('POST /restart', () => {
  it('logout que falhou com a sessão de pé → 502 com a frase, e nada gravado', async () => {
    reparar.mockRejectedValue(new SessaoAindaDePe());
    const res = await POST(pedido(), params);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe(new SessaoAindaDePe().message);
    expect(json.error).not.toMatch(/^Erro da Evolution/);
    expect(estado.updates).toEqual([]);
  });

  it('logout que não pegou (a sessão antiga voltou) → 502 com a frase, e nada gravado', async () => {
    reparar.mockRejectedValue(new LogoutNaoPegou());
    const res = await POST(pedido(), params);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(new LogoutNaoPegou().message);
    expect(estado.updates).toEqual([]);
  });

  it('falha DEPOIS do logout → 200 sem QR e a conexão em connecting (o diálogo pede o QR)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    reparar.mockRejectedValue(new FalhaDepoisDoLogout(new Error('timeout')));
    const res = await POST(pedido(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ qr: null, pairingCode: null });
    expect(estado.updates[0]).toEqual({
      tabela: 'cb_channels',
      linha: { status: 'connecting', last_error: null },
    });
  });

  it('outro erro da Evolution → 502 com o prefixo, e nada gravado', async () => {
    reparar.mockRejectedValue(new Error('timeout'));
    const res = await POST(pedido(), params);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Erro da Evolution: timeout');
    expect(estado.updates).toEqual([]);
  });

  it('repareamento ok → o QR e o pairingCode voltam, e a conexão fica em connecting', async () => {
    reparar.mockResolvedValue({ qrBase64: 'data:qr', pairingCode: 'ABCD-1234' });
    const res = await POST(pedido(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ qr: 'data:qr', pairingCode: 'ABCD-1234' });
    expect(estado.updates[0]).toEqual({
      tabela: 'cb_channels',
      linha: { status: 'connecting', last_error: null },
    });
  });
});
