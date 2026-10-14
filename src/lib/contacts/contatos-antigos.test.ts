import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fichaPorContatoAntigo, fichasPeloTelefoneAntigo } from './contatos-antigos';

// ============================================================
// CONTATOS ANTIGOS (1092, D9): só o TELEFONE de uma ficha unida encontra a
// que ficou — nos cadastros e na busca `?search=` da API v1 (D9 refinada,
// 14/10/2026; a RPC perdeu o `p_email` na 1093). O e-mail antigo só acende o
// aviso de possível duplicata, que não passa por aqui.
// ============================================================

type Resposta = { data: unknown; error: { message: string } | null };

function dbComRpc(resposta: Resposta) {
  const rpc = vi.fn<(nome: string, args: Record<string, unknown>) => Promise<Resposta>>(async () => resposta);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe('fichaPorContatoAntigo — a busca dos cadastros', () => {
  it('manda EXATAMENTE os três argumentos da 1093 (sem `p_email`), com o telefone na forma canônica', async () => {
    const { db, rpc } = dbComRpc({ data: 'ficou-1', error: null });
    // 12 dígitos sem o nono: a canônica ganha o 9, como o valor guardado (1024).
    const r = await fichaPorContatoAntigo(db, 'conta-1', { telefone: '550099990001', nome: 'Maria Exemplo' });
    expect(r).toBe('ficou-1');
    expect(rpc).toHaveBeenCalledTimes(1);
    // `toStrictEqual`: um `p_email: undefined` a mais também reprova — o
    // PostgREST escolhe a função pelos nomes dos argumentos.
    expect(rpc.mock.calls[0]).toStrictEqual([
      'cb_ficha_por_contato_antigo',
      { p_conta: 'conta-1', p_telefone_canonico: '5500999990001', p_nome: 'Maria Exemplo' },
    ]);
  });

  it.each([[null], [''], ['sem dígito nenhum']])('sem telefone (%j): nulo, sem ir ao banco', async (telefone) => {
    const { db, rpc } = dbComRpc({ data: 'ficou-1', error: null });
    expect(await fichaPorContatoAntigo(db, 'conta-1', { telefone, nome: 'Maria' })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([[null], [undefined], ['   ']])('sem nome (%j): nulo, sem ir ao banco — a régua do primeiro nome não casaria', async (nome) => {
    const { db, rpc } = dbComRpc({ data: 'ficou-1', error: null });
    expect(await fichaPorContatoAntigo(db, 'conta-1', { telefone: '5500999990001', nome })).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('nenhuma ficha: nulo', async () => {
    const { db } = dbComRpc({ data: null, error: null });
    expect(await fichaPorContatoAntigo(db, 'conta-1', { telefone: '5500999990001', nome: 'Maria' })).toBeNull();
  });

  it('⚠️ erro de banco ESTOURA — nunca vira "não achei" (o cadastro recriaria a duplicata)', async () => {
    const { db } = dbComRpc({ data: null, error: { message: 'timeout' } });
    await expect(fichaPorContatoAntigo(db, 'conta-1', { telefone: '5500999990001', nome: 'Maria' })).rejects.toThrow(
      /a busca falhou \(timeout\)/,
    );
  });
});

/** Um banco que só conhece `cb_contatos_antigos` e anota cada filtro, na ordem. */
function dbDosAntigos(resposta: Resposta) {
  const filtros: unknown[][] = [];
  const tabelas: string[] = [];
  const cadeia: Record<string, unknown> = {};
  for (const metodo of ['select', 'eq', 'regexIMatch', 'order', 'limit']) {
    cadeia[metodo] = (...args: unknown[]) => {
      filtros.push([metodo, ...args]);
      return cadeia;
    };
  }
  cadeia.then = (resolver: (v: unknown) => unknown) => Promise.resolve(resposta).then(resolver);
  const db = {
    from: (tabela: string) => {
      tabelas.push(tabela);
      return cadeia;
    },
  } as unknown as SupabaseClient;
  return { db, filtros, tabelas };
}

describe('fichasPeloTelefoneAntigo — a busca `?search=` da API v1', () => {
  it('termo de 8 dígitos ou mais: procura NA CONTA, só telefone, pelo pedaço — e devolve cada ficha uma vez', async () => {
    const { db, filtros, tabelas } = dbDosAntigos({
      data: [{ contact_id: 'ficha-a' }, { contact_id: 'ficha-a' }, { contact_id: 'ficha-b' }],
      error: null,
    });
    expect(await fichasPeloTelefoneAntigo(db, 'conta-1', '99990001')).toEqual(['ficha-a', 'ficha-b']);
    expect(tabelas).toEqual(['cb_contatos_antigos']);
    expect(filtros).toEqual([
      ['select', 'contact_id'],
      // A API roda em service role: o recorte da conta é explícito.
      ['eq', 'account_id', 'conta-1'],
      ['eq', 'tipo', 'telefone'],
      ['regexIMatch', 'valor', '99990001'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 100],
    ]);
  });

  it('o número completo sem o nono dígito passa pela régua canônica do valor guardado', async () => {
    const { db, filtros } = dbDosAntigos({ data: [], error: null });
    await fichasPeloTelefoneAntigo(db, 'conta-1', '550099990001');
    expect(filtros).toContainEqual(['regexIMatch', 'valor', '5500999990001']);
  });

  it.each([
    ['nome', 'Ana'],
    ['nome e dígitos — traria, pelos dígitos, a ficha de outra pessoa', 'Ana 99990001'],
    ['telefone formatado — não acha nem o telefone atual', '(00) 99999-0001'],
    ['com +', '+5500999990001'],
    ['menos de 8 dígitos', '9999000'],
    ['vazio', ''],
  ])('%s: vazio, sem ir ao banco', async (_caso, termo) => {
    const { db, tabelas } = dbDosAntigos({ data: [{ contact_id: 'ficha-a' }], error: null });
    expect(await fichasPeloTelefoneAntigo(db, 'conta-1', termo)).toEqual([]);
    expect(tabelas).toEqual([]);
  });

  it('⚠️ erro de banco ESTOURA — a busca diria "não achei" sobre a ficha que existe', async () => {
    const { db } = dbDosAntigos({ data: null, error: { message: 'timeout' } });
    await expect(fichasPeloTelefoneAntigo(db, 'conta-1', '99990001')).rejects.toThrow(
      /a busca pelo telefone falhou \(timeout\)/,
    );
  });
});
