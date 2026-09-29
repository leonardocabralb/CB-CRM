import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A rota de suspender/reativar (1062) só repassa à RPC e traduz o SQLSTATE.
// Quem decide quem pode suspender quem é o banco (`cb_definir_suspensao`);
// aqui se cobra que a rota não invente regra nem engula o erro dele.
// ============================================================

const h = vi.hoisted(() => ({
  papel: 'admin' as string,
  chamadas: [] as { fn: string; args: Record<string, unknown> }[],
  resposta: { data: '2026-09-29T12:00:00+00:00' as unknown, error: null as null | { code: string; message: string } },
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    if (h.papel !== 'admin' && h.papel !== 'owner') {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    }
    return {
      userId: 'u-admin',
      accountId: 'conta-1',
      role: h.papel,
      supabase: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          h.chamadas.push({ fn, args });
          return h.resposta;
        },
      },
    };
  }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

import { POST } from './route';

const ALVO = '9b400680-e0a8-46c5-8677-dc95efbc43bb';

function pedir(corpo: unknown, userId = ALVO) {
  return POST(
    new Request(`http://x/api/account/members/${userId}/suspensao`, {
      method: 'POST',
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ userId }) },
  );
}

beforeEach(() => {
  h.papel = 'admin';
  h.chamadas = [];
  h.resposta = { data: '2026-09-29T12:00:00+00:00', error: null };
});

describe('POST /api/account/members/[userId]/suspensao', () => {
  it('suspende pela RPC e devolve a data', async () => {
    const res = await pedir({ suspenso: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, suspenso_em: '2026-09-29T12:00:00+00:00' });
    expect(h.chamadas).toEqual([
      { fn: 'cb_definir_suspensao', args: { p_user_id: ALVO, p_suspenso: true } },
    ]);
  });

  it('reativa: a RPC devolve NULL e a rota diz null', async () => {
    h.resposta = { data: null, error: null };
    const res = await pedir({ suspenso: false });
    expect(await res.json()).toEqual({ ok: true, suspenso_em: null });
    expect(h.chamadas[0].args.p_suspenso).toBe(false);
  });

  it('corpo sem booleano é 400 e NÃO chama a RPC — "sim" ou 1 não suspendem ninguém', async () => {
    for (const corpo of [{}, { suspenso: 'true' }, { suspenso: 1 }, 'não é json']) {
      const res = await pedir(corpo);
      expect(res.status).toBe(400);
    }
    expect(h.chamadas).toEqual([]);
  });

  it('traduz os SQLSTATE da RPC: 42501 → 403, 22023 → 400, o resto → 500 genérico', async () => {
    h.resposta = { data: null, error: { code: '42501', message: 'membro_suspenso' } };
    const proibido = await pedir({ suspenso: true });
    expect(proibido.status).toBe(403);
    expect((await proibido.json()).error).toBe('membro_suspenso');

    h.resposta = { data: null, error: { code: '22023', message: 'Cannot suspend the account owner' } };
    const invalido = await pedir({ suspenso: true });
    expect(invalido.status).toBe(400);
    expect((await invalido.json()).error).toBe('Cannot suspend the account owner');

    h.resposta = { data: null, error: { code: '08006', message: 'connection failure' } };
    const quebrado = await pedir({ suspenso: true });
    expect(quebrado.status).toBe(500);
    expect((await quebrado.json()).error).toBe('Failed to update member');
  });

  it('id que não é UUID é 400 e não chega ao banco (seria 22P02 → 500)', async () => {
    const res = await pedir({ suspenso: true }, 'nao-e-uuid');
    expect(res.status).toBe(400);
    expect(h.chamadas).toEqual([]);
  });

  it('quem não é admin nem chega à RPC', async () => {
    h.papel = 'agent';
    const res = await pedir({ suspenso: true });
    expect(res.status).toBe(403);
    expect(h.chamadas).toEqual([]);
  });
});
