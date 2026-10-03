import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// As rotas `/api/v1/…/{id}`: o MESMO contrato em todas.
//
//   - `{id}` que não é UUID → 400 `bad_request`, sem tocar no banco (o
//     Postgres recusaria o filtro com 22P02, e a resposta saía 500 — que
//     cliente HTTP repete — ou, pior, 404);
//   - erro de banco → 500 `internal`, NUNCA 404 (regra da v1: "não
//     encontrado" faz o integrador recriar o que existe e duplicar);
//   - só a linha ausente é 404.
//
// Até 01/10/2026 negócio, tarefa, reunião e agendada respondiam 404 a
// qualquer erro de leitura, e as mensagens da conversa descartavam o erro da
// guarda de posse. Ids fictícios.
// ============================================================

const h = vi.hoisted(() => ({
  resultado: { data: null as unknown, error: null as unknown },
  from: vi.fn(),
}));

/** Uma cadeia do supabase-js que aceita qualquer filtro e termina no resultado configurado. */
function cadeia() {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit', 'or', 'update', 'delete']) {
    c[m] = () => c;
  }
  c.maybeSingle = async () => h.resultado;
  c.single = async () => h.resultado;
  c.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
    Promise.resolve(h.resultado).then(ok, falha);
  return c;
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: { from: h.from },
    accountId: 'conta-1',
    keyId: 'chave-1',
  })),
}));
// O dreno arrasta o motor de automações; aqui ele só não pode rodar.
vi.mock('@/lib/automations/drain-events', () => ({
  drenarEventosDeFunil: vi.fn(async () => {}),
}));

import * as negocio from './deals/[id]/route';
import * as tarefa from './tasks/[id]/route';
import * as reuniao from './meetings/[id]/route';
import * as agendada from './scheduled-messages/[id]/route';
import * as conversa from './conversations/[id]/route';
import * as mensagens from './conversations/[id]/messages/route';
import * as disparo from './broadcasts/[id]/route';
import * as webhook from './webhooks/[id]/route';

const ID = '11111111-2222-4333-8444-555555555555';

type Rota = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

const chamar = (rota: Rota, metodo: string, id: string, corpo?: unknown) =>
  rota(
    new Request(`http://localhost/api/v1/x/${id}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) }
  );

const ROTAS: Array<[string, Rota, string, unknown?]> = [
  ['GET /deals/{id}', negocio.GET, 'GET'],
  ['PATCH /deals/{id}', negocio.PATCH, 'PATCH', { value: 10 }],
  ['GET /tasks/{id}', tarefa.GET, 'GET'],
  ['GET /meetings/{id}', reuniao.GET, 'GET'],
  ['GET /scheduled-messages/{id}', agendada.GET, 'GET'],
  ['GET /conversations/{id}', conversa.GET, 'GET'],
  ['GET /conversations/{id}/messages', mensagens.GET, 'GET'],
  ['GET /broadcasts/{id}', disparo.GET, 'GET'],
  ['GET /webhooks/{id}', webhook.GET, 'GET'],
  ['PATCH /webhooks/{id}', webhook.PATCH, 'PATCH', { is_active: true }],
  ['DELETE /webhooks/{id}', webhook.DELETE, 'DELETE'],
];

// As rotas cujo `error` era lido como "não encontrado" (as outras já davam 500).
const LIAM_O_ERRO_COMO_404 = new Set([
  'GET /deals/{id}',
  'PATCH /deals/{id}',
  'GET /tasks/{id}',
  'GET /meetings/{id}',
  'GET /scheduled-messages/{id}',
  'GET /conversations/{id}/messages',
]);

beforeEach(() => {
  h.resultado = { data: null, error: null };
  h.from.mockReset().mockImplementation(() => cadeia());
});

describe.each(ROTAS)('%s', (nome, rota, metodo, corpo) => {
  it('id que não é UUID: 400 e o banco nem é tocado', async () => {
    const r = await chamar(rota, metodo, 'abc', corpo);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe('bad_request');
    expect(h.from).not.toHaveBeenCalled();
  });

  it('linha ausente: 404', async () => {
    const r = await chamar(rota, metodo, ID, corpo);
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe('not_found');
  });

  it(`erro de banco: 500, nunca 404${LIAM_O_ERRO_COMO_404.has(nome) ? ' (era 404)' : ''}`, async () => {
    h.resultado = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await chamar(rota, metodo, ID, corpo);
    expect(r.status).toBe(500);
    expect((await r.json()).error.code).toBe('internal');
    erro.mockRestore();
  });
});
