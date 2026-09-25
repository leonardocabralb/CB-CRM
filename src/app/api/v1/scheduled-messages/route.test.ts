import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/v1/scheduled-messages — a ficha só-BSUID (Fase 11.3).
//
// É o único caminho da API pública até uma ficha que a Meta identifica só
// pelo nome de usuário: `POST /v1/messages` exige telefone. Essa ficha só é
// alcançável pela API oficial da Meta, e a agendada FIXA o canal — agendar
// por uma conexão por QR Code seria descobrir a recusa de madrugada, sem
// ninguém na tela. A rota falha FECHADA com 409, como a do canal, e nada é
// gravado. Espelho de `/api/cb/scheduled`. Ids fictícios.
// ============================================================

const BSUID = 'BR.13491208655302741918';
const CONVERSA = '0f0f0f0f-1111-4222-8333-444444444444';

const h = vi.hoisted(() => ({
  conversa: null as Record<string, unknown> | null,
  canal: null as Record<string, unknown> | null,
  inseridas: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    accountId: 'conta-1',
    keyId: 'chave-1',
    supabase: {
      from: (tabela: string) => {
        const cadeia: Record<string, unknown> = {
          select: () => cadeia,
          eq: () => cadeia,
          maybeSingle: async () => {
            if (tabela === 'conversations') return { data: h.conversa, error: null };
            throw new Error(`tabela inesperada: ${tabela}`);
          },
          insert: (linha: Record<string, unknown>) => {
            if (tabela !== 'cb_scheduled_messages') throw new Error(`insert inesperado: ${tabela}`);
            h.inseridas.push(linha);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'ag-1', created_at: '2026-09-25T10:00:00Z', ...linha },
                  error: null,
                }),
              }),
            };
          },
        };
        return cadeia;
      },
    },
  })),
}));

vi.mock('@/lib/cb-channels/resolve', () => ({
  resolveChannelForConversation: vi.fn(async () => h.canal),
}));

vi.mock('@/lib/api/v1/authorship', () => ({
  resolveApiAuthor: vi.fn(async () => ({ userId: 'dono-1', nome: 'Escritório', membro: true })),
}));

import { POST } from './route';

const EM_UMA_HORA = () => new Date(Date.now() + 3_600_000).toISOString();

const agendar = () =>
  POST(
    new Request('http://localhost/api/v1/scheduled-messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: JSON.stringify({ conversation_id: CONVERSA, body: 'Bom dia', scheduled_for: EM_UMA_HORA() }),
    }),
  );

beforeEach(() => {
  h.inseridas = [];
  h.conversa = {
    id: CONVERSA,
    channel_id: 'canal-evo',
    group_id: null,
    group: null,
    contact: { phone: null, wa_user_id: BSUID },
  };
  h.canal = { channelId: 'canal-evo', provider: 'evolution' };
});

describe('POST /api/v1/scheduled-messages — ficha só-BSUID (Fase 11.3)', () => {
  it('conexão por QR Code: 409 not_supported, e nada é agendado', async () => {
    const res = await agendar();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(JSON.stringify(json)).toContain('not_supported');
    expect(h.inseridas).toEqual([]);
  });

  it('conexão da Meta: agenda (é o número que alcança)', async () => {
    h.canal = { channelId: 'canal-meta', provider: 'meta' };
    const res = await agendar();
    expect(res.status).toBe(201);
    expect(h.inseridas).toHaveLength(1);
    expect(h.inseridas[0].channel_id).toBe('canal-meta');
  });

  it('com telefone, a conexão por QR Code agenda como sempre', async () => {
    h.conversa = { ...h.conversa, contact: { phone: '+5583988887777', wa_user_id: BSUID } };
    const res = await agendar();
    expect(res.status).toBe(201);
    expect(h.inseridas).toHaveLength(1);
  });
});
