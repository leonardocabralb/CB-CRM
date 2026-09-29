import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}));

import { POST } from './route';

const NEGOCIO = '11111111-1111-4111-8111-111111111111';
const DE = '22222222-2222-4222-8222-222222222222';
const PARA = '33333333-3333-4333-8333-333333333333';
const OUTRA = '44444444-4444-4444-8444-444444444444';

type Resultado = { data: unknown; error: { code?: string; message: string } | null };

/** O cliente do Supabase, gravando o que a rota pediu. */
function clienteFalso(update: Resultado, leitura?: Resultado) {
  const consultas: { patch?: unknown; cols?: string; filtros: [string, unknown][] }[] = [];
  return {
    consultas,
    from() {
      const q = {
        filtros: [] as [string, unknown][],
        patch: undefined as unknown,
        cols: undefined as string | undefined,
        update(patch: unknown) {
          q.patch = patch;
          return q;
        },
        select(cols: string) {
          q.cols = cols;
          return q;
        },
        eq(coluna: string, valor: unknown) {
          q.filtros.push([coluna, valor]);
          return q;
        },
        async maybeSingle() {
          consultas.push(q);
          return leitura;
        },
        then(resolver: (r: Resultado) => void) {
          consultas.push(q);
          resolver(update);
        },
      };
      return q;
    },
  };
}

function pedir(corpo: unknown, id = NEGOCIO) {
  return POST(
    new Request(`http://localhost/api/cb/negocios/${id}/mover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) },
  );
}

let cliente: ReturnType<typeof clienteFalso>;
const usar = (c: ReturnType<typeof clienteFalso>) => {
  cliente = c;
  mocks.requireRole.mockResolvedValue({ supabase: c, userId: 'u', accountId: 'a', role: 'agent' });
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  usar(clienteFalso({ data: [{ stage_id: PARA, status: 'open' }], error: null }));
});

describe('POST /api/cb/negocios/[id]/mover', () => {
  it('move SÓ a partir da etapa de origem, com a sessão de quem clicou', async () => {
    const resposta = await pedir({ de: DE, para: PARA });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ ok: true, stage_id: PARA, status: 'open' });
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    const [update] = cliente.consultas;
    expect(update.patch).toEqual({ stage_id: PARA });
    // ⚠️ A cerca: sem o `stage_id = de`, o card que um colega já tinha levado
    // adiante voltaria para trás, disparando as automações da etapa.
    expect(update.filtros).toEqual([
      ['id', NEGOCIO],
      ['stage_id', DE],
    ]);
  });

  it('nada casou e o card está noutra etapa: 409 com a etapa em que ele ESTÁ', async () => {
    usar(clienteFalso({ data: [], error: null }, { data: { stage_id: OUTRA, status: 'open' }, error: null }));
    const resposta = await pedir({ de: DE, para: PARA });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({ error: 'etapa_mudou', stage_id: OUTRA, status: 'open' });
  });

  it('nada casou e o card não existe (ou a RLS não o mostra): 404', async () => {
    usar(clienteFalso({ data: [], error: null }, { data: null, error: null }));
    expect((await pedir({ de: DE, para: PARA })).status).toBe(404);
  });

  it('etapa de outro funil (a FK composta recusa): 400, e não 500', async () => {
    usar(clienteFalso({ data: null, error: { code: '23503', message: 'fk' } }));
    const resposta = await pedir({ de: DE, para: PARA });
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ error: 'etapa_de_outro_funil' });
  });

  it('erro de banco é 500 — nunca "não encontrado"', async () => {
    usar(clienteFalso({ data: [], error: null }, { data: null, error: { message: 'timeout' } }));
    expect((await pedir({ de: DE, para: PARA })).status).toBe(500);
    usar(clienteFalso({ data: null, error: { code: '57014', message: 'timeout' } }));
    expect((await pedir({ de: DE, para: PARA })).status).toBe(500);
  });

  it('corpo inválido não chega ao banco', async () => {
    for (const corpo of [{}, { de: DE }, { de: DE, para: 'x' }, { de: DE, para: DE }, null]) {
      usar(clienteFalso({ data: [], error: null }));
      expect((await pedir(corpo)).status).toBe(400);
      expect(cliente.consultas).toEqual([]);
    }
    expect((await pedir({ de: DE, para: PARA }, 'nao-e-uuid')).status).toBe(400);
  });

  it('sem o papel: a resposta da guarda', async () => {
    mocks.requireRole.mockRejectedValue(new Error('forbidden'));
    expect((await pedir({ de: DE, para: PARA })).status).toBe(403);
  });
});
