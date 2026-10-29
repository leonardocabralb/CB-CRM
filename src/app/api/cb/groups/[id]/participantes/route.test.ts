import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/cb/groups/[id]/participantes: lê ao vivo, atualiza o espelho,
// responde `podeRenomear` com o `restrict`, e nunca transforma falha (ou lista
// vazia) em "nenhum participante". Ids, jids e telefones fictícios.
// ============================================================

import type { Banco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

const h = vi.hoisted(() => ({
  banco: null as unknown as Banco,
  canal: null as Record<string, unknown> | null,
  info: null as unknown,
  falhaDaEvolution: null as Error | null,
  pedidos: [] as string[],
}));

vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => h.banco.db }));
vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'conta-1', userId: 'u-1', supabase: h.banco.db }),
  toErrorResponse: (e: unknown) => {
    throw e;
  },
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => ({ status: 429 }),
  RATE_LIMITS: { whatsappAdmin: {} },
}));
vi.mock('@/lib/cb-channels/repo', () => ({ getChannelWithSecrets: async () => h.canal }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (s: string) => s }));
vi.mock('@/lib/whatsapp/transport/evolution-client', () => ({
  EvolutionClient: class {
    async findGroupInfos(jid: string) {
      h.pedidos.push(jid);
      if (h.falhaDaEvolution) throw h.falhaDaEvolution;
      return h.info;
    }
  },
}));

import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

import { GET } from './route';

const JID = '120363000000000001@g.us';
const INFO = {
  id: JID,
  subject: 'Grupo de teste',
  size: 3,
  restrict: true,
  announce: false,
  participants: [
    { id: '111@lid', phoneNumber: '5583980000016@s.whatsapp.net', admin: null },
    { id: '222@lid', phoneNumber: '5583980000099@s.whatsapp.net', admin: 'superadmin' },
    { id: '333@lid', admin: null },
  ],
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.banco = criarBanco({
    cb_groups: [{ id: 'g-1', account_id: 'conta-1', jid: JID, channel_id: 'canal-a', participant_count: null, we_are_admin: null }],
    conversations: [{ id: 'conv-g', account_id: 'conta-1', group_id: 'g-1' }],
    contacts: [{ id: 'ficha-1', account_id: 'conta-1', name: 'Cliente de Teste', telefone_canonico: '5583980000099' }],
    messages: [],
  });
  h.canal = {
    id: 'canal-a',
    kind: 'evolution',
    server_url: 'http://evolution.de.teste',
    instance_name: 'cbcrm-teste',
    api_key: 'chave',
    display_phone: '558380000016',
  };
  h.info = INFO;
  h.falhaDaEvolution = null;
  h.pedidos = [];
});

const pedir = () =>
  GET(new Request('http://localhost/api/cb/groups/g-1/participantes'), {
    params: Promise.resolve({ id: 'g-1' }),
  }) as unknown as Promise<{ body: Record<string, unknown>; status: number }>;

describe('GET participantes', () => {
  it('devolve a lista nomeada e ordenada, e atualiza o espelho do grupo', async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(h.pedidos).toEqual([JID]);
    const lista = r.body.participantes as { id: string; nome: string | null; somosNos: boolean; papel: string | null }[];
    expect(lista.map((p) => p.id)).toEqual(['111@lid', '222@lid', '333@lid']);
    expect(lista[0].somosNos).toBe(true);
    expect(lista[1]).toMatchObject({ nome: 'Cliente de Teste', papel: 'criador' });
    expect(h.banco.tabelas.cb_groups[0]).toMatchObject({
      participant_count: 3,
      we_are_admin: false,
      subject: 'Grupo de teste',
    });
    expect(r.body.grupo).toMatchObject({ id: 'g-1', participant_count: 3 });
  });

  it('só admin edita e não somos admin: não renomeia', async () => {
    expect((await pedir()).body).toMatchObject({ podeRenomear: false, soAdminEdita: true });
  });

  it('grupo que deixa qualquer participante editar: renomeia sem sermos admin', async () => {
    h.info = { ...INFO, restrict: false };
    expect((await pedir()).body).toMatchObject({ podeRenomear: true, soAdminEdita: false });
  });

  it('⚠️ sem achar a nossa linha, vale o "somos admin?" gravado — e ele não é apagado', async () => {
    h.banco.tabelas.cb_groups[0].we_are_admin = true;
    h.canal = { ...h.canal, display_phone: '5599999999999' };
    const r = await pedir();
    expect(r.body.podeRenomear).toBe(true);
    expect(h.banco.tabelas.cb_groups[0].we_are_admin).toBe(true);
    expect((r.body.participantes as { somosNos: boolean }[]).some((p) => p.somosNos)).toBe(false);
  });

  it('WhatsApp fora do ar = 502, sem gravar nada', async () => {
    h.falhaDaEvolution = new Error('timeout');
    const r = await pedir();
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('WHATSAPP_INDISPONIVEL');
    expect(h.banco.escritas).toEqual([]);
  });

  it('⚠️ lista vazia também é 502, nunca "nenhum participante"', async () => {
    h.info = { ...INFO, participants: [] };
    expect((await pedir()).status).toBe(502);
    expect(h.banco.escritas).toEqual([]);
  });

  it('grupo sem conexão (ou conexão que não é da Evolution) = 409 SEM_CONEXAO', async () => {
    h.canal = null;
    expect((await pedir()).body.code).toBe('SEM_CONEXAO');
    h.canal = { kind: 'meta' };
    expect((await pedir()).status).toBe(409);
    expect(h.pedidos).toEqual([]);
  });

  it('grupo de outra conta = 404; leitura que falha = 500, nunca 404', async () => {
    h.banco.tabelas.cb_groups[0].account_id = 'conta-2';
    expect((await pedir()).status).toBe(404);
    h.banco.falhas.cb_groups = { message: 'fora do ar' };
    expect((await pedir()).status).toBe(500);
  });
});
