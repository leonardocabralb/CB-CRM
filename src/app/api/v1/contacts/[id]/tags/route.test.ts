import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/v1/contacts/{id}/tags — o 400 de ETIQUETA vai para o log do
// servidor, com a rota, o código e o id da chave (nunca o corpo).
//
// A API não guarda as respostas que dá, e `api_keys.last_used_at` sobe na
// autenticação, antes da validação: sem este registro, saber se o cenário do
// Make tropeça numa regra de etiqueta dependia do histórico do próprio Make.
// ============================================================

const helpers = vi.hoisted(() => ({
  getContactById: vi.fn(),
  idAtualDaFicha: vi.fn(),
  resolveAuditUserId: vi.fn(),
  aplicarMudancaDeTags: vi.fn(),
  maybeSingle: vi.fn(),
}));

// O banco em si só serve para provar que a entrada ruim não o toca: a posse
// do contato é conferida por `idAtualDaFicha` (espiã abaixo).
const encadeado = {
  select: () => encadeado,
  eq: () => encadeado,
  maybeSingle: helpers.maybeSingle,
};
const from = vi.fn(() => encadeado);

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: { from },
    accountId: 'conta-1',
    keyId: 'chave-do-make',
  })),
}));
vi.mock('@/lib/api/v1/contacts', () => ({
  getContactById: helpers.getContactById,
  idAtualDaFicha: helpers.idAtualDaFicha,
  resolveAuditUserId: helpers.resolveAuditUserId,
  ContactError: class ContactError extends Error {
    status = 500;
  },
}));
vi.mock('@/lib/contacts/tag-write', () => ({
  ContactTagWriteError: class ContactTagWriteError extends Error {
    status = 500;
  },
}));
// REAIS: a leitura do corpo e o registro no log. A escrita (que arrasta o
// motor de automações) é espiã.
vi.mock('@/lib/api/v1/tags-do-contato', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/api/v1/tags-do-contato')>();
  return {
    lerMudancaDeTags: real.lerMudancaDeTags,
    avisarRecusaDeEtiqueta: real.avisarRecusaDeEtiqueta,
    aplicarMudancaDeTags: helpers.aplicarMudancaDeTags,
    TagReferenceError: class TagReferenceError extends Error {
      code = 'unknown_tag_ids';
      status = 400;
    },
  };
});

import { POST } from './route';
import { TagReferenceError } from '@/lib/api/v1/tags-do-contato';

const ID = '11111111-2222-4333-8444-555555555555';

const post = (id: string, corpo: unknown) =>
  POST(
    new Request(`http://localhost/api/v1/contacts/${id}/tags`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  for (const f of Object.values(helpers)) f.mockReset();
  from.mockClear();
  helpers.maybeSingle.mockResolvedValue({ data: { id: ID }, error: null });
  helpers.idAtualDaFicha.mockResolvedValue(ID);
  helpers.resolveAuditUserId.mockResolvedValue('usuario-de-auditoria');
  helpers.aplicarMudancaDeTags.mockResolvedValue({
    adicionadas: ['Typebot'],
    removidas: [],
    inalteradas: [],
    desconhecidas: [],
  });
  helpers.getContactById.mockResolvedValue({ id: ID, tags: [] });
});

describe('POST /api/v1/contacts/{id}/tags — o 400 de etiqueta vai para o log', () => {
  it.each([
    ['item que não é texto', { add: [42] }],
    ['lista vazia dos dois lados', { add: [], remove: [] }],
    ['corpo que não é objeto', ['Typebot']],
  ])('%s: 400 bad_request, registrado, sem tocar o banco', async (_, corpo) => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(ID, corpo);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('bad_request');
    expect(aviso).toHaveBeenCalledWith('[api/v1] 400 de etiqueta', {
      rota: 'POST /api/v1/contacts/{id}/tags',
      code: 'bad_request',
      keyId: 'chave-do-make',
    });
    expect(from).not.toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('`unknown_tag_ids` (e a mesma etiqueta nos dois lados) também', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    helpers.aplicarMudancaDeTags.mockRejectedValue(new TagReferenceError('unknown_tag_ids', 'ids desconhecidos'));
    const res = await post(ID, { add: ['99999999-9999-4999-8999-999999999999'] });
    expect(res.status).toBe(400);
    expect(aviso).toHaveBeenCalledWith('[api/v1] 400 de etiqueta', {
      rota: 'POST /api/v1/contacts/{id}/tags',
      code: 'unknown_tag_ids',
      keyId: 'chave-do-make',
    });
    aviso.mockRestore();
  });

  it('pedido aceito não registra nada', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post(ID, { add: ['Typebot'] });
    expect(res.status).toBe(200);
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });

  it('`{id}` malformado NÃO é 400 de etiqueta — fica fora do log', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await post('abc', { add: ['Typebot'] })).status).toBe(400);
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe('POST /api/v1/contacts/{id}/tags — id de ficha UNIDA a outra (1092)', () => {
  const NOVO = '99999999-8888-4777-8666-555555555555';

  it('aplica na ficha que ficou', async () => {
    helpers.idAtualDaFicha.mockResolvedValue(NOVO);
    helpers.getContactById.mockResolvedValue({ id: NOVO, tags: [] });
    const res = await post(ID, { add: ['Typebot'] });
    expect(res.status).toBe(200);
    expect(helpers.aplicarMudancaDeTags.mock.calls[0][1]).toMatchObject({ contactId: NOVO });
  });

  it('id que não é de ficha nem de união: 404, sem escrita', async () => {
    helpers.idAtualDaFicha.mockResolvedValue(null);
    const res = await post(ID, { add: ['Typebot'] });
    expect(res.status).toBe(404);
    expect(helpers.aplicarMudancaDeTags).not.toHaveBeenCalled();
  });
});
