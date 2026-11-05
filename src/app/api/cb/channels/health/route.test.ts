import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/cb/channels/health: a service role entra só para os episódios do
// sino (E1). Sem ela no contêiner, o cliente lança ao nascer — e a sonda tem
// de seguir, porque a trava do compositor depende dela.
// ============================================================

const estado = vi.hoisted(() => ({
  adminLanca: false,
  chamadas: [] as unknown[][],
}));

const ADMIN = { quem: 'service-role' };
const SESSAO = { quem: 'sessao' };

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ accountId: 'conta-1', userId: 'u1', supabase: SESSAO }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'interno' }), { status: 500 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => null,
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => {
    if (estado.adminLanca) throw new Error('supabaseKey is required.');
    return ADMIN;
  },
}));

vi.mock('@/lib/cb-channels/health', () => ({
  probeChannels: async (...args: unknown[]) => {
    estado.chamadas.push(args);
    return [{ id: 'c1', episodios: args[2] ? [] : null }];
  },
}));

const { GET } = await import('./route');

beforeEach(() => {
  estado.adminLanca = false;
  estado.chamadas.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GET /api/cb/channels/health — os episódios do sino (E1)', () => {
  it('a sonda vai com o cliente da SESSÃO, e a service role só para os episódios', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(estado.chamadas).toEqual([[SESSAO, 'conta-1', ADMIN]]);
  });

  it('⚠️ sem a service role, a sonda segue (200) sem os episódios, em vez de cair inteira', async () => {
    estado.adminLanca = true;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(estado.chamadas).toEqual([[SESSAO, 'conta-1', null]]);
    expect(await res.json()).toEqual({ channels: [{ id: 'c1', episodios: null }] });
  });
});
