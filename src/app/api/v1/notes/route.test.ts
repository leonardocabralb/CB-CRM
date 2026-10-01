import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// /api/v1/notes — conversa de GRUPO fica fora (regra da v1: as conversas de
// grupo não aparecem na API, e as anotações delas também não podem).
//
//   - GET: a anotação de grupo tem `contact_id` NULO por desenho (918), e é
//     esse filtro que a recorta, sem embed na conversa;
//   - POST por `conversation_id`: a busca da conversa leva
//     `.is('group_id', null)` — grupo é "não encontrada", como no
//     `GET /conversations/{id}`.
// Ids fictícios.
// ============================================================

type Chamada = [string, ...unknown[]];

const h = vi.hoisted(() => ({
  chamadas: {} as Record<string, Array<[string, ...unknown[]]>>,
  resultados: {} as Record<string, { data: unknown; error: unknown }>,
}));

function cadeia(tabela: string) {
  const registro: Chamada[] = (h.chamadas[tabela] ??= []);
  const fim = () => h.resultados[tabela] ?? { data: null, error: null };
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit', 'or', 'insert']) {
    c[m] = (...args: unknown[]) => {
      registro.push([m, ...args]);
      return c;
    };
  }
  c.maybeSingle = async () => fim();
  c.single = async () => fim();
  c.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
    Promise.resolve(fim()).then(ok, falha);
  return c;
}

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: { from: (tabela: string) => cadeia(tabela) },
    accountId: 'conta-1',
    keyId: 'chave-1',
  })),
}));
vi.mock('@/lib/api/v1/authorship', () => ({
  resolveApiAuthor: vi.fn(async () => ({ userId: 'dono-1', nome: 'Dona Exemplo', membro: true })),
}));

import { GET, POST } from './route';

const CONVERSA = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  h.chamadas = {};
  h.resultados = {};
});

describe('GET /api/v1/notes', () => {
  it('recorta as anotações de conversa de grupo (contact_id nulo)', async () => {
    h.resultados.cb_conversation_notes = { data: [], error: null };
    const r = await GET(new Request('http://localhost/api/v1/notes', { headers: { authorization: 'Bearer x' } }));
    expect(r.status).toBe(200);
    expect(h.chamadas.cb_conversation_notes).toContainEqual(['not', 'contact_id', 'is', null]);
  });
});

describe('POST /api/v1/notes', () => {
  const post = (corpo: unknown) =>
    POST(
      new Request('http://localhost/api/v1/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
        body: JSON.stringify(corpo),
      })
    );

  it('a conversa é buscada fora dos grupos — a de grupo é 404, e nada é gravado', async () => {
    h.resultados.conversations = { data: null, error: null };
    const r = await post({ conversation_id: CONVERSA, texto: 'Ligar amanhã' });
    expect(r.status).toBe(404);
    expect(h.chamadas.conversations).toContainEqual(['is', 'group_id', null]);
    expect(h.chamadas.cb_conversation_notes).toBeUndefined();
  });

  it('conversa 1:1: grava a anotação na conversa resolvida', async () => {
    h.resultados.conversations = { data: { id: CONVERSA, contact_id: 'contato-1' }, error: null };
    h.resultados.cb_conversation_notes = {
      data: {
        id: 'nota-1',
        conversation_id: CONVERSA,
        contact_id: 'contato-1',
        author_user_id: 'dono-1',
        autor_nome: 'Dona Exemplo',
        texto: 'Ligar amanhã',
        created_at: '2026-10-01T12:00:00Z',
      },
      error: null,
    };
    const r = await post({ conversation_id: CONVERSA, texto: 'Ligar amanhã' });
    expect(r.status).toBe(201);
    expect(h.chamadas.cb_conversation_notes?.[0]?.[0]).toBe('insert');
  });
});
