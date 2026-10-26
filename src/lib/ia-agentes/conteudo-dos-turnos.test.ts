import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PRAZO_DO_CONTEUDO_DO_TURNO_DIAS,
  TURNOS_POR_LOTE_DA_PODA,
  podarConteudoDosTurnos,
} from './conteudo-dos-turnos';

// A poda do conteúdo dos turnos (1110, DC2): o laço sob o prazo do ciclo de
// manutenção. O banco decide o que limpar; aqui, o prazo, o lote e o "nunca
// lança".

const respostas: Array<{ data: unknown; error: { message: string } | null }> =
  [];
const rpc = vi.fn(async () => respostas.shift() ?? { data: 0, error: null });
const admin = { rpc } as unknown as SupabaseClient;

beforeEach(() => {
  respostas.length = 0;
  rpc.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('podarConteudoDosTurnos', () => {
  it('o prazo do conteúdo é o decidido pelo operador (DC2: 90 dias)', () => {
    expect(PRAZO_DO_CONTEUDO_DO_TURNO_DIAS).toBe(90);
    expect(TURNOS_POR_LOTE_DA_PODA).toBeGreaterThan(0);
    // O teto da função no banco é 1.000.
    expect(TURNOS_POR_LOTE_DA_PODA).toBeLessThanOrEqual(1000);
  });

  it('chama a RPC com o prazo e o lote, e repete enquanto o lote vem CHEIO', async () => {
    respostas.push(
      { data: TURNOS_POR_LOTE_DA_PODA, error: null },
      { data: TURNOS_POR_LOTE_DA_PODA, error: null },
      { data: 7, error: null }
    );
    const r = await podarConteudoDosTurnos(admin, Date.now() + 60_000);
    expect(r).toEqual({ limpos: 2 * TURNOS_POR_LOTE_DA_PODA + 7, erro: null });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenCalledWith('cb_ia_podar_conteudo_dos_turnos', {
      p_dias: PRAZO_DO_CONTEUDO_DO_TURNO_DIAS,
      p_limite: TURNOS_POR_LOTE_DA_PODA,
    });
  });

  it('nada a podar: uma chamada só', async () => {
    expect(await podarConteudoDosTurnos(admin, Date.now() + 60_000)).toEqual({
      limpos: 0,
      erro: null,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('prazo vencido: não chama', async () => {
    expect(await podarConteudoDosTurnos(admin, Date.now() - 1)).toEqual({
      limpos: 0,
      erro: null,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('erro do banco: PARA e devolve o motivo, sem lançar (o que já saiu conta)', async () => {
    respostas.push(
      { data: TURNOS_POR_LOTE_DA_PODA, error: null },
      { data: null, error: { message: 'timeout' } }
    );
    const r = await podarConteudoDosTurnos(admin, Date.now() + 60_000);
    expect(r).toEqual({ limpos: TURNOS_POR_LOTE_DA_PODA, erro: 'timeout' });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('resposta fora da forma: PARA (repetir giraria em falso até o prazo)', async () => {
    respostas.push({ data: '200', error: null });
    const r = await podarConteudoDosTurnos(admin, Date.now() + 60_000);
    expect(r.limpos).toBe(0);
    expect(r.erro).toMatch(/a poda devolveu/);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a RPC que LANÇA (rede) também não sai para fora', async () => {
    rpc.mockImplementationOnce(async () => {
      throw new Error('fetch failed');
    });
    await expect(
      podarConteudoDosTurnos(admin, Date.now() + 60_000)
    ).resolves.toEqual({
      limpos: 0,
      erro: 'fetch failed',
    });
  });
});
