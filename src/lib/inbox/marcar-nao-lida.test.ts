import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { marcarComoNaoLida } from './marcar-nao-lida';

interface Pedido {
  metodo: 'update' | 'select';
  payload?: Record<string, unknown>;
  filtros: string[];
}

/**
 * Dublê do pedaço do postgrest que a função usa. `linhasDoUpdate` é o que o
 * BANCO responde ao UPDATE cercado; `leitura` é a releitura da linha.
 */
function banco(opcoes: {
  linhasDoUpdate?: number;
  erroDoUpdate?: { message: string } | null;
  leitura?: { unread_count: number | null } | null;
  erroDaLeitura?: { message: string } | null;
}) {
  const pedidos: Pedido[] = [];
  const db = {
    from() {
      const pedido: Pedido = { metodo: 'select', filtros: [] };
      pedidos.push(pedido);
      const b = {
        update(payload: Record<string, unknown>) {
          pedido.metodo = 'update';
          pedido.payload = payload;
          return b;
        },
        select() {
          return b;
        },
        eq(coluna: string, valor: unknown) {
          pedido.filtros.push(`${coluna}=${String(valor)}`);
          return b;
        },
        or(filtro: string) {
          pedido.filtros.push(`or(${filtro})`);
          return b;
        },
        maybeSingle: async () => ({
          data: opcoes.leitura ?? null,
          error: opcoes.erroDaLeitura ?? null,
        }),
        then(ok: (v: unknown) => unknown) {
          const erro = opcoes.erroDoUpdate ?? null;
          const linhas = Array.from({ length: opcoes.linhasDoUpdate ?? 0 }, () => ({ id: 'conv-1' }));
          return Promise.resolve({ data: erro ? null : linhas, error: erro }).then(ok);
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, pedidos };
}

describe('marcarComoNaoLida', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('grava 1, cercado no zero (ou nulo), e responde que ficou não lida', async () => {
    const { db, pedidos } = banco({ linhasDoUpdate: 1 });

    expect(await marcarComoNaoLida(db, 'conv-1')).toBe(true);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toEqual({
      metodo: 'update',
      payload: { unread_count: 1 },
      filtros: ['id=conv-1', 'or(unread_count.is.null,unread_count.eq.0)'],
    });
  });

  it('zero linhas porque o cliente escreveu no meio: relê e diz que ficou não lida', async () => {
    const { db, pedidos } = banco({ linhasDoUpdate: 0, leitura: { unread_count: 3 } });

    expect(await marcarComoNaoLida(db, 'conv-1')).toBe(true);
    // O contador de verdade (3) não é rebaixado: a releitura é só leitura.
    expect(pedidos.map((p) => p.metodo)).toEqual(['update', 'select']);
  });

  it('CRÍTICO: zero linhas porque a RLS barrou (Visualizador) — relê, vê zero e diz que NÃO marcou', async () => {
    const { db } = banco({ linhasDoUpdate: 0, leitura: { unread_count: 0 } });

    expect(await marcarComoNaoLida(db, 'conv-1')).toBe(false);
  });

  it('erro na gravação ou na releitura NÃO vira "marcada"', async () => {
    expect(await marcarComoNaoLida(banco({ erroDoUpdate: { message: 'rede' } }).db, 'conv-1')).toBe(false);
    expect(
      await marcarComoNaoLida(banco({ linhasDoUpdate: 0, erroDaLeitura: { message: 'rede' } }).db, 'conv-1'),
    ).toBe(false);
    expect(await marcarComoNaoLida(banco({ linhasDoUpdate: 0, leitura: null }).db, 'conv-1')).toBe(false);
  });
});
