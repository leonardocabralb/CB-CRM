import { beforeEach, describe, expect, it, vi } from 'vitest';

import { criarBanco, type Banco } from '@/lib/zapsign/duble.test-helper';

// ============================================================
// GET /api/cb/reunioes/resumo: só admin; os parâmetros opcionais; só as
// reuniões que já começaram; nada do cliente na resposta; erro de leitura é
// 500, nunca lista vazia. Dados fictícios.
// ============================================================

const h = vi.hoisted(() => ({ banco: null as unknown as Banco, papel: 'admin' }));

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async (min: string) => {
    if (min === 'admin' && h.papel !== 'admin' && h.papel !== 'owner') {
      throw Object.assign(new Error('This action requires the admin role or higher'), { status: 403 });
    }
    return { accountId: 'conta-1', userId: 'u1', role: h.papel };
  }),
  toErrorResponse: (err: { status?: number }) => ({ body: { error: 'x' }, status: err.status ?? 500 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => h.banco.cliente }));
vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) },
}));

import { __resetRateLimitForTests } from '@/lib/rate-limit';

import { GET } from './route';

type Resposta = { status: number; body: { reunioes?: Record<string, unknown>[]; error?: string } };
const pedir = async (qs = '') => (await GET(new Request(`http://x/api/cb/reunioes/resumo${qs}`))) as unknown as Resposta;

const CONTATO = 'contato-1';
const COMERCIAL = 'funil-comercial';
const JURIDICO = 'funil-juridico';
const ANTIGA = '2026-09-15T14:00:00Z';
const FUTURA = new Date(Date.now() + 3 * 86_400_000).toISOString();

function evento(id: string, inicio: string) {
  return {
    id,
    account_id: 'conta-1',
    evento: 'invitee.created',
    contact_id: CONTATO,
    invitee_uri: `https://calendly.example.com/invitees/${id}`,
    event_type_uri: 'https://calendly.example.com/event_types/1',
    event_type_nome: 'Reunião',
    inicio,
    fim: null,
    link: null,
    recebido_em: '2026-09-10T10:00:00Z',
    situacao: null,
  };
}

beforeEach(() => {
  __resetRateLimitForTests();
  h.papel = 'admin';
  h.banco = criarBanco({
    cb_calendly_eventos: [evento('cccccccc-0000-4000-8000-000000000001', ANTIGA), evento('cccccccc-0000-4000-8000-000000000002', FUTURA)],
    contacts: [{ id: CONTATO, account_id: 'conta-1', name: 'Cliente Fictício', phone: '5500000000000', wa_username: null, instagram_username: null }],
    deals: [{ id: 'negocio-1', account_id: 'conta-1', contact_id: CONTATO, pipeline_id: JURIDICO, stage_id: 'etapa-juridico', value: 5000, status: 'open', created_at: '2026-09-01T10:00:00Z' }],
    pipeline_stages: [
      { id: 'etapa-no-show', pipeline_id: COMERCIAL, name: 'No Show', position: 2, degrau: 'reuniao', desfecho_da_reuniao: 'faltou', 'pipelines.account_id': 'conta-1' },
      { id: 'etapa-juridico', pipeline_id: JURIDICO, name: 'Entrada', position: 0, degrau: 'lead', desfecho_da_reuniao: null, 'pipelines.account_id': 'conta-1' },
    ],
    cb_lead_events: [
      { id: 'eeeeeeee-0000-4000-8000-000000000001', account_id: 'conta-1', contact_id: CONTATO, deal_id: 'negocio-1', event_type: 'deal_created', occurred_at: '2026-09-01T10:00:00Z', to_stage_id: 'etapa-no-show', to_stage_label: 'No Show', to_pipeline_id: COMERCIAL, actor_label: null },
      { id: 'eeeeeeee-0000-4000-8000-000000000002', account_id: 'conta-1', contact_id: CONTATO, deal_id: 'negocio-1', event_type: 'stage_changed', occurred_at: '2026-09-15T14:30:00Z', to_stage_id: 'etapa-no-show', to_stage_label: 'No Show', to_pipeline_id: COMERCIAL, actor_label: 'Ana' },
      { id: 'eeeeeeee-0000-4000-8000-000000000003', account_id: 'conta-1', contact_id: CONTATO, deal_id: 'negocio-1', event_type: 'pipeline_changed', occurred_at: '2026-09-20T10:00:00Z', to_stage_id: 'etapa-juridico', to_stage_label: 'Entrada', to_pipeline_id: JURIDICO, actor_label: 'Ana' },
    ],
  });
});

describe('GET /api/cb/reunioes/resumo', () => {
  it('só admin: o membro recebe 403 sem ler nada', async () => {
    h.papel = 'agent';
    h.banco.falhar.add('cb_calendly_eventos:select');
    expect((await pedir()).status).toBe(403);
  });

  it('sem parâmetros ("Total"): as que já começaram, no funil do DIA, sem nada do cliente', async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    // A futura (com o mesmo contato e o mesmo card) não entra.
    expect(r.body.reunioes).toEqual([{ inicio: '2026-09-15T14:00:00.000Z', funil: COMERCIAL, resultado: 'no_show' }]);
    const texto = JSON.stringify(r.body);
    for (const proibido of ['Cliente Fictício', '5500000000000', CONTATO, 'negocio-1', '5000']) expect(texto).not.toContain(proibido);
  });

  it('a janela recorta pelo início da reunião', async () => {
    const r = await pedir('?de=2026-09-16T00:00:00Z&ate=2026-10-01T00:00:00Z');
    expect(r.status).toBe(200);
    expect(r.body.reunioes).toEqual([]);
    const r2 = await pedir('?de=2026-09-15T00:00:00-03:00&ate=2026-09-16T00:00:00-03:00');
    expect(r2.body.reunioes).toHaveLength(1);
  });

  it('janela ainda não começada: lista vazia (é resposta, não ignorância), sem ler o banco', async () => {
    h.banco.falhar.add('cb_calendly_eventos:select');
    const de = new Date(Date.now() + 86_400_000).toISOString();
    const ate = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const r = await pedir(`?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
    expect(r).toEqual({ status: 200, body: { reunioes: [] } });
  });

  it('instante sem fuso, ou fim antes do começo: 400', async () => {
    expect((await pedir('?de=2026-09-01T00:00:00')).status).toBe(400);
    expect((await pedir('?ate=2026-09-01')).status).toBe(400);
    expect((await pedir('?de=2026-09-10T00:00:00Z&ate=2026-09-01T00:00:00Z')).status).toBe(400);
  });

  it('erro de leitura: 500, nunca lista vazia', async () => {
    h.banco.falhar.add('cb_lead_events:select');
    const r = await pedir();
    expect(r.status).toBe(500);
    expect(r.body.reunioes).toBeUndefined();
  });
});
