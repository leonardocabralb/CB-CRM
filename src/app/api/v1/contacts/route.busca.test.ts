import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/v1/contacts?search= — o termo chega INTEIRO e literal ao `.or()`.
//
// A versão anterior apagava o que não fosse letra, dígito, espaço ou
// `+@.-_` ("O'Brien" buscava "OBrien") e deixava o `_` chegar ao `ilike`
// como curinga. Aqui se confere a string que vai ao PostgREST; a forma foi
// medida contra o PostgREST real (ver `src/lib/postgrest/literal.ts`).
// ============================================================

const chamadas = vi.hoisted(() => ({ or: [] as string[] }));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => {
    const consulta: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) consulta[m] = () => consulta;
    consulta.or = (filtro: string) => {
      chamadas.or.push(filtro);
      return consulta;
    };
    consulta.then = (resolver: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolver);
    return { supabase: { from: () => consulta }, accountId: 'conta-1', keyId: 'chave' };
  }),
}));
// O módulo real arrasta o motor de automações (via `tag-events`).
vi.mock('@/lib/api/v1/contacts', () => ({
  CONTACT_SELECT: '*',
  serializeContact: (r: unknown) => r,
  findOrCreateContact: vi.fn(),
  getContactById: vi.fn(),
  lerTagsPedidas: vi.fn(),
  setContactTags: vi.fn(),
  resolveAuditUserId: vi.fn(),
  ContactError: class ContactError extends Error {},
}));
vi.mock('@/lib/api/v1/tags-do-contato', () => ({
  avisarRecusaDeEtiqueta: vi.fn(),
  lerModoDasTags: vi.fn(),
  lerTagsDoCorpo: vi.fn(),
  TagReferenceError: class TagReferenceError extends Error {},
}));

import { GET } from './route';

const buscar = (termo: string) =>
  GET(
    new Request(`http://localhost/api/v1/contacts?search=${encodeURIComponent(termo)}`, {
      headers: { authorization: 'Bearer x' },
    }),
  );

beforeEach(() => {
  chamadas.or = [];
});

describe('GET /api/v1/contacts?search=', () => {
  it('busca nome e telefone com o termo literal, entre aspas', async () => {
    const res = await buscar("O'Brien, (83) 9887_50%*");
    expect(res.status).toBe(200);
    expect(chamadas.or).toEqual([
      `name.imatch."O'Brien, \\\\(83\\\\) 9887_50%\\\\*",phone.imatch."O'Brien, \\\\(83\\\\) 9887_50%\\\\*"`,
    ]);
  });

  it('termo comum continua simples', async () => {
    await buscar('Ana');
    expect(chamadas.or).toEqual(['name.imatch."Ana",phone.imatch."Ana"']);
  });

  it('só o caractere de controle sai — o NUL derrubaria a consulta com 500', async () => {
    await buscar('An\u0000a\n');
    expect(chamadas.or).toEqual(['name.imatch."Ana",phone.imatch."Ana"']);
  });

  it('termo em branco não filtra', async () => {
    await buscar('   ');
    expect(chamadas.or).toEqual([]);
  });
});
