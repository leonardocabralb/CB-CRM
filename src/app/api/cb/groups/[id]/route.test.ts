import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// PATCH /api/cb/groups/[id], o renomear NO WHATSAPP: a permissão se decide AO
// VIVO (admin, ou grupo que deixa qualquer participante mudar os dados); só
// sem resposta legível vale o `we_are_admin` gravado. Ids e jids fictícios.
// ============================================================

import type { Banco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

const h = vi.hoisted(() => ({
  banco: null as unknown as Banco,
  info: null as unknown,
  falhaDaLeitura: null as Error | null,
  renomeados: [] as string[],
}));

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'conta-1', userId: 'u-1', supabase: h.banco.db }),
  toErrorResponse: (e: unknown) => {
    throw e;
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => ({ status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/cb-channels/repo', () => ({
  getChannelWithSecrets: async () => ({
    id: 'canal-a',
    kind: 'evolution',
    server_url: 'http://evolution.de.teste',
    instance_name: 'cbcrm-teste',
    api_key: 'chave',
    display_phone: '558380000016',
  }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => s }));
vi.mock('@/lib/whatsapp/transport/evolution-client', () => ({
  EvolutionClient: class {
    async findGroupInfos() {
      if (h.falhaDaLeitura) throw h.falhaDaLeitura;
      return h.info;
    }
    async updateGroupSubject(_jid: string, subject: string) {
      h.renomeados.push(subject);
      return {};
    }
  },
}));

import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

import { PATCH } from './route';

const JID = '120363000000000001@g.us';
const infoCom = (admin: string | null, restrict: boolean) => ({
  id: JID,
  size: 2,
  restrict,
  participants: [
    { id: '111@lid', phoneNumber: '5583980000016@s.whatsapp.net', admin },
    { id: '222@lid', phoneNumber: '5511922223333@s.whatsapp.net', admin: 'superadmin' },
  ],
});

function prepararGrupo(weAreAdmin: boolean | null) {
  h.banco = criarBanco({
    cb_groups: [{ id: 'g-1', account_id: 'conta-1', jid: JID, channel_id: 'canal-a', we_are_admin: weAreAdmin }],
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.falhaDaLeitura = null;
  h.renomeados = [];
});

const renomear = () =>
  PATCH(
    new Request('http://localhost/api/cb/groups/g-1', {
      method: 'PATCH',
      body: JSON.stringify({ subject: 'Nome novo de teste', renomear_no_whatsapp: true }),
    }),
    { params: Promise.resolve({ id: 'g-1' }) },
  ) as unknown as Promise<{ body: Record<string, unknown>; status: number }>;

describe('renomear no WhatsApp: a permissão ao vivo', () => {
  it('grupo aberto a todos renomeia, mesmo sem sermos admin', async () => {
    prepararGrupo(null);
    h.info = infoCom(null, false);
    expect((await renomear()).status).toBe(200);
    expect(h.renomeados).toEqual(['Nome novo de teste']);
  });

  it('⚠️ gravado como admin, mas REBAIXADO no WhatsApp: recusa antes de chamar', async () => {
    prepararGrupo(true);
    h.info = infoCom(null, true);
    expect((await renomear()).status).toBe(403);
    expect(h.renomeados).toEqual([]);
  });

  it('admin ao vivo renomeia', async () => {
    prepararGrupo(false);
    h.info = infoCom('admin', true);
    expect((await renomear()).status).toBe(200);
  });

  it('sem resposta legível vale o gravado, como antes', async () => {
    prepararGrupo(true);
    h.falhaDaLeitura = new Error('timeout');
    expect((await renomear()).status).toBe(200);

    prepararGrupo(null);
    h.renomeados = [];
    h.falhaDaLeitura = null;
    h.info = { id: JID };
    expect((await renomear()).status).toBe(403);
    expect(h.renomeados).toEqual([]);
  });
});
