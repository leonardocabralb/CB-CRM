import { describe, expect, it, vi } from 'vitest';

import type { ApiKeyContext } from '@/lib/auth/api-context';
import { ApiError } from './respond';
import {
  contatoNoRecorte,
  exigirFiltroDoCliente,
  funilNoRecorte,
  funisDaChave,
} from './recorte-por-funil';

/** Banco falso da consulta de `contatoNoRecorte`, registrando os filtros. */
function bancoDeCards(resposta: { data: unknown[] | null; error: unknown }) {
  const filtros: Array<[string, unknown, unknown?]> = [];
  const consulta = {
    select: () => consulta,
    eq: (col: string, v: unknown) => (filtros.push(['eq', col, v]), consulta),
    in: (col: string, v: unknown) => (filtros.push(['in', col, v]), consulta),
    limit: () => Promise.resolve(resposta),
  };
  const from = vi.fn(() => consulta);
  return { supabase: { from } as unknown as ApiKeyContext['supabase'], from, filtros };
}

function ctx(funis: string[] | null, supabase?: ApiKeyContext['supabase']) {
  return { accountId: 'acct-1', funis, supabase: supabase ?? ({} as ApiKeyContext['supabase']) };
}

describe('funisDaChave / funilNoRecorte', () => {
  it('sem recorte, todo funil está', () => {
    expect(funisDaChave(ctx(null))).toBeNull();
    expect(funilNoRecorte(ctx(null), 'qualquer')).toBe(true);
    expect(funilNoRecorte(ctx(null), null)).toBe(true);
  });

  it('com recorte, só os da lista; card sem funil nunca está', () => {
    expect(funilNoRecorte(ctx(['p1']), 'p1')).toBe(true);
    expect(funilNoRecorte(ctx(['p1']), 'p2')).toBe(false);
    expect(funilNoRecorte(ctx(['p1']), null)).toBe(false);
  });
});

describe('contatoNoRecorte', () => {
  it('sem recorte responde SEM consultar (as integrações não pagam nada)', async () => {
    const banco = bancoDeCards({ data: [], error: null });
    expect(await contatoNoRecorte(ctx(null, banco.supabase), 'c1')).toBe(true);
    expect(banco.from).not.toHaveBeenCalled();
  });

  it('com recorte: card do cliente num funil da chave, cercado pela conta', async () => {
    const banco = bancoDeCards({ data: [{ id: 'd1' }], error: null });
    expect(await contatoNoRecorte(ctx(['p1', 'p2'], banco.supabase), 'c1')).toBe(true);
    expect(banco.from).toHaveBeenCalledWith('deals');
    expect(banco.filtros).toEqual([
      ['eq', 'account_id', 'acct-1'],
      ['eq', 'contact_id', 'c1'],
      ['in', 'pipeline_id', ['p1', 'p2']],
    ]);
  });

  it('sem card nos funis = fora; contato nulo (grupo, tarefa sem cliente) = fora', async () => {
    const banco = bancoDeCards({ data: [], error: null });
    expect(await contatoNoRecorte(ctx(['p1'], banco.supabase), 'c1')).toBe(false);
    expect(await contatoNoRecorte(ctx(['p1'], banco.supabase), null)).toBe(false);
  });

  it('⚠️ leitura que FALHA é 500, nunca "fora do recorte" (404 falso)', async () => {
    const banco = bancoDeCards({ data: null, error: { message: 'timeout' } });
    await expect(contatoNoRecorte(ctx(['p1'], banco.supabase), 'c1')).rejects.toMatchObject({
      code: 'internal',
      status: 500,
    });
  });
});

describe('exigirFiltroDoCliente', () => {
  it('chave recortada sem contact_id: 400; com ele, passa', () => {
    expect(() => exigirFiltroDoCliente(ctx(['p1']), false)).toThrow(ApiError);
    expect(() => exigirFiltroDoCliente(ctx(['p1']), true)).not.toThrow();
  });

  it('sem recorte, nada é exigido (o contrato de sempre)', () => {
    expect(() => exigirFiltroDoCliente(ctx(null), false)).not.toThrow();
  });
});
