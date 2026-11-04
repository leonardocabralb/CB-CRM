import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/cb/groups/[id]/recibos (1119): quem de fora recebeu e quem leu
// uma mensagem nossa no grupo, do banco, com o nome pela regra do painel de
// participantes. Falha nunca vira lista vazia. Ids, jids e telefones
// fictícios.
// ============================================================

import type { Banco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

const h = vi.hoisted(() => ({ banco: null as unknown as Banco }));

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

import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

import { GET } from './route';

const MENSAGEM = '3EB0000000000000AB26';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.banco = criarBanco({
    cb_groups: [{ id: 'g-1', account_id: 'conta-1', jid: '120363000000000001@g.us', participantes_de_fora: 3 }],
    conversations: [{ id: 'conv-g', account_id: 'conta-1', group_id: 'g-1', contact_id: null }],
    contacts: [{ id: 'ficha-1', account_id: 'conta-1', name: 'Cliente de Teste', telefone_canonico: '5583980000016' }],
    messages: [
      { id: 'm-1', conversation_id: 'conv-g', group_sender_jid: '333@lid', group_sender_name: 'Fulano do Grupo', created_at: '2026-11-04T10:00:00Z' },
    ],
    cb_recibos_do_grupo: [
      // Só recebeu (pela ficha, pelo telefone).
      { account_id: 'conta-1', group_id: 'g-1', message_id: MENSAGEM, participante: '111@lid', telefone: '5583980000016', entregue_em: '2026-11-04T18:54:24Z', lida_em: null },
      // Leu, sem telefone: o nome vem de quando escreveu no grupo.
      { account_id: 'conta-1', group_id: 'g-1', message_id: MENSAGEM, participante: '333@lid', telefone: null, entregue_em: '2026-11-04T18:54:25Z', lida_em: '2026-11-04T19:02:00Z' },
      // Leu, sem nome nem telefone: a tela diz "Número oculto", nunca o LID.
      { account_id: 'conta-1', group_id: 'g-1', message_id: MENSAGEM, participante: '444@lid', telefone: null, entregue_em: '2026-11-04T18:54:26Z', lida_em: '2026-11-04T19:01:00Z' },
      // Outra mensagem não entra.
      { account_id: 'conta-1', group_id: 'g-1', message_id: 'OUTRA0000000000000000', participante: '111@lid', telefone: '5583980000016', entregue_em: '2026-11-04T18:00:00Z', lida_em: null },
    ],
  });
});

const pedir = (mensagem: string | null = MENSAGEM, grupo = 'g-1') =>
  GET(
    new Request(
      `http://localhost/api/cb/groups/${grupo}/recibos${mensagem === null ? '' : `?mensagem=${encodeURIComponent(mensagem)}`}`,
    ),
    { params: Promise.resolve({ id: grupo }) },
  ) as unknown as Promise<{ body: Record<string, unknown>; status: number }>;

describe('GET /api/cb/groups/[id]/recibos', () => {
  it('quem leu primeiro (pela hora da leitura), depois quem só recebeu; nome pela ficha ou pelo grupo', async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      recibos: [
        { participante: '444@lid', nome: null, telefone: null, entregueEm: '2026-11-04T18:54:26Z', lidaEm: '2026-11-04T19:01:00Z' },
        { participante: '333@lid', nome: 'Fulano do Grupo', telefone: null, entregueEm: '2026-11-04T18:54:25Z', lidaEm: '2026-11-04T19:02:00Z' },
        { participante: '111@lid', nome: 'Cliente de Teste', telefone: '5583980000016', entregueEm: '2026-11-04T18:54:24Z', lidaEm: null },
      ],
      participantesDeFora: 3,
    });
  });

  it('nenhum recibo registrado: lista vazia COM o denominador (resposta, não falha)', async () => {
    h.banco.tabelas.cb_recibos_do_grupo = [];
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ recibos: [], participantesDeFora: 3 });
  });

  it('⚠️ leitura dos recibos que falha é 500, nunca uma lista vazia com cara de resposta', async () => {
    h.banco.falhas.cb_recibos_do_grupo = { message: 'fora do ar' };
    expect((await pedir()).status).toBe(500);
  });

  it('grupo de outra conta (ou inexistente) é 404; leitura do grupo que falha é 500', async () => {
    expect((await pedir(MENSAGEM, 'g-de-outra-conta')).status).toBe(404);
    h.banco.falhas.cb_groups = { message: 'fora do ar' };
    expect((await pedir()).status).toBe(500);
  });

  it('id de mensagem ausente ou estranho é 400 (nada vai à consulta)', async () => {
    expect((await pedir(null)).status).toBe(400);
    expect((await pedir("x' or 1=1")).status).toBe(400);
  });

  it('o nome é enfeite: a leitura das fichas que falha deixa o telefone', async () => {
    h.banco.falhas.contacts = { message: 'fora do ar' };
    const r = await pedir();
    expect(r.status).toBe(200);
    const recibos = r.body.recibos as { participante: string; nome: string | null; telefone: string | null }[];
    expect(recibos.find((x) => x.participante === '111@lid')).toEqual(
      expect.objectContaining({ nome: null, telefone: '5583980000016' }),
    );
  });
});
