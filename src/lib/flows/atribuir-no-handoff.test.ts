import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { atribuicaoDoHandoff, membroEscolhidoNoHandoff } from './atribuir-no-handoff';

// ============================================================
// "Atribuir a" do "Transferir para atendente" (2.7): o motor confere, na
// hora, que o escolhido ainda é membro da conta do robô. Quem saiu não
// recebe a conversa (nem o aviso com o nome do cliente), e leitura que
// falha não atribui.
// ============================================================

const MEMBRO = '582aad06-4836-4865-b850-0466fff8bc7d';

describe('membroEscolhidoNoHandoff', () => {
  it('lê o assign_to aparado; vazio, ausente ou não-texto = ninguém', () => {
    expect(membroEscolhidoNoHandoff({ assign_to: ` ${MEMBRO} ` })).toBe(MEMBRO);
    expect(membroEscolhidoNoHandoff({ assign_to: '' })).toBeNull();
    expect(membroEscolhidoNoHandoff({ assign_to: '   ' })).toBeNull();
    expect(membroEscolhidoNoHandoff({})).toBeNull();
    expect(membroEscolhidoNoHandoff({ assign_to: 42 })).toBeNull();
    expect(membroEscolhidoNoHandoff(null)).toBeNull();
  });
});

describe('atribuicaoDoHandoff', () => {
  function banco(resp: { data: unknown; error: { message: string } | null } | 'lanca') {
    const filtros: Array<[string, unknown]> = [];
    let tabela = '';
    let colunas = '';
    const db = {
      from(t: string) {
        tabela = t;
        const b = {
          select: (c: string) => ((colunas = c), b),
          eq: (c: string, v: unknown) => (filtros.push([c, v]), b),
          is: (c: string, v: unknown) => (filtros.push([`is:${c}`, v]), b),
          limit: () => (resp === 'lanca' ? Promise.reject(new Error('rede')) : Promise.resolve(resp)),
        };
        return b;
      },
    } as unknown as SupabaseClient;
    return { db, filtros, pedido: () => ({ tabela, colunas }) };
  }

  it('membro DESTA conta: atribui, lendo profiles pela conta e pelo user_id', async () => {
    const { db, filtros, pedido } = banco({ data: [{ user_id: MEMBRO }], error: null });
    expect(await atribuicaoDoHandoff(db, 'acc', MEMBRO)).toEqual({ userId: MEMBRO });
    expect(pedido()).toEqual({ tabela: 'profiles', colunas: 'user_id' });
    expect(filtros).toEqual([
      ['account_id', 'acc'],
      ['user_id', MEMBRO],
      // 1067: quem está suspenso não é achado, e a conversa fica na fila.
      ['is:suspenso_em', null],
    ]);
  });

  it('CRÍTICO: quem não é (mais) membro NÃO recebe a conversa', async () => {
    const { db } = banco({ data: [], error: null });
    expect(await atribuicaoDoHandoff(db, 'acc', MEMBRO)).toEqual({ userId: null, motivo: 'nao_membro' });
  });

  it('leitura que falha (erro devolvido ou lançado) não atribui, e diz por quê', async () => {
    expect(
      await atribuicaoDoHandoff(banco({ data: null, error: { message: 'timeout' } }).db, 'acc', MEMBRO),
    ).toEqual({ userId: null, motivo: 'leitura_falhou' });
    expect(await atribuicaoDoHandoff(banco('lanca').db, 'acc', MEMBRO)).toEqual({
      userId: null,
      motivo: 'leitura_falhou',
    });
  });

  it('id sem forma de UUID não vai ao banco: "não é membro", não "leitura falhou"', async () => {
    const { db, filtros } = banco({ data: [{ user_id: 'x' }], error: null });
    expect(await atribuicaoDoHandoff(db, 'acc', 'fulano')).toEqual({ userId: null, motivo: 'nao_membro' });
    expect(filtros).toEqual([]);
  });
});
