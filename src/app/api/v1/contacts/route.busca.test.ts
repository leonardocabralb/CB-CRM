import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/v1/contacts?search= — o termo chega INTEIRO e literal ao `.or()`.
//
// A versão anterior apagava o que não fosse letra, dígito, espaço ou
// `+@.-_` ("O'Brien" buscava "OBrien") e deixava o `_` chegar ao `ilike`
// como curinga. Aqui se confere a string que vai ao PostgREST; a forma foi
// medida contra o PostgREST real (ver `src/lib/postgrest/literal.ts`).
//
// E o telefone de uma ficha UNIDA (1092) também acha a que ficou (decisão do
// operador, 14/10/2026): a busca dos antigos é a REAL
// (`fichasPeloTelefoneAntigo`), contra o dublê de `cb_contatos_antigos`.
// ============================================================

const chamadas = vi.hoisted(() => ({
  or: [] as string[],
  /** Cada filtro da leitura de `cb_contatos_antigos`, na ordem. */
  antigos: [] as unknown[][],
  /** Quantas vezes a lista de contatos foi de fato lida. */
  contatosLidos: 0,
  respostaDosAntigos: { data: [] as unknown, error: null as { message: string } | null },
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => {
    const contatos: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) contatos[m] = () => contatos;
    contatos.or = (filtro: string) => {
      chamadas.or.push(filtro);
      return contatos;
    };
    contatos.then = (resolver: (v: unknown) => unknown) => {
      chamadas.contatosLidos += 1;
      return Promise.resolve({ data: [], error: null }).then(resolver);
    };
    const antigos: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'regexIMatch', 'order', 'limit']) {
      antigos[m] = (...args: unknown[]) => {
        chamadas.antigos.push([m, ...args]);
        return antigos;
      };
    }
    antigos.then = (resolver: (v: unknown) => unknown) =>
      Promise.resolve(chamadas.respostaDosAntigos).then(resolver);
    const from = (tabela: string) => {
      if (tabela === 'contacts') return contatos;
      if (tabela === 'cb_contatos_antigos') return antigos;
      throw new Error(`a busca consultou uma tabela inesperada: ${tabela}`);
    };
    return { supabase: { from }, accountId: 'conta-1', keyId: 'chave' };
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
  chamadas.antigos = [];
  chamadas.contatosLidos = 0;
  chamadas.respostaDosAntigos = { data: [], error: null };
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
    expect(chamadas.antigos).toEqual([]);
  });
});

describe('GET /api/v1/contacts?search= — o telefone de uma ficha UNIDA (1092)', () => {
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';

  it('8 dígitos ou mais: acha também a ficha que tem o telefone ANTIGO — o id entra no `.or()`', async () => {
    chamadas.respostaDosAntigos = { data: [{ contact_id: A }, { contact_id: A }, { contact_id: B }], error: null };
    const res = await buscar('99990001');
    expect(res.status).toBe(200);
    expect(chamadas.or).toEqual([`name.imatch."99990001",phone.imatch."99990001",id.in.(${A},${B})`]);
    // Service role: a leitura dos antigos é recortada pela conta, e só telefone.
    expect(chamadas.antigos).toContainEqual(['eq', 'account_id', 'conta-1']);
    expect(chamadas.antigos).toContainEqual(['eq', 'tipo', 'telefone']);
    expect(chamadas.contatosLidos).toBe(1);
  });

  it('nenhum telefone antigo casa: a busca fica como sempre foi', async () => {
    const res = await buscar('99990001');
    expect(res.status).toBe(200);
    expect(chamadas.antigos).not.toEqual([]);
    expect(chamadas.or).toEqual(['name.imatch."99990001",phone.imatch."99990001"']);
  });

  it('⚠️ a leitura dos antigos que FALHA é 500 — nunca "não achei" (o integrador recriaria a ficha)', async () => {
    chamadas.respostaDosAntigos = { data: null, error: { message: 'timeout' } };
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await buscar('99990001');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'internal', message: 'Failed to list contacts' } });
    expect(chamadas.contatosLidos).toBe(0);
    erro.mockRestore();
  });

  it.each([
    ['sem dígitos', 'Ana'],
    ['nome e dígitos', 'Ana 99990001'],
    ['telefone formatado', '(00) 99999-0001'],
    ['menos de 8 dígitos', '9999000'],
  ])('%s ("%s"): não consulta os antigos', async (_caso, termo) => {
    const res = await buscar(termo);
    expect(res.status).toBe(200);
    expect(chamadas.antigos).toEqual([]);
    expect(chamadas.or).toHaveLength(1);
    expect(chamadas.or[0]).not.toContain('id.in.');
  });
});
