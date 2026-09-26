import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A rota é a ÚNICA porta de escrita de `cb_celulares_dos_membros` (1046):
// confere o número pela régua e grava SEMPRE na linha do login da sessão.
// ============================================================

const estado = vi.hoisted(() => ({
  upserts: [] as { linha: Record<string, unknown>; opcoes: unknown }[],
  erroDoUpsert: null as null | { code: string; message: string },
  semSessao: false,
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      expect(tabela).toBe('cb_celulares_dos_membros');
      return {
        upsert(linha: Record<string, unknown>, opcoes: unknown) {
          estado.upserts.push({ linha, opcoes });
          return Promise.resolve({ error: estado.erroDoUpsert });
        },
      };
    },
  }),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => {
    if (estado.semSessao) throw new Error('sem sessão');
    return { userId: 'u-da-sessao', accountId: 'conta-1', role: 'viewer' };
  },
  toErrorResponse: () =>
    new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
}));

import { PUT } from './route';

function pedido(corpo: unknown) {
  return new Request('http://localhost/api/cb/meu-celular', {
    method: 'PUT',
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  });
}

beforeEach(() => {
  estado.upserts = [];
  estado.erroDoUpsert = null;
  estado.semSessao = false;
});

describe('PUT /api/cb/meu-celular', () => {
  it('grava os dígitos na linha do login da sessão, e devolve o que gravou', async () => {
    const res = await PUT(pedido({ celular: '(11) 91234-5678' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ celular: '5511912345678' });
    expect(estado.upserts).toHaveLength(1);
    expect(estado.upserts[0].linha).toMatchObject({
      user_id: 'u-da-sessao',
      celular: '5511912345678',
    });
    expect(estado.upserts[0].opcoes).toEqual({ onConflict: 'user_id' });
  });

  it('um user_id no corpo é ignorado — ninguém grava o número de um colega', async () => {
    await PUT(pedido({ celular: '(11) 91234-5678', user_id: 'u-colega' }));
    expect(estado.upserts[0].linha.user_id).toBe('u-da-sessao');
  });

  it.each([
    ['', 'vazio'],
    ['91234-5678', 'curto'],
    ['(11) 3456-7890', 'nao_e_celular'],
    ['11 9 1234 ramal 5', 'invalido'],
  ])('%j é recusado com 400 %s, sem gravar', async (celular, motivo) => {
    const res = await PUT(pedido({ celular }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: motivo });
    expect(estado.upserts).toHaveLength(0);
  });

  it('corpo sem o celular em texto é 400 corpo_invalido', async () => {
    for (const corpo of [{}, { celular: 11912345678 }, 'não é json']) {
      const res = await PUT(pedido(corpo));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'corpo_invalido' });
    }
    expect(estado.upserts).toHaveLength(0);
  });

  it('falha do banco é 500, nunca 200', async () => {
    estado.erroDoUpsert = { code: '23514', message: 'check violation' };
    const res = await PUT(pedido({ celular: '(11) 91234-5678' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'falhou' });
  });

  it('sem sessão, cai no toErrorResponse e não grava', async () => {
    estado.semSessao = true;
    const res = await PUT(pedido({ celular: '(11) 91234-5678' }));
    expect(res.status).toBe(401);
    expect(estado.upserts).toHaveLength(0);
  });
});
