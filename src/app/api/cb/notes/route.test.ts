import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// POST /api/cb/notes — a RESPOSTA à anotação (1075).
//
// A resposta grava `resposta_de` e avisa (`note_reply`) o autor da
// respondida e quem já escreveu na conversa dela — nunca quem responde, e
// nunca em dobro quem foi mencionado na mesma resposta. O aviso a um colega
// de verdade não se testa no preview (ele receberia), por isso este teste.
// ============================================================

const CONVERSA = 'c0000000-0000-4000-8000-000000000001';
const ORIGINAL = 'a0000000-0000-4000-8000-000000000001';
const RESPOSTA_DA_BIA = 'a0000000-0000-4000-8000-000000000002';
// Ids de login com forma de UUID: a rota descarta menção que não é UUID.
const ANA = 'b0000000-0000-4000-8000-00000000000a';
const BIA = 'b0000000-0000-4000-8000-00000000000b';
const CAIO = 'b0000000-0000-4000-8000-00000000000c';

type Nota = { id: string; resposta_de: string | null; author_user_id: string | null };
type Filtro = { op: string; col: string; val: unknown };

const estado = vi.hoisted(() => ({
  usuario: '',
  notas: [] as Nota[],
  membros: [] as string[],
  erroDaConversaDaNota: false,
  erroDoInsert: null as null | { code: string; message: string },
  inserts: [] as Record<string, unknown>[],
  avisos: [] as Record<string, unknown>[],
}));

const NOMES: Record<string, string> = {
  [ANA]: 'Ana Autora',
  [BIA]: 'Bia Respondente',
  [CAIO]: 'Caio Colega',
};

function resolver(tabela: string, filtros: Filtro[], modo: 'uma' | 'lista') {
  const eq = (col: string) => filtros.find((f) => f.op === 'eq' && f.col === col)?.val;
  if (tabela === 'profiles' && modo === 'uma') {
    return {
      data: {
        account_id: 'conta-1',
        account_role: 'agent',
        full_name: NOMES[eq('user_id') as string],
        email: null,
      },
      error: null,
    };
  }
  if (tabela === 'profiles') {
    const pedidos = (filtros.find((f) => f.op === 'in')?.val ?? []) as string[];
    return {
      data: pedidos.filter((id) => estado.membros.includes(id)).map((user_id) => ({ user_id })),
      error: null,
    };
  }
  if (tabela === 'conversations') {
    return {
      data: eq('id') === CONVERSA ? { id: CONVERSA, contact_id: 'contato-1', account_id: 'conta-1' } : null,
      error: null,
    };
  }
  if (tabela === 'cb_conversation_notes' && modo === 'uma') {
    const nota = estado.notas.find((n) => n.id === eq('id'));
    return { data: nota && eq('conversation_id') === CONVERSA ? { id: nota.id } : null, error: null };
  }
  if (tabela === 'cb_conversation_notes') {
    return estado.erroDaConversaDaNota
      ? { data: null, error: { message: 'falhou' } }
      : { data: estado.notas, error: null };
  }
  throw new Error(`tabela inesperada: ${tabela}`);
}

function consulta(tabela: string) {
  const filtros: Filtro[] = [];
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => (filtros.push({ op: 'eq', col, val }), builder),
    in: (col: string, val: unknown) => (filtros.push({ op: 'in', col, val }), builder),
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(resolver(tabela, filtros, 'uma')),
    then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve(resolver(tabela, filtros, 'lista')).then(ok, falha),
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: estado.usuario } }, error: null }) },
    from: consulta,
  }),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      if (tabela === 'cb_conversation_notes') {
        return {
          insert(linha: Record<string, unknown>) {
            estado.inserts.push(linha);
            return {
              select: () => ({
                single: async () =>
                  estado.erroDoInsert
                    ? { data: null, error: estado.erroDoInsert }
                    : { data: { id: 'nova', ...linha }, error: null },
              }),
            };
          },
        };
      }
      if (tabela === 'notifications') {
        return {
          insert: async (linhas: Record<string, unknown>[]) => {
            estado.avisos.push(...linhas);
            return { error: null };
          },
        };
      }
      throw new Error(`tabela inesperada no admin: ${tabela}`);
    },
  }),
}));

import { POST } from './route';

function pedido(corpo: Record<string, unknown>) {
  return new Request('http://localhost/api/cb/notes', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: CONVERSA, texto: 'Sim, criei as faturas.', ...corpo }),
  });
}

beforeEach(() => {
  estado.usuario = BIA;
  estado.notas = [{ id: ORIGINAL, resposta_de: null, author_user_id: ANA }];
  estado.membros = [ANA, BIA, CAIO];
  estado.erroDaConversaDaNota = false;
  estado.erroDoInsert = null;
  estado.inserts = [];
  estado.avisos = [];
});

describe('POST /api/cb/notes — resposta à anotação (1075)', () => {
  it('grava resposta_de e avisa o autor da respondida', async () => {
    const res = await POST(pedido({ resposta_de: ORIGINAL }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ respostaNotificada: true });
    expect(estado.inserts[0]).toMatchObject({ resposta_de: ORIGINAL, author_user_id: BIA });
    expect(estado.avisos).toEqual([
      expect.objectContaining({
        user_id: ANA,
        type: 'note_reply',
        conversation_id: CONVERSA,
        actor_user_id: BIA,
        title: 'Bia Respondente respondeu à sua anotação',
      }),
    ]);
  });

  it('o autor que responde de volta avisa quem já respondeu, e não a si mesmo', async () => {
    estado.notas.push({ id: RESPOSTA_DA_BIA, resposta_de: ORIGINAL, author_user_id: BIA });
    estado.usuario = ANA;
    await POST(pedido({ resposta_de: RESPOSTA_DA_BIA, texto: 'Obrigada!' }));
    expect(estado.avisos.map((a) => [a.user_id, a.title])).toEqual([
      [BIA, 'Ana Autora respondeu à sua anotação'],
    ]);
  });

  it('quem já escreveu na conversa, sem ser o autor da respondida, recebe o texto próprio', async () => {
    estado.notas.push({ id: RESPOSTA_DA_BIA, resposta_de: ORIGINAL, author_user_id: BIA });
    estado.usuario = CAIO;
    await POST(pedido({ resposta_de: RESPOSTA_DA_BIA }));
    expect(estado.avisos.map((a) => [a.user_id, a.title])).toEqual([
      [BIA, 'Caio Colega respondeu à sua anotação'],
      [ANA, 'Caio Colega respondeu numa anotação em que você escreveu'],
    ]);
  });

  it('quem saiu do escritório não recebe o aviso', async () => {
    estado.membros = [BIA];
    const res = await POST(pedido({ resposta_de: ORIGINAL }));
    expect(res.status).toBe(201);
    expect(estado.avisos).toEqual([]);
  });

  it('mencionado na resposta recebe só a menção, nunca dois avisos', async () => {
    await POST(pedido({ resposta_de: ORIGINAL, mencionados: [ANA] }));
    expect(estado.avisos.map((a) => [a.user_id, a.type])).toEqual([[ANA, 'note_mention']]);
  });

  it('resposta_de que não é UUID é 400, sem gravar', async () => {
    const res = await POST(pedido({ resposta_de: 'nao-e-uuid' }));
    expect(res.status).toBe(400);
    expect(estado.inserts).toEqual([]);
  });

  it('respondida que não existe nesta conversa é 409 REPLIED_NOTE_NOT_FOUND, sem gravar', async () => {
    const res = await POST(pedido({ resposta_de: RESPOSTA_DA_BIA }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'REPLIED_NOTE_NOT_FOUND' });
    expect(estado.inserts).toEqual([]);
  });

  it('respondida apagada entre a conferência e o insert (FK, 23503) também é 409', async () => {
    estado.erroDoInsert = { code: '23503', message: 'violates foreign key' };
    const res = await POST(pedido({ resposta_de: ORIGINAL }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'REPLIED_NOTE_NOT_FOUND' });
  });

  it('falhar ao ler a conversa da anotação salva a resposta e avisa a tela', async () => {
    estado.erroDaConversaDaNota = true;
    const res = await POST(pedido({ resposta_de: ORIGINAL }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ respostaNotificada: false });
    expect(estado.avisos).toEqual([]);
  });

  it('anotação comum não leva a coluna da 1075 nem avisa ninguém', async () => {
    const res = await POST(pedido({}));
    expect(res.status).toBe(201);
    expect(estado.inserts[0]).not.toHaveProperty('resposta_de');
    expect(estado.avisos).toEqual([]);
  });
});
