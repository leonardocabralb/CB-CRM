import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/cb/scheduled — a ficha só-BSUID (Fase 11.3).
//
// A ficha que a Meta identifica só pelo nome de usuário (BSUID, sem
// telefone) só é alcançável pela API oficial. A agendada FIXA o canal no
// agendamento: por uma conexão por QR Code, a recusa só apareceria na hora do
// disparo, de madrugada, sem ninguém na tela. Falha FECHADA aqui, com o
// motivo em português, e nada é gravado. Espelho da API v1.
// ============================================================

const BSUID = 'BR.13491208655302741918';

const h = vi.hoisted(() => ({
  conversa: null as Record<string, unknown> | null,
  canal: null as Record<string, unknown> | null,
  inseridas: [] as Record<string, unknown>[],
}));

function dbDoOperador() {
  return {
    from: (tabela: string) => {
      const cadeia: Record<string, unknown> = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: async () => {
          if (tabela === 'conversations') return { data: h.conversa, error: null };
          if (tabela === 'profiles') return { data: { full_name: 'Ana', email: 'ana@x.test' }, error: null };
          return { data: null, error: null };
        },
      };
      return cadeia;
    },
  };
}

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireRole: vi.fn(async () => ({ supabase: dbDoOperador(), accountId: 'conta-1', userId: 'user-1' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { send: {} },
}));

vi.mock('@/lib/cb-channels/resolve', () => ({
  resolveChannelForConversation: vi.fn(async () => h.canal),
}));

vi.mock('@/lib/assinatura/resolver', () => ({ nomeParaAssinar: vi.fn(async () => null) }));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => ({
      insert: (linha: Record<string, unknown>) => {
        if (tabela !== 'cb_scheduled_messages') throw new Error(`insert inesperado: ${tabela}`);
        h.inseridas.push(linha);
        return { select: () => ({ single: async () => ({ data: { id: 'ag-1', ...linha }, error: null }) }) };
      },
    }),
  }),
}));

import { POST } from './route';

const agendar = () =>
  POST(
    new Request('http://localhost/api/cb/scheduled', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv-1',
        body: 'Bom dia',
        scheduled_for: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    }),
  );

beforeEach(() => {
  h.inseridas = [];
  h.conversa = {
    id: 'conv-1',
    channel_id: 'canal-evo',
    group_id: null,
    group: null,
    contact: { phone: null, wa_user_id: BSUID },
  };
  h.canal = { channelId: 'canal-evo', provider: 'evolution' };
});

describe('POST /api/cb/scheduled — ficha só-BSUID (Fase 11.3)', () => {
  it('conexão por QR Code: 409 com o motivo, e nada é agendado', async () => {
    const res = await agendar();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe('not_supported');
    expect(json.error).toMatch(/número oficial/);
    expect(h.inseridas).toEqual([]);
  });

  it('conexão da Meta: agenda, com o canal fixado', async () => {
    h.canal = { channelId: 'canal-meta', provider: 'meta' };
    const res = await agendar();
    expect(res.status).toBe(200);
    expect(h.inseridas).toHaveLength(1);
    expect(h.inseridas[0].channel_id).toBe('canal-meta');
  });

  it('com telefone, a conexão por QR Code agenda como sempre', async () => {
    h.conversa = { ...h.conversa, contact: { phone: '+5583988887777', wa_user_id: BSUID } };
    const res = await agendar();
    expect(res.status).toBe(200);
    expect(h.inseridas).toHaveLength(1);
  });

  it('grupo não passa pela conferência do BSUID (o alvo é o JID)', async () => {
    h.conversa = {
      id: 'conv-1',
      channel_id: null,
      group_id: 'grupo-1',
      group: { channel_id: 'canal-evo' },
      contact: null,
    };
    const res = await agendar();
    expect(res.status).toBe(200);
    expect(h.inseridas).toHaveLength(1);
  });
});
