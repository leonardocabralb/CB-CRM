import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A rota da tarefa VISTA (1068): a barreira é a CONSULTA — só a tarefa do
// próprio responsável, aberta e ainda não vista, é tocada; e a lida à mão
// antes ganha a vista sem ter a leitura regravada.
// ============================================================

type Filtro = [string, ...unknown[]];
interface Escrita {
  tabela: string;
  valores: Record<string, unknown>;
  filtros: Filtro[];
}

const estado = vi.hoisted(() => ({
  escritas: [] as {
    tabela: string;
    valores: Record<string, unknown>;
    filtros: [string, ...unknown[]][];
  }[],
  devolve: [] as { data: { id: string }[] | null; error: { message: string } | null }[],
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      return {
        update(valores: Record<string, unknown>) {
          const escrita: Escrita = { tabela, valores, filtros: [] };
          estado.escritas.push(escrita);
          const registra =
            (nome: string) =>
            (...args: unknown[]) => {
              escrita.filtros.push([nome, ...args]);
              return b;
            };
          const b: Record<string, unknown> = {
            eq: registra('eq'),
            is: registra('is'),
            in: registra('in'),
            not: registra('not'),
            select: registra('select'),
            then: (f: (v: unknown) => unknown) =>
              Promise.resolve(
                estado.devolve.shift() ?? { data: [], error: null },
              ).then(f),
          };
          return b;
        },
      };
    },
  }),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ accountId: 'conta-1', userId: 'u-eu' }),
  toErrorResponse: (e: unknown) => {
    throw e;
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => null,
  RATE_LIMITS: { tarefaVista: { limit: 120, windowMs: 60_000 } },
}));

import { POST } from './route';

const T1 = '00000000-0000-4000-8000-000000000001';
const T2 = '00000000-0000-4000-8000-000000000002';

const pedido = (corpo: unknown) =>
  new Request('http://x/api/cb/tasks/vistas', {
    method: 'POST',
    body: JSON.stringify(corpo),
  });

beforeEach(() => {
  estado.escritas = [];
  estado.devolve = [];
});

describe('POST /api/cb/tasks/vistas', () => {
  it('recusa corpo inválido sem escrever nada', async () => {
    const r = await POST(pedido({ ids: ['nao-e-uuid'] }));
    expect(r.status).toBe(400);
    expect(estado.escritas).toEqual([]);
  });

  it('as duas escritas levam a cerca inteira: conta, responsável = quem chama, aberta, não vista, os ids', async () => {
    const r = await POST(pedido({ ids: [T1, T2] }));
    expect(r.status).toBe(200);
    expect(estado.escritas).toHaveLength(2);
    for (const e of estado.escritas) {
      expect(e.tabela).toBe('cb_tasks');
      expect(e.filtros).toEqual(
        expect.arrayContaining([
          ['eq', 'account_id', 'conta-1'],
          ['eq', 'responsavel_user_id', 'u-eu'],
          ['eq', 'status', 'aberta'],
          ['is', 'vista_em', null],
          ['in', 'id', [T1, T2]],
        ]),
      );
    }
  });

  it('a não lida ganha as duas colunas; a lida à mão ganha só a vista (a leitura não é regravada)', async () => {
    await POST(pedido({ ids: [T1] }));
    const [naoLidas, lidas] = estado.escritas;
    expect(Object.keys(naoLidas.valores).sort()).toEqual(['lida_em', 'vista_em']);
    expect(naoLidas.filtros).toContainEqual(['is', 'lida_em', null]);
    expect(Object.keys(lidas.valores)).toEqual(['vista_em']);
    expect(lidas.filtros).toContainEqual(['not', 'lida_em', 'is', null]);
  });

  it('devolve os ids que a consulta de fato marcou', async () => {
    estado.devolve = [
      { data: [{ id: T1 }], error: null },
      { data: [{ id: T2 }], error: null },
    ];
    const r = await POST(pedido({ ids: [T1, T2] }));
    expect(await r.json()).toEqual({ vistas: [T1, T2] });
  });

  it('erro do banco é 500, nunca lista vazia', async () => {
    estado.devolve = [{ data: null, error: { message: 'boom' } }];
    const r = await POST(pedido({ ids: [T1] }));
    expect(r.status).toBe(500);
  });
});
