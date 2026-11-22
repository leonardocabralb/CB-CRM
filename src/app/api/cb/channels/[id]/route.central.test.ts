import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// DELETE /api/cb/channels/[id] com a conexão pela central do Instagram (U-3):
// a conta para de entregar ao app da Atlas e a rota sai da central
// (`desligarDaCentral`) DEPOIS de a linha sair. Antes, uma falha no meio (o
// acervo das agendadas ou o próprio DELETE) deixaria a conexão de pé e muda:
// sem rota na central e sem assinatura do webhook. Valores fictícios.
// ============================================================

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  canal: null as null | Record<string, unknown>,
  erroDoDelete: null as null | { message: string },
}));

/** O cliente da sessão: cada consulta aguardada anota `op:tabela` na ordem. */
function banco() {
  return {
    from(tabela: string) {
      let op = 'select';
      const b: Record<string, unknown> = {
        select: () => b,
        update: () => {
          op = 'update';
          return b;
        },
        delete: () => {
          op = 'delete';
          return b;
        },
        eq: () => b,
        in: () => b,
        then: (ok: (v: unknown) => unknown) => {
          h.ordem.push(`${op}:${tabela}`);
          if (tabela === 'cb_channels' && op === 'delete') return ok({ error: h.erroDoDelete });
          if (op === 'select') return ok({ count: 0, error: null });
          return ok({ error: null });
        },
      };
      return b;
    },
  };
}

vi.mock('@/lib/auth/account', async (original) => ({
  ...(await original<typeof import('@/lib/auth/account')>()),
  requireRole: vi.fn(async () => ({
    accountId: 'conta-1',
    userId: 'admin-1',
    role: 'admin',
    supabase: banco(),
  })),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => null,
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/cb-channels/repo', async (original) => ({
  ...(await original<typeof import('@/lib/cb-channels/repo')>()),
  getChannelWithSecrets: vi.fn(async () => h.canal),
}));
vi.mock('@/lib/cb-channels/evolution-admin', () => ({ deleteChannelInstance: vi.fn() }));
vi.mock('@/lib/cb-channels/set-default', () => ({ setDefaultChannel: vi.fn() }));
vi.mock('@/lib/instagram/central/desligar', () => ({
  desligarDaCentral: vi.fn(async () => {
    h.ordem.push('desligar');
  }),
}));

import { desligarDaCentral } from '@/lib/instagram/central/desligar';

import { DELETE } from './route';

const apagar = () =>
  DELETE(new Request('http://localhost/api/cb/channels/canal-1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'canal-1' }),
  });

beforeEach(() => {
  h.ordem = [];
  h.erroDoDelete = null;
  h.canal = {
    id: 'canal-1',
    account_id: 'conta-1',
    kind: 'instagram',
    is_default: false,
    ig_login: 'central',
    ig_user_id: '17841400000000001',
    access_token: 'cifrado',
  };
});

describe('DELETE da conexão pela central do Instagram', () => {
  it('sai da central só DEPOIS de a linha sair', async () => {
    const r = await apagar();
    expect(r.status).toBe(200);
    expect(h.ordem.slice(-2)).toEqual(['delete:cb_channels', 'desligar']);
    expect(desligarDaCentral).toHaveBeenCalledWith(h.canal);
  });

  it('o DELETE que falha não tira a conexão da central', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.erroDoDelete = { message: 'falhou' };
    const r = await apagar();
    expect(r.status).toBe(500);
    expect(desligarDaCentral).not.toHaveBeenCalled();
  });

  it('a conexão do app da própria conta (unificado) não chama a central', async () => {
    h.canal = { ...h.canal, ig_login: 'unificado' };
    const r = await apagar();
    expect(r.status).toBe(200);
    expect(desligarDaCentral).not.toHaveBeenCalled();
  });
});
