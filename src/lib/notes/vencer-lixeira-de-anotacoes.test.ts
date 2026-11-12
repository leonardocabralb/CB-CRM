import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { limiteDoVencimento } from './lixeira';
import { ANOTACOES_POR_CICLO, vencerLixeiraDeAnotacoes } from './vencer-lixeira-de-anotacoes';

type Passo = { op: string; args: unknown[] };

const AGORA = Date.parse('2026-11-10T15:00:00Z');

function adminFalso(opcoes: {
  vencidas?: string[];
  erroDaLeitura?: boolean;
  erroDoDelete?: boolean;
  apagadas?: number;
}) {
  const leitura: Passo[] = [];
  const exclusao: Passo[] = [];
  const cadeia = (registro: Passo[], fim: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const op of ['select', 'not', 'lt', 'order', 'in']) {
      c[op] = (...args: unknown[]) => (registro.push({ op, args }), c);
    }
    c.limit = (...args: unknown[]) => (registro.push({ op: 'limit', args }), Promise.resolve(fim()));
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(fim()).then(ok);
    return c;
  };
  const admin = {
    from: () => ({
      select: (...args: unknown[]) => {
        leitura.push({ op: 'select', args });
        return cadeia(leitura, () =>
          opcoes.erroDaLeitura
            ? { data: null, error: { message: 'timeout' } }
            : { data: (opcoes.vencidas ?? []).map((id) => ({ id })), error: null }
        );
      },
      delete: (...args: unknown[]) => {
        exclusao.push({ op: 'delete', args });
        return cadeia(exclusao, () =>
          opcoes.erroDoDelete
            ? { count: null, error: { message: 'deadlock' } }
            : { count: opcoes.apagadas ?? opcoes.vencidas?.length ?? 0, error: null }
        );
      },
    }),
  } as unknown as SupabaseClient;
  return { admin, leitura, exclusao };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

describe('o vencimento da lixeira de anotações (1132)', () => {
  it('lê as apagadas há mais de 90 dias, pelas mais antigas, num lote com teto', async () => {
    const { admin, leitura } = adminFalso({ vencidas: [] });
    await vencerLixeiraDeAnotacoes(admin, AGORA);
    expect(leitura).toEqual([
      { op: 'select', args: ['id'] },
      { op: 'not', args: ['apagada_em', 'is', null] },
      { op: 'lt', args: ['apagada_em', limiteDoVencimento(AGORA)] },
      { op: 'order', args: ['apagada_em', { ascending: true }] },
      { op: 'limit', args: [ANOTACOES_POR_CICLO] },
    ]);
  });

  it('sem vencidas, não apaga nada', async () => {
    const { admin, exclusao } = adminFalso({ vencidas: [] });
    expect(await vencerLixeiraDeAnotacoes(admin, AGORA)).toEqual({ excluidas: 0, erro: null });
    expect(exclusao).toEqual([]);
  });

  it('apaga DE VEZ só os ids lidos, repetindo a cerca (a restaurada no meio não some)', async () => {
    const { admin, exclusao } = adminFalso({ vencidas: ['a', 'b'] });
    expect(await vencerLixeiraDeAnotacoes(admin, AGORA)).toEqual({ excluidas: 2, erro: null });
    expect(exclusao).toEqual([
      { op: 'delete', args: [{ count: 'exact' }] },
      { op: 'in', args: ['id', ['a', 'b']] },
      { op: 'not', args: ['apagada_em', 'is', null] },
      { op: 'lt', args: ['apagada_em', limiteDoVencimento(AGORA)] },
    ]);
  });

  it('NUNCA lança: a falha vira o erro devolvido', async () => {
    expect(
      await vencerLixeiraDeAnotacoes(adminFalso({ erroDaLeitura: true }).admin, AGORA)
    ).toEqual({ excluidas: 0, erro: 'timeout' });
    expect(
      await vencerLixeiraDeAnotacoes(adminFalso({ vencidas: ['a'], erroDoDelete: true }).admin, AGORA)
    ).toEqual({ excluidas: 0, erro: 'deadlock' });
  });
});
