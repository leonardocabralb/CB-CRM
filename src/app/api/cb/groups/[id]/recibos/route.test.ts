import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/cb/groups/[id]/recibos (1119): quem de fora recebeu e quem leu
// uma mensagem nossa no grupo, do banco. O nome sai da FICHA gravada com o
// recibo, senão do nome usado no grupo; o telefone não é guardado (só aparece
// quando o próprio participante é um JID de telefone). Falha nunca vira lista
// vazia. Ids, jids e telefones fictícios.
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

const recibo = (over: Record<string, unknown>) => ({
  account_id: 'conta-1',
  group_id: 'g-1',
  message_id: MENSAGEM,
  contact_id: null,
  lida_em: null,
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.banco = criarBanco({
    cb_groups: [{ id: 'g-1', account_id: 'conta-1', jid: '120363000000000001@g.us', participantes_de_fora: 4 }],
    conversations: [{ id: 'conv-g', account_id: 'conta-1', group_id: 'g-1', contact_id: null }],
    contacts: [
      { id: 'ficha-1', account_id: 'conta-1', name: 'Cliente de Teste', telefone_canonico: '5583980000016' },
      { id: 'ficha-2', account_id: 'conta-1', name: 'Cliente Por Telefone', telefone_canonico: '5583980000017' },
    ],
    messages: [
      { id: 'm-1', conversation_id: 'conv-g', group_sender_jid: '333@lid', group_sender_name: 'Fulano do Grupo', created_at: '2026-11-04T10:00:00Z' },
    ],
    cb_recibos_do_grupo: [
      // Cliente (a ficha gravada com o recibo): só recebeu.
      recibo({ participante: '111@lid', contact_id: 'ficha-1', entregue_em: '2026-11-04T18:54:24Z' }),
      // Sem ficha, mas escreveu no grupo: o nome que usou. Leu.
      recibo({ participante: '333@lid', entregue_em: '2026-11-04T18:54:25Z', lida_em: '2026-11-04T19:02:00Z' }),
      // Sem ficha nem nome: "Número oculto" na tela, nunca o LID. Leu antes.
      recibo({ participante: '444@lid', entregue_em: '2026-11-04T18:54:26Z', lida_em: '2026-11-04T19:01:00Z' }),
      // Grupo endereçado por telefone: o JID é o telefone (e acha a ficha por ele).
      recibo({ participante: '5583980000017@s.whatsapp.net', entregue_em: '2026-11-04T18:54:27Z' }),
      // Outra mensagem não entra.
      recibo({ participante: '111@lid', message_id: 'OUTRA0000000000000000', entregue_em: '2026-11-04T18:00:00Z' }),
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
  it('quem leu primeiro (pela hora da leitura), depois quem só recebeu; o nome pela ficha ou pelo grupo', async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      recibos: [
        { participante: '444@lid', nome: null, telefone: null, entregueEm: '2026-11-04T18:54:26Z', lidaEm: '2026-11-04T19:01:00Z' },
        { participante: '333@lid', nome: 'Fulano do Grupo', telefone: null, entregueEm: '2026-11-04T18:54:25Z', lidaEm: '2026-11-04T19:02:00Z' },
        { participante: '111@lid', nome: 'Cliente de Teste', telefone: null, entregueEm: '2026-11-04T18:54:24Z', lidaEm: null },
        {
          participante: '5583980000017@s.whatsapp.net',
          nome: 'Cliente Por Telefone',
          telefone: '5583980000017',
          entregueEm: '2026-11-04T18:54:27Z',
          lidaEm: null,
        },
      ],
      total: 4,
      participantesDeFora: 4,
    });
  });

  it('nenhum recibo registrado: lista vazia COM o denominador (resposta, não falha)', async () => {
    h.banco.tabelas.cb_recibos_do_grupo = [];
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ recibos: [], total: 0, participantesDeFora: 4 });
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

  it('o nome é enfeite: a leitura das fichas que falha deixa a lista (sem o nome da ficha)', async () => {
    h.banco.falhas.contacts = { message: 'fora do ar' };
    const r = await pedir();
    expect(r.status).toBe(200);
    const recibos = r.body.recibos as { participante: string; nome: string | null }[];
    expect(recibos).toHaveLength(4);
    expect(recibos.find((x) => x.participante === '111@lid')?.nome).toBeNull();
    expect(recibos.find((x) => x.participante === '333@lid')?.nome).toBe('Fulano do Grupo');
  });
});
