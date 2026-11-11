import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIAS_DA_GRAVACAO, podarGravacoesDeLigacao } from './poda';

// ============================================================
// A poda dos 180 dias com um dublê roteirizado: a leitura devolve um lote,
// cada ligação perde os três arquivos, o diálogo e ganha a marca; a faixa
// fica com o resumo. Dados fictícios.
// ============================================================

const CONTA = '00000000-0000-4000-8000-000000000001';
const L1 = 'abcdef12-2222-4333-8444-555555555551';
const L2 = 'abcdef12-2222-4333-8444-555555555552';

function duble(opcoes: { lote: unknown[]; removerErro?: { message: string } | null; marcaErro?: { message: string } | null }) {
  const leituras: [string, unknown[]][][] = [];
  const marcas: { patch: unknown; filtros: [string, unknown[]][] }[] = [];
  const removidos: string[][] = [];
  const rpcs: unknown[] = [];
  let lido = false;
  const db = {
    from: () => {
      const filtros: [string, unknown[]][] = [];
      let patch: unknown = null;
      const q: Record<string, unknown> = {};
      for (const nome of ['select', 'eq', 'is', 'lt', 'not', 'order', 'limit']) {
        q[nome] = (...args: unknown[]) => (filtros.push([nome, args]), q);
      }
      q.update = (p: unknown) => ((patch = p), q);
      q.then = (ok: (r: unknown) => unknown) => {
        if (patch) {
          marcas.push({ patch, filtros });
          return Promise.resolve({ error: opcoes.marcaErro ?? null }).then(ok);
        }
        leituras.push(filtros);
        const data = lido ? [] : opcoes.lote;
        lido = true;
        return Promise.resolve({ data, error: null }).then(ok);
      };
      return q;
    },
    rpc: async (_nome: string, args: unknown) => (rpcs.push(args), { data: true, error: null }),
    storage: {
      from: (bucket: string) => ({
        remove: async (caminhos: string[]) => {
          expect(bucket).toBe('ligacoes');
          removidos.push(caminhos);
          return { data: [], error: opcoes.removerErro ?? null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { db, leituras, marcas, removidos, rpcs };
}

const LONGE = () => Date.now() + 60_000;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('podarGravacoesDeLigacao', () => {
  it('passados 180 dias: saem os três arquivos e o diálogo; a faixa fica com o resumo', async () => {
    const d = duble({
      lote: [
        { id: L1, account_id: CONTA },
        { id: L2, account_id: CONTA },
      ],
    });
    await podarGravacoesDeLigacao(d.db, LONGE());

    // Só as ligações pelo CRM, sem a marca, mais velhas que o prazo, com algo a podar.
    const filtros = d.leituras[0];
    expect(filtros).toContainEqual(['eq', ['pelo_crm', true]]);
    expect(filtros).toContainEqual(['is', ['gravacao_expirada_em', null]]);
    // Toda ATENDIDA pode ter arquivo (os lados chegam mesmo sem o estéreo).
    expect(filtros).toContainEqual(['not', ['atendida_pelo_crm_em', 'is', null]]);
    const limite = Date.parse((filtros.find(([n]) => n === 'lt')?.[1][1] as string) ?? '');
    expect(Math.abs(Date.now() - DIAS_DA_GRAVACAO * 86_400_000 - limite)).toBeLessThan(5_000);

    expect(d.removidos).toEqual([
      [`account-${CONTA}/ligacoes/${L1}/estereo.ogg`, `account-${CONTA}/ligacoes/${L1}/cliente.ogg`, `account-${CONTA}/ligacoes/${L1}/atendente.ogg`],
      [`account-${CONTA}/ligacoes/${L2}/estereo.ogg`, `account-${CONTA}/ligacoes/${L2}/cliente.ogg`, `account-${CONTA}/ligacoes/${L2}/atendente.ogg`],
    ]);
    expect(d.marcas).toHaveLength(2);
    expect(d.marcas[0].patch).toMatchObject({ transcricao: null, gravacao_expirada_em: expect.any(String) });
    expect(d.marcas[0].filtros).toContainEqual(['is', ['gravacao_expirada_em', null]]);
    // A faixa reflete a poda (sem ▶ nem diálogo, o resumo fica) — uma sincronização por ligação.
    expect(d.rpcs).toEqual([{ p_ligacao: L1 }, { p_ligacao: L2 }]);
  });

  it('o Storage recusa: para o ciclo SEM marcar (a ligação volta no ciclo seguinte)', async () => {
    const d = duble({ lote: [{ id: L1, account_id: CONTA }], removerErro: { message: 'fora' } });
    await podarGravacoesDeLigacao(d.db, LONGE());
    expect(d.marcas).toHaveLength(0);
    expect(d.rpcs).toHaveLength(0);
  });

  it('prazo vencido: não começa', async () => {
    const d = duble({ lote: [{ id: L1, account_id: CONTA }] });
    await podarGravacoesDeLigacao(d.db, Date.now() - 1);
    expect(d.leituras).toHaveLength(0);
    expect(d.removidos).toHaveLength(0);
  });
});
